package journal

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestGrantDiagnosticsPersistBoundedConcurrentRecords(t *testing.T) {
	dir := t.TempDir()
	j, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer j.Close()
	value := GrantDiagnostic{Timestamp: 1, Stage: "grant_renew", Code: "invalid_execution_lease", GrantID: "grant", GrantVersion: 1, LeaseRemainingMs: 61000}
	var workers sync.WaitGroup
	for range 12 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			if err := j.RecordGrantDiagnostic(value); err != nil {
				t.Error(err)
			}
		}()
	}
	workers.Wait()
	path := filepath.Join(dir, "grant-diagnostics.jsonl")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 12 {
		t.Fatalf("records=%d", len(lines))
	}
	for _, line := range lines {
		var actual GrantDiagnostic
		if err := json.Unmarshal([]byte(line), &actual); err != nil || actual != value {
			t.Fatalf("invalid record: %s", line)
		}
	}
	if err := os.WriteFile(path, []byte(strings.Repeat("x", diagnosticLimit)), 0600); err != nil {
		t.Fatal(err)
	}
	if err := j.RecordGrantDiagnostic(value); err != nil {
		t.Fatal(err)
	}
	data, err = os.ReadFile(path)
	if err != nil || len(data) >= diagnosticLimit || strings.Count(string(data), "\n") != 1 {
		t.Fatal("diagnostics not bounded")
	}
	for _, invalid := range []GrantDiagnostic{
		{Stage: "secret command", Code: "grant_rejected", GrantID: "grant"},
		{Stage: "grant_renew", Code: "C:\\private\\path", GrantID: "grant"},
		{Stage: "grant_renew", Code: "grant_rejected", GrantID: "grant\ninjected"},
	} {
		if j.RecordGrantDiagnostic(invalid) == nil {
			t.Fatal("unsafe diagnostic accepted")
		}
	}
}

func TestGrantDiagnosticsRejectNonRegularFile(t *testing.T) {
	dir := t.TempDir()
	j, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer j.Close()
	if err := os.Mkdir(filepath.Join(dir, "grant-diagnostics.jsonl"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := j.RecordGrantDiagnostic(GrantDiagnostic{Stage: "grant_renew", Code: "grant_rejected", GrantID: "grant"}); err == nil {
		t.Fatal("nonregular diagnostic file accepted")
	}
}
