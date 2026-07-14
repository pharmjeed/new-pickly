"use client";

/**
 * دخول لوحة Super Admin — جوال الأدمن + OTP (رمز التطوير 1234).
 * POST /api/v1/auth/otp/request ثم /api/v1/auth/otp/verify → aw_token.
 * حساب demo: 0510000001 (super_admin).
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TOKEN_KEY, getToken } from "@/lib/api";
import { QirtasBadge, SpeedLines } from "@/components/qirtas";
import s from "./login.module.css";

export default function AdminLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // جلسة قائمة → مباشرة إلى اللوحة
  useEffect(() => {
    if (getToken()) router.replace("/panel");
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
      router.push("/panel");
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
          <QirtasBadge size={46} />
          <div>
            <b>لوحة Super Admin</b>
            <div className={s.sub}>منصة بيكلي — نطاق الطيار</div>
          </div>
          <SpeedLines width={44} style={{ marginInlineStart: "auto" }} />
        </div>

        {step === "phone" ? (
          <>
            <h1 className={s.title}>دخول الأدمن</h1>
            <div className="fld">
              <label htmlFor="phone">جوال الأدمن</label>
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
