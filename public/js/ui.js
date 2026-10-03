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
  attribution: "Karte: &copy; OpenStreetMap, SRTM | Stil: &copy; OpenTopoMap (CC-BY-SA) | Luftraum: openAIP | Orte: GeoNames"
}).addTo(map);
/* Wetterbild als Ueberlagerung (nur Anzeige, fliesst NICHT in die Bewertung ein):
   Radar von RainViewer (letztes Bild), Satellit von EUMETSAT (Meteosat, WMS ueber /sat): Wolken aus Infrarot
   (aufbereitet: nur Wolken sichtbar) oder Echtfarben bei Tag. */
var wxOverlay = null, wxTimer = null;
var IR_LO = 105, IR_HI = 215;   /* Grauwert IR-Bild: darunter wolkenfrei (durchsichtig), darueber voll weiss */
var NAT_LO = 95, NAT_HI = 185;  /* Echtfarben: kleinerer Wert aus Gruen/Blau - Land und Wasser darunter, Wolken darueber */
function ramp(x, lo, hi) { return Math.max(0, Math.min(1, (x - lo) / (hi - lo))); }
function cloudIr(l) { return ramp(l, IR_LO, IR_HI); }
function cloudNat(r, g, b) { return ramp(Math.min(g, b), NAT_LO, NAT_HI); }
/* Echtfarben nur anbieten, wenn EUMETSAT die Ebene gerade fuehrt */
fetch("sat/caps").then(function (r) { return r.json(); }).then(function (c) {
  if (c && c.nat === false) { var o = document.querySelector("#wxLayer option[value='nat']"); if (o) o.remove(); }
}).catch(function () {});
async function setWxLayer(v) {
  if (wxOverlay) { map.removeLayer(wxOverlay); wxOverlay = null; }
  clearTimeout(wxTimer); $("wxInfo").textContent = "";
  try { localStorage.setItem("vfrWxLayer", v); } catch (e) {}
  if (!v) return;
  var fails = 0, info = "";
  function watch(l) {
    l.on("tileerror", function () { if (++fails === 4) $("wxInfo").textContent = info + " \u2013 Bilder nicht erreichbar."; });
    l.addTo(map); wxOverlay = l;
  }
  try {
    if (v === "radar") {
      var j = await fetchJSON("https://api.rainviewer.com/public/weather-maps.json");
      var fr = j.radar && j.radar.past && j.radar.past[j.radar.past.length - 1];
      if (!fr) throw new Error("keine Radardaten");
      if ($("wxLayer").value !== v) return;
      info = "Radar " + fmtH(new Date(fr.time * 1000).getHours() * 60 + new Date(fr.time * 1000).getMinutes()) + " (RainViewer)";
      watch(L.tileLayer(j.host + fr.path + "/256/{z}/{x}/{y}/2/1_1.png", { opacity: 0.6, maxNativeZoom: 7, maxZoom: 15, zIndex: 5,
        attribution: "Radar: <a href='https://www.rainviewer.com' target='_blank' rel='noopener'>RainViewer</a>" }));
      wxTimer = setTimeout(function () { if ($("wxLayer").value === "radar") setWxLayer("radar"); }, 10 * 60000);
    } else if (v === "ir" || v === "nat") {
      /* Nur die Wolken zeigen, alles andere durchsichtig: die Karte bleibt scharf (Meteosat hat ueber
         Oesterreich nur ~3-5 km je Bildpunkt). IR 10,8 um: kalt = Wolke (Tag und Nacht, tiefe Wolken kaum).
         Echtfarben (nur bei Tag): Wolken sind hell in Gruen und Blau (Land gruen/braun, Wasser dunkel) -
         zeigt auch tiefe Wolken, Schnee sieht aber aus wie Wolke. Kacheln ueber den eigenen Server (/sat). */
      var nat = v === "nat";
      info = nat ? "Wolken aus Meteosat Echtfarben (EUMETSAT) \u2013 nur bei Tag, Schnee sieht wie Wolke aus"
        : "Wolken aus Meteosat Infrarot (EUMETSAT), neuestes Bild; tiefe Wolken/Nebel kaum sichtbar";
      var okT = 0, errT = 0;
      var lay = new (L.GridLayer.extend({ createTile: function (c, done) {
        var cv = document.createElement("canvas"); cv.width = cv.height = 256;
        var img = new Image();
        img.onload = function () {
          try {
            var g = cv.getContext("2d"); g.drawImage(img, 0, 0);
            var d = g.getImageData(0, 0, 256, 256), a = d.data;
            for (var i = 0; i < a.length; i += 4) {
              var f = nat ? cloudNat(a[i], a[i + 1], a[i + 2]) : cloudIr(a[i] * 0.3 + a[i + 1] * 0.59 + a[i + 2] * 0.11);
              var w = 205 + 50 * f;
              a[i] = w; a[i + 1] = w; a[i + 2] = Math.min(255, w + 8); a[i + 3] = Math.round(a[i + 3] * Math.pow(f, 0.8) * 0.92);
            }
            g.putImageData(d, 0, 0); okT++; done(null, cv);
          } catch (e) { done(e, cv); }
        };
        img.onerror = function () { done(new Error("Kachel"), cv); };
        img.src = "sat/" + v + "/" + c.z + "/" + c.x + "/" + c.y + ".png";
        return cv;
      } }))({ maxNativeZoom: 8, maxZoom: 15, zIndex: 5, attribution: "Satellit: &copy; EUMETSAT" });
      lay.on("tileerror", function () {
        if (++errT === 4 && !okT && $("wxLayer").value === v) {   /* eigener Server erreicht EUMETSAT nicht: Rohbild direkt */
          map.removeLayer(lay);
          info = "Meteosat Infrarot direkt (EUMETSAT), ohne Aufbereitung";
          watch(L.tileLayer.wms("https://view.eumetsat.int/geoserver/ows", { layers: "msg_fes:ir108", format: "image/png", transparent: true,
            version: "1.3.0", opacity: 0.5, zIndex: 5, attribution: "Satellit: &copy; EUMETSAT" }));
          $("wxInfo").textContent = info + " \u2013 nur Orientierung, keine Bewertung.";
        }
      });
      lay.addTo(map); wxOverlay = lay;
      wxTimer = setTimeout(function () { if ($("wxLayer").value === v) setWxLayer(v); }, 15 * 60000);
    }
    $("wxInfo").textContent = info + " \u2013 nur Orientierung, keine Bewertung.";
  } catch (e) { $("wxInfo").textContent = "Wetterbild nicht verf\u00fcgbar (" + e.message + ")."; }
}
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
    var nat = a.kind === "info" && isNature(a), col = nat ? NATURE_C : KIND[a.kind].c;
    L.geoJSON({ type: "Feature", geometry: a.geometry, properties: {} }, {
      renderer: cvs, interactive: false,
      style: { color: col, weight: nat ? 2 : a.temp ? 1.8 : 1.2, fillColor: col, fillOpacity: nat ? 0.12 : a.kind === "info" ? 0.03 : 0.07,
        dashArray: a.temp ? "3 5" : ((a.kind === "tmz" || a.kind === "rmz") ? "8 4" : nat ? "10 3 2 3" : null) }
    }).addTo(airLayer);
  });
}
map.on("moveend", function () { clearTimeout(airTimer); airTimer = setTimeout(loadAirView, 350); });
/* Klick in die Karte: ALLE Lufträume am Punkt, nach Untergrenze sortiert */
var MAP_CLICK_OFF = 0;   /* nach dem Sprung vom Profil zur Karte den "durchfallenden" Tipp ignorieren */
map.on("click", function (ev) {
  if (Date.now() < MAP_CLICK_OFF) return;
  var lat = ev.latlng.lat, lon = ev.latlng.lng;
  var hits = VIEW_AIR.filter(function (a) { return lon >= a.bb[0] && lon <= a.bb[2] && lat >= a.bb[1] && lat <= a.bb[3] && inGeom(a.geometry, lon, lat); });
  if (!hits.length) { showAsOutline(null); return; }
  hits.sort(function (x, y) { return x.loFt - y.loFt; });
  var lim = +$("asFilter").value, hidden = lim ? hits.filter(function (a) { return a.loFt > lim; }).length : 0;
  CLICK_HITS = hits;
  var h = "<div class='pop'><b class='h'>" + hits.length + " Luftr\u00e4um" + (hits.length > 1 ? "e" : "") + " an diesem Punkt</b>" +
    "<div class='note' style='margin:2px 0 3px'>Antippen = Umriss auf der Karte zeigen</div>";
  hits.forEach(function (a, i) {
    var at = actTxt(a), col = a.kind === "info" && isNature(a) ? NATURE_C : KIND[a.kind].c;
    h += "<div class='asr asel' data-asi='" + i + "'><i style='background:" + col + "'></i><b>" + esc(a.name) + "</b><br><small>" +
      (TYPE_TXT[a.type] || "?") + " (Nr. " + a.type + ") \u00b7 " + clsTxt(a) + " \u00b7 " + fmtLimit(a.lower) + " \u2013 " + fmtLimit(a.upper) +
      (at ? " \u00b7 <b style='color:#C1810B'>" + at + "</b>" : "") + "</small>" + asFreqLine(a) + "</div>";
  });
  if (hidden) h += "<div class='note' style='margin-top:4px'>" + hidden + " davon wegen H\u00f6henfilter nicht gezeichnet.</div>";
  h += "<div class='asfoot'></div></div>";
  var pop = L.popup({ maxWidth: Math.min(400, map.getSize().x - 60), autoPanPadding: [12, 12] }).setLatLng(ev.latlng).setContent(h).openOn(map);
  pop.on("remove", function () { if (!AS_KEEP) showAsOutline(null); });
  /* Klicks im Fenster erreichen das Dokument nicht (Leaflet stoppt sie) - daher direkt am Fenster */
  pop.getElement().addEventListener("click", function (e) {
    var r = e.target.closest(".asel"); if (!r) return;
    var i = +r.getAttribute("data-asi"); showAsOutline(asSelIdx === i ? null : i);
  });
  if (hits.length === 1) showAsOutline(0);   /* nur einer: gleich zeigen */
});
/* Zustaendige Frequenz im Klick-Fenster: bei freigabepflichtigen Lufträumen, RMZ, Gefahren-/TRA-Gebieten */
function asFreqLine(a) {
  if (["clearance", "rmz", "danger", "tra"].indexOf(a.kind) < 0) return "";
  var f = unitFreq(a, RES && RES.G), lbl = a.kind === "clearance" ? "Freigabe" : a.kind === "rmz" ? "Funk" : "Info/Aktivierung";
  var known = /^ \u2013 /.test(f);
  return "<div class='asfq" + (known ? "" : " unk") + "'>\ud83d\udcfb " + lbl + ": " + (known ? f.slice(3) : "laut AIP/ICAO-Karte (in openAIP nicht hinterlegt)") + "</div>";
}
/* Umriss eines Luftraums aus dem Klick-Fenster hervorheben (weisser Rand + kraeftige Linie) */
var AS_KEEP = false, CLICK_HITS = [], asSelLayer = L.layerGroup().addTo(map), asSelIdx = null;
function showAsOutline(i) {
  asSelLayer.clearLayers(); asSelIdx = i;
  var ft0 = document.querySelector(".leaflet-popup .asfoot"); if (ft0) ft0.innerHTML = "";
  document.querySelectorAll(".asel").forEach(function (e) { e.classList.toggle("on", i != null && +e.getAttribute("data-asi") === i); });
  if (i == null || !CLICK_HITS[i]) return;
  var a = CLICK_HITS[i], col = a.kind === "info" && isNature(a) ? NATURE_C : KIND[a.kind].c, gj = { type: "Feature", geometry: a.geometry, properties: {} };
  L.geoJSON(gj, { interactive: false, style: { color: "#fff", weight: 7, opacity: 0.9, fill: false } }).addTo(asSelLayer);
  L.geoJSON(gj, { interactive: false, style: { color: col, weight: 3.5, opacity: 1, fillColor: col, fillOpacity: 0.18 } }).addTo(asSelLayer);
  /* ragt der Umriss aus dem Bild: Knopf im Fensterfuss (nicht in der Zeile - sonst trifft ein zweiter Tipp ihn) */
  var b = L.geoJSON(gj).getBounds(), ft = document.querySelector(".leaflet-popup .asfoot");
  if (ft && !map.getBounds().contains(b)) {
    ft.innerHTML = "<a href='#' class='asfit'>\u2922 ganzen Umriss von " + esc(a.name) + " zeigen</a>";
    ft.firstChild.addEventListener("click", function (e) {   /* Fenster zu, Umriss bleibt (naechster Klick in die Karte loescht ihn) */
      e.preventDefault(); e.stopPropagation(); AS_KEEP = true; map.closePopup(); AS_KEEP = false; map.fitBounds(b, { padding: [30, 30] });
    });
  }
}


/* GAFOR-Strecken laden: nur verwenden, wenn die Datei als geprueft markiert ist und Strecken enthaelt */
var gaforLayer = L.layerGroup();
async function loadGafor() {
  try {
    var j = await (await fetch("data/gafor.geojson", { cache: "no-cache" })).json();
    if (!j || j.geprueft !== true || !Array.isArray(j.features) || !j.features.length) return;
    GAFOR = [];
    j.features.forEach(function (f) {
      var g = f.geometry || {}, lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
      lines.forEach(function (l) { GAFOR.push({ nr: (f.properties || {}).nr || "", name: (f.properties || {}).name || "", bz: (f.properties || {}).bezugshoehe, pts: l.map(function (c) { return { lat: c[1], lon: c[0] }; }) }); });
    });
    GAFOR.forEach(function (r) {
      /* breiter heller Unterstrich, damit die Punktlinie auf der Topokarte gut sichtbar ist */
      L.polyline(r.pts.map(function (q) { return [q.lat, q.lon]; }), { color: "#fff", weight: 9, opacity: 0.55, interactive: false }).addTo(gaforLayer);
      L.polyline(r.pts.map(function (q) { return [q.lat, q.lon]; }), { color: "#0E8A6E", weight: 6, opacity: 0.85, dashArray: "1 10", lineCap: "round", interactive: true })
        .bindTooltip("<b>GAFOR " + esc(r.nr) + "</b>" + (r.name ? " " + esc(r.name) : "") + (r.bz ? "<br>Bezugsh\u00f6he " + r.bz + " ft" : "") +
          "<br><small>Linie ungef\u00e4hr (" + esc(j.genauigkeit || "") + ") \u2013 aktuelle Einstufung: GAFOR von Austro Control</small>").addTo(gaforLayer);
    });
    var d = document.createElement("div"); d.style.cssText = "margin-top:6px;display:flex;gap:6px;align-items:flex-start;cursor:pointer";
    d.innerHTML = "<input type='checkbox' id='gaforOn' checked style='margin:3px 0 0;width:auto;height:auto;flex:none'><span onclick=\"document.getElementById('gaforOn').click()\">" +
      "<i style='background:none;border-top:3px dotted #16A085;border-radius:0;height:0;width:16px;vertical-align:3px'></i>GAFOR-Strecken <small style='color:#61717F'>(Linien ungef\u00e4hr)</small></span>";
    $("legend").querySelector(".lg").appendChild(d);
    gaforLayer.addTo(map);
    $("prefGafor").disabled = false;
    $("gaforInfo").textContent = "(nur bei gleicher Sicherheit; Linien ungef\u00e4hr aus der GAFOR-Karte)";
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
/* Von und Nach mit einem Klick tauschen (auch halb ausgefuellte Eingaben) */
function swapFromTo() {
  var f = S.from, t = S.to, fv = $("fIn").value, tv = $("tIn").value;
  S.from = t; S.to = f;
  if (S.from) showSel("fIn", S.from); else { $("fIn").value = tv; $("fIn").classList.remove("ok"); }
  if (S.to) showSel("tIn", S.to); else { $("tIn").value = fv; $("tIn").classList.remove("ok"); }
  saveSettings();
  if (S.from && S.to && RES) setSts("Von und Nach getauscht \u2013 \u201eSicherste Route berechnen\u201c f\u00fcr den R\u00fcckweg.");
}
var KEEP = ["tas", "maxAlt", "terrClr", "cloudClr", "prefAgl", "climb", "desc", "retStay", "xwMax"];
function saveSettings() {
  try {
    var o = { v74: true, from: S.from, to: S.to, avoidClr: $("avoidClr").checked, prefGafor: $("prefGafor").checked, retOn: $("retOn").checked, asFilter: $("asFilter").value };
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
    $("retOn").checked = !!o.retOn; $("retRow").style.display = o.retOn ? "" : "none";
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
    preferGafor: !!GAFOR && $("prefGafor").checked,
    ret: $("retOn").checked, stay: clampNum($("retStay").value, 0, 600, 60), xwMax: clampNum($("xwMax").value, 5, 35, 15)
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
  if (!P.date) { setSts("Bitte Datum wählen.", "err"); return; }
  $("go").disabled = true; hlLayer.clearLayers(); setSts("");
  progStart([["dem", "Gelände", 14], ["asp", "Luftraum", 9], ["apt", "Flugplätze", 3], ["awx", "METAR/TAF", 3], ["plc", "Orte", 2]]
    .concat(MODELS.map(function (m, mi) { return ["wx" + mi, m.l.replace(/ \(.*\)/, ""), 6]; }))
    .concat([["net", "Streckennetz", 10], ["route", "Routensuche", 12], ["opt", "Abflugzeit-Optimierer", 19]])
    .concat(P.ret ? [["ret", "R\u00fcckflug", 8]] : []));
  try {
    var G = buildGraph(A, B, d);
    var w = 180, s = 90, e = -180, n = -90;
    G.nodes.forEach(function (q) { w = Math.min(w, q.lon); e = Math.max(e, q.lon); s = Math.min(s, q.lat); n = Math.max(n, q.lat); });
    var bw = w - 0.2, bs = s - 0.2, be = e + 0.2, bn = n + 0.2;
    var awxKey = [Math.floor((bs - 0.1) * 2) / 2, Math.floor((bw - 0.1) * 2) / 2, Math.ceil((bn + 0.1) * 2) / 2, Math.ceil((be + 0.1) * 2) / 2].join(",");
    G.t0 = new Date(P.date + "T00:00:00").getTime() / 1000;
    /* Alle Downloads parallel: Gelaende, Luftraum, Plaetze, METAR/TAF und die 5 Wettermodelle */
    var demZ = demZoom(w - 0.07, s - 0.05, e + 0.07, n + 0.05);
    var pDem = ensureDem(w - 0.07, s - 0.05, e + 0.07, n + 0.05, demZ, function (k, t) { progSet("dem", k / t, null, k + "/" + t + " Kacheln"); })
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
    var pSun = Promise.resolve(sunFor(A, B, P.date));
    /* Orte und Staatsgrenzen (feste Dateien): fuer Ortsnamen, Grenzuebertritte und Wendepunkte */
    progSet("plc", 0.1);
    var pPlaces = Promise.all([loadPlaces(bw, bs, be, bn), loadBorders(bw - 0.5, bs - 0.5, be + 0.5, bn + 0.5)])
      .then(function (r) { progSet("plc", 1, "ok", r[0].length + " Orte"); return r; },
        function () { progSet("plc", 1, "err", "nicht verf\u00fcgbar"); return [[], []]; });
    await pDem;
    G.depElev = A.elevFt != null ? A.elevFt : (elevFt(A.lat, A.lon) || 0);
    G.destElev = B.elevFt != null ? B.elevFt : (elevFt(B.lat, B.lon) || 0);
    G.demBox = [w - 0.07, s - 0.05, e + 0.07, n + 0.05]; G.demZ = demZ;
    var got = await Promise.all([pAsp, pApt, pAwx]);
    G.airFailed = got[0].failed; G.AIR = got[0].list; G.FIRS = got[0].firs || []; G.airBoxes = coverBoxes([bw, bs, be, bn], got[0].ok || []);
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
    var pb = await pPlaces; G.PLACES = pb[0]; G.BORDERS = pb[1];
    await adjustRoutes(RES.routes, G, P);
    await snapLandmarks(RES.routes, G, P);
    /* Eigene Route bleibt bei Neuberechnung (z. B. andere Abflugzeit) erhalten, wenn Start/Ziel gleich sind */
    var keepSel = 0;
    if (EDIT.pts && EDIT.dirty && EDIT.A && EDIT.B && EDIT.A.lat === A.lat && EDIT.A.lon === A.lon && EDIT.B.lat === B.lat && EDIT.B.lon === B.lon) {
      try { await ensureArea(EDIT.pts); var ku = evalUser(); if (EDIT.on) keepSel = ku; } catch (e) { EDIT.on = false; }
    } else { EDIT.on = false; EDIT.pts = null; EDIT.ua = {}; EDIT.dirty = false; editLayer.clearLayers(); }
    progSet("route", 1, "ok", RES.routes.length + " Varianten");
    RES.opt = await optimizer(G, P, function (k, t, h) { progSet("opt", k / t, null, p2(h) + ":00"); });
    progSet("opt", 1, "ok", RES.opt.length + " Stunden");
    if (P.ret) {   /* Rueckflug: dieselbe Strecke umgekehrt, ab Ankunft + Aufenthalt */
      progSet("ret", 0.05);
      var r0 = RES.routes[0], ecR = G.sun && G.sun.depEcet != null ? G.sun.depEcet * 60 : 22 * 60;
      RES.ret = await returnPlan(G, P, r0, P.stay, function (t) { progSet("ret", Math.min(0.95, 0.1 + (t - r0.arrMin) / Math.max(60, ecR - r0.arrMin)), null, fmtH(t)); });
      progSet("ret", 1, "ok", RES.ret.latest != null ? "bis " + fmtH(RES.ret.latest) : "nicht empfohlen");
    } else RES.ret = null;
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
  h += retHtml();
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
  if (EDIT.on && R.custom) h += "<div class='note' style='margin-top:6px'>Bewertet f\u00fcr Abflug <b>" + fmtH(P.depH * 60) + "</b> am " + esc(P.date.split("-").reverse().join(".")) + ". <b>Karte:</b> Wegpunkt ziehen \u00b7 <b>+</b> antippen oder ziehen = Wegpunkt einf\u00fcgen \u00b7 Wegpunkt antippen = l\u00f6schen. " +
    "<b>Profil:</b> Griff \u2195 ziehen oder antippen + Kn\u00f6pfe unter dem Profil = Reiseh\u00f6he der Teilstrecke (Auto = wieder automatisch), Tipp daneben ins Profil = Wegpunkt. Bewertung rechnet live mit.</div>";
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
    (R.circMin > 0 ? ", inkl. ~" + Math.round(R.circMin) + " min Kreisen unterwegs" : "") + ".</div></div>";
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
    (G.sun ? "<span>Sonne Start / Ziel</span><b>\u2191 " + fmtH(G.sun.depRise * 60) + " \u00b7 \u2193 " + fmtH(G.sun.destSet * 60) + "</b>" +
      "<span>BCMT Start / ECET Ziel</span><b>" + fmtH(G.sun.depBcmt * 60) + " \u00b7 " + fmtH(G.sun.destEcet * 60) + "</b>" : "") +
    (R.landWind ? "<span>Landung " + esc(G.B.icao || "") + "</span><b>" + windShort(R.landWind) + "</b>" : "") +
    (R.depWind ? "<span>Start " + esc(G.A.icao || "") + "</span><b>" + windShort(R.depWind) + "</b>" : "") +
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
/* Rueckflug-Empfehlung (nur wenn bei der Suche aktiviert) */
function retHtml() {
  var X = RES.ret; if (!X) return "";
  var G = RES.G, base = RES.routes[0], A = G.A.icao || "Start", B = G.B.icao || "Ziel", ecet = G.sun ? fmtH(G.sun.depEcet * 60) : "?";
  var h, cls;
  if (base.night) { cls = "bad"; h = "<b>Kein R\u00fcckflug am selben Tag:</b> Schon der Hinflug landet nach ECET in " + esc(B) + "."; }
  else if (X.latest == null) {
    cls = "bad";
    h = X.reason === "late"
      ? "<b>R\u00fcckflug heute nicht mehr m\u00f6glich:</b> Ab " + fmtH(X.t0) + " (Ankunft + " + X.stay + " min Aufenthalt) w\u00e4re die Landung in " + esc(A) + " erst nach ECET (" + ecet + ")."
      : "<b>R\u00fcckflug heute nicht empfohlen:</b> Jeder Abflug von " + fmtH(X.t0) + " (fr\u00fchestens: Landung " + fmtH(base.arrMin) + " + " + X.stay +
        " min Aufenthalt) bis " + fmtH(X.tLast != null ? X.tLast : X.t0) + " ist KRITISCH" + (X.issue ? " \u2013 " + esc(X.issue) : "") + "." +
        (X.structural ? " <b>Das liegt nicht am Wetter, sondern am Gel\u00e4nde/der Steigleistung" + (X.causes.indexOf("climb") >= 0 ? " beim Abflug aus " + esc(B) : "") +
          " \u2013 eine andere Uhrzeit \u00e4ndert nichts.</b>" + (X.causes.indexOf("climb") >= 0 ? " Steigrate (" + RES.P.climb + " ft/min, Erweiterte Einstellungen) pr\u00fcfen oder R\u00fcckroute selbst planen." : "")
          : "");
  } else {
    cls = X.worseFrom != null ? "warn" : "ok";
    h = "<b>R\u00fcckflug " + esc(B) + " \u2192 " + esc(A) + " sp\u00e4testens " + fmtH(X.latest) + "</b> (Landung ~" + fmtH(X.latestArr) + ")";
    h += X.reason === "ecet" ? " \u2013 danach Landung nach ECET in " + esc(A) + " (" + ecet + ")."
      : " \u2013 ab " + fmtH(X.wxFrom) + " KRITISCH" + (X.issue ? ": " + esc(X.issue) : "") + ".";
    if (X.latestDay != null && X.latestDay < X.latest) h += " Mit Tageslichtreserve (Landung 30 min vor Sonnenuntergang): bis " + fmtH(X.latestDay) + ".";
    if (X.firstOk > X.t0) h += " Fr\u00fchestens " + fmtH(X.firstOk) + " (vorher KRITISCH).";
    if (X.worseFrom != null) h += (X.worseFrom === X.firstOk ? " Durchgehend nur EINGESCHR." : " Ab " + fmtH(X.worseFrom) + " nur EINGESCHR.") +
      (X.worseIssue ? " (" + esc(X.worseIssue) + ")" : "") + ".";
  }
  return "<div class='retbox " + cls + "'>" + h + "<small>Eigene Routensuche " + esc(B) + " \u2192 " + esc(A) + " mit denselben Wetter-, Gel\u00e4nde- und Luftraumdaten, ab Ankunft + " + X.stay +
    " min Aufenthalt alle 30 min (Grenze auf 10 min genau). ECET " + esc(A) + " " + ecet + ". Zum Ansehen der R\u00fcckroute Start/Ziel tauschen und neu suchen.</small></div>";
}
/* Kurzform fuer die Uebersicht: "Piste 26 · GW 11 · SW 5 R (G 8)" */
function windShort(w) {
  var wt = (w.wd === "VRB" ? "VRB" : p3(Math.round(w.wd / 10) * 10 % 360 || 360)) + "/" + Math.round(w.ws) + (w.gust && w.gust > w.ws + 2 ? "G" + Math.round(w.gust) : "") + " kt";
  if (!w.rwy) return wt;
  var col = w.level === 2 ? "#C0392B" : w.level === 1 ? "#C1810B" : "inherit";
  return "<span style='color:" + col + "'>" + wt + " \u00b7 Piste " + esc(w.rwy.d) + " \u00b7 " + (w.head >= 0 ? "GW " + Math.round(w.head) : "RW " + Math.round(-w.head)) +
    " \u00b7 SW " + Math.round(w.cross) + (w.side === "von rechts" ? " R" : w.side === "von links" ? " L" : "") + (w.crossG > w.cross + 1 ? " (B\u00f6en " + Math.round(w.crossG) + ")" : "") + "</span>";
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
/* Orte entlang der Route beschriften (GeoNames): hoechstens 3 NM neben der Linie, groessere zuerst,
   mindestens 7 NM Abstand entlang der Route - zum Navigieren "von Ort zu Ort" und fuer Positionsmeldungen */
function drawTowns(R) {
  var pl = RES.G.PLACES || []; if (!pl.length) return;
  var cand = [];
  pl.forEach(function (q) {
    var best = null;
    for (var i = 0; i < R.samples.length; i += 2) { var d = distNm(q, R.samples[i]); if (!best || d < best.d) best = { d: d, x: R.samples[i].x }; }
    if (best && best.d <= 3 && best.x > 2 && best.x < R.D - 2) cand.push({ q: q, x: best.x });
  });
  cand.sort(function (a, b) { return b.q.pop - a.q.pop; });
  /* Beschriftete Wegpunkte (Meldepunkt, Landmarke, Grenzort) haben schon ein Namensschild: dort keine Orte */
  var used = [], lab = (R.wps || []).filter(function (w) { return w.rp || w.lm || (w.border && w.town); });
  cand.forEach(function (c) {
    if (used.some(function (u) { return Math.abs(u.x - c.x) < 7; })) return;
    if (lab.some(function (w) { return Math.abs(w.x - c.x) < 4 || distNm(w, c.q) < 3; })) return;
    used.push(c);
    L.marker([c.q.lat, c.q.lon], { interactive: false, keyboard: false,
      icon: L.divIcon({ className: "town", html: "<i></i>" + esc(c.q.name), iconSize: null, iconAnchor: [4, 4] }) }).addTo(routeLayer);
  });
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
    /* Uebertritt ueber einen beschrifteten Wegpunkt (Meldepunkt/Ort): Faehnchen steht dort im Namensschild */
    if ((R.wps || []).some(function (w) { return w.border && (w.rp || w.town) && w.border.from === c.fromC && w.border.to === c.toC && Math.abs(w.x - c.x) < 8; })) return;
    L.marker([c.lat, c.lon], { interactive: true, icon: L.divIcon({ className: "brd", html: "\u2691 " + esc(c.fromC) + "/" + esc(c.toC), iconSize: null, iconAnchor: [-6, 24] }) })
      .bindTooltip("Grenz\u00fcbertritt " + esc(c.fromC) + " \u2192 " + esc(c.toC) + " bei NM " + Math.round(c.x) + " (~" + fmtH(c.t) + ")").addTo(routeLayer);
  });
  drawTowns(R);
  R.wps.forEach(function (w, k) {
    if (k === 0 || k === R.wps.length - 1) return;
    if ((w.rp || w.lm || (w.border && w.town)) && !(EDIT.on && R.custom)) {
      L.circleMarker([w.lat, w.lon], { radius: 6, color: "#fff", weight: 2, fillColor: "#1F5FA8", fillOpacity: 1, bubblingMouseEvents: false })
        .bindTooltip((w.border ? "\u2691 " : "") + esc(w.name) + (w.border ? " <small>" + esc(w.border.from) + "\u2192" + esc(w.border.to) + "</small>" : ""),
          { permanent: true, direction: "right", offset: [8, 0], className: "rptip" }).addTo(routeLayer);
      return;
    }
    var q = sampleAt(R, w.x), r = R.rs[q.ri];
    L.circleMarker([w.lat, w.lon], { radius: 5.5, color: "#fff", weight: 1.5, fillColor: CAT_COL[r.cat], fillOpacity: 1, bubblingMouseEvents: false })
      .bindPopup(nodePopup(r.wa, w.x, w.t, w.name + (w.town && w.town !== w.name ? " \u00b7 " + w.town : "")), { maxWidth: 380 }).addTo(routeLayer);
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
    var sz = map.getSize();
    if ((MOB.on && !$("main").classList.contains("on")) || !sz.x || !sz.y) RES.needFit = true; else map.fitBounds(RES.fitBox);
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
  /* Im Bearbeiten-Modus breite, unsichtbare Tippflaeche auf der Linie (Finger) */
  if (EDIT.on && R.custom) L.polyline(all, { color: "#000", opacity: 0, weight: 28, bubblingMouseEvents: false })
    .on("click", function (ev) { routeLineClick(R, ev); }).addTo(lineLayer);
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
  if (f.circ) sw("<path d='M13 1 C 6 1 6 4 13 4 C 6 4 6 7 13 7 C 6 7 6 10 13 10' fill='none' stroke='#B02E7A' stroke-width='1.8'/>", "Vollkreise: unterwegs im Tal kreisend steigen");
  if (f.wp) sw("<path d='M13 0 V12' stroke='#1F5FA8' stroke-width='1.2' stroke-dasharray='3 3'/>", "Wegpunkt (Nummer wie in der Karte)");
  sw("<rect x='1' y='1' width='24' height='10' fill='#2E7DD7' fill-opacity='0.09' stroke='#2E7DD7' stroke-opacity='0.55' stroke-dasharray='4 2'/>", "In der Karte sichtbarer Abschnitt (beim Hineinzoomen)");
  if (f.hl) sw("<rect x='0' y='0' width='26' height='12' fill='#FFD400' fill-opacity='0.4'/>", "Gew\u00e4hlter Hinweis");
  if (f.edit) sw("<circle cx='13' cy='6' r='4.5' fill='#fff' stroke='#B02E7A' stroke-width='2'/>", "Griff ziehen = Reiseh\u00f6he \u00e4ndern, Tipp ins Profil = Wegpunkt einf\u00fcgen");
  return it.join("");
}
/* Kartenausschnitt im Profil: der in der Karte sichtbare Teil der Route wird hinterlegt (nur wenn hineingezoomt) */
function drawViewBand() {
  var g = document.getElementById("pview"); if (!g || !RES || !RES.pv) return;
  var me = document.getElementById("map"); if (!me || !me.offsetWidth) return;   /* Karte verborgen: letzten Stand lassen */
  /* nur der wirklich sichtbare Teil der Karte: ohne den Bereich unter dem Profilfenster */
  var mr = me.getBoundingClientRect(), pe = $("prof"), yMaxPx = mr.height;
  if (pe && pe.offsetHeight) { var pr = pe.getBoundingClientRect(); if (pr.top > mr.top + 40 && pr.top < mr.bottom && pr.left < mr.right && pr.right > mr.left) yMaxPx = pr.top - mr.top; }
  var bb = L.latLngBounds(map.containerPointToLatLng([0, 0]), map.containerPointToLatLng([mr.width, yMaxPx]));
  var R = RES.routes[RES.sel], pv = RES.pv, runs = [], cur = null, nIn = 0;
  R.samples.forEach(function (q) {
    if (bb.contains([q.lat, q.lon])) { nIn++; if (!cur) { cur = { a: q.x, b: q.x }; runs.push(cur); } else cur.b = q.x; }
    else cur = null;
  });
  if (!nIn || nIn >= R.samples.length * 0.97) { g.innerHTML = ""; return; }
  g.innerHTML = runs.map(function (r) {
    var x0 = pv.X(Math.max(0, r.a - 0.3)), x1 = pv.X(Math.min(pv.D, r.b + 0.3));
    return "<rect x='" + x0.toFixed(1) + "' y='" + pv.Tp + "' width='" + Math.max(3, x1 - x0).toFixed(1) + "' height='" + (pv.H - pv.Tp - pv.Bp) +
      "' fill='#2E7DD7' fill-opacity='0.09' stroke='#2E7DD7' stroke-opacity='0.55' stroke-width='1.2' stroke-dasharray='5 3'/>";
  }).join("");
}
map.on("moveend", drawViewBand);
function drawProfile(R) {
  $("profSvg").innerHTML = profSvg(R); $("prof").style.display = "block";
  drawViewBand();
  renderAltBar(R);
  /* waehrend des Ziehens keine Legende aendern: sonst verschiebt sich das Profil unter dem Finger */
  if (!EDIT.drag) $("profLeg").innerHTML = profLegend();
  $("prof").classList.toggle("editing", !!(EDIT.on && R.custom));
  document.body.classList.toggle("editmode", !!(EDIT.on && R.custom));   /* Bearbeiten deutlich zeigen */
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
    if (!$("main").classList.contains("on")) return;   /* inzwischen andere Seite: nicht an einer 0-px-Karte einpassen */
    map.invalidateSize();
    /* Einpassen nachholen; auch wenn die Karte durch einen frueheren Fehler auf Weltansicht steht */
    if (RES && RES.fitBox && (RES.needFit || map.getZoom() < 5)) { map.fitBounds(RES.fitBox); RES.needFit = false; }
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
    /* Breite je Zeichen geschaetzt (Grossbuchstaben breiter, fett etwas breiter), damit nichts ueberlappt */
    var w = 0, h = size * 1.15;
    String(txt).split("").forEach(function (ch) { w += /[A-ZÄÖÜ]/.test(ch) ? 0.68 : /[0-9]/.test(ch) ? 0.58 : /[\s.,:'|·]/.test(ch) ? 0.3 : 0.53; });
    w *= size * (bold ? 1.06 : 1);
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
  var s = "<svg viewBox='0 0 " + W + " " + H + "' xmlns='http://www.w3.org/2000/svg' font-family='system-ui,sans-serif'><g id='pview'></g>";
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
  /* Wegpunkte als senkrechte Linien (Nummer/Name wie in Karte und Navlog) */
  var wpl = R.wps.slice(1, -1).filter(function (w) { return w.x > 0.3 && w.x < D - 0.3; });
  /* Beim Bearbeiten: genau die ziehbaren Wegpunkte mit derselben Nummer wie auf der Karte (Teilstrecken-Grenzen) */
  if (EDIT.on && R.custom && EDIT.pts) {
    var nsp = EDIT.pts.filter(function (p, i) { return i > 0 && i < EDIT.pts.length - 1 && !p.shape; }), lx = {};
    R.rs.forEach(function (r) { lx[r.e.leg] = r.x1; });
    wpl = nsp.map(function (p, j) { return { x: lx[j], name: p.name || String(j + 1), prof: !!p.fromProf, pt: p }; }).filter(function (w) { return w.x != null; });
  }
  wpl.forEach(function (w) {
    s += w.prof   /* im Profil eingefuegter Punkt: hervorgehoben, Tipp darauf = rueckgaengig */
      ? "<line x1='" + X(w.x).toFixed(1) + "' x2='" + X(w.x).toFixed(1) + "' y1='" + Tp + "' y2='" + (H - Bp) + "' stroke='#B02E7A' stroke-opacity='0.8' stroke-width='2' stroke-dasharray='6 3'/>"
      : "<line x1='" + X(w.x).toFixed(1) + "' x2='" + X(w.x).toFixed(1) + "' y1='" + Tp + "' y2='" + (H - Bp) + "' stroke='#1F5FA8' stroke-opacity='0.55' stroke-width='1' stroke-dasharray='3 4'/>";
  });
  var pl = "M " + X(0) + " " + Y(G.depElev) + " L " + X(0) + " " + Y(sm[0].p);
  sm.forEach(function (q) {
    if (q.circ) pl += " L " + X(q.x) + " " + Y(q.p - q.circ) + coil(X(q.x), Y(q.p - q.circ), Y(q.p));
    else pl += " L " + X(q.x) + " " + Y(q.p);
  });
  pl += " L " + X(D) + " " + Y(G.destElev);
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
  wpl.forEach(function (w) {
    var nm = /^WP\d+$/.test(w.name) ? w.name.slice(2) : w.name;
    if (w.prof) {   /* Rueckgaengig-Knopf oben an der Linie */
      var bx = X(w.x), by = Tp + f2 * 0.9, r = mob ? 13 : 10;
      s += "<g class='wpundo'><circle cx='" + bx.toFixed(1) + "' cy='" + by.toFixed(1) + "' r='" + r + "' fill='#B02E7A'/>" +
        "<path d='M " + (bx - r * 0.38).toFixed(1) + " " + (by - r * 0.38).toFixed(1) + " L " + (bx + r * 0.38).toFixed(1) + " " + (by + r * 0.38).toFixed(1) +
        " M " + (bx + r * 0.38).toFixed(1) + " " + (by - r * 0.38).toFixed(1) + " L " + (bx - r * 0.38).toFixed(1) + " " + (by + r * 0.38).toFixed(1) + "' stroke='#fff' stroke-width='2.4' stroke-linecap='round'/></g>";
      reserve(bx - r - 2, by - r - 2, bx + r + 2, by + r + 2);
      txts += lbl(bx + r + 4, by + f2 * 0.35, nm, f2, "#B02E7A", "start", true, [0, f2 * 1.2, f2 * 2.4]) ||
        lbl(bx - r - 4, by + f2 * 0.35, nm, f2, "#B02E7A", "end", true, [0, f2 * 1.2, f2 * 2.4]);
      return;
    }
    txts += lbl(X(w.x), Tp + f2 * 1.2, nm, f2, "#1F5FA8", "middle", true, [0, f2 * 1.2, f2 * 2.4, f2 * 3.6, H - Bp - Tp - f2 * 1.6]);
  });
  RES.pvWp = wpl.map(function (w) { return { x: w.x, prof: w.prof, pt: w.pt }; });
  if (!(EDIT.on && R.custom)) R.legs.forEach(function (l, k) {   /* im Bearbeiten-Modus zeigen die Griffe die Hoehen */
    var xm = (R.wps[k].x + R.wps[k + 1].x) / 2;
    if (X(R.wps[k + 1].x) - X(R.wps[k].x) < (mob ? 40 : 30)) return;
    if (Math.abs(sampleAt(R, xm).p - l.alt) > 150) return;   /* nur beschriften, wo die Hoehe auch geflogen wird */
    txts += lbl(X(xm), Y(sampleAt(R, xm).p) - 7, String(l.alt), f2, "#B02E7A", "middle", true, [0, -f2 * 1.2, f2 * 1.6, -f2 * 2.4]);
  });
  R.circles.forEach(function (c) { txts += lbl(X(c.x) + 6, Y(c.to) + f2 + 4, "\u21bb " + fmtFt(c.to), f2, "#B02E7A", "start", true); });
  if (P.maxAlt < yMax) txts += lbl(W - Rp - 4, Y(P.maxAlt) - 4, "max. " + P.maxAlt + " ft", f2, "#61717F", "end", false, [0, f2 * 1.4]);
  bandLbl.forEach(function (b) { txts += lbl(b.x, b.y, b.t, f2, b.c, "start", false, [0, f2 * 1.2, f2 * 2.4].filter(function (o) { return o + f2 < b.hgt; })); });
  /* Legende als HTML unter dem Bild: nur was im Profil vorkommt */
  RES.pvLeg = { cloud: !!bl, fz: !!fl, maxAlt: P.maxAlt < yMax, kinds: R.bands.filter(function (b) { return b.lo < yMax; }).map(function (b) { return b.as.kind; }),
    conf: R.conflicts.length > 0, hl: !!RES.hl, circ: R.circles.length > 0, wp: wpl.length > 0, edit: EDIT.on && R.custom };
  txts += "<text x='" + (Lp - 6) + "' y='" + (Tp - 6) + "' text-anchor='end' font-size='" + (f2 - 1) + "' fill='#61717F'>ft MSL</text>";
  return s + txts + "<g id='pedit'>" + ed.g + "</g><g id='pcur'></g></svg>";
}

/* ==================== 14a. Route und Hoehen bearbeiten ==================== */
/* Bearbeiten macht aus der gewaehlten Route eine "Eigene Route": Wegpunkte auf der Karte ziehen,
   per Klick auf die Linie einfuegen, per Popup/Rechtsklick loeschen; Reiseflughoehe je Teilstrecke im
   Profil ziehen oder per Hoehenleiste setzen (Auto = automatisch). Alles wird live neu bewertet. */
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
    EDIT.pts.forEach(function (p, i) { if (i > 0 && i < EDIT.pts.length - 1) p.shape = !(p.rp || p.border || p.lm); });
    (function dp(i0, i1) {
      var md = 0, mi = -1;
      for (var i = i0 + 1; i < i1; i++) { var d = segDist(EDIT.pts[i], EDIT.pts[i0], EDIT.pts[i1]).d; if (d > md) { md = d; mi = i; } }
      if (md > 0.75) { EDIT.pts[mi].shape = false; dp(i0, mi); dp(mi, i1); }
    })(0, EDIT.pts.length - 1);
  }
  EDIT.on = true; EDIT.A = RES.G.A; EDIT.B = RES.G.B;
  if (!base.custom) { EDIT.dirty = false; EDIT.baseName = base.name; }
  render(evalUser());
  setSts("Bearbeiten: Wegpunkte ziehen, + antippen oder ziehen = Wegpunkt einfügen, Wegpunkt antippen = löschen. Höhen im Profil ziehen.");
}
function stopEdit() {
  EDIT.on = false; editLayer.clearLayers(); setSts(""); document.body.classList.remove("editmode");
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
/* Einrasten beim Ziehen: Meldepunkt oder Ort in Fingerreichweite (Bildschirm-Pixel, hoechstens 3 NM) wird
   genau uebernommen und benannt - erleichtert die Positionsmeldung. Meldepunkte vor groesseren Orten. */
var SNAP_PX_MOUSE = 18, SNAP_PX_TOUCH = 28;
function editSnap(ll) {
  if (!RES || !RES.G) return null;
  var G = RES.G, pp = map.latLngToContainerPoint(ll), lim = (MOB.on || matchMedia("(pointer:coarse)").matches) ? SNAP_PX_TOUCH : SNAP_PX_MOUSE, best = null;
  var p = { lat: ll.lat, lon: ll.lng };
  function tryPt(q, pt, bonus) {
    if (distNm(q, p) > 3) return;
    var d = pp.distanceTo(map.latLngToContainerPoint([q.lat, q.lon])); if (d > lim) return;
    var sc = d - bonus;
    if (!best || sc < best.sc) best = { sc: sc, pt: pt };
  }
  (G.RPS || []).forEach(function (q) { tryPt(q, rpPoint(q, { lm: true }), 8); });
  (G.PLACES || []).forEach(function (q) { tryPt(q, { lat: q.lat, lon: q.lon, name: q.name, town: q.name, lm: true }, 2 * Math.log10(q.pop / 1000)); });
  return best ? best.pt : null;
}
var snapMk = null;
function showSnap(pt) {   /* Ring um den Einrastpunkt mit Namen */
  if (snapMk) { map.removeLayer(snapMk); snapMk = null; }
  if (!pt) return;
  snapMk = L.circleMarker([pt.lat, pt.lon], { radius: 13, color: "#B02E7A", weight: 3, fill: false, interactive: false })
    .bindTooltip("\u2316 " + esc(pt.name), { permanent: true, direction: "top", offset: [0, -12], className: "rptip" }).addTo(map);
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
      var ll = ev.target.getLatLng(), sp = editSnap(ll);
      EDIT.pts[k] = sp || { lat: ll.lat, lon: ll.lng, name: null };   /* verschoben = kein Meldepunkt mehr, ausser eingerastet */
      showSnap(sp);
      scheduleQuick();
    });
    mk.on("dragend", function () { EDIT.dragging = false; showSnap(null); commitEdit(); });
    mk.on("contextmenu", function () { deleteWp(k); });
    mk.bindPopup("<div class='pop'><b class='h'>Wegpunkt " + lbl + "</b><br><button class='btn2' data-delwp='" + k + "' style='margin-top:6px'>Wegpunkt löschen</button></div>");
    mk.addTo(editLayer);
  });
  drawAddHandles();
}
function deleteWp(k) {
  if (k <= 0 || k >= EDIT.pts.length - 1 || EDIT.pts[k].shape) return Promise.resolve();
  map.closePopup(); EDIT.dirty = true; EDIT.sel = null;
  var L0 = legOfSeg(k);   /* Teilstrecken L0 und L0+1 werden zu L0 */
  k = straighten(k); EDIT.pts.splice(k, 1);
  var ua = {}; Object.keys(EDIT.ua).forEach(function (l) { l = +l; if (l <= L0) ua[l] = EDIT.ua[l]; else if (l > L0 + 1) ua[l - 1] = EDIT.ua[l]; });
  EDIT.ua = ua;
  return commitEdit();
}
/* Neuen Wegpunkt an Position p in den naechstgelegenen Abschnitt einfuegen; gibt den Index zurueck */
function insertPoint(p) {
  var best = null;
  for (var k = 0; k < EDIT.pts.length - 1; k++) { var d = segDist(p, EDIT.pts[k], EDIT.pts[k + 1]).d; if (!best || d < best.d) best = { d: d, k: k }; }
  EDIT.dirty = true; EDIT.sel = null;
  var L0 = legOfSeg(best.k + 1);   /* Teilstrecke L0 wird in L0 und L0+1 geteilt */
  EDIT.pts.splice(best.k + 1, 0, { lat: p.lat, lon: p.lon, name: null });
  var ua = {}; Object.keys(EDIT.ua).forEach(function (l) { l = +l; ua[l > L0 ? l + 1 : l] = EDIT.ua[l]; if (l === L0) ua[l + 1] = EDIT.ua[l]; });
  EDIT.ua = ua;
  return best.k + 1;
}
/* Wegpunkt aus dem Hoehenprofil einfuegen (nicht naeher als 1 NM an einem vorhandenen Wegpunkt) */
function profInsert(R, x) {
  if (x < 1 || x > R.D - 1) return false;
  /* beim Bearbeiten zaehlen nur die ziehbaren (nummerierten) Wegpunkte, nicht die Knickpunkte des Navlogs */
  var wl = EDIT.on && RES.pvWp ? RES.pvWp : R.wps;
  if (wl.some(function (w) { return Math.abs(w.x - x) < 1; })) { setSts("Zu nah (unter 1 NM) an einem Wegpunkt \u2013 etwas weiter daneben tippen."); return false; }
  var q = sampleInterp(R, x);
  var k = insertPoint({ lat: q.lat, lon: q.lon });
  EDIT.pts[k].fromProf = true;
  hideCursor();
  commitEdit().then(function () { setSts("Wegpunkt eingef\u00fcgt \u2013 Tipp auf \u2715 im Profil macht es r\u00fcckg\u00e4ngig."); });
  return true;
}
function routeLineClick(R, ev) {
  if (!EDIT.on || !R.custom) { showCursor(nearestX(R, ev.latlng), "map"); return; }
  insertPoint({ lat: ev.latlng.lat, lon: ev.latlng.lng });
  commitEdit();
}
/* "+"-Griffe in der Mitte jeder Teilstrecke: antippen = Wegpunkt einfuegen, ziehen = einfuegen und verschieben */
function drawAddHandles() {
  var wp = []; EDIT.pts.forEach(function (p, i) { if (!p.shape) wp.push(i); });
  for (var j = 1; j < wp.length; j++) {
    var a = wp[j - 1], b = wp[j], len = 0, k;
    for (k = a + 1; k <= b; k++) len += distNm(EDIT.pts[k - 1], EDIT.pts[k]);
    if (len < 4) continue;
    var half = len / 2, acc = 0, mid = null;
    for (k = a + 1; k <= b && !mid; k++) {
      var d = distNm(EDIT.pts[k - 1], EDIT.pts[k]);
      if (acc + d >= half) mid = lerp(EDIT.pts[k - 1], EDIT.pts[k], d ? (half - acc) / d : 0);
      acc += d;
    }
    /* nicht anzeigen, wenn der Griff auf dem Bildschirm zu nah an einem Wegpunkt laege (Finger trifft sonst falsch) */
    var pm = map.latLngToContainerPoint([mid.lat, mid.lon]);
    if (pm.distanceTo(map.latLngToContainerPoint([EDIT.pts[a].lat, EDIT.pts[a].lon])) < 34 ||
        pm.distanceTo(map.latLngToContainerPoint([EDIT.pts[b].lat, EDIT.pts[b].lon])) < 34) continue;
    (function (mid) {
      var idx = null;
      var mk = L.marker([mid.lat, mid.lon], { draggable: true, autoPan: true, zIndexOffset: -100,
        icon: L.divIcon({ className: "wpadd", html: "+", iconSize: [22, 22], iconAnchor: [11, 11] }) });
      mk.on("click", function () { insertPoint(mid); commitEdit(); });
      mk.on("dragstart", function () { EDIT.dragging = true; hideCursor(); idx = straighten(insertPoint(mid)); });
      mk.on("drag", function (ev) { var ll = ev.target.getLatLng(), sp = editSnap(ll); EDIT.pts[idx] = sp || { lat: ll.lat, lon: ll.lng, name: null }; showSnap(sp); scheduleQuick(); });
      mk.on("dragend", function () { EDIT.dragging = false; showSnap(null); commitEdit(); });
      mk.addTo(editLayer);
    })(mid);
  }
}
map.getContainer().addEventListener("click", function (e) {
  var b = e.target.closest("[data-delwp]"); if (b) deleteWp(+b.getAttribute("data-delwp"));
});
/* "+"-Griffe nach dem Zoomen neu setzen (Abstand in Bildschirmpixeln aendert sich) */
map.on("zoomend", function () { if (EDIT.on && !EDIT.dragging && RES && RES.routes[RES.sel] && RES.routes[RES.sel].custom) drawEditMarkers(RES.routes[RES.sel]); });
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
    coverBoxes(box, r.ok || []).forEach(function (bb) { G.airBoxes.push(bb); });
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
  /* wird die Hoehe der Teilstrecke irgendwo tatsaechlich geflogen? (sonst Griff gestrichelt + Hinweis) */
  R.samples.forEach(function (q) { var l = legs[R.rs[q.ri].e.leg]; if (l && Math.abs(q.p - l.alt) <= 1) l.reach = true; });
  /* zuerst alle Griffe reservieren, damit keine Beschriftung darauf landet */
  R.legX.forEach(function (l) {
    var x0 = X(l.x0) + 3, x1 = X(l.x1) - 3, y = Y(l.alt), xm = (x0 + x1) / 2;
    if (x1 - x0 >= 6) reserve(xm - 11, y - 11, xm + 11, y + 11);
  });
  R.legX.forEach(function (l) {
    var x0 = X(l.x0) + 3, x1 = X(l.x1) - 3, y = Y(l.alt), xm = (x0 + x1) / 2;
    if (x1 - x0 < 6) return;
    var miss = l.user && !l.reach && !(EDIT.drag && EDIT.drag.leg === l.leg);
    var sel = EDIT.sel === l.leg;   /* gewaehlte Teilstrecke (Hoehenleiste) gefuellt */
    out += "<line x1='" + x0 + "' x2='" + x1 + "' y1='" + y + "' y2='" + y + "' stroke='" + (miss ? "#C0392B" : "#B02E7A") + "' stroke-width='" + (miss ? 3 : 9) + "'" +
      (miss ? " stroke-dasharray='6 5' stroke-opacity='0.7'" : " stroke-opacity='0.18'") + " stroke-linecap='round'/>" +
      "<circle cx='" + xm.toFixed(1) + "' cy='" + y + "' r='" + (sel ? 10 : 8) + "' fill='" + (sel ? "#B02E7A" : "#fff") + "' stroke='#B02E7A' stroke-width='2.5' style='cursor:ns-resize'/>" +
      "<path d='M " + (xm - 3).toFixed(1) + " " + (y - 2) + " l 3 -3 l 3 3 M " + (xm - 3).toFixed(1) + " " + (y + 2) + " l 3 3 l 3 -3' stroke='" + (sel ? "#fff" : "#B02E7A") + "' stroke-width='1.5' fill='none'/>";
    if (EDIT.drag && EDIT.drag.leg === l.leg && EDIT.drag.minA) {   /* waehrend des Ziehens: Mindesthoehe zeigen */
      var ym = Y(EDIT.drag.minA);
      out += "<line x1='" + x0 + "' x2='" + x1 + "' y1='" + ym + "' y2='" + ym + "' stroke='#C0392B' stroke-width='2' stroke-dasharray='5 4'/>";
      txt += lbl(x0 + 2, ym + f2 + 3, "min. " + EDIT.drag.minA + " ft", f2, "#C0392B", "start", true, [0, f2 * 1.2, -f2 * 1.6]);
    }
    var right = xm > RES.pv.W - 140;
    txt += lbl(xm + (right ? -12 : 12), y - 6, l.alt + " ft" + (l.user ? " \u270e" : " auto") + (miss ? " nicht erreichbar" : ""), f2, miss ? "#C0392B" : "#B02E7A",
      right ? "end" : "start", true, [0, -f2 * 1.2, f2 * 2.2, -f2 * 2.4]);
  });
  return { g: out, t: txt };
}
/* Griff (Teilstrecke) an einer Profilstelle: naechster Griff senkrecht innerhalb tol Einheiten */
function legAt(c, tol) {
  var R = RES.routes[RES.sel], pv = RES.pv; if (!R || !R.legX) return null;
  tol = tol || 16;
  var best = null;
  R.legX.forEach(function (l) {
    if (c.x < l.x0 - 0.3 || c.x > l.x1 + 0.3) return;
    var d = Math.abs(pv.Y(l.alt) - c.y);
    if (d <= tol && (!best || d < best.d)) best = { d: d, l: l };
  });
  return best ? best.l : null;
}
/* Liegt ein Tipp (SVG-x) nahe am runden Griff der Teilstrecke? Sonst gilt er als Tipp auf die Linie. */
function nearHandle(R, leg, sx, touch) {
  var l = R.legX && R.legX.filter(function (x) { return x.leg === leg; })[0]; if (!l || sx == null) return false;
  return Math.abs(sx - RES.pv.X((l.x0 + l.x1) / 2)) <= (touch ? 36 : 22);
}
/* Hoehenleiste unter dem Profil (Bearbeiten): gewaehlte Teilstrecke, Hoehe, Mindesthoehe, Knoepfe */
function renderAltBar(R) {
  var bar = $("altBar"); if (!bar) return;
  if (!EDIT.on || !R || !R.custom) { bar.innerHTML = ""; return; }
  var l = EDIT.sel != null && R.legX ? R.legX.filter(function (x) { return x.leg === EDIT.sel; })[0] : null;
  if (!l) {
    bar.innerHTML = "<span class='t'>H\u00f6he \u00e4ndern: Griff \u25ef im Profil antippen oder ziehen \u00b7 Tipp daneben ins Profil = Wegpunkt</span>";
    return;
  }
  var minA = legMinAlt(R, l.leg), cur = EDIT.ua[l.leg] != null ? EDIT.ua[l.leg] : l.alt, user = EDIT.ua[l.leg] != null;
  var note = EDIT.drag && EDIT.drag.clamp ? " \u00b7 <span class='w'>tiefer nicht m\u00f6glich (Gel\u00e4nde)</span>"
    : user && !l.reach && !EDIT.drag ? " \u00b7 <span class='w'>hier nicht erreichbar (siehe Hinweise)</span>" : "";
  function b(d, t) { var dis = (d < 0 && cur + d < minA && cur <= minA) || (d > 0 && cur >= 15000); return "<button type='button' data-d='" + d + "'" + (dis ? " disabled" : "") + ">" + t + "</button>"; }
  bar.innerHTML = "<span class='t'>Teilstrecke " + (l.leg + 1) + ": <b>" + cur + " ft</b> " + (user ? "\u270e" : "auto") +
    " \u00b7 min. " + minA + " ft" + note + "</span>" + b(-500, "\u2212500") + b(-100, "\u2212100") + b(100, "+100") + b(500, "+500") +
    "<button type='button' data-auto='1'" + (user ? "" : " disabled") + ">Auto</button>";
}
function altBarClick(e) {
  var btn = e.target.closest("button"); if (!btn || btn.disabled || !EDIT.on || EDIT.sel == null) return;
  var R = RES.routes[RES.sel], l = R.legX && R.legX.filter(function (x) { return x.leg === EDIT.sel; })[0]; if (!l) return;
  EDIT.dirty = true;
  if (btn.getAttribute("data-auto")) { delete EDIT.ua[l.leg]; render(evalUser()); setSts("Teilstrecke " + (l.leg + 1) + ": H\u00f6he wieder automatisch."); return; }
  var minA = legMinAlt(R, l.leg), cur = EDIT.ua[l.leg] != null ? EDIT.ua[l.leg] : l.alt, a = cur + +btn.getAttribute("data-d"), msg = "";
  if (a < minA) { a = minA; msg = "Tiefer nicht m\u00f6glich: Mindesth\u00f6he " + minA + " ft (Gel\u00e4nde \u00b11 NM + 500 ft + Puffer)."; }
  if (a > 15000) { a = 15000; msg = "H\u00f6her als 15.000 ft ist nicht vorgesehen."; }
  else if (a > RES.P.maxAlt) msg = "Achtung: \u00fcber der eingestellten Max. H\u00f6he (" + RES.P.maxAlt + " ft).";
  EDIT.ua[l.leg] = a; render(evalUser()); setSts(msg);
}
/* Mindesthoehe einer Teilstrecke beim Ziehen: harte Grenze (Gelaende +-1 NM + 500 ft + DEM-Puffer,
   im Ab-/Anflugbereich von der Platzhoehe ansteigend), auf 100 ft aufgerundet */
function legMinAlt(R, leg) {
  var m = 0;
  R.samples.forEach(function (q) { if (R.rs[q.ri].e.leg === leg && isFinite(q.hard)) m = Math.max(m, q.hard); });
  return Math.ceil(m / 100) * 100;
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
    CUR.mk.bindTooltip("", { permanent: true, direction: MOB.on ? "top" : "right", offset: MOB.on ? [0, -10] : [10, 0], className: "curtip" });
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
  var pb = $("profBody"), pt = $("profTouch");
  function editing() { return EDIT.on && RES && RES.routes[RES.sel] && RES.routes[RES.sel].custom; }
  /* Finger auf einem Griff: Seiten-Scrollen/Zoomen von Safari fuer diese Beruehrung sperren */
  pt.addEventListener("touchstart", function (e) {
    if (!editing() || e.touches.length !== 1) return;
    var c = svgX(e.touches[0]); if (c && legAt(c, 30)) e.preventDefault();
  }, { passive: false });
  pt.addEventListener("pointerdown", function (ev) {
    if (!editing()) return;
    var c = svgX(ev), l = c && legAt(c, ev.pointerType === "mouse" ? 16 : 30); if (!l) return;
    ev.preventDefault(); ev.vfrHandle = true;   /* Griff getroffen: kein Tipp ins Profil */
    var R = RES.routes[RES.sel];
    EDIT.sel = l.leg;
    EDIT.drag = { leg: l.leg, moved: false, a0: l.alt, y0: c.y, x: c.x, sx: c.sx, touch: ev.pointerType !== "mouse",
      minA: legMinAlt(R, l.leg), clamp: false }; RES.pvFreeze = RES.pv.yMax;
    try { pt.setPointerCapture(ev.pointerId); } catch (e) {}
    hideCursor(); renderAltBar(R);
  });
  pt.addEventListener("pointermove", function (ev) {
    if (EDIT.drag) {
      var cd = svgX(ev); if (!cd) return;
      ev.preventDefault();
      /* Ziehen beginnt erst nach 2 Einheiten senkrecht (kein versehentliches Verstellen beim Tippen);
         danach folgt die Hoehe direkt der Fingerposition */
      if (!EDIT.drag.moved && Math.abs(cd.y - EDIT.drag.y0) < 2) return;
      /* nie ins Gelaende: hoechstens bis zur Mindesthoehe der Teilstrecke (Konfliktgrenze) */
      var want = altFromY(cd.y), a = Math.max(want, EDIT.drag.minA);
      EDIT.drag.moved = true; EDIT.dirty = true; EDIT.drag.clamp = want < EDIT.drag.minA;
      if (EDIT.ua[EDIT.drag.leg] !== a) { EDIT.ua[EDIT.drag.leg] = a; scheduleQuick(); }
      else renderAltBar(RES.routes[RES.sel]);
      return;
    }
    var c = svgX(ev); if (!c) return;
    if (ev.pointerType === "mouse") pt.classList.toggle("grab", !!(editing() && legAt(c, 16)));
    if (c.x < -0.5 || c.x > RES.pv.D + 0.5) { hideCursor(); return; }
    showCursor(c.x, "prof");
  });
  var tap = null;
  pt.addEventListener("pointerdown", function (ev) {
    var c = svgX(ev); if (c && c.x >= 0 && c.x <= RES.pv.D && !ev.vfrHandle) showCursor(c.x, "prof");
    tap = c && !ev.vfrHandle ? { cx: ev.clientX, cy: ev.clientY, t: Date.now(), x: c.x, y: c.y, sx: c.sx, touch: ev.pointerType !== "mouse" } : null;
  });
  /* Kurzer Tipp/Klick ins Profil: beim Bearbeiten = Wegpunkt an dieser Stelle einfuegen (teilt die
     Teilstrecke, damit dort eine eigene Hoehe gesetzt werden kann); sonst auf Handy/Tablet zur Karte */
  pt.addEventListener("pointerup", function (ev) {
    if (!tap || EDIT.drag) { tap = null; return; }
    var moved = Math.abs(ev.clientX - tap.cx) + Math.abs(ev.clientY - tap.cy), x = tap.x, y = tap.y, touch = tap.touch, tap0sx = tap.sx; tap = null;
    if (moved > 10 || x < 0 || x > RES.pv.D) return;
    var R = RES.routes[RES.sel];
    if (editing()) {
      ev.preventDefault();
      /* Tipp auf einen im Profil eingefuegten Punkt (Linie oder Knopf) = Einfuegen rueckgaengig */
      var tol = 14 * RES.pv.D / (RES.pv.W - RES.pv.Lp - RES.pv.Rp), hit = null;
      (RES.pvWp || []).forEach(function (w) { if (w.prof && Math.abs(w.x - x) <= tol && (!hit || Math.abs(w.x - x) < Math.abs(hit.x - x))) hit = w; });
      if (hit) { var k = EDIT.pts.indexOf(hit.pt); if (k > 0) { hideCursor(); deleteWp(k).then(function () { setSts("Eingef\u00fcgter Wegpunkt wieder entfernt."); }); } return; }
      /* knapp neben einem Griff: diese Teilstrecke waehlen statt einen Wegpunkt einzufuegen */
      var near = legAt({ x: x, y: y }, touch ? 40 : 26);
      if (near && !nearHandle(R, near.leg, tap0sx, touch)) near = null;   /* nur nahe am runden Griff */
      if (near) {
        EDIT.sel = near.leg; hideCursor(); drawProfile(R);
        setSts("Teilstrecke " + (near.leg + 1) + " gew\u00e4hlt \u2013 H\u00f6he mit den Kn\u00f6pfen unter dem Profil oder durch Ziehen am Griff \u00e4ndern.");
        return;
      }
      profInsert(R, x); return;
    }
    if (!MOB.on) return;
    ev.preventDefault(); MAP_CLICK_OFF = Date.now() + 700;
    showCursor(x, "prof"); showPane("main");
    setTimeout(function () { if (CUR.mk) map.setView(CUR.mk.getLatLng(), Math.max(map.getZoom(), 10)); }, 150);
  });
  pt.addEventListener("pointerleave", function (ev) { if (ev.pointerType === "mouse" && !EDIT.drag) hideCursor(); });
  function endDrag() {
    if (!EDIT.drag) return;
    var d = EDIT.drag; EDIT.drag = null; RES.pvFreeze = null;
    var R = RES.routes[RES.sel];
    if (d.moved) {
      render(evalUser());
      setSts(d.clamp ? "Tiefer nicht m\u00f6glich: Mindesth\u00f6he " + d.minA + " ft f\u00fcr Teilstrecke " + (d.leg + 1) + " (Gel\u00e4nde \u00b11 NM + 500 ft + Puffer)."
        : "Teilstrecke " + (d.leg + 1) + ": " + EDIT.ua[d.leg] + " ft.");
    } else if (nearHandle(R, d.leg, d.sx, d.touch)) {
      drawProfile(R); setSts("Teilstrecke " + (d.leg + 1) + " gew\u00e4hlt \u2013 ziehen oder die Kn\u00f6pfe unter dem Profil nutzen.");
    } else profInsert(R, d.x);   /* kurzer Tipp auf die Hoehenlinie abseits des Griffs = Wegpunkt dort einfuegen */
  }
  pt.addEventListener("pointerup", endDrag);
  pt.addEventListener("pointercancel", endDrag);
  pt.addEventListener("lostpointercapture", endDrag);
  $("altBar").addEventListener("click", altBarClick);
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
  $("swapBtn").addEventListener("click", swapFromTo);
  setupAc("tIn", "tAc", "to");
  loadSettings();
  $("go").addEventListener("click", plan);
  $("out").addEventListener("click", onOutClick);
  $("exp").addEventListener("click", onExpClick);
  $("asFilter").addEventListener("change", function () { drawAir(); saveSettings(); });
  $("editDone").addEventListener("click", function () { if (EDIT.on) stopEdit(); });
  $("wxLayer").addEventListener("change", function () { setWxLayer(this.value); });
  try { var wl = localStorage.getItem("vfrWxLayer"); if (wl) { $("wxLayer").value = wl; setWxLayer(wl); } } catch (e) {}
  $("avoidClr").addEventListener("change", saveSettings);
  $("prefGafor").addEventListener("change", saveSettings);
  $("retOn").addEventListener("change", function () { $("retRow").style.display = this.checked ? "" : "none"; saveSettings(); });
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
