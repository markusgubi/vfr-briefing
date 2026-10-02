"use strict";
function wpAlts(R) {
  return R.wps.map(function (w, k) {
    if (k === R.wps.length - 1) return Math.round(RES.G.destElev);
    return R.legs[k] ? R.legs[k].alt : R.legs[R.legs.length - 1].alt;
  });
}
function download(name, text, type) {
  var url = URL.createObjectURL(new Blob([text], { type: type })), a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
}
/* GPX: Hoehe als <ele> (Meter) UND im Wegpunktnamen, da SkyDemon <ele> beim Import ignoriert */
function exportGpx(R) {
  var G = RES.G, nm = (G.A.icao || "START") + "-" + (G.B.icao || "ZIEL"), alts = wpAlts(R);
  var s = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="VFR-Briefing v7.6" xmlns="http://www.topografix.com/GPX/1/1">\n<rte><name>' + esc(nm + " " + R.name) + "</name>\n";
  R.wps.forEach(function (w, k) {
    var last = k === R.wps.length - 1, label = last ? w.name : w.name + " " + alts[k] + "FT";
    s += '<rtept lat="' + w.lat.toFixed(5) + '" lon="' + w.lon.toFixed(5) + '"><ele>' + (alts[k] / M2FT).toFixed(0) + "</ele><name>" + esc(label) +
      "</name><desc>" + (last ? "Ziel" : "Reisehoehe ab hier " + alts[k] + " ft MSL") + "</desc></rtept>\n";
  });
  s += "</rte>\n</gpx>\n";
  download(nm + "_" + R.id + ".gpx", s, "application/gpx+xml");
}
function dmsTxt(v, pos, neg, degW) {
  var a = Math.abs(v), d = Math.floor(a), mf = (a - d) * 60, m = Math.floor(mf), sec = Math.round((mf - m) * 6000) / 100;
  if (sec >= 60) { sec = 0; m++; } if (m >= 60) { m = 0; d++; }
  return (v >= 0 ? pos : neg) + String(d).padStart(degW, "0") + p2(m) + (sec < 10 ? "0" : "") + sec.toFixed(2);
}
/* SkyDemon-Flugplan (.flightplan) mit Reiseflughoehe je Abschnitt */
function exportSkyDemon(R) {
  var G = RES.G, nm = (G.A.icao || "START") + "-" + (G.B.icao || "ZIEL"), alts = wpAlts(R);
  function pos(w) { return dmsTxt(w.lat, "N", "S", 2) + " " + dmsTxt(w.lon, "E", "W", 3); }
  var s = '<?xml version="1.0" encoding="utf-8"?>\n<DivelementsFlightPlanner>\n  <PrimaryRoute CourseType="GreatCircle" Start="' + pos(R.wps[0]) + '" Level="' + alts[0] + '" Rules="Vfr">\n';
  for (var k = 1; k < R.wps.length; k++) s += '    <RhumbLineRoute To="' + pos(R.wps[k]) + '" Level="' + alts[k - 1] + '" LevelChange="B" />\n';
  s += "  </PrimaryRoute>\n</DivelementsFlightPlanner>\n";
  download(nm + "_" + R.id + ".flightplan", s, "application/xml");
}
