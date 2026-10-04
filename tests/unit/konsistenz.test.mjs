// Dieselbe Strecke muss immer gleich bewertet werden – egal ob als berechnete Route oder
// nach "Bearbeiten" als eigene Route. Nachgestellt: tiefe Wolken mitten zwischen zwei Netzknoten.
import test from "node:test";
import assert from "node:assert/strict";
import { loadApp, setup } from "./load.mjs";

const gut = { base: Infinity, risk: 0, nogo: false, reasons: [], fz: 12000, ws: null, wd: null, cat: 0, agree: 1, elevFt: 1000 };
function mitWolkenNest(app, G) {
  // Wetter je Netzpunkt: im Umkreis von 2 NM um den Punkt NEST liegt die Basis bei 2500 ft MSL
  const NEST = { lat: 47.0, lon: 13.2 };
  app.nodeWx = (g, ni) => {
    const nd = g.nodes[ni];
    return app.distNm(nd, NEST) < 2 ? Object.assign({}, gut, { base: 2500 }) : gut;
  };
  return NEST;
}

test("Bearbeiten ändert die Sicherheitsbewertung einer berechneten Route nicht.", () => {
  const app = loadApp();
  const { G, P } = setup(app, () => 1000);
  mitWolkenNest(app, G);
  app.RES = { G, P, apts: [] };
  const routes = app.computeRoutes(G, P);
  for (const R of routes) {
    app.finalize(R, G, P);
    const pts = R.pts.map(p => Object.assign({}, p));
    const E = app.routeFromPoints(G, P, pts, null);
    assert.equal(E.cat, R.cat, R.name + ": " + R.cat + " vs Bearbeiten " + E.cat);
    assert.deepEqual(E.conflicts.map(c => c.cause), R.conflicts.map(c => c.cause), R.name);
    assert.equal(E.score, R.score, R.name);
  }
});

test("Tiefe Wolken zwischen zwei Netzknoten werden auch bei berechneten Routen erkannt.", () => {
  const app = loadApp();
  const { G, P } = setup(app, () => 1000);
  mitWolkenNest(app, G);
  app.RES = { G, P, apts: [] };
  const direct = app.computeRoutes(G, P).find(r => r.id === "direct");
  assert.ok(direct, "Direktstrecke vorhanden");
  assert.ok(direct.cat >= 1 || direct.minCloud < 1000, "Wolkennest auf der Direktstrecke muss sich auswirken");
});

test("Ein auf der Linie eingefügter Wegpunkt ändert die Bewertung nicht (auch mit eigenen Höhen).", () => {
  const app = loadApp();
  const { G, P } = setup(app, x => 1000 + 4000 * Math.max(0, Math.sin(x / 6)) ** 2);
  mitWolkenNest(app, G);
  app.RES = { G, P, apts: [] };
  let n = 0;
  for (const R of app.computeRoutes(G, P)) {
    const pts = R.pts.map(p => Object.assign({}, p));
    for (const ua of [null, { 0: 9500 }]) {
      const E = app.routeFromPoints(G, P, pts, ua);
      for (let k = 0; k < pts.length - 1; k++) for (const f of [0.31, 0.5, 0.77]) {
        const q = app.lerp(pts[k], pts[k + 1], f);
        const p2 = pts.slice(0, k + 1).concat([{ lat: q.lat, lon: q.lon, name: null }], pts.slice(k + 1));
        const F = app.routeFromPoints(G, P, p2, ua ? { 0: 9500, 1: 9500 } : null);
        assert.equal(F.cat, E.cat, R.name); assert.equal(F.score, E.score, R.name);
        assert.equal(F.ete, E.ete, R.name); assert.equal(F.maxAlt, E.maxAlt, R.name);
        assert.deepEqual(F.conflicts.map(c => c.cause), E.conflicts.map(c => c.cause), R.name);
        app.finalize(F, G, P);
        assert.ok(F.wps.some(w => w.uw === k + 1), "eingefügter Wegpunkt fehlt im Navlog");
        assert.equal(F.legs.length, F.wps.length - 1);
        n++;
      }
    }
  }
  assert.ok(n > 20);
});
