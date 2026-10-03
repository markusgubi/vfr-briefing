// VFR-Briefing 9.9 - Cloudflare Worker
// Jede Anfrage laeuft zuerst durch die Passwort-Anmeldung (src/auth.js, Secret APP_PASSWORD).
// Danach: API-Routen /test | /cfg | GET /awx?bbox= | GET /dem/z/x/y.png | GET /sat/{ir|nat}/z/x/y.png | GET /sat/caps,
// alles andere aus public/ (Static Assets).
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

// ---------- Satellitenbild (EUMETSAT WMS) als Kachel, 5 min Cache ----------
// Ueber den eigenen Server, damit der Browser die Bildpunkte umfaerben darf (Wolken weiss, wolkenfrei durchsichtig).
const SAT_WMS = "https://view.eumetsat.int/geoserver/ows";
const SAT_LAYERS = { ir: "msg_fes:ir108", nat: "msg_fes:rgb_naturalenhncd" };
async function handleSat(p, ctx) {
  const m = p.match(/^\/sat\/(ir|nat)\/(\d{1,2})\/(\d{1,5})\/(\d{1,5})\.png$/);
  if (!m) return jr({ error: "Kachel ungueltig" }, 400);
  const z = +m[2], x = +m[3], y = +m[4], n = 1 << z;
  if (z > 9 || x >= n || y >= n) return jr({ error: "Kachel ungueltig" }, 400);
  const R = 20037508.342789244, sz = 2 * R / n;
  const bbox = [-R + x * sz, R - (y + 1) * sz, -R + (x + 1) * sz, R - y * sz].map(v => v.toFixed(1)).join(",");
  const slot = Math.floor(Date.now() / 300000);   /* neues Bild hoechstens alle 5 min */
  const cache = caches.default, key = new Request("https://vfr7-cache.internal/sat/" + m[1] + "/" + slot + "/" + z + "/" + x + "/" + y);
  const hit = await cache.match(key);
  if (hit) return hit;
  const u = SAT_WMS + "?service=WMS&version=1.3.0&request=GetMap&layers=" + encodeURIComponent(SAT_LAYERS[m[1]]) +
    "&styles=&crs=EPSG:3857&bbox=" + bbox + "&width=256&height=256&format=image/png&transparent=true";
  const r = await fetch(u);
  const ct = r.headers.get("content-type") || "";
  if (!r.ok || ct.indexOf("image") < 0) return jr({ error: "EUMETSAT HTTP " + r.status }, 502);
  const res = new Response(await r.arrayBuffer(), { headers: { "Content-Type": ct, "Cache-Control": "public, max-age=300", ...CORS } });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}
/* Welche Satellitenebenen bietet EUMETSAT gerade an (6 h Cache) */
async function handleSatCaps(ctx) {
  const cache = caches.default, key = new Request("https://vfr7-cache.internal/satcaps");
  const hit = await cache.match(key);
  if (hit) return hit;
  let txt = "";
  try { const r = await fetch(SAT_WMS + "?service=WMS&version=1.3.0&request=GetCapabilities"); if (r.ok) txt = await r.text(); } catch (e) {}
  const out = {};
  /* null = unbekannt (EUMETSAT nicht erreicht): Auswahl bleibt, Kachelfehler zeigen dann einen Hinweis */
  Object.keys(SAT_LAYERS).forEach(k => { out[k] = txt ? txt.indexOf("<Name>" + SAT_LAYERS[k] + "</Name>") >= 0 : null; });
  const res = new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json;charset=utf-8", "Cache-Control": "public, max-age=" + (txt ? 21600 : 300) } });
  if (txt) ctx.waitUntil(cache.put(key, res.clone()));
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
  await probe("Satellitenbild EUMETSAT (IR 10.8)", () => fetch(SAT_WMS + "?service=WMS&version=1.3.0&request=GetMap&layers=msg_fes:ir108&styles=&crs=EPSG:3857&bbox=1252344.3,5948635.3,1878516.4,6574807.4&width=64&height=64&format=image/png"));
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const allOk = rows.every(r => r.ok) && !!key;
  let html = "<!DOCTYPE html><html lang=\"de\"><meta charset=\"utf-8\"><title>VFR 9.9 Diagnose</title><body style=\"font-family:monospace;max-width:900px;margin:40px auto;line-height:1.6\">";
  html += "<h2>VFR 9.9 &middot; Diagnose</h2>";
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
    if (p === "/sat/caps") return handleSatCaps(ctx);
    if (p.indexOf("/sat/") === 0) return handleSat(p, ctx);
    return env.ASSETS.fetch(request);   /* Oberflaeche aus public/ */
  }
};

