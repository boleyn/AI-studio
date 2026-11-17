$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$inputData = ([System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine())) | ConvertFrom-Json)
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Windows.Forms

# 窗口模板始终为本地静态内容；平台、对话名称等外部文字仅通过 Text 属性赋值。
[xml]$markup = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Width="540" SizeToContent="Height" ResizeMode="NoResize" WindowStartupLocation="CenterScreen"
        Background="#FAFBFE" FontFamily="Microsoft YaHei UI, Segoe UI" Foreground="#182338"
        ShowInTaskbar="True">
  <Window.Resources>
    <Style TargetType="Button">
      <Setter Property="Cursor" Value="Hand"/><Setter Property="FontSize" Value="13"/>
      <Setter Property="Padding" Value="20,10"/><Setter Property="Background" Value="White"/>
      <Setter Property="Foreground" Value="#344054"/><Setter Property="BorderBrush" Value="#DCE2EC"/>
      <Setter Property="BorderThickness" Value="1"/>
      <Setter Property="Template"><Setter.Value><ControlTemplate TargetType="Button">
        <Border x:Name="Surface" CornerRadius="9" Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="{TemplateBinding BorderThickness}" Padding="{TemplateBinding Padding}">
          <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
        </Border>
        <ControlTemplate.Triggers>
          <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="Surface" Property="Opacity" Value="0.85"/></Trigger>
          <Trigger Property="IsPressed" Value="True"><Setter TargetName="Surface" Property="Opacity" Value="0.65"/></Trigger>
          <Trigger Property="IsEnabled" Value="False"><Setter TargetName="Surface" Property="Opacity" Value="0.45"/></Trigger>
          <Trigger Property="IsKeyboardFocused" Value="True"><Setter TargetName="Surface" Property="BorderBrush" Value="#182338"/><Setter TargetName="Surface" Property="BorderThickness" Value="2"/></Trigger>
        </ControlTemplate.Triggers>
      </ControlTemplate></Setter.Value></Setter>
    </Style>
  </Window.Resources>
  <StackPanel Margin="28,24,28,26">
    <StackPanel Orientation="Horizontal" HorizontalAlignment="Center" Margin="0,0,0,20">
      <Border Width="64" Height="64" CornerRadius="18" Background="#EAF0FF">
        <Viewbox Width="31" Height="31"><Path Stroke="#366BFA" StrokeThickness="1.8" Data="M 3,4 L 25,4 25,20 3,20 Z M 0,24 L 28,24 M 10,20 L 10,24 M 18,20 L 18,24"/></Viewbox>
      </Border>
      <StackPanel Orientation="Horizontal" VerticalAlignment="Center" Margin="18,0">
        <Ellipse Name="Dot1" Width="6" Height="6" Fill="#366BFA" Margin="0,0,7,0"/>
        <Ellipse Name="Dot2" Width="6" Height="6" Fill="#366BFA" Margin="0,0,7,0"/>
        <Ellipse Name="Dot3" Width="6" Height="6" Fill="#366BFA"/>
      </StackPanel>
      <Border Width="64" Height="64" CornerRadius="18" Background="#EAF0FF">
        <TextBlock Name="PlatformIcon" FontFamily="Segoe MDL2 Assets" Text="&#xE774;" FontSize="29" Foreground="#366BFA" HorizontalAlignment="Center" VerticalAlignment="Center"/>
      </Border>
    </StackPanel>
    <TextBlock Name="Heading" FontSize="23" FontWeight="SemiBold" TextAlignment="Center" TextWrapping="Wrap"/>
    <TextBlock Name="Subtitle" Margin="0,9,0,22" FontSize="13" Foreground="#667085" TextWrapping="Wrap" TextAlignment="Center" LineHeight="21"/>
    <Border Background="#EEF3FF" CornerRadius="12" Padding="18">
      <StackPanel>
        <TextBlock Name="DetailLabel" Text="请求绑定的平台" Foreground="#667085" FontSize="12" Margin="0,0,0,7"/>
        <ScrollViewer Name="DetailScroll" VerticalScrollBarVisibility="Auto" MaxHeight="174">
          <TextBox Name="Detail" IsReadOnly="True" BorderThickness="0" Background="Transparent" Padding="0" FontSize="14" TextWrapping="Wrap" AcceptsReturn="True"/>
        </ScrollViewer>
      </StackPanel>
    </Border>
    <Button Name="FolderButton" HorizontalContentAlignment="Stretch" Margin="0,14,0,0" Padding="14" Background="#F0F3F9" BorderThickness="0" Visibility="Collapsed">
      <StackPanel Width="410">
        <TextBlock Text="默认工作目录 · 点击选择" FontSize="12" Foreground="#667085"/>
        <TextBlock Name="FolderText" Margin="0,6,0,0" Text="请选择工作文件夹" TextWrapping="Wrap" FontSize="13"/>
      </StackPanel>
    </Button>
    <TextBlock Name="Hint" Margin="0,14,0,24" FontSize="12" Foreground="#667085" TextWrapping="Wrap" LineHeight="21"/>
    <Grid>
      <Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
      <TextBlock Name="Footer" Text="由聊天页面发起" FontSize="11" Foreground="#8791A4" VerticalAlignment="Center"/>
      <Button Name="Cancel" Grid.Column="1" Content="取消" IsCancel="True" Margin="0,0,10,0"/>
      <Button Name="Confirm" Grid.Column="2" Content="确认绑定" Background="#366BFA" Foreground="White" BorderBrush="#366BFA" FontWeight="SemiBold"/>
    </Grid>
  </StackPanel>
</Window>
'@
$window = [Windows.Markup.XamlReader]::Load([System.Xml.XmlNodeReader]::new($markup))
$window.Title = $inputData.productName
if ($inputData.mode -in @('accountApprove', 'pairApprove')) {
    $window.Topmost = $true
    $window.Add_ContentRendered({ param($sender, $eventArgs) [void]$sender.Activate() })
}
if ($inputData.mode -in @('authorizations', 'settings', 'invite', 'setup')) {
    Invoke-ManagementWindow
    exit 2
}
$controls = @{}
foreach ($name in @('Heading','Subtitle','DetailLabel','Detail','FolderButton','FolderText','Hint','Footer','Cancel','Confirm','PlatformIcon','Dot1','Dot2','Dot3')) {
    $controls[$name] = $window.FindName($name)
}
$state = @{ result = $null; folder = ''; approved = $false }
$pairing = $inputData.mode -eq 'pairApprove'
$notice = $inputData.mode -eq 'notice'
if ($pairing) {
    $controls.Heading.Text = '连接这台电脑'
    $controls.Subtitle.Text = '将电脑绑定到当前平台账号，继续在聊天中使用。'
    $controls.DetailLabel.Text = '请求绑定的平台与账号'
    $controls.Detail.Text = $inputData.message
    $controls.Hint.Text = '绑定后可在本机「已授权用户」中启用长期访问。'
} elseif ($notice) {
    $controls.Heading.Text = '暂时无法连接这台电脑'
    $controls.Subtitle.Text = '请按下面的提示处理，然后重新连接。'
    $controls.DetailLabel.Text = '连接提示'
    $controls.Detail.Text = $inputData.message
    $controls.Hint.Text = '处理后，可以在授权管理的连接设置中重新保存并连接。'
    $controls.Footer.Text = '本机连接器'
    $controls.Cancel.Visibility = 'Collapsed'
    $controls.Confirm.Content = '知道了'
} elseif ($inputData.mode -in @('approve','accountApprove')) {
    $controls.Heading.Text = '允许对话执行本机任务？'
    $controls.Subtitle.Text = '此对话将能够执行命令，并读取、修改本机文件。'
    $controls.DetailLabel.Text = '本次授权'
    $controls.Detail.Text = $inputData.message
    $controls.Hint.Text = '工作目录不是访问限制；命令将以当前系统用户的权限运行。'
    if ($inputData.mode -eq 'accountApprove') {
        $controls.Heading.Text = '允许此用户长期访问？'
        $controls.Subtitle.Text = '此用户的新会话可执行命令，并读取、修改本机文件。'
        $controls.Footer.Text = '本机授权管理'
    }
    $controls.FolderButton.Visibility = 'Visible'
    $controls.Confirm.Content = '允许执行'
    $controls.Confirm.IsEnabled = $true
    if ($inputData.address -and [System.IO.Directory]::Exists($inputData.address)) {
        $state.folder = $inputData.address
        $controls.FolderText.Text = $state.folder
    }
} else { exit 2 }

$controls.FolderButton.Add_Click({
    $picker = [System.Windows.Forms.FolderBrowserDialog]::new()
    $picker.Description = '选择默认工作目录（不是访问限制）'
    $picker.SelectedPath = $state.folder
    try {
        # 给目录选择器指定父窗口，避免授权窗口遮挡它。
        $owner = [System.Windows.Forms.NativeWindow]::new()
        $owner.AssignHandle(([System.Windows.Interop.WindowInteropHelper]::new($window)).Handle)
        try {
            if ($picker.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
                $state.folder = $picker.SelectedPath
                $controls.FolderText.Text = $state.folder
                $controls.Confirm.IsEnabled = $true
            }
        } finally { $owner.ReleaseHandle() }
    } finally { $picker.Dispose() }
})
$controls.Cancel.Add_Click({ $window.Close() })
$timer = [System.Windows.Threading.DispatcherTimer]::new()
$timer.Interval = [TimeSpan]::FromMilliseconds(450)
$timer.Add_Tick({ $timer.Stop(); $window.Close() })
$controls.Confirm.Add_Click({
    if ($state.approved) { return }
    # 已显示的有效目录可直接确认；缺失或失效时再选目录，取消选择不批准。
    if (!$pairing -and !$notice -and ![System.IO.Directory]::Exists($state.folder)) {
        $controls.FolderButton.RaiseEvent([Windows.RoutedEventArgs]::new([Windows.Controls.Button]::ClickEvent))
        if (![System.IO.Directory]::Exists($state.folder)) { return }
    }
    $state.approved = $true
    if ($notice) { $state.result = 'confirmed'; $window.Close(); return }
    if ($pairing) { $state.result = 'confirmed' } else { $state.result = $state.folder }
    $controls.Heading.Text = '已确认，正在返回聊天'
    $controls.Confirm.Content = '已确认'
    $controls.Confirm.IsEnabled = $false
    $controls.Cancel.IsEnabled = $false
    $controls.FolderButton.IsEnabled = $false
    $controls.PlatformIcon.Text = [string][char]0xE73E
    $controls.PlatformIcon.Foreground = [Windows.Media.Brushes]::SeaGreen
    foreach ($name in @('Dot1','Dot2','Dot3')) {
        $controls[$name].BeginAnimation([Windows.UIElement]::OpacityProperty, $null)
        $controls[$name].Fill = [Windows.Media.Brushes]::SeaGreen
    }
    $timer.Start()
})
# 尊重 Windows 关闭动画的系统设置；动画只提示等待状态，不影响授权结果。
if ([Windows.SystemParameters]::ClientAreaAnimation -and !$notice) {
    $delay = 0
    foreach ($name in @('Dot1','Dot2','Dot3')) {
        $motion = [Windows.Media.Animation.DoubleAnimation]::new(0.25, 1.0, [TimeSpan]::FromMilliseconds(650))
        $motion.AutoReverse = $true
        $motion.RepeatBehavior = [Windows.Media.Animation.RepeatBehavior]::Forever
        $motion.BeginTime = [TimeSpan]::FromMilliseconds($delay)
        $controls[$name].BeginAnimation([Windows.UIElement]::OpacityProperty, $motion)
        $delay += 180
    }
}
Initialize-ConnectorWindow -Window $window -IconBase64 $inputData.iconBase64
$window.Add_ContentRendered({ [void]$controls.Cancel.Focus() })
$window.Add_Closed({ $timer.Stop() })
[void]$window.ShowDialog()
if ($null -eq $state.result) { exit 2 }
[Console]::Write($state.result)
exit 0
