// Tests fuer Tageslicht (BCMT/ECET) und die Rueckflug-Empfehlung.
import test from "node:test";
import assert from "node:assert/strict";
import { loadApp, setup } from "./load.mjs";

const near = (a, b, min) => Math.abs(a - b) * 60 <= min;

test("ECET und BCMT werden für jeden Tag berechnet (Wien, bekannte Werte auf 3 min genau).", () => {
  const app = loadApp();
  const s = app.sunTimes(48.2082, 16.3738, "2026-06-21");
  assert.ok(near(s.bcmt, 4 + 13 / 60, 3) && near(s.rise, 4 + 53 / 60, 3) && near(s.set, 20 + 58 / 60, 3) && near(s.ecet, 21 + 38 / 60, 3), JSON.stringify(s));
  const w = app.sunTimes(48.2082, 16.3738, "2026-12-21");
  assert.ok(near(w.bcmt, 7 + 6 / 60, 3) && near(w.rise, 7 + 42 / 60, 3) && near(w.set, 16 + 3 / 60, 3) && near(w.ecet, 16 + 39 / 60, 3), JSON.stringify(w));
});

function sunSetup(app, terrain) {
  const t = setup(app, terrain);
  t.G.sun = { depRise: 7, depSet: 18.5, depBcmt: 6.5, depEcet: 19, destRise: 7, destSet: 18.5, destBcmt: 6.5, destEcet: 19 };
  return t;
}

test("Ankunft nach ECET ist Nacht (KRITISCH), zwischen Sonnenuntergang und ECET EINGESCHRÄNKT.", () => {
  const app = loadApp();
  const { G, P, A, B } = sunSetup(app, () => 1000);
  const ete = app.routeFromPoints(G, P, [A, B], null).ete;
  const at = arrH => { const p = Object.assign({}, P, { depH: arrH - ete / 60 }); return app.routeFromPoints(G, p, [A, B], null); };
  const vorher = at(17.5), daemmerung = at(18.75), nacht = at(19.25);
  assert.equal(vorher.cat, 0);
  assert.ok(daemmerung.dusk && !daemmerung.night && daemmerung.cat === 1, JSON.stringify({ c: daemmerung.cat, d: daemmerung.dusk }));
  assert.ok(nacht.night && nacht.cat === 2);
  assert.match(app.issueOf(nacht), /ECET/);
});

test("Rückflug: spätester Abflug landet vor ECET am Startplatz.", async () => {
  const app = loadApp();
  const { G, P, A, B } = sunSetup(app, () => 1000);
  const R = app.routeFromPoints(G, P, [A, B], null);
  const X = await app.returnPlan(G, P, R, 60);
  assert.equal(X.reason, "ecet");
  assert.ok(X.latestArr <= 19 * 60, "Landung " + X.latestArr);
  assert.ok(X.latestArr > 19 * 60 - 16, "spaetestmoeglich im 15-min-Raster: " + X.latestArr);
  assert.ok(X.t0 >= R.arrMin + 60);
  assert.equal(X.R.G.A, G.B, "Rueckflug startet am Ziel");
});

test("Rückflug: Wetterverschlechterung am Nachmittag begrenzt die Empfehlung und wird begründet.", async () => {
  const app = loadApp();
  const { G, P, A, B } = sunSetup(app, () => 1000);
  app.nodeWx = (g, ni, h) => ({ base: h >= 15 ? 1800 : Infinity, risk: 0, nogo: false, reasons: [], fz: 12000, ws: null, wd: null, cat: 0, agree: 1 });
  const R = app.routeFromPoints(G, P, [A, B], null);
  const X = await app.returnPlan(G, P, R, 60);
  assert.equal(X.reason, "wx", JSON.stringify({ r: X.reason, l: X.latest }));
  assert.ok(X.latest < 15 * 60 && X.wxFrom <= 15 * 60, X.latest + " / " + X.wxFrom);
  assert.ok(X.issue, "Grund angegeben");
});

test("Rückflug: Kommt der Hinflug zu spät an, gibt es keinen Rückflug vor ECET.", async () => {
  const app = loadApp();
  const { G, P, A, B } = sunSetup(app, () => 1000);
  const R = app.routeFromPoints(G, Object.assign({}, P, { depH: 17 }), [A, B], null);
  const X = await app.returnPlan(G, P, R, 60);
  assert.equal(X.latest, null);
  assert.equal(X.reason, "late");
});
