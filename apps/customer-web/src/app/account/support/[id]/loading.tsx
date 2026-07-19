/** هيكل تحميل فوري للمسار الديناميكي — يمنع شاشة بيضاء أثناء تحميل الحزمة */
export default function Loading() {
  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "20px 16px" }} aria-busy="true">
      <div
        style={{
          height: 26,
          width: "50%",
          borderRadius: 10,
          background: "var(--pk-cloud-2)"
        }}
      />
      <div
        style={{
          height: 120,
          marginTop: 16,
          borderRadius: 16,
          background: "var(--pk-cloud-2)"
        }}
      />
    </main>
  );
}
