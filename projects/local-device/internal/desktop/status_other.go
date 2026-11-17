//go:build !darwin || headless

package desktop

func installStatusHook()            {}
func setNativeWindowPID(pid int)    {}
func setNativeStatus(status string) {}
