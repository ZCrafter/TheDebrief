from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
import sqlite3
import json
import math
import os
import re
from datetime import datetime

DATABASE_PATH = os.environ.get("DATABASE_PATH", "/data/health_tracker.db")

app = FastAPI(title="Health Tracker API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Database ────────────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    os.makedirs(os.path.dirname(DATABASE_PATH), exist_ok=True)
    conn = get_db()
    c = conn.cursor()

    c.execute("""CREATE TABLE IF NOT EXISTS entries (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        date        TEXT    UNIQUE NOT NULL,
        water_bottles  REAL    DEFAULT 0,
        self_improvement TEXT  DEFAULT '',
        happiness   INTEGER DEFAULT 5,
        stress      INTEGER DEFAULT 5,
        coffee      REAL    DEFAULT 0,
        alcohol     REAL    DEFAULT 0,
        stretching  INTEGER DEFAULT 0,
        pushups_done INTEGER DEFAULT 0,
        squats_done  INTEGER DEFAULT 0,
        notes        TEXT    DEFAULT '',
        custom_data  TEXT    DEFAULT '{}',
        created_at   TEXT    DEFAULT CURRENT_TIMESTAMP,
        updated_at   TEXT    DEFAULT CURRENT_TIMESTAMP
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS exercise_goals (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        exercise        TEXT    UNIQUE NOT NULL,
        current_goal    INTEGER DEFAULT 10,
        starting_goal   INTEGER DEFAULT 10,
        consecutive_hits INTEGER DEFAULT 0,
        total_hits      INTEGER DEFAULT 0,
        total_misses    INTEGER DEFAULT 0,
        updated_at      TEXT    DEFAULT CURRENT_TIMESTAMP
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS goal_history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        exercise   TEXT NOT NULL,
        date       TEXT NOT NULL,
        goal       INTEGER,
        actual     INTEGER,
        hit        INTEGER,
        new_goal   INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS custom_fields (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        field_key  TEXT UNIQUE NOT NULL,
        field_type TEXT NOT NULL DEFAULT 'number',
        unit       TEXT DEFAULT '',
        group_name TEXT DEFAULT 'Custom',
        sort_order INTEGER DEFAULT 0,
        active     INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )""")
    # Migration: add group_name to existing databases
    try:
        c.execute("ALTER TABLE custom_fields ADD COLUMN group_name TEXT DEFAULT 'Custom'")
    except Exception:
        pass  # Column already exists

    # Seed default goals
    c.execute("INSERT OR IGNORE INTO exercise_goals (exercise, current_goal, starting_goal) VALUES ('pushups', 10, 10)")
    c.execute("INSERT OR IGNORE INTO exercise_goals (exercise, current_goal, starting_goal) VALUES ('squats', 15, 15)")

    conn.commit()
    conn.close()


@app.on_event("startup")
def startup():
    init_db()


# ─── Progressive Overload ─────────────────────────────────────────────────────

def calculate_next_goal(current_goal: int, done: int, consecutive_hits: int):
    """
    Returns (new_goal, new_consecutive_hits, did_hit)
    Formula:
      - Hit goal: +5% (min +1); after 3 consecutive +7%; after 5 consecutive +10%
      - Missed (but did something): new goal = done + small step (3%), capped at original goal
      - Did nothing: goal unchanged
    """
    if done >= current_goal:
        new_consec = consecutive_hits + 1
        if new_consec >= 5:
            pct = 0.10
        elif new_consec >= 3:
            pct = 0.07
        else:
            pct = 0.05
        increase = max(1, math.ceil(current_goal * pct))
        return current_goal + increase, new_consec, True
    elif done > 0:
        step = max(1, math.ceil(done * 0.05))
        new_goal = min(done + step, current_goal)  # don't exceed original goal
        return new_goal, 0, False
    else:
        return current_goal, 0, False


def preview_next_goal(current_goal: int, done: int, consecutive_hits: int) -> int:
    """Same formula but just returns the projected next goal for UI preview."""
    g, _, _ = calculate_next_goal(current_goal, done, consecutive_hits)
    return g


# ─── Helpers ─────────────────────────────────────────────────────────────────

def row_to_dict(row) -> dict:
    if row is None:
        return None
    d = dict(row)
    if "custom_data" in d and isinstance(d["custom_data"], str):
        try:
            d["custom_data"] = json.loads(d["custom_data"])
        except Exception:
            d["custom_data"] = {}
    if "stretching" in d:
        d["stretching"] = bool(d["stretching"])
    return d


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower().strip()).strip("_")


# ─── Pydantic Models ──────────────────────────────────────────────────────────

class EntryCreate(BaseModel):
    date: str
    water_bottles: float = 0
    self_improvement: str = ""
    happiness: int = 5
    stress: int = 5
    coffee: float = 0
    alcohol: float = 0
    stretching: bool = False
    pushups_done: int = 0
    squats_done: int = 0
    notes: str = ""
    custom_data: Dict[str, Any] = {}


class GoalOverride(BaseModel):
    exercise: str
    new_goal: int


class CustomFieldCreate(BaseModel):
    name: str
    field_type: str = "number"   # number | boolean | text | rating
    unit: str = ""
    group_name: str = "Custom"


class GoalPreviewRequest(BaseModel):
    exercise: str
    done: int


# ─── Entries ──────────────────────────────────────────────────────────────────

@app.get("/api/entries")
def get_entries(limit: int = 365, offset: int = 0):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM entries ORDER BY date DESC LIMIT ? OFFSET ?", (limit, offset)
    ).fetchall()
    conn.close()
    return [row_to_dict(r) for r in rows]


@app.get("/api/entries/date/{entry_date}")
def get_entry_by_date(entry_date: str):
    conn = get_db()
    row = conn.execute("SELECT * FROM entries WHERE date = ?", (entry_date,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Entry not found")
    return row_to_dict(row)


@app.post("/api/entries", status_code=201)
def create_or_update_entry(entry: EntryCreate):
    conn = get_db()
    c = conn.cursor()
    now = datetime.now().isoformat()
    custom_str = json.dumps(entry.custom_data)

    existing = c.execute("SELECT id FROM entries WHERE date = ?", (entry.date,)).fetchone()

    if existing:
        c.execute(
            """UPDATE entries SET
                water_bottles=?, self_improvement=?, happiness=?, stress=?,
                coffee=?, alcohol=?, stretching=?, pushups_done=?, squats_done=?,
                notes=?, custom_data=?, updated_at=?
               WHERE date=?""",
            (
                entry.water_bottles, entry.self_improvement, entry.happiness,
                entry.stress, entry.coffee, entry.alcohol, int(entry.stretching),
                entry.pushups_done, entry.squats_done, entry.notes, custom_str, now,
                entry.date,
            ),
        )
    else:
        c.execute(
            """INSERT INTO entries
                (date, water_bottles, self_improvement, happiness, stress,
                 coffee, alcohol, stretching, pushups_done, squats_done, notes, custom_data)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                entry.date, entry.water_bottles, entry.self_improvement,
                entry.happiness, entry.stress, entry.coffee, entry.alcohol,
                int(entry.stretching), entry.pushups_done, entry.squats_done,
                entry.notes, custom_str,
            ),
        )

    # Progressive overload updates
    goal_updates = {}
    for exercise, done in [("pushups", entry.pushups_done), ("squats", entry.squats_done)]:
        g = c.execute("SELECT * FROM exercise_goals WHERE exercise = ?", (exercise,)).fetchone()
        if g:
            g = dict(g)
            new_goal, new_consec, hit = calculate_next_goal(g["current_goal"], done, g["consecutive_hits"])
            total_hits   = g["total_hits"]   + (1 if hit else 0)
            total_misses = g["total_misses"] + (1 if not hit and done > 0 else 0)

            c.execute(
                """UPDATE exercise_goals SET
                    current_goal=?, consecutive_hits=?, total_hits=?, total_misses=?, updated_at=?
                   WHERE exercise=?""",
                (new_goal, new_consec, total_hits, total_misses, now, exercise),
            )
            c.execute(
                "INSERT INTO goal_history (exercise, date, goal, actual, hit, new_goal) VALUES (?, ?, ?, ?, ?, ?)",
                (exercise, entry.date, g["current_goal"], done, int(hit), new_goal),
            )
            goal_updates[exercise] = {
                "old_goal": g["current_goal"],
                "new_goal": new_goal,
                "hit": hit,
                "consecutive_hits": new_consec,
            }

    conn.commit()
    result = row_to_dict(c.execute("SELECT * FROM entries WHERE date = ?", (entry.date,)).fetchone())
    conn.close()
    result["goal_updates"] = goal_updates
    return result


@app.delete("/api/entries/date/{entry_date}")
def delete_entry(entry_date: str):
    conn = get_db()
    conn.execute("DELETE FROM entries WHERE date = ?", (entry_date,))
    conn.commit()
    conn.close()
    return {"message": "deleted"}


# ─── Goals ────────────────────────────────────────────────────────────────────

@app.get("/api/goals")
def get_goals():
    conn = get_db()
    rows = conn.execute("SELECT * FROM exercise_goals").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/goals/preview")
def preview_goal(req: GoalPreviewRequest):
    conn = get_db()
    g = conn.execute("SELECT * FROM exercise_goals WHERE exercise = ?", (req.exercise,)).fetchone()
    conn.close()
    if not g:
        raise HTTPException(status_code=404, detail="Goal not found")
    g = dict(g)
    projected = preview_next_goal(g["current_goal"], req.done, g["consecutive_hits"])
    hit = req.done >= g["current_goal"]
    return {
        "exercise": req.exercise,
        "current_goal": g["current_goal"],
        "done": req.done,
        "hit": hit,
        "projected_next_goal": projected,
        "consecutive_hits": g["consecutive_hits"],
    }


@app.put("/api/goals/override")
def override_goal(override: GoalOverride):
    if override.new_goal < 1:
        raise HTTPException(status_code=400, detail="Goal must be at least 1")
    conn = get_db()
    conn.execute(
        "UPDATE exercise_goals SET current_goal=?, consecutive_hits=0, updated_at=? WHERE exercise=?",
        (override.new_goal, datetime.now().isoformat(), override.exercise),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM exercise_goals WHERE exercise = ?", (override.exercise,)).fetchone()
    conn.close()
    return dict(row)


@app.get("/api/goals/history/{exercise}")
def get_goal_history(exercise: str):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM goal_history WHERE exercise = ? ORDER BY date DESC LIMIT 60", (exercise,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ─── Custom Fields ────────────────────────────────────────────────────────────

@app.get("/api/custom-fields")
def get_custom_fields():
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM custom_fields WHERE active = 1 ORDER BY sort_order, id"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/custom-fields", status_code=201)
def create_custom_field(field: CustomFieldCreate):
    key = f"cf_{slugify(field.name)}_{int(datetime.now().timestamp())}"
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO custom_fields (name, field_key, field_type, unit, group_name) VALUES (?, ?, ?, ?, ?)",
            (field.name.strip(), key, field.field_type, field.unit.strip(), field.group_name.strip() or "Custom"),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM custom_fields WHERE field_key = ?", (key,)).fetchone()
        conn.close()
        return dict(row)
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/api/custom-fields/{field_id}")
def delete_custom_field(field_id: int):
    conn = get_db()
    conn.execute("UPDATE custom_fields SET active = 0 WHERE id = ?", (field_id,))
    conn.commit()
    conn.close()
    return {"message": "deactivated"}


# ─── Stats ────────────────────────────────────────────────────────────────────

@app.get("/api/stats")
def get_stats():
    conn = get_db()
    total = conn.execute("SELECT COUNT(*) as c FROM entries").fetchone()["c"]
    if total == 0:
        conn.close()
        return {"total_entries": 0}

    avg = conn.execute("""SELECT
        ROUND(AVG(happiness), 2)     as avg_happiness,
        ROUND(AVG(stress), 2)        as avg_stress,
        ROUND(AVG(water_bottles), 2) as avg_water,
        ROUND(AVG(coffee), 2)        as avg_coffee,
        ROUND(AVG(alcohol), 2)       as avg_alcohol,
        SUM(stretching)              as total_stretching_days,
        SUM(pushups_done)            as total_pushups,
        SUM(squats_done)             as total_squats
        FROM entries""").fetchone()

    goals = conn.execute("SELECT * FROM exercise_goals").fetchall()

    # 7-day trend
    recent = conn.execute("""SELECT
        ROUND(AVG(happiness), 2) as avg_happiness,
        ROUND(AVG(stress), 2)    as avg_stress
        FROM entries ORDER BY date DESC LIMIT 7""").fetchone()

    # Streak: consecutive days with an entry (today or yesterday as start)
    dates = [r[0] for r in conn.execute("SELECT date FROM entries ORDER BY date DESC").fetchall()]

    from datetime import date, timedelta
    today = date.today()
    streak = 0

    if dates:
        most_recent = dates[0]
        if most_recent == today.isoformat():
            base = today
        elif most_recent == (today - timedelta(days=1)).isoformat():
            base = today - timedelta(days=1)
        else:
            base = None  # last entry too old

        if base:
            for i, d in enumerate(dates):
                expected = (base - timedelta(days=i)).isoformat()
                if d == expected:
                    streak += 1
                else:
                    break

    conn.close()
    return {
        "total_entries": total,
        "streak_days": streak,
        "all_time": dict(avg),
        "last_7_days": dict(recent),
        "goals": [dict(g) for g in goals],
    }


# ─── Static / SPA ────────────────────────────────────────────────────────────

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def serve_index():
    return FileResponse("static/index.html")


@app.get("/{full_path:path}")
def serve_spa(full_path: str):
    # Don't intercept /api routes
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404)
    return FileResponse("static/index.html")
