import { QirtasLoader } from "../../qirtas";
import styles from "./restaurant.module.css";

/**
 * المسار ديناميكي (SSR لكل طلب) — بدون حد التحميل هذا يبقى النقر على بطاقة
 * المطعم بلا أي استجابة مرئية حتى يرد الخادم، ومعه الانتقال فوري.
 */
export default function Loading() {
  return (
    <main className={styles.page}>
      <div className={styles.loaderWrap}>
        <QirtasLoader />
      </div>
    </main>
  );
}
