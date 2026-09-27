/* app.js — האפליקציה (PWA, מחשב ונייד): דירות, מועדפים, זוגות בבניין, עורך פרופיל/קריטריונים,
   מקורות, התראות והגדרות. הנתונים בענן (Supabase); הסריקה עצמה רצה בתוסף שבמחשב. */

import * as db from "./lib/store.js";
import { scoreListing, monthlyPayment, criterionLabel } from "./lib/score.js";
import {
  IMPORTANCE, FEATURES, STATUSES, SOURCE_TYPES, CRITERION_KINDS, PROFILE_TEMPLATES, AI_MODELS as MODELS,
  newCriterion, uid, detectSourceType, dealTypeFromUrl, DEFAULT_MESSAGE, defaultSettings, defaultSources,
} from "./lib/model.js";
import { waNumber, norm } from "./lib/text.js";

const APPS_SCRIPT_CODE = `function doPost(e) {
  var d = JSON.parse(e.postData.contents);
  if (d.secret !== 'SECRET_HERE') return ContentService.createTextOutput('forbidden');
  MailApp.sendEmail({ to: d.to, subject: d.subject, htmlBody: d.html, name: 'צייד הדירות' });
  return ContentService.createTextOutput('ok');
}`;

/* ======================= מצב ======================= */

let S = null;            // הגדרות
let L = [];              // מודעות
let SC = {};             // מצב הסורק במחשב (דופק, מצב מקורות, שימוש ב-AI)
let srcState = {};
let lastRunAt = null;
let scanning = false;
const UI = loadUi();
const $ = sel => document.querySelector(sel);
const main = $("#main");

function loadUi() {
  const d = { profileId: null, minScore: 40, status: "active", sort: "score", sources: [], showRejected: false, onlyNew: false, q: "",
    maxPrice: "", minRooms: "", nb: "", ptype: "" };
  try { return { ...d, ...JSON.parse(localStorage.getItem("ui") ?? "{}"), q: "" }; } catch { return d; }
}
function saveUi() { try { localStorage.setItem("ui", JSON.stringify(UI)); } catch {} }

const profile = () => S.profiles.find(p => p.id === UI.profileId) ?? S.profiles[0];

/* ======================= עזרים ======================= */

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtPrice = p => (p ? "₪" + Math.round(p).toLocaleString("he-IL") : "מחיר לא צוין");
const fmtK = p => (p >= 1e6 ? (p / 1e6).toFixed(p % 1e6 ? 2 : 0).replace(/\.?0+$/, "") + "M" : Math.round(p / 1000) + "K");
const icon = (id, cls = "") => `<svg class="ico ${cls}"><use href="#i-${id}"/></svg>`;

function ago(t) {
  if (!t) return "";
  const ms = Date.now() - (typeof t === "number" ? t : Date.parse(t));
  const m = Math.round(ms / 60000);
  if (m < 1) return "עכשיו";
  if (m < 60) return `לפני ${m} דק׳`;
  const h = Math.round(m / 60);
  if (h < 24) return `לפני ${h} שע׳`;
  const d = Math.round(h / 24);
  return d === 1 ? "אתמול" : `לפני ${d} ימים`;
}

function toast(msg, err = false) {
  const t = document.createElement("div");
  t.className = "toast" + (err ? " err" : "");
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 3200);
}

let saveTimer = null;
function persist(immediate = false) {
  clearTimeout(saveTimer);
  const go = async () => {
    await db.saveSettings(S);
    document.querySelectorAll(".saved").forEach(el => { el.classList.add("show"); setTimeout(() => el.classList.remove("show"), 1200); });
  };
  if (immediate) return go();
  saveTimer = setTimeout(go, 450);
}

function download(name, data) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function pickFile() {
  return new Promise(resolve => {
    const i = document.createElement("input");
    i.type = "file"; i.accept = "application/json,.json";
    i.onchange = async () => resolve(i.files[0] ? JSON.parse(await i.files[0].text()) : null);
    i.click();
  });
}

const place = l => [l.neighborhood, l.city].filter(Boolean).join(", ") || l.address || "מיקום לא צוין";
const floorTxt = l => l.floor === null || l.floor === undefined ? null : l.floor === 0 ? "קרקע" : `קומה ${l.floor}${l.totalFloors ? "/" + l.totalFloors : ""}`;
const facts = l => [l.propertyType, l.rooms && `${l.rooms} חד׳`, l.sqm && `${l.sqm} מ״ר`, floorTxt(l)].filter(Boolean).join(" · ");
const scoreColor = p => p >= 80 ? "var(--good)" : p >= 60 ? "var(--accent)" : p >= 40 ? "var(--warn)" : "var(--bad)";

/* ---------- מחיר למ"ר לעומת האזור ---------- */
let areaStats = new Map();
function buildAreaStats() {
  const acc = new Map();
  const add = (k, v) => { if (!acc.has(k)) acc.set(k, []); acc.get(k).push(v); };
  for (const l of L) {
    if (!l.price || !l.sqm || l.dealType === "rent" || l.sqm < 25) continue;
    const v = l.price / l.sqm;
    if (l.city) add("c:" + norm(l.city), v);
    if (l.city && l.neighborhood) add("n:" + norm(l.city) + "|" + norm(l.neighborhood), v);
  }
  areaStats = new Map();
  for (const [k, vs] of acc) {
    if (vs.length < 3) continue;
    vs.sort((a, b) => a - b);
    areaStats.set(k, { median: vs[Math.floor(vs.length / 2)], n: vs.length });
  }
}
function ppsqmInfo(l) {
  if (!l.price || !l.sqm || l.dealType === "rent") return null;
  const v = l.price / l.sqm;
  const st = (l.neighborhood && areaStats.get("n:" + norm(l.city) + "|" + norm(l.neighborhood))) || areaStats.get("c:" + norm(l.city));
  const diff = st ? Math.round((v / st.median - 1) * 100) : null;
  return { v, diff, n: st?.n, scope: st && areaStats.get("n:" + norm(l.city) + "|" + norm(l.neighborhood)) ? "בשכונה" : "בעיר" };
}

/* ======================= טעינה ======================= */

async function loadAll() {
  S = await db.getSettings();
  L = await db.allListings({ refresh: false });
  if (!S.profiles.some(p => p.id === UI.profileId)) UI.profileId = S.profiles.find(p => p.active)?.id ?? S.profiles[0]?.id;
  buildAreaStats();
  renderProfileSel();
  renderCounts();
}

function renderProfileSel() {
  $("#profileSel").innerHTML = S.profiles.map(p =>
    `<option value="${p.id}" ${p.id === UI.profileId ? "selected" : ""}>${esc(p.name)}${p.active ? "" : " (כבוי)"}</option>`).join("");
}

function scored() {
  const P = profile();
  return L.map(l => ({ l, s: P ? scoreListing(l, P) : null })).filter(x => x.s);
}

function renderCounts() {
  const P = profile();
  const sc = scored();
  const above = sc.filter(x => !x.s.mustFail && x.s.pct >= (P?.notifyThreshold ?? 70) && !x.l.user?.hidden);
  $("#cntListings").textContent = above.length || "";
  $("#cntFav").textContent = L.filter(l => l.user?.fav).length || "";
  $("#cntPairs").textContent = pairGroups().length || "";
  $("#cntSources").textContent = S.sources.filter(s => s.enabled).length || "";
}

/* ======================= ניתוב ======================= */

const views = { more: viewMore, listings: viewListings, favorites: viewFavorites, pairs: viewPairs, profile: viewProfile, sources: viewSources, notify: viewNotify, settings: viewSettings, log: viewLog };

function route() {
  const [view, sub] = (location.hash.slice(1) || "listings").split("/");
  const v = views[view] ? view : "listings";
  document.querySelectorAll(".rail a").forEach(a => a.classList.toggle("on", a.dataset.view === v));
  main.scrollTop = 0;
  views[v](sub);
}

/* ======================= דירות ======================= */

function filtered(opts = {}) {
  const P = profile();
  const q = norm(UI.q);
  let rows = scored();
  if (opts.favorites) rows = rows.filter(x => x.l.user?.fav);
  else {
    rows = rows.filter(x => !x.l.user?.hidden);
    if (!UI.showRejected) rows = rows.filter(x => !x.s.mustFail && x.l.user?.status !== "rejected");
    rows = rows.filter(x => x.s.pct >= UI.minScore);
    if (UI.status === "active") rows = rows.filter(x => x.l.user?.status !== "rejected");
    else if (UI.status !== "all") rows = rows.filter(x => (x.l.user?.status ?? "new") === UI.status);
    if (UI.onlyNew) rows = rows.filter(x => x.l.firstSeen > Date.now() - 24 * 3600e3);
    // מסננים מהירים — בנוסף לקריטריונים של הפרופיל (מודעה בלי הנתון לא מוסתרת)
    if (UI.maxPrice) rows = rows.filter(x => !x.l.price || x.l.price <= Number(UI.maxPrice));
    if (UI.minRooms) rows = rows.filter(x => !x.l.rooms || x.l.rooms >= Number(UI.minRooms));
    if (UI.nb) rows = rows.filter(x => (x.l.neighborhood ?? "") === UI.nb);
    if (UI.ptype) rows = rows.filter(x => (x.l.propertyType ?? "") === UI.ptype);
    if (UI.sources.length) rows = rows.filter(x => (x.l.links ?? [{ source: x.l.source }]).some(k => UI.sources.includes(k.source)));
  }
  if (q) rows = rows.filter(x => norm([x.l.title, x.l.text, x.l.city, x.l.neighborhood, x.l.street, x.l.propertyType, x.l.user?.note].join(" ")).includes(q));
  const by = {
    score: (a, b) => b.s.pct - a.s.pct || b.l.firstSeen - a.l.firstSeen,
    newest: (a, b) => b.l.firstSeen - a.l.firstSeen,
    priceUp: (a, b) => (a.l.price ?? 9e12) - (b.l.price ?? 9e12),
    priceDown: (a, b) => (b.l.price ?? 0) - (a.l.price ?? 0),
    ppsqm: (a, b) => (a.l.price && a.l.sqm ? a.l.price / a.l.sqm : 9e12) - (b.l.price && b.l.sqm ? b.l.price / b.l.sqm : 9e12),
  };
  rows.sort(by[UI.sort] ?? by.score);
  return { rows, P };
}

function onboardingHtml() {
  const hasFb = S.sources.some(s => s.type === "fb_group" || s.type === "fb_market");
  const steps = [
    [!!SC.heartbeat, "התקן את תוסף הסורק ב-Chrome במחשב והתחבר בו עם אותו משתמש", "#settings", "איך מתקינים"],
    [S.ai.provider === "api" ? !!S.ai.apiKey : !!SC.aiHost?.ok, "חבר את Claude (דרך המנוי שלך) — כדי לקרוא פוסטים בפייסבוק ולהעריך את השאלות החופשיות", "#settings", "להגדרות AI"],
    [!!S.onboard?.profileReviewed, "עבור על הפרופיל: תקציב, אזורים, וכמה חשוב כל דבר", "#profile", "לפרופיל"],
    [hasFb, "הוסף קבוצות פייסבוק של דירות באזור (נכנסים לקבוצה ← אייקון התוסף ← 'הוסף כמקור')", "#sources", "למקורות"],
    [S.notify.telegram.enabled || S.notify.email.enabled, "חבר טלגרם או מייל כדי לקבל התראות לטלפון", "#notify", "להתראות"],
    [!!lastRunAt, "הרץ סריקה ראשונה", null, "סרוק עכשיו"],
  ];
  if (steps.every(s => s[0]) || S.onboard?.dismissed) return "";
  return `<section class="onboard">
    <div class="row"><h2 class="grow">מתחילים — 6 צעדים</h2><button class="btn ghost sm" data-act="dismissOnboard">הסתר</button></div>
    <ol>${steps.map(([ok, txt, href, cta]) => `<li class="${ok ? "done" : ""}"><span>${txt}</span>${ok ? "" : href ? `<a class="btn sm" href="${href}">${cta}</a>` : `<button class="btn sm primary" data-act="scanNow">${cta}</button>`}</li>`).join("")}</ol>
  </section>`;
}

function viewListings() {
  const { rows, P } = filtered();
  const total = scored().filter(x => !x.l.user?.hidden).length;
  const srcChips = Object.entries(SOURCE_TYPES).map(([k, v]) =>
    `<button class="${UI.sources.includes(k) ? "on" : ""}" data-act="toggleSrc" data-v="${k}">${v.short}</button>`).join("");
  main.innerHTML = `
    ${onboardingHtml()}
    <div class="view-head">
      <div class="grow"><h1>דירות</h1><p>ממוינות לפי התאמה לפרופיל "${esc(P?.name ?? "")}". הציון מתעדכן מיד כשמשנים קריטריונים.</p></div>
      <button class="btn sm mobile-only" data-act="toggleFilters">${icon("sliders", "sm")}סינון ומיון</button>
      <button class="btn sm" data-act="markAllSeen">${icon("check", "sm")}סמן הכל כנראה</button>
    </div>
    <div class="filters ${UI.filtersOpen ? "open" : ""}">
      <div class="grp">התאמה מינימלית <input type="range" min="0" max="100" step="5" value="${UI.minScore}" data-ui="minScore"><span class="val num">${UI.minScore}%</span></div>
      <div class="grp">מקור <div class="seg">${srcChips}</div></div>
      <div class="grp">סטטוס <select data-ui="status">
        <option value="active">הכל חוץ מנפסלו</option><option value="all">הכל</option>
        ${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
      </select></div>
      <div class="grp">מיון <select data-ui="sort">
        <option value="score">התאמה</option><option value="newest">חדשות קודם</option>
        <option value="priceUp">מחיר: נמוך לגבוה</option><option value="priceDown">מחיר: גבוה לנמוך</option><option value="ppsqm">מחיר למ״ר</option>
      </select></div>
      <div class="grp">מחיר עד <select data-ui="maxPrice"><option value="">הכל</option>${[1500000, 2000000, 2500000, 3000000, 3300000, 3600000, 4000000].map(v => `<option value="${v}" ${String(UI.maxPrice) === String(v) ? "selected" : ""}>${fmtK(v)}</option>`).join("")}</select></div>
      <div class="grp">חדרים <select data-ui="minRooms"><option value="">הכל</option>${[3, 4, 5, 6, 7, 8].map(v => `<option value="${v}" ${String(UI.minRooms) === String(v) ? "selected" : ""}>${v}+</option>`).join("")}</select></div>
      <div class="grp">שכונה <select data-ui="nb"><option value="">כל השכונות</option>${countBy("neighborhood").map(([k, n]) => `<option value="${esc(k)}" ${UI.nb === k ? "selected" : ""}>${esc(k)} (${n})</option>`).join("")}</select></div>
      <div class="grp">סוג נכס <select data-ui="ptype"><option value="">הכל</option>${countBy("propertyType").map(([k, n]) => `<option value="${esc(k)}" ${UI.ptype === k ? "selected" : ""}>${esc(k)} (${n})</option>`).join("")}</select></div>
      <label class="check grp"><input type="checkbox" data-ui="onlyNew" ${UI.onlyNew ? "checked" : ""}>רק מה-24 שעות האחרונות</label>
      ${UI.maxPrice || UI.minRooms || UI.nb || UI.ptype || UI.sources.length || UI.onlyNew ? `<button class="btn sm ghost" data-act="clearFilters">נקה מסננים</button>` : ""}
      <label class="check grp"><input type="checkbox" data-ui="showRejected" ${UI.showRejected ? "checked" : ""}>הצג גם כאלה שנכשלו בחובה</label>
    </div>
    <div class="summary"><span><b class="num">${rows.length}</b> מוצגות מתוך <span class="num">${total}</span></span></div>
    ${rows.length ? `<div class="grid">${rows.map(x => card(x.l, x.s)).join("")}</div>` : emptyHtml(total)}
  `;
  main.querySelector('[data-ui="status"]').value = UI.status;
  main.querySelector('[data-ui="sort"]').value = UI.sort;
}

/** ערכים קיימים בנתונים (שכונות / סוגי נכס) עם כמות, לתפריטי הסינון. */
function countBy(field) {
  const m = new Map();
  for (const l of L) if (l[field] && !l.user?.hidden) m.set(l[field], (m.get(l[field]) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
}

function emptyHtml(total) {
  if (!L.length) return `<div class="empty"><h2>עוד אין דירות</h2><p>הסורק במחשב אוסף דירות כל ${S.scan.intervalMin} דקות כש-Chrome פתוח. אפשר גם לבקש סריקה עכשיו.</p><br><button class="btn primary" data-act="scanNow">${icon("sync", "sm")}סרוק עכשיו</button></div>`;
  return `<div class="empty"><h2>אין דירות שעוברות את הסינון</h2><p>${total} דירות נאספו. נסה להוריד את ההתאמה המינימלית או לסמן "הצג גם כאלה שנכשלו בחובה".</p></div>`;
}

function ring(s, big = false) {
  return `<div class="ring ${s.pendingAi && S.ai.apiKey ? "pending" : ""}" style="--p:${s.pct};--c:${scoreColor(s.pct)}" title="${s.mustFail ? "נכשל בקריטריון חובה" : `ודאות ${s.confidence}%`}${s.pendingAi ? " · ממתין להערכת AI" : ""}">
    <b>${s.pct}<small>%</small></b></div>`;
}

function isGone(l) {
  const st = srcState[l.sourceId];
  return st?.lastOk && l.lastSeen < st.lastOk - 26 * 3600e3;
}

function card(l, s) {
  const img = l.images?.[0];
  const pp = ppsqmInfo(l);
  const drop = (l.priceHistory?.length ?? 0) > 1 && l.priceHistory.at(-1).price < l.priceHistory[0].price;
  const chips = s.breakdown
    .filter(b => b.imp !== "low" || b.state === "ok")
    .sort((a, b) => IMPORTANCE[b.imp].weight - IMPORTANCE[a.imp].weight)
    .slice(0, 7)
    .map(b => `<span class="chip ${b.state}" title="${esc(b.detail ?? "")}">${esc(b.label)}${b.state === "unknown" ? "?" : ""}</span>`).join("");
  const aiLine = s.breakdown.find(b => b.detail && profile().criteria.find(c => c.id === b.id)?.kind === "ai");
  const srcs = [...new Set((l.links ?? [{ source: l.source }]).map(k => SOURCE_TYPES[k.source]?.short ?? k.source))].join(" + ");
  const status = l.user?.status ?? "new";
  return `<article class="card ${l.user?.seen ? "" : "unseen"} ${s.mustFail || status === "rejected" ? "muted-card" : ""}" data-id="${esc(l.id)}">
    <div class="pic">
      ${img ? `<img src="${esc(img)}" loading="lazy" alt="" referrerpolicy="no-referrer">` : `<div class="noimg">${esc((l.text ?? "").slice(0, 140)) || "אין תמונה"}</div>`}
      <div class="badges">
        ${!l.user?.seen ? `<span class="badge new">חדש</span>` : ""}
        ${drop ? `<span class="badge drop">${icon("down", "sm")}ירד מחיר</span>` : ""}
        ${l.pairWith?.length ? `<span class="badge pair">עוד דירה בבניין</span>` : ""}
        ${isGone(l) ? `<span class="badge gone">ייתכן שהוסרה</span>` : ""}
      </div>
      ${ring(s)}
    </div>
    <div class="body">
      <div class="price-row"><span class="price num">${fmtPrice(l.price)}</span>
        ${pp ? `<span class="ppsqm">₪${Math.round(pp.v).toLocaleString("he-IL")} למ״ר${pp.diff !== null ? ` · <span class="${pp.diff <= -5 ? "cheap" : pp.diff >= 5 ? "pricey" : ""}">${pp.diff > 0 ? "+" : ""}${pp.diff}% מהחציון ${pp.scope}</span>` : ""}</span>` : ""}</div>
      <div class="facts">${esc(facts(l)) || "<span class='dim'>פרטים חסרים</span>"}</div>
      <div class="place">${esc(place(l))}${l.address && !place(l).includes(l.address) ? " · " + esc(l.address) : ""}</div>
      ${aiLine ? `<div class="ai-line">${icon("spark", "sm")}<span><b>${esc(aiLine.label)}:</b> ${esc(aiLine.detail)}</span></div>` : ""}
      <div class="crit">${chips}</div>
    </div>
    <div class="foot">
      <button class="btn icon sm ghost ${l.user?.fav ? "fav-on" : ""}" data-act="fav" title="מועדף">${icon("star", "sm")}</button>
      <select data-act="status" title="סטטוס">${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}" ${k === status ? "selected" : ""}>${v}</option>`).join("")}</select>
      <span class="srcline" title="${esc(srcs)}">${esc(srcs)} · ${ago(l.firstSeen)}</span>
      ${l.phone ? `<button class="btn icon sm ghost" data-act="wa" title="וואטסאפ">${icon("chat", "sm")}</button>` : ""}
      <button class="btn icon sm ghost" data-act="open" title="פתח מודעה">${icon("external", "sm")}</button>
      <button class="btn icon sm ghost" data-act="hide" title="הסתר">${icon("eye-off", "sm")}</button>
    </div>
  </article>`;
}

/* ======================= מועדפים ======================= */

function viewFavorites() {
  const { rows } = filtered({ favorites: true });
  const order = Object.keys(STATUSES);
  rows.sort((a, b) => order.indexOf(b.l.user?.status ?? "new") - order.indexOf(a.l.user?.status ?? "new") || b.s.pct - a.s.pct);
  const counts = order.map(k => [k, rows.filter(x => (x.l.user?.status ?? "new") === k).length]).filter(([, n]) => n);
  main.innerHTML = `
    <div class="view-head"><div class="grow"><h1>מועדפים</h1><p>הדירות ששמרת, לפי שלב הטיפול. אפשר לשמור גם ידנית: בעמוד מודעה ביד 2 או במדלן ← אייקון התוסף ← "שמור".</p></div></div>
    ${counts.length ? `<div class="summary">${counts.map(([k, n]) => `<span class="chip">${STATUSES[k]}: <span class="num">${n}</span></span>`).join("")}</div>` : ""}
    ${rows.length ? `<div class="grid">${rows.map(x => card(x.l, x.s)).join("")}</div>` : `<div class="empty"><h2>עוד אין מועדפים</h2><p>לחץ על הכוכב בכרטיס של דירה כדי לשמור אותה כאן.</p></div>`}`;
}

/* ======================= שתי דירות בבניין ======================= */

function pairGroups() {
  const byId = new Map(L.map(l => [l.id, l]));
  const seen = new Set();
  const groups = [];
  for (const l of L) {
    if (!l.pairWith?.length || seen.has(l.id) || l.user?.hidden) continue;
    const g = [l, ...l.pairWith.map(id => byId.get(id)).filter(Boolean)];
    g.forEach(x => seen.add(x.id));
    if (g.length > 1) groups.push(g);
  }
  return groups;
}

function viewPairs() {
  const P = profile();
  const groups = pairGroups();
  main.innerHTML = `
    <div class="view-head"><div class="grow"><h1>שתי דירות באותו בניין</h1>
      <p>כשמוצעות למכירה שתי דירות באותה כתובת, אפשר לקנות את שתיהן: משפחה בקומה אחת ואמא בקומה אחרת, כל אחד עם דלת משלו. זוהה לפי רחוב ומספר בית, ולכן עובד בעיקר על יד 2 ומדלן.</p></div></div>
    ${groups.length ? groups.map(g => {
      const sum = g.reduce((a, l) => a + (l.price ?? 0), 0);
      return `<section class="panel"><h2>${esc(g[0].address ?? "")}, ${esc(place(g[0]))}</h2>
        <p class="sub">${g.length} דירות · ביחד ${fmtPrice(sum)} · ${g.reduce((a, l) => a + (l.rooms ?? 0), 0)} חדרים</p>
        <div class="grid">${g.map(l => card(l, scoreListing(l, P) ?? { pct: 0, breakdown: [], confidence: 0 })).join("")}</div></section>`;
    }).join("") : `<div class="empty"><h2>עוד לא נמצאו זוגות</h2><p>כשתופענה שתי מודעות באותה כתובת (בקומות שונות), הן יוצגו כאן ותקבל התראה.</p></div>`}`;
}

/* ======================= מגירת פרטים ======================= */

function waLink(l) {
  const msg = (S.messageTemplate || DEFAULT_MESSAGE)
    .replaceAll("{מיקום}", [l.address, place(l)].filter(Boolean).join(", "))
    .replaceAll("{חדרים}", l.rooms ?? "")
    .replaceAll("{מחיר}", l.price ? fmtPrice(l.price) : "")
    .replaceAll("{קישור}", l.url ?? "");
  return `https://wa.me/${waNumber(l.phone)}?text=${encodeURIComponent(msg)}`;
}

async function openDrawer(id) {
  const l = L.find(x => x.id === id);
  if (!l) return;
  if (!l.user?.seen) { l.user = { ...l.user, seen: true }; db.updateUser(id, { seen: true }); }
  const P = profile();
  const s = scoreListing(l, P) ?? { pct: 0, breakdown: [], confidence: 0 };
  const pp = ppsqmInfo(l);
  const pay = monthlyPayment(l.price, S.finance);
  const f = l.features ?? {};
  const featTxt = Object.entries(FEATURES).map(([k, v]) => f[k] === true ? `✓ ${v}` : f[k] === false ? `✗ ${v}` : null).filter(Boolean).join(" · ");
  const kv = [
    ["מחיר", fmtPrice(l.price)], ["חדרים", l.rooms], ["שטח", l.sqm && `${l.sqm} מ״ר`], ["גינה", l.gardenSqm && `${l.gardenSqm} מ״ר`],
    ["קומה", floorTxt(l)], ["סוג נכס", l.propertyType], ["מצב", l.condition], ["תיווך", l.broker === true ? "כן" : l.broker === false ? "ללא תיווך" : null],
    ["מחיר למ״ר", pp && `₪${Math.round(pp.v).toLocaleString("he-IL")}${pp.diff !== null ? ` (${pp.diff > 0 ? "+" : ""}${pp.diff}% מהחציון ${pp.scope}, ${pp.n} דירות)` : ""}`],
    ["החזר חודשי משוער", pay && S.finance.equity ? `₪${pay.toLocaleString("he-IL")} (${S.finance.years} שנה, ${S.finance.rate}%)` : null],
    ["ועד בית", l.houseCommittee && `₪${l.houseCommittee}`], ["כניסה", l.entryDate], ["איש קשר", l.contactName], ["טלפון", l.phone],
    ["נראתה לראשונה", ago(l.firstSeen)], ["נראתה לאחרונה", ago(l.lastSeen)],
  ].filter(([, v]) => v !== null && v !== undefined && v !== "");

  $("#drawerBody").innerHTML = `
    <div class="gallery">${l.images?.length ? l.images.map((src, i) => `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-zoom="${i}">`).join("") : `<div class="noimg">אין תמונות</div>`}</div>
    ${l.images?.length > 1 ? `<div class="gallery-count">${l.images.length} תמונות · לחץ להגדלה</div>` : ""}
    <div class="dsec">
      <div class="dhead">${ring(s, true)}<div class="grow"><h2>${esc(facts(l) || l.title || "מודעה")}</h2><p class="muted">${esc(place(l))}${l.address ? " · " + esc(l.address) : ""}</p></div></div>
      <br><div class="actions" data-id="${esc(l.id)}">
        <button class="btn ${l.user?.fav ? "fav-on" : ""}" data-act="fav">${icon("star", "sm")}${l.user?.fav ? "במועדפים" : "שמור במועדפים"}</button>
        <select data-act="status">${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}" ${k === (l.user?.status ?? "new") ? "selected" : ""}>${v}</option>`).join("")}</select>
        ${l.phone ? `<a class="btn primary" href="${esc(waLink(l))}" target="_blank">${icon("chat", "sm")}וואטסאפ עם הודעה מוכנה</a>` : ""}
        <a class="btn" href="${esc(l.url)}" target="_blank">${icon("external", "sm")}פתח מודעה</a>
        <button class="btn ghost" data-act="hide">${icon("eye-off", "sm")}${l.user?.hidden ? "בטל הסתרה" : "הסתר"}</button>
      </div>
    </div>
    ${adTextHtml(l)}
    <div class="dsec"><h3>למה ${s.pct}%${s.mustFail ? " (נכשל בחובה)" : ""} · ודאות ${s.confidence}%</h3>
      <div class="breakdown">${s.breakdown.map(b => `<div class="bd ${b.state}"><span class="mark"></span>
        <div><b>${esc(b.label)}</b>${b.detail ? `<p>${esc(b.detail)}</p>` : b.state === "unknown" ? `<p>המודעה לא מציינת</p>` : b.state === "pending" ? `<p>ממתין להערכת AI (בסבב הסריקה הבא)</p>` : ""}</div>
        <span class="imp">${IMPORTANCE[b.imp].label}</span></div>`).join("")}</div>
    </div>
    <div class="dsec"><h3>פרטים</h3><dl class="kv">${kv.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
      ${featTxt ? `<p style="margin-top:12px">${esc(featTxt)}</p>` : ""}</div>

    ${(l.priceHistory?.length ?? 0) > 1 ? `<div class="dsec"><h3>היסטוריית מחיר</h3><div class="hist">${l.priceHistory.map(h => `<div><span class="num">${fmtPrice(h.price)}</span> <span class="dim">· ${new Date(h.at).toLocaleDateString("he-IL")}</span></div>`).join("")}</div></div>` : ""}
    <div class="dsec"><h3>פורסם ב-${(l.links ?? []).length || 1} מקומות</h3><div class="links">${(l.links ?? [{ source: l.source, url: l.url }]).map(k => `<a class="btn sm" href="${esc(k.url)}" target="_blank">${esc(SOURCE_TYPES[k.source]?.label ?? k.source)}${icon("external", "sm")}</a>`).join("")}</div></div>
    <div class="dsec"><h3>הערות שלי</h3><textarea rows="4" style="width:100%" data-note="${esc(l.id)}" placeholder="מה לשאול, מה ראיתי בביקור, מספר של השכן…">${esc(l.user?.note ?? "")}</textarea></div>
  `;
  $("#drawer").hidden = false;
  // "הצג את כל המודעה" רק אם הטקסט באמת נחתך
  const at = $("#adText");
  if (at && at.scrollHeight > at.clientHeight + 4) at.nextElementSibling.hidden = false;
  renderCounts();
}

function closeDrawer() { $("#drawer").hidden = true; }

/** מה שהמפרסם כתב במודעה, כמו שהוא. ביד 2 ובמדלן התיאור המלא מגיע רק אחרי שהסורק נכנס לעמוד המודעה. */
function adTextHtml(l) {
  const fromSite = l.source === "yad2" || l.source === "madlan";
  const hasFull = l.text && (!fromSite || l.enriched);
  const body = hasFull
    ? `<div class="fulltext clamp" id="adText">${esc(l.text.replace(/\s*…\s*עוד\s*$/, ""))}</div>
       <button class="btn sm ghost more-text" data-act="expandText" hidden>הצג את כל המודעה</button>`
    : `<p class="muted">התיאור המלא עוד לא נקרא מ${fromSite ? (l.source === "yad2" ? "יד 2" : "מדלן") : "המקור"} — הסורק יקרא אותו באחד הסבבים הקרובים.
       ${l.text ? `<br>מה שידוע כרגע: ${esc(l.text)}` : ""}</p>
       <a class="btn sm" href="${esc(l.url)}" target="_blank">${icon("external", "sm")}לקריאה באתר</a>`;
  return `<div class="dsec"><h3>מה כתוב במודעה</h3>${body}</div>`;
}

/** צפייה בתמונות במסך מלא — החלקה בין תמונות, סגירה ב-X / Esc. */
function openLightbox(images, start) {
  const lb = document.createElement("div");
  lb.className = "lightbox";
  lb.innerHTML = `<div class="lb-track">${images.map(src => `<div class="lb-slide"><img src="${esc(src)}" alt="" referrerpolicy="no-referrer"></div>`).join("")}</div>
    <button class="btn icon lb-x" aria-label="סגור">${icon("x")}</button>
    <div class="lb-count"><span>${start + 1}</span> / ${images.length}</div>`;
  document.body.append(lb);
  const track = lb.querySelector(".lb-track");
  const w = () => track.clientWidth;
  requestAnimationFrame(() => { track.scrollLeft = -start * w(); if (track.scrollLeft === 0 && start) track.scrollLeft = start * w(); });
  track.addEventListener("scroll", () => { lb.querySelector(".lb-count span").textContent = Math.round(Math.abs(track.scrollLeft) / w()) + 1; });
  const close = () => { lb.remove(); document.removeEventListener("keydown", key); };
  const key = e => {
    if (e.key === "Escape") close();
    if (e.key === "ArrowLeft") track.scrollBy({ left: -w(), behavior: "smooth" });
    if (e.key === "ArrowRight") track.scrollBy({ left: w(), behavior: "smooth" });
  };
  document.addEventListener("keydown", key);
  lb.querySelector(".lb-x").onclick = close;
}

/* ======================= פרופיל וקריטריונים ======================= */

function impSeg(c) {
  return `<div class="seg imp">${Object.entries(IMPORTANCE).map(([k, v]) =>
    `<button data-v="${k}" class="${c.imp === k ? "on" : ""}" data-cact="imp">${v.label}</button>`).join("")}</div>`;
}

const numIn = (c, f, ph = "") => `<input type="number" data-c="${c.id}" data-f="${f}" data-t="num" value="${c[f] ?? ""}" placeholder="${ph}">`;
const listVal = arr => (arr ?? []).join(", ");

function tiersHtml(c, key, cols) {
  const rows = c[key] ?? [];
  return `<div class="tier head"><span>שם</span><span>${cols.city ? "עיר" : ""}</span><span>מילים לזיהוי (מופרדות בפסיק)</span><span>ציון העדפה</span><span></span></div>
    ${rows.map((t, i) => `<div class="tier">
      <label class="tf tf-name"><span class="tl">${cols.city ? "אזור" : "סוג"}</span><input type="text" data-c="${c.id}" data-list="${key}" data-i="${i}" data-f="name" value="${esc(t.name)}"></label>
      ${cols.city ? `<label class="tf tf-city"><span class="tl">עיר</span><input type="text" data-c="${c.id}" data-list="${key}" data-i="${i}" data-f="city" value="${esc(t.city ?? "")}" placeholder="כל עיר"></label>` : "<span></span>"}
      <label class="tf tf-alias"><span class="tl">מילים לזיהוי</span><input type="text" data-c="${c.id}" data-list="${key}" data-i="${i}" data-f="aliases" data-t="list" value="${esc(listVal(t.aliases))}" placeholder="${cols.city ? "ריק = כל העיר" : ""}"></label>
      <label class="tf score"><span class="tl">העדפה</span><input type="range" min="0" max="100" step="5" data-c="${c.id}" data-list="${key}" data-i="${i}" data-f="score" data-t="num" value="${t.score}"><b class="num">${t.score}</b></label>
      <button class="btn icon sm ghost tier-del" data-cact="delTier" data-list="${key}" data-i="${i}" title="מחק">${icon("x", "sm")}</button>
    </div>`).join("")}
    <div><button class="btn sm" data-cact="addTier" data-list="${key}">${icon("plus", "sm")}הוסף ${cols.city ? "אזור" : "סוג"}</button></div>`;
}

function critBody(c) {
  switch (c.kind) {
    case "price": return `<div class="form-grid"><label class="field">מינימום ₪${numIn(c, "min", "ללא")}</label><label class="field">מקסימום ₪${numIn(c, "max", "ללא")}</label><label class="field">סבילות מעל התקרה %${numIn(c, "tolerancePct")}</label></div>`;
    case "rooms": return `<div class="form-grid"><label class="field">מינימום חדרים${numIn(c, "min", "ללא")}</label><label class="field">מקסימום חדרים${numIn(c, "max", "ללא")}</label></div>`;
    case "sqm": return `<div class="form-grid"><label class="field">מינימום מ״ר${numIn(c, "min", "ללא")}</label><label class="field">מקסימום מ״ר${numIn(c, "max", "ללא")}</label></div>`;
    case "ppsqm": return `<div class="form-grid"><label class="field">תקרת ₪ למ״ר${numIn(c, "max")}</label></div>`;
    case "floor": return `<div class="form-grid"><label class="field">מקומה${numIn(c, "min", "ללא")}</label><label class="field">עד קומה${numIn(c, "max", "ללא")}</label>
      <label class="check"><input type="checkbox" data-c="${c.id}" data-f="notGround" data-t="bool" ${c.notGround ? "checked" : ""}>לא קרקע</label>
      <label class="check"><input type="checkbox" data-c="${c.id}" data-f="notTop" data-t="bool" ${c.notTop ? "checked" : ""}>לא אחרונה</label></div>`;
    case "feature": return `<div class="form-grid"><label class="field">מאפיין<select data-c="${c.id}" data-f="feature">${Object.entries(FEATURES).map(([k, v]) => `<option value="${k}" ${c.feature === k ? "selected" : ""}>${v}</option>`).join("")}</select></label></div>`;
    case "broker": return "";
    case "location": return `${tiersHtml(c, "areas", { city: true })}
      <label class="field">להחריג (מילים שפוסלות, מופרדות בפסיק)<input type="text" data-c="${c.id}" data-f="exclude" data-t="list" value="${esc(listVal(c.exclude))}"></label>`;
    case "propertyType": return tiersHtml(c, "types", { city: false });
    case "keywords": return `<label class="field">שם<input type="text" data-c="${c.id}" data-f="label" value="${esc(c.label ?? "")}" placeholder="למשל: נוף / שקט"></label>
      <label class="field">מילים שרוצים לראות (מופרדות בפסיק; 2 ומעלה = ציון מלא)<textarea rows="2" data-c="${c.id}" data-f="want" data-t="list">${esc(listVal(c.want))}</textarea></label>
      <label class="field">מילים שפוסלות<input type="text" data-c="${c.id}" data-f="avoid" data-t="list" value="${esc(listVal(c.avoid))}"></label>`;
    case "ai": return `<label class="field">שם קצר (יופיע בכרטיס)<input type="text" data-c="${c.id}" data-f="label" value="${esc(c.label ?? "")}"></label>
      <label class="field">השאלה ל-Claude — תאר במילים שלך מה חשוב ומה נחשב 100 / 0<textarea rows="4" data-c="${c.id}" data-f="question">${esc(c.question ?? "")}</textarea></label>
      ${S.ai.apiKey ? "" : `<p class="dim">צריך מפתח API כדי שהשאלה תוערך. <a href="#settings">להגדרות</a></p>`}`;
  }
  return "";
}

function viewProfile() {
  if (!S.onboard?.profileReviewed) { S.onboard = { ...S.onboard, profileReviewed: true }; persist(); }
  const P = profile();
  const sc = scored();
  const nAbove = sc.filter(x => !x.s.mustFail && x.s.pct >= P.notifyThreshold).length;
  const nFail = sc.filter(x => x.s.mustFail).length;
  main.innerHTML = `
    <div class="view-head"><div class="grow"><h1>פרופיל וקריטריונים</h1>
      <p>כל פרופיל הוא חיפוש נפרד (למשל קנייה עכשיו, שכירות בהמשך). לכל קריטריון בוחרים עד כמה הוא חשוב; "חובה" שנכשל מוריד את הדירה לתחתית.</p></div>
      <span class="saved">נשמר ✓</span></div>
    <div class="ptabs">
      ${S.profiles.map(p => `<button class="btn sm ${p.id === P.id ? "primary" : ""}" data-pact="select" data-id="${p.id}">${esc(p.name)}</button>`).join("")}
      <select class="tpl-pick" data-pact-select="new" title="פרופיל חדש מתבנית"><option value="">+ פרופיל חדש…</option>${Object.entries(PROFILE_TEMPLATES).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join("")}</select>
      <button class="btn sm ghost" data-pact="dup">שכפל</button>
      <button class="btn sm ghost" data-pact="import">ייבוא</button>
      <button class="btn sm ghost" data-pact="export">ייצוא</button>
      ${S.profiles.length > 1 ? `<button class="btn sm ghost danger" data-pact="delete">מחק פרופיל</button>` : ""}
    </div>
    <section class="panel">
      <div class="form-grid">
        <label class="field">שם הפרופיל<input type="text" data-p="name" value="${esc(P.name)}"></label>
        <label class="field">סוג עסקה<select data-p="dealType"><option value="sale" ${P.dealType === "sale" ? "selected" : ""}>קנייה</option><option value="rent" ${P.dealType === "rent" ? "selected" : ""}>שכירות</option></select></label>
        <label class="field">התראה מעל <span class="num" id="thrVal">${P.notifyThreshold}%</span><input type="range" min="30" max="100" step="5" data-p="notifyThreshold" value="${P.notifyThreshold}"></label>
        <label class="check"><input type="checkbox" data-p="active" ${P.active ? "checked" : ""}>פעיל (נסרק ומתריע)</label>
      </div>
      <br><div class="dist">כרגע: <span><b class="num">${nAbove}</b> דירות מעל הסף</span><span><b class="num">${nFail}</b> נכשלות בחובה</span><span><b class="num">${sc.length}</b> רלוונטיות לסוג העסקה</span></div>
    </section>
    <div class="crits">${P.criteria.map(c => `
      <div class="crit-card ${c.imp}" data-cid="${c.id}">
        <div class="crit-top">
          <span class="kind">${esc(c.kind === "ai" || c.kind === "keywords" ? (c.label || CRITERION_KINDS[c.kind].label) : criterionLabel(c))}</span>
          ${c.kind === "ai" ? `<span class="chip accent">${icon("spark", "sm")}AI</span>` : ""}
          <span class="hint">${esc(CRITERION_KINDS[c.kind].hint)}</span>
          ${impSeg(c)}
          <button class="btn icon sm ghost" data-cact="delete" title="מחק קריטריון">${icon("trash", "sm")}</button>
        </div>
        ${c.imp === "off" ? "" : `<div class="crit-body">${critBody(c)}</div>`}
      </div>`).join("")}
    </div>
    <div class="add-crit"><span class="muted" style="align-self:center">הוסף קריטריון:</span>
      ${Object.entries(CRITERION_KINDS).map(([k, v]) => `<button class="btn sm" data-cact="add" data-kind="${k}">${icon("plus", "sm")}${v.label}</button>`).join("")}
    </div>`;
}

function critById(id) { return profile().criteria.find(c => c.id === id); }

function coerce(el) {
  const t = el.dataset.t;
  if (t === "bool") return el.checked;
  if (t === "num") return el.value === "" ? null : Number(el.value);
  if (t === "list") return el.value.split(/[,،\n]/).map(s => s.trim()).filter(Boolean);
  return el.value;
}

/* ======================= מקורות ======================= */

function viewSources() {
  const q = encodeURIComponent;
  main.innerHTML = `
    <div class="view-head"><div class="grow"><h1>מקורות</h1><p>כל עמוד כאן נפתח ברקע בטאב שקט (בקבוצת טאבים מקופלת בשם "סורק דירות") ונקרא כמו שאתה רואה אותו.</p></div><span class="saved">נשמר ✓</span></div>
    <section class="panel"><h2>הוספת מקור</h2>
      <p class="sub">הדרך הכי קלה: פותחים באתר חיפוש עם הסינון שרוצים (עיר, סוג נכס, מחיר), לוחצים על אייקון התוסף ובוחרים "הוסף עמוד זה כמקור". אפשר גם להדביק כתובת כאן.</p>
      <div class="row"><input type="url" id="newSrc" class="grow" placeholder="https://www.yad2.co.il/realestate/forsale?... / https://www.facebook.com/groups/..."><button class="btn primary" data-sact="add">הוסף</button></div>
      <br><div class="quick">
        <a class="btn sm" target="_blank" href="https://www.yad2.co.il/realestate/forsale?city=2500">יד 2: נשר למכירה</a>
        <a class="btn sm" target="_blank" href="https://www.madlan.co.il/for-sale/%D7%A0%D7%A9%D7%A8-%D7%99%D7%A9%D7%A8%D7%90%D7%9C">מדלן: נשר</a>
        <a class="btn sm" target="_blank" href="https://www.facebook.com/groups/search/groups/?q=${q("דירות למכירה נשר")}">חפש קבוצות: דירות למכירה נשר</a>
        <a class="btn sm" target="_blank" href="https://www.facebook.com/groups/search/groups/?q=${q("נדל\"ן חיפה והקריות")}">חפש קבוצות: נדל״ן חיפה והקריות</a>
        <a class="btn sm" target="_blank" href="https://www.facebook.com/groups/search/groups/?q=${q("יחידת דיור למכירה")}">חפש קבוצות: יחידת דיור</a>
        <a class="btn sm" target="_blank" href="https://www.facebook.com/marketplace/category/propertyforsale">מרקטפלייס: נכסים למכירה</a>
      </div>
    </section>
    <div class="src-list">${S.sources.map(s => {
      const st = srcState[s.id] ?? {};
      const err = st.lastError;
      const blocked = st.blockedUntil > Date.now();
      return `<div class="src ${s.enabled ? "" : "disabled"}" data-sid="${s.id}">
        <input type="checkbox" data-sf="enabled" ${s.enabled ? "checked" : ""} title="פעיל">
        <div class="meta">
          <div class="row"><span class="chip">${SOURCE_TYPES[s.type]?.label ?? s.type}</span><input type="text" class="grow" data-sf="name" value="${esc(s.name)}"></div>
          <a class="url" href="${esc(s.url)}" target="_blank">${esc(decodeURI(s.url))}</a>
          <span class="st ${err || blocked ? "err" : ""}">${st.lastScan ? `נסרק ${ago(st.lastScan)} · ${st.lastCount ?? 0} מודעות · ${st.lastNew ?? 0} חדשות${st.lastRaw !== undefined ? ` · ${st.lastRaw} פוסטים נקראו` : ""}` : "עוד לא נסרק"}${blocked ? " · מושהה: האתר ביקש אימות — פתח אותו ידנית פעם אחת" : ""}${err ? " · " + esc(err) : ""}</span>
        </div>
        <div class="ops">
          <select data-sf="dealType"><option value="sale" ${s.dealType === "sale" ? "selected" : ""}>קנייה</option><option value="rent" ${s.dealType === "rent" ? "selected" : ""}>שכירות</option></select>
          <button class="btn sm" data-sact="scan">${icon("sync", "sm")}סרוק</button>
          <button class="btn icon sm ghost danger" data-sact="delete" title="מחק">${icon("trash", "sm")}</button>
        </div>
      </div>`;
    }).join("") || `<div class="empty">אין מקורות</div>`}</div>`;
}

/* ======================= התראות ======================= */

const pathGet = p => p.split(".").reduce((o, k) => o?.[k], S);
function pathSet(p, v) {
  const ks = p.split(".");
  const last = ks.pop();
  ks.reduce((o, k) => (o[k] ??= {}), S)[last] = v;
}
const bind = (p, type = "text", attrs = "") => {
  const v = pathGet(p);
  if (type === "checkbox") return `<input type="checkbox" data-p2="${p}" data-t="bool" ${v ? "checked" : ""} ${attrs}>`;
  if (type === "number") return `<input type="number" data-p2="${p}" data-t="num" value="${v ?? ""}" ${attrs}>`;
  return `<input type="${type}" data-p2="${p}" value="${esc(v ?? "")}" ${attrs}>`;
};

function viewNotify() {
  const code = APPS_SCRIPT_CODE.replace("SECRET_HERE", S.notify.email.secret || "SECRET_HERE");
  main.innerHTML = `
    <div class="view-head"><div class="grow"><h1>התראות</h1><p>התראה נשלחת כשדירה חדשה עוברת את סף ההתאמה של פרופיל פעיל (מוגדר בפרופיל), כשיורד מחיר של דירה רלוונטית, וכשנמצאות שתי דירות באותו בניין.</p></div><span class="saved">נשמר ✓</span></div>

    <section class="panel"><h2>כללי</h2>
      <div class="form-grid">
        <label class="check">${bind("notify.priceDrop", "checkbox")}ירידות מחיר</label>
        <label class="field">ירידה מינימלית %${bind("notify.minDropPct", "number")}</label>
        <label class="check">${bind("notify.pairs", "checkbox")}שתי דירות באותו בניין</label>
      </div></section>

    <section class="panel"><h2>התראה במחשב</h2>
      <p class="sub">הודעה של Windows עם כפתורים "פתח מודעה" ו"שמור במועדפים".</p>
      <div class="row"><label class="check">${bind("notify.desktop", "checkbox")}פעיל</label><button class="btn sm" data-nact="test" data-ch="desktop">שלח בדיקה</button></div></section>

    <section class="panel"><h2>טלגרם (מומלץ — מגיע לטלפון עם תמונה וקישור)</h2>
      <ol class="steps">
        <li>בטלגרם, פתח שיחה עם <b>@BotFather</b>, שלח <b>/newbot</b> ותן שם (למשל "צייד הדירות שלי").</li>
        <li>הוא ישלח לך <b>token</b> — הדבק אותו כאן.</li>
        <li>פתח את הבוט החדש ושלח לו הודעה כלשהי (למשל "היי"), ואז לחץ "זהה אותי".</li>
      </ol>
      <div class="form-grid">
        <label class="field">Bot token${bind("notify.telegram.token", "password", 'autocomplete="off"')}</label>
        <label class="field">Chat ID${bind("notify.telegram.chatId")}</label>
        <div class="row"><button class="btn sm" data-nact="findChat">זהה אותי</button><button class="btn sm" data-nact="test" data-ch="telegram">שלח בדיקה</button></div>
        <label class="check">${bind("notify.telegram.enabled", "checkbox")}פעיל</label>
      </div></section>

    <section class="panel"><h2>מייל</h2>
      <p class="sub">נשלח מחשבון הג׳ימייל שלך דרך סקריפט קטן של גוגל (חינם, בלי שרת). הגדרה חד-פעמית של 3 דקות:</p>
      <ol class="steps">
        <li>היכנס ל-<a href="https://script.google.com/home/projects/create" target="_blank">script.google.com ← פרויקט חדש</a>.</li>
        <li>מחק את מה שכתוב שם והדבק את הקוד הזה (הסיסמה שבו כבר תואמת להגדרות כאן):</li>
      </ol>
      <pre class="code">${esc(code)}</pre>
      <div class="row"><button class="btn sm" data-nact="copyCode">${icon("copy", "sm")}העתק קוד</button><button class="btn sm ghost" data-nact="newSecret">צור סיסמה חדשה</button></div><br>
      <ol class="steps" start="3">
        <li>לחץ <b>Deploy ← New deployment ← Web app</b>. ב-"Execute as" בחר <b>Me</b>, וב-"Who has access" בחר <b>Anyone</b>. אשר הרשאות.</li>
        <li>העתק את ה-<b>Web app URL</b> והדבק למטה.</li>
      </ol>
      <div class="form-grid">
        <label class="field">Web app URL${bind("notify.email.url", "url")}</label>
        <label class="field">לשלוח אל${bind("notify.email.to", "text", 'placeholder="you@gmail.com"')}</label>
        <label class="field">מתי<select data-p2="notify.email.mode"><option value="digest" ${S.notify.email.mode === "digest" ? "selected" : ""}>סיכום יומי ב-20:00</option><option value="instant" ${S.notify.email.mode === "instant" ? "selected" : ""}>מיד</option></select></label>
        <div class="row"><label class="check">${bind("notify.email.enabled", "checkbox")}פעיל</label><button class="btn sm" data-nact="test" data-ch="email">שלח בדיקה</button></div>
      </div></section>`;
}

/* ======================= AI וכללי ======================= */

async function viewSettings() {
  const u = SC.aiUsage ?? { day: "", calls: 0, month: "", inTok: 0, outTok: 0, usd: 0 };
  const thisMonth = u.month === new Date().toISOString().slice(0, 7);
  const online = db.scannerOnline(SC);
  main.innerHTML = `
    <div class="view-head"><div class="grow"><h1>AI וכללי</h1></div><span class="saved">נשמר ✓</span></div>

    <section class="panel"><h2>הסורק במחשב</h2>
      <p class="sub">האפליקציה מציגה ומנהלת. את הסריקה עצמה עושה תוסף קטן ב-Chrome במחשב, כי רק דרכו אפשר לקרוא את פייסבוק עם החיבור שלך ולעבור את החסימות של יד 2. הוא סורק כשהמחשב דולק ו-Chrome פתוח (גם ממוזער), והכל מגיע לכאן ולנייד.</p>
      <p><span class="chip ${online ? "ok" : "fail"}">${online ? "מחובר" : SC.heartbeat ? `כבוי מאז ${ago(SC.heartbeat)}` : "עוד לא חובר"}</span>
        ${SC.version ? `<span class="dim">גרסה ${esc(SC.version)}</span>` : ""}</p>
      <details class="how" ${online ? "" : "open"}><summary>איך מתקינים את הסורק</summary>
      <ol class="steps" style="margin-top:12px">
        <li>הורד את תיקיית התוסף (<b>extension</b> מתוך תיקיית הפרויקט במחשב).</li>
        <li>ב-Chrome, היכנס ל-<b>chrome://extensions</b>, הפעל <b>Developer mode</b> (למעלה בצד) ולחץ <b>Load unpacked</b> ← בחר את התיקייה.</li>
        <li>לחץ על אייקון הבית הכתום בסרגל ← התחבר עם אותו אימייל וסיסמה של האפליקציה.</li>
        <li>ודא שאתה מחובר לפייסבוק באותו Chrome, ושנכנסת פעם אחת ליד 2 ולמדלן כרגיל.</li>
      </ol></details>
    </section>

    <section class="panel"><h2>Claude — קריאת פוסטים ושאלות חופשיות</h2>
      <p class="sub">משמש לשני דברים: קריאת פוסטים בטקסט חופשי מפייסבוק (מחיר, חדרים, שכונה…) והערכת השאלות החופשיות בפרופיל (כמו "שתי יחידות" ו"נגישות").</p>
      <div class="form-grid">
        <label class="field">דרך<select data-p2="ai.provider">
          <option value="subscription" ${(S.ai.provider ?? "subscription") === "subscription" ? "selected" : ""}>המנוי שלי ל-Claude (דרך Claude Code במחשב) — בלי עלות נוספת</option>
          <option value="api" ${S.ai.provider === "api" ? "selected" : ""}>מפתח API (תשלום לפי שימוש)</option>
        </select></label>
        <label class="field">מודל<select data-p2="ai.model">${Object.entries(MODELS).map(([k, v]) => `<option value="${k}" ${S.ai.model === k ? "selected" : ""}>${v.label.replace(/ — .*/, "")}${k === "claude-haiku-4-5" ? " (מומלץ, הכי חסכוני)" : ""}</option>`).join("")}</select></label>
        <label class="field">תקרת קריאות ביום${bind("ai.dailyCap", "number")}</label>
        <label class="check">${bind("ai.enabled", "checkbox")}פעיל</label>
      </div>
      ${(S.ai.provider ?? "subscription") === "subscription"
        ? `<p style="margin-top:12px"><span class="chip ${SC.aiHost?.ok ? "ok" : "fail"}">${SC.aiHost?.ok ? `מחובר · ${esc(SC.aiHost.version ?? "")}` : SC.aiHost ? "לא מחובר" : "עוד לא נבדק"}</span>
            ${SC.aiHost && !SC.aiHost.ok ? `<span class="dim">${esc(SC.aiHost.error ?? "")}</span>` : ""}</p>
           <p class="dim" style="margin-top:8px">עובד דרך Claude Code שמותקן במחשב שבו רץ הסורק, על המנוי הקיים. נספר במגבלת השימוש הרגילה של המנוי (כמה עשרות קריאות קצרות ביום). התקנה חד-פעמית של הגשר: <b>node native/install.mjs</b> בתיקיית הפרויקט.</p>`
        : `<div class="form-grid" style="margin-top:12px"><label class="field">מפתח API${bind("ai.apiKey", "password", 'autocomplete="off" placeholder="sk-ant-..."')}</label></div>
           <p class="dim" style="margin-top:6px">מפתח יוצרים ב-<a href="https://platform.claude.com/settings/keys" target="_blank">platform.claude.com</a>. חיוב נפרד מהמנוי.</p>`}
      <br><div class="row"><button class="btn sm" data-gact="testAi">בדוק חיבור</button><button class="btn sm" data-gact="evalNow">${icon("spark", "sm")}הערך עכשיו מודעות שממתינות</button>
        <span class="muted">היום: <span class="num">${u.day === new Date().toISOString().slice(0, 10) ? u.calls : 0}</span> קריאות${S.ai.provider === "api" ? ` · החודש: כ-$<span class="num">${thisMonth ? u.usd.toFixed(2) : "0.00"}</span>` : " · ללא עלות (מנוי)"}</span></div>
      <p class="dim" id="aiResult" style="margin-top:8px"></p>
    </section>

    <section class="panel"><h2>סריקה</h2>
      <p class="sub">הסריקה רצה ברקע כל עוד Chrome פתוח (גם ממוזער). פייסבוק נסרק לאט יותר בכוונה, כדי לא לסכן את החשבון.</p>
      <div class="form-grid">
        <label class="field">יד 2 / מדלן: כל כמה דקות${bind("scan.intervalMin", "number", 'min="10"')}</label>
        <label class="field">פייסבוק: כל כמה דקות${bind("scan.fbIntervalMin", "number", 'min="30"')}</label>
        <label class="field">עמודי תוצאות לכל מקור${bind("scan.pagesPerSource", "number", 'min="1" max="5"')}</label>
        <label class="field">גלילות בכל קבוצת פייסבוק${bind("scan.fbScrolls", "number", 'min="1" max="20"')}</label>
        <label class="field">כמה מודעות להעשיר בכל סבב${bind("scan.enrichMax", "number")}</label>
        <label class="field">למחוק מודעות שלא נראו X ימים${bind("scan.keepDays", "number")}</label>
        <label class="check">${bind("scan.quietEnabled", "checkbox")}שעות שקטות</label>
        <label class="field">מ-${bind("scan.quietFrom", "time")}</label>
        <label class="field">עד${bind("scan.quietTo", "time")}</label>
        <label class="check">${bind("scan.paused", "checkbox")}השהה את כל הסריקות</label>
      </div></section>

    <section class="panel"><h2>מימון</h2>
      <p class="sub">להצגת החזר חודשי משוער בכל דירה (שפיצר, הערכה בלבד).</p>
      <div class="form-grid">
        <label class="field">הון עצמי ₪${bind("finance.equity", "number")}</label>
        <label class="field">ריבית שנתית %${bind("finance.rate", "number", 'step="0.1"')}</label>
        <label class="field">שנים${bind("finance.years", "number")}</label>
      </div></section>

    <section class="panel"><h2>הודעת פנייה לוואטסאפ</h2>
      <p class="sub">משתנים: {מיקום} {חדרים} {מחיר} {קישור}</p>
      <textarea rows="3" style="width:100%" data-p2="messageTemplate">${esc(S.messageTemplate)}</textarea></section>

    <section class="panel"><h2>גיבוי והעברה</h2>
      <p class="sub">ייצוא של כל ההגדרות, הפרופילים והמודעות (כולל מועדפים והערות). מפתחות וסיסמאות לא נכללים. אפשר לייבא במחשב אחר, או לתת למישהו אחר רק פרופיל (מסך הפרופיל ← ייצוא).</p>
      <div class="row"><button class="btn sm" data-gact="export">ייצוא גיבוי</button><button class="btn sm" data-gact="import">ייבוא גיבוי</button><button class="btn sm ghost danger" data-gact="wipe">מחק את כל המודעות</button></div></section>

    <section class="panel"><h2>התקנה בנייד ובמחשב</h2>
      <p class="sub"><b>אייפון:</b> פתח את הכתובת הזו ב-Safari ← כפתור השיתוף ← "הוסף למסך הבית".<br>
      <b>אנדרואיד:</b> ב-Chrome ← תפריט ⋮ ← "התקנת אפליקציה".<br>
      <b>מחשב:</b> ב-Chrome, אייקון ההתקנה בשורת הכתובת.</p></section>

    <section class="panel"><h2>חשבון</h2>
      <div class="row"><span class="muted grow">מחובר: <span id="whoSettings">${esc($("#who").textContent)}</span></span><button class="btn sm" data-gact="logout">התנתק</button></div></section>`;
}

/* ======================= עוד (נייד) ======================= */

function viewMore() {
  const online = db.scannerOnline(SC);
  const item = (href, ic, title, sub) => `<a class="more-item" href="${href}">${icon(ic)}<span class="grow"><b>${title}</b>${sub ? `<small>${sub}</small>` : ""}</span>${icon("chevron", "sm")}</a>`;
  main.innerHTML = `
    <div class="view-head"><div class="grow"><h1>עוד</h1></div></div>
    <section class="panel scanner-card">
      <span class="chip ${online ? "ok" : "fail"}">${online ? "הסורק במחשב פעיל" : SC.heartbeat ? `הסורק במחשב כבוי מאז ${ago(SC.heartbeat)}` : "הסורק במחשב עוד לא חובר"}</span>
      ${SC.lastRun ? `<p class="muted">סריקה אחרונה ${ago(SC.lastRun.at)} · ${SC.lastRun.new ?? 0} חדשות</p>` : ""}
    </section>
    <nav class="more-list">
      ${item("#sources", "source", "מקורות", `${S.sources.filter(s => s.enabled).length} פעילים`)}
      ${item("#notify", "bell", "התראות", S.notify.telegram.enabled ? "טלגרם מחובר" : "")}
      ${item("#settings", "settings", "AI וכללי", "")}
      ${item("#log", "log", "יומן סריקות", "")}
    </nav>
    <p class="dim more-who">מחובר: ${esc($("#who").textContent)} · <a href="#" data-gact="logout">התנתק</a></p>`;
}

/* ======================= יומן ======================= */

async function viewLog() {
  const rows = await db.recentLog(400);
  main.innerHTML = `<div class="view-head"><div class="grow"><h1>יומן סריקות</h1><p>מה נסרק, כמה נמצא ואילו שגיאות היו. אם מקור מחזיר 0 מודעות שוב ושוב — זה המקום לבדוק.</p></div></div>
    <section class="panel log">${rows.map(r => `<div><time>${new Date(r.at).toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time><span class="${r.level}">${esc(r.msg)}</span></div>`).join("") || "<p class='dim'>ריק</p>"}</section>`;
}

/* ======================= אירועים ======================= */

main.addEventListener("click", async e => {
  const t = e.target.closest("[data-act],[data-cact],[data-pact],[data-sact],[data-nact],[data-gact]");
  const cardEl = e.target.closest(".card");
  if (!t) {
    if (cardEl && !e.target.closest("select,a,button,input")) openDrawer(cardEl.dataset.id);
    return;
  }
  e.stopPropagation();
  if (t.tagName === "SELECT") return; // שינוי סטטוס מטופל ב-change
  const d = t.dataset;
  if (d.act) return listingAction(d.act, t, t.closest("[data-id]")?.dataset.id);
  if (d.cact) return critAction(d.cact, t);
  if (d.pact) return profileAction(d.pact, t);
  if (d.sact) return sourceAction(d.sact, t);
  if (d.nact) return notifyAction(d.nact, t);
  if (d.gact) return generalAction(d.gact, t);
});

$("#drawer").addEventListener("click", e => {
  if (e.target.closest("[data-close]")) return closeDrawer();
  const z = e.target.closest("[data-zoom]");
  if (z) return openLightbox([...$("#drawer").querySelectorAll(".gallery img")].map(i => i.src), Number(z.dataset.zoom));
  if (e.target.closest("[data-act=expandText]")) { $("#adText").classList.remove("clamp"); e.target.closest("button").hidden = true; return; }
  const t = e.target.closest("[data-act]");
  if (t && t.tagName !== "SELECT") listingAction(t.dataset.act, t, t.closest("[data-id]")?.dataset.id, true);
});
$("#drawer").addEventListener("change", e => {
  const t = e.target.closest("[data-act=status]");
  if (t) listingAction("status", t, t.closest("[data-id]")?.dataset.id, true);
});
$("#drawer").addEventListener("input", e => {
  const id = e.target.dataset.note;
  if (!id) return;
  clearTimeout(e.target._t);
  e.target._t = setTimeout(async () => {
    const l = L.find(x => x.id === id);
    if (l) l.user = { ...l.user, note: e.target.value };
    await db.updateUser(id, { note: e.target.value });
  }, 400);
});
document.addEventListener("keydown", e => { if (e.key === "Escape") closeDrawer(); });

async function listingAction(act, el, id, inDrawer = false) {
  if (act === "scanNow") return scanNow();
  if (act === "dismissOnboard") { S.onboard = { ...S.onboard, dismissed: true }; await persist(true); return route(); }
  if (act === "toggleSrc") {
    const v = el.dataset.v;
    UI.sources = UI.sources.includes(v) ? UI.sources.filter(x => x !== v) : [...UI.sources, v];
    saveUi(); return route();
  }
  if (act === "clearFilters") { Object.assign(UI, { maxPrice: "", minRooms: "", nb: "", ptype: "", sources: [], onlyNew: false }); saveUi(); return route(); }
  if (act === "toggleFilters") { UI.filtersOpen = !UI.filtersOpen; saveUi(); return route(); }
  if (act === "markAllSeen") {
    const ids = L.filter(l => !l.user?.seen).map(l => l.id);
    for (const id of ids) { await db.updateUser(id, { seen: true }); L.find(l => l.id === id).user.seen = true; }
    renderCounts(); return route();
  }
  const l = L.find(x => x.id === id);
  if (!l) return;
  const upd = async patch => { l.user = { ...l.user, ...patch }; await db.updateUser(id, patch); };
  if (act === "fav") await upd({ fav: !l.user?.fav, seen: true });
  if (act === "hide") await upd({ hidden: !l.user?.hidden, seen: true });
  if (act === "status") await upd({ status: el.value, seen: true, fav: el.value !== "new" && el.value !== "rejected" ? true : l.user?.fav });
  if (act === "open") { await upd({ seen: true }); window.open(l.url, "_blank"); }
  if (act === "wa") { await upd({ seen: true }); window.open(waLink(l), "_blank"); }
  renderCounts();
  if (inDrawer) { if (act === "hide") closeDrawer(); else openDrawer(id); }
  const [view] = (location.hash.slice(1) || "listings").split("/");
  if (["listings", "favorites", "pairs"].includes(view) && act !== "open" && act !== "wa") {
    const y = main.scrollTop; route(); main.scrollTop = y;
  }
}

main.addEventListener("change", e => {
  const t = e.target;
  if (t.dataset.pactSelect) return profileAction("new", t);
  if (t.matches(".card [data-act=status]")) return listingAction("status", t, t.closest("[data-id]").dataset.id);
  if (t.dataset.ui) {
    UI[t.dataset.ui] = t.type === "checkbox" ? t.checked : t.type === "range" ? Number(t.value) : t.value;
    saveUi(); route();
  }
  if (t.dataset.sf) sourceField(t);
  if (t.dataset.p2 && (t.type === "checkbox" || t.tagName === "SELECT")) settingField(t);
  if (t.dataset.p && (t.type === "checkbox" || t.tagName === "SELECT")) profileField(t);
  if (t.dataset.c && (t.type === "checkbox" || t.tagName === "SELECT")) critField(t);
});

main.addEventListener("input", e => {
  const t = e.target;
  if (t.dataset.ui === "minScore") { t.nextElementSibling.textContent = t.value + "%"; return; }
  if (t.type === "checkbox" || t.tagName === "SELECT") return;
  if (t.dataset.c) critField(t);
  if (t.dataset.p) profileField(t);
  if (t.dataset.p2) settingField(t);
  if (t.dataset.sf === "name") sourceField(t);
});

function critField(t) {
  const c = critById(t.dataset.c);
  if (!c) return;
  const v = coerce(t);
  if (t.dataset.list) {
    c[t.dataset.list][Number(t.dataset.i)][t.dataset.f] = v;
    if (t.dataset.f === "score") t.nextElementSibling.textContent = v;
  } else c[t.dataset.f] = v;
  persist();
}

function profileField(t) {
  const P = profile();
  const f = t.dataset.p;
  P[f] = t.type === "checkbox" ? t.checked : f === "notifyThreshold" ? Number(t.value) : t.value;
  if (f === "notifyThreshold") $("#thrVal").textContent = t.value + "%";
  if (f === "name" || f === "active") renderProfileSel();
  persist();
}

function settingField(t) {
  pathSet(t.dataset.p2, coerce(t));
  persist();
  if (t.dataset.p2 === "ai.provider") { persist(true); viewSettings(); return; }
  if (t.dataset.p2 === "notify.email.secret") route();
}

function sourceField(t) {
  const s = S.sources.find(x => x.id === t.closest("[data-sid]").dataset.sid);
  if (!s) return;
  s[t.dataset.sf] = t.type === "checkbox" ? t.checked : t.value;
  persist();
  if (t.type === "checkbox") t.closest(".src").classList.toggle("disabled", !t.checked);
  renderCounts();
}

async function critAction(act, t) {
  const P = profile();
  const card = t.closest("[data-cid]");
  const c = card && critById(card.dataset.cid);
  if (act === "add") {
    const nc = newCriterion(t.dataset.kind);
    if (nc.kind === "location") nc.areas = [{ name: "", city: "", aliases: [], score: 100 }];
    if (nc.kind === "propertyType") nc.types = [{ name: "", aliases: [], score: 100 }];
    P.criteria.push(nc);
  }
  if (act === "delete" && c) {
    if (!confirm(`למחוק את הקריטריון "${criterionLabel(c)}"?`)) return;
    P.criteria = P.criteria.filter(x => x !== c);
  }
  if (act === "imp" && c) c.imp = t.dataset.v;
  if (act === "addTier" && c) c[t.dataset.list].push(t.dataset.list === "areas" ? { name: "", city: "", aliases: [], score: 70 } : { name: "", aliases: [], score: 70 });
  if (act === "delTier" && c) c[t.dataset.list].splice(Number(t.dataset.i), 1);
  await persist(true);
  const y = main.scrollTop;
  viewProfile();
  main.scrollTop = y;
  if (act === "add") main.querySelector(".crit-card:last-child input, .crit-card:last-child textarea")?.focus();
}

async function profileAction(act, t) {
  if (act === "select") UI.profileId = t.dataset.id;
  if (act === "new") {
    const p = PROFILE_TEMPLATES[t.value]?.make();
    if (!p) return;
    S.profiles.push(p); UI.profileId = p.id;
  }
  if (act === "dup") {
    const src = profile();
    const p = structuredClone(src);
    p.id = uid("p"); p.name = src.name + " (עותק)";
    p.criteria = p.criteria.map(c => ({ ...c, id: uid() }));
    S.profiles.push(p); UI.profileId = p.id;
  }
  if (act === "delete") {
    if (!confirm(`למחוק את הפרופיל "${profile().name}"?`)) return;
    S.profiles = S.profiles.filter(p => p.id !== UI.profileId);
    UI.profileId = S.profiles[0].id;
  }
  if (act === "export") return download(`פרופיל-${profile().name}.json`, { type: "apt-hunter-profile", profile: profile() });
  if (act === "import") {
    const j = await pickFile().catch(() => null);
    const p = j?.profile ?? (j?.criteria ? j : null);
    if (!p) return toast("הקובץ לא נראה כמו פרופיל", true);
    p.id = uid("p"); p.criteria = (p.criteria ?? []).map(c => ({ ...c, id: uid() }));
    S.profiles.push(p); UI.profileId = p.id;
    toast("הפרופיל יובא");
  }
  saveUi();
  await persist(true);
  renderProfileSel();
  viewProfile();
  renderCounts();
}

async function sourceAction(act, t) {
  if (act === "add") {
    const url = $("#newSrc").value.trim();
    const type = detectSourceType(url);
    if (!type) return toast("הכתובת לא נתמכת. נתמך: חיפוש ביד 2 / מדלן, קבוצת פייסבוק, מרקטפלייס.", true);
    const clean = url.split("#")[0];
    if (S.sources.some(x => x.url === clean)) return toast("המקור כבר קיים");
    let tail = "";
    try { tail = decodeURIComponent(new URL(clean).pathname).split("/").filter(Boolean).slice(-1)[0] ?? ""; } catch {}
    S.sources.push({ id: uid("s"), type, enabled: true, url: clean, dealType: dealTypeFromUrl(clean) ?? profile()?.dealType ?? "sale",
      name: `${SOURCE_TYPES[type].label} — ${tail}` });
    await persist(true);
    toast("נוסף. הוא ייסרק בסבב הקרוב של הסורק");
    renderCounts();
    return viewSources();
  }
  const id = t.closest("[data-sid]").dataset.sid;
  if (act === "delete") {
    if (!confirm("למחוק את המקור? המודעות שכבר נאספו יישארו.")) return;
    S.sources = S.sources.filter(s => s.id !== id);
    await persist(true);
    viewSources(); renderCounts();
  }
  if (act === "scan") scanNow([id]);
}

async function notifyAction(act, t) {
  if (act === "test") {
    await persist(true);
    if (!db.scannerOnline(SC)) return toast("ההתראות נשלחות מהסורק במחשב, והוא לא מחובר כרגע", true);
    toast("שולח דרך הסורק במחשב…");
    const r = await db.command("testNotify", { channel: t.dataset.ch }, { wait: true });
    toast(r?.ok ? "נשלח" : r?.error ?? "שגיאה", !r?.ok);
  }
  if (act === "findChat") {
    await persist(true);
    let chat = null;
    try {
      const j = await (await fetch(`https://api.telegram.org/bot${S.notify.telegram.token}/getUpdates`)).json();
      if (!j.ok) return toast(`טלגרם: ${j.description ?? "token לא תקין"}`, true);
      const m = [...j.result].reverse().find(u => u.message?.chat?.id)?.message;
      chat = m && { id: String(m.chat.id), name: m.chat.first_name ?? m.chat.title ?? "" };
    } catch (e) { return toast("טלגרם: " + e.message, true); }
    if (!chat) return toast("לא נמצאה הודעה. שלח לבוט הודעה ונסה שוב.", true);
    S.notify.telegram.chatId = chat.id; S.notify.telegram.enabled = true;
    await persist(true);
    toast(`זוהה: ${chat.name}`);
    viewNotify();
  }
  if (act === "copyCode") {
    await navigator.clipboard.writeText(APPS_SCRIPT_CODE.replace("SECRET_HERE", S.notify.email.secret || "SECRET_HERE"));
    toast("הקוד הועתק");
  }
  if (act === "newSecret") {
    S.notify.email.secret = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
    await persist(true);
    toast("נוצרה סיסמה — העתק את הקוד מחדש לסקריפט");
    viewNotify();
  }
}

async function generalAction(act) {
  if (act === "testAi") {
    await persist(true);
    if (!db.scannerOnline(SC)) return toast("הבדיקה רצה בסורק במחשב, והוא לא מחובר כרגע", true);
    $("#aiResult").textContent = "בודק דרך הסורק במחשב…";
    const r = await db.command("testAi", {}, { wait: true });
    $("#aiResult").textContent = r?.ok
      ? `עובד. Claude קרא את פוסט הבדיקה: ${r.result.summary} · ${r.result.rooms} חד׳ · ${r.result.city ?? ""} ${r.result.neighborhood ?? ""} · ₪${(r.result.price ?? 0).toLocaleString("he-IL")}`
      : `שגיאה: ${r?.error}`;
  }
  if (act === "evalNow") {
    if (!db.scannerOnline(SC)) return toast("ההערכה רצה בסורק במחשב, והוא לא מחובר כרגע", true);
    toast("מעריך… זה יכול לקחת דקה-שתיים");
    const r = await db.command("evaluate", {}, { wait: true, timeout: 240e3 });
    toast(r?.ok ? `הוערכו ${r.result.evaluated} מודעות` : r?.error, !r?.ok);
    await refreshData();
  }
  if (act === "export") {
    const clean = structuredClone(S);
    clean.ai.apiKey = ""; clean.notify.telegram.token = ""; clean.notify.email.secret = "";
    download(`צייד-הדירות-גיבוי-${new Date().toISOString().slice(0, 10)}.json`, { type: "apt-hunter-backup", settings: clean, listings: L });
  }
  if (act === "import") {
    const j = await pickFile().catch(() => null);
    if (j?.type !== "apt-hunter-backup") return toast("קובץ גיבוי לא תקין", true);
    if (!confirm(`לייבא ${j.listings?.length ?? 0} מודעות והגדרות? ההגדרות הנוכחיות יוחלפו (מפתחות נשמרים).`)) return;
    const keep = { apiKey: S.ai.apiKey, token: S.notify.telegram.token, secret: S.notify.email.secret };
    S = { ...j.settings };
    S.ai.apiKey ||= keep.apiKey; S.notify.telegram.token ||= keep.token; S.notify.email.secret ||= keep.secret;
    await persist(true);
    toast("מייבא…");
    await db.importListings(j.listings ?? []);
    await refreshData(); toast("יובא");
  }
  if (act === "logout") { await db.signOut(); location.hash = ""; location.reload(); }
  if (act === "wipe") {
    if (!confirm("למחוק את כל המודעות שנאספו (כולל מועדפים)? ההגדרות נשארות.")) return;
    await db.deleteListings(L.map(l => l.id));
    await refreshData(); toast("נמחק");
  }
}

/* ======================= סריקה וסטטוס ======================= */

async function scanNow(sourceIds) {
  if (!db.scannerOnline(SC)) toast("הסורק במחשב לא מחובר כרגע. הבקשה תחכה לו עד שעה.", true);
  else toast("הבקשה נשלחה לסורק במחשב");
  await db.command("scan", { sourceIds: sourceIds ?? null });
  scanning = true;
  paintStatus();
}

$("#scanBtn").addEventListener("click", () => scanNow());
$("#searchBtn").addEventListener("click", () => {
  const open = document.body.classList.toggle("search-open");
  if (open) $("#q").focus();
});
$("#profileSel").addEventListener("change", e => { UI.profileId = e.target.value; saveUi(); renderCounts(); route(); });
$("#q").addEventListener("input", e => {
  UI.q = e.target.value;
  clearTimeout(e.target._t);
  e.target._t = setTimeout(() => { if (!/^#(listings|favorites)?$/.test(location.hash || "#")) location.hash = "#listings"; else route(); }, 200);
});

async function refreshData() {
  try { L = await db.allListings(); } catch (e) { return toast("טעינה נכשלה: " + e.message, true); }
  buildAreaStats();
  renderCounts();
  const [view] = (location.hash.slice(1) || "listings").split("/");
  const editing = document.activeElement && main.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (["listings", "favorites", "pairs", "log"].includes(view) && !editing && $("#drawer").hidden) { const y = main.scrollTop; route(); main.scrollTop = y; }
  if (view === "sources" && !editing) viewSources();
}

function paintStatus() {
  const online = db.scannerOnline(SC);
  $("#scanDot").className = "scan-dot " + (online ? "on" : "off");
  $("#scanBtn").title = online ? "סרוק עכשיו" : "סרוק עכשיו (הסורק במחשב כבוי)";
  $("#scanBtn").classList.toggle("busy", scanning);
  $("#scanStatus").innerHTML = scanning
    ? `<span class="dot"></span>סורק…`
    : online
      ? (SC.lastRun ? `סריקה אחרונה ${ago(SC.lastRun.at)}` : "הסורק מחובר")
      : `<span class="off-dot"></span>${SC.heartbeat ? `הסורק במחשב כבוי מאז ${ago(SC.heartbeat)}` : "הסורק במחשב עוד לא חובר"}`;
}

async function pollStatus() {
  try { SC = await db.scanner(); } catch { return; }
  srcState = SC.srcState ?? {};
  scanning = !!SC.scanning && Date.now() - SC.scanning < 20 * 60e3;
  paintStatus();
  if (SC.lastRun?.at && SC.lastRun.at !== lastRunAt) {
    const first = lastRunAt === null;
    lastRunAt = SC.lastRun.at;
    if (!first) refreshData();
  }
}

/* ======================= התחברות והפעלה ======================= */

function authScreen(mode = "login", msg = "") {
  document.body.classList.add("auth-mode");
  main.innerHTML = `<div class="auth">
    <img src="icons/192.png" alt="">
    <h1>צייד הדירות</h1>
    <p class="muted">כל הדירות מיד 2, מדלן ופייסבוק במקום אחד, מדורגות לפי מה שחשוב לך.</p>
    <form id="authForm">
      <input type="email" name="email" placeholder="אימייל" autocomplete="username" required>
      <input type="password" name="password" placeholder="סיסמה (6 תווים לפחות)" autocomplete="${mode === "login" ? "current-password" : "new-password"}" minlength="6" required>
      <button class="btn primary" type="submit">${mode === "login" ? "כניסה" : "יצירת משתמש"}</button>
      <p class="auth-msg ${msg ? "show" : ""}">${esc(msg)}</p>
    </form>
    <p class="dim">${mode === "login" ? `אין משתמש? <a href="#signup">הרשמה</a>` : `כבר יש משתמש? <a href="#login">כניסה</a>`}</p>
  </div>`;
  $("#authForm").onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      if (mode === "login") await db.signIn(f.get("email"), f.get("password"));
      else {
        const r = await db.signUp(f.get("email"), f.get("password"));
        // המשתמש מאושר אוטומטית במסד (טריגר), אז מתחברים מיד גם אם Supabase ביקש אימות מייל
        if (r.needsConfirm) {
          try { await db.signIn(f.get("email"), f.get("password")); }
          catch { return authScreen("login", "נשלח אליך מייל אימות. אחרי האישור — היכנס כאן."); }
        }
      }
      location.hash = "";
      boot();
    } catch (err) {
      btn.disabled = false;
      const m = /invalid login/i.test(err.message) ? "אימייל או סיסמה שגויים"
        : /already registered/i.test(err.message) ? "המשתמש כבר קיים — היכנס"
        : /not confirmed/i.test(err.message) ? "צריך לאשר את המייל קודם (בדוק את תיבת הדואר)" : err.message;
      $(".auth-msg").textContent = m;
      $(".auth-msg").classList.add("show");
    }
  };
}

function firstRun() {
  main.innerHTML = `<div class="auth wide">
    <h1>מאיפה מתחילים?</h1>
    <p class="muted">בחר תבנית, ואחר כך אפשר לשנות בה הכל: אזורים, תקציב, מה חובה ומה רק נחמד, ושאלות חופשיות ל-AI.</p>
    <div class="tpl">${Object.entries(PROFILE_TEMPLATES).map(([k, t]) => `<button class="btn" data-tpl="${k}">${esc(t.label)}</button>`).join("")}</div>
  </div>`;
  main.querySelectorAll("[data-tpl]").forEach(b => b.onclick = async () => {
    const s = defaultSettings();
    s.profiles = [PROFILE_TEMPLATES[b.dataset.tpl].make()];
    s.sources = b.dataset.tpl === "twoGen" ? defaultSources() : [];
    await db.saveSettings(s);
    location.hash = "#profile";
    boot();
  });
}

let liveSub = null, pollTimer = null;
async function boot() {
  if (!db.configured()) {
    main.innerHTML = `<div class="empty"><h2>האפליקציה עוד לא מחוברת לענן</h2><p>חסרים פרטי Supabase ב-build/config.json.</p></div>`;
    return;
  }
  db.init();
  const u = await db.user();
  const [view] = location.hash.slice(1).split("/");
  if (!u) return authScreen(view === "signup" ? "signup" : "login");
  S = await db.getSettings();
  if (!S) { document.body.classList.add("auth-mode"); return firstRun(); }
  document.body.classList.remove("auth-mode");
  if (view === "signup" || view === "login") history.replaceState(null, "", location.pathname);
  $("#who").textContent = u.email;
  await loadAll();
  try { SC = await db.scanner(); } catch {}
  srcState = SC.srcState ?? {};
  lastRunAt = SC.lastRun?.at ?? null;
  scanning = !!SC.scanning && Date.now() - SC.scanning < 20 * 60e3;
  route();
  paintStatus();
  refreshData();
  liveSub ??= db.live(() => refreshData());
  pollTimer ??= setInterval(pollStatus, 15000);
}

document.addEventListener("visibilitychange", () => { if (!document.hidden && S) { pollStatus(); refreshData(); } });
window.addEventListener("hashchange", () => {
  const [v] = location.hash.slice(1).split("/");
  if (document.body.classList.contains("auth-mode")) { if (v === "signup" || v === "login") authScreen(v); return; }
  if (S) route();
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
boot();
