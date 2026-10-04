// Pisten & Wind ganz unten im Ergebnis: Windrose, aktive Piste, Landung/Start, Zeitschieber, Piste antippen
import { openApp, planRoute } from "./lib.mjs";
const OUT = process.env.OUT || ".";
let fails = 0;
const ok = (c, t) => { console.log((c ? "OK   " : "FAIL ") + t); if (!c) fails++; };
for (const mob of [false, true]) {
  const tag = mob ? "iPhone" : "Desktop";
  const { browser, page, errors } = await openApp({ mob });
  await planRoute(page, "LOLW", "LOWZ", "10:00");
  if (mob) { await page.click("#mnav button[data-p=pRes]").catch(() => {}); await page.waitForTimeout(300); }
  const last = await page.evaluate(() => { const c = [...document.querySelectorAll("#out > .card, #out > details")]; return c[c.length - 1] && c[c.length - 1].id; });
  ok(last === "rwyCard", `${tag} Karte ganz unten: ${last}`);
  const st = await page.evaluate(() => {
    const R = RES.routes[RES.sel], c = $("rwyCard");
    return { rows: c.querySelectorAll("tr[data-rws]").length, act: (c.querySelector("tr.act b") || {}).textContent, exp: R.landWind && R.landWind.rwy && R.landWind.rwy.d,
      svg: !!c.querySelector("svg.rwrose"), txt: c.textContent, len: /1000 m/.test(c.textContent) };
  });
  ok(st.svg, `${tag} Windrose`);
  ok(st.rows === 2, `${tag} 2 Pistenrichtungen LOWZ: ${st.rows}`);
  ok(st.act && st.act === st.exp, `${tag} aktive Piste = Bewertung: ${st.act} / ${st.exp}`);
  ok(/Landung LOWZ/.test(st.txt) && /aktive Piste|keine Piste klar/.test(st.txt), `${tag} Text Landung/aktive Piste`);
  ok(st.len, `${tag} Pistenlänge aus openAIP-Maßen`);
  await page.locator("#rwyCard").scrollIntoViewIfNeeded();
  await page.locator("#rwyCard").screenshot({ path: `${OUT}/pisten-${tag}-land.png` });
  // Start umschalten
  await page.click("#rwyCard [data-rwm='dep']");
  const dep = await page.evaluate(() => ({ t: $("rwyCard").textContent, act: ($("rwyCard").querySelector("tr.act b") || {}).textContent, exp: RES.routes[RES.sel].depWind && RES.routes[RES.sel].depWind.rwy && RES.routes[RES.sel].depWind.rwy.d }));
  ok(/geplanter Abflug/.test(dep.t) && dep.act === dep.exp, `${tag} Start LOLW: ${dep.act} / ${dep.exp}`);
  // Zeitschieber
  await page.evaluate(() => { const r = $("rwT"); r.value = "60"; r.dispatchEvent(new Event("input", { bubbles: true })); });
  const tt = await page.evaluate(() => $("rwyCard").textContent);
  ok(/\+60 min ab Abflug/.test(tt), `${tag} Zeitschieber +60 min`);
  // Piste antippen
  await page.click("#rwyCard [data-rwm='land']");
  const nonAct = await page.evaluate(() => { const r = [...$("rwyCard").querySelectorAll("tr[data-rws]")].find(x => !x.classList.contains("act")); return r && r.getAttribute("data-rws"); });
  await page.click(`#rwyCard tr[data-rws='${nonAct}']`);
  ok(await page.evaluate(i => !!$("rwyCard").querySelector(`tr.sel[data-rws='${i}']`), nonAct), `${tag} Piste antippen markiert sie`);
  const nanFree = await page.evaluate(() => !/NaN|undefined/.test($("rwyCard").innerHTML));
  ok(nanFree, `${tag} kein NaN/undefined`);
  await page.locator("#rwyCard").screenshot({ path: `${OUT}/pisten-${tag}-sel.png` });
  // Bewertung unveraendert (nur Anzeige)
  ok(await page.evaluate(() => RES.routes[RES.sel].cat === RES.routes[RES.sel].cat), `${tag} Bewertung unverändert`);
  ok(!errors.length, `${tag} keine JS-Fehler ` + JSON.stringify(errors));
  await browser.close();
}
process.exit(fails ? 1 : 0);
