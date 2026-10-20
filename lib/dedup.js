/* generated from shared/ by build/build.mjs — edit the source in shared/ */
/* dedup.js — זיהוי אותה דירה שמופיעה בכמה מקורות / קבוצות, ומיזוג לרשומה אחת. */

import { norm, textFingerprint, dedupText } from "./text.js";

/** מפתחות זיהוי: מודעה שחולקת מפתח כלשהו עם מודעה קיימת נחשבת אותה דירה. */
export function dupKeys(l) {
  const keys = new Set();
  const fp = textFingerprint(l.text);
  if (fp && (l.text?.length ?? 0) > 80) keys.add(`t:${fp}`);
  const city = norm(l.city), street = norm(l.street);
  if (city && street && l.houseNumber && l.rooms) {
    keys.add(`a:${city}|${street}|${l.houseNumber}|${l.rooms}|${l.floor ?? "?"}`);
  }
  if (l.phone && l.rooms && l.price) {
    keys.add(`p:${l.phone}|${l.rooms}|${Math.round(l.price / 25000)}`);
  }
  return [...keys];
}

/** מפתח בניין — לזיהוי "זוג דירות באותו בניין". */
export function buildingKey(l) {
  const city = norm(l.city), street = norm(l.street);
  if (!city || !street || !l.houseNumber) return null;
  return `${city}|${street}|${l.houseNumber}`;
}

const known = v => v !== null && v !== undefined && v !== "";

/**
 * מיזוג מודעה חדשה לתוך רשומה קיימת. הרשומה הקיימת שומרת על ה-id ועל נתוני המשתמש.
 * מחזיר {merged, priceChanged:{from,to}|null}
 */
export function mergeInto(existing, incoming, now = Date.now()) {
  const m = { ...existing };
  // פוסט פייסבוק שנקרא שוב עובר רק פענוח פשוט (בלי AI, לחיסכון). הוא לא דורס את מה שה-AI חילץ —
  // רק משלים חסרים, ומעדכן "נראה לאחרונה" ותמונות
  const weaker = !!existing.aiParsed && incoming.aiParsed === false;
  const sameSource = existing.id === incoming.id;
  const overwrite = sameSource && !weaker;

  for (const [k, v] of Object.entries(incoming)) {
    if (["id", "user", "firstSeen", "ai", "scores", "notified", "priceHistory", "links", "features", "images", "dupKeys", "imageHashes", "photoDir"].includes(k)) continue;
    if (!known(v)) continue;
    // שדות מהמקור עצמו מתעדכנים; ממקור אחר רק משלימים חסרים
    if (overwrite || !known(m[k])) m[k] = v;
  }

  const f = { ...(existing.features ?? {}) };
  for (const [k, v] of Object.entries(incoming.features ?? {})) {
    if (v === true || v === false) {
      if (overwrite || f[k] === null || f[k] === undefined) f[k] = v;
    }
  }
  m.features = f;

  // תמונות: עותק שמור בענן לא מוחלף; כתובות שפגו מוחלפות בכתובות טריות מהסריקה הנוכחית
  const stored = (existing.images ?? []).some(isStoredImage);
  const live = liveImages(existing, now);
  if (!stored && incoming.images?.length && (!live.length || (sameSource && incoming.images.length > live.length))) {
    m.images = incoming.images;
  }

  // קישורים לכל המקורות שבהם הדירה פורסמה
  const links = [...(existing.links ?? [{ source: existing.source, url: existing.url, id: existing.id }])];
  if (!links.some(x => x.url === incoming.url)) links.push({ source: incoming.source, url: incoming.url, id: incoming.id });
  m.links = links;

  // היסטוריית מחירים — רק שינוי מאותו מקור (מקורות שונים יכולים לפרסם מחיר אחר)
  let priceChanged = null;
  const hist = [...(existing.priceHistory ?? [])];
  if (overwrite && known(incoming.price) && known(existing.price) && incoming.price !== existing.price) {
    priceChanged = { from: existing.price, to: incoming.price };
    hist.push({ price: incoming.price, at: new Date(now).toISOString() });
    m.price = incoming.price;
  }
  m.priceHistory = hist;
  m.dupKeys = [...new Set([...(existing.dupKeys ?? []), ...dupKeys(m)])];
  m.lastSeen = now;
  return { merged: m, priceChanged };
}

/** מודעה חדשה לגמרי — מוסיף שדות ניהול. */
export function fresh(l, now = Date.now()) {
  return {
    ...l,
    firstSeen: now,
    lastSeen: now,
    links: [{ source: l.source, url: l.url, id: l.id }],
    priceHistory: l.priceHistory ?? (l.price ? [{ price: l.price, at: new Date(now).toISOString() }] : []),
    dupKeys: dupKeys(l),
    user: { fav: false, status: "new", note: "", hidden: false, seen: false },
    ai: {},
    scores: {},
    notified: {},
  };
}

/* ======================= אותה דירה בכמה מקורות ======================= */

/** שם רחוב בצורה שמתעלמת מהבדלי כתיב: "השיקמה"="השקמה", "התאנה"="תאנה", "העלייה"="עליה". */
export function streetKey(s) {
  let t = norm(s).replace(/^(רחוב|רח|שדרות|שד|דרך)\s+/, "").replace(/\s+/g, "");
  t = t.replace(/^ה/, "").replace(/[וי]/g, "").replace(/(.)\1+/g, "$1");
  return t || null;
}

/* ---------- תמונות ----------
   כתובות התמונות של פייסבוק חתומות ופגות אחרי כמה ימים (הפרמטר oe = זמן התפוגה בהקסה).
   הסורק שומר עותק בענן (photos), אבל למודעות ישנות נשארו רק הכתובות המקוריות. */

const STORED = "/storage/v1/object/public/photos/";
export const isStoredImage = u => String(u ?? "").includes(STORED);

/** האם כתובת התמונה כבר לא תיטען (תמונת פייסבוק שפג תוקפה). */
export function imageExpired(u, now = Date.now()) {
  const m = /fbcdn\.net\/.*[?&]oe=([0-9a-f]{6,10})/i.exec(String(u ?? ""));
  return !!m && parseInt(m[1], 16) * 1000 < now;
}

/** רק התמונות שעוד אפשר להציג. */
export const liveImages = (l, now = Date.now()) => (l?.images ?? []).filter(u => u && !imageExpired(u, now));

/** מזהה יציב לתמונה: אותו קובץ שפורסם בכמה קבוצות מקבל אותו מפתח, גם כשהכתובת החתומה שונה. */
export function imageKey(u) {
  const s = String(u ?? "");
  const fb = /\/(\d{5,}_\d{5,}_\d{5,})_[a-z]\.(?:jpg|png|webp)/i.exec(s);
  if (fb) return "fb:" + fb[1];
  if (isStoredImage(s) || !/^https?:/.test(s)) return null;
  return s.split("?")[0];
}

const NIB = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
/** מרחק בין שתי טביעות תמונה (dHash של 64 ביט בהקסה) — כמה ביטים שונים. */
export function hashDistance(a, b) {
  if (!a || !b || a.length !== b.length) return 99;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += NIB[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  return d;
}

/** מפתחות תמונה שמופיעים בהרבה מודעות (לוגו של משרד תיווך, תמונת "למכירה" גנרית) — לא ראיה לאותה דירה. */
export function commonImages(list, max = 6) {
  const n = new Map();
  for (const l of list) for (const k of new Set([...prep(l).imgs, ...prep(l).hashes])) n.set(k, (n.get(k) ?? 0) + 1);
  return new Set([...n].filter(([, c]) => c > max).map(([k]) => k));
}

const cityKey = s => norm(s).replace(/^(קרית|קריית)\s*/, "קרית").replace(/\s+/g, "") || null;
const wordSet = s => new Set(norm(s).replace(/(…|\.\.\.)?\s*עוד$/, "").split(" ").filter(w => w.length > 1).slice(0, 60));

const prepCache = new WeakMap();
function prep(l) {
  let p = prepCache.get(l);
  if (!p) {
    p = {
      city: cityKey(l.city),
      street: l.street ? streetKey(l.street) : null,
      house: l.houseNumber != null && l.houseNumber !== "" ? String(l.houseNumber).replace(/\D.*$/, "") || null : null,
      nb: l.neighborhood ? streetKey(l.neighborhood) : null,
      phone: l.phone ? String(l.phone).replace(/\D/g, "") : null,
      fp: (l.text?.length ?? 0) > 80 ? textFingerprint(l.text) : null,
      words: (l.text?.length ?? 0) > 60 ? wordSet(l.text) : null,
      // פוסטים קצרים (כותרת בלבד) — להשוואה מדויקת / הכלה
      dt: dedupText(l.text),
      ws: null,
      imgs: (l.images ?? []).slice(0, 8).map(imageKey).filter(Boolean),
      hashes: (l.imageHashes ?? []).filter(Boolean),
      price: l.price > 0 ? l.price : null,
      rooms: l.rooms > 0 ? l.rooms : null,
      sqm: l.sqm > 0 ? l.sqm : null,
      floor: l.floor ?? null,
    };
    // אוסף מילים גם לטקסט קצר (לראיות החלשות); נבנה פעם אחת לכל מודעה
    p.ws = p.words ?? (p.dt.length >= 25 ? wordSet(p.dt) : null);
    prepCache.set(l, p);
  }
  return p;
}

const both = (x, y) => x != null && y != null;
const close = (x, y, t) => both(x, y) && Math.abs(x - y) <= t * Math.max(x, y);

/** דמיון בין שני אוספי מילים (0–1). כשההפרש בגודל לבדו מבטיח תוצאה מתחת ל-min — מחזיר 0 בלי לספור. */
function jaccard(a, b, min = 0) {
  if (Math.min(a.size, b.size) < min * Math.max(a.size, b.size)) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

/**
 * האם שתי מודעות הן כנראה אותה דירה (גם ממקורות שונים). שמרני: סתירה ודאית באחד הנתונים = לא.
 * משמש לתצוגה (כרטיס אחד לכל הדירה) ולמניעת התראה כפולה — לא למחיקה, כך שטעות אפשר לבטל.
 */
/** סתירה ודאית בין שתי מודעות — אי אפשר שזו אותה דירה. */
export function contradicts(a, b) {
  const A = prep(a), B = prep(b);
  if (A.city && B.city && !(A.city.includes(B.city) || B.city.includes(A.city))) return true;
  if (a.dealType && b.dealType && a.dealType !== b.dealType) return true;
  if (both(A.rooms, B.rooms) && Math.abs(A.rooms - B.rooms) > 0.5) return true;
  if (both(A.floor, B.floor) && A.floor !== B.floor) return true;
  if (both(A.price, B.price) && !close(A.price, B.price, 0.04)) return true;
  if (A.house && B.house && A.house !== B.house) return true;
  // רחוב שונה = דירה אחרת, גם אם הטקסט דומה (מתווכים משתמשים באותה תבנית לכמה דירות)
  if (A.street && B.street && A.street !== B.street) return true;
  return false;
}

/**
 * ראיה שאלה אותה דירה, בלי סתירה. שתי רמות:
 *  חזקה — טביעת טקסט, טקסט ארוך דומה, טלפון+חדרים, אותה תמונה, אותו רחוב עם פרטים תואמים.
 *  חלשה — אותו טקסט קצר בדיוק, כותרת שמוכלת בפוסט המלא, טקסט קצר דומה מאוד, אותו רחוב ואותו מספר חדרים.
 * opts.strict = רק ראיות חזקות (לסימון אוטומטי של עותק כ"לא רלוונטי" — שם טעות מסתירה דירה אמיתית).
 * opts.common = מפתחות תמונה נפוצים שמתעלמים מהם (commonImages).
 */
export function sameApartment(a, b, opts = {}) {
  if (a === b || a.id === b.id) return false;
  if (contradicts(a, b)) return false;
  const A = prep(a), B = prep(b);
  // דמיון מילים — מחושב פעם אחת ורק כשצריך (זה החלק היקר כשמשווים אלפי מודעות)
  let j;
  const sim = () => (j ??= A.ws && B.ws ? jaccard(A.ws, B.ws, 0.3) : 0);
  // ראיות חזקות
  if (A.fp && A.fp === B.fp) return true;
  if (A.words && B.words && sim() >= 0.6) return true;
  // אותו טלפון לבד לא מספיק: מתווך מפרסם הרבה דירות מאותו מספר. צריך עוד נתון שמתאים
  if (A.phone && A.phone === B.phone && both(A.rooms, B.rooms) && A.rooms === B.rooms &&
      (close(A.price, B.price, 0.02) || close(A.sqm, B.sqm, 0.05) || (A.street && A.street === B.street) || sim() >= 0.35)) return true;
  if (sharedImage(A, B, opts.common)) return true;
  if (A.street && B.street) {
    if (A.street !== B.street) return false;
    if (both(A.price, B.price) || !!(A.house && B.house) || (close(A.sqm, B.sqm, 0.15) && both(A.floor, B.floor))) return true;
  }
  if (!opts.strict && weakMatch(A, B, sim)) return true;
  if (A.street && B.street) return false;
  // לאחד הצדדים אין רחוב — דורשים התאמה צמודה בכל השאר
  if (!close(A.price, B.price, 0.02) || !both(A.rooms, B.rooms) || !both(A.floor, B.floor)) return false;
  if (A.nb && B.nb && A.nb !== B.nb) return false;
  if (both(A.sqm, B.sqm) && !close(A.sqm, B.sqm, 0.15)) return false;
  return true;
}

function sharedImage(A, B, common) {
  const ok = k => !common?.has(k);
  if (A.imgs.length && B.imgs.length && A.imgs.some(k => ok(k) && B.imgs.includes(k))) return true;
  for (const x of A.hashes) for (const y of B.hashes) if (ok(x) && ok(y) && hashDistance(x, y) <= 5) return true;
  return false;
}

function weakMatch(A, B, sim) {
  const [s, l] = A.dt.length <= B.dt.length ? [A.dt, B.dt] : [B.dt, A.dt];
  // אותו פוסט בדיוק (גם קצר): "למכירה ללא תיווך! דירת גן ברמות יצחק נשר" בשלוש קבוצות
  if (s.length >= 15 && s === l) return true;
  if (s.length < 25) return false;
  // כותרת מול הפוסט המלא: "למכירה – דירת 4 חדרים בטופ רמות יצחק!" בראש פוסט של 550 תווים
  if (s.length < l.length && l.slice(0, s.length + 60).includes(s)) return true;
  if (A.ws.size >= 4 && B.ws.size >= 4 && sim() >= 0.6) return true;
  // אותו רחוב ואותו מספר חדרים, וטקסט שמדבר על אותו נכס (מתווכים שונים מנסחים אחרת)
  return !!(A.street && A.street === B.street && both(A.rooms, B.rooms) && A.rooms === B.rooms && sim() >= 0.3);
}

/** מקבץ מודעות לקבוצות של "אותה דירה". קבוצות מתאחדות רק אם אין סתירה בין אף שני חברים —
    כך מודעה בלי רחוב לא "מגשרת" בין שתי דירות ברחובות שונים. */
export function clusterListings(list) {
  const common = commonImages(list);
  const groupOf = list.map((_, i) => i);
  const members = new Map(list.map((_, i) => [i, [i]]));
  for (const [i, j] of candidatePairs(list)) {
    const gi = groupOf[i], gj = groupOf[j];
    if (gi === gj || !sameApartment(list[i], list[j], { common })) continue;
    const A = members.get(gi), B = members.get(gj);
    if (A.some(x => B.some(y => contradicts(list[x], list[y])))) continue;
    for (const y of B) { groupOf[y] = gi; A.push(y); }
    members.delete(gj);
  }
  return [...members.values()].map(ix => ix.map(i => list[i]));
}

/** זוגות שבכלל שווה להשוות (i<j, ממוינים כמו לולאה כפולה): רק מודעות שחולקות משהו שאחת הראיות
    צריכה — טביעה, טלפון, רחוב, תמונה, מילה לא נפוצה, או קומה+מחיר קרוב. ההשוואה עצמה נשארת sameApartment;
    זה רק חוסך את מיליוני הזוגות שאין להם שום דבר משותף (באלפי מודעות: מ-3 שניות לעשיריות שנייה). */
function candidatePairs(list) {
  const buckets = new Map();
  const add = (k, i) => { let b = buckets.get(k); if (!b) buckets.set(k, b = []); b.push(i); };
  const df = new Map();
  const P = list.map(prep);
  for (const p of P) for (const w of p.ws ?? []) df.set(w, (df.get(w) ?? 0) + 1);
  const rare = Math.max(30, Math.round(list.length / 100));
  P.forEach((p, i) => {
    if (p.fp) add("f" + p.fp, i);
    if (p.phone) add("p" + p.phone, i);
    if (p.street) add("s" + p.street, i);
    if (p.dt.length >= 15) add("d" + p.dt.slice(0, 25), i);
    for (const k of p.imgs) add("i" + k, i);
    // טביעת תמונה: מרחק ≤5 ביטים מ-64 → לפחות 3 מתוך 8 הבתים זהים, אז מספיק בית אחד משותף באותו מקום
    for (const h of p.hashes) for (let s = 0; s < h.length; s += 2) add(`h${s}${h.slice(s, s + 2)}`, i);
    if (p.floor != null && p.price) {
      const band = Math.floor(Math.log(p.price) / Math.log(1.02));
      add(`q${p.floor}|${band}`, i); add(`q${p.floor}|${band + 1}`, i);
    }
    // רק מילים נדירות יחסית (שם רחוב, מחיר, ניסוח מיוחד) — "למכירה"/"דירה" לא יוצרות זוגות.
    // נבדק על 2,718 מודעות אמיתיות: אותה תוצאה בדיוק כמו השוואת כל הזוגות
    for (const w of p.ws ?? []) if (df.get(w) < rare) add("w" + w, i);
  });
  const seen = new Set(), out = [];
  const n = list.length;
  for (const b of buckets.values()) {
    if (b.length < 2) continue;
    for (let x = 0; x < b.length; x++) for (let y = x + 1; y < b.length; y++) {
      const i = Math.min(b[x], b[y]), j = Math.max(b[x], b[y]);
      const key = i * n + j;
      if (i === j || seen.has(key)) continue;
      seen.add(key);
      out.push([i, j]);
    }
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

const STATUS_RANK = ["new", "interesting", "contacted", "visit", "offer"];

/** מאחד קבוצה לכרטיס אחד: הבסיס הוא המודעה העשירה ביותר, והשאר משלימות מה שחסר. */
export function mergeCluster(group) {
  if (group.length === 1) return { ...group[0], members: [group[0].id] };
  const rich = l => (l.enriched ? 4 : 0) + Math.min(3, (l.text?.length ?? 0) / 300) + Math.min(2, (l.images?.length ?? 0) / 4) + (l.price ? 1 : 0) + (l.street ? 1 : 0);
  const sorted = [...group].sort((a, b) => rich(b) - rich(a));
  const m = { ...sorted[0], features: { ...(sorted[0].features ?? {}) }, images: liveImages(sorted[0]) };
  for (const o of sorted.slice(1)) {
    for (const k of ["price", "rooms", "sqm", "floor", "totalFloors", "street", "houseNumber", "address", "neighborhood", "propertyType", "condition", "phone", "contactName", "entryDate", "gardenSqm"]) {
      if ((m[k] === null || m[k] === undefined || m[k] === "") && o[k] != null && o[k] !== "") m[k] = o[k];
    }
    for (const [k, v] of Object.entries(o.features ?? {})) if ((m.features[k] ?? null) === null && (v === true || v === false)) m.features[k] = v;
    // תמונות: עדיף עותק ששמור בענן, אחר כך כתובות שעוד לא פגו
    const better = imgs => (imgs.some(isStoredImage) ? 2 : 0) + (imgs.length ? 1 : 0);
    const mine = liveImages(m), theirs = liveImages(o);
    if (better(theirs) > better(mine)) m.images = theirs;
    if ((o.text?.length ?? 0) > (m.text?.length ?? 0) * 1.5 && (o.enriched || !m.enriched)) m.text = o.text;
  }
  const links = [];
  for (const l of group) for (const k of l.links ?? [{ source: l.source, url: l.url, id: l.id }]) if (!links.some(x => x.url === k.url)) links.push(k);
  m.links = links;
  m.members = group.map(l => l.id);
  m.firstSeen = Math.min(...group.map(l => l.firstSeen ?? Infinity));
  m.lastSeen = Math.max(...group.map(l => l.lastSeen ?? 0));
  // מצב המשתמש של הקבוצה: פסילה/הסתרה של עותק אחד חלה על כולם; הסטטוס המתקדם ביותר
  const us = group.map(l => l.user ?? {});
  const rejected = us.find(u => u.status === "rejected");
  const best = us.map(u => u.status ?? "new").sort((a, b) => STATUS_RANK.indexOf(b) - STATUS_RANK.indexOf(a))[0];
  m.user = {
    ...sorted[0].user,
    fav: us.some(u => u.fav),
    seen: us.some(u => u.seen),
    hidden: us.some(u => u.hidden),
    note: [...new Set(us.map(u => u.note).filter(Boolean))].join("\n") || "",
    status: rejected ? "rejected" : best,
    ...(rejected ? { rejectReason: rejected.rejectReason, rejectNote: rejected.rejectNote, rejectedAt: rejected.rejectedAt } : {}),
  };
  // הערכות AI: לוקחים מכל עותק שיש לו
  m.ai = Object.assign({}, ...sorted.slice().reverse().map(l => l.ai ?? {}));
  return m;
}
