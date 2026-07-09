"use client";

/** P5 (مصغرة): السلة + التسعير الخادمي — السعر النهائي من الخادم حصراً */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, fmtSar } from "@/lib/api";

interface Cart {
  id: string;
  items: Array<{
    id: string;
    name_ar: string;
    quantity: number;
    line_total_halalas: number;
    modifiers: Array<{ name_ar: string }>;
  }>;
  quote: {
    quote_id: string;
    subtotal_halalas: number;
    vat_halalas: number;
    service_fee_halalas: number;
    total_halalas: number;
  } | null;
}

export default function CartPage() {
  const router = useRouter();
  const [cart, setCart] = useState<Cart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cartId = typeof window !== "undefined" ? sessionStorage.getItem("pk_cart") : null;

  useEffect(() => {
    if (!cartId) return;
    // تسعير خادمي فور فتح السلة — BR-6
    api<Cart>("POST", `/v1/carts/${cartId}/quote`)
      .then((c) => {
        setCart(c);
        if (c.quote) sessionStorage.setItem("pk_quote", c.quote.quote_id);
      })
      .catch((e: Error) => setError(e.message));
  }, [cartId]);

  if (!cartId) {
    return (
      <main className="pk-wrap">
        <div className="pk-card">لا طلبات حالية — اطلب من متجرك المفضل وخلّنا على السيارة</div>
      </main>
    );
  }

  return (
    <main className="pk-wrap">
      <h1 className="pk-display" style={{ fontSize: "var(--pk-fs-24)", marginBottom: 12 }}>سلتك</h1>
      {error && <div className="pk-card" style={{ color: "var(--pk-error)" }}>{error}</div>}
      {!cart && !error && <div className="pk-loader"><span /><span /><span /></div>}

      {cart?.items.map((i) => (
        <div key={i.id} className="pk-card" data-testid="cart-item" style={{ display: "flex", justifyContent: "space-between" }}>
          <div>
            <strong style={{ fontWeight: 500 }}>{i.name_ar} × {i.quantity}</strong>
            {i.modifiers.length > 0 && (
              <p className="pk-muted">{i.modifiers.map((m) => m.name_ar).join(" · ")}</p>
            )}
          </div>
          <span className="pk-mono">{fmtSar(i.line_total_halalas)}</span>
        </div>
      ))}

      {cart?.quote && (
        <div className="pk-card" data-testid="quote-box">
          <Row label="المجموع" value={fmtSar(cart.quote.subtotal_halalas)} />
          {/* رسم الخدمة مفصول وواضح دائماً — BR-6 */}
          <Row label="رسم خدمة بيكلي" value={fmtSar(cart.quote.service_fee_halalas)} />
          <Row label="الضريبة (15%)" value={fmtSar(cart.quote.vat_halalas)} />
          <hr style={{ border: "none", borderTop: "1px solid var(--pk-border)", margin: "8px 0" }} />
          <Row label="الإجمالي" value={fmtSar(cart.quote.total_halalas)} bold />
        </div>
      )}

      {cart?.quote && (
        <button className="pk-btn" data-testid="go-checkout" onClick={() => router.push("/checkout")}>
          متابعة الإتمام
        </button>
      )}
    </main>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: bold ? 700 : 400 }}>
      <span>{label}</span>
      <span className="pk-mono">{value}</span>
    </div>
  );
}
