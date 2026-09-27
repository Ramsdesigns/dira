/* generated from shared/ by build/build.mjs — edit the source in shared/ */
/* model.js — מודל הנתונים: קטלוג סוגי הקריטריונים, ברירות מחדל, ופרופיל הדוגמה.
   שום דבר כאן לא ספציפי למשתמש אחד: פרופיל הדוגמה הוא רק נקודת התחלה שעורכים בממשק. */

export const IMPORTANCE = {
  off:    { label: "כבוי",        weight: 0 },
  low:    { label: "נחמד שיהיה",  weight: 1 },
  medium: { label: "חשוב",        weight: 2 },
  high:   { label: "חשוב מאוד",   weight: 3 },
  must:   { label: "חובה",        weight: 3 },
};

export const FEATURES = {
  elevator:   "מעלית",
  parking:    "חניה",
  mamad:      "ממ\"ד",
  balcony:    "מרפסת",
  renovated:  "משופצת / חדשה",
  storage:    "מחסן",
  garden:     "גינה",
  accessible: "נגישות",
};

export const STATUSES = {
  new:        "חדש",
  interesting:"מעניין",
  contacted:  "יצרתי קשר",
  visit:      "נקבע ביקור",
  offer:      "במו\"מ",
  rejected:   "נפסל",
};

export const SOURCE_TYPES = {
  yad2:      { label: "יד 2",            short: "יד2" },
  madlan:    { label: "מדלן",            short: "מדלן" },
  fb_group:  { label: "קבוצת פייסבוק",   short: "FB" },
  fb_market: { label: "מרקטפלייס",       short: "MP" },
};

/** קטלוג סוגי הקריטריונים — הממשק בונה את העורך מתוך הרשימה הזו. */
export const CRITERION_KINDS = {
  price:    { label: "מחיר",                   hint: "טווח מחיר. מעט מעל התקרה (לפי סבילות) מקבל ניקוד חלקי." },
  rooms:    { label: "מספר חדרים",             hint: "חצי חדר פחות או יותר מקבל ניקוד חלקי." },
  sqm:      { label: "שטח (מ\"ר)",             hint: "עד 10% מתחת למינימום מקבל ניקוד חלקי." },
  ppsqm:    { label: "מחיר למ\"ר",             hint: "תקרת מחיר למטר." },
  location: { label: "אזורים",                 hint: "לכל אזור ציון העדפה. דירה מחוץ לכל האזורים מקבלת 0." },
  propertyType: { label: "סוג נכס",            hint: "לכל סוג ציון העדפה (דירת גן, דו-משפחתי וכו')." },
  floor:    { label: "קומה",                   hint: "טווח קומות, בלי קרקע / בלי אחרונה." },
  feature:  { label: "מאפיין",                 hint: "מעלית, חניה, ממ\"ד ועוד." },
  broker:   { label: "ללא תיווך",              hint: "מודעות מבעלים בלבד." },
  keywords: { label: "מילות מפתח",             hint: "מילים שרוצים לראות / שפוסלות." },
  ai:       { label: "שאלה חופשית ל-AI",       hint: "Claude קורא את המודעה ונותן ציון 0–100 לשאלה שתכתוב." },
};

let seq = 0;
export const uid = (p = "c") => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function newCriterion(kind) {
  const base = { id: uid(), kind, imp: "medium" };
  switch (kind) {
    case "price":    return { ...base, imp: "must", min: null, max: null, tolerancePct: 5 };
    case "rooms":    return { ...base, min: null, max: null };
    case "sqm":      return { ...base, min: null, max: null };
    case "ppsqm":    return { ...base, max: null };
    case "location": return { ...base, imp: "must", areas: [], exclude: [] };
    case "propertyType": return { ...base, types: [] };
    case "floor":    return { ...base, min: null, max: null, notGround: false, notTop: false };
    case "feature":  return { ...base, feature: "elevator" };
    case "broker":   return { ...base, imp: "low" };
    case "keywords": return { ...base, label: "", want: [], avoid: [] };
    case "ai":       return { ...base, label: "", question: "" };
    default: throw new Error("unknown criterion kind " + kind);
  }
}

/** תבניות פרופיל — נקודת פתיחה שבוחרים במסך הפרופיל ואז עורכים חופשי. */
export const PROFILE_TEMPLATES = {
  twoGen: { label: "בית לשני דורות (נשר)", make: () => exampleProfile() },
  family: { label: "דירה למשפחה", make: () => familyProfile() },
  rent:   { label: "שכירות", make: () => rentProfile() },
  blank:  { label: "ריק", make: () => ({ id: uid("p"), name: "פרופיל חדש", dealType: "sale", active: true, notifyThreshold: 70, criteria: [newCriterion("price"), newCriterion("location")] }) },
};

function familyProfile() {
  const c = newCriterion;
  return {
    id: uid("p"), name: "דירה למשפחה", dealType: "sale", active: true, notifyThreshold: 75,
    criteria: [
      { ...c("price"), imp: "must", min: 300000, max: null },
      { ...c("location"), imp: "must", areas: [{ name: "", city: "", aliases: [], score: 100 }] },
      { ...c("rooms"), imp: "high", min: 4, max: null },
      { ...c("feature"), imp: "high", feature: "elevator" },
      { ...c("feature"), imp: "medium", feature: "parking" },
      { ...c("feature"), imp: "medium", feature: "mamad" },
      { ...c("feature"), imp: "low", feature: "balcony" },
      { ...c("broker"), imp: "low" },
    ],
  };
}

function rentProfile() {
  const c = newCriterion;
  return {
    id: uid("p"), name: "שכירות", dealType: "rent", active: false, notifyThreshold: 75,
    criteria: [
      { ...c("price"), imp: "must", min: 1500, max: null, tolerancePct: 5 },
      { ...c("location"), imp: "must", areas: [{ name: "", city: "", aliases: [], score: 100 }] },
      { ...c("rooms"), imp: "high", min: 3, max: null },
      { ...c("feature"), imp: "medium", feature: "parking" },
      { ...c("broker"), imp: "medium" },
      { ...c("keywords"), imp: "low", label: "בעלי חיים", want: ["בעלי חיים", "חיות מחמד"], avoid: [] },
    ],
  };
}

/** פרופיל דוגמה: בית לשני דורות בנשר. נערך לגמרי בממשק. */
export function exampleProfile() {
  const c = newCriterion;
  return {
    id: uid("p"),
    name: "נשר — בית לשני דורות",
    dealType: "sale",
    active: true,
    notifyThreshold: 70,
    criteria: [
      // תקציב 3 מיליון עם מקום למו"מ: עד 10% מעל עדיין נכנס, בציון יורד
      { ...c("price"), imp: "must", min: 600000, max: 3000000, tolerancePct: 10 },
      { ...c("location"), imp: "must", areas: [
        { name: "רמות יצחק", city: "נשר", aliases: ["רמות יצחק"], score: 100 },
        { name: "גבעת נשר",  city: "נשר", aliases: ["גבעת נשר", "הגבעה"], score: 75 },
        { name: "שאר נשר",   city: "נשר", aliases: [], score: 35 },
      ], exclude: [] },
      // 5+ כדי לא לפספס דירת גן של 4.5 עם גינה לבניית יחידה — ה-AI כבר מעריך את הפיצול עצמו
      { ...c("rooms"), imp: "medium", min: 5, max: null },
      { ...c("propertyType"), imp: "medium", types: [
        { name: "דו משפחתי", aliases: ["דו משפחתי", "דו-משפחתי", "דו־משפחתי"], score: 100 },
        { name: "בית פרטי / קוטג'", aliases: ["בית פרטי", "קוטג", "וילה"], score: 100 },
        { name: "דירת גן",   aliases: ["דירת גן"], score: 90 },
        { name: "דופלקס / טריפלקס", aliases: ["דופלקס", "טריפלקס", "מפלס"], score: 80 },
        { name: "דירה",      aliases: ["דירה"], score: 40 },
      ] },
      { ...c("ai"), imp: "high", label: "שתי יחידות נפרדות",
        question: "האם יש בנכס (או אפשר ליצור בקלות יחסית) שתי יחידות מגורים נפרדות, כל אחת עם סלון ומטבח משלה, כשהיחידה הקטנה בגודל של כ-3 חדרים? למשל: יחידת דיור קיימת, דירה מחולקת, מפלסים שאפשר לסגור עם כניסה נפרדת, דירת גן עם שטח גינה גדול לבניית יחידה, דו-משפחתי, בית עם מרתף/קומת קרקע נפרדת. 100 = כבר יש שתי יחידות נפרדות, 60 = אפשרות ממשית עם עבודה סבירה, 0 = אין." },
      { ...c("ai"), imp: "high", label: "נגישות להורה מבוגר",
        question: "עד כמה נגיש הנכס (או לפחות אחת היחידות בו) לאדם מבוגר לאורך שנים: מעט מדרגות מהרחוב/החניה עד הדלת, דירת גן או קומת כניסה, מעלית, אפשרות ליצור מסלול בלי מדרגות, וכל החדרים הדרושים במפלס אחד. 100 = כניסה מפולסת בלי מדרגות, 0 = הרבה מדרגות בלי חלופה. אם המודעה לא מציינת — הערך לפי קומה, מעלית וסוג הנכס." },
      { ...c("keywords"), imp: "medium", label: "סימנים לשתי יחידות",
        want: ["יחידת דיור", "יחידה נפרדת", "כניסה נפרדת", "מחולקת", "2 יחידות", "שתי יחידות", "מפלס", "גינה גדולה", "זכויות בנייה", "היתר"],
        avoid: [] },
      { ...c("feature"), imp: "medium", feature: "parking" },
      { ...c("feature"), imp: "low", feature: "mamad" },
    ],
  };
}

export function defaultSources() {
  return [
    { id: uid("s"), type: "yad2", name: "יד 2 — נשר, למכירה", enabled: true, dealType: "sale",
      url: "https://www.yad2.co.il/realestate/forsale?city=2500" },
    { id: uid("s"), type: "madlan", name: "מדלן — נשר, למכירה", enabled: true, dealType: "sale",
      url: "https://www.madlan.co.il/for-sale/%D7%A0%D7%A9%D7%A8-%D7%99%D7%A9%D7%A8%D7%90%D7%9C" },
  ];
}

export const DEFAULT_MESSAGE =
  "היי, ראיתי את המודעה על הנכס {מיקום} ({חדרים} חד׳, {מחיר}). הנכס עדיין רלוונטי? אשמח לשמוע עוד ולתאם ביקור. תודה!";

export function defaultSettings() {
  return {
    version: 1,
    profiles: [exampleProfile()],
    sources: defaultSources(),
    scan: {
      paused: false,
      intervalMin: 30,        // יד 2 / מדלן
      fbIntervalMin: 90,      // פייסבוק — שמרני בכוונה
      quietEnabled: true,
      quietFrom: "00:30",
      quietTo: "07:00",
      pagesPerSource: 1,
      fbScrolls: 6,
      enrichMax: 15,          // כמה מודעות חדשות להעשיר (תיאור מלא) בכל סבב
      keepDays: 60,
    },
    ai: {
      enabled: true,
      provider: "subscription",   // "subscription" = Claude Code במחשב (המנוי הקיים) | "api" = מפתח בתשלום
      apiKey: "",
      model: "claude-haiku-4-5",
      dailyCap: 60,           // מקסימום קריאות ביום (חוסך במגבלת המנוי)
    },
    notify: {
      desktop: true,
      telegram: { enabled: false, token: "", chatId: "" },
      email: { enabled: false, url: "", to: "", secret: "", mode: "digest" },
      priceDrop: true,
      minDropPct: 2,
      pairs: true,
    },
    finance: { equity: 0, rate: 4.9, years: 30 },
    messageTemplate: DEFAULT_MESSAGE,
  };
}

/** מיזוג הגדרות שמורות עם ברירות מחדל (כדי ששדות חדשים בגרסאות הבאות יופיעו). */
export function mergeSettings(saved) {
  const d = defaultSettings();
  if (!saved) return d;
  return {
    ...d, ...saved,
    scan: { ...d.scan, ...saved.scan },
    ai: { ...d.ai, ...saved.ai },
    notify: {
      ...d.notify, ...saved.notify,
      telegram: { ...d.notify.telegram, ...saved.notify?.telegram },
      email: { ...d.notify.email, ...saved.notify?.email },
    },
    finance: { ...d.finance, ...saved.finance },
    profiles: saved.profiles ?? d.profiles,
    sources: saved.sources ?? d.sources,
  };
}

/** זיהוי סוג מקור לפי כתובת. */
export function detectSourceType(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const h = u.hostname.replace(/^www\.|^m\.|^web\./, "");
  if (h.endsWith("yad2.co.il") && u.pathname.startsWith("/realestate/")) return "yad2";
  if (h.endsWith("madlan.co.il")) return "madlan";
  if (h === "facebook.com" && u.pathname.startsWith("/groups/")) return "fb_group";
  if (h === "facebook.com" && u.pathname.startsWith("/marketplace")) return "fb_market";
  return null;
}

export function dealTypeFromUrl(url) {
  if (/\/forsale|for-sale|propertyforsale/.test(url)) return "sale";
  if (/\/rent\b|for-rent|propertyrentals/.test(url)) return "rent";
  return null;
}

/** מודלים של Claude לבחירה בהגדרות (מחיר לכל מיליון טוקנים, דולר). */
export const AI_MODELS = {
  "claude-haiku-4-5": { label: "Haiku 4.5 — זול ומהיר (מומלץ)", in: 1, out: 5 },
  "claude-sonnet-5":  { label: "Sonnet 5 — מדויק יותר", in: 2, out: 10 },
  "claude-opus-5":    { label: "Opus 5 — הכי מדויק, יקר", in: 5, out: 25 },
};
