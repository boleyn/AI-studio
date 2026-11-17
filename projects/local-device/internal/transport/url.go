// Package transport validates the protocol selected by the user.
package transport

import "net/url"

// SecureURL accepts either supported protocol without restricting the target host.
// HTTPS/WSS retain the standard certificate verification performed by the transport.
func SecureURL(u *url.URL, secure, plain string) bool {
	return u != nil && (u.Scheme == secure || u.Scheme == plain)
}
