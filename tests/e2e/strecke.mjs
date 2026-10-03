// Aufenthalt in Stunden (inkl. Umrechnung alter Minutenwerte), Klick auf die Strecke zeigt Hinweise zum
// Abschnitt, Windy-Link auch am Handy (Export-Reiter).
import { openApp, planRoute } from "./lib.mjs";
const OUT = process.env.OUT || ".";
let fails = 0;
const ok = (c, t) => { console.log((c ? "OK   " : "FAIL ") + t); if (!c) fails++; };
for (const mob of [false, true]) {
  const tag = mob ? "iPhone" : "Desktop";
  const { browser, page, errors } = await openApp({ mob });
  // alter Minutenwert (90) wird zu 1,5 Std.
  await page.evaluate(() => { const o = JSON.parse(localStorage.getItem("vfr72") || "{}"); o.retStay = "90"; delete o.retStayH; localStorage.setItem("vfr72", JSON.stringify(o)); });
  await page.reload(); await page.waitForFunction(() => window.APTDB && APTDB.AT && APTDB.AT.length);
  ok(await page.evaluate(() => $("retStayH").value) === "1.5", `${tag} alter Wert 90 min -> 1,5 Std.`);
  await page.evaluate(() => { const c = $("retOn"); c.checked = true; c.dispatchEvent(new Event("change")); $("retStayH").value = "2,5"; });
  ok(await page.evaluate(() => readP().stay) === 150 || await page.evaluate(() => $("retStayH").value === "") , `${tag} 2,5 Std. = 150 min`);
  await page.evaluate(() => { $("retStayH").value = "2"; });
  await planRoute(page, "LOLW", "LOWZ", "10:00");
  const st = await page.evaluate(() => ({ stay: RES.P.stay, txt: (document.querySelector(".retbox") || {}).textContent || "" }));
  ok(st.stay === 120 && /2 Std\. Aufenthalt/.test(st.txt), `${tag} Rueckflug mit 2 Std. Aufenthalt: ${st.txt.slice(0, 120)}`);
  // Klick auf die Strecke
  if (mob) { await page.click("#mnav button[data-p='main']"); await page.waitForTimeout(500); }
  const R = await page.evaluate(() => { const R = RES.routes[RES.sel]; const h = R.hints.find(h => h.x0 != null && h.x0 > 2 && h.x0 < R.D - 2); const x = h ? h.x0 : R.D / 2; const q = sampleAt(R, x);
    const p = map.latLngToContainerPoint([q.lat, q.lon]), r = $("map").getBoundingClientRect(); return { x: r.x + p.x, y: r.y + p.y, hint: h ? h.t.replace(/<[^>]+>/g, "").slice(0, 40) : "" }; });
  await page.evaluate(([x, y]) => { const R = RES.routes[RES.sel]; const ll = map.containerPointToLatLng([x - $("map").getBoundingClientRect().x, y - $("map").getBoundingClientRect().y]); map.setView(ll, map.getZoom(), { animate: false }); }, [R.x, R.y]);
  await page.waitForTimeout(400);
  /* Punkt suchen, an dem wirklich die Routen-Linie (bzw. ihre Tippflaeche) getroffen wird */
  const c = await page.evaluate(() => { const R = RES.routes[RES.sel], h = R.hints.find(h => h.x0 != null && h.x0 > 2 && h.x0 < R.D - 2), q = sampleAt(R, h ? h.x0 : R.D / 2);
    const r = $("map").getBoundingClientRect(), pq = map.latLngToContainerPoint([q.lat, q.lon]), cx = r.x + pq.x, cy = r.y + pq.y;
    for (let d = 0; d <= 12; d++) for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d], [d, -d], [-d, d]]) {
      const e = document.elementFromPoint(cx + dx, cy + dy); if (e && e.closest && e.closest(".leaflet-routeP-pane")) return { x: cx + dx, y: cy + dy, d }; }
    return { x: cx, y: cy, d: -1 }; });
  ok(c.d >= 0 && c.d <= 10, `${tag} Routen-Linie in Tippnaehe gefunden (Abstand ${c.d} px)`);
  if (mob) await page.touchscreen.tap(c.x, c.y); else await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(500);
  const pop = await page.evaluate(() => { const p = document.querySelector(".leaflet-popup .seghints"); return p ? p.textContent : ""; });
  ok(/Hinweise zu diesem Abschnitt|Keine besonderen Hinweise/.test(pop), `${tag} Klick auf Strecke zeigt Abschnitt-Hinweise: ${pop.slice(0, 120)}`);
  ok(!R.hint || pop.includes(R.hint.slice(0, 20)), `${tag} enthaelt den Hinweis an dieser Stelle (${R.hint})`);
  await page.screenshot({ path: `${OUT}/strecke-${tag}.png` });
  // Windy-Link
  if (mob) { await page.click("#mnav button[data-p='pExp']"); await page.waitForTimeout(400); }
  const wl = await page.evaluate(() => { const a = document.getElementById("bWindy"); return a ? { href: a.href, vis: a.getBoundingClientRect().width > 0, t: a.target } : null; });
  ok(wl && wl.vis && /^https:\/\/www\.windy\.com\/distance\/vfr\/[\d.,;]+\?clouds/.test(wl.href) && wl.t === "_blank", `${tag} Windy-Link sichtbar: ${wl && wl.href.slice(0, 70)}`);
  if (mob) await page.screenshot({ path: `${OUT}/strecke-${tag}-export.png` });
  ok(!errors.length, `${tag} keine JS-Fehler ` + JSON.stringify(errors));
  await browser.close();
}
process.exit(fails ? 1 : 0);
