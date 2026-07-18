#!/usr/bin/env bash
# إعداد سيرفر Ubuntu (Oracle Always Free ARM أو أي VPS) لتشغيل Pickly كاملاً.
# يُنفَّذ مرة واحدة على السيرفر:
#   curl -fsSL https://raw.githubusercontent.com/pharmjeed/new-pickly/main/infra/vm/setup-vm.sh | bash
set -euo pipefail

echo "🐳 [1/5] تثبيت Docker..."
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER"
fi

echo "📥 [2/5] جلب المستودع..."
if [ ! -d "$HOME/pickly" ]; then
  git clone https://github.com/pharmjeed/new-pickly.git "$HOME/pickly"
fi
cd "$HOME/pickly"
git pull --ff-only || true

echo "🔥 [3/5] فتح المنافذ في جدار السيرفر المحلي..."
# ملاحظة Oracle: افتح نفس المنافذ أيضاً من لوحة Oracle (VCN → Security List → Ingress)
if command -v iptables >/dev/null; then
  for p in 3000 3001 3002 3003 3004 4000; do
    sudo iptables -I INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null || true
  done
  sudo netfilter-persistent save 2>/dev/null || true
fi

echo "🏗️ [4/5] بناء وتشغيل كل الخدمات (يأخذ ~10-20 دقيقة أول مرة)..."
sudo docker compose -f infra/vm/docker-compose.prod.yml up -d --build

echo "🗄️ [5/5] الهجرات والبيانات التجريبية..."
sudo docker compose -f infra/vm/docker-compose.prod.yml exec -T api \
  sh -c "cd packages/database && npx prisma migrate deploy && npx tsx prisma/seed/index.ts"

IP=$(curl -s ifconfig.me || echo "SERVER_IP")
echo ""
echo "✅ بيكلي يعمل الآن:"
echo "   العميل  http://$IP:3000   (جوال 0500000001 · رمز 1234)"
echo "   التاجر  http://$IP:3001   (جوال 0520000001)"
echo "   الفرع   http://$IP:3002   (101 / cashier101 / 1234)"
echo "   الأدمن  http://$IP:3003   (جوال 0510000001)"
echo "   الموقع  http://$IP:3004"
echo ""
echo "⚠️ تذكير Oracle: أضف Ingress Rules للمنافذ 3000-3004 و4000 من لوحة التحكم أيضاً."
