// Desktop-Layout: Seitenleiste ziehen, Profilhoehe ziehen, Karte maximieren; Werte bleiben gespeichert.
// iPhone: keine Zieh-Griffe, Layout unveraendert.
import { openApp, planRoute } from "./lib.mjs";
const OUT = process.env.OUT || ".";
let fails = 0;
const ok = (c, t) => { console.log((c ? "OK   " : "FAIL ") + t); if (!c) fails++; };
{
  const { browser, page, errors } = await openApp();
  await page.evaluate(() => { try { localStorage.removeItem("vfrSideW"); localStorage.removeItem("vfrProfPx"); } catch (e) {} });
  await page.reload(); await page.waitForFunction(() => window.APTDB && APTDB.AT && APTDB.AT.length);
  await planRoute(page, "LOLW", "LOWZ", "10:00");
  const box = sel => page.evaluate(s => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }, sel);
  const drag = async (x, y, x2, y2) => { await page.mouse.move(x, y); await page.mouse.down(); for (let i = 1; i <= 8; i++) { await page.mouse.move(x + (x2 - x) * i / 8, y + (y2 - y) * i / 8); await page.waitForTimeout(30); } await page.mouse.up(); await page.waitForTimeout(400); };
  // Seitenleiste breiter
  const s0 = await box("#side"), sp = await box("#split"), m0 = await box("#map");
  await drag(sp.x + sp.w / 2, sp.y + sp.h / 2, sp.x + sp.w / 2 + 150, sp.y + sp.h / 2);
  const s1 = await box("#side"), m1 = await box("#map");
  ok(Math.abs(s1.w - s0.w - 150) < 6 && Math.abs(m1.w - (m0.w - 150)) < 8, `Seitenleiste ${Math.round(s0.w)} -> ${Math.round(s1.w)} px, Karte ${Math.round(m0.w)} -> ${Math.round(m1.w)} px`);
  ok(await page.evaluate(() => map.getSize().x) === Math.round(m1.w), "Karte neu vermessen");
  // Profil hoeher
  const p0 = await box("#profSvg"), g = await box("#profGrip");
  await drag(g.x + g.w / 2, g.y + g.h / 2, g.x + g.w / 2, g.y + g.h / 2 - 150);
  const p1 = await box("#profSvg");
  ok(p1.h > p0.h + 120 && p1.h < p0.h + 180, `Profil ${Math.round(p0.h)} -> ${Math.round(p1.h)} px hoch`);
  const nan = await page.evaluate(() => /NaN|Infinity/.test(document.getElementById("profSvg").innerHTML));
  ok(!nan, "Profil ohne NaN nach Hoehenaenderung");
  await page.screenshot({ path: OUT + "/layout-gross.png" });
  // Profil-Klick/Cursor funktioniert weiter: Bewertung unveraendert
  // Maximieren
  await page.click(".maxctl a"); await page.waitForTimeout(400);
  let st = await page.evaluate(() => ({ side: getComputedStyle(document.getElementById("side")).display, mw: map.getSize().x, ww: innerWidth }));
  ok(st.side === "none" && st.mw > st.ww - 5, `Karte maximiert: Seitenleiste ${st.side}, Karte ${st.mw}/${st.ww}`);
  await page.screenshot({ path: OUT + "/layout-max.png" });
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  st = await page.evaluate(() => ({ side: getComputedStyle(document.getElementById("side")).display, mw: map.getSize().x }));
  ok(st.side !== "none" && Math.abs(st.mw - Math.round(m1.w)) < 4, `Esc stellt zurueck: Karte ${st.mw}`);
  // Gespeichert nach Neuladen
  await page.reload(); await page.waitForFunction(() => window.APTDB && APTDB.AT && APTDB.AT.length);
  const s2 = await box("#side");
  ok(Math.abs(s2.w - s1.w) < 3, `Breite gespeichert: ${Math.round(s2.w)} px`);
  await planRoute(page, "LOLW", "LOWZ", "10:00");
  const p2 = await box("#profSvg");
  ok(Math.abs(p2.h - p1.h) < 6, `Profilhoehe gespeichert: ${Math.round(p2.h)} px`);
  // Doppelklick = Standard
  const sp2 = await box("#split"); await page.mouse.dblclick(sp2.x + sp2.w / 2, sp2.y + sp2.h / 2); await page.waitForTimeout(400);
  const g2 = await box("#profGrip"); await page.mouse.dblclick(g2.x + g2.w / 2, g2.y + g2.h / 2); await page.waitForTimeout(500);
  const s3 = await box("#side"), p3 = await box("#profSvg");
  ok(Math.abs(s3.w - s0.w) < 3 && Math.abs(p3.h - p3.w * 250 / 1100) < 3, `Doppelklick: Standard ${Math.round(s3.w)} px / ${Math.round(p3.h)} px (Seitenverhaeltnis wie vorher)`);
  ok(!errors.length, "Desktop keine JS-Fehler " + JSON.stringify(errors));
  await browser.close();
}
{
  const { browser, page, errors } = await openApp({ mob: true });
  const vis = await page.evaluate(() => ["#split", "#profGrip", ".maxctl"].map(s => { const e = document.querySelector(s); return e ? getComputedStyle(e).display : "fehlt"; }));
  ok(vis.every(v => v === "none"), "iPhone: keine Zieh-Griffe/Maximieren " + vis.join(","));
  ok(!errors.length, "iPhone keine JS-Fehler " + JSON.stringify(errors));
  await browser.close();
}
process.exit(fails ? 1 : 0);
