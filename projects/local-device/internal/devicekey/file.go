package devicekey

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
)

// fileVault is the Linux fallback and Windows encrypted-blob container, never macOS's fallback.
type fileVault struct {
	path      string
	protect   func([]byte) ([]byte, error)
	unprotect func([]byte) ([]byte, error)
}

func newFileVault(directory, account string, protect, unprotect func([]byte) ([]byte, error)) (vault, error) {
	if !filepath.IsAbs(directory) {
		return nil, errors.New("device_state_path_must_be_absolute")
	}
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, err
	}
	info, err := os.Lstat(directory)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("unsafe_device_state_directory")
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("unsafe_device_state_permissions")
	}
	return fileVault{path: filepath.Join(directory, account+".key"), protect: protect, unprotect: unprotect}, nil
}

func (v fileVault) load() ([]byte, error) {
	info, err := os.Lstat(v.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, errMissing
	}
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > 16384 || (runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0) {
		return nil, errors.New("unsafe_device_key_file")
	}
	file, err := os.Open(v.path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return nil, errors.New("device_key_file_changed")
	}
	raw, err := io.ReadAll(io.LimitReader(file, 16385))
	if err != nil || len(raw) > 16384 {
		return nil, errors.New("invalid_stored_device_key")
	}
	defer clear(raw)
	return v.unprotect(raw)
}

func (v fileVault) create(seed []byte) error {
	blob, err := v.protect(seed)
	if err != nil {
		return err
	}
	defer clear(blob)
	file, err := os.CreateTemp(filepath.Dir(v.path), ".device-key-*")
	if err != nil {
		return err
	}
	// Only remove this call's temporary file, never an existing identity.
	defer os.Remove(file.Name())
	defer file.Close()
	if err = file.Chmod(0600); err != nil {
		return err
	}
	if _, err = file.Write(blob); err != nil {
		return err
	}
	if err = file.Sync(); err != nil {
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	// Atomic no-overwrite publication; an interrupted partial write cannot become the identity.
	if err = os.Link(file.Name(), v.path); err != nil && !errors.Is(err, os.ErrExist) {
		return err
	}
	if runtime.GOOS != "windows" {
		directory, err := os.Open(filepath.Dir(v.path))
		if err != nil {
			return err
		}
		defer directory.Close()
		return directory.Sync()
	}
	return nil
}
