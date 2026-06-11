# CLAUDE.md — developer context

Context for future Claude Code sessions working on the **AMR Evolution Sandbox**.

## What this is
A self-contained, browser-based AMR simulation game. Vanilla ES6+, HTML5 Canvas, CSS.
**No build step, no dependencies, no server** — it runs by opening `index.html`. The only
tooling used is `node --check app.js` for a syntax sanity pass.

## File layout
- **`index.html`** — page structure: header, a 3-column layout (left controls sidebar,
  centered `<canvas id="dish">`, right stats/ledger sidebar). Loads `app.js` with `defer`.
  IDs here are the contract `app.js` wires to (see `cacheEls()`).
- **`style.css`** — dark, responsive theme. CSS custom properties define the palette and
  the three per-drug accent colors (`--pen` blue, `--tet` amber, `--cip` magenta). CSS
  Grid layout collapses to stacked sidebars under 1100px.
- **`app.js`** — the entire simulation.

## `app.js` section map
The file is organised into 10 numbered, commented sections:
1. **Configuration** — `ANTIBIOTICS` map (keys are the gene flags), `GENES` array, `CONFIG`.
2. **State** — the `state` object (entity arrays, tick, generation, paused, accumulators).
3. **Utilities** — `rand`, `clamp`, `dist2`, `randomDishPoint`, `hasAnyResistance`, `bacteriumColor`.
4. **Entity factories** — `createBacterium`, `createNutrient`, `createPlasmid`, `createFlood`.
5. **Spatial hash** — `SpatialGrid` class; two instances `nutrientGrid`, `plasmidGrid`.
6. **Simulation step** — `update(dt)`: movement (random walk + chemotaxis toward the
   nearest sensed nutrient), eating, HGT, floods, reproduction, death.
7. **Rendering** — `render()`: dish, flood overlays, nutrients, plasmids, bacteria.
8. **Game loop** — `frame()`: fixed-step accumulator (`fixedDt = 1/60`), ~60 FPS.
9. **UI wiring** — `cacheEls`, `addLedger`, `updateStats`, action fns, `bindUI`.
10. **Init** — `init()` seeds the world, syncs CONFIG from slider DOM values, starts the loop.

## Key CONFIG tunables
- **Energy economy** (sensitive — see the comment block above the `// bacteria` group):
  `startEnergy`, `energyDecayPerSec`, `nutrientEnergy`, `nutrientRate`, `maxNutrients`,
  `eatRadius`. Carrying capacity identity:
  **`N* = (nutrientRate * nutrientEnergy) / energyDecayPerSec`**. Defaults give
  `(30*30)/4 = 225`; start population is 60, so the colony grows then self-limits.
  **Caveat: this identity assumes cells actually consume the nutrients they're fed.
  It's an upper bound — if cells can't reach the food (see Movement), realised capacity
  is far lower and the colony starves even though the global supply looks adequate.**
- **Movement / foraging** (the thing that makes feeding actually happen):
  `drag` (velocity retention per step — keep ~0.97; low values like 0.86 damp velocity to
  ~zero each tick so cells barely move and can't feed), `jitter` (random-walk acceleration),
  `maxSpeed`, `chemotaxis` (acceleration bias toward the nearest sensed nutrient), and
  `senseRadius` (how far a cell can "smell" food). Chemotaxis is what turns the random walk
  into directed foraging — without it (or with heavy drag) cells diffuse too slowly to eat,
  never divide, and the colony dies regardless of how much food is spawned.
- **Reproduction**: `divideThreshold` (energy at which a cell divides — the trigger) and
  `reproEfficiency` (fraction of energy kept across division; 1.0 = conserved). Division
  splits the parent's energy evenly between the two daughters.
- **Genetics**: `mutationRate` (fraction per gene per division; driven live by the slider).
- **HGT/plasmids**: `plasmidDropChance`, `plasmidLifespan`, `plasmidPickupRadius`.
- **Floods**: `floodDuration`, `floodSweep` (seconds for the front to cross), `floodDamage`
  (energy/s drained from susceptible cells), `effluxCost` (tax resistant cells pay).
- **Sim**: `simSpeed`, `fixedDt`, `maxPopulation`.

## Core entity shapes
- **bacterium**: `{ x, y, vx, vy, energy, age, lifespan, resistanceGenes:{penicillin,tetracycline,cipro}, plasmidSlots, efflux, dead }`
- **nutrient**: `{ x, y }` (gains a transient `eaten` flag when consumed)
- **plasmid**: `{ x, y, gene, age, life }` (gains a transient `absorbed` flag on pickup)
- **flood**: `{ gene, age, front, duration, sweep, casualties }`

## Known gotchas
- **Foraging, not supply, was the real "bacteria die off" bug.** Cells use a random walk;
  with heavy `drag` (0.86) the velocity damped to ~0 each tick, so cells sat nearly still
  (~4 px/s), ate almost nothing, never divided (`generation` stayed 0), and died at the
  starvation/lifespan mark — even though nutrients piled up to the `maxNutrients` cap
  uneaten. Fix was movement-side: `drag`→0.97, add `chemotaxis`/`senseRadius` so cells swim
  toward food, and a modest `eatRadius` bump. **If the colony is dying, check whether cells
  are moving and feeding before you touch the energy/supply numbers.** The carrying-capacity
  identity is reassuring but irrelevant if cells never reach the food.
- **The energy economy is also sensitive.** Changing any of `startEnergy`, `energyDecayPerSec`,
  `nutrientEnergy`, or `nutrientRate` shifts the carrying-capacity identity above and can
  flip the colony between "starves out" and "instantly hits `maxPopulation`". Re-derive
  `N*` before/after any change.
- **ALWAYS verify balance changes by running the sim, not by reasoning alone.** The cheap,
  reliable check is a headless harness: load `app.js` in a Node `vm` context with stubbed
  DOM globals (`document.getElementById` returning fake slider/element objects, `requestAnimationFrame`
  a no-op, a `ctx` Proxy), append `globalThis.__sim = { state, CONFIG, update, spawnBacteria, ... }`
  so you can reach the `const`-scoped internals, seed the world, then step `update(1/60)` for
  ~60 simulated seconds. **Confirm `generation` climbs above 0 within a few seconds and the
  un-flooded population sustains itself** (and that a flood collapses it to resistant-only
  survivors). `node --check app.js` only catches syntax, not extinction.
- **Floods sweep by X-POSITION, not radially.** A cell is "under" a drug once
  `b.x <= flood.front * CONFIG.size`. The leading edge moves left→right over `floodSweep`
  seconds. Both `update()` (damage) and `render()` (overlay) rely on this same rule.
- **Population is hard-capped at `maxPopulation` (800).** Reproduction checks
  `state.bacteria.length + births.length < maxPopulation`, so growth silently stops there.
- **`divideThreshold` is the reproduction trigger** (not a cost). After a split each
  daughter holds half the parent's energy and must eat back up to the threshold to divide again.
- **Spatial grids are rebuilt every step** at the top of `update()`. Anything you want
  collision-queryable must be inserted there. `queryNearby` returns the 3×3 cell block and
  uses a direct copy (no spread) because it's the per-bacterium hot path.
- **Slider defaults in `index.html` are the source of truth at startup** — `init()` reads
  `CONFIG` values from the slider DOM `value`s, so changing a default means editing the HTML
  attribute (and its label span), not just `CONFIG`.
- **Ledger is batched/capped**: mutations are summarised ~once/sec (`mutationsThisWindow`)
  and the ledger keeps at most `MAX_LEDGER` (120) entries.
