package connector

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fastgpt.local/local-device/internal/transport"
	"net/http"
	"net/url"
	"time"

	"fastgpt.local/local-device/internal/grant"
	"fastgpt.local/local-device/internal/journal"
	"fastgpt.local/local-device/internal/operation"
)

// PairingNotice is safe for a local window: it deliberately excludes the poll token.
type PairingNotice struct {
	Origin    string
	PairingID string
	Code      string
	ExpiresAt int64
}
type PairingOptions struct {
	InviteCode  string
	Journal     *journal.Journal
	Key         ed25519.PrivateKey
	Name        string
	Platform    string
	Show        func(PairingNotice) error
	ShowContext func(context.Context, PairingNotice) error
}

// ErrReauthenticationRequired marks a rejected device identity, distinct from transient network errors.
var ErrReauthenticationRequired = errors.New("device_reauthentication_required")

// EnsureBinding resumes a stored identity or starts one explicitly visible pairing attempt.
// Expiry/failure returns to the caller; it never silently starts a replacement pairing.
func (p *PlatformClient) EnsureBinding(ctx context.Context, input PairingOptions) (string, error) {
	if input.Journal == nil || len(input.Key) != ed25519.PrivateKeySize || (input.InviteCode == "" && input.Show == nil && input.ShowContext == nil) {
		return "", errors.New("invalid_pairing_configuration")
	}
	hash := sha256.Sum256(input.Key.Public().(ed25519.PublicKey))
	fingerprint := hex.EncodeToString(hash[:])
	bindings, err := input.Journal.Bindings(ctx, p.base)
	if err != nil {
		return "", err
	}
	for _, binding := range bindings {
		if binding.Fingerprint != fingerprint {
			return "", errors.New("device_identity_changed")
		}
	}
	if input.InviteCode != "" {
		deviceID, err := p.RedeemInvite(ctx, input.InviteCode, input.Name, input.Platform, input.Key)
		if err != nil {
			return "", err
		}
		binding := journal.Binding{Origin: p.base, DeviceID: deviceID, Fingerprint: fingerprint}
		if len(bindings) == 0 {
			err = input.Journal.SaveBinding(ctx, binding)
		} else {
			err = input.Journal.AddBinding(ctx, binding)
		}
		return deviceID, err
	}
	if len(bindings) > 0 {
		return bindings[0].DeviceID, nil
	}
	pairing, err := p.StartPairing(ctx, input.Name, input.Platform, input.Key)
	if err != nil {
		return "", err
	}
	pairingCtx, cancel := context.WithTimeout(ctx, time.UnixMilli(pairing.ExpiresAt).Sub(p.clock.Now()))
	defer cancel()
	notice := PairingNotice{Origin: p.base, PairingID: pairing.PairingID, Code: pairing.ConfirmationCode, ExpiresAt: pairing.ExpiresAt}
	var noticeDone chan error
	if input.ShowContext != nil {
		noticeDone = make(chan error, 1)
		go func() { noticeDone <- input.ShowContext(pairingCtx, notice) }()
	} else if err = input.Show(notice); err != nil {
		return "", err
	}
	for {
		// 本机握手等待用户确认时不能阻塞平台轮询；绑定成功后立即连接。
		var noticeErr error
		select {
		case noticeErr = <-noticeDone:
			noticeDone = nil
		default:
		}
		state, err := p.PollPairing(pairingCtx, pairing)
		if err != nil {
			return "", err
		}
		if state.Status == "confirmed" {
			if err = input.Journal.SaveBinding(pairingCtx, journal.Binding{Origin: p.base, DeviceID: state.DeviceID, Fingerprint: fingerprint}); err != nil {
				return "", err
			}
			return state.DeviceID, nil
		}
		// 关闭本机窗口可能发生在网页确认之后；先核对绑定结果，避免误报掉线。
		if noticeErr != nil {
			return "", noticeErr
		}
		if err = waitForReconnect(pairingCtx, 3*time.Second); err != nil {
			return "", err
		}
	}
}

type RunOptions struct {
	Profile     func(*MemberProfile)
	OpenSession func(context.Context, grant.Owner) (*LocalSession, error)
	HandleGrant func(context.Context, string, grant.Grant, int64) (grant.Grant, error)
	Prepare     func(context.Context, operation.Request) (context.Context, operation.Request, context.CancelFunc, error)
	DeviceID    string
	Key         ed25519.PrivateKey
	GatewayURL  string
	Service     *operation.Service
	HTTPClient  *http.Client
	Status      func(string)
}

// Run renews authentication on every connection attempt. It never resends commands:
// operation recovery and deduplication belong to the durable local journal.
func (p *PlatformClient) Run(ctx context.Context, input RunOptions) error {
	address, err := url.Parse(input.GatewayURL)
	if err != nil || !transport.SecureURL(address, "wss", "ws") || address.Host == "" || address.User != nil || address.RawQuery != "" || address.Fragment != "" || (input.Service == nil && input.OpenSession == nil) || input.DeviceID == "" || len(input.Key) != ed25519.PrivateKeySize {
		return errors.New("invalid_connector_configuration")
	}
	backoff := time.Second
	for {
		if err = ctx.Err(); err != nil {
			return err
		}
		if input.Status != nil {
			input.Status("authenticating")
		}
		ticket, authErr := p.Authenticate(ctx, input.DeviceID, input.Key)
		if errors.Is(authErr, ErrReauthenticationRequired) {
			return ErrReauthenticationRequired
		}
		if authErr == nil {
			if input.Profile != nil {
				input.Profile(ticket.Profile)
			}
			if input.Status != nil {
				input.Status("connecting")
			}
			started := time.Now()
			_ = Connect(ctx, Options{URL: input.GatewayURL, Ticket: ticket.Ticket, RefreshTicket: func(ctx context.Context) (ConnectionTicket, error) {
				return p.Authenticate(ctx, input.DeviceID, input.Key)
			}, OpenSession: input.OpenSession, Service: input.Service, Prepare: input.Prepare, HandleGrant: input.HandleGrant, HTTPClient: input.HTTPClient, OnConnected: func() {
				if input.Status != nil {
					input.Status("connected")
				}
			}})
			if time.Since(started) > 30*time.Second {
				backoff = time.Second
			}
		}
		if input.Status != nil {
			input.Status("disconnected")
		}
		if err = waitForReconnect(ctx, backoff); err != nil {
			return err
		}
		if backoff < 30*time.Second {
			backoff *= 2
			if backoff > 30*time.Second {
				backoff = 30 * time.Second
			}
		}
	}
}

func waitForReconnect(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
