// Wetterbild-Ueberlagerung (Radar/Satellit) mit simulierten Quellen: Ebene erscheint, Zeit/Quelle stehen dabei,
// Ausfall der Quelle ergibt einen Hinweis statt eines Fehlers.
import { openApp } from "./lib.mjs";
const OUT = process.env.OUT || ".";
let fails = 0;
const ok = (c, t) => { console.log((c ? "OK   " : "FAIL ") + t); if (!c) fails++; };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const { browser, page, errors } = await openApp();
let tiles = 0;
await page.route("https://api.rainviewer.com/**", r => r.fulfill({ status: 200, contentType: "application/json",
  body: JSON.stringify({ host: "https://tilecache.rainviewer.com", radar: { past: [{ time: 1790000000, path: "/v2/radar/1790000000" }] } }) }));
await page.route("https://tilecache.rainviewer.com/**", r => { tiles++; return r.fulfill({ status: 200, contentType: "image/png", body: png }); });
await page.route("https://view.eumetsat.int/**", r => { tiles++; return r.fulfill({ status: 200, contentType: "image/png", body: png }); });
await page.selectOption("#wxLayer", "radar"); await page.waitForTimeout(1200);
let st = await page.evaluate(() => ({ on: !!wxOverlay && map.hasLayer(wxOverlay), info: document.getElementById("wxInfo").textContent }));
ok(st.on && /Radar \d\d:\d\d/.test(st.info) && tiles > 0, "Radar-Ebene sichtbar: " + st.info + " (" + tiles + " Kacheln)");
tiles = 0;
await page.selectOption("#wxLayer", "ir"); await page.waitForTimeout(1200);
st = await page.evaluate(() => ({ on: !!wxOverlay && map.hasLayer(wxOverlay), info: document.getElementById("wxInfo").textContent }));
ok(st.on && /Infrarot/.test(st.info) && tiles > 0, "Satellit-Ebene sichtbar: " + st.info + " (" + tiles + " Kacheln)");
await page.screenshot({ path: OUT + "/wetterbild.png" });
await page.selectOption("#wxLayer", ""); await page.waitForTimeout(300);
ok(await page.evaluate(() => !wxOverlay), "aus: Ebene entfernt");
await page.unroute("https://api.rainviewer.com/**");
await page.route("https://api.rainviewer.com/**", r => r.fulfill({ status: 503, body: "" }));
await page.selectOption("#wxLayer", "radar"); await page.waitForTimeout(15000);
st = await page.evaluate(() => document.getElementById("wxInfo").textContent);
ok(/nicht verf/.test(st), "Ausfall der Quelle ergibt Hinweis: " + st);
ok(!errors.length, "keine JS-Fehler " + JSON.stringify(errors));
await page.evaluate(() => { try { localStorage.removeItem("vfrWxLayer"); } catch (e) {} });
await browser.close();
process.exit(fails ? 1 : 0);
