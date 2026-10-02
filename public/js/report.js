"use strict";
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
