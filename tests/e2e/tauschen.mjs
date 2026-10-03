// Knopf "tauschen": Von und Nach mit einem Klick vertauschen (Desktop und iPhone)
import { openApp, planRoute } from "./lib.mjs";
const OUT = process.env.OUT || ".";
let fails = 0;
const ok = (c, t) => { console.log((c ? "OK   " : "FAIL ") + t); if (!c) fails++; };
for (const mob of [false, true]) {
  const tag = mob ? "iPhone" : "Desktop";
  const { browser, page, errors } = await openApp({ mob });
  await planRoute(page, "LOLW", "LOWZ", "10:00");
  if (mob) { await page.click("#mnav button[data-p='side']").catch(() => {}); await page.waitForTimeout(300); }
  await page.click("#swapBtn");
  const r = await page.evaluate(() => ({ f: S.from && S.from.icao, t: S.to && S.to.icao, fv: $("fIn").value, tv: $("tIn").value }));
  ok(r.f === "LOWZ" && r.t === "LOLW", `${tag} getauscht: ${r.f} -> ${r.t}`);
  ok(/^LOWZ/.test(r.fv) && /^LOLW/.test(r.tv), `${tag} Eingabefelder: ${r.fv} / ${r.tv}`);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("vfr72")));
  ok(saved.from.icao === "LOWZ" && saved.to.icao === "LOLW", `${tag} gespeichert`);
  await page.click("#swapBtn");
  const r2 = await page.evaluate(() => [S.from.icao, S.to.icao].join(">"));
  ok(r2 === "LOLW>LOWZ", `${tag} zweimal = zurueck: ${r2}`);
  await page.screenshot({ path: `${OUT}/tauschen-${tag}.png` });
  ok(!errors.length, `${tag} keine JS-Fehler ` + JSON.stringify(errors));
  await browser.close();
}
process.exit(fails ? 1 : 0);
