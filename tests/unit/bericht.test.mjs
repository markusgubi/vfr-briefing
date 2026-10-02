// Tests fuer Hinweise: gleichnamige Luftraumteile zusammenfassen, Frequenzen nur aus Daten.
import test from "node:test";
import assert from "node:assert/strict";
import { loadApp } from "./load.mjs";

test("Sektoren und Teilnummern werden zum Grundnamen des Luftraums zusammengefasst.", () => {
  const app = loadApp();
  assert.equal(app.baseName("TMA LOWL 1"), "TMA LOWL");
  assert.equal(app.baseName("TMA LOWL 2"), "TMA LOWL");
  assert.equal(app.baseName("LOWW TMA SECTOR A"), "LOWW TMA");
  assert.equal(app.baseName("CTA LOWW II"), "CTA LOWW");
  assert.equal(app.baseName("LINZ CTR"), "LINZ CTR");
  assert.equal(app.partName("TMA LOWL 2"), "2");
});

const linz = { id: "x", icao: "LOWL", name: "Linz", lat: 48.233, lon: 14.187,
  freq: [{ v: "118.800", n: "LINZ TOWER", t: 14, p: true }, { v: "129.625", n: "LINZ RADAR", t: 0, p: false }] };
function asp(app, name, type, geomAround) {
  const g = { type: "Polygon", coordinates: [[[geomAround.lon - 0.1, geomAround.lat - 0.1], [geomAround.lon + 0.1, geomAround.lat - 0.1],
    [geomAround.lon + 0.1, geomAround.lat + 0.1], [geomAround.lon - 0.1, geomAround.lat + 0.1], [geomAround.lon - 0.1, geomAround.lat - 0.1]]] };
  return { name, type, icaoClass: 3, geometry: g, bb: app.geomBbox(g), freq: [] };
}

test("Für eine Kontrollzone wird die Turmfrequenz des Platzes darin genannt.", () => {
  const app = loadApp();
  app.RES = { apts: [linz] };
  const G = { A: {}, B: {} };
  assert.match(app.unitFreq(asp(app, "LINZ CTR", 4, linz), G), /LINZ TOWER 118\.800/);
});

test("Für eine TMA mit ICAO-Code im Namen wird die Anflug-/Radarfrequenz genannt.", () => {
  const app = loadApp();
  app.RES = { apts: [linz] };
  assert.match(app.unitFreq(asp(app, "TMA LOWL 1", 7, { lat: 48.6, lon: 14.6 }), { A: {}, B: {} }), /LINZ RADAR 129\.625/);
});

test("Ohne verlässliche Daten wird keine Frequenz erfunden.", () => {
  const app = loadApp();
  app.RES = { apts: [] };
  assert.match(app.unitFreq(asp(app, "TMA XYZ", 7, { lat: 47, lon: 13 }), { A: {}, B: {} }), /laut AIP/);
});
