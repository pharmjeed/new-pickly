/**
 * قاعدة بيانات السيارات — ماركات وموديلات السوق السعودي.
 * تُغذي شاشة «أضف سيارة جديدة» (ماركة السيارة ← نوع السيارة).
 * آمنة لإعادة التشغيل (upsert بمفتاح الماركة واسم الموديل).
 */
import type { PrismaClient } from "@prisma/client";

interface CatalogModel {
  name_ar: string;
  name_en: string;
}
interface CatalogMake {
  key: string;
  name_ar: string;
  name_en: string;
  models: CatalogModel[];
}

const m = (name_ar: string, name_en: string): CatalogModel => ({ name_ar, name_en });

export const VEHICLE_CATALOG: CatalogMake[] = [
  {
    key: "toyota",
    name_ar: "تويوتا",
    name_en: "Toyota",
    models: [
      m("كامري", "Camry"),
      m("كورولا", "Corolla"),
      m("يارس", "Yaris"),
      m("أفالون", "Avalon"),
      m("لاند كروزر", "Land Cruiser"),
      m("برادو", "Prado"),
      m("فورتشنر", "Fortuner"),
      m("راف فور", "RAV4"),
      m("هايلكس", "Hilux"),
      m("إينوفا", "Innova"),
      m("رايز", "Raize"),
      m("كورولا كروس", "Corolla Cross")
    ]
  },
  {
    key: "hyundai",
    name_ar: "هيونداي",
    name_en: "Hyundai",
    models: [
      m("سوناتا", "Sonata"),
      m("إلنترا", "Elantra"),
      m("أكسنت", "Accent"),
      m("أزيرا", "Azera"),
      m("توسان", "Tucson"),
      m("سانتافي", "Santa Fe"),
      m("كريتا", "Creta"),
      m("باليسيد", "Palisade"),
      m("فينيو", "Venue"),
      m("ستاريا", "Staria")
    ]
  },
  {
    key: "nissan",
    name_ar: "نيسان",
    name_en: "Nissan",
    models: [
      m("التيما", "Altima"),
      m("صني", "Sunny"),
      m("ماكسيما", "Maxima"),
      m("باترول", "Patrol"),
      m("إكس تريل", "X-Trail"),
      m("كيكس", "Kicks"),
      m("باثفايندر", "Pathfinder"),
      m("نافارا", "Navara")
    ]
  },
  {
    key: "kia",
    name_ar: "كيا",
    name_en: "Kia",
    models: [
      m("K5", "K5"),
      m("سيراتو", "Cerato"),
      m("بيجاس", "Pegas"),
      m("ريو", "Rio"),
      m("سبورتاج", "Sportage"),
      m("سورينتو", "Sorento"),
      m("سيلتوس", "Seltos"),
      m("تيلورايد", "Telluride"),
      m("كارنيفال", "Carnival")
    ]
  },
  {
    key: "ford",
    name_ar: "فورد",
    name_en: "Ford",
    models: [
      m("فوكس", "Focus"),
      m("فيوجن", "Fusion"),
      m("تورس", "Taurus"),
      m("إكسبلورر", "Explorer"),
      m("إكسبيدشن", "Expedition"),
      m("إيدج", "Edge"),
      m("إسكيب", "Escape"),
      m("F-150", "F-150"),
      m("موستنج", "Mustang"),
      m("برونكو", "Bronco"),
      m("تيريتوري", "Territory")
    ]
  },
  {
    key: "chevrolet",
    name_ar: "شفروليه",
    name_en: "Chevrolet",
    models: [
      m("ماليبو", "Malibu"),
      m("إمبالا", "Impala"),
      m("تاهو", "Tahoe"),
      m("سوبربان", "Suburban"),
      m("كابتيفا", "Captiva"),
      m("جروف", "Groove"),
      m("بليزر", "Blazer"),
      m("سلفرادو", "Silverado"),
      m("كمارو", "Camaro")
    ]
  },
  {
    key: "gmc",
    name_ar: "جي إم سي",
    name_en: "GMC",
    models: [m("يوكن", "Yukon"), m("سييرا", "Sierra"), m("تيرين", "Terrain"), m("أكاديا", "Acadia")]
  },
  {
    key: "honda",
    name_ar: "هوندا",
    name_en: "Honda",
    models: [
      m("أكورد", "Accord"),
      m("سيفيك", "Civic"),
      m("سيتي", "City"),
      m("CR-V", "CR-V"),
      m("HR-V", "HR-V"),
      m("بايلوت", "Pilot")
    ]
  },
  {
    key: "mazda",
    name_ar: "مازدا",
    name_en: "Mazda",
    models: [
      m("مازدا 3", "Mazda3"),
      m("مازدا 6", "Mazda6"),
      m("CX-3", "CX-3"),
      m("CX-30", "CX-30"),
      m("CX-5", "CX-5"),
      m("CX-9", "CX-9")
    ]
  },
  {
    key: "mitsubishi",
    name_ar: "ميتسوبيشي",
    name_en: "Mitsubishi",
    models: [
      m("لانسر", "Lancer"),
      m("أتراج", "Attrage"),
      m("باجيرو", "Pajero"),
      m("مونتيرو سبورت", "Montero Sport"),
      m("أوتلاندر", "Outlander"),
      m("إكسباندر", "Xpander"),
      m("L200", "L200")
    ]
  },
  {
    key: "lexus",
    name_ar: "لكزس",
    name_en: "Lexus",
    models: [
      m("ES", "ES"),
      m("LS", "LS"),
      m("IS", "IS"),
      m("RX", "RX"),
      m("NX", "NX"),
      m("LX", "LX"),
      m("GX", "GX"),
      m("UX", "UX")
    ]
  },
  {
    key: "mercedes",
    name_ar: "مرسيدس",
    name_en: "Mercedes",
    models: [
      m("الفئة C", "C-Class"),
      m("الفئة E", "E-Class"),
      m("الفئة S", "S-Class"),
      m("الفئة A", "A-Class"),
      m("GLC", "GLC"),
      m("GLE", "GLE"),
      m("الفئة G", "G-Class")
    ]
  },
  {
    key: "bmw",
    name_ar: "بي إم دبليو",
    name_en: "BMW",
    models: [
      m("الفئة الثالثة", "3 Series"),
      m("الفئة الخامسة", "5 Series"),
      m("الفئة السابعة", "7 Series"),
      m("X3", "X3"),
      m("X5", "X5"),
      m("X6", "X6"),
      m("X7", "X7")
    ]
  },
  {
    key: "audi",
    name_ar: "أودي",
    name_en: "Audi",
    models: [m("A4", "A4"), m("A6", "A6"), m("A8", "A8"), m("Q5", "Q5"), m("Q7", "Q7"), m("Q8", "Q8")]
  },
  {
    key: "geely",
    name_ar: "جيلي",
    name_en: "Geely",
    models: [
      m("إمجراند", "Emgrand"),
      m("كولراي", "Coolray"),
      m("توجيلا", "Tugella"),
      m("ستاري", "Starray"),
      m("مونجارو", "Monjaro"),
      m("أوكافانجو", "Okavango")
    ]
  },
  {
    key: "changan",
    name_ar: "شانجان",
    name_en: "Changan",
    models: [
      m("إيدو بلس", "Eado Plus"),
      m("ألسفن", "Alsvin"),
      m("CS35 بلس", "CS35 Plus"),
      m("CS75 بلس", "CS75 Plus"),
      m("CS85", "CS85"),
      m("CS95", "CS95"),
      m("يوني تي", "UNI-T"),
      m("يوني كي", "UNI-K"),
      m("يوني في", "UNI-V")
    ]
  },
  {
    key: "mg",
    name_ar: "إم جي",
    name_en: "MG",
    models: [
      m("MG5", "MG5"),
      m("MG6", "MG6"),
      m("ZS", "ZS"),
      m("RX5", "RX5"),
      m("HS", "HS"),
      m("GT", "GT"),
      m("T60", "T60")
    ]
  },
  {
    key: "haval",
    name_ar: "هافال",
    name_en: "Haval",
    models: [m("جوليان", "Jolion"), m("H6", "H6"), m("دارجو", "Dargo"), m("H9", "H9")]
  },
  {
    key: "chery",
    name_ar: "تشيري",
    name_en: "Chery",
    models: [
      m("أريزو 6", "Arrizo 6"),
      m("تيجو 4", "Tiggo 4"),
      m("تيجو 7", "Tiggo 7"),
      m("تيجو 8", "Tiggo 8")
    ]
  },
  {
    key: "dodge",
    name_ar: "دودج",
    name_en: "Dodge",
    models: [m("تشارجر", "Charger"), m("تشالنجر", "Challenger"), m("دورانجو", "Durango")]
  },
  {
    key: "jeep",
    name_ar: "جيب",
    name_en: "Jeep",
    models: [m("رانجلر", "Wrangler"), m("جراند شيروكي", "Grand Cherokee"), m("كومباس", "Compass")]
  },
  {
    key: "landrover",
    name_ar: "لاند روفر",
    name_en: "Land Rover",
    models: [
      m("رينج روفر", "Range Rover"),
      m("رينج روفر سبورت", "Range Rover Sport"),
      m("ديفندر", "Defender"),
      m("ديسكفري", "Discovery"),
      m("إيفوك", "Evoque")
    ]
  },
  {
    key: "porsche",
    name_ar: "بورشه",
    name_en: "Porsche",
    models: [m("كايين", "Cayenne"), m("ماكان", "Macan"), m("باناميرا", "Panamera"), m("911", "911")]
  },
  {
    key: "suzuki",
    name_ar: "سوزوكي",
    name_en: "Suzuki",
    models: [
      m("سويفت", "Swift"),
      m("ديزاير", "Dzire"),
      m("فيتارا", "Vitara"),
      m("جيمني", "Jimny"),
      m("سياز", "Ciaz"),
      m("بالينو", "Baleno")
    ]
  },
  {
    key: "isuzu",
    name_ar: "إيسوزو",
    name_en: "Isuzu",
    models: [m("D-Max", "D-Max"), m("MU-X", "MU-X")]
  },
  {
    key: "genesis",
    name_ar: "جينيسيس",
    name_en: "Genesis",
    models: [m("G70", "G70"), m("G80", "G80"), m("G90", "G90"), m("GV70", "GV70"), m("GV80", "GV80")]
  }
];

export async function seedVehicleCatalog(prisma: PrismaClient): Promise<void> {
  let sort = 0;
  for (const make of VEHICLE_CATALOG) {
    sort += 10;
    const row = await prisma.vehicleMake.upsert({
      where: { key: make.key },
      create: { key: make.key, name_ar: make.name_ar, name_en: make.name_en, sort },
      update: { name_ar: make.name_ar, name_en: make.name_en, sort }
    });
    let msort = 0;
    for (const model of make.models) {
      msort += 10;
      await prisma.vehicleModel.upsert({
        where: { make_id_name_ar: { make_id: row.id, name_ar: model.name_ar } },
        create: { make_id: row.id, name_ar: model.name_ar, name_en: model.name_en, sort: msort },
        update: { name_en: model.name_en, sort: msort }
      });
    }
  }
}
