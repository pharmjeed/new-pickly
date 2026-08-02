#!/usr/bin/env bash
# نشر ذاتي: يسحب آخر main ويعيد بناء الخدمات المتأثرة فقط.
# يُشغَّل عبر systemd timer كل دقيقتين. لا يتطلب أي أسرار على GitHub.
#
# هذه النسخة المرجعية — المُشغَّلة فعلياً هي /home/ubuntu/pickly-autodeploy.sh
# على سيرفر الإنتاج. عدّل هنا أولاً ثم طبّق على السيرفر (راجع README-autodeploy.md).
#
# مبدأ جوهري (درس عطل 2026-08-01): أساس الـdiff هو آخر SHA نُشر «بنجاح»
# (الملف $STATE) لا HEAD — فلو فشل البناء لا يتقدم الأساس، وتُعاد محاولة
# الخدمات المتأثرة في التشغيلات التالية بدل أن تبقى قديمة بصمت.
set -uo pipefail

REPO="$HOME/pickly"
COMPOSE="infra/vm/docker-compose.prod.yml"
LOG="$HOME/pickly-autodeploy.log"
LOCK="/tmp/pickly-autodeploy.lock"
STATE="$HOME/.pickly-last-deployed"   # آخر SHA اكتمل نشره بنجاح

exec 9>"$LOCK"
flock -n 9 || { echo "$(date -Is) نشر آخر جارٍ — تخطّي" >>"$LOG"; exit 0; }

cd "$REPO" || exit 1

git fetch origin main --quiet 2>>"$LOG"
NEW=$(git rev-parse origin/main)

# الأساس: آخر نشر ناجح. HEAD قد يكون متقدماً عنه إن فشل بناء سابق.
LAST=""
[ -f "$STATE" ] && LAST=$(<"$STATE")
if [ -z "$LAST" ] || ! git cat-file -e "$LAST^{commit}" 2>/dev/null; then
  LAST=$(git rev-parse HEAD)          # أول تشغيل (أو ملف حالة تالف): الأساس هو المنشور حالياً
  printf '%s\n' "$LAST" >"$STATE"     # يُثبَّت قبل أي reset — وإلا ضاع أثر فشلٍ يقع في هذا التشغيل نفسه
fi

[ "$LAST" = "$NEW" ] && exit 0   # لا جديد ولا فشل سابق ينتظر

{
  echo "════════ $(date -Is)  $LAST → $NEW ════════"
  if [ "$LAST" != "$(git rev-parse HEAD)" ]; then
    echo "  ⟳ إعادة محاولة: HEAD تجاوز آخر نشر ناجح (فشل بناء سابق)"
  fi

  CHANGED=$(git diff --name-only "$LAST" "$NEW")
  echo "$CHANGED" | sed 's/^/  ± /'

  # تحديد الخدمات المتأثرة من المسارات المتغيّرة
  declare -A svc=()
  shared=0
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    case "$f" in
      packages/*|pnpm-lock.yaml|pnpm-workspace.yaml|package.json|tsconfig*|\
      infra/docker/*|infra/vm/Dockerfile.web|infra/vm/docker-compose.prod.yml) shared=1 ;;
      apps/customer-web/*) svc[customer-web]=1 ;;
      apps/merchant-web/*) svc[merchant-web]=1 ;;
      apps/branch-ops/*)   svc[branch-ops]=1 ;;
      apps/admin-web/*)    svc[admin-web]=1 ;;
      apps/site/*)         svc[site]=1 ;;
      apps/api/*|apps/worker/*) svc[api]=1; svc[worker]=1 ;;
    esac
  done <<< "$CHANGED"

  # البناء يحتاج الكود الجديد في الشجرة؛ تثبيت التقدم يكون في $STATE لا هنا
  git reset --hard "$NEW" --quiet

  if [ "$shared" = 1 ]; then
    SERVICES="api worker customer-web merchant-web branch-ops admin-web site"
    echo "  → كود مشترك تغيّر: إعادة بناء كل خدمات التطبيق"
  else
    SERVICES="${!svc[*]}"
  fi

  if [ -z "${SERVICES// }" ]; then
    printf '%s\n' "$NEW" >"$STATE"
    echo "  → لا خدمات تحتاج بناء (توثيق/اختبارات فقط) — تم السحب فقط"
    exit 0
  fi

  echo "  → بناء: $SERVICES"
  # --no-deps: لا نُعيد بناء/تشغيل التوابع (postgres/api/osrm) عند تغيّر خدمة واحدة فقط
  if docker compose -f "$COMPOSE" up -d --build --no-deps $SERVICES; then
    printf '%s\n' "$NEW" >"$STATE"   # التثبيت هنا حصراً — بعد نجاح البناء والتشغيل
    docker image prune -f >/dev/null 2>&1
    echo "  ✅ اكتمل النشر لـ$NEW"
  else
    echo "  ❌ فشل البناء — الأساس يبقى $LAST وستُعاد المحاولة في التشغيل القادم"
    exit 1
  fi
} >>"$LOG" 2>&1
