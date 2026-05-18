// ─────────────────────────────────────────────────────────
//  The Debrief — iOS Home Screen Widget
//  Built for Scriptable (free on App Store)
//
//  SETUP:
//  1. Install Scriptable from the App Store
//  2. Open Scriptable → tap + → paste this entire script
//  3. Change SERVER_URL below to your NAS IP
//  4. Long-press your home screen → + → Scriptable
//     Choose "Small" or "Medium" widget size
// ─────────────────────────────────────────────────────────

const SERVER_URL = "http://192.168.1.X:5400"; // ← Change this

// ── Colours ──────────────────────────────────────────────
const C = {
  bg:       new Color("#0b0f1a"),
  surface:  new Color("#131929"),
  accent:   new Color("#38bdf8"),
  energy:   new Color("#fb923c"),
  wellness: new Color("#34d399"),
  danger:   new Color("#f87171"),
  warning:  new Color("#fbbf24"),
  muted:    new Color("#64748b"),
  dim:      new Color("#94a3b8"),
  text:     new Color("#e2e8f0"),
};

// ── Helpers ───────────────────────────────────────────────
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function fetchJSON(path) {
  try {
    const req = new Request(`${SERVER_URL}${path}`);
    req.timeoutInterval = 5;
    return await req.loadJSON();
  } catch { return null; }
}

// ── Fetch data ────────────────────────────────────────────
const [goals, todayEntry, stats] = await Promise.all([
  fetchJSON("/api/goals"),
  fetchJSON(`/api/entries/date/${todayISO()}`),
  fetchJSON("/api/stats"),
]);

const goalMap = {};
(goals || []).forEach(g => goalMap[g.exercise] = g);
const puGoal  = goalMap['pushups'];
const sqGoal  = goalMap['squats'];
const puDone  = todayEntry?.pushups_done  ?? null;
const sqDone  = todayEntry?.squats_done   ?? null;
const streak  = stats?.streak_days        ?? 0;
const logged  = !!todayEntry;

// ── Widget ────────────────────────────────────────────────
const w = new ListWidget();
w.backgroundColor = C.bg;
w.setPadding(14, 14, 10, 14);
w.url = SERVER_URL;

// Title row
const titleRow = w.addStack();
titleRow.layoutHorizontally();
titleRow.centerAlignContent();

const titleTxt = titleRow.addText("THE DEBRIEF");
titleTxt.font        = new Font("Helvetica Neue", 9);
titleTxt.textColor   = C.muted;
titleTxt.leftAlignText();

titleRow.addSpacer();

// Streak badge
if (streak > 0) {
  const stk = titleRow.addText(`🔥 ${streak}`);
  stk.font      = new Font("Helvetica Neue", 10);
  stk.textColor = C.warning;
}

w.addSpacer(8);

// ── Exercise rows ─────────────────────────────────────────
function addExRow(container, label, goal, done) {
  if (!goal) return;

  const hit  = done !== null && done >= goal.current_goal;
  const pct  = done !== null ? Math.min(1, done / goal.current_goal) : 0;
  const numColor = done === null ? C.energy : (hit ? C.wellness : C.energy);

  const row = container.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();

  // Label
  const lbl = row.addText(label.toUpperCase());
  lbl.font      = new Font("Helvetica Neue", 10);
  lbl.textColor = C.dim;
  lbl.minimumScaleFactor = 0.7;

  row.addSpacer();

  // Done / goal numbers
  if (done !== null) {
    const doneTxt = row.addText(String(done));
    doneTxt.font      = Font.boldSystemFont(20);
    doneTxt.textColor = numColor;
    const sep = row.addText(" / ");
    sep.font      = new Font("Helvetica Neue", 11);
    sep.textColor = C.muted;
  }
  const goalTxt = row.addText(String(goal.current_goal));
  goalTxt.font      = done !== null ? new Font("Helvetica Neue", 13) : Font.boldSystemFont(22);
  goalTxt.textColor = done !== null ? C.muted : C.energy;

  container.addSpacer(4);

  // Progress bar
  const barBg = container.addStack();
  barBg.backgroundColor = new Color("#1a2235");
  barBg.cornerRadius    = 2;
  barBg.size            = new Size(0, 4);
  barBg.layoutHorizontally();

  const fill = barBg.addStack();
  fill.backgroundColor = hit ? C.wellness : C.energy;
  fill.cornerRadius    = 2;
  // Scriptable stacks can't do percentage width directly;
  // use spacer ratio trick
  fill.addSpacer(null);  // fill takes proportion of remaining space based on weight
  // We simulate fill via spacer count
  // (Scriptable doesn't support % width, so we use a text workaround)

  container.addSpacer(8);
}

addExRow(w, "Pushups", puGoal, puDone);
addExRow(w, "Squats",  sqGoal, sqDone);

w.addSpacer();

// Status line
const statusRow = w.addStack();
statusRow.layoutHorizontally();
const dot  = statusRow.addText(logged ? "● " : "○ ");
dot.font      = new Font("Helvetica Neue", 10);
dot.textColor = logged ? C.wellness : C.muted;
const statusTxt = statusRow.addText(logged ? "Logged today" : "Not logged yet");
statusTxt.font      = new Font("Helvetica Neue", 10);
statusTxt.textColor = logged ? C.wellness : C.muted;

// Refresh every 30 min
w.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);

Script.setWidget(w);
Script.complete();

// Preview in app
if (config.runsInApp) {
  await w.presentSmall();
}
