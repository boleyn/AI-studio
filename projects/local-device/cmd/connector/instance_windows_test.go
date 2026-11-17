package main

import (
	"fmt"
	"os"
	"os/exec"
	"testing"
	"time"
)

// The child executes the same kernel-event path as a second Explorer launch.
func TestInstanceActivationChild(t *testing.T) {
	prefix := os.Getenv("CONNECTOR_TEST_ACTIVATE_PREFIX")
	if prefix == "" {
		return
	}
	release, acquired, err := acquireNamedInstance(prefix, func() {})
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if acquired {
		t.Fatal("second executable acquired instance")
	}
}

func TestRelaunchSignalsExistingInstance(t *testing.T) {
	prefix := fmt.Sprintf(`Local\FastGPT.LocalDevice.Test.%d.%d`, os.Getpid(), time.Now().UnixNano())
	woke := make(chan struct{}, 1)
	release, acquired, err := acquireNamedInstance(prefix, func() { woke <- struct{}{} })
	if err != nil || !acquired {
		t.Fatalf("first instance: %v %v", acquired, err)
	}
	defer func() {
		if release != nil {
			release()
		}
	}()
	child := exec.Command(os.Args[0], "-test.run=^TestInstanceActivationChild$")
	child.Env = append(os.Environ(), "CONNECTOR_TEST_ACTIVATE_PREFIX="+prefix)
	if output, err := child.CombinedOutput(); err != nil {
		t.Fatalf("relaunch failed: %v %s", err, output)
	}
	select {
	case <-woke:
	case <-time.After(5 * time.Second):
		t.Fatal("existing instance was not notified")
	}
	release()
	release = nil
	cleanup, acquired, err := acquireNamedInstance(prefix, func() {})
	if err != nil || !acquired {
		t.Fatalf("shutdown left stale instance objects: %v %v", acquired, err)
	}
	cleanup()
}
