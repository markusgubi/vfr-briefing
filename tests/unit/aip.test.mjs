// Kontaktangaben aus dem AIP-Austria-Auszug (public/data/aip-lo.json, ENR 2.1/2.2).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadApp } from "./load.mjs";

const AIP = JSON.parse(fs.readFileSync(new URL("../../public/data/aip-lo.json", import.meta.url)));
function app() {
  const a = loadApp(); a.AIP_LO = AIP;
  a.APTDB.AT = [{ icao: "LOWS", name: "Salzburg", lat: 47.7933, lon: 13.0043, freq: [{ v: "123.725", n: "SALZBURG RADAR", t: 0, p: true }] }];
  return a;
}
function box(a, name, type, lon, lat, r, loFt) {
  const g = { type: "Polygon", coordinates: [[[lon - r, lat - r], [lon + r, lat - r], [lon + r, lat + r], [lon - r, lat + r], [lon - r, lat - r]]] };
  return { name, type, kind: "clearance", country: "AT", geometry: g, bb: a.geomBbox(g), loFt };
}

test("Die AIP-Daten enthalten alle TMA/CTA aus ENR 2.1 sowie APP- und FIS-Sektoren aus ENR 2.2.", () => {
  assert.equal(Object.keys(AIP.units).length, 39);
  assert.deepEqual(Object.keys(AIP.fis).sort(), ["FIC WIEN APPROACH", "FIC WIEN NORTH", "FIC WIEN SOUTH"]);
  assert.equal(Object.keys(AIP.app).length, 6);
  assert.deepEqual(AIP.freq["FIC WIEN|WIEN INFORMATION"], ["134.625", "124.400"]);
  assert.ok(AIP.units["CTA GLOCKNER"].some(u => u.call === "MÜNCHEN RADAR"));
});

test("CTA GLOCKNER: Wien Radar (ACC) und Wien Information des FIS-Sektors am Ort, Nachbar-ACC genannt.", () => {
  const a = app();
  const f = a.unitFreq(box(a, "CTA GLOCKNER", 26, 13.0, 47.05, 0.1, 14500), null, { lat: 47.05, lon: 13.0 });
  assert.match(f, /WIEN RADAR<\/b> \(ACC/);
  assert.match(f, /WIEN INFORMATION<\/b> 124\.400 <small>\(FIS-Sektor Süd/);
  assert.doesNotMatch(f, /134\.625/);
  assert.match(f, /MÜNCHEN RADAR/);
  assert.match(f, /AIP ENR 2\.1\/2\.2/);
});

test("Eine TMA bei Salzburg bekommt Salzburg Radar mit Betriebszeit aus dem AIP.", () => {
  const a = app();
  const t = box(a, "TMA LOWS 9", 7, 13.0, 47.79, 0.05, 3500);
  t.freq = null;
  const f = a.aipContact(t, null, { lat: 47.79, lon: 13.0 });
  assert.match(f, /SALZBURG RADAR<\/b> 123\.725/);
  assert.match(f, /05:00–22:00 UTC \(Sommer 04:00–21:00\)/);
});

test("RMZ ohne Frequenz in openAIP bekommt die Frequenz aus ENR 2.2.", () => {
  const a = app();
  const r = { ...box(a, "RMZ VOESLAU", 6, 16.25, 47.96, 0.05, 0), kind: "rmz" };
  assert.match(a.unitFreq(r, null, null), /VÖSLAU RADIO<\/b> 118\.605/);
});

test("Ausserhalb Österreichs und ohne Tabelleneintrag liefert der AIP-Auszug nichts.", () => {
  const a = app();
  const x = { ...box(a, "CTA X", 26, 12.0, 45.5, 0.1, 5000), country: "IT" };
  assert.equal(a.aipContact(x, null, { lat: 45.5, lon: 12.0 }), null);
});

test("Wien Information: Nord 134.625, Süd 124.400, Ost/Wien 118.525 je nach FIS-Sektor am Ort.", () => {
  const a = app();
  const at = (lat, lon) => a.aipContact({ ...box(a, "TMA X", 7, lon, lat, 0.02, 2000), name: "TEST AT" }, null, { lat, lon });
  assert.match(at(48.3, 14.0), /WIEN INFORMATION<\/b> 134\.625 <small>\(FIS-Sektor Nord/);   // Linz
  assert.match(at(46.75, 13.0), /WIEN INFORMATION<\/b> 124\.400 <small>\(FIS-Sektor Süd/);   // Oberkärnten
  assert.match(at(47.8, 16.3), /WIEN INFORMATION<\/b> 118\.525 <small>\(FIS-Sektor Ost\/Wien/); // Wr. Neustadt
  assert.match(at(46.7, 14.3), /KLAGENFURT RADAR/);   // im Anflugsektor Klagenfurt: zuerst Klagenfurt Radar
});
