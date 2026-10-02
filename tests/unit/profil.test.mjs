// Tests fuer die Hoehenplanung (evalRoute): Abflug in Platzhoehe, kein Kreisen am Start,
// ehrliche Bewertung, wenn die Steigrate nicht reicht.
import test from "node:test";
import assert from "node:assert/strict";
import { loadApp, setup } from "./load.mjs";

function direkt(app, terrain, opt) {
  const t = setup(app, terrain, opt);
  return { ...t, R: app.evalRoute(t.G, t.P, 10, app.directPath(t.G), "direct", "Direkt", opt && opt.userAlt ? { userAlt: opt.userAlt } : undefined) };
}
// Flach auf 1000 ft
const flach = () => 1000;
// Bergruecken 6000 ft zwischen NM 2 und NM 10
const ruecken = x => (x > 2 && x < 10 ? 6000 : 1000);
// sanfter Anstieg nach dem Start: 1000 ft + 150 ft je NM bis NM 20
const sanft = x => 1000 + Math.min(20, Math.max(0, x)) * 150;
// Gebirge ab NM 25: 9000 ft
const gebirgeSpaeter = x => (x > 25 && x < 40 ? 9000 : 1000);

test("Der Start beginnt immer in Platzhöhe, auch wenn danach Gelände kommt.", () => {
  const app = loadApp();
  for (const terrain of [flach, ruecken, sanft, gebirgeSpaeter]) {
    const { R, A } = direkt(app, terrain);
    assert.equal(Math.round(R.samples[0].p), Math.round(A.elevFt));
  }
});

test("Über flachem Gelände gibt es weder Kreisen noch Konflikte und die Route ist gut.", () => {
  const app = loadApp();
  const { R } = direkt(app, flach);
  assert.equal(R.circles.length, 0);
  assert.equal(R.conflicts.length, 0);
  assert.equal(R.tight.length, 0);
  assert.equal(R.cat, 0);
});

test("Im Abflugbereich wird nie kreisend gestiegen.", () => {
  const app = loadApp();
  for (const terrain of [ruecken, sanft, gebirgeSpaeter]) {
    const { R } = direkt(app, terrain);
    assert.ok(R.circles.every(c => c.x >= app.NO_CIRC_NM), JSON.stringify(R.circles));
  }
});

test("Reicht die Steigrate für einen Rücken direkt nach dem Start nicht, ist die Route kritisch und begründet.", () => {
  const app = loadApp();
  const { R } = direkt(app, ruecken);
  assert.equal(R.cat, 2);
  assert.ok(R.conflicts.some(c => c.cause === "climb"), JSON.stringify(R.conflicts));
  assert.match(app.issueOf(R), /Steigrate/);
});

test("Ein sanft ansteigendes Tal ist mit normaler Steigrate ohne Konflikt fliegbar.", () => {
  const app = loadApp();
  const { R } = direkt(app, sanft);
  assert.equal(R.conflicts.length, 0, JSON.stringify(R.conflicts));
  assert.ok(R.cat <= 1);
});

test("Mit zu geringer Steigrate wird ein sanfter Anstieg mindestens als eingeschränkt bewertet.", () => {
  const app = loadApp();
  const { R } = direkt(app, sanft, { climb: 200 });
  assert.ok(R.cat >= 1);
  assert.ok(R.conflicts.length || R.tight.length);
});

test("Unterwegs darf gekreist werden, wenn das Gelände es verlangt – das zählt als Nachteil.", () => {
  const app = loadApp();
  const { R } = direkt(app, gebirgeSpaeter, { climb: 300 });
  if (R.circles.length) {
    assert.ok(R.circles[0].x >= app.NO_CIRC_NM);
    assert.ok(R.cat >= 1);
    assert.match(app.issueOf(R) || "", /kreisend|Höhenkorridor|Gelände/);
  } else assert.ok(R.cat >= 1 || R.conflicts.length === 0);
});

test("Nach dem Gebirge sinkt das Profil über flachem Gelände rechtzeitig, statt über dem Ziel zu spiralen.", () => {
  const app = loadApp();
  // Gebirge NM 10-20, danach ~37 NM flach: genug Strecke, um normal abzusteigen
  const { R } = direkt(app, x => (x > 10 && x < 20 ? 9000 : 1000));
  assert.ok(R.spiralMin < 1, "spiralMin=" + R.spiralMin);
});

