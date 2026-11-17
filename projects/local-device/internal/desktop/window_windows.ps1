# 仅在首次呈现窗口时请求前台；失败后有限闪烁任务栏，不定时抢占焦点。
function Initialize-ConnectorWindow {
    param($Window, [string]$IconBase64)
    if (-not ('ConnectorWindowAttention' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ConnectorWindowAttention {
    [StructLayout(LayoutKind.Sequential)]
    private struct FLASHWINFO {
        public uint cbSize;
        public IntPtr hwnd;
        public uint dwFlags;
        public uint uCount;
        public uint dwTimeout;
    }
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool FlashWindowEx(ref FLASHWINFO info);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    public static extern int SetCurrentProcessExplicitAppUserModelID(string appID);
    public static bool Request(IntPtr hwnd) {
        SetForegroundWindow(hwnd);
        bool active = GetForegroundWindow() == hwnd;
        Flash(hwnd, active ? 0u : 2u);
        return active;
    }
    public static void Stop(IntPtr hwnd) { Flash(hwnd, 0); }
    private static void Flash(IntPtr hwnd, uint flags) {
        var info = new FLASHWINFO {
            cbSize = (uint)Marshal.SizeOf(typeof(FLASHWINFO)), hwnd = hwnd,
            dwFlags = flags, uCount = 3, dwTimeout = 0
        };
        FlashWindowEx(ref info);
    }
}
'@
    }
    # 与 PowerShell 自身的任务栏分组区分，窗口仍显示连接器的品牌标题及图标。
    [void][ConnectorWindowAttention]::SetCurrentProcessExplicitAppUserModelID('tech.fastgpt.local-device.dialog')
    if ($IconBase64) {
        $stream = [IO.MemoryStream]::new([Convert]::FromBase64String($IconBase64))
        try {
            $icon = [Windows.Media.Imaging.BitmapFrame]::Create($stream, [Windows.Media.Imaging.BitmapCreateOptions]::None, [Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
            # WPF 不会将小源图放大填满大 HICON，高 DPI 任务栏会出现居中的小图案。
            # 默认使用高分辨率窗口资源；兼容旧的 32px OEM 图标，先归一化再交给 WPF。
            if ($icon.PixelWidth -lt 256 -or $icon.PixelHeight -lt 256) {
                $scale = [Windows.Media.ScaleTransform]::new((256.0 / $icon.PixelWidth), (256.0 / $icon.PixelHeight))
                $icon = [Windows.Media.Imaging.TransformedBitmap]::new($icon, $scale)
            }
            $icon.Freeze()
            $Window.Icon = $icon
        } finally { $stream.Dispose() }
    }
    $Window.Add_ContentRendered({
        param($sender, $eventArgs)
        [void]$sender.Activate()
        [void][ConnectorWindowAttention]::Request(([Windows.Interop.WindowInteropHelper]::new($sender)).Handle)
    })
    $stopAttention = {
        param($sender, $eventArgs)
        [ConnectorWindowAttention]::Stop(([Windows.Interop.WindowInteropHelper]::new($sender)).Handle)
    }
    $Window.Add_Activated($stopAttention)
    $Window.Add_Closed($stopAttention)
}
