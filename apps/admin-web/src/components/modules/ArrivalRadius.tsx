"use client";

/**
 * نصف قطر تفعيل «وصلت» — العميل لا يقدر يؤكد وصوله إلا داخل هذا القطر من المطعم.
 * يُحفظ سجلاً تاريخياً في system_settings (ops.arrival_radius_m) بسبب يدخل التدقيق (BR-15)،
 * ويسري على الطلبات الحية فوراً (تُقرأ القيمة عند كل تحديث لصفحة تتبع العميل).
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import ReasonModal from "@/components/ReasonModal";
import { QirtasLoader } from "@/components/qirtas";

type RadiusConfig = { radius_m: number };

export default function ArrivalRadius() {
  const router = useRouter();
  const [config, setConfig] = useState<RadiusConfig | null>(null);
  const [radius, setRadius] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingSave, setPendingSave] = useState(false);

  const load = useCallback(() => {
    apiGet<RadiusConfig>("/api/v1/admin/ops/arrival-radius")
      .then((c) => {
        setConfig(c);
        setRadius(String(c.radius_m));
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) {
          router.replace("/");
          return;
        }
        setError((e as Error).message);
      });
  }, [router]);

  useEffect(load, [load]);

  const value = Math.round(Number.parseInt(radius, 10) || 0);
  const invalid = value < 50 || value > 5000;
  const dirty = config !== null && value !== config.radius_m;

  const confirmSave = async (reason: string) => {
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/v1/admin/ops/arrival-radius", { radius_m: value, reason });
      setNotice("حُفظ نصف قطر الوصول — يسري على الطلبات الحية فوراً");
      setPendingSave(false);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {error && <div className="note err" data-testid="arrival-error">{error}</div>}
      {notice && <div className="note info" data-testid="arrival-notice">{notice}</div>}
      {!config && !error && <div className="loadwrap" style={{ minHeight: 160 }}><QirtasLoader /></div>}

      {config && (
        <div className="pcardx" data-testid="arrival-radius">
          <h3>
            نصف قطر تفعيل «وصلت»
            <span className="sp">
              <button
                type="button"
                className="btn sm"
                disabled={!dirty || invalid || busy}
                data-testid="arrival-radius-save"
                onClick={() => setPendingSave(true)}
              >
                حفظ القطر
              </button>
            </span>
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12, alignItems: "end" }}>
            <div className="fld">
              <label>المسافة (متر)</label>
              <input
                className="inp mono"
                dir="ltr"
                inputMode="numeric"
                value={radius}
                onChange={(e) => setRadius(e.target.value.replace(/[^\d]/g, ""))}
                data-testid="arrival-radius-input"
              />
            </div>
            <div className="fld">
              <label>المدى المسموح</label>
              <input className="inp mono" dir="ltr" value="50 – 5000 متر" readOnly disabled />
            </div>
          </div>
          {invalid && (
            <p className="note err" style={{ marginTop: 10 }}>
              القيمة يجب أن تكون بين 50 و 5000 متر.
            </p>
          )}
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            زر «وصلت» في صفحة العميل يبقى مقفلاً حتى يقترب العميل هذه المسافة من المطعم، فيتحول لعنصر
            سحب يؤكد به وصوله يدوياً (docs/14) · القيمة الأصغر تتطلب اقتراباً أدق، والأكبر تسمح بالتأكيد من
            أبعد · التغيير يسري فوراً على كل الطلبات الحية.
          </p>
        </div>
      )}

      <div className="note soft">
        كل تعديل يُحفظ سجلاً تاريخياً في system_settings بسبب إلزامي يدخل سجل التدقيق (BR-15).
      </div>

      {pendingSave && (
        <ReasonModal
          title="حفظ نصف قطر تفعيل «وصلت»"
          confirmLabel="حفظ"
          busy={busy}
          onConfirm={confirmSave}
          onClose={() => setPendingSave(false)}
        />
      )}
    </>
  );
}
