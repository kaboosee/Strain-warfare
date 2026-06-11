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
6. **Simulation step** — `update(dt)`: movement, eating, HGT, floods, reproduction, death.
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
- **The energy economy is sensitive.** Changing any of `startEnergy`, `energyDecayPerSec`,
  `nutrientEnergy`, or `nutrientRate` shifts the carrying-capacity identity above and can
  flip the colony between "starves out" and "instantly hits `maxPopulation`". Re-derive
  `N*` before/after any change. (This file's earlier bug was exactly this: supply < demand.)
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
