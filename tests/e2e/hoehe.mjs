// Belastungstest: Hoehen im Profil ziehen (echte Maus- und Fingereingaben ueber CDP).
// Prueft je Zug: Hoehe uebernommen, Griff steht danach an der neuen Hoehe, kein haengender Zug,
// auch bei schnell aufeinanderfolgenden Zuegen, Zuegen ueber den Rand hinaus und Wackeln.
import { openApp, planRoute } from "./lib.mjs";
const OUT = process.env.OUT || ".";
let fails = 0;
const ok = (c, t) => { console.log((c ? "OK   " : "FAIL ") + t); if (!c) fails++; };

async function handle(page, leg) {
  return page.evaluate(leg => {
    const R = RES.routes[RES.sel], l = R.legX && R.legX.find(x => x.leg === leg), pv = RES.pv, svg = document.querySelector("#profBody svg");
    if (!l) return null;
    const m = svg.getScreenCTM(), A = svg.createSVGPoint();
    A.x = pv.X((l.x0 + l.x1) / 2); A.y = pv.Y(l.alt);
    const a = A.matrixTransform(m);
    return { x: a.x, y: a.y, alt: l.alt, pxPerFt: (pv.Y(0) - pv.Y(1000)) / 1000 * m.d };
  }, leg);
}
const state = page => page.evaluate(() => ({ drag: !!EDIT.drag, freeze: RES.pvFreeze || null, ua: Object.assign({}, EDIT.ua),
  legs: RES.routes[RES.sel].legX.map(l => ({ leg: l.leg, alt: l.alt })) }));

async function run(mob) {
  const tag = mob ? "iPhone" : "Desktop";
  const { browser, page, errors } = await openApp({ mob });
  await planRoute(page, "LOLW", "LOWZ");
  await page.click("#bEdit"); await page.waitForTimeout(500);
  if (mob) { await page.click("#mnav button[data-p='pProf']"); await page.waitForTimeout(400); }
  const cdp = mob ? await page.context().newCDPSession(page) : null;
  const touch = async (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  async function dragTo(leg, dy, opt = {}) {
    if (mob) {   // Griff in den sichtbaren Bereich wischen
      const h0 = await handle(page, leg);
      await page.evaluate(x => { document.getElementById("profBody").scrollLeft += x - 195; }, h0.x);
      await page.waitForTimeout(150);
    }
    const h = await handle(page, leg);
    const x = h.x + (opt.dx || 0), y = h.y, y2 = y + dy, steps = opt.steps || 12;
    if (mob) {
      await touch("touchStart", x, y);
      for (let i = 1; i <= steps; i++) { await touch("touchMove", x + (opt.wiggle ? (i % 2 ? 6 : -6) : 0), y + dy * i / steps); await page.waitForTimeout(opt.fast ? 4 : 20); }
      await touch("touchEnd");
    } else {
      await page.mouse.move(x, y); await page.mouse.down();
      for (let i = 1; i <= steps; i++) { await page.mouse.move(x + (opt.wiggle ? (i % 2 ? 6 : -6) : 0), y + dy * i / steps); if (!opt.fast) await page.waitForTimeout(20); }
      await page.mouse.up();
    }
    await page.waitForTimeout(opt.pause ?? 400);
    return h;
  }
  const legs = (await state(page)).legs;
  const mid = legs.slice(1, -1);
  let n = 0;
  for (const round of [0, 1]) for (const l of [legs[0], ...mid, legs[legs.length - 1]]) {
    const before = await handle(page, l.leg);
    const want = Math.max(1500, Math.min(12000, before.alt + (round ? -1500 : 2000)));
    const dy = -(want - before.alt) * before.pxPerFt;
    await dragTo(l.leg, dy, { wiggle: n % 3 === 1, fast: n % 3 === 2, pause: n % 2 ? 120 : 400 });
    await page.waitForTimeout(350);
    const s = await state(page), got = s.ua[l.leg], after = await handle(page, l.leg);
    ok(!s.drag && !s.freeze, `${tag} Zug ${++n} beendet (kein haengender Zug)`);
    ok(got != null && Math.abs(got - want) <= 150, `${tag} Teilstrecke ${l.leg}: ${before.alt} -> ${got} (Ziel ${want})`);
    ok(after && after.alt === got, `${tag} Griff steht an der neuen Hoehe (${after && after.alt})`);
  }
  // schnell hintereinander auf denselben Griff (frueher als Doppeltipp = Zuruecksetzen erkannt)
  const l0 = legs[Math.min(1, legs.length - 1)].leg;
  for (let k = 0; k < 3; k++) {
    const h = await handle(page, l0), want = h.alt + 500;
    await dragTo(l0, -500 * h.pxPerFt, { pause: 60 });
    await page.waitForTimeout(300);
    const s = await state(page);
    ok(s.ua[l0] != null && Math.abs(s.ua[l0] - want) <= 150, `${tag} schneller Folgezug ${k + 1}: ${h.alt} -> ${s.ua[l0]} (Ziel ${want})`);
  }
  // ueber den oberen Rand hinaus ziehen und dort loslassen
  const hTop = await handle(page, l0);
  await dragTo(l0, -(hTop.y + 200), {});
  let s = await state(page);
  ok(!s.drag && !s.freeze && s.ua[l0] <= 15000 && s.ua[l0] > hTop.alt, `${tag} Zug ueber den Rand: ${hTop.alt} -> ${s.ua[l0]}`);
  // Doppeltipp setzt zurueck
  const hD = await handle(page, l0);
  if (mob) { await touch("touchStart", hD.x, hD.y); await touch("touchEnd"); await page.waitForTimeout(80); await touch("touchStart", hD.x, hD.y); await touch("touchEnd"); }
  else await page.mouse.dblclick(hD.x, hD.y);
  await page.waitForTimeout(400);
  s = await state(page);
  ok(s.ua[l0] == null, `${tag} Doppeltipp setzt Teilstrecke ${l0} auf automatisch`);
  await page.screenshot({ path: `${OUT}/hoehe-${tag}.png` });
  ok(!errors.length, `${tag} keine JS-Fehler ${JSON.stringify(errors)}`);
  await browser.close();
}
await run(false);
await run(true);
console.log(fails ? fails + " FEHLER" : "ALLES OK");
process.exit(fails ? 1 : 0);
