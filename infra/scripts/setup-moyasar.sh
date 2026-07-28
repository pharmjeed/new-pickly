#!/usr/bin/env bash
# تفعيل بوابة ميسر على السيرفر — خطوة واحدة تفاعلية.
#
# التشغيل من جهازك مباشرة:
#   ssh -t -i ~/.oci/pickly_vm_ssh ubuntu@193.122.83.224 "bash /home/ubuntu/pickly/infra/scripts/setup-moyasar.sh"
#
# يفعل كل شيء: يكتب .env بصلاحيات مغلقة، ويولّد سر webhook عشوائياً، ويسجّل
# الـwebhook لدى ميسر تلقائياً، ويعيد تشغيل api وworker، ثم يتحقق من النتيجة.
# المفتاح السري يُقرأ منك هنا مباشرة — لا يمر في سجل الأوامر ولا يُطبع أبداً.

set -uo pipefail

REPO="${REPO:-/home/ubuntu/pickly}"
COMPOSE="infra/vm/docker-compose.prod.yml"
WEBHOOK_URL="${WEBHOOK_URL:-https://api.thepickly.com/v1/webhooks/payments/moyasar}"
EVENTS='["payment_paid","payment_authorized","payment_captured","payment_faild","payment_voided","payment_refunded"]'

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '\033[32m%s\033[0m\n' "$1"; }
warn() { printf '\033[33m%s\033[0m\n' "$1"; }
err()  { printf '\033[31m%s\033[0m\n' "$1" >&2; }
die()  { err "❌ $1"; exit 1; }

cd "$REPO" || die "مجلد المشروع غير موجود: $REPO"
command -v docker >/dev/null || die "docker غير مثبت"
command -v curl   >/dev/null || die "curl غير مثبت"

bold "════ تفعيل بوابة ميسر ════"
echo

# ————— ١) المفاتيح —————
# اللصق من ويندوز قد يحمل سطراً زائداً أو \r — ننظّف المدخل ونعيد السؤال بدل الموت.
trim() { printf '%s' "$1" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'; }

PK=""
while [ -z "$PK" ]; do
  printf 'المفتاح القابل للنشر (pk_...): '
  read -r PK
  PK=$(trim "$PK")
  [ -z "$PK" ] && continue
  case "$PK" in
    pk_*) ;;
    *) warn "⚠ المفتاح القابل للنشر يجب أن يبدأ بـpk_ — حاول مجدداً"; PK="" ;;
  esac
done

SK=""
while [ -z "$SK" ]; do
  printf 'المفتاح السري (sk_... — لن يظهر): '
  read -rs SK
  echo
  SK=$(trim "$SK")
  [ -z "$SK" ] && continue
  case "$SK" in
    sk_*) ;;
    *) warn "⚠ المفتاح السري يجب أن يبدأ بـsk_ — حاول مجدداً"; SK="" ;;
  esac
done

# وضع حي؟ تأكيد صريح — بيئة العرض فيها رمز OTP ثابت يفتح أي حساب
MODE="اختبار"
case "$SK" in
  sk_live_*)
    MODE="حي"
    echo
    warn "⚠️  هذه مفاتيح حية — مال حقيقي من عملاء حقيقيين."
    warn "    وبيئة العرض الحالية رمز دخولها ثابت (1234) يفتح أي حساب."
    printf 'اكتب "نعم أفهم" للمتابعة: '
    read -r CONFIRM
    [ "$CONFIRM" = "نعم أفهم" ] || die "أُلغي التفعيل"
    ;;
esac

case "$PK$SK" in
  *pk_test_*sk_live_*|*pk_live_*sk_test_*) die "المفتاحان من وضعين مختلفين (اختبار مقابل حي) — استخدم زوجاً واحداً" ;;
esac

# ————— ٢) سر webhook عشوائي —————
WH=$(openssl rand -hex 24) || die "تعذّر توليد السر"

# ————— ٣) كتابة .env (نُبقي أي إعدادات أخرى موجودة) —————
umask 077
touch .env
if [ -s .env ]; then
  cp .env ".env.backup.$(date +%Y%m%d%H%M%S)"
  grep -vE '^(PAYMENT_PROVIDER|PAYMENT_API_KEY|PAYMENT_PUBLISHABLE_KEY|PAYMENT_WEBHOOK_SECRET|PAYMENT_MANUAL_CAPTURE)=' .env > .env.tmp || true
  mv .env.tmp .env
fi
{
  echo "PAYMENT_PROVIDER=moyasar"
  echo "PAYMENT_PUBLISHABLE_KEY=$PK"
  echo "PAYMENT_API_KEY=$SK"
  echo "PAYMENT_WEBHOOK_SECRET=$WH"
  echo "PAYMENT_MANUAL_CAPTURE=${PAYMENT_MANUAL_CAPTURE:-true}"
} >> .env
chmod 600 .env
# رابط رمزي بجوار ملف compose — يضمن قراءة .env أياً كان مجلد المشروع لدى docker
ln -sfn "$REPO/.env" "$REPO/infra/vm/.env"
ok "✓ كُتب .env بصلاحيات 600"

# ————— ٤) تسجيل الـwebhook لدى ميسر —————
echo
echo "تسجيل الـwebhook لدى ميسر…"
EXISTING=$(curl -sS -u "$SK:" https://api.moyasar.com/v1/webhooks 2>/dev/null || echo "")
if printf '%s' "$EXISTING" | grep -qF "$WEBHOOK_URL"; then
  warn "⚠ يوجد webhook بنفس الرابط مسبقاً — سرّه القديم لن يطابق السر الجديد."
  warn "  احذفه من لوحة ميسر ثم أعد تشغيل هذا الأمر، أو حدّث سرّه يدوياً إلى:"
  echo "  $WH"
else
  RESP=$(curl -sS -w '\n%{http_code}' -u "$SK:" \
    -H 'Content-Type: application/json' \
    -d "{\"url\":\"$WEBHOOK_URL\",\"http_method\":\"post\",\"shared_secret\":\"$WH\",\"events\":$EVENTS}" \
    https://api.moyasar.com/v1/webhooks 2>/dev/null)
  CODE=$(printf '%s' "$RESP" | tail -1)
  if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
    ok "✓ سُجّل الـwebhook تلقائياً — لا حاجة للوحة ميسر"
  else
    warn "⚠ تعذّر التسجيل التلقائي (رمز $CODE). أضفه يدوياً من لوحة ميسر:"
    echo "    الرابط:  $WEBHOOK_URL"
    echo "    السر:    $WH"
    echo "    الأحداث: payment_paid payment_authorized payment_captured payment_faild payment_voided"
  fi
fi
unset SK

# ————— ٥) إعادة تشغيل الخدمات —————
echo
echo "إعادة تشغيل api وworker…"
docker compose -f "$COMPOSE" up -d api worker >/dev/null 2>&1 || die "فشل إعادة التشغيل — راجع: docker compose -f $COMPOSE logs api"
ok "✓ أُعيد تشغيل الخدمات"

# ————— ٦) التحقق —————
echo
echo "التحقق…"
for i in $(seq 1 20); do
  CFG=$(curl -sS http://localhost:4000/v1/content/payment-config 2>/dev/null || echo "")
  printf '%s' "$CFG" | grep -q '"provider":"moyasar"' && break
  sleep 2
done

if printf '%s' "$CFG" | grep -q '"provider":"moyasar"'; then
  echo
  ok "════════════════════════════════════════"
  ok "  ✅ بوابة ميسر مفعّلة — وضع: $MODE"
  ok "════════════════════════════════════════"
  printf '%s\n' "$CFG"
  echo
  echo "الخطوة الأخيرة — شغّل جولة التحقق من جهازك:"
  echo "  node infra/scripts/verify-moyasar.mjs"
else
  err "⚠ الخدمة لم تلتقط الإعداد بعد."
  err "  الأرجح أن docker لم يقرأ .env — جرّب:"
  err "  cd $REPO && docker compose -f $COMPOSE --env-file $REPO/.env up -d api worker"
  err "  ثم: curl -s localhost:4000/v1/content/payment-config"
  exit 1
fi
