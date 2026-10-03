// Pruefung der hinterlegten GAFOR-Daten (public/data/gafor.geojson).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fc = JSON.parse(readFileSync(new URL("../../public/data/gafor.geojson", import.meta.url), "utf8"));

test("Die GAFOR-Datei enthält alle 48 Strecken der Austro-Control-Karte als Linien mit Bezugshöhe.", () => {
  assert.equal(fc.geprueft, true);
  assert.ok(/ungef/i.test(fc.stand) && fc.genauigkeit, "als ungefähr gekennzeichnet");
  const nrs = fc.features.map(f => f.properties.nr);
  assert.equal(nrs.length, 48);
  assert.equal(new Set(nrs).size, 48, "keine doppelten Nummern");
  for (const f of fc.features) {
    assert.equal(f.geometry.type, "LineString");
    assert.ok(f.geometry.coordinates.length >= 2, f.properties.nr);
    assert.ok(f.properties.bezugshoehe >= 500 && f.properties.bezugshoehe <= 12000, f.properties.nr);
    for (const [lon, lat] of f.geometry.coordinates) assert.ok(lon > 9 && lon < 17.5 && lat > 45.8 && lat < 49.5, f.properties.nr + " " + lon + "," + lat);
  }
});

test("GAFOR-Strecken beginnen und enden an ihren Flugplätzen (z. B. 14 Salzburg – Linz).", () => {
  const f = fc.features.find(x => x.properties.nr === "14").geometry.coordinates;
  const near = (c, lat, lon) => Math.hypot((c[1] - lat) * 60, (c[0] - lon) * 60 * Math.cos(lat * Math.PI / 180)) < 1.5;
  assert.ok(near(f[0], 47.7933, 13.0043), "Start LOWS " + f[0]);
  assert.ok(near(f[f.length - 1], 48.2332, 14.1875), "Ende LOWL " + f[f.length - 1]);
});
