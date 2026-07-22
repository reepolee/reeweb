# Registers reeweb to restart when this user logs on, using pm2 + a Scheduled Task.
# Run from a NORMAL (non-elevated) PowerShell:
#   .\operations\register_windows_service.ps1            - install and start
#   .\operations\register_windows_service.ps1 -Uninstall - remove task and pm2 app
#
# How it works: pm2 starts the app now and saves the process list (pm2 save).
# A Scheduled Task runs "pm2 resurrect" AT LOGON, in this user's interactive,
# non-elevated session. Because the pm2 daemon then lives in the same session
# (not session 0 / not elevated), "pm2 monit" works from a local terminal.
# Trade-off: the app comes up after the user logs in, not on a headless boot.
# No nssm/pm2-installer dependency.

param(
	[switch]$Uninstall
)

$ErrorActionPreference = "Stop"

$task_name = "reeweb-pm2-resurrect"
$project_root = Split-Path -Parent $PSScriptRoot
$ecosystem_config = Join-Path $project_root "operations\ecosystem.config.cjs"

$pm2_command = Get-Command pm2.cmd -ErrorAction SilentlyContinue
if (-not $pm2_command) {
	$pm2_command = Get-Command pm2 -ErrorAction SilentlyContinue
}
if (-not $pm2_command) {
	Write-Error "pm2 not found on PATH. Install it first: npm install -g pm2"
}
$pm2_path = $pm2_command.Source

# Must NOT run elevated: an elevated daemon owns a pipe that a normal local
# terminal cannot connect to (EPERM on \\.\pipe\rpc.sock), breaking pm2 monit.
$is_admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($is_admin) {
	Write-Error "Run this script from a NORMAL (non-elevated) PowerShell, so the pm2 daemon is reachable by local non-elevated terminals."
}

$current_user = "$env:USERDOMAIN\$env:USERNAME"

if ($Uninstall) {
	$existing_task = Get-ScheduledTask -TaskName $task_name -ErrorAction SilentlyContinue
	if ($existing_task) {
		Unregister-ScheduledTask -TaskName $task_name -Confirm:$false
		Write-Host "Removed scheduled task '$task_name'."
	} else {
		Write-Host "Scheduled task '$task_name' not found, nothing to remove."
	}
	& $pm2_path delete reeweb
	& $pm2_path save --force
	Write-Host "reeweb removed from pm2 and process list saved."
	exit 0
}

if (-not (Test-Path $ecosystem_config)) {
	Write-Error "Ecosystem config not found: $ecosystem_config"
}

# Start (or restart) the app and persist the pm2 process list.
& $pm2_path startOrRestart $ecosystem_config
if ($LASTEXITCODE -ne 0) {
	Write-Error "pm2 failed to start $ecosystem_config (exit $LASTEXITCODE)."
}
& $pm2_path save
if ($LASTEXITCODE -ne 0) {
	Write-Error "pm2 save failed (exit $LASTEXITCODE)."
}

# Scheduled task: run "pm2 resurrect" AT LOGON of this user, in the interactive
# (non-elevated) session so the daemon's pipe is reachable by local terminals.
$task_action = New-ScheduledTaskAction -Execute $pm2_path -Argument "resurrect" -WorkingDirectory $project_root
$task_trigger = New-ScheduledTaskTrigger -AtLogOn -User $current_user
$task_principal = New-ScheduledTaskPrincipal -UserId $current_user -LogonType Interactive -RunLevel Limited
$task_settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

$existing_task = Get-ScheduledTask -TaskName $task_name -ErrorAction SilentlyContinue
if ($existing_task) {
	Unregister-ScheduledTask -TaskName $task_name -Confirm:$false
}
Register-ScheduledTask -TaskName $task_name -Action $task_action -Trigger $task_trigger -Principal $task_principal -Settings $task_settings | Out-Null

Write-Host ""
Write-Host "Done. reeweb is running under pm2 and will resurrect when $current_user logs on."
Write-Host "Check status:   pm2 status"
Write-Host "Check monit:    pm2 monit"
Write-Host "Check the task: Get-ScheduledTask -TaskName $task_name"
