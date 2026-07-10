"use client";

/**
 * A-23: Feature Flags — FR-A11 (مرحلة 2):
 * GET /api/v1/admin/flags جدول + تبديل POST /flags/{key} {enabled, reason} بسبب إلزامي.
 * كل تبديل يدخل سجل التدقيق (BR-15).
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiGet, apiPost, shortDateTime } from "@/lib/api";
import ReasonModal from "@/components/ReasonModal";

type Flag = {
  key: string;
  enabled: boolean;
  updated_by: string | null;
  updated_at: string;
};

/** أوصاف الأعلام المعروفة — للقارئ البشري */
const FLAG_AR: Record<string, string> = {
  scheduled_orders: "الطلب المجدول بفترات وسعات (BR-5)",
  coupons_full: "الكوبونات بأنواعها (BR-7)",
  wallet_payments: "محافظ الدفع Apple Pay / STC Pay",
  search: "البحث في الرئيسية (C-11)",
  support_tickets: "تذاكر الدعم (C-65)",
  tips: "البقشيش",
  discovery_map: "خريطة الاكتشاف (C-15)",
  favorites: "المفضلة (C-18)",
  auto_accept: "القبول الآلي (S6)",
  web_checkout_full: "ويب العميل الكامل",
  pos_integrations: "تكاملات POS (Foodics)"
};

export default function FeatureFlags() {
  const router = useRouter();
  const [flags, setFlags] = useState<Flag[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Flag | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiGet<Flag[]>("/api/v1/admin/flags")
      .then(setFlags)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) {
          router.replace("/");
          return;
        }
        setError((e as Error).message);
      });
  }, [router]);

  useEffect(load, [load]);

  const confirm = async (reason: string) => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/admin/flags/${pending.key}`, { enabled: !pending.enabled, reason });
      setNotice(`${pending.key} أصبح ${pending.enabled ? "مطفأً" : "مفعلاً"} — دخل سجل التدقيق`);
      setPending(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onCount = flags?.filter((f) => f.enabled).length ?? 0;

  return (
    <>
      {error && <div className="note err" data-testid="flags-error">{error}</div>}
      {notice && <div className="note info" data-testid="flags-notice">{notice}</div>}
      {!flags && !error && <div className="skl" style={{ height: 260 }} />}

      {flags && (
        <div className="kpis">
          <div className="kpi" data-testid="admin-stat" data-stat="flags_on">
            <div className="k">مفعلة</div>
            <div className="v">{onCount}</div>
          </div>
          <div className="kpi" data-testid="admin-stat" data-stat="flags_total">
            <div className="k">إجمالي الأعلام</div>
            <div className="v">{flags.length}</div>
          </div>
        </div>
      )}

      {flags && flags.length > 0 && (
        <div className="tblwrap">
          <table className="tbl" data-testid="flags-table">
            <thead>
              <tr>
                <th>العلم</th>
                <th>الوصف</th>
                <th>الحالة</th>
                <th>آخر تحديث</th>
                <th>تبديل</th>
              </tr>
            </thead>
            <tbody>
              {flags.map((f) => (
                <tr key={f.key} data-testid="flag-row">
                  <td className="mono"><b>{f.key}</b></td>
                  <td>{FLAG_AR[f.key] ?? "—"}</td>
                  <td>
                    <span className={`badge ${f.enabled ? "b-ok" : "b-soft"}`} data-testid="flag-status">
                      {f.enabled ? "مفعل" : "مطفأ"}
                    </span>
                  </td>
                  <td className="mono">{shortDateTime(f.updated_at)}</td>
                  <td>
                    <button
                      type="button"
                      className={`btn sm${f.enabled ? " dgh" : ""}`}
                      data-testid="flag-toggle"
                      onClick={() => setPending(f)}
                    >
                      {f.enabled ? "إطفاء" : "تفعيل"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="note soft">
        كل خاصية قابلة للإيقاف دون نشر (docs/09§6-5) — الخادم يفرض العلم عند التنفيذ والواجهات تتكيف خلال ٣٠ ثانية.
      </div>

      {pending && (
        <ReasonModal
          title={`${pending.enabled ? "إطفاء" : "تفعيل"} العلم ${pending.key}`}
          confirmLabel={pending.enabled ? "إطفاء" : "تفعيل"}
          danger={pending.enabled}
          busy={busy}
          onConfirm={confirm}
          onClose={() => setPending(null)}
        />
      )}
    </>
  );
}
