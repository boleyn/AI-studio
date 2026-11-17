package desktop

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"image/png"
	"runtime"
	"testing"
)

func TestPackagedOEMTrayIconAndInvalidFallback(t *testing.T) {
	previous := ProductIconBase64
	defer func() { ProductIconBase64 = previous }()
	ProductIconBase64 = ""
	fallback := trayIcon()
	ProductIconBase64 = "invalid-base64"
	if !bytes.Equal(trayIcon(), fallback) {
		t.Fatal("invalid icon must fall back")
	}
	data := fallback
	if runtime.GOOS == "windows" {
		data = data[22:]
	}
	ProductIconBase64 = base64.StdEncoding.EncodeToString(data)
	if !bytes.Equal(trayIcon(), fallback) {
		t.Fatal("packaged PNG must be preserved")
	}
	ProductIconBase64 = base64.StdEncoding.EncodeToString([]byte("not png"))
	if !bytes.Equal(trayIcon(), fallback) {
		t.Fatal("non-PNG icon must fall back")
	}
}

func TestTrayIcon(t *testing.T) {
	data := trayIcon()
	if runtime.GOOS == "windows" {
		if len(data) < 22 || binary.LittleEndian.Uint16(data[2:4]) != 1 || binary.LittleEndian.Uint16(data[4:6]) != 1 || binary.LittleEndian.Uint32(data[18:22]) != 22 || int(binary.LittleEndian.Uint32(data[14:18])) != len(data)-22 {
			t.Fatal("invalid ICO directory")
		}
		data = data[22:]
	}
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if img.Bounds().Dx() != 32 || img.Bounds().Dy() != 32 {
		t.Fatal("invalid tray icon dimensions")
	}
}

func TestConnectionLabels(t *testing.T) {
	for status, expected := range map[string]string{
		"authenticating": "正在验证设备身份…", "connecting": "正在连接平台…", "connected": "已连接平台", "disconnected": "连接中断，正在重连…", "invalid": "连接状态未知",
	} {
		if actual := connectionLabel(status); actual != expected {
			t.Fatalf("%s: %s", status, actual)
		}
	}
}

func TestStartupErrorLabelsDoNotLeakInternalDetails(t *testing.T) {
	for _, code := range []string{"invalid_platform_origin", "platform_address_required", "platform_connector_unavailable", "platform_unavailable", "local_confirmation_cancelled_or_unavailable", "local_setup_cancelled_or_unavailable", "invalid_local_settings", "local_settings_changed", "device_reauthentication_required", "private-path-and-token"} {
		label := startupErrorLabel(code)
		if label == "" || label == code {
			t.Fatalf("missing friendly failure: %s", code)
		}
	}
	if startupErrorLabel("private-path-and-token") != "连接已停止，请检查配置或联系支持" {
		t.Fatal("private details leaked")
	}
}
