/* ============================================================
   AMR EVOLUTION SANDBOX
   Vanilla ES6+ · HTML5 Canvas · continuous 2D Petri dish
   ------------------------------------------------------------
   Sections:
     1. Configuration
     2. State
     3. Utilities
     4. Entity factories
     5. Spatial hash (collision broadphase)
     6. Simulation step (physics / biology)
     7. Rendering
     8. Game loop
     9. UI wiring
    10. Init
   ============================================================ */

'use strict';

/* ============================================================
   1. CONFIGURATION
   ============================================================ */

// Antibiotic / resistance-gene classes. The keys ARE the gene flags.
const ANTIBIOTICS = {
  penicillin:   { name: 'Penicillin',    target: 'cell wall',         color: '#4ea3ff', rgb: [78, 163, 255] },
  tetracycline: { name: 'Tetracycline',  target: 'protein synthesis', color: '#ffb648', rgb: [255, 182, 72] },
  cipro:        { name: 'Ciprofloxacin', target: 'DNA gyrase',        color: '#e472ff', rgb: [228, 114, 255] },
};
const GENES = Object.keys(ANTIBIOTICS); // ['penicillin','tetracycline','cipro']

const CONFIG = {
  // canvas (logical pixels — matches <canvas> width/height attributes)
  size: 800,
  get cx() { return this.size / 2; },
  get cy() { return this.size / 2; },
  get radius() { return this.size / 2 - 6; }, // dish inner radius

  // population
  startPopulation: 60,
  spawnBatch: 25,
  maxPopulation: 800,

  // --- ENERGY ECONOMY (sensitive — read before tuning) ---
  // Out: every cell loses energyDecayPerSec each second.
  // In : the dish receives nutrientRate * nutrientEnergy energy/sec (food is the ONLY
  //      real energy source — division just splits existing energy, see reproEfficiency).
  // Carrying capacity  N* = (nutrientRate * nutrientEnergy) / energyDecayPerSec.
  //   Defaults: (30 * 30) / 4 = 225 cells.  Start = 60 < 225  => colony grows then self-limits.
  //   Time to starve from full with no food = startEnergy / energyDecayPerSec = 60/4 = 15 s.
  // To make floods deadlier, raise floodDamage; to thin the colony, lower nutrientRate.

  // bacteria
  bactRadius: 3.4,
  startEnergy: 60,         // energy a fresh/seeded cell begins with (15 s starve buffer)
  divideThreshold: 100,    // energy at which a cell divides (the repro trigger)
  reproEfficiency: 1.0,    // fraction of energy kept across division (1.0 = conserved)
  energyDecayPerSec: 4,    // baseline metabolism — energy out per cell per second
  jitter: 26,              // random-walk acceleration (px/s^2-ish)
  maxSpeed: 34,            // px/s
  drag: 0.97,             // velocity-retention per step. CRITICAL: low values (e.g. 0.86)
                          //   damp velocity to ~zero each tick so cells barely move and
                          //   cannot forage. ~0.97 lets motion persist so they actually feed.
  chemotaxis: 14,         // accel bias toward the nearest sensed nutrient (foraging drive)
  // How far a cell can "smell" a nutrient to swim toward it. Too small (≈26) and cells that
  // have eaten their local patch can't find the food that's piled up elsewhere — the colony
  // starves locally and can DIE OUT even while global nutrients are in surplus (especially
  // when confined by a gradient, or at low supply). Must be ≤ the nutrient grid's cell size
  // (nutrientGrid below) or the 3×3 query clips it. Verified headless: 26 → low-supply
  // extinction; ≈44 keeps the colony alive and tightens the boom/bust swings.
  senseRadius: 44,
  lifespanMin: 14,         // seconds
  lifespanMax: 30,
  nutrientEnergy: 30,      // energy gained per nutrient eaten
  eatRadius: 11,           // center-to-center distance at which a cell consumes a nutrient

  // --- GRADED RESISTANCE (MIC model) ---
  // Each cell carries a numeric MIC per drug (mic.{penicillin,tetracycline,cipro}) on the
  // doseResponse "level" scale: 0 = fully susceptible, up to micMax. A level L means the cell
  // survives a local dose up to L (1=1× MIC band, 2=10×, 3=100×, 4=1000×). It survives a drug
  // when mic >= the local dose; below that it takes kill damage scaled by (1 - mic/dose), a
  // smooth ramp rather than a cliff. Mutations on division step MIC by micStep (one band).
  micMax: 4,            // max MIC level — aligned with the deepest gradient band (1000× = level 4)
  micStep: 1,           // band-equivalent change per mutation event
  floodDose: 1,         // dose level a transient flood applies everywhere (1 ≈ the 1× MIC band)
  mutationUpBias: 0.85, // P(a mutation steps MIC UP) when the cell is under that drug (else 0.5)

  // genetics (mutationRate set live from slider, as a fraction 0..1 per division)
  mutationRate: 0.01,        // chance per drug, per division, that MIC mutates (steps up/down)
  backMutationRate: 0.01,    // chance per drug, per division, MIC drifts DOWN when no drug present

  // --- RESISTANCE ECOLOGY (why resistance isn't a free one-way ratchet) ---
  // Without a standing cost, resistance only ever climbs (mutation + HGT) and never pays for
  // itself, so it monotonically fixes at max MIC and floods stop mattering. resistanceCost
  // makes every UNIT of MIC carried burn extra metabolism EVERY second, drug or not, so high
  // resistance is selected AGAINST when no antibiotic is present and only pays off under active
  // drug pressure. (Distinct from effluxCost, which is only paid while actually under a drug.)
  resistanceCost: 2.0,       // extra energy/sec PER unit of total MIC, always-on (base decay is 4)

  // HGT / plasmids
  plasmidDropChance: 0.55,  // chance a resistant cell drops a plasmid on death
  plasmidLifespan: 16,      // seconds before it degrades
  plasmidPickupRadius: 7,

  // nutrients (rate set live from slider — nutrients spawned per second across the dish)
  nutrientRate: 30,        // supply * nutrientEnergy = 900 energy/s -> carrying capacity 225
  maxNutrients: 1200,      // standing food buffer cap so small colonies don't supply-starve

  // antibiotics
  // floodDuration is the drain WINDOW for cells under the drug. It was 7s with a 9/s efflux
  // tax, which (on top of base metabolism + resistance cost) drained resistant cells faster
  // than they could eat over the window, so ~80% of RESISTANT cells starved during a flood —
  // resistance looked broken. Now a short, sharp pulse (4s) with a small efflux tax (2/s):
  // susceptibles still die almost instantly at floodDamage 70/s, but resistant cells reliably
  // ride it out (verified headless: ~17% -> ~72% resistant survival, susceptibles still wiped).
  floodDuration: 4,     // seconds the drug lingers
  floodSweep: 1.1,      // seconds for the front to cross the dish
  floodDamage: 70,      // energy/sec drained from susceptible cells under the drug
  effluxCost: 2,        // extra energy/sec resistant cells pay to pump it out (modest tax)

  // --- MEGA-PLATE GRADIENT (Kishony 2016) ---
  // A standing spatial gradient of ONE drug instead of a transient sweep. The dish is
  // divided left->right into bands of increasing concentration (relative MIC). Cells survive
  // a band only when their MIC for that drug >= the band's dose level, so resistant lineages
  // advance band-by-band as their MIC mutates upward (the true Kishony stepwise march). Kill
  // scales with dose and how far the cell's MIC falls short; efflux gets costlier at higher
  // conc so the top bands are survivable-but-expensive.
  gradientBands: [0, 1, 10, 100, 1000],  // relative MIC per band, low x -> high x
  // The drug-free refuge (band 0) takes a generous share of the dish so a healthy
  // susceptible colony lives there and keeps throwing resistant mutants; the remaining
  // width splits equally among the treated bands. Without a viable refuge the colony just
  // goes extinct the moment the gradient turns on.
  gradientRefugeFrac: 0.5,
  // Kill must be net-lethal even at the lowest treated band (1× MIC) despite the cell still
  // eating — otherwise well-fed susceptibles survive bands above their MIC, which is wrong.
  // Anchored at floodDamage so band 1× is "at/above MIC = inhibitory", scaling deeper in.
  gradientKill: 70,       // energy/s per (log10 conc + 1) drained from susceptibles in a band
  // Decoupled from the flood effluxCost: the gradient wants a STEEP per-dose tax so the front
  // advances band-by-band (high bands survivable but costly). Tuned so effluxCost*scale*dose
  // matches the old gradient cost even though the flood effluxCost was lowered.
  gradientEffluxScale: 2.7, // efflux tax multiplier per (log10 conc + 1) for resistant cells

  // simulation
  simSpeed: 1,
  fixedDt: 1 / 60,      // physics step
};

// Scenario presets. Each one resets the world, sets the three sliders, seeds a colony
// (optionally with some pre-resistant founders), and may switch on a gradient. The `seed`
// fields: count = founders, resistantFrac = share that start resistant, genesPerResistant =
// how many drugs each of those resists, seedMic = the MIC level those drugs start at
// (default 1). These fields are unchanged from the binary era so old presets still load.
const PRESETS = {
  baseline: {
    label: '🧪 Baseline Colony',
    blurb: 'A healthy colony, no drugs — watch it grow to carrying capacity.',
    mutation: 1.0, nutrient: 30, speed: 1,
    seed: { count: 60 },
  },
  megaplate: {
    label: '🧬 MEGA-plate (Kishony)',
    blurb: 'Standing ciprofloxacin gradient. Resistance must evolve to cross the bands.',
    mutation: 1.5, nutrient: 36, speed: 1.5, gradient: 'cipro',
    seed: { count: 90 },
  },
  superbug: {
    label: '☠ Superbug Outbreak',
    blurb: 'A few high-MIC multi-drug-resistant founders seeded among susceptibles — watch MDR spread.',
    mutation: 1.0, nutrient: 30, speed: 1,
    seed: { count: 70, resistantFrac: 0.12, genesPerResistant: 2, seedMic: 2 },
  },
  famine: {
    label: '🍽 Famine',
    blurb: 'Scarce food — fierce competition and boom/bust, but the colony hangs on.',
    mutation: 1.5, nutrient: 12, speed: 1,
    seed: { count: 80 },
  },
};

/* ============================================================
   2. STATE
   ============================================================ */

const state = {
  bacteria: [],
  nutrients: [],
  plasmids: [],
  floods: [],
  tick: 0,
  generation: 0,
  paused: false,
  nutrientAccumulator: 0,
  mutationsThisWindow: 0, // batched so the ledger isn't spammed
  hgtThisWindow: 0,       // batched HGT (plasmid uptake) events for the ledger
  gradient: null,         // { gene } when a MEGA-plate gradient is active, else null
  history: [],            // ring buffer of {living,penPct,tetPct,cipPct} samples for the chart
  hovered: null,          // bacterium currently under the cursor (cell inspector)
  course: null,           // active dosing regimen, or null. Shape:
                          //   { drug, dose, intervalTicks, dosesRemaining, nextDoseTick,
                          //     adherence, total, taken, missed, resistantAtStart }
};

let canvas, ctx;
let chartCanvas, chartCtx;

/* ============================================================
   3. UTILITIES
   ============================================================ */

const rand = (min, max) => min + Math.random() * (max - min);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const dist2 = (ax, ay, bx, by) => {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
};

// Pick a uniformly random point inside the circular dish.
function randomDishPoint(margin = 8) {
  const r = (CONFIG.radius - margin) * Math.sqrt(Math.random());
  const a = Math.random() * Math.PI * 2;
  return { x: CONFIG.cx + Math.cos(a) * r, y: CONFIG.cy + Math.sin(a) * r };
}

function hasAnyResistance(b) {
  return b.mic.penicillin > 0 || b.mic.tetracycline > 0 || b.mic.cipro > 0;
}
// Sum of MIC across all drugs — drives the standing fitness cost (higher MIC = costlier).
function totalMic(b) {
  return b.mic.penicillin + b.mic.tetracycline + b.mic.cipro;
}
// Strongest single resistance — drives colour intensity (vivid = highly resistant).
function peakMic(b) {
  return Math.max(b.mic.penicillin, b.mic.tetracycline, b.mic.cipro);
}
// How many distinct drugs the cell resists at all (MIC >= 1) — for the multi-resistant tally.
function drugsResisted(b) {
  return (b.mic.penicillin >= 1 ? 1 : 0)
       + (b.mic.tetracycline >= 1 ? 1 : 0)
       + (b.mic.cipro >= 1 ? 1 : 0);
}

// MEGA-plate band layout: the leftmost gradientRefugeFrac of the dish is the drug-free
// refuge (band 0); the rest splits equally among the treated bands (1..n-1).
// bandBounds() returns the n+1 x-pixel edges so update() and render() agree exactly.
function bandBounds() {
  const n = CONFIG.gradientBands.length;
  const rf = CONFIG.gradientRefugeFrac;
  const treated = n - 1;
  const bounds = [0, rf * CONFIG.size];
  for (let i = 1; i <= treated; i++) {
    bounds.push((rf + (i / treated) * (1 - rf)) * CONFIG.size);
  }
  return bounds;
}
function bandIndex(x) {
  const n = CONFIG.gradientBands.length;
  const rf = CONFIG.gradientRefugeFrac;
  const frac = x / CONFIG.size;
  if (frac < rf) return 0;
  const treated = n - 1;
  const t = (frac - rf) / (1 - rf);
  return clamp(1 + Math.floor(t * treated), 1, n - 1);
}
function localConc(x) {
  return CONFIG.gradientBands[bandIndex(x)];
}
// Dose response curve: returns log10(conc)+1 so band 1x -> 1, 10x -> 2, 100x -> 3, 1000x -> 4.
// (conc 0 -> 0, i.e. the refuge is harmless.) MIC is expressed on this same level scale.
function doseResponse(conc) {
  return conc > 0 ? Math.log10(conc) + 1 : 0;
}

// The drug dose a cell currently faces for one gene, taken as the MAX over any active flood it
// is under and the MEGA-plate gradient band it sits in (0 if neither). Used for mutation bias.
function localDose(b, gene) {
  let d = 0;
  for (let i = 0; i < state.floods.length; i++) {
    const f = state.floods[i];
    if (f.gene === gene && b.x <= f.front * CONFIG.size && f.dose > d) d = f.dose;
  }
  if (state.gradient && state.gradient.gene === gene) {
    const gd = doseResponse(localConc(b.x));
    if (gd > d) d = gd;
  }
  return d;
}

// Apply one drug exposure to a cell, graded by how its MIC compares to the local dose.
// resist = clamp(mic/dose, 0..1): 1 means fully resistant (survives, pays only the efflux tax),
// 0 means fully susceptible (takes the full kill). In between, damage and efflux scale smoothly
// — no hard cliff. killPerSec/effluxScale differ for floods vs the gradient (passed in).
function exposeToDrug(b, gene, dose, killPerSec, effluxScale, dt) {
  if (dose <= 0) return;
  const m = b.mic[gene];
  const resist = m >= dose ? 1 : m / dose;
  if (resist < 1) {
    b.energy -= killPerSec * dose * (1 - resist) * dt;   // vulnerable fraction takes damage
  }
  if (resist > 0) {
    b.energy -= CONFIG.effluxCost * effluxScale * dose * resist * dt; // pumping costs energy
    if (resist > b.efflux) b.efflux = resist;            // graded glow (full only at mic >= dose)
  }
}

// Cache a bacterium's render colour onto b.cr/cg/cb from its MIC profile. Hue = the drug
// colours weighted by this cell's MIC for each drug; intensity scales with the strongest single
// MIC (susceptible grey-green -> vivid drug colour at micMax). Recomputed only at birth and on
// HGT, so render never recomputes or allocates per cell per frame.
function setColor(b) {
  const m = b.mic, total = m.penicillin + m.tetracycline + m.cipro;
  if (total <= 0) { b.cr = 127; b.cg = 191; b.cb = 127; return; } // susceptible grey-green
  const P = ANTIBIOTICS.penicillin.rgb, T = ANTIBIOTICS.tetracycline.rgb, C = ANTIBIOTICS.cipro.rgb;
  const hr = (P[0] * m.penicillin + T[0] * m.tetracycline + C[0] * m.cipro) / total;
  const hg = (P[1] * m.penicillin + T[1] * m.tetracycline + C[1] * m.cipro) / total;
  const hb = (P[2] * m.penicillin + T[2] * m.tetracycline + C[2] * m.cipro) / total;
  // lerp grey-green -> weighted hue by t; even MIC 1 is clearly tinted, micMax is fully vivid
  const t = clamp(0.4 + 0.6 * (peakMic(b) / CONFIG.micMax), 0.4, 1);
  b.cr = 127 + (hr - 127) * t;
  b.cg = 191 + (hg - 191) * t;
  b.cb = 127 + (hb - 127) * t;
}

/* ============================================================
   4. ENTITY FACTORIES
   ============================================================ */

function createBacterium(x, y, mic = null) {
  const b = {
    x, y,
    vx: rand(-8, 8),
    vy: rand(-8, 8),
    energy: CONFIG.startEnergy,
    age: 0,
    lifespan: rand(CONFIG.lifespanMin, CONFIG.lifespanMax),
    // graded resistance: a numeric MIC level per drug (0 = susceptible). Defaults to all-0.
    mic: mic
      ? { penicillin: mic.penicillin || 0, tetracycline: mic.tetracycline || 0, cipro: mic.cipro || 0 }
      : { penicillin: 0, tetracycline: 0, cipro: 0 },
    plasmidSlots: 1,   // how many plasmids it can still absorb
    efflux: 0,         // >0 means actively pumping (decays for the visual glow)
    dead: false,
    cr: 0, cg: 0, cb: 0, // cached render colour (set below; refreshed on HGT)
  };
  setColor(b);
  return b;
}

function createNutrient(x, y) {
  return { x, y };
}

// A plasmid now carries an MIC LEVEL (not just a boolean gene): a cell that absorbs it gains
// that drug's resistance up to `mic` (horizontal gene transfer of a graded trait).
function createPlasmid(x, y, gene, mic) {
  return { x, y, gene, mic, age: 0, life: CONFIG.plasmidLifespan };
}

// A flood = a drug sweeping across the dish then lingering, then clearing. Each flood carries
// its own `dose` (MIC-band level) so a treatment course can dose at a chosen strength while the
// instant-flood buttons keep the default CONFIG.floodDose. exposeToDrug/localDose read f.dose.
function createFlood(geneTarget, dose = CONFIG.floodDose) {
  return {
    gene: geneTarget,
    age: 0,
    front: 0,              // 0..1 sweep progress (left -> right)
    duration: CONFIG.floodDuration,
    sweep: CONFIG.floodSweep,
    dose,                  // dose level this flood applies (default = CONFIG.floodDose)
    casualties: 0,
  };
}

/* ============================================================
   5. SPATIAL HASH (collision broadphase)
   ============================================================ */

class SpatialGrid {
  constructor(cellSize) {
    this.cellSize = cellSize;
    this.cols = Math.ceil(CONFIG.size / cellSize) + 1;
    this.map = new Map();
  }
  _key(x, y) {
    // clamp negative coords defensively so an out-of-bounds entity can't alias another cell
    const cx = x > 0 ? Math.floor(x / this.cellSize) : 0;
    const cy = y > 0 ? Math.floor(y / this.cellSize) : 0;
    return cy * this.cols + cx;
  }
  clear() { this.map.clear(); }
  insert(entity) {
    const k = this._key(entity.x, entity.y);
    let bucket = this.map.get(k);
    if (!bucket) { bucket = []; this.map.set(k, bucket); }
    bucket.push(entity);
  }
  // Fill `out` with the entities in the 3x3 block of cells around (x, y) and return it.
  // Takes a caller-owned scratch array (reset to length 0 here) so the per-bacterium hot
  // path allocates nothing — queryNearby used to return a fresh array on every call.
  queryInto(x, y, out) {
    out.length = 0;
    const cx = x > 0 ? Math.floor(x / this.cellSize) : 0;
    const cy = y > 0 ? Math.floor(y / this.cellSize) : 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = this.map.get((cy + dy) * this.cols + (cx + dx));
        if (bucket) for (let i = 0; i < bucket.length; i++) out.push(bucket[i]);
      }
    }
    return out;
  }
}

// nutrient grid cell >= senseRadius so the 3×3 query fully covers a cell's sense range
const nutrientGrid = new SpatialGrid(44);
const plasmidGrid = new SpatialGrid(16);
// reusable scratch buffers for queryInto — refilled per cell, never reallocated
const _nutScratch = [];
const _plasScratch = [];

/* ============================================================
   6. SIMULATION STEP
   ============================================================ */

function update(dt) {
  state.tick++;

  // --- rebuild spatial grids for this step ---
  nutrientGrid.clear();
  for (const n of state.nutrients) nutrientGrid.insert(n);
  plasmidGrid.clear();
  for (const p of state.plasmids) plasmidGrid.insert(p);

  // --- nutrient spawning (Poisson-ish via accumulator) ---
  state.nutrientAccumulator += CONFIG.nutrientRate * dt;
  while (state.nutrientAccumulator >= 1 && state.nutrients.length < CONFIG.maxNutrients) {
    state.nutrientAccumulator -= 1;
    const p = randomDishPoint();
    state.nutrients.push(createNutrient(p.x, p.y));
  }

  // --- floods: advance fronts, expire ---
  for (const f of state.floods) {
    f.age += dt;
    f.front = Math.min(1, f.age / f.sweep);
  }
  const beforeFloods = state.floods.length;
  state.floods = state.floods.filter(f => f.age < f.duration);
  if (beforeFloods && state.floods.length === 0) {
    addLedger('Antibiotic has cleared from the dish.', 'info');
  }

  // --- treatment course: administer any dose now due (before the per-bacterium loop so a fresh
  // flood is live this tick). Per-tick (never skipped at high sim speed) and only while unpaused,
  // since frame() gates update() on state.paused — so the regimen honours pause AND CONFIG.simSpeed.
  advanceCourse();

  // --- plasmids: age out ---
  for (const p of state.plasmids) p.age += dt;
  state.plasmids = state.plasmids.filter(p => p.age < p.life);

  const births = [];

  // --- per-bacterium update ---
  for (const b of state.bacteria) {
    if (b.dead) continue;

    // random walk
    b.vx += rand(-CONFIG.jitter, CONFIG.jitter) * dt * 8;
    b.vy += rand(-CONFIG.jitter, CONFIG.jitter) * dt * 8;

    // Query nearby nutrients ONCE per cell (nutrient positions are static and the cell moves
    // <1px this step, so it stays in the same grid cell). Reused for both chemotaxis here and
    // eating after the move — halves the nutrient-grid queries and allocates nothing.
    const near = nutrientGrid.queryInto(b.x, b.y, _nutScratch);

    // chemotaxis: steer toward the nearest un-eaten nutrient within sense range so cells
    // actively forage instead of drifting (pure diffusion leaves cells nearly static).
    let best = null, bestD = CONFIG.senseRadius * CONFIG.senseRadius;
    for (let i = 0; i < near.length; i++) {
      const n = near[i];
      if (n.eaten) continue;
      const d = dist2(b.x, b.y, n.x, n.y);
      if (d < bestD) { bestD = d; best = n; }
    }
    if (best) {
      const d = Math.sqrt(bestD) || 1;
      b.vx += ((best.x - b.x) / d) * CONFIG.chemotaxis * dt * 8;
      b.vy += ((best.y - b.y) / d) * CONFIG.chemotaxis * dt * 8;
    }

    b.vx *= CONFIG.drag;
    b.vy *= CONFIG.drag;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > CONFIG.maxSpeed) {
      b.vx = (b.vx / sp) * CONFIG.maxSpeed;
      b.vy = (b.vy / sp) * CONFIG.maxSpeed;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // keep inside circular dish (bounce off the wall)
    const dx = b.x - CONFIG.cx, dy = b.y - CONFIG.cy;
    const rr = Math.hypot(dx, dy);
    const maxR = CONFIG.radius - CONFIG.bactRadius;
    if (rr > maxR) {
      const nx = dx / rr, ny = dy / rr;
      b.x = CONFIG.cx + nx * maxR;
      b.y = CONFIG.cy + ny * maxR;
      const dot = b.vx * nx + b.vy * ny;
      b.vx -= 2 * dot * nx;
      b.vy -= 2 * dot * ny;
    }

    // metabolism + aging
    b.age += dt;
    // baseline metabolism + standing fitness cost of carrying resistance, scaled by TOTAL MIC
    // (high-resistance cells pay more), paid EVERY second drug or not. This is what stops MIC
    // from ratcheting to the max absent selection; separate from effluxCost (only paid under a drug).
    b.energy -= (CONFIG.energyDecayPerSec + totalMic(b) * CONFIG.resistanceCost) * dt;
    if (b.efflux > 0) b.efflux = Math.max(0, b.efflux - dt * 2);

    // antibiotic exposure — graded by MIC vs the local dose (see exposeToDrug).
    for (const f of state.floods) {
      // a cell is "under" the drug once the sweep front has passed its x position
      if (b.x <= f.front * CONFIG.size) {
        exposeToDrug(b, f.gene, f.dose, CONFIG.floodDamage, 1, dt);
      }
    }

    // MEGA-plate gradient: a standing dose that scales with the cell's band (see localConc).
    // The front advances band-by-band as MIC rises: a cell survives a band only when its MIC
    // for the drug >= that band's dose; below that it takes smoothly-scaled damage.
    if (state.gradient) {
      exposeToDrug(b, state.gradient.gene, doseResponse(localConc(b.x)),
                   CONFIG.gradientKill, CONFIG.gradientEffluxScale, dt);
    }

    // eat nearby nutrients — reuse the same nutrient list queried above (one query per cell);
    // distances are re-checked at the post-move position so eating still happens after moving.
    const eatR2 = CONFIG.eatRadius * CONFIG.eatRadius;
    for (let i = 0; i < near.length; i++) {
      const n = near[i];
      if (n.eaten) continue;
      if (dist2(b.x, b.y, n.x, n.y) < eatR2) {
        n.eaten = true;
        b.energy += CONFIG.nutrientEnergy;
      }
    }

    // HGT: absorb a nearby plasmid that would RAISE this cell's MIC for that drug (and has a slot)
    if (b.plasmidSlots > 0) {
      const nearP = plasmidGrid.queryInto(b.x, b.y, _plasScratch);
      const pickR2 = CONFIG.plasmidPickupRadius * CONFIG.plasmidPickupRadius;
      for (let i = 0; i < nearP.length; i++) {
        const p = nearP[i];
        if (p.absorbed) continue;
        if (b.mic[p.gene] >= p.mic) continue;  // already at least as resistant — nothing to gain
        if (dist2(b.x, b.y, p.x, p.y) < pickR2) {
          p.absorbed = true;
          b.mic[p.gene] = Math.max(b.mic[p.gene], p.mic); // gain the plasmid's MIC level
          b.plasmidSlots--;
          setColor(b);                  // MIC changed — refresh cached render colour
          state.hgtThisWindow++;        // batched to the ledger ~once/sec (see update tail)
          break;
        }
      }
    }

    // reproduction
    if (b.energy >= CONFIG.divideThreshold && state.bacteria.length + births.length < CONFIG.maxPopulation) {
      const childMic = { penicillin: b.mic.penicillin, tetracycline: b.mic.tetracycline, cipro: b.mic.cipro };

      // mutation per drug: MIC steps up or down by one band-equivalent, biased UPWARD when the
      // cell is under that drug (selection for higher resistance). Plus a reversion-drift roll
      // that nudges MIC down when no drug is present, so resistance decays once pressure is gone.
      for (const gene of GENES) {
        const underDrug = localDose(b, gene) > 0;
        if (Math.random() < CONFIG.mutationRate) {
          const up = Math.random() < (underDrug ? CONFIG.mutationUpBias : 0.5);
          const next = clamp(childMic[gene] + (up ? CONFIG.micStep : -CONFIG.micStep), 0, CONFIG.micMax);
          if (up && next > childMic[gene]) state.mutationsThisWindow++;
          childMic[gene] = next;
        }
        if (!underDrug && childMic[gene] > 0 && Math.random() < CONFIG.backMutationRate) {
          childMic[gene] = clamp(childMic[gene] - CONFIG.micStep, 0, CONFIG.micMax);
        }
      }

      const angle = Math.random() * Math.PI * 2;
      const child = createBacterium(
        b.x + Math.cos(angle) * 5,
        b.y + Math.sin(angle) * 5,
        childMic
      );
      // Split the parent's energy evenly between the two daughter cells.
      // reproEfficiency models the metabolic cost of replication: 1.0 conserves energy
      // exactly; <1.0 burns a fraction on division. Because food stays the only true
      // energy input, carrying capacity remains supply/decay regardless of this factor.
      const shared = b.energy * CONFIG.reproEfficiency;
      b.energy = shared / 2;
      child.energy = shared / 2;
      births.push(child);
    }

    // death
    if (b.energy <= 0 || b.age >= b.lifespan) {
      b.dead = true;
      // HGT seed: a resistant corpse may leave a plasmid carrying its MIC for a random drug it resisted
      if (hasAnyResistance(b) && Math.random() < CONFIG.plasmidDropChance) {
        const resistant = GENES.filter(g => b.mic[g] > 0);
        const gene = resistant[(Math.random() * resistant.length) | 0];
        state.plasmids.push(createPlasmid(b.x, b.y, gene, b.mic[gene]));
      }
    }
  }

  // commit births
  for (const child of births) state.bacteria.push(child);
  if (births.length) state.generation++;

  // remove eaten nutrients & dead bacteria by compacting each array in place — avoids
  // allocating a fresh array every step (these are the two biggest per-step collections).
  let nw = 0;
  for (let i = 0; i < state.nutrients.length; i++) {
    const n = state.nutrients[i];
    if (!n.eaten) state.nutrients[nw++] = n;
  }
  state.nutrients.length = nw;

  const livingBefore = state.bacteria.length;
  let bw = 0;
  for (let i = 0; i < state.bacteria.length; i++) {
    const b = state.bacteria[i];
    if (!b.dead) state.bacteria[bw++] = b;
  }
  state.bacteria.length = bw;

  // colony-wipe detection
  if (livingBefore > 0 && state.bacteria.length === 0) {
    addLedger('💀 Colony wiped out — no bacteria remain.', 'wipe');
  }

  // Once-per-second housekeeping. `tick` increments every step, so this fires on every 60th
  // tick and is NEVER skipped — even when many steps run per frame at high sim speed (a
  // frame-gated check would miss it, which previously under-sampled the history chart).
  if (state.tick % 60 === 0) {
    sampleHistory();
    if (state.mutationsThisWindow > 0) {
      addLedger(`Mutation${state.mutationsThisWindow > 1 ? 's' : ''} occurred ×${state.mutationsThisWindow} — new resistance arose.`, 'mut');
      state.mutationsThisWindow = 0;
    }
    if (state.hgtThisWindow > 0) {
      addLedger(`Plasmid uptake ×${state.hgtThisWindow} — resistance spread by HGT.`, 'hgt');
      state.hgtThisWindow = 0;
    }
  }
}

/* ============================================================
   7. RENDERING
   ============================================================ */

function render() {
  ctx.clearRect(0, 0, CONFIG.size, CONFIG.size);

  // agar dish background
  ctx.save();
  ctx.beginPath();
  ctx.arc(CONFIG.cx, CONFIG.cy, CONFIG.radius, 0, Math.PI * 2);
  ctx.clip();

  const ag = ctx.createRadialGradient(CONFIG.cx, CONFIG.cy * 0.8, 40, CONFIG.cx, CONFIG.cy, CONFIG.radius);
  ag.addColorStop(0, '#13202a');
  ag.addColorStop(1, '#0c1318');
  ctx.fillStyle = ag;
  ctx.fillRect(0, 0, CONFIG.size, CONFIG.size);

  // active flood overlays (translucent colored sweeps with a leading edge)
  for (const f of state.floods) {
    const reach = f.front * CONFIG.size;
    const linger = f.duration - f.sweep;        // guard: never divide by <=0 if mis-tuned
    const fade = linger > 0 ? clamp(1 - (f.age - f.sweep) / linger, 0.25, 1) : 1;
    const [r, g, b] = ANTIBIOTICS[f.gene].rgb;
    ctx.fillStyle = `rgba(${r},${g},${b},${0.12 * fade})`;
    ctx.fillRect(0, 0, reach, CONFIG.size);
    // leading edge glow
    if (f.front < 1) {
      ctx.fillStyle = `rgba(${r},${g},${b},${0.32 * fade})`;
      ctx.fillRect(reach - 10, 0, 12, CONFIG.size);
    }
  }

  // MEGA-plate gradient: standing concentration bands (left refuge -> right max dose)
  if (state.gradient) {
    const [r, g, b] = ANTIBIOTICS[state.gradient.gene].rgb;
    const bands = CONFIG.gradientBands;
    const bounds = bandBounds();
    for (let i = 0; i < bands.length; i++) {
      const x0 = bounds[i], x1 = bounds[i + 1], w = x1 - x0;
      const dose = doseResponse(bands[i]);          // 0..4
      ctx.fillStyle = `rgba(${r},${g},${b},${0.06 * dose})`;
      ctx.fillRect(x0, 0, w, CONFIG.size);
      // band divider + concentration label
      if (i > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(x0 - 0.5, 0, 1, CONFIG.size);
      }
      ctx.fillStyle = `rgba(${r},${g},${b},0.85)`;
      ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(bands[i] === 0 ? 'refuge' : `${bands[i]}× MIC`, x0 + w / 2, 18);
    }
    ctx.textAlign = 'left';
  }

  // nutrients — all drawn in ONE path (one beginPath/fill instead of up to 1200) for speed.
  // moveTo before each arc so the sub-circles don't connect with stray lines.
  ctx.fillStyle = '#5fd07a';
  ctx.beginPath();
  for (const n of state.nutrients) {
    ctx.moveTo(n.x + 1.6, n.y);
    ctx.arc(n.x, n.y, 1.6, 0, Math.PI * 2);
  }
  ctx.fill();

  // plasmids — pulsing rings colored by gene
  for (const p of state.plasmids) {
    const pulse = 1 + 0.25 * Math.sin(p.age * 6);
    const alpha = clamp(1 - p.age / p.life, 0.2, 1);
    const [r, g, b] = ANTIBIOTICS[p.gene].rgb;
    ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.2 * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
    ctx.fill();
  }

  // bacteria
  for (const b of state.bacteria) {
    // efflux aura
    if (b.efflux > 0) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, CONFIG.bactRadius + 3.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(94,234,212,${0.18 * b.efflux})`;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(b.x, b.y, CONFIG.bactRadius, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${b.cr | 0},${b.cg | 0},${b.cb | 0})`; // cached colour
    ctx.fill();
    // resistant cells get a crisp border (efflux pump indicator)
    if (hasAnyResistance(b)) {
      ctx.lineWidth = b.efflux > 0 ? 1.6 : 0.9;
      ctx.strokeStyle = b.efflux > 0 ? 'rgba(94,234,212,0.95)' : 'rgba(255,255,255,0.5)';
      ctx.stroke();
    }
  }

  // cell inspector: highlight ring around the hovered cell
  if (state.hovered && !state.hovered.dead) {
    const h = state.hovered;
    ctx.beginPath();
    ctx.arc(h.x, h.y, CONFIG.bactRadius + 5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.restore();

  // dish rim
  ctx.beginPath();
  ctx.arc(CONFIG.cx, CONFIG.cy, CONFIG.radius, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

// Live time-series chart: population (white, scaled to maxPopulation) plus the three
// per-gene resistance percentages, over a rolling window of history samples.
function renderChart() {
  if (!chartCtx) return;
  const W = chartCanvas.width, H = chartCanvas.height;
  const cc = chartCtx;
  cc.clearRect(0, 0, W, H);
  cc.fillStyle = '#0f141c';
  cc.fillRect(0, 0, W, H);

  // gridlines at 25/50/75%
  cc.strokeStyle = 'rgba(255,255,255,0.06)';
  cc.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = (i / 4) * H;
    cc.beginPath(); cc.moveTo(0, y); cc.lineTo(W, y); cc.stroke();
  }

  const hist = state.history;
  if (hist.length < 2) return;
  const n = hist.length;
  const xAt = i => (i / (n - 1)) * W;

  // helper: draw a polyline for a value accessor mapped 0..1 (1 = top)
  const line = (accessor, color, width) => {
    cc.strokeStyle = color;
    cc.lineWidth = width;
    cc.beginPath();
    for (let i = 0; i < n; i++) {
      const v = clamp(accessor(hist[i]), 0, 1);
      const y = H - v * H;
      if (i === 0) cc.moveTo(xAt(i), y); else cc.lineTo(xAt(i), y);
    }
    cc.stroke();
  };

  // population scaled against carrying-capacity-ish ceiling for readability
  const popMax = CONFIG.maxPopulation;
  line(s => s.living / popMax, 'rgba(230,234,240,0.85)', 1.6);
  line(s => s.penPct / 100, ANTIBIOTICS.penicillin.color, 1.4);
  line(s => s.tetPct / 100, ANTIBIOTICS.tetracycline.color, 1.4);
  line(s => s.cipPct / 100, ANTIBIOTICS.cipro.color, 1.4);
}

/* ============================================================
   8. GAME LOOP (fixed-step accumulator, ~60 FPS)
   ============================================================ */

let lastTime = performance.now();
let accumulator = 0;
let fpsEMA = 60;
let frameCount = 0;

function frame(now) {
  let frameTime = (now - lastTime) / 1000;
  lastTime = now;
  if (frameTime > 0.25) frameTime = 0.25; // avoid spiral of death after a tab stall
  fpsEMA = fpsEMA * 0.9 + (1 / Math.max(frameTime, 1e-4)) * 0.1;

  if (!state.paused) {
    // sim-speed scales how much simulated time passes per real second
    accumulator += frameTime * CONFIG.simSpeed;
    let steps = 0;
    while (accumulator >= CONFIG.fixedDt && steps < 8) {
      update(CONFIG.fixedDt);
      accumulator -= CONFIG.fixedDt;
      steps++;
    }
    if (steps === 8) accumulator = 0; // shed backlog at very high speeds
  }

  render();

  // Refresh stats/chart on a FRAME cadence (~4x/sec at 60 fps) rather than a tick cadence, so
  // the rate stays steady regardless of sim speed and is never tied to which tick a frame ends
  // on. (History sampling lives in update() so it can't be skipped at high sim speed.)
  frameCount++;
  if (frameCount % 15 === 0 || state.paused) { updateStats(); renderChart(); }

  requestAnimationFrame(frame);
}

/* ============================================================
   9. UI WIRING
   ============================================================ */

const els = {};
function cacheEls() {
  [
    'mutationRate', 'mutationRateVal', 'nutrientRate', 'nutrientRateVal',
    'simSpeed', 'simSpeedVal',
    'presetSelect', 'btnPreset',
    'btnSpawn', 'btnPenicillin', 'btnTetracycline', 'btnCipro',
    'btnClearPlasmids', 'btnReset', 'btnPause',
    'gradientGene', 'btnGradient',
    'courseDrug', 'courseDose', 'courseDoseVal', 'courseInterval', 'courseIntervalVal',
    'courseDoses', 'courseAdherence', 'courseAdherenceVal', 'btnCourse', 'courseStatus',
    'statLiving', 'statResistant', 'statMultiResistant', 'statPlasmids', 'statNutrients', 'statTick',
    'barPen', 'barTet', 'barCip', 'cntPen', 'cntTet', 'cntCip',
    'chart', 'tooltip', 'ledger',
  ].forEach(id => { els[id] = document.getElementById(id); });
}

// ---- ledger ----
const MAX_LEDGER = 120;
const CHART_HISTORY = 180; // rolling window of per-second samples for the live chart
function addLedger(msg, kind = 'info') {
  const time = `${String(((state.tick / 60) | 0) / 60 | 0).padStart(2, '0')}:${String(((state.tick / 60) | 0) % 60).padStart(2, '0')}`;
  const entry = document.createElement('div');
  entry.className = `entry ${kind}`;
  entry.innerHTML = `<span class="t">${time}</span>${msg}`;
  els.ledger.appendChild(entry);
  while (els.ledger.childElementCount > MAX_LEDGER) {
    els.ledger.removeChild(els.ledger.firstChild);
  }
  els.ledger.scrollTop = els.ledger.scrollHeight;
}

// ---- stats ----
// Single pass over the colony. pen/tet/cip = how many cells carry ANY resistance (MIC >= 1) to
// that drug; micPen/micTet/micCip = summed MIC for the colony mean. `resistant` = resists >=1
// drug, `multi` = resists >=2. A multi-resistant cell counts in every drug it resists, so
// pen+tet+cip can exceed `resistant`.
function colonyCounts() {
  let resistant = 0, multi = 0, pen = 0, tet = 0, cip = 0, micPen = 0, micTet = 0, micCip = 0;
  for (const b of state.bacteria) {
    const m = b.mic;
    let drugs = 0;
    if (m.penicillin   >= 1) { pen++; drugs++; }
    if (m.tetracycline >= 1) { tet++; drugs++; }
    if (m.cipro        >= 1) { cip++; drugs++; }
    micPen += m.penicillin; micTet += m.tetracycline; micCip += m.cipro;
    if (drugs >= 1) resistant++;
    if (drugs >= 2) multi++;
  }
  return { living: state.bacteria.length, resistant, multi, pen, tet, cip, micPen, micTet, micCip };
}

// Push one rolling-window sample for the live chart. Called from update() on every 60th tick
// (per-tick, so it can't be skipped at high sim speed), capped at CHART_HISTORY samples.
function sampleHistory() {
  const c = colonyCounts();
  const denom = Math.max(c.living, 1);
  state.history.push({
    living: c.living,
    penPct: Math.round((c.pen / denom) * 100),
    tetPct: Math.round((c.tet / denom) * 100),
    cipPct: Math.round((c.cip / denom) * 100),
  });
  if (state.history.length > CHART_HISTORY) state.history.shift();
}

function updateStats() {
  const c = colonyCounts();
  const living = c.living;
  els.statLiving.textContent = living;
  els.statResistant.textContent = c.resistant;
  els.statMultiResistant.textContent = c.multi;
  els.statPlasmids.textContent = state.plasmids.length;
  els.statNutrients.textContent = state.nutrients.length;
  els.statTick.textContent = `Tick ${state.tick} · Gen ${state.generation} · ${fpsEMA.toFixed(0)} FPS`;

  // Graded display: the bar fills with the colony's MEAN MIC for the drug (0..micMax), and the
  // label shows how many cells resist it at all (MIC>=1) plus that mean as "μ<level>".
  const denom = Math.max(living, 1);
  const meanPen = c.micPen / denom, meanTet = c.micTet / denom, meanCip = c.micCip / denom;
  els.barPen.style.width = `${(meanPen / CONFIG.micMax) * 100}%`;
  els.barTet.style.width = `${(meanTet / CONFIG.micMax) * 100}%`;
  els.barCip.style.width = `${(meanCip / CONFIG.micMax) * 100}%`;
  els.cntPen.textContent = `${c.pen} · μ${meanPen.toFixed(1)}`;
  els.cntTet.textContent = `${c.tet} · μ${meanTet.toFixed(1)}`;
  els.cntCip.textContent = `${c.cip} · μ${meanCip.toFixed(1)}`;

  renderCourseStatus(); // live course indicator ticks with the stats refresh (and the countdown)
}

// ---- actions ----
function spawnBacteria(n = CONFIG.spawnBatch, staggerAge = false) {
  for (let i = 0; i < n && state.bacteria.length < CONFIG.maxPopulation; i++) {
    const p = randomDishPoint();
    const b = createBacterium(p.x, p.y);
    // Stagger founder ages so the whole seed cohort doesn't hit its lifespan and
    // die in the same few seconds (which caused a deep early population crash).
    if (staggerAge) b.age = rand(0, b.lifespan * 0.6);
    state.bacteria.push(b);
  }
  addLedger(`Spawned ${n} bacteria into the dish.`, 'info');
}

function floodAntibiotic(gene, dose = CONFIG.floodDose, log = true) {
  const a = ANTIBIOTICS[gene];
  // Don't STACK floods of the same drug — that would multiply the efflux tax and wrongly
  // starve resistant cells when the button is mashed. Instead re-arm the existing front and
  // adopt the new dose. Different drugs still combine. `log=false` lets the treatment course
  // drive the mechanic but write its own ledger line instead of the generic flood message.
  const existing = state.floods.find(f => f.gene === gene);
  if (existing) {
    existing.age = 0;
    existing.front = 0;
    existing.dose = dose;
    if (log) addLedger(`💉 Re-flooded ${a.name} — the drug front resets and sweeps again.`, 'flood');
  } else {
    state.floods.push(createFlood(gene, dose));
    if (log) addLedger(`💉 Flooded ${a.name} (targets ${a.target}). Susceptible cells dying.`, 'flood');
  }
  // Snap the stats panel to the new reality immediately — otherwise the periodic refresh
  // can lag the fast flood die-off by up to ~0.25 s right after the user acts.
  updateStats();
}

// Toggle the MEGA-plate gradient. Activating it sets a standing dose field of one drug;
// toggling again (or picking it while active) clears it back to a normal open dish.
function toggleGradient() {
  const gene = els.gradientGene.value;
  if (state.gradient && state.gradient.gene === gene) {
    state.gradient = null;
    addLedger('MEGA-plate gradient cleared — dish is open again.', 'info');
  } else {
    state.gradient = { gene };
    const a = ANTIBIOTICS[gene];
    addLedger(`🧬 MEGA-plate gradient set: ${a.name} in bands up to ${CONFIG.gradientBands[CONFIG.gradientBands.length - 1]}× MIC. Only the refuge is safe for susceptibles.`, 'flood');
  }
  syncGradientButton();
  updateStats();
}

function syncGradientButton() {
  if (!els.btnGradient) return;
  const on = !!state.gradient;
  els.btnGradient.textContent = on ? '⏹ Clear MEGA-plate' : '🧬 Set MEGA-plate';
  els.btnGradient.classList.toggle('active', on);
}

// ---- treatment course (a scheduled, repeating drug regimen) ----
// Dose strength is on the same MIC-band scale as a cell's MIC: level 1 -> "1× MIC", 2 -> "10×",
// 3 -> "100×", 4 -> "1000×" (mirrors the inspector tooltip's band labels).
function doseLabel(dose) { return `${10 ** (dose - 1)}× MIC`; }

// Read the Treatment Course controls and arm a regimen on state.course. The doses themselves are
// delivered per-tick by advanceCourse() (inside update()), so they respect pause and sim speed.
function startCourse() {
  if (state.course) return;
  const drug = els.courseDrug.value;
  const dose = clamp(parseInt(els.courseDose.value, 10) || 1, 1, CONFIG.micMax);
  const intervalSec = Math.max(0.5, parseFloat(els.courseInterval.value) || 1);
  const doses = Math.max(1, parseInt(els.courseDoses.value, 10) || 1);
  const adherence = clamp((parseFloat(els.courseAdherence.value) || 0) / 100, 0, 1);
  state.course = {
    drug,
    dose,
    intervalTicks: Math.max(1, Math.round(intervalSec * 60)),
    dosesRemaining: doses,
    nextDoseTick: state.tick,        // first dose lands on the next tick
    adherence,
    total: doses,
    taken: 0,
    missed: 0,
    resistantAtStart: colonyCounts().resistant,
  };
  addLedger(`🩺 Treatment course started: ${doses} × ${ANTIBIOTICS[drug].name} at ${doseLabel(dose)}, ` +
            `every ${intervalSec}s, ${Math.round(adherence * 100)}% adherence.`, 'flood');
  syncCourseUI();
  updateStats();
}

// Per-tick dosing engine, called from update(). When a scheduled dose comes due, roll against
// adherence: a kept dose floods the chosen drug at the chosen strength (reusing the flood
// mechanic); a skipped dose is logged as a missed dose. Either way the next dose is scheduled and
// the counter ticks down; the course ends (with a summary) once no doses remain.
function advanceCourse() {
  const c = state.course;
  if (!c || c.dosesRemaining <= 0 || state.tick < c.nextDoseTick) return;
  const n = c.taken + c.missed + 1;   // 1-based index of this dose, for the ledger
  if (Math.random() < c.adherence) {
    c.taken++;
    floodAntibiotic(c.drug, c.dose, false); // reuse the flood mechanic; course writes its own line
    addLedger(`💊 Dose ${n}/${c.total} administered — ${ANTIBIOTICS[c.drug].name} at ${doseLabel(c.dose)}.`, 'flood');
  } else {
    c.missed++;
    addLedger(`🚫 Dose ${n}/${c.total} MISSED — non-adherence (${ANTIBIOTICS[c.drug].name} not given).`, 'wipe');
  }
  c.dosesRemaining--;
  c.nextDoseTick = state.tick + c.intervalTicks;
  if (c.dosesRemaining <= 0) endCourse(false);
}

// End the active course and log a summary — including whether resistance rose over the course
// (resistant-cell count at start vs now), the teaching payoff of the whole regimen.
function endCourse(stopped) {
  const c = state.course;
  if (!c) return;
  const resNow = colonyCounts().resistant;
  const delta = resNow - c.resistantAtStart;
  const trend = delta > 0 ? `rose ${c.resistantAtStart} → ${resNow}`
              : delta < 0 ? `fell ${c.resistantAtStart} → ${resNow}`
              : `held at ${resNow}`;
  const verdict = delta > 0 ? ' — resistance INCREASED over the course.'
                : delta < 0 ? ' — resistance fell over the course.'
                : ' — resistance unchanged.';
  const head = stopped
    ? `Treatment course stopped early (${c.dosesRemaining} dose${c.dosesRemaining === 1 ? '' : 's'} skipped)`
    : 'Treatment course complete';
  addLedger(`🧪 ${head}: ${c.taken} taken, ${c.missed} missed. Resistant cells ${trend}${verdict}`,
            delta > 0 ? 'wipe' : 'info');
  state.course = null;
  syncCourseUI();
  updateStats();
}

function toggleCourse() {
  if (state.course) endCourse(true);
  else startCourse();
}

// Live course indicator: doses left, next-dose countdown (simulated seconds), missed count.
function renderCourseStatus() {
  if (!els.courseStatus) return;
  const c = state.course;
  if (!c) { els.courseStatus.innerHTML = '<span class="course-idle">No active course</span>'; return; }
  const secs = Math.max(0, (c.nextDoseTick - state.tick) / 60);
  els.courseStatus.innerHTML =
    `<span><b>${c.dosesRemaining}</b> left</span>` +
    `<span>next in <b>${secs.toFixed(1)}s</b></span>` +
    `<span><b>${c.missed}</b> missed</span>`;
}

// Reflect course state in the UI: button label/highlight, lock the inputs while a course runs so
// it can't be edited mid-flight, and refresh the live indicator.
function syncCourseUI() {
  if (!els.btnCourse) return;
  const active = !!state.course;
  els.btnCourse.textContent = active ? '⏹ Stop Course' : '▶ Start Course';
  els.btnCourse.classList.toggle('active', active);
  for (const el of [els.courseDrug, els.courseDose, els.courseInterval, els.courseDoses, els.courseAdherence]) {
    if (el) el.disabled = active;
  }
  renderCourseStatus();
}

function clearPlasmids() {
  const n = state.plasmids.length;
  state.plasmids = [];
  addLedger(`Cleared ${n} floating plasmid${n === 1 ? '' : 's'}.`, 'info');
}

function resetSim() {
  state.bacteria = [];
  state.nutrients = [];
  state.plasmids = [];
  state.floods = [];
  state.tick = 0;
  state.generation = 0;
  state.nutrientAccumulator = 0;
  state.mutationsThisWindow = 0;
  state.hgtThisWindow = 0;
  state.gradient = null;
  state.course = null;
  state.history = [];
  state.hovered = null;
  if (els.tooltip) els.tooltip.hidden = true;
  syncGradientButton();
  syncCourseUI();
  els.ledger.innerHTML = '';
  // seed
  for (let i = 0; i < 40; i++) { const p = randomDishPoint(); state.nutrients.push(createNutrient(p.x, p.y)); }
  spawnBacteria(CONFIG.startPopulation, true);
  addLedger('Simulation reset. A fresh colony begins.', 'info');
  updateStats();
}

// Load a named scenario: sync the sliders, wipe the world, and seed a tailored colony.
function applyPreset(key) {
  const p = PRESETS[key];
  if (!p) return;

  // sliders (DOM value + CONFIG + label all in lock-step, same as init/bindUI)
  els.mutationRate.value = p.mutation;
  CONFIG.mutationRate = p.mutation / 100;
  els.mutationRateVal.textContent = `${p.mutation.toFixed(1)}%`;
  els.nutrientRate.value = p.nutrient;
  CONFIG.nutrientRate = p.nutrient;
  els.nutrientRateVal.textContent = `${p.nutrient}/s`;
  els.simSpeed.value = p.speed;
  CONFIG.simSpeed = p.speed;
  els.simSpeedVal.textContent = `${p.speed.toFixed(2)}×`;

  // wipe world
  state.bacteria = [];
  state.nutrients = [];
  state.plasmids = [];
  state.floods = [];
  state.gradient = null;
  state.course = null;
  state.tick = 0;
  state.generation = 0;
  state.nutrientAccumulator = 0;
  state.mutationsThisWindow = 0;
  state.hgtThisWindow = 0;
  state.history = [];
  state.hovered = null;
  if (els.tooltip) els.tooltip.hidden = true;
  els.ledger.innerHTML = '';

  // seed nutrients
  for (let i = 0; i < 60; i++) { const q = randomDishPoint(); state.nutrients.push(createNutrient(q.x, q.y)); }

  // seed founders, some pre-resistant. Resistant founders get MIC = seedMic (default 1, i.e. the
  // minimum resistant level) for `genesPerResistant` random drugs — the graded analogue of the
  // old boolean "gene on", so existing presets load unchanged.
  const s = p.seed;
  const level = s.seedMic || 1;
  for (let i = 0; i < s.count && state.bacteria.length < CONFIG.maxPopulation; i++) {
    const q = randomDishPoint();
    let mic = null;
    if (s.resistantFrac && Math.random() < s.resistantFrac) {
      mic = { penicillin: 0, tetracycline: 0, cipro: 0 };
      const pick = [...GENES].sort(() => Math.random() - 0.5).slice(0, s.genesPerResistant || 1);
      for (const g of pick) mic[g] = level;
    }
    const b = createBacterium(q.x, q.y, mic);
    b.age = rand(0, b.lifespan * 0.6); // stagger ages so founders don't die together
    state.bacteria.push(b);
  }

  if (p.gradient) {
    state.gradient = { gene: p.gradient };
    if (els.gradientGene) els.gradientGene.value = p.gradient; // keep the toggle in sync
  }
  syncGradientButton();
  syncCourseUI();
  addLedger(`Preset loaded — ${p.label}: ${p.blurb}`, 'info');
  updateStats();
}

function bindUI() {
  // sliders
  els.mutationRate.addEventListener('input', e => {
    const pct = parseFloat(e.target.value);
    CONFIG.mutationRate = pct / 100;
    els.mutationRateVal.textContent = `${pct.toFixed(1)}%`;
  });
  els.nutrientRate.addEventListener('input', e => {
    CONFIG.nutrientRate = parseFloat(e.target.value);
    els.nutrientRateVal.textContent = `${e.target.value}/s`;
  });
  els.simSpeed.addEventListener('input', e => {
    CONFIG.simSpeed = parseFloat(e.target.value);
    els.simSpeedVal.textContent = `${CONFIG.simSpeed.toFixed(2)}×`;
  });

  // presets
  els.btnPreset.addEventListener('click', () => applyPreset(els.presetSelect.value));

  // buttons
  els.btnSpawn.addEventListener('click', () => spawnBacteria());
  els.btnPenicillin.addEventListener('click', () => floodAntibiotic('penicillin'));
  els.btnTetracycline.addEventListener('click', () => floodAntibiotic('tetracycline'));
  els.btnCipro.addEventListener('click', () => floodAntibiotic('cipro'));
  els.btnClearPlasmids.addEventListener('click', clearPlasmids);
  els.btnGradient.addEventListener('click', toggleGradient);
  els.btnReset.addEventListener('click', resetSim);
  els.btnPause.addEventListener('click', () => {
    state.paused = !state.paused;
    els.btnPause.textContent = state.paused ? '▶ Resume' : '⏸ Pause';
  });

  // treatment course: live slider labels + start/stop toggle
  els.courseDose.addEventListener('input', e => {
    els.courseDoseVal.textContent = doseLabel(parseInt(e.target.value, 10) || 1);
  });
  els.courseInterval.addEventListener('input', e => {
    els.courseIntervalVal.textContent = `${e.target.value}s`;
  });
  els.courseAdherence.addEventListener('input', e => {
    els.courseAdherenceVal.textContent = `${e.target.value}%`;
  });
  els.btnCourse.addEventListener('click', toggleCourse);

  // click the dish to drop a cluster of bacteria
  canvas.addEventListener('click', e => {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * CONFIG.size;
    const y = ((e.clientY - rect.top) / rect.height) * CONFIG.size;
    if (dist2(x, y, CONFIG.cx, CONFIG.cy) > CONFIG.radius * CONFIG.radius) return;
    for (let i = 0; i < 8 && state.bacteria.length < CONFIG.maxPopulation; i++) {
      state.bacteria.push(createBacterium(x + rand(-8, 8), y + rand(-8, 8)));
    }
  });

  // cell inspector: hover to inspect the nearest bacterium under the cursor
  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * CONFIG.size;
    const y = ((e.clientY - rect.top) / rect.height) * CONFIG.size;
    const pickR = CONFIG.bactRadius + 4;
    let best = null, bestD = pickR * pickR;
    for (const b of state.bacteria) {
      const d = dist2(x, y, b.x, b.y);
      if (d < bestD) { bestD = d; best = b; }
    }
    state.hovered = best;
    showTooltip(best, e.clientX - rect.left, e.clientY - rect.top);
  });
  canvas.addEventListener('mouseleave', () => {
    state.hovered = null;
    if (els.tooltip) els.tooltip.hidden = true;
  });
}

// Render the inspector tooltip card for a hovered cell (or hide it).
function showTooltip(b, px, py) {
  const tip = els.tooltip;
  if (!tip) return;
  if (!b) { tip.hidden = true; return; }
  // MIC level -> "×MIC" band label (level 1 = 1×, 2 = 10×, 3 = 100×, 4 = 1000×)
  const micFmt = lvl => `${Math.round(10 ** (lvl - 1))}× MIC`;
  const parts = GENES.filter(g => b.mic[g] > 0).map(g => `${ANTIBIOTICS[g].name} ${micFmt(b.mic[g])}`);
  const resLine = parts.length ? parts.join(', ') : 'none — susceptible (MIC 0)';
  const nDrugs = parts.length;
  // plain-language footer so the inspector also teaches the terms
  const note = b.efflux > 0
    ? 'Efflux pump ON: pumping the antibiotic out to survive (burns energy, scales with MIC).'
    : nDrugs >= 2
      ? 'Multi-drug-resistant (MDR): elevated MIC to several drugs — a "superbug".'
      : nDrugs === 1
        ? 'Resistant to one drug — survives doses up to its MIC; a higher dose still kills it.'
        : 'No resistance (MIC 0) — dies if its area is dosed with any antibiotic.';
  tip.innerHTML =
    `<div class="tip-title">${nDrugs ? (nDrugs >= 2 ? 'Multi-resistant cell' : 'Resistant cell') : 'Susceptible cell'}</div>` +
    `<div><span>Resists</span><b>${resLine}</b></div>` +
    `<div><span>Energy</span><b>${b.energy.toFixed(0)} / ${CONFIG.divideThreshold} to divide</b></div>` +
    `<div><span>Age</span><b>${b.age.toFixed(1)} / ${b.lifespan.toFixed(0)} s</b></div>` +
    `<div><span>Efflux pump</span><b>${b.efflux > 0 ? 'active' : 'idle'}</b></div>` +
    `<div><span>Plasmid slots</span><b>${b.plasmidSlots}</b></div>` +
    `<div class="tip-note">${note}</div>`;
  tip.hidden = false;
  // position next to the cursor (coords are relative to the canvas; offset by the canvas's
  // position inside its container), flipping left near the right edge
  const offset = 14;
  const flip = px + offset + tip.offsetWidth > canvas.clientWidth;
  const x = canvas.offsetLeft + (flip ? px - offset - tip.offsetWidth : px + offset);
  tip.style.left = `${x}px`;
  tip.style.top = `${canvas.offsetTop + py + offset}px`;
}

/* ============================================================
   10. INIT
   ============================================================ */

function init() {
  canvas = document.getElementById('dish');
  ctx = canvas.getContext('2d');
  cacheEls();
  chartCanvas = els.chart;
  if (chartCanvas) chartCtx = chartCanvas.getContext('2d');
  bindUI();
  syncGradientButton();

  // sync slider config with default DOM values
  CONFIG.mutationRate = parseFloat(els.mutationRate.value) / 100;
  CONFIG.nutrientRate = parseFloat(els.nutrientRate.value);
  CONFIG.simSpeed = parseFloat(els.simSpeed.value);
  els.mutationRateVal.textContent = `${parseFloat(els.mutationRate.value).toFixed(1)}%`;
  els.nutrientRateVal.textContent = `${els.nutrientRate.value}/s`;
  els.simSpeedVal.textContent = `${CONFIG.simSpeed.toFixed(2)}×`;

  // treatment-course control labels (the sliders' DOM values are the source of truth)
  els.courseDoseVal.textContent = doseLabel(parseInt(els.courseDose.value, 10) || 1);
  els.courseIntervalVal.textContent = `${els.courseInterval.value}s`;
  els.courseAdherenceVal.textContent = `${els.courseAdherence.value}%`;
  syncCourseUI();

  // seed world
  for (let i = 0; i < 40; i++) { const p = randomDishPoint(); state.nutrients.push(createNutrient(p.x, p.y)); }
  spawnBacteria(CONFIG.startPopulation, true);
  addLedger('Welcome to the AMR Evolution Sandbox. Selection pressure awaits.', 'info');

  lastTime = performance.now();
  requestAnimationFrame(frame);
}

document.addEventListener('DOMContentLoaded', init);
