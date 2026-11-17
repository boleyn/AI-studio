package desktop

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf16"
	"unsafe"
)

//go:embed dialog_windows.ps1
var nativeScript string

//go:embed management_windows.ps1
var managementScript string

//go:embed window_windows.ps1
var windowScript string

//go:embed connector-window.png
var windowIconPNG []byte

// windowPNG uses a high-resolution window asset independently of the small tray
// icon. Custom OEM icons are retained and normalized by the WPF window helper.
func windowPNG() []byte {
	if custom := trayPNG(); !bytes.Equal(custom, connectorIconPNG) {
		return custom
	}
	return windowIconPNG
}

var windowsDialogs struct {
	sync.Mutex
	management *exec.Cmd
	done       chan struct{}
	approval   *exec.Cmd
	reserved   bool
}
var windowsApprovalQueue sync.Mutex

// managementOutput handles refresh requests from the child without treating them as dialog results.
type managementOutput struct {
	ctx    context.Context
	input  *os.File
	buffer bytes.Buffer
	result bytes.Buffer
}

// Write accepts fragmented stdout and both Windows and Unix line endings; final
// dialog results remain separate from the read-only refresh protocol.
func (w *managementOutput) Write(p []byte) (int, error) {
	n := len(p)
	w.buffer.Write(p)
	for {
		line, err := w.buffer.ReadString('\n')
		if err != nil {
			w.buffer.WriteString(line)
			break
		}
		if strings.TrimSuffix(line, "\r\n") != "__connector_refresh__" && line != "__connector_refresh__\n" {
			w.result.WriteString(line)
			continue
		}
		reply := make(chan managementSnapshot, 1)
		ctx, cancel := context.WithTimeout(w.ctx, 5*time.Second)
		var snapshot managementSnapshot
		ok := false
		select {
		case managementSnapshotRequests <- reply:
			select {
			case snapshot = <-reply:
				ok = true
			case <-ctx.Done():
			}
		case <-ctx.Done():
		}
		cancel()
		data, _ := json.Marshal(map[string]any{"ok": ok, "snapshot": snapshot})
		_, _ = io.WriteString(w.input, base64.StdEncoding.EncodeToString(data)+"\n")
	}
	return n, nil
}

var windowsUser32 = syscall.NewLazyDLL("user32.dll")

type windowsFlashInfo struct {
	Size    uint32
	Window  uintptr
	Flags   uint32
	Count   uint32
	Timeout uint32
}

var windowsActivateCallback = syscall.NewCallback(func(hwnd, pid uintptr) uintptr {
	var owner uint32
	windowsUser32.NewProc("GetWindowThreadProcessId").Call(hwnd, uintptr(unsafe.Pointer(&owner)))
	visible, _, _ := windowsUser32.NewProc("IsWindowVisible").Call(hwnd)
	if owner == uint32(pid) && visible != 0 {
		windowsUser32.NewProc("ShowWindow").Call(hwnd, 9)
		windowsUser32.NewProc("SetForegroundWindow").Call(hwnd)
		active, _, _ := windowsUser32.NewProc("GetForegroundWindow").Call()
		if active != hwnd {
			// Relaunch activation still respects Windows foreground restrictions.
			info := windowsFlashInfo{Window: hwnd, Flags: 2, Count: 3}
			info.Size = uint32(unsafe.Sizeof(info))
			windowsUser32.NewProc("FlashWindowEx").Call(uintptr(unsafe.Pointer(&info)))
		}
		return 0
	}
	return 1
})

// notifyPortConflict 只展示错误与恢复步骤，不要求用户填写配置或授予执行权限。
func notifyPortConflict(ctx context.Context) {
	_, _ = dialog(ctx, "notice", "连接器暂时无法连接这台电脑\n\n本机连接端口（13005）正在被其他程序使用。\n\n如果还运行着旧版连接器，请先从托盘退出旧版。若是其他程序占用，请关闭相关程序，或联系管理员协助处理。\n\n处理后，右键点击连接器托盘图标，选择“重新连接”，再回到网页点击“连接此电脑”。", "")
}

func dialog(ctx context.Context, mode, message, address string) (string, error) {
	return runWindowsDialog(ctx, map[string]any{"mode": mode, "message": message, "address": address, "productName": clientWindowTitle()}, mode == "authorizations" || mode == "settings" || mode == "invite")
}

// runWindowsDialog 仅从 stdin 传递外部数据，不将地址、名称或连接码插入脚本。
func runWindowsDialog(ctx context.Context, input map[string]any, management bool) (string, error) {
	// 完整 WPF 模板通过 stdin 传输，避免超过 Windows 32767 字符命令行上限。
	bootstrap := `$source=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine())); & ([ScriptBlock]::Create($source))`
	units := utf16.Encode([]rune(bootstrap))
	raw := make([]byte, len(units)*2)
	for i, unit := range units {
		binary.LittleEndian.PutUint16(raw[i*2:], unit)
	}
	path := filepath.Join(os.Getenv("SystemRoot"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
	if !filepath.IsAbs(path) {
		return "", errors.New("native_dialog_unavailable")
	}
	// 窗口使用高分辨率品牌图标，避免高 DPI 任务栏居中显示小图；不修改调用方数据。
	windowInput := make(map[string]any, len(input)+1)
	for key, value := range input {
		windowInput[key] = value
	}
	windowInput["iconBase64"] = base64.StdEncoding.EncodeToString(windowPNG())
	payload, err := json.Marshal(windowInput)
	if err != nil {
		return "", err
	}
	cmd := exec.CommandContext(ctx, path, "-NoProfile", "-STA", "-EncodedCommand", base64.StdEncoding.EncodeToString(raw))
	// GUI 客户端只显示原生确认窗口，避免 PowerShell 控制台抢焦点。
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000} // CREATE_NO_WINDOW，不隐藏原生对话框。
	initial := base64.StdEncoding.EncodeToString([]byte(windowScript+"\n"+managementScript+"\n"+nativeScript)) + "\n" + base64.StdEncoding.EncodeToString(payload) + "\n"
	var output *managementOutput
	if management {
		reader, writer, pipeErr := os.Pipe()
		if pipeErr != nil {
			return "", pipeErr
		}
		defer reader.Close()
		defer writer.Close()
		cmd.Stdin = reader
		output = &managementOutput{ctx: ctx, input: writer}
		cmd.Stdout = output
		go func() { _, _ = io.WriteString(writer, initial) }()
	} else {
		cmd.Stdin = strings.NewReader(initial)
	}
	data, err := runWindowsHelper(ctx, cmd, management)
	if output != nil {
		data = append(output.result.Bytes(), output.buffer.Bytes()...)
	}
	if err != nil {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		var exit *exec.ExitError
		if errors.As(err, &exit) && exit.ExitCode() == 2 {
			return "", errors.New("local_confirmation_cancelled")
		}
		return "", errors.New("local_confirmation_cancelled_or_unavailable")
	}
	return string(data), nil
}

// runWindowsHelper 先关闭并等待管理进程退出，再显示安全申请；管理入口只唤回现有窗口。
func runWindowsHelper(ctx context.Context, command *exec.Cmd, management bool) ([]byte, error) {
	if !management {
		windowsApprovalQueue.Lock()
		defer windowsApprovalQueue.Unlock()
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		windowsDialogs.Lock()
		windowsDialogs.reserved = true
		previous, done := windowsDialogs.management, windowsDialogs.done
		windowsDialogs.Unlock()
		if previous != nil {
			_ = previous.Process.Kill()
			<-done
		}
		defer func() {
			windowsDialogs.Lock()
			windowsDialogs.reserved = false
			windowsDialogs.approval = nil
			windowsDialogs.Unlock()
		}()
	}
	windowsDialogs.Lock()
	if management && (windowsDialogs.reserved || windowsDialogs.management != nil) {
		current := windowsDialogs.management
		if windowsDialogs.approval != nil {
			current = windowsDialogs.approval
		}
		if current != nil {
			activateWindowsProcess(uint32(current.Process.Pid))
		}
		windowsDialogs.Unlock()
		return nil, errors.New("local_confirmation_cancelled")
	}
	if err := ctx.Err(); err != nil {
		windowsDialogs.Unlock()
		return nil, err
	}
	var output bytes.Buffer
	if command.Stdout == nil {
		command.Stdout = &output
	}
	cleanup, resume, err := containWindowsDialog(command)
	if err != nil {
		windowsDialogs.Unlock()
		return nil, err
	}
	defer cleanup()
	if err := command.Start(); err != nil {
		windowsDialogs.Unlock()
		return nil, err
	}
	if err := resume(); err != nil {
		_ = command.Process.Kill()
		_ = command.Wait()
		windowsDialogs.Unlock()
		return nil, err
	}
	if management {
		windowsDialogs.management = command
		windowsDialogs.done = make(chan struct{})
	} else {
		windowsDialogs.approval = command
	}
	windowsDialogs.Unlock()
	err = command.Wait()
	// 先结束 Job 中的子进程，再通知下一条安全申请可以显示。
	cleanup()
	if management {
		windowsDialogs.Lock()
		windowsDialogs.management = nil
		close(windowsDialogs.done)
		windowsDialogs.done = nil
		windowsDialogs.Unlock()
	}
	return output.Bytes(), err
}

// activateWindowsProcess 只唤回已登记 helper 的顶层窗口，不周期性抢占用户焦点。
func activateWindowsProcess(pid uint32) {
	windowsUser32.NewProc("EnumWindows").Call(windowsActivateCallback, uintptr(pid))
}
