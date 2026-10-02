$ErrorActionPreference = 'Stop'
$taskCore = 'C:/Users/Admin/Documents/ChatGPT/opencode-telegram-core-source/aminsh35322088-ctrl-opencode-telegram-core-7d605b3'
$taskUpstream = 'C:/Users/Admin/AppData/Local/Temp/codex-upstream-pause-source/opencode-51ef4be1d3c122f18fefb510dca8d778571f4f18'
$taskBase = Join-Path $env:TEMP ('codex-shell-timeout-baseline-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskBase | Out-Null
tar -xf "$env:TEMP/codex-opencode-51ef4be.tar.gz" -C $taskBase
if ($LASTEXITCODE -ne 0) { throw 'tar failed' }
$taskTree = Join-Path $taskBase 'opencode-51ef4be1d3c122f18fefb510dca8d778571f4f18'
$taskPath = 'packages/opencode/src/tool/shell.ts'
Push-Location $taskTree
try {
  git init -q
  git -c core.autocrlf=false add -- $taskPath
  git -c user.name=Codex -c user.email=codex@local -c core.autocrlf=false commit -qm 'Locked shell baseline'
  [IO.File]::WriteAllText((Join-Path $taskTree $taskPath), [IO.File]::ReadAllText((Join-Path $taskUpstream $taskPath)).Replace("`r`n", "`n"), [Text.UTF8Encoding]::new($false))
  $taskInfo = [Diagnostics.ProcessStartInfo]::new('git')
  $taskInfo.WorkingDirectory = $taskTree
  $taskInfo.UseShellExecute = $false
  $taskInfo.RedirectStandardOutput = $true
  $taskInfo.RedirectStandardError = $true
  foreach ($taskArg in @('-c', 'core.autocrlf=false', 'diff', '--binary', 'HEAD', '--', $taskPath)) { $taskInfo.ArgumentList.Add($taskArg) }
  $taskProcess = [Diagnostics.Process]::Start($taskInfo)
  $taskDiff = $taskProcess.StandardOutput.ReadToEnd()
  $taskError = $taskProcess.StandardError.ReadToEnd()
  $taskProcess.WaitForExit()
  if ($taskProcess.ExitCode -ne 0) { throw $taskError }
  $taskPatchPath = Join-Path $taskCore 'patches/0003-telegram-process-budget.patch'
  $taskPatch = [IO.File]::ReadAllText($taskPatchPath)
  $taskStart = $taskPatch.IndexOf('diff --git a/packages/opencode/src/tool/shell.ts ')
  $taskEnd = $taskPatch.IndexOf('diff --git a/packages/opencode/src/util/process.ts ', $taskStart)
  if ($taskStart -lt 0 -or $taskEnd -lt 0) { throw 'shell patch section missing' }
  [IO.File]::WriteAllText($taskPatchPath, $taskPatch.Substring(0, $taskStart) + $taskDiff + $taskPatch.Substring($taskEnd), [Text.UTF8Encoding]::new($false))
  git -c core.autocrlf=false restore --worktree -- $taskPath
  foreach ($taskName in [IO.File]::ReadAllLines((Join-Path $taskCore 'patches/series'))) {
    if (!$taskName) { continue }
    git apply --check --whitespace=error (Join-Path $taskCore ('patches/' + $taskName))
    if ($LASTEXITCODE -ne 0) { throw "Patch check failed: $taskName" }
    git apply (Join-Path $taskCore ('patches/' + $taskName))
    if ($LASTEXITCODE -ne 0) { throw "Patch apply failed: $taskName" }
    Write-Output "Verified $taskName"
  }
} finally { Pop-Location }
