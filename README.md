# Emergence

**How does a word get invented?**

A simulation of emergent language formation. Agents wander a world, find food, and emit signals — but no signal *means* anything. Through reinforcement learning, the population converges on shared vocabulary. Nobody designs it. It just happens.

#### Video Demo: `<URL HERE>`

---

## Quick start

```bash
pip install -r requirements.txt
python app.py
```

Open `http://127.0.0.1:5000`.

## What it does

50 agents move through a 2D world. Food spawns randomly. When an agent finds food, it emits its broadcast signal. Nearby agents hear the signal, move toward it, and if they also find food, they reinforce that association: *this sound means food is nearby*.

Over time, one signal statistically dominates. The population invented a word.

### The three mutation pressures

Language doesn't converge cleanly. Three forces push back against consensus:

| Mutation | What it models | Effect |
|---|---|---|
| **Isolation drift** | Geographic divergence | Alone agents try random signals |
| **Youth rebellion** | Generational shift | Young, unsuccessful agents experiment |
| **Mishearing** | Phonetic drift | Adopted signals sometimes shift by ±1 |

### Key metrics

- **Consensus** — % of agents using the dominant signal
- **Entropy** — Shannon entropy of signal distribution (high = diverse, low = unified)
- **Find rate** — how fast agents locate food (improves as language forms)
- **Active signals** — how many distinct signals are in use

The core insight: as consensus rises, find rate rises too. The emergent language is *functional*.

## Project structure

```
emergence/
├── app.py                      # Flask app — routes + SQLite
├── requirements.txt
├── templates/
│   ├── layout.html             # Base template
│   ├── index.html              # Simulation page
│   └── experiments.html        # Saved experiments log
└── static/
    ├── css/style.css           # Styling
    └── js/simulation.js        # Simulation engine
```

## Design decisions

**Flask + client-side JS** — The simulation runs at 60fps with ~50 agents doing neighbour lookups every frame. This must be client-side. Flask handles page serving and experiment persistence via SQLite.

**SQLite** — Experiments table stores snapshots with parameters, metrics, and notes. Snapshots table stores timeline data points for each experiment. Simple relational model, fits CS50's SQL curriculum.

**10 signals** — Enough competition for convergence to be non-trivial, few enough to visualise in a bar chart and observe within minutes.

## Things to try

1. **Default settings** — let it run 2–3 min, watch one signal dominate
2. **Babel event** — scramble all vocabularies, watch reconstruction speed
3. **High isolation + small range** — set isolation drift to .05, range to 30 — regional dialects emerge
4. **Zero conformity** — language can only spread through food reinforcement, much slower
5. **Scarce food** (.02) — fewer learning events, slower convergence
6. **Max mutation** — crank all three mutation sliders, see if language can stabilise at all
