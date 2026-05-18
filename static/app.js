/* ═══════════════════════════════════════════════════════════
   Daily Tracker — app.js
   Mobile-first SPA: Today form, History, Settings
═══════════════════════════════════════════════════════════ */

'use strict';

// ─── State ────────────────────────────────────────────────
const state = {
  goals: { pushups: { current_goal: 0, consecutive_hits: 0 }, squats: { current_goal: 0, consecutive_hits: 0 } },
  customFields: [],
  todayEntry: null,
  editingDate: null,
  historyLoaded: false,
  historyEntries: [],
  stats: null,
};

// ─── Helpers ──────────────────────────────────────────────
const $ = id => document.getElementById(id);
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

function fmtDate(isoStr) {
  const d = new Date(isoStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function toTitleCase(str) {
  return str.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ─── API ──────────────────────────────────────────────────
const API = {
  async get(path) {
    const r = await fetch(path);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async post(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async put(path, body) {
    const r = await fetch(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async del(path) {
    const r = await fetch(path, { method: 'DELETE' });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
};

// ─── Toast ────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = '') {
  const el = $('toast');
  clearTimeout(toastTimer);
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

// ─── Theme ────────────────────────────────────────────────
function loadTheme() {
  const saved = localStorage.getItem('ht_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('ht_theme', next);
}

// ─── Header Date ──────────────────────────────────────────
function setHeaderDate() {
  const d = new Date();
  $('header-date').textContent = d.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric'
  });
}

// ─── Goals ────────────────────────────────────────────────
async function loadGoals() {
  const rows = await API.get('/api/goals');
  if (!rows) return;
  rows.forEach(g => {
    state.goals[g.exercise] = g;
  });
  renderGoalBanner();
}

function renderGoalBanner() {
  const { pushups, squats } = state.goals;
  $('goal-pushups-num').textContent = pushups.current_goal || '—';
  $('goal-squats-num').textContent  = squats.current_goal  || '—';
  $('goal-pushups-streak').textContent = pushups.consecutive_hits
    ? `🔥 ${pushups.consecutive_hits} in a row`
    : (pushups.total_hits ? `${pushups.total_hits} total hits` : '');
  $('goal-squats-streak').textContent  = squats.consecutive_hits
    ? `🔥 ${squats.consecutive_hits} in a row`
    : (squats.total_hits  ? `${squats.total_hits} total hits` : '');

  $('pushups-badge').textContent = `Goal: ${pushups.current_goal}`;
  $('squats-badge').textContent  = `Goal: ${squats.current_goal}`;

  // Pre-fill override inputs
  const opi = $('override-pushups');
  const osi = $('override-squats');
  if (opi && !opi.value) opi.placeholder = pushups.current_goal;
  if (osi && !osi.value) osi.placeholder = squats.current_goal;
}

// ─── Custom Fields ────────────────────────────────────────
async function loadCustomFields() {
  const fields = await API.get('/api/custom-fields');
  state.customFields = fields || [];
  renderCustomFieldInputs();
  renderCustomFieldsList();
}

function renderCustomFieldInputs() {
  const container = $('custom-fields-container');
  if (!container) return;

  if (!state.customFields.length) {
    container.innerHTML = '';
    return;
  }

  // Group fields by group_name
  const groups = {};
  state.customFields.forEach(f => {
    const g = f.group_name || 'Custom';
    if (!groups[g]) groups[g] = [];
    groups[g].push(f);
  });

  const accentMap = {
    'Hydration & Intake': 'water', 'Mindset': 'mindset', 'Movement': 'energy',
    'Sleep': 'mindset', 'Nutrition': 'water',
  };
  const iconMap = {
    'Hydration & Intake': '💧', 'Mindset': '🧠', 'Movement': '🏋️',
    'Sleep': '🌙', 'Nutrition': '🥗',
  };

  container.innerHTML = Object.entries(groups).map(([groupName, fields]) => {
    const accent = accentMap[groupName] || 'custom';
    const icon   = iconMap[groupName]   || '✦';
    return `<div class="form-section" data-accent="${accent}" style="margin-top:0.75rem">
      <div class="section-header">
        <span class="section-icon">${icon}</span>
        <span class="section-title">${escHtml(groupName)}</span>
      </div>
      ${fields.map(f => {
        const savedVal = state.todayEntry?.custom_data?.[f.field_key];
        return `<div class="custom-input-row" data-key="${f.field_key}">
          <label class="field-label">${escHtml(f.name)}${f.unit ? ` <span class="field-unit">${escHtml(f.unit)}</span>` : ''}</label>
          ${buildCustomInput(f, savedVal)}
        </div>`;
      }).join('')}
    </div>`;
  }).join('');

  // Wire up booleans and rating stars
  state.customFields.forEach(f => {
    if (f.field_type === 'rating') {
      const row = container.querySelector(`.rating-stars[data-custom-key="${f.field_key}"]`);
      if (row) wireRatingStars(row, state.todayEntry?.custom_data?.[f.field_key] || 0);
    }
  });

  // Re-init any new steppers inside custom container
  container.querySelectorAll('.stepper').forEach(stepper => {
    if (stepper._wired) return;
    stepper._wired = true;
    const step = parseFloat(stepper.dataset.step) || 1;
    const min  = parseFloat(stepper.dataset.min)  || 0;
    const max  = parseFloat(stepper.dataset.max)  || 9999;
    stepper._value = parseFloat(stepper.querySelector('.step-value').textContent) || 0;
    stepper.querySelector('.step-down').addEventListener('click', () => {
      stepper._value = Math.max(min, stepper._value - step);
      stepper.querySelector('.step-value').textContent = Math.round(stepper._value);
    });
    stepper.querySelector('.step-up').addEventListener('click', () => {
      stepper._value = Math.min(max, stepper._value + step);
      stepper.querySelector('.step-value').textContent = Math.round(stepper._value);
    });
  });
}

function buildCustomInput(f, savedVal) {
  const v = savedVal !== undefined ? savedVal : '';
  switch (f.field_type) {
    case 'boolean':
      return `<label class="toggle-switch">
        <input type="checkbox" data-custom-key="${f.field_key}" ${v ? 'checked' : ''} />
        <span class="toggle-track"><span class="toggle-thumb"></span></span>
      </label>`;
    case 'text':
      return `<input type="text" class="text-input small" data-custom-key="${f.field_key}" value="${escHtml(v)}" placeholder="—" />`;
    case 'rating':
      return `<div class="rating-stars" data-custom-key="${f.field_key}" data-rating="${v || 0}">
        ${[1,2,3,4,5].map(i => `<button type="button" class="star-btn ${v >= i ? 'active' : ''}" data-val="${i}">★</button>`).join('')}
      </div>`;
    default: // number
      return `<div class="stepper" data-field="${f.field_key}" data-step="1" data-min="0" data-max="9999">
        <button type="button" class="step-btn step-down">−</button>
        <span class="step-value">${v || 0}</span>
        <button type="button" class="step-btn step-up">+</button>
      </div>`;
  }
}

function wireRatingStars(container, initial) {
  let current = initial || 0;
  const btns = container.querySelectorAll('.star-btn');
  function update(val) {
    current = val;
    container.dataset.rating = val;
    btns.forEach(b => b.classList.toggle('active', +b.dataset.val <= val));
  }
  btns.forEach(b => b.addEventListener('click', () => update(+b.dataset.val)));
  update(current);
}

function renderCustomFieldsList() {
  const list = $('custom-fields-list');
  if (!list) return;
  if (!state.customFields.length) {
    list.innerHTML = '<p class="empty-note">No custom fields yet. Add one above!</p>';
    return;
  }
  list.innerHTML = state.customFields.map(f => `
    <div class="custom-field-chip" data-id="${f.id}">
      <div class="chip-info">
        <span class="chip-name">${escHtml(f.name)}${f.unit ? ` <span class="field-unit">${escHtml(f.unit)}</span>` : ''}</span>
        <span class="chip-meta">${f.field_type} · ${escHtml(f.group_name || 'Custom')}</span>
      </div>
      <button class="chip-delete" data-id="${f.id}" title="Remove field">✕</button>
    </div>
  `).join('');

  list.querySelectorAll('.chip-delete').forEach(btn =>
    btn.addEventListener('click', () => deleteCustomField(+btn.dataset.id))
  );
}

async function addCustomField() {
  const name  = $('new-field-name').value.trim();
  const type  = $('new-field-type').value;
  const unit  = $('new-field-unit').value.trim();
  const group = $('new-field-group').value.trim() || 'Custom';
  if (!name) { showToast('Enter a field name', 'error'); return; }

  try {
    await API.post('/api/custom-fields', { name, field_type: type, unit, group_name: group });
    $('new-field-name').value  = '';
    $('new-field-unit').value  = '';
    $('new-field-group').value = '';
    $('add-field-form').style.display = 'none';
    await loadCustomFields();
    showToast(`"${name}" added to ${group}`, 'success');
  } catch (e) {
    showToast('Failed to add field', 'error');
  }
}

async function deleteCustomField(id) {
  if (!confirm('Remove this custom field?')) return;
  await API.del(`/api/custom-fields/${id}`);
  await loadCustomFields();
  showToast('Field removed');
}

// ─── Load Today's Entry ────────────────────────────────────
async function loadTodayEntry() {
  const entry = await API.get(`/api/entries/date/${todayISO()}`);
  state.todayEntry = entry;
  if (entry) populateForm(entry);
}

function populateForm(entry) {
  // Steppers
  setStepperValue('water_bottles', entry.water_bottles);
  setStepperValue('coffee',        entry.coffee);
  setStepperValue('alcohol',       entry.alcohol);

  // Sliders
  const happinessEl = $('happiness');
  const stressEl    = $('stress');
  if (happinessEl) {
    happinessEl.value = entry.happiness;
    $('happiness-val').textContent = entry.happiness;
    $('happiness-label').textContent = getMoodLabel('happiness', +entry.happiness);
    updateSliderFill(happinessEl);
  }
  if (stressEl) {
    stressEl.value = entry.stress;
    $('stress-val').textContent = entry.stress;
    $('stress-label').textContent = getMoodLabel('stress', +entry.stress);
    updateSliderFill(stressEl);
  }

  // Self-improvement textarea
  const si = $('self-improvement');
  if (si) si.value = entry.self_improvement || '';

  // Stretching
  const stretch = $('stretching');
  if (stretch) stretch.checked = !!entry.stretching;

  // Exercise
  const pu = $('pushups');
  const sq = $('squats');
  if (pu) {
    pu.value = entry.pushups_done;
    updateExerciseFeedback('pushups', entry.pushups_done);
    const puBtn = document.querySelector('.complete-btn[data-exercise="pushups"]');
    if (puBtn) puBtn.classList.toggle('done', entry.pushups_done >= (state.goals.pushups?.current_goal || 0) && entry.pushups_done > 0);
  }
  if (sq) {
    sq.value = entry.squats_done;
    updateExerciseFeedback('squats', entry.squats_done);
    const sqBtn = document.querySelector('.complete-btn[data-exercise="squats"]');
    if (sqBtn) sqBtn.classList.toggle('done', entry.squats_done >= (state.goals.squats?.current_goal || 0) && entry.squats_done > 0);
  }

  // Notes
  const notes = $('notes');
  if (notes) notes.value = entry.notes || '';

  // Custom fields (re-rendered in renderCustomFieldInputs after state.todayEntry is set)

  // Update "last saved" note
  $('last-saved-note').textContent = `Last saved: ${fmtDate(entry.date)}`;

  // Update submit button text
  $('submit-btn').querySelector('.submit-text').textContent = 'Update Today\'s Entry';
}

// ─── Form Steppers ────────────────────────────────────────
function setStepperValue(field, val) {
  const steppers = document.querySelectorAll(`[data-field="${field}"]`);
  steppers.forEach(s => {
    const span = s.querySelector('.step-value');
    if (span) span.textContent = formatStepValue(val, +s.dataset.step);
    s._value = val;
  });
}

function formatStepValue(val, step) {
  if (step < 1) return parseFloat(val.toFixed(1)).toString();
  return Math.round(val).toString();
}

function setupSteppers() {
  document.querySelectorAll('.stepper').forEach(stepper => {
    const step = parseFloat(stepper.dataset.step) || 1;
    const min  = parseFloat(stepper.dataset.min)  || 0;
    const max  = parseFloat(stepper.dataset.max)  || 9999;
    stepper._value = parseFloat(stepper.querySelector('.step-value').textContent) || 0;

    stepper.querySelector('.step-down').addEventListener('click', () => {
      stepper._value = Math.max(min, Math.round((stepper._value - step) * 100) / 100);
      stepper.querySelector('.step-value').textContent = formatStepValue(stepper._value, step);
    });
    stepper.querySelector('.step-up').addEventListener('click', () => {
      stepper._value = Math.min(max, Math.round((stepper._value + step) * 100) / 100);
      stepper.querySelector('.step-value').textContent = formatStepValue(stepper._value, step);
    });
  });
}

// ─── Slider Labels ────────────────────────────────────────
const HAPPINESS_LABELS = { 1: 'Rough day', 2: 'Below average', 3: 'Average', 4: 'Pretty good', 5: 'Fantastic!' };
const STRESS_LABELS    = { 1: 'Very calm',  2: 'Mostly calm',  3: 'Average', 4: 'Quite stressed', 5: 'Overwhelmed' };

function getMoodLabel(id, val) {
  return id === 'happiness' ? (HAPPINESS_LABELS[val] || '') : (STRESS_LABELS[val] || '');
}

function updateSliderFill(el) {
  const pct = ((+el.value - +el.min) / (+el.max - +el.min)) * 100;
  el.style.background = `linear-gradient(to right, var(--section-accent, var(--accent)) ${pct}%, var(--surface-3) ${pct}%)`;
}

function setupSliders() {
  [['happiness', 'happiness-val', 'happiness-label'], ['stress', 'stress-val', 'stress-label']].forEach(([id, valId, lblId]) => {
    const el  = $(id);
    const lbl = $(lblId);
    if (!el) return;
    updateSliderFill(el);
    if (lbl) lbl.textContent = getMoodLabel(id, +el.value);
    el.addEventListener('input', () => {
      $(valId).textContent = el.value;
      if (lbl) lbl.textContent = getMoodLabel(id, +el.value);
      updateSliderFill(el);
    });
  });
}

// ─── Exercise Feedback (live) ──────────────────────────────
function updateExerciseFeedback(exercise, done) {
  const goal     = state.goals[exercise]?.current_goal || 0;
  const consec   = state.goals[exercise]?.consecutive_hits || 0;
  const feedback = $(`${exercise}-feedback`);
  const progress = $(`${exercise}-progress`);
  const projected= $(`${exercise}-projected`);
  if (!feedback || !goal) return;

  const pct = goal > 0 ? Math.min(100, Math.round((done / goal) * 100)) : 0;
  progress.style.width = pct + '%';
  progress.classList.toggle('hit', done >= goal);

  if (done === 0) {
    feedback.textContent = '';
    feedback.className = 'exercise-feedback';
    projected.textContent = '';
    return;
  }

  if (done >= goal) {
    feedback.textContent = `✓ Goal hit! +${Math.ceil(goal * 0.05)} tomorrow`;
    feedback.className = 'exercise-feedback hit';
    const next = projectedGoal(goal, done, consec);
    projected.textContent = `Tomorrow's goal: ${next}`;
  } else {
    feedback.textContent = `${goal - done} short of goal`;
    feedback.className = 'exercise-feedback miss';
    const next = projectedGoal(goal, done, consec);
    projected.textContent = `Tomorrow's goal: ${next}`;
  }
}

function projectedGoal(currentGoal, done, consec) {
  if (done >= currentGoal) {
    const newConsec = consec + 1;
    let pct = 0.05;
    if (newConsec >= 5) pct = 0.10;
    else if (newConsec >= 3) pct = 0.07;
    return currentGoal + Math.max(1, Math.ceil(currentGoal * pct));
  } else if (done > 0) {
    const step = Math.max(1, Math.ceil(done * 0.05));
    return Math.min(done + step, currentGoal);
  }
  return currentGoal;
}

// ─── Collect Form Data ────────────────────────────────────
function collectFormData() {
  const getStepperVal = field => {
    const el = document.querySelector(`[data-field="${field}"]`);
    return el ? (el._value || 0) : 0;
  };

  const customData = {};
  state.customFields.forEach(f => {
    const key = f.field_key;
    if (f.field_type === 'boolean') {
      const cb = document.querySelector(`[data-custom-key="${key}"]`);
      customData[key] = cb ? cb.checked : false;
    } else if (f.field_type === 'rating') {
      const stars = document.querySelector(`.rating-stars[data-custom-key="${key}"]`);
      customData[key] = stars ? +stars.dataset.rating : 0;
    } else if (f.field_type === 'text') {
      const inp = document.querySelector(`[data-custom-key="${key}"]`);
      customData[key] = inp ? inp.value.trim() : '';
    } else { // number stepper
      customData[key] = getStepperVal(key);
    }
  });

  return {
    date:             state.editingDate || todayISO(),
    water_bottles:    getStepperVal('water_bottles'),
    self_improvement: ($('self-improvement')?.value || '').trim(),
    happiness:        +($('happiness')?.value || 5),
    stress:           +($('stress')?.value    || 5),
    coffee:           getStepperVal('coffee'),
    alcohol:          getStepperVal('alcohol'),
    stretching:       $('stretching')?.checked || false,
    pushups_done:     +($('pushups')?.value || 0),
    squats_done:      +($('squats')?.value  || 0),
    notes:            ($('notes')?.value || '').trim(),
    custom_data:      customData,
  };
}

// ─── Submit ───────────────────────────────────────────────
async function submitEntry(e) {
  e.preventDefault();
  const btn = $('submit-btn');
  btn.disabled = true;
  btn.classList.add('saving');
  btn.querySelector('.submit-text').textContent = 'Saving…';

  try {
    const data   = collectFormData();
    const result = await API.post('/api/entries', data);
    state.todayEntry = result;

    // Update goals in state
    if (result.goal_updates) {
      Object.entries(result.goal_updates).forEach(([ex, upd]) => {
        if (state.goals[ex]) {
          state.goals[ex].current_goal    = upd.new_goal;
          state.goals[ex].consecutive_hits = upd.consecutive_hits;
        }
      });
      renderGoalBanner();
      updateExerciseFeedback('pushups', data.pushups_done);
      updateExerciseFeedback('squats',  data.squats_done);
    }

    // If editing a past entry, exit edit mode
    if (state.editingDate) {
      state.editingDate = null;
      $('edit-banner').style.display = 'none';
    }

    $('last-saved-note').textContent = 'Saved just now ✓';

    // Green flash animation
    btn.classList.add('saved');
    btn.querySelector('.submit-text').textContent = '✓ Saved!';
    setTimeout(() => {
      btn.classList.remove('saved');
      btn.querySelector('.submit-text').textContent = 'Update Today\'s Entry';
    }, 2000);

    // Reset form to defaults
    resetFormToDefaults();

    // Show summary toast
    const gu = result.goal_updates || {};
    const msgs = [];
    ['pushups','squats'].forEach(ex => {
      if (gu[ex]) {
        msgs.push(gu[ex].hit
          ? `🎯 ${toTitleCase(ex)} goal hit! → ${gu[ex].new_goal} tomorrow`
          : `${toTitleCase(ex)}: new target ${gu[ex].new_goal}`);
      }
    });
    showToast(msgs.length ? msgs.join(' · ') : '✓ Entry saved!', 'success');

    // Invalidate history cache so charts and list refresh next visit
    state.historyLoaded = false;
    destroyCharts();

  } catch (err) {
    console.error(err);
    showToast('Error saving entry', 'error');
    btn.querySelector('.submit-text').textContent = 'Save Today\'s Entry';
  } finally {
    btn.disabled = false;
    btn.classList.remove('saving');
  }
}

// ─── Reset Form ───────────────────────────────────────────
function resetFormToDefaults() {
  // Steppers
  ['water_bottles','coffee','alcohol'].forEach(f => setStepperValue(f, 0));

  // Sliders back to 3
  ['happiness','stress'].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.value = 3;
    $(`${id}-val`).textContent  = '3';
    $(`${id}-label`).textContent = getMoodLabel(id, 3);
    updateSliderFill(el);
  });

  // Textareas
  const si = $('self-improvement');
  const notes = $('notes');
  if (si)    si.value    = '';
  if (notes) notes.value = '';

  // Stretching
  const stretch = $('stretching');
  if (stretch) stretch.checked = false;

  // Exercise inputs
  ['pushups','squats'].forEach(id => {
    const inp = $(id);
    if (!inp) return;
    inp.value = 0;
    updateExerciseFeedback(id, 0);
    const btn = document.querySelector(`.complete-btn[data-exercise="${id}"]`);
    if (btn) btn.classList.remove('done');
  });

  // Custom fields — re-render with no saved data
  const savedEntry = state.todayEntry;
  state.todayEntry = null;
  renderCustomFieldInputs();
  state.todayEntry = savedEntry; // restore so history still works
}

// ─── Charts ───────────────────────────────────────────────
const chartInstances = {};

function destroyCharts() {
  Object.values(chartInstances).forEach(c => c.destroy());
  Object.keys(chartInstances).forEach(k => delete chartInstances[k]);
}

function chartColors() {
  const s = getComputedStyle(document.documentElement);
  return {
    wellness: '#34d399', danger: '#f87171', accent: '#38bdf8',
    energy: '#fb923c',  mindset: '#a78bfa', warning: '#fbbf24',
    custom: '#f472b6',  muted: '#64748b',   grid: 'rgba(148,163,184,0.08)',
  };
}

function baseChartOptions(yMin, yMax, yStep) {
  const c = chartColors();
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 400 },
    plugins: {
      legend: { labels: { color: c.muted, font: { family: 'Barlow', size: 11 }, boxWidth: 10, padding: 12 } },
    },
    scales: {
      x: {
        ticks: { color: c.muted, font: { size: 10, family: 'Barlow' }, maxRotation: 45, autoSkip: true, maxTicksLimit: 10 },
        grid:  { color: c.grid },
      },
      y: {
        min: yMin, max: yMax,
        ticks: { color: c.muted, font: { size: 10, family: 'Barlow' }, stepSize: yStep },
        grid:  { color: c.grid },
      },
    },
  };
}

function renderCharts() {
  if (typeof Chart === 'undefined') return;
  const entries = [...state.historyEntries].reverse().slice(-60); // oldest→newest, max 60
  if (!entries.length) return;

  destroyCharts();

  const labels = entries.map(e => {
    const d = new Date(e.date + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });
  const c = chartColors();

  // ── Mood chart ──
  const moodCanvas = $('chart-mood');
  if (moodCanvas) {
    chartInstances['mood'] = new Chart(moodCanvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Happiness', data: entries.map(e => e.happiness), borderColor: c.wellness, backgroundColor: 'rgba(52,211,153,0.08)', tension: 0.4, fill: true, pointRadius: 3, pointBackgroundColor: c.wellness },
          { label: 'Stress',    data: entries.map(e => e.stress),    borderColor: c.danger,   backgroundColor: 'rgba(248,113,113,0.08)', tension: 0.4, fill: true, pointRadius: 3, pointBackgroundColor: c.danger },
        ],
      },
      options: { ...baseChartOptions(1, 5, 1) },
    });
  }

  // ── Exercise chart ──
  const exCanvas = $('chart-exercise');
  if (exCanvas) {
    const maxEx = Math.max(...entries.map(e => Math.max(e.pushups_done, e.squats_done)), 10);
    chartInstances['exercise'] = new Chart(exCanvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Pushups', data: entries.map(e => e.pushups_done), backgroundColor: 'rgba(251,146,60,0.75)', borderColor: c.energy,  borderWidth: 1, borderRadius: 3 },
          { label: 'Squats',  data: entries.map(e => e.squats_done),  backgroundColor: 'rgba(244,114,182,0.75)', borderColor: c.custom, borderWidth: 1, borderRadius: 3 },
        ],
      },
      options: { ...baseChartOptions(0, undefined, undefined) },
    });
  }

  // ── Hydration chart ──
  const hydCanvas = $('chart-hydration');
  if (hydCanvas) {
    chartInstances['hydration'] = new Chart(hydCanvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Water',   data: entries.map(e => e.water_bottles), backgroundColor: 'rgba(56,189,248,0.75)',  borderColor: c.accent,  borderWidth: 1, borderRadius: 3 },
          { label: 'Coffee',  data: entries.map(e => e.coffee),         backgroundColor: 'rgba(251,191,36,0.75)',  borderColor: c.warning, borderWidth: 1, borderRadius: 3 },
          { label: 'Alcohol', data: entries.map(e => e.alcohol),        backgroundColor: 'rgba(167,139,250,0.75)', borderColor: c.mindset, borderWidth: 1, borderRadius: 3 },
        ],
      },
      options: { ...baseChartOptions(0, undefined, 1) },
    });
  }
}

// ─── History ──────────────────────────────────────────────
async function loadHistory() {
  if (state.historyLoaded) return;
  const [entries, stats] = await Promise.all([
    API.get('/api/entries?limit=365'),
    API.get('/api/stats'),
  ]);
  state.historyEntries = entries || [];
  state.stats = stats;
  state.historyLoaded = true;
  renderHistory();
  renderStats();
  // Small delay so canvas is visible before Chart.js measures it
  setTimeout(renderCharts, 50);
}

function renderStats() {
  const s = state.stats;
  if (!s) return;
  $('stat-streak').querySelector('.stat-num').textContent   = s.streak_days ?? '0';
  $('stat-entries').querySelector('.stat-num').textContent  = s.total_entries ?? '0';
  $('stat-happiness').querySelector('.stat-num').textContent = s.last_7_days?.avg_happiness?.toFixed(1) ?? '—';
  $('stat-stress').querySelector('.stat-num').textContent   = s.last_7_days?.avg_stress?.toFixed(1)    ?? '—';
}

function renderHistory() {
  const list = $('history-list');
  if (!state.historyEntries.length) {
    list.innerHTML = '<div class="empty-state">No entries yet. Fill out today\'s log!</div>';
    return;
  }
  list.innerHTML = state.historyEntries.map(e => {
    const d    = new Date(e.date + 'T00:00:00');
    const day  = d.getDate();
    const mon  = d.toLocaleString('default', { month: 'short' }).toUpperCase();
    const mood = e.happiness ?? '—';
    const str  = e.stress    ?? '—';
    const pu   = e.pushups_done > 0 ? e.pushups_done : '—';
    const sq   = e.squats_done  > 0 ? e.squats_done  : '—';
    const water= e.water_bottles > 0 ? e.water_bottles : '—';
    const cof  = e.coffee > 0 ? e.coffee : '—';
    return `<div class="history-card" data-date="${e.date}">
      <div class="hc-date">
        <span class="hc-day">${day}</span>
        <span class="hc-month">${mon}</span>
      </div>
      <div class="hc-divider"></div>
      <div class="hc-stats">
        <div class="hc-stat"><span class="hc-stat-val">${mood}/5</span><span class="hc-stat-lbl">Happy</span></div>
        <div class="hc-stat"><span class="hc-stat-val">${str}/5</span><span class="hc-stat-lbl">Stress</span></div>
        <div class="hc-stat"><span class="hc-stat-val">${water}</span><span class="hc-stat-lbl">Water</span></div>
        <div class="hc-stat"><span class="hc-stat-val">${pu}</span><span class="hc-stat-lbl">Pushups</span></div>
        <div class="hc-stat"><span class="hc-stat-val">${sq}</span><span class="hc-stat-lbl">Squats</span></div>
        <div class="hc-stat"><span class="hc-stat-val">${cof}</span><span class="hc-stat-lbl">Coffee</span></div>
      </div>
      <svg class="hc-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </div>`;
  }).join('');

  list.querySelectorAll('.history-card').forEach(card =>
    card.addEventListener('click', () => openEntryModal(card.dataset.date))
  );
}

// ─── Entry Detail Modal ───────────────────────────────────
async function openEntryModal(date) {
  const entry = await API.get(`/api/entries/date/${date}`);
  if (!entry) return;

  $('modal-title').textContent = fmtDate(date);
  $('modal-body').innerHTML = buildModalBody(entry);

  // Wire up the edit button rendered inside buildModalBody
  const editBtn = $('modal-edit-btn');
  if (editBtn) editBtn.addEventListener('click', () => startEditingEntry(date, entry));

  $('modal-overlay').removeAttribute('hidden');
  document.body.style.overflow = 'hidden';
}

function buildModalBody(e) {
  const boolIcon = v => v ? '✓ Yes' : '— No';
  let html = `<div class="detail-grid">
    <div class="detail-item"><div class="detail-label">Happiness</div><div class="detail-value">${e.happiness}/5</div></div>
    <div class="detail-item"><div class="detail-label">Stress</div><div class="detail-value">${e.stress}/5</div></div>
    <div class="detail-item"><div class="detail-label">Water</div><div class="detail-value">${e.water_bottles} btl</div></div>
    <div class="detail-item"><div class="detail-label">Coffee</div><div class="detail-value">${e.coffee} cups</div></div>
    <div class="detail-item"><div class="detail-label">Alcohol</div><div class="detail-value">${e.alcohol} drk</div></div>
    <div class="detail-item"><div class="detail-label">Stretching</div><div class="detail-value">${boolIcon(e.stretching)}</div></div>
    <div class="detail-item"><div class="detail-label">Pushups</div><div class="detail-value">${e.pushups_done}</div></div>
    <div class="detail-item"><div class="detail-label">Squats</div><div class="detail-value">${e.squats_done}</div></div>`;

  // Custom fields
  const cd = e.custom_data || {};
  state.customFields.forEach(f => {
    const val = cd[f.field_key];
    if (val !== undefined && val !== '' && val !== 0) {
      html += `<div class="detail-item"><div class="detail-label">${escHtml(f.name)}</div><div class="detail-value">${escHtml(String(val))}${f.unit ? ' '+f.unit : ''}</div></div>`;
    }
  });
  html += `</div>`;

  if (e.self_improvement) {
    html += `<div class="detail-label" style="margin-bottom:0.4rem">Made myself better by:</div>
             <div class="detail-text">${escHtml(e.self_improvement)}</div>`;
  }
  if (e.notes) {
    html += `<div class="detail-label" style="margin-bottom:0.4rem">Notes:</div>
             <div class="detail-text">${escHtml(e.notes)}</div>`;
  }

  html += `<div style="margin-top:1rem">
    <button id="modal-edit-btn" class="submit-btn" style="height:44px;font-size:0.85rem">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      <span class="submit-text">Edit This Entry</span>
    </button>
  </div>`;

  return html;
}

// ─── Edit Past Entry ──────────────────────────────────────
function startEditingEntry(date, entry) {
  closeModal();
  state.editingDate = date;

  // Show edit banner
  const banner = $('edit-banner');
  $('edit-banner-date').textContent = fmtDate(date);
  banner.style.display = '';

  // Populate form and switch tab
  populateForm(entry);
  renderCustomFieldInputs();  // re-render with saved custom data
  switchTab('today');
  $('tab-container').scrollTop = 0;
  $('submit-btn').querySelector('.submit-text').textContent = 'Save Changes';
}

window.cancelEdit = function() {
  state.editingDate = null;
  $('edit-banner').style.display = 'none';
  $('submit-btn').querySelector('.submit-text').textContent = 'Save Today\'s Entry';
  // Restore today's data
  loadTodayEntry().then(() => {
    if (state.todayEntry) {
      populateForm(state.todayEntry);
    } else {
      resetFormToDefaults();
    }
    renderCustomFieldInputs();
  });
};

function closeModal() {
  $('modal-overlay').setAttribute('hidden', '');
  document.body.style.overflow = '';
}

// ─── Settings: Goal Override ──────────────────────────────
window.applyGoalOverride = async function(exercise) {
  const inp = $(`override-${exercise}`);
  const val = +inp.value;
  if (!val || val < 1) { showToast('Enter a valid goal', 'error'); return; }
  try {
    await API.put('/api/goals/override', { exercise, new_goal: val });
    await loadGoals();
    inp.value = '';
    showToast(`${toTitleCase(exercise)} goal set to ${val}`, 'success');
  } catch (e) {
    showToast('Failed to update goal', 'error');
  }
};

// ─── Export CSV ───────────────────────────────────────────
window.exportCSV = async function() {
  const entries = await API.get('/api/entries?limit=9999');
  if (!entries?.length) { showToast('No data to export', 'error'); return; }

  const allKeys = new Set(['date','water_bottles','self_improvement','happiness','stress',
    'coffee','alcohol','stretching','pushups_done','squats_done','notes']);
  state.customFields.forEach(f => allKeys.add(f.field_key));

  const headers = [...allKeys];
  const rows = entries.map(e => {
    const cd = e.custom_data || {};
    return headers.map(h => {
      const val = h in e ? e[h] : (cd[h] ?? '');
      const s = String(val ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    }).join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `health-tracker-${todayISO()}.csv`;
  a.click();
  showToast('CSV downloaded', 'success');
};

// ─── Tab Navigation ───────────────────────────────────────
function switchTab(tabName) {
  document.querySelectorAll('.tab-panel').forEach(p => {
    const active = p.id === `tab-${tabName}`;
    p.classList.toggle('active', active);
    p.hidden = !active;
  });
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabName);
    b.setAttribute('aria-selected', b.dataset.tab === tabName);
  });
  if (tabName === 'history') loadHistory();
}

// ─── Utility ──────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Init ─────────────────────────────────────────────────
async function init() {
  loadTheme();
  setHeaderDate();

  try {
    await Promise.all([loadGoals(), loadCustomFields()]);
    await loadTodayEntry();
    // Re-render custom inputs after todayEntry is loaded
    renderCustomFieldInputs();
  } catch (e) {
    console.error('Init error:', e);
  }

  setupSteppers();
  setupSliders();
  setupEventListeners();

  // Hide loading, show app
  $('loading-screen').style.display = 'none';
  $('app').removeAttribute('hidden');
}

function setupEventListeners() {
  // Theme
  $('theme-toggle').addEventListener('click', toggleTheme);

  // Bottom nav
  document.querySelectorAll('.nav-btn').forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  );

  // Form submit
  $('entry-form').addEventListener('submit', submitEntry);

  // Exercise inputs live feedback
  ['pushups', 'squats'].forEach(ex => {
    const inp = $(ex);
    if (!inp) return;
    inp.addEventListener('input', () => {
      updateExerciseFeedback(ex, +inp.value || 0);
      // Update complete button state
      const btn = document.querySelector(`.complete-btn[data-exercise="${ex}"]`);
      if (btn) {
        const goal = state.goals[ex]?.current_goal || 0;
        btn.classList.toggle('done', +inp.value >= goal && +inp.value > 0);
      }
    });
  });

  // Complete (hit goal) buttons
  document.querySelectorAll('.complete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const ex   = btn.dataset.exercise;
      const goal = state.goals[ex]?.current_goal || 0;
      if (!goal) return;
      const inp  = $(ex);
      inp.value  = goal;
      btn.classList.add('done');
      updateExerciseFeedback(ex, goal);
    });
  });

  // Modal close
  $('modal-close').addEventListener('click', closeModal);
  $('modal-overlay').addEventListener('click', e => {
    if (e.target === $('modal-overlay')) closeModal();
  });

  // Settings: custom field panel
  $('add-field-btn').addEventListener('click', () => {
    const form = $('add-field-form');
    form.style.display = form.style.display === 'none' ? '' : 'none';
    if (form.style.display !== 'none') $('new-field-name').focus();
  });
  $('save-field-btn').addEventListener('click',   addCustomField);
  $('cancel-field-btn').addEventListener('click', () => { $('add-field-form').style.display = 'none'; });
  $('new-field-name').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addCustomField(); } });

  // Keyboard shortcut: Esc to close modal
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });
}

// ─── Boot ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
