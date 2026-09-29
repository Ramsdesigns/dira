/* generated from shared/ by build/build.mjs — edit the source in shared/ */
/* dedup.js — זיהוי אותה דירה שמופיעה בכמה מקורות / קבוצות, ומיזוג לרשומה אחת. */

import { norm, textFingerprint } from "./text.js";

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
  const sameSource = existing.id === incoming.id;

  for (const [k, v] of Object.entries(incoming)) {
    if (["id", "user", "firstSeen", "ai", "scores", "notified", "priceHistory", "links", "features", "images", "dupKeys"].includes(k)) continue;
    if (!known(v)) continue;
    // שדות מהמקור עצמו מתעדכנים; ממקור אחר רק משלימים חסרים
    if (sameSource || !known(m[k])) m[k] = v;
  }

  const f = { ...(existing.features ?? {}) };
  for (const [k, v] of Object.entries(incoming.features ?? {})) {
    if (v === true || v === false) {
      if (sameSource || f[k] === null || f[k] === undefined) f[k] = v;
    }
  }
  m.features = f;

  if ((!existing.images?.length || (sameSource && incoming.images?.length > existing.images.length)) && incoming.images?.length) {
    m.images = incoming.images;
  }

  // קישורים לכל המקורות שבהם הדירה פורסמה
  const links = [...(existing.links ?? [{ source: existing.source, url: existing.url, id: existing.id }])];
  if (!links.some(x => x.url === incoming.url)) links.push({ source: incoming.source, url: incoming.url, id: incoming.id });
  m.links = links;

  // היסטוריית מחירים — רק שינוי מאותו מקור (מקורות שונים יכולים לפרסם מחיר אחר)
  let priceChanged = null;
  const hist = [...(existing.priceHistory ?? [])];
  if (sameSource && known(incoming.price) && known(existing.price) && incoming.price !== existing.price) {
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
      price: l.price > 0 ? l.price : null,
      rooms: l.rooms > 0 ? l.rooms : null,
      sqm: l.sqm > 0 ? l.sqm : null,
      floor: l.floor ?? null,
    };
    prepCache.set(l, p);
  }
  return p;
}

const both = (x, y) => x != null && y != null;
const close = (x, y, t) => both(x, y) && Math.abs(x - y) <= t * Math.max(x, y);

function jaccard(a, b) {
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

export function sameApartment(a, b) {
  if (a === b || a.id === b.id) return false;
  if (contradicts(a, b)) return false;
  const A = prep(a), B = prep(b);
  // ראיות חזקות
  if (A.fp && A.fp === B.fp) return true;
  if (A.words && B.words && jaccard(A.words, B.words) >= 0.6) return true;
  if (A.phone && A.phone === B.phone && both(A.rooms, B.rooms)) return true;
  if (A.street && B.street) {
    if (A.street !== B.street) return false;
    return both(A.price, B.price) || !!(A.house && B.house) || (close(A.sqm, B.sqm, 0.15) && both(A.floor, B.floor));
  }
  // לאחד הצדדים אין רחוב — דורשים התאמה צמודה בכל השאר
  if (!close(A.price, B.price, 0.02) || !both(A.rooms, B.rooms) || !both(A.floor, B.floor)) return false;
  if (A.nb && B.nb && A.nb !== B.nb) return false;
  if (both(A.sqm, B.sqm) && !close(A.sqm, B.sqm, 0.15)) return false;
  return true;
}

/** מקבץ מודעות לקבוצות של "אותה דירה". קבוצות מתאחדות רק אם אין סתירה בין אף שני חברים —
    כך מודעה בלי רחוב לא "מגשרת" בין שתי דירות ברחובות שונים. */
export function clusterListings(list) {
  const groupOf = list.map((_, i) => i);
  const members = new Map(list.map((_, i) => [i, [i]]));
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const gi = groupOf[i], gj = groupOf[j];
      if (gi === gj || !sameApartment(list[i], list[j])) continue;
      const A = members.get(gi), B = members.get(gj);
      if (A.some(x => B.some(y => contradicts(list[x], list[y])))) continue;
      for (const y of B) { groupOf[y] = gi; A.push(y); }
      members.delete(gj);
    }
  }
  return [...members.values()].map(ix => ix.map(i => list[i]));
}

const STATUS_RANK = ["new", "interesting", "contacted", "visit", "offer"];

/** מאחד קבוצה לכרטיס אחד: הבסיס הוא המודעה העשירה ביותר, והשאר משלימות מה שחסר. */
export function mergeCluster(group) {
  if (group.length === 1) return { ...group[0], members: [group[0].id] };
  const rich = l => (l.enriched ? 4 : 0) + Math.min(3, (l.text?.length ?? 0) / 300) + Math.min(2, (l.images?.length ?? 0) / 4) + (l.price ? 1 : 0) + (l.street ? 1 : 0);
  const sorted = [...group].sort((a, b) => rich(b) - rich(a));
  const m = { ...sorted[0], features: { ...(sorted[0].features ?? {}) } };
  for (const o of sorted.slice(1)) {
    for (const k of ["price", "rooms", "sqm", "floor", "totalFloors", "street", "houseNumber", "address", "neighborhood", "propertyType", "condition", "phone", "contactName", "entryDate", "gardenSqm"]) {
      if ((m[k] === null || m[k] === undefined || m[k] === "") && o[k] != null && o[k] !== "") m[k] = o[k];
    }
    for (const [k, v] of Object.entries(o.features ?? {})) if ((m.features[k] ?? null) === null && (v === true || v === false)) m.features[k] = v;
    if (!m.images?.length && o.images?.length) m.images = o.images;
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
