// Rueckflug-Option: Empfehlung "spaetestens HH:MM" erscheint, ECET wird angezeigt, spaeter Hinflug wird gewarnt.
import { openApp, planRoute } from "./lib.mjs";
const OUT = process.env.OUT || ".";
let fails = 0;
const ok = (c, t) => { console.log((c ? "OK   " : "FAIL ") + t); if (!c) fails++; };
for (const mob of [false, true]) {
  const tag = mob ? "iPhone" : "Desktop";
  const { browser, page, errors } = await openApp({ mob });
  await page.evaluate(() => { const c = document.getElementById("retOn"); c.checked = true; c.dispatchEvent(new Event("change")); });
  ok(await page.evaluate(() => document.getElementById("retRow").style.display !== "none"), `${tag} Aufenthalt-Feld erscheint mit dem Haken`);
  await planRoute(page, "LOLW", "LOAG", "10:00");
  const r = await page.evaluate(() => ({ box: (document.querySelector("#out .retbox") || {}).textContent || "", ret: RES.ret && { latest: RES.ret.latest, reason: RES.ret.reason, arr: RES.ret.latestArr, ecet: RES.ret.ecet },
    info: document.getElementById("out").textContent.includes("ECET") }));
  ok(/R.ckflug LOAG . LOLW sp.testens \d\d:\d\d/.test(r.box), `${tag} Empfehlung: "${r.box.slice(0, 160)}"`);
  ok(r.ret && r.ret.arr <= r.ret.ecet, `${tag} Landung ${r.ret && r.ret.arr} vor ECET ${r.ret && r.ret.ecet}`);
  ok(r.info, `${tag} ECET wird angezeigt`);
  if (mob) await page.click("#mnav button[data-p='pRes']");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/rueckflug-${tag}.png` });
  // Rueckflug aus dem Tal (Talflug): Empfehlung statt "nicht empfohlen"
  await planRoute(page, "LOLW", "LOWZ", "10:00");
  const v = await page.evaluate(() => (document.querySelector("#out .retbox") || {}).textContent || "");
  ok(/R.ckflug LOWZ . LOLW sp.testens \d\d:\d\d/.test(v), `${tag} Rueckflug aus dem Tal: "${v.slice(0, 120)}"`);
  // spaeter Hinflug: Ankunft nach ECET -> Warnung, kein Rueckflug
  await planRoute(page, "LOLW", "LOWZ", "18:45");
  const s = await page.evaluate(() => ({ box: (document.querySelector("#out .retbox") || {}).textContent || "", night: RES.routes[0].night,
    hint: RES.routes[0].hints.some(h => /nach ECET/.test(h.t)) }));
  ok(s.night && s.hint && /Kein R.ckflug/.test(s.box), `${tag} Hinflug nach ECET gewarnt: "${s.box.slice(0, 100)}"`);
  ok(!errors.length, `${tag} keine JS-Fehler ${JSON.stringify(errors)}`);
  await browser.close();
}
process.exit(fails ? 1 : 0);
