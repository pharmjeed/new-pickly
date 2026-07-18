"use client";

/**
 * M-10: الطاقم — إدارة كاملة ضمن نطاق الفاعل (docs/16§1 «الموظفون والأدوار»):
 * إضافة موظف بدور وفروع، تعديل الدور/الفروع/PIN، إيقاف/تفعيل.
 * التدرّج يمنع منح دور برتبة ≥ رتبة الفاعل — يُنفَّذ في الخادم ويُعكس هنا بإخفاء الخيارات.
 * الشكل: design/merchant/M-10.html وM-12.html
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import { Qirtas } from "@/components/qirtas";
import { clearToken, getToken, ApiError, apiGet, apiPost, apiPatch } from "@/lib/api";
import s from "./staff.module.css";

type Staff = {
  id: string;
  username: string;
  full_name: string;
  role_key: string;
  status: string;
  branches: string[];
  branch_ids: string[];
  can_manage: boolean;
};

type Branch = { id: string; name_ar: string };

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

/** مرآة تدرّج الخادم — لإخفاء ما سيُرفض أصلاً (الإنفاذ الحقيقي في API) */
const ROLE_RANK: Record<string, number> = {
  owner: 5,
  general_manager: 4,
  operations_manager: 3,
  branch_manager: 2,
  cashier: 1,
  kitchen: 1,
  handoff: 1,
  finance: 1,
  analyst: 1
};
const GRANTABLE = ["general_manager", "operations_manager", "branch_manager", "cashier", "kitchen", "handoff", "finance", "analyst"];
const BRANCH_BOUND = new Set(["operations_manager", "branch_manager", "cashier", "kitchen", "handoff"]);

const STATUS_AR: Record<string, { label: string; cls: string }> = {
  active: { label: "نشط", cls: "b-lime" },
  suspended: { label: "معلق مؤقتاً", cls: "b-soft" },
  invited: { label: "مدعو", cls: "b-warn" }
};

const plain = (r: string) => r.replace(/^merchant:/, "");

/** قراءة أدوار/نطاق الجلسة من التوكن (عرض فقط — الخادم هو الحكم) */
function sessionClaims(): { roles: string[]; branch_ids: string[] } {
  const t = getToken();
  if (!t) return { roles: [], branch_ids: [] };
  try {
    const payload = JSON.parse(atob(t.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as {
      roles?: string[];
      branch_ids?: string[];
    };
    return { roles: payload.roles ?? [], branch_ids: payload.branch_ids ?? [] };
  } catch {
    return { roles: [], branch_ids: [] };
  }
}

export default function StaffPage() {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  // نموذج إضافة/تعديل
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null); // null = إضافة
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [roleKey, setRoleKey] = useState("cashier");
  const [branchIds, setBranchIds] = useState<string[]>([]);

  const claims = useMemo(sessionClaims, []);
  const myRank = useMemo(() => Math.max(0, ...claims.roles.map((r) => ROLE_RANK[plain(r)] ?? 0)), [claims]);
  const fullScope = useMemo(() => claims.roles.some((r) => ["owner", "general_manager"].includes(plain(r))), [claims]);
  const grantable = useMemo(() => GRANTABLE.filter((r) => (ROLE_RANK[r] ?? 0) < myRank), [myRank]);
  // الفروع القابلة للتعيين: كل فروع التاجر للمالك/المدير العام، وفروع التوكن لمن دونهما
  const assignableBranches = useMemo(
    () => (fullScope ? branches : branches.filter((b) => claims.branch_ids.includes(b.id))),
    [branches, fullScope, claims]
  );

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
    apiGet<Staff[]>("/api/v1/merchant/staff").then(setStaff).catch(onApiError);
  }, [onApiError]);

  useEffect(() => {
    load();
    apiGet<Branch[]>("/api/v1/merchant/branches")
      .then((list) => setBranches(list.map((b) => ({ id: b.id, name_ar: b.name_ar }))))
      .catch(onApiError);
  }, [load, onApiError]);

  const resetForm = () => {
    setEditId(null);
    setFullName("");
    setUsername("");
    setPin("");
    // الافتراضي الأدنى امتيازاً — منح الأدوار العليا قرار مقصود لا افتراضي
    setRoleKey(grantable.includes("cashier") ? "cashier" : grantable[0] ?? "cashier");
    setBranchIds([]);
    setFormError(null);
  };

  const openAdd = () => {
    resetForm();
    setFormOpen(true);
  };

  const openEdit = (m: Staff) => {
    resetForm();
    setEditId(m.id);
    setFullName(m.full_name);
    setUsername(m.username);
    setRoleKey(m.role_key);
    setBranchIds(m.branch_ids);
    setFormOpen(true);
  };

  const toggleBranch = (id: string) =>
    setBranchIds((cur) => (cur.includes(id) ? cur.filter((b) => b !== id) : [...cur, id]));

  const validate = (): string | null => {
    if (fullName.trim().length < 2) return "اسم الموظف مطلوب";
    if (!editId && !/^[a-zA-Z0-9._-]{3,32}$/.test(username.trim())) return "اسم الحساب: أحرف لاتينية/أرقام 3-32 (يُستخدم لدخول الفرع)";
    if (!editId && !/^\d{4,6}$/.test(pin)) return "الرمز السري: 4-6 أرقام";
    if (editId && pin && !/^\d{4,6}$/.test(pin)) return "الرمز السري الجديد: 4-6 أرقام";
    if (BRANCH_BOUND.has(roleKey) && branchIds.length === 0) return "هذا الدور يتطلب اختيار فرع واحد على الأقل";
    if (!editId && staff?.some((m) => m.username.toLowerCase() === username.trim().toLowerCase()))
      return "اسم الحساب مستخدم مسبقاً لموظف آخر";
    return null;
  };

  const submit = async () => {
    const v = validate();
    if (v) return setFormError(v);
    setSaving(true);
    setFormError(null);
    try {
      if (editId) {
        await apiPatch(`/api/v1/merchant/staff/${editId}`, {
          full_name: fullName.trim(),
          role_key: roleKey,
          branch_ids: branchIds,
          ...(pin ? { pin } : {})
        });
      } else {
        await apiPost("/api/v1/merchant/staff", {
          full_name: fullName.trim(),
          username: username.trim(),
          pin,
          role_key: roleKey,
          branch_ids: branchIds
        });
      }
      resetForm();
      setFormOpen(false);
      load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onApiError(e);
      setFormError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (m: Staff) => {
    const next = m.status === "suspended" ? "active" : "suspended";
    if (next === "suspended" && !confirm(`إيقاف «${m.full_name}» مؤقتاً؟ ستُلغى جلساته فوراً.`)) return;
    setPending(m.id);
    setError(null);
    try {
      await apiPatch(`/api/v1/merchant/staff/${m.id}`, { status: next });
      load();
    } catch (e) {
      onApiError(e);
    } finally {
      setPending(null);
    }
  };

  const canManage = grantable.length > 0;

  return (
    <Shell
      title="الطاقم"
      crumb="أدوار الجدول التسعة (RBAC) — امنح كل موظف دوره وفروعه"
      actions={
        canManage ? (
          <button type="button" className={s.addBtn} data-testid="staff-add-toggle" onClick={openAdd}>
            + إضافة موظف
          </button>
        ) : undefined
      }
    >
      {error && (
        <div className="note err" data-testid="staff-error">
          {error}
        </div>
      )}

      {/* ===== نموذج إضافة/تعديل موظف ===== */}
      {formOpen && (
        <div className={s.addForm} data-testid="staff-form">
          <h2 className={s.formTitle}>{editId ? "تعديل موظف" : "موظف جديد"}</h2>
          <div className={s.formGrid}>
            <label className={s.field}>
              <span>اسم الموظف *</span>
              <input
                value={fullName}
                data-testid="staff-name"
                placeholder="مثال: راشد العتيبي"
                onChange={(e) => setFullName(e.target.value)}
              />
            </label>
            <label className={s.field}>
              <span>اسم الحساب (لدخول الفرع) *</span>
              <input
                value={username}
                data-testid="staff-username"
                placeholder="مثال: rashed101"
                dir="ltr"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                disabled={!!editId}
                // الأسماء تُخزن صغيرة دائماً — دخول الفرع يطبّعها كذلك (iOS يكبّر أول حرف)
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
              />
            </label>
            <label className={s.field}>
              <span>{editId ? "رمز سري جديد (اتركه فارغاً للإبقاء)" : "الرمز السري PIN *"}</span>
              <input
                value={pin}
                data-testid="staff-pin"
                placeholder="4-6 أرقام"
                dir="ltr"
                inputMode="numeric"
                maxLength={6}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              />
            </label>
            <label className={s.field}>
              <span>الدور *</span>
              <select value={roleKey} data-testid="staff-role" onChange={(e) => setRoleKey(e.target.value)}>
                {grantable.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_AR[r] ?? r}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className={s.branchesBlock}>
            <span className={s.branchesLabel}>
              الفروع {BRANCH_BOUND.has(roleKey) ? "(فرع واحد على الأقل) *" : "(اختياري لهذا الدور)"}
            </span>
            <div className={s.branchChips}>
              {assignableBranches.length === 0 && <span className={s.noBranches}>لا فروع ضمن نطاقك</span>}
              {assignableBranches.map((b) => {
                const on = branchIds.includes(b.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    className={`${s.chip} ${on ? s.chipOn : ""}`}
                    data-testid="staff-branch-chip"
                    aria-pressed={on}
                    onClick={() => toggleBranch(b.id)}
                  >
                    {on ? "✓ " : ""}
                    {b.name_ar}
                  </button>
                );
              })}
            </div>
          </div>

          {formError && (
            <div className="note err" data-testid="staff-form-error">
              {formError}
            </div>
          )}

          <div className={s.formActions}>
            <button type="button" className={s.saveBtn} data-testid="staff-submit" disabled={saving} onClick={submit}>
              {saving ? "…جارٍ الحفظ" : editId ? "حفظ التعديلات" : "إضافة الموظف"}
            </button>
            <button
              type="button"
              className={s.cancelBtn}
              onClick={() => {
                resetForm();
                setFormOpen(false);
              }}
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      {!staff && !error && <div className="skl" style={{ height: 260 }} />}

      {staff && staff.length === 0 && !formOpen && (
        <div className="empty">
          <Qirtas mood="sleepy" size={96} />
          <b>لا موظفين بعد</b>
          <p>{canManage ? "ابدأ بإضافة موظف عبر زر «إضافة موظف» بالأعلى" : "لا موظفين ضمن نطاقك"}</p>
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
                  {canManage && <th>إجراءات</th>}
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
                      {canManage && (
                        <td>
                          {m.can_manage ? (
                            <div className={s.rowActions}>
                              <button
                                type="button"
                                className={s.editBtn}
                                data-testid="staff-edit"
                                disabled={pending === m.id}
                                onClick={() => openEdit(m)}
                              >
                                تعديل
                              </button>
                              <button
                                type="button"
                                className={m.status === "suspended" ? s.editBtn : s.delBtn}
                                data-testid="staff-toggle-status"
                                disabled={pending === m.id}
                                onClick={() => toggleStatus(m)}
                              >
                                {m.status === "suspended" ? "تفعيل" : "إيقاف"}
                              </button>
                            </div>
                          ) : (
                            <span className={s.noActions}>—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="note soft">
            يدخل الموظف من لوحة الفرع بكود الفرع + اسم الحساب + الرمز السري. الأدوار المساوية لدورك أو الأعلى تُدار عبر
            فريق نجاح التجار.
          </div>
        </>
      )}
    </Shell>
  );
}
