"use client";

/**
 * B-01: دخول الفرع (design/branch/B-01.html) — كود الفرع + الحساب + PIN،
 * جهاز مسمى يُربط بالفرع (يظهر لدى التاجر M-04).
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import s from "./login.module.css";
import { QirtasBadge, QirtasMono, Wordmark } from "./qirtas";

const pad2 = (n: number): string => String(n).padStart(2, "0");

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
          <QirtasMono size={34} />
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
        {/* شعار الدخول — الشارة الكاملة + الاسم الثنائي (كتاب الهوية §5) */}
        <div className={s.hero}>
          <QirtasBadge size={84} />
          <Wordmark size={30} color="var(--pk-ink-900)" />
        </div>
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
                placeholder="101"
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
