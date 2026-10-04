// Bewertung haengt nicht von der Uhrzeit des Ansehens ab: ob ein METAR "aktuell" ist (<= 90 min), wird gegen den
// Zeitpunkt der Berechnung (G.now) geprueft. Sonst bewertete z. B. das spaetere Bearbeiten dieselbe Strecke anders.
import test from "node:test";
import assert from "node:assert/strict";
import { loadApp } from "./load.mjs";

test("Ein zur Berechnungszeit gültiges METAR gilt auch später für dieselbe Planung.", () => {
  const app = loadApp();
  const plan = Date.now() / 1000 - 3 * 3600;   // vor 3 Stunden berechnet
  app.STN = [{ id: "LOWZ", lat: 47.29, lon: 12.79, elevFt: 2470, metar: { t: plan - 1200, visKm: 3, ceil: 800, gust: null }, taf: null }];
  const p = { lat: 47.29, lon: 12.8 };
  const mitPlanzeit = app.officialAt(p, plan + 600, plan);
  assert.ok(mitPlanzeit, "Station gefunden");
  assert.equal(mitPlanzeit.visKm, 3, "METAR zur Planungszeit verwendet");
  const ohne = app.officialAt(p, plan + 600);   // alte Logik: gegen die aktuelle Uhr -> METAR verworfen
  assert.equal(ohne ? ohne.visKm : null, null);
});
