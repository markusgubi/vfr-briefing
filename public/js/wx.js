"use strict";
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
    ws10: v("wind_speed_10m"), wd10: v("wind_direction_10m"),
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
    ws10: Math.max(a.ws10 || 0, b.ws10 || 0), wd10: (h - h0 < 0.5 ? a : b).wd10,
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
/* Sonnenzeiten fuer Start und Ziel (lokal berechnet, ohne Netz): Auf-/Untergang und BCMT/ECET */
function sunFor(A, B, date) {
  var a = sunTimes(A.lat, A.lon, date), b = sunTimes(B.lat, B.lon, date);
  return { depRise: a.rise, depSet: a.set, depBcmt: a.bcmt, depEcet: a.ecet, destRise: b.rise, destSet: b.set, destBcmt: b.bcmt, destEcet: b.ecet };
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
    s.metar = { t: t, raw: o.rawOb || "", visKm: cav ? 10 : visKmOf(o.visib), ceil: cav ? null : ceilOf(o.clouds), gust: o.wgst || null, qnh: o.altim || null, temp: o.temp,
      wdir: o.wdir != null ? o.wdir : null, wspd: o.wspd != null ? o.wspd : null };
  });
  (j.taf || []).forEach(function (o) {
    if (!o.icaoId || o.lat == null) return;
    get(o).taf = { from: o.validTimeFrom, to: o.validTimeTo, raw: o.rawTAF || "", fcsts: Array.isArray(o.fcsts) ? o.fcsts : [] };
  });
  return Object.keys(mp).map(function (k) { return mp[k]; });
}
function fcVals(f) {
  var v = { visKm: visKmOf(f.visib), gust: f.wgst != null ? f.wgst : null, wx: f.wxString || null, ceil: undefined,
    wdir: f.wdir != null ? f.wdir : null, wspd: f.wspd != null ? f.wspd : null };
  if (Array.isArray(f.clouds) && f.clouds.length) { var c = ceilOf(f.clouds); v.ceil = c == null ? Infinity : c; }
  return v;
}
function ceilVal(c) { return c === undefined || c == null ? Infinity : c; }
function mergeV(a, b) {
  if (!a) return b;
  var w = b.wspd != null ? b : a;   /* Wind: neue Gruppe gilt, sonst bisheriger */
  return { visKm: b.visKm != null ? b.visKm : a.visKm, gust: b.gust != null ? b.gust : a.gust, wx: b.wx || a.wx, ceil: b.ceil !== undefined ? b.ceil : a.ceil, wdir: w.wdir, wspd: w.wspd };
}
function worseV(a, b) {
  if (!a) return b; if (!b) return a;
  var w = (b.wspd || 0) > (a.wspd || 0) ? b : a;   /* Wind: der staerkere */
  return { visKm: minN(a.visKm, b.visKm), gust: maxN(a.gust, b.gust), wx: b.wx || a.wx, ceil: Math.min(ceilVal(a.ceil), ceilVal(b.ceil)), wdir: w.wdir, wspd: w.wspd };
}
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
