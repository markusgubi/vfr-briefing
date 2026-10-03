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
// Hineinzoomen: sichtbarer Abschnitt wird im Profil hinterlegt
await page.evaluate(() => { const R = RES.routes[RES.sel], q = R.samples[Math.floor(R.samples.length / 2)]; map.setView([q.lat, q.lon], 11, { animate: false }); });
await page.waitForTimeout(600);
const band = await page.evaluate(() => [...document.querySelectorAll("#pview rect")].map(r => [+r.getAttribute("x"), +r.getAttribute("width"), RES.pv.W]));
ok(band.length >= 1 && band[0][1] > 3 && band[0][1] < band[0][2] * 0.5, "Kartenausschnitt im Profil markiert: " + JSON.stringify(band));
await page.screenshot({ path: OUT + "/grenze-ausschnitt.png" });
// Bearbeiten: Wegpunkt in die Naehe eines Orts ziehen -> rastet dort ein und traegt dessen Namen
await page.evaluate(() => startEdit());
await page.waitForTimeout(500);
await page.evaluate(() => { const R = RES.routes[RES.sel], q = R.samples[Math.floor(R.samples.length * 0.3)]; routeLineClick(R, { latlng: L.latLng(q.lat, q.lon) }); });
await page.waitForTimeout(800);
await page.evaluate(() => { const p = EDIT.pts.find((q, i) => i > 0 && !q.shape && !q.name); map.setView([p.lat, p.lon], 11, { animate: false }); });
await page.waitForTimeout(800);
const tgt = await page.evaluate(() => {
  const mk = [...document.querySelectorAll(".wpk")].filter(e => /^\d+$/.test(e.textContent.trim())).map(e => e.getBoundingClientRect()).filter(b => b.width)[0];
  if (!mk) return null;
  const c = { x: mk.x + mk.width / 2, y: mk.y + mk.height / 2 }, mr = document.getElementById("map").getBoundingClientRect();
  const ll = map.containerPointToLatLng([c.x - mr.x, c.y - mr.y]);
  const t = RES.G.PLACES.map(q => ({ q, d: distNm(q, { lat: ll.lat, lon: ll.lng }) })).filter(x => x.d > 0.8 && x.d < 6).sort((a, b) => a.d - b.d)[0];
  if (!t) return null;
  const p = map.latLngToContainerPoint([t.q.lat, t.q.lon]);
  return { x: c.x, y: c.y, tx: p.x + mr.x + 6, ty: p.y + mr.y + 5, name: t.q.name };
});
if (!tgt) ok(false, "kein Ort zum Einrasten in der Naehe gefunden");
else {
  await page.mouse.move(tgt.x, tgt.y); await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(tgt.x + (tgt.tx - tgt.x) * i / 12, tgt.y + (tgt.ty - tgt.y) * i / 12); await page.waitForTimeout(30); }
  const ring = await page.evaluate(() => [...document.querySelectorAll(".rptip")].map(e => e.textContent).join("|"));
  await page.screenshot({ path: OUT + "/grenze-einrasten.png" });
  await page.mouse.up(); await page.waitForTimeout(1200);
  const names = await page.evaluate(() => EDIT.pts.map(p => p.name).filter(Boolean));
  ok(ring.includes(tgt.name), "Einrast-Anzeige beim Ziehen: " + tgt.name + " / " + ring);
  ok(names.includes(tgt.name), "Wegpunkt rastet am Ort ein: " + tgt.name + " -> " + names.join(", "));
}
ok(!errors.length, "keine JS-Fehler " + JSON.stringify(errors));
await browser.close();
process.exit(fails ? 1 : 0);
