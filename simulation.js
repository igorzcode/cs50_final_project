/**
 * Emergence: emergent language simulation engine.
 *
 * Agents wander a 2D world, find food at hotspots, and emit signals.
 * Through reinforcement learning they converge on shared vocabulary.
 * No agent knows it is building a language. Meaning emerges from feedback.
 */

// ── Canvas and constants ───────────────────────────────────────

const canvas = document.getElementById("world");
const context = canvas.getContext("2d");
const WORLD_WIDTH = 500;
const WORLD_HEIGHT = 500;
const NUM_SIGNALS = 10;
const HOTSPOT_RADIUS = 40;
const HOTSPOT_MAX_FOOD = 8;
const HOTSPOT_REGROW_CHANCE = 0.012;
const SIGHT_RANGE = 55;
const MAX_SPEED = 1.4;
const MAX_HISTORY = 250;

const SIGNAL_COLORS = [
    "#e05555", "#e08830", "#d4af37", "#6aad40", "#2e9e5e",
    "#2e9e9e", "#3070c0", "#5e4eb8", "#9040b0", "#c04890"
];

// ── Simulation parameters (bound to sliders) ───────────────────

let params = {
    learnRate: 0.18,
    memoryDecay: 0.002,
    conformity: 0.35,
    hearingRange: 75,
    isolationDrift: 0.012,
    youthRebellion: 0.02,
    mishearing: 0.008,
    population: 50,
    hotspotCount: 4,
    simSpeed: 5
};

// ── Simulation state ───────────────────────────────────────────

let agents = [];
let foods = [];
let hotspots = [];
let tickCount = 0;
let generation = 0;
let paused = false;
let totalFoodFound = 0;
let recentFinds = 0;
let recentTicks = 0;

// History arrays for the live graphs
let history = {
    consensus: [],
    efficiency: [],
    entropy: [],
    vocabulary: []
};

// Timeline data sent to Flask when saving an experiment
let timeline = [];

// ── Utility ────────────────────────────────────────────────────

function randomBetween(min, max) {
    return min + Math.random() * (max - min);
}

function wrapSignal(value) {
    return ((value % NUM_SIGNALS) + NUM_SIGNALS) % NUM_SIGNALS;
}

// ── Agent class ────────────────────────────────────────────────

class Agent {
    constructor() {
        // Position and velocity
        this.x = randomBetween(15, WORLD_WIDTH - 15);
        this.y = randomBetween(15, WORLD_HEIGHT - 15);
        this.velocityX = randomBetween(-0.8, 0.8);
        this.velocityY = randomBetween(-0.8, 0.8);

        // Language: which signal this agent broadcasts when it finds food
        this.broadcastSignal = Math.floor(Math.random() * NUM_SIGNALS);

        // Beliefs: how much this agent trusts each signal to indicate food
        // Index is signal number, value is trust level from 0 to 1
        this.beliefs = new Float32Array(NUM_SIGNALS);

        // Lifecycle
        this.age = 0;
        this.foodsFound = 0;
        this.neighbourCount = 0;
        this.energy = 70 + randomBetween(0, 30);

        // Behaviour state
        this.state = "wander";
        this.targetFood = null;
        this.signalSource = null;

        // Animation timers
        this.emitTimer = 0;
        this.eatFlash = 0;

        // Smooth random walk
        this.wanderAngle = Math.random() * Math.PI * 2;
        this.wanderTimer = 0;
    }

    /**
     * Apply mutation rules that inject linguistic diversity.
     * Each rule models a real process in language change.
     */
    mutate() {
        // Isolation drift: agents alone try random new signals.
        // Models how geographically isolated groups develop new words.
        if (this.neighbourCount === 0 && Math.random() < params.isolationDrift) {
            this.broadcastSignal = Math.floor(Math.random() * NUM_SIGNALS);
        }

        // Youth rebellion: young, unsuccessful agents experiment.
        // Models generational language shift.
        if (this.age < 400 && this.foodsFound < 3 && Math.random() < params.youthRebellion) {
            let direction = Math.random() < 0.5 ? 1 : -1;
            this.broadcastSignal = wrapSignal(this.broadcastSignal + direction);
        }
    }

    /**
     * Decide what to do this tick: chase visible food,
     * follow a trusted signal, or wander randomly.
     */
    decide() {
        // Check if any food is visible within sight range
        let closestFood = null;
        let closestDistance = SIGHT_RANGE * SIGHT_RANGE;

        for (let food of foods) {
            let dx = food.x - this.x;
            let dy = food.y - this.y;
            let distanceSquared = dx * dx + dy * dy;

            if (distanceSquared < closestDistance) {
                closestDistance = distanceSquared;
                closestFood = food;
            }
        }

        if (closestFood) {
            this.targetFood = closestFood;
            this.state = "seek_food";
            this.signalSource = null;
            return;
        }

        // Check if we heard a signal we trust
        if (this.signalSource && this.beliefs[this.signalSource.signal] > 0.2) {
            this.state = "seek_signal";
            this.targetFood = null;
            return;
        }

        // Default: wander
        this.state = "wander";
        this.targetFood = null;
        this.signalSource = null;
    }

    /**
     * Move the agent based on its current state and apply physics.
     * Check for food pickup and handle learning.
     */
    update() {
        this.age++;
        this.energy -= 0.02;
        if (this.emitTimer > 0) this.emitTimer--;
        if (this.eatFlash > 0) this.eatFlash--;

        // Memory decay: beliefs weaken over time
        for (let i = 0; i < NUM_SIGNALS; i++) {
            this.beliefs[i] = Math.max(0, this.beliefs[i] - params.memoryDecay);
        }

        this.mutate();
        this.decide();

        // Calculate steering force based on state
        let forceX = 0;
        let forceY = 0;

        if (this.state === "seek_food" && this.targetFood) {
            if (!this.targetFood._alive) {
                this.state = "wander";
                this.targetFood = null;
            } else {
                let dx = this.targetFood.x - this.x;
                let dy = this.targetFood.y - this.y;
                let distance = Math.hypot(dx, dy);
                if (distance > 1) {
                    forceX += (dx / distance) * 2.5;
                    forceY += (dy / distance) * 2.5;
                }
            }
        } else if (this.state === "seek_signal" && this.signalSource) {
            let dx = this.signalSource.x - this.x;
            let dy = this.signalSource.y - this.y;
            let distance = Math.hypot(dx, dy);
            let pullStrength = this.beliefs[this.signalSource.signal] * 2;
            if (distance > 1) {
                forceX += (dx / distance) * pullStrength;
                forceY += (dy / distance) * pullStrength;
            }
        } else {
            // Smooth random walk
            this.wanderTimer--;
            if (this.wanderTimer <= 0) {
                this.wanderAngle += randomBetween(-0.8, 0.8);
                this.wanderTimer = Math.floor(randomBetween(30, 90));
            }
            forceX += Math.cos(this.wanderAngle) * 0.6;
            forceY += Math.sin(this.wanderAngle) * 0.6;
        }

        // Apply forces with damping
        this.velocityX = this.velocityX * 0.82 + forceX * 0.18;
        this.velocityY = this.velocityY * 0.82 + forceY * 0.18;

        // Clamp speed
        let speed = Math.hypot(this.velocityX, this.velocityY);
        if (speed > MAX_SPEED) {
            this.velocityX = (this.velocityX / speed) * MAX_SPEED;
            this.velocityY = (this.velocityY / speed) * MAX_SPEED;
        }

        // Move
        this.x += this.velocityX;
        this.y += this.velocityY;

        // Soft boundary: push away from edges
        let margin = 10;
        if (this.x < margin) this.velocityX += 0.4;
        if (this.x > WORLD_WIDTH - margin) this.velocityX -= 0.4;
        if (this.y < margin) this.velocityY += 0.4;
        if (this.y > WORLD_HEIGHT - margin) this.velocityY -= 0.4;
        this.x = Math.max(2, Math.min(WORLD_WIDTH - 2, this.x));
        this.y = Math.max(2, Math.min(WORLD_HEIGHT - 2, this.y));

        // Check for food pickup
        for (let food of foods) {
            if (!food._alive) continue;
            let dx = food.x - this.x;
            let dy = food.y - this.y;
            if (dx * dx + dy * dy < 144) {
                food._alive = false;
                this.energy = Math.min(100, this.energy + 25);
                this.foodsFound++;
                this.eatFlash = 20;
                this.emitTimer = 60;
                totalFoodFound++;
                recentFinds++;

                // LEARNING: reinforce the signal that led me here
                if (this.signalSource) {
                    let signal = this.signalSource.signal;
                    this.beliefs[signal] = Math.min(1, this.beliefs[signal] + params.learnRate * 1.5);
                }

                // Also reinforce own broadcast signal
                this.beliefs[this.broadcastSignal] = Math.min(
                    1, this.beliefs[this.broadcastSignal] + params.learnRate * 0.6
                );

                this.targetFood = null;
                this.signalSource = null;
                this.state = "wander";
                break;
            }
        }
    }

    /**
     * Process a signal heard from another agent.
     * May update this agent's signal source for navigation
     * and may trigger conformity-based signal adoption.
     */
    hearSignal(signal, sourceX, sourceY, distance) {
        if (distance > params.hearingRange || distance < 1) return;

        let strength = 1 - distance / params.hearingRange;

        // Remember the strongest signal source for navigation
        if (!this.signalSource || strength > 0.5) {
            this.signalSource = { x: sourceX, y: sourceY, signal: signal };
        }

        // Conformity: chance of adopting this neighbour's signal
        if (Math.random() < params.conformity * strength * 0.03) {
            // Mishearing: small chance of off-by-one copy error
            if (Math.random() < params.mishearing) {
                let direction = Math.random() < 0.5 ? 1 : -1;
                this.broadcastSignal = wrapSignal(signal + direction);
            } else {
                this.broadcastSignal = signal;
            }
        }
    }

    /** Draw the agent on the canvas. */
    draw() {
        let color = SIGNAL_COLORS[this.broadcastSignal];

        // Emission wave ripple
        if (this.emitTimer > 0) {
            let progress = 1 - this.emitTimer / 60;
            let radius = params.hearingRange * progress;
            context.beginPath();
            context.arc(this.x, this.y, radius, 0, Math.PI * 2);
            context.strokeStyle = color;
            context.globalAlpha = 0.1 * (1 - progress);
            context.lineWidth = 1.5;
            context.stroke();
            context.globalAlpha = 1;
        }

        // Direction indicator
        let speed = Math.hypot(this.velocityX, this.velocityY);
        if (speed > 0.3) {
            context.beginPath();
            context.moveTo(this.x, this.y);
            context.lineTo(
                this.x + (this.velocityX / speed) * 7,
                this.y + (this.velocityY / speed) * 7
            );
            context.strokeStyle = color;
            context.globalAlpha = 0.25;
            context.lineWidth = 1;
            context.stroke();
            context.globalAlpha = 1;
        }

        // Agent body (opacity reflects belief strength)
        let size = this.eatFlash > 0 ? 5.5 : 3.2;
        let maxBelief = Math.max(0.01, ...this.beliefs);
        let opacity = 0.5 + maxBelief * 0.5;

        context.beginPath();
        context.arc(this.x, this.y, size, 0, Math.PI * 2);
        context.globalAlpha = opacity;
        context.fillStyle = color;
        context.fill();
        context.globalAlpha = 1;

        // Eat flash ring
        if (this.eatFlash > 0) {
            context.beginPath();
            context.arc(this.x, this.y, size + 3, 0, Math.PI * 2);
            context.strokeStyle = "#ffffff";
            context.globalAlpha = (this.eatFlash / 20) * 0.6;
            context.lineWidth = 1.5;
            context.stroke();
            context.globalAlpha = 1;
        }

        // State indicator pip above agent
        if (this.state === "seek_food") {
            context.fillStyle = "#00b894";
            context.fillRect(this.x - 1.5, this.y - 8, 3, 3);
        } else if (this.state === "seek_signal") {
            context.fillStyle = color;
            context.globalAlpha = 0.5;
            context.fillRect(this.x - 1, this.y - 7, 2, 2);
            context.globalAlpha = 1;
        }

        // Low energy warning ring
        if (this.energy < 25) {
            context.beginPath();
            context.arc(this.x, this.y, size + 2, 0, Math.PI * 2);
            context.strokeStyle = "rgba(220, 60, 60, 0.35)";
            context.lineWidth = 0.5;
            context.stroke();
        }
    }
}

// ── Hotspot system ─────────────────────────────────────────────

function createHotspot() {
    let hotspot = {
        x: randomBetween(50, WORLD_WIDTH - 50),
        y: randomBetween(50, WORLD_HEIGHT - 50),
        food: []
    };
    for (let i = 0; i < HOTSPOT_MAX_FOOD; i++) {
        spawnFoodAtHotspot(hotspot);
    }
    return hotspot;
}

function spawnFoodAtHotspot(hotspot) {
    let angle = Math.random() * Math.PI * 2;
    let radius = Math.random() * HOTSPOT_RADIUS;
    let foodX = hotspot.x + Math.cos(angle) * radius;
    let foodY = hotspot.y + Math.sin(angle) * radius;

    // Keep food within world bounds
    foodX = Math.max(5, Math.min(WORLD_WIDTH - 5, foodX));
    foodY = Math.max(5, Math.min(WORLD_HEIGHT - 5, foodY));

    let food = { x: foodX, y: foodY, _alive: true, age: 0 };
    hotspot.food.push(food);
    foods.push(food);
}

function updateHotspots() {
    for (let i = hotspots.length - 1; i >= 0; i--) {
        let hotspot = hotspots[i];

        // Remove references to eaten food
        hotspot.food = hotspot.food.filter(function(f) { return f._alive; });

        // Slowly regrow food if below capacity
        if (hotspot.food.length < HOTSPOT_MAX_FOOD && Math.random() < HOTSPOT_REGROW_CHANCE) {
            spawnFoodAtHotspot(hotspot);
        }

        // Depleted hotspot: replace with a new one elsewhere
        if (hotspot.food.length === 0) {
            hotspots.splice(i, 1);
            hotspots.push(createHotspot());
        }
    }

    // Maintain target number of hotspots
    while (hotspots.length < params.hotspotCount) {
        hotspots.push(createHotspot());
    }
    while (hotspots.length > params.hotspotCount) {
        let removed = hotspots.pop();
        for (let food of removed.food) food._alive = false;
    }
}

// ── Signal broadcasting ────────────────────────────────────────

function broadcastSignals() {
    // Reset neighbour counts
    for (let agent of agents) agent.neighbourCount = 0;

    // Emitting agents broadcast to all agents in range
    for (let i = 0; i < agents.length; i++) {
        let sender = agents[i];
        if (sender.emitTimer <= 0) continue;

        for (let j = 0; j < agents.length; j++) {
            if (i === j) continue;
            let receiver = agents[j];
            let distance = Math.hypot(sender.x - receiver.x, sender.y - receiver.y);

            if (distance < params.hearingRange) {
                receiver.neighbourCount++;
                receiver.hearSignal(sender.broadcastSignal, sender.x, sender.y, distance);
            }
        }
    }

    // Count neighbours for non-emitting agents (used by isolation drift)
    for (let i = 0; i < agents.length; i++) {
        for (let j = i + 1; j < agents.length; j++) {
            let dx = agents[i].x - agents[j].x;
            let dy = agents[i].y - agents[j].y;
            if (dx * dx + dy * dy < params.hearingRange * params.hearingRange) {
                agents[i].neighbourCount++;
                agents[j].neighbourCount++;
            }
        }
    }
}

// ── Metrics calculation ────────────────────────────────────────

function calculateMetrics() {
    // Count how many agents use each signal
    let signalCounts = new Float32Array(NUM_SIGNALS);
    for (let agent of agents) {
        signalCounts[agent.broadcastSignal]++;
    }

    // Find the most popular signal
    let maxCount = 0;
    let dominantSignal = 0;
    for (let i = 0; i < NUM_SIGNALS; i++) {
        if (signalCounts[i] > maxCount) {
            maxCount = signalCounts[i];
            dominantSignal = i;
        }
    }

    // Consensus: what percentage use the dominant signal
    let consensus = agents.length > 0
        ? Math.round((maxCount / agents.length) * 100)
        : 0;

    // Active signals: how many are used by more than 3% of agents
    let activeSignals = 0;
    for (let i = 0; i < NUM_SIGNALS; i++) {
        if (signalCounts[i] > agents.length * 0.03) {
            activeSignals++;
        }
    }

    // Shannon entropy of signal distribution
    let entropy = 0;
    for (let i = 0; i < NUM_SIGNALS; i++) {
        if (signalCounts[i] > 0) {
            let probability = signalCounts[i] / agents.length;
            entropy -= probability * Math.log2(probability);
        }
    }

    return {
        consensus: consensus,
        activeSignals: activeSignals,
        entropy: +entropy.toFixed(2),
        signalCounts: signalCounts,
        dominantSignal: dominantSignal
    };
}

// ── Rendering ──────────────────────────────────────────────────

function drawWorld() {
    context.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    context.fillStyle = "#f7f5f0";
    context.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // Subtle ground texture
    context.globalAlpha = 0.03;
    for (let i = 0; i < 12; i++) {
        context.beginPath();
        context.arc(
            randomBetween(0, WORLD_WIDTH),
            randomBetween(0, WORLD_HEIGHT),
            randomBetween(15, 40),
            0, Math.PI * 2
        );
        context.fillStyle = "#b8b090";
        context.fill();
    }
    context.globalAlpha = 1;

    // Hotspot zones
    for (let hotspot of hotspots) {
        let fillLevel = hotspot.food.length / HOTSPOT_MAX_FOOD;
        context.beginPath();
        context.arc(hotspot.x, hotspot.y, HOTSPOT_RADIUS, 0, Math.PI * 2);
        context.fillStyle = "rgba(120, 170, 50, " + (0.04 + fillLevel * 0.06) + ")";
        context.fill();
        context.strokeStyle = "rgba(120, 170, 50, " + (0.08 + fillLevel * 0.12) + ")";
        context.lineWidth = 0.5;
        context.stroke();
    }

    // Food items
    for (let food of foods) {
        if (!food._alive) continue;
        food.age++;
        let pulse = 0.9 + Math.sin(food.age * 0.04) * 0.1;
        context.beginPath();
        context.arc(food.x, food.y, 4 * pulse, 0, Math.PI * 2);
        context.fillStyle = "rgba(95, 155, 30, 0.85)";
        context.fill();
        context.beginPath();
        context.arc(food.x - 1, food.y - 1.5, 1.8, 0, Math.PI * 2);
        context.fillStyle = "rgba(150, 200, 70, 0.35)";
        context.fill();
    }

    // Agents
    for (let agent of agents) {
        agent.draw();
    }
}

function drawGraph(canvasId, data1, color1, scale1, data2, color2, scale2) {
    let graphCanvas = document.getElementById(canvasId);
    let graphContext = graphCanvas.getContext("2d");
    let width = graphCanvas.width;
    let height = graphCanvas.height;

    graphContext.clearRect(0, 0, width, height);

    // Grid lines
    graphContext.strokeStyle = "rgba(0, 0, 0, 0.05)";
    graphContext.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
        let y = (height * i) / 4;
        graphContext.beginPath();
        graphContext.moveTo(0, y);
        graphContext.lineTo(width, y);
        graphContext.stroke();
    }

    // Draw a data line
    function drawLine(data, color, scale) {
        if (data.length < 2) return;
        graphContext.beginPath();
        graphContext.strokeStyle = color;
        graphContext.lineWidth = 1.5;
        for (let i = 0; i < data.length; i++) {
            let x = (i / (MAX_HISTORY - 1)) * width;
            let y = height - (data[i] / scale) * height * 0.85 - height * 0.07;
            if (i === 0) graphContext.moveTo(x, y);
            else graphContext.lineTo(x, y);
        }
        graphContext.stroke();
    }

    drawLine(data1, color1, scale1);
    drawLine(data2, color2, scale2);
}

// ── UI updates ─────────────────────────────────────────────────

function updateSignalBars(signalCounts) {
    let container = document.getElementById("bars");

    // Create bar elements on first call
    if (!container.children.length) {
        for (let i = 0; i < NUM_SIGNALS; i++) {
            let bar = document.createElement("div");
            bar.className = "sig-bar";
            container.appendChild(bar);
        }
        let labels = document.getElementById("bar-labels");
        for (let i = 0; i < NUM_SIGNALS; i++) {
            let label = document.createElement("span");
            label.textContent = i;
            labels.appendChild(label);
        }
    }

    let maxCount = Math.max(1, ...signalCounts);
    for (let i = 0; i < NUM_SIGNALS; i++) {
        let bar = container.children[i];
        let heightPercent = Math.max(2, (signalCounts[i] / maxCount) * 100);
        bar.style.height = heightPercent + "%";
        bar.style.background = SIGNAL_COLORS[i];
        bar.style.opacity = signalCounts[i] > 0 ? 1 : 0.12;
    }
}

function updateConsensusLabel(dominantSignal, consensus) {
    let label = document.getElementById("con-word");
    if (consensus >= 70) {
        label.textContent = "Signal " + dominantSignal + " is dominant";
        label.style.color = SIGNAL_COLORS[dominantSignal];
    } else if (consensus >= 40) {
        label.textContent = "Signal " + dominantSignal + " forming...";
        label.style.color = SIGNAL_COLORS[dominantSignal];
    } else {
        label.textContent = "No consensus yet";
        label.style.color = "#a8a196";
    }
}

// ── Controls ───────────────────────────────────────────────────

function togglePause() {
    paused = !paused;
    document.getElementById("btn-pause").textContent = paused ? "▶ Play" : "⏸ Pause";
}

/** Scramble all agent vocabularies to simulate catastrophic language loss. */
function babel() {
    for (let agent of agents) {
        agent.broadcastSignal = Math.floor(Math.random() * NUM_SIGNALS);
        agent.beliefs.fill(0);
        agent.foodsFound = 0;
        agent.age = 0;
        agent.signalSource = null;
    }
}

/** Reset the entire simulation to initial state. */
function resetAll() {
    agents = [];
    foods = [];
    hotspots = [];
    tickCount = 0;
    generation = 0;
    totalFoodFound = 0;
    recentFinds = 0;
    recentTicks = 0;
    history = { consensus: [], efficiency: [], entropy: [], vocabulary: [] };
    timeline = [];

    for (let i = 0; i < params.population; i++) {
        agents.push(new Agent());
    }
    for (let i = 0; i < params.hotspotCount; i++) {
        hotspots.push(createHotspot());
    }
}

/** Bind a slider element to a parameter with live updates. */
function bindSlider(sliderId, paramKey, displayId, formatter) {
    let slider = document.getElementById(sliderId);
    if (!slider) return;
    slider.addEventListener("input", function () {
        params[paramKey] = +this.value;
        document.getElementById(displayId).textContent =
            formatter ? formatter(+this.value) : (+this.value).toFixed(2);

        // Adjust population live
        if (paramKey === "population") {
            while (agents.length < params.population) agents.push(new Agent());
            while (agents.length > params.population) agents.pop();
        }
    });
}

// Connect all sliders
bindSlider("r-lr", "learnRate", "v-lr");
bindSlider("r-decay", "memoryDecay", "v-decay", function (v) { return v.toFixed(3); });
bindSlider("r-conf", "conformity", "v-conf");
bindSlider("r-range", "hearingRange", "v-range", function (v) { return v.toFixed(0); });
bindSlider("r-iso", "isolationDrift", "v-iso", function (v) { return v.toFixed(3); });
bindSlider("r-rebel", "youthRebellion", "v-rebel", function (v) { return v.toFixed(3); });
bindSlider("r-cerr", "mishearing", "v-cerr", function (v) { return v.toFixed(3); });
bindSlider("r-pop", "population", "v-pop", function (v) { return v.toFixed(0); });
bindSlider("r-spots", "hotspotCount", "v-spots", function (v) { return v.toFixed(0); });
bindSlider("r-spd", "simSpeed", "v-spd", function (v) { return v.toFixed(0); });

// ── Load parameters from a saved experiment ────────────────────

function loadParameters(experimentId) {
    fetch("/api/experiments/" + experimentId + "/parameters")
        .then(function (response) { return response.json(); })
        .then(function (data) {
            if (data.error) return;

            // Map saved keys back to param names and slider ids
            let mapping = {
                lr: ["learnRate", "r-lr", "v-lr"],
                decay: ["memoryDecay", "r-decay", "v-decay"],
                conf: ["conformity", "r-conf", "v-conf"],
                range: ["hearingRange", "r-range", "v-range"],
                iso: ["isolationDrift", "r-iso", "v-iso"],
                rebel: ["youthRebellion", "r-rebel", "v-rebel"],
                cerr: ["mishearing", "r-cerr", "v-cerr"],
                pop: ["population", "r-pop", "v-pop"],
                spots: ["hotspotCount", "r-spots", "v-spots"],
                spd: ["simSpeed", "r-spd", "v-spd"]
            };

            for (let key in mapping) {
                if (data[key] !== undefined) {
                    let [paramName, sliderId, displayId] = mapping[key];
                    params[paramName] = data[key];
                    let slider = document.getElementById(sliderId);
                    if (slider) slider.value = data[key];
                    let display = document.getElementById(displayId);
                    if (display) display.textContent = Number(data[key]).toFixed(
                        key === "range" || key === "pop" || key === "spots" || key === "spd" ? 0 : (key === "lr" || key === "conf" ? 2 : 3)
                    );
                }
            }

            resetAll();
            let status = document.getElementById("save-status");
            if (status) {
                status.textContent = "✓ Parameters loaded";
                setTimeout(function () { status.textContent = ""; }, 3000);
            }
        })
        .catch(function (error) { console.error("Load failed:", error); });
}

// ── Save experiment ────────────────────────────────────────────

function saveExperiment() {
    let metrics = calculateMetrics();
    let nameInput = document.getElementById("exp-name");
    let notesInput = document.getElementById("exp-notes");
    let name = nameInput.value.trim();
    let notes = notesInput.value.trim();

    // Frontend validation
    if (!name) {
        nameInput.style.borderColor = "#e17055";
        nameInput.focus();
        return;
    }
    nameInput.style.borderColor = "";

    // Build short parameter keys for storage
    let savedParams = {
        lr: params.learnRate,
        decay: params.memoryDecay,
        conf: params.conformity,
        range: params.hearingRange,
        iso: params.isolationDrift,
        rebel: params.youthRebellion,
        cerr: params.mishearing,
        spots: params.hotspotCount,
        spd: params.simSpeed
    };

    let data = {
        name: name,
        notes: notes,
        generation: generation,
        consensus: metrics.consensus,
        entropy: metrics.entropy,
        active_signals: metrics.activeSignals,
        dominant_signal: metrics.dominantSignal,
        total_food: totalFoodFound,
        population: params.population,
        parameters: savedParams,
        timeline: timeline.slice(-100)
    };

    fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
    })
        .then(function (response) { return response.json(); })
        .then(function (result) {
            let status = document.getElementById("save-status");
            if (result.error) {
                status.textContent = "Error: " + result.error;
                status.style.color = "#e17055";
            } else {
                status.textContent = "✓ Saved as #" + result.id;
                status.style.color = "#00b894";
                nameInput.value = "";
                notesInput.value = "";
            }
            setTimeout(function () { status.textContent = ""; }, 4000);
        })
        .catch(function (error) {
            console.error("Save failed:", error);
            let status = document.getElementById("save-status");
            status.textContent = "Save failed. Check connection.";
            status.style.color = "#e17055";
        });
}

// ── Main loop ──────────────────────────────────────────────────

function mainLoop() {
    requestAnimationFrame(mainLoop);
    if (paused) return;

    // Run simulation steps
    for (let step = 0; step < params.simSpeed; step++) {
        tickCount++;
        recentTicks++;
        if (tickCount % 500 === 0) generation++;

        updateHotspots();
        foods = foods.filter(function (f) { return f._alive; });
        broadcastSignals();

        for (let agent of agents) agent.update();

        // Replace starved agents with fresh ones
        for (let i = agents.length - 1; i >= 0; i--) {
            if (agents[i].energy <= 0) {
                agents.splice(i, 1);
                agents.push(new Agent());
            }
        }
    }

    // Render the world
    drawWorld();

    // Update metrics display periodically
    if (tickCount % 20 === 0) {
        let metrics = calculateMetrics();
        let findRate = recentTicks > 0
            ? Math.round((recentFinds / recentTicks) * 1000)
            : 0;

        document.getElementById("m-con").textContent = metrics.consensus + "%";
        document.getElementById("m-vocab").textContent = metrics.activeSignals + "/" + NUM_SIGNALS;
        document.getElementById("m-eff").textContent = findRate;
        document.getElementById("m-ent").textContent = metrics.entropy;
        document.getElementById("m-fed").textContent = totalFoodFound;
        document.getElementById("gen-label").textContent =
            "Generation " + generation + " · " + totalFoodFound + " food found";

        updateSignalBars(metrics.signalCounts);
        updateConsensusLabel(metrics.dominantSignal, metrics.consensus);

        // Push to graph history
        history.consensus.push(metrics.consensus);
        history.efficiency.push(Math.min(100, findRate * 4));
        history.entropy.push(metrics.entropy);
        history.vocabulary.push(metrics.activeSignals);

        if (history.consensus.length > MAX_HISTORY) {
            history.consensus.shift();
            history.efficiency.shift();
            history.entropy.shift();
            history.vocabulary.shift();
        }

        // Record timeline for saving
        timeline.push({
            tick: tickCount,
            consensus: metrics.consensus,
            entropy: metrics.entropy,
            active_signals: metrics.activeSignals,
            find_rate: findRate
        });
        if (timeline.length > 500) timeline.shift();

        // Redraw graphs
        drawGraph("g-con",
            history.consensus, "#6c5ce7", 100,
            history.efficiency, "#00b894", 100
        );
        drawGraph("g-ent",
            history.entropy, "#fdcb6e", Math.log2(NUM_SIGNALS),
            history.vocabulary, "#e17055", NUM_SIGNALS
        );

        // Reset rolling find rate window
        if (recentTicks > 300) {
            recentFinds = 0;
            recentTicks = 0;
        }
    }
}

// ── Start ──────────────────────────────────────────────────────

resetAll();
mainLoop();
