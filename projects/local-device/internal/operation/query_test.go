package operation

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"fastgpt.local/local-device/internal/executor"
	"fastgpt.local/local-device/internal/journal"
)

func TestLookupDoesNotExecuteAndRequiresCurrentGrant(t *testing.T) {
	ctx := context.Background()
	ledger, err := journal.Open(filepath.Join(t.TempDir(), "state"))
	if err != nil {
		t.Fatal(err)
	}
	defer ledger.Close()
	// Seed an accepted operation from the past: querying its expired deadline cannot launch it.
	_, _, err = ledger.Accept(ctx, journal.Record{ID: "old", GrantID: "grant", Digest: strings.Repeat("a", 64), Deadline: time.Now().Add(-time.Minute).UnixMilli()}, time.Now().Add(-2*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	var calls int
	var revokeAt int
	s, err := New(ledger, executor.Shell{}, func(r Request) error {
		calls++
		if r.GrantVersion != 1 || (revokeAt > 0 && calls >= revokeAt) {
			return errors.New("grant_revoked")
		}
		if r.Command != "" || r.Deadline != 0 {
			t.Fatal("query carried an executable request")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	s.SetPaused(true)
	query := Query{ID: "old", GrantID: "grant", GrantVersion: 1}
	if result, err := s.Lookup(ctx, query); err != nil || result.Status != "accepted" {
		t.Fatalf("lookup changed state: %+v %v", result, err)
	}
	if calls != 2 {
		t.Fatalf("missing authorization recheck: %d", calls)
	}
	for _, other := range []Query{{ID: "missing", GrantID: "grant", GrantVersion: 1}, {ID: "old", GrantID: "other", GrantVersion: 1}} {
		if result, err := s.Lookup(ctx, other); err == nil || err.Error() != "operation_not_found" || result.ID != "" {
			t.Fatalf("leaked foreign/missing operation: %+v %v", result, err)
		}
	}
	for _, mutate := range []func(*Query){func(q *Query) { q.ID = "" }, func(q *Query) { q.GrantID = "" }, func(q *Query) { q.GrantVersion = 0 }, func(q *Query) { q.ID = strings.Repeat("a", 129) }} {
		invalid := query
		mutate(&invalid)
		if _, err := s.Lookup(ctx, invalid); err == nil || err.Error() != "invalid_operation_query" {
			t.Fatalf("accepted invalid query: %v", err)
		}
	}
	for _, at := range []int{1, 2} {
		calls, revokeAt = 0, at
		if result, err := s.Lookup(ctx, query); err == nil || err.Error() != "grant_revoked" || result.ID != "" {
			t.Fatalf("revocation leaked result: %+v %v", result, err)
		}
	}
	calls, revokeAt = 0, 0
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := s.Lookup(cancelled, query); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel ignored: %v", err)
	}
}

func TestCancelDoesNotStopDifferentOperation(t *testing.T) {
	ctx := context.Background()
	ledger, err := journal.Open(filepath.Join(t.TempDir(), "state"))
	if err != nil {
		t.Fatal(err)
	}
	defer ledger.Close()
	if _, _, err := ledger.Accept(ctx, journal.Record{ID: "old", GrantID: "grant", Digest: strings.Repeat("a", 64), Deadline: time.Now().Add(time.Minute).UnixMilli()}, time.Now()); err != nil {
		t.Fatal(err)
	}
	s, err := New(ledger, executor.Shell{}, func(Request) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	stopped := false
	s.activeID, s.active = "new", func() { stopped = true }
	query := Query{ID: "old", GrantID: "grant", GrantVersion: 1}
	if record, err := s.Cancel(ctx, query); err != nil || record.ID != "old" || stopped {
		t.Fatalf("old cancellation affected new task: %v", err)
	}
	query.GrantID = "foreign"
	if _, err := s.Cancel(ctx, query); err == nil || stopped {
		t.Fatal("foreign cancellation accepted")
	}
	query.GrantID = "grant"
	s.activeID = "old"
	if record, err := s.Cancel(ctx, query); err != nil || !stopped || record.Status != "accepted" {
		t.Fatalf("cancel missed task or invented terminal status: %v", err)
	}
}

func TestLookupAfterRestartKeepsUnknown(t *testing.T) {
	ctx := context.Background()
	directory := filepath.Join(t.TempDir(), "state")
	ledger, err := journal.Open(directory)
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = ledger.Accept(ctx, journal.Record{ID: "interrupted", GrantID: "grant", Digest: strings.Repeat("a", 64), Deadline: time.Now().Add(time.Minute).UnixMilli()}, time.Now())
	if err != nil {
		ledger.Close()
		t.Fatal(err)
	}
	if err := ledger.MarkRunning(ctx, "interrupted"); err != nil {
		ledger.Close()
		t.Fatal(err)
	}
	if err := ledger.Close(); err != nil {
		t.Fatal(err)
	}
	ledger, err = journal.Open(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer ledger.Close()
	// No shell is configured: result recovery must never invoke an executor.
	service, err := New(ledger, executor.Shell{}, func(Request) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		record, err := service.Lookup(ctx, Query{ID: "interrupted", GrantID: "grant", GrantVersion: 1})
		if err != nil || record.Status != "unknown" {
			t.Fatalf("recovery invented a result: %+v %v", record, err)
		}
	}
}
