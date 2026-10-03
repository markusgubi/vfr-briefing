"use strict";
/* ==================== 12b. Grenzuebertritte & VFR-Meldepunkte ==================== */
/* Grenzen kommen aus den Staatsgrenzlinien (Natural Earth, public/data/grenzen.json), ersatzweise aus den
   FIR-Luftraeumen von openAIP (Typ 10), Meldepunkte aus den openAIP reporting points. Es wird nichts erfunden: Fehlen Daten, bleibt die Route unveraendert und ein
   Hinweis sagt, was zu pruefen ist. */
var BORDER_RP_NM = 15;   /* Meldepunkt fuer den Grenzuebertritt hoechstens so weit vom Schnittpunkt */
var BORDER_TOWN_NM = 6;  /* sonst markanter Ort (GeoNames) hoechstens so weit vom Schnittpunkt */
var DEST_RP_NM = 20;     /* Meldepunkt fuer den Zielplatz hoechstens so weit vom Platz */
var DEST_OFF_NM = 3;     /* ... und hoechstens so weit seitlich neben der geplanten Linie */
/* seitlicher Abstand eines Punkts zur Route (NM) */
function offRoute(R, p) {
  var sm = R.samples, best = Infinity;
  for (var i = 1; i < sm.length; i++) best = Math.min(best, segDist(p, sm[i - 1], sm[i]).d);
  return best;
}

function firAt(G, p) {
  if (!G.FIRS || !G.FIRS.length) return null;
  var f = (G.FIRS || []).filter(function (a) { return inBox(p, a.bb) && inGeom(a.geometry, p.lon, p.lat); });
  return f.length ? f[0] : null;
}
function firCountry(f) { return f ? (f.country || (f.name.match(/^[A-Z]{4}/) || [""])[0]) : ""; }
/* Grenzuebertritte entlang des Profils: Wechsel des LANDES zwischen zwei Stichproben (auf ~0,1 NM genau).
   Punkte ohne FIR (Datenluecke) zaehlen nicht, mehrere FIRs eines Landes (z. B. DE) auch nicht. */
/* Grenzuebertritte aus Staatsgrenzlinien (Natural Earth): Schnitt jeder Profilstrecke mit den Grenzlinien.
   Land vorher/nachher aus der Linienrichtung (l = links, r = rechts). FIR (falls in openAIP) liefert die
   FIS-Frequenz. */
function borderCrossings(R, G) {
  var sm = R.samples, out = [];
  function k(lat) { return Math.cos(lat * RAD); }
  for (var i = 1; i < sm.length; i++) {
    var a = sm[i - 1], b = sm[i], kk = k(a.lat);
    var sb = [Math.min(a.lon, b.lon), Math.min(a.lat, b.lat), Math.max(a.lon, b.lon), Math.max(a.lat, b.lat)];
    G.BORDERS.forEach(function (ln) {
      if (!bbOverlap(sb, ln.bb)) return;
      for (var j = 1; j < ln.c.length; j++) {
        var p = ln.c[j - 1], q = ln.c[j];
        if (Math.max(p[0], q[0]) < sb[0] || Math.min(p[0], q[0]) > sb[2] || Math.max(p[1], q[1]) < sb[1] || Math.min(p[1], q[1]) > sb[3]) continue;
        var rx = (b.lon - a.lon) * kk, ry = b.lat - a.lat, lx = (q[0] - p[0]) * kk, ly = q[1] - p[1];
        var den = rx * ly - ry * lx; if (Math.abs(den) < 1e-12) continue;
        var px = (p[0] - a.lon) * kk, py = p[1] - a.lat;
        var t = (px * ly - py * lx) / den, u = (px * ry - py * rx) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        var cr = lx * ry - ly * rx, fromC = cr < 0 ? ln.l : ln.r, toC = cr < 0 ? ln.r : ln.l;
        var c = { x: a.x + (b.x - a.x) * t, lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, t: a.t + (b.t - a.t) * t, fromC: fromC, toC: toC };
        c.from = firAt(G, a); c.to = firAt(G, b);
        if (!out.some(function (o) { return Math.abs(o.x - c.x) < 0.3 && o.toC === c.toC; })) out.push(c);
      }
    });
  }
  out.sort(function (x, y) { return x.x - y.x; });
  return out.filter(function (c) { return c.fromC && c.toC && c.fromC !== c.toC; });
}
function detectCrossings(R, G) {
  if (G.BORDERS && G.BORDERS.length) return borderCrossings(R, G);
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
/* Markanter Ort nahe am Grenzuebertritt: groesster/naechster Ort innerhalb BORDER_TOWN_NM (GeoNames) */
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
  if (!(G.BORDERS && G.BORDERS.length) && !(G.FIRS && G.FIRS.length)) return routes;
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
    var simp = simplifyPts(R.samples, 1).slice(1, -1);
    /* Moeglichkeiten je Uebertritt: (1) VFR-Meldepunkt, (2) markanter Ort an der Grenze (z. B. Arnoldstein),
       (3) Grenzpunkt genau auf der Linie */
    var opts = cr.map(function (c) {
      var o = [], cand = rp.list.filter(function (q) { return distNm(q, c) <= BORDER_RP_NM; })
        .sort(function (a, b) { return (b.compulsory - a.compulsory) || (distNm(a, c) - distNm(b, c)); });
      var bd = { from: c.fromC, to: c.toC };
      if (cand.length) o.push({ kind: "rp", pt: rpPoint(cand[0], { border: bd }) });
      var town = borderTown(G, c);
      if (town) o.push({ kind: "town", pt: { lat: town.lat, lon: town.lon, name: town.name, town: town.name, border: bd }, note: "town:" + town.name });
      var nt = nearestPlace(G.PLACES, c, 8);
      o.push({ kind: "line", pt: { lat: c.lat, lon: c.lon, name: "GRENZE " + c.fromC + "/" + c.toC + (nt ? " (" + nt.name + ")" : ""), border: bd },
        note: cand.length ? "rpworse:" + cand[0].name : town ? "townworse:" + town.name : "norp" });
      return o;
    });
    /* Zielplatz im Ausland: Meldepunkt des Platzes (laut openAIP zugeordnet), sonst Pflichtmeldepunkt in der Naehe */
    /* Nur ein Meldepunkt, der hoechstens DEST_OFF_NM neben der geplanten Linie liegt: kein Umweg nur fuer einen
       Punkt (Wetter/Sicherheit bestimmen die Linie). Liegen sie abseits, nennt ein Hinweis die Meldepunkte. */
    var destRp = null, destNote = null;
    if (G.B.country && G.B.country !== G.A.country) {
      var own = rp.list.filter(function (q) { return G.B.id && q.airports.indexOf(G.B.id) >= 0; });
      var near = (own.length ? own : rp.list.filter(function (q) { return q.compulsory && distNm(q, G.B) <= DEST_RP_NM; }))
        .filter(function (q) { return distNm(q, G.B) > 1; })
        .map(function (q) { return { q: q, off: offRoute(R, q) }; }).sort(function (a, b) { return a.off - b.off; });
      if (near.length && near[0].off <= DEST_OFF_NM) destRp = near[0].q;
      else destNote = near.length ? "destoff:" + near.slice(0, 4).map(function (x) { return x.q.name; }).join(", ") : "nodest";
    }
    var destX = destRp ? R.D - distNm(destRp, G.B) : R.D;
    var build = function (sel) {
      var pts = [{ lat: G.A.lat, lon: G.A.lon, name: G.A.icao || "START" }], notes = [], lastX = 0;
      cr.forEach(function (c, ci) {
        simp.forEach(function (q) { if (q.x > lastX + 0.5 && q.x < c.x - 3) pts.push({ lat: q.lat, lon: q.lon }); });
        var o = opts[ci][sel[ci]];
        pts.push(o.pt); if (o.note) notes.push(o.note);
        if (o.kind === "town" && opts[ci][0].kind === "rp") notes.push("rpworse:" + opts[ci][0].pt.name);
        lastX = c.x + 3;
      });
      simp.forEach(function (q) { if (q.x > lastX + 0.5 && q.x < destX - 3) pts.push({ lat: q.lat, lon: q.lon }); });
      if (destRp && pts[pts.length - 1].name !== destRp.name) pts.push(rpPoint(destRp, { dest: true }));
      if (destNote) notes.push(destNote);
      pts.push({ lat: G.B.lat, lon: G.B.lon, name: G.B.icao || "ZIEL" });
      return { pts: pts, notes: notes };
    };
    /* Sicherheit geht vor: Meldepunkt nur, wenn Einstufung und Konfliktlaenge nicht schlechter werden; Ort nur
       unter denselben Bedingungen wie Landmarken (snapOk); sonst Grenzpunkt auf der Linie. Spaetere Uebertritte
       stehen waehrend der Pruefung auf "Linie", damit sie die Entscheidung nicht verfaelschen. */
    var sel = opts.map(function (o) { return o.length - 1; }), R2 = null;
    for (var ci = 0; ci < cr.length; ci++) {
      for (var oi = 0; oi < opts[ci].length - 1; oi++) {
        var trySel = sel.slice(); trySel[ci] = oi;
        var b0 = build(trySel), Rt = routeFromPoints(G, P, b0.pts, null, R.id, R.name), kind = opts[ci][oi].kind;
        var good = kind === "rp" ? Rt.cat <= R.cat && Rt.confLen <= R.confLen + 0.05 && !(Rt.airMissing && Rt.airMissing.length) : snapOk(R, Rt);
        if (good) { sel = trySel; R2 = Rt; break; }
      }
      if (sel[ci] === opts[ci].length - 1) R2 = null;
    }
    var bf = build(sel);
    if (!R2) R2 = routeFromPoints(G, P, bf.pts, null, R.id, R.name);
    /* Anflug-Meldepunkt nur, wenn die Route dadurch nicht weniger sicher wird */
    if (destRp && !(R2.cat <= R.cat && R2.confLen <= R.confLen + 0.05)) {
      var dn = destRp.name; destRp = null; destNote = "destworse:" + dn;
      bf = build(sel); R2 = routeFromPoints(G, P, bf.pts, null, R.id, R.name);
    }
    var pts = bf.pts, notes = bf.notes;
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
  nameRoutes(routes);
  return routes;
}
function nameRoutes(routes) {
  routes.sort(rankCmp);
  routes.forEach(function (R, i) {
    var base = i === 0 ? (R.id === "direct" ? "Sicherste Route (= Direktstrecke)" : "Sicherste Route") : R.id === "direct" ? "Direktstrecke" : "Alternative";
    R.name = base + (R.viaRp ? (R.viaLabel != null ? R.viaLabel : " über Meldepunkte") : "");
  });
}

/* ==================== 12c. Wendepunkte ueber Meldepunkten und Orten ==================== */
/* Knickpunkte der Route werden auf einen nahen VFR-Meldepunkt oder markanten Ort gelegt (Navigation von
   Ort zu Ort, Positionsmeldung im Funk). Uebernommen wird das nur, wenn die verschobene Route komplett neu
   bewertet mindestens genauso sicher ist: Einstufung und Konfliktlaenge nicht schlechter, Sicherheitswert
   hoechstens SNAP_SCORE schlechter, Strecke hoechstens 3 % + 1 NM laenger. Sicherheit geht immer vor. */
var SNAP_NM = 3, SNAP_POP = 2000, SNAP_SCORE = 3;
var ONLEG_NM = 1.5, ONLEG_POP = 3000, ONLEG_MIN = 15, ONLEG_GAP = 12;   /* Ueberflug-Punkte auf langen Teilstrecken */
function landmarkCands(G, p, used) {
  var out = [];
  (G.RPS || []).forEach(function (q) {
    var d = distNm(q, p); if (d > SNAP_NM || used[q.name]) return;
    out.push({ sc: d - 2 - (q.compulsory ? 0.5 : 0), pt: rpPoint(q, { lm: true }) });
  });
  (G.PLACES || []).forEach(function (q) {
    var d = distNm(q, p); if (d > SNAP_NM || q.pop < SNAP_POP || used[q.name]) return;
    out.push({ sc: d - 1.5 * Math.log10(q.pop / 1000), pt: { lat: q.lat, lon: q.lon, name: q.name, town: q.name, lm: true } });
  });
  return out.sort(function (a, b) { return a.sc - b.sc; });
}
function snapOk(R0, R) {
  return R.cat <= R0.cat && R.confLen <= R0.confLen + 0.05 && R.rawScore >= R0.rawScore - SNAP_SCORE &&
    R.D <= R0.D * 1.03 + 1 && !(R.airMissing && R.airMissing.length);
}
async function snapLandmarks(routes, G, P) {
  /* Meldepunkte von Start- und Zielland (Grenzlaender hat adjustRoutes schon geladen) */
  var have = {}, need = [G.A.country, G.B.country].filter(function (c) { return c && CTRY[c]; });
  (G.RPS || []).forEach(function (q) { have[q.country] = 1; });
  need = need.filter(function (c, i) { return !have[c] && need.indexOf(c) === i; });
  if (need.length) { var rp = await rpsFor(G, need); G.RPS = (G.RPS || []).concat(rp.list); }
  if (!(G.RPS || []).length && !(G.PLACES || []).length) return routes;
  for (var k = 0; k < routes.length; k++) {
    var R0 = routes[k], pts;
    if (R0.viaRp) pts = R0.pts.map(function (p) { return Object.assign({}, p); });
    else pts = [R0.pts[0]].concat(simplifyPts(R0.samples, 1).slice(1, -1).map(function (q) { return { lat: q.lat, lon: q.lon }; }), [R0.pts[R0.pts.length - 1]]);
    var used = {}, best = null, n = 0;
    pts.forEach(function (p) { if (p.name) used[p.name] = 1; });
    for (var i = 1; i < pts.length - 1; i++) {
      var p = pts[i]; if (p.rp || p.border || p.dest || p.lm) continue;
      var cs = landmarkCands(G, p, used).slice(0, 2);
      for (var c = 0; c < cs.length; c++) {
        var trial = pts.slice(); trial[i] = cs[c].pt;
        var Rt = routeFromPoints(G, P, trial, null, R0.id, R0.name);
        if (snapOk(R0, Rt)) { pts = trial; best = Rt; used[cs[c].pt.name] = 1; n++; break; }
      }
      if (typeof yieldUi === "function") await yieldUi();
    }
    /* Ueberflug: Meldepunkte/Orte, die fast genau auf einer langen geraden Teilstrecke liegen, werden als
       Wegpunkt eingefuegt (keine Kursaenderung, nur Benennung fuer Positionsmeldungen) */
    var ins = [], usedX = [];
    for (var a = 1; a < pts.length; a++) {
      var p0 = pts[a - 1], p1 = pts[a], len = distNm(p0, p1); if (len < ONLEG_MIN) continue;
      var cl = [];
      (G.RPS || []).forEach(function (q) { if (!used[q.name]) cl.push({ q: q, pt: rpPoint(q, { lm: true }), lim: ONLEG_NM, sc: -2 }); });
      (G.PLACES || []).forEach(function (q) { if (q.pop >= ONLEG_POP && !used[q.name]) cl.push({ q: q, pt: { lat: q.lat, lon: q.lon, name: q.name, town: q.name, lm: true }, lim: ONLEG_NM, sc: -1.5 * Math.log10(q.pop / 1000) }); });
      cl = cl.map(function (c) { var sd = segDist(c.q, p0, p1); return { c: c, d: sd.d, t: sd.t }; })
        .filter(function (x) { return x.d <= x.c.lim && x.t * len > 5 && (1 - x.t) * len > 5; })
        .sort(function (x, y) { return (x.d + x.c.sc) - (y.d + y.c.sc); });
      var taken = [];
      cl.forEach(function (x) {
        if (taken.some(function (y) { return Math.abs(y.t - x.t) * len < ONLEG_GAP; })) return;
        taken.push(x); used[x.c.pt.name] = 1;
      });
      taken.sort(function (x, y) { return x.t - y.t; }).forEach(function (x) { ins.push({ a: a, t: x.t, pt: x.c.pt }); });
    }
    if (ins.length) {
      var pts2 = [];
      pts.forEach(function (p, i) { ins.filter(function (x) { return x.a === i; }).forEach(function (x) { pts2.push(x.pt); }); pts2.push(p); });
      var Ri = routeFromPoints(G, P, pts2, null, R0.id, R0.name);
      if (snapOk(R0, Ri)) { pts = pts2; best = Ri; n += ins.length; }
      if (typeof yieldUi === "function") await yieldUi();
    }
    if (!best) continue;
    best.custom = false; best.viaRp = R0.viaRp; best.viaLabel = R0.viaLabel; best.rpNotes = R0.rpNotes; best.landmarks = n;
    routes[k] = best;
  }
  nameRoutes(routes);
  return routes;
}
