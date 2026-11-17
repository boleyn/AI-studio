package devicekey

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"os"
	"testing"

	"github.com/keybase/go-keychain"
)

// Explicit opt-in: creates only a fresh test item and removes that exact item afterwards.
func TestNativeKeychainRoundTrip(t *testing.T) {
	if os.Getenv("LOCAL_DEVICE_KEYCHAIN_TEST") != "1" {
		t.Skip("native keychain test requires explicit opt-in")
	}
	random := make([]byte, 16)
	if _, err := rand.Read(random); err != nil {
		t.Fatal(err)
	}
	store := systemVault{account: "test-" + hex.EncodeToString(random)}
	defer func() {
		if err := keychain.DeleteGenericPasswordItem(keychainService, store.account); err != nil {
			t.Error("test keychain cleanup failed")
		}
	}()
	first, err := loadOrCreate(store)
	if err != nil {
		t.Fatal(err)
	}
	second, err := loadOrCreate(store)
	if err != nil || !bytes.Equal(first, second) {
		t.Fatalf("keychain identity not stable: %v", err)
	}
}
