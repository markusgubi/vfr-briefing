// Zustaendige Frequenz eines Luftraums (Freigabe anfordern), auch ohne geplante Route.
import test from "node:test";
import assert from "node:assert/strict";
import { loadApp } from "./load.mjs";

function setup() {
  const app = loadApp();
  app.APTDB.AT = [
    { icao: "LOWS", name: "Salzburg", lat: 47.7933, lon: 13.0043, freq: [{ v: "118.100", n: "SALZBURG TOWER", t: 14, p: true }, { v: "123.725", n: "SALZBURG RADAR", t: 0, p: false }] },
    { icao: "LOWG", name: "Graz", lat: 46.9911, lon: 15.4396, freq: [{ v: "118.200", n: "GRAZ TOWER", t: 14, p: true }, { v: "119.300", n: "GRAZ RADAR", t: 0, p: false }] },
    { icao: "LOGG", name: "Punitz-Güssing", lat: 47.1465, lon: 16.3171, freq: [{ v: "123.200", n: "PUNITZ", t: 10, p: true }] }
  ];
  return app;
}
function asp(app, name, type, lon, lat, r = 0.2) {
  const g = { type: "Polygon", coordinates: [[[lon - r, lat - r], [lon + r, lat - r], [lon + r, lat + r], [lon - r, lat + r], [lon - r, lat - r]]] };
  return { name, type, kind: "clearance", geometry: g, bb: app.geomBbox(g) };
}

test("Eine CTR ohne ICAO-Code im Namen bekommt die Turmfrequenz des Platzes mit gleichem Ortsnamen.", () => {
  const app = setup();
  const f = app.unitFreq(asp(app, "SALZBURG CTR", 4, 13.0, 47.8), null);
  assert.match(f, /SALZBURG TOWER 118\.100/);
  assert.match(f, /LOWS/);
});

test("Eine TMA bekommt die Radar-/Anflugfrequenz des Platzes, auch wenn der Name keinen Ort nennt.", () => {
  const app = setup();
  const f = app.unitFreq(asp(app, "TMA 2", 7, 15.44, 46.99), null);
  assert.match(f, /GRAZ RADAR 119\.300/);
});

test("Ohne passenden Platz verweist die Frequenz auf AIP/ICAO-Karte statt etwas zu erfinden.", () => {
  const app = setup();
  const f = app.unitFreq(asp(app, "CTA C", 26, 10.0, 45.0), null);
  assert.match(f, /laut AIP/);
});

function sector(app, name, type, lon, lat, r, lo, hi, freq) {
  const g = { type: "Polygon", coordinates: [[[lon - r, lat - r], [lon + r, lat - r], [lon + r, lat + r], [lon - r, lat + r], [lon - r, lat - r]]] };
  return { name, type, kind: "svc", geometry: g, bb: app.geomBbox(g), loFt: lo, upper: { value: hi, unit: 1, referenceDatum: 1 }, freq };
}

test("Ohne Platz-Frequenz liefert der ACC-Sektor (openAIP), der die CTA an dieser Stelle und Höhe abdeckt, die Frequenz.", () => {
  const app = setup();
  const cta = { ...asp(app, "CTA GLOCKNER", 26, 12.7, 47.1), country: "AT", loFt: 14500 };
  const G = { SVC: [
    sector(app, "WIEN FIS WEST", 33, 12.7, 47.1, 1, 0, 9500, [{ v: "124.400", n: "WIEN INFORMATION" }]),
    sector(app, "WIEN ACC WEST", 27, 12.7, 47.1, 1, 9500, 24500, [{ v: "134.350", n: "WIEN RADAR" }]),
    sector(app, "WIEN ACC OST", 27, 16.0, 48.0, 1, 0, 24500, [{ v: "999.999", n: "FALSCH" }])
  ], FIRS: [] };
  const f = app.unitFreq(cta, G, null);
  assert.match(f, /WIEN RADAR 134\.350/);
  assert.match(f, /ACC-Sektor WIEN ACC WEST/);
});

test("Ohne Sektor greift die FIR-Frequenz, ohne FIR nur die zuständige Stelle mit Namen – keine erfundene Zahl.", () => {
  const app = setup();
  const cta = { ...asp(app, "CTA GLOCKNER", 26, 12.7, 47.1), country: "AT", loFt: 14500 };
  const fir = { ...sector(app, "LOVV FIR", 10, 13.5, 47.5, 3, 0, 66000, [{ v: "124.400", n: "WIEN INFORMATION" }]), kind: "fir" };
  assert.match(app.unitFreq(cta, { SVC: [], FIRS: [fir] }, null), /WIEN INFORMATION 124\.400.*FIR LOVV FIR/);
  const f = app.unitFreq(cta, { SVC: [], FIRS: [] }, null);
  assert.match(f, /Wien Information/);
  assert.match(f, /laut ICAO-Karte/);
  assert.doesNotMatch(f, /\d{3}\.\d/);
});
