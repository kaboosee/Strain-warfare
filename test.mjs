/* ============================================================
   AMR EVOLUTION SANDBOX — headless test + benchmark harness
   ------------------------------------------------------------
   No dependencies. Node builtins only.   Run:  node test.mjs
   Exits non-zero if any assertion fails.

   It loads app.js into a vm sandbox with a stubbed DOM and a
   SEEDED Math.random (so every run is deterministic, not flaky),
   exposes the const-scoped internals via globalThis.__sim, and
   checks: invariants, biology, the robustness fixes, and speed.
   ============================================================ */

import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// --- seeded PRNG (mulberry32) so Math.random is reproducible across runs ---
function seededMath(seed) {
  let s = seed >>> 0;
  const random = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // delegate everything except random to the real Math
  return new Proxy(Math, { get: (t, p) => (p === 'random' ? random : t[p]) });
}

// --- build a fresh simulation in an isolated sandbox ---
function makeSim(seed = 12345) {
  let src = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  src += `\nglobalThis.__sim = { state, CONFIG, update, resetSim, applyPreset, floodAntibiotic,
    spawnBacteria, frame, MAX_LEDGER, CHART_HISTORY };\n`;

  let domReady = null, rafCb = null;
  const elCache = {};
  const makeEl = (id) => {
    const el = {
      value: '1', textContent: '', innerHTML: '', hidden: false,
      width: 280, height: 110, offsetWidth: 120, offsetLeft: 0, offsetTop: 0, clientWidth: 800,
      style: {}, classList: { toggle() {}, add() {}, remove() {} },
      children: [], childElementCount: 0, firstChild: null, scrollTop: 0, scrollHeight: 0,
      appendChild(c) { this.children.push(c); this.childElementCount = this.children.length; this.firstChild = this.children[0]; },
      removeChild() { this.children.shift(); this.childElementCount = this.children.length; this.firstChild = this.children[0] || null; },
      addEventListener() {}, getContext: () => ctxProxy,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }),
    };
    if (id === 'nutrientRate') el.value = '30';
    if (id === 'mutationRate') el.value = '1';
    if (id === 'simSpeed') el.value = '1';
    if (id === 'gradientGene') el.value = 'penicillin';
    if (id === 'presetSelect') el.value = 'baseline';
    return el;
  };
  // recursive proxy: any property/call returns the proxy, so the whole canvas 2D API is a no-op
  const ctxProxy = new Proxy(function () {}, { get: () => ctxProxy, apply: () => ctxProxy, set: () => true });
  const document = {
    getElementById: (id) => elCache[id] || (elCache[id] = makeEl(id)),
    createElement: () => makeEl('dyn'),
    addEventListener: (ev, fn) => { if (ev === 'DOMContentLoaded') domReady = fn; },
  };
  let vclock = 0;
  const sandbox = {
    document, performance: { now: () => vclock }, requestAnimationFrame: (cb) => { rafCb = cb; },
    Math: seededMath(seed), Date, console, Object, Array, Map, String, Number, JSON, isNaN, isFinite, parseFloat, parseInt,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const sim = sandbox.__sim;
  domReady(); // runs init(): seeds the world and schedules the first frame

  return {
    sim, elCache,
    step(seconds) { const n = Math.round(seconds * 60); for (let i = 0; i < n; i++) sim.update(sim.CONFIG.fixedDt); },
    // drive the REAL frame() loop with a monotonic clock (for sim-speed / sampling tests)
    runFrames(realSeconds, dtMs = 1000 / 60) {
      for (let f = 0; f < realSeconds * 60; f++) { vclock += dtMs; if (rafCb) { const cb = rafCb; rafCb = null; cb(vclock); } }
    },
  };
}

// --- colony helpers ---
const genePct = (sim, gene) => {
  const L = Math.max(sim.state.bacteria.length, 1);
  let c = 0; for (const b of sim.state.bacteria) if (b.resistanceGenes[gene]) c++;
  return Math.round((c / L) * 100);
};

// --- tiny test runner ---
let passed = 0, failed = 0;
const results = [];
function test(name, fn) {
  try { fn(); results.push(`  ✓ ${name}`); passed++; }
  catch (e) { results.push(`  ✗ ${name}\n      ${e.message}`); failed++; }
}
function section(title) { results.push(`\n${title}`); }

/* ============================================================
   INVARIANTS — nothing the sim does should ever break these
   ============================================================ */
section('Invariants (5000-step adversarial run: random floods / presets / slider values)');
test('state stays finite and all collections stay capped', () => {
  const h = makeSim(1);
  const { sim } = h;
  const drugs = ['penicillin', 'tetracycline', 'cipro'];
  const presets = ['baseline', 'superbug', 'famine', 'megaplate'];
  for (let i = 0; i < 5000; i++) {
    if (Math.random() < 0.01) sim.floodAntibiotic(drugs[(Math.random() * 3) | 0]);
    if (Math.random() < 0.003) sim.applyPreset(presets[(Math.random() * 4) | 0]);
    if (Math.random() < 0.02) sim.spawnBacteria(25, true);
    sim.CONFIG.simSpeed = [0, 1, 2, 4][(Math.random() * 4) | 0];
    sim.CONFIG.nutrientRate = [0, 12, 30, 40][(Math.random() * 4) | 0];
    sim.CONFIG.mutationRate = Math.random() * 0.03;
    sim.update(sim.CONFIG.fixedDt);

    for (const b of sim.state.bacteria) {
      assert(Number.isFinite(b.x) && Number.isFinite(b.y), `non-finite position at step ${i}`);
      assert(Number.isFinite(b.vx) && Number.isFinite(b.vy), `non-finite velocity at step ${i}`);
      assert(Number.isFinite(b.energy), `non-finite energy at step ${i}`);
    }
    assert(sim.state.bacteria.length <= sim.CONFIG.maxPopulation, `population overflow at step ${i}`);
    assert(sim.state.nutrients.length <= sim.CONFIG.maxNutrients, `nutrient overflow at step ${i}`);
    assert(sim.state.history.length <= sim.CHART_HISTORY, `history overflow at step ${i}`);
    assert(h.elCache.ledger.childElementCount <= sim.MAX_LEDGER, `ledger overflow at step ${i}`);
  }
  // resistant can never exceed living
  let resistant = 0;
  for (const b of sim.state.bacteria) if (b.resistanceGenes.penicillin || b.resistanceGenes.tetracycline || b.resistanceGenes.cipro) resistant++;
  assert(resistant <= sim.state.bacteria.length, 'resistant > living');
});

/* ============================================================
   BIOLOGY — the locked-in qualitative behaviours
   ============================================================ */
section('Biology');
test('no drug: resistance stays rare and never pan-fixes (max mutation 3%, 300 s)', () => {
  const { sim, step } = makeSim(2);
  sim.applyPreset('baseline'); sim.CONFIG.mutationRate = 0.03;
  step(300);
  for (const g of ['penicillin', 'tetracycline', 'cipro']) {
    assert(genePct(sim, g) < 80, `${g} fixed too high (${genePct(sim, g)}%) — standing cost not preventing the ratchet`);
  }
  assert(sim.state.bacteria.length > 0, 'colony died with no drug present');
});

test('single flood selects resistant: a 25%-tet colony sweeps to >80% tet after recovery', () => {
  const { sim, step } = makeSim(3);
  sim.applyPreset('baseline'); step(90);
  for (const b of sim.state.bacteria) if (Math.random() < 0.25) b.resistanceGenes.tetracycline = true;
  sim.floodAntibiotic('tetracycline'); step(sim.CONFIG.floodDuration); step(45);
  assert(sim.state.bacteria.length > 0, 'colony failed to recover after flood');
  assert(genePct(sim, 'tetracycline') > 80, `tet did not sweep (${genePct(sim, 'tetracycline')}%)`);
});

test('resistant cells survive their own drug (>= 60% ride out a flood)', () => {
  const { sim, step } = makeSim(4);
  sim.applyPreset('baseline'); step(60);
  for (const b of sim.state.bacteria) b.resistanceGenes.tetracycline = true;
  const before = sim.state.bacteria.length;
  let id = 0; for (const b of sim.state.bacteria) b.__id = id++;
  const ids = new Set(sim.state.bacteria.map((b) => b.__id));
  sim.floodAntibiotic('tetracycline'); step(sim.CONFIG.floodDuration);
  const survived = sim.state.bacteria.filter((b) => ids.has(b.__id)).length;
  const rate = survived / before;
  assert(rate >= 0.6, `only ${(rate * 100) | 0}% of resistant cells survived their own drug`);
});

test('triple flood on a non-MDR colony wipes it out', () => {
  const { sim, step } = makeSim(5);
  sim.applyPreset('baseline'); step(60);
  const before = sim.state.bacteria.length;
  sim.floodAntibiotic('penicillin'); sim.floodAntibiotic('tetracycline'); sim.floodAntibiotic('cipro');
  step(6);
  assert(sim.state.bacteria.length < before * 0.2, `colony survived triple flood (${sim.state.bacteria.length}/${before})`);
});

test('low nutrient supply: colony competes but does not go extinct', () => {
  const { sim, step } = makeSim(6);
  sim.applyPreset('famine'); // nutrient rate 12
  let minLiving = Infinity;
  for (let t = 0; t < 10; t++) { step(20); minLiving = Math.min(minLiving, sim.state.bacteria.length); }
  assert(minLiving > 0, `colony went extinct under low food (min ${minLiving}) — foraging reach regressed`);
});

test('MEGA-plate gradient: treated bands end up resistant-only', () => {
  const { sim, step } = makeSim(7);
  sim.applyPreset('baseline'); step(120);
  sim.state.gradient = { gene: 'penicillin' }; step(220);
  const refugeEdge = sim.CONFIG.gradientRefugeFrac * sim.CONFIG.size;
  let susceptibleInTreated = 0, treatedTotal = 0;
  for (const b of sim.state.bacteria) {
    if (b.x > refugeEdge) { treatedTotal++; if (!b.resistanceGenes.penicillin) susceptibleInTreated++; }
  }
  // a few susceptibles may be transiently wandering across the boundary; require near-zero
  assert(susceptibleInTreated <= 3, `${susceptibleInTreated} susceptible cells alive in treated bands (of ${treatedTotal})`);
});

/* ============================================================
   ROBUSTNESS FIXES — regression guards for this hardening pass
   ============================================================ */
section('Robustness fixes');
test('history sampling is not skipped at high sim speed (4x)', () => {
  const h = makeSim(8);
  h.sim.resetSim(); h.sim.CONFIG.simSpeed = 4;
  h.runFrames(12);
  const expected = Math.floor(h.sim.state.tick / 60);
  const got = h.sim.state.history.length;
  assert(Math.abs(got - expected) <= 2, `chart under-sampled at 4x: got ${got}, expected ~${expected}`);
});

test('same-gene flood refreshes instead of stacking', () => {
  const { sim, step } = makeSim(9);
  sim.applyPreset('baseline'); step(20);
  sim.floodAntibiotic('penicillin'); sim.floodAntibiotic('penicillin'); sim.floodAntibiotic('penicillin');
  assert.equal(sim.state.floods.length, 1, `same-gene floods stacked (${sim.state.floods.length})`);
  sim.floodAntibiotic('tetracycline');
  assert.equal(sim.state.floods.length, 2, 'different drugs should still combine');
});

/* ============================================================
   PERFORMANCE — must clear the 60 Hz real-time budget with margin
   ============================================================ */
section('Performance');
test('throughput at max population clears the real-time budget', () => {
  const { sim, step } = makeSim(10);
  sim.applyPreset('baseline'); step(0.7);
  sim.spawnBacteria(800, true); step(1);
  const pop = sim.state.bacteria.length;
  const N = 600;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) sim.update(sim.CONFIG.fixedDt);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const perStep = ms / N, stepsPerSec = N / (ms / 1000);
  results.push(`      ~${pop} cells: ${perStep.toFixed(3)} ms/step, ${stepsPerSec.toFixed(0)} steps/sec`);
  // 60 Hz needs 60 steps/sec (1x) up to 480 (8 steps/frame cap). Lenient floor catches a big regression.
  assert(stepsPerSec > 200, `too slow: ${stepsPerSec.toFixed(0)} steps/sec`);
});

/* ============================================================
   REPORT
   ============================================================ */
console.log('AMR Evolution Sandbox — test suite\n' + '='.repeat(50));
console.log(results.join('\n'));
console.log('\n' + '='.repeat(50));
console.log(`${failed === 0 ? '✓ ALL PASSED' : '✗ FAILURES'} — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
