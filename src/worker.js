// VFR-Briefing v7.5 - Cloudflare Worker
// Endpunkte: / | /test | /cfg | GET /awx?bbox= | GET /dem/z/x/y.png
// openAIP und Open-Meteo fragt der Browser direkt ab (eigene IP -> kein Rate-Limit durch geteilte Cloudflare-IPs)
// Secret: OPENAIP_KEY

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
  if (c <= a || d <= b || c - a > 6 || d - b > 8) return jr({ error: "bbox zu gross" }, 400);
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
  let html = "<!DOCTYPE html><html lang=\"de\"><meta charset=\"utf-8\"><title>VFR v7.3 Diagnose</title><body style=\"font-family:monospace;max-width:900px;margin:40px auto;line-height:1.6\">";
  html += "<h2>VFR v7.3 &middot; Diagnose</h2>";
  html += "<p>Secret OPENAIP_KEY: <b style=\"color:" + (key ? "green" : "crimson") + "\">" + (key ? "gesetzt (" + key.length + " Zeichen)" : "FEHLT") + "</b></p>";
  html += "<p>openAIP und Open-Meteo werden direkt im Browser abgefragt und hier nicht getestet.</p>";
  rows.forEach(r => { html += "<p><b>" + esc(r.name) + "</b>: HTTP <b style=\"color:" + (r.ok ? "green" : "crimson") + "\">" + (r.status || "-") + "</b> &middot; " + r.ms + " ms</p><pre style=\"background:#f4f4f4;padding:10px;white-space:pre-wrap\">" + esc(r.txt) + "</pre>"; });
  html += "<p style=\"color:" + (allOk ? "green" : "crimson") + "\"><b>" + (allOk ? "Alle Quellen OK." : "Mindestens eine Quelle liefert keine Daten.") + "</b></p></body></html>";
  return new Response(html, { headers: { "Content-Type": "text/html;charset=utf-8" } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url), p = url.pathname;
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "GET") return jr({ error: "Not found" }, 404);
    if (p === "/test") return handleTest(env);
    if (p === "/cfg") return new Response(JSON.stringify({ oaipKey: oaipKey(env) }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    if (p === "/awx") return handleAwx(url, ctx);
    if (p.indexOf("/dem/") === 0) return handleDem(p, ctx);
    if (p === "/") return new Response(HTML, { headers: { "Content-Type": "text/html;charset=utf-8" } });
    return jr({ error: "Not found" }, 404);
  }
};

// =====================================================================
// OBERFLAECHE (v7.3)
// =====================================================================
const HTML = String.raw`<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#1F5FA8">
<title>VFR Briefing v7.5</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<style>
*{box-sizing:border-box}
html,body{margin:0;height:100%;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#0F1D2A;font-size:14px;background:#F2F5F8}
body{display:flex}
#side{width:440px;flex:none;height:100%;overflow-y:auto;padding:14px 16px 40px;border-right:1px solid #E1E7EC}
#main{flex:1;position:relative;height:100%;min-width:0}
#map{position:absolute;top:0;right:0;bottom:0;left:0}
h1{font-size:19px;margin:0}
h1 em{color:#B02E7A;font-style:normal}
.sub{font-size:11px;color:#61717F;margin:2px 0 8px}
label{display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#61717F;margin:9px 0 3px}
label.chk{display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-size:13px;color:#0F1D2A;margin-top:12px;cursor:pointer}
label.chk input{width:auto;height:auto;margin:0}
input,select{width:100%;height:36px;border:1px solid #CBD5DD;border-radius:6px;padding:0 9px;font:inherit;background:#fff;color:#0F1D2A}
input:focus,select:focus{outline:none;border-color:#1F5FA8;box-shadow:0 0 0 3px rgba(31,95,168,.15)}
input.ok{border-color:#1F7A4C;background:#F1FAF4}
.row{display:flex;gap:8px}
.row>div{flex:1;min-width:0}
.acw{position:relative}
.ac{display:none;position:absolute;top:100%;left:0;right:0;z-index:2000;background:#fff;border:1px solid #1F5FA8;border-radius:6px;max-height:280px;overflow:auto;box-shadow:0 6px 16px rgba(0,0,0,.15)}
.ac div{padding:6px 10px;cursor:pointer;border-bottom:1px solid #EEF2F5;font-size:13px}
.ac div:hover{background:#E3EDF5}
.ac b{display:inline-block;min-width:48px;color:#1F5FA8}
.ac small{color:#61717F}
details.adv{margin-top:10px}
details.adv summary{cursor:pointer;color:#1F5FA8;font-size:12.5px}
.btn{margin-top:14px;width:100%;height:42px;border:0;border-radius:7px;background:#1F5FA8;color:#fff;font:inherit;font-weight:700;cursor:pointer}
.btn:disabled{opacity:.5;cursor:default}
.btn2{height:32px;padding:0 10px;border:1px solid #1F5FA8;border-radius:6px;background:#fff;color:#1F5FA8;font:inherit;font-size:12.5px;cursor:pointer}
#sts{margin-top:10px;font-size:12.5px;color:#61717F;min-height:1.2em}
#sts.err{color:#C0392B;font-weight:600}
.card{background:#fff;border:1px solid #E1E7EC;border-radius:10px;padding:11px 13px;margin-top:12px;box-shadow:0 1px 2px rgba(15,29,42,.05)}
.card h3{margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:#61717F}
.verdict{border-radius:10px;padding:12px 14px;margin-top:12px;color:#fff}
.verdict.ok{background:#1F7A4C}.verdict.warn{background:#C1810B}.verdict.bad{background:#C0392B}
.verdict .big{font-size:19px;font-weight:800}
.verdict .meta{font-size:12px;margin-top:3px;opacity:.95}
.why{font-size:12.5px;line-height:1.5;background:#F4F7FA;border-radius:8px;padding:8px 10px;margin-top:8px}
.why p{margin:0 0 4px}
.ropt{display:grid;grid-template-columns:1fr auto;gap:2px 8px;padding:8px 10px;border:1px solid #E1E7EC;border-radius:8px;margin-top:6px;cursor:pointer;border-left-width:5px;background:#fff}
.ropt.sel{border-color:#1F5FA8;box-shadow:0 0 0 2px rgba(31,95,168,.18)}
.ropt b{font-size:13px}
.ropt small{color:#61717F;font-size:11.5px;grid-column:1/-1}
.tag{font-size:10.5px;font-weight:700;padding:1px 6px;border-radius:3px;color:#fff;white-space:nowrap}
.tag.ok{background:#1F7A4C}.tag.warn{background:#C1810B}.tag.bad{background:#C0392B}
.hint{font-size:12.5px;padding:6px 9px;border-radius:6px;margin:5px 0;border-left:4px solid;line-height:1.45}
.hint.bad{background:#FBECEA;border-color:#C0392B}
.hint.warn{background:#FDF4E3;border-color:#C1810B}
.hint.info{background:#EEF3F8;border-color:#1F5FA8}
.hint.ok{background:#EAF6EF;border-color:#1F7A4C}
.hint small{color:#61717F}
.hint.clk{cursor:pointer}
.hint.clk:hover{box-shadow:0 0 0 2px rgba(31,95,168,.3)}
.hint.act{box-shadow:0 0 0 2px #0F1D2A}
table.nav{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}
table.nav th{font-size:10px;color:#61717F;font-weight:600;text-align:right;padding:3px 4px;border-bottom:1px solid #E1E7EC}
table.nav td{text-align:right;padding:4px 4px;border-bottom:1px solid #F0F3F6}
table.nav th:first-child,table.nav td:first-child{text-align:left}
.opt{display:flex;gap:3px;align-items:flex-end;height:78px;margin:4px 0 18px}
.opt div{flex:1;border-radius:3px 3px 0 0;cursor:pointer;position:relative;min-width:10px}
.opt div span{position:absolute;bottom:-16px;left:50%;transform:translateX(-50%);font-size:9.5px;color:#61717F}
.opt div.cur{outline:2px solid #0F1D2A;outline-offset:1px}
.mono{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;background:#F4F6F8;border-radius:4px;padding:5px 7px;white-space:pre-wrap;word-break:break-word;margin-top:4px}
.kv{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:12.5px}
.kv>span{color:#61717F}
.note{font-size:11px;color:#61717F;margin-top:12px;line-height:1.5}
.btnrow{display:flex;gap:6px;flex-wrap:wrap}
#legend{position:absolute;top:10px;left:10px;z-index:1000;background:#fff;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.18);font-size:11.5px;padding:7px 10px;line-height:1.6;max-width:240px}
#legend i{display:inline-block;width:11px;height:11px;border-radius:2px;margin-right:6px;vertical-align:-1px}
#legend select{height:28px;font-size:12px}
#legend label{margin:6px 0 2px}
#prof{position:absolute;left:10px;right:10px;bottom:22px;z-index:1000;background:#fff;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,.2);display:none}
#profHead{display:flex;justify-content:space-between;align-items:center;padding:5px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#61717F;cursor:pointer;user-select:none}
#profBody{padding:0 8px 6px}
#prof.min #profBody{display:none}
#profBody svg{width:100%;height:auto;display:block}
.pop{font-size:12px;min-width:250px}
.pop b.h{font-size:13.5px}
.pop table{border-collapse:collapse;margin-top:4px;font-size:11.5px;width:100%}
.pop td{padding:1px 6px 1px 0;vertical-align:top}
.pop td:first-child{color:#61717F;white-space:nowrap}
.pop .mt td{border-top:1px solid #EEF2F5}
.asr{padding:5px 0;border-top:1px solid #EEF2F5}
.asr i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}
.asr small{color:#61717F}
#legend.col .lg{display:none}
.navwrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
#mnav,#mchip{display:none}
@media(max-width:860px){
  html,body{height:100%;max-width:100%;overflow:hidden}
  body{display:block}
  .pane{position:fixed;left:0;right:0;top:0;bottom:calc(58px + env(safe-area-inset-bottom));overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;background:#F2F5F8;display:none;padding:calc(10px + env(safe-area-inset-top)) 12px 28px}
  .pane.on{display:block}
  #main.pane{padding:0;overflow:hidden;height:auto}
  #side.pane{width:auto;height:auto;border:0}
  #mnav{display:flex;position:fixed;left:0;right:0;bottom:0;height:calc(58px + env(safe-area-inset-bottom));padding-bottom:env(safe-area-inset-bottom);background:#fff;border-top:1px solid #E1E7EC;z-index:3000}
  #mnav button{flex:1;border:0;background:none;font:inherit;font-size:11px;color:#61717F;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:0}
  #mnav button b{font-size:20px;line-height:1;font-weight:400}
  #mnav button.on{color:#1F5FA8;font-weight:700}
  #mnav button:disabled{opacity:.35}
  #mchip{display:block;position:absolute;left:50%;transform:translateX(-50%);top:calc(10px + env(safe-area-inset-top));z-index:1100;border-radius:20px;padding:7px 14px;color:#fff;font-weight:700;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.25);white-space:nowrap;max-width:74%;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
  #mchip:empty{display:none}
  #legend{top:calc(56px + env(safe-area-inset-top));max-width:220px;font-size:11px;padding:6px 8px}
  #prof{position:static;display:block;box-shadow:none;border:1px solid #E1E7EC;border-radius:10px;background:#fff}
  #profHead{display:none}
  #profBody{overflow-x:auto;-webkit-overflow-scrolling:touch;padding:6px}
  #profBody svg{width:1100px;max-width:none}
  input,select{font-size:16px;height:44px}
  .btn{height:50px;font-size:16px}
  .btn2{height:42px;font-size:14px;flex:1 1 45%}
  .hint{font-size:14px}
  .kv{font-size:13.5px}
  .ropt small{font-size:12.5px}
  .leaflet-control-zoom a{width:38px;height:38px;line-height:38px}
  .card{margin-top:10px}
}
@media print{
  body{display:block;background:#fff}
  #side{width:100%;height:auto;overflow:visible;border:0}
  #map,#legend,.noprint{display:none!important}
  #main{position:static;height:auto}
  #prof{position:static;display:block!important;box-shadow:none}
  #prof.min #profBody{display:block}
  .card{break-inside:avoid}
}
</style>
</head>
<body>
<div id="side">
  <h1>VFR <em>&#9656;</em> Route &amp; Wetter</h1>
  <div class="sub">v7.5 &middot; sicherste Route aus 5 Wettermodellen, Gel&auml;nde, Luftraum und METAR/TAF</div>
  <div class="noprint">
    <label>Von</label>
    <div class="acw"><input id="fIn" placeholder="ICAO oder Name, z.B. LOLW" autocomplete="off"><div class="ac" id="fAc"></div></div>
    <label>Nach</label>
    <div class="acw"><input id="tIn" placeholder="ICAO oder Name, z.B. LOWZ" autocomplete="off"><div class="ac" id="tAc"></div></div>
    <div class="row">
      <div><label>Datum</label><input id="dDate" type="date"></div>
      <div><label>Abflug (lokal)</label><input id="dTime" type="time"></div>
    </div>
    <div class="row">
      <div><label>Reise-TAS (kt)</label><input id="tas" type="number" value="100" min="50" max="250"></div>
      <div><label>Max. H&ouml;he (ft MSL)</label><input id="maxAlt" type="number" value="12500" min="3000" max="13000" step="500"></div>
    </div>
    <label class="chk"><input type="checkbox" id="avoidClr"> Freigabepflichtige Lufträume meiden</label>
    <details class="adv"><summary>Erweiterte Einstellungen</summary>
      <div class="row">
        <div><label>Min. Gel&auml;ndeabstand (ft)</label><input id="terrClr" type="number" value="1000" min="500" max="3000" step="100"></div>
        <div><label>Min. Wolkenabstand (ft)</label><input id="cloudClr" type="number" value="1000" min="500" max="3000" step="100"></div>
      </div>
      <div class="row">
        <div><label>Wunschh&ouml;he &uuml;b. Gel&auml;nde (ft)</label><input id="prefAgl" type="number" value="2000" min="1000" max="5000" step="100"></div>
        <div><label>Steigen / Sinken (ft/min)</label>
          <div class="row"><div><input id="climb" type="number" value="500" min="200" max="2000" step="50"></div><div><input id="desc" type="number" value="500" min="200" max="2000" step="50"></div></div></div>
      </div>
    </details>
    <button class="btn" id="go">Sicherste Route berechnen</button>
  </div>
  <div id="sts"></div>
  <div id="out"></div>
  <div class="note"><b>Entscheidungshilfe &ndash; kein Ersatz f&uuml;r amtliches Flugwetter-Briefing, NOTAM, GAFOR und AIP.</b>
  Wetter: Open-Meteo (ICON, AROME, ECMWF, UKMO, GFS); Wolkenbasis aus Feuchteprofil (950&ndash;700&thinsp;hPa), R&uuml;ckfall Taupunktdifferenz. METAR/TAF: NOAA AviationWeather. Gel&auml;nde: AWS Terrain Tiles (+150&thinsp;ft Puffer). Luftraum &amp; Flugpl&auml;tze: openAIP (Community-Daten, nicht amtlich). <b>Tempor&auml;re NOTAM-Beschr&auml;nkungen sind nicht enthalten.</b> Abstand zu Lufträumen 1&thinsp;NM seitlich, 300&thinsp;ft vertikal. Kurse magnetisch, Missweisung 5&deg;&thinsp;O.</div>
</div>
<div id="main">
  <div id="map"></div>
  <div id="mchip"></div>
  <div id="legend" class="noprint"><div id="lgT" style="font-weight:700;cursor:pointer;user-select:none">Legende &amp; Filter <span id="lgA">&#9662;</span></div><div class="lg">
    <div><i style="background:#C0392B"></i>Verboten (R / P / Klasse A)</div>
    <div><i style="background:#E67E22"></i>Gefahren-/Aktivierungsgebiet</div>
    <div><i style="background:#1F5FA8"></i>Freigabepflichtig (CTR, B/C/D)</div>
    <div><i style="background:#8E44AD"></i>TMZ / RMZ</div>
    <div><i style="background:#7F8C8D"></i>Sonstiges</div>
    <div><i style="border:2px dashed #444;background:none;width:9px;height:9px"></i>zeitweise aktiv</div>
    <label>Anzeigen bis Untergrenze</label>
    <select id="asFilter">
      <option value="10000">10.000 ft</option>
      <option value="15000" selected>15.000 ft</option>
      <option value="19500">FL 195</option>
      <option value="0">alle</option>
    </select>
    <div style="font-size:10.5px;color:#61717F;margin-top:4px">Klick in die Karte: alle Lufträume an diesem Punkt</div></div>
  </div>
  <div id="prof"><div id="profHead"><span>Vertikalprofil</span><span id="profTgl">&#9660;</span></div><div id="profBody"></div></div>
</div>
<nav id="mnav"><button data-p="side" class="on"><b>&#9998;</b>Planen</button><button data-p="main"><b>&#128506;</b>Karte</button><button data-p="pProf" disabled><b>&#9968;</b>Profil</button><button data-p="pRes" disabled><b>&#9776;</b>Ergebnis</button></nav>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script>
"use strict";
/* ==================== 1. Konstanten & Helfer ==================== */
var RAD = Math.PI / 180, R_NM = 3440.065, M2FT = 3.28084;
var MAGVAR = 5;
var MODELS = [
  { id: "icon_seamless", l: "ICON (DWD)" },
  { id: "meteofrance_seamless", l: "AROME (M\u00e9t\u00e9o-France)" },
  { id: "ecmwf_ifs025", l: "ECMWF IFS" },
  { id: "ukmo_seamless", l: "UKMO (Met Office)" },
  { id: "gfs_seamless", l: "GFS (NOAA)" }
];
var PL = [950, 925, 850, 800, 700];
var HOURLY = ["temperature_2m", "dew_point_2m", "cloud_cover_low", "cloud_cover_mid", "visibility",
  "precipitation", "cape", "wind_gusts_10m", "wind_speed_850hPa", "wind_direction_850hPa"]
  .concat(PL.map(function (p) { return "relative_humidity_" + p + "hPa"; }))
  .concat(PL.map(function (p) { return "geopotential_height_" + p + "hPa"; }));
var CAT_TXT = ["GUT", "EINGESCHR.", "KRITISCH"], CAT_CLS = ["ok", "warn", "bad"], CAT_COL = ["#1F7A4C", "#D08A0C", "#C0392B"];
var S = { from: null, to: null }, RES = null, STN = [];

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function p2(n) { return String(n).padStart(2, "0"); }
function fmtH(min) { var m = Math.round(min); m = ((m % 1440) + 1440) % 1440; return p2(Math.floor(m / 60)) + ":" + p2(m % 60); }
function deg3(x) { var v = Math.round(((x % 360) + 360) % 360); if (v === 0) v = 360; return String(v).padStart(3, "0"); }
function fmtFt(x) { return isFinite(x) ? String(Math.round(x / 50) * 50) : "\u2013"; }
function fmtVis(k) { if (k == null) return "\u2013"; return k >= 10 ? "\u226510 km" : (k < 1 ? Math.round(k * 1000) + " m" : k.toFixed(1).replace(".", ",") + " km"); }
function minN(a, b) { return a == null ? b : b == null ? a : Math.min(a, b); }
function maxN(a, b) { return a == null ? b : b == null ? a : Math.max(a, b); }
function avg(a) { return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : null; }
function clampNum(v, lo, hi, def) { v = parseFloat(v); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def; }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function setSts(html, cls) { var e = $("sts"); e.innerHTML = html; e.className = cls || ""; }
function catTag(c) { return "<span class='tag " + CAT_CLS[c] + "'>" + CAT_TXT[c] + "</span>"; }
function normTxt(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
async function fetchJSON(url, tries) {
  tries = tries || 4;
  for (var k = 0; k < tries; k++) {
    var r = await fetch(url);
    if (r.status === 429 && k < tries - 1) {
      var w = 5 * Math.pow(2, k);
      setSts("Datenquelle kurz ausgelastet \u2013 neuer Versuch in " + w + " s \u2026");
      await sleep(w * 1000); continue;
    }
    var j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error((j && (j.error || j.reason)) || ("HTTP " + r.status));
    return j;
  }
}

/* ==================== 2. Geometrie ==================== */
function distNm(a, b) {
  var dp = (b.lat - a.lat) * RAD, dl = (b.lon - a.lon) * RAD;
  var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}
function courseDeg(a, b) {
  var dl = (b.lon - a.lon) * RAD;
  var y = Math.sin(dl) * Math.cos(b.lat * RAD);
  var x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos(dl);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}
function lerp(a, b, f) { return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f }; }
function offsetPt(p, brg, nm) {
  return { lat: p.lat + nm * Math.cos(brg * RAD) / 60, lon: p.lon + nm * Math.sin(brg * RAD) / (60 * Math.cos(p.lat * RAD)) };
}
function segDist(p, a, b) {
  var kx = 60 * Math.cos(p.lat * RAD), ky = 60;
  var ax = (a.lon - p.lon) * kx, ay = (a.lat - p.lat) * ky, bx = (b.lon - p.lon) * kx, by = (b.lat - p.lat) * ky;
  var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  var t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
  var x = ax + t * dx, y = ay + t * dy;
  return { d: Math.sqrt(x * x + y * y), t: t };
}

/* ==================== 3. Karte & Luftraum ==================== */
var map = L.map("map", { zoomControl: false }).setView([47.6, 13.8], 8);
L.control.zoom({ position: "topright" }).addTo(map);
L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
  maxZoom: 15, subdomains: "abc",
  attribution: "Karte: &copy; OpenStreetMap, SRTM | Stil: &copy; OpenTopoMap (CC-BY-SA) | Luftraum: openAIP"
}).addTo(map);
var cvs = L.canvas({ padding: 0.3 });
var airLayer = L.layerGroup().addTo(map), routeLayer = L.layerGroup().addTo(map), hlLayer = L.layerGroup().addTo(map);

var TYPE_TXT = {0:"Sonstiges",1:"Flugbeschr\u00e4nkungsgebiet (R)",2:"Gefahrengebiet (D)",3:"Sperrgebiet (P)",
  4:"CTR",5:"TMZ",6:"RMZ",7:"TMA",8:"TRA",9:"TSA",10:"FIR",11:"UIR",12:"ADIZ",13:"ATZ",14:"MATZ",
  15:"Airway",16:"MTR",17:"Alert Area",18:"Warning Area",19:"Schutzgebiet",20:"HTZ",21:"Segelflugsektor",
  22:"TRP",23:"TIZ",24:"TIA",25:"MTA",26:"CTA",27:"ACC-Sektor",28:"Sport/Freizeit",29:"Tiefflugbeschr\u00e4nkung"};
var CLASS_TXT = {0:"A",1:"B",2:"C",3:"D",4:"E",5:"F",6:"G",8:"nicht klassifiziert"};
var KIND = {
  forbidden: { c: "#C0392B", t: "verboten" }, danger: { c: "#E67E22", t: "Gefahren-/Aktivierungsgebiet" },
  tra: { c: "#E67E22", t: "TRA/TSA (zeitweise aktiv)" }, clearance: { c: "#1F5FA8", t: "freigabepflichtig" }, tmz: { c: "#8E44AD", t: "TMZ" }, rmz: { c: "#8E44AD", t: "RMZ" },
  info: { c: "#7F8C8D", t: "Info" }
};
function classify(a) {
  var t = a.type, c = a.icaoClass;
  if (t === 10 || t === 11 || t === 15 || t === 27) return "ignore";
  if (c === 0 || t === 1 || t === 3) return "forbidden";
  if (t === 8 || t === 9) return "tra";
  if (t === 2) return "danger";
  if (t === 4 || c === 1 || c === 2 || c === 3) return "clearance";
  if (t === 5) return "tmz";
  if (t === 6) return "rmz";
  return "info";
}
function fmtLimit(l) {
  if (!l) return "?";
  if (l.unit === 6) return "FL " + l.value;
  if (l.value === 0 && l.referenceDatum === 0) return "GND";
  var u = l.unit === 1 ? "ft" : l.unit === 0 ? "m" : "?";
  var r = l.referenceDatum === 0 ? "AGL" : l.referenceDatum === 1 ? "MSL" : l.referenceDatum === 2 ? "STD" : "";
  return l.value + " " + u + " " + r;
}
function clsTxt(a) { return a.icaoClass != null && CLASS_TXT[a.icaoClass] ? "Klasse " + CLASS_TXT[a.icaoClass] : (TYPE_TXT[a.type] || "?"); }
function freqTxt(a) {
  if (a.freq && a.freq.length) return " \u2013 Frequenz " + a.freq.map(function (f) { return esc(f.v) + (f.n ? " (" + esc(f.n) + ")" : ""); }).join(", ");
  return " (Frequenz: ICAO-Karte/AIP)";
}
function actTxt(a) {
  var t = [];
  if (a.act.d) t.push("bei Bedarf aktiv"); if (a.act.r) t.push("auf Anfrage"); if (a.act.n) t.push("Aktivierung per NOTAM");
  if (!t.length && (a.type === 8 || a.type === 9)) t.push("zeitweise aktiv");
  return t.join(", ");
}
function geomBbox(g) {
  var bb = [180, 90, -180, -90];
  (function walk(c) {
    if (typeof c[0] === "number") { bb[0] = Math.min(bb[0], c[0]); bb[1] = Math.min(bb[1], c[1]); bb[2] = Math.max(bb[2], c[0]); bb[3] = Math.max(bb[3], c[1]); }
    else c.forEach(walk);
  })(g.coordinates);
  return bb;
}
function bbOverlap(a, b) { return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]); }
function pointInRing(lon, lat, ring) {
  var inside = false;
  for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function inPoly(rings, lon, lat) {
  if (!rings.length || !pointInRing(lon, lat, rings[0])) return false;
  for (var k = 1; k < rings.length; k++) if (pointInRing(lon, lat, rings[k])) return false;
  return true;
}
function inGeom(g, lon, lat) {
  if (g.type === "Polygon") return inPoly(g.coordinates, lon, lat);
  if (g.type === "MultiPolygon") return g.coordinates.some(function (p) { return inPoly(p, lon, lat); });
  return false;
}
function approxFt(l) { if (!l) return 0; var v = +l.value || 0; if (l.unit === 6) return v * 100; return l.unit === 0 ? v * M2FT : v; }
function limitFt(l, terrFt, qnh) {
  if (!l) return null;
  var v = +l.value; if (!isFinite(v)) return null;
  if (l.unit === 6) return v * 100 + (qnh - 1013.25) * 27;
  var f = l.unit === 0 ? v * M2FT : v;
  if (l.referenceDatum === 0) return terrFt + f;
  if (l.referenceDatum === 2) return f + (qnh - 1013.25) * 27;
  return f;
}

/* openAIP-Daten laenderweise (Export-Datei, im Worker 6 h zwischengespeichert) */
var CTRY = {
  AT: [[9.5, 46.3, 17.2, 49.1]], DE: [[5.8, 47.2, 13.0, 55.1], [13.0, 48.2, 13.9, 55.1], [13.9, 50.2, 15.1, 55.1]],
  CH: [[5.9, 45.8, 10.5, 47.9]], LI: [[9.47, 47.04, 9.64, 47.28]], IT: [[6.6, 43.5, 13.9, 47.1]], SI: [[13.3, 45.4, 16.6, 46.9]],
  CZ: [[12.0, 48.5, 18.9, 51.1]], SK: [[16.8, 47.7, 22.6, 49.6]], HU: [[16.1, 45.7, 22.9, 48.6]]
};
function countriesFor(w, s, e, n) {
  return Object.keys(CTRY).filter(function (c) { return CTRY[c].some(function (b) { return !(e < b[0] || w > b[2] || n < b[1] || s > b[3]); }); });
}
function rawList(j) {
  if (Array.isArray(j)) return j;
  if (j && Array.isArray(j.items)) return j.items;
  if (j && j.type === "FeatureCollection" && Array.isArray(j.features)) return j.features.map(function (f) {
    var o = {}, p = f.properties || {}; for (var k in p) o[k] = p[k]; o.geometry = f.geometry; return o;
  });
  return [];
}
function normAsp(a) {
  if (!a || !a.geometry || (a.geometry.type !== "Polygon" && a.geometry.type !== "MultiPolygon")) return null;
  var o = { id: a._id || a.id || (a.name + "|" + a.type + "|" + JSON.stringify(a.lowerLimit || "")), name: a.name || "?", type: a.type, icaoClass: a.icaoClass,
    lower: a.lowerLimit || a.lower, upper: a.upperLimit || a.upper, geometry: a.geometry, country: a.country || "",
    freq: Array.isArray(a.frequencies) ? a.frequencies.map(function (f) { return { v: f.value, n: f.name || "" }; }) : null,
    act: { d: !!a.onDemand, r: !!a.onRequest, n: !!a.byNotam } };
  o.kind = classify(o);
  if (o.kind === "ignore") return null;
  o.bb = geomBbox(o.geometry);
  o.loFt = approxFt(o.lower);
  o.temp = o.act.d || o.act.r || o.act.n || o.type === 8 || o.type === 9;
  return o;
}
function normApt(a) {
  if (!a || !a.geometry || !Array.isArray(a.geometry.coordinates)) return null;
  var e = a.elevation || {};
  return { icao: a.icaoCode || null, name: a.name || "?", country: a.country || "", type: a.type,
    lat: a.geometry.coordinates[1], lon: a.geometry.coordinates[0],
    elevFt: typeof e.value === "number" ? Math.round(e.unit === 1 ? e.value : e.value * M2FT) : null };
}
var AIRDB = {}, APTDB = {}, LOADING = {};
/* openAIP direkt aus dem Browser (eigene IP, kein Cloudflare-Rate-Limit),
   Ergebnis 24 h im Browser-Cache */
var OAIP_KEY = null;
async function oaipKeyGet() {
  if (OAIP_KEY !== null) return OAIP_KEY;
  var r = await fetch("/cfg"), j = await r.json();
  OAIP_KEY = j.oaipKey || "";
  return OAIP_KEY;
}
async function oaipGet(path) {
  var key = await oaipKeyGet(), base = "https://api.core.openaip.net/api/" + path;
  for (var k = 0; k < 4; k++) {
    var r = await fetch(base + (base.indexOf("?") >= 0 ? "&" : "?") + "apiKey=" + encodeURIComponent(key));
    if (r.status === 401 || r.status === 403) r = await fetch(base, { headers: { "x-openaip-api-key": key } });
    if (r.status === 429 && k < 3) {
      var w = 5 * Math.pow(2, k);
      setSts("openAIP kurz ausgelastet \u2013 neuer Versuch in " + w + " s \u2026");
      await sleep(w * 1000); continue;
    }
    if (!r.ok) throw new Error("openAIP HTTP " + r.status);
    return r.json();
  }
}
async function cacheGet(url, maxAge) {
  try {
    var c = await caches.open("vfr-oaip"), r = await c.match(url);
    if (!r || Date.now() - (+r.headers.get("x-t") || 0) > maxAge) return null;
    return await r.json();
  } catch (e) { return null; }
}
async function cachePut(url, data) {
  try {
    var c = await caches.open("vfr-oaip");
    await c.put(url, new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json", "x-t": String(Date.now()) } }));
  } catch (e) {}
}
function slim(x, t) {
  if (t === "apt") return { icaoCode: x.icaoCode, name: x.name, country: x.country, type: x.type, geometry: x.geometry, elevation: x.elevation };
  return { _id: x._id, name: x.name, type: x.type, icaoClass: x.icaoClass, lowerLimit: x.lowerLimit, upperLimit: x.upperLimit,
    geometry: x.geometry, country: x.country, frequencies: x.frequencies, onDemand: x.onDemand, onRequest: x.onRequest, byNotam: x.byNotam };
}
async function loadCountry(c, t) {
  var k = c + t;
  if (!LOADING[k]) LOADING[k] = (async function () {
    var ck = "https://cache.local/oaip/" + c + "/" + t;
    var raw = await cacheGet(ck, 86400000);
    if (!raw) {
      raw = [];
      for (var page = 1; page <= 15; page++) {
        var j = await oaipGet((t === "asp" ? "airspaces" : "airports") + "?country=" + c + "&limit=1000&page=" + page);
        (j.items || []).forEach(function (x) { raw.push(slim(x, t)); });
        var more = j.nextPage != null ? j.nextPage > page : (j.totalPages ? page < j.totalPages : false);
        if (!more) break;
      }
      await cachePut(ck, raw);
    }
    var list = raw.map(t === "asp" ? normAsp : normApt).filter(Boolean);
    (t === "asp" ? AIRDB : APTDB)[c] = list;
    return list;
  })();
  try { return await LOADING[k]; } catch (e) { delete LOADING[k]; throw e; }
}
async function dataIn(t, w, s, e, n) {
  var cs = countriesFor(w, s, e, n);
  var res = await Promise.allSettled(cs.map(function (c) { return loadCountry(c, t); }));
  var failed = cs.filter(function (c, i) { return res[i].status !== "fulfilled"; });
  var db = t === "asp" ? AIRDB : APTDB, seen = {}, out = [];
  cs.forEach(function (c) {
    (db[c] || []).forEach(function (a) {
      if (t === "asp") { if (seen[a.id] || !bbOverlap([w, s, e, n], a.bb)) return; seen[a.id] = 1; }
      else { if (a.lon < w || a.lon > e || a.lat < s || a.lat > n) return; }
      out.push(a);
    });
  });
  return { list: out, failed: failed };
}

var VIEW_AIR = [], airTimer = null;
async function loadAirView() {
  if (map.getZoom() < 7) { airLayer.clearLayers(); VIEW_AIR = []; return; }
  var b = map.getBounds();
  try {
    var r = await dataIn("asp", b.getWest(), b.getSouth(), b.getEast(), b.getNorth());
    VIEW_AIR = r.list;
    drawAir();
    if (r.failed.length) setSts("Luftraumdaten f\u00fcr " + r.failed.join(", ") + " nicht geladen \u2013 Karte unvollst\u00e4ndig.", "err");
  } catch (e) { setSts("Luftraum: " + esc(e.message), "err"); }
}
function drawAir() {
  airLayer.clearLayers();
  var lim = +$("asFilter").value;
  VIEW_AIR.forEach(function (a) {
    if (lim && a.loFt > lim) return;
    var col = KIND[a.kind].c;
    L.geoJSON({ type: "Feature", geometry: a.geometry, properties: {} }, {
      renderer: cvs, interactive: false,
      style: { color: col, weight: a.temp ? 1.8 : 1.2, fillColor: col, fillOpacity: a.kind === "info" ? 0.03 : 0.07,
        dashArray: a.temp ? "3 5" : ((a.kind === "tmz" || a.kind === "rmz") ? "8 4" : null) }
    }).addTo(airLayer);
  });
}
map.on("moveend", function () { clearTimeout(airTimer); airTimer = setTimeout(loadAirView, 350); });
/* Klick in die Karte: ALLE Lufträume am Punkt, nach Untergrenze sortiert */
map.on("click", function (ev) {
  var lat = ev.latlng.lat, lon = ev.latlng.lng;
  var hits = VIEW_AIR.filter(function (a) { return lon >= a.bb[0] && lon <= a.bb[2] && lat >= a.bb[1] && lat <= a.bb[3] && inGeom(a.geometry, lon, lat); });
  if (!hits.length) return;
  hits.sort(function (x, y) { return x.loFt - y.loFt; });
  var lim = +$("asFilter").value, hidden = lim ? hits.filter(function (a) { return a.loFt > lim; }).length : 0;
  var h = "<div class='pop'><b class='h'>" + hits.length + " Luftr\u00e4um" + (hits.length > 1 ? "e" : "") + " an diesem Punkt</b>";
  hits.forEach(function (a) {
    var at = actTxt(a);
    h += "<div class='asr'><i style='background:" + KIND[a.kind].c + "'></i><b>" + esc(a.name) + "</b><br><small>" +
      (TYPE_TXT[a.type] || "?") + " (Nr. " + a.type + ") \u00b7 " + clsTxt(a) + " \u00b7 " + fmtLimit(a.lower) + " \u2013 " + fmtLimit(a.upper) +
      (at ? " \u00b7 <b style='color:#C1810B'>" + at + "</b>" : "") + "</small></div>";
  });
  if (hidden) h += "<div class='note' style='margin-top:4px'>" + hidden + " davon wegen H\u00f6henfilter nicht gezeichnet.</div>";
  h += "</div>";
  L.popup({ maxWidth: 400 }).setLatLng(ev.latlng).setContent(h).openOn(map);
});

/* ==================== 4. Flugplatzsuche & Einstellungen ==================== */
function showSel(inpId, a) { var inp = $(inpId); inp.value = (a.icao ? a.icao + " \u2013 " : "") + a.name; inp.classList.add("ok"); }
function searchLocal(q) {
  var up = q.toUpperCase(), lq = normTxt(q), all = [];
  Object.keys(APTDB).forEach(function (c) { APTDB[c].forEach(function (a) { all.push(a); }); });
  var hits = all.filter(function (a) { return (a.icao && a.icao.indexOf(up) === 0) || normTxt(a.name).indexOf(lq) >= 0; });
  hits.sort(function (a, b) {
    var ra = a.icao === up ? 0 : (a.icao && a.icao.indexOf(up) === 0) ? 1 : a.icao ? 2 : 3;
    var rb = b.icao === up ? 0 : (b.icao && b.icao.indexOf(up) === 0) ? 1 : b.icao ? 2 : 3;
    return ra - rb || a.name.localeCompare(b.name);
  });
  return hits.slice(0, 20);
}
function setupAc(inpId, boxId, key) {
  var inp = $(inpId), box = $(boxId), t = null, items = [];
  inp.addEventListener("input", function () {
    S[key] = null; inp.classList.remove("ok"); clearTimeout(t);
    var q = inp.value.trim();
    if (q.length < 2) { box.style.display = "none"; return; }
    t = setTimeout(async function () {
      items = searchLocal(q);
      if (!items.length && q.length >= 3) {
              try { var j = await oaipGet("airports?search=" + encodeURIComponent(q) + "&limit=20"); items = rawList(j).map(normApt).filter(Boolean); } catch (e) { items = []; }
      }
      box.innerHTML = items.length ? items.map(function (a, i) {
        return "<div data-i='" + i + "'><b>" + esc(a.icao || "\u2014") + "</b>" + esc(a.name) + " <small>" + esc(a.country) + "</small></div>";
      }).join("") : "<div>Kein Treffer</div>";
      box.style.display = "block";
    }, 200);
  });
  box.addEventListener("mousedown", function (e) {
    var d = e.target.closest("[data-i]"); if (!d) return;
    e.preventDefault();
    S[key] = items[+d.getAttribute("data-i")];
    showSel(inpId, S[key]); box.style.display = "none"; saveSettings();
  });
  inp.addEventListener("blur", function () { setTimeout(function () { box.style.display = "none"; }, 150); });
  inp.addEventListener("keydown", function (e) { if (e.key === "Enter" && S.from && S.to) plan(); });
}
var KEEP = ["tas", "maxAlt", "terrClr", "cloudClr", "prefAgl", "climb", "desc"];
function saveSettings() {
  try {
    var o = { v74: true, from: S.from, to: S.to, avoidClr: $("avoidClr").checked, asFilter: $("asFilter").value };
    KEEP.forEach(function (f) { o[f] = $(f).value; });
    localStorage.setItem("vfr72", JSON.stringify(o));
  } catch (e) {}
}
function loadSettings() {
  try {
    var o = JSON.parse(localStorage.getItem("vfr72") || "null"); if (!o) return;
    KEEP.forEach(function (f) { if (o[f]) $(f).value = o[f]; });
    if (!o.v74 && o.maxAlt === "10000") $("maxAlt").value = 12500;
    $("avoidClr").checked = !!o.avoidClr;
    if (o.asFilter != null) $("asFilter").value = o.asFilter;
    if (o.from) { S.from = o.from; showSel("fIn", o.from); }
    if (o.to) { S.to = o.to; showSel("tIn", o.to); }
  } catch (e) {}
}
function readP() {
  var tm = ($("dTime").value || "10:00").split(":");
  var P = {
    date: $("dDate").value, depH: (+tm[0]) + (+tm[1] || 0) / 60,
    tas: clampNum($("tas").value, 50, 250, 100), maxAlt: clampNum($("maxAlt").value, 3000, 13000, 12500),
    terrClr: clampNum($("terrClr").value, 500, 3000, 1000), cloudClr: clampNum($("cloudClr").value, 500, 3000, 1000),
    prefAgl: clampNum($("prefAgl").value, 1000, 5000, 2000), climb: clampNum($("climb").value, 200, 2000, 500),
    desc: clampNum($("desc").value, 200, 2000, 500), avoidClr: $("avoidClr").checked
  };
  P.prefAgl = Math.max(P.prefAgl, P.terrClr);
  return P;
}

/* ==================== 5. Gelaende (Terrarium-Kacheln) ==================== */
var DEM = { z: 10, buf: 150, data: {} };
function tileX(lon, z) { return (lon + 180) / 360 * Math.pow(2, z); }
function tileY(lat, z) { var r = lat * RAD; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z); }
async function loadTile(z, x, y) {
  var k = z + "/" + x + "/" + y;
  if (DEM.data[k]) return;
  var r = await fetch("/dem/" + k + ".png");
  if (!r.ok) throw new Error("Gel\u00e4ndekachel " + k + ": HTTP " + r.status);
  var bmp = await createImageBitmap(await r.blob());
  var cv = document.createElement("canvas"); cv.width = 256; cv.height = 256;
  var g = cv.getContext("2d", { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  var px = g.getImageData(0, 0, 256, 256).data, out = new Float32Array(65536);
  for (var i = 0; i < 65536; i++) out[i] = (px[4 * i] * 256 + px[4 * i + 1] + px[4 * i + 2] / 256 - 32768) * M2FT;
  DEM.data[k] = out;
}
async function ensureDem(w, s, e, n, z) {
  DEM.z = z; DEM.buf = z >= 10 ? 150 : 300;
  var x0 = Math.floor(tileX(w, z)), x1 = Math.floor(tileX(e, z)), y0 = Math.floor(tileY(n, z)), y1 = Math.floor(tileY(s, z));
  var jobs = [];
  for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) jobs.push([x, y]);
  if (jobs.length > 160) throw new Error("Gebiet zu gro\u00df f\u00fcr Gel\u00e4ndedaten");
  var k = 0;
  async function worker() { while (k < jobs.length) { var j = jobs[k++]; await loadTile(z, j[0], j[1]); } }
  await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
}
function elevFt(lat, lon) {
  var z = DEM.z, fx = tileX(lon, z), fy = tileY(lat, z), x = Math.floor(fx), y = Math.floor(fy);
  var d = DEM.data[z + "/" + x + "/" + y];
  if (!d) return null;
  var px = Math.min(255, Math.floor((fx - x) * 256)), py = Math.min(255, Math.floor((fy - y) * 256));
  var qx = Math.min(255, px + 1), qy = Math.min(255, py + 1);
  return Math.max(d[py * 256 + px], d[py * 256 + qx], d[qy * 256 + px], d[qy * 256 + qx]);
}

/* ==================== 6. Wetter (Open-Meteo, direkt im Browser) ==================== */
var WXC = {};
async function fetchModel(mi, pts, date) {
  var m = MODELS[mi];
  var lats = pts.map(function (p) { return p.lat.toFixed(3); }).join(","), lons = pts.map(function (p) { return p.lon.toFixed(3); }).join(",");
  var key = m.id + "|" + date + "|" + lats + "|" + lons;
  if (WXC[key] && Date.now() - WXC[key].t < 1800000) return WXC[key].d;
  var url = "https://api.open-meteo.com/v1/forecast?latitude=" + lats + "&longitude=" + lons + "&hourly=" + HOURLY.join(",") +
    "&models=" + m.id + "&timezone=Europe%2FVienna&start_date=" + date + "&end_date=" + date + "&wind_speed_unit=kn&cell_selection=land";
  var j = await fetchJSON(url);
  var arr = Array.isArray(j) ? j : [j];
  var d = arr.map(function (o) {
    var h = o.hourly || {}, out = { elevFt: (o.elevation || 0) * M2FT, hours: {} };
    (h.time || []).forEach(function (t, i) { out.hours[parseInt(t.slice(11, 13), 10)] = i; });
    HOURLY.forEach(function (v) { out[v] = h[v] || h[v + "_" + m.id] || null; });
    return out;
  });
  var ok = d.some(function (x) { return x.temperature_2m && x.temperature_2m.some(function (v) { return v != null; }); });
  if (!ok) throw new Error("keine Daten f\u00fcr dieses Datum");
  WXC[key] = { t: Date.now(), d: d };
  return d;
}
function estVis(sp, prec) {
  if (prec > 5) return 2; if (prec > 2) return 4; if (prec > 0.5) return 6;
  if (sp < 0.5) return 0.5; if (sp < 1.5) return 2; if (sp < 2.5) return 5; if (sp < 3.5) return 8;
  return 15;
}
function tsProb(cape, prec) {
  var p = 0;
  if (cape > 300) p += 5; if (cape > 700) p += 10; if (cape > 1200) p += 20; if (cape > 2000) p += 25;
  if (cape > 300 && prec > 0.3) p += 20; if (cape > 300 && prec > 2) p += 20;
  return Math.min(95, p);
}
/* Wolkenbasis: nur bei Decke (tief >=50 % oder mittel >=70 %). Hoehe aus Feuchteprofil:
   erstes Druckniveau ueber Grund mit rel. Feuchte >= 93 %, linear interpoliert.
   Rueckfall Taupunktdifferenz x 400 ft, wenn das Modell kein Feuchteprofil liefert. */
function baseFrom(md, i, sp, low, mid) {
  if (low < 50 && mid < 70) return { msl: Infinity, how: null };
  function v(n) { var a = md[n]; return a && a[i] != null ? a[i] : null; }
  var lcl = md.elevFt + Math.min(6500, Math.max(300, sp * 400));
  var prevZ = md.elevFt, prevRh = null, haveProfile = true, found = null;
  for (var k = 0; k < PL.length; k++) {
    var rh = v("relative_humidity_" + PL[k] + "hPa"), gh = v("geopotential_height_" + PL[k] + "hPa");
    if (rh == null || gh == null) { haveProfile = false; break; }
    var z = gh * M2FT;
    if (z <= md.elevFt + 200) { prevRh = rh; continue; }
    if (rh >= 93) {
      if (prevRh != null && prevRh < 93) found = prevZ + (93 - prevRh) / (rh - prevRh) * (z - prevZ);
      else found = Math.min(z, lcl);
      break;
    }
    prevZ = z; prevRh = rh;
  }
  if (!haveProfile) return low >= 50 ? { msl: lcl, how: "Taupunkt" } : { msl: Infinity, how: null };
  if (found == null) return low >= 50 ? { msl: lcl, how: "Taupunkt" } : { msl: Infinity, how: null };
  return { msl: Math.max(md.elevFt + 200, found), how: "Feuchteprofil" };
}
function recAt(md, hr) {
  if (!md) return null;
  var i = md.hours[hr]; if (i == null) return null;
  function v(n) { var a = md[n]; return a && a[i] != null ? a[i] : null; }
  var T = v("temperature_2m"), Td = v("dew_point_2m");
  if (T == null || Td == null) return null;
  var sp = Math.max(0, T - Td), low = v("cloud_cover_low") || 0, mid = v("cloud_cover_mid") || 0, prec = v("precipitation") || 0;
  var visM = v("visibility"), cape = v("cape") || 0, b = baseFrom(md, i, sp, low, mid);
  return { T: T, Td: Td, sp: sp, low: low, mid: mid, prec: prec, cape: cape,
    visKm: visM != null ? Math.min(20, visM / 1000) : estVis(sp, prec), visEst: visM == null,
    gust: v("wind_gusts_10m") || 0, ws: v("wind_speed_850hPa"), wd: v("wind_direction_850hPa"),
    baseMsl: b.msl, baseHow: b.how, baseAgl: isFinite(b.msl) ? b.msl - md.elevFt : null,
    ts: tsProb(cape, prec), elevFt: md.elevFt };
}
/* Zwischen zwei Modellstunden gilt die SCHLECHTERE (konservativ) */
function recAtH(md, h) {
  var h0 = Math.floor(h), a = recAt(md, h0);
  if (h - h0 < 1e-6) return a;
  var b = recAt(md, h0 + 1);
  if (!a) return b; if (!b) return a;
  var lowB = a.baseMsl <= b.baseMsl ? a : b;
  return { T: a.T, Td: a.Td, sp: Math.min(a.sp, b.sp), low: Math.max(a.low, b.low), mid: Math.max(a.mid, b.mid),
    prec: Math.max(a.prec, b.prec), cape: Math.max(a.cape, b.cape), visKm: Math.min(a.visKm, b.visKm), visEst: a.visEst || b.visEst,
    gust: Math.max(a.gust, b.gust), ws: (h - h0 < 0.5 ? a : b).ws, wd: (h - h0 < 0.5 ? a : b).wd,
    baseMsl: lowB.baseMsl, baseHow: lowB.baseHow, baseAgl: lowB.baseAgl, ts: Math.max(a.ts, b.ts), elevFt: a.elevFt };
}
function catOf(vis, ts, bAgl) {
  if (vis < 5 || ts >= 65 || (bAgl != null && bAgl < 1000)) return 2;
  if (vis < 8 || ts >= 40 || (bAgl != null && bAgl < 2000)) return 1;
  return 0;
}
function vecMean(list) {
  var u = 0, v = 0, n = 0;
  list.forEach(function (x) { if (x && x.ws != null && x.wd != null) { u += -x.ws * Math.sin(x.wd * RAD); v += -x.ws * Math.cos(x.wd * RAD); n++; } });
  if (!n) return null;
  u /= n; v /= n;
  return { ws: Math.sqrt(u * u + v * v), wd: (Math.atan2(-u, -v) / RAD + 360) % 360 };
}
/* Modellkonsens an einem Wetterpunkt: Basis = schlechtestes Modell,
   Sicht/Gewitter/Boeen/Niederschlag = zweitschlechtestes (Bestaetigung durch 2. Modell) */
function wpWx(G, wi, h) {
  var key = wi + "@" + h.toFixed(2);
  if (G.ww[key] !== undefined) return G.ww[key];
  var recs = [];
  G.wx.forEach(function (md, mi) { if (!md) return; var r = recAtH(md[wi], h); if (r) { r.mi = mi; recs.push(r); } });
  if (!recs.length) { G.ww[key] = null; return null; }
  function kth(vals, desc) { var a = vals.slice().sort(function (x, y) { return desc ? y - x : x - y; }); return a[Math.min(recs.length >= 2 ? 2 : 1, a.length) - 1]; }
  var w = { recs: recs };
  w.visKm = kth(recs.map(function (r) { return r.visKm; }), false);
  w.ts = kth(recs.map(function (r) { return r.ts; }), true);
  w.gust = kth(recs.map(function (r) { return r.gust; }), true);
  w.prec = kth(recs.map(function (r) { return r.prec; }), true);
  var bs = recs.map(function (r) { return r.baseMsl; }).sort(function (a, b) { return a - b; });
  w.base = bs[Math.min(recs.length >= 2 ? 1 : 0, bs.length - 1)];
  w.baseMin = bs[0];
  var bm = recs.filter(function (r) { return r.baseMsl === w.base; })[0];
  var bmin = recs.filter(function (r) { return r.baseMsl === w.baseMin; })[0];
  w.baseMinModel = isFinite(w.baseMin) ? MODELS[bmin.mi].l : null;
  w.baseModel = isFinite(w.base) ? MODELS[bm.mi].l + " (" + bm.baseHow + ")" : null;
  w.visEstAny = recs.some(function (r) { return r.visEst; });
  w.T = avg(recs.map(function (r) { return r.T; })); w.Td = avg(recs.map(function (r) { return r.Td; }));
  w.elevFt = avg(recs.map(function (r) { return r.elevFt; }));
  var wm = vecMean(recs); w.ws = wm ? wm.ws : null; w.wd = wm ? wm.wd : null;
  w.fz = w.elevFt + Math.max(0, w.T) * 500;
  G.ww[key] = w;
  return w;
}
/* Mehrere benachbarte Wetterpunkte zusammenfassen (jeweils der schlechtere Wert) */
function combineWx(list) {
  list = list.filter(Boolean);
  if (!list.length) return null;
  var f = list[0], w = {};
  for (var k in f) w[k] = f[k];
  list.slice(1).forEach(function (o) {
    w.visKm = Math.min(w.visKm, o.visKm); w.ts = Math.max(w.ts, o.ts); w.gust = Math.max(w.gust, o.gust); w.prec = Math.max(w.prec, o.prec);
    if (o.base < w.base) { w.base = o.base; w.baseModel = o.baseModel; }
    if (o.baseMin < w.baseMin) { w.baseMin = o.baseMin; w.baseMinModel = o.baseMinModel; }
    w.fz = Math.min(w.fz, o.fz); w.visEstAny = w.visEstAny || o.visEstAny;
  });
  return w;
}
function assess(w) {
  var rs = [], reasons = [], nogo = false;
  function add(r, lvl, txt) { rs.push(r); if (lvl) reasons.push([lvl, txt]); }
  var vs = w.visSrc ? " (" + w.visSrc + ")" : "";
  if (w.visKm < 5) { nogo = true; add(1, "bad", "Sicht " + fmtVis(w.visKm) + vs); }
  else if (w.visKm < 8) add(0.5, "warn", "Sicht nur " + fmtVis(w.visKm) + vs);
  else if (w.visKm < 10) add(0.15, null);
  if (w.ts >= 65) { nogo = true; add(1, "bad", "Gewitter wahrscheinlich (" + w.ts + " %)"); }
  else if (w.ts >= 40) add(0.6, "warn", "Gewitter m\u00f6glich (" + w.ts + " %)");
  else if (w.ts >= 15) add(0.2, "info", "Gewitterpotenzial (" + w.ts + " %)");
  if (w.gust >= 35) add(0.8, "bad", "Sturmb\u00f6en " + Math.round(w.gust) + " kt");
  else if (w.gust >= 25) add(0.4, "warn", "B\u00f6en " + Math.round(w.gust) + " kt");
  else if (w.gust >= 18) add(0.1, null);
  if (w.prec >= 4) add(0.6, "warn", "starker Niederschlag (" + w.prec.toFixed(1) + " mm/h)");
  else if (w.prec >= 1) add(0.3, "warn", "Niederschlag (" + w.prec.toFixed(1) + " mm/h)");
  else if (w.prec >= 0.2) add(0.1, "info", "leichter Niederschlag");
  if (w.off && w.off.soft) add(0.3, "warn", w.off.soft.txt);
  if (isFinite(w.baseMin) && w.baseMin < w.base - 1000) add(0.05, "info", "Nur " + w.baseMinModel + " sieht tiefere Basis (~" + fmtFt(w.baseMin) + " ft MSL)");
  var p = 1; rs.forEach(function (x) { p *= (1 - x); });
  w.risk = Math.min(1, 1 - p); w.nogo = nogo; w.reasons = reasons;
  var bAgl = isFinite(w.base) ? w.base - w.elevFt : null;
  w.cat = (nogo || (bAgl != null && bAgl < 1000)) ? 2 : (w.risk >= 0.35 || (bAgl != null && bAgl < 2000)) ? 1 : 0;
}
async function fetchSun(A, B, date) {
  var j = await fetchJSON("https://api.open-meteo.com/v1/forecast?latitude=" + A.lat.toFixed(3) + "," + B.lat.toFixed(3) +
    "&longitude=" + A.lon.toFixed(3) + "," + B.lon.toFixed(3) + "&daily=sunrise,sunset&timezone=Europe%2FVienna&start_date=" + date + "&end_date=" + date, 2);
  var a = Array.isArray(j) ? j : [j, j];
  function hh(s) { return parseInt(s.slice(11, 13), 10) + parseInt(s.slice(14, 16), 10) / 60; }
  return { depRise: hh(a[0].daily.sunrise[0]), depSet: hh(a[0].daily.sunset[0]), destRise: hh(a[1].daily.sunrise[0]), destSet: hh(a[1].daily.sunset[0]) };
}

/* ==================== 7. METAR / TAF ==================== */
function visKmOf(v) {
  if (v == null) return null;
  var s = String(v).trim();
  if (/\+$/.test(s)) return 10;
  var m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/); if (m) return Math.min(10, (+m[1] + (+m[2]) / (+m[3])) * 1.609);
  m = s.match(/^(\d+)\/(\d+)$/); if (m) return (+m[1] / +m[2]) * 1.609;
  var n = parseFloat(s); if (!isFinite(n)) return null;
  return n >= 6 ? 10 : n * 1.609;
}
function ceilOf(cl) {
  var c = null;
  (cl || []).forEach(function (x) { if (/^(BKN|OVC|OVX|VV)$/.test(x.cover) && x.base != null) c = c == null ? x.base : Math.min(c, x.base); });
  return c;
}
function buildStations(j) {
  var mp = {};
  function get(o) {
    if (!mp[o.icaoId]) mp[o.icaoId] = { id: o.icaoId, lat: o.lat, lon: o.lon, elevFt: (o.elev || 0) * M2FT, name: o.name || "", metar: null, taf: null };
    return mp[o.icaoId];
  }
  (j.metar || []).forEach(function (o) {
    if (!o.icaoId || o.lat == null) return;
    var s = get(o), t = o.obsTime || 0;
    if (s.metar && s.metar.t >= t) return;
    var cav = /CAVOK/.test(o.rawOb || "");
    s.metar = { t: t, raw: o.rawOb || "", visKm: cav ? 10 : visKmOf(o.visib), ceil: cav ? null : ceilOf(o.clouds), gust: o.wgst || null, qnh: o.altim || null, temp: o.temp };
  });
  (j.taf || []).forEach(function (o) {
    if (!o.icaoId || o.lat == null) return;
    get(o).taf = { from: o.validTimeFrom, to: o.validTimeTo, raw: o.rawTAF || "", fcsts: Array.isArray(o.fcsts) ? o.fcsts : [] };
  });
  return Object.keys(mp).map(function (k) { return mp[k]; });
}
function fcVals(f) {
  var v = { visKm: visKmOf(f.visib), gust: f.wgst != null ? f.wgst : null, wx: f.wxString || null, ceil: undefined };
  if (Array.isArray(f.clouds) && f.clouds.length) { var c = ceilOf(f.clouds); v.ceil = c == null ? Infinity : c; }
  return v;
}
function ceilVal(c) { return c === undefined || c == null ? Infinity : c; }
function mergeV(a, b) { if (!a) return b; return { visKm: b.visKm != null ? b.visKm : a.visKm, gust: b.gust != null ? b.gust : a.gust, wx: b.wx || a.wx, ceil: b.ceil !== undefined ? b.ceil : a.ceil }; }
function worseV(a, b) { if (!a) return b; if (!b) return a; return { visKm: minN(a.visKm, b.visKm), gust: maxN(a.gust, b.gust), wx: b.wx || a.wx, ceil: Math.min(ceilVal(a.ceil), ceilVal(b.ceil)) }; }
function tafAt(T, t) {
  if (!T || !T.fcsts.length || t < T.from - 1800 || t > T.to) return null;
  var fs = T.fcsts.slice().sort(function (a, b) { return (a.timeFrom || 0) - (b.timeFrom || 0); });
  var prev = null, tempos = [];
  fs.forEach(function (f) {
    var ch = f.fcstChange || null, v = fcVals(f);
    if (!prev && !ch) { prev = v; return; }
    if (!ch || ch === "FM") { if ((f.timeFrom || 0) <= t) prev = mergeV(prev, v); return; }
    if (ch === "BECMG") {
      if (f.timeFrom <= t) { var after = mergeV(prev, v), end = f.timeBec || f.timeTo || f.timeFrom; prev = t < end ? worseV(prev, after) : after; }
      return;
    }
    if ((ch === "TEMPO" || ch === "PROB") && f.timeFrom <= t && t < f.timeTo) tempos.push(v);
  });
  if (!prev) return null;
  var soft = null;
  tempos.forEach(function (v) { soft = worseV(soft, mergeV(prev, v)); });
  return { hard: prev, soft: soft };
}
function nearestStn(p, maxNm) {
  var best = null, bd = maxNm;
  STN.forEach(function (s) { var d = distNm(p, s); if (d <= bd) { bd = d; best = s; } });
  return best ? { s: best, d: bd } : null;
}
function officialAt(p, t) {
  var ns = nearestStn(p, 10); if (!ns) return null;
  var s = ns.s, now = Date.now() / 1000, res = { visKm: null, ceilMsl: null, gust: null, soft: null }, used = [];
  var m = s.metar;
  if (m && Math.abs(t - now) <= 5400 && now - m.t <= 5400) {
    res.visKm = m.visKm; res.ceilMsl = m.ceil != null ? s.elevFt + m.ceil : null; res.gust = m.gust; used.push("METAR " + s.id);
  }
  var tf = tafAt(s.taf, t);
  if (tf) {
    var hd = tf.hard;
    if (hd.visKm != null) res.visKm = minN(res.visKm, hd.visKm);
    if (isFinite(ceilVal(hd.ceil))) res.ceilMsl = minN(res.ceilMsl, s.elevFt + hd.ceil);
    if (hd.gust != null) res.gust = maxN(res.gust, hd.gust);
    used.push("TAF " + s.id);
    if (tf.soft) {
      var st = [];
      if (tf.soft.visKm != null && (hd.visKm == null || tf.soft.visKm < hd.visKm)) st.push("Sicht " + fmtVis(tf.soft.visKm));
      if (isFinite(ceilVal(tf.soft.ceil)) && tf.soft.ceil < ceilVal(hd.ceil)) st.push("Ceiling " + tf.soft.ceil + " ft");
      if (tf.soft.wx && tf.soft.wx !== hd.wx) st.push(tf.soft.wx);
      if (st.length) res.soft = { txt: "TAF " + s.id + " zeitweise: " + st.join(", ") };
    }
  }
  if (!used.length) return null;
  res.src = used.join(" + "); res.stn = s;
  return res;
}
/* ==================== 8. Routen-Netz ==================== */
/* Feines Routennetz (~5 NM laengs, 13 Spuren quer) fuer Talrouten,
   groeberes Wetterraster (~12 NM, 5 Spuren) zur Schonung des Open-Meteo-Kontingents */
function buildGraph(A, B, d) {
  var crs = courseDeg(A, B), N = Math.max(6, Math.min(40, Math.round(d / 5))), K = 6;
  var hw = Math.max(10, Math.min(30, d * 0.3)), s = hw / K, step = d / N;
  var nodes = [], idx = {}, i, j;
  for (i = 0; i <= N; i++) {
    var c = lerp(A, B, i / N);
    for (j = -K; j <= K; j++) {
      if ((i === 0 || i === N) && j !== 0) continue;
      if (i > 0 && i < N && Math.abs(j) * s > Math.min(i, N - i) * step * 1.2 + 0.01) continue;
      var p = i === 0 ? A : i === N ? B : (j === 0 ? c : offsetPt(c, crs + 90, j * s));
      idx[i + "," + j] = nodes.length;
      nodes.push({ i: i, j: j, lat: p.lat, lon: p.lon, along: d * i / N });
    }
  }
  var edges = [], emap = {};
  nodes.forEach(function (n, a) {
    if (n.i === N) return;
    for (var dj = -2; dj <= 2; dj++) {
      var b = idx[(n.i + 1) + "," + (n.j + dj)];
      if (b == null) continue;
      emap[a + ">" + b] = edges.length; edges.push({ a: a, b: b });
    }
  });
  var order = edges.map(function (e, k) { return k; }).sort(function (x, y) { return nodes[edges[x].a].i - nodes[edges[y].a].i; });
  var Nw = Math.max(3, Math.min(12, Math.round(d / 12))), sw = d / Nw, wpts = [];
  for (i = 0; i <= Nw; i++) {
    var cw = lerp(A, B, i / Nw), ii = i;
    [-hw, -hw / 2, 0, hw / 2, hw].forEach(function (o) {
      if ((ii === 0 || ii === Nw) && o !== 0) return;
      if (Math.abs(o) > Math.min(ii, Nw - ii) * sw * 1.2 + 0.01) return;
      var q = o === 0 ? cw : offsetPt(cw, crs + 90, o);
      wpts.push({ lat: q.lat, lon: q.lon });
    });
  }
  nodes.forEach(function (n) {
    var ds = wpts.map(function (w, k) { return { k: k, d: distNm(n, w) }; }).sort(function (a, b) { return a.d - b.d; });
    var lim = Math.max(ds[0].d * 1.25, ds[0].d + 1);
    n.wps = ds.filter(function (x) { return x.d <= lim; }).slice(0, 2).map(function (x) { return x.k; });
  });
  return { A: A, B: B, d: d, crs: crs, N: N, nodes: nodes, edges: edges, emap: emap, order: order, wpts: wpts,
    start: idx["0,0"], end: idx[N + ",0"], idx: idx, nw: {}, ww: {}, dyn: {} };
}
function edgeStatic(G, e, AIR) {
  var na = G.nodes[e.a], nb = G.nodes[e.b];
  e.len = distNm(na, nb); e.crs = courseDeg(na, nb);
  var n = Math.max(4, Math.ceil(e.len / 0.25)), tmax = -1e9, k, o;
  for (k = 0; k <= n; k++) {
    var c = lerp(na, nb, k / n);
    for (o = -1; o <= 1.001; o += 0.5) {
      var p = Math.abs(o) < 1e-6 ? c : offsetPt(c, e.crs + 90, o), h = elevFt(p.lat, p.lon);
      if (h != null && h > tmax) tmax = h;
    }
  }
  e.tmax = tmax > -1e8 ? tmax : 0;
  var bb = [Math.min(na.lon, nb.lon) - 0.04, Math.min(na.lat, nb.lat) - 0.03, Math.max(na.lon, nb.lon) + 0.04, Math.max(na.lat, nb.lat) + 0.03];
  var cand = AIR.filter(function (as) { return bbOverlap(bb, as.bb); });
  e.hits = [];
  if (!cand.length) return;
  var m = Math.max(4, Math.ceil(e.len / 0.5)), pts = [];
  for (k = 0; k <= m; k++) {
    var cc = lerp(na, nb, k / m);
    for (o = -1; o <= 1; o++) { var q = o === 0 ? cc : offsetPt(cc, e.crs + 90, o); pts.push({ lat: q.lat, lon: q.lon, f: k / m }); }
  }
  cand.forEach(function (as) {
    var lo = Infinity, hi = -Infinity, f0 = null, f1 = null;
    pts.forEach(function (q) {
      if (q.lon < as.bb[0] || q.lon > as.bb[2] || q.lat < as.bb[1] || q.lat > as.bb[3]) return;
      if (!inGeom(as.geometry, q.lon, q.lat)) return;
      var t = elevFt(q.lat, q.lon) || 0, l = limitFt(as.lower, t, G.qnh), u = limitFt(as.upper, t, G.qnh);
      if (l != null && l < lo) lo = l; if (u != null && u > hi) hi = u;
      if (f0 == null || q.f < f0) f0 = q.f; if (f1 == null || q.f > f1) f1 = q.f;
    });
    if (f0 != null) e.hits.push({ as: as, lo: lo, hi: hi, f0: f0, f1: f1 });
  });
}
function subtractIv(set, lo, hi) {
  var out = [];
  set.forEach(function (iv) {
    if (hi <= iv[0] || lo >= iv[1]) { out.push(iv); return; }
    if (lo > iv[0]) out.push([iv[0], lo]);
    if (hi < iv[1]) out.push([hi, iv[1]]);
  });
  return out;
}
function subtractKind(set, hits, kind, buf) {
  hits.forEach(function (h) {
    if (h.as.kind !== kind) return;
    if (!isFinite(h.lo) || !isFinite(h.hi)) { set = []; return; }
    set = subtractIv(set, h.lo - buf, h.hi + buf);
  });
  return set;
}
function intersect(A, B) {
  var out = [];
  A.forEach(function (a) { B.forEach(function (b) { var lo = Math.max(a[0], b[0]), hi = Math.min(a[1], b[1]); if (hi >= lo) out.push([lo, hi]); }); });
  return out;
}

/* ==================== 9. Wetter am Netzpunkt & Teilstrecken ==================== */
function nodeWx(G, ni, h) {
  var key = ni + "@" + h.toFixed(2);
  if (G.nw[key] !== undefined) return G.nw[key];
  var nd = G.nodes[ni];
  var w = combineWx(nd.wps.map(function (wi) { return wpWx(G, wi, h); }));
  if (!w) { G.nw[key] = null; return null; }
  var off = officialAt(nd, G.t0 + h * 3600);
  if (off) {
    w.off = off;
    if (off.visKm != null && off.visKm < w.visKm) { w.visKm = off.visKm; w.visSrc = off.src; }
    if (off.ceilMsl != null && off.ceilMsl < w.base) { w.base = off.ceilMsl; w.baseModel = off.src; }
    if (off.gust != null && off.gust > w.gust) w.gust = off.gust;
  }
  assess(w);
  var cats = w.recs.map(function (r) { return catOf(r.visKm, r.ts, r.baseAgl); });
  w.agree = cats.filter(function (c) { return c === w.cat; }).length / cats.length;
  G.nw[key] = w;
  return w;
}
function edgeDyn(G, ei, depH, P) {
  var key = ei + "|" + depH.toFixed(3);
  if (G.dyn[key]) return G.dyn[key];
  var e = G.edges[ei], na = G.nodes[e.a], nb = G.nodes[e.b];
  var wa = nodeWx(G, e.a, depH + na.along / P.tas), wb = nodeWx(G, e.b, depH + nb.along / P.tas);
  var floor = e.tmax + DEM.buf + P.terrClr;
  var base = Math.min(wa ? wa.base : Infinity, wb ? wb.base : Infinity);
  var ceilWx = ceilFromBase(base, P), top = Math.min(ceilWx, P.maxAlt);
  var r = { e: e, wa: wa, wb: wb, floor: floor, base: base, ceilWx: ceilWx, room: top - floor };
  r.terrainHigh = floor > P.maxAlt;
  r.wxFail = !r.terrainHigh && floor > top;
  var work = (r.terrainHigh || r.wxFail) ? [[floor, Math.max(floor, P.maxAlt)]] : [[floor, top]];
  var buf = 300 + (G.qnhKnown ? 0 : 300);
  var sF = subtractKind(work, e.hits, "forbidden", buf);
  if (!sF.length) { r.blocked = true; r.risk = 1; r.nogo = true; G.dyn[key] = r; return r; }
  var sD = subtractKind(sF, e.hits, "danger", buf);
  r.needDanger = !sD.length; if (!sD.length) sD = sF;
  var sC = subtractKind(sD, e.hits, "clearance", buf);
  r.needClr = !sC.length;
  r.setNoClr = sC.length ? sC : null; r.setAny = sD;
  r.risk = Math.max(wa ? wa.risk : 1, wb ? wb.risk : 1);
  r.nogo = !wa || !wb || wa.nogo || wb.nogo;
  G.dyn[key] = r;
  return r;
}
function ceilFromBase(base, P) {
  if (!isFinite(base)) return Infinity;
  var c = base - P.cloudClr;
  if (c < 3000) c = Math.min(Math.max(c, base - 500), Math.max(c, 3000));
  return c;
}
function makeMode(P, lambda) { return { lambda: lambda, clrPen: P.avoidClr ? 400 : 2, dangerPen: 150 }; }
function edgeCost(r, mode) {
  var c = r.e.len * (1 + mode.lambda * r.risk);
  if (r.terrainHigh) c += 1e5;
  if (r.wxFail) c += 3000; else if (r.room < 1500) c += r.e.len * 3 * (1500 - r.room) / 1500;
  if (r.nogo) c += 3000;
  if (r.needDanger) c += mode.dangerPen;
  if (r.needClr) c += mode.clrPen;
  return c;
}
function bestPath(G, P, depH, mode, extra) {
  var n = G.nodes.length, dist = new Array(n).fill(Infinity), prev = new Array(n).fill(-1);
  dist[G.start] = 0;
  G.order.forEach(function (ei) {
    var e = G.edges[ei];
    if (dist[e.a] === Infinity) return;
    var r = edgeDyn(G, ei, depH, P);
    if (r.blocked) return;
    var c = dist[e.a] + edgeCost(r, mode) + (extra ? extra(ei) : 0);
    if (c < dist[e.b]) { dist[e.b] = c; prev[e.b] = ei; }
  });
  if (dist[G.end] === Infinity) return null;
  var path = [], cur = G.end;
  while (cur !== G.start) { var ei = prev[cur]; path.unshift(ei); cur = G.edges[ei].a; }
  return path;
}
function directPath(G) {
  var p = [];
  for (var i = 0; i < G.N; i++) {
    var ei = G.emap[G.idx[i + ",0"] + ">" + G.idx[(i + 1) + ",0"]];
    if (ei == null) return null;
    p.push(ei);
  }
  return p;
}

/* ==================== 10. Hoehenwahl & Vertikalprofil ==================== */
function pickAlt(set, tmax, P, mc) {
  var target = Math.min(tmax + DEM.buf + P.prefAgl, 10000), best = null;
  set.forEach(function (iv) {
    var a = Math.max(iv[0], Math.min(iv[1], target)), d = Math.abs(a - target);
    if (!best || d < best.d - 1 || (Math.abs(d - best.d) <= 1 && a > best.a)) best = { a: a, d: d, iv: iv };
  });
  var iv = best.iv, alt = Math.floor(best.a / 500) * 500;
  if (alt < iv[0]) { alt = Math.ceil(iv[0] / 100) * 100; if (alt > iv[1]) alt = Math.round(iv[0]); }
  var semi = null;
  if (alt - tmax > 3000) {
    var cand = [];
    for (var L = 3500; L <= 13500; L += 2000) { var lv = mc < 180 ? L : L + 1000; if (lv >= iv[0] && lv <= iv[1]) cand.push(lv); }
    if (cand.length) { cand.sort(function (a, b) { return Math.abs(a - alt) - Math.abs(b - alt); }); alt = cand[0]; semi = "ok"; }
    else semi = "no";
  }
  return { alt: alt, semi: semi, iv: iv };
}
function gsCalc(tas, tc, w) {
  if (!w) return { gs: tas, wca: 0 };
  var ang = (w.wd - tc) * RAD, hwc = w.ws * Math.cos(ang), xw = w.ws * Math.sin(ang);
  var s = Math.max(-0.9, Math.min(0.9, xw / tas)), wca = Math.asin(s) / RAD;
  return { gs: Math.max(30, tas * Math.cos(Math.asin(s)) - hwc), wca: wca };
}
var CAUSE = { wx: "Wolkenbasis zu nah am Gel\u00e4nde", air: "Luftraum l\u00e4sst keine sichere H\u00f6he zu",
  rate: "Gel\u00e4nde steigt zu schnell f\u00fcr Steigflug unter Wolken/Luftraum", terr: "Gel\u00e4nde \u00fcber Maximalh\u00f6he" };
/* Bewertet eine Route komplett: Reiseflughoehen je Abschnitt, dann ein durchgehendes Profil,
   das Steig-/Sinkrate einhaelt und vorausschauend fuer kommendes Gelaende steigt. */
function evalRoute(G, P, depH, path, id, name) {
  var rs = path.map(function (ei) {
    var r = edgeDyn(G, ei, depH, P), o = {};
    for (var k in r) o[k] = r[k];
    o.ei = ei;
    o.set = r.blocked ? [[r.floor, Math.max(r.floor, P.maxAlt)]] : (P.avoidClr ? (r.setNoClr || r.setAny) : r.setAny);
    o.mc = (r.e.crs - MAGVAR + 360) % 360;
    return o;
  });
  var i = 0, k;
  while (i < rs.length) {
    var cur = rs[i].set, j = i + 1, hemi = rs[i].mc < 180;
    while (j < rs.length && (rs[j].mc < 180) === hemi) { var x = intersect(cur, rs[j].set); if (!x.length) break; cur = x; j++; }
    var tmax = -1e9;
    for (k = i; k < j; k++) tmax = Math.max(tmax, rs[k].e.tmax);
    var pk = pickAlt(cur, tmax, P, rs[i].mc);
    for (k = i; k < j; k++) { rs[k].alt = pk.alt; rs[k].semi = pk.semi; rs[k].iv = pk.iv; }
    i = j;
  }
  var cum = 0;
  rs.forEach(function (r) {
    r.x0 = cum; cum += r.e.len; r.x1 = cum;
    r.wind = vecMean([r.wa, r.wb]);
    var g = gsCalc(P.tas, r.e.crs, r.wind); r.gs = g.gs; r.wca = g.wca;
  });
  var D = cum, depElev = G.depElev, destElev = G.destElev;
  var gC = P.climb * 60 / (P.tas * 0.8), gD = P.desc * 60 / P.tas;
  /* Stichproben alle 0,5 NM */
  var sm = [];
  rs.forEach(function (r, ri) {
    var na = G.nodes[r.e.a], nb = G.nodes[r.e.b], n = Math.max(1, Math.ceil(r.e.len / 0.5));
    for (var kk = (ri === 0 ? 0 : 1); kk <= n; kk++) {
      var f = kk / n, c = lerp(na, nb, f), xx = r.x0 + f * r.e.len;
      var tc = elevFt(c.lat, c.lon); if (tc == null) tc = 0;
      var tm = tc;
      [-1, -0.5, 0.5, 1].forEach(function (o) { var q = offsetPt(c, r.e.crs + 90, o), hh = elevFt(q.lat, q.lon); if (hh != null && hh > tm) tm = hh; });
      var bA = r.wa ? r.wa.base : Infinity, bB = r.wb ? r.wb.base : Infinity;
      var base = (isFinite(bA) && isFinite(bB)) ? bA + (bB - bA) * f : Math.min(bA, bB);
      var fA = r.wa ? r.wa.fz : null, fB = r.wb ? r.wb.fz : null;
      var fz = (fA != null && fB != null) ? fA + (fB - fA) * f : (fA != null ? fA : fB);
      var dF = Math.min(xx, D - xx);
      var req = dF < 3 ? tc + (P.terrClr + DEM.buf) * dF / 3 : tm + P.terrClr + DEM.buf;
      var lo = (r.iv[0] > r.floor + 1 && dF >= 5) ? Math.max(req, r.iv[0]) : req;
      var hi = Math.min(r.iv[1], P.maxAlt);
      if (r.wxFail) hi = Math.min(hi, Math.max(r.ceilWx, r.floor));
      var T = Math.min(r.alt, destElev + 1000 + gD * Math.max(0, D - xx - 2));
      sm.push({ x: xx, ri: ri, f: f, lat: c.lat, lon: c.lon, tc: tc, tm: tm, base: base, fz: fz, dF: dF, lo: lo, hi: hi, T: T });
    }
  });
  var n = sm.length;
  for (i = 0; i < n; i++) sm[i].dx = i ? sm[i].x - sm[i - 1].x : 0;
  /* Untere Huelle: vorausschauend steigen (rueckwaerts), begrenzt sinken (vorwaerts) */
  var Lr = sm.map(function (q) { return q.lo; });
  for (i = n - 2; i >= 0; i--) Lr[i] = Math.max(Lr[i], Lr[i + 1] - gC * sm[i + 1].dx);
  for (i = 1; i < n; i++) Lr[i] = Math.max(Lr[i], Lr[i - 1] - gD * sm[i].dx);
  /* Obere Huelle: Wolken/Luftraum. Kreisend steigen ist ueberall erlaubt, wo Platz ist */
  var Ur = sm.map(function (q) { return q.hi; });
  for (i = n - 2; i >= 0; i--) Ur[i] = Math.min(Ur[i], Ur[i + 1] + gD * sm[i + 1].dx);
  var p = new Array(n), circ = new Array(n).fill(0), rateFail = new Array(n).fill(false);
  for (i = 0; i < n; i++) {
    var reach = i ? p[i - 1] + gC * sm[i].dx : depElev;
    var t = Math.max(Lr[i], Math.min(Math.max(Ur[i], Lr[i]), sm[i].T));
    if (i) t = Math.max(t, p[i - 1] - gD * sm[i].dx);
    if (t > reach + 1) {
      if (Lr[i] > reach + 1) {
        if (sm[i].hi >= Lr[i] - 1 && reach >= sm[i].lo - 1) { circ[i] = Lr[i] - reach; t = Lr[i]; }
        else if (reach >= sm[i].lo - 1) t = Math.max(sm[i].lo, Math.min(reach, sm[i].hi));
        else { rateFail[i] = true; t = Lr[i]; }
      } else t = reach;
    }
    p[i] = t;
  }
  /* Zeiten inkl. Kreisen (Start oder unterwegs) und Sinken ueber dem Ziel */
  var tm0 = depH * 60, circles = [];
  for (i = 0; i < n; i++) {
    if (i) { var gs = rs[sm[i].ri].gs * (p[i] > p[i - 1] + 1 ? 0.8 : 1); tm0 += sm[i].dx / gs * 60; }
    if (circ[i] > 250) {
      var cm = circ[i] / P.climb, lc = circles[circles.length - 1];
      if (lc && sm[i].x - lc.x < 1.01) { lc.to = p[i]; lc.min += cm; }
      else circles.push({ x: sm[i].x, from: p[i] - circ[i], to: p[i], min: cm });
      tm0 += cm;
    }
    sm[i].t = tm0;
  }
  var circMin = circles.reduce(function (s, c) { return s + c.min; }, 0), W = depElev + circ[0];
  var excess = p[n - 1] - (destElev + 1000), spiralMin = excess > 300 ? excess / P.desc : 0;
  var arrMin = tm0 + spiralMin;
  rs.forEach(function (r) { r.tStart = null; r.tEnd = null; r.cat = 0; r.minCloud = Infinity; r.minTerr = Infinity; r.conf = false; });
  /* Bewertung der Stichproben */
  var minTerr = Infinity, minCloud = Infinity, conflicts = [], curC = null;
  for (i = 0; i < n; i++) {
    var q = sm[i], r = rs[q.ri];
    q.p = p[i];
    if (r.tStart == null) r.tStart = i ? sm[i - 1].t : q.t;
    r.tEnd = q.t;
    q.conf = q.lo > Ur[i] + 1 || rateFail[i] || (q.dF >= 3 && q.p < q.tm + 100);
    var cause = null;
    if (q.conf) cause = r.terrainHigh ? "terr" : (q.lo > q.hi ? ((r.wxFail || q.base - P.cloudClr < q.lo) ? "wx" : "air") : "rate");
    if (cause) {
      if (curC && curC.cause === cause && q.x - curC.x1 < 1.01) curC.x1 = q.x;
      else { curC = { cause: cause, x0: q.x, x1: q.x }; conflicts.push(curC); }
      r.conf = true;
    } else curC = null;
    if (q.dF >= 3) { minTerr = Math.min(minTerr, q.p - q.tm); r.minTerr = Math.min(r.minTerr, q.p - q.tm); }
    if (isFinite(q.base)) { minCloud = Math.min(minCloud, q.base - q.p); r.minCloud = Math.min(r.minCloud, q.base - q.p); }
  }
  var cat = 0, maxRisk = 0, rsum = 0, worstReason = null;
  rs.forEach(function (r) {
    r.cat = (r.conf || r.blocked || r.terrainHigh || r.nogo || r.minCloud < 0) ? 2
      : (r.risk >= 0.35 || r.minCloud < 1000 || r.minTerr < P.terrClr + 300) ? 1 : 0;
    cat = Math.max(cat, r.cat);
    maxRisk = Math.max(maxRisk, r.risk); rsum += r.risk * r.e.len;
    [r.wa, r.wb].forEach(function (w, wk) {
      if (!w) return;
      w.reasons.forEach(function (rr) {
        var lv = rr[0] === "bad" ? 2 : rr[0] === "warn" ? 1 : 0;
        if (lv && (!worstReason || lv > worstReason.lv)) worstReason = { lv: lv, t: rr[1], x: wk ? r.x1 : r.x0 };
      });
    });
  });
  /* Lufträume entlang des tatsaechlichen Profils */
  var ent = {};
  sm.forEach(function (q) {
    rs[q.ri].e.hits.forEach(function (h) {
      if (q.f < h.f0 - 1e-6 || q.f > h.f1 + 1e-6) return;
      var inside = q.p >= h.lo && q.p <= h.hi;
      var below = !inside && h.as.kind === "clearance" && h.lo > q.p && h.lo - q.p < 1000 && q.dF >= 3;
      if (!inside && !below) return;
      var key = h.as.id + (inside ? "|E" : "|B"), o = ent[key];
      if (!o) ent[key] = { as: h.as, inside: inside, x0: q.x, x1: q.x, t0: q.t, lo: h.lo, hi: h.hi, alt: q.p };
      else { o.x1 = q.x; o.lo = Math.min(o.lo, h.lo); o.hi = Math.max(o.hi, h.hi); o.alt = Math.max(o.alt, q.p); }
    });
  });
  var entries = Object.keys(ent).map(function (kk) { return ent[kk]; }).sort(function (a, b) { return a.x0 - b.x0; });
  var clr = entries.filter(function (x) { return x.inside && x.as.kind === "clearance"; }).length;
  if (entries.some(function (x) { return x.inside && x.as.kind === "forbidden"; })) cat = 2;
  var night = false, dusk = false, dawn = false;
  if (G.sun) {
    if (arrMin / 60 > G.sun.destSet) night = true; else if (arrMin / 60 > G.sun.destSet - 0.5) dusk = true;
    if (depH < G.sun.depRise) dawn = true;
  }
  if (night || dawn || arrMin > 1440) cat = 2; else if (dusk) cat = Math.max(cat, 1);
  var avgRisk = D ? rsum / D : 0, score = 100 - 45 * maxRisk - 15 * avgRisk;
  if (isFinite(minCloud) && minCloud < 2500) score -= Math.min(25, Math.max(0, (2500 - minCloud) / 2500 * 25));
  if (minTerr < 1500) score -= Math.min(15, Math.max(0, (1500 - minTerr) / 1500 * 15));
  score -= Math.min(10, (circMin + spiralMin) * 0.8);
  var rawScore = score, confLen = conflicts.reduce(function (s, c) { return s + c.x1 - c.x0 + 0.5; }, 0);
  if (cat === 2) score = Math.min(score, 30); else if (cat === 1) score = Math.min(score, 70);
  return { rawScore: rawScore, confLen: Math.round(confLen * 2) / 2, circles: circles, id: id, name: name, rs: rs, path: path, key: path.join(","), D: D, samples: sm, W: W, circMin: circMin, spiralMin: spiralMin,
    depMin: depH * 60, arrMin: arrMin, ete: arrMin - depH * 60, maxAlt: Math.max.apply(null, p), cruiseMax: Math.max.apply(null, rs.map(function (r) { return r.alt; })),
    minTerr: minTerr, minCloud: minCloud, maxRisk: maxRisk, avgRisk: avgRisk, worstReason: worstReason, conflicts: conflicts,
    entries: entries, clr: clr, cat: cat, score: Math.max(0, Math.round(score)), night: night, dusk: dusk, dawn: dawn };
}
function sampleAt(R, x) {
  var sm = R.samples;
  for (var i = 0; i < sm.length; i++) if (sm[i].x >= x - 1e-6) return sm[i];
  return sm[sm.length - 1];
}
function densAlt(elev, T, qnh) { var pa = elev + (1013.25 - qnh) * 27, isa = 15 - 1.98 * elev / 1000; return pa + 120 * (T - isa); }

/* ==================== 11. Kandidaten, Rangfolge, Begruendung ==================== */
function laneMap(path, G) { var m = {}; path.forEach(function (ei) { var n = G.nodes[G.edges[ei].b]; m[n.i] = n.j; }); return m; }
function similar(a, b, G) {
  var ma = laneMap(a, G), mb = laneMap(b, G), k = 0, n = 0;
  Object.keys(ma).forEach(function (i) { n++; if (mb[i] != null && Math.abs(ma[i] - mb[i]) <= 1) k++; });
  return n ? k / n : 1;
}
function rankCmp(x, y) { return x.cat - y.cat || x.confLen - y.confLen || y.rawScore - x.rawScore || x.ete - y.ete; }
function candidatePaths(G, P, depH, quick) {
  var out = [];
  function add(p) { if (p && !out.some(function (q) { return q.join() === p.join(); })) out.push(p); }
  var p1 = bestPath(G, P, depH, makeMode(P, 5)); add(p1);
  add(bestPath(G, P, depH, makeMode(P, 12)));
  if (!quick) {
    add(bestPath(G, P, depH, makeMode(P, 2)));
    if (p1) {
      var pen = function (m) {
        return function (ei) { var nd = G.nodes[G.edges[ei].b]; return (m[nd.i] != null && Math.abs(m[nd.i] - nd.j) <= 1 && nd.i !== G.N) ? G.edges[ei].len * 1.5 + 3 : 0; };
      };
      var m1 = laneMap(p1, G), p4 = bestPath(G, P, depH, makeMode(P, 5), pen(m1)); add(p4);
      if (p4) { var m4 = laneMap(p4, G); add(bestPath(G, P, depH, makeMode(P, 5), function (ei) { return pen(m1)(ei) + pen(m4)(ei); })); }
    }
  }
  return out;
}
function computeRoutes(G, P) {
  var dp = directPath(G), direct = dp ? evalRoute(G, P, P.depH, dp, "direct", "Direktstrecke") : null;
  var evals = candidatePaths(G, P, P.depH, false).map(function (p, k) { return evalRoute(G, P, P.depH, p, "c" + k, ""); })
    .filter(function (r) { return !direct || r.key !== direct.key; });
  var all = evals.concat(direct ? [direct] : []).sort(rankCmp);
  if (!all.length) throw new Error("Keine zul\u00e4ssige Route: verbotene Lufträume oder Gel\u00e4nde blockieren alle Varianten.");
  var best = all[0], routes = [best];
  best.name = best.id === "direct" ? "Sicherste Route (= Direktstrecke)" : "Sicherste Route";
  var alt = all.slice(1).filter(function (r) { return r.id !== "direct" && similar(r.path, best.path, G) < 0.7; })[0];
  if (alt) { alt.name = "Alternative"; routes.push(alt); }
  if (direct && best !== direct) routes.push(direct);
  return routes;
}
function optimizer(G, P) {
  var span = G.d / P.tas, lo = G.sun ? Math.ceil(G.sun.depRise) : 6, hi = G.sun ? Math.floor(G.sun.destSet - span - 0.25) : 19;
  var now = new Date(), isToday = P.date === now.getFullYear() + "-" + p2(now.getMonth() + 1) + "-" + p2(now.getDate());
  if (isToday) lo = Math.max(lo, now.getHours() + 1);
  var out = [];
  for (var h = Math.max(0, lo); h <= Math.min(23, hi); h++) {
    var ps = candidatePaths(G, P, h, true), dp = directPath(G);
    if (dp) ps.push(dp);
    var best = null;
    ps.forEach(function (p) { var R = evalRoute(G, P, h, p, "", ""); if (!best || rankCmp(R, best) < 0) best = R; });
    out.push(best ? { h: h, score: best.score, cat: best.cat } : { h: h, score: 0, cat: 2 });
  }
  return out;
}
function issueOf(R) {
  if (R.conflicts.length) {
    var c = R.conflicts.slice().sort(function (a, b) { return (b.x1 - b.x0) - (a.x1 - a.x0); })[0];
    var where = Math.round(c.x1) > Math.round(c.x0) ? "zwischen NM " + Math.round(c.x0) + " und " + Math.round(c.x1) : "bei NM " + Math.round(c.x0);
    return where + " kein sicherer H\u00f6henkorridor (" + CAUSE[c.cause] + ")";
  }
  var f = R.entries.filter(function (x) { return x.inside && x.as.kind === "forbidden"; })[0];
  if (f) return "Ber\u00fchrung von " + f.as.name + " (verboten)";
  if (R.night) return "Ankunft nach Sonnenuntergang";
  if (R.maxRisk >= 0.35 && R.worstReason) return R.worstReason.t + " bei NM " + Math.round(R.worstReason.x);
  if (isFinite(R.minCloud) && R.minCloud < 1500) return "Wolkenabstand nur ~" + fmtFt(R.minCloud) + " ft";
  if (R.circMin > 3) return "Kreisen \u00fcber dem Startplatz n\u00f6tig (~" + Math.round(R.circMin) + " min)";
  if (R.spiralMin > 3) return "Sinkflug \u00fcber dem Ziel n\u00f6tig (~" + Math.round(R.spiralMin) + " min)";
  return null;
}
function whyHtml() {
  var rs = RES.routes, best = rs[0], dir = rs.filter(function (r) { return r.id === "direct"; })[0], out = [];
  if (best.cat === 2) out.push("<p><b>Keine Variante ist sicher fliegbar.</b> Hauptproblem: " + esc(issueOf(best) || "erh\u00f6htes Wetterrisiko") + ".</p>");
  else if (best.id === "direct") out.push("<p><b>Gew\u00e4hlt:</b> Die Direktstrecke bietet bereits die gr\u00f6\u00dften Sicherheitsreserven (Wert " + best.score + ").</p>");
  else {
    var t = "<b>Gew\u00e4hlt:</b> " + Math.round(best.D) + " NM (" + (best.D > RES.G.d + 0.5 ? "+" + Math.round(best.D - RES.G.d) + " NM Umweg" : "kein Umweg") + ")";
    if (dir) { var di = issueOf(dir); t += di ? ", weil die Direktstrecke ein Problem hat: " + esc(di) + "." : ", weil sie mehr Reserven bietet (Wert " + best.score + " statt " + dir.score + ")."; }
    out.push("<p>" + t + "</p>");
  }
  rs.slice(1).forEach(function (r) {
    var i = issueOf(r);
    out.push("<p><b>" + esc(r.name) + ":</b> " + (i ? "nicht empfohlen \u2013 " + esc(i) : (r.score < best.score ? "geringere Reserven (Wert " + r.score + " statt " + best.score + ")" : "gleichwertig")) +
      (r.D > best.D + 2 ? ", " + Math.round(r.D - best.D) + " NM l\u00e4nger" : "") + ".</p>");
  });
  return "<div class='why'>" + out.join("") + "</div>";
}

/* ==================== 12. Details je Route ==================== */
function finalize(R, G, P) {
  if (R.final) return;
  R.final = true;
  R.coords = [[G.A.lat, G.A.lon]].concat(R.rs.map(function (r) { var n = G.nodes[r.e.b]; return [n.lat, n.lon]; }));
  var D = R.D;
  /* Wegpunkte & Navigationslog */
  var wps = [{ lat: G.A.lat, lon: G.A.lon, name: G.A.icao || "START", x: 0, t: R.depMin }];
  for (var k = 1; k < R.rs.length; k++) {
    var a = R.rs[k - 1], b = R.rs[k], turn = Math.abs(((b.e.crs - a.e.crs + 540) % 360) - 180);
    if (turn >= 4 || a.alt !== b.alt) { var nn = G.nodes[b.e.a]; wps.push({ lat: nn.lat, lon: nn.lon, name: "WP" + wps.length, x: b.x0, t: b.tStart }); }
  }
  wps.push({ lat: G.B.lat, lon: G.B.lon, name: G.B.icao || "ZIEL", x: D, t: R.arrMin });
  R.wps = wps;
  R.legs = [];
  for (k = 1; k < wps.length; k++) {
    var w0 = wps[k - 1], w1 = wps[k];
    var es = R.rs.filter(function (r) { return r.x0 >= w0.x - 1e-6 && r.x1 <= w1.x + 1e-6; });
    var tc = courseDeg(w0, w1), wind = vecMean(es.map(function (r) { return r.wind; })), g = gsCalc(P.tas, tc, wind);
    var dist = es.reduce(function (s, r) { return s + r.e.len; }, 0);
    var mins = es.length ? es[es.length - 1].tEnd - es[0].tStart : 0;
    R.legs.push({ from: w0.name, to: w1.name, tc: tc, mc: tc - MAGVAR, mh: tc + g.wca - MAGVAR, dist: dist, alt: es.length ? es[0].alt : 0,
      wind: wind, gs: mins > 0 ? dist / (mins / 60) : g.gs, mins: mins, eto: k === wps.length - 1 ? R.arrMin : w1.t,
      cat: Math.max.apply(null, es.map(function (r) { return r.cat; }).concat([0])) });
  }
  /* Hinweise (mit Streckenbereich -> anklickbar) */
  var H = [];
  function add(l, txt, x0, x1) { H.push({ l: l, t: txt, x0: x0 == null ? null : x0, x1: x1 == null ? x0 : x1 }); }
  var now = new Date(), isToday = P.date === now.getFullYear() + "-" + p2(now.getMonth() + 1) + "-" + p2(now.getDate());
  if (isToday && R.depMin < now.getHours() * 60 + now.getMinutes() - 10) add("warn", "Abflugzeit liegt in der Vergangenheit.");
  R.conflicts.forEach(function (c) {
    add("bad", "<b>Kein sicherer H\u00f6henkorridor:</b> " + CAUSE[c.cause] + " <small>\u2013 NM " + Math.round(c.x0) + "\u2013" + Math.round(c.x1) + " (~" + fmtH(sampleAt(R, c.x0).t) + ")</small>", c.x0, c.x1);
  });
  if (G.sun) {
    if (R.dawn) add("bad", "Abflug " + fmtH(R.depMin) + " vor Sonnenaufgang (" + fmtH(G.sun.depRise * 60) + ") \u2013 nur mit NVFR-Berechtigung.");
    if (R.night) add("bad", "Ankunft " + fmtH(R.arrMin) + " nach Sonnenuntergang (" + fmtH(G.sun.destSet * 60) + ") \u2013 nur mit NVFR-Berechtigung.", D);
    else if (R.dusk) add("warn", "Weniger als 30 min Tageslichtreserve (Sonnenuntergang Ziel " + fmtH(G.sun.destSet * 60) + ").", D);
  }
  R.circles.forEach(function (c) {
    var lv = c.min > 6 ? "warn" : "info";
    if (c.x < 0.6) add(lv, "<b>Steigflug:</b> Gel\u00e4nde voraus erfordert, \u00fcber dem Platz/Tal kreisend auf ~" + (Math.ceil(c.to / 100) * 100) + " ft MSL zu steigen (" + P.climb + " ft/min, ~" + Math.round(c.min) + " min), bevor die Strecke angetreten wird.", 0, 1.5);
    else add(lv, "<b>Kreisend steigen</b> bei NM " + Math.round(c.x) + " (~" + fmtH(sampleAt(R, c.x).t) + ") von ~" + fmtFt(c.from) + " auf ~" + (Math.ceil(c.to / 100) * 100) + " ft MSL (~" + Math.round(c.min) + " min) \u2013 das Gel\u00e4nde danach steigt schneller als der Steigflug.", c.x - 0.5, c.x + 0.5);
  });
  var o2min = 0, hiAlt = 0;
  for (var oi = 1; oi < R.samples.length; oi++) { var qo = R.samples[oi]; hiAlt = Math.max(hiAlt, qo.p); if (qo.p > 10000) o2min += qo.t - R.samples[oi - 1].t; }
  if (hiAlt > 13000) add("bad", "<b>Sauerstoff:</b> Route f\u00fchrt \u00fcber 13.000 ft \u2013 dort ist Sauerstoff Pflicht (EASA NCO.OP.190).");
  else if (o2min > 30) add("warn", "<b>Sauerstoff:</b> ~" + Math.round(o2min) + " min \u00fcber 10.000 ft \u2013 ab 30 min ist Sauerstoff Pflicht (EASA NCO.OP.190). Max. H\u00f6he auf 10.000 ft senken oder Sauerstoff mitf\u00fchren.");
  else if (o2min > 0) add("info", "~" + Math.round(o2min) + " min \u00fcber 10.000 ft (unter 30 min ohne Sauerstoff zul\u00e4ssig) \u2013 auf Hypoxie-Anzeichen achten.");
  if (R.spiralMin > 0) add(R.spiralMin > 6 ? "warn" : "info", "<b>Sinkflug:</b> Gel\u00e4nde vor dem Ziel erlaubt erst sp\u00e4t zu sinken \u2013 Ankunft \u00fcber dem Platz in ~" +
    fmtFt(R.samples[R.samples.length - 1].p) + " ft, dann im Tal auf Platzrundenh\u00f6he sinken (~" + Math.round(R.spiralMin) + " min).", D - 1.5, D);
  R.entries.forEach(function (x) {
    var a = x.as, nm = esc(a.name), lim = fmtLimit(a.lower) + " \u2013 " + fmtLimit(a.upper);
    var where = "NM " + Math.round(x.x0) + " (~" + fmtH(x.t0) + ")";
    var reqX = Math.max(0, x.x0 - 10), req = "NM " + Math.round(reqX) + " (~" + fmtH(sampleAt(R, reqX).t) + ")";
    var at = actTxt(a), atx = at ? " <b>" + at + "</b> \u2013 NOTAM/FIS pr\u00fcfen." : "";
    if (!x.inside) { if (a.kind === "clearance") add("info", "Unter <b>" + nm + "</b> bleiben: Untergrenze ~" + fmtFt(x.lo) + " ft MSL, geplant bis " + fmtFt(x.alt) + " ft.", x.x0, x.x1); return; }
    if (a.kind === "forbidden") add("bad", "<b>" + nm + "</b> (" + (TYPE_TXT[a.type] || clsTxt(a)) + ", " + lim + ") wird bei " + where + " ber\u00fchrt \u2013 so nicht zul\u00e4ssig." + atx, x.x0, x.x1);
    else if (a.kind === "clearance") {
      if (x.x0 < 0.6) add("warn", "<b>Freigabe Abflug</b> aus <b>" + nm + "</b> (" + clsTxt(a) + ", " + lim + "): vor dem Rollen beim Turm einholen" + freqTxt(a) + ".", x.x0, x.x1);
      else if (x.x1 > D - 0.6) add("warn", "<b>Freigabe Ziel</b> <b>" + nm + "</b> (" + clsTxt(a) + ", " + lim + "): sp\u00e4testens bei " + req + " anfordern, Einflug \u00fcber Pflichtmeldepunkt laut Sichtanflugkarte" + freqTxt(a) + ".", x.x0, x.x1);
      else add("warn", "<b>Freigabe</b> <b>" + nm + "</b> (" + clsTxt(a) + ", " + lim + "): Einflug bei " + where + " \u2013 sp\u00e4testens bei " + req + " anfordern" + freqTxt(a) + ".", x.x0, x.x1);
    } else if (a.kind === "danger" || a.kind === "tra") add("warn", "Durchflug <b>" + nm + "</b> (" + (TYPE_TXT[a.type] || "") + ", " + lim + ") ab " + where + ":" + (atx || " Aktivierung per NOTAM/FIS pr\u00fcfen."), x.x0, x.x1);
    else if (a.kind === "tmz") add("info", "<b>" + nm + "</b> ab " + where + ": Transponder (Mode S, ALT) einschalten.", x.x0, x.x1);
    else if (a.kind === "rmz") add("info", "<b>" + nm + "</b> ab " + where + ": Funkkontakt/H\u00f6rbereitschaft erforderlich" + freqTxt(a) + ".", x.x0, x.x1);
    else if (a.type === 19 || a.type === 29 || a.type === 21) add("info", "<b>" + nm + "</b> (" + TYPE_TXT[a.type] + ") ab " + where + ": Auflagen/Mindesth\u00f6hen laut AIP beachten." + atx, x.x0, x.x1);
  });
  var acc = {}, order = [];
  R.rs.forEach(function (r, idx) {
    function put(key, lvl, txt) {
      var o = acc[key];
      if (!o) { acc[key] = { l: lvl, t: txt, a: r.x0, b: r.x1, ta: r.tStart }; order.push(key); }
      else { o.b = r.x1; if (lvl === "bad") o.l = "bad"; }
    }
    if (r.terrainHigh) put("terr", "bad", "Gel\u00e4nde ~" + fmtFt(r.e.tmax) + " ft + Abstand \u00fcbersteigt max. Flugh\u00f6he " + P.maxAlt + " ft");
    if (isFinite(r.minCloud) && r.minCloud >= 0 && r.minCloud < 1000) put("cc", "warn", "Wolkenabstand nur ~" + fmtFt(r.minCloud) + " ft");
    if (r.semi === "no") put("semi", "info", "Halbkreisflugh\u00f6he nicht einhaltbar (Wetter/Gel\u00e4nde/Luftraum), geplant " + r.alt + " ft");
    var fz = Math.min(r.wa ? r.wa.fz : Infinity, r.wb ? r.wb.fz : Infinity), pr = Math.max(r.wa ? r.wa.prec : 0, r.wb ? r.wb.prec : 0);
    if (r.alt >= fz - 500 && (r.minCloud < 2000 || pr >= 0.2)) put("ice", "warn", "<b>Vereisungsgefahr</b> bei Wolken-/Niederschlagskontakt: Nullgradgrenze ~" + fmtFt(fz) + " ft");
    (idx === 0 ? [r.wa, r.wb] : [r.wb]).forEach(function (w) {
      if (!w) { put("nowx", "bad", "Keine Wetterdaten (au\u00dferhalb Modellhorizont/Tag)"); return; }
      w.reasons.forEach(function (x) { put("w:" + x[1].replace(/[\d.,]+/g, "#"), x[0], x[1]); });
    });
  });
  order.forEach(function (key) {
    var o = acc[key];
    add(o.l, o.t + " <small>\u2013 NM " + Math.round(o.a) + (Math.round(o.b) !== Math.round(o.a) ? "\u2013" + Math.round(o.b) : "") + " (ab ~" + fmtH(o.ta) + ")</small>", o.a, o.b);
  });
  R.fields = [{ apt: G.A, elev: G.depElev, t: R.depMin, w: R.rs[0].wa }, { apt: G.B, elev: G.destElev, t: R.arrMin, w: R.rs[R.rs.length - 1].wb }].map(function (f) {
    var ns = nearestStn(f.apt, 15), T = f.w ? f.w.T : null, qnh = G.qnh;
    if (ns && ns.s.metar) {
      if (ns.s.metar.qnh) qnh = ns.s.metar.qnh;
      if (Math.abs(f.t - (Date.now() / 60000 - G.t0 / 60)) < 120 && ns.s.metar.temp != null) T = ns.s.metar.temp;
    }
    f.stn = ns; f.qnh = qnh; f.T = T; f.da = T != null ? densAlt(f.elev, T, qnh) : null;
    if (f.da != null && f.da - f.elev > 2000) add("warn", "Dichteh\u00f6he " + esc(f.apt.icao || f.apt.name) + " ~" + fmtFt(f.da) + " ft \u2013 Start-/Landestrecke und Steigleistung pr\u00fcfen.");
    return f;
  });
  if (G.airFailed && G.airFailed.length) add("bad", "Luftraumdaten f\u00fcr " + G.airFailed.join(", ") + " fehlen \u2013 Lufträume dort NICHT gepr\u00fcft!");
  add("info", "Tempor\u00e4re Luftraumbeschr\u00e4nkungen und Aktivierungen per NOTAM sind nicht enthalten \u2013 NOTAM vor dem Flug pr\u00fcfen.");
  var ord = { bad: 0, warn: 1, info: 2, ok: 3 };
  H.sort(function (a, b) { return ord[a.l] - ord[b.l]; });
  R.hints = H;
  R.alts = (RES.apts || []).filter(function (a) {
    return [4, 7, 8, 10].indexOf(a.type) < 0 && distNm(a, G.A) > 1 && distNm(a, G.B) > 1;
  }).map(function (a) {
    var best = { d: 1e9, x: 0 };
    R.rs.forEach(function (r) { var q = segDist(a, G.nodes[r.e.a], G.nodes[r.e.b]); if (q.d < best.d) best = { d: q.d, x: r.x0 + q.t * r.e.len }; });
    return { a: a, d: best.d, x: best.x };
  }).filter(function (o) { return o.d <= 10; }).sort(function (p, q) { return p.x - q.x; }).slice(0, 14);
  var bands = {};
  R.rs.forEach(function (r) {
    r.e.hits.forEach(function (h) {
      if (["forbidden", "danger", "tra", "clearance", "tmz", "rmz"].indexOf(h.as.kind) < 0 || !isFinite(h.lo)) return;
      var x0 = r.x0 + h.f0 * r.e.len, x1 = r.x0 + h.f1 * r.e.len, o = bands[h.as.id];
      if (!o) bands[h.as.id] = { as: h.as, x0: x0, x1: x1, lo: h.lo, hi: h.hi };
      else { o.x0 = Math.min(o.x0, x0); o.x1 = Math.max(o.x1, x1); o.lo = Math.min(o.lo, h.lo); o.hi = Math.max(o.hi, h.hi); }
    });
  });
  R.bands = Object.keys(bands).map(function (kk) { return bands[kk]; });
  var ag = 0, an = 0;
  R.rs.forEach(function (r) { [r.wa, r.wb].forEach(function (w) { if (w) { ag += w.agree; an++; } }); });
  var agree = an ? ag / an : 0, leadH = (G.t0 + R.depMin * 60 - Date.now() / 1000) / 3600;
  var lead = leadH <= 12 ? 1 : leadH <= 24 ? 0.93 : leadH <= 48 ? 0.85 : leadH <= 72 ? 0.75 : leadH <= 120 ? 0.6 : 0.45;
  var compl = G.modelsOk.length / MODELS.length, offN = 0;
  [R.rs[0].wa, R.rs[R.rs.length - 1].wb].forEach(function (w) { if (w && w.off) offN++; });
  R.conf = { v: Math.max(5, Math.min(99, Math.round(100 * agree * lead * Math.sqrt(compl) * (0.88 + 0.06 * offN)))), agree: agree, lead: lead, leadH: leadH, compl: compl, offN: offN };
}

/* ==================== 13. Ablauf ==================== */
async function plan() {
  var A = S.from, B = S.to;
  if (!A || !B) { setSts("Bitte Start und Ziel aus der Vorschlagsliste w\u00e4hlen.", "err"); return; }
  var P = readP(); saveSettings();
  var d = distNm(A, B);
  if (d < 3) { setSts("Start und Ziel liegen zu nah beieinander.", "err"); return; }
  if (d > 250) { setSts("Strecke " + Math.round(d) + " NM \u2013 maximal 250 NM. Bitte mit Zwischenlandung planen.", "err"); return; }
  if (!P.date) { setSts("Bitte Datum w\u00e4hlen.", "err"); return; }
  $("go").disabled = true; hlLayer.clearLayers();
  try {
    setSts("1/6 Gel\u00e4nde laden \u2026");
    var G = buildGraph(A, B, d);
    var w = 180, s = 90, e = -180, n = -90;
    G.nodes.forEach(function (q) { w = Math.min(w, q.lon); e = Math.max(e, q.lon); s = Math.min(s, q.lat); n = Math.max(n, q.lat); });
    await ensureDem(w - 0.07, s - 0.05, e + 0.07, n + 0.05, d <= 160 ? 10 : 9);
    G.depElev = A.elevFt != null ? A.elevFt : (elevFt(A.lat, A.lon) || 0);
    G.destElev = B.elevFt != null ? B.elevFt : (elevFt(B.lat, B.lon) || 0);
    setSts("2/6 Lufträume, Flugpl\u00e4tze, METAR/TAF \u2026");
    var bw = w - 0.2, bs = s - 0.2, be = e + 0.2, bn = n + 0.2;
    var awxKey = [Math.floor((bs - 0.1) * 2) / 2, Math.floor((bw - 0.1) * 2) / 2, Math.ceil((bn + 0.1) * 2) / 2, Math.ceil((be + 0.1) * 2) / 2].join(",");
    var got = await Promise.all([
      dataIn("asp", bw, bs, be, bn),
      dataIn("apt", bw, bs, be, bn).catch(function () { return { list: [], failed: [] }; }),
      fetchJSON("/awx?bbox=" + awxKey, 2).catch(function () { return { metar: [], taf: [] }; })
    ]);
    G.airFailed = got[0].failed;
    if (!got[0].list.length && got[0].failed.length) throw new Error("Luftraumdaten nicht verf\u00fcgbar (" + got[0].failed.join(", ") + ") \u2013 ohne Luftraumpr\u00fcfung wird nicht geplant. Sp\u00e4ter erneut versuchen.");
    STN = buildStations(got[2]);
    var qs = STN.map(function (x) { return x.metar && x.metar.qnh; }).filter(Boolean);
    G.qnh = qs.length ? avg(qs) : 1013.25; G.qnhKnown = qs.length > 0;
    setSts("3/6 Streckennetz analysieren (" + G.edges.length + " Teilstrecken) \u2026");
    await sleep(20);
    G.edges.forEach(function (ed) { edgeStatic(G, ed, got[0].list); });
    setSts("4/6 Wetter von " + MODELS.length + " Modellen (" + G.wpts.length + " Wetterpunkte) \u2026");
    G.t0 = new Date(P.date + "T00:00:00").getTime() / 1000;
    var res = await Promise.all(MODELS.map(function (m, mi) { return fetchModel(mi, G.wpts, P.date).then(function (x) { return x; }, function () { return null; }); }));
    G.wx = res; G.modelsOk = []; G.modelsFail = [];
    res.forEach(function (x, mi) { (x ? G.modelsOk : G.modelsFail).push(MODELS[mi].l); });
    if (!G.modelsOk.length) throw new Error("Kein Wettermodell lieferte Daten (Datum zu weit in der Zukunft oder Netzwerkproblem).");
    G.sun = await fetchSun(A, B, P.date).catch(function () { return null; });
    setSts("5/6 Routen berechnen \u2026");
    await sleep(20);
    RES = { G: G, P: P, apts: got[1].list || [], routes: [], hl: null };
    RES.routes = computeRoutes(G, P);
    setSts("6/6 Beste Abflugzeit ermitteln \u2026");
    await sleep(20);
    RES.opt = optimizer(G, P);
    RES.fitted = false;
    render(0);
    if (MOB.on) showPane("main");
    setSts("Fertig \u00b7 Modelle: " + G.modelsOk.join(", ") + (G.modelsFail.length ? " \u00b7 ohne Daten: " + G.modelsFail.join(", ") : ""));
  } catch (err) {
    setSts("Fehler: " + esc(err.message), "err");
  } finally {
    $("go").disabled = false;
  }
}

/* ==================== 14. Darstellung ==================== */
function verdictText(c) { return ["GUT FLIEGBAR (Prognose)", "EINGESCHR\u00c4NKT \u2013 nur mit Reserven", "KRITISCH \u2013 Flug nicht empfohlen"][c]; }
function nodePopup(w, x, tMin, title) {
  var head = "<b class='h'>" + (title ? esc(title) + " \u00b7 " : "") + "NM " + Math.round(x) + " \u00b7 " + fmtH(tMin) + "</b> ";
  if (!w) return "<div class='pop'>" + head + "<br>Keine Wetterdaten verf\u00fcgbar.</div>";
  function row(k, v) { return "<tr><td>" + k + "</td><td>" + v + "</td></tr>"; }
  var bAgl = isFinite(w.base) ? w.base - w.elevFt : null;
  var h = "<div class='pop'>" + head + catTag(w.cat) + "<table>";
  h += row("Wolkenbasis", isFinite(w.base) ? "~" + fmtFt(w.base) + " ft MSL (~" + fmtFt(bAgl) + " ft \u00fcber Grund)<br><small>" + esc(w.baseModel || "") + "</small>" : "keine Wolkendecke (BKN+) erwartet");
  h += row("Sicht", fmtVis(w.visKm) + (w.visSrc ? " <small>(" + esc(w.visSrc) + ")</small>" : (w.visEstAny ? " <small>(teils gesch\u00e4tzt)</small>" : "")));
  h += row("Gewitter-Index", w.ts + " %");
  h += row("B\u00f6en (Boden)", Math.round(w.gust) + " kt");
  h += row("Niederschlag", w.prec.toFixed(1) + " mm/h");
  h += row("Wind 850 hPa", w.ws != null ? deg3(w.wd) + "\u00b0 / " + Math.round(w.ws) + " kt" : "\u2013");
  h += row("Temp / Taupunkt", Math.round(w.T) + " / " + Math.round(w.Td) + " \u00b0C");
  h += row("Nullgradgrenze", "~" + fmtFt(w.fz) + " ft MSL");
  if (w.off) h += row("Amtlich", esc(w.off.src));
  h += "</table><table class='mt'><tr><td><b>Modell</b></td><td><b>Basis MSL</b></td><td><b>Sicht</b></td><td><b>TS</b></td></tr>";
  w.recs.forEach(function (r) {
    h += "<tr><td>" + esc(MODELS[r.mi].l) + "</td><td>" + (isFinite(r.baseMsl) ? fmtFt(r.baseMsl) + (r.baseHow === "Taupunkt" ? "\u00b9" : "") : "\u2013") + "</td><td>" +
      fmtVis(r.visKm) + (r.visEst ? "*" : "") + "</td><td>" + r.ts + " %</td></tr>";
  });
  h += "</table>";
  if (w.reasons.length) h += "<div style='margin-top:4px'>" + w.reasons.map(function (q) { return "\u2022 " + esc(q[1]); }).join("<br>") + "</div>";
  h += "<div style='font-size:10.5px;color:#61717F;margin-top:3px'>Basis/Sicht/Gewitter/B\u00f6en: zweitschlechtestes Modell \u00b7 \u00b9 aus Taupunkt \u00b7 * Sicht gesch\u00e4tzt</div></div>";
  return h;
}
function render(sel) {
  var G = RES.G, P = RES.P, R = RES.routes[sel];
  RES.sel = sel; RES.hl = null; hlLayer.clearLayers();
  RES.routes.forEach(function (x) { finalize(x, G, P); });
  var h = "<div class='verdict " + CAT_CLS[R.cat] + "'><div class='big'>" + verdictText(R.cat) + "</div><div class='meta'>" +
    esc(R.name) + " \u00b7 Sicherheitswert " + R.score + "/100 \u00b7 Vertrauen " + R.conf.v + " %</div></div>";
  h += whyHtml();
  h += "<div class='card'><h3>Routen-Varianten</h3>";
  RES.routes.forEach(function (x, k) {
    var det = Math.round((x.D / G.d - 1) * 100);
    h += "<div class='ropt" + (k === sel ? " sel" : "") + "' data-r='" + k + "' style='border-left-color:" + CAT_COL[x.cat] + "'><b>" + esc(x.name) + "</b>" + catTag(x.cat) +
      "<small>" + x.D.toFixed(0) + " NM" + (det > 0 ? " (+" + det + " %)" : "") + " \u00b7 " + Math.round(x.ete) + " min \u00b7 Reiseh\u00f6he bis " + x.cruiseMax + " ft \u00b7 " +
      (x.clr ? x.clr + " Freigabe" + (x.clr > 1 ? "n" : "") : "keine Freigabe") + " \u00b7 Wert " + x.score + "</small></div>";
  });
  h += "</div>";
  h += "<div class='card'><h3>Hinweise &amp; Freigaben <span style='text-transform:none;letter-spacing:0;font-weight:400'>(anklicken = auf Karte zeigen)</span></h3>" +
    R.hints.map(function (x, k) { return "<div class='hint " + x.l + (x.x0 != null ? " clk" : "") + "'" + (x.x0 != null ? " data-hi='" + k + "'" : "") + ">" + x.t + "</div>"; }).join("") + "</div>";
  h += "<div class='card'><h3>Kennzahlen</h3><div class='kv'>" +
    "<span>Abflug \u2192 Ankunft</span><b>" + fmtH(R.depMin) + " \u2192 " + fmtH(R.arrMin) + " (" + Math.round(R.ete) + " min)</b>" +
    "<span>Distanz</span><b>" + R.D.toFixed(1) + " NM (direkt " + G.d.toFixed(1) + ")</b>" +
    "<span>Min. Gel\u00e4ndeabstand</span><b>" + (isFinite(R.minTerr) ? fmtFt(R.minTerr) + " ft" : "\u2013") + "</b>" +
    "<span>Min. Wolkenabstand</span><b>" + (isFinite(R.minCloud) ? fmtFt(R.minCloud) + " ft" : "keine Wolkendecke") + "</b>" +
    "<span>Gr\u00f6\u00dftes Wetterrisiko</span><b>" + Math.round(R.maxRisk * 100) + " %</b>" +
    "<span>Steig-/Sinkrate</span><b>" + P.climb + " / " + P.desc + " ft/min</b>" +
    "<span>QNH (Umrechnung FL)</span><b>" + Math.round(G.qnh) + " hPa" + (G.qnhKnown ? "" : " (Standard \u2013 keine METARs)") + "</b>" +
    (G.sun ? "<span>Sonne Start / Ziel</span><b>\u2191 " + fmtH(G.sun.depRise * 60) + " \u00b7 \u2193 " + fmtH(G.sun.destSet * 60) + "</b>" : "") +
    "</div></div>";
  h += "<div class='card'><h3>Navigationslog</h3><div class='navwrap'><table class='nav'><tr><th>Strecke</th><th>MK</th><th>MH</th><th>NM</th><th>Reiseh.</th><th>Wind</th><th>GS</th><th>min</th><th>ETO</th></tr>";
  R.legs.forEach(function (l) {
    h += "<tr><td><span style='color:" + CAT_COL[l.cat] + "'>\u25cf</span> " + esc(l.from) + "\u2192" + esc(l.to) + "</td><td>" + deg3(l.mc) + "</td><td>" + deg3(l.mh) +
      "</td><td>" + l.dist.toFixed(1) + "</td><td>" + l.alt + "</td><td>" + (l.wind ? deg3(l.wind.wd) + "/" + Math.round(l.wind.ws) : "\u2013") +
      "</td><td>" + Math.round(l.gs) + "</td><td>" + Math.round(l.mins) + "</td><td>" + fmtH(l.eto) + "</td></tr>";
  });
  h += "</table></div><div class='note' style='margin-top:6px'>Reiseh\u00f6he je Abschnitt; Steig-/Sinkfl\u00fcge siehe Profil. MK/MH magnetisch (" + MAGVAR + "\u00b0 O), Wind 850 hPa, Zeiten lokal" +
    (R.circMin > 0 ? ", inkl. ~" + Math.round(R.circMin) + " min Kreisen am Start" : "") + (R.spiralMin > 0 ? ", inkl. ~" + Math.round(R.spiralMin) + " min Sinken am Ziel" : "") + ".</div></div>";
  if (RES.opt && RES.opt.length) {
    h += "<div class='card noprint'><h3>Beste Abflugzeit (" + esc(P.date.split("-").reverse().join(".")) + ")</h3><div class='opt'>";
    RES.opt.forEach(function (o) {
      h += "<div data-h='" + o.h + "' class='" + (Math.floor(P.depH) === o.h ? "cur" : "") + "' title='" + p2(o.h) + ":00 \u2013 " + CAT_TXT[o.cat] + ", Wert " + o.score +
        "' style='height:" + Math.max(6, o.score) + "%;background:" + CAT_COL[o.cat] + "'><span>" + o.h + "</span></div>";
    });
    h += "</div><div class='note'>Beste Route je volle Abflugstunde (nur Tageslicht). Balken anklicken = Zeit \u00fcbernehmen und neu berechnen.</div></div>";
  }
  h += "<div class='card'><h3>Start- &amp; Zielplatz</h3>";
  R.fields.forEach(function (f, k) {
    h += "<div style='margin-top:" + (k ? "10px" : "0") + "'><b>" + esc((f.apt.icao ? f.apt.icao + " \u2013 " : "") + f.apt.name) + "</b> <small style='color:#61717F'>" +
      fmtFt(f.elev) + " ft \u00b7 " + (k ? "Ankunft " : "Abflug ") + fmtH(f.t) + (f.da != null ? " \u00b7 Dichteh\u00f6he ~" + fmtFt(f.da) + " ft" : "") + "</small>";
    if (f.stn) {
      var st = f.stn.s;
      h += "<div style='font-size:11.5px;color:#61717F;margin-top:3px'>" + esc(st.id) + (f.stn.d > 1 ? " (" + f.stn.d.toFixed(0) + " NM entfernt)" : "") + "</div>";
      if (st.metar) h += "<div class='mono'>" + esc(st.metar.raw) + "</div>";
      if (st.taf) h += "<div class='mono'>" + esc(st.taf.raw) + "</div>";
    } else h += "<div class='note' style='margin-top:3px'>Keine METAR/TAF-Station im Umkreis von 15 NM.</div>";
    h += "</div>";
  });
  h += "</div>";
  h += "<div class='card'><h3>Ausweichpl\u00e4tze entlang der Route (\u226410 NM)</h3>";
  if (!R.alts.length) h += "<div class='note' style='margin-top:0'>Keine gefunden.</div>";
  else h += "<table class='nav'><tr><th>Platz</th><th>bei NM</th><th>seitl. NM</th><th>Elev ft</th></tr>" + R.alts.map(function (o) {
    return "<tr><td>" + esc((o.a.icao ? o.a.icao + " " : "") + o.a.name) + "</td><td>" + Math.round(o.x) + "</td><td>" + o.d.toFixed(1) + "</td><td>" + (o.a.elevFt != null ? o.a.elevFt : "\u2013") + "</td></tr>";
  }).join("") + "</table><div class='note'>Status, \u00d6ffnungszeiten und PPR immer im AIP pr\u00fcfen.</div>";
  h += "</div>";
  h += "<div class='card noprint'><h3>Export</h3><div class='btnrow'><button class='btn2' id='bSky'>SkyDemon (.flightplan, mit H\u00f6hen)</button><button class='btn2' id='bGpx'>GPX</button>" +
    "<button class='btn2' id='bPrint'>Drucken</button><button class='btn2' id='bWindy'>Windy-Routenplaner (VFR)</button></div>" +
    "<div class='note'><b>SkyDemon:</b> Die .flightplan-Datei enth\u00e4lt die Reiseh\u00f6he je Abschnitt (in SkyDemon \u00f6ffnen). GPX \u00fcbertr\u00e4gt nur Wegpunkte \u2013 SkyDemon ignoriert dort H\u00f6hen, deshalb stehen sie im Wegpunktnamen (z.\u202fB. \u201eWP3 9000FT\u201c).<br><b>Windy:</b> \u00f6ffnet den VFR-Routenplaner mit diesen Wegpunkten (nur Desktop-Browser). Abflugzeit \u00fcber die Zeitleiste unten verschieben; mit Windy-Login l\u00e4sst sich die Route als Favorit speichern.</div></div>";
  var c = R.conf;
  h += "<div class='card'><h3>Datenbasis &amp; Vertrauen " + c.v + " %</h3><div class='kv'>" +
    "<span>Modell-\u00dcbereinstimmung</span><b>" + Math.round(c.agree * 100) + " %</b>" +
    "<span>Vorlaufzeit</span><b>" + (c.leadH > 0 ? Math.round(c.leadH) + " h" : "jetzt") + " (Faktor " + c.lead.toFixed(2) + ")</b>" +
    "<span>Modelle verf\u00fcgbar</span><b>" + G.modelsOk.length + " / " + MODELS.length + "</b>" +
    "<span>METAR/TAF Start/Ziel</span><b>" + c.offN + " / 2</b>" +
    "<span>Netz / Wetterpunkte</span><b>" + G.nodes.length + " / " + G.wpts.length + "</b>" +
    "<span>Modelle</span><b style='font-weight:400'>" + esc(G.modelsOk.join(", ")) +
    (G.modelsFail.length ? "<br><i style='color:#C0392B;font-style:normal'>ohne Daten: " + esc(G.modelsFail.join(", ")) + "</i>" : "") + "</b>" +
    "</div></div>";
  $("out").innerHTML = h;
  drawMap(sel);
  drawProfile(R);
  if (MOB.on) {
    var ch = $("mchip");
    ch.textContent = CAT_TXT[R.cat] + " \u00b7 " + R.name + " \u00b7 " + Math.round(R.D) + " NM \u00b7 " + Math.round(R.ete) + " min";
    ch.style.background = CAT_COL[R.cat];
    $("profSum").innerHTML = "<b>" + esc(R.name) + "</b> \u00b7 " + CAT_TXT[R.cat] + " \u00b7 " + Math.round(R.D) + " NM \u00b7 Reiseh\u00f6he bis " + R.cruiseMax + " ft<br>Profil seitlich wischen \u2192";
    Array.prototype.forEach.call(document.querySelectorAll("#mnav button"), function (b) { b.disabled = false; });
  }
}
function highlight(k) {
  var R = RES.routes[RES.sel], G = RES.G, hi = R.hints[k];
  hlLayer.clearLayers();
  Array.prototype.forEach.call(document.querySelectorAll(".hint.act"), function (el) { el.classList.remove("act"); });
  if (!hi || hi.x0 == null || RES.hlIdx === k) { RES.hl = null; RES.hlIdx = null; drawProfile(R); return; }
  var el = document.querySelector("[data-hi='" + k + "']"); if (el) el.classList.add("act");
  RES.hlIdx = k;
  var a = Math.max(0, hi.x0 - 0.5), b = Math.min(R.D, Math.max(hi.x1, hi.x0) + 0.5);
  RES.hl = { a: a, b: b };
  var pts = R.samples.filter(function (q) { return q.x >= a - 1e-6 && q.x <= b + 1e-6; }).map(function (q) { return [q.lat, q.lon]; });
  if (pts.length >= 2) {
    L.polyline(pts, { color: "#0F1D2A", weight: 14, opacity: 0.35, interactive: false }).addTo(hlLayer);
    L.polyline(pts, { color: "#FFD400", weight: 6, dashArray: "10 8", interactive: false }).addTo(hlLayer);
    map.fitBounds(L.latLngBounds(pts).pad(0.8), { maxZoom: 11 });
  } else {
    var q = sampleAt(R, hi.x0);
    L.circleMarker([q.lat, q.lon], { radius: 16, color: "#FFD400", weight: 4, fill: false, interactive: false }).addTo(hlLayer);
    map.setView([q.lat, q.lon], Math.max(map.getZoom(), 10));
  }
  drawProfile(R);
}
function onOutClick(e) {
  var r = e.target.closest("[data-r]");
  if (r) { render(+r.getAttribute("data-r")); return; }
  var b = e.target.closest("[data-h]");
  if (b) { $("dTime").value = p2(+b.getAttribute("data-h")) + ":00"; plan(); return; }
  var hi = e.target.closest("[data-hi]");
  if (hi) {
    var hk = +hi.getAttribute("data-hi");
    if (MOB.on) { showPane("main"); setTimeout(function () { highlight(hk); }, 120); } else highlight(hk);
    return;
  }
  if (!RES) return;
  var R = RES.routes[RES.sel];
  if (e.target.id === "bGpx") exportGpx(R);
  if (e.target.id === "bSky") exportSkyDemon(R);
  if (e.target.id === "bPrint") window.print();
  if (e.target.id === "bWindy") {
    var c = lerp(RES.G.A, RES.G.B, 0.5);
    var url = "https://www.windy.com/distance/vfr/" + R.wps.map(function (w) { return w.lat.toFixed(4) + "," + w.lon.toFixed(4); }).join(";") +
      "?clouds," + c.lat.toFixed(3) + "," + c.lon.toFixed(3) + ",8";
    window.open(url, "_blank");
  }
}
function drawMap(sel) {
  var G = RES.G, R = RES.routes[sel], nb = { bubblingMouseEvents: false };
  routeLayer.clearLayers();
  RES.routes.forEach(function (x, k) {
    if (k === sel) return;
    L.polyline(x.coords, { color: "#4A5A68", weight: 3, opacity: 0.75, dashArray: "6 7", bubblingMouseEvents: false })
      .bindTooltip(esc(x.name) + " \u2013 " + CAT_TXT[x.cat] + " (anklicken)").on("click", function () { render(k); }).addTo(routeLayer);
  });
  R.rs.forEach(function (r) {
    var a = G.nodes[r.e.a], b = G.nodes[r.e.b];
    L.polyline([[a.lat, a.lon], [b.lat, b.lon]], { color: "#fff", weight: 9, opacity: 0.85, interactive: false }).addTo(routeLayer);
    L.polyline([[a.lat, a.lon], [b.lat, b.lon]], { color: CAT_COL[r.cat], weight: 5.5, bubblingMouseEvents: false })
      .bindTooltip("Reiseh\u00f6he " + r.alt + " ft \u00b7 " + CAT_TXT[r.cat]).addTo(routeLayer);
  });
  R.wps.forEach(function (w, k) {
    if (k === 0 || k === R.wps.length - 1) return;
    var q = sampleAt(R, w.x), r = R.rs[q.ri];
    L.circleMarker([w.lat, w.lon], { radius: 5.5, color: "#fff", weight: 1.5, fillColor: CAT_COL[r.cat], fillOpacity: 1, bubblingMouseEvents: false })
      .bindPopup(nodePopup(r.wa, w.x, w.t, w.name), { maxWidth: 380 }).addTo(routeLayer);
  });
  [[G.A, R.rs[0].wa, 0, R.depMin], [G.B, R.rs[R.rs.length - 1].wb, R.D, R.arrMin]].forEach(function (q) {
    L.circleMarker([q[0].lat, q[0].lon], { radius: 8, color: "#fff", weight: 2.5, fillColor: "#0F1D2A", fillOpacity: 1, bubblingMouseEvents: false })
      .bindTooltip(esc(q[0].icao || q[0].name), { permanent: true, direction: "top", offset: [0, -9] })
      .bindPopup(nodePopup(q[1], q[2], q[3], q[0].icao || q[0].name), { maxWidth: 380 }).addTo(routeLayer);
  });
  R.entries.forEach(function (x) {
    if (!x.inside || x.as.kind !== "clearance" || x.x0 < 0.6) return;
    var q = sampleAt(R, x.x0);
    L.circleMarker([q.lat, q.lon], { radius: 7, color: "#fff", weight: 2, fillColor: "#1F5FA8", fillOpacity: 1, bubblingMouseEvents: false })
      .bindTooltip("Freigabe: " + esc(x.as.name) + " (~" + fmtH(x.t0) + ")").addTo(routeLayer);
  });
  R.alts.forEach(function (o) {
    L.circleMarker([o.a.lat, o.a.lon], { radius: 4, color: "#1F7A4C", weight: 2, fillColor: "#fff", fillOpacity: 1, bubblingMouseEvents: false })
      .bindTooltip("Ausweichplatz: " + esc((o.a.icao ? o.a.icao + " " : "") + o.a.name)).addTo(routeLayer);
  });
  if (!RES.fitted) {
    RES.fitBox = L.latLngBounds(RES.routes.reduce(function (a, x) { return a.concat(x.coords); }, [])).pad(0.12);
    if (MOB.on && !$("main").classList.contains("on")) RES.needFit = true; else map.fitBounds(RES.fitBox);
    RES.fitted = true;
  }
}
function drawProfile(R) { $("profBody").innerHTML = profSvg(R); $("prof").style.display = "block"; }
function isMob() { return window.matchMedia("(max-width:860px)").matches; }
/* Handy: vier Seiten (Planen / Karte / Profil / Ergebnis) mit Leiste unten */
var MOB = { on: false };
function setupMobile() {
  MOB.on = true;
  $("side").classList.add("pane");
  $("main").classList.add("pane");
  var pr = document.createElement("div"); pr.id = "pRes"; pr.className = "pane"; document.body.appendChild(pr); pr.appendChild($("out"));
  var pp = document.createElement("div"); pp.id = "pProf"; pp.className = "pane"; document.body.appendChild(pp);
  pp.innerHTML = "<div id='profSum' class='note' style='margin:0 0 8px'>Noch keine Route berechnet.</div>";
  pp.appendChild($("prof"));
  $("legend").classList.add("col"); $("lgA").innerHTML = "&#9656;";
  $("mnav").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b && !b.disabled) showPane(b.getAttribute("data-p")); });
  $("mchip").addEventListener("click", function () { showPane("pRes"); });
  showPane("side");
}
function showPane(id) {
  if (!MOB.on) return;
  ["side", "main", "pProf", "pRes"].forEach(function (p) { $(p).classList.toggle("on", p === id); });
  Array.prototype.forEach.call(document.querySelectorAll("#mnav button"), function (b) { b.classList.toggle("on", b.getAttribute("data-p") === id); });
  if (id === "main") setTimeout(function () {
    map.invalidateSize();
    if (RES && RES.needFit) { map.fitBounds(RES.fitBox); RES.needFit = false; }
  }, 60);
}
/* Vertikalprofil. Alle Beschriftungen laufen ueber eine Kollisionspruefung:
   ueberschneidet sich ein Text mit einem bereits gesetzten, wird er verschoben oder weggelassen. */
function profSvg(R) {
  var P = RES.P, G = RES.G, sm = R.samples, D = R.D, mob = false;
  var W = mob ? 640 : 1100, H = mob ? 380 : 270, Lp = mob ? 64 : 54, Rp = 12, Tp = mob ? 26 : 18, Bp = mob ? 66 : 34;
  var f1 = mob ? 17 : 11, f2 = mob ? 15 : 10;
  var top = 0, i, g;
  sm.forEach(function (q) { top = Math.max(top, q.tm, q.p); });
  var yMax = Math.max(4000, Math.ceil((top + 2500) / 1000) * 1000);
  function X(x) { return +(Lp + x / D * (W - Lp - Rp)).toFixed(1); }
  function Y(f) { return +(Tp + (1 - Math.max(0, Math.min(yMax, f)) / yMax) * (H - Tp - Bp)).toFixed(1); }
  var boxes = [];
  function lbl(x, y, txt, size, color, anchor, bold, offs) {
    var w = String(txt).length * size * 0.57, h = size * 1.15;
    offs = offs || [0, -h, h, -2 * h, 2 * h];
    for (var k = 0; k < offs.length; k++) {
      var yy = y + offs[k], x0 = anchor === "end" ? x - w : anchor === "middle" ? x - w / 2 : x;
      if (x0 < 1 || x0 + w > W - 1 || yy - h < 1 || yy > H - 1) continue;
      var b = { x0: x0 - 3, x1: x0 + w + 3, y0: yy - h, y1: yy + 3 };
      if (boxes.some(function (o) { return !(b.x1 < o.x0 || o.x1 < b.x0 || b.y1 < o.y0 || o.y1 < b.y0); })) continue;
      boxes.push(b);
      return "<text x='" + x.toFixed(1) + "' y='" + yy.toFixed(1) + "'" + (anchor && anchor !== "start" ? " text-anchor='" + anchor + "'" : "") +
        " font-size='" + size + "'" + (bold ? " font-weight='700'" : "") + " fill='" + color + "' style='paint-order:stroke;stroke:#fff;stroke-width:3px'>" + esc(txt) + "</text>";
    }
    return "";
  }
  var s = "<svg viewBox='0 0 " + W + " " + H + "' xmlns='http://www.w3.org/2000/svg' font-family='system-ui,sans-serif'>";
  if (RES.hl) s += "<rect x='" + X(RES.hl.a) + "' y='" + Tp + "' width='" + Math.max(3, X(RES.hl.b) - X(RES.hl.a)) + "' height='" + (H - Tp - Bp) + "' fill='#FFD400' fill-opacity='0.28'/>";
  var step = yMax > (mob ? 7000 : 9000) ? 2000 : 1000, txts = "";
  for (g = step; g < yMax; g += step) {
    s += "<line x1='" + Lp + "' x2='" + (W - Rp) + "' y1='" + Y(g) + "' y2='" + Y(g) + "' stroke='#E8EDF1'/>";
    txts += lbl(Lp - 6, Y(g) + f2 * 0.35, String(g), f2, "#61717F", "end", false, [0]);
  }
  R.conflicts.forEach(function (c) {
    s += "<rect x='" + X(Math.max(0, c.x0 - 0.25)) + "' y='" + Tp + "' width='" + Math.max(3, X(Math.min(D, c.x1 + 0.25)) - X(Math.max(0, c.x0 - 0.25))) +
      "' height='" + (H - Tp - Bp) + "' fill='#C0392B' fill-opacity='0.12'/>";
  });
  for (i = 0; i < sm.length - 1; i++) {
    var b = sm[i].base;
    if (!isFinite(b) || b >= yMax) continue;
    s += "<rect x='" + X(sm[i].x) + "' y='" + Y(yMax) + "' width='" + Math.max(0.5, X(sm[i + 1].x) - X(sm[i].x) + 0.6).toFixed(1) +
      "' height='" + Math.max(0, Y(b) - Y(yMax)).toFixed(1) + "' fill='#9AAAB8' fill-opacity='0.35'/>";
  }
  var bl = "", pen = false;
  sm.forEach(function (q) { if (isFinite(q.base) && q.base < yMax) { bl += (pen ? " L " : " M ") + X(q.x) + " " + Y(q.base); pen = true; } else pen = false; });
  if (bl) s += "<path d='" + bl + "' fill='none' stroke='#5E7386' stroke-width='1.5'/>";
  var bandLbl = [];
  R.bands.forEach(function (bd) {
    if (bd.lo >= yMax) return;
    var k = KIND[bd.as.kind], x0 = X(bd.x0), x1 = Math.max(X(bd.x1), x0 + 2), y0 = Y(Math.min(bd.hi, yMax)), y1 = Y(Math.max(0, bd.lo));
    s += "<rect x='" + x0 + "' y='" + y0 + "' width='" + (x1 - x0).toFixed(1) + "' height='" + Math.max(1, y1 - y0).toFixed(1) +
      "' fill='" + k.c + "' fill-opacity='0.08' stroke='" + k.c + "' stroke-opacity='0.6' stroke-dasharray='" + (bd.as.temp ? "2 4" : "4 3") + "'/>";
    var maxCh = Math.floor((x1 - x0 - 8) / (f2 * 0.57));
    if (maxCh >= 5) bandLbl.push({ x: x0 + 4, y: y0 + f2 + 2, t: String(bd.as.name || "").slice(0, maxCh), c: k.c, hgt: y1 - y0 });
  });
  function area(key) {
    var pth = "M " + X(0) + " " + Y(0);
    sm.forEach(function (q) { pth += " L " + X(q.x) + " " + Y(q[key]); });
    return pth + " L " + X(D) + " " + Y(0) + " Z";
  }
  s += "<path d='" + area("tm") + "' fill='#CDBB9E' fill-opacity='0.65'/><path d='" + area("tc") + "' fill='#8C7A5B' fill-opacity='0.85'/>";
  var fl = ""; pen = false;
  sm.forEach(function (q) { if (q.fz != null && isFinite(q.fz) && q.fz < yMax) { fl += (pen ? " L " : " M ") + X(q.x) + " " + Y(q.fz); pen = true; } else pen = false; });
  if (fl) s += "<path d='" + fl + "' fill='none' stroke='#2E86C9' stroke-width='1.2' stroke-dasharray='2 4'/>";
  if (P.maxAlt < yMax) s += "<line x1='" + Lp + "' x2='" + (W - Rp) + "' y1='" + Y(P.maxAlt) + "' y2='" + Y(P.maxAlt) + "' stroke='#9AA7B0' stroke-dasharray='8 6'/>";
  var pl = "M " + X(0) + " " + Y(G.depElev) + " L " + X(0) + " " + Y(sm[0].p);
  sm.forEach(function (q) { pl += " L " + X(q.x) + " " + Y(q.p); });
  pl += " L " + X(D) + " " + Y(G.destElev);
  s += "<path d='" + pl + "' fill='none' stroke='#B02E7A' stroke-width='" + (mob ? 3.2 : 2.6) + "' stroke-linejoin='round'/>";
  /* Beschriftungen nach Prioritaet: Achsen, Plaetze, Hoehen, Kreisen, Max-Hoehe, Luftraumnamen */
  [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
    txts += lbl(X(D * f), H - Bp + f2 + 6, Math.round(D * f) + " NM", f2, "#61717F", f === 0 ? "start" : f === 1 ? "end" : "middle", false, [0]);
  });
  txts += lbl(Lp + 4, Tp + f1 * 0.2, G.A.icao || G.A.name, f1, "#0F1D2A", "start", true, [0, f1 * 1.2]);
  txts += lbl(W - Rp - 4, Tp + f1 * 0.2, G.B.icao || G.B.name, f1, "#0F1D2A", "end", true, [0, f1 * 1.2]);
  R.legs.forEach(function (l, k) {
    var xm = (R.wps[k].x + R.wps[k + 1].x) / 2;
    if (X(R.wps[k + 1].x) - X(R.wps[k].x) < (mob ? 40 : 30)) return;
    txts += lbl(X(xm), Y(sampleAt(R, xm).p) - 7, String(l.alt), f2, "#B02E7A", "middle", true, [0, -f2 * 1.2, f2 * 1.6, -f2 * 2.4]);
  });
  R.circles.forEach(function (c) { txts += lbl(X(c.x) + 6, Y(c.to) + f2 + 4, "\u21bb " + fmtFt(c.to), f2, "#B02E7A", "start", true); });
  if (R.spiralMin > 0) txts += lbl(X(D) - 6, Y(sm[sm.length - 1].p) + f2 + 4, "\u21ba Sinken im Tal", f2, "#B02E7A", "end", true);
  if (P.maxAlt < yMax) txts += lbl(W - Rp - 4, Y(P.maxAlt) - 4, "max. " + P.maxAlt + " ft", f2, "#61717F", "end", false, [0, f2 * 1.4]);
  bandLbl.forEach(function (b) { txts += lbl(b.x, b.y, b.t, f2, b.c, "start", false, [0, f2 * 1.2, f2 * 2.4].filter(function (o) { return o + f2 < b.hgt; })); });
  var leg = mob ? ["\u25ac Flugprofil (" + P.climb + "/" + P.desc + " ft/min) \u00b7 grau: Wolken \u00b7 blau: 0 \u00b0C", "Rahmen: Lufträume \u00b7 rot: kein Korridor \u00b7 gelb: Hinweis"]
    : ["\u25ac Flugprofil mit " + P.climb + "/" + P.desc + " ft/min \u00b7 grau: Wolken ab Basis \u00b7 blau gepunktet: 0 \u00b0C \u00b7 Rahmen: Lufträume \u00b7 rot: kein sicherer Korridor \u00b7 gelb: gew\u00e4hlter Hinweis"];
  leg.forEach(function (t, k) { txts += "<text x='" + Lp + "' y='" + (H - 4 - (leg.length - 1 - k) * (f2 + 4)) + "' font-size='" + (f2 - 1) + "' fill='#61717F'>" + esc(t) + "</text>"; });
  return s + txts + "</svg>";
}
function wpAlts(R) {
  return R.wps.map(function (w, k) {
    if (k === R.wps.length - 1) return Math.round(RES.G.destElev);
    return R.legs[k] ? R.legs[k].alt : R.legs[R.legs.length - 1].alt;
  });
}
function download(name, text, type) {
  var url = URL.createObjectURL(new Blob([text], { type: type })), a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
}
/* GPX: Hoehe als <ele> (Meter) UND im Wegpunktnamen, da SkyDemon <ele> beim Import ignoriert */
function exportGpx(R) {
  var G = RES.G, nm = (G.A.icao || "START") + "-" + (G.B.icao || "ZIEL"), alts = wpAlts(R);
  var s = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="VFR-Briefing v7.5" xmlns="http://www.topografix.com/GPX/1/1">\n<rte><name>' + esc(nm + " " + R.name) + "</name>\n";
  R.wps.forEach(function (w, k) {
    var last = k === R.wps.length - 1, label = last ? w.name : w.name + " " + alts[k] + "FT";
    s += '<rtept lat="' + w.lat.toFixed(5) + '" lon="' + w.lon.toFixed(5) + '"><ele>' + (alts[k] / M2FT).toFixed(0) + "</ele><name>" + esc(label) +
      "</name><desc>" + (last ? "Ziel" : "Reisehoehe ab hier " + alts[k] + " ft MSL") + "</desc></rtept>\n";
  });
  s += "</rte>\n</gpx>\n";
  download(nm + "_" + R.id + ".gpx", s, "application/gpx+xml");
}
function dmsTxt(v, pos, neg, degW) {
  var a = Math.abs(v), d = Math.floor(a), mf = (a - d) * 60, m = Math.floor(mf), sec = Math.round((mf - m) * 6000) / 100;
  if (sec >= 60) { sec = 0; m++; } if (m >= 60) { m = 0; d++; }
  return (v >= 0 ? pos : neg) + String(d).padStart(degW, "0") + p2(m) + (sec < 10 ? "0" : "") + sec.toFixed(2);
}
/* SkyDemon-Flugplan (.flightplan) mit Reiseflughoehe je Abschnitt */
function exportSkyDemon(R) {
  var G = RES.G, nm = (G.A.icao || "START") + "-" + (G.B.icao || "ZIEL"), alts = wpAlts(R);
  function pos(w) { return dmsTxt(w.lat, "N", "S", 2) + " " + dmsTxt(w.lon, "E", "W", 3); }
  var s = '<?xml version="1.0" encoding="utf-8"?>\n<DivelementsFlightPlanner>\n  <PrimaryRoute CourseType="GreatCircle" Start="' + pos(R.wps[0]) + '" Level="' + alts[0] + '" Rules="Vfr">\n';
  for (var k = 1; k < R.wps.length; k++) s += '    <RhumbLineRoute To="' + pos(R.wps[k]) + '" Level="' + alts[k - 1] + '" LevelChange="B" />\n';
  s += "  </PrimaryRoute>\n</DivelementsFlightPlanner>\n";
  download(nm + "_" + R.id + ".flightplan", s, "application/xml");
}

/* ==================== 15. Start ==================== */
(function init() {
  var t = new Date(), today = t.getFullYear() + "-" + p2(t.getMonth() + 1) + "-" + p2(t.getDate());
  var mx = new Date(t.getTime() + 6 * 86400000);
  $("dDate").value = today; $("dDate").min = today;
  $("dDate").max = mx.getFullYear() + "-" + p2(mx.getMonth() + 1) + "-" + p2(mx.getDate());
  $("dTime").value = p2(Math.min(20, t.getHours() + 1)) + ":00";
  setupAc("fIn", "fAc", "from");
  setupAc("tIn", "tAc", "to");
  loadSettings();
  $("go").addEventListener("click", plan);
  $("out").addEventListener("click", onOutClick);
  $("asFilter").addEventListener("change", function () { drawAir(); saveSettings(); });
  $("avoidClr").addEventListener("change", saveSettings);
  if (isMob()) setupMobile();
  $("lgT").addEventListener("click", function () { var l = $("legend"); l.classList.toggle("col"); $("lgA").innerHTML = l.classList.contains("col") ? "&#9656;" : "&#9662;"; });
  $("profHead").addEventListener("click", function () {
    var p = $("prof"); p.classList.toggle("min");
    $("profTgl").innerHTML = p.classList.contains("min") ? "&#9650;" : "&#9660;";
  });
  loadCountry("AT", "apt").catch(function () {});
  loadAirView();
  setSts("Bereit \u2013 Start und Ziel w\u00e4hlen, dann \u201eSicherste Route berechnen\u201c.");
})();
</script>
</body>
</html>`;
