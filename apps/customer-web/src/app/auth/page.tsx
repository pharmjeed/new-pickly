"use client";

/** P2: المصادقة — Stepper واحد: جوال ← OTP ← الاسم (docs/21§1 · design/customer/P2.html C-05→C-07) */
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, setTokens } from "@/lib/api";
import { cacheClear } from "@/lib/cache";
import { QirtasLive } from "../qirtas-motion";
import s from "./auth.module.css";

const OTP_LEN = 4; // الخادم يولّد 4 أرقام (generateOtpCode: 1000-9999)
const RESEND_SECONDS = 47;

/** قائمة تحويلات الدول — السعودية أولاً ثم الخليج والعالم العربي ثم الأشهر عالمياً */
const COUNTRIES = [
  { iso: "SA", dial: "+966", flag: "🇸🇦", name: "السعودية" },
  { iso: "AE", dial: "+971", flag: "🇦🇪", name: "الإمارات" },
  { iso: "KW", dial: "+965", flag: "🇰🇼", name: "الكويت" },
  { iso: "BH", dial: "+973", flag: "🇧🇭", name: "البحرين" },
  { iso: "QA", dial: "+974", flag: "🇶🇦", name: "قطر" },
  { iso: "OM", dial: "+968", flag: "🇴🇲", name: "عُمان" },
  { iso: "YE", dial: "+967", flag: "🇾🇪", name: "اليمن" },
  { iso: "EG", dial: "+20", flag: "🇪🇬", name: "مصر" },
  { iso: "JO", dial: "+962", flag: "🇯🇴", name: "الأردن" },
  { iso: "IQ", dial: "+964", flag: "🇮🇶", name: "العراق" },
  { iso: "SY", dial: "+963", flag: "🇸🇾", name: "سوريا" },
  { iso: "LB", dial: "+961", flag: "🇱🇧", name: "لبنان" },
  { iso: "PS", dial: "+970", flag: "🇵🇸", name: "فلسطين" },
  { iso: "SD", dial: "+249", flag: "🇸🇩", name: "السودان" },
  { iso: "LY", dial: "+218", flag: "🇱🇾", name: "ليبيا" },
  { iso: "TN", dial: "+216", flag: "🇹🇳", name: "تونس" },
  { iso: "DZ", dial: "+213", flag: "🇩🇿", name: "الجزائر" },
  { iso: "MA", dial: "+212", flag: "🇲🇦", name: "المغرب" },
  { iso: "MR", dial: "+222", flag: "🇲🇷", name: "موريتانيا" },
  { iso: "SO", dial: "+252", flag: "🇸🇴", name: "الصومال" },
  { iso: "DJ", dial: "+253", flag: "🇩🇯", name: "جيبوتي" },
  { iso: "KM", dial: "+269", flag: "🇰🇲", name: "جزر القمر" },
  { iso: "TR", dial: "+90", flag: "🇹🇷", name: "تركيا" },
  { iso: "PK", dial: "+92", flag: "🇵🇰", name: "باكستان" },
  { iso: "IN", dial: "+91", flag: "🇮🇳", name: "الهند" },
  { iso: "BD", dial: "+880", flag: "🇧🇩", name: "بنغلاديش" },
  { iso: "PH", dial: "+63", flag: "🇵🇭", name: "الفلبين" },
  { iso: "ID", dial: "+62", flag: "🇮🇩", name: "إندونيسيا" },
  { iso: "MY", dial: "+60", flag: "🇲🇾", name: "ماليزيا" },
  { iso: "US", dial: "+1", flag: "🇺🇸", name: "أمريكا" },
  { iso: "GB", dial: "+44", flag: "🇬🇧", name: "بريطانيا" },
  { iso: "FR", dial: "+33", flag: "🇫🇷", name: "فرنسا" },
  { iso: "DE", dial: "+49", flag: "🇩🇪", name: "ألمانيا" },
  { iso: "CA", dial: "+1", flag: "🇨🇦", name: "كندا" },
  { iso: "AU", dial: "+61", flag: "🇦🇺", name: "أستراليا" },
  { iso: "CN", dial: "+86", flag: "🇨🇳", name: "الصين" },
  { iso: "JP", dial: "+81", flag: "🇯🇵", name: "اليابان" },
  { iso: "KR", dial: "+82", flag: "🇰🇷", name: "كوريا الجنوبية" },
  { iso: "RU", dial: "+7", flag: "🇷🇺", name: "روسيا" },
  { iso: "BR", dial: "+55", flag: "🇧🇷", name: "البرازيل" }
] as const;
type Country = (typeof COUNTRIES)[number];

function ChevBack() {
  return (
    <svg width="16" height="16" viewBox="0 0 100 100" aria-hidden="true">
      <path d="M60,26 L36,50 L60,74" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 100 100" aria-hidden="true">
      <path d="M26,38 L50,62 L74,38" fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** العلم الرسمي — صور flagcdn (الإيموجي لا يُصيَّر كأعلام على أندرويد/ويندوز) */
function Flag({ iso, name }: { iso: string; name: string }) {
  const lc = iso.toLowerCase();
  return (
    // eslint-disable-next-line @next/next/no-img-element -- أعلام خارجية صغيرة؛ next/image يتطلب تهيئة نطاقات
    <img
      className={s.ccFlagImg}
      src={`https://flagcdn.com/w40/${lc}.png`}
      srcSet={`https://flagcdn.com/w80/${lc}.png 2x`}
      width={26}
      height={19}
      alt={`علم ${name}`}
    />
  );
}

function AuthFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/";

  const [step, setStep] = useState<"phone" | "otp" | "name">("phone");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState<Country>(COUNTRIES[0]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const otpRef = useRef<HTMLInputElement>(null);

  // يفهم الصيغتين: 05XXXXXXXX (من الصفر) أو 5XXXXXXXX — الصفر الأول يُحذف قبل التحويلة
  const nationalDigits = phone.replace(/\D/g, "").replace(/^0/, "");
  const e164 = `${country.dial}${nationalDigits}`;
  const phoneValid =
    country.iso === "SA"
      ? nationalDigits.length === 9 && nationalDigits.startsWith("5")
      : nationalDigits.length >= 7;

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
      await api("POST", "/v1/auth/otp/request", { phone: e164 });
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
        { phone: e164, code }
      );
      cacheClear(); // دخول مستخدم (قد يكون غير السابق) — لا تُعرض بيانات me/* مخبأة لغيره
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
              <button
                type="button"
                className={s.ccBtn}
                data-testid="country-picker"
                aria-label={`الدولة: ${country.name} ${country.dial}`}
                onClick={() => setPickerOpen(true)}
              >
                <Flag iso={country.iso} name={country.name} />
                <span className={s.mono}>{country.dial}</span>
                <span className={s.ccChev} aria-hidden="true">
                  <ChevDown />
                </span>
              </button>
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
            <span className={s.hint}>
              اكتب رقمك كاملاً من الصفر (05…) أو مباشرة من 5 — النظام يفهم الطريقتين
            </span>
            {error && (
              <div className={s.errMsg} data-testid="auth-error">
                {error}
              </div>
            )}
          </div>

          <button className={s.btn} data-testid="phone-submit" disabled={busy || !phoneValid} onClick={requestOtp}>
            تسجيل الدخول / إنشاء حساب
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

          {/* منتقي الدولة — قائمة تمرير بكل التحويلات مع الأعلام */}
          {pickerOpen && (
            <div className={s.sheetOverlay} onClick={() => setPickerOpen(false)}>
              <div className={s.sheet} role="dialog" aria-label="اختر الدولة" onClick={(e) => e.stopPropagation()}>
                <div className={s.sheetHead}>
                  <b>اختر الدولة</b>
                  <button className={s.link} onClick={() => setPickerOpen(false)}>
                    إغلاق
                  </button>
                </div>
                <ul className={s.ccList}>
                  {COUNTRIES.map((c) => (
                    <li key={c.iso}>
                      <button
                        type="button"
                        className={`${s.ccItem} ${c.iso === country.iso ? s.ccItemOn : ""}`}
                        onClick={() => {
                          setCountry(c);
                          setPickerOpen(false);
                        }}
                      >
                        <Flag iso={c.iso} name={c.name} />
                        <span className={s.ccName}>{c.name}</span>
                        <span className={`${s.mono} ${s.ccDial}`}>{c.dial}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
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
              أرسلنا رمزاً إلى <b className={`${s.mono} ${s.strong}`}>{e164}</b> ·{" "}
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
