#!/usr/bin/env bash
# مراقب على المضيف: ينتظر إشارة زر «تحديث خريطة الملاحة» من السوبر أدمن (nav-map.request)
# ثم ينفّذ osrm-update.sh. آمن: لا حاوية ويب تملك وصول Docker — الـAPI يُسقِط ملف إشارة فقط،
# وهذا المراقب (على المضيف) هو من يملك صلاحية Docker. يعمل كخدمة systemd دائمة.
set -uo pipefail

OPS="/home/ubuntu/pickly-ops"
REQ="$OPS/nav-map.request"
STATUS="$OPS/nav-map.status.json"
SCRIPT="/home/ubuntu/pickly/infra/vm/osrm-update.sh"

mkdir -p "$OPS"
chmod 777 "$OPS" 2>/dev/null || true
# حالة ابتدائية إن لم توجد
[ -f "$STATUS" ] || printf '{"state":"idle","step":"","message":"لم يُحدَّث بعد في هذه الجلسة","at":""}\n' > "$STATUS"

while true; do
  if [ -f "$REQ" ]; then
    rm -f "$REQ"
    bash "$SCRIPT" || true
  fi
  sleep 8
done
