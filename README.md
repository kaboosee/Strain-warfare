# 🧫 AMR Evolution Sandbox

A browser-based simulation game about **antimicrobial resistance (AMR)**. Bacteria
crawl around a Petri dish, eat nutrients, divide with occasional mutations, evolve
resistance to antibiotics, and swap resistance genes with each other. You apply
selection pressure by flooding the dish with antibiotics and watch evolution play out
in real time — the susceptible majority dies, the resistant few inherit the dish, and
their genes spread.

Built with **vanilla JavaScript (ES6+), HTML5 Canvas, and CSS** — no frameworks, no
build step, no dependencies.

---

## How to run

Just open **`index.html`** in any modern browser (double-click it, or drag it into a
browser tab). There is nothing to install and no server to start.

## Tests

The simulation has a headless, dependency-free test + benchmark suite (Node builtins only):

```
node test.mjs
```

It loads `app.js` in a sandbox with a seeded RNG (so runs are deterministic) and checks the
invariants (no NaN, capped collections), the locked-in biology (selective sweeps, resistant
survival, no-drug ratchet, gradient behaviour), the robustness fixes, and per-step throughput.
Exits non-zero on any failure.

---

## AMR mechanics modelled

The sandbox is a continuous 2-D agent simulation. Each bacterium is an autonomous agent
with its own energy, age, and a graded **MIC (minimum inhibitory concentration) level per
drug** — `0` = fully susceptible, higher = more resistant, on a band scale of `1× → 10× →
100× → 1000×` (levels 1–4, matching the MEGA-plate bands).

- **Graded resistance (MIC)** — a cell survives a drug only when its MIC for that drug is
  **≥ the local dose**. Just below the dose it takes *reduced* (not full) damage, scaling
  smoothly with the gap — no hard cliff. The brighter and more saturated a cell's colour,
  the higher its MIC.
- **Mutation** — when a cell divides, each drug's MIC can step **up or down by one band**
  (the **Mutation Rate** slider), biased upward when the cell is currently under that drug.
  This is how resistance climbs under pressure — and decays once the drug is gone.
- **Horizontal Gene Transfer (HGT) via plasmids** — when a *resistant* cell dies it may
  leave a **plasmid** (a pulsing colored ring) carrying its **MIC level** for one drug. A
  living cell that drifts into it **raises its own MIC to match** — no reproduction
  required. This is why resistance can spread explosively even through a non-dividing
  population.
- **Efflux pumps** — resistant cells survive a dose by actively pumping the drug out. They
  glow with a cyan aura (brighter the more strongly they resist) and pay an energy cost in
  proportion to their MIC.
- **Three antibiotic classes**, each with its own MIC axis and flood color:

  | Antibiotic | Target | Color |
  |---|---|---|
  | Penicillin | cell wall synthesis | 🔵 blue |
  | Tetracycline | protein synthesis | 🟠 amber |
  | Ciprofloxacin | DNA gyrase | 🟣 magenta |

  A flood sweeps across the dish as a translucent colored wave. Any cell behind the front
  whose MIC for that drug is below the flood dose loses energy fast and dies within seconds.
- **MEGA-plate gradient** (the Kishony 2016 experiment) — instead of a transient flood, lay
  down a **standing antibiotic gradient**: the dish splits left→right into a drug-free
  **refuge** and bands of rising concentration (1× → 10× → 100× → 1000× MIC). Susceptible
  cells survive only in the refuge; a resistant lineage that arises there can march
  band-by-band into ever-higher doses, recreating the famous evolving-front image. (With
  aggressive dosing the colony sometimes goes extinct before resistance evolves — exactly
  why monotherapy is risky.)

### The energy economy

Cells spend energy every second (metabolism) and gain it by eating nutrients. Division
simply splits a cell's energy between the two daughters — **food is the only real source
of energy**, so the colony's size is ultimately limited by the food supply. With the
default settings an un-flooded colony grows from 60 cells and stabilises around its
carrying capacity; antibiotics are the dominant cause of death.

---

## UI guide

### Parameters (left sidebar, sliders)
- **Mutation Rate** — chance per gene, per division, that a new resistance arises.
- **Nutrient Spawn Rate** — how fast food enters the dish; this sets the colony's
  carrying capacity. Lower it to starve the colony, raise it to let it boom.
- **Sim Speed** — scales how fast simulated time runs (0× pauses growth, 4× fast-forwards).

### Scenario Presets (left sidebar, top)
Pick a scenario and hit **▶ Load** to reset the dish into a tailored setup:
- **🧪 Baseline Colony** — a healthy colony, no drugs.
- **🧬 MEGA-plate (Kishony)** — a standing ciprofloxacin gradient; resistance must evolve to cross the bands.
- **☠ Superbug Outbreak** — a few multi-drug-resistant founders seeded among susceptibles; watch MDR spread.
- **🍽 Famine** — scarce food, fierce competition and boom/bust (but the colony hangs on).

### Actions (left sidebar, buttons)
- **＋ Spawn Bacteria** — drop a fresh batch of susceptible cells into the dish.
- **💉 Flood Penicillin / Tetracycline / Ciprofloxacin** — sweep that antibiotic across
  the dish.
- **🧬 MEGA-plate gradient** — pick a drug and toggle a standing concentration gradient
  (see above). Toggle again to clear it.
- **🧹 Clear Plasmids** — remove all floating plasmids (stops HGT spread in its tracks).
- **↺ Reset Sim** — wipe everything and start a fresh colony.
- **⏸ Pause / ▶ Resume** — freeze or resume the simulation.

### Stats & Ledger (right sidebar)
Live counters for **Living**, **Resistant**, **Plasmids**, and **Nutrients**, a per-drug
resistance breakdown, a **live history chart** (population in white vs. the three
resistance percentages over the last few minutes), and an **Event Ledger** logging
mutations, HGT events, floods, and colony wipe-outs.

### Tips
- **Click anywhere inside the dish** to seed a small cluster of bacteria at that spot.
- **Hover any cell** to inspect it — a tooltip shows its resistance genes, energy,
  age, efflux state, remaining plasmid slots, and a plain-language note on what it is.
- **Hover any item in the on-dish key** for a one-line explanation, and open the
  **📖 Glossary** panel (left sidebar) for definitions of every biological term
  (AMR, MDR, efflux pump, plasmid/HGT, fitness cost, MIC, …).

---

## Colour legend

Cell colour encodes resistance: hue = which drug(s), **brightness/saturation = MIC level**
(dim = low, vivid = high).

| Colour | Meaning |
|---|---|
| 🟢 Grey-green dot | Susceptible bacterium (MIC 0) |
| 🔵 Blue (brighter = higher MIC) | Penicillin resistance |
| 🟠 Amber (brighter = higher MIC) | Tetracycline resistance |
| 🟣 Magenta (brighter = higher MIC) | Ciprofloxacin resistance |
| Blended colour | Multi-drug-resistant (elevated MIC to several drugs) |
| Pulsing ring | Floating plasmid (HGT payload carrying an MIC level), coloured by its drug |
| Cyan glow / bright border | Efflux pump active — surviving a dose (glow scales with MIC) |
| Small green dots | Nutrients |
