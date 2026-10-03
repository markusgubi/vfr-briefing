// Talflug: im Tal (Flanken mind. 0,5 NM seitlich) gilt der Abstand ueber dem Talboden, nicht ueber den Graten.
import test from "node:test";
import assert from "node:assert/strict";
import { loadApp, setup } from "./load.mjs";

/* Tal entlang der Route (Breite +-0,7 NM, Talboden 1000 ft, zur Mitte bis 1800 ft ansteigend), Flanken 7000 ft */
function tal(app, base) {
  const t = setup(app, () => 1000, base != null ? { base } : {});
  const x0 = t.A;
  app.elevFt = (lat, lon) => {
    const dy = Math.abs(lat - 47.0) * 60, x = app.distNm(x0, { lat: x0.lat, lon });
    return dy < 0.7 ? 1000 + Math.max(0, Math.min(x, 57 - x, 20)) * 40 : 7000;
  };
  t.G.edges.forEach(e => app.edgeStatic(t.G, e, []));
  t.G.polyCache = {};
  return t;
}

test("Talflug ohne Wetterprobleme ist fliegbar und nicht eingeschränkt (Abstand über dem Talboden).", () => {
  const app = loadApp();
  const { G, P, A, B } = tal(app);
  const R = app.routeFromPoints(G, P, [A, B], null);
  assert.equal(R.conflicts.length, 0, JSON.stringify(R.conflicts));
  assert.equal(R.cat, 0, app.issueOf(R));
  assert.ok(R.maxAlt < 7000, "bleibt im Tal: " + R.maxAlt);
  const mitte = R.samples.filter(q => q.fr >= 1);
  assert.ok(mitte.every(q => q.p >= q.tc + P.terrClr - 1), "Sollabstand ueber dem Talboden");
});

test("Liegen die Wolken unter der nötigen Talflughöhe, ist der Talflug KRITISCH und begründet.", () => {
  const app = loadApp();
  const { G, P, A, B } = tal(app, 2200);
  const R = app.routeFromPoints(G, P, [A, B], null);
  assert.equal(R.cat, 2);
  assert.ok(R.conflicts.some(c => c.cause === "wx" || c.cause === "cloud"), JSON.stringify(R.conflicts));
});

test("Zu schmales Tal (Flanken näher als 0,5 NM) gilt nicht als Talflug.", () => {
  const app = loadApp();
  const t = setup(app, () => 1000);
  app.elevFt = (lat, lon) => (Math.abs(lat - 47.0) * 60 < 0.3 ? 1000 : 7000);
  t.G.edges.forEach(e => app.edgeStatic(t.G, e, []));
  const R = app.routeFromPoints(t.G, t.P, [t.A, t.B], null);
  assert.ok(R.maxAlt >= 7000 || R.cat === 2, "nicht unter den Flanken geplant: " + R.maxAlt + " cat " + R.cat);
});
