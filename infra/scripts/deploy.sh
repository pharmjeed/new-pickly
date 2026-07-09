#!/usr/bin/env bash
# pnpm deploy:staging | deploy:production
# يتطلب: gcloud مسجل الدخول + مشروع GCP (HUMAN-ACTIONS A2) + terraform apply (مرحلة 9)
set -euo pipefail

ENV="${1:?الاستخدام: deploy.sh staging|production}"

if [[ "$ENV" != "staging" && "$ENV" != "production" ]]; then
  echo "بيئة غير معروفة: $ENV" >&2
  exit 1
fi

TFVARS="infra/terraform/environments/$ENV.tfvars"
if [[ ! -f "$TFVARS" ]]; then
  cat >&2 <<EOF
لا يوجد $TFVARS بعد.
النشر يُستكمل في المرحلة 9 (Terraform GCP) وبعد إنجاز HUMAN-ACTIONS.md:
  A2 (مشروع GCP) ← ثم terraform apply ← ثم هذا السكربت يبني ويدفع صور api/worker وينشر Cloud Run.
EOF
  exit 1
fi

echo "🔨 build & push images ($ENV)…"
PROJECT_ID="$(grep -oP 'project_id\s*=\s*"\K[^"]+' "$TFVARS")"
REGION="$(grep -oP 'region\s*=\s*"\K[^"]+' "$TFVARS")"
TAG="$(git rev-parse --short HEAD)"
REPO="$REGION-docker.pkg.dev/$PROJECT_ID/pickly"

for svc in api worker; do
  docker build -f "infra/docker/$svc.Dockerfile" -t "$REPO/$svc:$TAG" .
  docker push "$REPO/$svc:$TAG"
  gcloud run deploy "pickly-$svc-$ENV" \
    --image "$REPO/$svc:$TAG" \
    --region "$REGION" \
    --project "$PROJECT_ID" \
    --quiet
done

echo "✅ نُشر $ENV بالوسم $TAG — للتراجع: gcloud run services update-traffic بالمراجعة السابقة"
