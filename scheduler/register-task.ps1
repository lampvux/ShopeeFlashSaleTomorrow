# Đăng ký Windows Task Scheduler: chạy mỗi ngày lúc 20:00 (giờ máy).
# Chạy trong PowerShell (không cần quyền Admin):
#   powershell -ExecutionPolicy Bypass -File scheduler\register-task.ps1
#   powershell -ExecutionPolicy Bypass -File scheduler\register-task.ps1 -At "20:00"
param(
  [string]$At = "20:00",
  [string]$TaskName = "ShopeeFlashSaleTomorrow"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$cmd  = Join-Path $root "scheduler\run-daily.cmd"
if (-not (Test-Path $cmd)) { throw "Không thấy $cmd" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Chưa cài Node.js (https://nodejs.org) hoặc node chưa có trong PATH" }

$action   = New-ScheduledTaskAction -Execute $cmd -WorkingDirectory $root
$trigger  = New-ScheduledTaskTrigger -Daily -At $At
# WakeToRun: đánh thức máy nếu đang Sleep. StartWhenAvailable: lỡ giờ (máy tắt) thì chạy ngay khi bật lại.
$settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -MultipleInstances IgnoreNew `
            -ExecutionTimeLimit (New-TimeSpan -Hours 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
# Chạy với user hiện tại, chỉ khi đã đăng nhập Windows (cần để mở được cửa sổ Chrome)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description "Tạo Flash Sale Shopee cho tất cả khung giờ ngày mai (3 shop)" -Force | Out-Null

Write-Host "Đã đăng ký task '$TaskName' chạy lúc $At mỗi ngày."
Write-Host "Chạy thử ngay:  Start-ScheduledTask -TaskName $TaskName"
Write-Host "Xem log:        $root\logs\scheduler.log"
