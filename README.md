# Emergence

**How does a word get invented?**

#### Video Demo: `<URL HERE>`

## The question

Nobody designed English. Every human language emerged from populations who started with no language at all. This project models one explanation: a group of agents who can make sounds but have no shared meaning gradually develop a common vocabulary through trial and error.

The idea comes from a field called evolutionary linguistics, which studies how language structure can emerge without anyone designing it. The core claim is simple: if a sound leads to a useful outcome, it gets repeated. If enough individuals reinforce the same sound, it becomes a word.

## How the model works

### Agents and signals

Each agent carries a broadcast signal (one of 10 sounds it makes when it finds food) and a belief table tracking how much it trusts each of the 10 sounds. At the start, everything is random.

### Food hotspots

Food grows in persistent clusters called hotspots. This is important because if food appeared randomly and vanished immediately, an agent following a signal would arrive and find nothing. The signal would never get reinforced. Hotspots contain multiple food items that regenerate slowly. When one agent finds food and calls out, others can follow the sound and still find food at the same location. This closes the learning loop.

When a hotspot is fully depleted it vanishes and a new one appears elsewhere.

### The learning loop

1. Agent A finds food at a hotspot and emits its signal
2. Agent B hears the signal and walks toward the source
3. Agent B finds food there too
4. Agent B strengthens its belief in that signal
5. Over time, agent B may adopt that signal as its own

No agent sees the full picture. Useful signals spread because they lead to food. Useless ones fade through memory decay.

### Three mutation pressures

**Isolation drift.** Agents with no neighbours try random new signals. Models how separated groups develop different words for the same thing.

**Youth rebellion.** Young agents who have not found much food experiment with nearby signals. Models how each generation changes the language slightly.

**Mishearing.** When copying a neighbour's signal there is a small chance of getting it slightly wrong. Models the gradual sound changes that turn one language into several over time.

## What the metrics show

**Consensus** is the percentage of agents using the most popular signal. Above 70% means the population has effectively agreed on a word.

**Entropy** measures diversity in the signal distribution. It drops as the population converges.

**Find rate** tracks how fast agents locate food. This rises alongside consensus, showing the language is not just shared but functional.

**Active signals** counts how many of the 10 sounds are in real use. Starts near 10 and drops as one signal wins.

## Technical implementation

### Architecture

Flask serves the application and handles experiment persistence. The simulation runs in the browser using JavaScript and the HTML5 canvas API. This split is necessary because 50 agents doing pairwise distance checks at 60fps needs to happen client side.

### Database

SQLite with two tables. The experiments table stores parameters, final metrics, and user notes. The snapshots table stores timeline data (consensus, entropy, find rate sampled every 20 ticks) linked by foreign key. The backend uses JOINs and GROUP BY to compute aggregate statistics across experiments and compare runs.

### Backend analysis

The Python backend computes three metrics from saved timeline data:
- **Convergence tick**: the first moment consensus held above 60% for five consecutive readings
- **Stability**: standard deviation of consensus in the second half of the run
- **Efficiency gain**: percentage change in find rate from the first quarter to the last quarter

These let you compare experiments quantitatively, not just visually.

### Validation

All API inputs are validated server side: name length, numeric ranges, timeline structure. The frontend also validates before sending. Error responses include specific messages.

### Tests

19 pytest tests cover route responses, save/delete operations, input validation edge cases, parameter retrieval, experiment comparison, and all three analysis functions.

```bash
pytest tests/test_app.py -v
```

### Project structure

```
emergence/
├── app.py                      # Flask routes, validation, analysis, SQLite
├── requirements.txt
├── tests/
│   └── test_app.py             # 19 pytest tests
├── templates/
│   ├── layout.html             # Base template
│   ├── index.html              # Simulation page
│   ├── experiments.html        # Experiment log with summary stats
│   ├── detail.html             # Single experiment analysis
│   └── 404.html                # Error page
└── static/
    ├── css/style.css           # Responsive styling
    └── js/simulation.js        # Simulation engine
```

### Running

```bash
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5000. The database creates itself on first run.
