"use client";

/**
 * خريطة الملاحة (OSRM) — تحديث بضغطة. محرك المسارات الذاتي على السيرفر يخدم خريطة تتبع
 * العميل ووضع الملاحة داخل التطبيق. الزر يُسقِط إشارة تحديث مُدقّقة (BR-15)؛ مراقب على
 * المضيف ينزّل أحدث خريطة ويعالجها ويعيد تشغيل الخدمة، والحالة تُتابَع هنا تلقائياً.
 * لا تملك أي واجهة ويب صلاحية النظام — الفصل الأمني مقصود.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import ReasonModal from "@/components/ReasonModal";

type NavStatus = { state: string; step: string; message: string; at: string };

const STEP_LABEL: Record<string, string> = {
  queued: "في الانتظار",
  download: "تنزيل الخريطة",
  extract: "استخلاص الطرق",
  partition: "تقسيم",
  customize: "تخصيص",
  swap: "التبديل والتفعيل",
  verify: "التحقق",
  done: "اكتمل"
};

function fmtAt(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("ar-SA", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export default function NavMap() {
  const router = useRouter();
  const [status, setStatus] = useState<NavStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);

  const load = useCallback(() => {
    apiGet<NavStatus>("/api/v1/admin/ops/nav-map")
      .then(setStatus)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) {
          router.replace("/");
          return;
        }
        setError((e as Error).message);
      });
  }, [router]);

  useEffect(load, [load]);

  // استطلاع دوري لمتابعة تقدّم المضيف — أسرع أثناء التحديث
  const running = status?.state === "running";
  useEffect(() => {
    const t = setInterval(load, running ? 3000 : 20000);
    return () => clearInterval(t);
  }, [running, load]);

  const confirmRebuild = async (reason: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await apiPost<{ ok: boolean; running?: boolean; message?: string }>(
        "/api/v1/admin/ops/nav-map/rebuild",
        { reason }
      );
      setNotice(
        r.ok === false
          ? (r.message ?? "التحديث جارٍ بالفعل")
          : "بدأ التحديث — قد يستغرق عدة دقائق، وتُتابَع الحالة هنا تلقائياً."
      );
      setPending(false);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const stateNote = () => {
    if (!status) return null;
    if (status.state === "running")
      return (
        <div className="note info" data-testid="navmap-state">
          ⏳ جارٍ التحديث — {STEP_LABEL[status.step] ?? status.step}
          {status.message ? `: ${status.message}` : ""}
        </div>
      );
    if (status.state === "done")
      return (
        <div className="note info" data-testid="navmap-state">
          ✓ {status.message || "اكتمل التحديث"}
          {status.at ? ` — ${fmtAt(status.at)}` : ""}
        </div>
      );
    if (status.state === "error")
      return (
        <div className="note err" data-testid="navmap-state">
          ✗ {status.message || "فشل التحديث"}
        </div>
      );
    return (
      <div className="note soft" data-testid="navmap-state">
        {status.message || "لم تُحدَّث الخريطة بعد على هذا السيرفر"}
      </div>
    );
  };

  return (
    <>
      {error && <div className="note err" data-testid="navmap-error">{error}</div>}
      {notice && <div className="note info" data-testid="navmap-notice">{notice}</div>}
      {!status && !error && <div className="skl" style={{ height: 160 }} />}

      {status && (
        <div className="pcardx" data-testid="navmap">
          <h3>
            خريطة الملاحة (OSRM)
            <span className="sp">
              <button
                type="button"
                className="btn sm"
                disabled={busy || running}
                data-testid="navmap-rebuild"
                onClick={() => setPending(true)}
              >
                {running ? "التحديث جارٍ…" : "تحديث الخريطة الآن"}
              </button>
            </span>
          </h3>
          {stateNote()}
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            محرك المسارات الذاتي يعمل على خريطة السعودية/الخليج المستضافة على السيرفر — تُستخدم في خريطة تتبع
            العميل ووضع الملاحة داخل التطبيق. اضغط «تحديث الخريطة الآن» لتنزيل أحدث نسخة من الطرق ومعالجتها؛
            العملية تأخذ عدة دقائق وتعمل بأقل انقطاع، والحالة تتابع هنا تلقائياً. حدِّث دورياً (مثلاً شهرياً)
            لالتقاط الشوارع والتعديلات الجديدة.
          </p>
        </div>
      )}

      <div className="note soft">
        التحديث فعل تشغيلي مُدقّق — يتطلب سبباً ويدخل سجل التدقيق (BR-15). ينفّذه مراقب على المضيف؛ لا تملك أي
        واجهة ويب صلاحية النظام.
      </div>

      {pending && (
        <ReasonModal
          title="تحديث خريطة الملاحة (OSRM)"
          confirmLabel="ابدأ التحديث"
          busy={busy}
          onConfirm={confirmRebuild}
          onClose={() => setPending(false)}
        />
      )}
    </>
  );
}
