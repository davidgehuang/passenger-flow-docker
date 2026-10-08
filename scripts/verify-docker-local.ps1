param([switch] $Acceptance)
& (Join-Path $PSScriptRoot 'docker-local.ps1') -Action Verify -Acceptance:$Acceptance
exit $LASTEXITCODE
