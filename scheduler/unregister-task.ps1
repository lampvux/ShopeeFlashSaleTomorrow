param([string]$TaskName = "ShopeeFlashSaleTomorrow")
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "Đã xoá task '$TaskName'."
