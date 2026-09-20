# Downloads the mihomo core that Zephyr bundles as a sidecar.
# The binary is not committed (61 MB), so run this once after cloning.
$ErrorActionPreference = "Stop"

$version = "v1.19.31"
$triple = "x86_64-pc-windows-msvc"
$dest = Join-Path $PSScriptRoot "..\src-tauri\binaries"
$target = Join-Path $dest "mihomo-$triple.exe"

if (Test-Path $target) {
    Write-Host "Core already present: $target"
    exit 0
}

New-Item -ItemType Directory -Force $dest | Out-Null
$zip = Join-Path $env:TEMP "mihomo-$version.zip"
$url = "https://github.com/MetaCubeX/mihomo/releases/download/$version/mihomo-windows-amd64-$version.zip"

Write-Host "Downloading mihomo $version ..."
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

$work = Join-Path $env:TEMP "mihomo-$version"
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive -Path $zip -DestinationPath $work -Force

$exe = Get-ChildItem "$work\*.exe" | Select-Object -First 1
Copy-Item $exe.FullName $target -Force
Remove-Item $zip, $work -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Core ready: $target"
& $target -v
