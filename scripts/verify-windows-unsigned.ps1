$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not [Environment]::Is64BitOperatingSystem) {
  throw 'Windows package verification requires a 64-bit operating system'
}

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
