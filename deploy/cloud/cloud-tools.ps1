param(
  [ValidateSet('Validate','Preflight','Init','Plan','Apply','Export','Password','Publish')]
  [string]$Action='Validate',
  [ValidateSet('aws','tencent','bootstrap')]
  [string]$Platform='aws',
  [string]$Repository,
  [string]$Tag,
  [string]$Commit='manual',
  [string]$Bucket
)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$infraDir=Join-Path $projectRoot "infra\$Platform"
$localDir=Join-Path $projectRoot '.cloud-local'
[IO.Directory]::CreateDirectory($localDir) | Out-Null
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls $localDir /inheritance:r /grant:r "${identity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
if($LASTEXITCODE -ne 0){throw '无法限制.cloud-local目录权限'}
function Run-Checked([string]$Command,[string[]]$Arguments){
  & $Command @Arguments
  if($LASTEXITCODE -ne 0){throw "$Command 执行失败，退出码 $LASTEXITCODE"}
}
function Write-Utf8([string]$File,[string]$Body){
  [IO.File]::WriteAllText($File,$Body,(New-Object Text.UTF8Encoding($false)))
}
$secretFile=Join-Path $localDir "$Platform-admin.dpapi"
if($Action -eq 'Password'){
  if($Platform -eq 'bootstrap'){throw 'bootstrap不需要数据库密码'}
  $secure=Read-Host '输入数据库管理员密码（请同时保存到密码管理器）' -AsSecureString
  Write-Utf8 $secretFile ($secure | ConvertFrom-SecureString)
  Write-Host '已保存当前Windows用户专用DPAPI密文；不会写入tfvars。'
  exit 0
}
if($Action -eq 'Publish'){
  if($Repository -notmatch '^[0-9]{12}\.dkr\.ecr\.ap-east-1\.amazonaws\.com/[a-z0-9/-]+$'){throw '需要香港私有ECR完整仓库地址'}
  if(!$Tag){$Tag='manual-'+(Get-Date -Format 'yyyyMMdd-HHmmss')}
  if($Tag -notmatch '^[a-zA-Z0-9_.-]+$'){throw '标签无效'}
  $registry=$Repository.Split('/')[0]
  $token=& aws ecr get-login-password --region ap-east-1
  if($LASTEXITCODE -ne 0){throw '获取ECR短期令牌失败'}
  try {
    $token | & docker login --username AWS --password-stdin $registry
    if($LASTEXITCODE -ne 0){throw 'Docker登录失败'}
    Run-Checked docker @('build','--platform','linux/amd64','--build-arg',"GIT_COMMIT=$Commit",'-t',"${Repository}:$Tag",$projectRoot)
    Run-Checked docker @('push',"${Repository}:$Tag")
    $name=$Repository.Substring($registry.Length+1)
    $digest=& aws ecr describe-images --region ap-east-1 --repository-name $name --image-ids "imageTag=$Tag" --query 'imageDetails[0].imageDigest' --output text
    if($LASTEXITCODE -ne 0 -or $digest -notmatch '^sha256:[a-f0-9]{64}$'){throw '摘要读取失败'}
    Write-Host "部署镜像：$Repository@$digest"
  } finally { $token=$null; & docker logout $registry | Out-Null }
  exit 0
}
if($Action -eq 'Preflight'){
  Run-Checked terraform @('version')
  Run-Checked aws @('--version')
  Run-Checked docker @('version')
  if($Platform -eq 'aws'){
    Run-Checked aws @('ec2','describe-regions','--all-regions','--region','ap-east-1','--filters','Name=region-name,Values=ap-east-1','--query','Regions[].{Region:RegionName,Status:OptInStatus}','--output','table')
    Run-Checked aws @('rds','describe-db-engine-versions','--region','ap-east-1','--engine','mysql','--query',"DBEngineVersions[?starts_with(EngineVersion, '8.4.')].EngineVersion",'--output','table')
    Write-Host '按手册核对官方AMI发布者、规格、Marketplace条款，再锁定terraform.tfvars。没有创建资源。'
  }else{
    Write-Host '腾讯预检：按手册执行tccli DescribeImages、DescribeInstanceTypeConfigs、DescribeDBZoneConfig及InquiryPrice；Terraform plan继续校验镜像和规格。'
  }
  exit 0
}
if($Action -eq 'Validate'){
  foreach($p in @('bootstrap','aws','tencent')){
    $dir=Join-Path $projectRoot "infra\$p"
    Run-Checked terraform @("-chdir=$dir",'init','-backend=false','-input=false','-no-color')
    Run-Checked terraform @("-chdir=$dir",'validate','-no-color')
  }
  exit 0
}
if($Action -eq 'Init'){
  $args=@("-chdir=$infraDir",'init','-input=false')
  if($Platform -ne 'bootstrap'){$args+='-backend-config=backend.hcl'}
  Run-Checked terraform $args
  exit 0
}
if($Action -eq 'Export'){
  if($Platform -eq 'bootstrap'){throw 'bootstrap没有应用输出'}
  $output=& terraform "-chdir=$infraDir" output -json deployment
  if($LASTEXITCODE -ne 0){throw '请先创建资源'}
  Write-Utf8 (Join-Path $localDir "$Platform-deployment.json") ($output -join [Environment]::NewLine)
  Write-Host "已输出脱敏端点：.cloud-local\$Platform-deployment.json"
  exit 0
}
$varName=if($Platform -eq 'aws'){'TF_VAR_master_password'}else{'TF_VAR_root_password'}
$original=[Environment]::GetEnvironmentVariable($varName,'Process')
$ptr=[IntPtr]::Zero
try {
  if($Platform -eq 'bootstrap'){
    if($Action -eq 'Plan' -and !$Bucket){throw 'bootstrap Plan需要-Bucket 全球唯一名称'}
  }else{
    if(!(Test-Path $secretFile)){throw '请先执行Password保存管理员密码'}
    $secure=(Get-Content -LiteralPath $secretFile -Raw) | ConvertTo-SecureString
    $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    [Environment]::SetEnvironmentVariable($varName,[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr),'Process')
  }
  $plan=Join-Path $localDir "$Platform.tfplan"
  if($Action -eq 'Plan'){
    $args=@("-chdir=$infraDir",'plan','-input=false',"-out=$plan")
    if($Platform -eq 'bootstrap'){$args+="-var=bucket_name=$Bucket"}
    Run-Checked terraform $args
    Write-Host "请审核计划及报价。应用：cloud-tools.bat -Action Apply -Platform $Platform"
  }elseif($Action -eq 'Apply'){
    if(!(Test-Path $plan)){throw '必须先Plan'}
    $answer=Read-Host "会创建或修改付费云资源。输入 APPLY-$Platform 执行已审核计划"
    if($answer -cne "APPLY-$Platform"){throw '没有执行'}
    Run-Checked terraform @("-chdir=$infraDir",'apply','-input=false',$plan)
  }
}finally{
  [Environment]::SetEnvironmentVariable($varName,$original,'Process')
  if($ptr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
}
