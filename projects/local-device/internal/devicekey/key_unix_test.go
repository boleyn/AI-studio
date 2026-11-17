//go:build darwin || linux

package devicekey

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFileIdentityRejectsSymlinksAndLoosePermissions(t *testing.T) {
	copyBytes := func(value []byte) ([]byte, error) { return append([]byte(nil), value...), nil }
	directory := filepath.Join(t.TempDir(), "private")
	store, err := newFileVault(directory, "test", copyBytes, copyBytes)
	if err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(directory, "target")
	os.WriteFile(target, make([]byte, 32), 0600)
	os.Symlink(target, filepath.Join(directory, "test.key"))
	if _, err = loadOrCreate(store); err == nil {
		t.Fatal("symlink accepted")
	}
	os.Chmod(directory, 0755)
	if _, err = newFileVault(directory, "test", copyBytes, copyBytes); err == nil {
		t.Fatal("unsafe directory accepted")
	}
}
