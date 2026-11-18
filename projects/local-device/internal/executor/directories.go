package executor

import (
	"context"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

const directoriesPrefix = "exit 97\n# ai-studio-directories-v1 "

func listDirectories(ctx context.Context, command string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(command, directoriesPrefix))
	dir := string(raw)
	if err != nil || !filepath.IsAbs(dir) {
		return "", errors.New("invalid_directory")
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", err
	}
	var names strings.Builder
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		isDir := entry.IsDir()
		if entry.Type()&os.ModeSymlink != 0 {
			info, err := os.Stat(filepath.Join(dir, entry.Name()))
			isDir = err == nil && info.IsDir()
		}
		if isDir {
			names.WriteString(entry.Name())
			names.WriteByte(0)
		}
	}
	return base64.StdEncoding.EncodeToString([]byte(names.String())), nil
}
