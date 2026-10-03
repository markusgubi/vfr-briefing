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
