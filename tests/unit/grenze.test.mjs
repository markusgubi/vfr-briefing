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

test("Staatsgrenzlinien (Natural Earth) ergeben den Grenzübertritt samt Richtung, auch ohne FIR.", () => {
  const app = loadApp();
  const { R, t } = route(app, []);
  // Linie von Nord nach Sued bei lon 13.7: links (Osten bei Blick nach Sueden) = SI, rechts = AT
  t.G.BORDERS = [{ l: "SI", r: "AT", c: [[13.7, 47.5], [13.7, 46.5]], bb: [13.7, 46.5, 13.7, 47.5] }];
  const c = app.detectCrossings(R, R.G);
  assert.equal(c.length, 1);
  assert.equal(c[0].fromC + ">" + c[0].toC, "AT>SI");
  assert.ok(Math.abs(c[0].lon - 13.7) < 0.01, "lon " + c[0].lon);
});

test("Ein Knickpunkt wird auf einen nahen Ort gelegt, wenn die Route dadurch nicht unsicherer wird.", async () => {
  const app = loadApp();
  const t = setup(app, () => 1000);
  const G = t.G;
  G.A.country = "AT"; G.B.country = "AT";
  app.loadCountry = async () => [];
  G.PLACES = [{ name: "Knickstadt", lat: 47.12, lon: 13.68, kind: "town", pop: 8000 }];
  const R = app.routeFromPoints(G, t.P, [{ ...t.A, name: "TSTA" }, { lat: 47.15, lon: 13.7 }, { ...t.B, name: "TSTB" }], null, "r1", "Sicherste Route");
  R.custom = false;
  const routes = [R];
  await app.snapLandmarks(routes, G, t.P);
  const names = routes[0].pts.map(p => p.name).filter(Boolean);
  assert.ok(names.includes("Knickstadt"), names.join(", "));
  assert.ok(routes[0].cat <= R.cat && routes[0].confLen <= R.confLen + 0.05);
});

test("Ein Ort wird nicht übernommen, wenn die Route dadurch unsicherer würde.", async () => {
  const app = loadApp();
  // Berg genau beim Ort: Gelaende hoch um lon 13.68 sued der Linie
  const t = setup(app, () => 1000);
  const G = t.G;
  const base = app.elevFt;
  app.elevFt = (lat, lon) => (Math.abs(lon - 13.68) < 0.05 && lat < 47.13 ? 11000 : base(lat, lon));
  G.edges.forEach(e => app.edgeStatic(G, e, []));
  G.A.country = "AT"; G.B.country = "AT";
  app.loadCountry = async () => [];
  G.PLACES = [{ name: "Bergdorf", lat: 47.11, lon: 13.68, kind: "town", pop: 8000 }];
  const R = app.routeFromPoints(G, t.P, [{ ...t.A, name: "TSTA" }, { lat: 47.16, lon: 13.7 }, { ...t.B, name: "TSTB" }], null, "r1", "Sicherste Route");
  R.custom = false;
  const routes = [R];
  await app.snapLandmarks(routes, G, t.P);
  const names = routes[0].pts.map(p => p.name).filter(Boolean);
  assert.ok(!names.includes("Bergdorf"), names.join(", "));
});

test("Ein Grenzort wird nicht übernommen, wenn die Route darüber weniger sicher wäre; der Übertritt bleibt auf der Linie.", async () => {
  const app = loadApp();
  const { R, t } = route(app, []);
  const G = t.G, base = app.elevFt;
  app.elevFt = (lat, lon) => (Math.abs(lon - 13.72) < 0.05 && lat < 46.98 ? 11000 : base(lat, lon));
  G.edges.forEach(e => app.edgeStatic(G, e, []));
  const R0 = app.evalRoute(G, t.P, 10, app.directPath(G), "direct", "Direkt");
  G.BORDERS = [{ l: "SI", r: "AT", c: [[13.7, 47.5], [13.7, 46.5]], bb: [13.7, 46.5, 13.7, 47.5] }];
  G.A.country = "AT"; G.B.country = "AT";
  G.PLACES = [{ name: "Bergstadt", lat: 46.94, lon: 13.72, kind: "town", pop: 9000 }];
  app.loadCountry = async () => [];
  app.CTRY.SI = app.CTRY.SI || [[13.3, 45.4, 16.6, 46.9]];
  R0.pts = [{ lat: G.A.lat, lon: G.A.lon }, { lat: G.B.lat, lon: G.B.lon }];
  const routes = [R0];
  await app.adjustRoutes(routes, G, t.P);
  const names = routes[0].pts.map(p => p.name).filter(Boolean);
  assert.ok(!names.includes("Bergstadt"), names.join(", "));
  assert.ok(names.some(n => /^GRENZE AT\/SI/.test(n)), names.join(", "));
  assert.ok(routes[0].rpNotes.includes("townworse:Bergstadt"), routes[0].rpNotes.join(","));
  assert.ok(routes[0].cat <= R0.cat);
});

test("Ein Ort fast genau auf einer langen geraden Teilstrecke wird als Überflug-Wegpunkt eingefügt.", async () => {
  const app = loadApp();
  const t = setup(app, () => 1000);
  const G = t.G;
  G.A.country = "AT"; G.B.country = "AT";
  app.loadCountry = async () => [];
  G.PLACES = [{ name: "Linienort", lat: 47.01, lon: 13.7, kind: "town", pop: 5000 }, { name: "Fernort", lat: 47.2, lon: 13.7, kind: "town", pop: 90000 }];
  const R = app.routeFromPoints(G, t.P, [{ ...t.A, name: "TSTA" }, { ...t.B, name: "TSTB" }], null, "direct", "Direkt");
  R.custom = false;
  const routes = [R];
  await app.snapLandmarks(routes, G, t.P);
  const names = routes[0].pts.map(p => p.name).filter(Boolean);
  assert.equal(names.join(","), "TSTA,Linienort,TSTB");
});

test("Ein Anflug-Meldepunkt weit neben der sichersten Linie wird nicht angeflogen (kein Umweg), ein Hinweis nennt ihn.", async () => {
  const app = loadApp();
  const t = setup(app, () => 1000);
  const G = t.G;
  G.A.country = "AT"; G.B.country = "IT"; G.B.id = "apt-TSTB";
  G.BORDERS = [{ l: "IT", r: "AT", c: [[13.7, 47.5], [13.7, 46.5]], bb: [13.7, 46.5, 13.7, 47.5] }];
  G.PLACES = [];
  app.CTRY.IT = app.CTRY.IT || [[6.6, 43.5, 13.9, 47.1]];
  const far = { id: "r9", name: "FERNPKT", compulsory: true, country: "IT", lat: 47.17, lon: 14.3, airports: ["apt-TSTB"] };
  app.loadCountry = async (c, kind) => (kind === "rp" && c === "IT" ? [far] : []);
  const R = app.evalRoute(G, t.P, 10, app.directPath(G), "direct", "Direkt");
  R.pts = [{ lat: G.A.lat, lon: G.A.lon }, { lat: G.B.lat, lon: G.B.lon }];
  const routes = [R];
  await app.adjustRoutes(routes, G, t.P);
  const names = routes[0].pts.map(p => p.name).filter(Boolean);
  assert.ok(!names.includes("FERNPKT"), names.join(", "));
  assert.ok(routes[0].rpNotes.some(n => n.startsWith("destoff:FERNPKT")), routes[0].rpNotes.join(","));
});
