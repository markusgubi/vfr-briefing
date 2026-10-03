// Lange Strecke (> 250 NM): Planung wird erlaubt, Hinweis "Lange Strecke" erscheint, keine JS-Fehler.
import { openApp, planRoute } from "./lib.mjs";
const OUT = process.env.OUT || ".";
const { browser, page, errors } = await openApp();
await planRoute(page, "LOAG", "LDSP");
const r = await page.evaluate(() => {
  const R = RES.routes[RES.sel];
  return { D: Math.round(R.D), cat: R.cat, demZ: RES.G.demZ, sts: document.getElementById("sts").textContent,
    lang: R.hints.some(h => /Lange Strecke/.test(h.t)), wps: R.wps.length, nan: R.samples.some(q => !isFinite(q.p)) };
});
console.log(JSON.stringify(r));
const ok = r.D > 250 && r.lang && !r.nan && !errors.length;
await page.screenshot({ path: OUT + "/e2e-lang.png" });
console.log(ok ? "OK   lange Strecke geplant" : "FAIL lange Strecke " + JSON.stringify(errors));
await browser.close();
process.exit(ok ? 0 : 1);
