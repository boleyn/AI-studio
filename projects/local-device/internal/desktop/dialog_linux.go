package desktop

import (
	"context"
	"errors"
	"os/exec"
)

// Linux requires a desktop dialog provider; headless sessions fail closed.
func dialog(ctx context.Context, mode, message, address string) (string, error) {
	if mode == "invite" {
		mode = "setup"
		address = ""
	}
	if mode == "notice" {
		return "", exec.CommandContext(ctx, "zenity", "--info", "--no-markup", "--title="+clientWindowTitle(), "--text="+message).Run()
	}
	if mode == "setup" {
		data, err := exec.CommandContext(ctx, "zenity", "--entry", "--title="+clientWindowTitle(), "--text="+message, "--entry-text="+address).Output()
		if err != nil {
			return "", errors.New("local_setup_cancelled_or_unavailable")
		}
		return string(data), nil
	}
	if err := exec.CommandContext(ctx, "zenity", "--question", "--no-markup", "--title="+clientWindowTitle(), "--text="+message, "--default-cancel", "--ok-label=允许", "--cancel-label=拒绝").Run(); err != nil {
		return "", errors.New("local_confirmation_cancelled_or_unavailable")
	}
	if mode == "pairApprove" {
		return "confirmed", nil
	}
	data, err := exec.CommandContext(ctx, "zenity", "--file-selection", "--directory", "--title=选择默认工作目录（不是访问限制）").Output()
	if err != nil {
		return "", errors.New("local_confirmation_cancelled_or_unavailable")
	}
	return string(data), nil
}
