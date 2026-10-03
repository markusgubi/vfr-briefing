"use strict";
/* ==================== 12. Details je Route ==================== */
function finalize(R, G, P) {
  if (R.final) return;
  R.final = true;
  G = R.G || G;
  R.coords = [[G.A.lat, G.A.lon]].concat(R.rs.map(function (r) { var n = G.nodes[r.e.b]; return [n.lat, n.lon]; }));
  var D = R.D;
  /* Wegpunkte & Navigationslog */
  var wps = [{ lat: G.A.lat, lon: G.A.lon, name: G.A.icao || "START", x: 0, t: R.depMin }];
  for (var k = 1; k < R.rs.length; k++) {
    var a = R.rs[k - 1], b = R.rs[k], turn = Math.abs(((b.e.crs - a.e.crs + 540) % 360) - 180);
    var nn = G.nodes[b.e.a];
    if (nn.uw != null || turn >= 4 || a.alt !== b.alt) {
      var up = nn.uw != null && R.pts ? R.pts[nn.uw] : null;
      wps.push({ lat: nn.lat, lon: nn.lon, name: up && up.name ? up.name : "WP" + wps.length, x: b.x0, t: b.tStart, uw: nn.uw, pi: nn.pi, rp: up ? up.rp : null, border: up ? up.border : null, town: up ? up.town : null, lm: up ? up.lm : null });
    }
  }
  wps.push({ lat: G.B.lat, lon: G.B.lon, name: G.B.icao || "ZIEL", x: D, t: R.arrMin });
  /* Ortsnamen (GeoNames) an Wegpunkten: erleichtert Positionsmeldungen ("ueber Gmunden") */
  wps.forEach(function (w, k) {
    if (k === 0 || k === wps.length - 1 || w.rp || w.town) return;
    var t = nearestPlace(G.PLACES, w, 3); if (t) w.town = t.name;
  });
  R.wps = wps;
  R.legs = [];
  for (k = 1; k < wps.length; k++) {
    var w0 = wps[k - 1], w1 = wps[k];
    var es = R.rs.filter(function (r) { return r.x0 >= w0.x - 1e-6 && r.x1 <= w1.x + 1e-6; });
    var tc = courseDeg(w0, w1), wind = vecMean(es.map(function (r) { return r.wind; })), g = gsCalc(P.tas, tc, wind);
    var dist = es.reduce(function (s, r) { return s + r.e.len; }, 0);
    var mins = es.length ? es[es.length - 1].tEnd - es[0].tStart : 0;
    R.legs.push({ from: (w0.border ? "\u2691 " : "") + w0.name + (w0.town && w0.town !== w0.name ? " \u00b7 " + w0.town : ""),
      to: (w1.border ? "\u2691 " : "") + w1.name + (w1.town && w1.town !== w1.name ? " \u00b7 " + w1.town : ""), tc: tc, mc: tc - MAGVAR, mh: tc + g.wca - MAGVAR, dist: dist, alt: es.length ? es[0].alt : 0,
      wind: wind, gs: mins > 0 ? dist / (mins / 60) : g.gs, mins: mins, eto: k === wps.length - 1 ? R.arrMin : w1.t,
      cat: Math.max.apply(null, es.map(function (r) { return r.cat; }).concat([0])) });
  }
  /* Hinweise (mit Streckenbereich -> anklickbar) */
  var H = [];
  function add(l, txt, x0, x1) { H.push({ l: l, t: txt, x0: x0 == null ? null : x0, x1: x1 == null ? x0 : x1 }); }
  var now = new Date(), isToday = P.date === now.getFullYear() + "-" + p2(now.getMonth() + 1) + "-" + p2(now.getDate());
  if (isToday && R.depMin < now.getHours() * 60 + now.getMinutes() - 10) add("warn", "Abflugzeit liegt in der Vergangenheit.");
  if (D > 250 || R.ete > 180) add("warn", "<b>Lange Strecke:</b> " + Math.round(D) + " NM, ~" + Math.floor(R.ete / 60) + " h " + p2(Math.round(R.ete % 60)) +
    " min Flugzeit. Kraftstoff inkl. Reserve und eine m\u00f6gliche Zwischenlandung selbst pr\u00fcfen." +
    (G.demZ && G.demZ < 10 ? " Gel\u00e4nde wird hier gr\u00f6ber gerechnet (gr\u00f6\u00dferer Sicherheitspuffer)." : ""));
  R.conflicts.forEach(function (c) {
    if (c.cause === "forb") return;   /* steht als eigener Luftraum-Hinweis */
    var rng = " <small>\u2013 NM " + Math.round(c.x0) + (Math.round(c.x1) > Math.round(c.x0) ? "\u2013" + Math.round(c.x1) : "") + " (~" + fmtH(sampleAt(R, c.x0).t) + ")</small>";
    if (c.cause === "climb") add("bad", "<b>Steigflug reicht nicht:</b> Mit " + P.climb + " ft/min ist das Gel\u00e4nde nicht sicher zu \u00fcbersteigen (Abstand nur ~" +
      fmtFt(Math.max(0, c.clr)) + " ft). Kein Kreisen \u00fcber dem Startplatz eingeplant \u2013 andere Route/Talweg w\u00e4hlen oder Steigleistung pr\u00fcfen." + rng, c.x0, c.x1);
    else if (c.cause === "desc") add("bad", "<b>Sinkflug reicht nicht:</b> Mit " + P.desc + " ft/min ist vom Gel\u00e4nde vor dem Ziel aus kein gleichm\u00e4\u00dfiger Sinkflug bis zum Platz m\u00f6glich (Abstand nur ~" +
      fmtFt(Math.max(0, c.clr)) + " ft). Kein Sinken im Vollkreis \u00fcber dem Platz eingeplant \u2013 Anflug \u00fcber das Tal w\u00e4hlen oder Sinkrate pr\u00fcfen." + rng, c.x0, c.x1);
    else if (c.cause === "low") add("bad", "<b>Eigene H\u00f6he zu tief:</b> Gel\u00e4ndeabstand nur ~" + fmtFt(Math.max(0, c.clr)) + " ft." + rng, c.x0, c.x1);
    else if (c.cause === "cloud") add("bad", "<b>In/an den Wolken:</b> geplante H\u00f6he liegt an oder \u00fcber der Wolkenbasis." + rng, c.x0, c.x1);
    else add("bad", "<b>Kein sicherer H\u00f6henkorridor:</b> " + CAUSE[c.cause] + rng, c.x0, c.x1);
  });
  if (!(R.tight || []).length && R.minTerr < R.terrReserve) add("warn", "<b>Geringe Gel\u00e4ndereserve:</b> ~" + Math.floor(R.minTerr / 50) * 50 + " ft \u00fcber Gel\u00e4nde bei NM " +
    Math.round(R.minTerrX) + " \u2013 weniger als 300 ft Reserve \u00fcber dem eingestellten Mindestabstand (" + P.terrClr + " ft). Fr\u00fch steigen oder Strecke anpassen.", R.minTerrX - 1, R.minTerrX + 1);
  /* Eigene Hoehen: ueber Max. Hoehe? Mit der Steigrate (rechtzeitig) erreichbar? */
  if (R.userAlt) Object.keys(R.userAlt).forEach(function (l) {
    var a = R.userAlt[l], rs = R.rs.filter(function (r) { return r.e.leg === +l; });
    if (!rs.length) return;
    var x0 = rs[0].x0, x1 = rs[rs.length - 1].x1, n = +l + 1;
    if (a > P.maxAlt) add("warn", "<b>Eigene H\u00f6he " + a + " ft</b> (Teilstrecke " + n + ") liegt \u00fcber der eingestellten Max. H\u00f6he von " + P.maxAlt + " ft.", x0, x1);
    var hit = R.samples.filter(function (q) { return q.x >= x0 - 1e-6 && q.x <= x1 + 1e-6 && Math.abs(q.p - a) <= 1; })[0];
    var inLeg = R.samples.filter(function (q) { return q.x >= x0 - 1e-6 && q.x <= x1 + 1e-6; });
    var above = inLeg.length && inLeg.every(function (q) { return q.p > a + 1; });
    if (!hit && above) add("warn", "<b>Eigene H\u00f6he " + a + " ft</b> (Teilstrecke " + n + ") wird nicht erreicht: Mit " + P.desc + " ft/min Sinken und " + P.climb +
      " ft/min Steigen geht das hier nicht \u2013 f\u00fcr das Gel\u00e4nde bzw. die H\u00f6he danach muss rechtzeitig wieder gestiegen werden. Geflogen wird mindestens ~" +
      fmtFt(Math.min.apply(null, inLeg.map(function (q) { return q.p; }))) + " ft.", x0, x1);
    else if (!hit) add("warn", "<b>Eigene H\u00f6he " + a + " ft</b> (Teilstrecke " + n + ") wird mit " + P.climb + " ft/min nicht erreicht \u2013 Teilstrecke zu kurz oder H\u00f6he zu hoch.", x0, x1);
    else if (hit.x > x0 + 1) add("info", "Eigene H\u00f6he " + a + " ft (Teilstrecke " + n + ") wird erst bei NM " + Math.round(hit.x) + " erreicht (Steigrate " + P.climb + " ft/min).", x0, hit.x);
  });
  (R.tight || []).forEach(function (t) {
    add("warn", "<b>" + (t.climb ? "Steigflug knapp" : t.desc ? "Sinkflug knapp" : "Gel\u00e4ndeabstand knapp") + ":</b> nur ~" + fmtFt(Math.max(0, t.clr)) + " ft \u00fcber Gel\u00e4nde (Soll " + P.terrClr +
      " ft)" + (t.climb ? " bei " + P.climb + " ft/min \u2013 fr\u00fch und z\u00fcgig steigen, Talmitte fliegen" : t.desc ? " \u2013 erst nach dem Gel\u00e4nde sinken, Talmitte fliegen" : "") +
      " <small>\u2013 NM " + Math.round(t.x0) + (Math.round(t.x1) > Math.round(t.x0) ? "\u2013" + Math.round(t.x1) : "") + "</small>", t.x0, t.x1);
  });
  if (G.sun) {
    var ecetT = fmtH(G.sun.destEcet * 60), setT = fmtH(G.sun.destSet * 60);
    if (R.dawn) add("bad", "<b>Abflug " + fmtH(R.depMin) + " vor BCMT</b> (" + fmtH(G.sun.depBcmt * 60) + ", Beginn b\u00fcrgerliche D\u00e4mmerung) \u2013 Nacht, nur mit NVFR-Berechtigung.");
    else if (R.early) add("warn", "Abflug " + fmtH(R.depMin) + " vor Sonnenaufgang (" + fmtH(G.sun.depRise * 60) + ") \u2013 D\u00e4mmerung, Sicht/Gel\u00e4nde besonders beachten.");
    if (R.night) add("bad", "<b>Ankunft " + fmtH(R.arrMin) + " nach ECET</b> (" + ecetT + " am Ziel, Ende b\u00fcrgerliche D\u00e4mmerung) \u2013 Nacht, nur mit NVFR-Berechtigung. Fr\u00fcher starten.", D);
    else if (R.dusk) add("warn", "<b>Ankunft " + fmtH(R.arrMin) + "</b> " + (R.arrMin / 60 > G.sun.destSet ? "nach Sonnenuntergang (" + setT + ")" : "weniger als 30 min vor Sonnenuntergang (" + setT + ")") +
      " \u2013 ECET am Ziel " + ecetT + ". D\u00e4mmerung, wenig Reserve.", D);
  }
  R.circles.forEach(function (c) {
    add("warn", "<b>Kreisend steigen</b> bei NM " + Math.round(c.x) + " (~" + fmtH(sampleAt(R, c.x).t) + ") von ~" + fmtFt(c.from) + " auf ~" + (Math.ceil(c.to / 100) * 100) +
      " ft MSL (~" + Math.round(c.min) + " min) \u2013 das Gel\u00e4nde danach steigt schneller als der Steigflug. Nachteil: Zeit, Platzbedarf im Tal.", c.x - 0.5, c.x + 0.5);
  });
  /* Wind bei Start und Landung mit Pistenempfehlung */
  [[R.depWind, "Start", G.A, R.depMin], [R.landWind, "Landung", G.B, R.arrMin]].forEach(function (x) {
    var w = x[0]; if (!w) return;
    var ap = esc(x[2].icao || x[2].name), wtxt = (w.wd === "VRB" ? "VRB" : p3(Math.round(w.wd / 10) * 10 % 360 || 360) + "\u00b0") + "/" + Math.round(w.ws) + (w.gust && w.gust > w.ws + 2 ? " G" + Math.round(w.gust) : "") + " kt";
    var h = "<b>" + x[1] + " " + ap + " ~" + fmtH(x[3]) + ":</b> Wind " + wtxt + " (" + esc(w.src) + ")";
    if (w.rwy) {
      h += " \u2192 <b>Piste " + esc(w.rwy.d) + "</b>: " + (w.head >= 0 ? "Gegenwind " + Math.round(w.head) : "R\u00fcckenwind " + Math.round(-w.head)) + " kt, Seitenwind " +
        Math.round(w.cross) + " kt " + w.side + (w.crossG > w.cross + 1 ? " (in B\u00f6en " + Math.round(w.crossG) + " kt)" : "") + (w.rwy.tmp ? " \u2013 Piste laut openAIP zeitweise gesperrt" : "") + ".";
      if (w.level === 2) h += " <b>Seitenwind \u00fcber deiner Grenze (" + R.xwMax + " kt)</b> \u2013 " + (w.evalCross > w.cross + 1 ? "laut Modellen bis ~" + Math.round(w.evalCross) + " kt. " : "") + "Ausweichplatz oder andere Zeit w\u00e4hlen.";
      else if (w.level === 1) h += w.evalTail > 5 ? " R\u00fcckenwind auf allen Pisten \u2013 Pistenwahl und Landestrecke pr\u00fcfen." : " In B\u00f6en \u00fcber deiner Seitenwind-Grenze (" + R.xwMax + " kt).";
    } else h += " \u2013 Pistenrichtung in openAIP nicht vorhanden, Piste selbst w\u00e4hlen.";
    add(w.level === 2 ? "bad" : w.level === 1 ? "warn" : "info", h, x[1] === "Start" ? 0 : D, x[1] === "Start" ? 0 : D);
  });
  var o2min = 0, hiAlt = 0;
  for (var oi = 1; oi < R.samples.length; oi++) { var qo = R.samples[oi]; hiAlt = Math.max(hiAlt, qo.p); if (qo.p > 10000) o2min += qo.t - R.samples[oi - 1].t; }
  if (hiAlt > 13000) add("bad", "<b>Sauerstoff:</b> Route f\u00fchrt \u00fcber 13.000 ft \u2013 dort ist Sauerstoff Pflicht (EASA NCO.OP.190).");
  else if (o2min > 30) add("warn", "<b>Sauerstoff:</b> ~" + Math.round(o2min) + " min \u00fcber 10.000 ft \u2013 ab 30 min ist Sauerstoff Pflicht (EASA NCO.OP.190). Max. H\u00f6he auf 10.000 ft senken oder Sauerstoff mitf\u00fchren.");
  else if (o2min > 0) add("info", "~" + Math.round(o2min) + " min \u00fcber 10.000 ft (unter 30 min ohne Sauerstoff zul\u00e4ssig) \u2013 auf Hypoxie-Anzeichen achten.");
  if ((R.steep || []).length) {   /* ein Hinweis fuer alle steilen Stuecke */
    var st0 = R.steep[0].x0, st1 = R.steep[R.steep.length - 1].x1, stF = Math.max.apply(null, R.steep.map(function (q) { return q.fpm; }));
    add(stF > P.desc * 1.5 ? "warn" : "info", "<b>Steiler Sinkflug</b> zum Ziel: bis ~" + Math.round(stF / 50) * 50 + " ft/min (eingestellt " + P.desc + ") \u2013 das Gel\u00e4nde vor dem Platz erlaubt erst sp\u00e4t zu sinken." +
      " <small>\u2013 NM " + Math.round(st0) + "\u2013" + Math.round(st1) + "</small>", st0, st1);
  }
  if (R.tod && R.tod.x < D - 0.5) add("info", "<b>Sinkflugbeginn</b> bei NM " + Math.round(R.tod.x) + " (~" + fmtH(R.tod.t) + ") aus ~" + fmtFt(R.tod.p) +
    " ft" + ((R.steep || []).length ? "" : ", gleichm\u00e4\u00dfig mit " + P.desc + " ft/min") + " bis zum Platz (" + fmtFt(G.destElev) + " ft).", R.tod.x, D);
  /* Luftraeume: gleichnamige Teile (z. B. mehrere "TMA LOWL"-Sektoren) werden zu einem Hinweis zusammengefasst */
  var groups = [], gidx = {};
  R.entries.forEach(function (x) {
    var key = x.as.kind + "|" + (x.inside ? "E" : "B") + "|" + baseName(x.as.name), g = gidx[key];
    if (!g) { g = gidx[key] = { key: key, items: [], x0: x.x0, x1: x.x1, t0: x.t0, lo: x.lo, hi: x.hi, alt: x.alt, inside: x.inside, as: x.as }; groups.push(g); }
    g.items.push(x); g.x0 = Math.min(g.x0, x.x0); g.x1 = Math.max(g.x1, x.x1); g.lo = Math.min(g.lo, x.lo); g.hi = Math.max(g.hi, x.hi); g.alt = Math.max(g.alt, x.alt);
    if (x.t0 < g.t0) g.t0 = x.t0;
  });
  groups.sort(function (p, q) { return p.x0 - q.x0; });
  groups.forEach(function (g) {
    var a = g.as, multi = g.items.length > 1;
    var nm = "<b>" + esc(multi ? baseName(a.name) : a.name) + "</b>" + (multi ? " <small>(" + g.items.length + " Teile: " + esc(g.items.map(function (i) { return partName(i.as.name); }).join(", ")) + ")</small>" : "");
    var lim = multi ? "~" + fmtFt(g.lo) + " – " + fmtFt(g.hi) + " ft MSL" : fmtLimit(a.lower) + " – " + fmtLimit(a.upper);
    var where = "NM " + Math.round(g.x0) + " (~" + fmtH(g.t0) + ")";
    var reqX = Math.max(0, g.x0 - 10), req = reqX < 1 ? "direkt nach dem Start" : "spätestens bei NM " + Math.round(reqX) + " (~" + fmtH(sampleAt(R, reqX).t) + ")";
    var at = actTxt(a), atx = at ? " <b>" + at + "</b> – NOTAM/FIS prüfen." : "";
    var fq = unitFreq(a, G);
    if (!g.inside) { if (a.kind === "clearance") add("info", "Unter " + nm + " bleiben: Untergrenze ~" + fmtFt(g.lo) + " ft MSL, geplant bis " + fmtFt(g.alt) + " ft.", g.x0, g.x1); return; }
    if (a.kind === "forbidden") add("bad", nm + " (" + (TYPE_TXT[a.type] || clsTxt(a)) + ", " + lim + ") wird bei " + where + " berührt – so nicht zulässig." + atx, g.x0, g.x1);
    else if (a.kind === "clearance") {
      if (g.x0 < 0.6) add("warn", "<b>Freigabe Abflug</b> aus " + nm + " (" + clsTxt(a) + ", " + lim + "): vor dem Rollen einholen" + fq + ".", g.x0, g.x1);
      else if (g.x0 < 5) add("warn", "<b>Freigabe vor dem Abflug anfordern:</b> " + nm + " (" + clsTxt(a) + ", " + lim + ") wird schon bei " + where + " erreicht" + fq + ".", g.x0, g.x1);
      else if (g.x1 > D - 0.6) add("warn", "<b>Freigabe Ziel</b> " + nm + " (" + clsTxt(a) + ", " + lim + "): " + req + " anfordern, Einflug über Pflichtmeldepunkt laut Sichtanflugkarte" + fq + ".", g.x0, g.x1);
      else add("warn", "<b>Freigabe</b> " + nm + " (" + clsTxt(a) + ", " + lim + "): Einflug bei " + where + " – " + req + " anfordern" + fq + ".", g.x0, g.x1);
    } else if (a.kind === "danger" || a.kind === "tra") add("warn", "Durchflug " + nm + " (" + (TYPE_TXT[a.type] || "") + ", " + lim + ") ab " + where + ":" + (atx || " Aktivierung per NOTAM/FIS prüfen."), g.x0, g.x1);
    else if (a.kind === "tmz") add("info", nm + " ab " + where + ": Transponder (Mode S, ALT) einschalten.", g.x0, g.x1);
    else if (a.kind === "rmz") add("info", nm + " ab " + where + ": Funkkontakt/Hörbereitschaft erforderlich" + fq + ".", g.x0, g.x1);
    else if (a.type === 19 || a.type === 29 || a.type === 21) add("info", nm + " (" + TYPE_TXT[a.type] + ") ab " + where + ": Auflagen/Mindesthöhen laut AIP beachten." + atx, g.x0, g.x1);
  });
  /* Grenzuebertritte (immer anzeigen) und Meldepunkte */
  R.crossings = detectCrossings(R, G);
  R.crossings.forEach(function (c) {
    var wp = (R.wps || []).filter(function (w) { return w.border && Math.abs(w.x - c.x) < 6; })[0];
    var via = wp ? (wp.rp ? " über Meldepunkt <b>" + esc(wp.name) + "</b>" + (wp.rp.compulsory ? " (Pflichtmeldepunkt)" : "") : " über <b>" + esc(wp.name) + "</b>") : "";
    var ff = c.to && c.to.freq && c.to.freq.length ? " – " + esc(c.to.name) + ": " + c.to.freq.map(function (f) { return esc(f.v) + (f.n ? " " + esc(f.n) : ""); }).join(", ") : "";
    add("warn", "<b>Grenzübertritt " + esc(c.fromC || "?") + " → " + esc(c.toC || "?") + "</b> bei NM " + Math.round(c.x) + " (~" + fmtH(c.t) + ")" + via +
      ". Flugplan und Grenzformalitäten laut AIP prüfen (SERA.4001), FIS-Wechsel" + (ff || " – Frequenz laut AIP/ICAO-Karte") + ".", c.x - 1, c.x + 1);
  });
  (R.wps || []).forEach(function (w) {
    if (w.rp && !w.border) add("info", "Anflug über Meldepunkt <b>" + esc(w.name) + "</b>" + (w.rp.compulsory ? " (Pflichtmeldepunkt)" : "") + " bei NM " + Math.round(w.x) + " – Verfahren laut Sichtanflugkarte (AIP AD 2).", w.x, w.x);
  });
  (R.rpNotes || []).forEach(function (n) {
    if (n === "norp") add("warn", "Kein veröffentlichter Meldepunkt (openAIP) innerhalb " + BORDER_RP_NM + " NM und kein Ort innerhalb " + BORDER_TOWN_NM + " NM vom Grenzübertritt – Übertrittspunkt laut AIP/VFR-Karte wählen.");
    if (n.indexOf("town:") === 0) add("info", "Grenzübertritt über den Ort <b>" + esc(n.slice(5)) + "</b> – Positionsmeldung an FIS mit Ortsangabe, Übertritt laut AIP prüfen.");
    if (n.indexOf("rpworse:") === 0) add("info", "Meldepunkt <b>" + esc(n.slice(8)) + "</b> nahe am Grenzübertritt nicht übernommen: die Route darüber wäre weniger sicher. Übertritt auf der Linie, Verfahren laut AIP prüfen.");
    if (n.indexOf("townworse:") === 0) add("info", "Grenzort <b>" + esc(n.slice(10)) + "</b> nicht übernommen: die Route darüber wäre weniger sicher. Übertritt auf der Linie, Positionsmeldung mit Ortsangabe.");
    if (n === "nodest") add("warn", "Kein Meldepunkt für " + esc(G.B.icao || G.B.name) + " in openAIP gefunden – Anflug laut Sichtanflugkarte (AIP AD 2) planen.");
  });
  if (G.rpFailed && G.rpFailed.length) add("warn", "Meldepunkte für " + G.rpFailed.join(", ") + " nicht geladen – Grenzübertritt/Anflug laut AIP planen.");
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
  if (R.airMissing && R.airMissing.length) add("bad", "<b>Keine Luftraumdaten</b> f\u00fcr Teile dieser Route (Land nicht abgedeckt oder noch nicht geladen) \u2013 ohne Luftraumpr\u00fcfung gilt die Route als KRITISCH.", R.airMissing[0]);
  if (R.wxFar && R.wxFar.length) add("warn", "Wetterdaten f\u00fcr Teile dieser Route nur von bis zu " + Math.round(Math.max.apply(null, R.wxFar.map(function (w) { return w.d; }))) +
    " NM entfernten Punkten \u2013 werden nachgeladen.", R.wxFar[0].x);
  if (G.airFailed && G.airFailed.length) add("bad", "Luftraumdaten f\u00fcr " + G.airFailed.join(", ") + " fehlen \u2013 Lufträume dort NICHT gepr\u00fcft!");
  add("info", "Tempor\u00e4re Luftraumbeschr\u00e4nkungen und Aktivierungen per NOTAM sind nicht enthalten \u2013 NOTAM vor dem Flug pr\u00fcfen.");
  var ord = { bad: 0, warn: 1, info: 2, ok: 3 };
  H.sort(function (a, b) { return ord[a.l] - ord[b.l]; });
  R.hints = H;
  R.gaforPct = GAFOR ? Math.round(100 * R.rs.reduce(function (a, r) { return a + (r.e.gafor ? r.e.len : 0); }, 0) / Math.max(1, R.D)) : null;
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

/* Grundname eines Luftraums ohne Sektor-/Teilbezeichnung: "TMA LOWL 1" -> "TMA LOWL", "LOWW TMA SECTOR A" -> "LOWW TMA" */
function baseName(n) {
  var s = String(n || "").toUpperCase().replace(/\s+/g, " ").trim();
  s = s.replace(/\s*\b(SECTOR|SEKTOR|SECT|SEC|PART|TEIL)\b.*$/, "");
  for (var k = 0; k < 2; k++) s = s.replace(/[\s\-_/]+([0-9]{1,2}[A-Z]?|[A-H]|[IVX]{1,4})$/, "");
  return s.trim() || String(n || "");
}
function partName(n) { var b = baseName(n), s = String(n || "").toUpperCase().replace(/\s+/g, " ").trim(); return s.indexOf(b) === 0 ? (s.slice(b.length).trim() || s) : s; }
/* Zustaendige Stelle und Frequenz NUR aus Daten: Frequenzen des Luftraums, sonst des zugehoerigen Platzes
   (ICAO-Code im Luftraumnamen oder Platz innerhalb einer CTR). Sonst Verweis auf AIP/ICAO-Karte. */
var FQ_TWR = [14], FQ_APP = [0, 13, 2, 6];
function aptForAsp(as, G) {
  var apts = (RES && RES.apts) || [], all = apts.concat([G.A, G.B]), name = String(as.name || "").toUpperCase();
  var codes = name.match(/\b[A-Z]{4}\b/g) || [];
  for (var k = 0; k < codes.length; k++) { var hit = all.filter(function (a) { return a && a.icao === codes[k]; })[0]; if (hit) return hit; }
  if (as.type === 4 || as.type === 13) {
    var inside = all.filter(function (a) { return a && a.icao && inBox(a, as.bb) && inGeom(as.geometry, a.lon, a.lat); });
    inside.sort(function (a, b) { return ((b.freq || []).length - (a.freq || []).length); });
    if (inside.length) return inside[0];
  }
  return null;
}
function pickFreq(list, types, re) {
  var l = list.filter(function (f) { return types.indexOf(f.t) >= 0 || re.test(f.n); });
  l.sort(function (a, b) { return (b.p - a.p); });
  return l;
}
function unitFreq(as, G) {
  function fmt(l) { return l.slice(0, 2).map(function (f) { return (f.n ? esc(f.n) + " " : "") + esc(f.v); }).join(" / "); }
  if (as.freq && as.freq.length) return " – " + fmt(as.freq.map(function (f) { return { v: f.v, n: f.n || as.name }; }));
  var ap = aptForAsp(as, G);
  if (ap && ap.freq && ap.freq.length) {
    var isCtr = as.type === 4 || as.type === 13;
    var l = isCtr ? pickFreq(ap.freq, FQ_TWR, /TOWER|TWR/i) : pickFreq(ap.freq, FQ_APP, /APP|RADAR|APPROACH|DIRECTOR|ARR|DEP/i);
    if (!l.length && !isCtr) l = pickFreq(ap.freq, FQ_TWR, /TOWER|TWR/i);
    if (l.length) return " – " + fmt(l) + " <small>(openAIP, " + esc(ap.icao || ap.name) + ")</small>";
  }
  return " (Frequenz laut AIP/ICAO-Karte)";
}
