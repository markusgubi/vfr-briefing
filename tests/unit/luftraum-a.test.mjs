// Luftraum Klasse A ist fuer VFR verboten: nie einplanen, eigene Routen hinein sind KRITISCH.
import test from "node:test";
import assert from "node:assert/strict";
import { loadApp, setup } from "./load.mjs";

function klasseA(app) {
  // Klasse A von 4000 ft MSL bis FL 195 quer ueber der Strecke (lon 13.6-13.8)
  const g = { type: "Polygon", coordinates: [[[13.6, 46.8], [13.8, 46.8], [13.8, 47.2], [13.6, 47.2], [13.6, 46.8]]] };
  return app.normAsp({ _id: "A1", name: "TEST KLASSE A", type: 0, icaoClass: 0, geometry: g,
    lowerLimit: { value: 4000, unit: 1, referenceDatum: 1 }, upperLimit: { value: 195, unit: 6, referenceDatum: 2 } });
}

test("Klasse A wird als verbotener Luftraum eingestuft.", () => {
  const app = loadApp();
  assert.equal(klasseA(app).kind, "forbidden");
});

test("Berechnete Routen fliegen nie in Klasse A (unten durch, Gelände flach).", () => {
  const app = loadApp();
  const { G, P } = setup(app, () => 1000);
  const A = klasseA(app);
  G.AIR = [A];
  G.edges.forEach(e => app.edgeStatic(G, e, G.AIR));
  app.RES = { G, P, apts: [] };
  for (const R of app.computeRoutes(G, P)) {
    assert.ok(!R.entries.some(x => x.inside && x.as.id === "A1"), R.name + " fliegt in Klasse A");
    const unter = R.samples.filter(q => q.lon > 13.58 && q.lon < 13.82);
    assert.ok(unter.every(q => q.p < 4000 - 300 + 1), R.name + ": max " + Math.round(Math.max(...unter.map(q => q.p))));
  }
});

test("Eine eigene Höhe in Klasse A ist KRITISCH mit Begründung.", () => {
  const app = loadApp();
  const { G, P, A: a, B } = setup(app, () => 1000);
  G.AIR = [klasseA(app)];
  app.RES = { G, P, apts: [] };
  const R = app.routeFromPoints(G, P, [a, B], { 0: 6500 });
  assert.equal(R.cat, 2);
  assert.ok(R.conflicts.some(c => c.cause === "forb"));
  assert.match(app.issueOf(R), /TEST KLASSE A.*verboten/);
});
