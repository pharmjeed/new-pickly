#!/usr/bin/env bash
# تفعيل بوابة ميسر على السيرفر — خطوة واحدة تفاعلية.
#
# التشغيل من جهازك مباشرة:
#   ssh -t -i ~/.oci/pickly_vm_ssh ubuntu@193.122.83.224 "bash /home/ubuntu/pickly/infra/scripts/setup-moyasar.sh"
#
# --webhook-only: يقرأ المفاتيح من .env القائم، يولّد سر webhook جديداً ويسجّله
# لدى ميسر ويعيد تشغيل الخدمات — بلا أي إدخال تفاعلي (مناسب للتشغيل الآلي).
#
# يفعل كل شيء: يكتب .env بصلاحيات مغلقة، ويولّد سر webhook عشوائياً، ويسجّل
# الـwebhook لدى ميسر تلقائياً، ويعيد تشغيل api وworker، ثم يتحقق من النتيجة.
# المفتاح السري يُقرأ منك هنا مباشرة — لا يمر في سجل الأوامر ولا يُطبع أبداً.

set -uo pipefail

REPO="${REPO:-/home/ubuntu/pickly}"
COMPOSE="infra/vm/docker-compose.prod.yml"
WEBHOOK_URL="${WEBHOOK_URL:-https://api.thepickly.com/v1/webhooks/payments/moyasar}"

# --webhook-only: يقرأ المفاتيح من .env القائم ويعيد توليد سر الـwebhook وتسجيله فقط
WEBHOOK_ONLY=false
[ "${1:-}" = "--webhook-only" ] && WEBHOOK_ONLY=true

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

if $WEBHOOK_ONLY; then
  [ -s .env ] || die "لا يوجد .env — شغّل التفعيل الكامل أولاً (بدون --webhook-only)"
  PK=$(grep '^PAYMENT_PUBLISHABLE_KEY=' .env | tail -1 | cut -d= -f2-)
  SK=$(grep '^PAYMENT_API_KEY=' .env | tail -1 | cut -d= -f2-)
  [ -n "$PK" ] && [ -n "$SK" ] || die "المفاتيح غير مكتملة في .env — شغّل التفعيل الكامل أولاً"
  echo "وضع الـwebhook فقط — المفاتيح من .env القائم (${PK%"${PK#????????}"}…)"
fi

# ————— ١) المفاتيح —————
# اللصق من ويندوز/المتصفح قد يحمل سطوراً زائدة أو \r أو أحرفاً خفية (bidi/zero-width).
# مفاتيح ميسر حصراً [A-Za-z0-9_] — نحذف كل ما عداها.
trim() { printf '%s' "$1" | tr -cd 'A-Za-z0-9_'; }

# الخانة المخفية تغري باللصق المتكرر (لا شيء يظهر فيلصق المستخدم مراراً) —
# مفتاح ميسر شكله ثابت: بادئة + وضع + 40 حرفاً. نستخرج أول ظهور سليم.
extract_key() { # $1=النص $2=البادئة (pk|sk)
  printf '%s' "$1" | grep -oE "${2}_(test|live)_[A-Za-z0-9]{40}" | head -1
}

if ! $WEBHOOK_ONLY; then

PK=""
while [ -z "$PK" ]; do
  printf 'المفتاح القابل للنشر (pk_...): '
  read -r PK
  PK=$(trim "$PK")
  [ -z "$PK" ] && continue
  FOUND=$(extract_key "$PK" pk)
  if [ -n "$FOUND" ]; then
    [ ${#PK} -gt 48 ] && warn "  (التُقط المفتاح من لصق متكرر/زائد — لا بأس)"
    PK="$FOUND"
  else
    warn "⚠ لم أتعرف على مفتاح معلن سليم (pk_test_/pk_live_ + 40 حرفاً) — حاول مجدداً"
    PK=""
  fi
done

SK=""
while [ -z "$SK" ]; do
  printf 'المفتاح السري (sk_... — الصقه مرة واحدة ثم Enter؛ لن يظهر وهذا طبيعي): '
  read -rs SK
  echo
  SK=$(trim "$SK")
  [ -z "$SK" ] && continue
  FOUND=$(extract_key "$SK" sk)
  if [ -n "$FOUND" ]; then
    [ ${#SK} -gt 48 ] && warn "  (التُقط المفتاح من لصق متكرر/زائد — لا بأس)"
    SK="$FOUND"
  else
    warn "⚠ لم أتعرف على مفتاح سري سليم (sk_test_/sk_live_ + 40 حرفاً) — طوله بعد التنظيف ${#SK}"
    SK=""
    continue
  fi
  # تحقق حي لدى ميسر — يكشف مفتاحاً قديماً جُدّد في اللوحة قبل كتابته للسيرفر
  AUTH_CODE=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -u "$SK:" "https://api.moyasar.com/v1/payments?per=1" 2>/dev/null || echo "000")
  case "$AUTH_CODE" in
    401)
      warn "⚠ ميسر رفضت هذا المفتاح (401)."
      warn "  المُدخل بعد التنظيف: ${SK%"${SK#????????}"}… وطوله ${#SK} حرفاً (المتوقع نحو 48)."
      if [ ${#SK} -lt 40 ]; then
        warn "  المفتاح ناقص — استخدم زر النسخ 📋 بجوار المفتاح في اللوحة بدل التحديد اليدوي."
      else
        warn "  الطول سليم لكن ميسر لا تعرفه — تأكد أنه المفتاح الحالي ومن نفس الحساب/الوضع."
      fi
      SK=""
      ;;
    000) warn "⚠ تعذّر الوصول لميسر للتحقق — سنتابع على مسؤوليتك" ;;
    *)   ok "✓ المفتاح السري صالح لدى ميسر" ;;
  esac
done

# وضع حي؟ تأكيد صريح — بيئة العرض فيها رمز OTP ثابت يفتح أي حساب
case "$SK" in
  sk_live_*)
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

fi # WEBHOOK_ONLY يتخطى إدخال المفاتيح

case "$SK" in sk_live_*) MODE="حي" ;; *) MODE="اختبار" ;; esac

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
  warn "  احذفه من لوحة ميسر (Webhooks) ثم أعد: bash $0 --webhook-only"
else
  # بلا قائمة أحداث = مستمع شامل لكل الأحداث الحالية والمستقبلية (توصية وثائق ميسر) —
  # المعالج لدينا يترجم ما يعرفه ويستنتج البقية من حالة العملية.
  RESP=$(curl -sS -w '\n%{http_code}' -u "$SK:" \
    -H 'Content-Type: application/json' \
    -d "{\"url\":\"$WEBHOOK_URL\",\"http_method\":\"post\",\"shared_secret\":\"$WH\"}" \
    https://api.moyasar.com/v1/webhooks 2>/dev/null)
  CODE=$(printf '%s' "$RESP" | tail -1)
  if [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; then
    ok "✓ سُجّل الـwebhook تلقائياً (مستمع شامل) — لا حاجة للوحة ميسر"
  else
    warn "⚠ تعذّر التسجيل التلقائي (رمز $CODE) — ردّ ميسر:"
    printf '%s\n' "$RESP" | head -n -1 | head -c 500
    echo
    warn "  أضفه يدوياً من لوحة ميسر → Webhooks بالرابط: $WEBHOOK_URL"
    warn "  والسر موجود على السيرفر في .env (PAYMENT_WEBHOOK_SECRET) — لا تنسخه من أي محادثة."
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
