"use client";

/**
 * صفحة العودة من بوابة الدفع — يصل إليها العميل بعد تحدي 3DS أو رمز STC Pay.
 * البوابة تُلحق id/status/message بالرابط، لكن **لا نثق بها**: نسأل خادمنا
 * الذي يقرأ الحالة من البوابة ويطبّقها (docs/13§4-4). نعيد المحاولة قليلاً
 * لأن webhook قد يسبق أو يتأخر عن عودة المتصفح.
 */
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { QirtasLoader } from "../../qirtas";
import { QirtasLive } from "../../qirtas-motion";
import pageStyles from "../../page.module.css";

type SyncStatus =
  | "requires_payment"
  | "processing"
  | "authorized"
  | "captured"
  | "failed"
  | "cancelled";

const POLL_MS = 1500;
const MAX_TRIES = 8;

function PayReturn() {
  const router = useRouter();
  const params = useSearchParams();
  const orderId = params.get("order");
  const [failed, setFailed] = useState<string | null>(null);
  const tries = useRef(0);

  useEffect(() => {
    if (!orderId) {
      router.replace("/orders");
      return;
    }
    let timer: number | null = null;
    let alive = true;

    const check = async () => {
      try {
        const res = await api<{ status: SyncStatus; message: string | null }>(
          "POST",
          `/v1/orders/${orderId}/payment/sync`
        );
        if (!alive) return;
        if (res.status === "authorized" || res.status === "captured") {
          router.replace(`/track/${orderId}`);
          return;
        }
        if (res.status === "failed" || res.status === "cancelled") {
          setFailed(res.message ?? "ما تمّ الدفع — لم يُخصم أي مبلغ");
          return;
        }
      } catch {
        /* انقطاع عابر — نعيد المحاولة */
      }
      if (!alive) return;
      tries.current += 1;
      // انتهت المحاولات والحالة ما زالت معلّقة: نتابع على صفحة الطلب نفسها
      if (tries.current >= MAX_TRIES) {
        router.replace(`/track/${orderId}`);
        return;
      }
      timer = window.setTimeout(() => void check(), POLL_MS);
    };

    void check();
    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [orderId, router]);

  if (failed) {
    return (
      <main className="pk-wrap" style={{ textAlign: "center", paddingTop: 40 }}>
        <QirtasLive pose="sleep" mood="sleepy" size={110} />
        <h1 style={{ fontSize: 20, margin: "14px 0 6px" }}>ما تمّ الدفع</h1>
        <p className={pageStyles.acMuted} style={{ marginBottom: 18 }}>{failed}</p>
        <button className="pk-btn" onClick={() => router.replace("/orders")}>
          طلباتي
        </button>
      </main>
    );
  }

  return (
    <main className="pk-wrap" style={{ textAlign: "center", paddingTop: 40 }}>
      <QirtasLoader />
      <p className={pageStyles.acMuted}>نتحقق من دفعتك لدى البنك…</p>
    </main>
  );
}

export default function PayReturnPage() {
  // useSearchParams يتطلب حدّ Suspense في App Router
  return (
    <Suspense fallback={<QirtasLoader />}>
      <PayReturn />
    </Suspense>
  );
}
