"use client";

/**
 * M-12: التقييمات — GET /api/v1/merchant/reviews (منشورة/معلقة لفروع التاجر).
 * الشكل: design/merchant/M-12.html (جدول بلغة البوابة)
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Shell from "@/components/Shell";
import { Qirtas } from "@/components/qirtas";
import {clearToken,  ApiError, apiGet } from "@/lib/api";
import s from "./reviews.module.css";

type Review = {
  id: string;
  branch_name: string;
  rating_overall: number;
  comment: string | null;
  status: string;
  created_at: string;
};

const STATUS_AR: Record<string, { label: string; cls: string }> = {
  published: { label: "منشور", cls: "b-lime" },
  pending: { label: "قيد المراجعة", cls: "b-warn" },
  rejected: { label: "مرفوض", cls: "b-soft" }
};

function Stars({ n }: { n: number }) {
  return (
    <span className={s.stars} aria-label={`${n} من 5`}>
      {"★".repeat(n)}
      <span className={s.starsOff}>{"★".repeat(Math.max(0, 5 - n))}</span>
    </span>
  );
}

export default function ReviewsPage() {
  const router = useRouter();
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Review[]>("/api/v1/merchant/reviews")
      .then(setReviews)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) {
          clearToken();
          router.replace("/");
          return;
        }
        setError((e as Error).message);
      });
  }, [router]);

  const avg =
    reviews && reviews.length > 0
      ? (reviews.reduce((sum, r) => sum + r.rating_overall, 0) / reviews.length).toFixed(1)
      : null;

  return (
    <Shell title="التقييمات" crumb="تقييمات العملاء عبر فروعك — أحدث 100 تقييم">
      {error && (
        <div className="note err" data-testid="reviews-error">
          {error}
        </div>
      )}

      {!reviews && !error && <div className="skl" style={{ height: 260 }} />}

      {reviews && (
        <>
          <div className="kpis">
            <div className="kpi" data-testid="reviews-stat">
              <div className="k">متوسط التقييم</div>
              <div className="v">{avg ?? "—"}</div>
              <div className="d">من 5</div>
            </div>
            <div className="kpi" data-testid="reviews-stat">
              <div className="k">عدد التقييمات</div>
              <div className="v">{reviews.length}</div>
            </div>
            <div className="kpi" data-testid="reviews-stat">
              <div className="k">قيد المراجعة</div>
              <div className="v">{reviews.filter((r) => r.status === "pending").length}</div>
            </div>
          </div>

          {reviews.length === 0 ? (
            <div className="empty">
              <Qirtas mood="sleepy" size={96} />
              <b>لا تقييمات بعد</b>
              <p>تظهر تقييمات العملاء هنا بعد اكتمال الطلبات</p>
            </div>
          ) : (
            <div className="tblwrap">
              <table className="tbl" data-testid="reviews-table">
                <thead>
                  <tr>
                    <th>الفرع</th>
                    <th>التقييم</th>
                    <th>التعليق</th>
                    <th>الحالة</th>
                    <th>التاريخ</th>
                  </tr>
                </thead>
                <tbody>
                  {reviews.map((r) => {
                    const st = STATUS_AR[r.status] ?? { label: r.status, cls: "b-soft" };
                    return (
                      <tr key={r.id} data-testid="review-row">
                        <td>{r.branch_name}</td>
                        <td>
                          <Stars n={r.rating_overall} />
                        </td>
                        <td>
                          {r.comment ? (
                            <span className={s.comment}>{r.comment}</span>
                          ) : (
                            <span className={s.noComment}>بدون تعليق</span>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${st.cls}`} style={{ fontSize: "10.5px" }}>
                            {st.label}
                          </span>
                        </td>
                        <td>
                          <span className={`${s.meta} mono`}>{new Date(r.created_at).toLocaleDateString("en-GB")}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Shell>
  );
}
