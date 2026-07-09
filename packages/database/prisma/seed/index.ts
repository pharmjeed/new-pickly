/**
 * Seed سعودي واقعي — برومبت البناء (مرحلة التأسيس):
 * 3 مطاعم × فروع × قوائم كاملة + حساب demo لكل دور.
 * آمن لإعادة التشغيل (upsert بالأسماء/الأكواد الثابتة).
 */
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

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
      amount_halalas: 300, // 3 ر.س — رسوم رمزية تُعرض بوضوح قبل الدفع
      percent_bp: null,
      applies_to: "order"
    },
    update: {}
  });

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

  // أعلام الطيار — المؤجل مطفأ (docs/21§3)
  const flags: Array<[string, boolean]> = [
    ["scheduled_orders", false],
    ["coupons_full", false],
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
    ["gps_failed", "ما قدرنا نحدد موقعك", "اضغط «وصلت» ونكمل عادي"]
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
    ["retention.location_events_days", 30]
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

type MenuSpec = Array<{
  category: string;
  products: Array<{
    name: string;
    desc?: string;
    price: number; // ر.س — تُحول هللات
    calories?: number;
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
    ownerPhone: "+966520000001",
    ownerName: "عبدالله الحربي",
    branches: [
      { name: "بيست برجر — العليا", code: "BB-OLAYA", city: "الرياض", address: "شارع العليا العام", lat: 24.6949, lng: 46.6853, spots: ["1", "2", "3", "4", "أمام المدخل"] },
      { name: "بيست برجر — النخيل", code: "BB-NAKHEEL", city: "الرياض", address: "طريق الملك سلمان، النخيل", lat: 24.7565, lng: 46.6288, spots: ["1", "2", "3"] }
    ],
    menu: [
      {
        category: "برجر",
        products: [
          { name: "بيست برجر كلاسيك", desc: "لحم واجيو مشوي على الفحم مع صوصنا الخاص", price: 32, calories: 620, groups: [
            { name: "الحجم", min: 1, max: 1, modifiers: [["عادي", 0], ["دبل", 12]] },
            { name: "إضافات", min: 0, max: 4, modifiers: [["جبن إضافي", 4], ["بصل مكرمل", 3], ["حلبينو", 2], ["بيكون بقري", 6]] }
          ] },
          { name: "برجر الدجاج المقرمش", desc: "صدر دجاج مقرمش مع كول سلو", price: 28, calories: 540, groups: [
            { name: "الحدة", min: 1, max: 1, modifiers: [["عادي", 0], ["حار", 0], ["حار جداً", 0]] }
          ] },
          { name: "برجر الفطر والجبن", desc: "فطر سوتيه وجبن سويسري ذائب", price: 35, calories: 680 },
          { name: "سموكي برجر", desc: "صوص باربكيو مدخن وحلقات بصل مقلية", price: 37, calories: 720 }
        ]
      },
      {
        category: "أطباق جانبية",
        products: [
          { name: "بطاطس بيست", desc: "مقلية طازجة مع ملح البحر", price: 12, calories: 380, groups: [
            { name: "الحجم", min: 1, max: 1, modifiers: [["وسط", 0], ["كبير", 5]] },
            { name: "الصوص", min: 0, max: 2, modifiers: [["جبنة", 4], ["ثوم", 3], ["باربكيو", 3]] }
          ] },
          { name: "حلقات البصل", price: 14, calories: 410 },
          { name: "تشيكن تندر (4 قطع)", price: 22, calories: 460 }
        ]
      },
      {
        category: "مشروبات",
        products: [
          { name: "بيبسي", price: 7, calories: 150, groups: [{ name: "الحجم", min: 1, max: 1, modifiers: [["عادي", 0], ["كبير", 3]] }] },
          { name: "عصير برتقال طازج", price: 14, calories: 120 },
          { name: "ماء", price: 3, calories: 0 },
          { name: "ميلك شيك فانيلا", price: 18, calories: 520 }
        ]
      }
    ]
  });

  // 2) شاورما الديوان — الرياض وجدة
  await seedMerchant({
    name_ar: "مؤسسة الديوان للأغذية",
    brand_ar: "شاورما الديوان",
    cuisine: "شاورما",
    ownerPhone: "+966520000002",
    ownerName: "خالد القحطاني",
    branches: [
      { name: "الديوان — الملز", code: "DW-MALAZ", city: "الرياض", address: "شارع الستين، الملز", lat: 24.6664, lng: 46.7398, spots: ["1", "2", "أمام المدخل"] },
      { name: "الديوان — الحمراء", code: "DW-HAMRA", city: "جدة", address: "طريق الأمير سلطان، الحمراء", lat: 21.5433, lng: 39.1728, spots: ["1", "2", "3", "4"] }
    ],
    menu: [
      {
        category: "شاورما",
        products: [
          { name: "شاورما دجاج عربي", desc: "خبز صاج مع ثومية الديوان", price: 9, calories: 320, groups: [
            { name: "الإضافات", min: 0, max: 3, modifiers: [["بطاطس داخل الساندويتش", 2], ["جبن", 3], ["ثومية إضافية", 1]] }
          ] },
          { name: "شاورما لحم عربي", desc: "لحم بلدي متبل على السيخ", price: 12, calories: 380 },
          { name: "صحن شاورما دجاج", desc: "مع بطاطس وثومية ومخلل", price: 24, calories: 650 },
          { name: "صحن شاورما لحم", price: 29, calories: 700 },
          { name: "شاورما بوكس عائلي", desc: "8 ساندويتشات + بطاطس عائلي + مشروبات", price: 75, calories: 2800 }
        ]
      },
      {
        category: "مقبلات",
        products: [
          { name: "بطاطس", price: 8, calories: 350 },
          { name: "حمص بالطحينة", price: 10, calories: 210 },
          { name: "تبولة", price: 12, calories: 150 }
        ]
      },
      {
        category: "مشروبات",
        products: [
          { name: "عيران", price: 5, calories: 90 },
          { name: "ليمون نعناع", price: 10, calories: 130 },
          { name: "مشروب غازي", price: 6, calories: 150 }
        ]
      }
    ]
  });

  // 3) قهوة سحابة — الرياض والدمام
  await seedMerchant({
    name_ar: "شركة سحابة للمشروبات",
    brand_ar: "قهوة سحابة",
    cuisine: "مقهى",
    ownerPhone: "+966520000003",
    ownerName: "ريم العنزي",
    branches: [
      { name: "سحابة — حطين", code: "SA-HITTEEN", city: "الرياض", address: "بوليفارد حطين", lat: 24.7748, lng: 46.5987, spots: ["1", "2", "3"] },
      { name: "سحابة — الشاطئ", code: "SA-SHATEA", city: "الدمام", address: "كورنيش الشاطئ الغربي", lat: 26.4498, lng: 50.0891, spots: ["1", "2"] }
    ],
    menu: [
      {
        category: "قهوة ساخنة",
        products: [
          { name: "لاتيه", price: 16, calories: 190, groups: [
            { name: "الحجم", min: 1, max: 1, modifiers: [["وسط", 0], ["كبير", 4]] },
            { name: "الحليب", min: 0, max: 1, modifiers: [["شوفان", 4], ["لوز", 4], ["خالي اللاكتوز", 3]] },
            { name: "نكهة", min: 0, max: 2, modifiers: [["فانيلا", 3], ["كراميل", 3], ["بندق", 3]] }
          ] },
          { name: "كابتشينو", price: 15, calories: 160 },
          { name: "فلات وايت", price: 17, calories: 170 },
          { name: "قهوة اليوم", price: 10, calories: 5 },
          { name: "V60", desc: "محاصيل مختصة تُخمّر عند الطلب", price: 22, calories: 5 }
        ]
      },
      {
        category: "قهوة باردة",
        products: [
          { name: "آيس لاتيه", price: 18, calories: 180, groups: [
            { name: "الحليب", min: 0, max: 1, modifiers: [["شوفان", 4], ["لوز", 4]] }
          ] },
          { name: "آيس سبانش لاتيه", price: 21, calories: 260 },
          { name: "كولد برو", price: 20, calories: 10 }
        ]
      },
      {
        category: "حلى وسناك",
        products: [
          { name: "كوكيز شوكولاتة", price: 12, calories: 420 },
          { name: "كرواسون زعتر", price: 14, calories: 380 },
          { name: "سان سبستيان (قطعة)", price: 24, calories: 450 }
        ]
      }
    ]
  });

  await seedCustomersAndAdmin();

  const counts = {
    merchants: await prisma.merchant.count(),
    branches: await prisma.branch.count(),
    products: await prisma.product.count(),
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
