"use client";

/**
 * دخول التاجر — جوال المالك + OTP (رمز التطوير 1234).
 * POST /api/v1/auth/otp/request ثم /api/v1/auth/otp/verify → mw_token.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TOKEN_KEY, getToken } from "@/lib/api";
import s from "./login.module.css";

/** شارة بيكلي — كتاب الهوية */
function Badge() {
  return (
    <svg width="42" height="42" viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" rx="24" fill="var(--pk-lime-500)" />
      <g transform="skewX(-8) translate(4,0)" stroke="var(--pk-ink-900)" fill="none">
        <path d="M36,34 L62,34 L59,72 L39,72 Z" strokeWidth="4" strokeLinejoin="round" />
        <path d="M43,34 Q49,24 55,34" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M70,40 H88" strokeWidth="5" strokeLinecap="round" />
        <path d="M74,52 H88" strokeWidth="5" strokeLinecap="round" opacity="0.55" />
        <path d="M70,64 H80" strokeWidth="5" strokeLinecap="round" opacity="0.3" />
      </g>
    </svg>
  );
}

export default function MerchantLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // جلسة قائمة → مباشرة إلى اللوحة
  useEffect(() => {
    if (getToken()) router.replace("/dashboard");
  }, [router]);

  const requestOtp = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone })
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: { message_ar?: string } };
        throw new Error(data.error?.message_ar ?? "تعذر إرسال رمز التحقق");
      }
      setStep("otp");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code })
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: { message_ar?: string } };
        throw new Error(data.error?.message_ar ?? "رمز التحقق غير صحيح");
      }
      const body = (await res.json()) as { access_token: string };
      localStorage.setItem(TOKEN_KEY, body.access_token);
      router.push("/dashboard");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={s.page}>
      <div className={s.card}>
        <div className={s.brand}>
          <Badge />
          <div>
            <b>بوابة التاجر</b>
            <div className={s.sub}>بيكلي — نطاق الطيار</div>
          </div>
        </div>

        {step === "phone" ? (
          <>
            <h1 className={s.title}>دخول التاجر</h1>
            <div className="fld">
              <label htmlFor="phone">جوال المالك</label>
              <input
                id="phone"
                className={s.mono}
                data-testid="login-phone"
                inputMode="tel"
                dir="ltr"
                placeholder="05XXXXXXXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value.trim())}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && phone.length >= 10 && !busy) void requestOtp();
                }}
              />
              <span className="hint">يصلك رمز تحقق لمرة واحدة على هذا الرقم</span>
            </div>
            {error && (
              <div className={s.err} data-testid="login-error">
                {error}
              </div>
            )}
            <button
              type="button"
              className="btn blk"
              data-testid="login-request-otp"
              disabled={busy || phone.length < 10}
              onClick={requestOtp}
            >
              إرسال رمز التحقق
            </button>
          </>
        ) : (
          <>
            <h1 className={s.title}>رمز التحقق</h1>
            <div className="fld">
              <label htmlFor="otp">
                أُرسل إلى <span className={s.mono}>{phone}</span>
              </label>
              <input
                id="otp"
                className={s.otpInput}
                data-testid="login-otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={4}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && code.length === 4 && !busy) void verifyOtp();
                }}
              />
            </div>
            {error && (
              <div className={s.err} data-testid="login-error">
                {error}
              </div>
            )}
            <button
              type="button"
              className="btn blk"
              data-testid="login-verify-otp"
              disabled={busy || code.length !== 4}
              onClick={verifyOtp}
            >
              دخول
            </button>
            <button type="button" className={s.back} onClick={() => setStep("phone")}>
              ← تغيير الرقم
            </button>
          </>
        )}
      </div>
    </main>
  );
}
