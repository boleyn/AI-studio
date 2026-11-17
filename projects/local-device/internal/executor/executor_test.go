package executor

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func testShell(t *testing.T) Shell {
	t.Helper()
	kind := "bash"
	if runtime.GOOS == "windows" {
		kind = "powershell"
	}
	shell, err := ResolveShell(kind)
	if err != nil {
		t.Fatal(err)
	}
	return shell
}

func TestNativeExecution(t *testing.T) {
	shell := testShell(t)
	command := "printf 'hello 世界'; printf 'err' >&2; exit 7"
	if runtime.GOOS == "windows" {
		command = "[Console]::Write('hello 世界'); [Console]::Error.Write('err'); exit 7"
	}
	result, err := Run(context.Background(), shell, Request{Command: command, Workdir: t.TempDir(), Timeout: time.Second * 10})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "failed" || result.ExitCode != 7 || result.Stdout != "hello 世界" || result.Stderr != "err" {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestIndependentCommandsAndWorkdir(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "中文 path")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	command := "pwd; export FASTGPT_LOCAL_TEST=one"
	second := "printf '%s' \"${FASTGPT_LOCAL_TEST-unset}\""
	if runtime.GOOS == "windows" {
		command = "[Console]::Write((Get-Location).Path); $env:FASTGPT_LOCAL_TEST='one'"
		second = "if (-not $env:FASTGPT_LOCAL_TEST) { [Console]::Write('unset') }"
	}
	shell := testShell(t)
	result, err := Run(context.Background(), shell, Request{Command: command, Workdir: dir, Timeout: 10 * time.Second})
	if err != nil || result.Status != "completed" || !strings.Contains(result.Stdout, "中文 path") {
		t.Fatalf("%+v %v", result, err)
	}
	result, err = Run(context.Background(), shell, Request{Command: second, Workdir: dir, Timeout: 10 * time.Second})
	if err != nil || result.Stdout != "unset" {
		t.Fatalf("state leaked: %+v %v", result, err)
	}
}

func TestTimeoutAndCancellation(t *testing.T) {
	command := "sleep 30 & wait"
	if runtime.GOOS == "windows" {
		command = "Start-Sleep -Seconds 30"
	}
	shell := testShell(t)
	start := time.Now()
	result, err := Run(context.Background(), shell, Request{Command: command, Workdir: t.TempDir(), Timeout: 100 * time.Millisecond})
	if err != nil || result.Status != "timed_out" || time.Since(start) > 5*time.Second {
		t.Fatalf("%+v %v", result, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	timer := time.AfterFunc(100*time.Millisecond, cancel)
	defer timer.Stop()
	defer cancel()
	result, err = Run(ctx, shell, Request{Command: command, Workdir: t.TempDir(), Timeout: 10 * time.Second})
	if err != nil || result.Status != "cancelled" {
		t.Fatalf("%+v %v", result, err)
	}
}

func TestOutputLimitAndValidation(t *testing.T) {
	command := "head -c 200000 /dev/zero"
	if runtime.GOOS == "windows" {
		command = "[Console]::Write(('x' * 200000))"
	}
	shell := testShell(t)
	dir := t.TempDir()
	result, err := Run(context.Background(), shell, Request{Command: command, Workdir: dir, Timeout: 10 * time.Second})
	if err != nil || !result.OutputTruncated || len(result.Stdout) != 128*1024 {
		t.Fatalf("limit failed: %d %v", len(result.Stdout), err)
	}
	for _, req := range []Request{
		{Command: "echo ok", Workdir: "relative", Timeout: time.Second}, {Command: "echo ok", Workdir: filepath.Join(dir, "absent"), Timeout: time.Second},
		{Workdir: dir, Timeout: time.Second}, {Command: "echo ok", Workdir: dir}, {Command: "echo ok", Workdir: dir, Timeout: 11 * time.Minute},
		{Command: "echo\x00bad", Workdir: dir, Timeout: time.Second},
	} {
		if _, err := Run(context.Background(), shell, req); err == nil {
			t.Fatalf("accepted invalid request: %+v", req)
		}
	}
}

func TestShellArguments(t *testing.T) {
	for _, kind := range []string{"bash", "sh", "cmd", "powershell"} {
		args, err := commandArgs(Shell{Kind: kind}, "echo 'a & b'")
		if err != nil || len(args) == 0 {
			t.Fatalf("%s: %v", kind, err)
		}
	}
	if _, err := commandArgs(Shell{Kind: "unknown"}, "echo ok"); err == nil {
		t.Fatal("accepted unknown shell")
	}
	if _, err := ResolveShell("unknown"); err == nil {
		t.Fatal("resolved unknown shell")
	}
}

func TestStartupFailures(t *testing.T) {
	dir := t.TempDir()
	shell := testShell(t)
	req := Request{Command: "echo ok", Workdir: dir, Timeout: time.Second}
	if _, err := Run(context.Background(), Shell{Path: "relative", Kind: shell.Kind}, req); err == nil {
		t.Fatal("relative shell accepted")
	}
	if _, err := Run(context.Background(), Shell{Path: filepath.Join(dir, "missing-shell"), Kind: shell.Kind}, req); err == nil {
		t.Fatal("missing shell accepted")
	}
	path := filepath.Join(dir, "not-a-directory")
	if err := os.WriteFile(path, []byte("test"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Run(context.Background(), shell, Request{Command: "echo ok", Workdir: path, Timeout: time.Second}); err == nil {
		t.Fatal("file workdir accepted")
	}
	for _, command := range []string{" \n ", strings.Repeat("x", 65537)} {
		if _, err := commandArgs(shell, command); err == nil {
			t.Fatal("invalid command accepted")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Run(ctx, shell, req); err == nil {
		t.Fatal("started cancelled request")
	}
}

func TestSharedOutputBudget(t *testing.T) {
	b := &boundedOutput{remaining: 3}
	stdout := outputWriter{buffer: b}
	stderr := outputWriter{buffer: b, stderr: true}
	if n, err := stdout.Write([]byte("ab")); n != 2 || err != nil {
		t.Fatal(n, err)
	}
	if n, err := stderr.Write([]byte("cdef")); n != 4 || err != nil {
		t.Fatal(n, err)
	}
	if b.stdout.String() != "ab" || b.stderr.String() != "c" || !b.truncated {
		t.Fatal("shared budget failed")
	}
}
