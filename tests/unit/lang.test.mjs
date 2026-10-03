// Tests fuer lange Strecken (ueber 250 NM): Planung erlaubt, Datenmengen bleiben begrenzt.
import test from "node:test";
import assert from "node:assert/strict";
import { loadApp } from "./load.mjs";

test("Eine Strecke über 400 NM ergibt ein Netz mit begrenzter Knoten- und Wetterpunktzahl.", () => {
  const app = loadApp();
  const A = { lat: 48.2, lon: 16.4 }, B = { lat: 43.0, lon: 9.6 };
  const d = app.distNm(A, B);
  assert.ok(d > 400, "d=" + d);
  const G = app.buildGraph(A, B, d);
  assert.ok(G.nodes.length < 1200, "Knoten " + G.nodes.length);
  assert.ok(G.wpts.length <= 21 * 5, "Wetterpunkte " + G.wpts.length);
  const maxStep = Math.max(...G.nodes.filter(n => n.j === 0).map((n, i, a) => (i ? n.along - a[i - 1].along : 0)));
  assert.ok(maxStep < 7, "Schritt " + maxStep);
});

test("Für große Gebiete wird eine gröbere Geländestufe mit höchstens 260 Kacheln gewählt.", () => {
  const app = loadApp();
  assert.equal(app.demZoom(13, 47, 14, 47.5), 10);
  const z = app.demZoom(10, 43.3, 16.6, 48.4);
  assert.ok(z < 10);
  assert.ok(app.demTiles(10, 43.3, 16.6, 48.4, z) <= 260);
});
