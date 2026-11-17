package operation

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"fastgpt.local/local-device/internal/executor"
	"fastgpt.local/local-device/internal/journal"
)

func TestLocalPauseAndStop(t *testing.T) {
	dir := t.TempDir()
	ledger, err := journal.Open(filepath.Join(dir, "state"))
	if err != nil {
		t.Fatal(err)
	}
	defer ledger.Close()
	kind, command := "bash", "printf ready > ready; sleep 30"
	if runtime.GOOS == "windows" {
		kind, command = "powershell", "[System.IO.File]::WriteAllText((Join-Path (Get-Location) 'ready'),'ready'); Start-Sleep -Seconds 30"
	}
	shell, err := executor.ResolveShell(kind)
	if err != nil {
		t.Fatal(err)
	}
	s, err := New(ledger, shell, func(Request) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	if s.StopActive() {
		t.Fatal("idle stop claimed a task")
	}
	r := Request{ID: "paused", GrantID: "grant", GrantVersion: 1, Deadline: time.Now().Add(time.Minute).UnixMilli(), Command: command, Workdir: dir, TimeoutMs: 30000}
	s.SetPaused(true)
	if _, err = s.Run(context.Background(), r); err == nil || err.Error() != "device_paused" {
		t.Fatalf("pause ignored: %v", err)
	}
	if _, err = ledger.Get(context.Background(), r.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("paused command accepted: %v", err)
	}
	s.SetPaused(false)
	done := make(chan journal.Record, 1)
	go func() {
		record, err := s.Run(context.Background(), r)
		if err != nil {
			t.Error(err)
		}
		done <- record
	}()
	defer s.StopActive()
	limit := time.Now().Add(5 * time.Second)
	for {
		if _, err := os.Stat(filepath.Join(dir, "ready")); err == nil {
			break
		}
		if time.Now().After(limit) {
			t.Fatal("process did not start")
		}
		time.Sleep(5 * time.Millisecond)
	}
	s.SetPaused(true)
	select {
	case record := <-done:
		t.Fatalf("pause stopped active process: %+v", record)
	case <-time.After(50 * time.Millisecond):
	}
	if !s.StopActive() {
		t.Fatal("active stop missed task")
	}
	select {
	case record := <-done:
		if record.Status != "cancelled" {
			t.Fatalf("stop result: %+v", record)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("process survived stop")
	}
	if s.StopActive() {
		t.Fatal("completed task still active")
	}
	// Results remain inspectable while paused; they are never executed again.
	if record, err := s.Run(context.Background(), r); err != nil || record.Status != "cancelled" {
		t.Fatalf("lost durable result: %+v %v", record, err)
	}
	s.SetPaused(false)
	r.ID, r.Command = "after-resume", "echo resumed"
	if record, err := s.Run(context.Background(), r); err != nil || record.Status != "completed" {
		t.Fatalf("resume failed: %+v %v", record, err)
	}
}

func TestDurableExecutionDoesNotRepeat(t *testing.T) {
	dir := t.TempDir()
	ledger, err := journal.Open(filepath.Join(dir, "state"))
	if err != nil {
		t.Fatal(err)
	}
	defer ledger.Close()
	kind := "bash"
	command := "printf x >> marker"
	if runtime.GOOS == "windows" {
		kind = "powershell"
		command = "[System.IO.File]::AppendAllText((Join-Path (Get-Location) 'marker'),'x')"
	}
	shell, err := executor.ResolveShell(kind)
	if err != nil {
		t.Fatal(err)
	}
	allowed := true
	service, err := New(ledger, shell, func(Request) error {
		if !allowed {
			return errors.New("grant_revoked")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	request := Request{ID: "op", GrantID: "grant", GrantVersion: 1, Deadline: time.Now().Add(time.Minute).UnixMilli(), Command: command, Workdir: dir, TimeoutMs: 10000}
	for i := 0; i < 3; i++ {
		record, err := service.Run(context.Background(), request)
		if err != nil || record.Status != "completed" {
			t.Fatalf("%+v %v", record, err)
		}
	}
	data, err := os.ReadFile(filepath.Join(dir, "marker"))
	if err != nil || string(data) != "x" {
		t.Fatalf("duplicate side effect: %s %v", data, err)
	}
	altered := request
	altered.Command = "echo other"
	if _, err := service.Run(context.Background(), altered); err == nil {
		t.Fatal("accepted conflict")
	}
	allowed = false
	if _, err := service.Run(context.Background(), request); err == nil {
		t.Fatal("returned private result after revocation")
	}
}

func TestMissingAuthorizer(t *testing.T) {
	if _, err := New(nil, executor.Shell{}, nil); err == nil {
		t.Fatal("accepted unauthenticated service")
	}
}

func TestValidationAndStartupFailure(t *testing.T) {
	dir := t.TempDir()
	ledger, err := journal.Open(filepath.Join(dir, "state"))
	if err != nil {
		t.Fatal(err)
	}
	defer ledger.Close()
	kind := "bash"
	if runtime.GOOS == "windows" {
		kind = "powershell"
	}
	shell, err := executor.ResolveShell(kind)
	if err != nil {
		t.Fatal(err)
	}
	service, err := New(ledger, shell, func(Request) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	base := Request{ID: "op", GrantID: "grant", GrantVersion: 1, Deadline: time.Now().Add(time.Minute).UnixMilli(), Command: "echo ok", Workdir: dir, TimeoutMs: 10000}
	for _, field := range []string{"version", "timeout", "deadline", "id"} {
		r := base
		switch field {
		case "version":
			r.GrantVersion = 0
		case "timeout":
			r.TimeoutMs = 0
		case "deadline":
			r.Deadline = 0
		case "id":
			r.ID = "invalid/id"
		}
		if _, err := service.Run(context.Background(), r); err == nil {
			t.Fatal(field)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := service.Run(ctx, base); err == nil {
		t.Fatal("cancelled request accepted")
	}
	base.Workdir = filepath.Join(dir, "missing")
	record, err := service.Run(context.Background(), base)
	if err != nil || record.Status != "failed" {
		t.Fatalf("startup failure not recorded: %+v %v", record, err)
	}
	if _, err := os.Stat(base.Workdir); !os.IsNotExist(err) {
		t.Fatal("created missing workdir")
	}
}

func TestBusyAndTimeout(t *testing.T) {
	dir := t.TempDir()
	ledger, err := journal.Open(filepath.Join(dir, "state"))
	if err != nil {
		t.Fatal(err)
	}
	defer ledger.Close()
	kind, command := "bash", "sleep 30"
	if runtime.GOOS == "windows" {
		kind = "powershell"
		command = "Start-Sleep -Seconds 30"
	}
	shell, err := executor.ResolveShell(kind)
	if err != nil {
		t.Fatal(err)
	}
	service, err := New(ledger, shell, func(Request) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	request := Request{ID: "slow", GrantID: "grant", GrantVersion: 1, Deadline: time.Now().Add(time.Minute).UnixMilli(), Command: command, Workdir: dir, TimeoutMs: 500}
	done := make(chan error, 1)
	go func() {
		record, err := service.Run(context.Background(), request)
		if err == nil && record.Status != "timed_out" {
			err = errors.New("expected timeout")
		}
		done <- err
	}()
	deadline := time.Now().Add(5 * time.Second)
	for {
		if record, err := ledger.Get(context.Background(), request.ID); err == nil && record.Status == "running" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("operation did not start")
		}
		time.Sleep(time.Millisecond)
	}
	duplicate, err := service.Run(context.Background(), request)
	if err != nil || duplicate.Status != "running" {
		t.Fatalf("duplicate live request: %+v %v", duplicate, err)
	}
	other := request
	other.ID = "other"
	if _, err := service.Run(context.Background(), other); err == nil || err.Error() != "device_busy" {
		t.Fatalf("busy result: %v", err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
