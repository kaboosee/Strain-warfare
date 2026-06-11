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
  drag: 0.86,
  lifespanMin: 14,         // seconds
  lifespanMax: 30,
  nutrientEnergy: 30,      // energy gained per nutrient eaten
  eatRadius: 8,            // center-to-center distance at which a cell consumes a nutrient

  // genetics (mutationRate set live from slider, as a fraction 0..1 per division)
  mutationRate: 0.02,

  // HGT / plasmids
  plasmidDropChance: 0.55,  // chance a resistant cell drops a plasmid on death
  plasmidLifespan: 16,      // seconds before it degrades
  plasmidPickupRadius: 7,

  // nutrients (rate set live from slider — nutrients spawned per second across the dish)
  nutrientRate: 30,        // supply * nutrientEnergy = 900 energy/s -> carrying capacity 225
  maxNutrients: 1200,      // standing food buffer cap so small colonies don't supply-starve

  // antibiotics
  floodDuration: 7,     // seconds the drug lingers
  floodSweep: 1.1,      // seconds for the front to cross the dish
  floodDamage: 70,      // energy/sec drained from susceptible cells under the drug
  effluxCost: 9,        // extra energy/sec resistant cells pay to pump it out

  // simulation
  simSpeed: 1,
  fixedDt: 1 / 60,      // physics step
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
};

let canvas, ctx;

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
  return b.resistanceGenes.penicillin || b.resistanceGenes.tetracycline || b.resistanceGenes.cipro;
}

// Blend a bacterium's color from the resistance genes it carries.
function bacteriumColor(b) {
  const active = GENES.filter(g => b.resistanceGenes[g]);
  if (active.length === 0) return [127, 191, 127]; // susceptible grey-green
  let r = 0, g = 0, bl = 0;
  for (const gene of active) {
    const c = ANTIBIOTICS[gene].rgb;
    r += c[0]; g += c[1]; bl += c[2];
  }
  return [r / active.length, g / active.length, bl / active.length];
}

/* ============================================================
   4. ENTITY FACTORIES
   ============================================================ */

function createBacterium(x, y, genes = null) {
  return {
    x, y,
    vx: rand(-8, 8),
    vy: rand(-8, 8),
    energy: CONFIG.startEnergy,
    age: 0,
    lifespan: rand(CONFIG.lifespanMin, CONFIG.lifespanMax),
    resistanceGenes: genes
      ? { ...genes }
      : { penicillin: false, tetracycline: false, cipro: false },
    plasmidSlots: 1,   // how many plasmids it can still absorb
    efflux: 0,         // >0 means actively pumping (decays for the visual glow)
    dead: false,
  };
}

function createNutrient(x, y) {
  return { x, y };
}

function createPlasmid(x, y, gene) {
  return { x, y, gene, age: 0, life: CONFIG.plasmidLifespan };
}

// A flood = a drug sweeping across the dish then lingering, then clearing.
function createFlood(geneTarget) {
  return {
    gene: geneTarget,
    age: 0,
    front: 0,              // 0..1 sweep progress (left -> right)
    duration: CONFIG.floodDuration,
    sweep: CONFIG.floodSweep,
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
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    return cy * this.cols + cx;
  }
  clear() { this.map.clear(); }
  insert(entity) {
    const k = this._key(entity.x, entity.y);
    let bucket = this.map.get(k);
    if (!bucket) { bucket = []; this.map.set(k, bucket); }
    bucket.push(entity);
  }
  // Return all entities in the 3x3 block of cells around (x, y).
  queryNearby(x, y) {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const out = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = this.map.get((cy + dy) * this.cols + (cx + dx));
        // direct copy (no spread) — hot path, called per-bacterium per-step for both grids
        if (bucket) for (let i = 0; i < bucket.length; i++) out.push(bucket[i]);
      }
    }
    return out;
  }
}

const nutrientGrid = new SpatialGrid(20);
const plasmidGrid = new SpatialGrid(16);

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
    b.energy -= CONFIG.energyDecayPerSec * dt;
    if (b.efflux > 0) b.efflux = Math.max(0, b.efflux - dt * 2);

    // antibiotic exposure
    for (const f of state.floods) {
      // a cell is "under" the drug once the sweep front has passed its x position
      const reach = f.front * CONFIG.size;
      if (b.x <= reach) {
        if (b.resistanceGenes[f.gene]) {
          // resistant: survive but pay the efflux-pump tax
          b.energy -= CONFIG.effluxCost * dt;
          b.efflux = 1;
        } else {
          // susceptible: rapidly drained
          b.energy -= CONFIG.floodDamage * dt;
        }
      }
    }

    // eat nearby nutrients
    const near = nutrientGrid.queryNearby(b.x, b.y);
    for (const n of near) {
      if (n.eaten) continue;
      if (dist2(b.x, b.y, n.x, n.y) < CONFIG.eatRadius * CONFIG.eatRadius) {
        n.eaten = true;
        b.energy += CONFIG.nutrientEnergy;
      }
    }

    // HGT: absorb a nearby plasmid if susceptible to that gene and has a slot
    if (b.plasmidSlots > 0) {
      const nearP = plasmidGrid.queryNearby(b.x, b.y);
      for (const p of nearP) {
        if (p.absorbed) continue;
        if (b.resistanceGenes[p.gene]) continue;
        if (dist2(b.x, b.y, p.x, p.y) < CONFIG.plasmidPickupRadius * CONFIG.plasmidPickupRadius) {
          p.absorbed = true;
          b.resistanceGenes[p.gene] = true;
          b.plasmidSlots--;
          addLedger(`Plasmid absorbed → gained ${ANTIBIOTICS[p.gene].name} resistance (HGT).`, 'hgt');
          break;
        }
      }
    }

    // reproduction
    if (b.energy >= CONFIG.divideThreshold && state.bacteria.length + births.length < CONFIG.maxPopulation) {
      const childGenes = { ...b.resistanceGenes };

      // mutation roll per gene
      for (const gene of GENES) {
        if (!childGenes[gene] && Math.random() < CONFIG.mutationRate) {
          childGenes[gene] = true;
          state.mutationsThisWindow++;
        }
      }

      const angle = Math.random() * Math.PI * 2;
      const child = createBacterium(
        b.x + Math.cos(angle) * 5,
        b.y + Math.sin(angle) * 5,
        childGenes
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
      // HGT seed: resistant corpses may leave a plasmid
      if (hasAnyResistance(b) && Math.random() < CONFIG.plasmidDropChance) {
        const resistant = GENES.filter(g => b.resistanceGenes[g]);
        const gene = resistant[(Math.random() * resistant.length) | 0];
        state.plasmids.push(createPlasmid(b.x, b.y, gene));
      }
    }
  }

  // commit births
  for (const child of births) state.bacteria.push(child);
  if (births.length) state.generation++;

  // remove eaten nutrients & dead bacteria
  state.nutrients = state.nutrients.filter(n => !n.eaten);

  const livingBefore = state.bacteria.length;
  state.bacteria = state.bacteria.filter(b => !b.dead);

  // colony-wipe detection
  if (livingBefore > 0 && state.bacteria.length === 0) {
    addLedger('💀 Colony wiped out — no bacteria remain.', 'wipe');
  }

  // flush batched mutation count to the ledger once per ~second
  if (state.tick % 60 === 0 && state.mutationsThisWindow > 0) {
    addLedger(`Mutation${state.mutationsThisWindow > 1 ? 's' : ''} occurred ×${state.mutationsThisWindow} — new resistance arose.`, 'mut');
    state.mutationsThisWindow = 0;
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
    const fade = clamp(1 - (f.age - f.sweep) / (f.duration - f.sweep), 0.25, 1);
    const [r, g, b] = ANTIBIOTICS[f.gene].rgb;
    ctx.fillStyle = `rgba(${r},${g},${b},${0.12 * fade})`;
    ctx.fillRect(0, 0, reach, CONFIG.size);
    // leading edge glow
    if (f.front < 1) {
      ctx.fillStyle = `rgba(${r},${g},${b},${0.32 * fade})`;
      ctx.fillRect(reach - 10, 0, 12, CONFIG.size);
    }
  }

  // nutrients
  ctx.fillStyle = '#5fd07a';
  for (const n of state.nutrients) {
    ctx.beginPath();
    ctx.arc(n.x, n.y, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

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
    const [r, g, bl] = bacteriumColor(b);
    // efflux aura
    if (b.efflux > 0) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, CONFIG.bactRadius + 3.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(94,234,212,${0.18 * b.efflux})`;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(b.x, b.y, CONFIG.bactRadius, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${r | 0},${g | 0},${bl | 0})`;
    ctx.fill();
    // resistant cells get a crisp border (efflux pump indicator)
    if (hasAnyResistance(b)) {
      ctx.lineWidth = b.efflux > 0 ? 1.6 : 0.9;
      ctx.strokeStyle = b.efflux > 0 ? 'rgba(94,234,212,0.95)' : 'rgba(255,255,255,0.5)';
      ctx.stroke();
    }
  }

  ctx.restore();

  // dish rim
  ctx.beginPath();
  ctx.arc(CONFIG.cx, CONFIG.cy, CONFIG.radius, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

/* ============================================================
   8. GAME LOOP (fixed-step accumulator, ~60 FPS)
   ============================================================ */

let lastTime = performance.now();
let accumulator = 0;
let fpsEMA = 60;

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

  // refresh stats ~4x/sec for readability
  if (state.tick % 15 === 0 || state.paused) updateStats();

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
    'btnSpawn', 'btnPenicillin', 'btnTetracycline', 'btnCipro',
    'btnClearPlasmids', 'btnReset', 'btnPause',
    'statLiving', 'statResistant', 'statPlasmids', 'statNutrients', 'statTick',
    'barPen', 'barTet', 'barCip', 'cntPen', 'cntTet', 'cntCip',
    'ledger',
  ].forEach(id => { els[id] = document.getElementById(id); });
}

// ---- ledger ----
const MAX_LEDGER = 120;
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
function updateStats() {
  const living = state.bacteria.length;
  let resistant = 0, pen = 0, tet = 0, cip = 0;
  for (const b of state.bacteria) {
    if (hasAnyResistance(b)) resistant++;
    if (b.resistanceGenes.penicillin) pen++;
    if (b.resistanceGenes.tetracycline) tet++;
    if (b.resistanceGenes.cipro) cip++;
  }
  els.statLiving.textContent = living;
  els.statResistant.textContent = resistant;
  els.statPlasmids.textContent = state.plasmids.length;
  els.statNutrients.textContent = state.nutrients.length;
  els.statTick.textContent = `Tick ${state.tick} · Gen ${state.generation} · ${fpsEMA.toFixed(0)} FPS`;

  const denom = Math.max(living, 1);
  els.barPen.style.width = `${(pen / denom) * 100}%`;
  els.barTet.style.width = `${(tet / denom) * 100}%`;
  els.barCip.style.width = `${(cip / denom) * 100}%`;
  els.cntPen.textContent = pen;
  els.cntTet.textContent = tet;
  els.cntCip.textContent = cip;
}

// ---- actions ----
function spawnBacteria(n = CONFIG.spawnBatch) {
  for (let i = 0; i < n && state.bacteria.length < CONFIG.maxPopulation; i++) {
    const p = randomDishPoint();
    state.bacteria.push(createBacterium(p.x, p.y));
  }
  addLedger(`Spawned ${n} bacteria into the dish.`, 'info');
}

function floodAntibiotic(gene) {
  state.floods.push(createFlood(gene));
  const a = ANTIBIOTICS[gene];
  addLedger(`💉 Flooded ${a.name} (targets ${a.target}). Susceptible cells dying.`, 'flood');
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
  els.ledger.innerHTML = '';
  // seed
  for (let i = 0; i < 40; i++) { const p = randomDishPoint(); state.nutrients.push(createNutrient(p.x, p.y)); }
  spawnBacteria(CONFIG.startPopulation);
  addLedger('Simulation reset. A fresh colony begins.', 'info');
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

  // buttons
  els.btnSpawn.addEventListener('click', () => spawnBacteria());
  els.btnPenicillin.addEventListener('click', () => floodAntibiotic('penicillin'));
  els.btnTetracycline.addEventListener('click', () => floodAntibiotic('tetracycline'));
  els.btnCipro.addEventListener('click', () => floodAntibiotic('cipro'));
  els.btnClearPlasmids.addEventListener('click', clearPlasmids);
  els.btnReset.addEventListener('click', resetSim);
  els.btnPause.addEventListener('click', () => {
    state.paused = !state.paused;
    els.btnPause.textContent = state.paused ? '▶ Resume' : '⏸ Pause';
  });

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
}

/* ============================================================
   10. INIT
   ============================================================ */

function init() {
  canvas = document.getElementById('dish');
  ctx = canvas.getContext('2d');
  cacheEls();
  bindUI();

  // sync slider config with default DOM values
  CONFIG.mutationRate = parseFloat(els.mutationRate.value) / 100;
  CONFIG.nutrientRate = parseFloat(els.nutrientRate.value);
  CONFIG.simSpeed = parseFloat(els.simSpeed.value);
  els.mutationRateVal.textContent = `${parseFloat(els.mutationRate.value).toFixed(1)}%`;
  els.nutrientRateVal.textContent = `${els.nutrientRate.value}/s`;
  els.simSpeedVal.textContent = `${CONFIG.simSpeed.toFixed(2)}×`;

  // seed world
  for (let i = 0; i < 40; i++) { const p = randomDishPoint(); state.nutrients.push(createNutrient(p.x, p.y)); }
  spawnBacteria(CONFIG.startPopulation);
  addLedger('Welcome to the AMR Evolution Sandbox. Selection pressure awaits.', 'info');

  lastTime = performance.now();
  requestAnimationFrame(frame);
}

document.addEventListener('DOMContentLoaded', init);
