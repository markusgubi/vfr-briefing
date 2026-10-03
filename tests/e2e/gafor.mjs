// GAFOR-Daten im Browser: 48 Strecken geladen, Haken aktiv, "bevorzugen" aendert nie die Sicherheit.
import { openApp, planRoute } from "./lib.mjs";
const OUT = process.env.OUT || ".";
let fails = 0;
const ok = (c, t) => { console.log((c ? "OK   " : "FAIL ") + t); if (!c) fails++; };
const { browser, page, errors } = await openApp();
await page.waitForTimeout(500);
const st = await page.evaluate(() => ({ n: GAFOR ? GAFOR.length : 0, en: !document.getElementById("prefGafor").disabled, info: document.getElementById("gaforInfo").textContent }));
ok(st.n === 48 && st.en, `GAFOR geladen: ${st.n} Strecken, Haken aktiv (${st.info})`);
const res = {};
for (const pref of [false, true]) {
  for (const [a, b] of [["LOLW", "LOWZ"], ["LOWS", "LOWK"], ["LOWZ", "LOLW"]]) {
    await page.evaluate(p => { document.getElementById("prefGafor").checked = p; }, pref);
    const t0 = Date.now();
    await planRoute(page, a, b);
    const r = await page.evaluate(() => { const R = RES.routes[0]; return { cat: R.cat, conf: R.confLen, raw: Math.round(R.rawScore), g: R.gaforPct, name: R.name }; });
    r.ms = Date.now() - t0;
    res[a + b + pref] = r;
    if (pref) {
      const o = res[a + b + false];
      ok(r.cat <= o.cat && r.conf <= o.conf, `${a}-${b}: mit GAFOR nicht unsicherer (Kat. ${o.cat} -> ${r.cat}, Konflikt ${o.conf} -> ${r.conf} NM, GAFOR-Anteil ${o.g} -> ${r.g} %, ${r.ms} ms)`);
    }
  }
}
await page.evaluate(() => map.setView([47.5, 13.5], 7));
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + "/gafor.png" });
ok(!errors.length, "keine JS-Fehler " + JSON.stringify(errors));
await browser.close();
process.exit(fails ? 1 : 0);
