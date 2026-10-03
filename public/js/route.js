"use strict";
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
  /* Abflug-/Anflugfaecher: Ringe in 2,5 und 5 NM (alle 15 Grad), damit die Suche einem Tal aus dem Platz heraus
     bzw. in den Platz hinein folgen kann statt nur geraden 5-NM-Strahlen */
  if (d >= 20) {
    var RINGS = [2.5, 5], DIRS = 24, add = function (a, b) { if (emap[a + ">" + b] == null) { emap[a + ">" + b] = edges.length; edges.push({ a: a, b: b }); } };
    [[A, 0, 1], [B, N, -1]].forEach(function (cfg) {
      var ctr = cfg[0], i0 = cfg[1], sg = cfg[2], fwd = sg > 0 ? crs : (crs + 180) % 360, ring = [[], []];
      for (var r = 0; r < RINGS.length; r++) for (var k = 0; k < DIRS; k++) {
        var dir = k * 360 / DIRS, dd = Math.abs(((dir - fwd + 540) % 360) - 180);
        if (dd > 105) continue;
        var q = offsetPt(ctr, dir, RINGS[r]), along = sg > 0 ? RINGS[r] : d - RINGS[r];
        ring[r].push({ n: nodes.length, k: k });
        nodes.push({ i: i0 + sg * (r + 1) / 3, j: 100 + r * DIRS + k, lat: q.lat, lon: q.lon, along: along, fan: true });
      }
      var end = idx[i0 + ",0"];
      ring[0].forEach(function (q0) {
        if (sg > 0) add(end, q0.n); else add(q0.n, end);
        ring[1].forEach(function (q1) {
          var dk = Math.abs(((q1.k - q0.k) % DIRS + DIRS + DIRS / 2) % DIRS - DIRS / 2);
          if (dk <= 2) { if (sg > 0) add(q0.n, q1.n); else add(q1.n, q0.n); }
        });
      });
      ring[1].forEach(function (q1) {
        var nd = nodes[q1.n];
        [i0 + sg, i0 + 2 * sg].forEach(function (gi) {
          for (var gj = -K; gj <= K; gj++) {
            var b = idx[gi + "," + gj];
            if (b == null || distNm(nd, nodes[b]) > step * 1.6 + 1) continue;
            if (sg > 0) add(q1.n, b); else add(b, q1.n);
          }
        });
      });
    });
  }
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
  var n = Math.max(4, Math.ceil(e.len / 0.25)), tmax = -1e9, tmaxC = -1e9, k, o;
  for (k = 0; k <= n; k++) {
    var c = lerp(na, nb, k / n);
    for (o = -1; o <= 1.001; o += 0.5) {
      var p = Math.abs(o) < 1e-6 ? c : offsetPt(c, e.crs + 90, o), h = elevFt(p.lat, p.lon);
      if (h != null && h > tmax) tmax = h;
      if (h != null && Math.abs(o) < 1e-6 && h > tmaxC) tmaxC = h;
    }
  }
  e.tmax = tmax > -1e8 ? tmax : 0;
  e.tmaxC = tmaxC > -1e8 ? tmaxC : e.tmax;
  e.gafor = !!GAFOR && nearGafor(lerp(na, nb, 0.5)) && nearGafor(na) && nearGafor(nb);
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
/* GAFOR-Strecken (public/data/gafor.geojson, nur wenn als geprueft markiert): Teilstrecken innerhalb
   2,5 NM einer GAFOR-Strecke bekommen in der Routensuche einen Bonus, damit man bei
   Wetterverschlechterung ins Tal absinken kann */
var GAFOR = null, GAFOR_NM = 2.5;
var GAFOR_ON = false;   /* Option "GAFOR-Strecken bevorzugen" beim Planen; ohne Haken kein Einfluss */
function nearGafor(p) {
  if (!GAFOR) return false;
  for (var k = 0; k < GAFOR.length; k++) {
    var l = GAFOR[k].pts;
    for (var i = 1; i < l.length; i++) if (segDist(p, l[i - 1], l[i]).d <= GAFOR_NM) return true;
  }
  return false;
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
  /* Steigfaehigkeit: erreichbare Hoehe bei normalem Steigflug ab Platzhoehe (ohne Kreisen) */
  var ramp = rampNm(P), xb = nb.along, full = P.terrClr + DEM.buf;
  var need = xb < ramp ? e.tmaxC + full * xb / ramp : e.tmax + full;
  r.climbDef = Math.max(0, need - (G.depElev + climbGrad(P) * xb));
  r.noCirc = na.along < NO_CIRC_NM;
  G.dyn[key] = r;
  return r;
}
function ceilFromBase(base, P) {
  if (!isFinite(base)) return Infinity;
  var c = base - P.cloudClr;
  if (c < 3000) c = Math.min(Math.max(c, base - 500), Math.max(c, 3000));
  return c;
}
function makeMode(P, lambda, gafor) { return { lambda: lambda, clrPen: P.avoidClr ? 400 : 2, dangerPen: 150, gafor: !!gafor }; }
function edgeCost(r, mode) {
  var c = r.e.len * (1 + mode.lambda * r.risk);
  if (r.terrainHigh) c += 1e5;
  if (r.wxFail) c += 3000; else if (r.room < 1500) c += r.e.len * 3 * (1500 - r.room) / 1500;
  if (r.nogo) c += 3000;
  if (r.needDanger) c += mode.dangerPen;
  if (r.needClr) c += mode.clrPen;
  /* Gelaende nicht mit normalem Steigflug erreichbar: im Abflugbereich stark (dort wird nie gekreist),
     unterwegs schwaecher bestraft (Kreisen moeglich, aber Nachteil) */
  if (r.climbDef > 0) c += (r.noCirc ? 4 : 1) * r.e.len * Math.min(3, r.climbDef / 500) + (r.noCirc && r.climbDef > 500 ? 300 : 0);
  /* GAFOR-Bonus nur in der eigenen GAFOR-Suche (zusaetzlicher Kandidat), nie in der normalen Suche */
  if (mode.gafor && r.e.gafor) c -= r.e.len * 0.15;
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
var NO_CIRC_NM = 8;   /* im Abflugbereich wird nie kreisend gestiegen (Start in Platzhoehe, normaler Steigflug) */
function climbGrad(P) { return P.climb * 60 / (P.tas * 0.8); }   /* ft je NM im Steigflug (Steig-Fahrt ~80 % TAS) */
function descGrad(P) { return P.desc * 60 / P.tas; }
/* Abflug-/Anflugbereich: so lang, wie ein normaler Steigflug fuer den vollen Gelaendeabstand braucht (+1 NM) */
function rampNm(P) { return Math.max(3, (P.terrClr + DEM.buf) / climbGrad(P) + 1); }
function semiOk(alt, mc) { var b = mc < 180 ? 3500 : 4500; return alt >= b && (alt - b) % 2000 === 0; }
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
var CAUSE = { wx: "Wolkenbasis zu nah am Gelände", air: "Luftraum lässt keine sichere Höhe zu",
  climb: "Gelände steigt schneller an, als es die eingestellte Steigrate erlaubt",
  low: "geplante Höhe zu nah am Gelände", cloud: "geplante Höhe in oder an den Wolken",
  forb: "Flugbeschränkungs-/Sperrgebiet wird berührt", terr: "Gelände über Maximalhöhe",
  nodata: "keine Geländedaten (werden nachgeladen)" };
/* Reiseflughoehen: zusammenhaengende Abschnitte gleicher Halbkreisrichtung, deren erlaubte Hoehenbaender
   sich ueberschneiden, bekommen eine gemeinsame Hoehe. Vom Nutzer gesetzte Hoehen (je Teilstrecke) haben Vorrang. */
function assignAlts(rs, P, userAlt) {
  function ua(r) { return userAlt && r.e.leg != null && userAlt[r.e.leg] != null ? userAlt[r.e.leg] : null; }
  var i = 0, j, k, tmax;
  while (i < rs.length) {
    var u = ua(rs[i]);
    if (u != null) {
      j = i + 1; while (j < rs.length && rs[j].e.leg === rs[i].e.leg) j++;
      tmax = -1e9; for (k = i; k < j; k++) tmax = Math.max(tmax, rs[k].e.tmax);
      var sm = u - tmax > 3000 ? (semiOk(u, rs[i].mc) ? "ok" : "no") : null;
      for (k = i; k < j; k++) { rs[k].alt = u; rs[k].user = true; rs[k].semi = sm; rs[k].iv = [-Infinity, Infinity]; }
      i = j; continue;
    }
    var cur = rs[i].set, hemi = rs[i].mc < 180;
    j = i + 1;
    while (j < rs.length && ua(rs[j]) == null && (rs[j].mc < 180) === hemi) { var x = intersect(cur, rs[j].set); if (!x.length) break; cur = x; j++; }
    tmax = -1e9;
    for (k = i; k < j; k++) tmax = Math.max(tmax, rs[k].e.tmax);
    var pk = pickAlt(cur, tmax, P, rs[i].mc);
    /* Hoehenband je Abschnitt aus dessen EIGENEN Grenzen (nicht die der ganzen Gruppe),
       sonst wird z. B. die Gelaendeuntergrenze vom Gebirge bis ins Flachland mitgeschleppt */
    for (k = i; k < j; k++) {
      var own = rs[k].set.filter(function (iv) { return iv[0] <= pk.alt + 1 && iv[1] >= pk.alt - 1; })[0] || pk.iv;
      rs[k].alt = pk.alt; rs[k].semi = pk.semi; rs[k].iv = own; rs[k].user = false;
    }
    i = j;
  }
}
/* Bewertet eine Route komplett: Reiseflughoehen je Abschnitt, dann ein durchgehendes Profil.
   Grundsaetze: Start immer in Platzhoehe mit normalem Steigflug, im Abflugbereich (NO_CIRC_NM) wird nie
   kreisend gestiegen. Reicht die Steigrate fuer das Gelaende nicht, wird das als Konflikt bzw. knapper
   Gelaendeabstand bewertet statt "wegkreist". Unterwegs wird nur gekreist, wenn das Gelaende es verlangt;
   das zaehlt als Nachteil (mind. EINGESCHRAENKT). opt.userAlt: { Teilstrecke: Hoehe } fuer eigene Hoehen. */
function evalRoute(G, P, depH, path, id, name, opt) {
  opt = opt || {};
  var rs = path.map(function (ei) {
    var r = edgeDyn(G, ei, depH, P), o = {};
    for (var k in r) o[k] = r[k];
    o.ei = ei;
    o.set = r.blocked ? [[r.floor, Math.max(r.floor, P.maxAlt)]] : (P.avoidClr ? (r.setNoClr || r.setAny) : r.setAny);
    o.mc = (r.e.crs - MAGVAR + 360) % 360;
    return o;
  });
  assignAlts(rs, P, opt.userAlt);
  var cum = 0, i;
  rs.forEach(function (r) {
    r.x0 = cum; cum += r.e.len; r.x1 = cum;
    r.wind = vecMean([r.wa, r.wb]);
    var g = gsCalc(P.tas, r.e.crs, r.wind); r.gs = g.gs; r.wca = g.wca;
  });
  var D = cum, depElev = G.depElev, destElev = G.destElev;
  var gC = climbGrad(P), gD = descGrad(P), full = P.terrClr + DEM.buf, ramp = rampNm(P);
  /* Automatische Sinkflugplanung zum Ziel erst nach der letzten selbst gesetzten Hoehe */
  var lastUserX = rs.reduce(function (m, r) { return r.user ? Math.max(m, r.x1) : m; }, -1);
  /* Stichproben alle 0,5 NM */
  var sm = [];
  rs.forEach(function (r, ri) {
    var na = G.nodes[r.e.a], nb = G.nodes[r.e.b], n = Math.max(1, Math.ceil(r.e.len / 0.5));
    for (var kk = (ri === 0 ? 0 : 1); kk <= n; kk++) {
      var f = kk / n, c = lerp(na, nb, f), xx = r.x0 + f * r.e.len;
      var tc = elevFt(c.lat, c.lon), nod = tc == null; if (nod) tc = 0;
      var tm = tc;
      [-1, -0.5, 0.5, 1].forEach(function (o) { var q = offsetPt(c, r.e.crs + 90, o), hh = elevFt(q.lat, q.lon); if (hh == null) nod = true; else if (hh > tm) tm = hh; });
      var bA = r.wa ? r.wa.base : Infinity, bB = r.wb ? r.wb.base : Infinity;
      var base = (isFinite(bA) && isFinite(bB)) ? bA + (bB - bA) * f : Math.min(bA, bB);
      var fA = r.wa ? r.wa.fz : null, fB = r.wb ? r.wb.fz : null;
      var fz = (fA != null && fB != null) ? fA + (fB - fA) * f : (fA != null ? fA : fB);
      var dF = Math.min(xx, D - xx), near = dF < ramp;
      /* Gelaendeanforderung: im Abflug-/Anflugbereich von der Platzhoehe ansteigend (Mittellinie),
         sonst voller Abstand ueber dem hoechsten Punkt +-1 NM. "hard" = mind. 500 ft (+DEM-Puffer). */
      var ter = near ? tc : tm;
      var req = near ? tc + full * dF / ramp : tm + full;
      var hard = Math.min(req, near ? tc + (DEM.buf + 500) * dF / ramp : tm + DEM.buf + 500);
      var hi = Math.min(r.iv[1], P.maxAlt);
      if (r.wxFail) hi = Math.min(hi, Math.max(r.ceilWx, r.floor));
      /* Geplant wird mit 300 ft Reserve ueber dem Mindestabstand, soweit Wolken/Luftraum Platz lassen */
      var aim = Math.max(req, Math.min(req + 300 * Math.min(1, dF / ramp), hi));
      var lo = (r.iv[0] > r.floor + 1 && dF >= 5) ? Math.max(aim, r.iv[0]) : aim;
      /* Eigene Hoehe wird so geflogen, wie eingestellt; nur automatische Hoehen planen den Sinkflug zum Ziel ein */
      var T = r.user || xx < lastUserX ? r.alt : Math.min(r.alt, destElev + 1000 + gD * Math.max(0, D - xx - 2));
      sm.push({ x: xx, ri: ri, f: f, lat: c.lat, lon: c.lon, tc: tc, tm: tm, ter: ter, base: base, fz: fz, dF: dF,
        req: req, hard: hard, lo: lo, hi: hi, T: T, user: r.user, nod: nod });
    }
  });
  var n = sm.length;
  for (i = 0; i < n; i++) sm[i].dx = i ? sm[i].x - sm[i - 1].x : 0;
  function hull(v) {   /* vorausschauend steigen (rueckwaerts), begrenzt sinken (vorwaerts) */
    for (var a = n - 2; a >= 0; a--) v[a] = Math.max(v[a], v[a + 1] - gC * sm[a + 1].dx);
    for (var b = 1; b < n; b++) v[b] = Math.max(v[b], v[b - 1] - gD * sm[b].dx);
    return v;
  }
  /* Eigene Hoehen gehen in die Vorausschau ein: Eine hoehere eigene Hoehe wird schon VOR Beginn ihrer
     Teilstrecke erreicht (wie SkyDemon LevelChange "B"), gesunken wird ab Beginn der Teilstrecke ("F"). */
  var Lr = hull(sm.map(function (q) { return q.user ? q.T : q.lo; }));
  var LT = hull(sm.map(function (q) { return q.user ? -Infinity : q.req; }));   /* nur Gelaende */
  var Ur = sm.map(function (q) { return q.hi; });
  for (i = n - 2; i >= 0; i--) Ur[i] = Math.min(Ur[i], Ur[i + 1] + gD * sm[i + 1].dx);
  var p = new Array(n), circ = new Array(n).fill(0), atMax = new Array(n).fill(false);
  p[0] = depElev;   /* Start immer in Platzhoehe */
  for (i = 1; i < n; i++) {
    var q = sm[i], reach = p[i - 1] + gC * q.dx;
    var t = q.user ? Math.max(q.T, Lr[i]) : Math.max(Lr[i], Math.min(Math.max(Ur[i], Lr[i]), q.T));
    t = Math.max(t, p[i - 1] - gD * q.dx);
    if (t > reach + 1) {
      if (!q.user && q.x >= NO_CIRC_NM && LT[i] > reach + 1 && reach >= q.hard - 1 && q.hi >= LT[i] - 1) { circ[i] = LT[i] - reach; t = LT[i]; }
      else { t = reach; atMax[i] = true; }
    }
    p[i] = t;
  }
  /* Zeiten inkl. Kreisen unterwegs und Sinken ueber dem Ziel */
  var tm0 = depH * 60, circles = [];
  for (i = 0; i < n; i++) {
    if (i) { var gs = rs[sm[i].ri].gs * (p[i] > p[i - 1] + 1 ? 0.8 : 1); tm0 += sm[i].dx / gs * 60; }
    if (circ[i] > 150) {
      var cm = circ[i] / P.climb, lc = circles[circles.length - 1];
      if (lc && sm[i].x - lc.x < 1.01) { lc.to = p[i]; lc.min += cm; }
      else circles.push({ x: sm[i].x, from: p[i] - circ[i], to: p[i], min: cm });
      tm0 += cm;
    }
    sm[i].t = tm0; sm[i].circ = circ[i] > 150 ? circ[i] : 0;
  }
  var circMin = circles.reduce(function (s, c) { return s + c.min; }, 0);
  var excess = p[n - 1] - (destElev + 1000), spiralMin = excess > 300 ? excess / P.desc : 0;
  var arrMin = tm0 + spiralMin;
  rs.forEach(function (r) { r.tStart = null; r.tEnd = null; r.cat = 0; r.minCloud = Infinity; r.minTerr = Infinity; r.conf = false; r.soft = false; r.circ = false; });
  circles.forEach(function (c) { rs[sampleAt({ samples: sm }, c.x).ri].circ = true; });
  /* Bewertung der Stichproben */
  var minTerr = Infinity, minTerrX = 0, minCloud = Infinity, conflicts = [], curC = null, tight = [], curT = null;
  for (i = 0; i < n; i++) {
    var s = sm[i], r = rs[s.ri];
    s.p = p[i];
    if (r.tStart == null) r.tStart = i ? sm[i - 1].t : s.t;
    r.tEnd = s.t;
    var cause = null;
    if (s.nod) cause = "nodata";
    else if (r.terrainHigh && (s.p < s.req - 1 || s.p > P.maxAlt + 1)) cause = "terr";
    else if (s.p < s.hard - 1) {
      var climbing = false;
      for (var b = i; b > 0 && b > i - 60; b--) { if (atMax[b]) { climbing = true; break; } if (p[b] <= p[b - 1] + 1) break; }
      cause = climbing ? "climb" : s.user ? "low" : (isFinite(s.base) && s.base - P.cloudClr < s.req) ? "wx" : "air";
    } else if (!s.user && s.lo > Ur[i] + 1) cause = (r.wxFail || s.base - P.cloudClr < s.lo) ? "wx" : "air";
    else if (s.dF >= 1 && isFinite(s.base) && s.p > s.base - 100) cause = (!s.user && r.wxFail) ? "wx" : "cloud";
    s.conf = !!cause; s.cause = cause;
    if (cause) {
      if (curC && curC.cause === cause && s.x - curC.x1 < 1.01) { curC.x1 = s.x; curC.clr = Math.min(curC.clr, s.p - s.ter); }
      else { curC = { cause: cause, x0: s.x, x1: s.x, clr: s.p - s.ter }; conflicts.push(curC); }
      r.conf = true;
    } else curC = null;
    /* knapper Gelaendeabstand (unter Sollwert, aber ueber der harten Grenze) */
    if (!cause && i && s.p < s.req - 50) {
      var clr = s.p - s.ter;
      if (curT && s.x - curT.x1 < 1.01) { curT.x1 = s.x; if (clr < curT.clr) curT.clr = clr; }
      else { curT = { x0: s.x, x1: s.x, clr: clr, climb: atMax[i] || (p[i] > p[i - 1] + 1) }; tight.push(curT); }
      r.soft = true;
    } else curT = null;
    if (s.dF >= ramp) { if (s.p - s.tm < minTerr) { minTerr = s.p - s.tm; minTerrX = s.x; } r.minTerr = Math.min(r.minTerr, s.p - s.tm); }
    if (isFinite(s.base)) { minCloud = Math.min(minCloud, s.base - s.p); r.minCloud = Math.min(r.minCloud, s.base - s.p); }
  }
  var cat = 0, maxRisk = 0, rsum = 0, worstReason = null;
  rs.forEach(function (r) {
    r.cat = (r.conf || r.blocked || r.terrainHigh || r.nogo || r.minCloud < 0) ? 2
      : (r.risk >= 0.35 || r.minCloud < 1000 || r.minTerr < P.terrClr + 300 || r.soft || r.circ) ? 1 : 0;
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
  /* Luftraeume entlang des tatsaechlichen Profils */
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
  entries.forEach(function (x) {
    if (!x.inside || x.as.kind !== "forbidden") return;
    cat = 2; conflicts.push({ cause: "forb", x0: x.x0, x1: x.x1, as: x.as });
    rs.forEach(function (r) { if (r.x1 >= x.x0 && r.x0 <= x.x1) { r.cat = 2; r.conf = true; } });
  });
  conflicts.sort(function (a, b) { return a.x0 - b.x0; });
  var night = false, dusk = false, dawn = false;
  if (G.sun) {
    if (arrMin / 60 > G.sun.destSet) night = true; else if (arrMin / 60 > G.sun.destSet - 0.5) dusk = true;
    if (depH < G.sun.depRise) dawn = true;
  }
  if (night || dawn || arrMin > 1440) cat = 2; else if (dusk) cat = Math.max(cat, 1);
  var avgRisk = D ? rsum / D : 0, score = 100 - 45 * maxRisk - 15 * avgRisk;
  if (isFinite(minCloud) && minCloud < 2500) score -= Math.min(25, Math.max(0, (2500 - minCloud) / 2500 * 25));
  if (minTerr < 1500) score -= Math.min(15, Math.max(0, (1500 - minTerr) / 1500 * 15));
  tight.forEach(function (t) { score -= Math.min(15, 3 + Math.max(0, P.terrClr - t.clr) / 100); });
  score -= Math.min(20, circMin * 2) + Math.min(6, spiralMin * 0.5);
  var rawScore = score, confLen = conflicts.reduce(function (s, c) { return s + c.x1 - c.x0 + 0.5; }, 0);
  if (cat === 2) score = Math.min(score, 30); else if (cat === 1) score = Math.min(score, 70);
  return { rawScore: rawScore, confLen: Math.round(confLen * 2) / 2, circles: circles, tight: tight, id: id, name: name, rs: rs, path: path, key: path.join(","),
    G: G, userAlt: opt.userAlt || null, D: D, samples: sm, circMin: circMin, spiralMin: spiralMin,
    depMin: depH * 60, arrMin: arrMin, ete: arrMin - depH * 60, maxAlt: Math.max.apply(null, p), cruiseMax: Math.max.apply(null, rs.map(function (r) { return r.alt; })),
    minTerr: minTerr, minTerrX: minTerrX, terrReserve: P.terrClr + 300, minCloud: minCloud, maxRisk: maxRisk, avgRisk: avgRisk, worstReason: worstReason, conflicts: conflicts,
    entries: entries, clr: clr, cat: cat, score: Math.max(0, Math.round(score)), night: night, dusk: dusk, dawn: dawn };
}
function sampleAt(R, x) {
  var sm = R.samples;
  for (var i = 0; i < sm.length; i++) if (sm[i].x >= x - 1e-6) return sm[i];
  return sm[sm.length - 1];
}
function densAlt(elev, T, qnh) { var pa = elev + (1013.25 - qnh) * 27, isa = 15 - 1.98 * elev / 1000; return pa + 120 * (T - isa); }

/* ==================== 10b. Beliebige Routen (Polylinie aus Wegpunkten) ==================== */
/* Macht aus einer Wegpunktfolge ein lineares Netz: jede Teilstrecke (leg) wird in Stuecke von hoechstens
   5 NM geteilt. Gelaende, Luftraum und Wetter kommen aus dem Hauptnetz Gb (Wetter vom naechsten
   Wetterpunkt). Damit bewertet evalRoute jede gezogene oder ueber Meldepunkte gelegte Route. */
var WX_FAR_NM = 15;
/* pts[k].shape = Formpunkt (aus dem Suchnetz, kein eigener Wegpunkt). Teilstrecken ("legs", fuer eigene
   Hoehen) laufen von Wegpunkt zu Wegpunkt; Formpunkte teilen keine Teilstrecke. */
function polyGraph(Gb, pts) {
  var G = Object.create(Gb), nodes = [], edges = [], along = 0, leg = 0;
  pts.forEach(function (p, k) {
    if (k === 0) { nodes.push({ i: 0, j: 0, lat: p.lat, lon: p.lon, along: 0, uw: 0, pi: 0 }); return; }
    var a = pts[k - 1], len = distNm(a, p), n = Math.max(1, Math.ceil(len / 5));
    for (var m = 1; m <= n; m++) {
      var q = lerp(a, p, m / n);
      nodes.push({ i: nodes.length, j: 0, lat: q.lat, lon: q.lon, along: along + len * m / n,
        uw: m === n && !p.shape ? k : null, pi: m === n ? k : null });
      edges.push({ a: nodes.length - 2, b: nodes.length - 1, leg: leg });
    }
    if (!p.shape) leg++;
    along += len;
  });
  nodes.forEach(function (nd) {
    var ds = Gb.wpts.map(function (w, k) { return { k: k, d: distNm(nd, w) }; }).sort(function (a, b) { return a.d - b.d; });
    var lim = Math.max(ds[0].d * 1.25, ds[0].d + 1);
    nd.wps = ds.filter(function (x) { return x.d <= lim; }).slice(0, 2).map(function (x) { return x.k; });
    nd.wxFar = ds[0].d > WX_FAR_NM ? ds[0].d : 0;
  });
  G.nodes = nodes; G.edges = edges; G.N = nodes.length - 1; G.start = 0; G.end = nodes.length - 1;
  G.order = edges.map(function (e, k) { return k; }); G.emap = {}; G.idx = {};
  G.nw = {}; G.dyn = {}; G.poly = true;
  edges.forEach(function (e) { edgeStatic(G, e, Gb.AIR || []); });
  return G;
}
/* Abdeckung der geladenen Daten fuer eine Wegpunktfolge pruefen */
function inBox(p, bb) { return p.lon >= bb[0] && p.lon <= bb[2] && p.lat >= bb[1] && p.lat <= bb[3]; }
function inAirBoxes(G, p) { return !G.airBoxes || G.airBoxes.some(function (bb) { return inBox(p, bb); }); }
function routeFromPoints(Gb, P, pts, userAlt, id, name) {
  var G = polyGraph(Gb, pts), path = G.edges.map(function (e, k) { return k; });
  var R = evalRoute(G, P, P.depH, path, id || "user", name || "Eigene Route", { userAlt: userAlt || null });
  R.pts = pts.map(function (p) { var o = {}; for (var k in p) o[k] = p[k]; return o; });
  R.custom = true;
  R.wxFar = G.nodes.filter(function (nd) { return nd.wxFar; }).map(function (nd) { return { lat: nd.lat, lon: nd.lon, d: nd.wxFar, x: nd.along }; });
  var outside = [];
  G.nodes.forEach(function (nd) { if (!inAirBoxes(Gb, nd)) outside.push(nd.along); });
  R.airMissing = outside;
  if (outside.length) { R.cat = 2; R.score = Math.min(R.score, 30); }
  return R;
}

/* Einheitliche Bewertung: Das Suchnetz dient nur zum Finden der Wege. Jede Route (berechnet, Direktstrecke,
   Optimierer, Bearbeiten) wird ueber dieselbe Polylinie mit Wetter hoechstens alle 5 NM bewertet. So liefert
   dieselbe Strecke immer dasselbe Ergebnis, und schlechtes Wetter mitten auf einer langen Netzkante wird
   nicht uebersehen. */
function ptsFromPath(G, path) {
  var pts = [{ lat: G.A.lat, lon: G.A.lon, name: G.A.icao || "START" }];
  path.forEach(function (ei, k) {
    var n = G.nodes[G.edges[ei].b], last = k === path.length - 1;
    pts.push(last ? { lat: G.B.lat, lon: G.B.lon, name: G.B.icao || "ZIEL" } : { lat: n.lat, lon: n.lon, shape: true });
  });
  return pts;
}
function evalPath(G, P, depH, path, id, name) {
  var key = path.join(","), cache = G.polyCache || (G.polyCache = {});
  var pg = cache[key] || (cache[key] = polyGraph(G, ptsFromPath(G, path)));
  var R = evalRoute(pg, P, depH, pg.edges.map(function (e, k) { return k; }), id, name);
  R.pts = ptsFromPath(G, path); R.custom = false;
  R.path = path; R.key = key;   /* Netzweg fuer Aehnlichkeit/Duplikate */
  return R;
}

/* ==================== 11. Kandidaten, Rangfolge, Begruendung ==================== */
function laneMap(path, G) { var m = {}; path.forEach(function (ei) { var n = G.nodes[G.edges[ei].b]; m[n.i] = n.j; }); return m; }
function similar(a, b, G) {
  var ma = laneMap(a, G), mb = laneMap(b, G), k = 0, n = 0;
  Object.keys(ma).forEach(function (i) { n++; if (mb[i] != null && Math.abs(ma[i] - mb[i]) <= 1) k++; });
  return n ? k / n : 1;
}
/* Rangfolge streng nach Sicherheit: Einstufung, Konfliktlaenge, Sicherheitswert. Erst bei GLEICHER Sicherheit
   entscheidet die Naehe zu GAFOR-Strecken, danach die Flugzeit. */
function gaforShare(R) { return R.rs.reduce(function (a, r) { return a + (r.e.gafor ? r.e.len : 0); }, 0) / Math.max(1, R.D); }
function rankCmp(x, y) {
  return x.cat - y.cat || x.confLen - y.confLen || Math.round(y.rawScore) - Math.round(x.rawScore) ||
    (GAFOR && GAFOR_ON ? Math.round(10 * (gaforShare(y) - gaforShare(x))) : 0) || x.ete - y.ete;
}
function candidatePaths(G, P, depH, quick) {
  var out = [];
  function add(p) { if (p && !out.some(function (q) { return q.join() === p.join(); })) out.push(p); }
  var p1 = bestPath(G, P, depH, makeMode(P, 5)); add(p1);
  add(bestPath(G, P, depH, makeMode(P, 12)));
  if (GAFOR && GAFOR_ON) add(bestPath(G, P, depH, makeMode(P, 5, true)));   /* GAFOR-Variante, gewinnt nur bei gleicher Sicherheit */
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
  var dp = directPath(G), direct = dp ? evalPath(G, P, P.depH, dp, "direct", "Direktstrecke") : null;
  var evals = candidatePaths(G, P, P.depH, false).map(function (p, k) { return evalPath(G, P, P.depH, p, "c" + k, ""); })
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
async function optimizer(G, P, onHour) {
  var span = G.d / P.tas, lo = G.sun ? Math.ceil(G.sun.depRise) : 6, hi = G.sun ? Math.floor(G.sun.destSet - span - 0.25) : 19;
  var now = new Date(), isToday = P.date === now.getFullYear() + "-" + p2(now.getMonth() + 1) + "-" + p2(now.getDate());
  if (isToday) lo = Math.max(lo, now.getHours() + 1);
  var out = [];
  for (var h = Math.max(0, lo); h <= Math.min(23, hi); h++) {
    var ps = candidatePaths(G, P, h, true), dp = directPath(G);
    if (dp) ps.push(dp);
    var best = null;
    ps.forEach(function (p) { var R = evalPath(G, P, h, p, "", ""); if (!best || rankCmp(R, best) < 0) best = R; });
    out.push(best ? { h: h, score: best.score, cat: best.cat } : { h: h, score: 0, cat: 2 });
    if (onHour) { onHour(h - Math.max(0, lo) + 1, Math.min(23, hi) - Math.max(0, lo) + 1, h); await new Promise(function (r) { setTimeout(r, 0); }); }
  }
  return out;
}
function issueOf(R) {
  var fb = R.conflicts.filter(function (c) { return c.cause === "forb"; })[0];
  if (fb) return "Ber\u00fchrung von " + fb.as.name + " (verboten) bei NM " + Math.round(fb.x0);
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
  if (R.tight && R.tight.length) {
    var tt = R.tight.slice().sort(function (a, b) { return a.clr - b.clr; })[0];
    return (tt.climb ? "im Steigflug " : "") + "Gel\u00e4ndeabstand nur ~" + fmtFt(Math.max(0, tt.clr)) + " ft bei NM " + Math.round(tt.x0);
  }
  if (R.minTerr < R.terrReserve) return "Gel\u00e4ndeabstand nur ~" + Math.floor(R.minTerr / 50) * 50 + " ft bei NM " + Math.round(R.minTerrX) + " (weniger als 300 ft Reserve)";
  if (R.circMin > 1) return "unterwegs kreisend steigen n\u00f6tig (~" + Math.round(R.circMin) + " min)";
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
  if (best.cat === 1) { var bi = issueOf(best); if (bi) out.push("<p><b>Einschr\u00e4nkung:</b> " + esc(bi) + ".</p>"); }
  rs.slice(1).forEach(function (r) {
    var i = issueOf(r);
    out.push("<p><b>" + esc(r.name) + ":</b> " + (i ? (r.cat === 2 ? "nicht empfohlen \u2013 " : "m\u00f6glich, Nachteil: ") + esc(i) : (r.score < best.score ? "geringere Reserven (Wert " + r.score + " statt " + best.score + ")" : "gleichwertig")) +
      (r.D > best.D + 2 ? ", " + Math.round(r.D - best.D) + " NM l\u00e4nger" : "") + ".</p>");
  });
  return "<div class='why'>" + out.join("") + "</div>";
}
