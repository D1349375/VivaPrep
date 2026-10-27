$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskEnvironment = Join-Path $taskRoot '.data/speech-venv'
$taskModel = Join-Path $taskRoot '.data/speech-model/small'
if (-not (Test-Path -LiteralPath (Join-Path $taskEnvironment 'Scripts/python.exe'))) {
    & python -m venv $taskEnvironment
    if ($LASTEXITCODE -ne 0) { throw 'Unable to create the local speech environment.' }
}
$taskPython = Join-Path $taskEnvironment 'Scripts/python.exe'
& $taskPython -m pip install -r (Join-Path $PSScriptRoot 'speech-requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Speech dependency installation failed.' }
& $taskPython -c 'import sys; from faster_whisper import download_model; download_model("small", output_dir=sys.argv[1])' $taskModel
if ($LASTEXITCODE -ne 0) { throw 'Whisper model download failed.' }
Write-Output 'Local speech recognition is ready. Restart the VivaPrep server.'
