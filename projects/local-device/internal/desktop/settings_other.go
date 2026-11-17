//go:build !darwin && !windows

package desktop

import (
	"context"
	"fastgpt.local/local-device/internal/connector"
)

// configurePlatform retains native text input on platforms without the macOS settings helper.
func configurePlatform(ctx context.Context, directory, current string) (string, error) {
	return dialog(ctx, "setup", "输入要连接的平台地址。切换会停止当前任务。", current)
}

func manageAuthorizations(ctx context.Context, directory, current string, locals []*connector.LocalSession, selectedAccountID string, status ...string) (string, error) {
	return dialog(ctx, "setup", "输入 add 添加授权，或输入 clear 清除会话授权", "")
}
