"""
Emergence: a simulation of how shared language forms
from individual reinforcement learning.

Flask backend handling experiment persistence, statistical
analysis, and comparison between simulation runs.
"""

import json
import math
import sqlite3
from datetime import datetime
from functools import wraps

from flask import Flask, render_template, request, jsonify, g, abort

app = Flask(__name__)
DATABASE = "emergence.db"


# ── Database helpers ────────────────────────────────────────────


def get_db():
    """Return a database connection for the current request."""
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(exception):
    """Close the database connection when the request ends."""
    db = g.pop("db", None)
    if db:
        db.close()


def init_db():
    """Create tables if they do not exist."""
    db = sqlite3.connect(DATABASE)
    db.executescript("""
        CREATE TABLE IF NOT EXISTS experiments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            generation INTEGER NOT NULL DEFAULT 0,
            consensus REAL NOT NULL DEFAULT 0,
            entropy REAL NOT NULL DEFAULT 0,
            active_signals INTEGER NOT NULL DEFAULT 0,
            dominant_signal INTEGER NOT NULL DEFAULT -1,
            total_food INTEGER NOT NULL DEFAULT 0,
            population INTEGER NOT NULL DEFAULT 50,
            parameters TEXT NOT NULL,
            notes TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            experiment_id INTEGER NOT NULL,
            tick INTEGER NOT NULL,
            consensus REAL NOT NULL,
            entropy REAL NOT NULL,
            active_signals INTEGER NOT NULL,
            find_rate REAL NOT NULL,
            FOREIGN KEY (experiment_id)
                REFERENCES experiments(id) ON DELETE CASCADE
        );
    """)
    db.close()


# ── Validation ──────────────────────────────────────────────────


def validate_experiment_data(data):
    """
    Validate incoming experiment data.
    Returns (cleaned_data, error_message).
    Error message is None if valid.
    """
    if not isinstance(data, dict):
        return None, "Request body must be a JSON object"

    name = str(data.get("name", "")).strip()
    if not name or len(name) > 200:
        return None, "Name must be between 1 and 200 characters"

    notes = str(data.get("notes", "")).strip()
    if len(notes) > 2000:
        return None, "Notes must be under 2000 characters"

    # Validate numeric fields with expected ranges
    try:
        generation = int(data.get("generation", 0))
        consensus = float(data.get("consensus", 0))
        entropy = float(data.get("entropy", 0))
        active_signals = int(data.get("active_signals", 0))
        dominant_signal = int(data.get("dominant_signal", -1))
        total_food = int(data.get("total_food", 0))
        population = int(data.get("population", 50))
    except (TypeError, ValueError):
        return None, "Numeric fields must be valid numbers"

    if not (0 <= consensus <= 100):
        return None, "Consensus must be between 0 and 100"
    if not (0 <= entropy <= 10):
        return None, "Entropy must be between 0 and 10"
    if not (0 <= active_signals <= 10):
        return None, "Active signals must be between 0 and 10"
    if not (-1 <= dominant_signal <= 9):
        return None, "Dominant signal must be between -1 and 9"
    if generation < 0 or total_food < 0 or population < 0:
        return None, "Generation, food, and population cannot be negative"

    # Validate parameters object
    parameters = data.get("parameters", {})
    if not isinstance(parameters, dict):
        return None, "Parameters must be an object"

    # Validate timeline entries
    timeline = data.get("timeline", [])
    if not isinstance(timeline, list):
        return None, "Timeline must be a list"
    if len(timeline) > 500:
        timeline = timeline[-500:]

    for snap in timeline:
        if not isinstance(snap, dict):
            return None, "Each timeline entry must be an object"

    return {
        "name": name,
        "notes": notes,
        "generation": generation,
        "consensus": consensus,
        "entropy": entropy,
        "active_signals": active_signals,
        "dominant_signal": dominant_signal,
        "total_food": total_food,
        "population": population,
        "parameters": parameters,
        "timeline": timeline,
    }, None


def validate_snapshot(snap):
    """Validate a single timeline snapshot. Returns cleaned dict."""
    return {
        "tick": max(0, int(snap.get("tick", 0))),
        "consensus": max(0, min(100, float(snap.get("consensus", 0)))),
        "entropy": max(0, float(snap.get("entropy", 0))),
        "active_signals": max(0, min(10, int(snap.get("active_signals", 0)))),
        "find_rate": max(0, float(snap.get("find_rate", 0))),
    }


# ── Statistical analysis (real Python logic) ───────────────────


def compute_convergence_tick(snapshots):
    """
    Find the first tick where consensus stayed above 60%
    for at least 5 consecutive readings.
    Returns the tick number, or None if convergence never happened.
    """
    streak = 0
    for snap in snapshots:
        if snap["consensus"] >= 60:
            streak += 1
            if streak >= 5:
                return snap["tick"]
        else:
            streak = 0
    return None


def compute_stability(snapshots):
    """
    Measure how stable the consensus is once formed.
    Returns the standard deviation of consensus values
    in the second half of the timeline.
    """
    if len(snapshots) < 10:
        return None

    second_half = snapshots[len(snapshots) // 2:]
    values = [s["consensus"] for s in second_half]
    mean = sum(values) / len(values)
    variance = sum((v - mean) ** 2 for v in values) / len(values)
    return round(math.sqrt(variance), 2)


def compute_efficiency_gain(snapshots):
    """
    Compare average find rate in first quarter vs last quarter.
    A positive value means language improved foraging efficiency.
    """
    if len(snapshots) < 8:
        return None

    quarter = len(snapshots) // 4
    early = snapshots[:quarter]
    late = snapshots[-quarter:]

    early_avg = sum(s["find_rate"] for s in early) / len(early)
    late_avg = sum(s["find_rate"] for s in late) / len(late)

    if early_avg == 0:
        return None

    return round(((late_avg - early_avg) / max(early_avg, 0.01)) * 100, 1)


def analyse_experiment(snapshots):
    """Run all analyses on a set of timeline snapshots."""
    snap_dicts = [dict(s) for s in snapshots]
    return {
        "convergence_tick": compute_convergence_tick(snap_dicts),
        "stability": compute_stability(snap_dicts),
        "efficiency_gain": compute_efficiency_gain(snap_dicts),
        "total_snapshots": len(snap_dicts),
    }


# ── Routes: pages ──────────────────────────────────────────────


@app.route("/")
def index():
    """Main simulation page."""
    return render_template("index.html")


@app.route("/experiments")
def experiments():
    """
    Experiment log with aggregate statistics.
    Uses JOIN to include snapshot count per experiment
    and GROUP BY for aggregation.
    """
    db = get_db()
    rows = db.execute("""
        SELECT
            e.*,
            COUNT(s.id) AS snapshot_count,
            ROUND(AVG(s.consensus), 1) AS avg_consensus,
            ROUND(MAX(s.consensus), 1) AS peak_consensus,
            ROUND(MIN(s.entropy), 2) AS min_entropy
        FROM experiments e
        LEFT JOIN snapshots s ON s.experiment_id = e.id
        GROUP BY e.id
        ORDER BY e.timestamp DESC
    """).fetchall()

    # Compute summary statistics across all experiments
    summary = db.execute("""
        SELECT
            COUNT(*) AS total_experiments,
            ROUND(AVG(consensus), 1) AS avg_consensus,
            MAX(consensus) AS best_consensus,
            ROUND(AVG(total_food), 0) AS avg_food
        FROM experiments
    """).fetchone()

    return render_template(
        "experiments.html",
        experiments=rows,
        summary=summary,
    )


@app.route("/experiments/<int:experiment_id>")
def experiment_detail(experiment_id):
    """
    Detail page for a single experiment.
    Shows the full timeline graph and analysis.
    """
    db = get_db()
    experiment = db.execute(
        "SELECT * FROM experiments WHERE id = ?",
        (experiment_id,),
    ).fetchone()

    if not experiment:
        abort(404)

    snapshots = db.execute(
        "SELECT * FROM snapshots WHERE experiment_id = ? ORDER BY tick",
        (experiment_id,),
    ).fetchall()

    analysis = analyse_experiment(snapshots)
    snapshot_list = [dict(s) for s in snapshots]

    return render_template(
        "detail.html",
        experiment=experiment,
        snapshots=snapshots,
        snapshots_json=snapshot_list,
        analysis=analysis,
    )


# ── Routes: API ─────────────────────────────────────────────────


@app.route("/api/save", methods=["POST"])
def save_experiment():
    """Save a new experiment with validation."""
    data = request.get_json()
    cleaned, error = validate_experiment_data(data)
    if error:
        return jsonify(error=error), 400

    db = get_db()
    cursor = db.execute(
        """INSERT INTO experiments
           (name, timestamp, generation, consensus, entropy,
            active_signals, dominant_signal, total_food,
            population, parameters, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            cleaned["name"],
            datetime.now().isoformat(),
            cleaned["generation"],
            cleaned["consensus"],
            cleaned["entropy"],
            cleaned["active_signals"],
            cleaned["dominant_signal"],
            cleaned["total_food"],
            cleaned["population"],
            json.dumps(cleaned["parameters"]),
            cleaned["notes"],
        ),
    )
    experiment_id = cursor.lastrowid

    for raw_snap in cleaned["timeline"]:
        snap = validate_snapshot(raw_snap)
        db.execute(
            """INSERT INTO snapshots
               (experiment_id, tick, consensus, entropy,
                active_signals, find_rate)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                experiment_id,
                snap["tick"],
                snap["consensus"],
                snap["entropy"],
                snap["active_signals"],
                snap["find_rate"],
            ),
        )

    db.commit()
    return jsonify(id=experiment_id, status="saved")


@app.route("/api/experiments/<int:experiment_id>", methods=["DELETE"])
def delete_experiment(experiment_id):
    """Delete an experiment and its snapshots (CASCADE)."""
    db = get_db()
    result = db.execute(
        "SELECT id FROM experiments WHERE id = ?",
        (experiment_id,),
    ).fetchone()
    if not result:
        return jsonify(error="Experiment not found"), 404

    db.execute("DELETE FROM experiments WHERE id = ?", (experiment_id,))
    db.commit()
    return jsonify(status="deleted")


@app.route("/api/experiments/<int:experiment_id>/parameters")
def get_parameters(experiment_id):
    """Return saved parameters so the simulation can reload them."""
    db = get_db()
    row = db.execute(
        "SELECT parameters, population FROM experiments WHERE id = ?",
        (experiment_id,),
    ).fetchone()
    if not row:
        return jsonify(error="Not found"), 404

    params = json.loads(row["parameters"])
    params["pop"] = row["population"]
    return jsonify(params)


@app.route("/api/compare/<int:id_a>/<int:id_b>")
def compare_experiments(id_a, id_b):
    """
    Compare two experiments using timeline data.
    Returns side by side analysis with statistical comparison.
    """
    db = get_db()

    exp_a = db.execute(
        "SELECT * FROM experiments WHERE id = ?", (id_a,)
    ).fetchone()
    exp_b = db.execute(
        "SELECT * FROM experiments WHERE id = ?", (id_b,)
    ).fetchone()

    if not exp_a or not exp_b:
        return jsonify(error="One or both experiments not found"), 404

    snaps_a = db.execute(
        "SELECT * FROM snapshots WHERE experiment_id = ? ORDER BY tick",
        (id_a,),
    ).fetchall()
    snaps_b = db.execute(
        "SELECT * FROM snapshots WHERE experiment_id = ? ORDER BY tick",
        (id_b,),
    ).fetchall()

    analysis_a = analyse_experiment(snaps_a)
    analysis_b = analyse_experiment(snaps_b)

    # Determine which converged faster
    winner = None
    if analysis_a["convergence_tick"] and analysis_b["convergence_tick"]:
        if analysis_a["convergence_tick"] < analysis_b["convergence_tick"]:
            winner = "a"
        elif analysis_b["convergence_tick"] < analysis_a["convergence_tick"]:
            winner = "b"

    return jsonify(
        experiment_a={"name": exp_a["name"], **analysis_a},
        experiment_b={"name": exp_b["name"], **analysis_b},
        faster_convergence=winner,
        consensus_diff=round(exp_a["consensus"] - exp_b["consensus"], 1),
    )


@app.route("/api/stats")
def global_stats():
    """
    Aggregate statistics across all saved experiments.
    Uses GROUP BY, AVG, COUNT, and subqueries.
    """
    db = get_db()

    overview = db.execute("""
        SELECT
            COUNT(*) AS total_experiments,
            ROUND(AVG(consensus), 1) AS avg_final_consensus,
            ROUND(AVG(entropy), 2) AS avg_final_entropy,
            ROUND(AVG(total_food), 0) AS avg_food_found,
            MAX(consensus) AS highest_consensus,
            MIN(entropy) AS lowest_entropy
        FROM experiments
    """).fetchone()

    # Most common dominant signal across all experiments
    top_signal = db.execute("""
        SELECT dominant_signal, COUNT(*) AS times_dominant
        FROM experiments
        WHERE dominant_signal >= 0
        GROUP BY dominant_signal
        ORDER BY times_dominant DESC
        LIMIT 1
    """).fetchone()

    # Average convergence speed from snapshot data
    avg_snapshots = db.execute("""
        SELECT
            e.id,
            ROUND(AVG(s.consensus), 1) AS avg_con,
            COUNT(s.id) AS readings
        FROM experiments e
        JOIN snapshots s ON s.experiment_id = e.id
        GROUP BY e.id
        HAVING readings > 5
    """).fetchall()

    return jsonify(
        overview=dict(overview) if overview else {},
        most_common_signal=dict(top_signal) if top_signal else None,
        experiments_with_data=len(avg_snapshots),
    )


# ── Error handlers ──────────────────────────────────────────────


@app.errorhandler(404)
def not_found(error):
    return render_template("404.html"), 404


@app.errorhandler(500)
def server_error(error):
    return jsonify(error="Internal server error"), 500


# ── Entry point ─────────────────────────────────────────────────


if __name__ == "__main__":
    init_db()
    app.run(debug=True)
