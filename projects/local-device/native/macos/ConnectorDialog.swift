import AppKit
import SwiftUI

private struct ConnectorLogo: View {
    private static let image = NSImage(contentsOf: Bundle.main.executableURL!
        .deletingLastPathComponent().appendingPathComponent("../Resources/Connector.icns"))

    var body: some View {
        Group {
            if let image = Self.image {
                Image(nsImage: image).resizable().scaledToFit()
            } else {
                Image(systemName: "desktopcomputer")
            }
        }
        .frame(width: 48, height: 48)
        .accessibilityHidden(true)
    }
}

struct DialogInput: Decodable {
    let mode: String
    let title: String
    let message: String
    let platform: String
    let initialWorkdir: String?
    let history: [String]?
    let testExecutable: String?
    let accounts: [AuthorizedAccount]?
    let selectedAccountID: String?
}

final class DialogController: NSObject, NSApplicationDelegate, NSWindowDelegate {
    var window: NSWindow?
    let input: DialogInput
    init(_ input: DialogInput) { self.input = input }
    func applicationDidFinishLaunching(_ notification: Notification) {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: input.mode == "settings" ? 520 : input.mode == "pairApprove" ? 480 : 520, height: input.mode == "invite" ? 370 : input.mode == "settings" ? 390 : input.mode == "pairApprove" ? 410 : 580), styleMask: [.titled, .closable, .fullSizeContentView], backing: .buffered, defer: false)
        window.title = input.title
        window.titlebarAppearsTransparent = true
        window.isReleasedWhenClosed = false
        window.delegate = self
        if ["authorizations", "settings", "invite"].contains(input.mode) {
            window.styleMask.insert(.resizable)
            window.contentMinSize = NSSize(width: 560, height: 480)
            window.setContentSize(NSSize(width: 560, height: 480))
            window.contentView = NSHostingView(rootView: ConnectionWorkspace(input: input))
        } else {
            window.contentView = NSHostingView(rootView: ApprovalCard(input: input))
        }
        DistributedNotificationCenter.default().addObserver(forName: Notification.Name("tech.asiainfo.connector.raise-window"), object: String(ProcessInfo.processInfo.processIdentifier), queue: .main) { [weak self] _ in
            self?.window?.deminiaturize(nil)
            self?.window?.orderFrontRegardless()
            self?.window?.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
        if ["accountApprove", "pairApprove"].contains(input.mode) {
            window.level = .floating
            window.orderFrontRegardless()
        }
        window.center()
        window.makeKeyAndOrderFront(nil)
        self.window = window
        NSApp.activate(ignoringOtherApps: true)
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window?.deminiaturize(nil)
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        return true
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool { finish(nil); return false }
}

func finish(_ value: String?) {
    if let value = value { FileHandle.standardOutput.write(Data(value.utf8)); Darwin.exit(0) }
    Darwin.exit(2)
}


/** 时间线驱动连接动画，避免窗口显示前 onAppear 已结束导致看不到动态效果。 */
struct ConnectionMotion: View {
    let still: Bool
    let approved: Bool
    var previewPhase: Double? = nil
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: still)) { timeline in
            let phase = previewPhase ?? (still ? 0.0 : timeline.date.timeIntervalSinceReferenceDate)
            let stationary = still && previewPhase == nil
            HStack(spacing: 18) {
                Image(systemName: "laptopcomputer").font(.system(size: 28, weight: .medium))
                    .frame(width: 64, height: 64).background(Color.blue.opacity(0.08)).cornerRadius(18)
                HStack(spacing: 7) {
                    ForEach(0..<3) { index in
                        Circle().fill(approved ? Color.green : Color.blue)
                            .frame(width: 6, height: 6)
                            .opacity(stationary || approved ? 1 : 0.25 + (sin(phase * 4 - Double(index) * 1.2) + 1) * 0.375)
                            .offset(y: still || approved ? 0 : sin(phase * 4 - Double(index) * 1.2) * 3)
                    }
                }
                Image(systemName: approved ? "checkmark.shield.fill" : "globe")
                    .font(.system(size: 27, weight: .medium)).foregroundColor(approved ? .green : .blue)
                    .frame(width: 64, height: 64).background(Color.blue.opacity(0.08)).cornerRadius(18)
            }.foregroundColor(.blue)
        }.frame(height: 64)
        .accessibilityLabel(approved ? "已确认" : "等待你确认连接")
    }
}

struct ConfirmButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.system(size: 13, weight: .semibold))
            .padding(.horizontal, 20).frame(height: 36)
            .foregroundColor(.white).background(Color.blue).cornerRadius(10)
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

struct ApprovalCard: View {
    let input: DialogInput
    var preview = false
    var previewPhase: Double? = nil
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false
    @State private var approved = false
    @State private var folder = ""
    init(input: DialogInput, preview: Bool = false, previewPhase: Double? = nil) {
        self.input = input
        self.preview = preview
        self.previewPhase = previewPhase
        _folder = State(initialValue: ["approve", "accountApprove"].contains(input.mode) ? input.initialWorkdir ?? "" : "")
    }
    /** 用户可沿用已有目录；仅在主动更换或目录失效时打开选择器，取消保留原值。 */
    private func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true; panel.canChooseFiles = false
        panel.allowsMultipleSelection = false; panel.prompt = "选择目录"
        if !folder.isEmpty { panel.directoryURL = URL(fileURLWithPath: folder, isDirectory: true) }
        if panel.runModal() == .OK { folder = panel.url?.path ?? "" }
    }
    private var hasValidFolder: Bool {
        var directory: ObjCBool = false
        return FileManager.default.fileExists(atPath: folder, isDirectory: &directory) && directory.boolValue
    }
    private var accountApproval: Bool { input.mode == "accountApprove" }
    private var pairing: Bool { input.mode == "pairApprove" }
    private var messageContent: some View {
        Text(input.message).font(.system(size: 12)).lineSpacing(4)
            .frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled).padding(14)
    }
    var body: some View {
        VStack(spacing: 16) {
            ConnectionMotion(still: preview || reduceMotion, approved: approved, previewPhase: previewPhase)
            VStack(spacing: 7) {
                Text(approved ? "已确认，正在返回聊天" : pairing ? "连接这台电脑" : accountApproval ? "允许此用户长期访问？" : "允许对话执行本机任务？")
                    .font(.system(size: 22, weight: .semibold))
                Text(pairing ? "将电脑绑定到当前平台账号，继续在聊天中使用。" : accountApproval ? "此用户的新会话可执行命令，并读取、修改本机文件。" : "此对话将能够执行命令，并读取、修改本机文件。")
                    .font(.system(size: 13)).foregroundColor(.secondary).multilineTextAlignment(.center)
            }
            if pairing {
                HStack(spacing: 12) {
                    Image(systemName: "globe").font(.system(size: 19)).foregroundColor(.blue)
                    VStack(alignment: .leading, spacing: 5) {
                        Text("请求绑定的平台").font(.system(size: 11)).foregroundColor(.secondary)
                        Text(input.platform).font(.system(size: 14, weight: .medium))
                            .textSelection(.enabled).lineLimit(2)
                    }
                    Spacer(minLength: 0)
                }.padding(16).frame(maxWidth: .infinity)
                    .background(Color.blue.opacity(0.05)).cornerRadius(12)
                Label("绑定后可在本机「已授权用户」中启用长期访问。", systemImage: "checkmark.shield")
                    .font(.system(size: 12)).foregroundColor(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Group {
                    if preview { messageContent } else { ScrollView { messageContent } }
                }.frame(height: 170).background(Color.blue.opacity(0.04)).cornerRadius(12)
                Button(action: {
                    chooseFolder()
                }) {
                    HStack(spacing: 12) {
                        Image(systemName: folder.isEmpty ? "folder.badge.plus" : "folder.fill")
                            .font(.system(size: 22)).foregroundColor(.blue)
                            .frame(width: 40, height: 40)
                            .background(Color.blue.opacity(0.08)).cornerRadius(10)
                        VStack(alignment: .leading, spacing: 5) {
                            HStack(spacing: 6) {
                                Text(folder.isEmpty ? "请选择工作文件夹" : "工作文件夹")
                                    .font(.system(size: 13, weight: .semibold)).foregroundColor(.primary)
                                if folder.isEmpty {
                                    Text("必选").font(.system(size: 10, weight: .medium))
                                        .foregroundColor(.blue).padding(.horizontal, 5).padding(.vertical, 2)
                                        .background(Color.blue.opacity(0.08)).cornerRadius(4)
                                }
                            }
                            Text(folder.isEmpty ? "选择后即可允许执行" : folder)
                                .font(.system(size: 11)).foregroundColor(.secondary)
                                .lineLimit(2).truncationMode(.middle).help(folder)
                        }
                        Spacer(minLength: 6)
                        Text(folder.isEmpty ? "选择文件夹" : "更换")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(folder.isEmpty ? .white : .blue)
                            .padding(.horizontal, 12).frame(height: 32)
                            .background(folder.isEmpty ? Color.blue : Color.blue.opacity(0.08)).cornerRadius(8)
                    }.padding(14).contentShape(Rectangle())
                }.buttonStyle(.plain)
                    .background(Color.blue.opacity(0.035)).cornerRadius(12)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.blue.opacity(folder.isEmpty ? 0.4 : 0.15), lineWidth: 1))
                    .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: folder.isEmpty)
                Text("工作目录不是访问限制；命令将以当前系统用户的权限运行。")
                    .font(.system(size: 11)).foregroundColor(.secondary)
            }
            Spacer(minLength: 0)
            HStack(spacing: 10) {
                Label(accountApproval ? "本机授权管理" : "由聊天页面发起", systemImage: "lock.fill")
                    .font(.system(size: 11)).foregroundColor(.secondary)
                Spacer()
                Button("取消") { finish(nil) }.keyboardShortcut(.cancelAction).disabled(approved)
                Button(approved ? "已确认" : pairing ? "确认绑定" : "允许执行") {
                    guard !approved else { return }
                    // 确认无需先更换目录；没有可用目录时才要求选择。
                    if !pairing && !hasValidFolder {
                        chooseFolder()
                        guard hasValidFolder else { return }
                    }
                    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { approved = true }
                    DispatchQueue.main.asyncAfter(deadline: .now() + (reduceMotion ? 0 : 0.45)) {
                        finish(pairing ? "confirmed" : folder)
                    }
                }.keyboardShortcut(.defaultAction)
                    .buttonStyle(ConfirmButtonStyle()).disabled(approved)
            }
        }.padding(26).padding(.top, 12)
            .background(Color(nsColor: .windowBackgroundColor))
            .opacity(preview || appeared ? 1 : 0).offset(y: preview || appeared ? 0 : 12)
            .onAppear {
                guard !preview else { return }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
                    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.35)) { appeared = true }
                }
            }
    }
}

struct AuthorizedAccount: Decodable, Identifiable {
    let id: String
    let name: String
    let team: String
    let platform: String
    let avatar: String?
    let state: String
    let workdir: String?
    let sessions: [SessionAuthorization]?
    let historyUnavailable: Bool?

    var status: String {
        switch state {
        case "active": return "已授权"
        case "paused": return "已暂停"
        default: return "按会话授权"
        }
    }
}

struct SessionAuthorization: Decodable, Identifiable {
    let id: String
    let title: String
    let app: String
    let workdir: String
    let status: String
}

struct AuthorizationCard: View {
    let input: DialogInput
    var preview = false
    var onAdd: () -> Void = {}
    @Environment(\.colorScheme) private var colorScheme
    @FocusState private var searchFocused: Bool
    @State private var selected: AuthorizedAccount?
    @State private var search = ""
    @State private var removal: AuthorizedAccount?
    @Binding var updatedAccounts: [AuthorizedAccount]?
    @State private var updating = false
    @State private var actionError = ""
    private var accounts: [AuthorizedAccount] { updatedAccounts ?? input.accounts ?? [] }

    /** 等待控制器持久化授权后再更新界面，失败时保持窗口并允许重试。 */
    private func toggleAuthorization(_ account: AuthorizedAccount) {
        guard !updating else { return }
        updating = true
        actionError = ""
        let action = (account.state == "paused" ? "resume:" : "pause:") + account.id
        FileHandle.standardOutput.write(Data(("__connector_account__:" + action + "\n").utf8))
        DispatchQueue.global().async {
            struct Response: Decodable { let accounts: [AuthorizedAccount]; let error: String }
            let pipe = FileHandle(fileDescriptor: 3, closeOnDealloc: false)
            var data = Data()
            while !data.contains(10) {
                let chunk = pipe.availableData
                if chunk.isEmpty { break }
                data.append(chunk)
            }
            let response = try? JSONDecoder().decode(Response.self, from: data)
            DispatchQueue.main.async {
                updating = false
                if let response {
                    updatedAccounts = response.accounts
                    actionError = response.error
                } else {
                    actionError = "未能更新授权，请关闭窗口后重试"
                }
            }
        }
    }

    var body: some View {
        Group {
            if let selected {
                AccountAuthorizationDetails(account: selected, onBack: { self.selected = nil })
            } else {
                accountList
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .disabled(updating)
        .alert("授权更新失败", isPresented: Binding(get: { !actionError.isEmpty }, set: { if !$0 { actionError = "" } })) {
            Button("确定") { actionError = "" }
        } message: { Text(actionError) }
        .onAppear { selected = accounts.first { $0.id == input.selectedAccountID } }
        .background(colorScheme == .dark ? Color(nsColor: .windowBackgroundColor) : Color(red: 0.96, green: 0.97, blue: 0.99))
    }

    private var accountList: some View {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        let visible = accounts.filter {
            query.isEmpty || [$0.name, $0.team, $0.platform].contains { $0.localizedStandardContains(query) }
        }
        return VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                ConnectorLogo()
                VStack(alignment: .leading, spacing: 5) {
                    Text("已授权用户").font(.system(size: 22, weight: .semibold))
                    Text("管理谁可以使用这台电脑").font(.system(size: 12)).foregroundColor(.secondary)
                }
                Spacer()
                Button(action: onAdd) {
                    Label("添加授权", systemImage: "plus")
                }.buttonStyle(ConfirmButtonStyle())
            }
            HStack(spacing: 9) {
                Image(systemName: "magnifyingglass").foregroundColor(.secondary)
                TextField("搜索使用者姓名、团队或平台", text: $search)
                    .textFieldStyle(.plain).focused($searchFocused)
                if !search.isEmpty {
                    Button { search = "" } label: {
                        Image(systemName: "xmark.circle.fill").foregroundColor(.secondary)
                    }.buttonStyle(.plain).accessibilityLabel("清除搜索")
                }
                Text("\(visible.count) / \(accounts.count)").foregroundColor(.secondary)
            }.font(.system(size: 12)).padding(.horizontal, 12).frame(height: 38)
                .background(Color(nsColor: .textBackgroundColor)).cornerRadius(10)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(searchFocused ? Color.blue.opacity(0.65) : Color.gray.opacity(0.24)))
            if visible.isEmpty {
                Text(accounts.isEmpty ? "还没有已绑定用户" : "没有匹配的用户")
                    .foregroundColor(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(visible) { account in
                            HStack(spacing: 10) {
                                AccountAvatar(account: account)
                                Button { selected = account } label: {
                                    VStack(alignment: .leading, spacing: 5) {
                                        HStack(spacing: 6) {
                                            Text(account.name).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                                            Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold))
                                        }.foregroundColor(.blue)
                                        Text([account.team, account.platform].filter { !$0.isEmpty }.joined(separator: " · "))
                                            .font(.system(size: 11)).foregroundColor(.secondary).lineLimit(1)
                                    }.contentShape(Rectangle())
                                }.buttonStyle(.plain).help("查看会话授权")
                                Spacer()
                                Text(account.status).font(.system(size: 10, weight: .medium))
                                    .foregroundColor(account.state == "active" ? .green : .secondary)
                                    .padding(.horizontal, 7).padding(.vertical, 4)
                                    .background((account.state == "active" ? Color.green : Color.gray).opacity(0.10))
                                    .clipShape(Capsule())
                                if account.state == "legacy" {
                                    Button("启用授权") { finish("enable:" + account.id) }
                                }
                                Button(account.state == "paused" ? "恢复" : "暂停") {
                                    toggleAuthorization(account)
                                }
                                Button("移除") { removal = account }
                            }.buttonStyle(.bordered).controlSize(.small).padding(12)
                                .background(Color(nsColor: .textBackgroundColor)).cornerRadius(12)
                                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.gray.opacity(0.18)))
                                .shadow(color: .black.opacity(0.035), radius: 4, x: 0, y: 2)
                        }
                    }
                }.frame(maxHeight: .infinity)
            }
            HStack {
                Text(input.title).font(.system(size: 10)).foregroundColor(.secondary)
                Spacer()
                Button("完成") { finish(nil) }.keyboardShortcut(.cancelAction)
            }
        }.padding(28).padding(.top, 10)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .alert("移除用户授权？", isPresented: Binding(get: { removal != nil }, set: { if !$0 { removal = nil } })) {
                Button("取消", role: .cancel) { removal = nil }
                Button("移除", role: .destructive) { if let user = removal { finish("remove:" + user.id) } }
            } message: { Text("该用户的任务将停止。再次使用需重新添加授权。") }
    }
}

/** 头像加载只允许平台自身和飞书头像 CDN，不跟随跨域跳转。 */
private final class AvatarRedirectGuard: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        let source = task.originalRequest?.url
        let target = request.url
        let sameOrigin = source?.scheme == target?.scheme && source?.host == target?.host && source?.port == target?.port
        completionHandler(sameOrigin ? request : nil)
    }
}

struct AccountAvatar: View {
    let account: AuthorizedAccount
    @State private var photo: NSImage?

    private var avatarURL: URL? {
        guard let path = account.avatar else { return nil }
        if let url = URL(string: path), url.scheme == "https", url.host == "s3-imfile.feishucdn.com",
           url.port == nil, url.user == nil, url.password == nil, url.fragment == nil {
            return url
        }
        guard path.hasPrefix("/imgs/avatar/") || path.hasPrefix("/api/system/img/"),
              let base = URL(string: account.platform),
              let url = URL(string: path, relativeTo: base)?.absoluteURL,
              url.host == base.host, url.scheme == base.scheme, url.port == base.port else { return nil }
        return url
    }

    var body: some View {
        Group {
            if let photo {
                Image(nsImage: photo).resizable().scaledToFill()
            } else {
                Text(String(account.name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(1)).uppercased())
                    .font(.system(size: 15, weight: .semibold)).foregroundColor(.blue)
            }
        }
        .frame(width: 36, height: 36)
        .background(Color.blue.opacity(0.10)).clipShape(RoundedRectangle(cornerRadius: 10))
        .accessibilityHidden(true)
        .task(id: avatarURL) {
            photo = nil
            guard let avatarURL else { return }
            var request = URLRequest(url: avatarURL, timeoutInterval: 8)
            request.httpShouldHandleCookies = false
            do {
                let (bytes, response) = try await URLSession.shared.bytes(for: request, delegate: AvatarRedirectGuard())
                guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                      http.mimeType?.hasPrefix("image/") == true else { return }
                let limit = 5 * 1024 * 1024
                guard response.expectedContentLength <= limit else { return }
                var data = Data()
                for try await byte in bytes {
                    guard data.count < limit else { return }
                    data.append(byte)
                }
                if !Task.isCancelled { photo = NSImage(data: data) }
            } catch { /* Keep the name initial when an avatar cannot be loaded. */ }
        }
    }
}

struct AccountAuthorizationDetails: View {
    let account: AuthorizedAccount
    let onBack: () -> Void

    @State private var pendingAction: String?
    @State private var pendingSession: String?

    private var sessions: [SessionAuthorization] { account.sessions ?? [] }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Button(action: onBack) { Label("已授权用户", systemImage: "chevron.left") }
                .buttonStyle(.plain).foregroundColor(.accentColor).keyboardShortcut(.cancelAction)

            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    AccountAvatar(account: account)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(account.name).font(.system(size: 21, weight: .semibold))
                        Text([account.team, account.platform].filter { !$0.isEmpty }.joined(separator: " · "))
                            .font(.system(size: 12)).foregroundColor(.secondary)
                    }
                    Spacer()
                    let tint: Color = account.state == "active" ? .green : account.state == "paused" ? .orange : .blue
                    Label(account.status, systemImage: "circle.fill")
                        .font(.system(size: 11, weight: .medium)).foregroundColor(tint)
                        .padding(.horizontal, 9).padding(.vertical, 5)
                        .background(tint.opacity(0.1), in: Capsule())
                }
                if let directory = account.workdir, !directory.isEmpty {
                    Divider()
                    HStack(spacing: 8) {
                        Label("默认目录", systemImage: "folder").foregroundColor(.secondary)
                        Text(directory).lineLimit(1).truncationMode(.middle).help(directory).textSelection(.enabled)
                    }.font(.system(size: 12))
                }
            }.padding(14)
                .background(Color(nsColor: .textBackgroundColor), in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.primary.opacity(0.08)))

            HStack(spacing: 8) {
                Text("会话授权").font(.system(size: 14, weight: .semibold))
                if account.historyUnavailable != true {
                    Text(sessions.count.formatted()).font(.system(size: 11, weight: .medium))
                        .foregroundColor(.secondary).padding(.horizontal, 7).padding(.vertical, 3)
                        .background(Color.primary.opacity(0.06), in: Capsule())
                }
            }
            if account.historyUnavailable == true || sessions.isEmpty {
                let unavailable = account.historyUnavailable == true
                VStack(spacing: 9) {
                    Image(systemName: unavailable ? "exclamationmark.shield" : "checkmark.shield")
                        .font(.system(size: 26, weight: .light)).foregroundColor(.accentColor)
                    Text(unavailable ? "暂时无法读取会话授权" : "暂无会话授权")
                        .font(.system(size: 13, weight: .medium))
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(sessions) { session in
                            sessionCard(session)
                        }
                    }
                }.frame(maxHeight: .infinity)
            }
            Divider()
            HStack {
                Spacer()
                Button {
                    pendingSession = nil
                    pendingAction = "remove:" + account.id
                } label: {
                    Label("撤销账号授权", systemImage: "person.crop.circle.badge.minus")
                }.buttonStyle(.bordered).foregroundColor(.red)
            }
        }.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .alert(pendingSession == nil ? "撤销账号授权？" : "撤销会话授权？",
                   isPresented: Binding(get: { pendingAction != nil }, set: { if !$0 { pendingAction = nil } })) {
                Button("取消", role: .cancel) { pendingAction = nil }
                Button("撤销", role: .destructive) { if let action = pendingAction { finish(action) } }
            } message: {
                if let session = pendingSession {
                    Text("「" + session + "」将停止使用本机。该账号的其他会话授权保留。")
                } else {
                    Text("该账号的全部会话将停止使用本机。再次使用需要重新添加授权。")
                }
            }
    }

    private func sessionCard(_ session: SessionAuthorization) -> some View {
        HStack(alignment: .center, spacing: 11) {
            Image(systemName: "bubble.left")
                .font(.system(size: 14)).foregroundColor(.accentColor)
                .frame(width: 34, height: 34)
                .background(Color.accentColor.opacity(0.08), in: RoundedRectangle(cornerRadius: 9))
            VStack(alignment: .leading, spacing: 5) {
                Text(session.title).font(.system(size: 13, weight: .semibold)).lineLimit(1).help(session.title)
                if !session.app.isEmpty {
                    Text(session.app).font(.system(size: 11)).foregroundColor(.secondary)
                }
                if !session.workdir.isEmpty {
                    Label {
                        Text(session.workdir).lineLimit(1).truncationMode(.middle)
                    } icon: {
                        Image(systemName: "folder")
                    }.font(.system(size: 11)).foregroundColor(.secondary)
                        .help(session.workdir).textSelection(.enabled)
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 10) {
                Text(session.status).font(.system(size: 11))
                    .foregroundColor(session.status == "已授权" ? .green : .secondary)
                if session.status == "已授权" || session.status == "已暂停" {
                    Button("撤销会话") {
                        pendingSession = session.title
                        pendingAction = "revoke-session:" + session.id + ":" + account.id
                    }.buttonStyle(.bordered).controlSize(.small)
                }
            }.fixedSize(horizontal: true, vertical: false)
        }.padding(12)
            .background(Color(nsColor: .textBackgroundColor), in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color.primary.opacity(0.08)))
    }

}

struct PlatformAddressPicker: View {
    @Binding var address: String
    @Binding var adding: Bool
    let history: [String]
    @State private var expanded = false

    private var addresses: [String] {
        let standard = "https://chat.asiainfo.tech"
        return [standard] + history.filter { !$0.isEmpty && $0 != standard }
    }

    var body: some View {
        Button { expanded.toggle() } label: {
            HStack(spacing: 10) {
                Image(systemName: "globe").font(.system(size: 13)).foregroundColor(.blue)
                Text(adding ? "选择平台地址" : address)
                    .font(.system(size: 13)).foregroundColor(.primary)
                    .lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 8)
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .semibold)).foregroundColor(.secondary)
            }
            .padding(.horizontal, 12)
            .frame(height: 36)
            .background(Color.white)
            .cornerRadius(9)
            .overlay(RoundedRectangle(cornerRadius: 9).stroke(expanded ? Color.blue.opacity(0.5) : Color.gray.opacity(0.2)))
        }
        .buttonStyle(.plain)
        .popover(isPresented: $expanded, arrowEdge: .bottom) {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(addresses, id: \.self) { value in
                    Button {
                        address = value
                        adding = false
                        expanded = false
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: value == "https://chat.asiainfo.tech" ? "globe" : "clock")
                                .font(.system(size: 14)).foregroundColor(.blue)
                                .frame(width: 20)
                            VStack(alignment: .leading, spacing: 3) {
                                if value == "https://chat.asiainfo.tech" {
                                    Text("腾云平台").font(.system(size: 13, weight: .medium))
                                    Text("chat.asiainfo.tech").font(.system(size: 11)).foregroundColor(.secondary)
                                } else {
                                    Text(value).font(.system(size: 13))
                                }
                            }
                            Spacer(minLength: 8)
                            if address == value {
                                Image(systemName: "checkmark").font(.system(size: 12, weight: .semibold)).foregroundColor(.blue)
                            }
                        }
                        .foregroundColor(.primary)
                        .padding(.horizontal, 10).padding(.vertical, 10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(address == value ? Color.blue.opacity(0.07) : Color.clear)
                        .cornerRadius(8)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(8)
            .frame(width: 310)
        }
    }
}

/** 所有管理操作在同一个 NSWindow 中导航，输入和测试状态在返回列表后保留。 */
struct ConnectionWorkspace: View {
    let input: DialogInput
    @State private var updatedAccounts: [AuthorizedAccount]?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var page = "list"
    @State private var link = ""
    @State private var address = ""
    @State private var addingAddress = false
    @State private var testing = false
    @State private var feedback = ""
    @State private var passed = false
    @FocusState private var linkFocused: Bool

    init(input: DialogInput) {
        self.input = input
        _page = State(initialValue: input.mode == "settings" ? "settings" : input.mode == "invite" ? "add" : "list")
        _address = State(initialValue: input.platform)
    }
    private func navigate(_ destination: String) {
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) { page = destination }
    }
    private func submit(_ action: String, _ value: String) {
        finish(input.mode == "authorizations" ? action + ":" + value : value)
    }
    private var parsedLink: (platform: String, code: String)? {
        let value = link.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.range(of: "^[A-Fa-f0-9]{20}$", options: .regularExpression) != nil {
            return (input.platform, value.uppercased())
        }
        guard let url = URLComponents(string: value), ["http", "https"].contains(url.scheme ?? ""),
              url.host != nil, url.user == nil, url.password == nil, url.query == nil,
              ["/account/devices", "/connector"].contains(url.path), let fragment = url.fragment,
              let items = URLComponents(string: "?" + fragment)?.queryItems,
              items.count == 1, items[0].name == "connect", let code = items[0].value,
              code.range(of: "^[A-Fa-f0-9]{20}$", options: .regularExpression) != nil else { return nil }
        var origin = url
        origin.path = ""; origin.fragment = nil
        guard let platform = origin.string else { return nil }
        return (platform, code.uppercased())
    }
    private func testConnection(saveOnSuccess: Bool = false) {
        guard let executable = input.testExecutable, !testing else { return }
        let target = address.trimmingCharacters(in: .whitespacesAndNewlines)
        testing = true; passed = false; feedback = ""
        DispatchQueue.global(qos: .userInitiated).async {
            let process = Process(), output = Pipe()
            process.executableURL = URL(fileURLWithPath: executable)
            process.arguments = ["--test-platform", target]
            process.standardOutput = output; process.standardError = FileHandle.nullDevice
            var success = false, message = "无法完成测试，请重试"
            do {
                try process.run()
                let data = output.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                success = process.terminationStatus == 0
                let code = String(data: data, encoding: .utf8) ?? ""
                let errors = [
                    "invalid_platform_origin": "请输入完整的 HTTP 或 HTTPS 地址",
                    "platform_host_unreachable": "无法到达平台，请检查网络及代理规则",
                    "platform_connection_refused": "端口拒绝连接，请确认平台服务已启动",
                    "platform_connection_timeout": "连接超时，请检查地址、网络及代理",
                    "platform_dns_failed": "域名解析失败，请检查域名和 DNS",
                    "platform_certificate_invalid": "HTTPS 证书校验失败",
                    "platform_permission_denied": "系统拒绝网络访问，请检查本地网络权限",
                    "platform_connector_unavailable": "平台尚未启用连接器服务"
                ]
                message = success ? "连接正常" : errors[code] ?? "无法访问平台，请检查地址和网络"
            } catch {}
            DispatchQueue.main.async {
                testing = false; passed = success; feedback = message
                if success && saveOnSuccess {
                    submit("settings", target)
                }
            }
        }
    }
    var body: some View {
        ZStack {
            Color(red: 0.98, green: 0.985, blue: 0.995)
            if page == "list" {
                AuthorizationCard(input: input, onAdd: { navigate("add") }, updatedAccounts: $updatedAccounts)
                    .transition(.opacity.combined(with: .offset(x: -12)))
            } else {
                VStack(alignment: .leading, spacing: 22) {
                    Button { navigate("list") } label: {
                        Label("授权管理", systemImage: "chevron.left")
                            .font(.system(size: 12, weight: .medium))
                    }.buttonStyle(.plain).foregroundColor(.secondary).disabled(testing)
                    HStack(spacing: 12) {
                        ConnectorLogo()
                        VStack(alignment: .leading, spacing: 5) {
                            Text(page == "add" ? "添加授权" : "连接设置").font(.system(size: 22, weight: .semibold))
                            Text(page == "add" ? "粘贴浏览器中复制的授权链接" : "保存时自动检查平台连接")
                                .font(.system(size: 12)).foregroundColor(.secondary)
                        }
                    }
                    if page == "add" {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("授权链接").font(.system(size: 12, weight: .medium))
                            TextField("粘贴链接或授权码", text: $link)
                                .textFieldStyle(.plain).font(.system(size: 13))
                                .focused($linkFocused).padding(14).frame(height: 64)
                                .background(Color.white).cornerRadius(12)
                                .overlay(RoundedRectangle(cornerRadius: 12).stroke(linkFocused ? Color.blue.opacity(0.5) : Color.gray.opacity(0.18)))
                            if let parsed = parsedLink {
                                VStack(alignment: .leading, spacing: 14) {
                                    Label(parsed.platform, systemImage: "globe")
                                    Divider()
                                    Label(parsed.code, systemImage: "key.horizontal")
                                }.font(.system(size: 12)).padding(16).frame(maxWidth: .infinity, alignment: .leading)
                                    .background(Color.white).cornerRadius(12)
                                    .transition(.opacity.combined(with: .offset(y: 5)))
                            } else if !link.isEmpty {
                                Text("链接格式不正确，请复制完整的授权链接")
                                    .font(.system(size: 12)).foregroundColor(.orange)
                            }
                        }.animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: parsedLink != nil)
                    } else {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("平台地址").font(.system(size: 12, weight: .medium))
                            HStack(spacing: 10) {
                                PlatformAddressPicker(address: $address, adding: $addingAddress, history: Array(Set([input.platform] + (input.history ?? []))).sorted())
                                Button { addingAddress = true; address = "" } label: { Image(systemName: "plus").frame(width: 22, height: 22) }
                                    .help("添加平台地址")
                            }
                            if addingAddress {
                                TextField("http://IP:端口 或 https://域名", text: $address)
                                    .textFieldStyle(.plain).padding(14).background(Color.white).cornerRadius(10)
                                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.blue.opacity(0.25)))
                            }
                            if !feedback.isEmpty {
                                Label(feedback, systemImage: passed ? "checkmark.circle.fill" : "exclamationmark.circle")
                                    .font(.system(size: 12)).foregroundColor(passed ? .green : .orange)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }.disabled(testing).onChange(of: address) { _ in feedback = ""; passed = false }
                    }
                    Spacer(minLength: 0)
                    Divider()
                    HStack(spacing: 12) {
                        if page == "settings" {
                            Button(action: { testConnection() }) {
                                HStack(spacing: 6) {
                                    if testing { ProgressView().controlSize(.small) }
                                    Text(testing ? "测试中…" : "测试连接")
                                }
                            }.disabled(testing || address.isEmpty)
                        }
                        Spacer()
                        Button("返回") { navigate("list") }.keyboardShortcut(.cancelAction).disabled(testing)
                        if page == "add" {
                            Button("继续") {
                                if let parsed = parsedLink { submit("invite", parsed.platform + "/account/devices#connect=" + parsed.code) }
                            }.buttonStyle(ConfirmButtonStyle()).disabled(parsedLink == nil)
                        } else {
                            Button(testing ? "正在检查连接…" : "保存并连接") { testConnection(saveOnSuccess: true) }
                                .buttonStyle(ConfirmButtonStyle())
                                .disabled(testing || address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                    }
                }.padding(28).padding(.top, 10)
                    .transition(.opacity.combined(with: .offset(x: 12)))
            }
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
            .onChange(of: page) { destination in linkFocused = destination == "add" }
    }
}

/** Native helper windows need an Edit menu so Command shortcuts follow the responder chain. */
@MainActor
func installEditingMenu() {
    let mainMenu = NSMenu()
    let editItem = NSMenuItem()
    let editMenu = NSMenu(title: "编辑")
    let actions: [(String, Selector, String)] = [
        ("撤销", Selector(("undo:")), "z"),
        ("剪切", #selector(NSText.cut(_:)), "x"),
        ("复制", #selector(NSText.copy(_:)), "c"),
        ("粘贴", #selector(NSText.paste(_:)), "v"),
        ("全选", #selector(NSText.selectAll(_:)), "a")
    ]
    for (title, action, key) in actions {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.keyEquivalentModifierMask = .command
        editMenu.addItem(item)
    }
    editItem.submenu = editMenu
    mainMenu.addItem(editItem)
    NSApp.mainMenu = mainMenu
}

@main
struct Main {
    @MainActor static func main() {
        if CommandLine.arguments.count == 3 && CommandLine.arguments[1] == "--activate",
           let pid = Int32(CommandLine.arguments[2]) {
            NSRunningApplication(processIdentifier: pid)?.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
            return
        }
        let data = FileHandle.standardInput.readDataToEndOfFile()
        guard let input = try? JSONDecoder().decode(DialogInput.self, from: data),
              ["approve", "accountApprove", "pairApprove", "settings", "invite", "authorizations"].contains(input.mode) else { Darwin.exit(2) }
        #if DEBUG
        if CommandLine.arguments.count == 3 && CommandLine.arguments[1] == "--render-preview", #available(macOS 13.0, *) {
            if input.mode == "authorizations" {
                let host = NSHostingView(rootView: AuthorizationCard(input: input, preview: true, updatedAccounts: .constant(nil)))
                host.frame = NSRect(x: 0, y: 0, width: 560, height: 480)
                host.layoutSubtreeIfNeeded()
                if let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) {
                    host.cacheDisplay(in: host.bounds, to: bitmap)
                    if let png = bitmap.representation(using: .png, properties: [:]) {
                        try? png.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
                    }
                }
                return
            }
            let renderer = ImageRenderer(content: ApprovalCard(input: input, preview: true, previewPhase: ProcessInfo.processInfo.environment["DIALOG_PREVIEW_TIME"].flatMap(Double.init)).frame(width: input.mode == "pairApprove" ? 480 : 520, height: input.mode == "pairApprove" ? 410 : 580))
            renderer.scale = 2
            if let data = renderer.nsImage?.tiffRepresentation,
               let image = NSBitmapImageRep(data: data), let png = image.representation(using: .png, properties: [:]) {
                try? png.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
            }
            return
        }
        #endif
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        installEditingMenu()
        let delegate = DialogController(input)
        app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}
