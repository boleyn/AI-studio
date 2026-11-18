// Package pairbridge exposes a loopback-only, origin-bound pairing handoff.
package pairbridge

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"

	"fastgpt.local/local-device/internal/connector"
	"fastgpt.local/local-device/internal/transport"
)

const Address = "127.0.0.1:13005"

var invitePattern = regexp.MustCompile(`^[A-Fa-f0-9]{20}$`)

var noncePattern = regexp.MustCompile(`^[a-fA-F0-9-]{36}$`)

type Server struct {
	// ClientVersion is set before Listen; status exposes build metadata, never authorization.
	ClientVersion       string
	LocalInvite         func(string, string) bool
	LocalInviteDecision func(string, string, chan<- bool) bool
	LocalDevices        func(string) []string
	lastInvite          time.Time
	origin              string
	confirm             func(context.Context, string) error
	mu                  sync.Mutex
	pending             *connector.PairingNotice
	bound               string
	devices             []string
	busy                bool
	used                map[string]bool
}

// New binds the handoff to the connector's configured platform; request bodies cannot select a platform.
func New(origin string, confirm func(context.Context, string) error) (*Server, error) {
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" || !transport.SecureURL(u, "https", "http") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || confirm == nil {
		return nil, errors.New("invalid_pairing_bridge_configuration")
	}
	return &Server{origin: origin, confirm: confirm, used: make(map[string]bool)}, nil
}

// Bound records only this connector's paired identity, never a webpage-supplied device ID.
func (s *Server) Bound(deviceID string) { s.mu.Lock(); s.bound = deviceID; s.mu.Unlock() }

// BoundDevices publishes only non-secret identities associated with the active origin.
func (s *Server) BoundDevices(ids []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.devices = append([]string(nil), ids...)
	s.bound = ""
	if len(ids) > 0 {
		s.bound = ids[0]
	}
}

// Show keeps the pending request local; unlike the legacy dialog it does not navigate or require typed codes.
func (s *Server) Show(ctx context.Context, notice connector.PairingNotice) error {
	s.mu.Lock()
	s.pending = &notice
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		if s.pending == &notice {
			s.pending = nil
		}
		s.mu.Unlock()
	}()
	<-ctx.Done()
	return ctx.Err()
}

// Listen never binds to a LAN interface. CORS, Host and native approval are enforced by ServeHTTP.
func (s *Server) Listen() (func() error, error) {
	listener, err := net.Listen("tcp", Address)
	if err != nil {
		return nil, err
	}
	server := &http.Server{Handler: s, ReadHeaderTimeout: 3 * time.Second, IdleTimeout: 5 * time.Second, MaxHeaderBytes: 8192}
	go func() { _ = server.Serve(listener) }()
	return func() error {
		// Close the listener even if Serve has not registered it yet.
		_ = listener.Close()
		return server.Close()
	}, nil
}

// ServeHTTP releases the short-lived confirmation code only after local approval for the exact platform origin.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	origin := r.Header.Get("Origin")
	// 桌面多账号模式对主平台也使用邀请确认，旧网页仍可走原来的 /pair。
	primaryInvite := origin == s.origin && (r.URL.Path == "/status" || r.URL.Path == "/invite")
	if r.Host == Address && s.LocalInvite != nil && (primaryInvite || isLoopbackOrigin(origin) && (r.URL.Path == "/status" || r.URL.Path == "/invite") || r.URL.Path == "/invite" && isWebOrigin(origin)) {
		s.serveLocalInvite(w, r, origin)
		return
	}
	if r.Host != Address || origin != s.origin {
		http.Error(w, "origin_not_allowed", http.StatusForbidden)
		return
	}
	w.Header().Set("Access-Control-Allow-Origin", s.origin)
	w.Header().Set("Vary", "Origin")
	// 已绑定身份只用于页面与本人设备列表核对，不返回密钥、短码或执行授权。
	if r.URL.Path == "/status" && r.URL.RawQuery == "" && r.Method == http.MethodGet {
		s.mu.Lock()
		bound, ids := s.bound, s.devices
		s.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		result := map[string]any{"deviceId": bound, "version": s.ClientVersion, "platform": runtime.GOOS}
		if len(ids) > 1 {
			result["deviceIds"] = ids
		}
		_ = json.NewEncoder(w).Encode(result)
		return
	}
	if r.URL.Path != "/pair" || r.URL.RawQuery != "" {
		http.NotFound(w, r)
		return
	}
	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Methods", "POST")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Private-Network", "true")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost || !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		http.Error(w, "invalid_request", http.StatusBadRequest)
		return
	}
	var body struct {
		Nonce string `json:"nonce"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&body) != nil || decoder.Decode(new(any)) != io.EOF || !noncePattern.MatchString(body.Nonce) {
		http.Error(w, "invalid_request", http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	notice := s.pending
	bound := s.bound
	if bound != "" {
		s.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"deviceId": bound})
		return
	}
	if s.busy || s.used[body.Nonce] || len(s.used) >= 128 {
		s.mu.Unlock()
		http.Error(w, "pairing_busy", http.StatusConflict)
		return
	}
	if (notice == nil && bound == "") || (notice != nil && notice.ExpiresAt <= time.Now().UnixMilli()) {
		s.mu.Unlock()
		http.Error(w, "no_pending_pairing", http.StatusConflict)
		return
	}
	s.busy = true
	s.used[body.Nonce] = true
	s.mu.Unlock()
	defer func() { s.mu.Lock(); s.busy = false; s.mu.Unlock() }()
	deadline := time.Now().Add(2 * time.Minute)
	if notice != nil {
		deadline = time.UnixMilli(notice.ExpiresAt)
	}
	ctx, cancel := context.WithDeadline(r.Context(), deadline)
	defer cancel()
	if s.confirm(ctx, s.origin) != nil {
		http.Error(w, "local_pairing_rejected", http.StatusForbidden)
		return
	}

	s.mu.Lock()
	valid := s.pending == notice && notice.ExpiresAt > time.Now().UnixMilli()
	s.mu.Unlock()
	if !valid {
		http.Error(w, "pairing_expired", http.StatusConflict)
		return
	}
	if notice.Origin != s.origin {
		http.Error(w, "pairing_origin_mismatch", http.StatusConflict)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"pairingId": notice.PairingID, "confirmationCode": notice.Code})
}

// isWebOrigin accepts browser origins for invite-only handoff. Native confirmation
// remains mandatory; cross-platform callers cannot read status or pairing data.
func isWebOrigin(origin string) bool {
	u, err := url.Parse(origin)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Hostname() != "" &&
		u.User == nil && u.Path == "" && u.RawQuery == "" && !u.ForceQuery && u.Fragment == ""
}

// isLoopbackOrigin limits development handoff to browser pages served on this machine.
func isLoopbackOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil || u.User != nil || u.Path != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" ||
		(u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	host := u.Hostname()
	ip := net.ParseIP(host)
	return strings.EqualFold(host, "localhost") || (ip != nil && ip.IsLoopback())
}

// serveLocalInvite never reads legacy pairing secrets. The invite is redeemed
// against its requesting origin only after the normal native account confirmation.
func (s *Server) serveLocalInvite(w http.ResponseWriter, r *http.Request, origin string) {
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Vary", "Origin")
	if r.URL.RawQuery != "" || (r.URL.Path != "/status" && r.URL.Path != "/invite") {
		http.NotFound(w, r)
		return
	}
	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Private-Network", "true")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.URL.Path == "/status" && r.Method == http.MethodGet {
		result := map[string]any{"deviceId": "", "inviteHandoff": true, "inviteDecision": s.LocalInviteDecision != nil, "version": s.ClientVersion, "platform": runtime.GOOS}
		if origin == s.origin {
			s.mu.Lock()
			result["deviceId"] = s.bound
			if len(s.devices) > 1 {
				result["deviceIds"] = s.devices
			}
			s.mu.Unlock()
		}
		if s.LocalDevices != nil {
			if ids := s.LocalDevices(origin); len(ids) > 0 {
				result["deviceId"], result["deviceIds"] = ids[0], ids
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(result)
		return
	}
	if r.URL.Path != "/invite" || r.Method != http.MethodPost || !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		http.Error(w, "invalid_request", http.StatusBadRequest)
		return
	}
	var body struct {
		Code            string `json:"code"`
		WaitForDecision bool   `json:"waitForDecision"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&body) != nil || decoder.Decode(new(any)) != io.EOF || !invitePattern.MatchString(body.Code) {
		http.Error(w, "invalid_request", http.StatusBadRequest)
		return
	}
	if origin != s.origin && !isLoopbackOrigin(origin) && !body.WaitForDecision {
		http.Error(w, "origin_not_allowed", http.StatusForbidden)
		return
	}
	var decision chan bool
	s.mu.Lock()
	accepted := false
	if time.Since(s.lastInvite) >= 3*time.Second {
		if body.WaitForDecision && s.LocalInviteDecision != nil {
			decision = make(chan bool, 1)
			accepted = s.LocalInviteDecision(origin, body.Code, decision)
		} else if !body.WaitForDecision {
			accepted = s.LocalInvite(origin, body.Code)
		}
		if accepted {
			s.lastInvite = time.Now()
		}
	}
	s.mu.Unlock()
	if !accepted {
		http.Error(w, "pairing_busy", http.StatusConflict)
		return
	}
	// 兼容只等待接收回执的旧网页。新版等待本机对话框的决定。
	if decision != nil {
		select {
		case allowed := <-decision:
			if !allowed {
				http.Error(w, "authorization_rejected", http.StatusForbidden)
				return
			}
		case <-r.Context().Done():
			return
		}
	}
	w.WriteHeader(http.StatusAccepted)
}
