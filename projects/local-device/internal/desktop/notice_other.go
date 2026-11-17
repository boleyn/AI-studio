//go:build !windows

package desktop

import "context"

// notifyPortConflict 其他平台通过托盘展示错误；Windows 额外提供原生说明窗口。
func notifyPortConflict(context.Context) {}
