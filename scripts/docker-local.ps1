param(
    [ValidateSet('Start','Verify','Show','Stop','Setup')][string] $Action='Start',
    [switch] $Acceptance, [switch] $GeneratedDefaults, [switch] $NoBuild,
    [ValidateRange(15,300)][int] $WaitSeconds=180
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'docker-local-lib.ps1')
Set-Location -LiteralPath $script:ProjectRoot
$project='passenger-flow-docker'; $file=Join-Path $script:ProjectRoot '.env.docker'; $defaultPort=3030
if ($Acceptance) { $project='passenger-flow-docker-acceptance'; $file=Join-Path $script:ProjectRoot '.env.docker.acceptance'; $defaultPort=3031 }
$stage='preflight'
try {
    if ($Action -eq 'Show') {
        if (-not (Test-Path -LiteralPath $file)) { throw '尚未创建配置，请先运行对应启动入口。' }
        Write-Host '仅在本机编辑器查看配置，不要发送截图或上传此文件。'
        Start-Process notepad.exe -ArgumentList ('"'+$file+'"'); exit 0
    }
    Assert-DockerReady; $compose=Get-ComposeArguments $project $file
    if ($Action -eq 'Start' -or $Action -eq 'Setup') { New-LocalConfig $file $defaultPort -GeneratedDefaults:$GeneratedDefaults }
    if (-not (Test-Path -LiteralPath $file)) { throw '缺少配置，请先运行对应启动入口。' }
    $config=Get-LocalConfig $compose
    if ($Action -eq 'Setup') { Write-Host '配置已验证，尚未启动容器。'; exit 0 }
    if ($Action -eq 'Stop') {
        if ((Invoke-Docker ($compose+@('stop','--timeout','45')) 100).Code -ne 0) { throw '停止失败，请检查 Docker Desktop。' }
        Write-Host '所选项目已停止；容器、配置和数据卷保留。'; exit 0
    }
    if ($Action -eq 'Start') {
        Write-Host "启动：$project。使用所选文件，忽略同名 shell 配置变量。"
        $app=Get-ContainerState $compose 'app'; $port=[int]$config.services.app.ports[0].published; $ownedPort=$false
        if ($app -and $app.State.Running) {
            foreach ($binding in $app.HostConfig.PortBindings.'3030/tcp') { if ([int]$binding.HostPort -eq $port) { $ownedPort=$true } }
        }
        if (-not $ownedPort) {
            $listener=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,$port)
            try { $listener.Start() } catch { throw "端口 $port 已被占用；不会停止其他程序，请修改所选文件 APP_HTTP_PORT。" }
            finally { $listener.Stop() }
        }
        if (-not $NoBuild) {
            $stage='image-build'
            Write-Host '正在构建镜像（首次需要下载依赖）……'
            if ((Invoke-Docker ($compose+@('build','app')) 600).Code -ne 0) { throw '镜像构建失败，请检查网络、Docker Desktop与镜像下载。' }
        }
        Write-Host '先启动数据库，验证真实账号……'
        $stage='database-business-login'
        if ((Invoke-Docker ($compose+@('up','-d','db')) 90).Code -ne 0) { throw '数据库启动失败；旧卷保留。' }
        $deadline=[DateTime]::UtcNow.AddSeconds($WaitSeconds)
        do {
            $login=Test-DatabaseLogin $compose
            if ($login -eq 'PASS') { break }
            if ($login -eq 'ACCESS_DENIED') { throw '数据库认证被拒绝：当前配置不适用于数据库账号。DB_HOST 自动为 db，不需要手填IP。旧卷不会自动改密；保留旧卷，使用 start-docker-acceptance.bat 验证新库。' }
            Start-Sleep -Seconds 2
        } while ([DateTime]::UtcNow -lt $deadline)
        if ($login -ne 'PASS') { throw "数据库未在期限内通过验证（$login），检查库名和初始化日志。" }
        Write-Host '数据库认证通过，启动应用、校验表、补齐本地示例资料……'
        $stage='app-readiness'
        if ((Invoke-Docker ($compose+@('up','-d','app')) 90).Code -ne 0) { throw '应用启动失败，数据库已保留。' }
        $deadline=[DateTime]::UtcNow.AddSeconds($WaitSeconds)
        do {
            $health=Get-HttpResult "http://127.0.0.1:$port/health" '' 5
            if ($health.Status -eq 200) { break }
            $app=Get-ContainerState $compose 'app'
            if ($app -and ($app.State.Status -eq 'restarting' -or $app.State.Status -eq 'exited')) { throw '应用启动检查退出，检查表权限、只读设置和认证配置；运行对应验证入口查看失败阶段。' }
            Start-Sleep -Seconds 2
        } while ([DateTime]::UtcNow -lt $deadline)
        if ($health.Status -ne 200) { throw '应用未在期限内就绪，尚不能报告启动成功。' }
    }
    Invoke-LocalVerification $compose $config $project $file -RequireRoot:$Acceptance
    exit 0
} catch {
    if ($Action -eq 'Start') {
        $reportDir=Join-Path $script:ProjectRoot 'reports'; [void][IO.Directory]::CreateDirectory($reportDir)
        @{sampledAt=[DateTime]::UtcNow.ToString('o'); project=$project; status='FAIL'; failedStage=$stage} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $reportDir ($project+'-verify.json')) -Encoding UTF8
    }
    Write-Host ('失败：'+$_.Exception.Message) -ForegroundColor Red; exit 1
}
