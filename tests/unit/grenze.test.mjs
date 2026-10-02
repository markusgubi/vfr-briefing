// Tests fuer die Grenzerkennung aus FIR-Grenzen.
import test from "node:test";
import assert from "node:assert/strict";
import { loadApp, setup } from "./load.mjs";

function fir(app, name, country, lon0, lon1) {
  const g = { type: "Polygon", coordinates: [[[lon0, 46.5], [lon1, 46.5], [lon1, 47.5], [lon0, 47.5], [lon0, 46.5]]] };
  return { id: name, name, country, type: 10, kind: "fir", geometry: g, bb: app.geomBbox(g) };
}
function route(app, firs) {
  const t = setup(app, () => 1000);
  t.G.FIRS = firs;
  return { t, R: app.evalRoute(t.G, t.P, 10, app.directPath(t.G), "direct", "Direkt") };
}

test("Ein Landeswechsel zwischen zwei FIRs wird als Grenzübertritt erkannt.", () => {
  const app = loadApp();
  const { R } = route(app, [fir(app, "LOVV", "AT", 12.5, 13.7), fir(app, "LJLA", "SI", 13.7, 15)]);
  const c = app.detectCrossings(R, R.G);
  assert.equal(c.length, 1);
  assert.equal(c[0].fromC + ">" + c[0].toC, "AT>SI");
  assert.ok(Math.abs(c[0].lon - 13.7) < 0.01, "lon " + c[0].lon);
});

test("Mehrere FIRs desselben Landes ergeben keinen Grenzübertritt.", () => {
  const app = loadApp();
  const { R } = route(app, [fir(app, "EDMM", "DE", 12.5, 13.7), fir(app, "EDGG", "DE", 13.7, 15)]);
  assert.equal(app.detectCrossings(R, R.G).length, 0);
});

test("Eine Datenlücke ohne FIR erzeugt keinen erfundenen Grenzübertritt.", () => {
  const app = loadApp();
  const { R } = route(app, [fir(app, "LOVV-West", "AT", 12.5, 13.5), fir(app, "LOVV-Ost", "AT", 13.9, 15)]);
  assert.equal(app.detectCrossings(R, R.G).length, 0);
});
