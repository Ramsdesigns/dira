/* store.js — שכבת הנתונים של האפליקציה: Supabase + מטמון מקומי (IndexedDB) לפתיחה מהירה ולנייד.
   מחזירה מודעות באותו מבנה שהסורק עובד איתו: {...data, id, user, firstSeen, lastSeen}. */

import * as cloud from "./cloud.js";
import { mergeSettings } from "./model.js";

export { configured, user, signIn, signUp, signOut, joinBlob, scannerChannel, onAuth, updatePassword } from "./cloud.js";

export function init() { cloud.init(); }

/* ---------------- מטמון מקומי ---------------- */
let dbp = null;
function idb() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open("apt-app", 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("rows", { keyPath: "id" }); r.result.createObjectStore("kv"); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
const wrap = q => new Promise((res, rej) => { q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
async function st(name, mode = "readonly") { return (await idb()).transaction(name, mode).objectStore(name); }
async function kvGet(k) { return wrap((await st("kv")).get(k)); }
async function kvSet(k, v) { return wrap((await st("kv", "readwrite")).put(v, k)); }

const toListing = r => ({ ...r.data, id: r.id, user: r.user_state ?? {}, firstSeen: Date.parse(r.first_seen), lastSeen: Date.parse(r.last_seen), _updated: r.updated_at });

let cache = new Map();
let owner = null;
// שינויים של המשתמש שעוד לא אושרו מהשרת (id → השינוי). שורה שמגיעה מהשרת בינתיים לא מוחקת אותם
const pending = new Map();

/** שורה מהשרת נכנסת למטמון רק אם היא לא ישנה ממה שכבר יש בו. בלי זה, תשובה שנשלפה רגע לפני
    שסימנת דירה "לא רלוונטית" (הסורק מעדכן מודעות כל דקה) החזירה אותה לרשימה (27.10.2026). */
function accept(r) {
  const cur = cache.get(r.id);
  if (cur?.updated_at && r.updated_at && Date.parse(r.updated_at) < Date.parse(cur.updated_at)) return null;
  const p = pending.get(r.id);
  if (p) r = { ...r, user_state: { ...(r.user_state ?? {}), ...p.patch } };
  cache.set(r.id, r);
  return r;
}

/** טוען מהמטמון המקומי (מיידי), ואז מושך מהענן רק מה שהשתנה. */
export async function allListings({ refresh = true } = {}) {
  const u = await cloud.user();
  if (owner !== u?.id) {
    cache = new Map();
    owner = u?.id ?? null;
    const cachedOwner = await kvGet("owner");
    if (cachedOwner !== owner) {
      (await st("rows", "readwrite")).clear();
      await kvSet("owner", owner);
      await kvSet("since", null);
    }
    for (const r of await wrap((await st("rows")).getAll())) cache.set(r.id, r);
  }
  if (refresh && owner) await syncDown();
  return [...cache.values()].map(toListing);
}

let fullCheckAt = 0;
// סנכרון אחד בכל רגע: רענונים נקראים מכמה מקומות (זמן אמת, חזרה ללשונית), ושני סנכרונים במקביל
// כתבו למטמון בסדר הפוך — הישן אחרי החדש
let syncing = null, again = false;
function syncDown() {
  if (syncing) { again = true; return syncing; }
  syncing = (async () => { do { again = false; await syncOnce(); } while (again); })().finally(() => { syncing = null; });
  return syncing;
}

async function syncOnce() {
  const since = await kvGet("since");
  const rows = await cloud.listingsSince(since ?? null);
  if (rows.length) {
    const s = await st("rows", "readwrite");
    for (const r of rows) { const x = accept(r); if (x) s.put(x); }
    await kvSet("since", rows.at(-1).updated_at);
  }
  // בדיקה מלאה מול השרת פעם ב-10 דקות (ובפתיחה): מודעות שנמחקו יוצאות, ומודעות שחסרות או שהשתנו
  // נמשכות שוב. משיכה לפי "מה השתנה מאז" לבד מפספסת עדכונים כשהסורק מעדכן הרבה מודעות בזמן הדפדוף
  if (Date.now() - fullCheckAt > 10 * 60e3) {
    fullCheckAt = Date.now();
    const vers = new Map((await cloud.listingVersions()).map(r => [r.id, r.updated_at]));
    if (!vers.size) return;   // תשובה ריקה (תקלה) — לא מוחקים את כל המטמון בגללה
    const gone = [...cache.keys()].filter(id => !vers.has(id));
    const stale = [...vers].filter(([id, u]) => cache.get(id)?.updated_at !== u).map(([id]) => id);
    const fresh = stale.length ? await cloud.listingsByIds(stale) : [];
    if (gone.length || fresh.length) {
      const s = await st("rows", "readwrite");
      for (const id of gone) { cache.delete(id); s.delete(id); }
      for (const r of fresh) { const x = accept(r); if (x) s.put(x); }
    }
  }
}

export async function updateUser(id, patch) {
  const r = cache.get(id);
  if (!r) return null;
  r.user_state = { ...(r.user_state ?? {}), ...patch };
  const p = pending.get(id) ?? { patch: {}, n: 0 };
  p.patch = { ...p.patch, ...patch };
  const n = ++p.n;
  pending.set(id, p);
  (await st("rows", "readwrite")).put(r);
  try {
    // נשלח רק השינוי, והשרת ממזג אותו עם מה ששמור אצלו — לא כל המצב מהמטמון (שאולי ישן)
    const saved = await cloud.patchUserState(id, patch);
    const cur = cache.get(id);
    if (saved && cur) {
      cur.user_state = pending.get(id)?.n === n ? saved.user_state : { ...saved.user_state, ...pending.get(id).patch };
      cur.updated_at = saved.updated_at;
      (await st("rows", "readwrite")).put(cur);
    }
  } finally {
    if (pending.get(id)?.n === n) pending.delete(id);
  }
  return toListing(cache.get(id) ?? r);
}

export async function deleteListings(ids) {
  await cloud.deleteListings(ids);
  const s = await st("rows", "readwrite");
  for (const id of ids) { cache.delete(id); s.delete(id); }
}

/** מחיקת החשבון: כל השורות בענן, ואחר כך המטמון המקומי בדפדפן הזה. */
export async function deleteAccountData() {
  await cloud.deleteAllMyData();
  cache = new Map();
  (await st("rows", "readwrite")).clear();
  await kvSet("since", null);
}

/** ייבוא מגיבוי. */
export async function importListings(list) {
  const rows = list.map(l => {
    const { user, firstSeen, lastSeen, _updated, dupKeys, notified, aiKeys, scores, ...data } = l;
    return { row: { id: l.id, data, first_seen: new Date(firstSeen ?? Date.now()).toISOString(), last_seen: new Date(lastSeen ?? Date.now()).toISOString() }, user: user ?? {} };
  });
  for (const { row, user } of rows) await cloud.insertWithState(row, user);
  await syncDown();
}

/* ---------------- הגדרות ---------------- */
export async function getSettings() {
  const r = await cloud.loadSettings();
  return r ? mergeSettings(r.data) : null;
}
export async function saveSettings(s) { await cloud.saveSettings(s); }

/* ---------------- סורק, פקודות, יומן ---------------- */
/** עותקי תמונות שהסורק שמר (שורות "img:..."): Map<id, dataUrl>. */
export async function photos(ids) { return cloud.photoRows(ids); }
/** שורת אבחון ליומן (נראית במסך "יומן סריקות" ואצל המפתח). */
export async function diag(msg) { try { await cloud.addLog("info", msg); } catch {} }

export async function scanner() { return (await cloud.scannerState()) ?? {}; }
export const scannerOnline = sc => !!sc?.heartbeat && Date.now() - sc.heartbeat < 4 * 60e3;

/** שולח פקודה לסורק במחשב. עם wait — מחכה לתוצאה (עד timeout). */
export async function command(type, payload = {}, { wait = false, timeout = 90e3 } = {}) {
  const id = await cloud.sendCommand(type, payload);
  if (!wait) return { ok: true, queued: true };
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    await new Promise(r => setTimeout(r, 2500));
    const r = await cloud.commandResult(id);
    if (r.done_at) return r.result ?? { ok: true };
  }
  return { ok: false, error: "הסורק במחשב לא הגיב. ודא ש-Chrome פתוח במחשב והתוסף מחובר." };
}

export async function recentLog(limit) {
  return (await cloud.recentLogs(limit)).map(r => ({ at: Date.parse(r.at), level: r.level, msg: r.msg }));
}

export function live(onChange) {
  let t = null;
  const bump = () => { clearTimeout(t); t = setTimeout(onChange, 800); };
  return cloud.subscribe(bump, bump);
}
