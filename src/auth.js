// Passwortschutz fuer die ganze Seite (statt Cloudflare Access).
// Secret APP_PASSWORD in Cloudflare. Nach richtiger Eingabe bekommt der Browser ein signiertes
// Sitzungs-Cookie (HMAC-SHA-256, 30 Tage, HttpOnly, Secure). Ein neues Passwort macht alle alten
// Sitzungen ungueltig. Ohne eingerichtetes Passwort bleibt die Seite gesperrt (nie offen).

const COOKIE = "vfr_sitzung";
const SESSION_DAYS = 30;
const enc = new TextEncoder();

function b64url(buf) {
  let s = "";
  new Uint8Array(buf).forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function password(env) { return env && typeof env.APP_PASSWORD === "string" ? env.APP_PASSWORD : ""; }
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode("vfr-sitzung-v1|" + secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
/* Vergleich ohne Zeitunterschied je nach Uebereinstimmung (beide Seiten vorher hashen = gleiche Laenge) */
async function sameSecret(a, b) {
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(x, y);
  const u = new Uint8Array(x), v = new Uint8Array(y); let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}
function getCookie(request, name) {
  const c = request.headers.get("Cookie") || "";
  for (const part of c.split(";")) {
    const i = part.indexOf("="); if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}
export async function isLoggedIn(request, env) {
  const pw = password(env), tok = getCookie(request, COOKIE);
  if (!pw || !tok) return false;
  const [exp, sig] = tok.split(".");
  if (!exp || !sig || !(+exp > Date.now())) return false;
  return sameSecret(sig, await hmac(pw, exp));
}
async function sessionCookie(env) {
  const exp = String(Date.now() + SESSION_DAYS * 86400000);
  return COOKIE + "=" + exp + "." + await hmac(password(env), exp) +
    "; Path=/; Max-Age=" + SESSION_DAYS * 86400 + "; HttpOnly; Secure; SameSite=Lax";
}
/* Nur Pfade auf dieser Seite als Ziel nach der Anmeldung (kein Weiterleiten auf fremde Seiten) */
function safeNext(n) { return typeof n === "string" && /^\/(?!\/)[^\\]*$/.test(n) ? n : "/"; }
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }

export function loginPage(next, msg, status) {
  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1F5FA8"><meta name="robots" content="noindex">
<title>VFR Briefing – Anmelden</title>
<style>
*{box-sizing:border-box}html,body{margin:0;height:100%;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#F2F5F8;color:#0F1D2A}
body{display:flex;align-items:center;justify-content:center;padding:16px}
form{width:100%;max-width:360px;background:#fff;border:1px solid #E1E7EC;border-radius:12px;padding:22px 20px;box-shadow:0 2px 10px rgba(15,29,42,.08)}
h1{font-size:20px;margin:0 0 4px}h1 em{color:#B02E7A;font-style:normal}p{margin:0 0 16px;color:#61717F;font-size:14px}
label{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#61717F;margin-bottom:4px}
input{width:100%;height:46px;border:1px solid #CBD5DD;border-radius:8px;padding:0 12px;font:inherit;font-size:16px}
input:focus{outline:none;border-color:#1F5FA8;box-shadow:0 0 0 3px rgba(31,95,168,.15)}
button{margin-top:14px;width:100%;height:48px;border:0;border-radius:8px;background:#1F5FA8;color:#fff;font:inherit;font-size:16px;font-weight:700;cursor:pointer}
.err{color:#C0392B;font-weight:600;margin:10px 0 0;font-size:14px}
</style></head><body>
<form method="post" action="/login">
<h1>VFR <em>&#9656;</em> Route &amp; Wetter</h1>
<p>Bitte Passwort eingeben.</p>
<label for="pw">Passwort</label>
<input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>
<input type="hidden" name="next" value="${esc(safeNext(next))}">
<button type="submit">Anmelden</button>
${msg ? `<div class="err">${esc(msg)}</div>` : ""}
</form></body></html>`;
  return new Response(html, { status: status || 401,
    headers: { "Content-Type": "text/html;charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" } });
}

/* Liefert eine Antwort, wenn die Anfrage von der Anmeldung abgefangen wird, sonst null (= angemeldet). */
export async function guard(request, env) {
  const url = new URL(request.url), p = url.pathname;
  if (p === "/logout") {
    return new Response(null, { status: 303, headers: { Location: "/", "Cache-Control": "no-store",
      "Set-Cookie": COOKIE + "=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax" } });
  }
  if (!password(env)) return loginPage("/", "Die Anmeldung ist noch nicht eingerichtet (Secret APP_PASSWORD fehlt). Die Seite bleibt gesperrt.", 503);
  if (p === "/login" && request.method === "POST") {
    let form; try { form = await request.formData(); } catch (e) { form = new FormData(); }
    const next = safeNext(form.get("next"));
    if (await sameSecret(String(form.get("password") || ""), password(env))) {
      return new Response(null, { status: 303, headers: { Location: next, "Cache-Control": "no-store", "Set-Cookie": await sessionCookie(env) } });
    }
    await new Promise(r => setTimeout(r, 1000));   /* bremst Durchprobieren */
    return loginPage(next, "Passwort falsch.", 401);
  }
  if (await isLoggedIn(request, env)) return null;
  /* Seitenaufruf -> Anmeldeseite; Daten-/Dateiabruf -> 401 ohne Inhalt */
  const accept = request.headers.get("Accept") || "";
  if (request.method === "GET" && (accept.indexOf("text/html") >= 0 || p === "/" || p === "/login")) return loginPage(p === "/login" ? "/" : p + url.search);
  return new Response(JSON.stringify({ error: "Anmeldung erforderlich" }), { status: 401, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
