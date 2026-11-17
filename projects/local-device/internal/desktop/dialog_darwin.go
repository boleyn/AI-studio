package desktop

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
)

const nativeScript = `on run argv
set mode to item 1 of argv
set messageText to item 2 of argv
if mode is "setup" then
set answer to display dialog messageText with title (item 4 of argv) default answer (item 3 of argv) buttons {"取消", "继续"} default button "继续" cancel button "取消"
return text returned of answer
else if mode is "notice" then
display dialog messageText with title (item 4 of argv) buttons {"确定"} default button "确定"
return "confirmed"
else if mode is "pairApprove" then
display dialog messageText with title (item 4 of argv) buttons {"取消", "允许绑定"} default button "取消" cancel button "取消" with icon caution
return "confirmed"
else
display dialog messageText with title (item 4 of argv) buttons {"拒绝", "允许此会话"} default button "拒绝" cancel button "拒绝" with icon caution
set selectedFolder to choose folder with prompt "选择默认工作目录（不是访问限制）"
return POSIX path of selectedFolder
end if
end run`

func dialog(ctx context.Context, mode, message, address string) (string, error) {
	if mode == "approve" || mode == "accountApprove" || mode == "pairApprove" || mode == "invite" {
		executable, err := os.Executable()
		if err == nil {
			helper := filepath.Join(filepath.Dir(executable), "connector-dialog")
			if info, statErr := os.Stat(helper); statErr == nil && info.Mode().IsRegular() {
				payload, err := json.Marshal(map[string]string{"mode": mode, "title": clientWindowTitle(), "message": message, "platform": address, "initialWorkdir": address})
				if err != nil {
					return "", err
				}
				command := exec.CommandContext(ctx, helper)
				command.Stdin = bytes.NewReader(payload)
				data, err := runApprovalHelper(command)
				if err != nil {
					if ctx.Err() != nil {
						return "", ctx.Err()
					}
					var exit *exec.ExitError
					if errors.As(err, &exit) && exit.ExitCode() == 2 {
						return "", errors.New("local_confirmation_cancelled")
					}
					return "", errors.New("local_confirmation_cancelled_or_unavailable")
				}
				return string(data), nil
			}
		}
	}

	data, err := exec.CommandContext(ctx, "/usr/bin/osascript", "-e", nativeScript, mode, message, address, clientWindowTitle()).Output()
	if err != nil {
		return "", errors.New("local_confirmation_cancelled_or_unavailable")
	}
	return string(data), nil
}

var helperWindow struct {
	sync.Mutex
	pid         int
	approvalPID int
	process     *os.Process
	done        chan struct{}
}

// runNativeHelper reactivates an existing helper instead of opening overlapping windows.
func runNativeHelper(command *exec.Cmd) ([]byte, error) {
	helperWindow.Lock()
	if helperWindow.pid != 0 || helperWindow.approvalPID != 0 {
		pid := helperWindow.pid
		if helperWindow.approvalPID != 0 {
			pid = helperWindow.approvalPID
		}
		helperWindow.Unlock()
		if pid > 0 {
			_ = exec.Command(command.Path, "--activate", strconv.Itoa(pid)).Run()
		}
		return nil, errors.New("local_confirmation_cancelled")
	}
	var output bytes.Buffer
	if command.Stdout == nil {
		command.Stdout = &output
	}
	if err := command.Start(); err != nil {
		helperWindow.Unlock()
		return nil, err
	}
	// 子进程已继承响应管道；关闭父进程的读端，窗口退出时写入才能及时失败。
	for _, file := range command.ExtraFiles {
		_ = file.Close()
	}
	helperWindow.pid = command.Process.Pid
	helperWindow.process = command.Process
	helperWindow.done = make(chan struct{})
	if helperWindow.approvalPID == 0 {
		setNativeWindowPID(helperWindow.pid)
	}
	helperWindow.Unlock()
	err := command.Wait()
	helperWindow.Lock()
	helperWindow.pid = 0
	helperWindow.process = nil
	close(helperWindow.done)
	helperWindow.done = nil
	setNativeWindowPID(helperWindow.approvalPID)
	helperWindow.Unlock()
	return output.Bytes(), err
}

var approvalQueue sync.Mutex

// runApprovalHelper serializes security prompts independently of management windows.
// An open settings window must never count as a rejection of a new execution request.
func runApprovalHelper(command *exec.Cmd) ([]byte, error) {
	approvalQueue.Lock()
	defer approvalQueue.Unlock()
	// Reserve the foreground slot before closing management so menu clicks cannot reopen it.
	helperWindow.Lock()
	helperWindow.approvalPID = -1
	process, done := helperWindow.process, helperWindow.done
	helperWindow.Unlock()
	if process != nil {
		_ = process.Kill()
		<-done // Wait for the old window process and Dock entry to disappear.
	}
	defer func() {
		helperWindow.Lock()
		helperWindow.approvalPID = 0
		setNativeWindowPID(helperWindow.pid)
		helperWindow.Unlock()
	}()
	var output bytes.Buffer
	command.Stdout = &output
	if err := command.Start(); err != nil {
		return nil, err
	}
	helperWindow.Lock()
	helperWindow.approvalPID = command.Process.Pid
	setNativeWindowPID(helperWindow.approvalPID)
	helperWindow.Unlock()
	err := command.Wait()
	return output.Bytes(), err
}
