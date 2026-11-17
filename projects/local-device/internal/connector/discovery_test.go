package connector

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPlatformDiscovery(t *testing.T) {
	for _, test := range []struct {
		name  string
		data  any
		valid bool
	}{
		{"ready", map[string]any{"available": true, "protocolVersion": 1, "gatewayUrl": "wss://devices.example/connect"}, true},
		{"disabled", map[string]any{"available": false}, false},
		{"explicit-ws", map[string]any{"available": true, "protocolVersion": 1, "gatewayUrl": "ws://devices.example/connect"}, true},
		{"credentials", map[string]any{"available": true, "protocolVersion": 1, "gatewayUrl": "wss://secret@devices.example/connect"}, false},
		{"token", map[string]any{"available": true, "protocolVersion": 1, "gatewayUrl": "wss://devices.example/connect?token=secret"}, false},
		{"protocol", map[string]any{"available": true, "protocolVersion": 2, "gatewayUrl": "wss://devices.example/connect"}, false},
		{"invalid", map[string]any{"available": true, "protocolVersion": 1, "gatewayUrl": "://"}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/api/core/localDevice/discovery" || r.Method != "POST" {
					t.Error("unexpected discovery request")
				}
				json.NewEncoder(w).Encode(map[string]any{"code": 200, "data": test.data})
			}))
			defer server.Close()
			client, err := NewPlatformClient(server.URL, server.Client())
			if err != nil {
				t.Fatal(err)
			}
			address, err := client.Discover(context.Background())
			if (err == nil) != test.valid {
				t.Fatalf("address=%s err=%v", address, err)
			}
		})
	}
}

func TestLoopbackDevelopmentDiscovery(t *testing.T) {
	t.Setenv("LOCAL_DEVICE_DEV_LOOPBACK", "1")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"code": 200, "data": map[string]any{"available": true, "protocolVersion": 1, "gatewayUrl": "ws://127.0.0.1:3000/local-device/connect"}})
	}))
	defer server.Close()
	client, err := NewPlatformClient(server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = client.Discover(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err = NewPlatformClient("http://192.168.1.1:3000", nil); err != nil {
		t.Fatalf("LAN address rejected: %v", err)
	}
}
