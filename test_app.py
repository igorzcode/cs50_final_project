"""
Tests for the Emergence web application.
Covers routes, validation, database operations, and statistical analysis.

Run with: pytest tests/test_app.py -v
"""

import json
import os
import tempfile

import pytest

from app import app, init_db, compute_convergence_tick, compute_stability, compute_efficiency_gain


@pytest.fixture
def client():
    """Create a test client with a temporary database."""
    db_fd, db_path = tempfile.mkstemp()
    app.config["TESTING"] = True

    # Point database at temp file
    import app as app_module
    app_module.DATABASE = db_path
    init_db()

    with app.test_client() as client:
        yield client

    os.close(db_fd)
    os.unlink(db_path)


def make_experiment(name="Test run", consensus=72, notes=""):
    """Helper to build valid experiment data."""
    return {
        "name": name,
        "generation": 5,
        "consensus": consensus,
        "entropy": 1.23,
        "active_signals": 3,
        "dominant_signal": 4,
        "total_food": 120,
        "population": 50,
        "parameters": {"lr": 0.18, "conf": 0.35},
        "notes": notes,
        "timeline": [
            {"tick": i * 100, "consensus": i * 10, "entropy": 3.0 - i * 0.3,
             "active_signals": 10 - i, "find_rate": i * 2}
            for i in range(10)
        ],
    }


# ── Route tests ─────────────────────────────────────────────────


def test_index_loads(client):
    """The simulation page should return 200."""
    response = client.get("/")
    assert response.status_code == 200
    assert b"How does a word get invented" in response.data


def test_experiments_page_empty(client):
    """The experiments page should load even with no data."""
    response = client.get("/experiments")
    assert response.status_code == 200
    assert b"No experiments saved yet" in response.data


def test_404_page(client):
    """Unknown routes should return 404."""
    response = client.get("/nonexistent")
    assert response.status_code == 404


# ── Save and retrieve tests ─────────────────────────────────────


def test_save_experiment(client):
    """Saving valid experiment data should return the new ID."""
    response = client.post(
        "/api/save",
        data=json.dumps(make_experiment()),
        content_type="application/json",
    )
    data = json.loads(response.data)
    assert response.status_code == 200
    assert data["status"] == "saved"
    assert data["id"] == 1


def test_save_creates_snapshots(client):
    """Saving should also store timeline snapshots."""
    client.post(
        "/api/save",
        data=json.dumps(make_experiment()),
        content_type="application/json",
    )
    response = client.get("/experiments/1")
    assert response.status_code == 200
    assert b"Test run" in response.data


def test_delete_experiment(client):
    """Deleting an experiment should remove it."""
    client.post(
        "/api/save",
        data=json.dumps(make_experiment()),
        content_type="application/json",
    )
    response = client.delete("/api/experiments/1")
    assert response.status_code == 200
    assert json.loads(response.data)["status"] == "deleted"

    # Should be gone now
    response = client.get("/experiments/1")
    assert response.status_code == 404


def test_delete_nonexistent(client):
    """Deleting a nonexistent experiment should return 404."""
    response = client.delete("/api/experiments/999")
    assert response.status_code == 404


# ── Validation tests ────────────────────────────────────────────


def test_save_empty_name_rejected(client):
    """An empty name should be rejected."""
    data = make_experiment(name="")
    response = client.post(
        "/api/save",
        data=json.dumps(data),
        content_type="application/json",
    )
    assert response.status_code == 400
    assert b"Name must be" in response.data


def test_save_long_name_rejected(client):
    """A name over 200 characters should be rejected."""
    data = make_experiment(name="x" * 201)
    response = client.post(
        "/api/save",
        data=json.dumps(data),
        content_type="application/json",
    )
    assert response.status_code == 400


def test_save_invalid_consensus_rejected(client):
    """Consensus outside 0-100 should be rejected."""
    data = make_experiment(consensus=150)
    response = client.post(
        "/api/save",
        data=json.dumps(data),
        content_type="application/json",
    )
    assert response.status_code == 400


def test_save_no_json_rejected(client):
    """A request with wrong content type should be rejected."""
    response = client.post("/api/save", data="not json", content_type="text/plain")
    assert response.status_code in (400, 415)


# ── API endpoint tests ──────────────────────────────────────────


def test_get_parameters(client):
    """Should return saved parameters for an experiment."""
    client.post(
        "/api/save",
        data=json.dumps(make_experiment()),
        content_type="application/json",
    )
    response = client.get("/api/experiments/1/parameters")
    data = json.loads(response.data)
    assert response.status_code == 200
    assert data["lr"] == 0.18
    assert data["pop"] == 50


def test_global_stats(client):
    """Global stats should aggregate across experiments."""
    for i in range(3):
        client.post(
            "/api/save",
            data=json.dumps(make_experiment(name=f"Run {i}", consensus=50 + i * 10)),
            content_type="application/json",
        )
    response = client.get("/api/stats")
    data = json.loads(response.data)
    assert data["overview"]["total_experiments"] == 3


def test_compare_experiments(client):
    """Comparing two experiments should return analysis for both."""
    client.post(
        "/api/save",
        data=json.dumps(make_experiment(name="Run A", consensus=80)),
        content_type="application/json",
    )
    client.post(
        "/api/save",
        data=json.dumps(make_experiment(name="Run B", consensus=40)),
        content_type="application/json",
    )
    response = client.get("/api/compare/1/2")
    data = json.loads(response.data)
    assert response.status_code == 200
    assert data["experiment_a"]["name"] == "Run A"
    assert data["experiment_b"]["name"] == "Run B"
    assert data["consensus_diff"] == 40.0


# ── Analysis function tests ─────────────────────────────────────


def test_convergence_tick_found():
    """Should find the tick where consensus stayed above 60% for 5 readings."""
    snapshots = [
        {"tick": i * 10, "consensus": 30 if i < 5 else 70, "find_rate": 1}
        for i in range(15)
    ]
    result = compute_convergence_tick(snapshots)
    # 5 consecutive readings above 60% starting at index 5, fifth is at index 9
    assert result == 90


def test_convergence_never():
    """Should return None if consensus never stays above 60%."""
    snapshots = [
        {"tick": i * 10, "consensus": 30, "find_rate": 1}
        for i in range(20)
    ]
    assert compute_convergence_tick(snapshots) is None


def test_stability_calculation():
    """Stability should measure std dev of second half consensus."""
    # Perfectly stable: all 50%
    snapshots = [{"consensus": 50, "find_rate": 1} for _ in range(20)]
    assert compute_stability(snapshots) == 0.0


def test_efficiency_gain_positive():
    """Efficiency gain should be positive when find rate increases."""
    snapshots = [
        {"consensus": 50, "find_rate": 1 if i < 10 else 5}
        for i in range(20)
    ]
    gain = compute_efficiency_gain(snapshots)
    assert gain is not None
    assert gain > 0


def test_efficiency_gain_no_data():
    """Should return None with too few snapshots."""
    assert compute_efficiency_gain([{"find_rate": 1}]) is None
