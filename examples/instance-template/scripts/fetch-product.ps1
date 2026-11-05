<#
.SYNOPSIS
Downloads the Origo Map Stories release pinned in product.version, verifies
it and unpacks it into .product\<version>\.

.DESCRIPTION
The zip's sha256 must equal PRODUCT_SHA256 in product.version. The release's
.sha256 file (when present) and the SHA256SUMS list inside the zip are checked
too. Works in Windows PowerShell 5.1 and PowerShell 7.

.PARAMETER BundlePath
A release zip downloaded by hand. Without it the release is downloaded with
the GitHub CLI (gh).

.PARAMETER OutDir
Where to download and unpack (default: .product in the repository root).

.EXAMPLE
powershell -ExecutionPolicy Bypass -File scripts\fetch-product.ps1

.EXAMPLE
powershell -ExecutionPolicy Bypass -File scripts\fetch-product.ps1 -BundlePath C:\Downloads\origo-map-stories-1.0.0.zip
#>
[CmdletBinding()]
param(
    [string]$BundlePath,
    [string]$OutDir
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$DefaultRepo = 'Sundsvallskommun/origo-map-stories'
$Root = Split-Path -Parent $PSScriptRoot
$VersionFile = Join-Path $Root 'product.version'
if (-not $OutDir) { $OutDir = Join-Path $Root '.product' }

function Fail([string]$Message) {
    throw "fetch-product: $Message"
}

# NAME=value settings from product.version (last one wins).
function Read-Settings([string]$Path) {
    $settings = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') {
            $settings[$Matches[1]] = $Matches[2].Trim()
        }
    }
    return $settings
}

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

if (-not (Test-Path -LiteralPath $VersionFile -PathType Leaf)) { Fail "missing $VersionFile" }
$settings = Read-Settings $VersionFile

$tag = if ($settings.ContainsKey('PRODUCT_VERSION')) { $settings['PRODUCT_VERSION'] } else { '' }
$expected = if ($settings.ContainsKey('PRODUCT_SHA256')) { $settings['PRODUCT_SHA256'].ToLowerInvariant() } else { '' }
$repo = if ($settings.ContainsKey('PRODUCT_REPO') -and $settings['PRODUCT_REPO']) { $settings['PRODUCT_REPO'] } else { $DefaultRepo }

if (-not $tag) { Fail 'PRODUCT_VERSION is not set in product.version' }
if ($tag -notmatch '^v\d') { Fail "PRODUCT_VERSION must be a release tag such as v1.0.0, got '$tag'" }
$version = $tag.Substring(1)
$zipName = "origo-map-stories-$version.zip"
$downloadDir = Join-Path $OutDir 'downloads'
$zip = Join-Path $downloadDir $zipName
$zipSha = "$zip.sha256"
New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null

if ($BundlePath) {
    if (-not (Test-Path -LiteralPath $BundlePath -PathType Leaf)) { Fail "bundle not found: $BundlePath" }
    if ((Split-Path -Leaf $BundlePath) -ne $zipName) {
        Write-Warning "$(Split-Path -Leaf $BundlePath) is not named $zipName; the checksum decides"
    }
    Copy-Item -LiteralPath $BundlePath -Destination $zip -Force
    if (Test-Path -LiteralPath $zipSha) { Remove-Item -LiteralPath $zipSha -Force }
    if (Test-Path -LiteralPath "$BundlePath.sha256" -PathType Leaf) {
        Copy-Item -LiteralPath "$BundlePath.sha256" -Destination $zipSha -Force
    }
}
else {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        Fail 'the GitHub CLI (gh) is not installed; download the release by hand and use -BundlePath <zip>'
    }
    Write-Host "Downloading $tag from $repo ..."
    & gh release download $tag -R $repo -p 'origo-map-stories-*.zip*' -D $downloadDir --clobber
    if ($LASTEXITCODE -ne 0) { Fail "gh release download failed (exit code $LASTEXITCODE)" }
}

if (-not (Test-Path -LiteralPath $zip -PathType Leaf)) { Fail "$zipName was not found in the release $tag" }

$actual = Get-Sha256 $zip

if (Test-Path -LiteralPath $zipSha -PathType Leaf) {
    $published = ((Get-Content -LiteralPath $zipSha -TotalCount 1) -split '\s+')[0].ToLowerInvariant()
    if ($published -ne $actual) { Fail "$zipName does not match its .sha256 file (download corrupt?)" }
}

if (-not $expected) {
    Write-Host "PRODUCT_SHA256 is not set in product.version."
    Write-Host "  sha256 of ${zipName}: $actual"
    Write-Host "  Compare it with the .sha256 file on the release page of $tag, then pin it:"
    Write-Host "  PRODUCT_SHA256=$actual"
    Fail 'PRODUCT_SHA256 is not pinned'
}
if ($expected -ne $actual) { Fail "sha256 mismatch for ${zipName}: expected $expected, got $actual" }

$dest = Join-Path $OutDir $version
if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Expand-Archive -LiteralPath $zip -DestinationPath $dest -Force

$versionPath = Join-Path $dest 'VERSION'
if (-not (Test-Path -LiteralPath $versionPath -PathType Leaf)) { Fail 'the zip has no VERSION file; is it an Origo Map Stories release?' }
$packagedVersion = (Get-Content -LiteralPath $versionPath -Raw).Trim()
if ($packagedVersion -ne $version) { Fail "the zip contains version $packagedVersion, product.version pins $version" }

# SHA256SUMS: "<sha256>  <relative path>" per line (sha256sum format).
$sumsPath = Join-Path $dest 'SHA256SUMS'
if (-not (Test-Path -LiteralPath $sumsPath -PathType Leaf)) { Fail 'the zip has no SHA256SUMS file' }
$bad = @()
foreach ($line in Get-Content -LiteralPath $sumsPath) {
    if (-not $line.Trim()) { continue }
    if ($line -notmatch '^([0-9a-fA-F]{64}) [ *](.+)$') { Fail "unexpected line in SHA256SUMS: $line" }
    $hash = $Matches[1].ToLowerInvariant()
    $file = Join-Path $dest ($Matches[2] -replace '/', '\')
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { $bad += "$($Matches[2]) (missing)"; continue }
    if ((Get-Sha256 $file) -ne $hash) { $bad += $Matches[2] }
}
if ($bad.Count -gt 0) { Fail ("SHA256SUMS check failed inside the zip: " + ($bad -join ', ')) }

$buildShaPath = Join-Path $dest 'BUILD_SHA'
$buildSha = if (Test-Path -LiteralPath $buildShaPath) { (Get-Content -LiteralPath $buildShaPath -Raw).Trim() } else { 'unknown' }
Write-Host "Origo Map Stories $version (commit $buildSha) verified and unpacked:"
Write-Host "  $dest"
