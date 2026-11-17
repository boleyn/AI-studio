//go:build darwin || linux

package journal

import (
	"golang.org/x/sys/unix"
	"os"
	"sync"
)

// A nonblocking kernel lock prevents a second process from recovering a live journal.
func lock(path string) (func(), error) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = unix.Flock(int(file.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		file.Close()
		return nil, err
	}
	var once sync.Once
	return func() { once.Do(func() { _ = unix.Flock(int(file.Fd()), unix.LOCK_UN); _ = file.Close() }) }, nil
}
