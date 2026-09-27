/* generated from shared/ by build/build.mjs — edit the source in shared/ */
/* text.js — עזרי טקסט עבריים: נרמול, טביעת אצבע, טלפונים, ופענוח היוריסטי של פוסטים.
   הפענוח ההיוריסטי משמש כגיבוי כשאין מפתח API, וגם כדי להשלים שדות שה-AI פספס. */

const HEB_QUOTES = /["'״׳`]/g;

/** נרמול לחיפוש: בלי גרשיים, מקפים ורווחים כפולים. */
export function norm(s) {
  return String(s ?? "")
    .replace(HEB_QUOTES, "")
    .replace(/[-–—_/\\.,:;!?()[\]{}|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** hash קצר ויציב (FNV-1a 32bit) — מספיק לזיהוי כפילויות, לא לאבטחה. */
export function hash(s) {
  let h = 0x811c9dc5;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** טביעת אצבע של טקסט מודעה: אותה מודעה שפורסמה בכמה קבוצות תקבל אותה טביעה. */
export function textFingerprint(text) {
  const t = norm(text).replace(/https?\S+/g, "").replace(/\d{2,3}\s?\d{3}\s?\d{4}/g, "");
  if (t.length < 60) return null;
  return hash(t.slice(0, 280));
}

/** כל מספרי הטלפון הישראליים בטקסט, בפורמט 05XXXXXXXX. */
export function phones(text) {
  const out = new Set();
  const re = /(?:\+?972[\s-]?|0)(5\d|[2-4689]|7\d)[\s-]?(\d{3})[\s-]?(\d{4})/g;
  let m;
  while ((m = re.exec(String(text ?? "")))) out.add("0" + m[1] + m[2] + m[3]);
  return [...out];
}

/** מספר טלפון לפורמט wa.me (972...). */
export function waNumber(phone) {
  const d = String(phone ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("972")) return d;
  if (d.startsWith("0")) return "972" + d.slice(1);
  return d;
}

const num = s => Number(String(s).replace(/,/g, ""));

/** מחיר מתוך טקסט חופשי. מחזיר מספר בשקלים או null. */
export function parsePrice(text) {
  const t = String(text ?? "");
  // "1.85 מיליון" / "1,850,000 ש"ח" / "2.1 מ'" / "₪1,650,000" / "5800 ₪"
  let m = t.match(/(\d+(?:[.,]\d+)?)\s*(?:מיליון|מליון|מ['׳]\s)/);
  if (m) return Math.round(parseFloat(m[1].replace(",", ".")) * 1_000_000);
  m = t.match(/(\d{1,3}(?:,\d{3})+|\d{4,8})\s*(?:₪|ש["״]?ח|שקל|nis)/i) ||
      t.match(/(?:₪|מחיר[:\s]*|במחיר[:\s]*|ב-?)\s*(\d{1,3}(?:,\d{3})+|\d{4,8})/);
  if (m) return num(m[1]);
  m = t.match(/(\d{3,4})\s*(?:אלף|א['׳])/);
  if (m) return num(m[1]) * 1000;
  // מספר גדול בלי סימן מטבע ("2,400,000") — לא טלפון (לא מתחיל ב-0, בלי מקפים)
  m = t.match(/(?<![\d\-.])(\d{1,2},\d{3},\d{3}|\d{3},\d{3})(?![\d\-])/) ||
      t.match(/(?<![\d\-.])([1-9]\d{5,6})(?![\d\-])/);
  if (m) return num(m[1]);
  return null;
}

export function parseRooms(text) {
  const m = String(text ?? "").match(/(\d{1,2}(?:[.,]5)?)\s*(?:חדרים|חדר|חד['׳]?(?=\s|$|,|\.)|ח['׳])/);
  if (m) {
    const v = parseFloat(m[1].replace(",", "."));
    if (v > 0 && v <= 12) return v;
  }
  if (/חדר וחצי/.test(text)) return 1.5;
  if (/שני חדרים|2 חד/.test(text)) return 2;
  return null;
}

export function parseSqm(text) {
  const m = String(text ?? "").match(/(\d{2,3})\s*(?:מ["״'׳]?ר|מטר(?:ים)?(?:\s*רבוע)?|sqm|m2)/i);
  if (m) {
    const v = num(m[1]);
    if (v >= 15 && v <= 900) return v;
  }
  return null;
}

export function parseFloor(text) {
  const t = String(text ?? "");
  if (/קומת\s*קרקע|קומה\s*0\b/.test(t)) return 0;
  const m = t.match(/קומה\s*(\d{1,2})/);
  return m ? num(m[1]) : null;
}

export function parseTotalFloors(text) {
  const m = String(text ?? "").match(/(?:מתוך|מ-)\s*(\d{1,2})\s*(?:קומות)?/);
  return m ? num(m[1]) : null;
}

/** true / false / null לפי אזכור חיובי או שלילי של מאפיין. */
function feature(t, positive, negative) {
  if (negative && negative.test(t)) return false;
  if (positive.test(t)) return true;
  return null;
}

export function parseFeatures(text) {
  const t = String(text ?? "");
  return {
    elevator: feature(t, /מעלית/, /(?:ללא|בלי|אין)\s*מעלית/),
    parking: feature(t, /חני[הות]/, /(?:ללא|בלי|אין)\s*חני/),
    mamad: feature(t, /ממ["״']?[דק]|מרחב מוגן/, /(?:ללא|בלי|אין)\s*ממ/),
    balcony: feature(t, /מרפס/, /(?:ללא|בלי|אין)\s*מרפס/),
    renovated: feature(t, /משופצ|שיפוץ\s*(?:מלא|כללי|חדש)|חדשה מקבלן|חדש מקבלן/, /דרוש(?:ה)?\s*שיפוץ|טעונ(?:ה)?\s*שיפוץ/),
    storage: feature(t, /מחסן/, /(?:ללא|בלי|אין)\s*מחסן/),
    garden: feature(t, /גינה|דירת גן/, null),
    accessible: feature(t, /נגיש/, null),
  };
}

export function parseBroker(text) {
  const t = String(text ?? "");
  if (/(?:ללא|בלי|לא)\s*(?:דמי\s*)?(?:תיווך|מתווכים)|לא למתווכים|מבעלים|ישירות מה?בעלים/.test(t)) return false;
  if (/תיווך|מתווך|משרד נדל|סוכנות|בלעדיות/.test(t)) return true;
  return null;
}

export function parseDealType(text) {
  const t = String(text ?? "");
  const rent = /להשכרה|לשכירות|שכירות|משכיר|השכרה/.test(t);
  const sale = /למכירה|מוכר(?:ים|ת)?\b|מכירה|לקנייה/.test(t);
  if (sale && !rent) return "sale";
  if (rent && !sale) return "rent";
  return null;
}

/** האם הטקסט בכלל מדבר על נכס (סינון זול לפני שליחה ל-AI). */
export function looksLikeProperty(text) {
  return /דיר[הת]|חד['׳"]|חדרים|מ["״']?ר|מטר|נכס|בית|קוטג|דופלקס|פנטהאוז|יחידת דיור|מגרש|קומה|למכירה|להשכרה|נדל/.test(String(text ?? ""));
}

/** האם זה כנראה פוסט של מישהו שמחפש דירה ולא מציע. */
export function looksLikeSeeker(text) {
  const head = String(text ?? "").slice(0, 90);
  return /^(?:\S+\s){0,3}(?:מחפש|מחפשת|מחפשים|דרוש|דרושה)/.test(head) && parsePrice(text) === null;
}

/** פענוח היוריסטי מלא של פוסט — גיבוי ל-AI. */
export function heuristicParse(text) {
  return {
    isListing: !looksLikeSeeker(text),
    dealType: parseDealType(text),
    price: parsePrice(text),
    rooms: parseRooms(text),
    sqm: parseSqm(text),
    floor: parseFloor(text),
    totalFloors: parseTotalFloors(text),
    features: parseFeatures(text),
    broker: parseBroker(text),
    phone: phones(text)[0] ?? null,
  };
}
