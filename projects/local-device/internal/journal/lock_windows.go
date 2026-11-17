package journal

import (
	"golang.org/x/sys/windows"
	"os"
	"sync"
)

func lock(path string) (func(), error) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	overlapped := &windows.Overlapped{}
	err = windows.LockFileEx(windows.Handle(file.Fd()), windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, overlapped)
	if err != nil {
		file.Close()
		return nil, err
	}
	var once sync.Once
	return func() {
		once.Do(func() { _ = windows.UnlockFileEx(windows.Handle(file.Fd()), 0, 1, 0, overlapped); _ = file.Close() })
	}, nil
}
