// Package desktop provides local-only native confirmation. Remote text is passed
// as data, never interpolated into an executable shell or automation script.
package desktop

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/url"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"syscall"
	"time"

	"fastgpt.local/local-device/internal/connector"
	"fastgpt.local/local-device/internal/grant"
	"fastgpt.local/local-device/internal/pairbridge"
)

// ProductName is embedded from the platform OEM configuration at packaging time.
var ProductName = "本机连接器"

// ClientVersion comes from the executable build version, shared by tray and native windows.
var ClientVersion = "development"

func clientWindowTitle() string {
	return ProductName + " · v" + ClientVersion
}

// PlatformOrigin 由发行包构建时注入；开发启动仍可显式指定平台。
var PlatformOrigin string

// ProductIconBase64 contains a packaged OEM 32px PNG, never a remote URL.
var ProductIconBase64 string

// StartConfigured is shared by tray and developer builds. Reconnecting reads the
// existing preference and never asks users for a device key or gateway token.
func StartConfigured(ctx context.Context, input connector.StartOptions) error {
	return startConfigured(ctx, input, nil)
}

func startConfigured(ctx context.Context, input connector.StartOptions, configureBridge func(*pairbridge.Server)) error {
	log.Print("connector: resolving platform")
	origin, err := connector.ResolvePlatform(ctx, connector.PlatformOptions{
		Directory: input.StateDirectory, Origin: input.Origin, DefaultOrigin: PlatformOrigin,
	})
	if err != nil {
		log.Print("connector: platform configuration failed: ", err)
		return err
	}
	input.Origin = origin
	bridge, err := pairbridge.New(origin, func(ctx context.Context, platform string) error {
		_, err := dialog(ctx, "pairApprove", "允许此平台绑定这台电脑？\n\n平台："+platform+"\n\n绑定仅建立设备身份。请在本机「已授权用户」中启用长期访问。", platform)
		return err
	})
	if err != nil {
		return err
	}
	if configureBridge != nil {
		configureBridge(bridge)
	}
	bridge.ClientVersion = ClientVersion
	closeBridge, err := bridge.Listen()
	if err != nil {
		// Windows 的 WSAEADDRINUSE 与 Unix errno 不同，只将确切的端口占用错误展示为冲突。
		if errors.Is(err, syscall.EADDRINUSE) || (runtime.GOOS == "windows" && errors.Is(err, syscall.Errno(10048))) {
			notifyPortConflict(ctx)
			return errors.New("pairing_port_in_use")
		}
		return fmt.Errorf("pairing_bridge_unavailable: %w", err)
	}
	defer closeBridge()
	log.Print("connector: pairing bridge ready")
	input.ShowPairingContext = bridge.Show
	previousBoundDevices := input.BoundDevices
	input.BoundDevices = func(ids []string) {
		bridge.BoundDevices(ids)
		if previousBoundDevices != nil {
			previousBoundDevices(ids)
		}
	}
	return runUntilCancelled(ctx, input, connector.Start)
}

// runUntilCancelled keeps the pairing bridge available after an identity is revoked.
// A replacement identity still requires native approval; previous execution grants are not reused.
func runUntilCancelled(ctx context.Context, input connector.StartOptions, start func(context.Context, connector.StartOptions) error) error {
	for {
		err := start(ctx, input)
		if !errors.Is(err, connector.ErrReauthenticationRequired) {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		// 仅服务端明确拒绝旧身份时重新配对，网络断线仍由原连接的退避重试处理。
		if input.Bound != nil {
			input.Bound("")
		}
		if input.Status != nil {
			input.Status("waiting_for_pairing")
		}
		input.RePair = false
		input.InviteCode = ""
	}
}

// Confirm requires a separate, explicit local acceptance and a local folder choice.
// The folder is a default working directory, never described as an access restriction.
func Confirm(ctx context.Context, value grant.Grant) (string, error) {
	expiry := "持续有效，直到你主动撤销"
	if value.ExpiresAt != 0 {
		expiry = time.UnixMilli(value.ExpiresAt).Local().Format("2006-01-02 15:04:05")
	}
	message := executionApprovalMessage(value, expiry)
	initialWorkdir := ""
	if value.Display != nil && filepath.IsAbs(value.Display.InitialWorkdir) {
		initialWorkdir = value.Display.InitialWorkdir
	}
	directory, err := dialog(ctx, "approve", message, initialWorkdir)
	if err != nil {
		return "", err
	}
	directory = strings.TrimSuffix(strings.TrimSuffix(directory, "\n"), "\r")
	if !filepath.IsAbs(directory) {
		return "", errors.New("local_directory_required")
	}
	return directory, nil
}

// executionApprovalMessage keeps internal IDs out of the consent text; names never participate in authorization.
func executionApprovalMessage(value grant.Grant, expiry string) string {
	names := grant.DisplayNames{TeamName: "当前团队", MemberName: "当前用户", AppName: "当前应用", ChatTitle: "当前对话"}
	if value.Display != nil {
		clean := func(value, fallback string) string {
			value = strings.Map(func(r rune) rune {
				if r < 32 || r == 127 {
					return ' '
				}
				return r
			}, value)
			if value = strings.TrimSpace(value); value != "" {
				return value
			}
			return fallback
		}
		names.TeamName = clean(value.Display.TeamName, names.TeamName)
		names.MemberName = clean(value.Display.MemberName, names.MemberName)
		names.AppName = clean(value.Display.AppName, names.AppName)
		names.ChatTitle = clean(value.Display.ChatTitle, names.ChatTitle)
	}
	return fmt.Sprintf("应用：%s\n对话：%s\n\n团队：%s\n用户：%s\n授权有效期：%s\n\n命令以当前系统用户身份运行，可访问本机文件、凭据和网络。", names.AppName, names.ChatTitle, names.TeamName, names.MemberName, expiry)
}

// parseInviteInput accepts either a copied platform link or a legacy raw code.
// The code stays in the URL fragment and is never sent in a navigation request.
func parseInviteInput(value, currentOrigin string) (string, string, error) {
	value = strings.TrimSpace(value)
	origin, code := currentOrigin, value
	if strings.Contains(value, "://") {
		link, err := url.Parse(value)
		if err != nil || link.User != nil || link.RawQuery != "" || (link.Path != "/account/devices" && link.Path != "/connector") {
			return "", "", errors.New("invalid_invite_link")
		}
		fragment, err := url.ParseQuery(link.Fragment)
		if err != nil || len(fragment) != 1 || len(fragment["connect"]) != 1 {
			return "", "", errors.New("invalid_invite_link")
		}
		code = fragment.Get("connect")
		link.Path, link.RawPath, link.Fragment, link.RawFragment = "", "", "", ""
		origin = link.String()
	}
	code = strings.ToUpper(strings.Join(strings.Fields(code), ""))
	if !regexp.MustCompile(`^[A-F0-9]{20}$`).MatchString(code) {
		return "", "", errors.New("invalid_invite_link")
	}
	if _, err := connector.NewPlatformClient(origin, nil); err != nil {
		return "", "", err
	}
	return origin, code, nil
}
