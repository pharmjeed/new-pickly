"use client";

/**
 * نافذة السبب الإلزامي — كل فعل حساس يتطلب سبباً ≥3 أحرف يدخل سجل التدقيق (BR-15).
 */
import { useState } from "react";
import s from "./reason-modal.module.css";

export default function ReasonModal({
  title,
  hint,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onClose
}: {
  title: string;
  hint?: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const valid = reason.trim().length >= 3;

  return (
    <div className={s.backdrop} role="dialog" aria-modal="true" aria-label={title} data-testid="reason-modal">
      <div className={s.modal}>
        <h3 className={s.title}>{title}</h3>
        <div className="fld">
          <label htmlFor="action-reason">السبب (إلزامي — يدخل سجل التدقيق)</label>
          <textarea
            id="action-reason"
            data-testid="reason-input"
            placeholder="اكتب السبب بوضوح…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
          <span className="hint">{hint ?? "3 أحرف على الأقل"}</span>
        </div>
        <div className={s.actions}>
          <button
            type="button"
            className={`btn sm ${danger ? "danger" : ""}`}
            data-testid="reason-submit"
            disabled={!valid || busy}
            onClick={() => onConfirm(reason.trim())}
          >
            {confirmLabel}
          </button>
          <button type="button" className="btn sm sec2" data-testid="reason-cancel" onClick={onClose}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
