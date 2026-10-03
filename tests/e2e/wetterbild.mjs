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
// Satellit Wolken: Testbild links dunkel (warmer Boden), rechts hell (kalte Wolke) -> links durchsichtig, rechts weiss
const irPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAADJUlEQVR4nO3UMQHAMAzAsHW4wrkQNxg5LCHw5TMz30PWvXc7gUXvdgCwxwAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAgzAAg7Ae6zQXAb+hJ6AAAAABJRU5ErkJggg==", "base64");
let satT = 0;
await page.route("**/sat/ir/**", r => { satT++; return r.fulfill({ status: 200, contentType: "image/png", body: irPng }); });
await page.route("**/sat/nat/**", r => { satT++; return r.fulfill({ status: 200, contentType: "image/png", body: png }); });
await page.selectOption("#wxLayer", "ir"); await page.waitForTimeout(1500);
st = await page.evaluate(() => {
  const cv = [...document.querySelectorAll(".leaflet-tile-container canvas")].find(c => c.width === 256);
  let px = null;
  if (cv) { const g = cv.getContext("2d"), a = g.getImageData(20, 128, 1, 1).data, b = g.getImageData(230, 128, 1, 1).data; px = [a[3], b[3], b[0]]; }
  return { on: !!wxOverlay && map.hasLayer(wxOverlay), info: document.getElementById("wxInfo").textContent, px };
});
ok(st.on && /Infrarot/.test(st.info) && satT > 0, "Satellit Wolken sichtbar: " + st.info + " (" + satT + " Kacheln)");
ok(st.px && st.px[0] === 0 && st.px[1] > 180 && st.px[2] > 230, "wolkenfrei durchsichtig, Wolke weiss: " + JSON.stringify(st.px));
await page.screenshot({ path: OUT + "/wetterbild.png" });
await page.selectOption("#wxLayer", "nat"); await page.waitForTimeout(1200);
st = await page.evaluate(() => ({ on: !!wxOverlay && map.hasLayer(wxOverlay), info: document.getElementById("wxInfo").textContent }));
ok(st.on && /Echtfarben/.test(st.info), "Satellit Echtfarben sichtbar: " + st.info);
// eigener Server erreicht EUMETSAT nicht -> Rohbild direkt von EUMETSAT
await page.unroute("**/sat/ir/**");
await page.route("**/sat/ir/**", r => r.fulfill({ status: 502, contentType: "application/json", body: "{}" }));
tiles = 0;
await page.selectOption("#wxLayer", "ir"); await page.waitForTimeout(2500);
st = await page.evaluate(() => document.getElementById("wxInfo").textContent);
ok(/direkt/.test(st) && tiles > 0, "Ausfall /sat: Rueckfall auf EUMETSAT direkt: " + st + " (" + tiles + ")");
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
