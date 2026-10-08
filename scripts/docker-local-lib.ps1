Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:ProjectRoot = Split-Path -Parent $PSScriptRoot

function Quote-NativeArgument([string] $Value) {
    if ($Value -notmatch '[\s"]' -and $Value.Length -gt 0) { return $Value }
    $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
    $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
    return '"' + $escaped + '"'
}

function Invoke-Docker([string[]] $Arguments, [int] $TimeoutSeconds=30, [string] $InputText='') {
    $info=New-Object Diagnostics.ProcessStartInfo
    $info.FileName='docker.exe'
    $info.Arguments=(($Arguments | ForEach-Object { Quote-NativeArgument $_ }) -join ' ')
    $info.WorkingDirectory=$script:ProjectRoot
    $info.UseShellExecute=$false; $info.CreateNoWindow=$true
    $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true; $info.RedirectStandardInput=$true
    $info.StandardOutputEncoding=New-Object Text.UTF8Encoding($false)
    $info.StandardErrorEncoding=New-Object Text.UTF8Encoding($false)
    # File configuration is authoritative; never let inherited shell values replace it.
    foreach ($key in @('DB_NAME','DB_USER','DB_PASSWORD','MYSQL_ROOT_PASSWORD','APP_AUTH_USER','APP_AUTH_PASSWORD','APP_HTTP_PORT','COMPOSE_PROJECT_NAME','COMPOSE_FILE','COMPOSE_PROFILES','COMPOSE_ENV_FILES','COMPOSE_DISABLE_ENV_FILE')) { $info.EnvironmentVariables.Remove($key) }
    $process=New-Object Diagnostics.Process
    $process.StartInfo=$info
    try {
        [void]$process.Start()
        $stdout=$process.StandardOutput.ReadToEndAsync(); $stderr=$process.StandardError.ReadToEndAsync()
        # .NET Framework/PowerShell 5.1 may use an ANSI stdin writer. Send explicit
        # UTF-8 bytes so SQL, JSON and non-ASCII passwords survive without a BOM.
        $stdin=$process.StandardInput.BaseStream
        if ($InputText) {
            $bytes=[Text.Encoding]::UTF8.GetBytes($InputText+"`n")
            $stdin.Write($bytes,0,$bytes.Length); $stdin.Flush()
        }
        $stdin.Close()
        if (-not $process.WaitForExit($TimeoutSeconds*1000)) { $process.Kill(); throw 'Docker 操作超时；检查 Docker Desktop。数据卷保留。' }
        return @{ Code=$process.ExitCode; Out=$stdout.Result; Err=$stderr.Result }
    } finally { $process.Dispose() }
}

function Get-ComposeArguments([string] $Project,[string] $EnvFile) {
    return @('compose','--project-name',$Project,'--env-file',$EnvFile,'--file',(Join-Path $script:ProjectRoot 'compose.yaml'))
}
function Assert-DockerReady {
    $result=Invoke-Docker @('info','--format','{{.OSType}}')
    if ($result.Code -ne 0) { throw 'Docker Desktop 尚未就绪，请启动后重试。' }
    if ($result.Out.Trim() -ne 'linux') { throw '请在 Docker Desktop 切换到 Linux containers。' }
    if ((Invoke-Docker @('compose','version')).Code -ne 0) { throw '需要 Docker Compose v2。' }
}
function Get-LocalConfig([string[]] $ComposeArguments) {
    $result=Invoke-Docker ($ComposeArguments+@('config','--format','json'))
    if ($result.Code -ne 0) { throw '配置解析失败：检查所选配置文件的必填项和引用格式；未输出含密码的 Compose 配置。' }
    try { $config=$result.Out | ConvertFrom-Json } catch { throw 'Compose 配置返回格式错误。' }
    # `config --format json` escapes $ as $$ for re-use as a Compose document.
    # Read actual interpolation values separately; never use the display form as a password.
    $environment=Invoke-Docker ($ComposeArguments+@('config','--environment'))
    if ($environment.Code -ne 0) { throw '无法读取实际 Compose 插值配置。' }
    $resolved=@{}
    foreach ($line in ($environment.Out -split "`r?`n")) {
        $parts=$line -split '=',2
        if ($parts.Count -eq 2) { $resolved[$parts[0]]=$parts[1] }
    }
    foreach ($key in @('DB_NAME','DB_USER','DB_PASSWORD','APP_AUTH_USER','APP_AUTH_PASSWORD')) {
        if (-not $resolved.ContainsKey($key)) { throw "缺少必填项 $key。" }
        $config.services.app.environment.$key=$resolved[$key]
    }
    $config.services.db.environment.MYSQL_DATABASE=$resolved['DB_NAME']
    $config.services.db.environment.MYSQL_USER=$resolved['DB_USER']
    $config.services.db.environment.MYSQL_PASSWORD=$resolved['DB_PASSWORD']
    $config.services.db.environment.MYSQL_ROOT_PASSWORD=$resolved['MYSQL_ROOT_PASSWORD']
    $app=$config.services.app.environment
    if ([string]$app.DB_NAME -notmatch '^[a-zA-Z][a-zA-Z0-9_]{0,63}$') { throw '数据库名以字母开头，仅允许字母、数字、下划线，最多64字符。' }
    if ([string]$app.DB_USER -notmatch '^[a-zA-Z][a-zA-Z0-9_]{0,31}$' -or $app.DB_USER -eq 'root') { throw '业务账号不能为 root；仅允许字母开头的字母、数字、下划线，最多32字符。' }
    if ([string]$app.APP_AUTH_USER -notmatch '^[a-zA-Z0-9_.-]{1,64}$') { throw '网页用户名仅允许字母、数字、下划线、点和横线，最多64字符。' }
    foreach ($value in @([string]$app.DB_PASSWORD,[string]$app.APP_AUTH_PASSWORD,[string]$config.services.db.environment.MYSQL_ROOT_PASSWORD)) {
        if ([string]::IsNullOrWhiteSpace($value) -or $value -match '[\r\n\x00]') { throw '密码必须是非空的单行值。' }
    }
    $port=[int]$config.services.app.ports[0].published
    if ($port -lt 1024 -or $port -gt 65535) { throw '本机端口必须为1024–65535。' }
    if ($app.DB_HOST -ne 'db' -or [string]$app.DB_PORT -ne '3306') { throw '本地 Compose 必须使用 db:3306。' }
    return $config
}
function New-LocalPassword {
    $bytes=New-Object byte[] 24
    $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes).Replace('+','-').Replace('/','_')
}
function ConvertTo-EnvLiteral([string] $Value) {
    if ($Value -match '[\r\n\x00]') { throw '配置值必须为单行。' }
    # Double quotes handle trailing backslashes; $$ suppresses variable expansion.
    return '"'+$Value.Replace('\','\\').Replace('"','\"').Replace('$','$$')+'"'
}
function Read-Default([string] $Label,[string] $Default) {
    $value=Read-Host "$Label [默认 $Default]"
    if ($value -eq '') { return $Default }; return $value
}
function Read-LocalPassword([string] $Label) {
    $secure=Read-Host "$Label（回车自动生成；输入不显示）" -AsSecureString
    $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $value=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secure.Dispose() }
    if ($value -eq '') { return New-LocalPassword }; return $value
}
function New-LocalConfig([string] $EnvFile,[int] $Port,[switch] $GeneratedDefaults) {
    if (Test-Path -LiteralPath $EnvFile) { return }
    $values=[ordered]@{DB_NAME='passenger_flow_codex'; DB_USER='passenger_app'; DB_PASSWORD=''; MYSQL_ROOT_PASSWORD=''; APP_AUTH_USER='local-admin'; APP_AUTH_PASSWORD=''; APP_HTTP_PORT=[string]$Port}
    if (-not $GeneratedDefaults) {
        Write-Host '首次配置：数据库账号与网页登录账号分别设置。'
        foreach ($key in @('DB_NAME','DB_USER','APP_AUTH_USER')) { $values[$key]=Read-Default $key $values[$key] }
        foreach ($key in @('DB_PASSWORD','MYSQL_ROOT_PASSWORD','APP_AUTH_PASSWORD')) { $values[$key]=Read-LocalPassword $key }
    } else { foreach ($key in @('DB_PASSWORD','MYSQL_ROOT_PASSWORD','APP_AUTH_PASSWORD')) { $values[$key]=New-LocalPassword } }
    if ($values.DB_NAME -notmatch '^[a-zA-Z][a-zA-Z0-9_]{0,63}$') { throw '数据库名称格式错误，未保存配置。' }
    if ($values.DB_USER -notmatch '^[a-zA-Z][a-zA-Z0-9_]{0,31}$' -or $values.DB_USER -eq 'root') { throw '业务账号格式错误或为root，未保存配置。' }
    if ($values.APP_AUTH_USER -notmatch '^[a-zA-Z0-9_.-]{1,64}$') { throw '网页用户名格式错误，未保存配置。' }
    $content=@('# 本机私密配置，不要提交 Git。DB_HOST 由 Compose 自动设置为 db。')
    foreach ($entry in $values.GetEnumerator()) { $content+=$entry.Key+'='+(ConvertTo-EnvLiteral $entry.Value) }
    $stream=[IO.File]::Open($EnvFile,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    $writer=New-Object IO.StreamWriter($stream,(New-Object Text.UTF8Encoding($false)))
    try { $writer.Write(($content -join "`r`n")+"`r`n") } finally { $writer.Dispose() }
    $parsed=Get-LocalConfig (Get-ComposeArguments 'passenger-flow-config-check' $EnvFile)
    foreach ($key in @('DB_NAME','DB_USER','DB_PASSWORD','APP_AUTH_USER','APP_AUTH_PASSWORD')) {
        if ([string]$parsed.services.app.environment.$key -cne [string]$values[$key]) { throw "$key 保存后解析不一致，启动已停止。" }
    }
    if ([string]$parsed.services.db.environment.MYSQL_ROOT_PASSWORD -cne [string]$values.MYSQL_ROOT_PASSWORD) { throw 'root密码保存后解析不一致，启动已停止。' }
    Write-Host "配置已保存：$EnvFile。密码仅保存在本机文件。"
}
function Get-ContainerState([string[]] $ComposeArguments,[string] $Service) {
    $result=Invoke-Docker ($ComposeArguments+@('ps','--all','--quiet',$Service))
    if ($result.Code -ne 0 -or -not $result.Out.Trim()) { return $null }
    $result=Invoke-Docker @('inspect','--format','{{json .}}',$result.Out.Trim())
    if ($result.Code -ne 0) { return $null }; return ($result.Out | ConvertFrom-Json)
}
function Test-DatabaseLogin([string[]] $ComposeArguments,[switch] $Root) {
    $command='MYSQL_PWD="$MYSQL_PASSWORD" mysql --protocol=TCP -h127.0.0.1 -u"$MYSQL_USER" "$MYSQL_DATABASE" --connect-timeout=5 -N'
    if ($Root) { $command='MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --protocol=TCP -h127.0.0.1 -uroot --connect-timeout=5 -N' }
    $result=Invoke-Docker ($ComposeArguments+@('exec','-T','db','sh','-c',$command)) 15 'SELECT 1;'
    if ($result.Code -eq 0 -and $result.Out.Trim() -eq '1') { return 'PASS' }
    if ($result.Err -match '1045|Access denied') { return 'ACCESS_DENIED' }
    if ($result.Err -match '1049|Unknown database') { return 'DATABASE_MISSING' }; return 'UNAVAILABLE'
}
function Get-HttpResult([string] $Url,[string] $Auth='',[int] $TimeoutSeconds=15) {
    $request=[Net.HttpWebRequest]::Create($Url)
    $request.Timeout=$TimeoutSeconds*1000; $request.ReadWriteTimeout=$TimeoutSeconds*1000; $request.Proxy=$null
    if ($Auth) { $request.Headers['Authorization']=$Auth }
    try { $response=$request.GetResponse() } catch [Net.WebException] {
        if ($_.Exception.Response) { $response=$_.Exception.Response }
        else { return @{Status=0; Body=''; Kind=[string]$_.Exception.Status} }
    }
    try {
        $reader=New-Object IO.StreamReader($response.GetResponseStream())
        try { $body=$reader.ReadToEnd() } finally { $reader.Dispose() }
        return @{Status=[int]$response.StatusCode; Body=$body; Kind='HTTP'}
    } finally { $response.Dispose() }
}
function Assert-ContainerConfig($Config,$State,[string] $Service) {
    if (-not $State) { throw "$Service 容器不存在，请运行对应启动入口。" }
    $actual=@{}
    foreach ($item in $State.Config.Env) { $parts=$item -split '=',2; $actual[$parts[0]]=$parts[1] }
    foreach ($property in $Config.services.$Service.environment.PSObject.Properties) {
        if ($actual[$property.Name] -cne [string]$property.Value) { throw "运行容器与文件不一致：$Service/$($property.Name)。重新启动；改配置不会修改旧卷数据库密码。" }
    }
}
function Invoke-LocalVerification([string[]] $ComposeArguments,$Config,[string] $Project,[string] $EnvFile,[switch] $RequireRoot) {
    $report=[ordered]@{sampledAt=[DateTime]::UtcNow.ToString('o'); project=$Project; configFile=$EnvFile; status='FAIL'; checks=@()}
    $stage='container-config'
    try {
        foreach ($service in @('db','app')) { Assert-ContainerConfig $Config (Get-ContainerState $ComposeArguments $service) $service }
        $stage='database-business-login'; $login=Test-DatabaseLogin $ComposeArguments
        if ($login -ne 'PASS') { throw "数据库业务认证失败（$login）。本地地址自动为 db:3306；旧卷不会因改配置而重设密码，请保留旧卷并使用独立验收入口或恢复原密码。" }
        $report.checks+=@{name=$stage; status='PASS'}; Write-Host '数据库业务账号验证：通过。'
        $stage='database-admin-login'; $root=Test-DatabaseLogin $ComposeArguments -Root
        $report.checks+=@{name=$stage; status=$root}
        if ($root -ne 'PASS') {
            if ($RequireRoot) { throw '独立验收库的 root 密码验证失败。' }
            Write-Host '提示：root认证未通过，业务验证继续；不要删除旧卷。'
        }
        $base='http://127.0.0.1:'+([int]$Config.services.app.ports[0].published)
        $app=$Config.services.app.environment
        $auth='Basic '+[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($app.APP_AUTH_USER+':'+$app.APP_AUTH_PASSWORD))
        foreach ($path in @('/live','/health','/metrics','/')) {
            $stage=$path; $header=''; if ($path -eq '/metrics' -or $path -eq '/') { $header=$auth }
            $result=Get-HttpResult ($base+$path) $header 30
            if ($result.Status -eq 401) { throw '网页认证被拒绝；核对 APP_AUTH_USER / APP_AUTH_PASSWORD 和运行容器配置。' }
            if ($result.Status -ne 200) { throw "$path 验证失败（HTTP=$($result.Status)，$($result.Kind)），不是已确认的网页登录密码错误。" }
            if ($path -eq '/health' -and (($result.Body | ConvertFrom-Json).database -ne 'UP')) { throw '数据库就绪检查未通过。' }
            $report.checks+=@{name=$path; status='PASS'; httpStatus=200}
        }
        if ((Get-HttpResult ($base+'/metrics')).Status -ne 401) { throw '未登录访问保护异常。' }
        $report.checks+=@{name='unauthenticated-request'; status='PASS'; httpStatus=401}; $report.status='PASS'
        Write-Host '建表、应用就绪、网页登录与访问保护：通过。'
        Write-Host "数据库：$($app.DB_NAME)；地址：db:3306；业务用户：$($app.DB_USER)"
        Write-Host "网页用户：$($app.APP_AUTH_USER)；访问：$base"
        $viewer='show-docker-config.bat'
        if ($Project -eq 'passenger-flow-docker-acceptance') { $viewer='show-docker-acceptance-config.bat' }
        Write-Host "密码查看：$viewer；配置：$EnvFile"
    } catch { $report.failedStage=$stage; throw }
    finally {
        $dir=Join-Path $script:ProjectRoot 'reports'; [void][IO.Directory]::CreateDirectory($dir)
        $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $dir ($Project+'-verify.json')) -Encoding UTF8
    }
}
