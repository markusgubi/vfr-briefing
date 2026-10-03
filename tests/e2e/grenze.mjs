// Grenzuebertritt ohne Meldepunkt und ohne FIR des Nachbarlands (AT -> IT) mit den echten Grenzlinien
// (Natural Earth) und Orten (GeoNames) aus public/data: Uebertritt ueber einen markanten Ort, Orte entlang der
// Route auf der Karte, Ortsnamen an Wegpunkten, Wind/Piste bei Start und Landung.
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
    towns: [...document.querySelectorAll(".town")].map(e => e.textContent), places: (RES.G.PLACES || []).length,
    wind: { dep: (R.hints.find(h => /^Start/.test(h.t.replace(/<[^>]+>/g, ""))) || {}).t, land: (R.hints.find(h => /^Landung/.test(h.t.replace(/<[^>]+>/g, ""))) || {}).t } };
});
console.log(JSON.stringify(r, null, 1));
ok(r.places > 0, "Orte geladen: " + r.places);
ok(r.cr.includes("AT>IT"), "Grenzuebertritt AT->IT erkannt (ohne IT-FIR): " + r.cr.join(","));
const town = (r.notes.find(n => n.startsWith("town:")) || "").slice(5);
ok(town, "Uebertritt ueber einen markanten Ort: " + r.notes.join(","));
ok(town && r.wps.some(w => w.split("|")[0] === town), "Ort ist Wegpunkt: " + r.wps.join(" / "));
ok(town && r.hints.some(h => h.includes(town)), "Hinweis nennt den Ort");
ok(r.wind.land && /Piste 23|Piste 05/.test(r.wind.land), "Landepiste LIPV aus Wind: " + r.wind.land);
ok(r.wind.dep && /Piste 27/.test(r.wind.dep), "Startpiste LOLW bei Westwind: " + r.wind.dep);
ok(r.towns.length > 0, "Orte auf der Karte: " + r.towns.join(", "));
await page.screenshot({ path: OUT + "/grenze-LOLW-LIPV.png" });
ok(!errors.length, "keine JS-Fehler " + JSON.stringify(errors));
await browser.close();
process.exit(fails ? 1 : 0);
