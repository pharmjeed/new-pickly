"use client";

/**
 * رسوم خدمة بيكلي — قيمة الرسم الذي يدفعه العميل وحصة التاجر منه.
 * تُحفظ سجلاً تاريخياً في system_settings (pricing.service_fee) بسبب يدخل التدقيق (BR-15)،
 * وتسري على التسعيرات الجديدة فوراً. حصة التاجر تُقيَّد له في التسوية الأسبوعية.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import ReasonModal from "@/components/ReasonModal";

type FeeConfig = { amount_halalas: number; merchant_share_halalas: number };

const toSar = (halalas: number): string => (halalas / 100).toFixed(2);
const toHalalas = (sar: string): number => Math.round((Number.parseFloat(sar) || 0) * 100);

export default function Pricing() {
  const router = useRouter();
  const [config, setConfig] = useState<FeeConfig | null>(null);
  const [amountSar, setAmountSar] = useState("");
  const [shareSar, setShareSar] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingSave, setPendingSave] = useState(false);

  const load = useCallback(() => {
    apiGet<FeeConfig>("/api/v1/admin/pricing/service-fee")
      .then((c) => {
        setConfig(c);
        setAmountSar(toSar(c.amount_halalas));
        setShareSar(toSar(c.merchant_share_halalas));
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

  const amount = toHalalas(amountSar);
  const share = toHalalas(shareSar);
  const invalid = amount < 0 || share < 0 || share > amount;
  const dirty =
    config !== null &&
    (amount !== config.amount_halalas || share !== config.merchant_share_halalas);

  const confirmSave = async (reason: string) => {
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/v1/admin/pricing/service-fee", {
        amount_halalas: amount,
        merchant_share_halalas: share,
        reason
      });
      setNotice("حُفظ رسم الخدمة — يسري على التسعيرات الجديدة فوراً");
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
      {error && <div className="note err" data-testid="pricing-error">{error}</div>}
      {notice && <div className="note info" data-testid="pricing-notice">{notice}</div>}
      {!config && !error && <div className="skl" style={{ height: 180 }} />}

      {config && (
        <div className="pcardx" data-testid="pricing-service-fee">
          <h3>
            رسم خدمة بيكلي
            <span className="sp">
              <button
                type="button"
                className="btn sm"
                disabled={!dirty || invalid || busy}
                data-testid="service-fee-save"
                onClick={() => setPendingSave(true)}
              >
                حفظ الرسم
              </button>
            </span>
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, alignItems: "end" }}>
            <div className="fld">
              <label>قيمة الرسم على العميل (ر.س)</label>
              <input
                className="inp mono"
                dir="ltr"
                inputMode="decimal"
                value={amountSar}
                onChange={(e) => setAmountSar(e.target.value)}
                data-testid="service-fee-amount"
              />
            </div>
            <div className="fld">
              <label>حصة التاجر منه (ر.س)</label>
              <input
                className="inp mono"
                dir="ltr"
                inputMode="decimal"
                value={shareSar}
                onChange={(e) => setShareSar(e.target.value)}
                data-testid="service-fee-share"
              />
            </div>
            <div className="fld">
              <label>حصة بيكلي (تلقائي)</label>
              <input className="inp mono" dir="ltr" value={toSar(Math.max(amount - share, 0))} readOnly disabled />
            </div>
          </div>
          {invalid && (
            <p className="note err" style={{ marginTop: 10 }}>
              حصة التاجر لا تتجاوز قيمة الرسم.
            </p>
          )}
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            الرسم يُحصَّل من العميل مع كل طلب ويظهر مفصولاً في ملخص الفاتورة (BR-6) ·
            حصة التاجر تبقى ضمن صافي مستحقه في التسوية الأسبوعية، وبيكلي تحتفظ بالباقي ·
            التغيير يسري على التسعيرات الجديدة فقط — الطلبات المسعّرة سابقاً تُسوّى بحصتها لحظة التسعير.
          </p>
        </div>
      )}

      <div className="note soft">
        كل تعديل يُحفظ سجلاً تاريخياً في system_settings بسبب إلزامي يدخل سجل التدقيق (BR-15).
      </div>

      {pendingSave && (
        <ReasonModal
          title="حفظ رسم خدمة بيكلي"
          confirmLabel="حفظ"
          busy={busy}
          onConfirm={confirmSave}
          onClose={() => setPendingSave(false)}
        />
      )}
    </>
  );
}
