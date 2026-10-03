// Gemeinsame Einrichtung fuer Browser-Tests mit simulierten Datenquellen.
import { createRequire } from "node:module";
import { openaip, openmeteo } from "./mock.mjs";

const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch (e) { pw = require(process.env.PLAYWRIGHT_PATH || "/opt/node-tools/node_modules/playwright"); }

export async function openApp({ mob = false, tablet = false, scenario = "gut", url = "http://127.0.0.1:8787/" } = {}) {
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext(tablet ? { viewport: { width: 1180, height: 820 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
    : mob ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  const json = (r, o) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(o) });
  await page.route("https://api.core.openaip.net/**", r => json(r, openaip(r.request().url())));
  await page.route("https://api.open-meteo.com/**", r => json(r, openmeteo(r.request().url(), scenario)));
  await page.route("**/awx?**", r => json(r, { metar: [], taf: [] }));
  if (process.env.LEAFLET_DIR) await page.route("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/**", r =>
    r.fulfill({ path: process.env.LEAFLET_DIR + "/" + r.request().url().split("/").pop().replace(".min", "") }));
  await page.route("https://*.tile.opentopomap.org/**", r => r.fulfill({ status: 404, body: "" }));
  await page.goto(url);
  /* Passwort-Anmeldung (lokal: APP_PASSWORD aus .dev.vars, Standard "test-passwort") */
  if (await page.locator("input[name=password]").count()) {
    if (process.env.SHOT_LOGIN) await page.screenshot({ path: process.env.SHOT_LOGIN });
    await page.fill("input[name=password]", process.env.TEST_PASSWORD || "test-passwort");
    await Promise.all([page.waitForNavigation(), page.click("button[type=submit]")]);
  }
  await page.waitForFunction(() => window.APTDB && APTDB.AT && APTDB.AT.length);
  return { browser, page, errors };
}

export async function planRoute(page, from, to, time = "10:00") {
  await page.evaluate(async ([f, t, tm]) => {
    await loadCountry("SI", "apt").catch(() => {});
    await loadCountry("HR", "apt").catch(() => {});
    const all = Object.values(APTDB).flat();
    S.from = all.find(a => a.icao === f); S.to = all.find(a => a.icao === t);
    showSel("fIn", S.from); showSel("tIn", S.to);
    document.getElementById("dTime").value = tm;
    await plan();
  }, [from, to, time]);
}
