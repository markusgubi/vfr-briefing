"use strict";
/* ==================== 3. Karte & Luftraum ==================== */
var map = L.map("map", { zoomControl: false }).setView([47.6, 13.8], 8);
L.control.zoom({ position: "topright" }).addTo(map);
var EditCtl = L.Control.extend({
  options: { position: "topright" },
  onAdd: function () {
    var d = L.DomUtil.create("div", "leaflet-bar editctl");
    d.innerHTML = "<a href='#' role='button' title='Route bearbeiten'>\u270e</a>";
    L.DomEvent.disableClickPropagation(d);
    L.DomEvent.on(d, "click", function (e) {
      L.DomEvent.preventDefault(e);
      if (!RES) return;
      if (EDIT.on) stopEdit(); else startEdit();
    });
    return d;
  }
});
var editCtl = new EditCtl().addTo(map);
L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
  maxZoom: 15, subdomains: "abc",
  attribution: "Karte: &copy; OpenStreetMap, SRTM | Stil: &copy; OpenTopoMap (CC-BY-SA) | Luftraum: openAIP"
}).addTo(map);
var cvs = L.canvas({ padding: 0.3 });
var airLayer = L.layerGroup().addTo(map), routeLayer = L.layerGroup().addTo(map), lineLayer = L.layerGroup().addTo(map);
var hlLayer = L.layerGroup().addTo(map), editLayer = L.layerGroup().addTo(map);

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

/* GAFOR-Strecken laden: nur verwenden, wenn die Datei als geprueft markiert ist und Strecken enthaelt */
var gaforLayer = L.layerGroup();
async function loadGafor() {
  try {
    var j = await (await fetch("data/gafor.geojson", { cache: "no-cache" })).json();
    if (!j || j.geprueft !== true || !Array.isArray(j.features) || !j.features.length) return;
    GAFOR = [];
    j.features.forEach(function (f) {
      var g = f.geometry || {}, lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
      lines.forEach(function (l) { GAFOR.push({ nr: (f.properties || {}).nr || "", name: (f.properties || {}).name || "", pts: l.map(function (c) { return { lat: c[1], lon: c[0] }; }) }); });
    });
    GAFOR.forEach(function (r) {
      L.polyline(r.pts.map(function (q) { return [q.lat, q.lon]; }), { color: "#16A085", weight: 3, opacity: 0.7, dashArray: "2 6", interactive: true })
        .bindTooltip("GAFOR " + esc(r.nr) + (r.name ? " " + esc(r.name) : "")).addTo(gaforLayer);
    });
    var d = document.createElement("label"); d.className = "chk"; d.style.marginTop = "6px";
    d.innerHTML = "<input type='checkbox' id='gaforOn' checked> GAFOR-Strecken (" + esc(j.stand || "Stand ?") + ")";
    $("legend").querySelector(".lg").appendChild(d);
    gaforLayer.addTo(map);
    $("prefGafor").disabled = false;
    $("gaforInfo").textContent = "(nur bei gleicher Sicherheit, Stand " + (j.stand || "?") + ")";
    $("gaforOn").addEventListener("change", function () { if (this.checked) gaforLayer.addTo(map); else map.removeLayer(gaforLayer); });
  } catch (e) { GAFOR = null; }
}

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
    var o = { v74: true, from: S.from, to: S.to, avoidClr: $("avoidClr").checked, prefGafor: $("prefGafor").checked, asFilter: $("asFilter").value };
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
    $("prefGafor").checked = !!o.prefGafor;
    if (o.asFilter != null) $("asFilter").value = o.asFilter;
    if (o.from) { S.from = o.from; showSel("fIn", o.from); }
    if (o.to) { S.to = o.to; showSel("tIn", o.to); }
  } catch (e) {}
}
/* Gespeicherte Plaetze (aeltere Version) mit aktuellen Daten (ID, Frequenzen) auffrischen */
function freshApt(a) {
  if (!a || !a.icao) return a;
  var all = []; Object.keys(APTDB).forEach(function (c) { all = all.concat(APTDB[c]); });
  return all.filter(function (x) { return x.icao === a.icao; })[0] || a;
}
function readP() {
  var tm = ($("dTime").value || "10:00").split(":");
  var P = {
    date: $("dDate").value, depH: (+tm[0]) + (+tm[1] || 0) / 60,
    tas: clampNum($("tas").value, 50, 250, 100), maxAlt: clampNum($("maxAlt").value, 3000, 13000, 12500),
    terrClr: clampNum($("terrClr").value, 500, 3000, 1000), cloudClr: clampNum($("cloudClr").value, 500, 3000, 1000),
    prefAgl: clampNum($("prefAgl").value, 1000, 5000, 2000), climb: clampNum($("climb").value, 200, 2000, 500),
    desc: clampNum($("desc").value, 200, 2000, 500), avoidClr: $("avoidClr").checked,
    preferGafor: !!GAFOR && $("prefGafor").checked
  };
  P.prefAgl = Math.max(P.prefAgl, P.terrClr);
  return P;
}

/* ==================== 13. Fortschritt & Ablauf ==================== */
/* Fortschrittsanzeige: gewichtete Schritte, je Schritt Anteil 0..1 und Zustand (wait/run/ok/err/skip) */
var PROG = null;
function progStart(steps) {
  PROG = { steps: steps.map(function (x) { return { id: x[0], l: x[1], w: x[2], f: 0, st: "wait", info: "" }; }) };
  progDraw();
}
function progSet(id, f, st, info) {
  if (!PROG) return;
  var x = PROG.steps.filter(function (q) { return q.id === id; })[0]; if (!x) return;
  if (f != null) x.f = Math.max(0, Math.min(1, f));
  if (st) x.st = st; else if (x.st === "wait") x.st = "run";
  if (st === "ok" || st === "skip") x.f = 1;
  if (info != null) x.info = info;
  progDraw();
}
function progPct() {
  var w = 0, d = 0;
  PROG.steps.forEach(function (x) { w += x.w; d += x.w * (x.st === "err" ? 1 : x.f); });
  return w ? Math.round(100 * d / w) : 0;
}
function progDraw() {
  var el = $("prog"); if (!el) return;
  if (!PROG) { el.innerHTML = ""; el.style.display = "none"; return; }
  var pct = progPct(), ic = { wait: "○", run: "◔", ok: "✓", err: "✗", skip: "–" };
  var cur = PROG.steps.filter(function (x) { return x.st === "run"; }).map(function (x) { return x.l; });
  el.style.display = "block";
  el.innerHTML = "<div class='pbar'><div style='width:" + pct + "%'></div><span>" + pct + " %" + (cur.length ? " · " + esc(cur[0]) : "") + "</span></div>" +
    "<div class='psteps'>" + PROG.steps.map(function (x) {
      return "<span class='ps " + x.st + "' title='" + esc(x.info) + "'>" + ic[x.st] + " " + esc(x.l) +
        (x.st === "run" && x.f > 0 && x.f < 1 ? " " + Math.round(x.f * 100) + "%" : "") + (x.info && x.st !== "run" ? " <small>" + esc(x.info) + "</small>" : "") + "</span>";
    }).join("") + "</div>";
}
function progEnd(keep) { if (!keep) PROG = null; progDraw(); }
function yieldUi() { return new Promise(function (r) { setTimeout(r, 0); }); }

async function plan() {
  var A = S.from, B = S.to;
  if (!A || !B) { setSts("Bitte Start und Ziel aus der Vorschlagsliste wählen.", "err"); return; }
  A = S.from = freshApt(A); B = S.to = freshApt(B);
  var P = readP(); saveSettings();
  GAFOR_ON = P.preferGafor;
  var d = distNm(A, B);
  if (d < 3) { setSts("Start und Ziel liegen zu nah beieinander.", "err"); return; }
  if (d > 250) { setSts("Strecke " + Math.round(d) + " NM – maximal 250 NM. Bitte mit Zwischenlandung planen.", "err"); return; }
  if (!P.date) { setSts("Bitte Datum wählen.", "err"); return; }
  $("go").disabled = true; hlLayer.clearLayers(); setSts("");
  progStart([["dem", "Gelände", 14], ["asp", "Luftraum", 9], ["apt", "Flugplätze", 3], ["awx", "METAR/TAF", 3]]
    .concat(MODELS.map(function (m, mi) { return ["wx" + mi, m.l.replace(/ \(.*\)/, ""), 6]; }))
    .concat([["net", "Streckennetz", 10], ["route", "Routensuche", 12], ["opt", "Abflugzeit-Optimierer", 19]]));
  try {
    var G = buildGraph(A, B, d);
    var w = 180, s = 90, e = -180, n = -90;
    G.nodes.forEach(function (q) { w = Math.min(w, q.lon); e = Math.max(e, q.lon); s = Math.min(s, q.lat); n = Math.max(n, q.lat); });
    var bw = w - 0.2, bs = s - 0.2, be = e + 0.2, bn = n + 0.2;
    var awxKey = [Math.floor((bs - 0.1) * 2) / 2, Math.floor((bw - 0.1) * 2) / 2, Math.ceil((bn + 0.1) * 2) / 2, Math.ceil((be + 0.1) * 2) / 2].join(",");
    G.t0 = new Date(P.date + "T00:00:00").getTime() / 1000;
    /* Alle Downloads parallel: Gelaende, Luftraum, Plaetze, METAR/TAF und die 5 Wettermodelle */
    var pDem = ensureDem(w - 0.07, s - 0.05, e + 0.07, n + 0.05, d <= 160 ? 10 : 9, function (k, t) { progSet("dem", k / t, null, k + "/" + t + " Kacheln"); })
      .then(function () { progSet("dem", 1, "ok"); }, function (er) { progSet("dem", 1, "err", er.message); throw er; });
    progSet("asp", 0); progSet("apt", 0); progSet("awx", 0);
    var pAsp = dataIn("asp", bw, bs, be, bn, function (k, t) { progSet("asp", k / t, null, k + "/" + t + " Länder"); })
      .then(function (r) { progSet("asp", 1, r.failed.length ? "err" : "ok", r.failed.length ? "fehlt: " + r.failed.join(", ") : r.list.length + " Lufträume"); return r; });
    var pApt = dataIn("apt", bw, bs, be, bn).then(function (r) { progSet("apt", 1, "ok", r.list.length + ""); return r; },
      function () { progSet("apt", 1, "err"); return { list: [], failed: [] }; });
    var pAwx = fetchJSON("/awx?bbox=" + awxKey, 2).then(function (j) { progSet("awx", 1, "ok", (j.metar || []).length + " METAR"); return j; },
      function () { progSet("awx", 1, "err", "nicht verfügbar"); return { metar: [], taf: [] }; });
    var pWx = Promise.all(MODELS.map(function (m, mi) {
      progSet("wx" + mi, 0.1);
      return fetchModel(mi, G.wpts, P.date).then(function (x) { progSet("wx" + mi, 1, "ok"); return x; }, function (er) { progSet("wx" + mi, 1, "err", er.message); return null; });
    }));
    var pSun = fetchSun(A, B, P.date).catch(function () { return null; });
    await pDem;
    G.depElev = A.elevFt != null ? A.elevFt : (elevFt(A.lat, A.lon) || 0);
    G.destElev = B.elevFt != null ? B.elevFt : (elevFt(B.lat, B.lon) || 0);
    G.demBox = [w - 0.07, s - 0.05, e + 0.07, n + 0.05]; G.demZ = d <= 160 ? 10 : 9;
    var got = await Promise.all([pAsp, pApt, pAwx]);
    G.airFailed = got[0].failed; G.AIR = got[0].list; G.FIRS = got[0].firs || []; G.airBoxes = [[bw, bs, be, bn]];
    if (!got[0].list.length && got[0].failed.length) throw new Error("Luftraumdaten nicht verfügbar (" + got[0].failed.join(", ") + ") – ohne Luftraumprüfung wird nicht geplant. Später erneut versuchen.");
    STN = buildStations(got[2]);
    var qs = STN.map(function (x) { return x.metar && x.metar.qnh; }).filter(Boolean);
    G.qnh = qs.length ? avg(qs) : 1013.25; G.qnhKnown = qs.length > 0;
    /* Streckennetz in Paketen, damit die Anzeige mitlaeuft */
    for (var k = 0; k < G.edges.length; k++) {
      edgeStatic(G, G.edges[k], G.AIR);
      if (k % 150 === 149) { progSet("net", k / G.edges.length, null, G.edges.length + " Teilstrecken"); await yieldUi(); }
    }
    progSet("net", 1, "ok", G.edges.length + " Teilstrecken");
    var res = await pWx;
    G.wx = res; G.modelsOk = []; G.modelsFail = [];
    res.forEach(function (x, mi) { (x ? G.modelsOk : G.modelsFail).push(MODELS[mi].l); });
    if (!G.modelsOk.length) throw new Error("Kein Wettermodell lieferte Daten (Datum zu weit in der Zukunft oder Netzwerkproblem).");
    G.sun = await pSun;
    progSet("route", 0.2); await yieldUi();
    RES = { G: G, P: P, apts: got[1].list || [], routes: [], hl: null };
    RES.routes = computeRoutes(G, P);
    await adjustRoutes(RES.routes, G, P);
    /* Eigene Route bleibt bei Neuberechnung (z. B. andere Abflugzeit) erhalten, wenn Start/Ziel gleich sind */
    var keepSel = 0;
    if (EDIT.pts && EDIT.dirty && EDIT.A && EDIT.B && EDIT.A.lat === A.lat && EDIT.A.lon === A.lon && EDIT.B.lat === B.lat && EDIT.B.lon === B.lon) {
      try { await ensureArea(EDIT.pts); var ku = evalUser(); if (EDIT.on) keepSel = ku; } catch (e) { EDIT.on = false; }
    } else { EDIT.on = false; EDIT.pts = null; EDIT.ua = {}; EDIT.dirty = false; editLayer.clearLayers(); }
    progSet("route", 1, "ok", RES.routes.length + " Varianten");
    RES.opt = await optimizer(G, P, function (k, t, h) { progSet("opt", k / t, null, p2(h) + ":00"); });
    progSet("opt", 1, "ok", RES.opt.length + " Stunden");
    RES.fitted = false;
    render(keepSel);
    if (MOB.on) showPane("main");
    progEnd();
    setSts("Fertig · Modelle: " + G.modelsOk.join(", ") + (G.modelsFail.length ? " · ohne Daten: " + G.modelsFail.join(", ") : ""));
  } catch (err) {
    progEnd(true);
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
  var h = verdictHtml(R);
  h += whyHtml();
  h += "<div class='card'><h3>Routen-Varianten</h3>";
  RES.routes.forEach(function (x, k) {
    var det = Math.round((x.D / G.d - 1) * 100);
    h += "<div class='ropt" + (k === sel ? " sel" : "") + "' data-r='" + k + "' style='border-left-color:" + CAT_COL[x.cat] + "'><b>" + esc(x.name) + "</b>" + catTag(x.cat) +
      "<small>" + x.D.toFixed(0) + " NM" + (det > 0 ? " (+" + det + " %)" : "") + " \u00b7 " + Math.round(x.ete) + " min \u00b7 Reiseh\u00f6he bis " + x.cruiseMax + " ft \u00b7 " +
      (x.clr ? x.clr + " Freigabe" + (x.clr > 1 ? "n" : "") : "keine Freigabe") + " \u00b7 Wert " + x.score + "</small></div>";
  });
  var hasUser = userIdx() >= 0, uaN = Object.keys(EDIT.ua || {}).length;
  h += "<div class='btnrow noprint' style='margin-top:8px'>" + (EDIT.on && R.custom
    ? "<button class='btn2 on' id='bEditEnd'>\u2713 Bearbeiten beenden</button>" + (uaN ? "<button class='btn2' id='bAltAuto'>H\u00f6hen automatisch</button>" : "")
    : "<button class='btn2' id='bEdit'>\u270e Route &amp; H\u00f6hen bearbeiten</button>") +
    (hasUser ? "<button class='btn2' id='bUserDel'>Eigene Route verwerfen</button>" : "") + "</div>";
  if (EDIT.on && R.custom) h += "<div class='note' style='margin-top:6px'>Bewertet f\u00fcr Abflug <b>" + fmtH(P.depH * 60) + "</b> am " + esc(P.date.split("-").reverse().join(".")) + ". <b>Karte:</b> Wegpunkt ziehen \u00b7 Linie anklicken = Punkt einf\u00fcgen \u00b7 Punkt anklicken/Rechtsklick = l\u00f6schen. " +
    "<b>Profil:</b> Griff \u2195 ziehen = Reiseh\u00f6he der Teilstrecke, Doppelklick = wieder automatisch. Bewertung rechnet live mit.</div>";
  h += "</div>";
  h += "<div class='card'><h3>Hinweise &amp; Freigaben <span style='text-transform:none;letter-spacing:0;font-weight:400'>(anklicken = auf Karte zeigen)</span></h3>" +
    R.hints.map(function (x, k) { return "<div class='hint " + x.l + (x.x0 != null ? " clk" : "") + "'" + (x.x0 != null ? " data-hi='" + k + "'" : "") + ">" + x.t + "</div>"; }).join("") + "</div>";
  h += "<div class='card'><h3>Navigationslog</h3><div class='navwrap'><table class='nav'><tr><th>Strecke</th><th>MK</th><th>MH</th><th>NM</th><th>Reiseh.</th><th>Wind</th><th>GS</th><th>min</th><th>ETO</th></tr>";
  R.legs.forEach(function (l) {
    h += "<tr><td><span style='color:" + CAT_COL[l.cat] + "'>\u25cf</span> " + esc(l.from) + "\u2192" + esc(l.to) + "</td><td>" + deg3(l.mc) + "</td><td>" + deg3(l.mh) +
      "</td><td>" + l.dist.toFixed(1) + "</td><td>" + l.alt + "</td><td>" + (l.wind ? deg3(l.wind.wd) + "/" + Math.round(l.wind.ws) : "\u2013") +
      "</td><td>" + Math.round(l.gs) + "</td><td>" + Math.round(l.mins) + "</td><td>" + fmtH(l.eto) + "</td></tr>";
  });
  h += "</table></div><div class='note' style='margin-top:6px'>Reiseh\u00f6he je Abschnitt; Steig-/Sinkfl\u00fcge siehe Profil. MK/MH magnetisch (" + MAGVAR + "\u00b0 O), Wind 850 hPa, Zeiten lokal" +
    (R.circMin > 0 ? ", inkl. ~" + Math.round(R.circMin) + " min Kreisen unterwegs" : "") + (R.spiralMin > 0 ? ", inkl. ~" + Math.round(R.spiralMin) + " min Sinken am Ziel" : "") + ".</div></div>";
  if (RES.opt && RES.opt.length) {
    h += "<div class='card noprint'><h3>Beste Abflugzeit (" + esc(P.date.split("-").reverse().join(".")) + ")</h3><div class='opt'>";
    RES.opt.forEach(function (o) {
      h += "<div data-h='" + o.h + "' class='" + (Math.floor(P.depH) === o.h ? "cur" : "") + "' title='" + p2(o.h) + ":00 \u2013 " + CAT_TXT[o.cat] + ", Wert " + o.score +
        "' style='height:" + Math.max(6, o.score) + "%;background:" + CAT_COL[o.cat] + "'><span>" + o.h + "</span></div>";
    });
    h += "</div><div class='note'>Beste Route je volle Abflugstunde (nur Tageslicht). Balken anklicken = Zeit \u00fcbernehmen und neu berechnen.</div></div>";
  }
  h += "<details class='card'><summary><h3>Kennzahlen</h3></summary><div class='kv'>" +
    "<span>Abflug \u2192 Ankunft</span><b>" + fmtH(R.depMin) + " \u2192 " + fmtH(R.arrMin) + " (" + Math.round(R.ete) + " min)</b>" +
    "<span>Distanz</span><b>" + R.D.toFixed(1) + " NM (direkt " + G.d.toFixed(1) + ")</b>" +
    "<span>Min. Gel\u00e4ndeabstand</span><b>" + (isFinite(R.minTerr) ? fmtFt(R.minTerr) + " ft" : "\u2013") + "</b>" +
    "<span>Min. Wolkenabstand</span><b>" + (isFinite(R.minCloud) ? fmtFt(R.minCloud) + " ft" : "keine Wolkendecke") + "</b>" +
    "<span>Gr\u00f6\u00dftes Wetterrisiko</span><b>" + Math.round(R.maxRisk * 100) + " %</b>" +
    "<span>Steig-/Sinkrate</span><b>" + P.climb + " / " + P.desc + " ft/min</b>" +
    "<span>QNH (Umrechnung FL)</span><b>" + Math.round(G.qnh) + " hPa" + (G.qnhKnown ? "" : " (Standard \u2013 keine METARs)") + "</b>" +
    (R.gaforPct != null ? "<span>Entlang GAFOR-Strecken</span><b>" + R.gaforPct + " %</b>" : "") +
    (G.sun ? "<span>Sonne Start / Ziel</span><b>\u2191 " + fmtH(G.sun.depRise * 60) + " \u00b7 \u2193 " + fmtH(G.sun.destSet * 60) + "</b>" : "") +
    "</div></details>";
  h += "<details class='card'><summary><h3>Start- &amp; Zielplatz (METAR/TAF)</h3></summary>";
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
  h += "</details>";
  h += "<details class='card'><summary><h3>Ausweichpl\u00e4tze (" + R.alts.length + ")</h3></summary>";
  if (!R.alts.length) h += "<div class='note' style='margin-top:0'>Keine gefunden.</div>";
  else h += "<table class='nav'><tr><th>Platz</th><th>bei NM</th><th>seitl. NM</th><th>Elev ft</th></tr>" + R.alts.map(function (o) {
    return "<tr><td>" + esc((o.a.icao ? o.a.icao + " " : "") + o.a.name) + "</td><td>" + Math.round(o.x) + "</td><td>" + o.d.toFixed(1) + "</td><td>" + (o.a.elevFt != null ? o.a.elevFt : "\u2013") + "</td></tr>";
  }).join("") + "</table><div class='note'>Entlang der Route (\u226410 NM seitlich). Status, \u00d6ffnungszeiten und PPR immer im AIP pr\u00fcfen.</div>";
  h += "</details>";
  var c = R.conf;
  h += "<details class='card'><summary><h3>Datenbasis &amp; Vertrauen " + c.v + " %</h3></summary><div class='kv'>" +
    "<span>Modell-\u00dcbereinstimmung</span><b>" + Math.round(c.agree * 100) + " %</b>" +
    "<span>Vorlaufzeit</span><b>" + (c.leadH > 0 ? Math.round(c.leadH) + " h" : "jetzt") + " (Faktor " + c.lead.toFixed(2) + ")</b>" +
    "<span>Modelle verf\u00fcgbar</span><b>" + G.modelsOk.length + " / " + MODELS.length + "</b>" +
    "<span>METAR/TAF Start/Ziel</span><b>" + c.offN + " / 2</b>" +
    "<span>Netz / Wetterpunkte</span><b>" + G.nodes.length + " / " + G.wpts.length + "</b>" +
    "<span>Modelle</span><b style='font-weight:400'>" + esc(G.modelsOk.join(", ")) +
    (G.modelsFail.length ? "<br><i style='color:#C0392B;font-style:normal'>ohne Daten: " + esc(G.modelsFail.join(", ")) + "</i>" : "") + "</b>" +
    "</div></details>";
  $("out").innerHTML = h;
  $("exp").innerHTML = expHtml(R);
  drawMap(sel);
  drawProfile(R);
  updateChip(R);
  if (MOB.on) {
    $("profSum").innerHTML = "<b>" + esc(R.name) + "</b> \u00b7 " + CAT_TXT[R.cat] + " \u00b7 " + Math.round(R.D) + " NM \u00b7 Reiseh\u00f6he bis " + R.cruiseMax + " ft<br>Profil seitlich wischen \u2192";
    Array.prototype.forEach.call(document.querySelectorAll("#mnav button"), function (b) { b.disabled = false; });
  }
}
/* Export: auf Handy/Tablet eigener Reiter, am Computer unter dem Ergebnis */
function canShareFiles() {
  try { return MOB.on && typeof File === "function" && navigator.canShare && navigator.canShare({ files: [new File(["x"], "t.flightplan", { type: "application/octet-stream" })] }); }
  catch (e) { return false; }
}
function expHtml(R) {
  var alts = wpAlts(R), share = canShareFiles();
  var h = "<div class='card noprint'><h3>Export \u00b7 " + esc(R.name) + "</h3>" +
    "<button class='btn exp1' id='bSky'>\u2708 SkyDemon-Flugplan mit H\u00f6hen" + (share ? " \u2013 teilen" : "") + "</button>" +
    "<div class='note' style='margin-top:6px'>" + (share ? "Im Teilen-Men\u00fc <b>SkyDemon</b> w\u00e4hlen. " : "Datei <b>.flightplan</b> in SkyDemon \u00f6ffnen. ") +
    "Enth\u00e4lt alle Wegpunkte und die Reiseh\u00f6he je Teilstrecke (Liste unten zum Abgleich).</div>" +
    "<div class='btnrow' style='margin-top:10px'><button class='btn2' id='bGpx'>GPX</button>" +
    (MOB.on ? "" : "<button class='btn2' id='bPrint'>Drucken</button><button class='btn2' id='bWindy'>Windy (VFR)</button>") + "</div>" +
    "<table class='nav' style='margin-top:10px'><tr><th>Wegpunkt</th><th>Reiseh\u00f6he ab hier</th></tr>" +
    R.wps.map(function (w, k) {
      var last = k === R.wps.length - 1;
      return "<tr><td>" + (w.border ? "\u2691 " : "") + esc(w.name) + "</td><td>" + (last ? "Landung (Platzh\u00f6he " + Math.round(alts[k]) + " ft)" : alts[k] + " ft") + "</td></tr>";
    }).join("") + "</table>" +
    "<div class='note'>GPX \u00fcbertr\u00e4gt in SkyDemon keine H\u00f6hen (dort stehen sie im Wegpunktnamen). " +
    "Falls SkyDemon die H\u00f6hen aus der .flightplan-Datei nicht \u00fcbernimmt: Datei mit H\u00f6hen aus SkyDemon speichern und als Vorlage schicken.</div></div>";
  return h;
}
function onExpClick(e) {
  if (!RES) return;
  var R = RES.routes[RES.sel], id = e.target.closest("button") && e.target.closest("button").id, share = canShareFiles();
  if (id === "bSky") exportSkyDemon(R, share);
  if (id === "bGpx") exportGpx(R, share);
  if (id === "bPrint") window.print();
  if (id === "bWindy") {
    var c = lerp(RES.G.A, RES.G.B, 0.5);
    window.open("https://www.windy.com/distance/vfr/" + R.wps.map(function (w) { return w.lat.toFixed(4) + "," + w.lon.toFixed(4); }).join(";") +
      "?clouds," + c.lat.toFixed(3) + "," + c.lon.toFixed(3) + ",8", "_blank");
  }
}
function verdictHtml(R) {
  return "<div class='verdict " + CAT_CLS[R.cat] + "'><div class='big'>" + verdictText(R.cat) + "</div><div class='meta'>" +
    esc(R.name) + " \u00b7 Sicherheitswert " + R.score + "/100 \u00b7 Vertrauen " + (R.conf ? R.conf.v : "\u2013") + " %" +
    (R.custom && R.conflicts.length ? " \u00b7 " + esc(issueOf(R) || "") : "") + "</div></div>";
}
function updateChip(R) {
  var ch = $("mchip"); if (!MOB.on) { ch.textContent = ""; return; }
  ch.textContent = CAT_TXT[R.cat] + " \u00b7 " + R.name + " \u00b7 " + Math.round(R.D) + " NM \u00b7 " + Math.round(R.ete) + " min";
  ch.style.background = CAT_COL[R.cat];
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
  if (e.target.id === "bEdit") { startEdit(); if (MOB.on) showPane("main"); return; }
  if (e.target.id === "bEditEnd") { stopEdit(); return; }
  if (e.target.id === "bAltAuto") { EDIT.ua = {}; EDIT.dirty = true; render(evalUser()); return; }
  if (e.target.id === "bUserDel") { discardUser(); return; }
}
function drawMap(sel) {
  var G = RES.G, R = RES.routes[sel], nb = { bubblingMouseEvents: false };
  routeLayer.clearLayers();
  RES.routes.forEach(function (x, k) {
    if (k === sel) return;
    L.polyline(x.coords, { color: "#4A5A68", weight: 3, opacity: 0.75, dashArray: "6 7", bubblingMouseEvents: false })
      .bindTooltip(esc(x.name) + " \u2013 " + CAT_TXT[x.cat] + " (anklicken)").on("click", function () { render(k); }).addTo(routeLayer);
  });
  drawRouteLines(R);
  drawEditMarkers(R);
  (R.crossings || []).forEach(function (c) {
    L.marker([c.lat, c.lon], { interactive: true, icon: L.divIcon({ className: "brd", html: "\u2691 " + esc(c.fromC) + "/" + esc(c.toC), iconSize: null, iconAnchor: [-6, 24] }) })
      .bindTooltip("Grenz\u00fcbertritt " + esc(c.fromC) + " \u2192 " + esc(c.toC) + " bei NM " + Math.round(c.x) + " (~" + fmtH(c.t) + ")").addTo(routeLayer);
  });
  R.wps.forEach(function (w, k) {
    if (k === 0 || k === R.wps.length - 1) return;
    if (w.rp && !(EDIT.on && R.custom)) {
      L.circleMarker([w.lat, w.lon], { radius: 6, color: "#fff", weight: 2, fillColor: "#1F5FA8", fillOpacity: 1, bubblingMouseEvents: false })
        .bindTooltip(esc(w.name), { permanent: true, direction: "right", offset: [8, 0], className: "rptip" }).addTo(routeLayer);
      return;
    }
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
function drawRouteLines(R) {
  lineLayer.clearLayers();
  /* weisser Rand als EINE Linie (sonst ueberlappen die runden Enden zu einer "Perlenkette") */
  var all = [[R.G.nodes[R.rs[0].e.a].lat, R.G.nodes[R.rs[0].e.a].lon]].concat(R.rs.map(function (r) { var b = R.G.nodes[r.e.b]; return [b.lat, b.lon]; }));
  L.polyline(all, { color: "#fff", weight: EDIT.on && R.custom ? 11 : 9, opacity: 0.9, interactive: false, lineJoin: "round" }).addTo(lineLayer);
  /* gleichfarbige Abschnitte zusammenfassen */
  var runs = [];
  R.rs.forEach(function (r) {
    var a = R.G.nodes[r.e.a], b = R.G.nodes[r.e.b], last = runs[runs.length - 1];
    if (last && last.cat === r.cat) last.pts.push([b.lat, b.lon]); else runs.push({ cat: r.cat, pts: [[a.lat, a.lon], [b.lat, b.lon]] });
  });
  runs.forEach(function (run) {
    L.polyline(run.pts, { color: CAT_COL[run.cat], weight: EDIT.on && R.custom ? 7 : 5.5, lineJoin: "round", bubblingMouseEvents: false })
      .on("mousemove", function (ev) { if (!EDIT.dragging) showCursor(nearestX(R, ev.latlng), "map"); })
      .on("mouseout", function () { hideCursor(); })
      .on("click", function (ev) { routeLineClick(R, ev); })
      .addTo(lineLayer);
  });
}
function profLegend() {
  var f = RES.pvLeg || {}, it = [];
  function sw(svg, t) { it.push("<span><svg width='26' height='12' viewBox='0 0 26 12'>" + svg + "</svg>" + t + "</span>"); }
  sw("<path d='M1 10 L9 3 L25 3' fill='none' stroke='#B02E7A' stroke-width='2.6'/>", "Geplante Flugh\u00f6he (Steig-/Sinkflug)");
  sw("<path d='M0 12 L6 5 L12 8 L19 2 L26 6 L26 12 Z' fill='#CDBB9E'/><path d='M0 12 L6 7 L12 10 L19 5 L26 9 L26 12 Z' fill='#8C7A5B'/>", "Gel\u00e4nde: dunkel auf der Linie, hell bis 1 NM seitlich");
  if (f.cloud) sw("<rect x='0' y='0' width='26' height='7' fill='#9AAAB8' fill-opacity='0.5'/><path d='M0 7 H26' stroke='#5E7386' stroke-width='1.5'/>", "Wolken ab Basis (Modelle/METAR)");
  if (f.fz) sw("<path d='M0 6 H26' stroke='#2E86C9' stroke-width='1.5' stroke-dasharray='2 3'/>", "0-\u00b0C-Grenze (Vereisung)");
  if (f.maxAlt) sw("<path d='M0 6 H26' stroke='#9AA7B0' stroke-width='1.5' stroke-dasharray='6 4'/>", "Max. H\u00f6he (Einstellung)");
  var seen = {};
  (f.kinds || []).forEach(function (k) { if (seen[k] || !KIND[k]) return; seen[k] = 1;
    sw("<rect x='1' y='1' width='24' height='10' fill='" + KIND[k].c + "' fill-opacity='0.12' stroke='" + KIND[k].c + "' stroke-dasharray='4 3'/>", "Luftraum: " + KIND[k].t); });
  if (f.conf) sw("<rect x='0' y='0' width='26' height='12' fill='#C0392B' fill-opacity='0.25'/>", "Kein sicherer H\u00f6henkorridor");
  if (f.circ) sw("<path d='M13 1 C 6 1 6 4 13 4 C 6 4 6 7 13 7 C 6 7 6 10 13 10' fill='none' stroke='#B02E7A' stroke-width='1.8'/>", "Vollkreise: H\u00f6he im Kreis \u00e4ndern (Tal/Platz)");
  if (f.hl) sw("<rect x='0' y='0' width='26' height='12' fill='#FFD400' fill-opacity='0.4'/>", "Gew\u00e4hlter Hinweis");
  if (f.edit) sw("<circle cx='13' cy='6' r='4.5' fill='#fff' stroke='#B02E7A' stroke-width='2'/>", "Griff ziehen = Reiseh\u00f6he \u00e4ndern");
  return it.join("");
}
function drawProfile(R) {
  $("profBody").innerHTML = profSvg(R); $("prof").style.display = "block";
  $("profLeg").innerHTML = profLegend();
  $("prof").classList.toggle("editing", !!(EDIT.on && R.custom));
  if (CUR.x != null) showCursor(CUR.x);
}
/* Reiter-Ansicht fuer Handy und Tablet (auch iPad quer): schmale Fenster oder Touch-Geraete bis 1400 px */
var MOB_Q = "(max-width:860px), (pointer:coarse) and (max-width:1400px)";
function isMob() { return window.matchMedia(MOB_Q).matches; }
/* Handy: vier Seiten (Planen / Karte / Profil / Ergebnis) mit Leiste unten */
var MOB = { on: false };
function setupMobile() {
  MOB.on = true;
  $("side").classList.add("pane");
  $("main").classList.add("pane");
  var pr = document.createElement("div"); pr.id = "pRes"; pr.className = "pane"; document.body.appendChild(pr); pr.appendChild($("out"));
  var px = document.createElement("div"); px.id = "pExp"; px.className = "pane"; document.body.appendChild(px); px.appendChild($("exp"));
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
  ["side", "main", "pProf", "pRes", "pExp"].forEach(function (p) { $(p).classList.toggle("on", p === id); });
  Array.prototype.forEach.call(document.querySelectorAll("#mnav button"), function (b) { b.classList.toggle("on", b.getAttribute("data-p") === id); });
  if (id === "main") setTimeout(function () {
    map.invalidateSize();
    if (RES && RES.needFit) { map.fitBounds(RES.fitBox); RES.needFit = false; }
  }, 60);
}
/* Vertikalprofil. Alle Beschriftungen laufen ueber eine Kollisionspruefung:
   ueberschneidet sich ein Text mit einem bereits gesetzten, wird er verschoben oder weggelassen. */
function profSvg(R) {
  var P = RES.P, G = RES.G, sm = R.samples, D = R.D, mob = MOB.on;
  /* Handy: 880 px breites Bild (seitlich wischen), hoeher und mit groesserer Schrift */
  var W = mob ? 880 : 1100, H = mob ? 470 : 250, Lp = mob ? 50 : 54, Rp = 12, Tp = mob ? 24 : 18, Bp = mob ? 30 : 22;
  var f1 = mob ? 14 : 11, f2 = mob ? 12.5 : 10;
  var top = 0, i, g;
  sm.forEach(function (q) { top = Math.max(top, q.tm, q.p); });
  var yMax = RES.pvFreeze || Math.max(4000, Math.ceil((top + 2500) / 1000) * 1000);
  function X(x) { return +(Lp + x / D * (W - Lp - Rp)).toFixed(1); }
  function Y(f) { return +(Tp + (1 - Math.max(0, Math.min(yMax, f)) / yMax) * (H - Tp - Bp)).toFixed(1); }
  RES.pv = { W: W, H: H, Lp: Lp, Rp: Rp, Tp: Tp, Bp: Bp, yMax: yMax, D: D, X: X, Y: Y, f2: f2 };
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
  /* Wolken: zusammenhaengende Flaeche von der Basis bis zum oberen Rand */
  var run = [];
  function flushCloud() {
    if (run.length > 1) s += "<path d='M " + X(run[0].x) + " " + Y(yMax) + run.map(function (q) { return " L " + X(q.x) + " " + Y(q.base); }).join("") +
      " L " + X(run[run.length - 1].x) + " " + Y(yMax) + " Z' fill='#9AAAB8' fill-opacity='0.35'/>";
    run = [];
  }
  sm.forEach(function (q) { if (isFinite(q.base) && q.base < yMax) run.push(q); else flushCloud(); });
  flushCloud();
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
  /* Kreisflug (Steigen unterwegs, Sinken ueber dem Platz) als Schleifenlinie statt senkrechtem Strich */
  function coil(x, y0, y1) {
    var hh = y1 - y0, n = Math.max(2, Math.round(Math.abs(hh) / (mob ? 14 : 10))), w = mob ? 13 : 10, d = "";
    for (var k = 1; k <= n; k++) {
      var ya = y0 + hh * (k - 1) / n, yb = y0 + hh * k / n;
      d += " C " + (x - w).toFixed(1) + " " + ya.toFixed(1) + " " + (x - w).toFixed(1) + " " + yb.toFixed(1) + " " + x.toFixed(1) + " " + yb.toFixed(1);
    }
    return d;
  }
  var pl = "M " + X(0) + " " + Y(G.depElev) + " L " + X(0) + " " + Y(sm[0].p);
  sm.forEach(function (q) {
    if (q.circ) pl += " L " + X(q.x) + " " + Y(q.p - q.circ) + coil(X(q.x), Y(q.p - q.circ), Y(q.p));
    else pl += " L " + X(q.x) + " " + Y(q.p);
  });
  var pEnd = sm[sm.length - 1].p;
  if (R.spiralMin > 0 && pEnd - G.destElev > 300) pl += coil(X(D), Y(pEnd), Y(G.destElev));
  else pl += " L " + X(D) + " " + Y(G.destElev);
  s += "<path d='" + pl + "' fill='none' stroke='#B02E7A' stroke-width='" + (mob ? 3.2 : 2.6) + "' stroke-linejoin='round'/>";
  /* Beschriftungen nach Prioritaet: Achsen, Plaetze, Hoehen, Kreisen, Max-Hoehe, Luftraumnamen */
  [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
    txts += lbl(X(D * f), H - Bp + f2 + 6, Math.round(D * f) + " NM", f2, "#61717F", f === 0 ? "start" : f === 1 ? "end" : "middle", false, [0]);
  });
  txts += lbl(Lp + 4, Tp + f1 * 0.2, G.A.icao || G.A.name, f1, "#0F1D2A", "start", true, [0, f1 * 1.2]);
  function reserve(x0, y0, x1, y1) { boxes.push({ x0: x0, x1: x1, y0: y0, y1: y1 }); }
  var ed = EDIT.on && R.custom ? editSvg(R, X, Y, f2, lbl, reserve) : { g: "", t: "" };
  txts += ed.t;
  txts += lbl(W - Rp - 4, Tp + f1 * 0.2, G.B.icao || G.B.name, f1, "#0F1D2A", "end", true, [0, f1 * 1.2]);
  if (!(EDIT.on && R.custom)) R.legs.forEach(function (l, k) {   /* im Bearbeiten-Modus zeigen die Griffe die Hoehen */
    var xm = (R.wps[k].x + R.wps[k + 1].x) / 2;
    if (X(R.wps[k + 1].x) - X(R.wps[k].x) < (mob ? 40 : 30)) return;
    if (Math.abs(sampleAt(R, xm).p - l.alt) > 150) return;   /* nur beschriften, wo die Hoehe auch geflogen wird */
    txts += lbl(X(xm), Y(sampleAt(R, xm).p) - 7, String(l.alt), f2, "#B02E7A", "middle", true, [0, -f2 * 1.2, f2 * 1.6, -f2 * 2.4]);
  });
  R.circles.forEach(function (c) { txts += lbl(X(c.x) + 6, Y(c.to) + f2 + 4, "\u21bb " + fmtFt(c.to), f2, "#B02E7A", "start", true); });
  if (R.spiralMin > 0) txts += lbl(X(D) - 16, Y(sm[sm.length - 1].p) + f2 + 4, "\u21ba Sinken im Vollkreis \u00fcber dem Platz (~" + Math.max(1, Math.round(R.spiralMin)) + " min)", f2, "#B02E7A", "end", true,
    [0, f2 * 1.3, f2 * 2.6, -f2 * 1.3]);
  if (P.maxAlt < yMax) txts += lbl(W - Rp - 4, Y(P.maxAlt) - 4, "max. " + P.maxAlt + " ft", f2, "#61717F", "end", false, [0, f2 * 1.4]);
  bandLbl.forEach(function (b) { txts += lbl(b.x, b.y, b.t, f2, b.c, "start", false, [0, f2 * 1.2, f2 * 2.4].filter(function (o) { return o + f2 < b.hgt; })); });
  /* Legende als HTML unter dem Bild: nur was im Profil vorkommt */
  RES.pvLeg = { cloud: !!bl, fz: !!fl, maxAlt: P.maxAlt < yMax, kinds: R.bands.filter(function (b) { return b.lo < yMax; }).map(function (b) { return b.as.kind; }),
    conf: R.conflicts.length > 0, hl: !!RES.hl, circ: R.circles.length > 0 || R.spiralMin > 0, edit: EDIT.on && R.custom };
  txts += "<text x='" + (Lp - 6) + "' y='" + (Tp - 6) + "' text-anchor='end' font-size='" + (f2 - 1) + "' fill='#61717F'>ft MSL</text>";
  return s + txts + "<g id='pedit'>" + ed.g + "</g><g id='pcur'></g></svg>";
}

/* ==================== 14a. Route und Hoehen bearbeiten ==================== */
/* Bearbeiten macht aus der gewaehlten Route eine "Eigene Route": Wegpunkte auf der Karte ziehen,
   per Klick auf die Linie einfuegen, per Popup/Rechtsklick loeschen; Reiseflughoehe je Teilstrecke im
   Profil ziehen (Doppelklick = wieder automatisch). Alles wird live neu bewertet. */
/* dirty = Nutzer hat wirklich etwas geaendert. Nur dann bleibt eine "Eigene Route" als Variante bestehen. */
var EDIT = { on: false, drag: null, dragging: false, pts: null, ua: {}, raf: 0, A: null, B: null, dirty: false, baseName: null };
function userIdx() { for (var k = 0; k < RES.routes.length; k++) if (RES.routes[k].id === "user") return k; return -1; }
function evalUser() {
  var R = routeFromPoints(RES.G, RES.P, EDIT.pts, EDIT.ua, "user", "Eigene Route"), k = userIdx();
  if (k < 0) { RES.routes.push(R); k = RES.routes.length - 1; } else RES.routes[k] = R;
  return k;
}
function startEdit() {
  if (!RES) return;
  var base = RES.routes[RES.sel];
  finalize(base, RES.G, RES.P);
  /* Exakt dieselbe Linie uebernehmen (inkl. Formpunkte), damit die Bewertung identisch bleibt.
     Ziehbar werden die Wegpunkte des Navigationslogs (Knicke, Hoehenwechsel, Meldepunkte). */
  EDIT.pts = base.pts.map(function (p) { return Object.assign({}, p); });
  EDIT.ua = base.custom ? Object.assign({}, base.userAlt || {}) : {};
  /* Ziehbar sind nur markante Punkte: echte Richtungswechsel (> 0,75 NM Abweichung von der Geraden),
     Meldepunkte und Grenzuebertritte. Die Linie bleibt exakt gleich (uebrige Punkte = Formpunkte). */
  if (!base.custom) {
    EDIT.pts.forEach(function (p, i) { if (i > 0 && i < EDIT.pts.length - 1) p.shape = !(p.rp || p.border); });
    (function dp(i0, i1) {
      var md = 0, mi = -1;
      for (var i = i0 + 1; i < i1; i++) { var d = segDist(EDIT.pts[i], EDIT.pts[i0], EDIT.pts[i1]).d; if (d > md) { md = d; mi = i; } }
      if (md > 0.75) { EDIT.pts[mi].shape = false; dp(i0, mi); dp(mi, i1); }
    })(0, EDIT.pts.length - 1);
  }
  EDIT.on = true; EDIT.A = RES.G.A; EDIT.B = RES.G.B;
  if (!base.custom) { EDIT.dirty = false; EDIT.baseName = base.name; }
  render(evalUser());
  setSts("Bearbeiten: Wegpunkte ziehen, Linie anklicken = Punkt einfügen, Punkt antippen = löschen. Höhen im Profil ziehen.");
}
function stopEdit() {
  EDIT.on = false; editLayer.clearLayers(); setSts("");
  if (!EDIT.dirty) {   /* nichts geaendert: zurueck zur urspruenglichen Route, keine "Eigene Route" anlegen */
    var k = userIdx(); if (k >= 0) RES.routes.splice(k, 1);
    EDIT.pts = null; EDIT.ua = {};
    var b = RES.routes.map(function (r) { return r.name; }).indexOf(EDIT.baseName);
    render(b >= 0 ? b : 0); return;
  }
  render(RES.sel);
}
function discardUser() {
  var k = userIdx(); EDIT.on = false; EDIT.pts = null; EDIT.ua = {}; EDIT.dirty = false;
  if (k >= 0) RES.routes.splice(k, 1);
  editLayer.clearLayers(); render(0); setSts("");
}
/* Waehrend des Ziehens: nur Linien, Profil und Urteil neu zeichnen (die Marker bleiben stehen) */
function quickUser() {
  EDIT.raf = 0;
  var k = evalUser(), R = RES.routes[k];
  RES.sel = k; finalize(R, RES.G, RES.P);
  drawRouteLines(R); drawProfile(R);
  var v = document.querySelector("#out .verdict");
  if (v) v.outerHTML = verdictHtml(R);
  updateChip(R);
}
function scheduleQuick() { if (!EDIT.raf) EDIT.raf = requestAnimationFrame(quickUser); }
async function commitEdit() {
  setSts("Neu bewerten …");
  try { await ensureArea(EDIT.pts); }
  catch (e) { setSts("Daten für den neuen Bereich nicht vollständig: " + esc(e.message), "err"); }
  render(evalUser());
  if (!$("sts").classList.contains("err")) setSts("");
}
/* Teilstrecke (fuer eigene Hoehen) des Abschnitts, der bei pts[k] endet */
function legOfSeg(k) { var n = 0; for (var j = 1; j < k; j++) if (!EDIT.pts[j].shape) n++; return n; }
/* Formpunkte zwischen dem vorigen und naechsten Wegpunkt entfernen (gezogener Punkt -> gerade Teilstrecken).
   Gibt den neuen Index des Punktes zurueck. */
function straighten(k) {
  var a = k - 1; while (a > 0 && EDIT.pts[a].shape) a--;
  var b = k + 1; while (b < EDIT.pts.length - 1 && EDIT.pts[b].shape) b++;
  var keep = EDIT.pts.slice(0, a + 1).concat([EDIT.pts[k]], EDIT.pts.slice(b));
  EDIT.pts = keep;
  return a + 1;
}
function drawEditMarkers(R) {
  editLayer.clearLayers();
  if (!EDIT.on || !R.custom) return;
  var num = 0;
  EDIT.pts.forEach(function (pt, k) {
    if (k === 0 || k === EDIT.pts.length - 1 || pt.shape) return;
    num++;
    var lbl = pt.name ? esc(pt.name) : String(num);
    var mk = L.marker([pt.lat, pt.lon], { draggable: true, autoPan: true,
      icon: L.divIcon({ className: "wpk" + (pt.rp ? " rp" : ""), html: "<b>" + lbl + "</b>", iconSize: null, iconAnchor: [12, 12] }) });
    mk.on("dragstart", function () { EDIT.dragging = true; EDIT.dirty = true; hideCursor(); k = straighten(k); });
    mk.on("drag", function (ev) {
      var ll = ev.target.getLatLng();
      EDIT.pts[k] = { lat: ll.lat, lon: ll.lng, name: null };   /* verschoben = kein Meldepunkt mehr */
      scheduleQuick();
    });
    mk.on("dragend", function () { EDIT.dragging = false; commitEdit(); });
    mk.on("contextmenu", function () { deleteWp(k); });
    mk.bindPopup("<div class='pop'><b class='h'>Wegpunkt " + lbl + "</b><br><button class='btn2' data-delwp='" + k + "' style='margin-top:6px'>Wegpunkt löschen</button></div>");
    mk.addTo(editLayer);
  });
}
function deleteWp(k) {
  if (k <= 0 || k >= EDIT.pts.length - 1 || EDIT.pts[k].shape) return;
  map.closePopup(); EDIT.dirty = true;
  var L0 = legOfSeg(k);   /* Teilstrecken L0 und L0+1 werden zu L0 */
  k = straighten(k); EDIT.pts.splice(k, 1);
  var ua = {}; Object.keys(EDIT.ua).forEach(function (l) { l = +l; if (l <= L0) ua[l] = EDIT.ua[l]; else if (l > L0 + 1) ua[l - 1] = EDIT.ua[l]; });
  EDIT.ua = ua;
  commitEdit();
}
function routeLineClick(R, ev) {
  if (!EDIT.on || !R.custom) { showCursor(nearestX(R, ev.latlng), "map"); return; }
  var p = { lat: ev.latlng.lat, lon: ev.latlng.lng }, best = null;
  for (var k = 0; k < EDIT.pts.length - 1; k++) { var d = segDist(p, EDIT.pts[k], EDIT.pts[k + 1]).d; if (!best || d < best.d) best = { d: d, k: k }; }
  EDIT.dirty = true;
  var L0 = legOfSeg(best.k + 1);   /* Teilstrecke L0 wird in L0 und L0+1 geteilt */
  EDIT.pts.splice(best.k + 1, 0, { lat: p.lat, lon: p.lon, name: null });
  var ua = {}; Object.keys(EDIT.ua).forEach(function (l) { l = +l; ua[l > L0 ? l + 1 : l] = EDIT.ua[l]; if (l === L0) ua[l + 1] = EDIT.ua[l]; });
  EDIT.ua = ua;
  commitEdit();
}
map.getContainer().addEventListener("click", function (e) {
  var b = e.target.closest("[data-delwp]"); if (b) deleteWp(+b.getAttribute("data-delwp"));
});
/* Daten fuer einen gezogenen Bereich nachladen: Gelaende je Teilstrecke, Luftraum, fehlende Wetterpunkte */
async function ensureArea(pts) {
  var G = RES.G, jobs = [];
  for (var k = 1; k < pts.length; k++) {
    var a = pts[k - 1], b = pts[k];
    jobs.push(ensureDem(Math.min(a.lon, b.lon) - 0.07, Math.min(a.lat, b.lat) - 0.05, Math.max(a.lon, b.lon) + 0.07, Math.max(a.lat, b.lat) + 0.05, G.demZ));
  }
  await Promise.all(jobs);
  var w = 180, s = 90, e = -180, n = -90;
  pts.forEach(function (q) { w = Math.min(w, q.lon); e = Math.max(e, q.lon); s = Math.min(s, q.lat); n = Math.max(n, q.lat); });
  if (!pts.every(function (q) { return inAirBoxes(G, q); })) {
    var box = [w - 0.2, s - 0.2, e + 0.2, n + 0.2], r = await dataIn("asp", box[0], box[1], box[2], box[3]);
    var ids = {}; G.AIR.forEach(function (x) { ids[x.id] = 1; });
    r.list.forEach(function (x) { if (!ids[x.id]) G.AIR.push(x); });
    if (r.failed.length) throw new Error("Luftraumdaten für " + r.failed.join(", ") + " fehlen");
    G.airBoxes.push(box);
  }
  var R = routeFromPoints(G, RES.P, pts, EDIT.ua);
  if (R.wxFar.length) await addWxPoints(G, R.wxFar);
}
async function addWxPoints(G, far) {
  var add = [];
  far.forEach(function (q) { if (add.length < 20 && !add.some(function (a) { return distNm(a, q) < 8; })) add.push({ lat: q.lat, lon: q.lon }); });
  if (!add.length) return;
  var res = await Promise.all(MODELS.map(function (m, mi) {
    if (!G.wx[mi]) return Promise.resolve(null);
    return fetchModel(mi, add, RES.P.date).catch(function () { return add.map(function () { return null; }); });
  }));
  add.forEach(function (q) { G.wpts.push(q); });
  res.forEach(function (d, mi) { if (G.wx[mi]) G.wx[mi] = G.wx[mi].concat(d || add.map(function () { return null; })); });
}
/* Hoehen-Griffe im Profil */
function editSvg(R, X, Y, f2, lbl, reserve) {
  var legs = {}, out = "", txt = "";
  R.rs.forEach(function (r) {
    var l = legs[r.e.leg] || (legs[r.e.leg] = { leg: r.e.leg, x0: r.x0, x1: r.x1, alt: r.alt, user: r.user });
    l.x1 = r.x1;
  });
  R.legX = Object.keys(legs).map(function (k) { return legs[k]; });
  /* zuerst alle Griffe reservieren, damit keine Beschriftung darauf landet */
  R.legX.forEach(function (l) {
    var x0 = X(l.x0) + 3, x1 = X(l.x1) - 3, y = Y(l.alt), xm = (x0 + x1) / 2;
    if (x1 - x0 >= 6) reserve(xm - 11, y - 11, xm + 11, y + 11);
  });
  R.legX.forEach(function (l) {
    var x0 = X(l.x0) + 3, x1 = X(l.x1) - 3, y = Y(l.alt), xm = (x0 + x1) / 2;
    if (x1 - x0 < 6) return;
    out += "<line x1='" + x0 + "' x2='" + x1 + "' y1='" + y + "' y2='" + y + "' stroke='#B02E7A' stroke-width='9' stroke-opacity='0.18' stroke-linecap='round'/>" +
      "<circle cx='" + xm.toFixed(1) + "' cy='" + y + "' r='8' fill='#fff' stroke='#B02E7A' stroke-width='2.5' style='cursor:ns-resize'/>" +
      "<path d='M " + (xm - 3).toFixed(1) + " " + (y - 2) + " l 3 -3 l 3 3 M " + (xm - 3).toFixed(1) + " " + (y + 2) + " l 3 3 l 3 -3' stroke='#B02E7A' stroke-width='1.5' fill='none'/>";
    var right = xm > RES.pv.W - 140;
    txt += lbl(xm + (right ? -12 : 12), y - 6, l.alt + " ft" + (l.user ? " \u270e" : " auto"), f2, "#B02E7A", right ? "end" : "start", true, [0, -f2 * 1.2, f2 * 2.2, -f2 * 2.4]);
  });
  return { g: out, t: txt };
}
function legAt(c) {
  var R = RES.routes[RES.sel], pv = RES.pv; if (!R || !R.legX) return null;
  for (var k = 0; k < R.legX.length; k++) {
    var l = R.legX[k];
    if (c.x >= l.x0 - 0.3 && c.x <= l.x1 + 0.3 && Math.abs(pv.Y(l.alt) - c.y) <= 16) return l;
  }
  return null;
}
function altFromY(y) {
  var pv = RES.pv, f = 1 - (y - pv.Tp) / (pv.H - pv.Tp - pv.Bp);
  return Math.max(500, Math.min(15000, Math.round(f * pv.yMax / 100) * 100));
}

/* ==================== 14b. Kopplung Profil <-> Karte ==================== */
/* Maus/Finger im Hoehenprofil zeigt die Position als Marker auf der Karte, Maus ueber der Route auf der
   Karte zeigt die Stelle im Profil (Linie + Werte) */
var curLayer = L.layerGroup().addTo(map), CUR = { mk: null, x: null };
function sampleInterp(R, x) {
  var sm = R.samples, n = sm.length;
  x = Math.max(0, Math.min(R.D, x));
  var i = 1; while (i < n - 1 && sm[i].x < x) i++;
  var a = sm[i - 1], b = sm[i], f = b.x > a.x ? Math.max(0, Math.min(1, (x - a.x) / (b.x - a.x))) : 0;
  function m(k) { var u = a[k], v = b[k]; return (isFinite(u) && isFinite(v)) ? u + (v - u) * f : (f < 0.5 ? u : v); }
  return { x: x, lat: m("lat"), lon: m("lon"), p: m("p"), tc: m("tc"), tm: m("tm"), base: m("base"), t: m("t"), ri: (f < 0.5 ? a : b).ri, conf: a.conf || b.conf };
}
function svgX(ev) {
  var svg = $("profBody").querySelector("svg"); if (!svg || !RES || !RES.pv) return null;
  var pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
  var sp = pt.matrixTransform(svg.getScreenCTM().inverse()), pv = RES.pv;
  return { x: (sp.x - pv.Lp) / (pv.W - pv.Lp - pv.Rp) * pv.D, y: sp.y, sx: sp.x };
}
function cursorTxt(q) {
  return "NM " + q.x.toFixed(0) + " \u00b7 " + fmtH(q.t) + " \u00b7 " + fmtFt(q.p) + " ft \u00b7 Gel\u00e4nde " + fmtFt(q.tc) +
    (isFinite(q.base) ? " \u00b7 Basis " + fmtFt(q.base) : "");
}
function showCursor(x, from) {
  if (!RES || !RES.pv || RES.sel == null) return;
  var R = RES.routes[RES.sel], q = sampleInterp(R, x), pv = RES.pv, g = $("pcur");
  CUR.x = x;
  if (g) {
    var X = pv.X(q.x), Yp = pv.Y(q.p), txt = cursorTxt(q), w = txt.length * pv.f2 * 0.56 + 12, left = X > pv.W / 2;
    var bx = left ? X - w - 8 : X + 8, by = pv.Tp + 2;
    g.innerHTML = "<line x1='" + X + "' x2='" + X + "' y1='" + pv.Tp + "' y2='" + (pv.H - pv.Bp) + "' stroke='#0F1D2A' stroke-width='1' stroke-dasharray='3 3'/>" +
      "<circle cx='" + X + "' cy='" + Yp + "' r='5' fill='#fff' stroke='#B02E7A' stroke-width='2.5'/>" +
      "<rect x='" + bx.toFixed(1) + "' y='" + by + "' width='" + w.toFixed(1) + "' height='" + (pv.f2 + 8) + "' rx='4' fill='#0F1D2A' fill-opacity='0.88'/>" +
      "<text x='" + (bx + 6).toFixed(1) + "' y='" + (by + pv.f2 + 2) + "' font-size='" + pv.f2 + "' fill='#fff'>" + esc(txt) + "</text>";
  }
  var ll = [q.lat, q.lon];
  if (!CUR.mk) {
    CUR.mk = L.circleMarker(ll, { radius: 8, color: "#B02E7A", weight: 3, fillColor: "#fff", fillOpacity: 1, interactive: false }).addTo(curLayer);
    CUR.mk.bindTooltip("", { permanent: true, direction: "right", offset: [10, 0], className: "curtip" });
  } else CUR.mk.setLatLng(ll);
  CUR.mk.setTooltipContent(esc(cursorTxt(q)));
  if (from === "prof" && !MOB.on && !map.getBounds().pad(-0.05).contains(ll)) map.panTo(ll, { animate: true });
}
function hideCursor() {
  CUR.x = null;
  var g = $("pcur"); if (g) g.innerHTML = "";
  curLayer.clearLayers(); CUR.mk = null;
}
function nearestX(R, ll) {
  var best = null, kx = Math.cos(ll.lat * RAD);
  R.samples.forEach(function (q) {
    var dx = (q.lon - ll.lng) * kx, dy = q.lat - ll.lat, d = dx * dx + dy * dy;
    if (!best || d < best.d) best = { d: d, x: q.x };
  });
  return best ? best.x : 0;
}
function setupCursor() {
  var pb = $("profBody");
  pb.addEventListener("pointerdown", function (ev) {
    if (!EDIT.on || !RES || !RES.routes[RES.sel] || !RES.routes[RES.sel].custom) return;
    var c = svgX(ev), l = c && legAt(c); if (!l) return;
    ev.preventDefault(); ev.stopPropagation();
    /* Doppeltipp/-klick auf den Griff = Hoehe wieder automatisch (eigene Erkennung, da das Profil
       zwischen den Klicks neu gezeichnet wird und der Browser dann kein dblclick meldet) */
    var now = Date.now();
    if (EDIT.lastTap && EDIT.lastTap.leg === l.leg && now - EDIT.lastTap.t < 450) {
      EDIT.lastTap = null; EDIT.dirty = true; delete EDIT.ua[l.leg]; render(evalUser()); return;
    }
    EDIT.lastTap = { leg: l.leg, t: now };
    EDIT.drag = { leg: l.leg, moved: false }; RES.pvFreeze = RES.pv.yMax;
    try { pb.setPointerCapture(ev.pointerId); } catch (e) {}
    hideCursor();
  }, true);
  pb.addEventListener("pointermove", function (ev) {
    if (EDIT.drag) {
      var cd = svgX(ev); if (!cd) return;
      var a = altFromY(cd.y);
      var curA = EDIT.ua[EDIT.drag.leg];
      if (!EDIT.drag.moved && curA == null) { var lg = legAt({ x: cd.x, y: RES.pv.Y(a) }) || {}; curA = lg.alt; }
      if (curA !== a && (EDIT.drag.moved || Math.abs(a - curA) >= 200)) { EDIT.drag.moved = true; EDIT.dirty = true; EDIT.lastTap = null; EDIT.ua[EDIT.drag.leg] = a; scheduleQuick(); }
      ev.preventDefault(); return;
    }
    var c = svgX(ev); if (!c) return;
    if (c.x < -0.5 || c.x > RES.pv.D + 0.5) { hideCursor(); return; }
    showCursor(c.x, "prof");
  });
  pb.addEventListener("pointerdown", function (ev) { var c = svgX(ev); if (c && c.x >= 0 && c.x <= RES.pv.D) showCursor(c.x, "prof"); });
  pb.addEventListener("pointerleave", function (ev) { if (ev.pointerType === "mouse" && !EDIT.drag) hideCursor(); });
  function endDrag() {
    if (!EDIT.drag) return;
    var moved = EDIT.drag.moved; EDIT.drag = null; RES.pvFreeze = null;
    if (moved) render(evalUser());
  }
  pb.addEventListener("pointerup", endDrag);
  pb.addEventListener("pointercancel", endDrag);
}

/* ==================== 15. Start ==================== */
(function init() {
  var t = new Date(), today = t.getFullYear() + "-" + p2(t.getMonth() + 1) + "-" + p2(t.getDate());
  var mx = new Date(t.getTime() + 6 * 86400000);
  $("dDate").value = today; $("dDate").min = today;
  $("dDate").max = mx.getFullYear() + "-" + p2(mx.getMonth() + 1) + "-" + p2(mx.getDate());
  /* Vorschlag: naechste volle Stunde; ab 17 Uhr (bald dunkel) morgen 10:00 */
  if (t.getHours() >= 17) {
    var tm = new Date(t.getTime() + 86400000);
    $("dDate").value = tm.getFullYear() + "-" + p2(tm.getMonth() + 1) + "-" + p2(tm.getDate());
    $("dTime").value = "10:00";
  } else $("dTime").value = p2(Math.max(8, t.getHours() + 1)) + ":00";
  setupAc("fIn", "fAc", "from");
  setupAc("tIn", "tAc", "to");
  loadSettings();
  $("go").addEventListener("click", plan);
  $("out").addEventListener("click", onOutClick);
  $("exp").addEventListener("click", onExpClick);
  $("asFilter").addEventListener("change", function () { drawAir(); saveSettings(); });
  $("avoidClr").addEventListener("change", saveSettings);
  $("prefGafor").addEventListener("change", saveSettings);
  if (isMob()) setupMobile();
  $("lgT").addEventListener("click", function () { var l = $("legend"); l.classList.toggle("col"); $("lgA").innerHTML = l.classList.contains("col") ? "&#9656;" : "&#9662;"; });
  setupCursor();
  /* Beim Drucken alle aufklappbaren Bereiche oeffnen */
  window.addEventListener("beforeprint", function () { Array.prototype.forEach.call(document.querySelectorAll("#out details"), function (d) { d.open = true; }); });
  $("profHead").addEventListener("click", function () {
    var p = $("prof"); p.classList.toggle("min");
    $("profTgl").innerHTML = p.classList.contains("min") ? "&#9650;" : "&#9660;";
  });
  loadCountry("AT", "apt").catch(function () {});
  loadGafor();
  loadAirView();
  setSts("Bereit \u2013 Start und Ziel w\u00e4hlen, dann \u201eSicherste Route berechnen\u201c.");
})();
