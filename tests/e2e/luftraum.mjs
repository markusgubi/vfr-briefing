// Luftraum-Karte: Naturschutzgebiet (Typ 29) gruen gezeichnet; Klick zeigt alle Luftraeume am Punkt, Antippen eines
// Eintrags hebt dessen Umriss hervor, Wechsel/Schliessen funktioniert (Desktop und iPhone).
import { openApp } from "./lib.mjs";
const OUT = process.env.OUT || ".";
let fails = 0;
const ok = (c, t) => { console.log((c ? "OK   " : "FAIL ") + t); if (!c) fails++; };
for (const mob of [false, true]) {
  const tag = mob ? "iPhone" : "Desktop";
  const { browser, page, errors } = await openApp({ mob });
  if (mob) { await page.click("#mnav button[data-p='main']"); await page.waitForTimeout(400); }
  await page.evaluate(() => { map.invalidateSize(); map.setView([48.05, 13.45], 10, { animate: false }); });
  await page.waitForFunction(() => VIEW_AIR.some(a => /NATIONALPARK TEST/.test(a.name)), null, { timeout: 15000 });
  const nat = await page.evaluate(() => { const a = VIEW_AIR.find(a => /NATIONALPARK TEST/.test(a.name)); return { kind: a.kind, nature: isNature(a) }; });
  ok(nat.kind === "info" && nat.nature, `${tag} Nationalpark als Naturschutz erkannt (Bewertung unveraendert: ${nat.kind})`);
  ok(await page.evaluate(() => /Naturschutz/.test(document.getElementById("legend").textContent)), `${tag} Legende nennt Naturschutz`);
  const pt = await page.evaluate(() => { const p = map.latLngToContainerPoint([48.05, 13.45]), r = document.getElementById("map").getBoundingClientRect(); return { x: r.x + p.x, y: r.y + p.y }; });
  if (mob) await page.touchscreen.tap(pt.x, pt.y); else await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(500);
  const rows = await page.evaluate(() => [...document.querySelectorAll(".asel")].map(e => e.querySelector("b").textContent));
  ok(rows.length >= 2 && rows.some(r => /NATIONALPARK/.test(r)) && rows.some(r => /TMA LOWL 2/.test(r)), `${tag} Klick zeigt mehrere Luftraeume: ${rows.join(" / ")}`);
  const iN = rows.findIndex(r => /NATIONALPARK/.test(r)), iT = rows.findIndex(r => /TMA LOWL 2/.test(r));
  const tapRow = async i => { const loc = page.locator(".asel").nth(i); if (mob) await loc.tap(); else await loc.click(); await page.waitForTimeout(300); };
  await tapRow(iN);
  let st = await page.evaluate(() => ({ sel: asSelIdx, n: asSelLayer.getLayers().length, on: [...document.querySelectorAll(".asel.on b")].map(e => e.textContent) }));
  ok(st.sel === iN && st.n === 2 && /NATIONALPARK/.test(st.on[0] || ""), `${tag} Antippen hebt Nationalpark hervor: ${JSON.stringify(st)}`);
  await page.screenshot({ path: `${OUT}/luftraum-${tag}.png` });
  await tapRow(iT);
  st = await page.evaluate(() => ({ sel: asSelIdx, on: [...document.querySelectorAll(".asel.on b")].map(e => e.textContent) }));
  ok(st.sel === iT && /TMA LOWL 2/.test(st.on[0] || ""), `${tag} Wechsel auf TMA: ${JSON.stringify(st)}`);
  const fit = await page.evaluate(() => ({ t: (document.querySelector(".asfoot") || {}).textContent || "",
    out: !map.getBounds().contains(L.geoJSON({ type: "Feature", geometry: CLICK_HITS[asSelIdx].geometry }).getBounds()) }));
  ok(fit.out ? /ganzen Umriss von TMA LOWL 2/.test(fit.t) : !fit.t, `${tag} Knopf fuer ganzen Umriss nur wenn noetig (ragt hinaus: ${fit.out}): ${fit.t}`);
  await tapRow(iT);
  ok(await page.evaluate(() => asSelIdx === null && asSelLayer.getLayers().length === 0), `${tag} erneutes Antippen blendet aus`);
  if (fit.out) {
    await tapRow(iT);
    const z0 = await page.evaluate(() => map.getZoom());
    const fl = page.locator(".asfoot .asfit"); if (mob) await fl.tap(); else await fl.click();
    await page.waitForTimeout(600);
    st = await page.evaluate(() => ({ z: map.getZoom(), n: asSelLayer.getLayers().length, pop: !!document.querySelector(".leaflet-popup") }));
    ok(st.z < z0 && st.n === 2 && !st.pop, `${tag} ganzen Umriss zeigen: Zoom ${z0} -> ${st.z}, Umriss bleibt`);
    await page.screenshot({ path: `${OUT}/luftraum-${tag}-ganz.png` });
    await page.evaluate(() => map.setView([48.05, 13.45], 10, { animate: false })); await page.waitForTimeout(700);
    if (mob) await page.touchscreen.tap(pt.x, pt.y); else await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(500);
  }
  await tapRow(iN);
  await page.evaluate(() => map.closePopup()); await page.waitForTimeout(200);
  ok(await page.evaluate(() => asSelLayer.getLayers().length === 0), `${tag} Fenster schliessen entfernt den Umriss`);
  ok(!errors.length, `${tag} keine JS-Fehler ` + JSON.stringify(errors));
  await browser.close();
}
process.exit(fails ? 1 : 0);
