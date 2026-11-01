param([switch]$StopKnownQa,[int]$IgnoreOwnerPid=0,[string]$OutputStem='native-process')
$ErrorActionPreference='Stop'
$taskRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$evidenceDir=Join-Path $taskRoot '.tmp-b7-final-recovery'
if($OutputStem -notmatch '^[a-z0-9-]+$'){throw 'Invalid evidence name'}
[void][IO.Directory]::CreateDirectory($evidenceDir)
function Read-QaProcesses {
 $all=@(Get-CimInstance Win32_Process)
 $rootPattern=[regex]::Escape($taskRoot.Replace('/','\'))
 $known=@($all | Where-Object {
  $_.ProcessId -ne $IgnoreOwnerPid -and $_.Name -eq 'node.exe' -and $_.CommandLine -and
  $_.CommandLine.Replace('/','\') -match $rootPattern -and
  ($_.CommandLine -match 'b7-staging-memory-operator\.mjs' -or
   $_.CommandLine -match 'scripts[\\/]qa[\\/]b7-staging-vite\.mjs' -or
   ($_.CommandLine -match 'vite[\\/]bin[\\/]vite\.js' -and $_.CommandLine -match '--port\s+518[89](\s|$)'))
 })
 $known+=@($all | Where-Object {
  $_.Name -eq 'chrome.exe' -and $_.CommandLine -and
  $_.CommandLine.Replace('/','\') -match ($rootPattern+'[\\]\.tmp-b7-final-recovery[\\]native-profile-[a-zA-Z0-9]+') -and
  $_.CommandLine -match '--remote-debugging-address=127\.0\.0\.1' -and $_.CommandLine -match '--remote-debugging-port=\d+'
 })
 $ids=[Collections.Generic.HashSet[uint32]]::new()
 foreach($item in $known){[void]$ids.Add([uint32]$item.ProcessId)}
 do {$added=$false;foreach($item in $all){if($ids.Contains([uint32]$item.ParentProcessId) -and $ids.Add([uint32]$item.ProcessId)){$added=$true}}} while($added)
 $owned=@($all | Where-Object {$ids.Contains([uint32]$_.ProcessId)})
 $ambiguous=@($all | Where-Object {$_.Name -eq 'chrome.exe' -and $_.CommandLine -match '--remote-debugging-pipe' -and $_.CommandLine -match 'playwright_chromiumdev_profile' -and -not $ids.Contains([uint32]$_.ProcessId)})
 $ports=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object {$_.LocalPort -in @(5188,5189)} | Select-Object LocalPort,OwningProcess)
 [pscustomobject]@{observedAt=[DateTime]::UtcNow.ToString('o');processes=@($owned | ForEach-Object {[pscustomobject]@{id=$_.ProcessId;parent=$_.ParentProcessId;name=$_.Name;created=$_.CreationDate.ToUniversalTime().ToString('o')}});ambiguousQaChromeCount=$ambiguous.Count;listeners=$ports}
}
$before=Read-QaProcesses
$before | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $evidenceDir "$OutputStem-before.json") -Encoding UTF8
$stopped=@()
$exitedDuringStop=@()
if($StopKnownQa){
 foreach($item in @($before.processes | Sort-Object @{e={if($_.name -eq 'chrome.exe'){0}else{1}}})){
  $live=Get-CimInstance Win32_Process -Filter "ProcessId=$($item.id)"
  if(-not $live){continue}
  if($live.CreationDate.ToUniversalTime().ToString('o') -ne $item.created){throw 'PID identity changed; stop without touching it'}
  try {Stop-Process -Id $item.id -ErrorAction Stop;$stopped+=@($item.id)}
  catch {
   if($_.FullyQualifiedErrorId -notlike 'NoProcessFoundForGivenId*'){throw}
   $exitedDuringStop+=@($item.id)
  }
 }
}
$after=Read-QaProcesses
$pass=$after.processes.Count -eq 0 -and $after.listeners.Count -eq 0 -and $after.ambiguousQaChromeCount -eq 0
[pscustomobject]@{source='native Windows CIM and TCP listener reads, not operator status.json';selfPid=$PID;ignoredCurrentOperatorPid=$IgnoreOwnerPid;before=$before;stoppedExactOwnedPids=$stopped;exitedDuringStop=$exitedDuringStop;after=$after;oldQaRuntimeExited=$pass;credentialsRead=$false} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $evidenceDir "$OutputStem-audit.json") -Encoding UTF8
if($pass){Write-Host 'PASS: no known QA helper, descendants, ambiguous QA Chrome, or listeners on5188/5189.'}
else{Write-Host 'BLOCKED: retained native-process-audit.json; no ambiguous/unrelated processes were stopped.'}
