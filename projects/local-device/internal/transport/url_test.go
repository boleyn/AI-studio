package transport

import (
	"net/url"
	"testing"
)

func TestExplicitProtocolsAcceptAnyHost(t *testing.T) {
	for _, host := range []string{"localhost", "127.0.0.1", "[::1]", "192.168.1.2", "10.21.80.241", "172.16.0.1", "172.31.255.254", "172.32.0.1", "8.8.8.8", "0.0.0.0", "localhost.example.com", "example.com"} {
		for _, schemes := range [][2]string{{"https", "http"}, {"wss", "ws"}} {
			u, _ := url.Parse(schemes[1] + "://" + host + ":3000")
			if !SecureURL(u, schemes[0], schemes[1]) {
				t.Fatalf("explicit protocol rejected for %s", u)
			}
			u.Scheme = schemes[0]
			if !SecureURL(u, schemes[0], schemes[1]) {
				t.Fatal("secure URL rejected")
			}
		}
	}
}
