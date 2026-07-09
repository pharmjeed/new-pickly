"use client";

/** P6 (مصغرة): الإتمام — سيارة + دفع (بوابة sandbox) ثم النجاح ← التتبع */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, fmtSar } from "@/lib/api";

interface Vehicle {
  id: string;
  make_ar: string | null;
  model_ar: string | null;
  color_ar: string;
  plate_short: string;
  is_default: boolean;
}

export default function CheckoutPage() {
  const router = useRouter();
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [color, setColor] = useState("");
  const [plate, setPlate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);

  const cartId = typeof window !== "undefined" ? sessionStorage.getItem("pk_cart") : null;
  const quoteId = typeof window !== "undefined" ? sessionStorage.getItem("pk_quote") : null;

  useEffect(() => {
    api<Vehicle[]>("GET", "/v1/customers/me/vehicles")
      .then((vs) => {
        setVehicles(vs);
        const def = vs.find((v) => v.is_default) ?? vs[0];
        if (def) setVehicleId(def.id);
        else setShowAdd(true);
      })
      .catch((e: Error) => setError(e.message));
    if (cartId) {
      api<{ quote: { total_halalas: number } | null }>("GET", `/v1/carts/${cartId}`)
        .then((c) => setTotal(c.quote?.total_halalas ?? null))
        .catch(() => undefined);
    }
  }, [cartId]);

  const addVehicle = async () => {
    setBusy(true);
    setError(null);
    try {
      // إضافة سيارة مصغرة — S3: حقلان فقط
      const v = await api<Vehicle>("POST", "/v1/customers/me/vehicles", {
        color_ar: color,
        plate_short: plate
      });
      setVehicles((vs) => [...(vs ?? []), v]);
      setVehicleId(v.id);
      setShowAdd(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const payAndOrder = async () => {
    if (!cartId || !quoteId || !vehicleId) return;
    setBusy(true);
    setError(null);
    try {
      const order = await api<{ id: string }>(
        "POST",
        "/v1/orders",
        { cart_id: cartId, quote_id: quoteId, vehicle_id: vehicleId, pickup_time: "asap" },
        { idempotent: true }
      );
      await api("POST", `/v1/orders/${order.id}/payment-intent`, undefined, { idempotent: true });
      // بوابة sandbox — نفس مسار الإنتاج: النتيجة عبر webhook موقع
      const pay = await api<{ gateway_result: string }>(
        "POST",
        `/v1/dev/mock-gateway/by-order/${order.id}/pay`
      );
      if (pay.gateway_result !== "authorized") {
        setError("ما تمّ الدفع. جرّب بطاقة ثانية — طلبك محفوظ");
        return;
      }
      sessionStorage.removeItem("pk_cart");
      sessionStorage.removeItem("pk_quote");
      router.push(`/track/${order.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="pk-wrap">
      <h1 className="pk-display" style={{ fontSize: "var(--pk-fs-24)", marginBottom: 12 }}>الإتمام</h1>
      {error && <div className="pk-card" style={{ color: "var(--pk-error)" }} data-testid="checkout-error">{error}</div>}

      <section className="pk-card">
        <h2 style={{ fontSize: "var(--pk-fs-17)", fontWeight: 500, marginBottom: 8 }}>سيارتك — عنوان استلامك</h2>
        {vehicles?.map((v) => (
          <label key={v.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, cursor: "pointer" }}>
            <input
              type="radio"
              name="vehicle"
              checked={vehicleId === v.id}
              onChange={() => setVehicleId(v.id)}
              data-testid="vehicle-radio"
            />
            <span className="pk-chip">
              {[v.model_ar ?? v.make_ar, v.color_ar, v.plate_short].filter(Boolean).join(" · ")}
            </span>
          </label>
        ))}

        {showAdd ? (
          <div style={{ marginTop: 8 }}>
            <input className="pk-input" data-testid="veh-color" placeholder="اللون (مثل: بيضاء)" value={color} onChange={(e) => setColor(e.target.value)} style={{ marginBottom: 8 }} />
            <input className="pk-input pk-mono" data-testid="veh-plate" placeholder="آخر 4 أرقام اللوحة" maxLength={4} value={plate} onChange={(e) => setPlate(e.target.value)} style={{ marginBottom: 8, textAlign: "center" }} />
            <button className="pk-btn-ghost" data-testid="veh-save" disabled={busy || color.length < 2 || plate.length < 1} onClick={addVehicle}>
              حفظ السيارة
            </button>
          </div>
        ) : (
          <button className="pk-btn-ghost" onClick={() => setShowAdd(true)}>+ سيارة أخرى</button>
        )}
      </section>

      <section className="pk-card">
        <h2 style={{ fontSize: "var(--pk-fs-17)", fontWeight: 500, marginBottom: 4 }}>وقت الاستلام</h2>
        <p className="pk-muted">في أقرب وقت — المطعم يجهّز طلبك على وقت وصولك</p>
      </section>

      <button className="pk-btn" data-testid="pay-button" disabled={busy || !vehicleId || !cartId} onClick={payAndOrder}>
        {busy ? "جارٍ الدفع…" : total ? `ادفع ${fmtSar(total)}` : "ادفع الآن"}
      </button>
      <p className="pk-muted" style={{ textAlign: "center", marginTop: 8 }}>
        دفع تجريبي آمن (sandbox) — لا بطاقة حقيقية في بيئة التطوير
      </p>
    </main>
  );
}
