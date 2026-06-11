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

---

## AMR mechanics modelled

The sandbox is a continuous 2-D agent simulation. Each bacterium is an autonomous agent
with its own energy, age, and set of resistance genes.

- **Mutation** — when a cell divides, each antibiotic-resistance gene it lacks has a
  small chance (the **Mutation Rate** slider) of switching on in the daughter. This is
  how brand-new resistance first appears in the colony.
- **Horizontal Gene Transfer (HGT) via plasmids** — when a *resistant* cell dies it may
  leave a **plasmid** (a pulsing colored ring) at its death site, carrying one of its
  resistance genes. A living, susceptible cell that drifts into the plasmid **absorbs**
  it and instantly gains that resistance — no reproduction required. This is why
  resistance can spread explosively even through a non-dividing population.
- **Efflux pumps** — resistant cells survive an antibiotic flood by actively pumping the
  drug out. While doing so they glow with a cyan aura and pay a small extra energy cost
  (the metabolic price of resistance).
- **Three antibiotic classes**, each with its own resistance gene and flood color:

  | Antibiotic | Target | Color |
  |---|---|---|
  | Penicillin | cell wall synthesis | 🔵 blue |
  | Tetracycline | protein synthesis | 🟠 amber |
  | Ciprofloxacin | DNA gyrase | 🟣 magenta |

  A flood sweeps across the dish as a translucent colored wave. Any cell behind the front
  **without** the matching resistance gene loses energy fast and dies within a few seconds.

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

### Actions (left sidebar, buttons)
- **＋ Spawn Bacteria** — drop a fresh batch of susceptible cells into the dish.
- **💉 Flood Penicillin / Tetracycline / Ciprofloxacin** — sweep that antibiotic across
  the dish.
- **🧹 Clear Plasmids** — remove all floating plasmids (stops HGT spread in its tracks).
- **↺ Reset Sim** — wipe everything and start a fresh colony.
- **⏸ Pause / ▶ Resume** — freeze or resume the simulation.

### Stats & Ledger (right sidebar)
Live counters for **Living**, **Resistant**, **Plasmids**, and **Nutrients**, a per-drug
resistance breakdown, and an **Event Ledger** logging mutations, HGT events, floods, and
colony wipe-outs.

### Tip
**Click anywhere inside the dish** to seed a small cluster of bacteria at that spot.

---

## Colour legend

| Colour | Meaning |
|---|---|
| 🟢 Grey-green dot | Susceptible bacterium (no resistance) |
| 🔵 Blue | Penicillin-resistant |
| 🟠 Amber | Tetracycline-resistant |
| 🟣 Magenta | Ciprofloxacin-resistant |
| Blended colour | Multi-drug-resistant (carries several genes) |
| Pulsing ring | Floating plasmid (HGT payload), coloured by its gene |
| Cyan glow / bright border | Efflux pump active — surviving an antibiotic flood |
| Small green dots | Nutrients |
