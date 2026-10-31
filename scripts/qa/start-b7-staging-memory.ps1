# Run manually in the normal Windows desktop. No key/password is persisted.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference='Stop'
$taskRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$form=New-Object Windows.Forms.Form
$form.Text='Staging QA - private memory input'
$form.Size=New-Object Drawing.Size(580,300)
$form.StartPosition='CenterScreen'
$form.TopMost=$true
$fields=@{}
$i=0
foreach($entry in @(@('admin','Staging legacy service_role key'),@('signingSecret','Staging Legacy JWT secret'))){
 $label=New-Object Windows.Forms.Label;$label.Text=$entry[1];$label.Location=New-Object Drawing.Point(20,(15+$i*70));$label.Size=New-Object Drawing.Size(520,20);$form.Controls.Add($label)
 $box=New-Object Windows.Forms.TextBox;$box.Name=$entry[0];$box.UseSystemPasswordChar=$true;$box.Location=New-Object Drawing.Point(20,(38+$i*70));$box.Size=New-Object Drawing.Size(520,24);$form.Controls.Add($box);$fields[$entry[0]]=$box;$i++
}
$note=New-Object Windows.Forms.Label;$note.Text='Staging only. Memory only. No migration or activation on launch.';$note.Location=New-Object Drawing.Point(20,160);$note.Size=New-Object Drawing.Size(520,30);$form.Controls.Add($note)
$start=New-Object Windows.Forms.Button;$start.Text='Connect Staging (memory only)';$start.Location=New-Object Drawing.Point(20,205);$start.Size=New-Object Drawing.Size(320,32);$form.Controls.Add($start)
$start.Add_Click({
 try {
  if($fields.admin.Text.Length -lt 30 -or $fields.signingSecret.Text.Length -lt 32){return}
  $start.Enabled=$false
  $info=New-Object Diagnostics.ProcessStartInfo
  $info.FileName=(Get-Command node.exe -ErrorAction Stop).Source
  $operator=Join-Path $taskRoot 'scripts/qa/b7-staging-memory-operator.mjs'
  $info.Arguments=([char]34+$operator+[char]34+' --private-stdin')
  $info.WorkingDirectory=$taskRoot;$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
  $script:qaChild=New-Object Diagnostics.Process;$script:qaChild.StartInfo=$info;[void]$script:qaChild.Start();$child=$script:qaChild
  $payload=@{admin=$fields.admin.Text;signingSecret=$fields.signingSecret.Text} | ConvertTo-Json -Compress
  $child.StandardInput.WriteLine($payload);$child.StandardInput.Flush();$child.StandardInput.Close();$payload=$null
  foreach($f in $fields.Values){$f.Clear()};$form.Close()
 } catch { $start.Enabled=$true;$start.Text='Failed to start - no credentials saved' }
})
try {
 [void]$form.ShowDialog()
 if($script:qaChild){
  while(-not $script:qaChild.StandardOutput.EndOfStream){
   $line=$script:qaChild.StandardOutput.ReadLine()
   # Only fixed messages are rendered. Never echo arbitrary child output.
   if($line -like 'READY:*'){Write-Host 'Staging ready (read-only QA check passed). Keep this PowerShell open.'}
   if($line -like 'BLOCKED:*'){Write-Host 'Staging connection blocked. See .tmp-b7-live/status.json (no credentials).'}
  }
  $line=$null;$script:qaChild.WaitForExit()
  if($script:qaChild.ExitCode -ne 0){Write-Host 'Staging QA blocked. Inspect .tmp-b7-live/status.json (no credentials).'}
 }
} finally {
 foreach($f in $fields.Values){$f.Clear()};$payload=$null;$form.Dispose()
 if($script:qaChild){if(-not $script:qaChild.HasExited){$script:qaChild.Kill()};$script:qaChild.Dispose()}
}
