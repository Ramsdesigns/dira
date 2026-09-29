/* generated from shared/ by build/build.mjs — edit the source in shared/ */
/* cloud.js — שכבת Supabase משותפת לאפליקציה ולתוסף.
   האפליקציה שומרת את ההתחברות ב-localStorage; התוסף מעביר מתאם ל-chrome.storage. */

import { createClient } from "../vendor/supabase.js";
import { CONFIG } from "./config.js";
import { stripSecrets } from "./model.js";

let sb = null;

export const configured = () => !!(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);

export function init({ storage, autoRefresh = true } = {}) {
  if (sb || !configured()) return sb;
  sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
    auth: { storage, persistSession: true, autoRefreshToken: autoRefresh, detectSessionInUrl: false, storageKey: "apt-hunter-auth" },
  });
  return sb;
}

const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

/* ---------------- התחברות ---------------- */
export async function user() {
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}
export async function signIn(email, password) {
  return must(await sb.auth.signInWithPassword({ email, password })).user;
}
export async function signOut() { await sb.auth.signOut(); }
export async function updatePassword(password) {
  // אותו מינימום כמו ב-mkuser וב-Supabase (Authentication → Policies): 10 תווים
  if (String(password ?? "").length < 10) throw new Error("הסיסמה צריכה להיות באורך 10 תווים לפחות");
  must(await sb.auth.updateUser({ password }));
}
export function onAuth(fn) { return sb.auth.onAuthStateChange((_e, s) => fn(s?.user ?? null)); }

/* ---------------- הגדרות ---------------- */
export async function loadSettings() {
  const r = must(await sb.from("settings").select("data, updated_at").maybeSingle());
  return r ? { data: r.data, updatedAt: r.updated_at } : null;
}
export async function saveSettings(data) {
  const u = await user();
  // סודות (טוקן טלגרם, מפתח API, סיסמת המייל) לא עולים לענן בשום מסלול — הם נשארים בתוסף במחשב
  const r = must(await sb.from("settings").upsert({ user_id: u.id, data: stripSecrets(data) }).select("updated_at").single());
  return r.updated_at;
}

/* ---------------- מודעות ---------------- */
const PAGE = 500;

/** מודעות שעודכנו אחרי since (או כולן). */
export async function listingsSince(since = null) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    let q = sb.from("listings").select("id, data, user_state, first_seen, last_seen, updated_at").order("updated_at").range(from, from + PAGE - 1);
    if (since) q = q.gt("updated_at", since);
    const rows = must(await q);
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** רק מצבי משתמש (קל) — לסורק, כדי לדעת מה מועדף/מוסתר. */
export async function userStatesSince(since = null) {
  const out = [];
  for (let from = 0; ; from += 2000) {
    let q = sb.from("listings").select("id, user_state, updated_at").order("updated_at").range(from, from + 1999);
    if (since) q = q.gt("updated_at", since);
    const rows = must(await q);
    out.push(...rows);
    if (rows.length < 2000) break;
  }
  return out;
}

export async function listingIds() {
  const out = [];
  for (let from = 0; ; from += 2000) {
    const rows = must(await sb.from("listings").select("id").range(from, from + 1999));
    out.push(...rows.map(r => r.id));
    if (rows.length < 2000) break;
  }
  return out;
}

/** סורק: כותב רק את data/first_seen/last_seen — user_state לא נדרס. */
export async function upsertListings(rows) {
  const u = await user();
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100).map(r => ({ user_id: u.id, ...r }));
    must(await sb.from("listings").upsert(chunk, { onConflict: "user_id,id" }));
  }
}

export async function setUserState(id, state) {
  must(await sb.from("listings").update({ user_state: state }).eq("id", id));
}

/** מודעה ששמרו ידנית: נוצרת עם user_state מלא. */
export async function insertWithState(row, state) {
  const u = await user();
  must(await sb.from("listings").upsert({ user_id: u.id, ...row, user_state: state }, { onConflict: "user_id,id" }));
}

export async function deleteListings(ids) {
  for (let i = 0; i < ids.length; i += 200) must(await sb.from("listings").delete().in("id", ids.slice(i, i + 200)));
}

/* ---------------- סורק ---------------- */
export async function scannerState() {
  const r = must(await sb.from("scanner").select("data, updated_at").maybeSingle());
  return r ? { ...r.data, updatedAt: r.updated_at } : null;
}
export async function setScannerState(patch) {
  const u = await user();
  const cur = (await scannerState()) ?? {};
  delete cur.updatedAt;
  must(await sb.from("scanner").upsert({ user_id: u.id, data: { ...cur, ...patch } }));
}

/* ---------------- פקודות ---------------- */
export async function sendCommand(type, payload = {}) {
  return must(await sb.from("commands").insert({ type, payload }).select("id").single()).id;
}
export async function commandResult(id) {
  return must(await sb.from("commands").select("done_at, result").eq("id", id).single());
}
export async function pendingCommands() {
  return must(await sb.from("commands").select("id, type, payload, created_at").is("done_at", null).order("id"));
}
export async function completeCommand(id, result) {
  must(await sb.from("commands").update({ done_at: new Date().toISOString(), result }).eq("id", id));
}

/* ---------------- יומן ---------------- */
export async function addLog(level, msg) {
  // המסד דוחה הודעה מעל 2000 תווים (אילוץ logs_msg_len), אז חותכים כאן ולא מאבדים את השורה
  await sb.from("logs").insert({ level, msg: String(msg).slice(0, 2000) });
}
export async function recentLogs(limit = 300) {
  return must(await sb.from("logs").select("at, level, msg").order("id", { ascending: false }).limit(limit));
}
export async function pruneLogs() { await sb.rpc("prune_logs", { keep: 1500 }); }

/* ---------------- מחיקת החשבון ---------------- */
/** מוחק את כל השורות של המשתמש המחובר בכל הטבלאות (RLS מתיר רק את השורות שלו).
    את המשתמש עצמו (שורת ההתחברות) אי אפשר למחוק מכאן — זה דורש מפתח מנהל, שאסור שיהיה בדפדפן. */
export async function deleteAllMyData() {
  const u = await user();
  for (const t of ["listings", "logs", "commands", "scanner", "settings"]) must(await sb.from(t).delete().eq("user_id", u.id));
}

/* ---------------- זמן אמת ---------------- */
export function subscribe(onListing, onScanner) {
  return sb.channel("apt-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "listings" }, p => onListing?.(p))
    .on("postgres_changes", { event: "*", schema: "public", table: "scanner" }, p => onScanner?.(p))
    .subscribe();
}
