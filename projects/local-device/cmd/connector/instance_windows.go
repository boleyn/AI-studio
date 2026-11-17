package main

import (
	"errors"
	"fastgpt.local/local-device/internal/desktop"

	"golang.org/x/sys/windows"
)

// acquireInstance 在托盘和配对服务启动前占用当前用户会话的互斥量。
// 名称不含版本或程序路径，复制程序、升级版本也不会产生多个托盘实例。
// 进程退出后内核自动释放句柄，崩溃不会留下锁文件。
func acquireInstance() (func(), bool, error) {
	token := windows.GetCurrentProcessToken()
	user, err := token.GetTokenUser()
	if err != nil {
		return nil, false, err
	}
	return acquireNamedInstance(`Local\FastGPT.LocalDevice.Connector.`+user.User.Sid.String(), desktop.RequestManagement)
}

// acquireNamedInstance pairs the user/session mutex with an auto-reset kernel
// event. Relaunching only signals the first process, even while it is starting or
// offline; no HTTP bridge, platform credentials or second executor is required.
func acquireNamedInstance(prefix string, wake func()) (func(), bool, error) {
	eventName, err := windows.UTF16PtrFromString(prefix + ".Activate")
	if err != nil {
		return nil, false, err
	}
	event, err := windows.CreateEvent(nil, 0, 0, eventName)
	if err != nil && !errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		return nil, false, err
	}
	name, err := windows.UTF16PtrFromString(prefix)
	if err != nil {
		windows.CloseHandle(event)
		return nil, false, err
	}
	handle, err := windows.CreateMutex(nil, false, name)
	if errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		if handle != 0 {
			windows.CloseHandle(handle)
		}
		err = windows.SetEvent(event)
		windows.CloseHandle(event)
		return func() {}, false, err
	}
	if err != nil {
		windows.CloseHandle(event)
		return nil, false, err
	}
	stop, done := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(done)
		for {
			_, err := windows.WaitForSingleObject(event, windows.INFINITE)
			select {
			case <-stop:
				return
			default:
			}
			if err != nil {
				return
			}
			wake()
		}
	}()
	return func() {
		close(stop)
		windows.SetEvent(event)
		<-done
		windows.CloseHandle(event)
		windows.CloseHandle(handle)
	}, true, nil
}
