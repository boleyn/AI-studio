package pairbridge

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"
	"time"

	"fastgpt.local/local-device/internal/connector"
)

const testOrigin = "https://platform.example"
const testNonce = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"

// Status metadata is available before pairing, but never opens native approval or relaxes origin checks.
func TestStatusBuildMetadataWithoutBinding(t *testing.T) {
	for _, invite := range []bool{false, true} {
		s := fixture(t, func(context.Context, string) error { t.Fatal("unexpected approval"); return nil })
		s.ClientVersion = "0.1.57"
		if invite {
			s.LocalInvite = func(string, string) bool { t.Fatal("unexpected invite"); return false }
		}
		for _, origin := range []string{testOrigin, "https://evil.example"} {
			r := httptest.NewRequest(http.MethodGet, "http://"+Address+"/status", nil)
			r.Header.Set("Origin", origin)
			w := httptest.NewRecorder()
			s.ServeHTTP(w, r)
			if origin != testOrigin {
				if w.Code != http.StatusForbidden || strings.Contains(w.Body.String(), s.ClientVersion) {
					t.Fatal("foreign origin received build metadata")
				}
				continue
			}
			var status struct{ DeviceID, Version, Platform string }
			if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &status) != nil || status.DeviceID != "" || status.Version != s.ClientVersion || status.Platform != runtime.GOOS {
				t.Fatalf("unexpected status %d: %s", w.Code, w.Body.String())
			}
			if w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("Access-Control-Allow-Origin") != testOrigin {
				t.Fatal("status response missing origin/cache protections")
			}
		}
	}
}

func fixture(t *testing.T, confirm func(context.Context, string) error) *Server {
	t.Helper()
	s, err := New(testOrigin, confirm)
	if err != nil {
		t.Fatal(err)
	}
	s.pending = &connector.PairingNotice{Origin: testOrigin, PairingID: strings.Repeat("a", 32), Code: "123456", ExpiresAt: time.Now().Add(time.Minute).UnixMilli()}
	return s
}
func request(s *Server, origin, host, method, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "http://"+Address+"/pair", strings.NewReader(body))
	r.Host = host
	r.Header.Set("Origin", origin)
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}
func TestHandoffRequiresExactOriginHostAndNativeApproval(t *testing.T) {
	calls := 0
	s := fixture(t, func(_ context.Context, origin string) error {
		calls++
		if origin != testOrigin {
			t.Fatal("foreign origin")
		}
		return nil
	})
	for _, bad := range []struct{ origin, host string }{{"https://evil.example", Address}, {"null", Address}, {"", Address}, {testOrigin, "evil.example"}, {testOrigin, "localhost:13005"}} {
		w := request(s, bad.origin, bad.host, "POST", `{"nonce":"`+testNonce+`"}`)
		if w.Code != 403 || strings.Contains(w.Body.String(), "123456") {
			t.Fatal("unsafe request accepted")
		}
	}
	if calls != 0 {
		t.Fatal("native prompt opened for an unsafe request")
	}
	w := request(s, testOrigin, Address, "POST", `{"nonce":"`+testNonce+`"}`)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "123456") || calls != 1 {
		t.Fatalf("handoff failed: %d", w.Code)
	}
	if w.Header().Get("Access-Control-Allow-Origin") != testOrigin || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("invalid response protection")
	}
	if request(s, testOrigin, Address, "POST", `{"nonce":"`+testNonce+`"}`).Code != 409 {
		t.Fatal("nonce replay accepted")
	}
}
func TestRejectsInvalidBodiesAndMethods(t *testing.T) {
	s := fixture(t, func(context.Context, string) error { t.Fatal("unexpected approval"); return nil })
	for _, body := range []string{`{}`, `{"nonce":"short"}`, `{"nonce":"` + testNonce + `","platform":"https://evil.example"}`, `{"nonce":"` + testNonce + `"} {}`, strings.Repeat("a", 1025)} {
		if request(s, testOrigin, Address, "POST", body).Code != 400 {
			t.Fatal("invalid body accepted")
		}
	}
	if request(s, testOrigin, Address, "GET", "").Code != 400 {
		t.Fatal("GET accepted")
	}
	if request(s, testOrigin, Address, "OPTIONS", "").Code != 204 {
		t.Fatal("preflight failed")
	}
}
func TestDeniedExpiredAndChangedRequestsNeverReleaseCodes(t *testing.T) {
	for _, mode := range []string{"denied", "expired", "changed", "foreign"} {
		t.Run(mode, func(t *testing.T) {
			var s *Server
			s = fixture(t, func(context.Context, string) error {
				if mode == "denied" {
					return errors.New("denied")
				}
				if mode == "changed" {
					s.mu.Lock()
					s.pending = nil
					s.mu.Unlock()
				}
				return nil
			})
			if mode == "expired" {
				s.pending.ExpiresAt = 1
			}
			if mode == "foreign" {
				s.pending.Origin = "https://other.example"
			}
			w := request(s, testOrigin, Address, "POST", `{"nonce":"`+testNonce+`"}`)
			if w.Code == 200 || strings.Contains(w.Body.String(), "123456") {
				t.Fatal("unapproved code released")
			}
		})
	}
}
func TestPairedDeviceDoesNotRepeatNativeApproval(t *testing.T) {
	calls := 0
	s := fixture(t, func(context.Context, string) error { calls++; return nil })
	s.pending = nil
	s.Bound("device")
	w := request(s, testOrigin, Address, "POST", `{"nonce":"`+testNonce+`"}`)
	var result map[string]string
	json.Unmarshal(w.Body.Bytes(), &result)
	if w.Code != 200 || calls != 0 || result["deviceId"] != "device" || result["confirmationCode"] != "" {
		t.Fatal("invalid paired handoff")
	}
}
func TestShowClearsPendingWhenCancelled(t *testing.T) {
	s := fixture(t, func(context.Context, string) error { return nil })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if !errors.Is(s.Show(ctx, *s.pending), context.Canceled) || s.pending != nil {
		t.Fatal("pending pairing retained")
	}
}

func TestStatusOnlyReturnsIdentityForConfiguredOrigin(t *testing.T) {
	s := fixture(t, func(context.Context, string) error { t.Fatal("status must not prompt"); return nil })
	s.Bound("device")
	for _, origin := range []string{testOrigin, "https://other.example"} {
		r := httptest.NewRequest("GET", "http://"+Address+"/status", nil)
		r.Host = Address
		r.Header.Set("Origin", origin)
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		if origin != testOrigin {
			if w.Code != 403 || strings.Contains(w.Body.String(), "device") {
				t.Fatal("foreign origin received identity")
			}
			continue
		}
		var result map[string]string
		if json.Unmarshal(w.Body.Bytes(), &result) != nil || result["deviceId"] != "device" || result["platform"] != runtime.GOOS || len(result) != 3 {
			t.Fatal("invalid status", w.Body.String())
		}
	}
}

func TestLocalInviteHandoffKeepsPlatformIdentitySeparate(t *testing.T) {
	server, err := New("https://chat.example", func(context.Context, string) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	server.Bound("primary-device")
	const origin = "http://localhost:3000"
	var submittedOrigin, submittedCode string
	server.LocalInvite = func(origin, code string) bool {
		submittedOrigin, submittedCode = origin, code
		return true
	}
	server.LocalDevices = func(value string) []string {
		if value == origin {
			return []string{"local-device"}
		}
		return nil
	}
	request := func(method, path, page, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "http://"+Address+path, strings.NewReader(body))
		req.Header.Set("Origin", page)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		server.ServeHTTP(w, req)
		return w
	}
	status := request("GET", "/status", origin, "")
	if status.Code != http.StatusOK || !strings.Contains(status.Body.String(), "local-device") ||
		strings.Contains(status.Body.String(), "primary-device") {
		t.Fatalf("unexpected localhost status %d: %s", status.Code, status.Body)
	}
	primary := request("GET", "/status", "https://chat.example", "")
	if primary.Code != http.StatusOK || !strings.Contains(primary.Body.String(), "primary-device") ||
		!strings.Contains(primary.Body.String(), `"inviteHandoff":true`) ||
		strings.Contains(primary.Body.String(), "local-device") {
		t.Fatalf("unexpected primary status %d: %s", primary.Code, primary.Body)
	}
	const code = "1234567890ABCDEF1234"
	for _, page := range []string{"https://elsewhere.example", "http://localhost.example:3000", "null"} {
		if response := request("POST", "/invite", page, `{"code":"`+code+`"}`); response.Code != http.StatusForbidden {
			t.Fatalf("unexpected origin %s accepted: %d", page, response.Code)
		}
	}
	server.LocalInviteDecision = func(page, value string, decision chan<- bool) bool {
		submittedOrigin, submittedCode = page, value
		decision <- true
		return true
	}
	const intranet = "http://192.168.1.20:3000"
	if response := request("POST", "/invite", intranet, `{"code":"`+code+`","waitForDecision":true}`); response.Code != http.StatusAccepted || submittedOrigin != intranet || submittedCode != code {
		t.Fatalf("intranet invite handoff failed: %d", response.Code)
	}
	server.lastInvite = time.Time{}
	if response := request("POST", "/invite", origin, `{"code":"`+code+`","origin":"https://elsewhere.example"}`); response.Code != http.StatusBadRequest {
		t.Fatal("accepted origin override")
	}
	if response := request("POST", "/invite", origin, `{"code":"`+code+`"}`); response.Code != http.StatusAccepted {
		t.Fatalf("local invite not accepted: %d", response.Code)
	}
	if submittedOrigin != origin || submittedCode != code {
		t.Fatal("invite was not routed to its requesting platform")
	}
	server.lastInvite = time.Time{}
	if response := request("POST", "/invite", "https://chat.example", `{"code":"`+code+`"}`); response.Code != http.StatusAccepted || submittedOrigin != "https://chat.example" {
		t.Fatalf("primary invite not handed to native confirmation: %d", response.Code)
	}
}
