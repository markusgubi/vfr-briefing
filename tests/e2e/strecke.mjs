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
  // Hoehenlinie im Profil in Ampelfarben (wie die Karte)
  const cols = await page.evaluate(() => [...document.querySelectorAll("#profSvg path")].map(p => p.getAttribute("stroke")).filter(c => CAT_COL.includes(c)));
  ok(cols.length >= 1, `${tag} Hoehenlinie in Ampelfarbe: ${[...new Set(cols)].join(",")}`);
  ok(await page.evaluate(() => { const R = RES.routes[RES.sel]; return [...new Set(R.rs.map(r => r.cat))].every(c => [...document.querySelectorAll("#profSvg path")].some(p => p.getAttribute("stroke") === CAT_COL[c])); }), `${tag} jede Einstufung der Route im Profil vertreten`);
  if (mob) {
    // Handy: kein Kartenausschnitt im Profil; Tipp abseits der Linie bleibt im Profil, Tipp auf die Linie springt zur Karte
    await page.click("#mnav button[data-p='main']"); await page.waitForTimeout(300);
    await page.evaluate(() => map.setZoom(11)); await page.waitForTimeout(400);
    await page.click("#mnav button[data-p='pProf']"); await page.waitForTimeout(400);
    ok(await page.evaluate(() => !document.querySelector("#pview rect")), "iPhone: kein Kartenausschnitt im Profil");
    const pts = await page.evaluate(() => { const R = RES.routes[RES.sel], pv = RES.pv, x = R.D * 0.4, q = sampleAt(R, x), svg = $("profSvg").querySelector("svg");
      const m = svg.getScreenCTM(), P = svg.createSVGPoint(); P.x = pv.X(x); P.y = pv.Y(q.p); const on = P.matrixTransform(m);
      P.y = pv.Y(q.p) + 120 > pv.H - pv.Bp ? pv.Y(q.p) - 120 : pv.Y(q.p) + 120; const off = P.matrixTransform(m);
      const pb = $("profBody"); pb.scrollLeft = Math.max(0, on.x - pb.getBoundingClientRect().x - 150);
      const m2 = svg.getScreenCTM(); P.y = pv.Y(q.p); const on2 = P.matrixTransform(m2); P.y = off.y === undefined ? 0 : (pv.Y(q.p) + 120 > pv.H - pv.Bp ? pv.Y(q.p) - 120 : pv.Y(q.p) + 120); const off2 = P.matrixTransform(m2);
      return { on: [on2.x, on2.y], off: [off2.x, off2.y] }; });
    await page.touchscreen.tap(pts.off[0], pts.off[1]); await page.waitForTimeout(500);
    ok(await page.evaluate(() => $("pProf").classList.contains("on")), "iPhone: Tipp neben die Hoehenlinie bleibt im Profil");
    await page.touchscreen.tap(pts.on[0], pts.on[1]); await page.waitForTimeout(600);
    ok(await page.evaluate(() => $("main").classList.contains("on")), "iPhone: Tipp auf die Hoehenlinie springt zur Karte");
  } else {
    await page.evaluate(() => map.setZoom(11)); await page.waitForTimeout(500);
    const vb = await page.evaluate(() => [...document.querySelectorAll("#pview rect")].map(r => r.getAttribute("fill")));
    ok(vb.length && vb.every(f => f === "#0F1D2A"), `Desktop: Kartenausschnitt grau (nicht wie Luftraum blau): ${vb.join(",")}`);
    await page.evaluate(() => map.fitBounds(L.latLngBounds(RES.routes[RES.sel].coords), { animate: false })); await page.waitForTimeout(400);
  }
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
  // Tipp knapp neben die Strecke in einem Luftraum (TMA LOWL bei NM 8): trotzdem der Streckenabschnitt, nicht der Luftraum
  const off = mob ? 18 : 9;
  const nb = await page.evaluate(([off]) => { map.closePopup(); const R = RES.routes[RES.sel], q = sampleAt(R, 8), q2 = sampleAt(R, 9);
    map.setView([q.lat, q.lon], 10, { animate: false });
    const a = map.latLngToContainerPoint([q.lat, q.lon]), b = map.latLngToContainerPoint([q2.lat, q2.lon]), dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    const r = $("map").getBoundingClientRect(); return { x: r.x + a.x - dy / l * off, y: r.y + a.y + dx / l * off,
      air: VIEW_AIR.some(A => inGeom(A.geometry, q.lon, q.lat)) }; }, [off]);
  await page.waitForTimeout(400);
  if (mob) await page.touchscreen.tap(nb.x, nb.y); else await page.mouse.click(nb.x, nb.y);
  await page.waitForTimeout(500);
  const pop2 = await page.evaluate(() => ({ seg: !!document.querySelector(".leaflet-popup .seghints"), air: !!document.querySelector(".leaflet-popup .asel") }));
  ok(pop2.seg && !pop2.air, `${tag} Tipp ${off} px neben die Strecke (Luftraum darunter: ${nb.air}) zeigt den Abschnitt: ${JSON.stringify(pop2)}`);
  await page.evaluate(() => map.closePopup());
  // Bearbeiten: bei Platzmangel Nummer statt Name, beim Hineinzoomen der Name
  if (mob) { await page.click("#mnav button[data-p='main']"); await page.waitForTimeout(300); }
  await page.evaluate(() => { map.closePopup(); startEdit(); EDIT.pts.forEach((p, i) => { if (i > 0 && i < EDIT.pts.length - 1 && !p.shape && !p.name) p.name = "Langer Ortsname " + i; }); drawEditMarkers(RES.routes[RES.sel]); });
  /* Namensschilder duerfen nichts ueberdecken (reine Nummern bei sehr nahen Punkten schon) */
  const lab = async () => page.evaluate(() => { const all = [...document.querySelectorAll(".wpk")], els = all.map(e => e.getBoundingClientRect()); let ov = 0;
    for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) { const a = els[i], b = els[j];
      if (!/Langer/.test(all[i].textContent) && !/Langer/.test(all[j].textContent)) continue;
      if (a.x < b.x + b.width - 2 && b.x < a.x + a.width - 2 && a.y < b.y + b.height - 2 && b.y < a.y + a.height - 2) ov++; }
    return { ov, named: [...document.querySelectorAll(".wpk")].filter(e => /Langer/.test(e.textContent)).length, n: els.length }; });
  await page.evaluate(() => map.setZoom(7)); await page.waitForTimeout(500);
  const l7 = await lab();
  await page.evaluate(() => map.setZoom(11)); await page.waitForTimeout(500);
  const l11 = await lab();
  ok(l7.ov === 0 && l7.named < l7.n, `${tag} Zoom 7: kein Name ueberdeckt etwas, ${l7.named}/${l7.n} mit Namen`);
  ok(l11.named >= l7.named, `${tag} Zoom 11: ${l11.named}/${l11.n} mit Namen`);
  await page.evaluate(() => stopEdit());
  // Windy-Link
  if (mob) { await page.click("#mnav button[data-p='pExp']"); await page.waitForTimeout(400); }
  const wl = await page.evaluate(() => { const a = document.getElementById("bWindy"); return a ? { href: a.href, vis: a.getBoundingClientRect().width > 0, t: a.target } : null; });
  ok(wl && wl.vis && /^https:\/\/www\.windy\.com\/distance\/vfr\/[\d.,;]+\?clouds/.test(wl.href) && wl.t === "_blank", `${tag} Windy-Link sichtbar: ${wl && wl.href.slice(0, 70)}`);
  if (mob) await page.screenshot({ path: `${OUT}/strecke-${tag}-export.png` });
  ok(!errors.length, `${tag} keine JS-Fehler ` + JSON.stringify(errors));
  await browser.close();
}
process.exit(fails ? 1 : 0);
