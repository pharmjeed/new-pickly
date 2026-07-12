/** تصغير الصورة في المتصفح إلى ≤maxPx وJPEG q0.72 → data URL خفيف */
export function resizeImage(file: File, maxPx = 800): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("تعذّرت قراءة الصورة"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("ملف صورة غير صالح"));
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("تعذّر تجهيز الصورة"));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
