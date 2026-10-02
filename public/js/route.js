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
