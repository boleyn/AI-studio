package executor

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Older clients execute only the fixed exit statement; the payload is a comment.
const workspacePrefix = "exit 97\n# fastgpt-workspace-v1 "
const workspaceReadLimit = 256 * 1024
const workspaceWriteLimit = 32 * 1024

type workspaceRequest struct {
	Action   string `json:"action"`
	Path     string `json:"path"`
	Content  string `json:"content"`
	Expected string `json:"expected"`
}

type workspaceEntry struct {
	Name string `json:"name"`
	Kind string `json:"kind"`
}

// runWorkspace uses the grant's directory as the filesystem boundary, including
// during symlink resolution. No workspace operation launches a shell.
func runWorkspace(ctx context.Context, request Request) (string, error) {
	var input workspaceRequest
	payload, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(request.Command, workspacePrefix))
	if err != nil || json.Unmarshal(payload, &input) != nil {
		return "", errors.New("workspace_invalid_request")
	}
	if input.Path == "" && input.Action != "list" {
		return "", errors.New("workspace_invalid_path")
	}
	for part := range strings.SplitSeq(input.Path, "/") {
		if input.Path != "" && (part == "" || part == "." || part == ".." || strings.ContainsAny(part, "\\:\x00")) {
			return "", errors.New("workspace_invalid_path")
		}
	}
	name := filepath.FromSlash(input.Path)
	if name == "" {
		name = "."
	}
	root, err := os.OpenRoot(request.Workdir)
	if err != nil {
		return "", errors.New("workspace_directory_unavailable")
	}
	defer root.Close()
	if err := ctx.Err(); err != nil {
		return "", err
	}
	result, err := workspaceOperation(ctx, root, name, input)
	if err != nil {
		return "", err
	}
	encoded, err := json.Marshal(result)
	if err != nil || len(encoded) > 384*1024 {
		return "", errors.New("workspace_result_too_large")
	}
	return string(encoded), nil
}

func workspaceOperation(ctx context.Context, root *os.Root, name string, input workspaceRequest) (any, error) {
	switch input.Action {
	case "list":
		info, err := root.Stat(name)
		if err != nil || !info.IsDir() {
			return nil, errors.New("workspace_directory_unavailable")
		}
		dir, err := root.OpenFile(name, os.O_RDONLY|workspaceOpenFlags, 0)
		if err != nil {
			return nil, errors.New("workspace_directory_unavailable")
		}
		defer dir.Close()
		items, err := dir.ReadDir(2001)
		if err != nil && err != io.EOF {
			return nil, errors.New("workspace_directory_unavailable")
		}
		if len(items) > 2000 {
			return nil, errors.New("workspace_directory_too_large")
		}
		entries := make([]workspaceEntry, 0, len(items))
		for _, item := range items {
			if strings.ContainsAny(item.Name(), "\\:") {
				continue
			}
			switch {
			case item.IsDir():
				entries = append(entries, workspaceEntry{item.Name(), "directory"})
			case item.Type().IsRegular():
				entries = append(entries, workspaceEntry{item.Name(), "file"})
			}
		}
		return map[string]any{"entries": entries}, nil
	case "read":
		content, err := readWorkspaceFile(root, name)
		if err != nil {
			return nil, err
		}
		digest := sha256.Sum256(content)
		return map[string]string{"content": base64.StdEncoding.EncodeToString(content), "fingerprint": hex.EncodeToString(digest[:])}, nil
	case "write":
		content, err := base64.StdEncoding.DecodeString(input.Content)
		if err != nil || len(content) > workspaceWriteLimit {
			return nil, errors.New("workspace_file_too_large")
		}
		original, err := readWorkspaceFile(root, name)
		if err != nil {
			return nil, err
		}
		digest := sha256.Sum256(original)
		if hex.EncodeToString(digest[:]) != input.Expected {
			return nil, errors.New("workspace_file_conflict")
		}
		if err := writeWorkspaceFile(ctx, root, name, content, digest); err != nil {
			return nil, err
		}
		written := sha256.Sum256(content)
		return map[string]string{"fingerprint": hex.EncodeToString(written[:])}, nil
	case "delete":
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		// Remove handles both regular files and empty directories without following symlinks.
		if err := root.Remove(name); err != nil {
			return nil, errors.New("workspace_delete_failed")
		}
		return map[string]bool{"deleted": true}, nil
	default:
		return nil, errors.New("workspace_invalid_request")
	}
}

func readWorkspaceFile(root *os.Root, name string) ([]byte, error) {
	info, err := root.Lstat(name)
	if err != nil || !info.Mode().IsRegular() {
		return nil, errors.New("workspace_file_unavailable")
	}
	if info.Size() > workspaceReadLimit {
		return nil, errors.New("workspace_file_too_large")
	}
	file, err := root.OpenFile(name, os.O_RDONLY|workspaceOpenFlags, 0)
	if err != nil {
		return nil, errors.New("workspace_file_unavailable")
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return nil, errors.New("workspace_file_conflict")
	}
	content, err := io.ReadAll(io.LimitReader(file, workspaceReadLimit+1))
	if err != nil {
		return nil, errors.New("workspace_file_unavailable")
	}
	if len(content) > workspaceReadLimit {
		return nil, errors.New("workspace_file_too_large")
	}
	return content, nil
}

func writeWorkspaceFile(ctx context.Context, root *os.Root, name string, content []byte, original [32]byte) error {
	info, err := root.Lstat(name)
	if err != nil || !info.Mode().IsRegular() {
		return errors.New("workspace_file_unavailable")
	}
	temp := filepath.Join(filepath.Dir(name), ".fastgpt-"+rand.Text())
	file, err := root.OpenFile(temp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, info.Mode().Perm())
	if err != nil {
		return errors.New("workspace_write_failed")
	}
	defer root.Remove(temp)
	_, writeErr := file.Write(content)
	closeErr := file.Close()
	if writeErr != nil || closeErr != nil {
		return errors.New("workspace_write_failed")
	}
	current, err := readWorkspaceFile(root, name)
	if err != nil || sha256.Sum256(current) != original {
		return errors.New("workspace_file_conflict")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := root.Rename(temp, name); err != nil {
		return errors.New("workspace_write_failed")
	}
	return nil
}
