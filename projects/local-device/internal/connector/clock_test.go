package connector

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"fastgpt.local/local-device/internal/executor"
	"fastgpt.local/local-device/internal/grant"
	"fastgpt.local/local-device/internal/journal"
	"fastgpt.local/local-device/internal/operation"
	"fastgpt.local/local-device/internal/protocol"
	"github.com/coder/websocket"
)

// Exercise actual TLS WebSocket frames, local approval/renew/revoke, durable
// execution and the installed shell while platform and desktop clocks differ.
func TestPlatformClockNativeExecution(t *testing.T) {
	for _, tc := range []struct {
		name       string
		offset     time.Duration
		negotiated bool
	}{
		{"server_behind_day", -24 * time.Hour, true},
		{"server_ahead_day", 24 * time.Hour, true},
		{"legacy_server", 0, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			dir := t.TempDir()
			ledger, err := journal.Open(filepath.Join(dir, "state"))
			if err != nil {
				t.Fatal(err)
			}
			defer ledger.Close()
			kind := "sh"
			if runtime.GOOS == "windows" {
				kind = "powershell"
			}
			shell, err := executor.ResolveShell(kind)
			if err != nil {
				t.Fatal(err)
			}
			open, err := NewLocalSessionFactory(LocalOptions{DeviceID: "device", Journal: ledger, Shell: shell, Confirm: func(context.Context, grant.Grant) (string, error) { return dir, nil }})
			if err != nil {
				t.Fatal(err)
			}
			done := make(chan error, 1)
			owner := grant.Owner{DeviceID: "device", TeamID: "team", MemberID: "member"}
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				err := func() error {
					if r.Header.Get("X-FastGPT-Clock") != "server-time-v1" {
						return fmt.Errorf("clock capability missing")
					}
					socket, err := websocket.Accept(w, r, nil)
					if err != nil {
						return err
					}
					defer socket.CloseNow()
					now := func() int64 { return time.Now().Add(tc.offset).UnixMilli() }
					send := func(f protocol.Frame) error {
						f.Version, f.Epoch = 1, "epoch"
						if tc.negotiated {
							f.ServerTime = now()
						}
						data, err := json.Marshal(f)
						if err != nil {
							return err
						}
						return socket.Write(ctx, websocket.MessageText, data)
					}
					read := func() (protocol.Frame, error) {
						_, data, err := socket.Read(ctx)
						if err != nil {
							return protocol.Frame{}, err
						}
						return protocol.Decode(data)
					}
					if err := send(protocol.Frame{Type: "welcome", Owner: &owner, AuthExpiresAt: now() + 300000}); err != nil {
						return err
					}
					g := grant.Grant{Owner: owner, ID: "grant", Version: 1, AppID: "app", ChatID: "chat", SourceTarget: "source", ExpiresAt: now() + 3600000}
					if err := send(protocol.Frame{Type: "grant_request", RequestID: "approve", GrantID: g.ID, Grant: &g}); err != nil {
						return err
					}
					approval, err := read()
					if err != nil {
						return err
					}
					if approval.Type != "grant_result" || approval.Grant == nil || approval.Grant.ExpiresAt != g.ExpiresAt {
						return fmt.Errorf("approval: %+v", approval)
					}
					g = *approval.Grant
					if err := send(protocol.Frame{Type: "grant_renew", RequestID: "renew", GrantID: g.ID, Grant: &g, LeaseExpiresAt: now() + 60000}); err != nil {
						return err
					}
					renewal, err := read()
					if err != nil {
						return err
					}
					if renewal.Type != "grant_result" {
						return fmt.Errorf("renewal: %+v", renewal)
					}
					request := operation.Request{ID: "operation", GrantID: g.ID, GrantVersion: g.Version, Command: "echo platform-clock-ok", Workdir: dir, TimeoutMs: 15000, Deadline: now() + 120000}
					if err := send(protocol.Frame{Type: "exec_start", RequestID: "execute", OperationID: request.ID, Request: &request}); err != nil {
						return err
					}
					result, err := read()
					if err != nil {
						return err
					}
					if result.Record == nil || result.Record.Status != "completed" || result.Record.Deadline != request.Deadline || !strings.Contains(string(result.Record.Result), "platform-clock-ok") {
						return fmt.Errorf("execution: %+v", result)
					}
					stale := request
					stale.ID, stale.Deadline = "expired_operation", now()-1
					if err := send(protocol.Frame{Type: "exec_start", RequestID: "stale", OperationID: stale.ID, Request: &stale}); err != nil {
						return err
					}
					if expired, err := read(); err != nil || expired.Error != "operation_expired" {
						return fmt.Errorf("expired command: %+v %v", expired, err)
					}
					if err := send(protocol.Frame{Type: "grant_renew", RequestID: "too_long", GrantID: g.ID, Grant: &g, LeaseExpiresAt: now() + 61000}); err != nil {
						return err
					}
					rejected, err := read()
					if err != nil {
						return err
					}
					if rejected.Type != "grant_error" || rejected.Error != "invalid_execution_lease" {
						return fmt.Errorf("overlong lease accepted: %+v", rejected)
					}
					if err := send(protocol.Frame{Type: "grant_revoke", RequestID: "revoke", GrantID: g.ID, Grant: &g}); err != nil {
						return err
					}
					if revoked, err := read(); err != nil || revoked.Type != "grant_result" {
						return fmt.Errorf("revoke: %+v %v", revoked, err)
					}
					request.ID = "after_revoke"
					if err := send(protocol.Frame{Type: "exec_start", RequestID: "denied", OperationID: request.ID, Request: &request}); err != nil {
						return err
					}
					denied, err := read()
					if err != nil {
						return err
					}
					if denied.Type != "exec_error" || denied.Error != "grant_revoked" {
						return fmt.Errorf("revoked task accepted: %+v", denied)
					}
					return nil
				}()
				done <- err
			}))
			defer server.Close()
			go func() {
				_ = Connect(ctx, Options{URL: "wss" + strings.TrimPrefix(server.URL, "https"), Ticket: strings.Repeat("a", 43), OpenSession: open, HTTPClient: server.Client()})
			}()
			select {
			case err := <-done:
				if err != nil {
					t.Fatal(err)
				}
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
		})
	}
}

func TestPlatformHTTPDateHandlesDesktopSkew(t *testing.T) {
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	for _, offset := range []time.Duration{-24 * time.Hour, 24 * time.Hour} {
		t.Run(offset.String(), func(t *testing.T) {
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				now := time.Now().Add(offset)
				w.Header().Set("Date", now.UTC().Format(http.TimeFormat))
				var request map[string]string
				_ = json.NewDecoder(r.Body).Decode(&request)
				var data any
				if request["action"] == "challenge" {
					data = map[string]any{"proof": map[string]any{"purpose": "local-device-connect-v1", "challengeId": strings.Repeat("a", 32), "nonce": strings.Repeat("b", 43), "deviceId": "device", "audience": "local-device-gateway-v1", "expiresAt": now.Add(time.Minute).UnixMilli()}}
				} else {
					data = ConnectionTicket{Ticket: strings.Repeat("a", 43), ExpiresAt: now.Add(5 * time.Minute).UnixMilli()}
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"code": 200, "data": data})
			}))
			defer server.Close()
			client, err := NewPlatformClient(server.URL, server.Client())
			if err != nil {
				t.Fatal(err)
			}
			if _, err := client.Authenticate(context.Background(), "device", key); err != nil {
				t.Fatal(err)
			}
		})
	}
}
