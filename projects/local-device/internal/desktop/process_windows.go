package desktop

import (
	"errors"
	"os/exec"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// containWindowsDialog 将 helper 与连接测试子进程纳入同一个 Job，关闭或被申请替换时一起清理。
// 先挂起再绑定，避免 helper 在被收容前创建测试子进程；不隐藏 WPF 窗口。
func containWindowsDialog(command *exec.Cmd) (cleanup func(), resume func() error, err error) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return nil, nil, err
	}
	var closed sync.Once
	cleanup = func() { closed.Do(func() { _ = windows.CloseHandle(job) }) }
	limits := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	limits.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	_, err = windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&limits)), uint32(unsafe.Sizeof(limits)))
	if err != nil {
		cleanup()
		return nil, nil, err
	}
	if command.SysProcAttr == nil {
		command.SysProcAttr = &syscall.SysProcAttr{}
	}
	command.SysProcAttr.CreationFlags |= windows.CREATE_SUSPENDED
	resume = func() error {
		process, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(command.Process.Pid))
		if err != nil {
			return err
		}
		defer windows.CloseHandle(process)
		if err = windows.AssignProcessToJobObject(job, process); err != nil {
			return err
		}
		snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPTHREAD, 0)
		if err != nil {
			return err
		}
		defer windows.CloseHandle(snapshot)
		entry := windows.ThreadEntry32{Size: uint32(unsafe.Sizeof(windows.ThreadEntry32{}))}
		for err = windows.Thread32First(snapshot, &entry); err == nil; err = windows.Thread32Next(snapshot, &entry) {
			if entry.OwnerProcessID != uint32(command.Process.Pid) {
				continue
			}
			thread, err := windows.OpenThread(windows.THREAD_SUSPEND_RESUME, false, entry.ThreadID)
			if err != nil {
				return err
			}
			_, err = windows.ResumeThread(thread)
			windows.CloseHandle(thread)
			return err
		}
		return errors.New("dialog_thread_not_found")
	}
	return cleanup, resume, nil
}
