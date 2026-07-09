"use client";

/** B-01 (مصغرة): دخول فريق الفرع — كود فرع + حساب + PIN، جهاز مسمى */
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function BranchLoginPage() {
  const router = useRouter();
  const [branchCode, setBranchCode] = useState("");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/branch/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch_code: branchCode,
          username,
          pin,
          device_name: `لوحة ${branchCode}`
        })
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: { message_ar?: string } };
        throw new Error(data.error?.message_ar ?? "تعذر الدخول");
      }
      const body = (await res.json()) as { access_token: string };
      localStorage.setItem("bo_token", body.access_token);
      router.push("/board");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="bo-wrap" style={{ maxWidth: 480, paddingTop: 64 }}>
      <h1 style={{ fontFamily: "var(--pk-font-display)", fontWeight: 800, fontSize: "var(--pk-fs-32)", marginBottom: 16 }}>
        لوحة الفرع
      </h1>
      {error && <div className="bo-card" style={{ color: "var(--pk-error)", marginBottom: 12 }} data-testid="login-error">{error}</div>}
      <div className="bo-card" style={{ display: "grid", gap: 12 }}>
        <input className="bo-input" data-testid="branch-code" placeholder="كود الفرع (مثل BB-OLAYA)" value={branchCode} onChange={(e) => setBranchCode(e.target.value)} style={{ direction: "ltr", textAlign: "center" }} />
        <input className="bo-input" data-testid="username" placeholder="اسم المستخدم" value={username} onChange={(e) => setUsername(e.target.value)} style={{ direction: "ltr", textAlign: "center" }} />
        <input className="bo-input" data-testid="pin" placeholder="الرمز السري PIN" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} style={{ textAlign: "center" }} />
        <button className="bo-btn" data-testid="login-submit" disabled={busy || !branchCode || !username || pin.length < 4} onClick={login}>
          افتح اللوحة
        </button>
      </div>
    </main>
  );
}
