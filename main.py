from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
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

app = FastAPI(title="Health Tracker API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Database ─────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def migrate(c, sql):
    """Run a migration silently — ignore if column/table already exists."""
    try:
        c.execute(sql)
    except Exception:
        pass


def init_db():
    os.makedirs(os.path.dirname(DATABASE_PATH), exist_ok=True)
    conn = get_db()
    c = conn.cursor()

    c.execute("""CREATE TABLE IF NOT EXISTS entries (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        date             TEXT    UNIQUE NOT NULL,
        water_bottles    REAL    DEFAULT 0,
        self_improvement TEXT    DEFAULT '',
        health_notes     TEXT    DEFAULT '',
        happiness        INTEGER DEFAULT 3,
        stress           INTEGER DEFAULT 3,
        coffee           REAL    DEFAULT 0,
        alcohol          REAL    DEFAULT 0,
        stretching       INTEGER DEFAULT 0,
        pushups_done     INTEGER DEFAULT 0,
        squats_done      INTEGER DEFAULT 0,
        notes            TEXT    DEFAULT '',
        custom_data      TEXT    DEFAULT '{}',
        created_at       TEXT    DEFAULT CURRENT_TIMESTAMP,
        updated_at       TEXT    DEFAULT CURRENT_TIMESTAMP
    )""")

    c.execute("""CREATE TABLE IF NOT EXISTS exercise_goals (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        exercise         TEXT    UNIQUE NOT NULL,
        display_name     TEXT    NOT NULL DEFAULT '',
        data_key         TEXT    NOT NULL DEFAULT '',
        is_builtin       INTEGER DEFAULT 0,
        current_goal     INTEGER DEFAULT 10,
        starting_goal    INTEGER DEFAULT 10,
        consecutive_hits INTEGER DEFAULT 0,
        total_hits       INTEGER DEFAULT 0,
        total_misses     INTEGER DEFAULT 0,
        updated_at       TEXT    DEFAULT CURRENT_TIMESTAMP
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

    c.execute("""CREATE TABLE IF NOT EXISTS group_settings (
        group_name           TEXT PRIMARY KEY,
        color                TEXT DEFAULT 'custom',
        collapsed_by_default INTEGER DEFAULT 0,
        sort_order           INTEGER DEFAULT 0
    )""")

    # ── Migrations for existing databases ──────────────────
    migrate(c, "ALTER TABLE custom_fields ADD COLUMN group_name TEXT DEFAULT 'Custom'")
    migrate(c, "ALTER TABLE entries ADD COLUMN health_notes TEXT DEFAULT ''")
    migrate(c, "ALTER TABLE exercise_goals ADD COLUMN display_name TEXT NOT NULL DEFAULT ''")
    migrate(c, "ALTER TABLE exercise_goals ADD COLUMN data_key TEXT NOT NULL DEFAULT ''")
    migrate(c, "ALTER TABLE exercise_goals ADD COLUMN is_builtin INTEGER DEFAULT 0")

    # ── Seed built-in exercises ─────────────────────────────
    c.execute("""INSERT OR IGNORE INTO exercise_goals
        (exercise, display_name, data_key, is_builtin, current_goal, starting_goal)
        VALUES ('pushups', 'Pushups', 'pushups_done', 1, 10, 10)""")
    c.execute("""INSERT OR IGNORE INTO exercise_goals
        (exercise, display_name, data_key, is_builtin, current_goal, starting_goal)
        VALUES ('squats', 'Squats', 'squats_done', 1, 15, 15)""")
    # Backfill display_name / data_key / is_builtin on old rows
    c.execute("UPDATE exercise_goals SET display_name='Pushups', data_key='pushups_done', is_builtin=1 WHERE exercise='pushups' AND display_name=''")
    c.execute("UPDATE exercise_goals SET display_name='Squats',  data_key='squats_done',  is_builtin=1 WHERE exercise='squats'  AND display_name=''")

    conn.commit()
    conn.close()


@app.on_event("startup")
def startup():
    init_db()


# ─── Progressive Overload ──────────────────────────────────

def calculate_next_goal(current_goal: int, done: int, consecutive_hits: int):
    """
    Goal NEVER goes down. If you miss, stay at current goal (reset streak).
    If you hit, increase by 5 / 7 / 10% based on streak.
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
    else:
        # Miss or skip — hold the goal, reset streak
        return current_goal, 0, False


def preview_next_goal(current_goal: int, done: int, consecutive_hits: int) -> int:
    g, _, _ = calculate_next_goal(current_goal, done, consecutive_hits)
    return g


# ─── Helpers ──────────────────────────────────────────────

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


# ─── Pydantic Models ───────────────────────────────────────

class EntryCreate(BaseModel):
    date: str
    water_bottles: float = 0
    health_notes: str = ""
    happiness: int = 3
    stress: int = 3
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


class ExerciseCreate(BaseModel):
    display_name: str
    starting_goal: int = 10


class ExerciseDelete(BaseModel):
    exercise: str


class CustomFieldCreate(BaseModel):
    name: str
    field_type: str = "number"
    unit: str = ""
    group_name: str = "Custom"


class CustomFieldUpdate(BaseModel):
    name: str
    unit: str = ""
    group_name: str = "Custom"


class GroupSettingUpdate(BaseModel):
    group_name: str
    color: str = "custom"
    collapsed_by_default: bool = False


class GoalPreviewRequest(BaseModel):
    exercise: str
    done: int


# ─── Entries ──────────────────────────────────────────────

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
                water_bottles=?, health_notes=?, happiness=?, stress=?,
                coffee=?, alcohol=?, stretching=?, pushups_done=?, squats_done=?,
                notes=?, custom_data=?, updated_at=?
               WHERE date=?""",
            (
                entry.water_bottles, entry.health_notes, entry.happiness,
                entry.stress, entry.coffee, entry.alcohol, int(entry.stretching),
                entry.pushups_done, entry.squats_done, entry.notes, custom_str, now,
                entry.date,
            ),
        )
    else:
        c.execute(
            """INSERT INTO entries
                (date, water_bottles, health_notes, happiness, stress,
                 coffee, alcohol, stretching, pushups_done, squats_done, notes, custom_data)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                entry.date, entry.water_bottles, entry.health_notes,
                entry.happiness, entry.stress, entry.coffee, entry.alcohol,
                int(entry.stretching), entry.pushups_done, entry.squats_done,
                entry.notes, custom_str,
            ),
        )

    # Progressive overload — new entries only, never on edits
    goal_updates = {}
    if not existing:
        all_exercises = c.execute("SELECT * FROM exercise_goals").fetchall()
        for ex in all_exercises:
            ex = dict(ex)
            exercise_key = ex["exercise"]
            data_key = ex["data_key"]

            # Get reps: built-ins from columns, custom from custom_data
            if ex["is_builtin"]:
                done = getattr(entry, data_key, 0) or 0
            else:
                done = int(entry.custom_data.get(data_key, 0) or 0)

            new_goal, new_consec, hit = calculate_next_goal(
                ex["current_goal"], done, ex["consecutive_hits"]
            )
            total_hits   = ex["total_hits"]   + (1 if hit else 0)
            total_misses = ex["total_misses"] + (1 if not hit and done > 0 else 0)

            c.execute(
                """UPDATE exercise_goals SET
                    current_goal=?, consecutive_hits=?, total_hits=?, total_misses=?, updated_at=?
                   WHERE exercise=?""",
                (new_goal, new_consec, total_hits, total_misses, now, exercise_key),
            )
            c.execute(
                "INSERT INTO goal_history (exercise, date, goal, actual, hit, new_goal) VALUES (?, ?, ?, ?, ?, ?)",
                (exercise_key, entry.date, ex["current_goal"], done, int(hit), new_goal),
            )
            goal_updates[exercise_key] = {
                "old_goal": ex["current_goal"],
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


# ─── Goals & Exercises ────────────────────────────────────

@app.get("/api/goals")
def get_goals():
    conn = get_db()
    rows = conn.execute("SELECT * FROM exercise_goals ORDER BY is_builtin DESC, id").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/exercises", status_code=201)
def create_exercise(ex: ExerciseCreate):
    name = ex.display_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    key      = f"ex_{slugify(name)}_{int(datetime.now().timestamp())}"
    data_key = f"ex_{slugify(name)}"
    conn = get_db()
    try:
        conn.execute(
            """INSERT INTO exercise_goals
               (exercise, display_name, data_key, is_builtin, current_goal, starting_goal)
               VALUES (?, ?, ?, 0, ?, ?)""",
            (key, name, data_key, ex.starting_goal, ex.starting_goal),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM exercise_goals WHERE exercise = ?", (key,)).fetchone()
        conn.close()
        return dict(row)
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/api/exercises/{exercise_key}")
def delete_exercise(exercise_key: str):
    conn = get_db()
    ex = conn.execute("SELECT * FROM exercise_goals WHERE exercise = ?", (exercise_key,)).fetchone()
    if not ex:
        conn.close()
        raise HTTPException(status_code=404, detail="Exercise not found")
    if dict(ex)["is_builtin"]:
        conn.close()
        raise HTTPException(status_code=400, detail="Cannot delete built-in exercises")
    conn.execute("DELETE FROM exercise_goals WHERE exercise = ?", (exercise_key,))
    conn.commit()
    conn.close()
    return {"message": "deleted"}


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
        "UPDATE exercise_goals SET current_goal=?, starting_goal=?, consecutive_hits=0, updated_at=? WHERE exercise=?",
        (override.new_goal, override.new_goal, datetime.now().isoformat(), override.exercise),
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


# ─── Custom Fields ────────────────────────────────────────

@app.get("/api/custom-fields")
def get_custom_fields():
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM custom_fields WHERE active = 1 ORDER BY group_name, sort_order, id"
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


@app.put("/api/custom-fields/{field_id}")
def update_custom_field(field_id: int, update: CustomFieldUpdate):
    conn = get_db()
    row = conn.execute("SELECT id FROM custom_fields WHERE id = ? AND active = 1", (field_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Field not found")
    conn.execute(
        "UPDATE custom_fields SET name=?, unit=?, group_name=? WHERE id=?",
        (update.name.strip(), update.unit.strip(), update.group_name.strip() or "Custom", field_id),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM custom_fields WHERE id = ?", (field_id,)).fetchone()
    conn.close()
    return dict(row)


@app.delete("/api/custom-fields/{field_id}")
def delete_custom_field(field_id: int):
    conn = get_db()
    conn.execute("UPDATE custom_fields SET active = 0 WHERE id = ?", (field_id,))
    conn.commit()
    conn.close()
    return {"message": "deactivated"}


# ─── Group Settings ───────────────────────────────────────

@app.get("/api/group-settings")
def get_group_settings():
    conn = get_db()
    rows = conn.execute("SELECT * FROM group_settings ORDER BY sort_order, group_name").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.put("/api/group-settings")
def upsert_group_setting(update: GroupSettingUpdate):
    conn = get_db()
    # INSERT OR REPLACE is compatible with all SQLite versions (3.24+ ON CONFLICT is not)
    conn.execute(
        "DELETE FROM group_settings WHERE group_name = ?",
        (update.group_name,),
    )
    conn.execute(
        "INSERT INTO group_settings (group_name, color, collapsed_by_default) VALUES (?, ?, ?)",
        (update.group_name, update.color, int(update.collapsed_by_default)),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM group_settings WHERE group_name = ?", (update.group_name,)).fetchone()
    conn.close()
    return dict(row)


# ─── Stats ────────────────────────────────────────────────

@app.get("/api/stats")
def get_stats():
    conn = get_db()
    total = conn.execute("SELECT COUNT(*) as c FROM entries").fetchone()["c"]
    if total == 0:
        conn.close()
        return {"total_entries": 0, "streak_days": 0}

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

    goals  = conn.execute("SELECT * FROM exercise_goals ORDER BY is_builtin DESC, id").fetchall()
    recent = conn.execute("""SELECT
        ROUND(AVG(happiness), 2) as avg_happiness,
        ROUND(AVG(stress), 2)    as avg_stress
        FROM entries ORDER BY date DESC LIMIT 7""").fetchone()

    dates = [r[0] for r in conn.execute("SELECT date FROM entries ORDER BY date DESC").fetchall()]

    from datetime import date, timedelta
    today  = date.today()
    streak = 0

    if dates:
        most_recent = dates[0]
        if most_recent == today.isoformat():
            base = today
        elif most_recent == (today - timedelta(days=1)).isoformat():
            base = today - timedelta(days=1)
        else:
            base = None

        if base:
            for i, d in enumerate(dates):
                if d == (base - timedelta(days=i)).isoformat():
                    streak += 1
                else:
                    break

    conn.close()
    return {
        "total_entries": total,
        "streak_days":   streak,
        "all_time":      dict(avg),
        "last_7_days":   dict(recent),
        "goals":         [dict(g) for g in goals],
    }


# ─── Static / SPA ─────────────────────────────────────────

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def serve_index():
    return FileResponse("static/index.html")

@app.get("/{full_path:path}")
def serve_spa(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404)
    return FileResponse("static/index.html")
