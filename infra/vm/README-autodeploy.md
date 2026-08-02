# النشر الذاتي (autodeploy) — المرجع

النشر إلى الإنتاج تلقائي بالكامل: أي push إلى `main` يلتقطه سيرفر Oracle
(`ubuntu@193.122.83.224`) عبر systemd timer كل دقيقتين، فيسحب ويعيد بناء
الخدمات المتأثرة فقط عبر `docker compose`.

## الملفات

| في المستودع (مرجع) | على السيرفر (المُشغَّل فعلياً) |
|---|---|
| `infra/vm/pickly-autodeploy.sh` | `/home/ubuntu/pickly-autodeploy.sh` |
| `infra/vm/pickly-autodeploy.service` | `/etc/systemd/system/pickly-autodeploy.service` |
| `infra/vm/pickly-autodeploy.timer` | `/etc/systemd/system/pickly-autodeploy.timer` |

> السيرفر **لا** يشغّل نسخة المستودع مباشرة — أي تعديل هنا يحتاج تطبيقاً
> يدوياً على السيرفر (أدناه). عدّل النسخة المرجعية أولاً ثم طبّق.

## كيف يعمل

1. `git fetch origin main` ثم حساب الملفات المتغيّرة بين **آخر SHA نُشر بنجاح**
   (الملف `~/.pickly-last-deployed`) و`origin/main`.
2. تحويل المسارات المتغيّرة إلى خدمات (`apps/customer-web/*` ← `customer-web`
   وهكذا؛ تغيّر `packages/*` أو ملفات الجذر المشتركة = إعادة بناء الكل).
3. `git reset --hard origin/main` (البناء يحتاج الكود الجديد في الشجرة).
4. `docker compose up -d --build --no-deps <الخدمات>`.
5. **فقط عند النجاح** يُكتب SHA الجديد في `~/.pickly-last-deployed`.
   التزامات التوثيق/الاختبارات (لا خدمة متأثرة) تُثبَّت فور السحب.

### لماذا ملف الحالة وليس HEAD؟ (عطل 2026-08-01)

النسخة الأولى كانت تحسب الـdiff من `HEAD` وتعمل `reset --hard` **قبل** البناء.
عندما فشل بناء `api` على 11ca8c2 كان HEAD قد تقدّم بالفعل، فالتشغيل التالي
حسب الـdiff من HEAD الجديد ورأى الالتزامات الأحدث فقط — والخدمات التي أُجهض
بناؤها (customer-web وadmin-web وغيرهما) بقيت على نسخة قديمة **بصمت** حتى
لمسها التزام لاحق. الأساس الآن هو آخر نشر ناجح، فالفشل يُعاد بناؤه تلقائياً
في التشغيلات التالية (كل دقيقتين) حتى ينجح أو يصل إصلاح.

ملاحظة مقصودة: فشل بناء دائم (لا عابر) يعني إعادة محاولة كل دقيقتين إلى أن
يُدفع إصلاح — هذا مرئي في اللوج ومقبول؛ البديل (تقدم صامت) هو عين العطل.
`flock` يمنع تداخل التشغيلات، والخدمات القديمة تبقى عاملة أثناء الفشل.

## تطبيق تعديل على السيرفر

بعد وصول التعديل إلى `origin/main` (انتظر دقيقتين أو تحقق من اللوج):

```bash
ssh -i ~/.oci/pickly_vm_ssh ubuntu@193.122.83.224 bash -s <<'EOF'
exec 9>/tmp/pickly-autodeploy.lock
flock 9
cd ~/pickly
git rev-parse HEAD > ~/.pickly-last-deployed        # الأساس = المنشور فعلاً الآن (قبل أي سحب)
git fetch origin main -q
git checkout origin/main -- infra/vm/pickly-autodeploy.sh   # يجلب الملف دون تحريك HEAD
install -m 755 infra/vm/pickly-autodeploy.sh ~/pickly-autodeploy.sh
echo "تم — أساس النشر: $(cat ~/.pickly-last-deployed)"
EOF
```

سطر البذر (`rev-parse HEAD > ...`) للتطبيق **الأول فقط**، ويفترض أن آخر نشر
نجح فعلاً (تحقق من ذيل اللوج قبله). في التطبيقات اللاحقة احذفه كي لا تمسح
أثر فشل قيد إعادة المحاولة — والسكربت أصلاً يبذر الملف بنفسه عند غيابه
(قبل أي reset) فالبذر اليدوي توضيحي لا أكثر. تعديل `.service`/`.timer` يحتاج إضافةً نسخهما إلى
`/etc/systemd/system/` ثم `sudo systemctl daemon-reload`.

## المراقبة

```bash
ssh -i ~/.oci/pickly_vm_ssh ubuntu@193.122.83.224 'tail -50 ~/pickly-autodeploy.log; echo; echo "الأساس: $(cat ~/.pickly-last-deployed 2>/dev/null || echo "(لا ملف حالة بعد)")"'
```

- `✅ اكتمل النشر لـ<SHA>` — نجاح؛ `❌ فشل البناء` — الأساس لم يتقدم وستُعاد المحاولة.
- `⟳ إعادة محاولة` — HEAD متقدم على آخر نشر ناجح (أثر فشل سابق قيد المعالجة).
- الهجرات تُطبق عند إقلاع حاوية `api` (منذ 34d5f84) — لا خطوة هجرات في السكربت.
