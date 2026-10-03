// Tests fuer frei gezogene Routen (routeFromPoints) und selbst gesetzte Hoehen je Teilstrecke.
import test from "node:test";
import assert from "node:assert/strict";
import { loadApp, setup } from "./load.mjs";

const gebirge = x => (x > 20 && x < 35 ? 7000 : 1000);

test("Eine gerade gezogene Route wird wie die Direktstrecke bewertet.", () => {
  const app = loadApp();
  const { G, P, A, B } = setup(app, gebirge);
  const direkt = app.evalRoute(G, P, 10, app.directPath(G), "direct", "Direkt");
  const eigen = app.routeFromPoints(G, P, [A, B], null);
  assert.equal(eigen.cat, direkt.cat);
  assert.ok(Math.abs(eigen.D - direkt.D) < 0.5);
  assert.ok(Math.abs(eigen.maxAlt - direkt.maxAlt) < 300);
});

test("Eine Route mit Zwischenpunkt hat zwei Teilstrecken und den Punkt im Navigationslog.", () => {
  const app = loadApp();
  const { G, P, A, B } = setup(app, gebirge);
  const M = { lat: 47.15, lon: 13.7, name: "MITTE" };
  const R = app.routeFromPoints(G, P, [A, M, B], null);
  assert.deepEqual([...new Set(R.rs.map(r => r.e.leg))], [0, 1]);
  app.RES = { apts: [] };
  app.finalize(R, G, P);
  assert.ok(R.wps.some(w => w.name === "MITTE"));
});

test("Eine selbst gesetzte Höhe unter dem Gelände wird als Konflikt markiert.", () => {
  const app = loadApp();
  const { G, P, A, B } = setup(app, gebirge);
  const R = app.routeFromPoints(G, P, [A, B], { 0: 5000 });
  assert.equal(R.cat, 2);
  assert.ok(R.conflicts.some(c => c.cause === "low"), JSON.stringify(R.conflicts));
  assert.ok(R.rs.every(r => r.user && r.alt === 5000));
});

test("Eine selbst gesetzte Höhe in den Wolken wird als Konflikt markiert.", () => {
  const app = loadApp();
  const { G, P, A, B } = setup(app, () => 1000, { base: 5000 });
  const R = app.routeFromPoints(G, P, [A, B], { 0: 6500 });
  assert.ok(R.conflicts.some(c => c.cause === "cloud"), JSON.stringify(R.conflicts));
  assert.equal(R.cat, 2);
});

test("Eine passende selbst gesetzte Höhe ergibt eine gute Route.", () => {
  const app = loadApp();
  const { G, P, A, B } = setup(app, () => 1000);
  const R = app.routeFromPoints(G, P, [A, B], { 0: 3500 });
  assert.equal(R.conflicts.length, 0);
  assert.equal(R.cat, 0);
});

test("Eine selbst gesetzte Höhe auf der letzten Teilstrecke wird geflogen, nicht vom Sinkflug überstimmt.", () => {
  const app = loadApp();
  const { G, P, A, B } = setup(app, () => 1000);
  const M = { lat: 47.0, lon: 13.7, name: "MITTE" };
  const R = app.routeFromPoints(G, P, [A, M, B], { 1: 7500 });
  const kurzVorZiel = R.samples.filter(q => q.x > R.D - 4 && q.x < R.D - 1);
  assert.ok(kurzVorZiel.every(q => Math.abs(q.p - 7500) < 1), kurzVorZiel.map(q => Math.round(q.p)).join(","));
  assert.ok(R.spiralMin > 0, "Sinken im Vollkreis über dem Platz");
});

test("Eine selbst gesetzte Höhe wird nach dem Steigflug erreicht und gehalten.", () => {
  const app = loadApp();
  const { G, P, A, B } = setup(app, () => 1000);
  const M = { lat: 47.0, lon: 13.7, name: "MITTE" };
  const R = app.routeFromPoints(G, P, [A, M, B], { 0: 4500, 1: 6500 });
  const mitteLeg0 = R.samples.find(q => q.x > 15 && q.x < 16);
  assert.equal(Math.round(mitteLeg0.p), 4500);
  const leg1 = R.samples.filter(q => R.rs[q.ri].e.leg === 1 && q.x > R.rs.find(r => r.e.leg === 1).x0 + 8 && q.x < R.D - 2);
  assert.ok(leg1.every(q => Math.abs(q.p - 6500) < 1), leg1.map(q => Math.round(q.p)).join(","));
});
