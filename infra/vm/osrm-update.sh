#!/usr/bin/env bash
# تحديث خريطة الملاحة (OSRM) — ينفّذه المراقب على المضيف عند ضغط زر السوبر أدمن.
# ينزّل خريطة الخليج/السعودية، يعالجها في staging، ثم يبدّلها ويعيد تشغيل خدمة osrm
# بأقل انقطاع. يكتب تقدّمه في nav-map.status.json ليقرأه الـAPI ويعرضه في اللوحة.
set -uo pipefail

IMG="ghcr.io/project-osrm/osrm-backend:latest"
VOL="vm_osrmdata"
COMPOSE="/home/ubuntu/pickly/infra/vm/docker-compose.prod.yml"
PBF_URL="https://download.geofabrik.de/asia/gcc-states-latest.osm.pbf"
OPS="/home/ubuntu/pickly-ops"
STATUS="$OPS/nav-map.status.json"
TMP="/tmp/osrm-update"

mkdir -p "$OPS" "$TMP"

# كتابة الحالة كـJSON (رسائل عربية UTF-8) ليقرأها الـAPI
write_status() {
  local state="$1" step="$2" msg="$3"
  local now; now="$(date -u +%FT%TZ)"
  printf '{"state":"%s","step":"%s","message":"%s","at":"%s"}\n' "$state" "$step" "$msg" "$now" > "$STATUS"
}

fail() {
  write_status "error" "${STEP:-}" "${1:-فشل التحديث}"
  # حاول إعادة تشغيل الخدمة إن كانت متوقفة أثناء التبديل
  docker compose -f "$COMPOSE" start osrm >/dev/null 2>&1 || true
  exit 1
}
trap 'fail "خطأ غير متوقع أثناء $STEP"' ERR

STEP="download"
write_status "running" "$STEP" "جارٍ تنزيل أحدث خريطة…"
rm -f "$TMP/region.osm.pbf"
curl -fsSL -o "$TMP/region.osm.pbf" "$PBF_URL"
# تحقّق أن الملف خريطة فعلية لا صفحة خطأ (> 50MB)
sz=$(stat -c%s "$TMP/region.osm.pbf" 2>/dev/null || echo 0)
[ "$sz" -gt 52428800 ] || fail "تنزيل الخريطة غير مكتمل (حجم غير متوقع)"

STEP="extract"
write_status "running" "$STEP" "معالجة الخريطة (استخلاص الطرق)…"
docker run --rm -v "$VOL":/data -v "$TMP":/host --entrypoint sh "$IMG" \
  -c "mkdir -p /data/staging && cp /host/region.osm.pbf /data/staging/saudi.osm.pbf"
docker run --rm -v "$VOL":/data "$IMG" osrm-extract -p /opt/car.lua /data/staging/saudi.osm.pbf

STEP="partition"
write_status "running" "$STEP" "معالجة الخريطة (تقسيم)…"
docker run --rm -v "$VOL":/data "$IMG" osrm-partition /data/staging/saudi.osrm

STEP="customize"
write_status "running" "$STEP" "معالجة الخريطة (تخصيص)…"
docker run --rm -v "$VOL":/data "$IMG" osrm-customize /data/staging/saudi.osrm

STEP="swap"
write_status "running" "$STEP" "تفعيل الخريطة الجديدة…"
docker compose -f "$COMPOSE" stop osrm >/dev/null 2>&1 || true
# بدّل ملفات .osrm الجديدة مكان القديمة داخل الـvolume
docker run --rm -v "$VOL":/data --entrypoint sh "$IMG" -c '
  set -e
  rm -f /data/saudi.osrm* /data/saudi.osm.pbf
  mv /data/staging/saudi.osrm* /data/
  mv /data/staging/saudi.osm.pbf /data/ 2>/dev/null || true
  rm -rf /data/staging
'
docker compose -f "$COMPOSE" start osrm >/dev/null 2>&1 || fail "تعذّر إعادة تشغيل خدمة الملاحة"

# انتظر جهوز المحرك ثم تحقّق بمسار تجريبي داخل المدينة المنورة
STEP="verify"
write_status "running" "$STEP" "التحقّق من المحرك…"
ok=0
for i in $(seq 1 20); do
  if docker compose -f "$COMPOSE" exec -T api node -e "fetch('http://osrm:5000/route/v1/driving/39.6142,24.4686;39.6180,24.4410?overview=false').then(r=>r.json()).then(j=>process.exit(j.code==='Ok'?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    ok=1; break
  fi
  sleep 3
done
[ "$ok" = "1" ] || fail "المحرك لم يجهز بعد التحديث"

write_status "done" "done" "اكتمل تحديث خريطة الملاحة بنجاح"
rm -f "$TMP/region.osm.pbf"
exit 0
