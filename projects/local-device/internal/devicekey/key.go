// Package devicekey persists a per-platform Ed25519 identity without exporting it to the cloud.
package devicekey

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fastgpt.local/local-device/internal/transport"
	"net"
	"net/url"
	"strings"
)

var errMissing = errors.New("device_key_missing")

type vault interface {
	load() ([]byte, error)
	create([]byte) error
}

// LoadOrCreate isolates identities by platform origin. Existing unreadable or corrupt
// identities fail closed rather than silently generating a replacement device.
func LoadOrCreate(directory, origin string) (ed25519.PrivateKey, error) {
	u, err := url.Parse(origin)
	if err != nil || !transport.SecureURL(u, "https", "http") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return nil, errors.New("invalid_platform_origin")
	}
	// Host names are case insensitive; scheme and default port remain part of the identity scope.
	host := strings.ToLower(u.Hostname())
	port := u.Port()
	if port == "" {
		port = "443"
		if u.Scheme == "http" {
			port = "80"
		}
	}
	digest := sha256.Sum256([]byte(u.Scheme + "://" + net.JoinHostPort(host, port)))
	store, err := newVault(directory, hex.EncodeToString(digest[:]))
	if err != nil {
		return nil, err
	}
	return loadOrCreate(store)
}

func loadOrCreate(store vault) (ed25519.PrivateKey, error) {
	seed, err := store.load()
	if errors.Is(err, errMissing) {
		fresh := make([]byte, ed25519.SeedSize)
		if _, err = rand.Read(fresh); err != nil {
			return nil, err
		}
		err = store.create(fresh)
		clear(fresh)
		if err != nil {
			return nil, err
		}
		// Always reread: another connector may have won the atomic create.
		seed, err = store.load()
	}
	if err != nil {
		return nil, err
	}
	defer clear(seed)
	if len(seed) != ed25519.SeedSize {
		return nil, errors.New("invalid_stored_device_key")
	}
	return ed25519.NewKeyFromSeed(seed), nil
}
