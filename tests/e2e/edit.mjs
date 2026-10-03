// Browser-Test: Route und Hoehen bearbeiten (Backlog 4 + 5).
import { openApp, planRoute } from "./lib.mjs";
const OUT = process.env.OUT || ".";
const { browser, page, errors } = await openApp();
const ok = (c, m) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const cur = () => page.evaluate(() => { const R = RES.routes[RES.sel]; return { id: R.id, n: EDIT.pts ? EDIT.pts.filter(p => !p.shape).length : 0, cat: R.cat, conf: R.conflicts.map(c => c.cause),
  ua: Object.assign({}, EDIT.ua), D: +R.D.toFixed(1), miss: (R.airMissing || []).length, far: (R.wxFar || []).length, legs: (R.legX || []).length, wps: R.wps.map(w => w.name) }; });

await planRoute(page, "LOLW", "LOWZ");
await page.click("#bEdit");
let r = await cur();
ok(r.id === "user" && r.n >= 2, "Bearbeiten erzeugt eigene Route: " + JSON.stringify(r));
if (r.n === 2) {   // Direktstrecke: erst einen Punkt einfuegen
  await page.evaluate(() => { const R = RES.routes[RES.sel], q = R.samples[Math.floor(R.samples.length * 0.4)]; routeLineClick(R, { latlng: L.latLng(q.lat, q.lon + 0.05) }); });
  await page.waitForTimeout(500); r = await cur();
  ok(r.n === 3, "Punkt in Direktstrecke eingefuegt");
}

// 1) Wegpunkt auf der Karte ziehen
const mk = page.locator(".wpk").first();
const b = await mk.boundingBox();
await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
await page.mouse.down();
for (let i = 1; i <= 8; i++) { await page.mouse.move(b.x + b.width / 2 + i * 10, b.y + b.height / 2 + i * 6); await page.waitForTimeout(30); }
await page.mouse.up();
await page.waitForTimeout(600);
const r1 = await cur();
ok(r1.id === "user" && r1.D !== r.D, "Ziehen aendert die Route (D " + r.D + " -> " + r1.D + ")");

// 2) Punkt einfuegen per Klick auf die Linie
await page.evaluate(() => { const R = RES.routes[RES.sel], q = R.samples[Math.floor(R.samples.length * 0.7)]; routeLineClick(R, { latlng: L.latLng(q.lat + 0.02, q.lon) }); });
await page.waitForTimeout(500);
const r2 = await cur();
ok(r2.n === r1.n + 1, "Klick auf Linie fuegt Punkt ein (" + r1.n + " -> " + r2.n + ")");

// 3) Punkt loeschen ueber Popup
await page.locator(".wpk").first().click();
await page.locator("[data-delwp]").click();
await page.waitForTimeout(500);
const r3 = await cur();
ok(r3.n === r2.n - 1, "Popup-Knopf loescht Punkt (" + r2.n + " -> " + r3.n + ")");

// 4) Hoehe im Profil nach unten ziehen -> Konflikt
const h = await page.evaluate(() => {
  const R = RES.routes[RES.sel], l = R.legX[R.legX.length - 1], pv = RES.pv, svg = document.querySelector("#profBody svg");
  const pt = svg.createSVGPoint(); pt.x = pv.X((l.x0 + l.x1) / 2); pt.y = pv.Y(l.alt);
  const sp = pt.matrixTransform(svg.getScreenCTM());
  const lo = svg.createSVGPoint(); lo.x = pt.x; lo.y = pv.Y(2500); const sl = lo.matrixTransform(svg.getScreenCTM());
  return { x: sp.x, y: sp.y, y2: sl.y, leg: l.leg, alt: l.alt };
});
await page.mouse.move(h.x, h.y); await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(h.x, h.y + (h.y2 - h.y) * i / 10); await page.waitForTimeout(25); }
await page.mouse.up(); await page.waitForTimeout(400);
const r4 = await cur();
ok(r4.ua[h.leg] != null && r4.ua[h.leg] < h.alt, "Profil-Griff setzt Hoehe " + h.alt + " -> " + r4.ua[h.leg]);
ok(r4.cat === 2 && r4.conf.includes("low"), "Zu tiefe Hoehe ist KRITISCH mit Konflikt: " + r4.conf.join(","));
await page.screenshot({ path: OUT + "/e2e-edit-tief.png" });

// 5) Doppelklick = wieder automatisch
const d5 = await page.evaluate(leg => {
  const R = RES.routes[RES.sel], l = R.legX.find(x => x.leg === leg), pv = RES.pv, svg = document.querySelector("#profBody svg");
  const pt = svg.createSVGPoint(); pt.x = pv.X((l.x0 + l.x1) / 2); pt.y = pv.Y(l.alt);
  const sp = pt.matrixTransform(svg.getScreenCTM()); return { x: sp.x, y: sp.y };
}, h.leg);
await page.mouse.dblclick(d5.x, d5.y);
await page.waitForTimeout(400);
const r5 = await cur();
ok(r5.ua[h.leg] == null, "Doppelklick setzt Hoehe zurueck auf automatisch");

// 6) Punkt weit aus dem geladenen Gebiet ziehen -> Daten werden nachgeladen
await page.evaluate(async () => { EDIT.pts.splice(1, 0, { lat: 46.75, lon: 12.2, name: null }); await commitEdit(); });
const r6 = await cur();
ok(r6.miss === 0, "Luftraum fuer neuen Bereich nachgeladen (fehlend: " + r6.miss + ")");
ok(r6.far === 0, "Wetter fuer neuen Bereich nachgeladen (fern: " + r6.far + ")");
await page.screenshot({ path: OUT + "/e2e-edit.png" });

// 7) Neu berechnen (andere Abflugzeit) behaelt die eigene Route
await page.evaluate(async () => { document.getElementById("dTime").value = "11:00"; await plan(); });
const r7 = await cur();
ok(r7.id === "user", "Eigene Route bleibt nach Neuberechnung erhalten");
ok(errors.length === 0, "keine JS-Fehler " + JSON.stringify(errors));
await browser.close();
