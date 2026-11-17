package operation

import (
	"context"
	"errors"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"fastgpt.local/local-device/internal/executor"
	"fastgpt.local/local-device/internal/journal"
)

func TestReadOutputRequiresCurrentGrant(t *testing.T) {
	ctx := context.Background()
	ledger, err := journal.Open(filepath.Join(t.TempDir(), "state"))
	if err != nil {
		t.Fatal(err)
	}
	defer ledger.Close()
	if _, _, err := ledger.Accept(ctx, journal.Record{ID: "op", GrantID: "grant", Digest: strings.Repeat("a", 64), Deadline: time.Now().Add(time.Minute).UnixMilli()}, time.Now()); err != nil {
		t.Fatal(err)
	}
	calls, revokeAt := 0, 0
	service, err := New(ledger, executor.Shell{}, func(Request) error {
		calls++
		if revokeAt > 0 && calls >= revokeAt {
			return errors.New("grant_revoked")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	query := OutputQuery{Query: Query{ID: "op", GrantID: "grant", GrantVersion: 1}, Limit: 64}
	if _, err := service.ReadOutput(ctx, query); err == nil || err.Error() != "operation_output_unavailable" {
		t.Fatalf("missing replay: %v", err)
	}
	service.outputID, service.output = "op", &executor.OutputStream{}
	if page, err := service.ReadOutput(ctx, query); err != nil || page.Done || len(page.Events) != 0 {
		t.Fatalf("empty live page: %v", err)
	}
	for _, at := range []int{1, 2, 3} {
		calls, revokeAt = 0, at
		if page, err := service.ReadOutput(ctx, query); err == nil || err.Error() != "grant_revoked" || len(page.Events) != 0 {
			t.Fatalf("revocation %d leaked output: %v", at, err)
		}
	}
	calls, revokeAt = 0, 0
	foreign := query
	foreign.GrantID = "other"
	if _, err := service.ReadOutput(ctx, foreign); err == nil || err.Error() != "operation_not_found" {
		t.Fatalf("foreign replay: %v", err)
	}
	foreign = query
	foreign.ID = "absent"
	if _, err := service.ReadOutput(ctx, foreign); err == nil || err.Error() != "operation_not_found" {
		t.Fatalf("absent replay: %v", err)
	}
	service.outputID = "newer"
	if _, err := service.ReadOutput(ctx, query); err == nil || err.Error() != "operation_output_unavailable" {
		t.Fatalf("wrong replay: %v", err)
	}
	query.ID = ""
	if _, err := service.ReadOutput(ctx, query); err == nil || err.Error() != "invalid_operation_query" {
		t.Fatalf("invalid query: %v", err)
	}
}

func TestNativeOperationOutputBeforeCompletion(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ledger, err := journal.Open(filepath.Join(t.TempDir(), "state"))
	if err != nil {
		t.Fatal(err)
	}
	defer ledger.Close()
	kind, command := "bash", "printf early; sleep 2; printf late"
	if runtime.GOOS == "windows" {
		kind, command = "powershell", "[Console]::Write('early'); Start-Sleep -Seconds 2; [Console]::Write('late')"
	}
	shell, err := executor.ResolveShell(kind)
	if err != nil {
		t.Fatal(err)
	}
	var revoked atomic.Bool
	service, err := New(ledger, shell, func(Request) error {
		if revoked.Load() {
			return errors.New("grant_revoked")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	req := Request{ID: "live", GrantID: "grant", GrantVersion: 1, Command: command, Workdir: t.TempDir(), TimeoutMs: 5000, Deadline: time.Now().Add(5 * time.Second).UnixMilli()}
	query := OutputQuery{Query: Query{ID: req.ID, GrantID: req.GrantID, GrantVersion: 1}, Limit: 64}
	done := make(chan error, 1)
	go func() {
		record, err := service.Run(ctx, req)
		if err == nil && record.Status != "completed" {
			err = errors.New("operation_not_completed")
		}
		done <- err
	}()
	// Always stop and join before the database and temporary directories are cleaned up.
	defer func() { cancel(); <-done }()
	deadline := time.Now().Add(1500 * time.Millisecond)
	for {
		page, err := service.ReadOutput(ctx, query)
		if err == nil && len(page.Events) > 0 {
			if page.Done || string(page.Events[0].Data) != "early" {
				t.Fatal("output did not arrive while running")
			}
			break
		}
		if err != nil && err.Error() != "operation_not_found" && err.Error() != "operation_output_unavailable" {
			t.Fatal(err)
		}
		if time.Now().After(deadline) {
			t.Fatal("no early output")
		}
		time.Sleep(5 * time.Millisecond)
	}
	service.SetPaused(true)
	if _, err := service.ReadOutput(ctx, query); err != nil {
		t.Fatalf("pause hid running output: %v", err)
	}
	if err := <-done; err != nil {
		done <- err
		t.Fatal(err)
	}
	done <- nil
	page, err := service.ReadOutput(ctx, query)
	if err != nil || !page.Done {
		t.Fatalf("final output: %v", err)
	}
	var text string
	for _, event := range page.Events {
		text += string(event.Data)
	}
	if text != "earlylate" {
		t.Fatalf("output mismatch: %q", text)
	}
	revoked.Store(true)
	if page, err := service.ReadOutput(ctx, query); err == nil || err.Error() != "grant_revoked" || len(page.Events) != 0 {
		t.Fatalf("completed output leaked: %v", err)
	}
}
