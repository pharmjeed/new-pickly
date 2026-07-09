"use client";

import { useState } from "react";

/* نموذج تسجيل اهتمام المتاجر — يخزَّن محلياً (localStorage) في الطيار، لا backend له */
const STORAGE_KEY = "pickly.merchant-interest";

type Interest = {
  name: string;
  phone: string;
  brand: string;
  city: string;
  at: string;
};

export function InterestForm() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [brand, setBrand] = useState("");
  const [city, setCity] = useState("الرياض");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim() || !brand.trim()) {
      setError("فضلًا أكمل جميع الحقول المطلوبة.");
      return;
    }
    const entry: Interest = {
      name: name.trim(),
      phone: phone.trim(),
      brand: brand.trim(),
      city,
      at: new Date().toISOString()
    };
    try {
      const prev: Interest[] = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
      prev.push(entry);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prev));
    } catch {
      /* التخزين المحلي غير متاح — نكتفي برسالة النجاح في الطيار */
    }
    setError("");
    setDone(true);
  }

  if (done) {
    return (
      <div className="scard" style={{ padding: 26 }}>
        <div className="note-ok" role="status">
          <span aria-hidden="true">✓</span>
          <span>
            استلمنا طلبك — <b>سنتواصل معك</b> خلال يوم عمل.
          </span>
        </div>
      </div>
    );
  }

  return (
    <form className="scard" style={{ padding: 26 }} onSubmit={submit} noValidate>
      <b className="disp" style={{ fontSize: 18, fontWeight: 700 }}>
        نموذج تسجيل الاهتمام
      </b>
      <div className="frm-col">
        <div className="fld">
          <label htmlFor="mi-brand">الاسم التجاري *</label>
          <input
            id="mi-brand"
            name="brand"
            placeholder="كما يظهر للعملاء"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            required
          />
        </div>
        <div className="frm-row">
          <div className="fld">
            <label htmlFor="mi-name">اسم المسؤول *</label>
            <input
              id="mi-name"
              name="name"
              placeholder="سارة القحطاني"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="fld">
            <label htmlFor="mi-phone">الجوال *</label>
            <input
              id="mi-phone"
              name="phone"
              className="mono"
              inputMode="tel"
              placeholder="05X XXX XXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </div>
        </div>
        <div className="fld">
          <label htmlFor="mi-city">المدينة *</label>
          <select id="mi-city" name="city" value={city} onChange={(e) => setCity(e.target.value)}>
            <option>الرياض</option>
            <option>جدة</option>
            <option>الدمام</option>
            <option>أخرى</option>
          </select>
        </div>
        {error ? (
          <p style={{ fontSize: 13, color: "var(--err)" }} role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn btn-block">
          إرسال طلب الاهتمام
        </button>
      </div>
    </form>
  );
}
