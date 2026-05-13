# 🏋️ Daily Health Tracker

A self-hosted, mobile-first nightly tracking app for your TrueNAS Scale server.

## Quick Start

```bash
# Clone / copy files to your server, then:
docker compose up -d --build
```

App will be live at **http://YOUR-SERVER-IP:5400**

---

## Features

- **Daily Form** — Water, Coffee, Alcohol, Happiness/Stress sliders, Stretching toggle, Self-improvement journal
- **Progressive Overload** — Pushups & Squats auto-scale goals based on performance
  - Hit goal → +5% (bumps to +7% after 3 in a row, +10% after 5)
  - Miss goal → resets to your actual reps + small step
  - Override any goal manually from Settings
- **Custom Fields** — Add any metric (number, yes/no, text, rating 1–5)
- **History** — Browse all past entries with key stats, tap to expand
- **Stats** — Streak counter, 7-day averages, all-time totals
- **Dark / Light Mode** — Toggle in the header
- **Export** — Download CSV or query the raw JSON API

---

## Progressive Overload Formula

| Scenario | Next Goal |
|---|---|
| Hit goal (1–2 consecutive) | `goal × 1.05`, min +1 |
| Hit goal (3–4 consecutive) | `goal × 1.07`, min +2 |
| Hit goal (5+ consecutive)  | `goal × 1.10`, min +2 |
| Missed goal (did something)| `done + max(1, done × 0.05)`, capped at original goal |
| Did nothing (0)            | Goal unchanged |

---

## REST API

All data is accessible via the REST API.

### Entries

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`    | `/api/entries`               | All entries (newest first) |
| `GET`    | `/api/entries/date/YYYY-MM-DD` | Single entry by date |
| `POST`   | `/api/entries`               | Create or update entry |
| `DELETE` | `/api/entries/date/YYYY-MM-DD` | Delete an entry |

**POST body example:**
```json
{
  "date": "2025-01-15",
  "water_bottles": 3.5,
  "self_improvement": "Read for 30 minutes, went for a walk",
  "happiness": 8,
  "stress": 4,
  "coffee": 2,
  "alcohol": 0,
  "stretching": true,
  "pushups_done": 25,
  "squats_done": 30,
  "notes": "Felt great today",
  "custom_data": {}
}
```

### Goals

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/api/goals`                    | Current pushup & squat goals |
| `PUT`  | `/api/goals/override`           | Manually override a goal |
| `POST` | `/api/goals/preview`            | Preview next goal before saving |
| `GET`  | `/api/goals/history/{exercise}` | Goal progression history |

**PUT override body:**
```json
{ "exercise": "pushups", "new_goal": 40 }
```

### Custom Fields

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`    | `/api/custom-fields`     | All active custom fields |
| `POST`   | `/api/custom-fields`     | Add a custom field |
| `DELETE` | `/api/custom-fields/{id}`| Remove a custom field |

**POST body:**
```json
{ "name": "Steps", "field_type": "number", "unit": "steps" }
```
`field_type` options: `number` · `boolean` · `text` · `rating`

### Stats

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/stats` | Aggregated stats + streak |

---

## Data Persistence

Data is stored in a named Docker volume (`health-tracker-data`) mounted at `/data/health_tracker.db` (SQLite).

To back up:
```bash
docker run --rm -v health-tracker-data:/data -v $(pwd):/backup alpine \
  cp /data/health_tracker.db /backup/health_tracker_backup.db
```

To restore:
```bash
docker run --rm -v health-tracker-data:/data -v $(pwd):/backup alpine \
  cp /backup/health_tracker_backup.db /data/health_tracker.db
```

---

## File Structure

```
health-tracker/
├── docker-compose.yml   ← Start here
├── Dockerfile
├── main.py              ← FastAPI backend + SQLite
├── requirements.txt
└── static/
    ├── index.html       ← SPA shell
    ├── style.css        ← Dark/light theme, mobile-first
    └── app.js           ← All frontend logic
```
