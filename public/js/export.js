"use strict";
function wpAlts(R) {
  return R.wps.map(function (w, k) {
    if (k === R.wps.length - 1) return Math.round(RES.G.destElev);
    return R.legs[k] ? R.legs[k].alt : R.legs[R.legs.length - 1].alt;
  });
}
/* Datei ausgeben. Auf iPhone/iPad ueber das Teilen-Menue (dort "SkyDemon" waehlen), sonst als Download.
   application/octet-stream verhindert, dass Safari ".xml" an den Dateinamen haengt. */
function download(name, text, type, share) {
  var blob = new Blob([text], { type: "application/octet-stream" });
  if (share && typeof File === "function" && navigator.canShare) {
    try {
      var file = new File([blob], name, { type: "application/octet-stream" });
      if (navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: name }).catch(function () {});
        return;
      }
    } catch (e) {}
  }
  var url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
}
function routeFileName(R) { var G = RES.G; return (G.A.icao || "START") + "-" + (G.B.icao || "ZIEL") + "_" + p2(Math.floor(R.depMin / 60) % 24) + p2(Math.round(R.depMin) % 60); }
/* GPX: Hoehe als <ele> (Meter) UND im Wegpunktnamen, da SkyDemon <ele> beim Import ignoriert */
function exportGpx(R, share) {
  var G = RES.G, nm = (G.A.icao || "START") + "-" + (G.B.icao || "ZIEL"), alts = wpAlts(R);
  var s = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="VFR-Briefing 8.3" xmlns="http://www.topografix.com/GPX/1/1">\n<rte><name>' + esc(nm + " " + R.name) + "</name>\n";
  R.wps.forEach(function (w, k) {
    var last = k === R.wps.length - 1, label = last ? w.name : w.name + " " + alts[k] + "FT";
    s += '<rtept lat="' + w.lat.toFixed(5) + '" lon="' + w.lon.toFixed(5) + '"><ele>' + (alts[k] / M2FT).toFixed(0) + "</ele><name>" + esc(label) +
      "</name><desc>" + (last ? "Ziel" : "Reisehoehe ab hier " + alts[k] + " ft MSL") + "</desc></rtept>\n";
  });
  s += "</rte>\n</gpx>\n";
  download(routeFileName(R) + ".gpx", s, "application/gpx+xml", share);
}
function dmsTxt(v, pos, neg, degW) {
  var a = Math.abs(v), d = Math.floor(a), mf = (a - d) * 60, m = Math.floor(mf), sec = Math.round((mf - m) * 6000) / 100;
  if (sec >= 60) { sec = 0; m++; } if (m >= 60) { m = 0; d++; }
  return (v >= 0 ? pos : neg) + String(d).padStart(degW, "0") + p2(m) + (sec < 10 ? "0" : "") + sec.toFixed(2);
}
/* SkyDemon-Flugplan (.flightplan). Aufbau wie eine in SkyDemon gespeicherte Datei:
   PrimaryRoute (Start + Standardhoehe) und je Teilstrecke ein RhumbLineRoute mit Level = Reiseflughoehe
   dieser Teilstrecke in ft. LevelChange "B" = Hoehe vor Beginn der Teilstrecke erreichen (Steigen, z. B.
   wegen Gelaende), "F" = Hoehenwechsel mit Beginn der Teilstrecke (Sinken). */
function skyDemonXml(R) {
  var alts = wpAlts(R);
  function pos(w) { return dmsTxt(w.lat, "N", "S", 2) + " " + dmsTxt(w.lon, "E", "W", 3); }
  function lv(a) { return String(Math.max(0, Math.round(a / 100) * 100)); }
  var s = '<?xml version="1.0" encoding="utf-8"?>\n<DivelementsFlightPlanner>\n  <PrimaryRoute CourseType="GreatCircle" Start="' + pos(R.wps[0]) +
    '" Level="' + lv(alts[0]) + '" Rules="Vfr">\n';
  for (var k = 1; k < R.wps.length; k++) {
    var cur = alts[k - 1], prev = k > 1 ? alts[k - 2] : cur;
    s += '    <RhumbLineRoute To="' + pos(R.wps[k]) + '" Level="' + lv(cur) + '" LevelChange="' + (cur < prev ? "F" : "B") + '" />\n';
  }
  return s + "  </PrimaryRoute>\n</DivelementsFlightPlanner>\n";
}
function exportSkyDemon(R, share) { download(routeFileName(R) + ".flightplan", skyDemonXml(R), "application/octet-stream", share); }
