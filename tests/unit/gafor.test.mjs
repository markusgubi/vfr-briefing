// GAFOR-Strecken duerfen eine Route nur bevorzugen, wenn sie mindestens genauso sicher ist.
// Erfundene TEST-Linie, keine echten GAFOR-Daten.
import test from "node:test";
import assert from "node:assert/strict";
import { loadApp, setup } from "./load.mjs";

const LINIE = [{ nr: "T", name: "Test", pts: [{ lat: 47.0667, lon: 12.9 }, { lat: 47.0667, lon: 14.5 }] }];   // 4 NM noerdlich

test("Ohne geprüfte GAFOR-Daten bleibt die Routensuche unverändert.", () => {
  const app = loadApp();
  assert.equal(app.GAFOR, null);
  const { G } = setup(app, () => 1000);
  assert.ok(G.edges.every(e => e.gafor === false));
});

test("Die normale Routensuche wird von GAFOR nicht beeinflusst.", () => {
  const app = loadApp();
  app.GAFOR = LINIE;
  const { G, P } = setup(app, () => 1000);
  const ohne = app.bestPath(G, P, 10, app.makeMode(P, 5));
  app.GAFOR = null;
  const { G: G2 } = setup(app, () => 1000);
  assert.deepEqual(ohne, app.bestPath(G2, P, 10, app.makeMode(P, 5)));
});

test("Ohne Haken bei \"GAFOR-Strecken bevorzugen\" hat GAFOR keinen Einfluss auf die Wahl.", () => {
  const app = loadApp();
  app.GAFOR = LINIE; app.GAFOR_ON = false;
  const { G, P } = setup(app, () => 1000);
  app.RES = { G, P, apts: [] };
  const best = app.computeRoutes(G, P)[0];
  assert.ok(app.gaforShare(best) < 0.2, "Anteil " + app.gaforShare(best).toFixed(2));
});

test("Mit Haken wird bei gleicher Sicherheit die Route entlang der GAFOR-Strecke gewählt.", () => {
  const app = loadApp();
  app.GAFOR = LINIE; app.GAFOR_ON = true;
  const { G, P } = setup(app, () => 1000);
  app.RES = { G, P, apts: [] };
  const best = app.computeRoutes(G, P)[0];
  assert.ok(app.gaforShare(best) > 0.5, "Anteil " + app.gaforShare(best).toFixed(2));
});

test("Ist die GAFOR-Strecke weniger sicher, wird sie auch mit Haken nicht gewählt.", () => {
  const app = loadApp();
  app.GAFOR = LINIE; app.GAFOR_ON = true;
  // Gebirge 7000 ft entlang der GAFOR-Linie (noerdlich), Direktlinie flach
  const { G, P } = setup(app, () => 1000);
  const elev = app.elevFt;
  app.elevFt = (lat, lon) => (lat > 47.035 ? 7000 : elev(lat, lon));
  G.edges.forEach(e => app.edgeStatic(G, e, []));
  G.polyCache = {};
  app.RES = { G, P, apts: [] };
  const best = app.computeRoutes(G, P)[0];
  /* die Route bleibt im flachen Teil (Talflug neben dem Gebirge ist erlaubt, nie darueber) */
  assert.ok(best.samples.every(q => q.tc < 2000), "ueber dem Gebirge: " + best.samples.filter(q => q.tc >= 2000).length);
  assert.ok(best.maxAlt < 7000, "Hoehe " + best.maxAlt);
  assert.equal(best.cat, 0);
});
