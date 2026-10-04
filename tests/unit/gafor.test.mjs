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

// Kuenstliche Routen fuer die Rangfolge: Anteil auf GAFOR-Teilstrecken, Flugzeit (min), Sicherheitswert
function R(anteil, ete, raw = 90, cat = 0, confLen = 0) {
  return { cat, confLen, rawScore: raw, ete, D: 100, rs: [{ e: { gafor: true, len: 100 * anteil } }, { e: { gafor: false, len: 100 * (1 - anteil) } }] };
}

test("Mit Haken wird die GAFOR-Route genommen, wenn sie höchstens 10 Minuten länger dauert.", () => {
  const app = loadApp();
  app.GAFOR = LINIE; app.GAFOR_ON = true;
  const kurz = R(0, 50), gafor = R(0.9, 59, 87);
  assert.ok(app.rankCmp(gafor, kurz) < 0);
  assert.equal([kurz, gafor].sort(app.rankCmp)[0], gafor);
});

test("Ist der Umweg über GAFOR länger als 10 Minuten, gewinnt die kürzere Route.", () => {
  const app = loadApp();
  app.GAFOR = LINIE; app.GAFOR_ON = true;
  assert.ok(app.rankCmp(R(0.9, 61), R(0, 50)) > 0);
});

test("Auch mit Haken gewinnt GAFOR nie gegen eine bessere Einstufung, weniger Konflikte oder deutlich mehr Sicherheit.", () => {
  const app = loadApp();
  app.GAFOR = LINIE; app.GAFOR_ON = true;
  assert.ok(app.rankCmp(R(0.9, 50, 90, 1), R(0, 55, 60, 0)) > 0);
  assert.ok(app.rankCmp(R(0.9, 50, 90, 0, 2), R(0, 55, 60, 0, 0)) > 0);
  assert.ok(app.rankCmp(R(0.9, 50, 80), R(0, 55, 90)) > 0);
});

test("Ohne Haken zählt bei gleicher Sicherheit nur die Flugzeit.", () => {
  const app = loadApp();
  app.GAFOR = LINIE; app.GAFOR_ON = false;
  assert.ok(app.rankCmp(R(0.9, 59), R(0, 50)) > 0);
});

test("Mit Haken findet die Suche auch eine weiter entfernte GAFOR-Strecke und wählt sie bei kleinem Umweg.", () => {
  const app = loadApp();
  app.GAFOR = [{ nr: "T", name: "Test", pts: [{ lat: 47.15, lon: 12.9 }, { lat: 47.15, lon: 14.5 }] }];   // 9 NM noerdlich
  app.GAFOR_ON = true;
  const { G, P } = setup(app, () => 1000);
  app.RES = { G, P, apts: [] };
  const routes = app.computeRoutes(G, P), best = routes[0];
  const kurz = routes.reduce((a, r) => (r.ete < a.ete ? r : a));
  assert.ok(app.gaforShare(best) > 0.5, "Anteil " + app.gaforShare(best).toFixed(2));
  assert.ok(best.ete <= kurz.ete + 10, best.ete + " vs " + kurz.ete);
});

test("Führt die GAFOR-Route deutlich mehr über hohes Gelände, wird sie trotz Haken nicht bevorzugt.", () => {
  const app = loadApp();
  app.GAFOR = LINIE; app.GAFOR_ON = true;
  const g = R(0.9, 52, 88), k = R(0, 50, 90);
  g.expo = 0.4; k.expo = 0;
  assert.ok(app.rankCmp(g, k) > 0);
});
