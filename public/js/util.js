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
