# تشغيل Pickly كاملاً بنقرة واحدة — يفتح كل خادم في نافذة مستقلة
# الاستخدام: كليك يمين على الملف ← Run with PowerShell (أو من طرفية: .\start-all.ps1)
$root = $PSScriptRoot

Write-Host "🐳 تشغيل الحاويات (postgres + redis + mailhog)..." -ForegroundColor Cyan
docker compose up -d
if ($LASTEXITCODE -ne 0) {
  Write-Host "⚠️  Docker غير جاهز — افتح Docker Desktop أولاً وانتظر أيقونة الحوت ثم أعد التشغيل" -ForegroundColor Yellow
  Read-Host "اضغط Enter للخروج"
  exit 1
}

$apps = @(
  @{ n = "API + Worker";  c = "pnpm dev" },
  @{ n = "العميل 3000";   c = "pnpm --filter @pickly/customer-web dev" },
  @{ n = "التاجر 3001";   c = "pnpm --filter @pickly/merchant-web dev" },
  @{ n = "الفرع 3002";    c = "pnpm --filter @pickly/branch-ops dev" },
  @{ n = "الأدمن 3003";   c = "pnpm --filter @pickly/admin-web dev" },
  @{ n = "الموقع 3004";   c = "pnpm --filter @pickly/site dev" }
)
foreach ($a in $apps) {
  Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root'; `$host.UI.RawUI.WindowTitle='Pickly — $($a.n)'; $($a.c)"
}

Write-Host ""
Write-Host "✅ انطلقت الخوادم — انتظر ~30 ثانية ثم افتح:" -ForegroundColor Green
Write-Host "   العميل  http://localhost:3000   (جوال 0500000001 · رمز 1234)"
Write-Host "   التاجر  http://localhost:3001   (جوال 0520000001 · رمز 1234)"
Write-Host "   الفرع   http://localhost:3002   (BB-OLAYA / BB-OLAYA-cashier / 1234)"
Write-Host "   الأدمن  http://localhost:3003   (جوال 0510000001 · رمز 1234)"
Write-Host "   الموقع  http://localhost:3004"
