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

test("Eine selbst gesetzte Höhe auf der letzten Teilstrecke wird bis zum Sinkflugbeginn gehalten, dann flach bis zum Platz gesunken.", () => {
  const app = loadApp();
  const { G, P, A, B } = setup(app, () => 1000);
  const M = { lat: 47.0, lon: 13.7, name: "MITTE" };
  const R = app.routeFromPoints(G, P, [A, M, B], { 1: 4500 });
  const gD = app.descGrad(P), tod = R.D - (4500 - G.destElev) / gD;
  const leg1 = R.samples.filter(q => R.rs[q.ri].e.leg === 1 && q.x > R.rs.find(r => r.e.leg === 1).x0 + 1 && q.x < tod - 0.5);
  assert.ok(leg1.length > 3 && leg1.every(q => Math.abs(q.p - 4500) < 1), leg1.map(q => Math.round(q.p)).join(","));
  assert.equal(Math.round(R.samples[R.samples.length - 1].p), Math.round(G.destElev), "Ankunft in Platzhöhe");
  for (let i = 1; i < R.samples.length; i++) {
    const a = R.samples[i - 1], b = R.samples[i];
    assert.ok(a.p - b.p <= gD * (b.x - a.x) + 1, "nie steiler als die Sinkrate bei NM " + b.x.toFixed(1));
  }
  assert.equal(R.spiralMin, 0, "kein Sinken im Vollkreis");
  assert.equal(R.conflicts.length, 0, JSON.stringify(R.conflicts));
});

test("Ein Berg kurz vor dem Ziel, über den kein normaler Sinkflug möglich ist, wird als Konflikt begründet.", () => {
  const app = loadApp();
  const { G, P, A, B } = setup(app, x => (x > 50 && x < 53 ? 6000 : 1000));
  const R = app.routeFromPoints(G, P, [A, B], null);
  assert.ok(R.conflicts.some(c => c.cause === "desc"), JSON.stringify(R.conflicts));
  assert.equal(R.cat, 2);
  assert.equal(R.spiralMin, 0);
});

test("Eine selbst gesetzte Höhe wird nach dem Steigflug erreicht und gehalten.", () => {
  const app = loadApp();
  const { G, P, A, B } = setup(app, () => 1000);
  const M = { lat: 47.0, lon: 13.7, name: "MITTE" };
  const R = app.routeFromPoints(G, P, [A, M, B], { 0: 4500, 1: 6500 });
  const mitteLeg0 = R.samples.find(q => q.x > 15 && q.x < 16);
  assert.equal(Math.round(mitteLeg0.p), 4500);
  const tod = R.D - (6500 - G.destElev) / app.descGrad(P);
  const leg1 = R.samples.filter(q => R.rs[q.ri].e.leg === 1 && q.x > R.rs.find(r => r.e.leg === 1).x0 + 8 && q.x < tod - 0.5);
  assert.ok(leg1.length > 3);
  assert.ok(leg1.every(q => Math.abs(q.p - 6500) < 1), leg1.map(q => Math.round(q.p)).join(","));
});

test("Vor dem Ziel zieht der Anflugweg eine eigene Höhe nie unter das Gelände.", () => {
  const app = loadApp();
  const { G, P, A, B } = setup(app, x => (x > 44 && x < 47 ? 5000 : 1000));
  const M = { lat: 47.0, lon: 13.7, name: "MITTE" };
  const R = app.routeFromPoints(G, P, [A, M, B], { 1: 6700 });
  assert.ok(!R.conflicts.some(c => c.cause === "low"), JSON.stringify(R.conflicts));
  const berg = R.samples.filter(q => q.x > 44 && q.x < 47);
  assert.ok(berg.every(q => q.p >= q.hard - 1), berg.map(q => Math.round(q.p) + "/" + Math.round(q.hard)).join(" "));
});

test("Eine zu tiefe eigene Höhe vor einem Berg wird nicht geflogen und mit Grund erklärt.", () => {
  const app = loadApp();
  const { G, P, A, B } = setup(app, x => (x > 26 && x < 29 ? 6000 : 1000));
  const M1 = { lat: 47.0, lon: 13.45, name: "M1" }, M2 = { lat: 47.0, lon: 13.6, name: "M2" };
  const R = app.routeFromPoints(G, P, [A, M1, M2, B], { 1: 2500 });
  app.RES = { G, P, apts: [] };
  app.finalize(R, G, P);
  const leg1 = R.samples.filter(q => R.rs[q.ri].e.leg === 1);
  assert.ok(leg1.every(q => q.p > 2501), "kurz vor dem Berg wird nicht auf 2500 ft gesunken: " + leg1.map(q => Math.round(q.p)).join(","));
  assert.ok(R.hints.some(h => /2500 ft<\/b> \(Teilstrecke 2\) wird nicht erreicht: Mit 500 ft\/min Sinken/.test(h.t)), R.hints.map(h => h.t).join("\n"));
  assert.ok(!R.conflicts.length, JSON.stringify(R.conflicts));
});
