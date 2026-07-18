import { QirtasLoader } from "../../qirtas";
import { TabBar } from "../../shell";

/**
 * المسار ديناميكي (SSR لكل طلب) — حد التحميل يجعل فتح صفحة التتبع فورياً
 * بنفس هيكل حالة «جارٍ الجلب» في الصفحة نفسها (pk-wrap + الشريط السفلي).
 */
export default function Loading() {
  return (
    <main className="pk-wrap" style={{ paddingBottom: 92 }}>
      <QirtasLoader />
      <TabBar />
    </main>
  );
}
