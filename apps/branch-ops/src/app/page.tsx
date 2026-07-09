"use client";

/**
 * B-01: دخول الفرع (design/branch/B-01.html) — كود الفرع + الحساب + PIN،
 * جهاز مسمى يُربط بالفرع (يظهر لدى التاجر M-04).
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import s from "./login.module.css";

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** شارة بيكلي — كتاب الهوية */
function Badge() {
  return (
    <svg width="38" height="38" viewBox="0 0 100 100" aria-hidden="true">
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

export default function BranchLoginPage() {
  const router = useRouter();
  const [branchCode, setBranchCode] = useState("");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState("--:--");

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setClock(`${pad2(d.getHours())}:${pad2(d.getMinutes())}`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

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

  const pressDigit = (d: string) => setPin((p) => (p.length >= 4 ? p : p + d));
  const backspace = () => setPin((p) => p.slice(0, -1));

  return (
    <main className={s.page}>
      {/* ترويسة الجهاز */}
      <header className={s.bhdr}>
        <div className={s.brand}>
          <Badge />
          <div>
            <b>بيكلي — شاشة الفرع</b>
            <div className={s.sub}>تسجيل دخول الجهاز</div>
          </div>
        </div>
        <div className={s.sp}>
          <span className={s.clock}>{clock}</span>
        </div>
      </header>

      <section className={s.bmain}>
        <div className={s.grid}>
          {/* عمود البيانات */}
          <div className={s.col}>
            <h1 className={s.title}>دخول الفرع</h1>
            <div className={s.fld}>
              <label htmlFor="branch-code">كود الفرع</label>
              <input
                id="branch-code"
                className={`${s.inp} ${s.inpMono}`}
                data-testid="branch-code"
                placeholder="BB-OLAYA"
                value={branchCode}
                onChange={(e) => setBranchCode(e.target.value)}
              />
            </div>
            <div className={s.fld}>
              <label htmlFor="username">الحساب</label>
              <input
                id="username"
                className={`${s.inp} ${s.inpMono}`}
                data-testid="username"
                placeholder="اسم المستخدم"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className={s.fld}>
              <label htmlFor="device-name">اسم هذا الجهاز (يُربط بالفرع)</label>
              <input
                id="device-name"
                className={`${s.inp} ${s.inpRo}`}
                value={`لوحة ${branchCode || "الفرع"}`}
                readOnly
              />
            </div>
            <div className={s.note}>
              <span>الجهاز يُربط بالفرع ويظهر لدى التاجر (M-04) — أي فك ربط يتطلب مدير الفرع.</span>
            </div>
          </div>

          {/* عمود PIN */}
          <div className={s.colC}>
            <label className={s.pinLabel} htmlFor="pin">
              الرقم السري PIN
            </label>
            <input
              id="pin"
              className={`${s.pinInput} ${error ? s.pinErr : ""}`}
              data-testid="pin"
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
            {error && (
              <div className={s.noteErr} data-testid="login-error">
                {error}
              </div>
            )}
            <div className={s.numpad}>
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <button key={d} type="button" className={s.numBtn} onClick={() => pressDigit(d)}>
                  {d}
                </button>
              ))}
              <button type="button" className={`${s.numBtn} ${s.numGhost}`} tabIndex={-1} aria-hidden="true" />
              <button type="button" className={s.numBtn} onClick={() => pressDigit("0")}>
                0
              </button>
              <button type="button" className={s.numBtn} onClick={backspace} aria-label="حذف">
                ⌫
              </button>
            </div>
            <button
              className={s.submit}
              data-testid="login-submit"
              disabled={busy || !branchCode || !username || pin.length < 4}
              onClick={login}
            >
              دخول
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
