package executor

import (
	"context"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

func TestDirectoryPickerListsOnlyFolders(t *testing.T) {
	root := t.TempDir()
	folder := "资料 ' 2026"
	if err := os.Mkdir(filepath.Join(root, folder), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "document.txt"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	list := func(path string) string {
		t.Helper()
		result, err := listDirectories(context.Background(), directoriesPrefix+base64.StdEncoding.EncodeToString([]byte(path)))
		if err != nil {
			t.Fatal(err)
		}
		raw, err := base64.StdEncoding.DecodeString(result)
		if err != nil {
			t.Fatal(err)
		}
		return string(raw)
	}
	if got := list(root); got != folder+"\x00" {
		t.Fatalf("unexpected entries %q", got)
	}
	if got := list(filepath.Join(root, folder)); got != "" {
		t.Fatalf("expected empty directory, got %q", got)
	}
}
