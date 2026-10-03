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
    const r = await page.evaluate(i => {
      render(i);
      const B = RES.routes[RES.sel], b = { cat: B.cat, score: B.score, conf: B.conflicts.map(c => c.cause).join(","), D: B.D.toFixed(1) };
      startEdit();
      const U = RES.routes[RES.sel], u = { cat: U.cat, score: U.score, conf: U.conflicts.map(c => c.cause).join(","), D: U.D.toFixed(1) };
      const name = B.name; discardUser();
      return { name, b, u };
    }, i);
    const same = JSON.stringify(r.b) === JSON.stringify(r.u);
    if (!same) fails++;
    console.log((same ? "OK   " : "FAIL ") + from + "-" + to + " " + sc + " | " + r.name + " | vorher " + JSON.stringify(r.b) + (same ? "" : " | Stift " + JSON.stringify(r.u)));
  }
  if (errors.length) { fails++; console.log("FAIL JS-Fehler " + JSON.stringify(errors)); }
  await browser.close();
}
process.exitCode = fails ? 1 : 0;
