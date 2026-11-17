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
	"testing"
	"time"

	"fastgpt.local/local-device/internal/journal"
)

func TestEnsureBindingPersistsAndRejectsChangedIdentity(t *testing.T) {
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	ledger, err := journal.Open(filepath.Join(t.TempDir(), "state"))
	if err != nil {
		t.Fatal(err)
	}
	defer ledger.Close()
	calls := 0
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var request map[string]string
		json.NewDecoder(r.Body).Decode(&request)
		var data any
		if request["action"] == "start" {
			data = Pairing{PairingID: strings.Repeat("a", 32), PollToken: strings.Repeat("b", 43), ConfirmationCode: "123456", ExpiresAt: time.Now().Add(time.Minute).UnixMilli()}
		} else {
			data = map[string]any{"result": PairingState{Status: "confirmed", DeviceID: "device-test"}}
		}
		json.NewEncoder(w).Encode(map[string]any{"code": 200, "data": data})
	}))
	defer server.Close()
	client, err := NewPlatformClient(server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	shown := 0
	input := PairingOptions{Journal: ledger, Key: key, Name: "test", Platform: "darwin", Show: func(notice PairingNotice) error {
		shown++
		if notice.PairingID != strings.Repeat("a", 32) || notice.Code != "123456" {
			t.Error("unsafe pairing notice")
		}
		return nil
	}}
	for i := 0; i < 2; i++ {
		id, err := client.EnsureBinding(context.Background(), input)
		if err != nil || id != "device-test" {
			t.Fatalf("%s %v", id, err)
		}
	}
	if calls != 2 || shown != 1 {
		t.Fatalf("unnecessary pairing: calls=%d shown=%d", calls, shown)
	}
	_, input.Key, _ = ed25519.GenerateKey(rand.Reader)
	if _, err = client.EnsureBinding(context.Background(), input); err == nil {
		t.Fatal("changed key reused old device")
	}
}

func TestReconnectWaitCancels(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := waitForReconnect(ctx, time.Hour); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if err := waitForReconnect(context.Background(), time.Millisecond); err != nil {
		t.Fatal(err)
	}
	client, err := NewPlatformClient("https://platform.example", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err = client.Run(ctx, RunOptions{}); err == nil {
		t.Fatal("missing executor accepted")
	}
}

// A visible native dialog must not block polling or require a second click after web confirmation.
func TestEnsureBindingPollsWhileNativeDialogIsOpen(t *testing.T) {
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	ledger, err := journal.Open(filepath.Join(t.TempDir(), "state"))
	if err != nil {
		t.Fatal(err)
	}
	defer ledger.Close()
	shown, closed := make(chan struct{}), make(chan struct{})
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]string
		json.NewDecoder(r.Body).Decode(&request)
		var data any
		if request["action"] == "start" {
			data = Pairing{PairingID: strings.Repeat("a", 32), PollToken: strings.Repeat("b", 43), ConfirmationCode: "123456", ExpiresAt: time.Now().Add(time.Minute).UnixMilli()}
		} else {
			select {
			case <-shown:
			case <-r.Context().Done():
				return
			}
			data = map[string]any{"result": PairingState{Status: "confirmed", DeviceID: "device-auto"}}
		}
		json.NewEncoder(w).Encode(map[string]any{"code": 200, "data": data})
	}))
	defer server.Close()
	client, _ := NewPlatformClient(server.URL, server.Client())
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	id, err := client.EnsureBinding(ctx, PairingOptions{Journal: ledger, Key: key, Name: "test", Platform: "darwin", ShowContext: func(ctx context.Context, notice PairingNotice) error {
		close(shown)
		<-ctx.Done()
		close(closed)
		return ctx.Err()
	}})
	if err != nil || id != "device-auto" {
		t.Fatalf("%s %v", id, err)
	}
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("native dialog was not cancelled after confirmation")
	}
	if binding, err := ledger.Binding(context.Background(), server.URL); err != nil || binding.DeviceID != id {
		t.Fatal("confirmed binding not persisted")
	}
}
