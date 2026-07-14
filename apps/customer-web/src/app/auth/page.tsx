"use client";

/** P2: المصادقة — Stepper واحد: جوال ← OTP ← الاسم (docs/21§1 · design/customer/P2.html C-05→C-07) */
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, setTokens } from "@/lib/api";
import { QirtasLive } from "../qirtas-motion";
import s from "./auth.module.css";

const OTP_LEN = 6;
const RESEND_SECONDS = 47;

function ChevBack() {
  return (
    <svg width="16" height="16" viewBox="0 0 100 100" aria-hidden="true">
      <path d="M60,26 L36,50 L60,74" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AuthFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/";

  const [step, setStep] = useState<"phone" | "otp" | "name">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const otpRef = useRef<HTMLInputElement>(null);

  // عدّاد إعادة الإرسال (C-06: «إعادة الإرسال بعد 00:47»)
  useEffect(() => {
    if (step !== "otp" || resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [step, resendIn]);

  const requestOtp = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/v1/auth/otp/request", { phone });
      setStep("otp");
      setResendIn(RESEND_SECONDS);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ access_token: string; refresh_token: string; is_new_user: boolean }>(
        "POST",
        "/v1/auth/otp/verify",
        { phone, code }
      );
      setTokens(res.access_token, res.refresh_token);
      if (res.is_new_user) setStep("name");
      else router.push(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveName = async () => {
    setBusy(true);
    try {
      await api("PATCH", "/v1/customers/me", { full_name: name });
      router.push(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const backToPhone = () => {
    setStep("phone");
    setCode("");
    setError(null);
  };

  const digits = code.split("");

  return (
    <main className={s.screen}>
      {/* ===== C-05: رقم الجوال ===== */}
      {step === "phone" && (
        <div className={`${s.body} ${s.center}`}>
          <div dir="ltr" className={s.logo}>
            <div className={s.logoTxt}>
              <span className={s.logoLatin}>pickly</span>
              <span className={s.logoAr}>بيكلي</span>
            </div>
            {/* القرطاس يلوّح مرحّباً بالداخل — «مرحباً بك!» */}
            <QirtasLive pose="wave" size={86} title="القرطاس يرحب بك" />
          </div>

          <h1 className={s.hero}>
            خلّك في سيارتك —
            <br />
            طلبك يجيك
          </h1>

          <div className={s.fld}>
            <label htmlFor="pk-phone">رقم الجوال</label>
            <div className={s.row}>
              <span className={s.prefix}>+966</span>
              <input
                id="pk-phone"
                className={`${s.inp} ${s.mono} ${error ? s.inpErr : ""}`}
                data-testid="phone-input"
                placeholder="05XXXXXXXX"
                inputMode="tel"
                autoFocus
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            {error && (
              <div className={s.errMsg} data-testid="auth-error">
                {error}
              </div>
            )}
          </div>

          <button className={s.btn} data-testid="phone-submit" disabled={busy || phone.length < 10} onClick={requestOtp}>
            متابعة
          </button>

          <div className={s.divider}>
            <i />
            <span>أو</span>
            <i />
          </div>

          <button className={s.btnSec} onClick={() => router.push("/")}>
            المتابعة كزائر للتصفح
          </button>

          <p className={s.foot}>
            تصفح بحرية — تحتاج حساباً عند الدفع فقط.
            <br />
            بمتابعتك توافق على الشروط وسياسة الخصوصية
          </p>
        </div>
      )}

      {/* ===== C-06: رمز التحقق OTP ===== */}
      {step === "otp" && (
        <>
          <div className={s.bhead}>
            <button className={s.bk} aria-label="رجوع" onClick={backToPhone}>
              <ChevBack />
            </button>
            <h1>رمز التحقق</h1>
          </div>

          <div className={s.body}>
            <p className={s.muted}>
              أرسلنا رمزاً من 6 أرقام إلى <b className={`${s.mono} ${s.strong}`}>{phone}</b> ·{" "}
              <button className={s.link} onClick={backToPhone}>
                تعديل الرقم
              </button>
            </p>

            <div className={s.otpWrap} onClick={() => otpRef.current?.focus()}>
              <div className={s.otp}>
                {Array.from({ length: OTP_LEN }, (_, i) => (
                  <span
                    key={i}
                    className={`${s.cell} ${error ? s.cellErr : i === code.length ? s.cellOn : ""}`}
                  >
                    {digits[i] ?? ""}
                  </span>
                ))}
              </div>
              <input
                ref={otpRef}
                className={s.otpInput}
                data-testid="otp-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={OTP_LEN}
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, OTP_LEN))}
              />
            </div>

            {error && (
              <p className={`${s.errMsg} ${s.tc}`} data-testid="auth-error">
                {error}
              </p>
            )}

            <div className={s.tc}>
              {resendIn > 0 ? (
                <button className={s.btnGhost} disabled>
                  إعادة الإرسال بعد <span className={s.mono}>00:{String(resendIn).padStart(2, "0")}</span>
                </button>
              ) : (
                <button className={s.btnGhost} disabled={busy} onClick={requestOtp}>
                  إعادة إرسال الرمز
                </button>
              )}
            </div>

            <button className={s.btn} data-testid="otp-submit" disabled={busy || code.length < 4} onClick={verify}>
              تأكيد
            </button>

            <p className={s.foot}>لا تشارك الرمز مع أي أحد — موظفو بيكلي لا يطلبونه أبداً</p>
          </div>
        </>
      )}

      {/* ===== C-07: إكمال الملف ===== */}
      {step === "name" && (
        <>
          <div className={s.bhead}>
            <h1>أكمل ملفك</h1>
          </div>

          <div className={s.body}>
            <div className={s.fld}>
              <label htmlFor="pk-name">الاسم *</label>
              <input
                id="pk-name"
                className={`${s.inp} ${error ? s.inpErr : ""}`}
                data-testid="name-input"
                placeholder="اسمك الأول يكفي"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <span className={s.hint}>يظهر لموظف الاستلام عند تسليم طلبك</span>
            </div>

            {error && (
              <div className={s.errMsg} data-testid="auth-error">
                {error}
              </div>
            )}

            <button className={s.btn} data-testid="name-submit" disabled={busy || name.length < 2} onClick={saveName}>
              إنشاء الحساب
            </button>
          </div>
        </>
      )}
    </main>
  );
}

export default function AuthPage() {
  return (
    <Suspense>
      <AuthFlow />
    </Suspense>
  );
}
