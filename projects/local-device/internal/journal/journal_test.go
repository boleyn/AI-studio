package journal

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func fixture(t *testing.T) (*Journal, Record) {
	t.Helper()
	j, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { j.Close() })
	return j, Record{ID: "operation-1", Digest: strings.Repeat("a", 64), GrantID: "grant-1", Deadline: time.Now().Add(time.Minute).UnixMilli()}
}

func TestConcurrentAcceptance(t *testing.T) {
	j, r := fixture(t)
	var winners atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			stored, fresh, err := j.Accept(context.Background(), r, time.Now())
			if err != nil {
				t.Error(err)
				return
			}
			if stored.Status != "accepted" {
				t.Error(stored.Status)
			}
			if fresh {
				winners.Add(1)
			}
		}()
	}
	wg.Wait()
	if winners.Load() != 1 {
		t.Fatalf("launch permissions: %d", winners.Load())
	}
	for _, field := range []string{"digest", "grant", "deadline"} {
		altered := r
		switch field {
		case "digest":
			altered.Digest = strings.Repeat("b", 64)
		case "grant":
			altered.GrantID = "other"
		case "deadline":
			altered.Deadline++
		}
		if _, _, err := j.Accept(context.Background(), altered, time.Now()); err == nil {
			t.Fatalf("accepted conflicting %s", field)
		}
	}
}

func TestRecoveryAndExclusiveOwner(t *testing.T) {
	dir := t.TempDir()
	j, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	r := Record{ID: "accepted", Digest: strings.Repeat("a", 64), GrantID: "grant", Deadline: time.Now().Add(time.Minute).UnixMilli()}
	if _, _, err = j.Accept(context.Background(), r, time.Now()); err != nil {
		t.Fatal(err)
	}
	r.ID = "running"
	if _, _, err = j.Accept(context.Background(), r, time.Now()); err != nil {
		t.Fatal(err)
	}
	if err = j.MarkRunning(context.Background(), r.ID); err != nil {
		t.Fatal(err)
	}
	if duplicate, err := Open(dir); err == nil {
		duplicate.Close()
		t.Fatal("second connector acquired journal")
	}
	if err = j.Close(); err != nil {
		t.Fatal(err)
	}
	j, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer j.Close()
	for _, id := range []string{"accepted", "running"} {
		record, err := j.Get(context.Background(), id)
		if err != nil || record.Status != "unknown" {
			t.Fatalf("%+v %v", record, err)
		}
		r.ID = id
		record, fresh, err := j.Accept(context.Background(), r, time.Now())
		if err != nil || fresh || record.Status != "unknown" {
			t.Fatalf("replayed recovered operation: %+v %t %v", record, fresh, err)
		}
	}
}

func TestLifecycleAndRetention(t *testing.T) {
	j, r := fixture(t)
	ctx := context.Background()
	if _, _, err := j.Accept(ctx, r, time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := j.MarkRunning(ctx, r.ID); err != nil {
		t.Fatal(err)
	}
	if err := j.MarkRunning(ctx, r.ID); err == nil {
		t.Fatal("restarted running operation")
	}
	result := json.RawMessage(`{"stdout":"done","exitCode":0}`)
	if err := j.Finish(ctx, r.ID, "completed", result); err != nil {
		t.Fatal(err)
	}
	if err := j.Finish(ctx, r.ID, "failed", result); err == nil {
		t.Fatal("overwrote terminal result")
	}
	stored, err := j.Get(ctx, r.ID)
	if err != nil || string(stored.Result) != string(result) {
		t.Fatalf("%+v %v", stored, err)
	}
	if err := j.Prune(ctx, time.Now().Add(25*time.Hour)); err != nil {
		t.Fatal(err)
	}
	stored, err = j.Get(ctx, r.ID)
	if err != nil || stored.Result != nil || stored.Status != "completed" {
		t.Fatalf("tombstone lost: %+v %v", stored, err)
	}
	if err := j.Prune(ctx, time.Now().Add(8*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := j.Get(ctx, r.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatal(err)
	}
	if _, _, err := j.Accept(ctx, r, time.Now().Add(8*24*time.Hour)); err == nil {
		t.Fatal("accepted expired replay after pruning")
	}
}

func TestInvalidInputs(t *testing.T) {
	j, r := fixture(t)
	ctx := context.Background()
	for _, field := range []string{"id", "digest", "grant", "expired", "future"} {
		bad := r
		switch field {
		case "id":
			bad.ID = "bad/id"
		case "digest":
			bad.Digest = "bad"
		case "grant":
			bad.GrantID = ""
		case "expired":
			bad.Deadline = 0
		case "future":
			bad.Deadline = time.Now().Add(time.Hour).UnixMilli()
		}
		if _, _, err := j.Accept(ctx, bad, time.Now()); err == nil {
			t.Fatal(field)
		}
	}
	if err := j.Finish(ctx, "missing", "running", json.RawMessage(`{}`)); err == nil {
		t.Fatal("nonterminal finish")
	}
	if err := j.Finish(ctx, "missing", "failed", json.RawMessage(`broken`)); err == nil {
		t.Fatal("invalid JSON")
	}
	if err := j.Finish(ctx, "missing", "failed", json.RawMessage(strings.Repeat(" ", 1024*1024+1))); err == nil {
		t.Fatal("oversized result")
	}
	if _, err := Open("relative"); err == nil {
		t.Fatal("relative state dir")
	}
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "operations.sqlite"), 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(dir); err == nil {
		t.Fatal("directory instead of database")
	}
}

func TestClosedStoreFailsClosed(t *testing.T) {
	j, r := fixture(t)
	if err := j.Close(); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if _, _, err := j.Accept(ctx, r, time.Now()); err == nil {
		t.Fatal("accepted on closed database")
	}
	if err := j.MarkRunning(ctx, r.ID); err == nil {
		t.Fatal("marked running on closed database")
	}
	if err := j.Finish(ctx, r.ID, "failed", json.RawMessage(`{}`)); err == nil {
		t.Fatal("finished on closed database")
	}
	if err := j.Prune(ctx, time.Now()); err == nil {
		t.Fatal("pruned closed database")
	}
}

func TestNonDirectoryStatePath(t *testing.T) {
	path := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(path, []byte("test"), 0600); err != nil {
		t.Fatal(err)
	}
	if j, err := Open(path); err == nil {
		j.Close()
		t.Fatal("accepted non-directory state")
	}
}
