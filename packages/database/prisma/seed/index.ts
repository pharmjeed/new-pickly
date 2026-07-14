/**
 * Seed سعودي واقعي — برومبت البناء (مرحلة التأسيس):
 * 3 مطاعم × فروع × قوائم كاملة + حساب demo لكل دور.
 * آمن لإعادة التشغيل (upsert بالأسماء/الأكواد الثابتة).
 */
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";
import { seedVehicleCatalog } from "./vehicle-catalog.js";

const prisma = new PrismaClient();

// نفس تجزئة طبقة auth (argon2) — التحقق في /v1/auth/branch/login
const devHash = (v: string) => argon2.hash(v);

async function seedRolesAndPermissions() {
  const merchantRoles: Array<[string, string]> = [
    ["merchant:owner", "مالك"],
    ["merchant:general_manager", "مدير عام"],
    ["merchant:operations_manager", "مدير عمليات"],
    ["merchant:branch_manager", "مدير فرع"],
    ["merchant:cashier", "كاشير"],
    ["merchant:kitchen", "مطبخ"],
    ["merchant:handoff", "تسليم"],
    ["merchant:finance", "مالية"],
    ["merchant:analyst", "محلل"]
  ];
  const adminRoles: Array<[string, string]> = [
    ["admin:super_admin", "مشرف عام"],
    ["admin:operations", "عمليات"],
    ["admin:finance", "مالية"],
    ["admin:support", "دعم"],
    ["admin:merchant_success", "نجاح التجار"],
    ["admin:risk", "مخاطر"],
    ["admin:read_only", "قراءة فقط"]
  ];
  for (const [key, name_ar] of merchantRoles) {
    await prisma.role.upsert({
      where: { key },
      create: { key, scope: "merchant", name_ar },
      update: { name_ar }
    });
  }
  for (const [key, name_ar] of adminRoles) {
    await prisma.role.upsert({
      where: { key },
      create: { key, scope: "admin", name_ar },
      update: { name_ar }
    });
  }
}

async function seedSystemDefaults() {
  await prisma.taxRule.upsert({
    where: { key: "vat_standard" },
    create: { key: "vat_standard", name_ar: "ضريبة القيمة المضافة", rate_bp: 1500 },
    update: { rate_bp: 1500 }
  });
  await prisma.fee.upsert({
    where: { key: "pickly_service_fee" },
    create: {
      key: "pickly_service_fee",
      name_ar: "رسم خدمة بيكلي",
      amount_halalas: 300, // قيمة احتياطية — الفعلية من system_settings:pricing.service_fee
      percent_bp: null,
      applies_to: "order"
    },
    update: {}
  });
  // رسم الخدمة القابل للتغيير من السوبر أدمن + حصة التاجر منه (سجل تاريخي)
  const feeSetting = await prisma.systemSetting.findFirst({
    where: { key: "pricing.service_fee" }
  });
  if (!feeSetting) {
    await prisma.systemSetting.create({
      data: {
        key: "pricing.service_fee",
        value: { amount_halalas: 200, merchant_share_halalas: 100 } // 2 ر.س: ريال لبيكلي وريال للتاجر
      }
    });
  }

  const reviewCategories: Array<[string, string, number]> = [
    ["overall", "التقييم العام", 0],
    ["speed", "سرعة التسليم", 1],
    ["accuracy", "دقة الطلب", 2],
    ["staff", "تعامل الموظف", 3],
    ["experience", "تجربة الاستلام", 4]
  ];
  for (const [key, name_ar, sort] of reviewCategories) {
    await prisma.reviewCategory.upsert({
      where: { key },
      create: { key, name_ar, sort },
      update: {}
    });
  }

  // أعلام الخصائص — كل خاصية جديدة قابلة للإيقاف دون نشر (docs/09§76)
  // مُفعّلة بعد بناء مرحلة 2؛ الإطفاء من لوحة الأدمن (A-23)
  const flags: Array<[string, boolean]> = [
    ["scheduled_orders", true], // BR-5 — بُنيت في مرحلة 2
    ["coupons_full", true], // BR-7 — بُنيت في مرحلة 2
    ["wallet_payments", true], // Apple Pay/STC Pay عبر البوابة — sandbox حتى B1
    ["in_app_wallet", true], // محفظة بيكلي — رصيد داخل التطبيق (قرار المالك 2026-07-12)
    ["search", true], // C-11/C-12
    ["support_tickets", true], // C-65/66 + A-15
    ["tips", false],
    ["discovery_map", false],
    ["favorites", false],
    ["auto_accept", false], // S6 — شرط 4 أسابيع >98%
    ["web_checkout_full", false],
    ["pos_integrations", false]
  ];
  for (const [key, enabled] of flags) {
    await prisma.featureFlag.upsert({
      where: { key },
      create: { key, enabled },
      update: {}
    });
  }

  // قوالب الإشعارات — النصوص من بنك النصوص (كتاب الهوية §4)
  const templates: Array<[string, string, string]> = [
    ["order_submitted", "أُرسل طلبك", "طلبك {{display_code}} وصل للمطعم — ننتظر تأكيدهم"],
    ["order_accepted", "قبل المطعم طلبك", "المطعم يجهّز طلبك على وقت وصولك"],
    ["order_rejected", "نعتذر — ما قدر المطعم يستقبل طلبك", "مبلغك يرجع لك كاملاً خلال أيام قليلة"],
    ["order_ready", "طلبك جاهز", "خلّك في سيارتك، الباقي علينا"],
    ["arrival_detected", "تم رصد وصولك", "تم رصد وصولك — أبلغنا المطعم تلقائيًا"],
    ["handoff_started", "{{staff_name}} في طريقه إليك", "{{staff_name}} في طريقه إليك · يحمل طلبك"],
    ["order_completed", "بالعافية!", "قيّم استلامك بضغطة"],
    ["no_show_reminder", "طلبك بانتظارك", "طلبك جاهز من فترة — إذا تأخرت أكثر قد يُلغى وفق السياسة"],
    ["gps_failed", "ما قدرنا نحدد موقعك", "اضغط «وصلت» ونكمل عادي"],
    ["order_scheduled", "تم حجز موعدك", "طلبك {{display_code}} محجوز لفترة {{slot_start}} — آخر تعديل مجاني قبل ساعة"],
    ["scheduled_reminder", "حان وقت التوجه", "اقتربت فترة استلام طلبك {{display_code}} — انطلق الآن"],
    ["scheduled_expired", "انتهت صلاحية الحجز", "ما اكتمل دفع طلبك المجدول {{display_code}} — احجز فترة جديدة متى شئت"],
    ["later_ready", "طلبك جاهز — تحرك وقت ما يناسبك", "طلبك محفوظ لك، واضغط «أنا في الطريق» وقت ما تتحرك"],
    ["refund_completed", "تم استرجاع مبلغك", "أعدنا {{amount}} لوسيلة دفعك — قد يستغرق الظهور أياماً قليلة"],
    ["support_reply", "رد جديد من الدعم", "لديك رد جديد على تذكرتك: {{subject}}"]
  ];
  for (const [key, title_ar, body_ar] of templates) {
    await prisma.notificationTemplate.upsert({
      where: { key },
      create: { key, channel: "push", title_ar, body_ar },
      update: { title_ar, body_ar }
    });
  }

  // إعدادات BR الافتراضية القابلة للضبط (docs/06)
  const settings: Array<[string, unknown]> = [
    ["br1.accept_window_seconds", 180],
    ["br1.reminder_at_percent", 60],
    ["br3.noshow_first_reminder_minutes", 15],
    ["br3.noshow_threshold_minutes", 45],
    ["br4.customer_response_minutes", 5],
    ["br8.dual_confirmation_threshold_halalas", 30000],
    ["pickup.eta_thresholds_minutes", [10, 5, 3]],
    ["retention.location_events_days", 30],
    ["br5.free_change_minutes", 60], // آخر تعديل/إلغاء مجاني قبل الفترة — BR-5
    ["br5.unpaid_expire_minutes", 30], // مجدول لم يُدفع → EXPIRED (docs/05)
    // بانرات CMS (A-13) — تُدار من لوحة الأدمن (رئيسية العميل C-09)
    [
      "cms.banners",
      [
        { title_ar: "خليك في السيارة وطلبك يجيك", body_ar: "اطلب وادفع وقُد — نجهّز طلبك موقوتاً بوصولك", image_url: null, link: "/restaurants" },
        { title_ar: "بلا طوابير وبلا نزول", body_ar: "رمز تحقق واحد ويوصل طلبك لشباك سيارتك", image_url: null, link: null }
      ]
    ],
    // تصنيفات المطاعم C-09 — يديرها السوبر أدمن (إضافة/حذف/ترتيب/تفعيل)
    [
      "cms.categories",
      [
        { name_ar: "برجر", is_active: true },
        { name_ar: "شاورما", is_active: true },
        { name_ar: "مقهى", is_active: true }
      ]
    ],
    // طرق الدفع الظاهرة للعميل — يديرها السوبر أدمن (قرار المالك 2026-07-12)
    [
      "payments.methods",
      [
        { key: "apple_pay", name_ar: "Apple Pay", desc_ar: null, badge_ar: null, is_active: true },
        { key: "card", name_ar: "بطاقة — مدى وفيزا وماستركارد", desc_ar: "احفظ وادفع عبر البطاقة", badge_ar: null, is_active: true },
        { key: "stc_pay", name_ar: "stc pay", desc_ar: "ادفع لطلبك باستخدام رقم الجوال المسجل في STC Pay", badge_ar: null, is_active: true }
      ]
    ]
  ];
  for (const [key, value] of settings) {
    const existing = await prisma.systemSetting.findFirst({ where: { key } });
    if (!existing) {
      await prisma.systemSetting.create({
        data: { key, value: value as never, created_by: "seed" }
      });
    }
  }
}

// صور الأطعمة التجريبية — روابط خارجية من CDN عام (كما بانرات CMS)؛ كل معرّف
// تم التحقق منه بصرياً أنه يطابق الصنف. في الإنتاج يرفعها التاجر من بوابته (M-10).
const foodImg = (id: string, w = 640): string =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=70`;
const logoImg = (id: string): string =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=240&h=240&q=70`;

type MenuSpec = Array<{
  category: string;
  products: Array<{
    name: string;
    desc?: string;
    price: number; // ر.س — تُحول هللات
    calories?: number;
    img?: string;
    groups?: Array<{
      name: string;
      min: number;
      max: number;
      modifiers: Array<[string, number]>;
    }>;
  }>;
}>;

async function seedMerchant(spec: {
  name_ar: string;
  brand_ar: string;
  cuisine: string;
  logo_url: string;
  cover_url: string;
  ownerPhone: string;
  ownerName: string;
  branches: Array<{ name: string; code: string; city: string; address: string; lat: number; lng: number; spots: string[] }>;
  menu: MenuSpec;
}) {
  let merchant = await prisma.merchant.findFirst({ where: { name_ar: spec.name_ar } });
  merchant ??= await prisma.merchant.create({
    data: { name_ar: spec.name_ar, status: "approved", plan_key: "pilot_basic" }
  });

  let brand = await prisma.brand.findFirst({ where: { merchant_id: merchant.id } });
  brand ??= await prisma.brand.create({
    data: {
      merchant_id: merchant.id,
      name_ar: spec.brand_ar,
      cuisine_ar: spec.cuisine
    }
  });
  // تُحدَّث دائماً — إعادة الـseed ترجع صور العرض الموحدة ولو بدّلها أحد أثناء التجربة
  await prisma.brand.update({
    where: { id: brand.id },
    data: { logo_url: spec.logo_url, cover_url: spec.cover_url }
  });

  // المالك — حساب مستخدم + دور
  const owner = await prisma.user.upsert({
    where: { phone: spec.ownerPhone },
    create: {
      phone: spec.ownerPhone,
      full_name: spec.ownerName,
      actor_type: "merchant_staff"
    },
    update: {}
  });
  const ownerRole = await prisma.role.findUniqueOrThrow({ where: { key: "merchant:owner" } });
  const existingOwnerRole = await prisma.userRole.findFirst({
    where: { user_id: owner.id, role_id: ownerRole.id, merchant_id: merchant.id }
  });
  if (!existingOwnerRole) {
    await prisma.userRole.create({
      data: { user_id: owner.id, role_id: ownerRole.id, merchant_id: merchant.id }
    });
  }

  // الفروع
  const branchIds: string[] = [];
  for (const b of spec.branches) {
    const branch = await prisma.branch.upsert({
      where: { branch_code: b.code },
      create: {
        merchant_id: merchant.id,
        brand_id: brand.id,
        name_ar: b.name,
        branch_code: b.code,
        city: b.city,
        address_short: b.address,
        lat: b.lat,
        lng: b.lng,
        status: "open"
      },
      update: {}
    });
    branchIds.push(branch.id);

    // location (PostGIS) — تُحدَّث بSQL خام لأن Prisma لا يدعم geography مباشرة
    await prisma.$executeRaw`
      UPDATE branches
      SET location = ST_SetSRID(ST_MakePoint(${b.lng}, ${b.lat}), 4326)::geography
      WHERE id = ${branch.id}::uuid`;

    await prisma.branchPickupSettings.upsert({
      where: { branch_id: branch.id },
      create: { branch_id: branch.id },
      update: {}
    });

    for (const g of [
      { kind: "alert" as const, radius_m: 300 },
      { kind: "arrival" as const, radius_m: 100 }
    ]) {
      const exists = await prisma.geofence.findFirst({
        where: { branch_id: branch.id, kind: g.kind }
      });
      if (!exists) {
        await prisma.geofence.create({ data: { branch_id: branch.id, ...g } });
      }
    }

    // ساعات العمل: يومياً 08:00–23:30
    for (let day = 0; day < 7; day++) {
      await prisma.branchHour.upsert({
        where: {
          branch_id_day_of_week_opens_at: {
            branch_id: branch.id,
            day_of_week: day,
            opens_at: "08:00"
          }
        },
        create: { branch_id: branch.id, day_of_week: day, opens_at: "08:00", closes_at: "23:30" },
        update: {}
      });
    }

    for (const [i, label] of b.spots.entries()) {
      await prisma.parkingSpot.upsert({
        where: { branch_id_label: { branch_id: branch.id, label } },
        create: { branch_id: branch.id, label, sort: i },
        update: {}
      });
    }

    // طاقم الفرع — demo لكل دور تشغيلي (PIN موحد للتطوير: 1234)
    const staffSpecs: Array<[string, string, string]> = [
      ["branch_manager", `${b.code}-manager`, "مدير الفرع"],
      ["cashier", `${b.code}-cashier`, "الكاشير"],
      ["kitchen", `${b.code}-kitchen`, "المطبخ"],
      ["handoff", `${b.code}-handoff`, "راشد (تسليم)"]
    ];
    for (const [role_key, username, full_name] of staffSpecs) {
      const staff = await prisma.merchantStaff.upsert({
        where: { merchant_id_username: { merchant_id: merchant.id, username } },
        create: {
          merchant_id: merchant.id,
          username,
          pin_hash: await devHash("1234"),
          role_key: `merchant:${role_key}`,
          full_name
        },
        // إعادة ضبط PIN التطوير عند كل seed — يضمن تطابق التجزئة مع طبقة auth
        update: { pin_hash: await devHash("1234") }
      });
      await prisma.staffBranchAssignment.upsert({
        where: { staff_id_branch_id: { staff_id: staff.id, branch_id: branch.id } },
        create: { staff_id: staff.id, branch_id: branch.id },
        update: {}
      });
    }
  }

  // المنيو
  let menu = await prisma.menu.findFirst({ where: { brand_id: brand.id } });
  menu ??= await prisma.menu.create({
    data: { brand_id: brand.id, name_ar: "المنيو الرئيسي" }
  });

  for (const [ci, cat] of spec.menu.entries()) {
    let category = await prisma.category.findFirst({
      where: { menu_id: menu.id, name_ar: cat.category }
    });
    category ??= await prisma.category.create({
      data: { menu_id: menu.id, name_ar: cat.category, sort_order: ci }
    });

    for (const [pi, p] of cat.products.entries()) {
      let product = await prisma.product.findFirst({
        where: { category_id: category.id, name_ar: p.name }
      });
      product ??= await prisma.product.create({
        data: {
          category_id: category.id,
          name_ar: p.name,
          description_ar: p.desc ?? null,
          price_halalas: Math.round(p.price * 100),
          calories: p.calories ?? null,
          sort_order: pi
        }
      });

      // صورة الصنف (تظهر في بطاقة المنتج C-23 وورقة التخصيص C-25 وبوابة التاجر)
      if (p.img) {
        const image = await prisma.productImage.findFirst({
          where: { product_id: product.id },
          orderBy: { sort: "asc" }
        });
        if (!image) {
          await prisma.productImage.create({
            data: { product_id: product.id, file_url: p.img, sort: 0 }
          });
        } else if (image.file_url !== p.img) {
          await prisma.productImage.update({ where: { id: image.id }, data: { file_url: p.img } });
        }
      }

      for (const g of p.groups ?? []) {
        let group = await prisma.modifierGroup.findFirst({
          where: { name_ar: g.name, products: { some: { product_id: product.id } } }
        });
        if (!group) {
          group = await prisma.modifierGroup.create({
            data: { name_ar: g.name, min_select: g.min, max_select: g.max }
          });
          await prisma.productModifierGroup.create({
            data: { product_id: product.id, group_id: group.id }
          });
        }
        for (const [mName, mPrice] of g.modifiers) {
          const exists = await prisma.modifier.findFirst({
            where: { group_id: group.id, name_ar: mName }
          });
          if (!exists) {
            await prisma.modifier.create({
              data: { group_id: group.id, name_ar: mName, price_halalas: Math.round(mPrice * 100) }
            });
          }
        }
      }

      // التوفر في كل الفروع
      for (const branch_id of branchIds) {
        await prisma.branchProductAvailability.upsert({
          where: { branch_id_product_id: { branch_id, product_id: product.id } },
          create: { branch_id, product_id: product.id, is_available: true },
          update: {}
        });
      }
    }
  }

  return merchant;
}

async function seedCustomersAndAdmin() {
  // عملاء demo — من شخصيات pickly-persona
  const sultan = await prisma.user.upsert({
    where: { phone: "+966500000001" },
    create: { phone: "+966500000001", full_name: "سلطان العتيبي" },
    update: {}
  });
  await prisma.customerProfile.upsert({
    where: { user_id: sultan.id },
    create: { user_id: sultan.id, default_city: "الرياض" },
    update: {}
  });
  let camry = await prisma.vehicle.findFirst({
    where: { user_id: sultan.id, plate_short: "8241" }
  });
  camry ??= await prisma.vehicle.create({
    data: {
      user_id: sultan.id,
      make_ar: "تويوتا",
      model_ar: "كامري",
      color_ar: "بيضاء",
      plate_short: "8241"
    }
  });
  await prisma.customerDefaultVehicle.upsert({
    where: { user_id: sultan.id },
    create: { user_id: sultan.id, vehicle_id: camry.id },
    update: { vehicle_id: camry.id }
  });

  const noura = await prisma.user.upsert({
    where: { phone: "+966500000002" },
    create: { phone: "+966500000002", full_name: "نورة الشهري" },
    update: {}
  });
  await prisma.customerProfile.upsert({
    where: { user_id: noura.id },
    create: { user_id: noura.id, default_city: "جدة" },
    update: {}
  });
  const yukon = await prisma.vehicle.findFirst({
    where: { user_id: noura.id, plate_short: "3319" }
  });
  if (!yukon) {
    const v = await prisma.vehicle.create({
      data: { user_id: noura.id, make_ar: "جي إم سي", model_ar: "يوكن", color_ar: "أسود", plate_short: "3319" }
    });
    await prisma.customerDefaultVehicle.upsert({
      where: { user_id: noura.id },
      create: { user_id: noura.id, vehicle_id: v.id },
      update: { vehicle_id: v.id }
    });
  }

  // حسابات أدمن demo لكل دور Pickly
  const adminSpecs: Array<[string, string, string]> = [
    ["+966510000001", "مشرف بيكلي", "admin:super_admin"],
    ["+966510000002", "عمليات بيكلي", "admin:operations"],
    ["+966510000003", "مالية بيكلي", "admin:finance"],
    ["+966510000004", "دعم بيكلي", "admin:support"],
    ["+966510000005", "نجاح التجار", "admin:merchant_success"],
    ["+966510000006", "مخاطر بيكلي", "admin:risk"],
    ["+966510000007", "قراءة فقط", "admin:read_only"]
  ];
  for (const [phone, full_name, roleKey] of adminSpecs) {
    const u = await prisma.user.upsert({
      where: { phone },
      create: { phone, full_name, actor_type: "admin", mfa_enabled: true },
      update: {}
    });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    const existing = await prisma.userRole.findFirst({
      where: { user_id: u.id, role_id: role.id }
    });
    if (!existing) {
      await prisma.userRole.create({ data: { user_id: u.id, role_id: role.id } });
    }
  }
}

async function main() {
  await seedRolesAndPermissions();
  await seedSystemDefaults();

  // 1) بيست برجر — الرياض (فرعان)
  await seedMerchant({
    name_ar: "شركة بيست برجر للتجارة",
    brand_ar: "بيست برجر",
    cuisine: "برجر",
    logo_url: logoImg("1568901346375-23c9450c58cd"),
    cover_url: foodImg("1571091718767-18b5b1457add", 900),
    ownerPhone: "+966520000001",
    ownerName: "عبدالله الحربي",
    branches: [
      { name: "بيست برجر — العليا", code: "BB-OLAYA", city: "الرياض", address: "شارع العليا العام", lat: 24.6949, lng: 46.6853, spots: ["1", "2", "3", "4", "أمام المدخل"] },
      { name: "بيست برجر — النخيل", code: "BB-NAKHEEL", city: "الرياض", address: "طريق الملك سلمان، النخيل", lat: 24.7565, lng: 46.6288, spots: ["1", "2", "3"] },
      { name: "بيست برجر — قباء", code: "BB-MED-QUBA", city: "المدينة المنورة", address: "طريق قباء", lat: 24.4410, lng: 39.6180, spots: ["1", "2", "3", "أمام المدخل"] }
    ],
    menu: [
      {
        category: "برجر",
        products: [
          { name: "بيست برجر كلاسيك", desc: "لحم واجيو مشوي على الفحم مع صوصنا الخاص", price: 32, calories: 620, img: foodImg("1568901346375-23c9450c58cd"), groups: [
            { name: "الحجم", min: 1, max: 1, modifiers: [["عادي", 0], ["دبل", 12]] },
            { name: "إضافات", min: 0, max: 4, modifiers: [["جبن إضافي", 4], ["بصل مكرمل", 3], ["حلبينو", 2], ["بيكون بقري", 6]] }
          ] },
          { name: "برجر الدجاج المقرمش", desc: "صدر دجاج مقرمش مع كول سلو", price: 28, calories: 540, img: foodImg("1615297928064-24977384d0da"), groups: [
            { name: "الحدة", min: 1, max: 1, modifiers: [["عادي", 0], ["حار", 0], ["حار جداً", 0]] }
          ] },
          { name: "برجر الفطر والجبن", desc: "فطر سوتيه وجبن سويسري ذائب", price: 35, calories: 680, img: foodImg("1550547660-d9450f859349") },
          { name: "سموكي برجر", desc: "صوص باربكيو مدخن وحلقات بصل مقلية", price: 37, calories: 720, img: foodImg("1553979459-d2229ba7433b") }
        ]
      },
      {
        category: "أطباق جانبية",
        products: [
          { name: "بطاطس بيست", desc: "مقلية طازجة مع ملح البحر", price: 12, calories: 380, img: foodImg("1573080496219-bb080dd4f877"), groups: [
            { name: "الحجم", min: 1, max: 1, modifiers: [["وسط", 0], ["كبير", 5]] },
            { name: "الصوص", min: 0, max: 2, modifiers: [["جبنة", 4], ["ثوم", 3], ["باربكيو", 3]] }
          ] },
          { name: "حلقات البصل", price: 14, calories: 410, img: foodImg("1639024471283-03518883512d") },
          { name: "تشيكن تندر (4 قطع)", price: 22, calories: 460, img: foodImg("1562967914-608f82629710") }
        ]
      },
      {
        category: "مشروبات",
        products: [
          { name: "بيبسي", price: 7, calories: 150, img: foodImg("1581636625402-29b2a704ef13"), groups: [{ name: "الحجم", min: 1, max: 1, modifiers: [["عادي", 0], ["كبير", 3]] }] },
          { name: "عصير برتقال طازج", price: 14, calories: 120, img: foodImg("1600271886742-f049cd451bba") },
          { name: "ماء", price: 3, calories: 0, img: foodImg("1548839140-29a749e1cf4d") },
          { name: "ميلك شيك فانيلا", price: 18, calories: 520, img: foodImg("1579954115545-a95591f28bfc") }
        ]
      }
    ]
  });

  // 2) شاورما الديوان — الرياض وجدة
  await seedMerchant({
    name_ar: "مؤسسة الديوان للأغذية",
    brand_ar: "شاورما الديوان",
    cuisine: "شاورما",
    logo_url: logoImg("1633321702518-7feccafb94d5"),
    cover_url: foodImg("1662116765994-1e4200c43589", 900),
    ownerPhone: "+966520000002",
    ownerName: "خالد القحطاني",
    branches: [
      { name: "الديوان — الملز", code: "DW-MALAZ", city: "الرياض", address: "شارع الستين، الملز", lat: 24.6664, lng: 46.7398, spots: ["1", "2", "أمام المدخل"] },
      { name: "الديوان — الحمراء", code: "DW-HAMRA", city: "جدة", address: "طريق الأمير سلطان، الحمراء", lat: 21.5433, lng: 39.1728, spots: ["1", "2", "3", "4"] },
      { name: "الديوان — العزيزية", code: "DW-MED-AZIZIYAH", city: "المدينة المنورة", address: "شارع العزيزية", lat: 24.4555, lng: 39.6320, spots: ["1", "2", "3", "أمام المدخل"] }
    ],
    menu: [
      {
        category: "شاورما",
        products: [
          { name: "شاورما دجاج عربي", desc: "خبز صاج مع ثومية الديوان", price: 9, calories: 320, img: foodImg("1529006557810-274b9b2fc783"), groups: [
            { name: "الإضافات", min: 0, max: 3, modifiers: [["بطاطس داخل الساندويتش", 2], ["جبن", 3], ["ثومية إضافية", 1]] }
          ] },
          { name: "شاورما لحم عربي", desc: "لحم بلدي متبل على السيخ", price: 12, calories: 380, img: foodImg("1633321702518-7feccafb94d5") },
          { name: "صحن شاورما دجاج", desc: "مع بطاطس وثومية ومخلل", price: 24, calories: 650, img: foodImg("1561651823-34feb02250e4") },
          { name: "صحن شاورما لحم", price: 29, calories: 700, img: foodImg("1603360946369-dc9bb6258143") },
          { name: "شاورما بوكس عائلي", desc: "8 ساندويتشات + بطاطس عائلي + مشروبات", price: 75, calories: 2800, img: foodImg("1544025162-d76694265947") }
        ]
      },
      {
        category: "مقبلات",
        products: [
          { name: "بطاطس", price: 8, calories: 350, img: foodImg("1541592106381-b31e9677c0e5") },
          { name: "حمص بالطحينة", price: 10, calories: 210, img: foodImg("1637949385162-e416fb15b2ce") },
          { name: "تبولة", price: 12, calories: 150, img: foodImg("1512621776951-a57141f2eefd") }
        ]
      },
      {
        category: "مشروبات",
        products: [
          { name: "عيران", price: 5, calories: 90, img: foodImg("1550583724-b2692b85b150") },
          { name: "ليمون نعناع", price: 10, calories: 130, img: foodImg("1575596510825-f748919a2bf7") },
          { name: "مشروب غازي", price: 6, calories: 150, img: foodImg("1554866585-cd94860890b7") }
        ]
      }
    ]
  });

  // 3) قهوة سحابة — الرياض والدمام
  await seedMerchant({
    name_ar: "شركة سحابة للمشروبات",
    brand_ar: "قهوة سحابة",
    cuisine: "مقهى",
    logo_url: logoImg("1572442388796-11668a67e53d"),
    cover_url: foodImg("1495474472287-4d71bcdd2085", 900),
    ownerPhone: "+966520000003",
    ownerName: "ريم العنزي",
    branches: [
      { name: "سحابة — حطين", code: "SA-HITTEEN", city: "الرياض", address: "بوليفارد حطين", lat: 24.7748, lng: 46.5987, spots: ["1", "2", "3"] },
      { name: "سحابة — الشاطئ", code: "SA-SHATEA", city: "الدمام", address: "كورنيش الشاطئ الغربي", lat: 26.4498, lng: 50.0891, spots: ["1", "2"] },
      { name: "سحابة — سلطانة", code: "SA-MED-SULTANAH", city: "المدينة المنورة", address: "شارع سلطانة", lat: 24.4760, lng: 39.5900, spots: ["1", "2", "أمام المدخل"] }
    ],
    menu: [
      {
        category: "قهوة ساخنة",
        products: [
          { name: "لاتيه", price: 16, calories: 190, img: foodImg("1541167760496-1628856ab772"), groups: [
            { name: "الحجم", min: 1, max: 1, modifiers: [["وسط", 0], ["كبير", 4]] },
            { name: "الحليب", min: 0, max: 1, modifiers: [["شوفان", 4], ["لوز", 4], ["خالي اللاكتوز", 3]] },
            { name: "نكهة", min: 0, max: 2, modifiers: [["فانيلا", 3], ["كراميل", 3], ["بندق", 3]] }
          ] },
          { name: "كابتشينو", price: 15, calories: 160, img: foodImg("1572442388796-11668a67e53d") },
          { name: "فلات وايت", price: 17, calories: 170, img: foodImg("1510591509098-f4fdc6d0ff04") },
          { name: "قهوة اليوم", price: 10, calories: 5, img: foodImg("1522992319-0365e5f11656") },
          { name: "V60", desc: "محاصيل مختصة تُخمّر عند الطلب", price: 22, calories: 5, img: foodImg("1497935586351-b67a49e012bf") }
        ]
      },
      {
        category: "قهوة باردة",
        products: [
          { name: "آيس لاتيه", price: 18, calories: 180, img: foodImg("1517959105821-eaf2591984ca"), groups: [
            { name: "الحليب", min: 0, max: 1, modifiers: [["شوفان", 4], ["لوز", 4]] }
          ] },
          { name: "آيس سبانش لاتيه", price: 21, calories: 260, img: foodImg("1461023058943-07fcbe16d735") },
          { name: "كولد برو", price: 20, calories: 10, img: foodImg("1521302080334-4bebac2763a6") }
        ]
      },
      {
        category: "حلى وسناك",
        products: [
          { name: "كوكيز شوكولاتة", price: 12, calories: 420, img: foodImg("1499636136210-6f4ee915583e") },
          { name: "كرواسون زعتر", price: 14, calories: 380, img: foodImg("1555507036-ab1f4038808a") },
          { name: "سان سبستيان (قطعة)", price: 24, calories: 450, img: foodImg("1533134242443-d4fd215305ad") }
        ]
      }
    ]
  });

  await seedCustomersAndAdmin();
  await seedVehicleCatalog(prisma);

  const counts = {
    merchants: await prisma.merchant.count(),
    branches: await prisma.branch.count(),
    products: await prisma.product.count(),
    vehicle_makes: await prisma.vehicleMake.count(),
    users: await prisma.user.count()
  };
  console.warn(`Seed تم: ${JSON.stringify(counts)}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
