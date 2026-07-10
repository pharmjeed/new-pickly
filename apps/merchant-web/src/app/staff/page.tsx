"use client";

/**
 * M-10: الطاقم — GET /api/v1/merchant/staff (قراءة فقط في الطيار).
 * الشكل: جدول الموظفين والأدوار كما في design/merchant/M-10.html وM-12.html
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import {clearToken,  ApiError, apiGet } from "@/lib/api";
import s from "./staff.module.css";

type Staff = {
  id: string;
  username: string;
  full_name: string;
  role_key: string;
  status: string;
  branches: string[];
};

const ROLE_AR: Record<string, string> = {
  owner: "مالك المنشأة",
  general_manager: "مدير عام",
  operations_manager: "مدير عمليات",
  branch_manager: "مدير فرع",
  cashier: "كاشير",
  kitchen: "مطبخ (KDS)",
  handoff: "موظف تسليم",
  finance: "محاسب",
  analyst: "محلل تقارير"
};

const STATUS_AR: Record<string, { label: string; cls: string }> = {
  active: { label: "نشط", cls: "b-lime" },
  suspended: { label: "معلق مؤقتاً", cls: "b-soft" },
  invited: { label: "مدعو", cls: "b-warn" }
};

export default function StaffPage() {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Staff[]>("/api/v1/merchant/staff")
      .then(setStaff)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) {
          clearToken();
          router.replace("/");
          return;
        }
        setError((e as Error).message);
      });
  }, [router]);

  return (
    <Shell title="الطاقم" crumb="أدوار الجدول التسعة (RBAC) — قراءة فقط في نطاق الطيار">
      {error && (
        <div className="note err" data-testid="staff-error">
          {error}
        </div>
      )}

      {!staff && !error && <div className="skl" style={{ height: 260 }} />}

      {staff && staff.length === 0 && (
        <div className="empty">
          <div className="ic">👥</div>
          <b>لا موظفين بعد</b>
          <p>تُدار حسابات الطاقم عبر فريق نجاح التجار في نطاق الطيار</p>
        </div>
      )}

      {staff && staff.length > 0 && (
        <>
          <div className="tblwrap">
            <table className="tbl" data-testid="staff-table">
              <thead>
                <tr>
                  <th>الموظف</th>
                  <th>الحساب</th>
                  <th>الدور</th>
                  <th>الفروع</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((m) => {
                  const st = STATUS_AR[m.status] ?? { label: m.status, cls: "b-soft" };
                  return (
                    <tr key={m.id} data-testid="staff-row">
                      <td>
                        <span className={s.name}>{m.full_name}</span>
                      </td>
                      <td>
                        <span className={s.username}>{m.username}</span>
                      </td>
                      <td>{ROLE_AR[m.role_key] ?? m.role_key}</td>
                      <td>
                        <span className={s.branches}>{m.branches.length > 0 ? m.branches.join(" · ") : "الكل"}</span>
                      </td>
                      <td>
                        <span className={`badge ${st.cls}`} style={{ fontSize: "10.5px" }}>
                          {st.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="note soft">
            إدارة الطاقم (دعوة/تعديل/إيقاف) خارج نطاق الطيار — تتم عبر فريق نجاح التجار.
          </div>
        </>
      )}
    </Shell>
  );
}
