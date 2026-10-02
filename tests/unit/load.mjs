// Laedt die Rechenlogik aus public/js in einen eigenen Kontext (ohne Browser, ohne Karte).
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../public/js");
const FILES = ["util.js", "data.js", "wx.js", "route.js", "report.js"];

export function loadApp() {
  const ctx = { console, Math, Date, JSON, Promise, setTimeout, clearTimeout,
    document: { getElementById: () => ({ value: "", innerHTML: "", className: "", classList: { add() {}, remove() {}, toggle() {} } }) } };
  vm.createContext(ctx);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(DIR, f), "utf8"), ctx, { filename: f });
  return ctx;
}

// Testumgebung: Gelaende als Funktion der Entfernung vom Start (NM), immer gutes Wetter, keine Luftraeume.
export function setup(app, terrain, opt = {}) {
  const A = { lat: 47.0, lon: 13.0, icao: "TSTA", elevFt: terrain(0) }, B = { lat: 47.0, lon: 14.4, icao: "TSTB", elevFt: null };
  const d = app.distNm(A, B);
  B.elevFt = terrain(d);
  app.elevFt = (lat, lon) => terrain(app.distNm(A, { lat: A.lat, lon }) * Math.sign(lon - A.lon || 1));
  app.nodeWx = () => ({ base: opt.base ?? Infinity, risk: 0, nogo: false, reasons: [], fz: 12000, ws: null, wd: null, cat: 0, agree: 1 });
  const P = { date: "2026-10-02", depH: 10, tas: 100, maxAlt: 12500, terrClr: 1000, cloudClr: 1000, prefAgl: 2000, climb: opt.climb || 500, desc: 500, avoidClr: false };
  const G = app.buildGraph(A, B, d);
  G.depElev = A.elevFt; G.destElev = B.elevFt; G.qnh = 1013.25; G.qnhKnown = true; G.sun = null; G.t0 = 0;
  G.edges.forEach(e => app.edgeStatic(G, e, []));
  return { A, B, d, P, G };
}
