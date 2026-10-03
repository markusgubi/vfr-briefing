// Erkundungstest: 5 Routen durchspielen, Strecke und Hoehen ziehen, automatisch pruefen.
// node tests/e2e/explore.mjs  (OUT=Ordner fuer Bilder)
import { openApp, planRoute } from "./lib.mjs";
const OUT = process.env.OUT || ".";
const CASES = [
  ["LOLW", "LOWZ", "gut", "10:00", false],
  ["LOWZ", "LOWK", "tief", "12:00", false],
  ["LOWS", "LOAG", "zeit", "11:00", true],
  ["LOGO", "LJLJ", "gut", "10:00", false],
  ["LOWK", "LOWL", "zeit", "09:00", true]
];
let problems = [];
const P = (c, m) => { problems.push(c + ": " + m); console.log("  PROBLEM " + m); };

/* Pruefungen im Browser: Ueberschneidungen, NaN, Begruendungen, Konsistenz */
async function check(page, tag) {
  const r = await page.evaluate(() => {
    const out = { overlaps: [], nan: false, noReason: [], legs: [] };
    const svg = document.querySelector("#profBody svg");
    if (svg) {
      out.nan = /NaN|Infinity/.test(svg.innerHTML);
      const ts = [...svg.querySelectorAll("text")].filter(t => t.textContent.trim() && !t.closest("#pcur")).map(t => ({ t: t.textContent, b: t.getBBox() }));
      /* Beschriftung ueber einem Hoehen-Griff */
      [...svg.querySelectorAll("#pedit circle")].forEach(c => {
        const cx = +c.getAttribute("cx"), cy = +c.getAttribute("cy");
        ts.forEach(t => { const b = t.b; if (cx + 7 > b.x && cx - 7 < b.x + b.width && cy + 7 > b.y && cy - 7 < b.y + b.height) out.overlaps.push(t.t + " / Griff"); });
      });
      for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
        const a = ts[i].b, b = ts[j].b;
        if (a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1) out.overlaps.push(ts[i].t + " / " + ts[j].t);
      }
    }
    RES.routes.forEach(R => { if (R.cat > 0 && !issueOf(R) && !(R.hints || []).some(h => h.l !== "info")) out.noReason.push(R.name + " (" + R.cat + ")"); });
    const R = RES.routes[RES.sel];
    if (R.userAlt) Object.keys(R.userAlt).forEach(l => {
      const rs = R.rs.filter(r => r.e.leg === +l); if (!rs.length) return;
      const x0 = rs[0].x0, x1 = rs[rs.length - 1].x1, a = R.userAlt[l];
      const qs = R.samples.filter(q => q.x > x0 + (x1 - x0) * 0.5 && q.x < x1 - 0.5 && q.x < R.D - 2);
      /* nicht gehalten = weder auf der Hoehe noch im Steig-/Sinkflug dorthin unterwegs */
      const off = qs.filter((q, k) => { if (Math.abs(q.p - a) <= 1) return false; const prev = R.samples[R.samples.indexOf(q) - 1]; return !prev || (q.p < a ? q.p <= prev.p + 1 : q.p >= prev.p - 1); }).length;
      const hinted = (R.hints || []).some(h => /Eigene H.he/.test(h.t) && h.t.indexOf(String(a)) >= 0);
      if (off && hinted) return;   /* nicht erreichbar, aber dem Nutzer erklaert */
      out.legs.push({ leg: +l, alt: a, n: qs.length, off });
    });
    out.state = { sel: R.name, cat: R.cat, issue: issueOf(R), spiral: +R.spiralMin.toFixed(1), circ: R.circles.length, D: +R.D.toFixed(1) };
    return out;
  });
  if (r.nan) P(tag, "NaN/Infinity im Profil");
  if (r.overlaps.length) P(tag, "Beschriftungen ueberschneiden sich: " + r.overlaps.slice(0, 4).join(" | "));
  if (r.noReason.length) P(tag, "Einstufung ohne Begruendung: " + r.noReason.join(", "));
  r.legs.forEach(l => { if (l.off) P(tag, "eigene Hoehe " + l.alt + " (Teilstrecke " + l.leg + ") nicht gehalten: " + l.off + "/" + l.n); });
  console.log("  " + tag + " -> " + JSON.stringify(r.state));
  return r;
}
async function profPoint(page, leg, alt) {
  return page.evaluate(([leg, alt]) => {
    const R = RES.routes[RES.sel], l = R.legX.find(x => x.leg === leg), pv = RES.pv, svg = document.querySelector("#profBody svg");
    if (!l) return null;
    const m = svg.getScreenCTM(), A = svg.createSVGPoint(), B = svg.createSVGPoint();
    A.x = pv.X((l.x0 + l.x1) / 2); A.y = pv.Y(l.alt); B.x = A.x; B.y = pv.Y(alt);
    const a = A.matrixTransform(m), b = B.matrixTransform(m);
    return { x: a.x, y: a.y, y2: b.y };
  }, [leg, alt]);
}
async function drag(page, x, y, x2, y2) {
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(x + (x2 - x) * i / 10, y + (y2 - y) * i / 10); await page.waitForTimeout(25); }
  await page.mouse.up(); await page.waitForTimeout(700);
}

for (const [from, to, sc, tm, mob] of CASES) {
  const c = from + "-" + to + " " + sc + " " + tm + (mob ? " (iPhone)" : "");
  console.log("== " + c);
  const { browser, page, errors } = await openApp({ scenario: sc, mob });
  await planRoute(page, from, to, tm);
  if (await page.evaluate(() => !RES)) { P(c, "keine Route: " + await page.textContent("#sts")); await browser.close(); continue; }
  const base = await check(page, "berechnet");
  if (mob) await page.click("#mnav button[data-p='main']");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/x-${from}-${to}-1-berechnet.png` });
  // Stift: Bewertung muss gleich bleiben
  const before = await page.evaluate(() => { const R = RES.routes[RES.sel]; return [R.cat, R.score, R.conflicts.length].join("/"); });
  await page.evaluate(() => startEdit());
  const after = await page.evaluate(() => { const R = RES.routes[RES.sel]; return [R.cat, R.score, R.conflicts.length].join("/"); });
  if (before !== after) P(c, "Stift aendert Bewertung " + before + " -> " + after);
  // Punkt einfuegen (Mitte der Route, 3 NM seitlich versetzt) und ziehen
  await page.evaluate(() => { const R = RES.routes[RES.sel], q = R.samples[Math.floor(R.samples.length * 0.45)]; routeLineClick(R, { latlng: L.latLng(q.lat, q.lon) }); });
  await page.waitForTimeout(700);
  if (mob) { await page.click("#mnav button[data-p='main']"); await page.waitForTimeout(300); }
  const mk = page.locator(".wpk").first();
  if (await mk.count()) {
    const b = await mk.boundingBox();
    const k = mob ? 0.35 : 1;   /* auf dem kleineren iPhone-Bild entspricht ein Pixel mehr Strecke */
    await drag(page, b.x + b.width / 2, b.y + b.height / 2, b.x + b.width / 2 + 60 * k, b.y + b.height / 2 - 40 * k);
  } else P(c, "kein ziehbarer Wegpunkt");
  await check(page, "Strecke gezogen");
  await page.screenshot({ path: `${OUT}/x-${from}-${to}-2-strecke.png` });
  // Hoehen ziehen: erste Teilstrecke hoch, letzte runter, dann mittlere hoch
  if (mob) { await page.click("#mnav button[data-p='pProf']"); await page.waitForTimeout(300); }
  const legs = await page.evaluate(() => RES.routes[RES.sel].legX.map(l => ({ leg: l.leg, alt: l.alt })));
  const plan = [[legs[0].leg, legs[0].alt + 2000], [legs[legs.length - 1].leg, Math.max(3000, legs[legs.length - 1].alt - 3000)]];
  if (legs.length > 2) plan.push([legs[1].leg, legs[1].alt + 1000]);
  for (const [leg, alt] of plan) {
    const p = await profPoint(page, leg, alt);
    if (!p) { P(c, "kein Griff fuer Teilstrecke " + leg); continue; }
    if (mob) {   // Finger: Profil seitlich zum Griff wischen, dann Touch-Ziehen ueber Pointer-Events
      await page.evaluate(x => { const pb = document.getElementById("profBody"); pb.scrollLeft += x - 195; }, p.x);
      await page.waitForTimeout(200);
      const q = await profPoint(page, leg, alt); p.x = q.x; p.y = q.y; p.y2 = q.y2;
      await page.evaluate(async ([x, y, y2]) => {
        const el = document.elementFromPoint(x, y), o = { pointerId: 7, pointerType: "touch", bubbles: true, clientX: x, clientY: y };
        el.dispatchEvent(new PointerEvent("pointerdown", o));
        for (let i = 1; i <= 8; i++) { document.getElementById("profTouch").dispatchEvent(new PointerEvent("pointermove", { ...o, clientY: y + (y2 - y) * i / 8 })); await new Promise(r => setTimeout(r, 30)); }
        document.getElementById("profTouch").dispatchEvent(new PointerEvent("pointerup", { ...o, clientY: y2 }));
      }, [p.x, p.y, p.y2]);
      await page.waitForTimeout(600);
    } else await drag(page, p.x, p.y, p.x, p.y2);
  }
  const ua = await page.evaluate(() => EDIT.ua);
  if (Object.keys(ua).length < plan.length) P(c, "nicht alle Hoehen uebernommen: " + JSON.stringify(ua) + " geplant " + JSON.stringify(plan));
  await check(page, "Hoehen gezogen " + JSON.stringify(ua));
  await page.screenshot({ path: `${OUT}/x-${from}-${to}-3-hoehen.png` });
  if (mob) { await page.click("#mnav button[data-p='pExp']"); await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}/x-${from}-${to}-4-export.png` }); }
  // Export muss die eigenen Hoehen enthalten
  const xml = await page.evaluate(() => skyDemonXml(RES.routes[RES.sel]));
  const lv = [...xml.matchAll(/Level="(\d+)"/g)].map(m => +m[1]);
  Object.values(ua).forEach(a => { if (!lv.includes(Math.round(a / 100) * 100)) P(c, "Export ohne eigene Hoehe " + a + ": " + lv.join(",")); });
  if (errors.length) P(c, "JS-Fehler: " + errors.join(" | "));
  await browser.close();
}
console.log("\n" + (problems.length ? problems.length + " PROBLEME:\n" + problems.join("\n") : "KEINE PROBLEME"));
process.exitCode = problems.length ? 1 : 0;
