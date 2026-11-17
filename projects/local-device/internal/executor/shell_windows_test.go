package executor

import (
	"context"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Exercise each installed PowerShell engine, not just the preferred one. These tests
// must run on Windows; cross-compiling this file is not execution evidence.
func TestWindowsPowerShellExitCodes(t *testing.T) {
	for _, name := range []string{"powershell.exe", "pwsh.exe"} {
		t.Run(name, func(t *testing.T) {
			path, err := exec.LookPath(name)
			if err != nil {
				t.Skipf("engine unavailable: %s", name)
			}
			if !filepath.IsAbs(path) {
				t.Fatal("shell path is not absolute")
			}
			for _, tc := range []struct {
				name    string
				command string
				code    int
			}{
				{"native_success", "cmd.exe /D /C exit 0", 0},
				{"native_failure", "cmd.exe /D /C exit 7", 7},
				{"explicit_exit", "exit 9", 9},
				{"terminating_error", "throw 'test failure'", 1},
				{"cmdlet_error", "Write-Error 'test failure'", 1},
			} {
				t.Run(tc.name, func(t *testing.T) {
					result, err := Run(context.Background(), Shell{Path: path, Kind: "powershell"}, Request{
						Command: tc.command, Workdir: t.TempDir(), Timeout: 15 * time.Second,
					})
					if err != nil || result.ExitCode != tc.code {
						t.Fatalf("result=%+v error=%v; want exit %d", result, err, tc.code)
					}
					wantStatus := "completed"
					if tc.code != 0 {
						wantStatus = "failed"
					}
					if result.Status != wantStatus {
						t.Fatalf("status=%s; want %s", result.Status, wantStatus)
					}
				})
			}
		})
	}
}

func TestWindowsCMDExitAndMetacharacters(t *testing.T) {
	shell, err := ResolveShell("cmd")
	if err != nil {
		t.Fatal(err)
	}
	result, err := Run(context.Background(), shell, Request{
		Command: "echo first& echo second& exit /b 7", Workdir: t.TempDir(), Timeout: 15 * time.Second,
	})
	if err != nil || result.Status != "failed" || result.ExitCode != 7 ||
		!strings.Contains(result.Stdout, "first") || !strings.Contains(result.Stdout, "second") {
		t.Fatalf("result=%+v error=%v", result, err)
	}
}
