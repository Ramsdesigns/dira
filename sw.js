/* sw.js — שומר את קבצי האפליקציה לפתיחה מהירה ובלי רשת. הנתונים עצמם תמיד מהענן (לא נשמרים כאן). */
const VERSION = "20260927211555";
const SHELL = ["./", "index.html", "app.js", "app.css", "ui.css", "manifest.webmanifest",
  "lib/store.js", "lib/cloud.js", "lib/config.js", "lib/model.js", "lib/score.js", "lib/text.js",
  "vendor/supabase.js", "icons/192.png", "icons/48.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// קבצי האפליקציה: רשת קודם (כדי לקבל עדכונים), מטמון כגיבוי כשאין רשת
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request).then(r => r ?? caches.match("index.html"))),
  );
});
