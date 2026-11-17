//go:build darwin && !headless

package desktop

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa
#include <stdlib.h>
void connectorInstallStatusHook(void);
void connectorSetWindowPID(int pid);
void connectorSetStatus(int status);
*/
import "C"

// installStatusHook binds tray activation to the existing native window, not a new helper process.
func installStatusHook()         { C.connectorInstallStatusHook() }
func setNativeWindowPID(pid int) { C.connectorSetWindowPID(C.int(pid)) }
func setNativeStatus(status string) {
	value := 0
	switch status {
	case "connected":
		value = 1
	case "connecting", "authenticating", "waiting_for_pairing":
		value = 2
	case "disconnected", "error":
		value = 3
	}
	C.connectorSetStatus(C.int(value))
}
