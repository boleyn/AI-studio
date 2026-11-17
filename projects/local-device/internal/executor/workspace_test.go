package executor

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestWorkspaceOperations(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(t.TempDir(), "outside.txt")
	if err := os.WriteFile(outside, []byte("private"), 0600); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(root, "notes.txt")
	if err := os.WriteFile(file, []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	run := func(input workspaceRequest) (Result, error) {
		t.Helper()
		payload, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		return Run(context.Background(), Shell{}, Request{
			Command: workspacePrefix + base64.StdEncoding.EncodeToString(payload),
			Workdir: root,
		})
	}
	result, err := run(workspaceRequest{Action: "list"})
	if err != nil || result.Stdout != `{"entries":[{"name":"notes.txt","kind":"file"}]}` {
		t.Fatalf("list: %+v %v", result, err)
	}
	result, err = run(workspaceRequest{Action: "read", Path: "notes.txt"})
	if err != nil {
		t.Fatal(err)
	}
	var read struct{ Fingerprint string }
	if err := json.Unmarshal([]byte(result.Stdout), &read); err != nil {
		t.Fatal(err)
	}
	write := workspaceRequest{Action: "write", Path: "notes.txt", Content: "bmV3", Expected: read.Fingerprint}
	if _, err := run(write); err != nil {
		t.Fatal(err)
	}
	if _, err := run(write); err == nil || err.Error() != "workspace_file_conflict" {
		t.Fatalf("stale edit: %v", err)
	}
	if data, err := os.ReadFile(file); err != nil || string(data) != "new" {
		t.Fatalf("written content: %q %v", data, err)
	}
	if _, err := run(workspaceRequest{Action: "delete", Path: "notes.txt"}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Fatalf("deleted file: %v", err)
	}

	for _, path := range []string{"../outside.txt", "/outside.txt", "a/../../b", `C:\outside.txt`} {
		if _, err := run(workspaceRequest{Action: "read", Path: path}); err == nil {
			t.Fatalf("escaped workspace through %q", path)
		}
	}
	if err := os.Symlink(filepath.Dir(outside), filepath.Join(root, "escape")); err == nil {
		for _, action := range []string{"read", "delete"} {
			if _, err := run(workspaceRequest{Action: action, Path: "escape/outside.txt"}); err == nil {
				t.Fatalf("%s escaped workspace through symlink", action)
			}
		}
	}
	if data, err := os.ReadFile(outside); err != nil || string(data) != "private" {
		t.Fatalf("outside file changed: %q %v", data, err)
	}
}
