"use client";

/** C-60 — سياراتي: عرض/تعيين الافتراضية/حذف. الإضافة تتم أثناء إتمام الطلب. */
import { useState } from "react";
import { api, getToken } from "@/lib/api";
import { useApi, useIsoLayout } from "@/lib/use-api";
import { GuestGate, TabBar } from "../../shell";
import { ITrash, SubHead } from "../ui";
import pageStyles from "../../page.module.css";
import styles from "../account.module.css";

interface Vehicle {
  id: string;
  make_ar: string | null;
  model_ar: string | null;
  color_ar: string;
  plate_short: string;
  is_default: boolean;
}

export default function VehiclesPage() {
  const [guest, setGuest] = useState<boolean | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  useIsoLayout(() => setGuest(!getToken()), []);
  const { data: vehicles, error, mutate } = useApi<Vehicle[]>(
    guest === false ? "/v1/customers/me/vehicles" : null
  );

  const setDefault = async (id: string) => {
    setBusyId(id);
    try {
      await api("PATCH", `/v1/customers/me/vehicles/${id}`, { set_default: true });
      mutate((prev) => prev?.map((v) => ({ ...v, is_default: v.id === id })) ?? prev);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("حذف هذه السيارة من حسابك؟")) return;
    setBusyId(id);
    try {
      await api("DELETE", `/v1/customers/me/vehicles/${id}`);
      mutate((prev) => prev?.filter((v) => v.id !== id) ?? prev);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className={pageStyles.page}>
      <SubHead title="سياراتي" />
      <div className={pageStyles.body}>
        {guest && <GuestGate next="/account/vehicles" message="سجّل دخولك لإدارة سياراتك" />}
        {guest === false && (
          <>
            {error && (
              <div className={pageStyles.noteErr} role="alert">
                <span>{error}</span>
              </div>
            )}
            {vehicles && vehicles.length === 0 && (
              <div className={pageStyles.acCard}>
                <div className={pageStyles.acMuted}>
                  لا سيارات محفوظة — تُضاف أثناء إتمام الطلب (حقلان فقط) وتظهر هنا
                </div>
              </div>
            )}
            {vehicles?.map((v) => (
              <div key={v.id} className={pageStyles.acCard} data-testid="vehicle-card">
                <div className={pageStyles.acRow}>
                  <span>
                    {[v.model_ar ?? v.make_ar, v.color_ar].filter(Boolean).join(" · ") || v.color_ar}
                    {v.is_default && <b> · الافتراضية</b>}
                  </span>
                  <span className={pageStyles.acAmt}>•••• {v.plate_short}</span>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  {!v.is_default && (
                    <button
                      type="button"
                      className={styles.primaryBtn}
                      style={{ flex: 1 }}
                      disabled={busyId === v.id}
                      onClick={() => void setDefault(v.id)}
                    >
                      اجعلها الافتراضية
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.dangerBtn}
                    style={{ marginTop: 0, width: v.is_default ? "100%" : "auto", paddingInline: 18 }}
                    disabled={busyId === v.id}
                    onClick={() => void remove(v.id)}
                    aria-label="حذف السيارة"
                  >
                    <ITrash />
                  </button>
                </div>
              </div>
            ))}
            <div className={pageStyles.acMuted}>
              اللوحات مشفرة ولا تظهر كاملة إلا لموظف التسليم أثناء طلبك النشط فقط.
            </div>
          </>
        )}
      </div>
      <TabBar />
    </main>
  );
}
