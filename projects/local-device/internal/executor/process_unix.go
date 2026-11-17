//go:build darwin || linux

package executor

import (
	"errors"
	"os"
	"os/exec"
	"syscall"
)

const workspaceOpenFlags = syscall.O_NONBLOCK

// Each command owns a process group. Cancellation kills its children as well as the shell;
// deliberately detached descendants are outside this guarantee.
func configureProcess(cmd *exec.Cmd) (func(), func() error, error) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	kill := func() error {
		if cmd.Process == nil {
			return nil
		}
		err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		if errors.Is(err, syscall.ESRCH) {
			return os.ErrProcessDone
		}
		return err
	}
	cmd.Cancel = kill
	// V1 does not support unattended descendants after the main command has exited.
	return func() { _ = kill() }, func() error { return nil }, nil
}
