package desktop

import (
	"context"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Compile the actual native script without displaying or approving any dialog.
func TestNativeDialogScriptCompiles(t *testing.T) {
	cmd := exec.Command("/usr/bin/osacompile", "-o", filepath.Join(t.TempDir(), "approval.scpt"))
	cmd.Stdin = strings.NewReader(nativeScript)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("invalid native script: %v %s", err, output)
	}
}

func TestCancelledDialogDoesNotApprove(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if value, err := dialog(ctx, "approve", "test", ""); err == nil || value != "" {
		t.Fatal("cancelled dialog approved")
	}
}

// Security prompts replace management, instead of spawning a second visible helper.
func TestApprovalClosesManagementBeforeStarting(t *testing.T) {
	managementDone := make(chan struct{})
	go func() {
		_, _ = runNativeHelper(exec.Command("/bin/sleep", "30"))
		close(managementDone)
	}()
	deadline := time.Now().Add(3 * time.Second)
	for {
		helperWindow.Lock()
		started := helperWindow.process != nil
		helperWindow.Unlock()
		if started {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("management did not start")
		}
		time.Sleep(time.Millisecond)
	}
	value, err := runApprovalHelper(exec.Command("/bin/sh", "-c", "printf confirmed"))
	if err != nil || string(value) != "confirmed" {
		t.Fatalf("approval failed: %q %v", value, err)
	}
	select {
	case <-managementDone:
	case <-time.After(time.Second):
		t.Fatal("management helper remained open")
	}
	helperWindow.Lock()
	defer helperWindow.Unlock()
	if helperWindow.pid != 0 || helperWindow.approvalPID != 0 {
		t.Fatal("window registration leaked")
	}
}
