"use strict";
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
  if (t === 10) return "fir";   /* FIR = Landesgrenze fuer Grenzuebertritte, nicht gezeichnet */
  if (t === 11 || t === 15 || t === 27) return "ignore";
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
  return " (Frequenz laut AIP/ICAO-Karte)";
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
  CZ: [[12.0, 48.5, 18.9, 51.1]], SK: [[16.8, 47.7, 22.6, 49.6]], HU: [[16.1, 45.7, 22.9, 48.6]],
  /* weitere Laender fuer lange Strecken */
  HR: [[13.4, 42.3, 19.5, 46.6]], BA: [[15.7, 42.5, 19.7, 45.3]], RS: [[18.8, 42.2, 23.1, 46.2]], ME: [[18.4, 41.8, 20.4, 43.6]],
  PL: [[14.1, 49.0, 24.2, 54.9]], FR: [[-5.2, 41.3, 9.6, 51.1]], BE: [[2.5, 49.5, 6.4, 51.5]], NL: [[3.3, 50.7, 7.3, 53.6]],
  LU: [[5.7, 49.4, 6.6, 50.2]], DK: [[8.0, 54.5, 15.3, 57.8]], RO: [[20.2, 43.6, 29.8, 48.3]], SM: [[12.4, 43.89, 12.52, 43.99]]
};
/* Gebiet, fuer das Luftraumdaten geladen sind: Laenderrechtecke der geladenen Laender, auf box zugeschnitten.
   Punkte ausserhalb (Land ohne openAIP-Abfrage) gelten als "ohne Luftraumdaten" -> Route KRITISCH. */
function coverBoxes(box, countries) {
  var out = [];
  countries.forEach(function (c) { (CTRY[c] || []).forEach(function (b) {
    var w = Math.max(box[0], b[0]), s = Math.max(box[1], b[1]), e = Math.min(box[2], b[2]), n = Math.min(box[3], b[3]);
    if (w < e && s < n) out.push([w, s, e, n]);
  }); });
  return out;
}
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
function normFreq(list) {
  return Array.isArray(list) ? list.filter(function (f) { return f && f.value; })
    .map(function (f) { return { v: String(f.value), n: f.name || "", t: f.type, p: !!f.primary }; }) : [];
}
function normApt(a) {
  if (!a || !a.geometry || !Array.isArray(a.geometry.coordinates)) return null;
  var e = a.elevation || {};
  return { id: a._id || null, icao: a.icaoCode || null, name: a.name || "?", country: a.country || "", type: a.type, freq: normFreq(a.frequencies),
    lat: a.geometry.coordinates[1], lon: a.geometry.coordinates[0],
    elevFt: typeof e.value === "number" ? Math.round(e.unit === 1 ? e.value : e.value * M2FT) : null };
}
var AIRDB = {}, APTDB = {}, RPDB = {}, LOADING = {};
var OAIP_PATH = { asp: "airspaces", apt: "airports", rp: "reporting-points" }, NORM = { asp: normAsp, apt: normApt, rp: normRp };
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
/* Orte (Staedte, Orte ab 1000 Einwohnern) aus OpenStreetMap (Overpass) - fuer Ortsnamen an Wegpunkten, auf der
   Karte und als markante Grenzuebertrittspunkte. Nur Anzeige/Benennung, nie fuer Sicherheitsentscheidungen.
   Fehler = keine Orte (Planung laeuft weiter). 30 Tage Cache je 0,5-Grad-Raster. */
var OVERPASS = "https://overpass-api.de/api/interpreter";
async function loadPlaces(w, s, e, n) {
  var r = function (v, up) { return (up ? Math.ceil(v * 2) : Math.floor(v * 2)) / 2; };
  w = r(w); s = r(s); e = r(e, true); n = r(n, true);
  var key = "https://cache.local/osm/places/" + [s, w, n, e].join(",");
  var hit = await cacheGet(key, 30 * 86400000);
  if (hit) return hit;
  var bb = "(" + s + "," + w + "," + n + "," + e + ")";
  var q = "[out:json][timeout:25];(node[\"place\"~\"^(city|town)$\"]" + bb + ";node[\"place\"=\"village\"][\"population\"~\"^[0-9]{4,}$\"]" + bb + ";);out qt;";
  var j = await fetchJSON(OVERPASS + "?data=" + encodeURIComponent(q), 2);
  var out = (j.elements || []).filter(function (x) { return x.tags && x.tags.name; }).map(function (x) {
    return { name: x.tags["name:de"] || x.tags.name, lat: x.lat, lon: x.lon, kind: x.tags.place, pop: +(x.tags.population || 0) || (x.tags.place === "city" ? 100000 : x.tags.place === "town" ? 10000 : 1000) };
  });
  await cachePut(key, out);
  return out;
}
/* naechster Ort zu einem Punkt (hoechstens maxNm), bei Gleichstand der groessere */
function nearestPlace(places, p, maxNm) {
  var best = null;
  (places || []).forEach(function (q) {
    var d = distNm(p, q); if (d > maxNm) return;
    var sc = d - Math.log10(Math.max(1000, q.pop)) * 0.3;
    if (!best || sc < best.sc) best = { sc: sc, d: d, pl: q };
  });
  return best ? Object.assign({ d: best.d }, best.pl) : null;
}
/* VFR-Melde-/Pflichtmeldepunkte (openAIP reporting points). airports: IDs der zugehoerigen Flugplaetze */
function normRp(a) {
  if (!a || !a.geometry || !Array.isArray(a.geometry.coordinates)) return null;
  return { id: a._id || a.id || a.name, name: a.name || "?", compulsory: !!a.compulsory, country: a.country || "",
    lat: a.geometry.coordinates[1], lon: a.geometry.coordinates[0],
    airports: (Array.isArray(a.airports) ? a.airports : []).map(function (x) { return typeof x === "string" ? x : x && (x._id || x.id); }).filter(Boolean) };
}
function slim(x, t) {
  if (t === "apt") return { _id: x._id, icaoCode: x.icaoCode, name: x.name, country: x.country, type: x.type, geometry: x.geometry, elevation: x.elevation, frequencies: x.frequencies };
  if (t === "rp") return { _id: x._id, name: x.name, compulsory: x.compulsory, country: x.country, geometry: x.geometry, airports: x.airports };
  return { _id: x._id, name: x.name, type: x.type, icaoClass: x.icaoClass, lowerLimit: x.lowerLimit, upperLimit: x.upperLimit,
    geometry: x.geometry, country: x.country, frequencies: x.frequencies, onDemand: x.onDemand, onRequest: x.onRequest, byNotam: x.byNotam };
}
async function loadCountry(c, t) {
  var k = c + t;
  if (!LOADING[k]) LOADING[k] = (async function () {
    var ck = "https://cache.local/oaip2/" + c + "/" + t;
    var raw = await cacheGet(ck, 86400000);
    if (!raw) {
      raw = [];
      for (var page = 1; page <= 15; page++) {
        var j = await oaipGet(OAIP_PATH[t] + "?country=" + c + "&limit=1000&page=" + page);
        (j.items || []).forEach(function (x) { raw.push(slim(x, t)); });
        var more = j.nextPage != null ? j.nextPage > page : (j.totalPages ? page < j.totalPages : false);
        if (!more) break;
      }
      await cachePut(ck, raw);
    }
    var list = raw.map(NORM[t]).filter(Boolean);
    (t === "asp" ? AIRDB : t === "rp" ? RPDB : APTDB)[c] = list;
    return list;
  })();
  try { return await LOADING[k]; } catch (e) { delete LOADING[k]; throw e; }
}
async function dataIn(t, w, s, e, n, onCountry) {
  var cs = countriesFor(w, s, e, n), done = 0;
  var res = await Promise.allSettled(cs.map(function (c) {
    return loadCountry(c, t).finally(function () { done++; if (onCountry) onCountry(done, cs.length); });
  }));
  var failed = cs.filter(function (c, i) { return res[i].status !== "fulfilled"; });
  var db = t === "asp" ? AIRDB : t === "rp" ? RPDB : APTDB, seen = {}, out = [], firs = [];
  cs.forEach(function (c) {
    (db[c] || []).forEach(function (a) {
      if (t === "asp") { if (seen[a.id] || !bbOverlap([w, s, e, n], a.bb)) return; seen[a.id] = 1; if (a.kind === "fir") { firs.push(a); return; } }
      else { if (a.lon < w || a.lon > e || a.lat < s || a.lat > n) return; }
      out.push(a);
    });
  });
  return { list: out, failed: failed, firs: firs, ok: cs.filter(function (c) { return failed.indexOf(c) < 0; }) };
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
/* Feinste Zoomstufe, bei der das Gebiet in hoechstens 160 Kacheln passt (lange Strecken: groeber,
   dafuer groesserer Hoehenpuffer DEM.buf) */
function demTiles(w, s, e, n, z) { return (Math.floor(tileX(e, z)) - Math.floor(tileX(w, z)) + 1) * (Math.floor(tileY(s, z)) - Math.floor(tileY(n, z)) + 1); }
function demZoom(w, s, e, n) { return demTiles(w, s, e, n, 10) <= 160 ? 10 : demTiles(w, s, e, n, 9) <= 160 ? 9 : 8; }
async function ensureDem(w, s, e, n, z, onTile) {
  DEM.z = z; DEM.buf = z >= 10 ? 150 : z === 9 ? 300 : 450;
  var x0 = Math.floor(tileX(w, z)), x1 = Math.floor(tileX(e, z)), y0 = Math.floor(tileY(n, z)), y1 = Math.floor(tileY(s, z));
  var jobs = [];
  for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) jobs.push([x, y]);
  if (jobs.length > (z <= 8 ? 260 : 160)) throw new Error("Gebiet zu gro\u00df f\u00fcr Gel\u00e4ndedaten");
  var k = 0;
  var done = 0;
  async function worker() { while (k < jobs.length) { var j = jobs[k++]; await loadTile(z, j[0], j[1]); done++; if (onTile) onTile(done, jobs.length); } }
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
