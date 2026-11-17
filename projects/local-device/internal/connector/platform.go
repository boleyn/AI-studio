package connector

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fastgpt.local/local-device/internal/remoteclock"
	"fastgpt.local/local-device/internal/transport"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"syscall"
	"time"
)

// PlatformClient handles pairing and proof of possession, never sending the private key.
type PlatformClient struct {
	clock  *remoteclock.Clock
	base   string
	client http.Client
}

var ErrPlatformRejected = errors.New("platform_request_rejected")

// InviteRequestError retains only numeric diagnostic details, never raw server text.
type InviteRequestError struct {
	HTTPStatus int
	Code       int
}

func (e *InviteRequestError) Error() string {
	return fmt.Sprintf("invite_request_rejected_http_%d_code_%d", e.HTTPStatus, e.Code)
}

type Pairing struct {
	PairingID        string `json:"pairingId"`
	PollToken        string `json:"pollToken"`
	ConfirmationCode string `json:"confirmationCode"`
	ExpiresAt        int64  `json:"expiresAt"`
}
type PairingState struct {
	Status   string `json:"status"`
	DeviceID string `json:"deviceId"`
}
type MemberProfile struct {
	MemberName string `json:"memberName"`
	Avatar     string `json:"avatar"`
}

type InvitePreview struct {
	Account string         `json:"account"`
	Team    string         `json:"team"`
	Profile *MemberProfile `json:"profile"`
}

type ConnectionTicket struct {
	Profile   *MemberProfile `json:"profile"`
	Ticket    string         `json:"ticket"`
	ExpiresAt int64          `json:"expiresAt"`
}

// Discover reads only the public connector address from the explicitly selected
// platform (HTTP or HTTPS). It never derives a gateway from redirects or an internal RPC URL.
func (p *PlatformClient) Discover(ctx context.Context) (string, error) {
	var response struct {
		Available  bool   `json:"available"`
		Version    int    `json:"protocolVersion"`
		GatewayURL string `json:"gatewayUrl"`
	}
	if err := p.call(ctx, "discovery", nil, &response); err != nil {
		return "", err
	}
	if !response.Available {
		return "", errors.New("platform_connector_unavailable")
	}
	address, err := url.Parse(response.GatewayURL)
	if err != nil || response.Version != 1 || !transport.SecureURL(address, "wss", "ws") || address.Host == "" || address.User != nil || address.RawQuery != "" || address.Fragment != "" || len(response.GatewayURL) > 2048 {
		return "", errors.New("invalid_gateway_discovery")
	}
	return response.GatewayURL, nil
}

// NewPlatformClient accepts explicit HTTP/HTTPS origins and refuses redirects.
func NewPlatformClient(origin string, client *http.Client) (*PlatformClient, error) {
	u, err := url.Parse(origin)
	if err != nil || !transport.SecureURL(u, "https", "http") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return nil, errors.New("invalid_platform_origin")
	}
	if client == nil {
		client = http.DefaultClient
	}
	transport := *client
	transport.Timeout = 10 * time.Second
	transport.CheckRedirect = func(*http.Request, []*http.Request) error { return errors.New("platform_redirect_rejected") }
	return &PlatformClient{clock: remoteclock.New(), base: strings.TrimSuffix(origin, "/"), client: transport}, nil
}

// call bounds responses and sanitizes errors: response bodies may contain credentials.
// Mutating requests are never automatically retried after an ambiguous transport failure.
func (p *PlatformClient) call(ctx context.Context, path string, input, output any) error {
	payload, err := json.Marshal(input)
	if err != nil {
		return errors.New("invalid_platform_request")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.base+"/api/core/localDevice/"+path, bytes.NewReader(payload))
	if err != nil {
		return errors.New("invalid_platform_request")
	}
	req.Header.Set("Content-Type", "application/json")
	response, err := p.client.Do(req)
	if err != nil {
		return platformConnectionError(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 && path != "invite" && path != "connect" {
		return ErrPlatformRejected
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, 16385))
	if err != nil || len(raw) > 16384 {
		return errors.New("invalid_platform_response")
	}
	var envelope struct {
		Code    int             `json:"code"`
		Message string          `json:"message"`
		Data    json.RawMessage `json:"data"`
	}
	if json.Unmarshal(raw, &envelope) != nil {
		if path == "invite" && response.StatusCode != 200 {
			return &InviteRequestError{HTTPStatus: response.StatusCode}
		}
		return errors.New("invalid_platform_response")
	}
	if response.StatusCode != 200 || envelope.Code != 200 || len(envelope.Data) == 0 || bytes.Equal(envelope.Data, []byte("null")) {
		// 只有挑战入口明确拒绝设备才删除绑定。交换失败、限流和代理错误可重试。
		if fields, ok := input.(map[string]string); path == "connect" && ok && fields["action"] == "challenge" && envelope.Message == "device_auth_failed" {
			return ErrReauthenticationRequired
		}
		// 只传播已知邀请错误码，不把服务端原始正文或凭据展示到桌面。
		if path == "invite" {
			switch envelope.Message {
			case "device_invite_expired", "device_invite_cancelled", "device_invite_used", "device_invite_unavailable", "device_pair_rate_limited":
				return errors.New(envelope.Message)
			}
			return &InviteRequestError{HTTPStatus: response.StatusCode, Code: envelope.Code}
		}
		return ErrPlatformRejected
	}

	if json.Unmarshal(envelope.Data, output) != nil {
		return errors.New("invalid_platform_response")
	}
	// Use the selected platform's HTTP clock for pre-WebSocket challenge/ticket
	// validation as well. Missing/invalid Date preserves legacy behavior; HTTPS
	// certificate verification and redirect rejection remain unchanged.
	if date, err := http.ParseTime(response.Header.Get("Date")); err == nil {
		p.clock.Observe(date.UnixMilli())
	}
	return nil
}

// platformConnectionError keeps the network failure actionable without exposing request URLs or credentials.
func platformConnectionError(err error) error {
	code := "platform_unavailable"
	var dns *net.DNSError
	var authority x509.UnknownAuthorityError
	var certificate x509.CertificateInvalidError
	var hostname x509.HostnameError
	var network net.Error
	switch {
	case errors.As(err, &dns):
		code = "platform_dns_failed"
	case errors.As(err, &authority), errors.As(err, &certificate), errors.As(err, &hostname):
		code = "platform_certificate_invalid"
	case errors.Is(err, syscall.EPERM), errors.Is(err, syscall.EACCES):
		code = "platform_permission_denied"
	case errors.Is(err, syscall.EHOSTUNREACH), errors.Is(err, syscall.ENETUNREACH):
		code = "platform_host_unreachable"
	case errors.Is(err, syscall.ECONNREFUSED):
		code = "platform_connection_refused"
	case errors.As(err, &network) && network.Timeout():
		code = "platform_connection_timeout"
	}
	return errors.New(code)
}

// StartPairing uploads only the Ed25519 public key. The returned poll token stays in the connector.
func (p *PlatformClient) StartPairing(ctx context.Context, name, platform string, key ed25519.PrivateKey) (Pairing, error) {
	if len(key) != ed25519.PrivateKeySize {
		return Pairing{}, errors.New("invalid_device_key")
	}
	der, err := x509.MarshalPKIXPublicKey(key.Public())
	if err != nil {
		return Pairing{}, err
	}
	publicKey := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}))
	var pairing Pairing
	err = p.call(ctx, "pair", map[string]string{"action": "start", "name": name, "platform": platform, "publicKey": publicKey}, &pairing)
	if err != nil {
		return Pairing{}, err
	}
	if len(pairing.PairingID) != 32 || len(pairing.PollToken) != 43 || len(pairing.ConfirmationCode) != 6 || pairing.ExpiresAt <= p.clock.Now().UnixMilli() {
		return Pairing{}, errors.New("invalid_pairing_response")
	}
	return pairing, nil
}

// PreviewInvite resolves the account shown in the native approval dialog.
func (p *PlatformClient) PreviewInvite(ctx context.Context, code string) (InvitePreview, error) {
	var result InvitePreview
	err := p.call(ctx, "invite", map[string]string{"action": "preview", "code": code}, &result)
	return result, err
}

// RedeemInvite registers only the public key after native approval.
func (p *PlatformClient) RedeemInvite(ctx context.Context, code, name, platform string, key ed25519.PrivateKey) (string, error) {
	der, err := x509.MarshalPKIXPublicKey(key.Public())
	if err != nil {
		return "", err
	}
	var result struct {
		DeviceID string `json:"deviceId"`
	}
	publicKey := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}))
	err = p.call(ctx, "invite", map[string]string{
		"action": "redeem", "code": code, "name": name, "platform": platform, "publicKey": publicKey,
	}, &result)
	if err != nil {
		return "", err
	}
	if result.DeviceID == "" {
		return "", errors.New("invalid_pairing_response")
	}
	return result.DeviceID, nil
}

// PollPairing requires the connector's private polling token, not just the browser's pairing ID.
func (p *PlatformClient) PollPairing(ctx context.Context, pairing Pairing) (PairingState, error) {
	var response struct {
		Result PairingState `json:"result"`
	}
	err := p.call(ctx, "pair", map[string]string{"action": "poll", "pairingId": pairing.PairingID, "pollToken": pairing.PollToken}, &response)
	if err != nil {
		return PairingState{}, err
	}
	if response.Result.Status != "pending" && (response.Result.Status != "confirmed" || response.Result.DeviceID == "") {
		return PairingState{}, errors.New("invalid_pairing_state")
	}
	return response.Result, nil
}

// Authenticate signs the platform's bounded, purpose-bound challenge using the shared JSON-array encoding.
func (p *PlatformClient) Authenticate(ctx context.Context, deviceID string, key ed25519.PrivateKey) (ConnectionTicket, error) {
	if len(key) != ed25519.PrivateKeySize {
		return ConnectionTicket{}, errors.New("invalid_device_key")
	}
	var response struct {
		Proof struct {
			Purpose     string `json:"purpose"`
			ChallengeID string `json:"challengeId"`
			Nonce       string `json:"nonce"`
			DeviceID    string `json:"deviceId"`
			Audience    string `json:"audience"`
			ExpiresAt   int64  `json:"expiresAt"`
		} `json:"proof"`
	}
	if err := p.call(ctx, "connect", map[string]string{"action": "challenge", "deviceId": deviceID}, &response); err != nil {
		return ConnectionTicket{}, err
	}
	proof := response.Proof
	now := p.clock.Now().UnixMilli()
	if proof.Purpose != "local-device-connect-v1" || proof.Audience != "local-device-gateway-v1" || proof.DeviceID != deviceID || len(proof.ChallengeID) != 32 || len(proof.Nonce) != 43 || proof.ExpiresAt <= now || !validRemoteExpiry(proof.ExpiresAt, now, time.Minute) {
		return ConnectionTicket{}, errors.New("invalid_device_challenge")
	}
	payload, err := json.Marshal([]any{proof.Purpose, proof.ChallengeID, proof.Nonce, proof.DeviceID, proof.Audience, proof.ExpiresAt})
	if err != nil {
		return ConnectionTicket{}, err
	}
	signature := base64.RawURLEncoding.EncodeToString(ed25519.Sign(key, payload))
	var ticket ConnectionTicket
	if err = p.call(ctx, "connect", map[string]string{"action": "exchange", "deviceId": deviceID, "challengeId": proof.ChallengeID, "signature": signature}, &ticket); err != nil {
		return ConnectionTicket{}, err
	}
	if len(ticket.Ticket) != 43 || !validRemoteExpiry(ticket.ExpiresAt, p.clock.Now().UnixMilli(), 5*time.Minute) {
		return ConnectionTicket{}, errors.New("invalid_connection_ticket")
	}
	return ticket, nil
}

// validRemoteExpiry tolerates a bounded server clock lead, not a longer server lease.
// Server-side expiry and one-time consumption remain authoritative; locally expired
// responses are rejected. Refresh shares this bound so successful connections stay stable.
func validRemoteExpiry(expiresAt, now int64, lifetime time.Duration) bool {
	const clockSkewAllowance = 30 * time.Second
	return expiresAt > now && expiresAt-now <= (lifetime+clockSkewAllowance).Milliseconds()
}
