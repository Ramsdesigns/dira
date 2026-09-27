/* generated from shared/ by build/build.mjs — edit the source in shared/ */
/* score.js — חישוב אחוז התאמה של מודעה מול פרופיל חיפוש.
   לכל קריטריון מחושב ציון s בין 0 ל-1, או null כשאין מספיק מידע.
   האחוז הסופי = ממוצע משוקלל; מידע חסר נספר כ-0.5 כדי לא להעניש ולא לתגמל.
   קריטריון "חובה" שנכשל בוודאות מסמן את המודעה כפסולה. */

import { IMPORTANCE, FEATURES, CRITERION_KINDS } from "./model.js";
import { norm } from "./text.js";

const has = v => v !== null && v !== undefined && v !== "";
const includesAny = (hay, words) => words.find(w => w && hay.includes(norm(w)));

function locationText(l) {
  return norm([l.city, l.neighborhood, l.street, l.address].filter(Boolean).join(" "));
}

function fullText(l) {
  return norm([l.title, l.text, l.propertyType, l.address, l.neighborhood, l.street, l.city].filter(Boolean).join(" "));
}

function cityMatches(l, city) {
  if (!city) return true;
  const c = norm(city);
  if (has(l.city)) return norm(l.city).includes(c) || c.includes(norm(l.city));
  return fullText(l).includes(c);
}

/* ---------- ציון לכל סוג קריטריון ---------- */

const scorers = {
  price(c, l) {
    if (!has(l.price)) return { s: null };
    if (has(c.min) && l.price < c.min) return { s: 0, detail: "מתחת למינימום" };
    if (!has(c.max) || l.price <= c.max) return { s: 1 };
    // בתוך טווח הסבילות הציון יורד בהדרגה: ממש מעל התקרה ≈ 1, בקצה הסבילות 0.4
    const tol = (c.tolerancePct ?? 0) / 100;
    if (tol > 0 && l.price <= c.max * (1 + tol)) {
      const over = (l.price - c.max) / (c.max * tol);
      return { s: Math.round((1 - 0.6 * over) * 100) / 100, detail: `${Math.round((l.price / c.max - 1) * 100)}% מעל התקרה — מקום למו"מ` };
    }
    return { s: 0, detail: "מעל התקרה" };
  },

  rooms(c, l) {
    if (!has(l.rooms)) return { s: null };
    let d = 0;
    if (has(c.min) && l.rooms < c.min) d = c.min - l.rooms;
    if (has(c.max) && l.rooms > c.max) d = l.rooms - c.max;
    if (d === 0) return { s: 1 };
    if (d <= 0.5) return { s: 0.6, detail: "חצי חדר מהטווח" };
    if (d <= 1) return { s: 0.25, detail: "חדר מהטווח" };
    return { s: 0 };
  },

  sqm(c, l) {
    if (!has(l.sqm)) return { s: null };
    if (has(c.min) && l.sqm < c.min) return l.sqm >= c.min * 0.9 ? { s: 0.5, detail: "קצת קטן" } : { s: 0 };
    if (has(c.max) && l.sqm > c.max) return l.sqm <= c.max * 1.1 ? { s: 0.5, detail: "קצת גדול" } : { s: 0 };
    return { s: 1 };
  },

  ppsqm(c, l) {
    if (!has(l.price) || !has(l.sqm) || !has(c.max)) return { s: null };
    const v = l.price / l.sqm;
    if (v <= c.max) return { s: 1 };
    if (v <= c.max * 1.05) return { s: 0.5 };
    return { s: 0 };
  },

  location(c, l) {
    const loc = locationText(l);
    const txt = fullText(l);
    const ex = includesAny(loc || txt, c.exclude ?? []);
    if (ex) return { s: 0, detail: `מוחרג: ${ex}` };
    let best = null;
    for (const a of c.areas ?? []) {
      const aliases = (a.aliases ?? []).filter(Boolean);
      let hit;
      if (aliases.length) {
        // קודם בשדות המיקום המובנים, ואם אין — בטקסט המודעה
        hit = (loc && includesAny(loc, aliases)) || (!has(l.neighborhood) && includesAny(txt, aliases));
        hit = hit && cityMatches(l, a.city);
      } else {
        hit = cityMatches(l, a.city) && (has(l.city) || (a.city && txt.includes(norm(a.city))));
      }
      if (hit && (!best || a.score > best.score)) best = a;
    }
    if (best) return { s: best.score / 100, detail: best.name };
    if (!loc && !txt) return { s: null };
    // יש מידע מיקום ואף אזור לא התאים
    return has(l.city) || has(l.neighborhood) ? { s: 0, detail: "מחוץ לאזורים" } : { s: null, detail: "מיקום לא ברור" };
  },

  propertyType(c, l) {
    const type = norm(l.propertyType ?? "");
    const txt = fullText(l);
    let best = null;
    for (const t of c.types ?? []) {
      const aliases = (t.aliases?.length ? t.aliases : [t.name]).filter(Boolean);
      const inType = type && includesAny(type, aliases);
      // בטקסט חופשי רק ביטויים מרובי מילים/ארוכים, כדי ש"דירה" לא יתאים לכל מודעה
      const inText = includesAny(txt, aliases.filter(a => a.length > 4 && a !== "דירה"));
      if ((inType || inText) && (!best || t.score > best.score)) best = t;
    }
    if (best) return { s: best.score / 100, detail: best.name };
    return type ? { s: 0, detail: l.propertyType } : { s: null };
  },

  floor(c, l) {
    if (!has(l.floor)) return { s: null };
    if (c.notGround && l.floor === 0) return { s: 0, detail: "קומת קרקע" };
    if (c.notTop && has(l.totalFloors) && l.floor >= l.totalFloors && l.floor > 0) return { s: 0, detail: "קומה אחרונה" };
    if (has(c.min) && l.floor < c.min) return { s: 0 };
    if (has(c.max) && l.floor > c.max) return { s: 0 };
    return { s: 1 };
  },

  feature(c, l) {
    const v = l.features?.[c.feature];
    return { s: v === true ? 1 : v === false ? 0 : null };
  },

  broker(c, l) {
    return { s: l.broker === false ? 1 : l.broker === true ? 0 : null };
  },

  keywords(c, l) {
    const txt = fullText(l);
    if (!l.text && !l.title) return { s: null };
    const bad = includesAny(txt, c.avoid ?? []);
    if (bad) return { s: 0, detail: `"${bad}"` };
    const want = (c.want ?? []).filter(Boolean);
    if (!want.length) return { s: 1 };
    const found = want.filter(w => txt.includes(norm(w)));
    if (found.length >= 2) return { s: 1, detail: found.slice(0, 3).join(", ") };
    if (found.length === 1) return { s: 0.7, detail: found[0] };
    return { s: 0 };
  },

  ai(c, l, profileId) {
    const r = l.ai?.[profileId]?.[c.id];
    if (!r || !has(r.score)) return { s: null, pending: true };
    return { s: Math.max(0, Math.min(100, r.score)) / 100, detail: r.reason };
  },
};

export function criterionLabel(c) {
  switch (c.kind) {
    case "feature":  return FEATURES[c.feature] ?? c.feature;
    case "keywords": return c.label || "מילות מפתח";
    case "ai":       return c.label || "שאלת AI";
    default:         return CRITERION_KINDS[c.kind]?.label ?? c.kind;
  }
}

/**
 * מחשב התאמה של מודעה לפרופיל.
 * @returns {{pct:number, mustFail:boolean, confidence:number, pendingAi:boolean, breakdown:Array}|null}
 *          null כשהמודעה לא רלוונטית לפרופיל בכלל (סוג עסקה אחר).
 */
export function scoreListing(listing, profile) {
  if (profile.dealType && listing.dealType && listing.dealType !== profile.dealType) return null;

  let sum = 0, total = 0, known = 0, mustFail = false, pendingAi = false;
  const breakdown = [];
  for (const c of profile.criteria ?? []) {
    const w = IMPORTANCE[c.imp]?.weight ?? 0;
    if (!w) continue;
    const fn = scorers[c.kind];
    if (!fn) continue;
    const r = fn(c, listing, profile.id);
    const s = r.s;
    if (r.pending) pendingAi = true;
    total += w;
    sum += w * (s ?? 0.5);
    if (s !== null) known += w;
    if (c.imp === "must" && s === 0) mustFail = true;
    breakdown.push({
      id: c.id,
      label: criterionLabel(c),
      imp: c.imp,
      s,
      state: s === null ? (r.pending ? "pending" : "unknown") : s >= 1 ? "ok" : s <= 0 ? "fail" : "partial",
      detail: r.detail ?? null,
    });
  }
  const pct = total ? Math.round((sum / total) * 100) : 0;
  return {
    pct: mustFail ? Math.min(pct, 25) : pct,
    mustFail,
    confidence: total ? Math.round((known / total) * 100) : 0,
    pendingAi,
    breakdown,
  };
}

/** הציון בלי קריטריוני AI — לסינון מוקדם לפני שמשלמים על קריאת API. */
export function prescore(listing, profile) {
  const noAi = { ...profile, criteria: (profile.criteria ?? []).filter(c => c.kind !== "ai") };
  return scoreListing(listing, noAi);
}

export function aiCriteria(profile) {
  return (profile.criteria ?? []).filter(c => c.kind === "ai" && c.imp !== "off" && c.question?.trim());
}

/** החזר חודשי משוער למשכנתא (שפיצר). */
export function monthlyPayment(price, finance) {
  if (!price || !finance) return null;
  const loan = Math.max(0, price - (finance.equity || 0));
  if (!loan) return 0;
  const r = (finance.rate || 0) / 100 / 12;
  const n = (finance.years || 30) * 12;
  if (!r) return Math.round(loan / n);
  return Math.round((loan * r) / (1 - Math.pow(1 + r, -n)));
}
