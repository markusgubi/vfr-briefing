// iPhone: "+"-Griffe zum Einfuegen, Tipp ins Profil springt zur Karte.
import { openApp, planRoute } from "./lib.mjs";
const OUT = process.env.OUT || ".";
const { browser, page, errors } = await openApp({ mob: true });
const ok = (c, m) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const nWp = () => page.evaluate(() => EDIT.pts.filter(p => !p.shape).length);
await planRoute(page, "LOLW", "LOWZ");
// Zeitfehler: direkt nach dem Berechnen einen anderen Reiter oeffnen, dann zur Karte
await page.evaluate(() => showPane("pRes")); await page.waitForTimeout(200);
await page.evaluate(() => showPane("main")); await page.waitForTimeout(300);
ok(await page.evaluate(() => map.getZoom()) >= 6, "Karte nach schnellem Reiterwechsel richtig eingepasst (Zoom " + await page.evaluate(() => map.getZoom()) + ")");
await page.click("#mnav button[data-p='pRes']");
await page.click("#bEdit"); await page.waitForTimeout(500);
ok(await page.evaluate(() => document.getElementById("main").classList.contains("on")), "Bearbeiten wechselt zur Karte");
const n0 = await nWp(), plus = page.locator(".wpadd");
ok(await plus.count() > 0, "+-Griffe sichtbar: " + await plus.count());
await page.screenshot({ path: OUT + "/i-edit-plus.png" });
await plus.first().tap(); await page.waitForTimeout(800);
const n1 = await nWp();
ok(n1 === n0 + 1, "+ antippen fuegt Wegpunkt ein (" + n0 + " -> " + n1 + ")");
// + ziehen (Touch ueber Maus-Emulation reicht fuer Leaflet-Drag)
const b = await page.locator(".wpadd").first().boundingBox();
await page.mouse.move(b.x + 11, b.y + 11); await page.mouse.down();
for (let i = 1; i <= 8; i++) { await page.mouse.move(b.x + 11 + i * 3, b.y + 11 - i * 2); await page.waitForTimeout(30); }
await page.mouse.up(); await page.waitForTimeout(900);
const n2 = await nWp();
ok(n2 === n1 + 1, "+ ziehen fuegt Wegpunkt ein (" + n1 + " -> " + n2 + ")");
await page.screenshot({ path: OUT + "/i-edit-plus2.png" });
// Tipp ins Profil -> Karte mit Marker
await page.evaluate(() => stopEdit());
await page.click("#mnav button[data-p='pProf']"); await page.waitForTimeout(300);
/* seit 9.16: nur ein Tipp auf die Hoehenlinie springt zur Karte */
const lp = await page.evaluate(() => { const R = RES.routes[RES.sel], pv = RES.pv, svg = $("profSvg").querySelector("svg"), r = svg.getBoundingClientRect();
  const P = svg.createSVGPoint(); for (let x = 0; x < R.D; x += 0.5) { P.x = pv.X(x); P.y = pv.Y(sampleAt(R, x).p); const s = P.matrixTransform(svg.getScreenCTM());
    if (s.x > r.x + 40 && s.x < Math.min(r.right, innerWidth) - 40) return { x: s.x, y: s.y }; } return null; });
await page.touchscreen.tap(lp.x, lp.y); await page.waitForTimeout(600);
const st = await page.evaluate(() => ({ map: document.getElementById("main").classList.contains("on"), mk: !!CUR.mk, inView: CUR.mk ? map.getBounds().contains(CUR.mk.getLatLng()) : false }));
ok(st.map && st.mk && st.inView, "Tipp ins Profil zeigt die Stelle auf der Karte " + JSON.stringify(st));
await page.screenshot({ path: OUT + "/i-profil-karte.png" });
ok(errors.length === 0, "keine JS-Fehler " + JSON.stringify(errors));
await browser.close();
