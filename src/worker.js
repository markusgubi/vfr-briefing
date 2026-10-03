// VFR-Briefing 9.2 - Cloudflare Worker
// Jede Anfrage laeuft zuerst durch die Passwort-Anmeldung (src/auth.js, Secret APP_PASSWORD).
// Danach: API-Routen /test | /cfg | GET /awx?bbox= | GET /dem/z/x/y.png, alles andere aus public/ (Static Assets).
// openAIP und Open-Meteo fragt der Browser direkt ab (eigene IP -> kein Rate-Limit durch geteilte Cloudflare-IPs)
// Secrets: OPENAIP_KEY, APP_PASSWORD
import { guard } from "./auth.js";

const AWX = "https://aviationweather.gov/api/data/";
const DEM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

function jr(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json;charset=utf-8", ...CORS } });
}
function oaipKey(env) { return env && typeof env.OPENAIP_KEY === "string" ? env.OPENAIP_KEY.trim() : ""; }

// ---------- METAR/TAF im Gebiet (bbox = minLat,minLon,maxLat,maxLon), 8 min Cache ----------
async function handleAwx(url, ctx) {
  const bb = (url.searchParams.get("bbox") || "").split(",").map(Number);
  if (bb.length !== 4 || !bb.every(Number.isFinite)) return jr({ error: "bbox=minLat,minLon,maxLat,maxLon" }, 400);
  const [a, b, c, d] = bb.map(v => Math.round(v * 10) / 10);
  if (c <= a || d <= b || c - a > 12 || d - b > 16) return jr({ error: "bbox zu gross" }, 400);
  const bbox = [a, b, c, d].join(",");
  const cache = caches.default, key = new Request("https://vfr7-cache.internal/awx/" + bbox);
  const hit = await cache.match(key);
  if (hit) return hit;
  let metar = [], taf = [];
  try { const r = await fetch(AWX + "metar?bbox=" + bbox + "&format=json"); if (r.ok) metar = await r.json(); } catch (e) {}
  try { const r = await fetch(AWX + "taf?bbox=" + bbox + "&format=json"); if (r.ok) taf = await r.json(); } catch (e) {}
  const res = new Response(JSON.stringify({ metar: Array.isArray(metar) ? metar : [], taf: Array.isArray(taf) ? taf : [] }),
    { headers: { "Content-Type": "application/json;charset=utf-8", "Cache-Control": "public, s-maxage=480", ...CORS } });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

// ---------- Gelaende-Kacheln (AWS Terrain Tiles), 30 Tage Cache ----------
async function handleDem(p, ctx) {
  const m = p.match(/^\/dem\/(\d{1,2})\/(\d{1,5})\/(\d{1,5})\.png$/);
  if (!m) return jr({ error: "Kachel ungueltig" }, 400);
  const z = +m[1], x = +m[2], y = +m[3], n = 1 << z;
  if (z > 12 || x >= n || y >= n) return jr({ error: "Kachel ungueltig" }, 400);
  const cache = caches.default, key = new Request("https://vfr7-cache.internal/dem/" + z + "/" + x + "/" + y);
  const hit = await cache.match(key);
  if (hit) return hit;
  const r = await fetch(DEM_URL + z + "/" + x + "/" + y + ".png");
  if (!r.ok) return jr({ error: "DEM HTTP " + r.status }, r.status);
  const res = new Response(await r.arrayBuffer(), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=2592000", ...CORS } });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

// ---------- Diagnose ----------
async function handleTest(env) {
  const rows = [], key = oaipKey(env);
  async function probe(name, fn) {
    const t0 = Date.now();
    try {
      const r = await fn(), ct = r.headers.get("content-type") || "";
      const txt = ct.indexOf("image") >= 0 ? "(Bild, " + (await r.arrayBuffer()).byteLength + " Bytes)" : (await r.text()).slice(0, 220);
      rows.push({ name, ok: r.ok, status: r.status, ms: Date.now() - t0, txt });
    } catch (e) { rows.push({ name, ok: false, status: 0, ms: Date.now() - t0, txt: String(e && e.message || e) }); }
  }
  await probe("Gelaendekachel (AWS Terrain Tiles)", () => fetch(DEM_URL + "10/551/355.png"));
  await probe("AviationWeather METAR (Raum Linz)", () => fetch(AWX + "metar?bbox=48.0,13.8,48.5,14.5&format=json"));
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const allOk = rows.every(r => r.ok) && !!key;
  let html = "<!DOCTYPE html><html lang=\"de\"><meta charset=\"utf-8\"><title>VFR 9.2 Diagnose</title><body style=\"font-family:monospace;max-width:900px;margin:40px auto;line-height:1.6\">";
  html += "<h2>VFR 9.2 &middot; Diagnose</h2>";
  html += "<p>Secret OPENAIP_KEY: <b style=\"color:" + (key ? "green" : "crimson") + "\">" + (key ? "gesetzt (" + key.length + " Zeichen)" : "FEHLT") + "</b></p>";
  html += "<p>Secret APP_PASSWORD (Anmeldung): <b style=\"color:" + (env.APP_PASSWORD ? "green" : "crimson") + "\">" + (env.APP_PASSWORD ? "gesetzt" : "FEHLT") + "</b></p>";
  html += "<p>openAIP und Open-Meteo werden direkt im Browser abgefragt und hier nicht getestet.</p>";
  rows.forEach(r => { html += "<p><b>" + esc(r.name) + "</b>: HTTP <b style=\"color:" + (r.ok ? "green" : "crimson") + "\">" + (r.status || "-") + "</b> &middot; " + r.ms + " ms</p><pre style=\"background:#f4f4f4;padding:10px;white-space:pre-wrap\">" + esc(r.txt) + "</pre>"; });
  html += "<p style=\"color:" + (allOk ? "green" : "crimson") + "\"><b>" + (allOk ? "Alle Quellen OK." : "Mindestens eine Quelle liefert keine Daten.") + "</b></p></body></html>";
  return new Response(html, { headers: { "Content-Type": "text/html;charset=utf-8" } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url), p = url.pathname;
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const blocked = await guard(request, env);   /* nicht angemeldet -> Anmeldeseite bzw. 401 */
    if (blocked) return blocked;
    if (p === "/login") return new Response(null, { status: 303, headers: { Location: "/" } });
    if (request.method !== "GET" && request.method !== "HEAD") return jr({ error: "Not found" }, 404);
    if (p === "/test") return handleTest(env);
    if (p === "/cfg") return new Response(JSON.stringify({ oaipKey: oaipKey(env) }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    if (p === "/awx") return handleAwx(url, ctx);
    if (p.indexOf("/dem/") === 0) return handleDem(p, ctx);
    return env.ASSETS.fetch(request);   /* Oberflaeche aus public/ */
  }
};

