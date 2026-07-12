"use client";

/**
 * M-02: معلومات المطعم — هوية العلامة كما تظهر للعميل في قائمة المطاعم:
 * الشعار (logo)، الغلاف (cover)، الاسم عربي/إنجليزي، نوع المطبخ.
 * GET /api/v1/merchant/profile · PATCH /api/v1/merchant/brands/{id}
 * الصور تُصغَّر في المتصفح وتُرسل data URL (نمط صور الأصناف نفسه).
 * التعديل للمالك/المدير العام فقط — البقية تصلهم 403 برسالة عربية.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import { clearToken, ApiError, apiGet, apiPatch } from "@/lib/api";
import { resizeImage } from "@/lib/image";
import s from "./profile.module.css";

type Brand = {
  id: string;
  name_ar: string;
  name_en: string | null;
  cuisine_ar: string | null;
  logo_url: string | null;
  cover_url: string | null;
  is_active: boolean;
};
type Profile = { merchant: { name_ar: string; name_en: string | null }; brands: Brand[] };

function BrandCard({
  brand,
  onError,
  onSaved
}: {
  brand: Brand;
  onError: (e: unknown) => void;
  onSaved: () => void;
}) {
  const [nameAr, setNameAr] = useState(brand.name_ar);
  const [nameEn, setNameEn] = useState(brand.name_en ?? "");
  const [cuisine, setCuisine] = useState(brand.cuisine_ar ?? "");
  const [logo, setLogo] = useState<string | null>(brand.logo_url);
  const [cover, setCover] = useState<string | null>(brand.cover_url);
  const [logoChanged, setLogoChanged] = useState(false);
  const [coverChanged, setCoverChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  const pickImage = async (file: File | undefined, kind: "logo" | "cover") => {
    if (!file) return;
    setFormError(null);
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error("الصورة أكبر من 12MB");
      const dataUrl = await resizeImage(file, kind === "logo" ? 512 : 1200);
      if (kind === "logo") {
        setLogo(dataUrl);
        setLogoChanged(true);
      } else {
        setCover(dataUrl);
        setCoverChanged(true);
      }
      setSaved(false);
    } catch (e) {
      setFormError((e as Error).message);
    }
  };

  const save = async () => {
    if (nameAr.trim().length < 2) {
      setFormError("اسم المطعم العربي مطلوب (حرفان على الأقل)");
      return;
    }
    setSaving(true);
    setFormError(null);
    setSaved(false);
    try {
      await apiPatch(`/api/v1/merchant/brands/${brand.id}`, {
        name_ar: nameAr.trim(),
        name_en: nameEn.trim() || null,
        cuisine_ar: cuisine.trim() || null,
        ...(logoChanged ? { logo_data_url: logo ?? "" } : {}),
        ...(coverChanged ? { cover_data_url: cover ?? "" } : {})
      });
      setLogoChanged(false);
      setCoverChanged(false);
      setSaved(true);
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.status !== 401) setFormError(e.message);
      else onError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={s.card} data-testid="brand-card">
      <div className={s.cover}>
        {cover ? <img src={cover} alt="" /> : <span>لا صورة غلاف — تظهر خلف اسم المطعم في صفحة المنيو</span>}
        <div className={s.coverBtns}>
          <button type="button" className="btn sm" onClick={() => coverRef.current?.click()} data-testid="cover-pick">
            {cover ? "تغيير الغلاف" : "إضافة غلاف"}
          </button>
          {cover && (
            <button
              type="button"
              className="btn sm sec2"
              onClick={() => {
                setCover(null);
                setCoverChanged(true);
                setSaved(false);
              }}
            >
              إزالة
            </button>
          )}
        </div>
        <input
          ref={coverRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className={s.hiddenInput}
          onChange={(e) => {
            void pickImage(e.target.files?.[0], "cover");
            e.target.value = "";
          }}
        />
      </div>

      <div className={s.head}>
        <div className={s.logoWrap} data-testid="brand-logo">
          {logo ? <img src={logo} alt="" /> : <span>{nameAr.trim().charAt(0) || "م"}</span>}
        </div>
        <div className={s.headActs}>
          <button type="button" className="btn sm" onClick={() => logoRef.current?.click()} data-testid="logo-pick">
            {logo ? "تغيير الشعار" : "إضافة شعار"}
          </button>
          {logo && (
            <button
              type="button"
              className="btn sm sec2"
              onClick={() => {
                setLogo(null);
                setLogoChanged(true);
                setSaved(false);
              }}
            >
              إزالة
            </button>
          )}
        </div>
        <input
          ref={logoRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className={s.hiddenInput}
          onChange={(e) => {
            void pickImage(e.target.files?.[0], "logo");
            e.target.value = "";
          }}
        />
      </div>

      <div className={s.body}>
        <div className={s.grid}>
          <div className="fld">
            <label>اسم المطعم (عربي)</label>
            <input
              value={nameAr}
              onChange={(e) => {
                setNameAr(e.target.value);
                setSaved(false);
              }}
              maxLength={60}
              data-testid="brand-name-ar"
            />
          </div>
          <div className="fld">
            <label>الاسم (إنجليزي — اختياري)</label>
            <input
              value={nameEn}
              onChange={(e) => {
                setNameEn(e.target.value);
                setSaved(false);
              }}
              maxLength={60}
              dir="ltr"
              data-testid="brand-name-en"
            />
          </div>
          <div className="fld">
            <label>نوع المطبخ (اختياري)</label>
            <input
              value={cuisine}
              onChange={(e) => {
                setCuisine(e.target.value);
                setSaved(false);
              }}
              maxLength={40}
              placeholder="برجر · شاورما · قهوة مختصة…"
              data-testid="brand-cuisine"
            />
            <span className="hint">يظهر تحت اسم المطعم في بطاقته لدى العميل</span>
          </div>
        </div>

        {formError && (
          <div className="note err" style={{ marginBottom: 12 }} data-testid="brand-form-error">
            {formError}
          </div>
        )}

        <div className={s.foot}>
          <button type="button" className="btn" onClick={() => void save()} disabled={saving} data-testid="brand-save">
            {saving ? "جارٍ الحفظ…" : "حفظ التعديلات"}
          </button>
          {saved && <span className={s.saved}>✓ حُفظت — تظهر للعملاء فوراً</span>}
        </div>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onApiError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) {
        clearToken();
        router.replace("/");
        return;
      }
      setError((e as Error).message);
    },
    [router]
  );

  const load = useCallback(() => {
    apiGet<Profile>("/api/v1/merchant/profile").then(setProfile).catch(onApiError);
  }, [onApiError]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Shell title="معلومات المطعم" crumb="الشعار والغلاف والاسم — ما يراه العميل في قائمة المطاعم">
      {error && (
        <div className="note err" data-testid="profile-error">
          {error}
        </div>
      )}

      {!profile && !error && <div className="skl" style={{ height: 260 }} />}

      {profile && profile.brands.length === 0 && (
        <div className="empty">
          <div className="ic">🏪</div>
          <b>لا علامة تجارية بعد</b>
          <p>تُنشأ العلامة عند تفعيل حساب التاجر — تواصل مع دعم بيكلي</p>
        </div>
      )}

      {profile?.brands.map((b) => <BrandCard key={b.id} brand={b} onError={onApiError} onSaved={load} />)}

      {profile && (
        <div className="note soft">
          تعديل الهوية متاح للمالك والمدير العام فقط، ويُسجَّل في سجل التدقيق. الصور تُحفظ مصغّرة (شعار ≤512px ·
          غلاف ≤1200px).
        </div>
      )}
    </Shell>
  );
}
