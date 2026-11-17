package connector

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPlatformPairAndAuthenticate(t *testing.T) {
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	expires := time.Now().Add(30 * time.Second).UnixMilli()
	challengeID, nonce := strings.Repeat("a", 32), strings.Repeat("b", 43)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]string
		if json.NewDecoder(r.Body).Decode(&request) != nil {
			t.Error("invalid request")
			return
		}
		var data any
		switch request["action"] {
		case "start":
			if !strings.Contains(request["publicKey"], "BEGIN PUBLIC KEY") || strings.Contains(request["publicKey"], "PRIVATE") {
				t.Error("wrong key")
			}
			data = Pairing{PairingID: challengeID, PollToken: nonce, ConfirmationCode: "123456", ExpiresAt: expires}
		case "poll":
			if request["pollToken"] != nonce {
				t.Error("missing poll token")
			}
			data = map[string]any{"result": PairingState{Status: "confirmed", DeviceID: "device"}}
		case "challenge":
			data = map[string]any{"proof": map[string]any{"purpose": "local-device-connect-v1", "challengeId": challengeID, "nonce": nonce, "deviceId": "device", "audience": "local-device-gateway-v1", "expiresAt": expires}}
		case "exchange":
			payload, _ := json.Marshal([]any{"local-device-connect-v1", challengeID, nonce, "device", "local-device-gateway-v1", expires})
			signature, err := base64.RawURLEncoding.DecodeString(request["signature"])
			if err != nil || !ed25519.Verify(public, payload, signature) {
				t.Error("invalid signature")
			}
			data = ConnectionTicket{Ticket: nonce, ExpiresAt: expires}
		default:
			t.Error("unexpected action")
		}
		json.NewEncoder(w).Encode(map[string]any{"code": 200, "data": data})
	}))
	defer server.Close()
	client, err := NewPlatformClient(server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	pairing, err := client.StartPairing(context.Background(), "测试电脑", "windows", private)
	if err != nil {
		t.Fatal(err)
	}
	state, err := client.PollPairing(context.Background(), pairing)
	if err != nil || state.DeviceID != "device" {
		t.Fatalf("%v %v", state, err)
	}
	ticket, err := client.Authenticate(context.Background(), state.DeviceID, private)
	if err != nil || ticket.Ticket != nonce {
		t.Fatalf("%v %v", ticket, err)
	}
}

func TestPlatformRejectsWrongChallengeAndRedirect(t *testing.T) {
	_, private, _ := ed25519.GenerateKey(rand.Reader)
	for _, mode := range []string{"challenge", "redirect", "oversize", "failure"} {
		t.Run(mode, func(t *testing.T) {
			calls := 0
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				switch mode {
				case "redirect":
					http.Redirect(w, r, "/redirect", 307)
				case "oversize":
					w.Write([]byte(strings.Repeat("x", 16385)))
				case "failure":
					w.WriteHeader(500)
				default:
					w.Write([]byte(`{"code":200,"data":{"proof":{"purpose":"other"}}}`))
				}
			}))
			defer server.Close()
			client, err := NewPlatformClient(server.URL, server.Client())
			if err != nil {
				t.Fatal(err)
			}
			if _, err = client.Authenticate(context.Background(), "device", private); err == nil {
				t.Fatal("unsafe response accepted")
			}
			if calls != 1 {
				t.Fatal("request retried or redirect followed")
			}
		})
	}
	if _, err := NewPlatformClient("ftp://platform.example", nil); err == nil {
		t.Fatal("unsupported protocol accepted")
	}
}

// HTTP status failures must still preserve the platform's known invitation reason.
func TestInviteErrorsPreserveSafeReason(t *testing.T) {
	for _, status := range []int{http.StatusOK, http.StatusInternalServerError} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(status)
				_ = json.NewEncoder(w).Encode(map[string]any{"code": 500, "message": "device_invite_unavailable", "data": nil})
			}))
			defer server.Close()
			client, err := NewPlatformClient(server.URL, server.Client())
			if err != nil {
				t.Fatal(err)
			}
			_, err = client.PreviewInvite(context.Background(), strings.Repeat("A", 20))
			if err == nil || err.Error() != "device_invite_unavailable" {
				t.Fatalf("lost invitation reason: %v", err)
			}
		})
	}
}

func TestInviteUnknownErrorsExcludeServerDetails(t *testing.T) {
	for _, body := range []string{
		`{"code":500,"message":"private database detail","data":null}`,
		"<html>private proxy configuration</html>",
	} {
		server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(body))
		}))
		client, err := NewPlatformClient(server.URL, server.Client())
		if err != nil {
			t.Fatal(err)
		}
		_, err = client.PreviewInvite(context.Background(), strings.Repeat("A", 20))
		server.Close()
		var diagnostic *InviteRequestError
		if !errors.As(err, &diagnostic) || diagnostic.HTTPStatus != 500 || strings.Contains(err.Error(), "private") {
			t.Fatalf("unsafe or missing diagnostic: %v", err)
		}
	}
}

// A server slightly ahead must not be rejected before the signature exchange.
func TestAuthenticateWithServerClockLead(t *testing.T) {
	_, private, _ := ed25519.GenerateKey(rand.Reader)
	for _, lead := range []time.Duration{150 * time.Millisecond, 29 * time.Second, 31 * time.Second} {
		t.Run(lead.String(), func(t *testing.T) {
			exchanges := 0
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var request map[string]string
				_ = json.NewDecoder(r.Body).Decode(&request)
				var data any
				if request["action"] == "challenge" {
					data = map[string]any{"proof": map[string]any{"purpose": "local-device-connect-v1", "challengeId": strings.Repeat("a", 32), "nonce": strings.Repeat("b", 43), "deviceId": "device", "audience": "local-device-gateway-v1", "expiresAt": time.Now().Add(time.Minute + lead).UnixMilli()}}
				} else {
					exchanges++
					data = ConnectionTicket{Ticket: strings.Repeat("c", 43), ExpiresAt: time.Now().Add(5*time.Minute + lead).UnixMilli()}
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"code": 200, "data": data})
			}))
			defer server.Close()
			client, _ := NewPlatformClient(server.URL, server.Client())
			_, err := client.Authenticate(context.Background(), "device", private)
			if lead < 30*time.Second {
				if err != nil || exchanges != 1 {
					t.Fatalf("clock lead rejected: %v, exchanges=%d", err, exchanges)
				}
			} else if err == nil || exchanges != 0 {
				t.Fatal("excessive clock lead accepted")
			}
		})
	}
}

func TestRemoteExpiryBounds(t *testing.T) {
	const now int64 = 1000000
	for _, lifetime := range []time.Duration{time.Minute, 5 * time.Minute} {
		for _, delta := range []time.Duration{-time.Millisecond, 0, time.Millisecond, lifetime, lifetime + 30*time.Second, lifetime + 30*time.Second + time.Millisecond} {
			want := delta > 0 && delta <= lifetime+30*time.Second
			if got := validRemoteExpiry(now+delta.Milliseconds(), now, lifetime); got != want {
				t.Fatalf("lifetime=%v delta=%v got=%v", lifetime, delta, got)
			}
		}
	}
}
