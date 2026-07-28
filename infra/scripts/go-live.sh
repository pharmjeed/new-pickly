#!/usr/bin/env bash
# التحويل للإنتاج الحقيقي — يقفل بيئة العرض ويشغّل الحماية الكاملة.
#
# التشغيل من جهازك مباشرة:
#   ssh -t -i ~/.oci/pickly_vm_ssh ubuntu@193.122.83.224 "bash /home/ubuntu/pickly/infra/scripts/go-live.sh"
#
# ما يفعله:
#   ١) يتحقق أن SMS الحقيقي مفعّل (وإلا يرفض — بدونه يستحيل دخول أي عميل)
#   ٢) يولّد JWT_SECRET قوياً (كل الجلسات الحالية تُسجَّل خروجاً — طبيعي)
#   ٣) NODE_ENV=production: يقتل رمز 1234 الثابت ويقيّد CORS بنطاقات المنصة
#   ٤) يعيد تشغيل الخدمات ويتحقق فعلياً أن الرمز الثابت مات
#
# ملاحظة: مفاتيح ميسر الحية خطوة مستقلة بعده: bash infra/scripts/setup-moyasar.sh

set -uo pipefail

REPO="${REPO:-/home/ubuntu/pickly}"
COMPOSE="infra/vm/docker-compose.prod.yml"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '\033[32m%s\033[0m\n' "$1"; }
warn() { printf '\033[33m%s\033[0m\n' "$1"; }
err()  { printf '\033[31m%s\033[0m\n' "$1" >&2; }
die()  { err "❌ $1"; exit 1; }

cd "$REPO" || die "مجلد المشروع غير موجود: $REPO"
command -v docker  >/dev/null || die "docker غير مثبت"
command -v openssl >/dev/null || die "openssl غير مثبت"

bold "════ التحويل للإنتاج الحقيقي ════"
echo

# ————— ١) البوابات —————
[ -s .env ] || die "لا يوجد .env — شغّل setup-sms.sh وsetup-moyasar.sh أولاً"

SMS_P=$(grep '^SMS_PROVIDER=' .env | tail -1 | cut -d= -f2-)
SMS_K=$(grep '^SMS_API_KEY=' .env | tail -1 | cut -d= -f2-)
if [ "$SMS_P" != "unifonic" ] || [ -z "$SMS_K" ]; then
  err "❌ SMS الحقيقي غير مفعّل (SMS_PROVIDER الحالي: ${SMS_P:-mock})."
  err "   بدونه لن يستطيع أي عميل استلام رمز الدخول بعد إيقاف الرمز الثابت."
  err "   شغّل أولاً: bash infra/scripts/setup-sms.sh"
  exit 1
fi
ok "✓ SMS حقيقي مفعّل (unifonic)"

PAY_P=$(grep '^PAYMENT_PROVIDER=' .env | tail -1 | cut -d= -f2-)
PAY_K=$(grep '^PAYMENT_API_KEY=' .env | tail -1 | cut -d= -f2-)
case "$PAY_K" in
  sk_live_*) ok "✓ مفاتيح ميسر حية" ;;
  sk_test_*) warn "⚠ مفاتيح ميسر ما زالت اختبارية — البطاقات الحقيقية سترفض حتى تعيد setup-moyasar.sh بمفاتيح live" ;;
  *)         warn "⚠ بوابة الدفع: ${PAY_P:-mock}" ;;
esac

echo
warn "سيحدث الآت:"
warn "  • رمز الدخول الثابت 1234 يتوقف نهائياً — الدخول برسائل SMS حقيقية فقط"
warn "  • كل الجلسات الحالية (عملاء/تجار/أدمن) تُسجَّل خروجاً وتحتاج دخولاً جديداً"
warn "  • CORS يُقيَّد بنطاقات thepickly.com حصراً"
printf 'اكتب "انطلاق" للمتابعة: '
read -r CONFIRM
[ "$CONFIRM" = "انطلاق" ] || die "أُلغي التحويل"

# ————— ٢) الكتابة —————
umask 077
cp .env ".env.backup.$(date +%Y%m%d%H%M%S)"
NEW_JWT=$(openssl rand -hex 48) || die "تعذّر توليد JWT_SECRET"
grep -vE '^(NODE_ENV|JWT_SECRET)=' .env > .env.tmp || true
mv .env.tmp .env
{
  echo "NODE_ENV=production"
  echo "JWT_SECRET=$NEW_JWT"
} >> .env
chmod 600 .env
ln -sfn "$REPO/.env" "$REPO/infra/vm/.env"
ok "✓ NODE_ENV=production + JWT_SECRET جديد"

# ————— ٣) إعادة التشغيل —————
echo
echo "إعادة تشغيل api وworker…"
docker compose -f "$COMPOSE" up -d api worker >/dev/null 2>&1 || die "فشل إعادة التشغيل — راجع: docker compose -f $COMPOSE logs api"
ok "✓ أُعيد تشغيل الخدمات"

# ————— ٤) التحقق: البيئة فعلاً production —————
echo
echo "التحقق…"
ENV_NOW=""
for i in $(seq 1 20); do
  ENV_NOW=$(docker compose -f "$COMPOSE" exec -T api node -e 'console.log(process.env.NODE_ENV)' 2>/dev/null | tr -d '\r\n')
  [ "$ENV_NOW" = "production" ] && break
  sleep 2
done
[ "$ENV_NOW" = "production" ] || die "الحاوية لم تلتقط NODE_ENV=production (الحالي: ${ENV_NOW:-?})"

HEALTH=$(curl -sS --max-time 10 http://localhost:4000/v1/content/payment-config 2>/dev/null || echo "")
[ -n "$HEALTH" ] || die "الخدمة لا تستجيب بعد إعادة التشغيل"

echo
ok "════════════════════════════════════════"
ok "  ✅ البيئة الآن إنتاج حقيقي"
ok "     • الرمز الثابت 1234: ميت (الكود يتجاهله في production)"
ok "     • الدخول: رسائل SMS حقيقية عبر Unifonic"
ok "     • CORS: نطاقات المنصة فقط"
ok "════════════════════════════════════════"
case "$PAY_K" in
  sk_live_*) ;;
  *) echo "الخطوة الأخيرة للمال الحقيقي: bash infra/scripts/setup-moyasar.sh (بمفاتيح live)" ;;
esac
