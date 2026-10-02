// Test fuer den GAFOR-Bonus mit einer erfundenen TEST-Linie (keine echten GAFOR-Daten).
import test from "node:test";
import assert from "node:assert/strict";
import { loadApp, setup } from "./load.mjs";


test("Ohne geprüfte GAFOR-Daten bleibt die Routensuche unverändert.", () => {
  const app = loadApp();
  assert.equal(app.GAFOR, null);
  const { G, P } = setup(app, () => 1000);
  assert.ok(G.edges.every(e => e.gafor === false));
});

test("Eine GAFOR-Strecke neben der Direktlinie zieht die Route in flachem Gelände zu sich.", () => {
  const app = loadApp();
  // Testlinie 4 NM noerdlich parallel zur Strecke (lat 47.0 -> 47.0667)
  app.GAFOR = [{ nr: "T", name: "Test", pts: [{ lat: 47.0667, lon: 12.9 }, { lat: 47.0667, lon: 14.5 }] }];
  const { G, P } = setup(app, () => 1000);
  assert.ok(G.edges.some(e => e.gafor));
  const path = app.bestPath(G, P, 10, app.makeMode(P, 5));
  const R = app.evalRoute(G, P, 10, path, "c0", "");
  const anteil = R.rs.reduce((a, r) => a + (r.e.gafor ? r.e.len : 0), 0) / R.D;
  assert.ok(anteil > 0.5, "Anteil entlang GAFOR: " + anteil.toFixed(2));
});
