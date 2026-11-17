package desktop

import (
	"context"
	"errors"
	"os"

	"fastgpt.local/local-device/internal/connector"
)

// windowsManagement 在一个窗口中提供授权列表、添加授权及经过连接测试的地址切换。
func windowsManagement(ctx context.Context, mode, directory, current string, locals []*connector.LocalSession, selectedAccountID string, status ...string) (string, error) {
	settings, err := connector.ReadPlatformSettings(directory)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	executable, err := os.Executable()
	if err != nil {
		return "", err
	}

	connectionStatus := ""
	if len(status) > 0 {
		connectionStatus = connectionLabel(status[0])
	}
	return runWindowsDialog(ctx, map[string]any{
		"connectionStatus": connectionStatus,
		"mode":             mode, "productName": clientWindowTitle(), "address": current,
		"defaultPlatform": PlatformOrigin, "history": settings.History,
		"accounts": accountRows(ctx, locals), "selectedAccountID": selectedAccountID, "testExecutable": executable,
	}, true)
}

// configurePlatform 返回通过连接测试的地址，由控制器验证并持久化。
func configurePlatform(ctx context.Context, directory, current string) (string, error) {
	return windowsManagement(ctx, "settings", directory, current, nil, "")
}

// manageAuthorizations 的动作结果与 macOS 相同，权限变更仍由 Go 控制器处理。
func manageAuthorizations(ctx context.Context, directory, current string, locals []*connector.LocalSession, selectedAccountID string, status ...string) (string, error) {
	return windowsManagement(ctx, "authorizations", directory, current, locals, selectedAccountID, status...)
}
