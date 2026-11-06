param([string]$Script = 'tools/3d/build_interviewers_v2.py', [string]$Blend = '')
$taskTools = Join-Path $env:TEMP 'VivaPrep-MPFB-local-tools'
$taskProfile = Join-Path $taskTools 'blender-profile'
if (-not $env:MPFB_ADDON_PATH) { $env:MPFB_ADDON_PATH = Join-Path $taskProfile 'scripts/addons/mpfb' }
if (-not $env:MPFB_ASSET_ROOT) { $env:MPFB_ASSET_ROOT = Join-Path $taskTools 'asset-data' }
$env:MPFB_USER_DATA = Join-Path $taskTools 'mpfb-user'
$env:BLENDER_USER_CONFIG = Join-Path $taskProfile 'config'
$env:BLENDER_USER_SCRIPTS = Join-Path $taskProfile 'scripts'
$env:BLENDER_USER_DATAFILES = Join-Path $taskProfile 'datafiles'
$taskBlender = $env:BLENDER_EXE
if (-not $taskBlender) { $taskBlender = Join-Path (Get-ChildItem -LiteralPath $env:TEMP -Directory -Filter 'VivaPrep-Blender-5.2.2-*' | Select-Object -First 1 -ExpandProperty FullName) 'blender-5.2.2-windows-x64/blender.exe' }
if ($Blend) { & $taskBlender --background $Blend --python-exit-code 1 --python $Script } else { & $taskBlender --background --python-exit-code 1 --python $Script }
exit $LASTEXITCODE
