package connector

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"fastgpt.local/local-device/internal/executor"
	"fastgpt.local/local-device/internal/grant"
	"fastgpt.local/local-device/internal/journal"
	"fastgpt.local/local-device/internal/protocol"
	"github.com/coder/websocket"
)

func TestAdditionalBindingKeepsOriginalConnection(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var revoked atomic.Bool
	disconnectSecond := make(chan struct{})
	firstClosed := make(chan struct{}, 1)
	const code = "0123456789ABCDEF0123"
	ticket := func(id string) string { return strings.Repeat(id[:1], 43) }
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/socket" {
			id := "first"
			if r.Header.Get("Authorization") == "Bearer "+ticket("second") {
				id = "second"
			}
			socket, err := websocket.Accept(w, r, nil)
			if err != nil {
				return
			}
			defer socket.CloseNow()
			payload, _ := json.Marshal(protocol.Frame{Version: 1, Type: "welcome", Epoch: "epoch", Owner: &grant.Owner{DeviceID: id, TeamID: "team", MemberID: id}, AuthExpiresAt: time.Now().Add(5 * time.Minute).UnixMilli()})
			if err := socket.Write(ctx, websocket.MessageText, payload); err != nil {
				return
			}
			readCtx := socket.CloseRead(ctx)
			if id == "second" {
				select {
				case <-disconnectSecond:
				case <-readCtx.Done():
				}
			} else {
				<-readCtx.Done()
				firstClosed <- struct{}{}
			}
			return
		}
		var request map[string]string
		_ = json.NewDecoder(r.Body).Decode(&request)
		id := request["deviceId"]
		var data any
		switch request["action"] {
		case "start":
			data = Pairing{PairingID: strings.Repeat("a", 32), PollToken: strings.Repeat("b", 43), ConfirmationCode: "123456", ExpiresAt: time.Now().Add(time.Minute).UnixMilli()}
		case "poll":
			data = map[string]any{"result": PairingState{Status: "confirmed", DeviceID: "first"}}
		case "redeem":
			if request["code"] != code {
				t.Error("unexpected invitation")
			}
			data = map[string]string{"deviceId": "second"}
		case "challenge":
			if id == "second" && revoked.Load() {
				_ = json.NewEncoder(w).Encode(map[string]any{"code": 500, "message": "device_auth_failed"})
				return
			}
			data = map[string]any{"proof": map[string]any{"purpose": "local-device-connect-v1", "challengeId": strings.Repeat("a", 32), "nonce": strings.Repeat("b", 43), "deviceId": id, "audience": "local-device-gateway-v1", "expiresAt": time.Now().Add(time.Minute).UnixMilli()}}
		case "exchange":
			data = ConnectionTicket{Ticket: ticket(id), ExpiresAt: time.Now().Add(5 * time.Minute).UnixMilli()}
		default:
			t.Errorf("unexpected action %q", request["action"])
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"code": 200, "data": data})
	}))
	defer server.Close()
	client, err := NewPlatformClient(server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	ledger, err := journal.Open(filepath.Join(t.TempDir(), "state"))
	if err != nil {
		t.Fatal(err)
	}
	defer ledger.Close()
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	shell, err := executor.ResolveShell("bash")
	if err != nil {
		t.Skip(err)
	}
	ready := make(chan string, 4)
	removed := make(chan string, 1)
	invites := make(chan BindingInvite, 1)
	result := make(chan error, 1)
	done := make(chan error, 1)
	options := StartOptions{
		GatewayURL: "wss" + strings.TrimPrefix(server.URL, "https") + "/socket", HTTPClient: server.Client(),
		Invites: invites, Confirm: func(context.Context, grant.Grant) (string, error) { return "", errors.New("unexpected execution") },
		Ready:   func(session *LocalSession) { ready <- session.DeviceID },
		Removed: func(id string) { removed <- id },
	}
	go func() {
		done <- client.runBindings(ctx, options, PairingOptions{
			Journal: ledger, Key: key, Name: "test", Platform: "darwin", Show: func(PairingNotice) error { return nil },
		}, shell)
	}()
	defer func() { cancel(); <-done }()
	waitFor := func(ch <-chan string, want string) {
		t.Helper()
		select {
		case got := <-ch:
			if got != want {
				t.Fatalf("got %q, want %q", got, want)
			}
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
	}
	waitFor(ready, "first")
	invites <- BindingInvite{Code: code, Result: result}
	select {
	case err := <-result:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	waitFor(ready, "second")
	assertBindings := func(want int) {
		t.Helper()
		bindings, err := ledger.Bindings(ctx, server.URL)
		if err != nil || len(bindings) != want || bindings[0].DeviceID != "first" {
			t.Fatalf("bindings=%v, err=%v", bindings, err)
		}
	}
	assertBindings(2)
	revoked.Store(true)
	close(disconnectSecond)
	waitFor(removed, "second")
	assertBindings(1)
	select {
	case <-firstClosed:
		t.Fatal("first account was disconnected")
	default:
	}
}
