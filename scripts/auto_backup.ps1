# Daily backup to GitHub (user, 2026-10-25): commits whatever changed - data/ (new files
# too) and every already-tracked file - and pushes. Run by the Windows scheduled task
# "Shiur Studio - GitHub backup" (23:00, or at the next start if the PC was off).
# Log: backup.log next to this repo (not in git). Credentials stay out (.gitignore).
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$log = Join-Path $repo 'backup.log'
function Log($m) { Add-Content -Path $log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m" -Encoding utf8 }
Set-Location $repo
git add data config.json 2>$null
git add -u 2>$null
$staged = git diff --cached --name-only
if (-not $staged) { Log 'nothing changed'; exit 0 }
$n = ($staged | Measure-Object -Line).Lines
git commit -q -m "Auto backup $(Get-Date -Format 'yyyy-MM-dd') ($n files)" 2>$null
git push -q origin main 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { Log "pushed $n files" } else { Log "COMMITTED $n files but PUSH FAILED (exit $LASTEXITCODE) - run 'git push' by hand" }
