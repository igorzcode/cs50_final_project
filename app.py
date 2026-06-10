import json
import sqlite3
from datetime import datetime
from flask import Flask, render_template, request, jsonify, g

app = Flask(__name__)
DATABASE = "emergence.db"


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_):
    db = g.pop("db", None)
    if db:
        db.close()


def init_db():
    db = sqlite3.connect(DATABASE)
    db.executescript("""
        CREATE TABLE IF NOT EXISTS experiments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            generation INTEGER,
            consensus REAL,
            entropy REAL,
            active_signals INTEGER,
            dominant_signal INTEGER,
            total_food INTEGER,
            parameters TEXT NOT NULL,
            notes TEXT
        );
        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            experiment_id INTEGER REFERENCES experiments(id),
            tick INTEGER,
            consensus REAL,
            entropy REAL,
            active_signals INTEGER,
            find_rate REAL
        );
    """)
    db.close()


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/experiments")
def experiments():
    rows = get_db().execute(
        "SELECT * FROM experiments ORDER BY timestamp DESC"
    ).fetchall()
    return render_template("experiments.html", experiments=rows)


@app.route("/api/save", methods=["POST"])
def save():
    d = request.get_json()
    if not d:
        return jsonify(error="No data"), 400

    db = get_db()
    cur = db.execute(
        """INSERT INTO experiments
           (name,timestamp,generation,consensus,entropy,
            active_signals,dominant_signal,total_food,parameters,notes)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (d.get("name", "Untitled"), datetime.now().isoformat(),
         d.get("generation", 0), d.get("consensus", 0),
         d.get("entropy", 0), d.get("active_signals", 0),
         d.get("dominant_signal", -1), d.get("total_food", 0),
         json.dumps(d.get("parameters", {})), d.get("notes", ""))
    )
    eid = cur.lastrowid
    for s in d.get("timeline", []):
        db.execute(
            """INSERT INTO snapshots
               (experiment_id,tick,consensus,entropy,active_signals,find_rate)
               VALUES (?,?,?,?,?,?)""",
            (eid, s.get("tick"), s.get("consensus"), s.get("entropy"),
             s.get("active_signals"), s.get("find_rate"))
        )
    db.commit()
    return jsonify(id=eid, status="saved")


@app.route("/api/experiments/<int:eid>")
def get_experiment(eid):
    db = get_db()
    exp = db.execute("SELECT * FROM experiments WHERE id=?", (eid,)).fetchone()
    if not exp:
        return jsonify(error="Not found"), 404
    snaps = db.execute(
        "SELECT * FROM snapshots WHERE experiment_id=? ORDER BY tick", (eid,)
    ).fetchall()
    return jsonify(experiment=dict(exp), timeline=[dict(s) for s in snaps])


@app.route("/api/experiments/<int:eid>", methods=["DELETE"])
def delete_experiment(eid):
    db = get_db()
    db.execute("DELETE FROM snapshots WHERE experiment_id=?", (eid,))
    db.execute("DELETE FROM experiments WHERE id=?", (eid,))
    db.commit()
    return jsonify(status="deleted")


if __name__ == "__main__":
    init_db()
    app.run(debug=True)
