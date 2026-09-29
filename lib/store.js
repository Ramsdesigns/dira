/* store.js — שכבת הנתונים של האפליקציה: Supabase + מטמון מקומי (IndexedDB) לפתיחה מהירה ולנייד.
   מחזירה מודעות באותו מבנה שהסורק עובד איתו: {...data, id, user, firstSeen, lastSeen}. */

import * as cloud from "./cloud.js";
import { mergeSettings } from "./model.js";

export { configured, user, signIn, signOut, onAuth, updatePassword } from "./cloud.js";

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
async function syncDown() {
  const since = await kvGet("since");
  const rows = await cloud.listingsSince(since ?? null);
  if (rows.length) {
    const s = await st("rows", "readwrite");
    for (const r of rows) { cache.set(r.id, r); s.put(r); }
    await kvSet("since", rows.at(-1).updated_at);
  }
  // מחיקות (הסורק מנקה מודעות ישנות) — בדיקה מלאה פעם ב-10 דקות
  if (Date.now() - fullCheckAt > 10 * 60e3) {
    fullCheckAt = Date.now();
    const ids = new Set(await cloud.listingIds());
    const gone = [...cache.keys()].filter(id => !ids.has(id));
    if (gone.length) {
      const s = await st("rows", "readwrite");
      for (const id of gone) { cache.delete(id); s.delete(id); }
    }
  }
}

export async function updateUser(id, patch) {
  const r = cache.get(id);
  if (!r) return null;
  r.user_state = { ...(r.user_state ?? {}), ...patch };
  (await st("rows", "readwrite")).put(r);
  await cloud.setUserState(id, r.user_state);
  return toListing(r);
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
