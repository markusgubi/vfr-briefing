// Tests fuer die Passwort-Anmeldung (src/auth.js).
import test from "node:test";
import assert from "node:assert/strict";
import { guard, isLoggedIn } from "../../src/auth.js";

const ENV = { APP_PASSWORD: "geheim-123" };
const B = "https://vfr.gubi.co.at";
const html = (p, extra = {}) => new Request(B + p, { headers: { Accept: "text/html", ...extra } });
async function login(pw, next = "/", env = ENV) {
  const body = new URLSearchParams({ password: pw, next });
  return guard(new Request(B + "/login", { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } }), env);
}
const cookieOf = r => (r.headers.get("Set-Cookie") || "").split(";")[0];

test("Ohne Anmeldung sind App, Dateien und /cfg gesperrt.", async () => {
  for (const p of ["/", "/js/ui.js", "/cfg", "/awx?bbox=1,2,3,4", "/test", "/manifest.webmanifest"]) {
    const r = await guard(new Request(B + p), ENV);
    assert.ok(r && r.status === 401, p + " -> " + (r && r.status));
  }
  const r = await guard(html("/"), ENV);
  assert.match(await r.text(), /Bitte Passwort eingeben/);
});

test("Ohne eingerichtetes Passwort bleibt alles gesperrt, auch mit leerem Passwort.", async () => {
  const r = await guard(html("/"), {});
  assert.equal(r.status, 503);
  assert.match(await r.text(), /bleibt gesperrt/);
  assert.equal((await login("", "/", {})).status, 503);
  assert.equal((await guard(new Request(B + "/cfg"), {})).status, 503);
});

test("Falsches Passwort wird abgelehnt und gebremst.", async () => {
  const t0 = Date.now(), r = await login("falsch");
  assert.equal(r.status, 401);
  assert.ok(Date.now() - t0 >= 900);
  assert.equal(r.headers.get("Set-Cookie"), null);
});

test("Richtiges Passwort meldet an; das Cookie öffnet die Seite.", async () => {
  const r = await login("geheim-123", "/?x=1");
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("Location"), "/?x=1");
  assert.match(r.headers.get("Set-Cookie"), /HttpOnly; Secure; SameSite=Lax/);
  const ok = await guard(new Request(B + "/cfg", { headers: { Cookie: cookieOf(r) } }), ENV);
  assert.equal(ok, null);
});

test("Nach der Anmeldung wird nie auf fremde Seiten weitergeleitet.", async () => {
  for (const n of ["//evil.example", "https://evil.example", "/\\evil.example", "javascript:alert(1)"]) {
    assert.equal((await login("geheim-123", n)).headers.get("Location"), "/", n);
  }
});

test("Gefälschte, abgelaufene und alte (vor Passwortwechsel) Cookies werden abgelehnt.", async () => {
  const req = c => new Request(B + "/cfg", { headers: { Cookie: c } });
  assert.equal(await isLoggedIn(req("vfr_sitzung=99999999999999.AAAA"), ENV), false);
  const good = cookieOf(await login("geheim-123"));
  const [name, val] = good.split("="), [, sig] = val.split(".");
  assert.equal(await isLoggedIn(req(name + "=1000." + sig), ENV), false, "abgelaufen");
  assert.equal(await isLoggedIn(req(good), { APP_PASSWORD: "neues-passwort" }), false, "Passwort gewechselt");
  assert.equal(await isLoggedIn(req(good), ENV), true);
});

test("Abmelden löscht das Cookie.", async () => {
  const r = await guard(new Request(B + "/logout"), ENV);
  assert.equal(r.status, 303);
  assert.match(r.headers.get("Set-Cookie"), /Max-Age=0/);
});
