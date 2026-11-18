//go:build !headless

package desktop

import (
	"context"
	"errors"
	"fastgpt.local/local-device/internal/grant"
	"fastgpt.local/local-device/internal/pairbridge"
	"log"
	"runtime"
	"strings"
	"sync"
	"time"

	"fastgpt.local/local-device/internal/connector"
	"github.com/getlantern/systray"
)

// Run owns the OS tray on the main thread. Connector callbacks only post events;
// menu actions and connection transitions are serialized by the controller loop.
// Exit cancels the core and waits for native processes/journal cleanup before quitting.
func Run(parent context.Context, input connector.StartOptions) error {
	input.AccountMode = true
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	type event struct {
		status          string
		session         *connector.LocalSession
		removed         string
		ack             chan struct{}
		finished        bool
		err             error
		secondaryOrigin string
		statusOrigin    string
		access          grant.AccountAccess
		inviteCode      string
		inviteOrigin    string
		settingsOrigin  string
	}
	// A single FIFO prevents an old ready/status event reviving a finished session.
	events := make(chan event, 16)
	type addRequest struct {
		value    string
		decision chan<- bool
	}
	addRequests := make(chan addRequest, 1)
	var localDeviceIDs sync.Map
	configureBridge := func(bridge *pairbridge.Server) {
		bridge.LocalInviteDecision = func(origin, code string, decision chan<- bool) bool {
			select {
			case addRequests <- addRequest{value: origin + "/account/devices#connect=" + code, decision: decision}:
				return true
			default:
				return false
			}
		}
		bridge.LocalInvite = func(origin, code string) bool {
			return bridge.LocalInviteDecision(origin, code, nil)
		}
		bridge.LocalDevices = func(origin string) []string {
			if value, ok := localDeviceIDs.Load(origin); ok {
				return value.([]string)
			}
			return nil
		}
	}
	previousStatus, previousReady := input.Status, input.Ready
	input.Status = func(status string) {
		if previousStatus != nil {
			previousStatus(status)
		}
		select {
		case events <- event{status: status}:
		case <-ctx.Done():
		}
	}
	input.Ready = func(session *connector.LocalSession) {
		ack := make(chan struct{})
		select {
		case events <- event{session: session, ack: ack}:
		case <-ctx.Done():
			return
		}
		// Apply an existing local pause before Connect can receive any command.
		select {
		case <-ack:
		case <-ctx.Done():
			return
		}
		if previousReady != nil {
			previousReady(session)
		}
	}
	previousRemoved := input.Removed
	input.Removed = func(id string) {
		select {
		case events <- event{removed: id}:
		case <-ctx.Done():
		}
		if previousRemoved != nil {
			previousRemoved(id)
		}
	}
	systray.Run(func() {
		log.Print("connector: initializing tray")
		systray.SetIcon(trayIcon())
		systray.SetTitle("")
		installStatusHook()
		setNativeStatus("connecting")
		systray.SetTooltip(clientWindowTitle())
		productItem := systray.AddMenuItem(ProductName, "打开授权管理")
		versionItem := systray.AddMenuItem("版本 v"+ClientVersion, "当前运行的连接器版本")
		versionItem.Disable()
		systray.AddSeparator()
		statusItem := systray.AddMenuItem("正在启动…", "连接状态")
		statusItem.Disable()
		systray.AddSeparator()
		manage := systray.AddMenuItem("授权管理…", "查看授权并添加新的授权")
		pause := systray.AddMenuItemCheckbox("暂停接收任务", "不打断正在运行的命令", false)
		// Windows 更新隐藏菜单项会重新插入；旧入口不再创建，权限操作统一放在管理窗口。
		stop := systray.AddMenuItem("终止当前任务", "请求终止当前命令，不撤销会话授权")
		stop.Disable()
		stop.Hide()
		systray.AddSeparator()
		quit := systray.AddMenuItem("退出连接器", "停止本机执行并断开连接")
		log.Print("connector: tray ready")
		// Serialized with tray clicks; startup does not wait for network discovery.
		go func() {
			for {
				select {
				case <-managementRequests:
					select {
					case manage.ClickedCh <- struct{}{}:
					case <-ctx.Done():
						return
					}
				case <-ctx.Done():
					return
				}
			}
		}()
		if runtime.GOOS == "windows" {
			RequestManagement()
		}
		go func() {
			locals := make(map[string]*connector.LocalSession)
			paused, running, closing := false, true, false
			shutdown := ctx.Done()
			taskTicker := time.NewTicker(500 * time.Millisecond)
			defer taskTicker.Stop()
			var stopConnection context.CancelFunc
			var activeConnection context.Context
			var invites chan connector.BindingInvite
			var activeOrigin string
			var switching bool
			var inviteNext string
			var inviteAccess grant.AccountAccess
			otherPlatforms := make(map[string]chan connector.BindingInvite)
			var otherWorkers sync.WaitGroup
			platformStatuses := make(map[string]string)
			connectionStatus := "connecting"
			primaryStatus := "connecting"
			showStatus := func() {
				connectionStatus = primaryStatus
				for _, status := range platformStatuses {
					if status == "connected" {
						connectionStatus = status
						break
					}
				}
				statusItem.SetTitle(connectionLabel(connectionStatus))
			}
			startOther := func(origin, code string, access grant.AccountAccess) {
				options := input
				options.Origin, options.GatewayURL = origin, ""
				options.StateDirectory = platformDirectory(input.StateDirectory, origin)
				options.Secondary, options.RePair = true, false
				options.InviteCode, options.InviteAccess = code, access
				options.Bound = nil
				options.Status = func(status string) {
					select {
					case events <- event{status: status, statusOrigin: origin}:
					case <-ctx.Done():
					}
				}
				options.BoundDevices = func(ids []string) { localDeviceIDs.Store(origin, ids) }
				requests := make(chan connector.BindingInvite)
				options.Invites = requests
				options.Removed = func(id string) {
					select {
					case events <- event{removed: origin + "#" + id}:
					case <-ctx.Done():
					}
				}
				otherPlatforms[origin] = requests
				otherWorkers.Add(1)
				go func() {
					defer otherWorkers.Done()
					err := connector.Start(ctx, options)
					localDeviceIDs.Delete(origin)
					select {
					case events <- event{secondaryOrigin: origin, inviteCode: code, err: err}:
					case <-ctx.Done():
					}
				}()
			}
			addToPlatform := func(connectionCtx context.Context, requests chan connector.BindingInvite, update event) {
				go func() {
					result := make(chan error, 1)
					select {
					case requests <- connector.BindingInvite{Code: update.inviteCode, Access: update.access, Result: result}:
					case <-connectionCtx.Done():
						return
					}
					select {
					case err := <-result:
						if err != nil {
							_, _ = dialog(ctx, "notice", inviteErrorLabel(err)+"\n\n平台："+update.inviteOrigin, "")
						}
					case <-connectionCtx.Done():
					}
				}()
			}
			start := func(rePair bool) {
				primaryStatus = "connecting"
				showStatus()
				connectionCtx, stop := context.WithCancel(ctx)
				stopConnection = stop
				options := input
				activeConnection = connectionCtx
				activeOrigin, _ = connector.ResolvePlatform(connectionCtx, connector.PlatformOptions{Directory: options.StateDirectory, Origin: options.Origin, DefaultOrigin: PlatformOrigin})
				invites = make(chan connector.BindingInvite)
				options.Invites = invites
				options.RePair = rePair
				options.InviteCode, options.InviteAccess = inviteNext, inviteAccess
				inviteNext = ""
				go func() {
					defer stop()
					events <- event{finished: true, inviteCode: options.InviteCode, err: startConfigured(connectionCtx, options, configureBridge)}
				}()
			}
			start(false)
			for _, origin := range savedPlatforms(input.StateDirectory) {
				if origin != activeOrigin {
					startOther(origin, "", grant.AccountAccess{})
				}
			}
			for {
				select {
				case reply := <-managementSnapshotRequests:
					snapshot := make([]*connector.LocalSession, 0, len(locals))
					for _, local := range locals {
						snapshot = append(snapshot, local)
					}
					status := connectionLabel(connectionStatus)
					go func() { reply <- managementSnapshot{Status: status, Accounts: accountRows(ctx, snapshot)} }()
				case update := <-events:
					if update.settingsOrigin != "" {
						if closing || switching {
							continue
						}
						// 已由其他平台连接维护的地址无需再次启动，避免重复打开身份库。
						if otherPlatforms[update.settingsOrigin] != nil {
							go func() {
								_, _ = dialog(ctx, "notice", "该平台已有账号在线，可直接在已授权用户中管理。", "")
							}()
							continue
						}
						// 配置写入成功后，串行等待旧连接释放数据库和配对端口。
						origin, err := connector.SavePlatformOrigin(input.StateDirectory, update.settingsOrigin)
						if err != nil {
							go func() { _, _ = dialog(ctx, "notice", "无法保存连接设置，请重试。", "") }()
							continue
						}
						input.Origin = origin
						if running {
							switching = true
							stopConnection()
						} else {
							running = true
							start(false)
						}
					} else if update.statusOrigin != "" {
						platformStatuses[update.statusOrigin] = update.status
						if !closing {
							showStatus()
						}
					} else if update.secondaryOrigin != "" {
						delete(platformStatuses, update.secondaryOrigin)
						if !closing {
							showStatus()
						}
						delete(otherPlatforms, update.secondaryOrigin)
						for key, local := range locals {
							if local.Origin == update.secondaryOrigin {
								delete(locals, key)
							}
						}
						if update.inviteCode != "" && update.err != nil && !closing {
							go func() {
								_, _ = dialog(ctx, "notice", inviteErrorLabel(update.err)+"\n\n平台："+update.secondaryOrigin, "")
							}()
						}
					} else if update.inviteCode != "" && !update.finished {
						if closing || switching {
							continue
						}
						if update.inviteOrigin != activeOrigin {
							if requests := otherPlatforms[update.inviteOrigin]; requests != nil {
								addToPlatform(ctx, requests, update)
							} else if _, err := connector.SavePlatformOrigin(platformDirectory(input.StateDirectory, update.inviteOrigin), update.inviteOrigin); err != nil {
								go func() { _, _ = dialog(ctx, "notice", "无法保存平台授权，请重试。", "") }()
							} else {
								startOther(update.inviteOrigin, update.inviteCode, update.access)
							}
							continue
						}
						hasPrimary := false
						for _, local := range locals {
							hasPrimary = hasPrimary || local.Origin == activeOrigin
						}
						if running && hasPrimary {
							addToPlatform(activeConnection, invites, update)
							continue
						}
						inviteNext, inviteAccess = update.inviteCode, update.access
						if running {
							switching = true
							stopConnection()
						} else {
							running = true
							start(false)
						}
					} else if update.session != nil {
						locals[accountID(update.session)] = update.session
						update.session.Service.SetPaused(paused || closing)
						close(update.ack)
					} else if update.removed != "" {
						delete(locals, update.removed)
						delete(locals, activeOrigin+"#"+update.removed)
					} else if update.finished {
						primaryStatus = "error"
						showStatus()
						log.Print("connector: startup ended: ", update.err)
						running = false
						for key, local := range locals {
							if local.Origin == activeOrigin {
								delete(locals, key)
							}
						}
						stop.Hide()
						if closing {
							otherWorkers.Wait()
							systray.Quit()
							return
						}
						if switching {
							switching, running = false, true
							start(false)
							continue
						}
						if connectionStatus == "connected" {
							showStatus()
						} else if update.err != nil && !errors.Is(update.err, context.Canceled) {
							statusItem.SetTitle(startupErrorLabel(update.err.Error()))
						} else {
							statusItem.SetTitle("连接已停止")
						}

					} else if !closing && !switching {
						primaryStatus = update.status
						showStatus()
					}
				case <-taskTicker.C:
					if paused || closing {
						setNativeStatus("stopped")
					} else {
						setNativeStatus(connectionStatus)
					}
					active := false
					for _, local := range locals {
						active = active || local.Service.HasActive()
					}
					if active && !closing {
						stop.Enable()
					} else {
						stop.Hide()
					}
				case <-productItem.ClickedCh:
					go func() {
						select {
						case manage.ClickedCh <- struct{}{}:
						case <-ctx.Done():
						}
					}()
				case <-manage.ClickedCh:
					current, _ := connector.ResolvePlatform(ctx, connector.PlatformOptions{Directory: input.StateDirectory, Origin: input.Origin, DefaultOrigin: PlatformOrigin})
					snapshot := make([]*connector.LocalSession, 0, len(locals))
					for _, local := range locals {
						snapshot = append(snapshot, local)
					}
					directory := input.StateDirectory
					status := connectionStatus
					go func() {
						selectedAccountID := ""
						for ctx.Err() == nil {
							action, err := manageAuthorizations(ctx, directory, current, snapshot, selectedAccountID, status)
							if err != nil {
								return
							}
							if action == "refresh" {
								RequestManagement()
								return
							}
							if strings.HasPrefix(action, "settings:") {
								select {
								case events <- event{settingsOrigin: strings.TrimPrefix(action, "settings:")}:
								case <-ctx.Done():
								}
								return
							}
							if strings.HasPrefix(action, "invite:") {
								select {
								case addRequests <- addRequest{value: strings.TrimPrefix(action, "invite:")}:
								case <-ctx.Done():
								}
								return
							}
							verb, id, ok := strings.Cut(action, ":")
							if !ok {
								return
							}
							var grantID string
							if verb == "revoke-session" {
								grantID, id, ok = strings.Cut(id, ":")
								if !ok {
									return
								}
							}
							for _, local := range snapshot {
								if accountID(local) != id {
									continue
								}
								if verb == "revoke-session" {
									selectedAccountID = id
									err = local.Grants.RevokeSession(ctx, grantID)
								} else {
									selectedAccountID = ""
									err = changeAccountAccess(ctx, local, verb)
								}
								if err != nil && !errors.Is(err, context.Canceled) {
									_, _ = dialog(ctx, "notice", "未能更新授权："+err.Error(), "")
								}
								break
							}
						}
					}()
				case <-pause.ClickedCh:
					paused = !paused
					if paused {
						pause.Check()
						pause.SetTitle("恢复接收任务")
					} else {
						pause.Uncheck()
						pause.SetTitle("暂停接收任务")
					}
					for _, local := range locals {
						local.Service.SetPaused(paused)
					}
				case <-stop.ClickedCh:
					stopped := false
					for _, local := range locals {
						if local.Service.StopActive() {
							stopped = true
						}
					}
					if stopped {
						statusItem.SetTitle("已请求终止当前任务")
					} else {
						statusItem.SetTitle("当前没有运行中的任务")
					}
				case request := <-addRequests:
					if closing || switching {
						if request.decision != nil {
							request.decision <- false
						}
						continue
					}

					directory, explicitOrigin := input.StateDirectory, input.Origin
					go func() {
						allowed := false
						defer func() {
							if request.decision != nil {
								request.decision <- allowed
							}
						}()
						current, err := connector.ResolvePlatform(ctx, connector.PlatformOptions{Directory: directory, Origin: explicitOrigin, DefaultOrigin: PlatformOrigin})
						if err != nil {

							return
						}
						origin, code, err := parseInviteInput(request.value, current)
						if err != nil {
							_, _ = dialog(ctx, "notice", "连接链接或连接码格式无效，请从网页重新复制。", "")

							return
						}
						if err == nil {
							var platform *connector.PlatformClient
							platform, err = connector.NewPlatformClient(origin, input.HTTPClient)
							if err == nil {
								preview, err := platform.PreviewInvite(ctx, code)
								if err == nil {
									name := preview.Account
									if preview.Profile != nil {
										name = preview.Profile.MemberName
									}
									access, confirmErr := confirmAccountAccess(ctx, origin, name, preview.Team)
									if preview.Profile != nil {
										access.Avatar = preview.Profile.Avatar
									}
									if confirmErr == nil {
										select {
										case events <- event{inviteCode: code, inviteOrigin: origin, access: access}:
											allowed = true
										case <-ctx.Done():
										}
									}
								} else {
									_, _ = dialog(ctx, "notice", inviteErrorLabel(err)+"\n\n当前平台："+origin, "")
								}
							}
						}
					}()
				case <-quit.ClickedCh:
					cancel()
				case <-shutdown:
					closing, shutdown = true, nil
					pause.Disable()
					stop.Hide()
					quit.Disable()

					statusItem.SetTitle("正在停止任务并退出…")
					if !running {
						otherWorkers.Wait()
						systray.Quit()
						return
					}
				}
			}
		}()
	}, cancel)
	return nil
}
