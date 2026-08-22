$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not [Environment]::Is64BitOperatingSystem) {
  throw 'Windows package verification requires a 64-bit operating system'
}

# GitHub's pwsh runner can pass its PowerShell 7 module path to this Windows
# PowerShell process. Load the in-box security module from this process's own
# installation so Get-AuthenticodeSignature cannot resolve to that incompatible
# inherited module.
$securityModule = Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1'
Import-Module -Name $securityModule -Force

$package = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
$files = @(
  'dist\win-unpacked\Wren.exe',
  "dist\Wren-Setup-$($package.version)-unsigned-x64.exe"
)

foreach ($file in $files) {
  $item = Get-Item -LiteralPath $file
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Refusing reparse-point release file: $file"
  }
  $signature = Get-AuthenticodeSignature -LiteralPath $item.FullName
  if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::NotSigned) {
    throw "Expected an unsigned file, but $file has signature status $($signature.Status)"
  }
}

Write-Host "Verified that $($files -join ', ') have no Authenticode signature"
