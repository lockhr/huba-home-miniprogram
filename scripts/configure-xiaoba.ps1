$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$functionSource = Join-Path $projectRoot 'cloudfunctions\api'
$runtimePath = Join-Path $projectRoot 'miniprogram\config.local.json'
$legacySecretPath = Join-Path $functionSource 'ai.secret.local.json'
$secretVault = Join-Path $projectRoot '.local\secrets'
$vaultSecretPath = Join-Path $secretVault 'ai.secret.local.json'
$deployRoot = Join-Path $projectRoot '.local\deploy'
$staging = Join-Path $deployRoot ("xiaoba-" + [guid]::NewGuid().ToString('N'))
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)

function Read-SecretConfiguration {
  $candidate = if (Test-Path -LiteralPath $vaultSecretPath) { $vaultSecretPath } elseif (Test-Path -LiteralPath $legacySecretPath) { $legacySecretPath } else { $null }
  if ($candidate) {
    return [System.IO.File]::ReadAllText($candidate, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
  }

  $secureKey = Read-Host 'Paste the new DeepSeek API key (input is hidden)' -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
  try {
    return @{ apiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer); model = 'deepseek-v4-flash' }
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

$secret = Read-SecretConfiguration
$apiKey = ([string]$secret.apiKey).Trim()
$model = ([string]$secret.model).Trim()
if ([string]::IsNullOrWhiteSpace($apiKey) -or -not $apiKey.StartsWith('sk-')) {
  throw 'Invalid key format. Create a new key in the DeepSeek console and try again.'
}
if ([string]::IsNullOrWhiteSpace($model)) { $model = 'deepseek-v4-flash' }

$runtimeConfig = [System.IO.File]::ReadAllText($runtimePath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($runtimeConfig.envId)) { throw 'Cloud environment ID is missing.' }

try {
  $stagedFunction = Join-Path $staging 'functions\api'
  New-Item -ItemType Directory -Force $stagedFunction | Out-Null
  Get-ChildItem -LiteralPath $functionSource -Force | Where-Object {
    $_.Name -notin @('ai.secret.local.json', 'node_modules')
  } | Copy-Item -Destination $stagedFunction -Recurse -Force

  $cloudbaseConfig = @{
    '$schema' = 'https://static.cloudbase.net/cli/cloudbaserc.schema.json'
    version = '2.1'
    envId = $runtimeConfig.envId
    functionRoot = 'functions'
    functions = @(@{
      name = 'api'
      type = 'Event'
      handler = 'index.main'
      installDependency = $true
      ignore = @('ai.secret.local.json', 'ai.secret.local.json/**/*')
      envVariables = @{
        DEEPSEEK_API_KEY = '{{env.DEEPSEEK_API_KEY}}'
        DEEPSEEK_MODEL = '{{env.DEEPSEEK_MODEL}}'
      }
    })
  } | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText((Join-Path $staging 'cloudbaserc.json'), $cloudbaseConfig, $utf8WithoutBom)

  $env:DEEPSEEK_API_KEY = $apiKey
  $env:DEEPSEEK_MODEL = $model
  Push-Location $staging
  try {
    & tcb fn deploy api --force --install-dependency true
    if ($LASTEXITCODE -ne 0) { throw 'Cloud function deployment failed.' }
  } finally {
    Pop-Location
  }

  New-Item -ItemType Directory -Force $secretVault | Out-Null
  if (Test-Path -LiteralPath $legacySecretPath) {
    if (Test-Path -LiteralPath $vaultSecretPath) {
      $legacyHash = (Get-FileHash -LiteralPath $legacySecretPath -Algorithm SHA256).Hash
      $vaultHash = (Get-FileHash -LiteralPath $vaultSecretPath -Algorithm SHA256).Hash
      if ($legacyHash -ne $vaultHash) { throw 'Two different local AI secret files exist; refusing to discard either one.' }
      Remove-Item -LiteralPath $legacySecretPath -Force
    } else {
      Move-Item -LiteralPath $legacySecretPath -Destination $vaultSecretPath
    }
  }
  Write-Host 'XiaoBa deployed with cloud environment variables; no AI key was included in the function package.' -ForegroundColor Green
} finally {
  $env:DEEPSEEK_API_KEY = $null
  $env:DEEPSEEK_MODEL = $null
  $apiKey = $null
  $secret = $null
  $resolvedDeployRoot = [System.IO.Path]::GetFullPath($deployRoot)
  $resolvedStaging = [System.IO.Path]::GetFullPath($staging)
  if ($resolvedStaging.StartsWith($resolvedDeployRoot, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedStaging)) {
    Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
  }
}
