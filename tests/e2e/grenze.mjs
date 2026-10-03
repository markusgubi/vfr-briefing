// Grenzuebertritt ohne Meldepunkt und ohne FIR des Nachbarlands (AT -> IT): Uebertritt ueber einen markanten Ort,
// Orte entlang der Route auf der Karte, Ortsnamen an Wegpunkten.
import { openApp, planRoute } from "./lib.mjs";
const OUT = process.env.OUT || ".";
let fails = 0;
const ok = (c, t) => { console.log((c ? "OK   " : "FAIL ") + t); if (!c) fails++; };
const { browser, page, errors } = await openApp();
await planRoute(page, "LOLW", "LIPV", "10:00");
const r = await page.evaluate(() => {
  const R = RES.routes[0];
  return { name: R.name, cr: (R.crossings || []).map(c => c.fromC + ">" + c.toC), wps: R.wps.map(w => w.name + (w.town ? "|" + w.town : "")),
    notes: R.rpNotes || [], hints: R.hints.filter(h => /Grenz/.test(h.t)).map(h => h.t.replace(/<[^>]+>/g, "")),
    towns: [...document.querySelectorAll(".town")].map(e => e.textContent), places: (RES.G.PLACES || []).length };
});
console.log(JSON.stringify(r, null, 1));
ok(r.places > 0, "Orte geladen: " + r.places);
ok(r.cr.includes("AT>IT"), "Grenzuebertritt AT->IT erkannt (ohne IT-FIR): " + r.cr.join(","));
ok(r.wps.some(w => /Grenzort Test/.test(w)), "Uebertritt ueber den Ort 'Grenzort Test': " + r.wps.join(" / "));
ok(r.hints.some(h => /Grenzort Test/.test(h)), "Hinweis nennt den Ort");
ok(r.towns.length > 0, "Orte auf der Karte: " + r.towns.join(", "));
await page.screenshot({ path: OUT + "/grenze-LOLW-LIPV.png" });
ok(!errors.length, "keine JS-Fehler " + JSON.stringify(errors));
await browser.close();
process.exit(fails ? 1 : 0);
