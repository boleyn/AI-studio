# 管理页和授权页共用静态窗口样式，所有外部文字均作为控件数据赋值。
function Invoke-ManagementWindow {
    [xml]$layout = @'
<Grid xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" Margin="28">
 <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
 <StackPanel>
  <TextBlock Name="PageTitle" Text="已授权用户" FontSize="24" FontWeight="SemiBold"/>
  <TextBlock Name="PageSubtitle" Text="管理谁可以使用这台电脑" Foreground="#667085" Margin="0,8,0,22"/>
  <TextBlock Name="ConnectionStatus" Foreground="#344054" Margin="0,0,0,8" TextWrapping="Wrap"/>
  <TextBlock Text="连接器正在运行。如需连接，请回到网页点击「连接此电脑」；关闭此窗口后仍会在托盘运行。" Foreground="#667085" Margin="0,0,0,14" TextWrapping="Wrap"/>
  <Border Background="#EEF3FF" CornerRadius="12" Padding="14"><TextBlock Name="Platform" TextWrapping="Wrap"/></Border>
 </StackPanel>
 <Grid Grid.Row="1" Margin="0,20,0,20">
  <Grid Name="ListPage">
   <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
   <StackPanel Margin="0,0,0,10">
    <DockPanel Margin="0,0,0,10"><Button Name="Add" Content="添加授权" DockPanel.Dock="Right" Background="#366BFA" Foreground="White"/><Button Name="Refresh" Content="刷新" DockPanel.Dock="Right" Margin="0,0,8,0"/><TextBlock Name="ApprovalCount" FontWeight="SemiBold" VerticalAlignment="Center"/></DockPanel>
    <TextBlock Name="SearchLabel" Text="搜索使用者姓名、团队或平台" FontSize="12" Foreground="#667085" Margin="0,0,0,5"/>
    <TextBox Name="ApprovalSearch" AutomationProperties.Name="搜索使用者姓名、团队或平台" Padding="8"/>
   </StackPanel>
   <Grid Grid.Row="1">
    <TextBlock Name="Empty" TextWrapping="Wrap" Foreground="#667085" Margin="0,12"/>
    <ScrollViewer Name="ApprovalScroll" VerticalScrollBarVisibility="Auto"><StackPanel Name="Approvals"/></ScrollViewer>
   </Grid>
   <StackPanel Grid.Row="2">
    <DockPanel Name="ApprovalPages" Margin="0,8,0,0">
     <StackPanel DockPanel.Dock="Right" Orientation="Horizontal"><Button Name="PreviousApprovals" Content="上一页" Margin="0,0,8,0"/><Button Name="NextApprovals" Content="下一页"/></StackPanel>
     <TextBlock Name="ApprovalPage" Foreground="#667085" VerticalAlignment="Center"/>
    </DockPanel>
    <Border Name="RevokePanel" Visibility="Collapsed" Background="#FFF0EC" CornerRadius="10" Padding="14" Margin="0,10,0,0"><StackPanel><TextBlock Name="RevokeMessage" TextWrapping="Wrap"/><WrapPanel Margin="0,10,0,0"><Button Name="CancelRevoke" Content="取消" Margin="0,0,10,0"/><Button Name="ConfirmRevoke" Content="撤销授权" Foreground="#B42318"/></WrapPanel></StackPanel></Border>
   </StackPanel>
  </Grid>
  <Grid Name="AccountPage" Visibility="Collapsed">
   <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/></Grid.RowDefinitions>
   <StackPanel Margin="0,0,0,12">
    <DockPanel><Button Name="RevokeAccount" Content="撤销账号授权" DockPanel.Dock="Right" Foreground="#B42318"/><StackPanel DockPanel.Dock="Right" VerticalAlignment="Center"><TextBlock Name="AccountStatus" FontWeight="SemiBold"/></StackPanel><TextBlock Name="AccountName" FontSize="19" FontWeight="SemiBold"/></DockPanel>
    <TextBlock Name="AccountMeta" Foreground="#667085" TextWrapping="Wrap" Margin="0,5,0,8"/>
    <TextBlock Name="AccountDirectory" Foreground="#667085" TextWrapping="Wrap" Margin="0,0,0,8"/>
    <TextBlock Name="AccountHistoryTitle" Text="会话授权" FontWeight="SemiBold"/>
   </StackPanel>
   <ScrollViewer Grid.Row="1" Name="AccountScroll" VerticalScrollBarVisibility="Auto">
    <StackPanel Name="AccountHistory"/>
   </ScrollViewer>
  </Grid>
  <StackPanel Name="AddPage" Visibility="Collapsed">
   <TextBlock Text="粘贴网页“管理我的设备”生成的完整连接链接或连接码。" TextWrapping="Wrap" Foreground="#667085" Margin="0,0,0,14"/>
   <TextBox Name="Invite" MinHeight="96" TextWrapping="Wrap" AcceptsReturn="True" Padding="12" FontSize="14"/>
   <TextBlock Name="InviteFeedback" TextWrapping="Wrap" Foreground="#B42318" Margin="0,10,0,0"/>
   <TextBlock Text="添加时请核对用户、团队和平台，并确认长期命令执行权限。" TextWrapping="Wrap" Foreground="#667085" Margin="0,14,0,0"/>
  </StackPanel>
  <StackPanel Name="SettingsPage" Visibility="Collapsed">
   <TextBlock Text="平台地址" Margin="0,0,0,8"/>
   <ComboBox Name="Address" IsEditable="True" FontSize="14" Padding="8"/>
   <TextBlock Text="支持 HTTP 或 HTTPS；不需要填写网关地址。切换平台会停止当前任务。" TextWrapping="Wrap" Foreground="#667085" Margin="0,12,0,14"/>
   <Button Name="Test" Content="测试连接" HorizontalAlignment="Left"/>
   <TextBlock Name="Feedback" TextWrapping="Wrap" Foreground="#667085" Margin="0,12,0,0"/>
  </StackPanel>
 </Grid>
 <DockPanel Grid.Row="2">
  <Button Name="Submit" Content="添加授权" DockPanel.Dock="Right" Visibility="Collapsed" Background="#366BFA" Foreground="White" Margin="10,0,0,0"/>
  <Button Name="Settings" Content="连接设置" DockPanel.Dock="Left" Margin="0,0,12,0"/>
  <Button Name="Back" Content="完成" DockPanel.Dock="Right" HorizontalAlignment="Right"/>
  <TextBlock Name="Version" FontSize="10" Foreground="#8791A4" VerticalAlignment="Center"/>
 </DockPanel>
</Grid>
'@
    $root = [Windows.Markup.XamlReader]::Load([System.Xml.XmlNodeReader]::new($layout))
    $window.Content = $root
    $window.Width = 740
    $window.Height = 670
    $window.MinWidth = 680
    $window.MinHeight = 580
    $window.ResizeMode = 'CanResizeWithGrip'
    $window.SizeToContent = 'Manual'
    $ui = @{}
    foreach ($name in @('PageTitle','PageSubtitle','Platform','ListPage','AccountPage','AccountName','AccountStatus','RevokeAccount','AccountMeta','AccountDirectory','AccountHistoryTitle','AccountScroll','AccountHistory','AddPage','SettingsPage','Add','Empty','Approvals','ApprovalCount','SearchLabel','ApprovalSearch','ApprovalScroll','ApprovalPages','ApprovalPage','PreviousApprovals','NextApprovals','RevokePanel','RevokeMessage','CancelRevoke','ConfirmRevoke','Invite','InviteFeedback','Address','Test','Feedback','Submit','Back','Version','Settings')) { $ui[$name] = $root.FindName($name) }
    $ui.Platform.Text = $inputData.address
    $ui.ConnectionStatus = $root.FindName('ConnectionStatus')
    $ui.ConnectionStatus.Text = if ($inputData.connectionStatus) { '连接状态（打开时）：' + $inputData.connectionStatus } else { '连接器已启动' }
    $ui.Refresh = $root.FindName('Refresh')
    $ui.Version.Text = $inputData.productName
    $manager = @{ page = 'list'; result = $null; pending = ''; saveTarget = ''; process = $null; approvalPage = 0 }
    # 默认发行平台位于首位，当前地址和历史地址去重保留；Go 负责最终校验和保存。
    foreach ($address in @($inputData.defaultPlatform, $inputData.address) + @($inputData.history)) {
        if ($address -and !$ui.Address.Items.Contains([string]$address)) { [void]$ui.Address.Items.Add([string]$address) }
    }
    $ui.Address.Text = $inputData.address
    function Set-ManagementPage($page) {
        $manager.page = $page
        $ui.Settings.Visibility = if ($page -eq 'list') { 'Visible' } else { 'Collapsed' }
        $ui.PageSubtitle.Text = switch ($page) { 'list' { '管理谁可以使用这台电脑' } 'account' { '查看账号状态、默认目录及会话授权' } 'add' { '从网页复制连接链接，添加新的用户授权' } default { '测试平台连接并保存地址' } }
        $ui.RevokePanel.Visibility = 'Collapsed'
        $ui.AccountPage.Visibility = 'Collapsed'; $ui.ListPage.Visibility = 'Collapsed'; $ui.AddPage.Visibility = 'Collapsed'; $ui.SettingsPage.Visibility = 'Collapsed'
        $ui.Submit.Visibility = 'Visible'; $ui.Back.Content = '返回'
        if ($page -eq 'list') {
            $ui.ListPage.Visibility = 'Visible'; $ui.PageTitle.Text = '已授权用户'; $ui.Submit.Visibility = 'Collapsed'; $ui.Back.Content = '完成'
        } elseif ($page -eq 'account') {
            $ui.AccountPage.Visibility = 'Visible'; $ui.PageTitle.Text = '用户授权详情'; $ui.Submit.Visibility = 'Collapsed'
        } elseif ($page -eq 'add') {
            $ui.AddPage.Visibility = 'Visible'; $ui.PageTitle.Text = '添加授权'; $ui.Submit.Content = '继续连接'; $ui.Submit.IsEnabled = $true
            [void]$ui.Invite.Focus()
        } else {
            $ui.SettingsPage.Visibility = 'Visible'; $ui.PageTitle.Text = '连接设置'; $ui.Submit.Content = '保存并连接'
            $ui.Submit.IsEnabled = !$manager.process -and [bool]$ui.Address.Text.Trim()
        }
    }
    $manager.allApprovals = @($inputData.accounts | Where-Object { $_ })
    $ui.SearchLabel.Visibility = $ui.ApprovalSearch.Visibility = if ($manager.allApprovals.Count) { 'Visible' } else { 'Collapsed' }

    function Show-AccountDetails($account) {
        $ui.AccountName.Text = $account.name
        $ui.AccountStatus.Text = switch ($account.state) { 'active' { '已授权' } 'paused' { '已暂停' } default { '按会话授权' } }
        $ui.AccountStatus.Foreground = [Windows.Media.BrushConverter]::new().ConvertFromString($(if ($account.state -eq 'active') { '#16804A' } elseif ($account.state -eq 'paused') { '#B76A13' } else { '#366BFA' }))
        $ui.AccountHistoryTitle.Text = if ($account.historyUnavailable) { '会话授权' } else { '会话授权 · ' + @($account.sessions).Count }
        $ui.RevokeAccount.Tag = 'remove:' + $account.id
        $ui.AccountMeta.Text = @($account.team, $account.platform).Where({ $_ }) -join ' · '
        $ui.AccountDirectory.Text = if ($account.workdir) { '默认工作目录 · ' + $account.workdir } else { '按会话授权。已授权的会话仍可使用本机，新会话需要启用账号授权。' }
        $ui.AccountDirectory.ToolTip = $ui.AccountDirectory.Text
        $ui.AccountHistory.Children.Clear()
        $ui.AccountScroll.ScrollToTop()
        if ($account.historyUnavailable -or @($account.sessions).Count -eq 0) {
            $empty = [Windows.Controls.TextBlock]::new()
            $empty.Text = if ($account.historyUnavailable) { '暂时无法读取会话授权。' } else { '暂无会话授权记录' }
            [void]$ui.AccountHistory.Children.Add($empty)
        } else {
            foreach ($session in $account.sessions) {
                $heading = [Windows.Controls.TextBlock]::new()
                $heading.FontWeight = 'SemiBold'
                $heading.Text = $session.title
                $heading.ToolTip = $session.title
                $heading.TextTrimming = 'CharacterEllipsis'
                $folder = [Windows.Controls.TextBlock]::new()
                $folder.Text = @($session.app, $(if ($session.workdir) { $session.workdir } else { '未记录工作目录' })).Where({ $_ }) -join ' · '
                $folder.TextTrimming = 'CharacterEllipsis'
                $folder.ToolTip = $folder.Text
                $content = [Windows.Controls.StackPanel]::new()
                $content.VerticalAlignment = 'Center'
                [void]$content.Children.Add($heading)
                [void]$content.Children.Add($folder)
                $card = [Windows.Controls.Border]::new()
                $card.Background = [Windows.Media.Brushes]::White
                $card.BorderBrush = [Windows.Media.Brushes]::LightGray
                $card.BorderThickness = [Windows.Thickness]::new(1)
                $card.Padding = [Windows.Thickness]::new(10)
                $card.Margin = [Windows.Thickness]::new(0,0,0,8)
                $card.CornerRadius = [Windows.CornerRadius]::new(8)
                $row = [Windows.Controls.Grid]::new()
                $flex = [Windows.Controls.ColumnDefinition]::new()
                [void]$row.ColumnDefinitions.Add($flex)
                $fixed = [Windows.Controls.ColumnDefinition]::new(); $fixed.Width = [Windows.GridLength]::Auto
                [void]$row.ColumnDefinitions.Add($fixed)
                $actions = [Windows.Controls.StackPanel]::new()
                $actions.Orientation = 'Horizontal'; $actions.VerticalAlignment = 'Center'
                $actions.Margin = [Windows.Thickness]::new(12,0,0,0)
                $status = [Windows.Controls.TextBlock]::new()
                $status.Text = $session.status; $status.VerticalAlignment = 'Center'
                $status.Margin = [Windows.Thickness]::new(0,0,10,0)
                $status.Foreground = [Windows.Media.BrushConverter]::new().ConvertFromString($(if ($session.status -eq '已授权') { '#16804A' } else { '#667085' }))
                [void]$actions.Children.Add($status)
                if ($session.status -in @('已授权','已暂停')) {
                    $revokeSession = [Windows.Controls.Button]::new()
                    $revokeSession.Content = '撤销会话'
                    $revokeSession.Tag = 'revoke-session:' + $session.id + ':' + $account.id
                    $revokeSession.Add_Click({
                        param($sender, $eventArgs)
                        if ([Windows.MessageBox]::Show($window, '此会话将停止使用本机。该账号的其他会话授权保留。', '撤销会话授权', 'OKCancel', 'Warning') -eq 'OK') {
                            $manager.result = $sender.Tag
                            $window.Close()
                        }
                    })
                    [void]$actions.Children.Add($revokeSession)
                }
                [Windows.Controls.Grid]::SetColumn($actions, 1)
                [void]$row.Children.Add($content); [void]$row.Children.Add($actions)
                $card.Child = $row
                [void]$ui.AccountHistory.Children.Add($card)
            }
        }
        Set-ManagementPage 'account'
    }

    # 每页只创建可用的一批行，避免大量授权一次占满窗口或阻塞输入。
    function Update-ApprovalRows {
        $query = $ui.ApprovalSearch.Text.Trim()
        $filtered = @($manager.allApprovals | Where-Object {
            if (!$query) { return $true }
            foreach ($name in @($_.name, $_.team, $_.platform)) {
                if ($name -and ([string]$name).IndexOf($query, [StringComparison]::CurrentCultureIgnoreCase) -ge 0) { return $true }
            }
            return $false
        })
        $pageSize = 20
        $pageCount = [int][Math]::Ceiling($filtered.Count / $pageSize)
        $ui.ApprovalCount.Text = if ($filtered.Count -eq $manager.allApprovals.Count) { "已授权用户  $($manager.allApprovals.Count)" } else { "已授权用户  $($filtered.Count) / $($manager.allApprovals.Count)" }
        $ui.Empty.Text = if ($manager.allApprovals.Count) { '没有匹配的用户' } else { '尚未加载到已绑定用户。可点击「刷新」，或回到网页点击「连接此电脑」。' }
        $ui.Empty.Visibility = if ($filtered.Count) { 'Collapsed' } else { 'Visible' }
        $ui.ApprovalPages.Visibility = if ($pageCount -gt 1) { 'Visible' } else { 'Collapsed' }
        $ui.ApprovalPage.Text = "第 $($manager.approvalPage + 1) / $pageCount 页"
        $ui.PreviousApprovals.IsEnabled = $manager.approvalPage -gt 0
        $ui.NextApprovals.IsEnabled = $manager.approvalPage + 1 -lt $pageCount
        $ui.Approvals.Children.Clear()
        $ui.ApprovalScroll.ScrollToTop()
        foreach ($approval in ($filtered | Select-Object -Skip ($manager.approvalPage * $pageSize) -First $pageSize)) {
            [xml]$rowMarkup = @'
<Border xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" Background="White" BorderBrush="#E2E7F0" BorderThickness="1" CornerRadius="10" Padding="12" Margin="0,0,0,8"><Grid><Grid.ColumnDefinitions><ColumnDefinition Width="44"/><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions><Border Width="34" Height="34" CornerRadius="17" Background="#EEF3FF" VerticalAlignment="Center"><TextBlock Name="Avatar" Foreground="#366BFA" FontWeight="SemiBold" HorizontalAlignment="Center" VerticalAlignment="Center"/></Border><StackPanel Grid.Column="1" VerticalAlignment="Center" Margin="0,0,10,0"><Button Name="Member" FontWeight="SemiBold" HorizontalAlignment="Left" Foreground="#245BCD" Padding="0,3" BorderThickness="0"/><TextBlock Name="Chat" Foreground="#667085" TextTrimming="CharacterEllipsis" Margin="0,5,0,0"/></StackPanel><StackPanel Grid.Column="2" VerticalAlignment="Center" Orientation="Horizontal"><TextBlock Name="Status" VerticalAlignment="Center" Margin="0,0,10,0" FontSize="12"/><Button Name="Enable" Content="启用授权" Padding="10,7" Margin="0,0,6,0"/><Button Name="Toggle" Padding="10,7" Margin="0,0,6,0"/><Button Name="Remove" Content="移除" Padding="10,7" Foreground="#B42318"/></StackPanel></Grid></Border>
'@
            $row = [Windows.Markup.XamlReader]::Load([System.Xml.XmlNodeReader]::new($rowMarkup))
            $status = switch ($approval.state) { 'active' { '已授权' } 'paused' { '已暂停' } default { '按会话授权' } }
            $member = $row.FindName('Member')
            $member.Content = $approval.name + ' ›'
            $member.ToolTip = $approval.name
            $row.FindName('Avatar').Text = ([string]$approval.name).Substring(0, [Math]::Min(1, ([string]$approval.name).Length))
            $row.FindName('Status').Text = $status
            $row.FindName('Status').Foreground = [Windows.Media.BrushConverter]::new().ConvertFromString($(if ($approval.state -eq 'active') { '#16804A' } else { '#667085' }))
            $member.Tag = $approval
            $member.Add_Click({ param($sender, $eventArgs) Show-AccountDetails $sender.Tag })
            $details = $row.FindName('Chat')
            $details.Text = @($approval.team, $approval.platform).Where({ $_ }) -join ' · '
            $details.ToolTip = $details.Text
            $enable = $row.FindName('Enable')
            $enable.Visibility = if ($approval.state -eq 'legacy') { 'Visible' } else { 'Collapsed' }
            $enable.Tag = 'enable:' + $approval.id
            $toggle = $row.FindName('Toggle')
            $toggle.Content = if ($approval.state -eq 'paused') { '恢复' } else { '暂停' }
            $toggle.Tag = if ($approval.state -eq 'paused') { 'resume:' + $approval.id } else { 'pause:' + $approval.id }
            foreach ($button in @($enable,$toggle)) {
                $button.Add_Click({ param($sender, $eventArgs) $manager.result = $sender.Tag; $window.Close() })
            }
            $remove = $row.FindName('Remove'); $remove.Tag = 'remove:' + $approval.id
            $remove.Add_Click({
                param($sender, $eventArgs)
                $manager.pending = $sender.Tag
                $ui.RevokeMessage.Text = '移除此用户授权？该用户的任务将停止。再次使用需重新添加授权。'
                $ui.RevokePanel.Visibility = 'Visible'
            })
            [void]$ui.Approvals.Children.Add($row)
        }
    }
    $refreshTimer = [Windows.Threading.DispatcherTimer]::new()
    $refreshTimer.Interval = [TimeSpan]::FromMilliseconds(100)
    $refreshTimer.Add_Tick({
        if (!$manager.refreshTask.IsCompleted) { return }
        $refreshTimer.Stop()
        try {
            $line = $manager.refreshTask.GetAwaiter().GetResult()
            $response = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line)) | ConvertFrom-Json
            if (!$response.ok) { throw 'refresh failed' }
            $manager.allApprovals = @($response.snapshot.accounts | Where-Object { $_ })
            $ui.SearchLabel.Visibility = $ui.ApprovalSearch.Visibility = if ($manager.allApprovals.Count) { 'Visible' } else { 'Collapsed' }
            $ui.ConnectionStatus.Text = '连接状态：' + $response.snapshot.status
            $manager.approvalPage = 0
            Update-ApprovalRows
        } catch { $ui.ConnectionStatus.Text = '刷新失败，请重试。' }
        $ui.Refresh.Content = '刷新'; $ui.Refresh.IsEnabled = $true
    })
    $ui.Refresh.Add_Click({
        $ui.Refresh.IsEnabled = $false; $ui.Refresh.Content = '刷新中…'
        [Console]::Out.WriteLine('__connector_refresh__'); [Console]::Out.Flush()
        $manager.refreshTask = [Console]::In.ReadLineAsync()
        $refreshTimer.Start()
    })

    $ui.ApprovalSearch.Add_TextChanged({ $manager.approvalPage = 0; Update-ApprovalRows })
    $ui.PreviousApprovals.Add_Click({ $manager.approvalPage--; Update-ApprovalRows })
    $ui.NextApprovals.Add_Click({ $manager.approvalPage++; Update-ApprovalRows })
    Update-ApprovalRows
    $ui.RevokeAccount.Add_Click({
        if ([Windows.MessageBox]::Show($window, '该账号的全部会话将停止使用本机。再次使用需要重新添加授权。', '撤销账号授权', 'OKCancel', 'Warning') -eq 'OK') {
            $manager.result = $ui.RevokeAccount.Tag
            $window.Close()
        }
    })
    $ui.Add.Add_Click({ Set-ManagementPage 'add' })
    $ui.Settings.Add_Click({ Set-ManagementPage 'settings' })
    $ui.CancelRevoke.Add_Click({ $manager.pending = ''; $ui.RevokePanel.Visibility = 'Collapsed' })
    $ui.ConfirmRevoke.Add_Click({ if ($manager.pending) { $manager.result = $manager.pending; $window.Close() } })
    $ui.Back.Add_Click({ if ($manager.page -eq 'list') { $window.Close() } else { Set-ManagementPage 'list' } })
    $window.Add_PreviewKeyDown({ param($sender, $keyEvent) if ($keyEvent.Key -eq 'Escape') { $window.Close(); $keyEvent.Handled = $true } })
    # 连接测试使用当前可执行文件的受限 CLI；不写入配置、不配对、不启动第二个托盘。
    $testTimer = [Windows.Threading.DispatcherTimer]::new()
    $testTimer.Interval = [TimeSpan]::FromMilliseconds(150)
    $testTimer.Add_Tick({
        if (!$manager.process -or !$manager.process.HasExited) { return }
        $testTimer.Stop()
        $success = $manager.process.ExitCode -eq 0
        $failure = $manager.process.StandardOutput.ReadToEnd().Trim()
        $manager.process.Dispose(); $manager.process = $null
        $ui.Test.IsEnabled = $true; $ui.Address.IsEnabled = $true; $ui.Back.IsEnabled = $true
        if ($success) {
            if ($manager.saveTarget) {
                $manager.result = if ($inputData.mode -eq 'authorizations') { 'settings:' + $manager.saveTarget } else { $manager.saveTarget }
                $window.Close()
                return
            }
            $ui.Feedback.Text = '连接正常。'
        } else {
            $messages = @{
                platform_permission_denied = '系统拒绝网络访问，请检查 Windows 防火墙或联系管理员。'
                platform_connection_refused = '平台拒绝连接，请确认地址、端口和服务是否启动。'
                platform_connection_timeout = '连接超时，请检查网络、VPN 和平台服务。'
                platform_dns_failed = '无法解析平台域名，请检查地址和 DNS。'
                platform_certificate_invalid = 'HTTPS 证书验证失败，请使用证书对应的域名和可信证书。'
                platform_connector_unavailable = '平台尚未启用连接器，请更新平台或联系管理员。'
            }
            $ui.Feedback.Text = if ($messages.ContainsKey($failure)) { $messages[$failure] } else { '连接测试失败，请检查平台地址、网络及 HTTPS 证书后重试。' }
        }
        $manager.saveTarget = ''
        $ui.Submit.Content = '保存并连接'
        $ui.Submit.IsEnabled = [bool]$ui.Address.Text.Trim()
    })
    # 保存与手动测试复用同一检查，保存成功时使用实际验证过的地址。
    function Start-ConnectionTest([bool]$saveOnSuccess) {
        if ($manager.process) { return }
        $target = $ui.Address.Text.Trim()
        $parsed = $null
        if (![Uri]::TryCreate($target, [UriKind]::Absolute, [ref]$parsed) -or $parsed.Scheme -notin @('http','https') -or !$parsed.Host -or $parsed.UserInfo -or $parsed.Query -or $parsed.Fragment -or $parsed.AbsolutePath -ne '/' -or $target -match '[\s"\\]') {
            $ui.Feedback.Text = '请输入完整的 HTTP 或 HTTPS 平台地址，不包含账号、路径或参数。'; return
        }
        $info = [Diagnostics.ProcessStartInfo]::new()
        $info.FileName = $inputData.testExecutable
        $info.Arguments = '--test-platform "' + $target + '"'
        $info.UseShellExecute = $false; $info.CreateNoWindow = $true
        $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
        try {
            $manager.process = [Diagnostics.Process]::Start($info)
            $manager.saveTarget = if ($saveOnSuccess) { $target } else { '' }
            $ui.Test.IsEnabled = $false; $ui.Address.IsEnabled = $false; $ui.Back.IsEnabled = $false
            $ui.Submit.IsEnabled = $false
            if ($saveOnSuccess) { $ui.Submit.Content = '正在检查连接…' }
            $ui.Feedback.Text = '正在检查连接…'; $testTimer.Start()
        } catch { $ui.Feedback.Text = '无法启动连接测试，请重新打开客户端后重试。' }
    }
    $ui.Test.Add_Click({ Start-ConnectionTest $false })
    $ui.Address.AddHandler([Windows.Controls.Primitives.TextBoxBase]::TextChangedEvent, [Windows.Controls.TextChangedEventHandler]{
        if ($manager.page -eq 'settings') { $ui.Submit.IsEnabled = !$manager.process -and [bool]$ui.Address.Text.Trim() }
    })
    $ui.Submit.Add_Click({
        if ($manager.page -eq 'add') {
            $value = $ui.Invite.Text.Trim()
            if (!$value) { [void]$ui.Invite.Focus(); return }
            $link = $null
            $rawCode = ($value -replace '\s','') -match '^[a-fA-F0-9]{20}$'
            $validLink = [Uri]::TryCreate($value, [UriKind]::Absolute, [ref]$link) -and $link.Scheme -in @('http','https') -and $link.Host -and !$link.UserInfo -and !$link.Query -and $link.AbsolutePath -in @('/account/devices','/connector') -and $link.Fragment -match '^#connect=[a-fA-F0-9]{20}$'
            if (!$rawCode -and !$validLink) { $ui.InviteFeedback.Text = '连接链接或连接码格式无效，请从网页重新复制。'; return }
            if ($inputData.mode -eq 'authorizations') { $manager.result = 'invite:' + $value } else { $manager.result = $value }
        } elseif ($manager.page -eq 'settings') {
            Start-ConnectionTest $true
            return
        } else { return }
        $window.Close()
    })
    $window.Add_Closed({
        $testTimer.Stop()
        $refreshTimer.Stop()
        if ($manager.process) {
            if (!$manager.process.HasExited) { $manager.process.Kill(); $manager.process.WaitForExit() }
            $manager.process.Dispose()
        }
    })
    if ($inputData.mode -in @('settings','setup')) { Set-ManagementPage 'settings' }
    elseif ($inputData.mode -eq 'invite') { Set-ManagementPage 'add' }
    else {
        $selected = $manager.allApprovals | Where-Object { $_.id -eq $inputData.selectedAccountID } | Select-Object -First 1
        if ($selected) { Show-AccountDetails $selected } else { Set-ManagementPage 'list' }
    }
    Initialize-ConnectorWindow -Window $window -IconBase64 $inputData.iconBase64
    $window.Add_ContentRendered({
        if ($manager.page -eq 'add') { [void]$ui.Invite.Focus() } else { [void]$ui.Back.Focus() }
    })
    [void]$window.ShowDialog()
    if ($null -eq $manager.result) { exit 2 }
    [Console]::Write($manager.result)
    exit 0
}
