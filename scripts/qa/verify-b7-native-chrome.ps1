param([int]$CandidatePid,[int]$ExpectedLauncherPid,[int]$Port,[string]$Profile,[string]$StartedAt)
$ErrorActionPreference='Stop'
$taskRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$allowedRoot=(Join-Path $taskRoot '.tmp-b7-final-recovery')+[IO.Path]::DirectorySeparatorChar
$resolved=(Resolve-Path -LiteralPath $Profile).Path
if(-not $resolved.StartsWith($allowedRoot,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolved) -notlike 'native-profile-*'){throw 'Unexpected QA profile scope'}
$item=Get-CimInstance Win32_Process -Filter "ProcessId=$CandidatePid"
if(-not $item -or $item.Name -ne 'chrome.exe' -or $item.ParentProcessId -ne $ExpectedLauncherPid){throw 'Chrome parent identity mismatch'}
if(-not $item.CommandLine.Contains($resolved) -or -not $item.CommandLine.Contains("--remote-debugging-port=$Port")){throw 'Chrome profile/port identity mismatch'}
if($item.CreationDate.ToUniversalTime() -lt ([DateTime]::Parse($StartedAt).ToUniversalTime().AddSeconds(-1))){throw 'Chrome process predates this launch'}
[pscustomobject]@{pid=$item.ProcessId;parent=$item.ParentProcessId;created=$item.CreationDate.ToUniversalTime().ToString('o');exactQaChrome=$true;profileAndPortAndLaunchTimeVerified=$true} | ConvertTo-Json -Compress
