package desktop

import (
	"bytes"
	_ "embed"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fastgpt.local/local-device/internal/connector"
	"fmt"
	"image/png"
	"runtime"
)

//go:embed connector.png
var connectorIconPNG []byte

func connectionLabel(status string) string {
	switch status {
	case "waiting_for_pairing":
		return "等待绑定设备…"
	case "authenticating":
		return "正在验证设备身份…"
	case "connecting":
		return "正在连接平台…"
	case "connected":
		return "已连接平台"
	case "disconnected":
		return "连接中断，正在重连…"
	default:
		return "连接状态未知"
	}
}

// startupErrorLabel keeps first-run failures actionable without displaying raw
// transport/database errors (which may contain private paths or service details).
func startupErrorLabel(code string) string {
	if message := platformNetworkErrorLabel(code); message != "" {
		return message
	}

	switch code {
	case "pairing_port_in_use":
		return "本机连接端口 13005 被占用，请释放后在连接设置中保存并连接"
	case "invalid_platform_origin", "platform_address_required":
		return "平台地址无效，请填写完整的 HTTP 或 HTTPS 地址"
	case "platform_connector_unavailable":
		return "平台尚未启用本机连接，请联系管理员"
	case "platform_unavailable":
		return "暂时无法访问平台，请检查网络后重试"
	case "local_confirmation_cancelled_or_unavailable", "local_setup_cancelled_or_unavailable":
		return "设置或确认已取消，可在连接设置中重试"
	case "settings_publish_failed":
		return "平台地址保存失败，请重试"
	case "invalid_local_settings", "local_settings_changed":
		return "本地配置无法读取，已停止连接，请联系支持"
	case "device_reauthentication_required":
		return "设备认证失效，请在授权管理中移除账号后重新添加"
	default:
		return "连接已停止，请检查配置或联系支持"
	}
}

// trayPNG 提供本机品牌图案，供托盘和 WPF 窗口复用；不读取远程图片。
func trayPNG() []byte {
	// 默认图案与 macOS 的连接窗口标记一致，不能使用易被误认为 PowerShell 的终端符号。
	if custom, err := base64.StdEncoding.DecodeString(ProductIconBase64); err == nil && len(custom) > 0 {
		if config, err := png.DecodeConfig(bytes.NewReader(custom)); err == nil && config.Width == 32 && config.Height == 32 {
			return custom
		}
	}
	return connectorIconPNG
}

// trayIcon 在 Windows 封装 ICO；其他平台及 WPF 窗口直接使用 PNG。
func trayIcon() []byte {
	encoded := trayPNG()
	if runtime.GOOS != "windows" {
		return encoded
	}
	icon := make([]byte, 22+len(encoded))
	binary.LittleEndian.PutUint16(icon[2:4], 1)
	binary.LittleEndian.PutUint16(icon[4:6], 1)
	icon[6], icon[7] = 32, 32
	binary.LittleEndian.PutUint16(icon[10:12], 1)
	binary.LittleEndian.PutUint16(icon[12:14], 32)
	binary.LittleEndian.PutUint32(icon[14:18], uint32(len(encoded)))
	binary.LittleEndian.PutUint32(icon[18:22], 22)
	copy(icon[22:], encoded)
	return icon
}

// platformNetworkErrorLabel maps the OS transport failure to a local recovery action.
func platformNetworkErrorLabel(code string) string {
	switch code {
	case "platform_permission_denied":
		if runtime.GOOS == "windows" {
			return "系统拒绝了连接器的网络访问。请检查 Windows 防火墙或联系管理员。"
		}
		return "系统拒绝了连接器的网络访问。请在系统设置「隐私与安全性 → 本地网络」允许连接器访问。"
	case "platform_host_unreachable":
		return "当前电脑无法路由到平台主机。请检查网络、VPN 和本地网络访问权限。"
	case "platform_connection_refused":
		return "平台主机拒绝了连接。请确认地址、端口及平台服务是否启动。"
	case "platform_connection_timeout":
		return "连接平台超时。请在这台电脑的浏览器打开同一地址，检查网络及防火墙。"
	case "platform_dns_failed":
		return "当前电脑无法解析平台域名。请检查域名或 DNS 设置。"
	case "platform_certificate_invalid":
		return "平台 HTTPS 证书校验失败。请使用证书对应的域名，并配置可信证书。"
	default:
		return ""
	}
}

// inviteErrorLabel keeps network and invitation failures distinct without exposing raw responses.
func inviteErrorLabel(err error) string {
	if message := platformNetworkErrorLabel(err.Error()); message != "" {
		return message
	}

	var requestError *connector.InviteRequestError
	if errors.As(err, &requestError) {
		detail := fmt.Sprintf("（HTTP %d，业务码 %d）", requestError.HTTPStatus, requestError.Code)
		switch requestError.HTTPStatus {
		case 404:
			return "当前平台没有连接码接口" + detail + "。请更新平台服务，或使用生成连接链接的平台地址。"
		case 401, 403:
			return "邀请接口拒绝访问" + detail + "。请检查反向代理或平台访问权限；连接器兑换连接码不需要网页登录。"
		case 429:
			return "平台限制了请求频率" + detail + "。请稍后重新连接。"
		case 400, 422:
			return "平台认为连接信息格式不正确" + detail + "。请从网页重新复制完整连接链接。"
		default:
			return "邀请接口处理失败" + detail + "。请检查平台服务日志后重试。"
		}
	}

	switch err.Error() {
	case "device_invite_expired":
		return "连接码已过期，请在网页生成新码。"
	case "device_invite_cancelled":
		return "这条邀请已取消，请在网页生成新码。"
	case "device_invite_used":
		return "连接码已经被使用，请查看网页设备列表。"
	case "device_invite_unavailable":
		return "当前平台找不到这条连接码。请从生成邀请的网页重新复制完整连接链接；旧版限时码被清理后需要重新生成。"
	case "device_pair_rate_limited":
		return "尝试过于频繁，请稍后重试。"
	case "platform_unavailable":
		return "无法访问平台，请检查地址和网络后重试。"
	case "invalid_platform_response":
		return "平台返回异常，请确认该平台已更新到支持连接码的版本。"
	default:
		return "邀请请求未完成，请重试；若再次失败，请检查平台服务日志。"
	}
}
