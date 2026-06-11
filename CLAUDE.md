# CLAUDE.md — developer context

Context for future Claude Code sessions working on the **AMR Evolution Sandbox**.

## What this is
A self-contained, browser-based AMR simulation game. Vanilla ES6+, HTML5 Canvas, CSS.
**No build step, no dependencies, no server** — it runs by opening `index.html`. Tooling is
`node --check app.js` (syntax) and **`node test.mjs`** (a dependency-free headless test +
benchmark suite — seeded RNG so it's deterministic; asserts invariants, biology, the
robustness fixes, and per-step throughput). Run `node test.mjs` after any change to `app.js`.

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
   nearest sensed nutrient), eating, HGT, floods, treatment-course dosing (`advanceCourse()`),
   reproduction, death.
7. **Rendering** — `render()`: dish, flood overlays, nutrients, plasmids, bacteria.
8. **Game loop** — `frame()`: fixed-step accumulator (`fixedDt = 1/60`), ~60 FPS.
9. **UI wiring** — `cacheEls`, `addLedger`, `updateStats`, action fns, `bindUI`, plus the
   treatment-course fns (`startCourse`/`advanceCourse`/`endCourse`/`toggleCourse`/`syncCourseUI`).
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
- **Graded resistance (MIC model)**: each cell carries `mic:{penicillin,tetracycline,cipro}`,
  numeric levels `0..micMax` on the `doseResponse` scale (0 = susceptible, 1=1× band, 2=10×,
  3=100×, 4=1000×). A cell survives a local dose `d` for a drug when its `mic >= d`; below that
  it takes damage scaled by `(1 - mic/d)` (smooth, no cliff). All drug exposure (floods AND the
  gradient) goes through `exposeToDrug(b, gene, dose, killPerSec, effluxScale, dt)`. Tunables:
  `micMax` (4), `micStep` (1 band per mutation), `floodDose` (the dose a flood applies, 1),
  `mutationUpBias` (0.85 = P(MIC steps up) when under that drug, else 0.5).
- **Genetics**: `mutationRate` (chance per drug per division that MIC mutates ±1 band; biased
  up under drug pressure, driven live by the slider, max 3%), `backMutationRate` (per drug per
  division, MIC drifts DOWN one band when no drug present — lets resistance decay).
- **Resistance ecology**: `resistanceCost` (extra metabolism per UNIT of TOTAL MIC EVERY
  second, drug or not — so high-MIC cells pay more). Standing fitness cost that keeps MIC low
  absent selection; distinct from `effluxCost`, paid only while actually under a drug.
- **HGT/plasmids**: `plasmidDropChance`, `plasmidLifespan`, `plasmidPickupRadius`.
- **Floods**: `floodDuration` (drain WINDOW, not just flavor — see gotcha), `floodSweep`
  (seconds for the front to cross), `floodDamage` (energy/s drained from susceptible cells),
  `effluxCost` (tax resistant cells pay — a MODEST 2/s; resistance must be survivable).
- **Treatment Course** (scheduled regimen, NOT CONFIG-driven): lives on `state.course` =
  `{drug, dose, intervalTicks, dosesRemaining, nextDoseTick, adherence, total, taken, missed,
  resistantAtStart}` or `null`. Armed from the "Treatment Course" panel sliders by `startCourse()`;
  `advanceCourse()` (per-tick in `update()`) delivers a due dose by calling `floodAntibiotic(drug,
  dose, /*log*/false)` if an adherence roll passes, else logs a missed dose; `endCourse()` logs a
  summary comparing `resistantAtStart` vs now. Doses are scaled by the dose-strength slider (1–4 =
  1×/10×/100×/1000× MIC), so a strong course can overwhelm low-MIC cells.
- **MEGA-plate gradient** (Kishony): `gradientBands` (relative-MIC per band, left→right),
  `gradientRefugeFrac` (share of dish width given to the drug-free band 0), `gradientKill`
  (susceptible energy/s drain, scaled by `doseResponse` = log10(conc)+1), `gradientEffluxScale`
  (resistant efflux tax, same dose scaling). `state.gradient` is `{gene}` or `null`; band
  geometry lives in `bandBounds()`/`bandIndex()` (used by BOTH `update()` and `render()` so
  they agree). See gotcha below.
- **Sim**: `simSpeed`, `fixedDt`, `maxPopulation`.

## Core entity shapes
- **bacterium**: `{ x, y, vx, vy, energy, age, lifespan, mic:{penicillin,tetracycline,cipro} (numeric MIC levels), plasmidSlots, efflux, dead, cr/cg/cb (cached colour) }`.
  Colour is cached by `setColor(b)` (hue = drug colours weighted by MIC; brightness scales with
  `peakMic`). Helpers: `totalMic(b)`, `peakMic(b)`, `drugsResisted(b)`, `hasAnyResistance(b)`.
- **nutrient**: `{ x, y }` (gains a transient `eaten` flag when consumed)
- **plasmid**: `{ x, y, gene, mic, age, life }` — carries an MIC LEVEL; on pickup a cell raises
  its own `mic[gene]` to match (gains a transient `absorbed` flag).
- **flood**: `{ gene, age, front, duration, sweep, dose, casualties }` — `dose` is the MIC-band
  level this flood applies (default `CONFIG.floodDose`; a treatment course passes its own). BOTH
  `exposeToDrug` (in `update()`) and `localDose()` read `f.dose`, never `CONFIG.floodDose` directly.

## Known gotchas
- **Resistance must be COSTLY or MIC ratchets to the max for free.** With no standing cost,
  high MIC is free when no drug is present, so it only ever climbs and fixes at `micMax`. The
  fix is BOTH `resistanceCost` scaled by TOTAL MIC paid every second (selection against high
  MIC without drugs) AND a sane mutation rate (slider capped at 3%); `backMutationRate` drifts
  MIC down absent a drug. **If late-game floods stop mattering, check `resistanceCost` first.**
  Verified headless: no-drug mean MIC stays ~0.05 even at 3% mutation.
  Verified headless: no-flood @1% mutation keeps each gene <15% over 1000+ gens, a penicillin
  flood leaves pen-resistant survivors that recover toward ~100% pen-R while others stay low,
  and max mutation does not pan-fix all three.
- **Foraging, not supply, was the real "bacteria die off" bug.** Cells use a random walk;
  with heavy `drag` (0.86) the velocity damped to ~0 each tick, so cells sat nearly still
  (~4 px/s), ate almost nothing, never divided (`generation` stayed 0), and died at the
  starvation/lifespan mark — even though nutrients piled up to the `maxNutrients` cap
  uneaten. Fix was movement-side: `drag`→0.97, add `chemotaxis`/`senseRadius` so cells swim
  toward food, and a modest `eatRadius` bump. **If the colony is dying, check whether cells
  are moving and feeding before you touch the energy/supply numbers.** The carrying-capacity
  identity is reassuring but irrelevant if cells never reach the food.
- **`senseRadius` must be ≥ the `nutrientGrid` cell size, or the colony dies amid surplus
  food.** A second die-off bug: with `senseRadius` 26 but the nutrient grid cell only 20, the
  3×3 `queryNearby` clipped sensing to ~20px. Once a cell ate its local patch it couldn't
  detect the food piled up elsewhere (very visible under a gradient, which strands ~half the
  uniformly-spawned food in the lethal zone, or at low `nutrientRate`) and starved locally —
  the colony could go fully EXTINCT while global nutrients were in surplus. Verified headless:
  `nutrientRate=8` went to 0 at sense 26 but survived at 44; default carrying capacity is
  unchanged (~150) but the boom/bust swings tighten. Now `senseRadius=44` with the
  `nutrientGrid` cell also at 44. **If cells starve while nutrients look plentiful, check
  foraging reach before supply.**
- **Scenario presets live in the `PRESETS` map (§1) and `applyPreset()` (§9).** Each entry
  sets the three sliders (DOM value + CONFIG + label, like `init`), wipes the world, seeds a
  tailored colony (optionally pre-resistant founders via `seed.resistantFrac`/`genesPerResistant`),
  and may switch on a gradient. Add a scenario by adding to `PRESETS` and an `<option>` to
  `#presetSelect`. The legend is now a `pointer-events:none` overlay in the dish's bottom-left
  corner (`.legend-overlay`), not a sidebar panel.
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
- **MEGA-plate gradient has two opposing failure modes — verified headless.** (1) If
  `gradientKill` is too low, well-fed susceptibles SURVIVE bands above their MIC (wrong —
  MIC means inhibitory). It must be net-lethal even at the 1× band despite the cell eating,
  so it's anchored at `floodDamage` (70). (2) If the drug-free refuge is too NARROW, the
  established colony bleeds across the absorbing band-1 boundary and goes fully extinct
  before any resistant mutant arises — so `gradientRefugeFrac` is a generous 0.5. Tuned
  outcome (gradient applied at steady state): treated bands have NO fully-susceptible (MIC 0)
  cells, the refuge stays low-MIC, and MIC forms a spatial CLINE — mean MIC rises band-by-band
  toward the deep bands (verified: refuge ~0.4 vs treated ~2). With the graded MIC model this is
  now a true per-band stepwise climb: a cell needs `mic >= band dose` to survive each band, so
  the front advances only as MIC mutates upward. `update()` damage and `render()` overlay both
  use `bandBounds()`.
- **Resistant cells must SURVIVE the drug they resist — `floodDuration` is the lever, not
  `effluxCost`.** Original 7s flood + 9/s efflux tax drained resistant cells (on top of base
  metabolism + the always-on `resistanceCost`) faster than they could eat over the window, so
  ~80% of RESISTANT cells starved during a flood — resistance looked broken. Lowering only
  `effluxCost` barely helped (base metabolism over a long window kills the low-energy tail —
  cells idle near `divideThreshold/2` ≈ 50 energy). The real fix was a SHORT sharp pulse:
  `floodDuration` 7→4 plus `effluxCost` 9→2. Verified headless: resistant survival ~17% → ~75%,
  susceptibles still wiped (they die in <1s at `floodDamage` 70/s). The gradient's per-dose tax
  was decoupled (`gradientEffluxScale` 0.6→2.7) so the MEGA-plate keeps its graded advance even
  though the flood efflux cost dropped. **If resistant cells die under their own drug, shorten
  the flood window before touching efflux.**
- **Floods sweep by X-POSITION, not radially.** A cell is "under" a drug once
  `b.x <= flood.front * CONFIG.size`. The leading edge moves left→right over `floodSweep`
  seconds. Both `update()` (damage) and `render()` (overlay) rely on this same rule.
- **Population is hard-capped at `maxPopulation` (800).** Reproduction checks
  `state.bacteria.length + births.length < maxPopulation`, so growth silently stops there.
- **`divideThreshold` is the reproduction trigger** (not a cost). After a split each
  daughter holds half the parent's energy and must eat back up to the threshold to divide again.
- **Spatial grids are rebuilt every step** at the top of `update()`. Anything you want
  collision-queryable must be inserted there. The per-bacterium query is `grid.queryInto(x, y,
  scratch)` — it fills a caller-owned reusable array (`_nutScratch` / `_plasScratch`) so the
  hot path allocates NOTHING. Don't switch it back to a fresh-array-returning query.
- **Hot-path allocations were deliberately removed — don't reintroduce them.** Per cell per
  step the sim does ONE nutrient query (shared by chemotaxis + eating; nutrients are static and
  the cell moves <1px), reuses scratch arrays, and reads a CACHED render colour (`b.cr/cg/cb`,
  set by `setColor()` at birth and on HGT — `render()` must never recompute colour or call a
  `GENES.filter`). Dead bacteria / eaten nutrients are compacted IN PLACE (no per-step `filter`
  allocation). Nutrients render in one batched path. `node test.mjs` prints a per-step benchmark.
- **History sampling lives in `update()` (per-tick `tick % 60 === 0`), NOT in `frame()`.** It
  used to ride `updateStats()` which `frame()` calls on a tick modulo — at high `simSpeed`
  several ticks run per frame and the exact multiples were skipped, dropping ~40% of chart
  samples at 4×. Keep sampling in `update()` (runs every tick); DOM stats refresh on a FRAME
  cadence (`frameCount`). The mutation/HGT ledger flushes live in the same per-tick block.
- **Floods of the same drug REFRESH, they don't stack** (`floodAntibiotic()` re-arms an
  existing same-gene flood). Stacking multiplied the efflux tax and wrongly starved resistant
  cells when the button was mashed. Different drugs still combine. NOTE: a re-arm also adopts the
  new `dose`, so a treatment-course dose re-arming an existing same-drug flood updates its strength.
- **Treatment-course dosing is per-tick in `update()` (`advanceCourse()`), NOT in `frame()`** —
  same reasoning as history sampling: keying doses to `state.tick` makes them honour BOTH pause
  (update() is gated on `state.paused`) and `CONFIG.simSpeed` (more ticks/sec = doses arrive sooner
  in real time but on schedule in sim time), and never skips a dose at high sim speed. The course's
  "seconds between doses" and countdown are SIMULATED seconds (`intervalTicks = round(sec*60)`).
- **Slider defaults in `index.html` are the source of truth at startup** — `init()` reads
  `CONFIG` values from the slider DOM `value`s, so changing a default means editing the HTML
  attribute (and its label span), not just `CONFIG`.
- **Ledger is batched/capped**: mutations AND HGT events are summarised ~once/sec
  (`mutationsThisWindow` / `hgtThisWindow`) and the ledger keeps at most `MAX_LEDGER` (120)
  entries. Don't `addLedger` per-event inside the per-bacterium loop — it does DOM work.
