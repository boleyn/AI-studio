package devicekey

import (
	"bytes"
	"crypto/ed25519"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestFileIdentitySurvivesAndConcurrentCreation(t *testing.T) {
	copyBytes := func(value []byte) ([]byte, error) { return append([]byte(nil), value...), nil }
	directory := filepath.Join(t.TempDir(), "private")
	store, err := newFileVault(directory, "test", copyBytes, copyBytes)
	if err != nil {
		t.Fatal(err)
	}
	keys := make(chan ed25519.PrivateKey, 10)
	var workers sync.WaitGroup
	for i := 0; i < 10; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			key, err := loadOrCreate(store)
			if err != nil {
				t.Error(err)
				return
			}
			keys <- key
		}()
	}
	workers.Wait()
	close(keys)
	var first []byte
	for key := range keys {
		if first == nil {
			first = key
		}
		if !bytes.Equal(key, first) {
			t.Fatal("concurrent identity changed")
		}
	}
	reopened, err := newFileVault(directory, "test", copyBytes, copyBytes)
	if err != nil {
		t.Fatal(err)
	}
	key, err := loadOrCreate(reopened)
	if err != nil || !bytes.Equal(first, key) {
		t.Fatalf("identity changed: %v", err)
	}
	info, _ := os.Stat(filepath.Join(directory, "test.key"))
	if info.Size() != ed25519.SeedSize {
		t.Fatal("unexpected key file")
	}
	entries, _ := os.ReadDir(directory)
	if len(entries) != 1 {
		t.Fatal("temporary secret files left behind")
	}
}

func TestFileIdentityFailsClosed(t *testing.T) {
	copyBytes := func(value []byte) ([]byte, error) { return append([]byte(nil), value...), nil }
	if _, err := newFileVault("relative", "test", copyBytes, copyBytes); err == nil {
		t.Fatal("relative directory accepted")
	}
	directory := filepath.Join(t.TempDir(), "private")
	store, err := newFileVault(directory, "test", copyBytes, copyBytes)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(directory, "test.key")
	if err = os.WriteFile(path, []byte("corrupt"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = loadOrCreate(store); err == nil {
		t.Fatal("corrupt key replaced")
	}
	raw, _ := os.ReadFile(path)
	if string(raw) != "corrupt" {
		t.Fatal("existing key overwritten")
	}
	protectFailure := func([]byte) ([]byte, error) { return nil, errors.New("denied") }
	failed, _ := newFileVault(directory, "other", protectFailure, protectFailure)
	if _, err = loadOrCreate(failed); err == nil {
		t.Fatal("protection failure ignored")
	}
	if _, err = os.Stat(filepath.Join(directory, "other.key")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("failed key persisted")
	}
	for _, origin := range []string{"ftp://host", "https://user:pass@host", "https://host?token=x", "https://host/path"} {
		if _, err = LoadOrCreate(directory, origin); err == nil {
			t.Fatalf("unsafe origin %s", origin)
		}
	}
}
