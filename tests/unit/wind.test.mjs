// Wind bei Start/Landung: Pistenwahl, Gegen-/Seitenwind, Bewertung gegen die Seitenwind-Grenze.
import test from "node:test";
import assert from "node:assert/strict";
import { loadApp, setup } from "./load.mjs";

const RWY = [{ d: "08", hdg: 80, lenM: 700 }, { d: "26", hdg: 260, lenM: 700 }];

test("Gewählt wird die Piste mit dem meisten Gegenwind; Seitenwind mit Seite.", () => {
  const app = loadApp();
  const p = app.pickRunway(RWY, { wd: 290, ws: 20 }, "land");
  assert.equal(p.r.d, "26");
  assert.ok(Math.abs(p.c.head - 20 * Math.cos(30 * Math.PI / 180)) < 0.01);
  assert.ok(Math.abs(p.c.cross - 10) < 0.01 && p.c.cross > 0, "10 kt von rechts: " + p.c.cross);
  const q = app.pickRunway(RWY, { wd: 60, ws: 12 }, "land");
  assert.equal(q.r.d, "08");
  assert.ok(q.c.cross < 0, "von links");
});

/* Modellwind (10 m) am Zielplatz: G.wx mit zwei Modellen, alle Stunden gleich */
function modelWx(app, G, wd, ws, gust) {
  const md = () => {
    const o = { elevFt: 1000, hours: {} };
    for (let h = 0; h < 24; h++) o.hours[h] = h;
    const f = v => Array(24).fill(v);
    Object.assign(o, { temperature_2m: f(15), dew_point_2m: f(5), cloud_cover_low: f(0), cloud_cover_mid: f(0), visibility: f(30000), precipitation: f(0), cape: f(0),
      wind_gusts_10m: f(gust), wind_speed_850hPa: f(10), wind_direction_850hPa: f(270), wind_speed_10m: f(ws), wind_direction_10m: f(wd) });
    return o;
  };
  G.wx = [G.wpts.map(md), G.wpts.map(md)];
}

test("Seitenwind über der Grenze macht die Route KRITISCH und nennt den Grund.", () => {
  const app = loadApp();
  const t = setup(app, () => 1000);
  t.B.rwy = RWY; t.A.rwy = RWY;
  modelWx(app, t.G, 170, 20, 25);   /* fast quer zu 08/26 */
  const R = app.routeFromPoints(t.G, t.P, [t.A, t.B], null);
  assert.equal(R.landWind.level, 2, JSON.stringify(R.landWind));
  assert.equal(R.cat, 2);
  assert.match(app.issueOf(R), /Seitenwind beim (Landen|Start)/);
});

test("Nur in Böen über der Grenze ist EINGESCHRÄNKT, mäßiger Wind bleibt GUT.", () => {
  const app = loadApp();
  let t = setup(app, () => 1000);
  t.B.rwy = RWY; t.A.rwy = RWY;
  modelWx(app, t.G, 220, 14, 30);   /* 40 Grad zur 26: Mittel ~9 kt quer, Boeen ~19 kt quer */
  let R = app.routeFromPoints(t.G, t.P, [t.A, t.B], null);
  assert.equal(R.landWind.level, 1, JSON.stringify(R.landWind));
  assert.equal(R.cat, 1);
  const app2 = loadApp();
  t = setup(app2, () => 1000);
  t.B.rwy = RWY; t.A.rwy = RWY;
  modelWx(app2, t.G, 250, 10, 14);
  R = app2.routeFromPoints(t.G, t.P, [t.A, t.B], null);
  assert.equal(R.landWind.level, 0);
  assert.equal(R.landWind.rwy.d, "26");
  assert.equal(R.cat, 0);
});

test("Ohne Pistendaten wird nur der Wind gezeigt, ohne Bewertung.", () => {
  const app = loadApp();
  const t = setup(app, () => 1000);
  modelWx(app, t.G, 170, 25, 30);
  const R = app.routeFromPoints(t.G, t.P, [t.A, t.B], null);
  assert.ok(R.landWind && !R.landWind.rwy);
  assert.equal(R.cat, 0);
});
