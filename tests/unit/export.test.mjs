// Tests fuer den SkyDemon-Export: Hoehe je Teilstrecke im Format einer echten SkyDemon-Datei.
import test from "node:test";
import assert from "node:assert/strict";
import { loadApp, setup } from "./load.mjs";

function plan(app) {
  const t = setup(app, x => (x > 20 && x < 35 ? 6000 : 1000));
  const M = { lat: 47.05, lon: 13.6, name: "MITTE" };
  const R = app.routeFromPoints(t.G, t.P, [t.A, M, t.B], { 0: 8500, 1: 4500 });
  app.RES = { G: t.G, P: t.P, apts: [] };
  app.finalize(R, t.G, t.P);
  return { R, t };
}

test("Die SkyDemon-Datei enthält je Teilstrecke die Reiseflughöhe.", () => {
  const app = loadApp();
  const { R } = plan(app);
  const xml = app.skyDemonXml(R);
  assert.match(xml, /^<\?xml version="1.0" encoding="utf-8"\?>\n<DivelementsFlightPlanner>/);
  assert.match(xml, /<PrimaryRoute CourseType="GreatCircle" Start="N470000\.00 E0130000\.00" StartType="Unknown" Level="8500" Time="\d{18}" Rules="Vfr">/);
  const legs = [...xml.matchAll(/<RhumbLineRoute To="([NS]\d{6}\.\d{2} [EW]\d{7}\.\d{2})" ToType="Unknown" Level="(\d+)" LevelChange="([BF])" \/>/g)];
  assert.equal(legs.length, R.wps.length - 1);
  assert.deepEqual(legs.map(l => l[2]), ["8500", "4500"]);
  assert.deepEqual(legs.map(l => l[3]), ["B", "B"], "wie SkyDemon: immer B");
});

test("Die Höhenliste im Export stimmt mit dem Navigationslog überein.", () => {
  const app = loadApp();
  const { R } = plan(app);
  const alts = app.wpAlts(R);
  R.legs.forEach((l, k) => assert.equal(alts[k], l.alt));
});

test("Die Abflugzeit steht wie bei SkyDemon als FILETIME (UTC) in der Datei.", () => {
  const app = loadApp();
  const { R } = plan(app);
  app.RES.P.date = "2026-10-03"; R.depMin = 9 * 60;
  const t = BigInt(app.skyDemonXml(R).match(/Time="(\d+)"/)[1]);
  const ms = Number(t / 10000n - 11644473600000n);
  const d = new Date(ms);
  assert.equal(d.getHours() * 60 + d.getMinutes(), 9 * 60, "Ortszeit 09:00");
});
