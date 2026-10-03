"use strict";
/* ==================== 12b. Grenzuebertritte & VFR-Meldepunkte ==================== */
/* Grenzen kommen aus den FIR-Luftraeumen von openAIP (Typ 10), Meldepunkte aus den openAIP
   reporting points. Es wird nichts erfunden: Fehlen Daten, bleibt die Route unveraendert und ein
   Hinweis sagt, was zu pruefen ist. */
var BORDER_RP_NM = 15;   /* Meldepunkt fuer den Grenzuebertritt hoechstens so weit vom Schnittpunkt */
var BORDER_TOWN_NM = 6;  /* sonst markanter Ort (OpenStreetMap) hoechstens so weit vom Schnittpunkt */
var DEST_RP_NM = 20;     /* Meldepunkt fuer den Zielplatz hoechstens so weit vom Platz */

function firAt(G, p) {
  var f = (G.FIRS || []).filter(function (a) { return inBox(p, a.bb) && inGeom(a.geometry, p.lon, p.lat); });
  return f.length ? f[0] : null;
}
function firCountry(f) { return f ? (f.country || (f.name.match(/^[A-Z]{4}/) || [""])[0]) : ""; }
/* Grenzuebertritte entlang des Profils: Wechsel des LANDES zwischen zwei Stichproben (auf ~0,1 NM genau).
   Punkte ohne FIR (Datenluecke) zaehlen nicht, mehrere FIRs eines Landes (z. B. DE) auch nicht. */
function detectCrossings(R, G) {
  if (!G.FIRS || !G.FIRS.length) return [];
  var sm = R.samples, out = [], prevI = -1, prev = null;
  for (var i = 0; i < sm.length; i++) {
    var cur = firAt(G, sm[i]);
    if (!cur) continue;
    if (prev && firCountry(cur) && firCountry(prev) && firCountry(cur) !== firCountry(prev)) {
      var a = sm[prevI], b = sm[i], lo = 0, hi = 1, pc = firCountry(prev);
      for (var k = 0; k < 8; k++) {
        var m = (lo + hi) / 2, f0 = firAt(G, { lat: a.lat + (b.lat - a.lat) * m, lon: a.lon + (b.lon - a.lon) * m });
        if (f0 && firCountry(f0) === pc) lo = m; else hi = m;
      }
      var f = (lo + hi) / 2;
      out.push({ x: a.x + (b.x - a.x) * f, lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, t: a.t + (b.t - a.t) * f,
        from: prev, to: cur, fromC: pc, toC: firCountry(cur) });
    }
    prev = cur; prevI = i;
  }
  /* Nachbarland ohne FIR in openAIP: Verlassen der letzten bekannten FIR Richtung auslaendischem Ziel zaehlt
     als Grenzuebertritt (Schnittpunkt auf ~0,1 NM genau) */
  var lastC = firCountry(prev);
  if (!out.length && prev && G.B && G.B.country && lastC && G.B.country !== lastC && prevI < sm.length - 1) {
    var a2 = sm[prevI], b2 = sm[prevI + 1], lo2 = 0, hi2 = 1;
    for (var k2 = 0; k2 < 8; k2++) {
      var m2 = (lo2 + hi2) / 2, f2 = firAt(G, { lat: a2.lat + (b2.lat - a2.lat) * m2, lon: a2.lon + (b2.lon - a2.lon) * m2 });
      if (f2 && firCountry(f2) === lastC) lo2 = m2; else hi2 = m2;
    }
    var g2 = (lo2 + hi2) / 2;
    out.push({ x: a2.x + (b2.x - a2.x) * g2, lat: a2.lat + (b2.lat - a2.lat) * g2, lon: a2.lon + (b2.lon - a2.lon) * g2, t: a2.t + (b2.t - a2.t) * g2,
      from: prev, to: null, fromC: lastC, toC: G.B.country, noFir: true });
  }
  return out;
}
/* Meldepunkte fuer die betroffenen Laender laden (Fehler = keine Meldepunkte, kein Abbruch) */
async function rpsFor(G, countries) {
  var list = [], failed = [];
  await Promise.all(countries.filter(Boolean).map(function (c) {
    return loadCountry(c, "rp").then(function (l) { list = list.concat(l); }, function () { failed.push(c); });
  }));
  return { list: list, failed: failed };
}
/* Markanter Ort nahe am Grenzuebertritt: groesster/naechster Ort innerhalb BORDER_TOWN_NM (OpenStreetMap) */
function borderTown(G, c) {
  var best = null;
  (G.PLACES || []).forEach(function (q) {
    var d = distNm(q, c); if (d > BORDER_TOWN_NM) return;
    var sc = d - 2 * Math.log10(Math.max(1000, q.pop));   /* 10x groesser = bis 2 NM weiter */
    if (!best || sc < best.sc) best = { sc: sc, q: q };
  });
  return best ? best.q : null;
}
/* Vereinfacht ein Profil zu Wegpunkten (Douglas-Peucker, 1 NM Toleranz) */
function simplifyPts(sm, tol) {
  function rec(i0, i1, out) {
    var a = sm[i0], b = sm[i1], md = 0, mi = -1;
    for (var i = i0 + 1; i < i1; i++) { var d = segDist(sm[i], a, b).d; if (d > md) { md = d; mi = i; } }
    if (md > tol) { rec(i0, mi, out); out.push(sm[mi]); rec(mi, i1, out); }
  }
  var out = [sm[0]]; rec(0, sm.length - 1, out); out.push(sm[sm.length - 1]);
  return out;
}
function rpPoint(rp, extra) {
  var o = { lat: rp.lat, lon: rp.lon, name: rp.name, rp: { id: rp.id, compulsory: rp.compulsory, country: rp.country } };
  for (var k in extra) o[k] = extra[k];
  return o;
}
/* Legt Auslandsabschnitte auf veroeffentlichte Meldepunkte: Grenzuebertritt ueber den naechsten
   (Pflicht-)Meldepunkt nahe der Grenze, Anflug auf einen auslaendischen Zielplatz ueber einen seiner
   Meldepunkte. Die angepasste Route wird komplett neu bewertet. */
async function adjustRoutes(routes, G, P) {
  if (!G.FIRS || !G.FIRS.length) return routes;
  var crossAll = routes.map(function (R) { return detectCrossings(R, G); });
  if (!crossAll.some(function (c) { return c.length; }) && (G.B.country || "") === (G.A.country || "")) return routes;
  var cs = {};
  crossAll.forEach(function (l) { l.forEach(function (c) { cs[c.fromC] = 1; cs[c.toC] = 1; }); });
  if (G.B.country) cs[G.B.country] = 1;
  var rp = await rpsFor(G, Object.keys(cs).filter(function (c) { return CTRY[c]; }));
  G.RPS = rp.list; G.rpFailed = rp.failed;
  for (var k = 0; k < routes.length; k++) {
    var R = routes[k], cr = crossAll[k];
    if (!cr.length && !(G.B.country && G.B.country !== G.A.country)) continue;
    var pts = [{ lat: G.A.lat, lon: G.A.lon, name: G.A.icao || "START" }], notes = [];
    var simp = simplifyPts(R.samples, 1).slice(1, -1), lastX = 0;
    cr.forEach(function (c) {
      var cand = rp.list.filter(function (q) { return distNm(q, c) <= BORDER_RP_NM; })
        .sort(function (a, b) { return (b.compulsory - a.compulsory) || (distNm(a, c) - distNm(b, c)); });
      simp.forEach(function (q) { if (q.x > lastX + 0.5 && q.x < c.x - 3) pts.push({ lat: q.lat, lon: q.lon }); });
      /* Reihenfolge: (1) VFR-Meldepunkt, (2) markanter Ort an der Grenze (z. B. Arnoldstein), (3) Grenzpunkt */
      var town = cand.length ? null : borderTown(G, c);
      if (cand.length) pts.push(rpPoint(cand[0], { border: { from: c.fromC, to: c.toC } }));
      else if (town) { pts.push({ lat: town.lat, lon: town.lon, name: town.name, town: town.name, border: { from: c.fromC, to: c.toC } }); notes.push("town:" + town.name); }
      else {
        var nt = nearestPlace(G.PLACES, c, 8);
        pts.push({ lat: c.lat, lon: c.lon, name: "GRENZE " + c.fromC + "/" + c.toC + (nt ? " (" + nt.name + ")" : ""), border: { from: c.fromC, to: c.toC } }); notes.push("norp");
      }
      lastX = c.x + 3;
    });
    /* Zielplatz im Ausland: Meldepunkt des Platzes (laut openAIP zugeordnet), sonst Pflichtmeldepunkt in der Naehe */
    var destRp = null;
    if (G.B.country && G.B.country !== G.A.country) {
      var prev = pts[pts.length - 1];
      var own = rp.list.filter(function (q) { return G.B.id && q.airports.indexOf(G.B.id) >= 0; });
      var near = own.length ? own : rp.list.filter(function (q) { return q.compulsory && distNm(q, G.B) <= DEST_RP_NM; });
      near.sort(function (a, b) { return (distNm(prev, a) + distNm(a, G.B)) - (distNm(prev, b) + distNm(b, G.B)); });
      if (near.length && distNm(near[0], G.B) > 1) destRp = near[0];
      if (!destRp) notes.push("nodest");
    }
    var destX = destRp ? R.D - distNm(destRp, G.B) : R.D;
    simp.forEach(function (q) { if (q.x > lastX + 0.5 && q.x < destX - 3) pts.push({ lat: q.lat, lon: q.lon }); });
    if (destRp && pts[pts.length - 1].name !== destRp.name) pts.push(rpPoint(destRp, { dest: true }));
    pts.push({ lat: G.B.lat, lon: G.B.lon, name: G.B.icao || "ZIEL" });
    var R2 = routeFromPoints(G, P, pts, null, R.id, R.name);
    R2.custom = false; R2.viaRp = true; R2.rpNotes = notes;
    /* Bezeichnung: ueber Meldepunkte, sonst ueber den Grenzort */
    var usedRp = pts.some(function (p) { return p.rp; }), tn = notes.filter(function (n) { return n.indexOf("town:") === 0; }).map(function (n) { return n.slice(5); });
    R2.viaLabel = usedRp ? " über Meldepunkte" : tn.length ? " über " + tn.join(", ") : "";
    routes[k] = R2;
  }
  /* Varianten, die durch die Meldepunkte gleich geworden sind, nur einmal behalten (die besser bewertete) */
  var uniq = [], sigs = {};
  routes.slice().sort(rankCmp).forEach(function (r) {
    var sig = (r.pts || []).map(function (q) { return q.lat.toFixed(2) + "," + q.lon.toFixed(2); }).join(";");
    if (sig && sigs[sig]) return;
    sigs[sig] = 1; uniq.push(r);
  });
  routes.length = 0; uniq.forEach(function (r) { routes.push(r); });
  routes.sort(rankCmp);
  routes.forEach(function (R, i) {
    var base = i === 0 ? (R.id === "direct" ? "Sicherste Route (= Direktstrecke)" : "Sicherste Route") : R.id === "direct" ? "Direktstrecke" : "Alternative";
    R.name = base + (R.viaRp ? (R.viaLabel != null ? R.viaLabel : " über Meldepunkte") : "");
  });
  return routes;
}
