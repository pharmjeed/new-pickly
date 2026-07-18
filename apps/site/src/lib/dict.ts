/**
 * قاموس الموقع التعريفي — عربي (الأصل الحرفي من S-01) + إنجليزي.
 * النص العربي منقول حرفياً من page.tsx/chrome.tsx السابقين — لا تعديل صياغة.
 * الـkickers اللاتينية (FEATURES…) ثابتة في الصفحة لأنها زخرفة هوية لا نصاً مترجماً.
 */
export type Lang = "ar" | "en";

const ar = {
  nav: {
    home: "بيكلي — الرئيسية",
    how: "كيف يعمل",
    merchants: "للمتاجر",
    pricing: "الأسعار",
    faq: "الأسئلة",
    switchLabel: "Switch to English"
  },
  hero: {
    pill: "قريبًا في السعودية · استلام ذكي من السيارة",
    h1a: "وصلت؟",
    h1b: "إحنا عرفنا.",
    sub: "بيكلي يبلّغ المطعم تلقائيًا لحظة اقتراب سيارتك — فيطلع لك الموظف بطلبك وأنت في مقعدك. بلا اتصال، بلا «وين طلبي؟»، بلا نزول مع الأطفال.",
    cta1: "حمّل التطبيق قريبًا",
    cta2: "سجّل متجرك",
    feats: ["رصد تلقائي ١٠٠–٣٠٠ م", "سيارتك هي عنوانك", "بلا عمولة على المتاجر", "تكامل Foodics"],
    mascotTitle: "القرطاس المبتسم — كاركتر بيكلي"
  },
  phone: {
    mode: "وضع القيادة",
    time: "١٢ دقيقة",
    sub: "حتى وصولك لبيست برجر — العليا",
    card1t: "الإبلاغ تلقائي",
    card1d: "عند دخولك نطاق ٣٠٠ متر يعرف المطعم أنك وصلت",
    card2t: "سيارتك: كامري · بيضاء · ٨٢٤١",
    card2d: "الموظف يعرف شكل سيارتك مسبقًا"
  },
  stats: [
    { to: 90, prefix: "", suffix: " ث", label: "متوسط التسليم بعد الرصد*" },
    { to: 0, prefix: "", suffix: "", label: "مكالمات «وين طلبي؟»" },
    { to: 0, prefix: "٪", suffix: "", label: "عمولة على قيمة الطلب" },
    { to: 300, prefix: "", suffix: " م", label: "نطاق الاستشعار الذكي" }
  ],
  footnote: "* أرقام مستهدفة من تصميم التجربة — ليست بيانات إنتاج.",
  features: {
    title: "ثلاث قدرات تلغي الانتظار.",
    lead: "بيكلي ليس تطبيق توصيل ولا منصة طلبات — هو طبقة تنسيق الاستلام الذكية بين سيارتك وباب المتجر.",
    cards: [
      {
        title: "رصد وصول تلقائي",
        text: "نطاق ذكي حول الفرع (١٠٠–٣٠٠ متر) يستشعر اقترابك ويبلّغ الموظف تلقائيًا — بلا زر، بلا اتصال. ولو تعطّل GPS؟ زر «وصلت» اليدوي موجود دائمًا.",
        tags: ["GEOFENCE", "AUTO-DETECT", "FALLBACK"]
      },
      {
        title: "سيارتك هي عنوانك",
        text: "سجّل سيارتك مرة واحدة — النوع واللون واللوحة — وتصبح «عنوان استلامك» الدائم. الموظف يعرف بالضبط أي سيارة يقصد، من أول مرة.",
        tags: ["ملف السيارة", "إعداد مرة واحدة"]
      },
      {
        title: "وضع قيادة آمن",
        text: "بعد الدفع تتحول الشاشة لوضع داكن هادئ: الوقت المتبقي وحالة طلبك فقط، بأحرف كبيرة — كل شيء يحدث تلقائيًا وأنت تسوق.",
        tags: ["DARK MODE", "بلا تشتيت"]
      }
    ]
  },
  how: {
    title: "من الطلب إلى يدك في ٣ خطوات.",
    lead: "إعداد أول مرة أقل من دقيقتين: سيارتك + إذن الموقع. بعدها كل شيء تلقائي.",
    steps: [
      { n: "١", title: "اطلب وادفع", text: "اطلب من متجرك المفضل وادفع داخل التطبيق. تظهر شاشة الاستلام فورًا مع كود طلبك." },
      { n: "٢", title: "انطلق وحنا نراقب", text: "اضغط «انطلقت» ويبدأ وضع القيادة. المتجر يجهّز طلبك على وقت وصولك المتوقع." },
      { n: "٣", title: "وصلت؟ إحنا عرفنا", text: "لحظة دخولك النطاق يُبلَّغ الموظف تلقائيًا ويخرج إليك بطلبك. تطابق الكود، استلم، وامشِ." }
    ]
  },
  merch: {
    title1: "لمتجرك: كاونتر أهدأ،",
    title2: "وعملاء أوفى.",
    checks: [
      { strong: "بلا عمولة على قيمة الطلب", text: " — رسوم بوابة الدفع القياسية فقط." },
      { strong: "", text: "لوحة موظف بسيطة: من قادم، متى يصل، وأي سيارة بالضبط." },
      { strong: "", text: "تكامل مع Foodics POS — طلباتك في نظامك الحالي، بلا شاشة إضافية." },
      { strong: "", text: "وداعًا لازدحام الاستلام ومكالمات «أنا واقف برا»." }
    ],
    cta: "سجّل متجرك مبكرًا",
    boardTitle: "لوحة الفرع — بيست برجر العليا",
    rows: [
      { car: "كامري بيضاء · ٨٢٤١", order: "موقف ٣", chip: "وصل الآن" },
      { car: "يوكن أسود · ٣٣١٩", order: "", chip: "٤ دقائق" },
      { car: "سوناتا رمادية · ٧٥٦٢", order: "", chip: "١١ دقيقة" }
    ],
    orderWord: "طلب"
  },
  sectors: {
    title: "مبني للمطاعم. جاهز لكل استلام.",
    lead: "أي متجر يسلّم طلبات محضّرة مسبقًا يستفيد من بيكلي:",
    items: ["مطاعم", "مقاهي", "مخابز وحلويات", "صيدليات", "بقالة وسوبرماركت", "ورد وهدايا", "تجزئة (اطلب واستلم)"]
  },
  pricing: {
    title: "تسعير بلا مفاجآت.",
    lead: "نربح فقط عندما يكتمل استلام — لا اشتراكات إجبارية ولا عمولات مخفية.",
    hotTag: "للمتاجر",
    cards: [
      { name: "للعملاء", amount: "رسوم رمزية", text: "لكل عملية استلام ناجحة — تُعرض بوضوح قبل الدفع. التطبيق مجاني." },
      { name: "بلا عمولة", amount: "٪٠", text: "على قيمة الطلب. رسوم بوابة الدفع القياسية فقط — أرباح طلبك تبقى لك بالكامل." },
      { name: "التكاملات", amount: "Foodics", text: "ربط مباشر مع نظام نقاط البيع — الطلبات والحالات في مكان واحد." }
    ]
  },
  faq: {
    title: "أسئلة تدور في بالك.",
    items: [
      {
        q: "ماذا لو تعطّل الـ GPS أو رفضت إذن الموقع؟",
        a: "الرصد التلقائي هو الأساس، لكن زر «وصلت» اليدوي موجود دائمًا في شاشة الاستلام — التجربة لا تتوقف أبدًا على الاستشعار."
      },
      {
        q: "هل بيكلي تطبيق توصيل؟",
        a: "لا. بيكلي لا يوصّل ولا يتدخل في تجهيز الطلب — نحن ننسق لحظة الاستلام فقط: نخبر المتجر أنك وصلت، وأي سيارة أنت."
      },
      {
        q: "كيف يعرف الموظف سيارتي؟",
        a: "ملف سيارتك (النوع، اللون، اللوحة) يظهر للموظف مع طلبك، مع رقم الموقف إن وجد — يمشي إليك مباشرة دون بحث."
      },
      {
        q: "ماذا لو لم يجدني الموظف؟",
        a: "يتواصل معك عبر التطبيق برسالة جاهزة، ويظهر لكما كود التطابق نفسه — التسليم لا يتم إلا بتطابق الكود."
      },
      {
        q: "ماذا عن خصوصية موقعي؟",
        a: "نستخدم موقعك فقط أثناء رحلة استلام نشطة ولنطاق الفرع، ولا نتتبعك خارجها."
      }
    ]
  },
  join: {
    title1: "خلّك في سيارتك.",
    title2: "الباقي علينا.",
    sub: "اطلب من متصفحك الآن — وتطبيق الجوال في طريقه للمتاجر.",
    order: "اطلب الآن — عميل",
    merchants: "سجّل متجرك"
  },
  footer: {
    line: "© ٢٠٢٦ بيكلي — طبقة تنسيق الاستلام الذكية · صُنع في السعودية",
    terms: "الشروط",
    privacy: "الخصوصية"
  }
};

export type Dict = typeof ar;

const en: Dict = {
  nav: {
    home: "Pickly — Home",
    how: "How it works",
    merchants: "For merchants",
    pricing: "Pricing",
    faq: "FAQ",
    switchLabel: "التبديل إلى العربية"
  },
  hero: {
    pill: "Coming soon in Saudi Arabia · Smart curbside pickup",
    h1a: "You've arrived?",
    h1b: "We already know.",
    sub: "Pickly automatically notifies the restaurant the moment your car gets close — staff walk out with your order while you stay in your seat. No calls, no “where's my order?”, no unbuckling the kids.",
    cta1: "Get the app — soon",
    cta2: "Register your store",
    feats: ["Auto-detection 100–300 m", "Your car is your address", "Zero commission for stores", "Foodics integration"],
    mascotTitle: "Qirtas the smiling bag — Pickly's mascot"
  },
  phone: {
    mode: "Driving mode",
    time: "12 min",
    sub: "until you reach Best Burger — Olaya",
    card1t: "Automatic notification",
    card1d: "Once you enter the 300 m zone, the restaurant knows you've arrived",
    card2t: "Your car: Camry · White · 8241",
    card2d: "Staff know your car before you arrive"
  },
  stats: [
    { to: 90, prefix: "", suffix: "s", label: "average handoff after detection*" },
    { to: 0, prefix: "", suffix: "", label: "“where's my order?” calls" },
    { to: 0, prefix: "", suffix: "%", label: "commission on order value" },
    { to: 300, prefix: "", suffix: " m", label: "smart detection radius" }
  ],
  footnote: "* Target figures from experience design — not production data.",
  features: {
    title: "Three capabilities that kill the wait.",
    lead: "Pickly is not a delivery app or an ordering platform — it's the smart pickup-coordination layer between your car and the store's door.",
    cards: [
      {
        title: "Automatic arrival detection",
        text: "A smart zone around the branch (100–300 m) senses your approach and notifies staff automatically — no button, no call. GPS acting up? A manual “I've arrived” button is always there.",
        tags: ["GEOFENCE", "AUTO-DETECT", "FALLBACK"]
      },
      {
        title: "Your car is your address",
        text: "Register your car once — make, color, plate — and it becomes your permanent pickup address. Staff know exactly which car to walk to, from the very first time.",
        tags: ["Car profile", "One-time setup"]
      },
      {
        title: "Safe driving mode",
        text: "After payment, the screen switches to a calm dark mode: only time remaining and order status, in large type — everything happens automatically while you drive.",
        tags: ["DARK MODE", "Zero distraction"]
      }
    ]
  },
  how: {
    title: "From order to your hand in 3 steps.",
    lead: "First-time setup takes under two minutes: your car + location permission. After that, everything is automatic.",
    steps: [
      { n: "1", title: "Order & pay", text: "Order from your favorite store and pay in-app. The pickup screen appears instantly with your order code." },
      { n: "2", title: "Drive — we watch", text: "Tap “On my way” and driving mode starts. The store times your order to your expected arrival." },
      { n: "3", title: "Arrived? We knew", text: "The moment you enter the zone, staff are notified automatically and walk out with your order. Match the code, pick up, go." }
    ]
  },
  merch: {
    title1: "For your store: a calmer counter,",
    title2: "more loyal customers.",
    checks: [
      { strong: "Zero commission on order value", text: " — standard payment-gateway fees only." },
      { strong: "", text: "A simple staff board: who's coming, when they arrive, and exactly which car." },
      { strong: "", text: "Foodics POS integration — your orders inside your current system, no extra screen." },
      { strong: "", text: "Goodbye pickup crowding and “I'm parked outside” calls." }
    ],
    cta: "Register your store early",
    boardTitle: "Branch board — Best Burger, Olaya",
    rows: [
      { car: "White Camry · 8241", order: "Spot 3", chip: "Arrived now" },
      { car: "Black Yukon · 3319", order: "", chip: "4 min" },
      { car: "Gray Sonata · 7562", order: "", chip: "11 min" }
    ],
    orderWord: "Order"
  },
  sectors: {
    title: "Built for restaurants. Ready for every pickup.",
    lead: "Any store that hands over pre-prepared orders benefits from Pickly:",
    items: ["Restaurants", "Cafés", "Bakeries & sweets", "Pharmacies", "Grocery & supermarkets", "Flowers & gifts", "Retail (click & collect)"]
  },
  pricing: {
    title: "Pricing with no surprises.",
    lead: "We only earn when a pickup completes — no forced subscriptions, no hidden commissions.",
    hotTag: "For stores",
    cards: [
      { name: "For customers", amount: "A small fee", text: "Per successful pickup — shown clearly before payment. The app is free." },
      { name: "Zero commission", amount: "0%", text: "On order value. Standard gateway fees only — your order margins stay entirely yours." },
      { name: "Integrations", amount: "Foodics", text: "Direct POS connection — orders and statuses in one place." }
    ]
  },
  faq: {
    title: "Questions on your mind.",
    items: [
      {
        q: "What if GPS fails or I decline location permission?",
        a: "Auto-detection is the default, but a manual “I've arrived” button is always on the pickup screen — the experience never depends on sensing alone."
      },
      {
        q: "Is Pickly a delivery app?",
        a: "No. Pickly doesn't deliver and doesn't touch order preparation — we only coordinate the pickup moment: we tell the store you've arrived, and which car you're in."
      },
      {
        q: "How do staff recognize my car?",
        a: "Your car profile (make, color, plate) appears next to your order, with the parking spot number if available — staff walk straight to you, no searching."
      },
      {
        q: "What if staff can't find me?",
        a: "They reach you through the app with a ready message, and you both see the same matching code — handoff only happens when the codes match."
      },
      {
        q: "What about my location privacy?",
        a: "We use your location only during an active pickup trip and around the branch zone — we never track you outside it."
      }
    ]
  },
  join: {
    title1: "Stay in your car.",
    title2: "We handle the rest.",
    sub: "Order from your browser now — the mobile app is on its way to the stores.",
    order: "Order now — web app",
    merchants: "Register your store"
  },
  footer: {
    line: "© 2026 Pickly — the smart pickup-coordination layer · Made in Saudi Arabia",
    terms: "Terms",
    privacy: "Privacy"
  }
};

export const DICT: Record<Lang, Dict> = { ar, en };
