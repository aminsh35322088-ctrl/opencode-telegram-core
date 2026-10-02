$ErrorActionPreference='Stop'
$taskCore='C:/Users/Admin/Documents/ChatGPT/opencode-telegram-core-source/aminsh35322088-ctrl-opencode-telegram-core-7d605b3'
$taskUpstream='C:/Users/Admin/AppData/Local/Temp/codex-upstream-pause-source/opencode-51ef4be1d3c122f18fefb510dca8d778571f4f18'
$taskBase=Join-Path $env:TEMP ('codex-provenance-baseline-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskBase | Out-Null
tar -xf "$env:TEMP/codex-opencode-51ef4be.tar.gz" -C $taskBase
if($LASTEXITCODE -ne 0){throw 'tar failed'}
$taskTree=Join-Path $taskBase 'opencode-51ef4be1d3c122f18fefb510dca8d778571f4f18'
$taskPaths=@('packages/core/src/event.ts','packages/opencode/src/event-v2-bridge.ts','packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts','packages/opencode/src/server/routes/instance/httpapi/api.ts','packages/opencode/src/server/routes/instance/httpapi/groups/global.ts')
$taskRunState='packages/opencode/src/session/run-state.ts'
$taskSchedulerPaths=@('packages/opencode/src/session/prompt.ts','packages/opencode/src/tool/task.ts','packages/opencode/test/session/prompt.test.ts','packages/opencode/test/tool/task.test.ts')
Push-Location $taskTree
try {
git init -q
git -c core.autocrlf=false add -- @taskPaths @taskSchedulerPaths $taskRunState
git -c user.name=Codex -c user.email=codex@local -c core.autocrlf=false commit -qm 'Locked upstream provenance baseline'
foreach($taskPath in (@($taskPaths)+@($taskSchedulerPaths)+@($taskRunState))) { [IO.File]::WriteAllText((Join-Path $taskTree $taskPath),[IO.File]::ReadAllText((Join-Path $taskUpstream $taskPath)).Replace("`r`n","`n"),[Text.UTF8Encoding]::new($false)) }
function Get-TaskDiff([string[]]$Paths) {
$taskInfo=[Diagnostics.ProcessStartInfo]::new('git'); $taskInfo.WorkingDirectory=$taskTree; $taskInfo.UseShellExecute=$false; $taskInfo.RedirectStandardOutput=$true; $taskInfo.RedirectStandardError=$true
foreach($taskArg in @('-c','core.autocrlf=false','diff','--binary','HEAD','--')+$Paths){$taskInfo.ArgumentList.Add($taskArg)}
$taskProcess=[Diagnostics.Process]::Start($taskInfo); $taskResult=$taskProcess.StandardOutput.ReadToEnd(); $taskError=$taskProcess.StandardError.ReadToEnd();$taskProcess.WaitForExit()
if($taskProcess.ExitCode -ne 0){throw $taskError}
return $taskResult
}
$taskPatch6=Get-TaskDiff $taskPaths
[IO.File]::WriteAllText((Join-Path $taskCore 'patches/0002-telegram-subagent-scheduler.patch'),(Get-TaskDiff $taskSchedulerPaths),[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $taskCore 'patches/0006-telegram-event-provenance.patch'),$taskPatch6,[Text.UTF8Encoding]::new($false))
$taskPatch4Path=Join-Path $taskCore 'patches/0004-telegram-session-execution.patch'
$taskPatch4=[IO.File]::ReadAllText($taskPatch4Path)
$taskStart=$taskPatch4.IndexOf('diff --git a/packages/opencode/src/session/run-state.ts ')
$taskEnd=$taskPatch4.IndexOf('diff --git a/packages/opencode/src/session/session.ts ',$taskStart)
if($taskStart -lt 0 -or $taskEnd -lt 0){throw 'patch4 section missing'}
[IO.File]::WriteAllText($taskPatch4Path,$taskPatch4.Substring(0,$taskStart)+(Get-TaskDiff @($taskRunState))+$taskPatch4.Substring($taskEnd),[Text.UTF8Encoding]::new($false))
$taskSeries=Join-Path $taskCore 'patches/series'
$taskSeriesText=[IO.File]::ReadAllText($taskSeries).Replace("`r`n","`n").TrimEnd()+"`n"
if(!$taskSeriesText.Contains('0006-telegram-event-provenance.patch')){$taskSeriesText+="0006-telegram-event-provenance.patch`n"}
[IO.File]::WriteAllText($taskSeries,$taskSeriesText,[Text.UTF8Encoding]::new($false))
git -c core.autocrlf=false restore --worktree -- @taskPaths @taskSchedulerPaths $taskRunState
foreach($taskPatch in [IO.File]::ReadAllLines($taskSeries)) {
if(!$taskPatch){continue}
git apply --check --whitespace=error (Join-Path $taskCore ('patches/'+$taskPatch))
if($LASTEXITCODE -ne 0){throw "patch check failed: $taskPatch"}
git apply (Join-Path $taskCore ('patches/'+$taskPatch))
if($LASTEXITCODE -ne 0){throw "patch apply failed: $taskPatch"}
Write-Output "Verified $taskPatch"
}
Write-Output "Baseline/preflight: $taskTree"
} finally {Pop-Location}
