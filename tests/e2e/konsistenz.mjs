// Browser-Test: "Bearbeiten" (Stift) darf die Bewertung einer Route nicht veraendern.
// Fuer jede Variante: auswaehlen, Stift, Einstufung/Wert/Konflikte vergleichen, verwerfen.
import { openApp, planRoute } from "./lib.mjs";
const CASES = [["LOLW", "LOWZ", "gut"], ["LOLW", "LOWZ", "tief"], ["LOWZ", "LOLW", "gut"], ["LOLW", "LJPZ", "gut"], ["LOWS", "LOWK", "tief"]];
let fails = 0;
for (const [from, to, sc] of CASES) {
  const { browser, page, errors } = await openApp({ scenario: sc });
  await planRoute(page, from, to);
  const n = await page.evaluate(() => RES.routes.length);
  for (let i = 0; i < n; i++) {
    const r = await page.evaluate(async i => {
      render(i);
      const B = RES.routes[RES.sel], b = { cat: B.cat, score: B.score, conf: B.conflicts.map(c => c.cause).join(","), D: B.D.toFixed(1) };
      startEdit();
      const U = RES.routes[RES.sel], u = { cat: U.cat, score: U.score, conf: U.conflicts.map(c => c.cause).join(","), D: U.D.toFixed(1) };
      /* Klick knapp neben die Linie (wie mit dem Finger): fuegt einen Wegpunkt AUF der Linie ein, Bewertung gleich */
      const n0 = EDIT.pts.filter(p => !p.shape).length, clk = [];
      for (const f of [0.3, 0.55, 0.8]) {
        const C = RES.routes[RES.sel], q = sampleInterp(C, C.D * f), s = sampleAt(C, C.D * f), r = C.rs[s.ri];
        const o = offsetPt(q, r.e.crs + 90, 0.3);
        routeLineClick(C, { latlng: { lat: o.lat, lng: o.lon } });
        await new Promise(res => setTimeout(res, 400));
        const K = RES.routes[RES.sel];
        clk.push({ cat: K.cat, score: K.score, conf: K.conflicts.map(c => c.cause).join(","), D: K.D.toFixed(1) });
      }
      const added = EDIT.pts.filter(p => !p.shape).length - n0;
      const name = B.name; discardUser();
      return { name, b, u, clk, added };
    }, i);
    const same = JSON.stringify(r.b) === JSON.stringify(r.u) && r.clk.every(c => JSON.stringify(c) === JSON.stringify(r.b)) && r.added === 3;
    if (!same) console.log("     nach Linienklick: " + JSON.stringify(r.clk) + " eingefuegt " + r.added);
    if (!same) fails++;
    console.log((same ? "OK   " : "FAIL ") + from + "-" + to + " " + sc + " | " + r.name + " | vorher " + JSON.stringify(r.b) + (same ? "" : " | Stift " + JSON.stringify(r.u)));
  }
  if (errors.length) { fails++; console.log("FAIL JS-Fehler " + JSON.stringify(errors)); }
  await browser.close();
}
process.exitCode = fails ? 1 : 0;
