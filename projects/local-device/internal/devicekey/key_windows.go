package devicekey

import (
	"errors"
	"golang.org/x/sys/windows"
	"unsafe"
)

// DPAPI binds ciphertext to the current Windows user; machine-wide protection is never enabled.
func newVault(directory, account string) (vault, error) {
	transform := func(value []byte, encrypt bool) ([]byte, error) {
		if len(value) == 0 {
			return nil, errors.New("invalid_stored_device_key")
		}
		input := windows.DataBlob{Size: uint32(len(value)), Data: &value[0]}
		var output windows.DataBlob
		var err error
		if encrypt {
			err = windows.CryptProtectData(&input, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &output)
		} else {
			err = windows.CryptUnprotectData(&input, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &output)
		}
		if err != nil {
			return nil, errors.New("device_key_protection_failed")
		}
		defer windows.LocalFree(windows.Handle(unsafe.Pointer(output.Data)))
		data := unsafe.Slice(output.Data, int(output.Size))
		result := append([]byte(nil), data...)
		clear(data)
		return result, nil
	}
	return newFileVault(directory, account, func(v []byte) ([]byte, error) { return transform(v, true) }, func(v []byte) ([]byte, error) { return transform(v, false) })
}
