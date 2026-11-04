# Enter existing Staging keys in masked fields; stdin only, never CLI/env/files.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference='Stop'
$taskRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$form=New-Object Windows.Forms.Form
$form.Text='Staging acceptance - memory only'
$form.Size=New-Object Drawing.Size(610,300)
$form.StartPosition='CenterScreen'
$fields=@{}
$entries=@(@('anon','Staging publishable / anon key (public)'),@('admin','Staging existing legacy service_role key (secret)'))
for($i=0;$i -lt $entries.Count;$i++){
 $label=New-Object Windows.Forms.Label;$label.Text=$entries[$i][1];$label.Location=New-Object Drawing.Point(20,(15+$i*75));$label.Size=New-Object Drawing.Size(550,20);$form.Controls.Add($label)
 $box=New-Object Windows.Forms.TextBox;$box.UseSystemPasswordChar=$true;$box.Location=New-Object Drawing.Point(20,(40+$i*75));$box.Size=New-Object Drawing.Size(550,24);$form.Controls.Add($box);$fields[$entries[$i][0]]=$box
}
$publicEnv=Join-Path $taskRoot '.env.staging.local'
if(Test-Path -LiteralPath $publicEnv){
 $publicMatch=[regex]::Match([IO.File]::ReadAllText($publicEnv),'(?m)^VITE_SUPABASE_ANON_KEY=([^\r\n]+)$')
 if($publicMatch.Success){$fields.anon.Text=$publicMatch.Groups[1].Value}
 $publicMatch=$null
}
$button=New-Object Windows.Forms.Button;$button.Text='Connect Staging (identity GET only)';$button.Location=New-Object Drawing.Point(20,190);$button.Size=New-Object Drawing.Size(350,35);$form.Controls.Add($button)
$button.Add_Click({
 try{
  $button.Enabled=$false
  $info=New-Object Diagnostics.ProcessStartInfo
  $info.FileName=(Get-Command node.exe).Source
  $scriptPath=Join-Path $taskRoot 'scripts/qa/staging-acceptance-memory.mjs'
  $info.Arguments=([char]34+$scriptPath+[char]34+' --private-stdin')
  $info.WorkingDirectory=$taskRoot;$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
  $script:qaChild=New-Object Diagnostics.Process;$script:qaChild.StartInfo=$info;[void]$script:qaChild.Start()
  $payload=@{anon=$fields.anon.Text;admin=$fields.admin.Text}|ConvertTo-Json -Compress
  $script:qaChild.StandardInput.WriteLine($payload);$script:qaChild.StandardInput.Close();$payload=$null
  $line=$script:qaChild.StandardOutput.ReadLine()
  if($line -eq 'READY'){foreach($f in $fields.Values){$f.Clear()};$form.Close()}
  else{if(-not $script:qaChild.HasExited){$script:qaChild.Kill()};$script:qaChild.Dispose();$script:qaChild=$null;$button.Text='Blocked - verify exact Staging keys';$button.Enabled=$true}
 }catch{$button.Text='Start failed';$button.Enabled=$true}
})
try{[void]$form.ShowDialog();if($script:qaChild){$script:qaChild.WaitForExit()}}
finally{foreach($f in $fields.Values){$f.Clear()};$payload=$null;$form.Dispose();if($script:qaChild){if(-not $script:qaChild.HasExited){$script:qaChild.Kill()};$script:qaChild.Dispose()}}
