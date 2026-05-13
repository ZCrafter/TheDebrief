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
  historyLoaded: false,
  historyEntries: [],
  stats: null,
};

// ─── Helpers ──────────────────────────────────────────────
const $ = id => document.getElementById(id);
const todayISO = () => new Date().toISOString().slice(0, 10);

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
  const container = $('custom-fields-inputs');
  const section   = $('custom-fields-section');
  if (!container) return;

  if (!state.customFields.length) {
    section.style.display = 'none';
    container.innerHTML = '';
    return;
  }
  section.style.display = '';

  container.innerHTML = state.customFields.map(f => {
    const savedVal = state.todayEntry?.custom_data?.[f.field_key];
    return `<div class="custom-input-row" data-key="${f.field_key}">
      <label class="field-label">${f.name}${f.unit ? ` <span class="field-unit">${f.unit}</span>` : ''}</label>
      ${buildCustomInput(f, savedVal)}
    </div>`;
  }).join('');

  // Wire up boolean toggles & rating stars
  state.customFields.forEach(f => {
    if (f.field_type === 'boolean') {
      const cb = container.querySelector(`[data-key="${f.field_key}"] input[type="checkbox"]`);
      if (cb && state.todayEntry?.custom_data?.[f.field_key]) cb.checked = true;
    }
    if (f.field_type === 'rating') {
      const row = container.querySelector(`[data-key="${f.field_key}"] .rating-stars`);
      if (row) wireRatingStars(row, state.todayEntry?.custom_data?.[f.field_key] || 0);
    }
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
        <span class="chip-meta">${f.field_type}</span>
      </div>
      <button class="chip-delete" data-id="${f.id}" title="Remove field">✕</button>
    </div>
  `).join('');

  list.querySelectorAll('.chip-delete').forEach(btn =>
    btn.addEventListener('click', () => deleteCustomField(+btn.dataset.id))
  );
}

async function addCustomField() {
  const name = $('new-field-name').value.trim();
  const type = $('new-field-type').value;
  const unit = $('new-field-unit').value.trim();
  if (!name) { showToast('Enter a field name', 'error'); return; }

  try {
    await API.post('/api/custom-fields', { name, field_type: type, unit });
    $('new-field-name').value = '';
    $('new-field-unit').value = '';
    $('add-field-form').style.display = 'none';
    await loadCustomFields();
    showToast(`"${name}" added`, 'success');
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
  if (happinessEl) { happinessEl.value = entry.happiness; $('happiness-val').textContent = entry.happiness; updateSliderFill(happinessEl); }
  if (stressEl)    { stressEl.value    = entry.stress;    $('stress-val').textContent    = entry.stress;    updateSliderFill(stressEl); }

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

// ─── Sliders ──────────────────────────────────────────────
function updateSliderFill(el) {
  const pct = ((+el.value - +el.min) / (+el.max - +el.min)) * 100;
  el.style.background = `linear-gradient(to right, var(--section-accent, var(--accent)) ${pct}%, var(--surface-3) ${pct}%)`;
}

function setupSliders() {
  [['happiness', 'happiness-val'], ['stress', 'stress-val']].forEach(([id, valId]) => {
    const el = $(id);
    if (!el) return;
    updateSliderFill(el);
    el.addEventListener('input', () => {
      $(valId).textContent = el.value;
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
    date:             todayISO(),
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

    $('last-saved-note').textContent = 'Saved just now ✓';
    btn.querySelector('.submit-text').textContent = 'Update Today\'s Entry';

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

    // Invalidate history cache
    state.historyLoaded = false;

  } catch (err) {
    console.error(err);
    showToast('Error saving entry', 'error');
    btn.querySelector('.submit-text').textContent = 'Save Today\'s Entry';
  } finally {
    btn.disabled = false;
    btn.classList.remove('saving');
  }
}

// ─── History Tab ──────────────────────────────────────────
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
        <div class="hc-stat"><span class="hc-stat-val">${mood}/10</span><span class="hc-stat-lbl">Happy</span></div>
        <div class="hc-stat"><span class="hc-stat-val">${str}/10</span><span class="hc-stat-lbl">Stress</span></div>
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
  $('modal-overlay').removeAttribute('hidden');
  document.body.style.overflow = 'hidden';
}

function buildModalBody(e) {
  const boolIcon = v => v ? '✓ Yes' : '— No';
  let html = `<div class="detail-grid">
    <div class="detail-item"><div class="detail-label">Happiness</div><div class="detail-value">${e.happiness}/10</div></div>
    <div class="detail-item"><div class="detail-label">Stress</div><div class="detail-value">${e.stress}/10</div></div>
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
  return html;
}

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
