# Emergence

**How does a word get invented?**

#### Video Demo: `<URL HERE>`

## The question

Nobody designed English. No committee decided that "water" means water. Every human language emerged from populations who started with no language at all. This project models one explanation: reinforcement learning across a population.

Agents wander a world, find food and make sounds. No sound means anything at first. But when an agent hears a sound, follows it, and finds food, it starts to trust that sound. Over time the whole population converges on a shared signal. A word is invented. Not by any individual, but as a property of the system.

This draws on real research in computational linguistics. Iterated learning theory (Kirby et al., 2008) shows that structured language can emerge from unstructured interaction. Signalling games (Lewis, 1969) model how arbitrary signs acquire meaning through coordination rather than design.

## How the model works

### Agents and signals

Each agent has a broadcast signal (one of 10 sounds it emits when it finds food) and a belief table (how strongly it links each sound to food). At the start, broadcasts are random and beliefs are near zero.

### Food hotspots

Food grows in clusters called hotspots. This matters because if food spawned randomly and vanished instantly, an agent following a signal would arrive and find nothing. The signal would never get reinforced. Hotspots contain multiple food items that regenerate slowly. When agent A finds food and calls out, agent B can follow the sound and still find food at the same spot. This closes the reinforcement loop.

When a hotspot runs out it vanishes and a new one appears elsewhere. This models how natural resources shift over time.

### The learning loop

1. Agent A finds food at a hotspot and emits its signal
2. Agent B hears the signal and stores the caller's location
3. Agent B walks toward the source
4. If agent B finds food there, it strengthens its belief in that signal
5. If that belief grows strong enough, agent B adopts the signal as its own

This is distributed reinforcement learning. No agent sees the full picture, but useful signals get amplified while useless ones fade.

### Conformity

Agents also copy nearby neighbours' signals through proximity alone. This models social pressure. High conformity means agents quickly mirror what they hear. Low conformity means language only spreads through the slower food reinforcement path.

### Three mutation pressures

Real languages constantly change. Three rules inject diversity.

**Isolation drift.** Agents with no neighbours sometimes switch to a random signal. This models how isolated populations develop their own vocabulary. Reducing hearing range produces visible dialect formation: different regions converge on different signals.

**Youth rebellion.** Young agents who have not found much food are more likely to experiment with adjacent signals. This models how each generation does not perfectly copy its parents' speech.

**Mishearing.** When adopting a neighbour's signal there is a small chance of copying it off by one (signal 4 becomes 3 or 5). This models phonetic drift, the gradual sound changes that turned Latin into French, Spanish and Italian. Individually tiny, but over many generations these errors can shift the dominant signal.

The balance between conformity pulling toward unity and these three forces pulling toward diversity is the emergent language.

## What the metrics mean

**Consensus** is the percentage of agents using the most popular signal. Below 15% there is no language. Above 70% the population has converged on a shared word.

**Entropy** is the Shannon entropy of the signal distribution. It captures diversity more precisely than consensus alone. Watching entropy drop while consensus rises is the mathematical signature of language forming.

**Find rate** measures how fast agents locate food. This is the functional proof. If the language works, find rate rises alongside consensus because agents following a meaningful signal find food faster than wandering randomly.

**Active signals** counts how many of the 10 signals are in real use. This starts near 10 and drops as the population converges.

## Technical implementation

The simulation runs client side in JavaScript on an HTML5 canvas. This is necessary for performance. 50 agents doing pairwise distance checks every frame at 60fps would be too slow over HTTP. Flask serves the app and provides a REST API for saving experiments to SQLite.

The database has two tables. The experiments table stores a snapshot at the moment of saving: parameters, metrics and notes. The snapshots table stores the timeline (consensus, entropy, active signals and find rate sampled every 20 ticks) so you can review how language evolved during a run.

```
emergence/
├── app.py                      # Flask routes and SQLite
├── requirements.txt
├── templates/
│   ├── layout.html             # Base template
│   ├── index.html              # Simulation page
│   └── experiments.html        # Saved experiments
└── static/
    ├── css/style.css           # Styling
    └── js/simulation.js        # Simulation engine
```

```bash
pip install -r requirements.txt
python app.py
```

The database creates itself on first run. Open http://127.0.0.1:5000.

## Real world connections

**Evolutionary linguistics.** Researchers like Christiansen and Kirby argue that language structure is an adaptation to the transmission bottleneck between generations. This simulation shows one pathway: functional pressure selects for shared signals.

**Swarm intelligence.** Ant pheromone trails, bee waggle dances and bird murmurations all follow the same principle: no individual has a global plan, but local interactions produce global order. This simulation applies that principle to symbolic communication.

**Game theory.** Lewis's signalling games formalised how arbitrary conventions become stable through mutual benefit. This simulation reaches that equilibrium through reinforcement rather than rational calculation.

The core finding: language does not require a designer or particularly intelligent agents. It requires a feedback loop between action, signal and outcome, and enough population pressure to amplify useful conventions over noise.
