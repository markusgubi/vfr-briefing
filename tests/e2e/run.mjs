// Browser-Test mit simulierten Daten: node tests/e2e/run.mjs [VON] [NACH] [gut|tief] [mobil]
// Voraussetzung: "npm run dev" laeuft auf Port 8787, Playwright ist installiert.
import { createRequire } from "node:module";
import { openaip, openmeteo } from "./mock.mjs";

const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch (e) { pw = require(process.env.PLAYWRIGHT_PATH || "/opt/node-tools/node_modules/playwright"); }

const [from = "LOLW", to = "LOWZ", scenario = "gut", mode = ""] = process.argv.slice(2);
const OUT = process.env.OUT || ".";
const browser = await pw.chromium.launch();
const mob = mode === "mobil";
const ctx = await browser.newContext(mob ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push("pageerror: " + e.message));
page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
const json = (r, o) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(o) });
await page.route("https://api.core.openaip.net/**", r => json(r, openaip(r.request().url())));
const DELAY = +(process.env.DELAY || 0);   // ms Verzoegerung je Wetterabfrage (zum Pruefen der Fortschrittsanzeige)
let wxN = 0;
await page.route("https://api.open-meteo.com/**", async r => { if (DELAY) await new Promise(ok => setTimeout(ok, DELAY * ++wxN)); return json(r, openmeteo(r.request().url(), scenario)); });
await page.route("**/awx?**", r => json(r, { metar: [], taf: [] }));
const LEAF = process.env.LEAFLET_DIR;  // optional: lokales leaflet/dist, falls das CDN nicht erreichbar ist
if (LEAF) await page.route("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/**", r => {
  const f = r.request().url().split("/").pop().replace(".min", "");
  return r.fulfill({ path: LEAF + "/" + f });
});
await page.route("https://*.tile.opentopomap.org/**", r => r.fulfill({ status: 404, body: "" }));

await page.goto("http://127.0.0.1:8787/");
await page.waitForFunction(() => window.APTDB && APTDB.AT && APTDB.AT.length);
await page.evaluate(async ([f, t, climb]) => {
  await loadCountry("SI", "apt").catch(() => {});
  const all = Object.values(APTDB).flat();
  S.from = all.find(a => a.icao === f); S.to = all.find(a => a.icao === t);
  showSel("fIn", S.from); showSel("tIn", S.to);
  document.getElementById("dTime").value = "10:00";
  if (climb) document.getElementById("climb").value = climb;
}, [from, to, process.env.CLIMB || ""]);
const t0 = Date.now();
const run = page.evaluate(() => plan());
if (DELAY) { await page.waitForTimeout(DELAY * 2.5); await page.locator("#side").screenshot({ path: OUT + "/e2e-fortschritt.png" }); }
await run;
await page.waitForFunction(() => !document.getElementById("go").disabled, null, { timeout: 120000 });
const ms = Date.now() - t0;
const sum = await page.evaluate(() => {
  if (!RES || !RES.routes.length) return { sts: document.getElementById("sts").textContent };
  return {
    sts: document.getElementById("sts").textContent,
    routes: RES.routes.map(R => ({ name: R.name, cat: R.cat, score: R.score, D: Math.round(R.D), ete: Math.round(R.ete),
      circMin: Math.round(R.circMin || 0), circles: (R.circles || []).map(c => ({ x: +c.x.toFixed(1), to: Math.round(c.to) })),
      conflicts: R.conflicts.map(c => c.cause + "@" + c.x0.toFixed(1) + "-" + c.x1.toFixed(1)),
      wps: (R.wps || []).map(w => w.name), p0: Math.round(R.samples[0].p), p1: Math.round(R.samples[1].p) })),
    hints: (RES.routes[RES.sel].hints || []).map(h => h.l + ": " + h.t.replace(/<[^>]+>/g, ""))
  };
});
if (process.env.HOVER && !mob) {
  const box = await page.locator("#profBody svg").boundingBox();
  await page.mouse.move(box.x + box.width * +process.env.HOVER, box.y + box.height * 0.5);
  await page.waitForTimeout(300);
}
await page.screenshot({ path: OUT + "/e2e-" + from + "-" + to + "-" + scenario + (mob ? "-mobil" : "") + ".png", fullPage: false });
console.log(JSON.stringify({ ms, errors, ...sum }, null, 1));
await browser.close();
