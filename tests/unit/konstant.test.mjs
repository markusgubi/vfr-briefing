// Hoehen eher konstant (Nutzerwunsch): kein kurzes Hoch/Runter fuer kurze Haken in Gegenrichtung, keine Buckel
// und Taeler, wo keine Grenze es verlangt – aber nie gegen Gelaende, Luftraum oder eine vorgeschriebene
// Halbkreisflughoehe auf laengeren Abschnitten.
import test from "node:test";
import assert from "node:assert/strict";
import { loadApp, setup } from "./load.mjs";

function zick(opt = {}) {
  const app = loadApp(); const t = setup(app, () => 2500);
  t.P.prefAgl = 6000;   // Reiseflug ueber 3000 ft AGL: Halbkreisregel gilt
  app.RES = { G: t.G, P: t.P, apts: [] };
  // Haken: kurzer Abschnitt Richtung Suedwest (Gegenrichtung), sonst Ost
  const pts = [t.A, { lat: 47.0, lon: 13.6 }, { lat: 46.98, lon: opt.lang ? 13.35 : 13.55 }, { lat: 47.0, lon: 13.7 }, t.B];
  return { app, R: app.routeFromPoints(t.G, t.P, pts, null), t };
}
function reise(R) { const tod = R.tod ? R.tod.x : R.D; return R.samples.filter(q => q.x > 15 && q.x < tod - 1); }

test("Ein kurzer Haken in Gegenrichtung behält die Reisehöhe (kein kurzes Steigen und Sinken).", () => {
  const { R } = zick();
  const ps = reise(R).map(q => Math.round(q.p));
  assert.ok(ps.length > 20);
  assert.equal(Math.max(...ps) - Math.min(...ps), 0, "Reiseflug nicht konstant: " + [...new Set(ps)].join(","));
  const haken = R.rs.find(r => r.mc > 180);
  assert.ok(haken && haken.semi === "short", "kurzer Haken markiert: " + (haken && haken.semi));
});

test("Ein langer Abschnitt in Gegenrichtung bekommt weiterhin die vorgeschriebene Halbkreisflughöhe.", () => {
  const { R } = zick({ lang: true });
  const west = R.rs.filter(r => r.mc > 180 && r.mc < 360);
  assert.ok(west.length);
  assert.ok(west.every(r => r.semi === "ok" && (r.alt - 4500) % 2000 === 0), west.map(r => r.alt + "/" + r.semi).join(" "));
});

test("Die Einstufung wird durch das Glätten nicht schlechter und nie unter die Geländegrenze.", () => {
  const { R } = zick();
  assert.equal(R.cat, 0);
  assert.equal(R.conflicts.length, 0);
  assert.ok(R.samples.every(q => q.p >= q.hard - 1 || q.x < 1 || q.x > R.D - 1));
});
