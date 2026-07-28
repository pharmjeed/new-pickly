#!/usr/bin/env bash
# تفعيل SMS الحقيقي (Unifonic) على السيرفر — خطوة واحدة تفاعلية.
#
# التشغيل من جهازك مباشرة:
#   ssh -t -i ~/.oci/pickly_vm_ssh ubuntu@193.122.83.224 "bash /home/ubuntu/pickly/infra/scripts/setup-sms.sh"
#
# يكتب SMS_PROVIDER/SMS_API_KEY/SMS_SENDER_NAME في .env بصلاحيات مغلقة، يعيد
# تشغيل api وworker، ثم يجري اختبار إرسال حقيقياً على جوالك للتأكد من الوصول.
# المفتاح يُقرأ منك هنا مباشرة — لا يمر في سجل الأوامر ولا يُطبع أبداً.

set -uo pipefail

REPO="${REPO:-/home/ubuntu/pickly}"
COMPOSE="infra/vm/docker-compose.prod.yml"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '\033[32m%s\033[0m\n' "$1"; }
warn() { printf '\033[33m%s\033[0m\n' "$1"; }
err()  { printf '\033[31m%s\033[0m\n' "$1" >&2; }
die()  { err "❌ $1"; exit 1; }

cd "$REPO" || die "مجلد المشروع غير موجود: $REPO"
command -v docker >/dev/null || die "docker غير مثبت"
command -v curl   >/dev/null || die "curl غير مثبت"

bold "════ تفعيل SMS الحقيقي (Unifonic) ════"
echo
echo "تحتاج من لوحة Unifonic (cloud.unifonic.com):"
echo "  - AppSid لتطبيق SMS (من Dev Tools → Applications)"
echo "  - اسم مرسِل معتمد لدى CITC (مثل Pickly)"
echo

# ————— ١) المفتاح واسم المرسل —————
SK=""
while [ -z "$SK" ]; do
  printf 'AppSid (الصقه مرة واحدة ثم Enter؛ لن يظهر وهذا طبيعي): '
  read -rs SK
  echo
  SK=$(printf '%s' "$SK" | tr -cd 'A-Za-z0-9_-')
  [ -z "$SK" ] && continue
  if [ ${#SK} -lt 10 ]; then
    warn "⚠ المُدخل قصير (${#SK} حرفاً) — تأكد من نسخ AppSid كاملاً"
    SK=""
  fi
done

printf 'اسم المرسِل [Pickly]: '
read -r SENDER
SENDER=$(printf '%s' "${SENDER:-Pickly}" | tr -cd 'A-Za-z0-9 _-')

# ————— ٢) كتابة .env —————
umask 077
touch .env
cp .env ".env.backup.$(date +%Y%m%d%H%M%S)" 2>/dev/null || true
grep -vE '^(SMS_PROVIDER|SMS_API_KEY|SMS_SENDER_NAME)=' .env > .env.tmp || true
mv .env.tmp .env
{
  echo "SMS_PROVIDER=unifonic"
  echo "SMS_API_KEY=$SK"
  echo "SMS_SENDER_NAME=$SENDER"
} >> .env
chmod 600 .env
ln -sfn "$REPO/.env" "$REPO/infra/vm/.env"
unset SK
ok "✓ كُتب .env بصلاحيات 600"

# ————— ٣) إعادة تشغيل الخدمات —————
echo
echo "إعادة تشغيل api وworker…"
docker compose -f "$COMPOSE" up -d api worker >/dev/null 2>&1 || die "فشل إعادة التشغيل — راجع: docker compose -f $COMPOSE logs api"
ok "✓ أُعيد تشغيل الخدمات"
sleep 5

# ————— ٤) اختبار إرسال حقيقي —————
echo
echo "اختبار الإرسال: سنطلب رمز دخول لجوالك عبر Unifonic فعلياً."
warn "ملاحظة: ما دام النظام على وضع العرض، الرمز المرسل سيكون 1234 — المهم وصول الرسالة."
printf 'رقم جوالك (05xxxxxxxx) أو Enter للتخطي: '
read -r PHONE
if [ -n "$PHONE" ]; then
  RESP=$(curl -sS -w '\n%{http_code}' -H 'Content-Type: application/json' \
    -d "{\"phone\":\"$PHONE\"}" http://localhost:4000/v1/auth/otp/request 2>/dev/null)
  CODE=$(printf '%s' "$RESP" | tail -1)
  if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
    ok "✓ طُلب الإرسال — راقب جوالك خلال لحظات."
    echo "  إن لم تصل الرسالة: راجع لوحة Unifonic (الرصيد + اعتماد اسم المرسل) ثم:"
    echo "  docker compose -f $COMPOSE logs api | grep -i sms"
  else
    warn "⚠ الطلب رُفض (رمز $CODE):"
    printf '%s\n' "$RESP" | head -n -1 | head -c 300
    echo
    warn "  (429 = حد المحاولات — انتظر ساعة أو جرّب رقماً آخر)"
  fi
fi

echo
ok "════════════════════════════════════════"
ok "  ✅ SMS الحقيقي مفعّل (Unifonic — $SENDER)"
ok "════════════════════════════════════════"
echo "الخطوة التالية للتحويل الكامل للإنتاج: bash infra/scripts/go-live.sh"
