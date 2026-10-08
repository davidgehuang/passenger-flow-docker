# Integration checks are restricted to the isolated acceptance project.
param([switch] $IncludeFaultTests)
$ErrorActionPreference='Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/docker-local-lib.ps1')
$project='passenger-flow-docker-acceptance'
$file=Join-Path $script:ProjectRoot '.env.docker.acceptance'
$compose=Get-ComposeArguments $project $file
$config=Get-LocalConfig $compose
$report=[ordered]@{startedAt=[DateTime]::UtcNow.ToString('o'); project=$project; checks=@(); status='FAIL'}
function Check([string] $Name,[bool] $Condition) {
    if (-not $Condition) { throw "Acceptance failed: $Name" }
    $report.checks+=@{name=$Name; status='PASS'}
    Write-Host "PASS $Name"
}
function BusinessQuery([string] $Sql) {
    $cmd='MYSQL_PWD="$MYSQL_PASSWORD" mysql --protocol=TCP -h127.0.0.1 -u"$MYSQL_USER" "$MYSQL_DATABASE" --connect-timeout=5 -N'
    $result=Invoke-Docker ($compose+@('exec','-T','db','sh','-c',$cmd)) 30 $Sql
    if ($result.Code -ne 0) { throw 'Acceptance SQL failed (no native credentials/output printed).' }
    return $result.Out.Trim()
}
function Write-TestConfig([string] $Path,$Values) {
    $lines=@()
    foreach ($entry in $Values.GetEnumerator()) { $lines+=$entry.Key+'='+(ConvertTo-EnvLiteral $entry.Value) }
    [IO.File]::WriteAllText($Path,($lines -join "`r`n")+"`r`n",(New-Object Text.UTF8Encoding($false)))
}
try {
    Assert-DockerReady
    $initial=BusinessQuery 'SELECT CONCAT((SELECT COUNT(*) FROM stores),",",(SELECT COUNT(*) FROM devices),",",(SELECT COUNT(*) FROM flow_events));'
    Check 'seed supplies at least 5 stores and 10 devices' (([int]($initial -split ',')[0] -ge 5) -and ([int]($initial -split ',')[1] -ge 10))
    $dns=Invoke-Docker ($compose+@('exec','-T','app','node','-e',"require('node:dns').lookup('db',(e,a)=>{if(e)process.exitCode=1;else console.log('resolved')})"))
    Check 'service DNS resolves db from app' ($dns.Code -eq 0 -and $dns.Out.Trim() -eq 'resolved')
    $identity=Invoke-Docker ($compose+@('exec','-T','app','id','-u'))
    Check 'app runs as non-root' ($identity.Code -eq 0 -and $identity.Out.Trim() -ne '0')
    $override=Join-Path $script:ProjectRoot 'reports/compose.readonly-test.yaml'
    [IO.File]::WriteAllText($override,"services:`n  app:`n    read_only: true`n    tmpfs:`n      - /tmp`n",(New-Object Text.UTF8Encoding($false)))
    $readonly=Invoke-Docker ($compose+@('-f',$override,'run','--rm','--no-deps','-e','AUTO_INIT_SCHEMA=false','-e','SEED_DEMO_DATA=false','-e','DB_READ_ONLY=true','app','node','scripts/container-preflight.js')) 45
    Check 'cloud-style read-only rootfs preflight does not seed or create tables' ($readonly.Code -eq 0)
    $seed=Invoke-Docker ($compose+@('exec','-T','app','node','scripts/seed.js'))
    Check 'repeat seed does not add stores or devices' ($seed.Code -eq 0 -and (BusinessQuery 'SELECT CONCAT((SELECT COUNT(*) FROM stores),",",(SELECT COUNT(*) FROM devices),",",(SELECT COUNT(*) FROM flow_events));') -eq $initial)
    $before=[int](BusinessQuery 'SELECT COUNT(*) FROM flow_events;')
    $generated=Invoke-Docker ($compose+@('exec','-T','app','node','scripts/generate-test-data.js','--rows','30','--days','0')) 60
    Check 'generate 30 real flow events in acceptance DB' ($generated.Code -eq 0 -and [int](BusinessQuery 'SELECT COUNT(*) FROM flow_events;') -eq ($before+30))
    $version=BusinessQuery 'SELECT VERSION();'; $report.databaseVersion=$version
    $restart=Invoke-Docker ($compose+@('restart','--timeout','45','app')) 60
    Check 'app restart command completes' ($restart.Code -eq 0)
    Start-Sleep -Seconds 3
    Check 'restart preserves events' ([int](BusinessQuery 'SELECT COUNT(*) FROM flow_events;') -eq ($before+30))
    $port=[int]$config.services.app.ports[0].published
    $auth='Basic '+[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($config.services.app.environment.APP_AUTH_USER+':'+$config.services.app.environment.APP_AUTH_PASSWORD))
    Check 'wrong web password gets 401' ((Get-HttpResult "http://127.0.0.1:$port/metrics" 'Basic aW52YWxpZDppbnZhbGlk').Status -eq 401)
    Check 'valid web credentials get 200 after restart' ((Get-HttpResult "http://127.0.0.1:$port/metrics" $auth).Status -eq 200)
    $values=[ordered]@{DB_NAME='pf_quote_test'; DB_USER='quote_test'; DB_PASSWORD=''; MYSQL_ROOT_PASSWORD=''; APP_AUTH_USER='quote-admin'; APP_AUTH_PASSWORD=''; APP_HTTP_PORT='3032'}
    $testFile=Join-Path $script:ProjectRoot 'reports/.env.serialization-test'
    $image=(Get-ContainerState $compose 'app').Config.Image
    $serializationOverride=Join-Path $script:ProjectRoot 'reports/compose.serialization-test.yaml'
    [IO.File]::WriteAllText($serializationOverride,"services:`n  app:`n    image: $image`n    pull_policy: never`n",(New-Object Text.UTF8Encoding($false)))
    $samples=@('space # hash $ dollar " double '' single','trailing\','backslash\''quote','100% ! & | < > ^ ` ( ) ${UNDEFINED} 中文')
    foreach ($sample in $samples) {
        foreach ($key in @('DB_PASSWORD','MYSQL_ROOT_PASSWORD','APP_AUTH_PASSWORD')) { $values[$key]=$sample }
        Write-TestConfig $testFile $values
        $parsed=Get-LocalConfig (Get-ComposeArguments 'passenger-flow-serialization-test' $testFile)
        Check 'special-character Compose roundtrip' ($parsed.services.app.environment.DB_PASSWORD -ceq $sample -and $parsed.services.db.environment.MYSQL_ROOT_PASSWORD -ceq $sample -and $parsed.services.app.environment.APP_AUTH_PASSWORD -ceq $sample)
        $probe="let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const v=JSON.parse(s);if(process.env.DB_PASSWORD!==v||process.env.APP_AUTH_PASSWORD!==v)process.exitCode=1})"
        $serializationArgs=Get-ComposeArguments 'passenger-flow-serialization-test' $testFile
        $runtime=Invoke-Docker ($serializationArgs+@('-f',$serializationOverride,'run','--rm','--no-deps','-T','app','node','-e',$probe)) 30 (ConvertTo-Json -InputObject $sample -Compress)
        Check ('special-character values reach real app container unchanged (exit='+$runtime.Code+')') ($runtime.Code -eq 0)
    }
    if ($IncludeFaultTests) {
        # A third independent volume is used solely to prove the old-volume password trap.
        $suffix=[DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
        $faultProject='passenger-flow-docker-credentials-test-'+$suffix
        $faultFile=Join-Path $script:ProjectRoot ('reports/.env.credentials-test-'+$suffix)
        foreach ($key in @('DB_PASSWORD','MYSQL_ROOT_PASSWORD','APP_AUTH_PASSWORD')) { $values[$key]=New-LocalPassword }
        Write-TestConfig $faultFile $values
        $faultCompose=Get-ComposeArguments $faultProject $faultFile
        Check 'credential fixture DB starts' ((Invoke-Docker ($faultCompose+@('up','-d','db')) 90).Code -eq 0)
        $deadline=[DateTime]::UtcNow.AddSeconds(120)
        do { $login=Test-DatabaseLogin $faultCompose; if ($login -eq 'PASS') { break }; Start-Sleep -Seconds 2 } while ([DateTime]::UtcNow -lt $deadline)
        Check 'credential fixture first password works' ($login -eq 'PASS')
        $values.DB_PASSWORD=New-LocalPassword # Recreate container; the same fixture volume retains the old account password.
        Write-TestConfig $faultFile $values
        Check 'credential fixture reconfigured without deleting volume' ((Invoke-Docker ($faultCompose+@('up','-d','db')) 90).Code -eq 0)
        Start-Sleep -Seconds 5
        Check 'changed env does not silently change persisted DB password' ((Test-DatabaseLogin $faultCompose) -eq 'ACCESS_DENIED')
        Start-Sleep -Seconds 40
        $state=Get-ContainerState $faultCompose 'db'
        Check 'bad credentials cannot report healthy' ($state.State.Health.Status -ne 'healthy')
        [void](Invoke-Docker ($faultCompose+@('stop','--timeout','45')) 60)
        $report.faultVolumeRetained=$faultProject+'_mysql_data'
        # Exercise the actual Windows entrypoint on our isolated acceptance volume.
        $saved=[IO.File]::ReadAllBytes($file)
        $backup=Join-Path $script:ProjectRoot ('reports/.env.acceptance-before-fault-test-'+$suffix)
        $backupStream=[IO.File]::Open($backup,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try { $backupStream.Write($saved,0,$saved.Length) } finally { $backupStream.Dispose() }
        $report.acceptanceConfigBackup=$backup
        try {
            $text=[Text.Encoding]::UTF8.GetString($saved)
            $replacement='DB_PASSWORD='+(ConvertTo-EnvLiteral (New-LocalPassword))
            $text=[regex]::Replace($text,'(?m)^DB_PASSWORD=.*$',$replacement)
            [IO.File]::WriteAllText($file,$text,(New-Object Text.UTF8Encoding($false)))
            $oldPause=$env:PASSENGER_NO_PAUSE; $env:PASSENGER_NO_PAUSE='1'
            $output=& cmd.exe /c 'start-docker-acceptance.bat -NoBuild' 2>&1
            $exitCode=$LASTEXITCODE
            if ($null -eq $oldPause) { Remove-Item Env:PASSENGER_NO_PAUSE } else { $env:PASSENGER_NO_PAUSE=$oldPause }
            Check 'actual start BAT rejects bad DB password' ($exitCode -eq 1 -and ($output -join '').Contains('数据库认证被拒绝'))
            $failed=Get-Content -LiteralPath (Join-Path $script:ProjectRoot 'reports/passenger-flow-docker-acceptance-verify.json') -Raw | ConvertFrom-Json
            Check 'failed startup cannot leave a previous PASS report' ($failed.status -eq 'FAIL' -and $failed.failedStage -eq 'database-business-login')
        } finally {
            [IO.File]::WriteAllBytes($file,$saved)
            $env:PASSENGER_NO_PAUSE='1'
            $recovered=& cmd.exe /c 'start-docker-acceptance.bat -NoBuild' 2>&1
            Check 'restore acceptance config and startup succeeds' ($LASTEXITCODE -eq 0)
        }
    }
    $report.status='PASS'
} finally {
    $report.finishedAt=[DateTime]::UtcNow.ToString('o')
    $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $script:ProjectRoot 'reports/docker-integration.json') -Encoding UTF8
}
