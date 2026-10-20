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
  // בעיקר לשכירות
  furnished:  "מרוהטת",
  pets:       "מותר בעלי חיים",
  aircon:     "מזגנים",
  roommates:  "מתאימה לשותפים",
};

/** מאפיינים שמוצגים רק בפרופיל / מודעה של שכירות (בקנייה הם רק רעש). */
export const RENT_FEATURES = ["furnished", "pets", "aircon", "roommates"];

export const STATUSES = {
  new:        "חדש",
  interesting:"מעניין",
  contacted:  "יצרתי קשר",
  visit:      "נקבע ביקור",
  offer:      "במו\"מ",
  rejected:   "נפסל",
};

/** למה דירה סומנה "לא רלוונטית" — נאסף כדי ללמוד ולהציע כיוונון לפרופיל. */
export const REJECT_REASONS = {
  talked:    "דיברתי איתם — לא מתאים לנו",
  sold:      "נמכרה / בתהליך מול קונה אחר",
  price:     "יקרה מדי",
  area:      "המיקום / הרחוב לא מתאים",
  stairs:    "יותר מדי מדרגות / לא נגישה",
  no_unit:   "אין אפשרות ליחידה נפרדת",
  size:      "קטנה מדי / חלוקה לא טובה",
  condition: "מצב הנכס / דורשת שיפוץ כבד",
  visited:   "ראיתי — לא אהבתי",
  other:     "אחר",
};

export const SOURCE_TYPES = {
  yad2:      { label: "יד 2",            short: "יד2" },
  madlan:    { label: "מדלן",            short: "מדלן" },
  fb_group:  { label: "קבוצת פייסבוק",   short: "FB" },
  fb_market: { label: "מרקטפלייס",       short: "MP" },
  fb_search: { label: "חיפוש בפייסבוק",  short: "חיפוש FB" },
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
  entryDate:{ label: "תאריך כניסה",            hint: "מתי צריך להיכנס. כניסה מיידית או בתוך הטווח = ציון מלא; עד שבועיים אחרי = חלקי." },
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
    case "entryDate":return { ...base, from: null, by: null };
    case "feature":  return { ...base, feature: "elevator" };
    case "broker":   return { ...base, imp: "low" };
    case "keywords": return { ...base, label: "", want: [], avoid: [] };
    case "ai":       return { ...base, label: "", question: "" };
    default: throw new Error("unknown criterion kind " + kind);
  }
}

/** תבניות פרופיל — נקודת פתיחה שבוחרים במסך הפרופיל ואז עורכים חופשי. */
export const PROFILE_TEMPLATES = {
  // מוסתר מהרשימות: רוב המשתמשים לא צריכים אותו (רם, 20.10.2026). אפשר להחזיר כאפשרות בהגדרות בהמשך
  twoGen: { label: "בית לשני דורות (נשר)", make: () => exampleProfile(), hidden: true },
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

/** שכירות: מחיר חודשי, תאריך כניסה, ומה שחשוב לשוכרים (ריהוט, בעלי חיים, שותפים, תיווך). */
export function rentProfile() {
  const c = newCriterion;
  return {
    id: uid("p"), name: "שכירות", dealType: "rent", active: true, notifyThreshold: 70,
    criteria: [
      // מחיר חודשי: מתחת ל-1,500 זה כמעט תמיד חדר בדירת שותפים / טעות קריאה
      { ...c("price"), imp: "must", min: 1500, max: 6000, tolerancePct: 5 },
      { ...c("location"), imp: "must", areas: [{ name: "", city: "", aliases: [], score: 100 }], exclude: [] },
      { ...c("rooms"), imp: "high", min: 3, max: null },
      { ...c("entryDate"), imp: "medium", from: null, by: null },
      { ...c("broker"), imp: "medium" },
      { ...c("feature"), imp: "medium", feature: "parking" },
      { ...c("feature"), imp: "medium", feature: "aircon" },
      { ...c("feature"), imp: "low", feature: "elevator" },
      { ...c("feature"), imp: "low", feature: "balcony" },
      { ...c("feature"), imp: "low", feature: "furnished" },
      { ...c("feature"), imp: "off", feature: "pets" },
      { ...c("keywords"), imp: "medium", label: "בלי חדר בשותפות", want: [], avoid: ["חדר בדירת שותפים", "חדר להשכרה", "מחפש שותף", "מחפשת שותפה", "סאבלט"] },
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

/** קוד עיר ביד 2 = סמל היישוב של הלמ"ס (נשר 2500 נבדק מול האתר). עיר שלא ברשימה: מדלן + חיפוש בפייסבוק,
    ויד 2 מוסיפים ידנית דרך התוסף. קוד שגוי לא מזיק: קריטריון העיר (חובה) מסנן מודעות מעיר אחרת. */
export const YAD2_CITIES = {
  "חיפה": 4000, "נשר": 2500, "טירת כרמל": 2100, "קרית אתא": 6800, "קרית ביאליק": 9500, "קרית מוצקין": 8200,
  "קרית ים": 9600, "קרית טבעון": 2300, "יקנעם עילית": 240, "עכו": 7600, "נהריה": 9100, "כרמיאל": 1139,
  "עפולה": 7700, "חדרה": 6500, "זכרון יעקב": 9300, "טבריה": 6700, "צפת": 8000, "נוף הגליל": 1061,
  "תל אביב יפו": 5000, "ירושלים": 3000, "באר שבע": 9000, "רמת גן": 8600, "גבעתיים": 6300, "חולון": 6600,
  "בת ים": 6200, "פתח תקווה": 7900, "ראשון לציון": 8300, "רחובות": 8400, "נס ציונה": 7200, "הרצליה": 6400,
  "רעננה": 8700, "כפר סבא": 6900, "הוד השרון": 9700, "נתניה": 7400, "מודיעין מכבים רעות": 1200,
  "אשדוד": 70, "אשקלון": 7100, "רמלה": 8500, "לוד": 7000, "אילת": 2600, "בית שמש": 2610,
};
const cityName = s => String(s ?? "").trim().replace(/\s+/g, " ").replace(/^קריית/, "קרית").replace(/^תל אביב$/, "תל אביב יפו").replace(/^מודיעין$/, "מודיעין מכבים רעות");

/**
 * שאלון השכירות → פרופיל + מקורות.
 * @param a {city, neighborhoods:[], maxPrice, minRooms, entry:"now"|"flex"|ISO, pets:boolean, noBroker:boolean,
 *           roommates:boolean, want:{parking, elevator, furnished, balcony, mamad, aircon: "any"|"prefer"|"must"}}
 */
export function rentFromAnswers(a) {
  const city = cityName(a.city);
  const p = rentProfile();
  p.name = `שכירות — ${city}`;
  const crit = kind => p.criteria.find(c => c.kind === kind);
  Object.assign(crit("price"), { max: Number(a.maxPrice) || null });
  const nbs = (a.neighborhoods ?? []).map(s => s.trim()).filter(Boolean);
  crit("location").areas = nbs.length
    ? [...nbs.map(n => ({ name: n, city, aliases: [n], score: 100 })), { name: `שאר ${city}`, city, aliases: [], score: 50 }]
    : [{ name: city, city, aliases: [], score: 100 }];
  Object.assign(crit("rooms"), { min: Number(a.minRooms) || null });
  const ed = crit("entryDate");
  if (a.entry === "now") ed.by = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  else if (/^\d{4}-\d{2}-\d{2}$/.test(a.entry ?? "")) ed.by = a.entry;
  else ed.imp = "off";
  crit("broker").imp = a.noBroker ? "high" : "low";
  // מאפיינים: "חובה" / "עדיף" / "לא משנה" — מחליפים את ברירות המחדל של התבנית
  p.criteria = p.criteria.filter(c => c.kind !== "feature");
  const imp = { must: "must", prefer: "medium" };
  for (const [f, v] of Object.entries(a.want ?? {})) if (imp[v]) p.criteria.push({ ...newCriterion("feature"), feature: f, imp: imp[v] });
  if (a.pets) p.criteria.push({ ...newCriterion("feature"), feature: "pets", imp: "must" });
  if (a.roommates) {
    p.criteria.push({ ...newCriterion("feature"), feature: "roommates", imp: "high" });
    crit("keywords").avoid = crit("keywords").avoid.filter(w => !/שותפ/.test(w));
  }
  const sources = citySources("rent", { yad2City: YAD2_CITIES[city], madlanSlug: `${city.replace(/\s+/g, "-")}-ישראל`, label: city });
  sources.push({ id: uid("s"), type: "fb_search", enabled: true, dealType: "rent", name: `חיפוש בפייסבוק — "דירה להשכרה ${city}"`, url: fbSearchUrl(`דירה להשכרה ${city}`) });
  return { profile: p, sources, yad2Known: !!YAD2_CITIES[city] };
}

/** כתובות חיפוש של יד 2 ומדלן לעיר (קוד עיר של יד 2 + שם העיר כפי שמופיע בכתובת של מדלן). */
export function citySources(dealType, { yad2City, madlanSlug, label }) {
  const rent = dealType === "rent";
  const out = [];
  if (yad2City) out.push({ id: uid("s"), type: "yad2", name: `יד 2 — ${label}, ${rent ? "להשכרה" : "למכירה"}`, enabled: true, dealType,
    url: `https://www.yad2.co.il/realestate/${rent ? "rent" : "forsale"}?city=${yad2City}` });
  if (madlanSlug) out.push({ id: uid("s"), type: "madlan", name: `מדלן — ${label}, ${rent ? "להשכרה" : "למכירה"}`, enabled: true, dealType,
    url: `https://www.madlan.co.il/${rent ? "for-rent" : "for-sale"}/${encodeURIComponent(madlanSlug)}` });
  return out;
}

/** חיפוש פוסטים בכל פייסבוק (כל הקבוצות שאתה חבר בהן + קבוצות ציבוריות), רק פוסטים אחרונים. */
export function fbSearchUrl(query) {
  const filters = btoa(JSON.stringify({ "recent_posts:0": JSON.stringify({ name: "recent_posts", args: "" }) }));
  return `https://www.facebook.com/search/posts/?q=${encodeURIComponent(query)}&filters=${encodeURIComponent(filters)}`;
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
      fbIntervalMin: 120,     // פייסבוק — שמרני בכוונה: סריקה אוטומטית מסכנת את החשבון (FB_MIN_INTERVAL)
      fbMaxPerRound: 4,       // כמה קבוצות פייסבוק לכל היותר בסבב אחד — השאר ממתינות לסבב הבא
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
      monthlyUsdCap: 5,       // במפתח API: עצירה כשההוצאה המשוערת החודש מגיעה לסכום הזה ($)
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

/* ---------------- סודות ----------------
   טוקן הטלגרם, מפתח ה-API וסיסמת ה-Apps Script נשמרים רק בתוסף במחשב (chrome.storage.local).
   הם לא עולים לענן: מי שנכנס לחשבון מהנייד (או גנב את הסשן) לא מקבל אותם. */
export const SECRET_FIELDS = [
  ["ai", "apiKey"],
  ["notify.telegram", "token"],
  ["notify.email", "secret"],
];
const at = (o, path) => path.split(".").reduce((x, k) => x?.[k], o);

/** עותק של ההגדרות בלי הסודות (מה שמותר לשמור בענן). */
export function stripSecrets(s) {
  if (!s) return s;
  const c = structuredClone(s);
  for (const [path, k] of SECRET_FIELDS) { const o = at(c, path); if (o && k in o) o[k] = ""; }
  return c;
}

/** הסודות שנמצאים בהגדרות (רק אלה שלא ריקים) — להעברה חד-פעמית מהענן לתוסף. */
export function pickSecrets(s) {
  const out = {};
  for (const [path, k] of SECRET_FIELDS) { const v = at(s, path)?.[k]; if (v) out[`${path}.${k}`] = v; }
  return out;
}

/** מחזיר את ההגדרות עם הסודות מהתוסף משולבים בתוכן (לשימוש מקומי בלבד). */
export function withSecrets(s, secrets = {}) {
  for (const [path, k] of SECRET_FIELDS) { const o = at(s, path); if (o) o[k] = secrets[`${path}.${k}`] ?? ""; }
  return s;
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
  if (h === "facebook.com" && u.pathname.startsWith("/search/")) return "fb_search";
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
