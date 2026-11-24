param(
  [uri] $WebOrigin = 'https://dexter-granizados.vercel.app',
  [string] $ExpectedBundle,
  [switch] $ProtectedDeployment,
  [switch] $RequireRetryableSync
)

$ErrorActionPreference = 'Stop'
$productionOrigin = 'https://dexter-granizados.vercel.app'
$gateway = 'https://nglfyhcrpxuuqqnaeevf.supabase.co/functions/v1/dexter'
$origin = $WebOrigin.GetLeftPart([System.UriPartial]::Authority)
if ($WebOrigin.Scheme -ne 'https' -or $WebOrigin.AbsolutePath -ne '/') {
  throw 'Use the HTTPS origin of a Dexter deployment.'
}

function Get-WebAsset([string] $Path) {
  if ($ProtectedDeployment) {
    $body = & npx vercel curl $Path --deployment $origin --scope crisdevlopez -- --fail --silent --show-error --max-time 30
    if ($LASTEXITCODE -ne 0) { throw "Could not read $Path from $origin." }
    return $body -join "`n"
  }
  $body = (Invoke-WebRequest -Uri "$origin$Path" -UseBasicParsing -TimeoutSec 30).Content
  if ($body -is [byte[]]) { return [System.Text.Encoding]::UTF8.GetString($body) }
  return $body
}

$html = Get-WebAsset '/'
$match = [regex]::Match($html, 'src="(/assets/index-[\w-]+\.js)"')
if (!$match.Success) { throw 'The published HTML does not point to the Vite entry bundle.' }
$bundle = $match.Groups[1].Value
if ($ExpectedBundle -and $bundle -ne $ExpectedBundle) { throw "Unexpected entry bundle $bundle." }

$manifest = Get-WebAsset '/manifest.webmanifest' | ConvertFrom-Json
$worker = Get-WebAsset '/sw.js'
$javascript = Get-WebAsset $bundle
if ($manifest.display -ne 'standalone' -or !$worker.Contains($bundle.TrimStart('/')) -or !$worker.Contains('SKIP_WAITING')) {
  throw 'The PWA does not cache and activate the published bundle.'
}
if (!$javascript.Contains('nglfyhcrpxuuqqnaeevf.supabase.co') -or $javascript.Contains('http://127.0.0.1:5180')) {
  throw 'The published bundle has the wrong API configuration.'
}
if (!$ProtectedDeployment) {
  $cache = (Invoke-WebRequest -Uri "$origin/sw.js" -Method Head -UseBasicParsing -TimeoutSec 30).Headers['Cache-Control']
  if ($cache -notmatch 'no-cache') { throw 'The service worker must be revalidated.' }
}

$health = Invoke-WebRequest -Uri "$gateway/health" -Headers @{ Origin = $productionOrigin } -UseBasicParsing -TimeoutSec 30
$service = $health.Content | ConvertFrom-Json
if (!$service.ok -or $service.app -ne 'dexter' -or $health.Headers['Access-Control-Allow-Origin'] -ne $productionOrigin) {
  throw 'The production API failed the health or CORS check.'
}
if ($RequireRetryableSync -and !$service.retryableSync) { throw 'The API is missing support for retryable sync.' }
try {
  $anonymous = (Invoke-WebRequest -Uri "$gateway/snapshot" -UseBasicParsing -TimeoutSec 30).StatusCode
} catch {
  if (!$_.Exception.Response) { throw }
  $anonymous = [int] $_.Exception.Response.StatusCode
}
if ($anonymous -ne 401) { throw "Expected HTTP 401 for anonymous snapshot, received $anonymous." }

Write-Host "Web and PWA verified at $origin. Production API healthy."
Write-Output $bundle
