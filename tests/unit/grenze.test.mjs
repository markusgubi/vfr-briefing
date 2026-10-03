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

test("Nachbarland ohne FIR in openAIP: Verlassen der FIR Richtung Auslandsziel ist der Grenzübertritt.", () => {
  const app = loadApp();
  const { R, t } = route(app, [fir(app, "LOVV", "AT", 12.5, 13.7)]);
  t.G.A.country = "AT"; t.G.B.country = "IT";
  const c = app.detectCrossings(R, R.G);
  assert.equal(c.length, 1);
  assert.equal(c[0].fromC + ">" + c[0].toC, "AT>IT");
  assert.ok(Math.abs(c[0].lon - 13.7) < 0.01, "lon " + c[0].lon);
});

test("Ohne FIR-Wechsel und mit Ziel im selben Land entsteht kein Grenzübertritt.", () => {
  const app = loadApp();
  const { R, t } = route(app, [fir(app, "LOVV", "AT", 12.5, 13.7)]);
  t.G.A.country = "AT"; t.G.B.country = "AT";
  assert.equal(app.detectCrossings(R, R.G).length, 0);
});

test("Ohne Meldepunkt wird ein markanter Ort an der Grenze als Übertrittspunkt gewählt.", async () => {
  const app = loadApp();
  const { R, t } = route(app, [fir(app, "LOVV", "AT", 12.5, 13.7)]);
  const G = t.G;
  G.A.country = "AT"; G.B.country = "IT";
  G.PLACES = [
    { name: "Kleinort", lat: 47.02, lon: 13.69, kind: "village", pop: 1200 },
    { name: "Grenzstadt", lat: 46.97, lon: 13.72, kind: "town", pop: 6700 },
    { name: "Fernort", lat: 47.0, lon: 14.2, kind: "town", pop: 50000 }
  ];
  app.RPDB.IT = []; app.RPDB.AT = [];
  app.loadCountry = async () => [];
  app.CTRY.IT = app.CTRY.IT || [[6.6, 43.5, 13.9, 47.1]];
  app.RES = { G, P: t.P, apts: [] };
  R.pts = [{ lat: G.A.lat, lon: G.A.lon }, { lat: G.B.lat, lon: G.B.lon }];
  const routes = [R];
  await app.adjustRoutes(routes, G, t.P);
  const pts = routes[0].pts.map(p => p.name).filter(Boolean);
  assert.ok(pts.includes("Grenzstadt"), pts.join(", "));
  assert.ok(routes[0].rpNotes.includes("town:Grenzstadt"));
  app.finalize(routes[0], G, t.P);
  assert.ok(routes[0].hints.some(h => /Grenzübertritt über den Ort <b>Grenzstadt/.test(h.t)), routes[0].hints.map(h => h.t).join("\n"));
});

test("Wegpunkte bekommen den nächsten Ort (höchstens 3 NM) als Namen dazu.", () => {
  const app = loadApp();
  const t = setup(app, () => 1000);
  t.G.PLACES = [{ name: "Mittelstadt", lat: 47.01, lon: 13.7, kind: "town", pop: 9000 }];
  const R = app.routeFromPoints(t.G, t.P, [t.A, { lat: 47.0, lon: 13.7 }, t.B], null);
  app.RES = { G: t.G, P: t.P, apts: [] };
  app.finalize(R, t.G, t.P);
  assert.equal(R.wps[1].town, "Mittelstadt");
  assert.ok(R.legs[0].to.includes("Mittelstadt"), R.legs[0].to);
});
