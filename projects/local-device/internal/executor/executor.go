// Package executor starts ordinary-user native processes. Authorization and durable
// operation acceptance must happen before calling Run; this package exposes no network listener.
package executor

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Request struct {
	Command string
	Workdir string
	Timeout time.Duration
	Output  *OutputStream
}

type Result struct {
	Status            string `json:"status"`
	Stdout            string `json:"stdout"`
	Stderr            string `json:"stderr"`
	ExitCode          int    `json:"exitCode"`
	StdoutFile        string `json:"stdoutFile,omitempty"`
	StderrFile        string `json:"stderrFile,omitempty"`
	OutputTruncated   bool   `json:"outputTruncated"`
	ActualWorkdir     string `json:"actualWorkdir"`
	TerminationReason string `json:"terminationReason,omitempty"`
	StartedAt         int64  `json:"startedAt,omitempty"`
	FinishedAt        int64  `json:"finishedAt,omitempty"`
}

// boundedOutput drains both pipes even after the shared byte limit is reached.
type boundedOutput struct {
	mu            sync.Mutex
	remaining     int
	truncated     bool
	stdout        strings.Builder
	stderr        strings.Builder
	stream        *OutputStream
	archiveStdout *os.File
	archiveStderr *os.File
	archiveBytes  int
}
type outputWriter struct {
	buffer *boundedOutput
	stderr bool
}

func (w outputWriter) Write(p []byte) (int, error) {
	b := w.buffer
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.archiveStdout != nil {
		if b.archiveBytes+len(p) > 32*1024*1024 {
			return 0, errors.New("output_archive_limit_exceeded")
		}
		file := b.archiveStdout
		if w.stderr {
			file = b.archiveStderr
		}
		if _, err := file.Write(p); err != nil {
			return 0, err
		}
		b.archiveBytes += len(p)
	}
	n := min(len(p), b.remaining)
	if w.stderr {
		b.stderr.Write(p[:n])
	} else {
		b.stdout.Write(p[:n])
	}
	b.remaining -= n
	b.truncated = b.truncated || n < len(p)
	b.stream.append(w.stderr, p[:n], n < len(p))
	return len(p), nil
}

// Run never retries or changes working directory after a failure. Context cancellation
// covers user revocation and lease expiry; command timeout is enforced locally.
// Optional output streaming shares the final byte bound and never blocks on consumers.
func Run(parent context.Context, shell Shell, request Request) (result Result, runError error) {
	defer request.Output.close()
	result = Result{Status: "failed", ExitCode: -1, ActualWorkdir: request.Workdir}
	result.StartedAt = time.Now().UnixMilli()
	// 只持久化受控原因码，不将原始 context 错误中的命令、路径或凭据带到诊断字段。
	defer func() {
		result.FinishedAt = time.Now().UnixMilli()
		if result.Status == "timed_out" {
			result.TerminationReason = "command_timeout"
		}
		if result.Status == "cancelled" {
			result.TerminationReason = "cancellation_source_unknown"
			if cause := context.Cause(parent); cause != nil {
				switch cause.Error() {
				case "local_user_stop", "remote_cancel_request", "connection_lost", "connector_shutdown", "grant_revoked", "grant_expired", "execution_lease_expired":
					result.TerminationReason = cause.Error()
				}
			}
		}
	}()
	if strings.HasPrefix(request.Command, workspacePrefix) || strings.HasPrefix(request.Command, directoriesPrefix) {
		if strings.HasPrefix(request.Command, directoriesPrefix) {
			result.Stdout, runError = listDirectories(parent, request.Command)
		} else {
			result.Stdout, runError = runWorkspace(parent, request)
		}
		if runError == nil {
			result.Status, result.ExitCode = "completed", 0
		}
		return result, runError
	}
	if !filepath.IsAbs(shell.Path) {
		return result, errors.New("shell_path_must_be_absolute")
	}
	if !filepath.IsAbs(request.Workdir) || strings.ContainsRune(request.Workdir, 0) {
		return result, errors.New("invalid_workdir")
	}
	info, err := os.Stat(request.Workdir)
	if err != nil {
		return result, err
	}
	if !info.IsDir() {
		return result, errors.New("workdir_not_directory")
	}
	if request.Timeout <= 0 || request.Timeout > 10*time.Minute {
		return result, errors.New("invalid_timeout")
	}
	args, err := commandArgs(shell, request.Command)
	if err != nil {
		return result, err
	}
	ctx, cancel := context.WithTimeout(parent, request.Timeout)
	defer cancel()
	if err := parent.Err(); err != nil {
		return result, err
	}
	cmd := exec.CommandContext(ctx, shell.Path, args...)
	cmd.Dir = request.Workdir
	cmd.WaitDelay = 2 * time.Second
	output := &boundedOutput{remaining: 128 * 1024, stream: request.Output}
	archiveDir := filepath.Join(request.Workdir, ".aistudio", "context")
	if err := os.MkdirAll(archiveDir, 0700); err != nil {
		return result, err
	}
	resolvedDir, err := filepath.EvalSymlinks(archiveDir)
	if err != nil {
		return result, err
	}
	resolvedRoot, err := filepath.EvalSymlinks(request.Workdir)
	if err != nil || !strings.HasPrefix(resolvedDir, resolvedRoot+string(os.PathSeparator)) {
		return result, errors.New("archive_outside_workspace")
	}
	output.archiveStdout, err = os.CreateTemp(archiveDir, "native-*.stdout.txt")
	if err != nil {
		return result, err
	}
	output.archiveStderr, err = os.CreateTemp(archiveDir, "native-*.stderr.txt")
	if err != nil {
		output.archiveStdout.Close()
		os.Remove(output.archiveStdout.Name())
		return result, err
	}
	defer func() {
		output.archiveStdout.Close()
		output.archiveStderr.Close()
		if !output.truncated {
			os.Remove(output.archiveStdout.Name())
			os.Remove(output.archiveStderr.Name())
		}
	}()
	cmd.Stdout = outputWriter{buffer: output}
	cmd.Stderr = outputWriter{buffer: output, stderr: true}
	// Nil stdin means /dev/null (or Windows equivalent); there is no password input channel.
	cleanup, afterStart, err := configureProcess(cmd)
	if err != nil {
		return result, err
	}
	defer cleanup()
	if err = cmd.Start(); err != nil {
		// 启动前撤销同样属于取消，不应被记录为进程启动失败。
		if ctx.Err() != nil {
			result.Status = "cancelled"
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				result.Status = "timed_out"
			}
			return result, nil
		}
		return result, err
	}
	if err = afterStart(); err != nil {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		// Windows 挂起进程在加入 Job 前可能已收到撤销。
		if ctx.Err() != nil {
			result.Status = "cancelled"
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				result.Status = "timed_out"
			}
			return result, nil
		}
		return result, err
	}
	// A cancellation can race Windows job assignment while the process is suspended.
	// Reapply it after assignment so an earlier empty-job cancellation cannot be lost.
	if ctx.Err() != nil {
		_ = cmd.Cancel()
	}
	err = cmd.Wait()
	output.mu.Lock()
	result.Stdout = strings.ToValidUTF8(output.stdout.String(), "�")
	result.Stderr = strings.ToValidUTF8(output.stderr.String(), "�")
	result.OutputTruncated = output.truncated
	if output.truncated {
		result.StdoutFile = output.archiveStdout.Name()
		result.StderrFile = output.archiveStderr.Name()
	}
	output.mu.Unlock()
	result.ExitCode = cmd.ProcessState.ExitCode()
	switch {
	case errors.Is(ctx.Err(), context.DeadlineExceeded):
		result.Status = "timed_out"
	case ctx.Err() != nil:
		result.Status = "cancelled"
	case err == nil:
		result.Status = "completed"
	default:
		result.Status = "failed"
	}
	// Nonzero shell exit is a command result, not a transport/startup failure.
	var exitError *exec.ExitError
	if errors.As(err, &exitError) || ctx.Err() != nil {
		return result, nil
	}
	return result, err
}
