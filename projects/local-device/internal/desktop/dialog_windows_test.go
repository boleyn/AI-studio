package desktop

import (
	"context"
	"encoding/base64"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

// TestWindowsHelperProcess 为窗口生命周期测试提供真实子进程，不显示或批准授权。
func TestWindowsHelperProcess(t *testing.T) {
	mode := os.Getenv("CONNECTOR_TEST_HELPER")
	if mode == "" {
		return
	}
	if mode == "spawn" {
		child := windowsTestHelper(context.Background(), "wait")
		if err := child.Start(); err != nil {
			os.Exit(3)
		}
		if err := os.WriteFile(os.Getenv("CONNECTOR_TEST_CHILD_FILE"), []byte(strconv.Itoa(child.Process.Pid)), 0600); err != nil {
			os.Exit(4)
		}
		time.Sleep(30 * time.Second)
	}
	if mode == "wait" {
		time.Sleep(30 * time.Second)
	}
	_, _ = os.Stdout.WriteString("confirmed")
	os.Exit(0)
}

func windowsTestHelper(ctx context.Context, mode string) *exec.Cmd {
	command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestWindowsHelperProcess$")
	command.Env = append(os.Environ(), "CONNECTOR_TEST_HELPER="+mode)
	return command
}

// 等待真实子进程登记；超时只作为死锁保护，不依赖进程启动的固定耗时。
func waitWindowsHelper(t *testing.T, management bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		windowsDialogs.Lock()
		ready := windowsDialogs.approval != nil
		if management {
			ready = windowsDialogs.management != nil
		}
		windowsDialogs.Unlock()
		if ready {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("helper did not register")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestWindowsApprovalReplacesManagement(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	finished := make(chan struct{})
	go func() { defer close(finished); _, _ = runWindowsHelper(ctx, windowsTestHelper(ctx, "wait"), true) }()
	waitWindowsHelper(t, true)
	data, err := runWindowsHelper(ctx, windowsTestHelper(ctx, "output"), false)
	if err != nil || string(data) != "confirmed" {
		t.Fatalf("approval failed: %q %v", data, err)
	}
	select {
	case <-finished:
	case <-ctx.Done():
		t.Fatal("management remained alive")
	}
	windowsDialogs.Lock()
	defer windowsDialogs.Unlock()
	if windowsDialogs.management != nil || windowsDialogs.approval != nil || windowsDialogs.reserved {
		t.Fatal("window registration leaked")
	}
}

func TestWindowsManagementDoesNotReplaceApproval(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	finished := make(chan struct{})
	defer func() { cancel(); <-finished }()
	go func() { defer close(finished); _, _ = runWindowsHelper(ctx, windowsTestHelper(ctx, "wait"), false) }()
	waitWindowsHelper(t, false)
	if data, err := runWindowsHelper(ctx, windowsTestHelper(ctx, "output"), true); err == nil || len(data) != 0 {
		t.Fatal("management replaced security prompt")
	}
	windowsDialogs.Lock()
	alive := windowsDialogs.approval != nil
	windowsDialogs.Unlock()
	if !alive {
		t.Fatal("approval was cancelled by management")
	}
}

func TestWindowsReplacingManagementStopsChildTest(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	marker := t.TempDir() + `\child.pid`
	management := windowsTestHelper(ctx, "spawn")
	management.Env = append(management.Env, "CONNECTOR_TEST_CHILD_FILE="+marker)
	finished := make(chan struct{})
	go func() { defer close(finished); _, _ = runWindowsHelper(ctx, management, true) }()
	waitWindowsHelper(t, true)
	var pid int
	for {
		if data, err := os.ReadFile(marker); err == nil {
			pid, _ = strconv.Atoi(string(data))
			if pid > 0 {
				break
			}
		}
		select {
		case <-ctx.Done():
			t.Fatal("child did not start")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	child, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(child)
	if _, err := runWindowsHelper(ctx, windowsTestHelper(ctx, "output"), false); err != nil {
		t.Fatal(err)
	}
	if state, err := windows.WaitForSingleObject(child, 3000); err != nil || state != windows.WAIT_OBJECT_0 {
		t.Fatalf("connection test child survived: %d %v", state, err)
	}
	<-finished
}

func TestWindowsCancelledDialogDoesNotApprove(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if data, err := dialog(ctx, "approve", "test", ""); err == nil || data != "" {
		t.Fatal("cancelled dialog approved")
	}
}

// 真实加载内嵌 WPF 与超长脚本传输，但无效模式必须在显示任何窗口之前拒绝。
func TestWindowsUnsupportedModeRejectsWithoutUI(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	data, err := runWindowsDialog(ctx, map[string]any{
		"mode": "unsupported", "productName": "连接器测试", "message": `<TextBlock>$(invalid)</TextBlock>`,
	}, false)
	if err == nil || err.Error() != "local_confirmation_cancelled" || data != "" {
		t.Fatalf("invalid mode was not rejected: %q %v", data, err)
	}
}

func TestWindowsDialogScriptsParse(t *testing.T) {
	path := os.Getenv("SystemRoot") + `\System32\WindowsPowerShell\v1.0\powershell.exe`
	command := exec.Command(path, "-NoProfile", "-Command", `$tokens=$null;$errors=$null;$source=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd()));[void][System.Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors);if($errors.Count){[Console]::Error.Write(($errors|ForEach-Object Message)-join '\n');exit 1}`)
	command.Stdin = strings.NewReader(base64.StdEncoding.EncodeToString([]byte(windowScript + "\n" + managementScript + "\n" + nativeScript)))
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("invalid WPF script: %v %s", err, output)
	}
}

// 加载真实 WPF 和本地图标，验证共享窗口帮助函数可在 Windows PowerShell 5.1 运行。
// 不显示确认窗口、不创建绑定，也不触发任何授权结果。
func TestWindowsWindowAttentionInitializesIcon(t *testing.T) {
	for _, tc := range []struct {
		name string
		png  []byte
	}{{"window_asset", windowPNG()}, {"legacy_small_oem", trayPNG()}} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			path := os.Getenv("SystemRoot") + `\System32\WindowsPowerShell\v1.0\powershell.exe`
			command := exec.CommandContext(ctx, path, "-NoProfile", "-STA", "-Command", `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase,System.Drawing
$source=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine()))
. ([ScriptBlock]::Create($source))
$icon=[Console]::In.ReadLine()
$window=[Windows.Window]::new()
Initialize-ConnectorWindow -Window $window -IconBase64 $icon
if(!$window.Icon -or !$window.Icon.IsFrozen -or $window.Topmost){throw 'invalid window identity'}
Add-Type 'using System;using System.Runtime.InteropServices;public static class NativeIconProbe{[DllImport("user32.dll")]public static extern IntPtr SendMessage(IntPtr window,uint message,IntPtr kind,IntPtr value);}'
$handle=([Windows.Interop.WindowInteropHelper]::new($window)).EnsureHandle()
foreach($kind in @(0,1)){
    $native=[NativeIconProbe]::SendMessage($handle,127,[IntPtr]$kind,[IntPtr]::Zero)
    if($native -eq [IntPtr]::Zero){throw 'native window icon missing'}
    $bitmap=([Drawing.Icon]::FromHandle($native)).ToBitmap()
    try {
        $left=$bitmap.Width;$top=$bitmap.Height;$right=-1;$bottom=-1
        for($y=0;$y -lt $bitmap.Height;$y++){
            for($x=0;$x -lt $bitmap.Width;$x++){
                if($bitmap.GetPixel($x,$y).A -gt 128){
                    $left=[Math]::Min($left,$x);$right=[Math]::Max($right,$x)
                    $top=[Math]::Min($top,$y);$bottom=[Math]::Max($bottom,$y)
                }
            }
        }
        if(($right-$left+1) -lt $bitmap.Width*.8 -or ($bottom-$top+1) -lt $bitmap.Height*.8){throw 'native icon has excessive transparent padding'}
    } finally {$bitmap.Dispose()}
}
[ConnectorWindowAttention]::Stop($handle)
$window.Close()
[Console]::Write('initialized')`)
			command.Stdin = strings.NewReader(base64.StdEncoding.EncodeToString([]byte(windowScript)) + "\n" + base64.StdEncoding.EncodeToString(tc.png))
			output, err := command.CombinedOutput()
			if err != nil || string(output) != "initialized" {
				t.Fatalf("window initialization failed: %v %s", err, output)
			}
		})
	}
}
