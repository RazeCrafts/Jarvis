# Reusable Hermes Agent backup script.
# Usage: powershell -ExecutionPolicy Bypass -File backup-hermes.ps1
# Creates Hermes-Backup-<timestamp>.zip on the Desktop.
$ErrorActionPreference = "Continue"
$stage = Join-Path $env:TEMP ("hermes-backup-" + [guid]::NewGuid().ToString("N").Substring(0,8))
New-Item -ItemType Directory -Path $stage | Out-Null

robocopy "$env:USERPROFILE\.hermes" "$stage\hermes-home" /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH | Out-Null

$heavy = @(
  "$env:LOCALAPPDATA\Hermes\installs",
  "$env:LOCALAPPDATA\Hermes\hermes-agent",
  "$env:LOCALAPPDATA\Hermes\tools",
  "$env:LOCALAPPDATA\Hermes\cache",
  "$env:LOCALAPPDATA\Hermes\audio_cache",
  "$env:LOCALAPPDATA\Hermes\image_cache",
  "$env:LOCALAPPDATA\Hermes\runtime"
)
robocopy "$env:LOCALAPPDATA\Hermes" "$stage\hermes-data" /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH /XD $heavy | Out-Null

$gpuCaches = @(
  "$env:APPDATA\Hermes\Cache",
  "$env:APPDATA\Hermes\Code Cache",
  "$env:APPDATA\Hermes\GPUCache",
  "$env:APPDATA\Hermes\GPUPersistentCache",
  "$env:APPDATA\Hermes\GrShaderCache",
  "$env:APPDATA\Hermes\ShaderCache",
  "$env:APPDATA\Hermes\DawnGraphiteCache",
  "$env:APPDATA\Hermes\DawnWebGPUCache"
)
robocopy "$env:APPDATA\Hermes" "$stage\hermes-app-profile" /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH /XD $gpuCaches | Out-Null

$stamp = Get-Date -Format "yyyy-MM-dd_HHmm"
$zip = Join-Path ([Environment]::GetFolderPath("Desktop")) "Hermes-Backup-$stamp.zip"
Compress-Archive -Path "$stage\*" -DestinationPath $zip -CompressionLevel Optimal -Force
Remove-Item -Recurse -Force $stage
Write-Output "Backup written to: $zip"
