"use client";

/** P2: المصادقة — Stepper واحد: جوال ← OTP ← الاسم (docs/21§1) */
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, setTokens } from "@/lib/api";

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

  const requestOtp = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/v1/auth/otp/request", { phone });
      setStep("otp");
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

  return (
    <main className="pk-wrap">
      <h1 className="pk-display" style={{ fontSize: "var(--pk-fs-24)", marginBottom: 16 }}>
        {step === "phone" ? "أدخل جوالك" : step === "otp" ? "رمز التحقق" : "وش نناديك؟"}
      </h1>

      {error && <div className="pk-card" style={{ color: "var(--pk-error)" }} data-testid="auth-error">{error}</div>}

      {step === "phone" && (
        <div className="pk-card">
          <input
            className="pk-input pk-mono"
            data-testid="phone-input"
            placeholder="05XXXXXXXX"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            style={{ marginBottom: 12, textAlign: "center" }}
          />
          <button className="pk-btn" data-testid="phone-submit" disabled={busy || phone.length < 10} onClick={requestOtp}>
            أرسل الرمز
          </button>
        </div>
      )}

      {step === "otp" && (
        <div className="pk-card">
          <p className="pk-muted" style={{ marginBottom: 8 }}>أرسلنا رمزاً إلى {phone}</p>
          <input
            className="pk-input pk-mono"
            data-testid="otp-input"
            placeholder="••••"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            style={{ marginBottom: 12, textAlign: "center", letterSpacing: 8 }}
          />
          <button className="pk-btn" data-testid="otp-submit" disabled={busy || code.length < 4} onClick={verify}>
            تحقق وادخل
          </button>
        </div>
      )}

      {step === "name" && (
        <div className="pk-card">
          <input
            className="pk-input"
            data-testid="name-input"
            placeholder="اسمك الأول يكفي"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ marginBottom: 12 }}
          />
          <button className="pk-btn" data-testid="name-submit" disabled={busy || name.length < 2} onClick={saveName}>
            يلا نبدأ
          </button>
        </div>
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
