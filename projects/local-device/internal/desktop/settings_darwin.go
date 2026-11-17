package desktop

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fastgpt.local/local-device/internal/connector"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// configurePlatform uses the packaged native settings window and validates settings before displaying history.
func configurePlatform(ctx context.Context, directory, current string) (string, error) {
	settings, err := connector.ReadPlatformSettings(directory)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	executable, err := os.Executable()
	if err != nil {
		return "", err
	}
	payload, err := json.Marshal(map[string]any{
		"mode": "settings", "title": clientWindowTitle(), "message": "", "platform": current,
		"history": settings.History, "testExecutable": executable,
	})
	if err != nil {
		return "", err
	}
	command := exec.CommandContext(ctx, filepath.Join(filepath.Dir(executable), "connector-dialog"))
	command.Stdin = bytes.NewReader(payload)
	data, err := runNativeHelper(command)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// nativeAuthorizationOutput handles pause/resume without ending the management helper.
// Only existing accounts and these two actions are accepted; other actions keep their confirmation flow.
type nativeAuthorizationOutput struct {
	ctx    context.Context
	locals []*connector.LocalSession
	input  io.Writer
	buffer bytes.Buffer
	result bytes.Buffer
}

// Write separates newline-delimited account actions from the final dialog result.
func (w *nativeAuthorizationOutput) Write(data []byte) (int, error) {
	w.buffer.Write(data)
	for {
		line, err := w.buffer.ReadString('\n')
		if err != nil {
			w.buffer.WriteString(line)
			break
		}
		if !strings.HasPrefix(line, "__connector_account__:") {
			w.result.WriteString(line)
			continue
		}
		action := strings.TrimSuffix(strings.TrimPrefix(line, "__connector_account__:"), "\n")
		verb, id, _ := strings.Cut(action, ":")
		actionErr := errors.New("invalid_account_action")
		if verb == "pause" || verb == "resume" {
			for _, local := range w.locals {
				if accountID(local) == id {
					actionErr = changeAccountAccess(w.ctx, local, verb)
					break
				}
			}
		}
		message := ""
		if actionErr != nil {
			message = "未能更新授权，请重试"
		}
		response, _ := json.Marshal(map[string]any{"accounts": accountRows(w.ctx, w.locals), "error": message})
		if _, err := w.input.Write(append(response, '\n')); err != nil {
			return len(data), err
		}
	}
	return len(data), nil
}

// manageAuthorizations displays only locally approved sessions; actions return to the controller for validation.
func manageAuthorizations(ctx context.Context, directory, current string, locals []*connector.LocalSession, selectedAccountID string, status ...string) (string, error) {
	executable, err := os.Executable()
	if err != nil {
		return "", err
	}
	settings, err := connector.ReadPlatformSettings(directory)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return "", err
	}

	payload, err := json.Marshal(map[string]any{"mode": "authorizations", "title": clientWindowTitle(), "message": "", "platform": current, "accounts": accountRows(ctx, locals), "selectedAccountID": selectedAccountID, "history": settings.History, "testExecutable": executable})
	if err != nil {
		return "", err
	}
	command := exec.CommandContext(ctx, filepath.Join(filepath.Dir(executable), "connector-dialog"))
	command.Stdin = bytes.NewReader(payload)
	// 独立响应管道保留 stdin 的初始 JSON/EOF 协议，避免影响其他确认窗口。
	reader, writer, err := os.Pipe()
	if err != nil {
		return "", err
	}
	defer reader.Close()
	defer writer.Close()
	command.ExtraFiles = []*os.File{reader}
	output := &nativeAuthorizationOutput{ctx: ctx, locals: locals, input: writer}
	command.Stdout = output
	_, err = runNativeHelper(command)
	data := append(output.result.Bytes(), output.buffer.Bytes()...)
	return string(data), err
}
