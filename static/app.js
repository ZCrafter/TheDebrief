/* ═══════════════════════════════════════════════════════════
   The Debrief — app.js  v3
═══════════════════════════════════════════════════════════ */
'use strict';

// ─── State ────────────────────────────────────────────────
const state = {
  exercises:      [],   // all rows from exercise_goals
  customFields:   [],
  groupSettings:  {},   // { groupName: { color, collapsed_by_default } }
  todayEntry:     null,
  editingDate:    null,
  historyLoaded:  false,
  historyEntries: [],
  stats:          null,
  // per-session collapse overrides (toggle vs default)
  collapseState:  {},
};

// ─── Helpers ──────────────────────────────────────────────
const $ = id => document.getElementById(id);
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const escHtml = s => String(s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fmtDate = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-US',
  { weekday:'short', month:'short', day:'numeric', year:'numeric' });
const toTitle = s => s.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());

// ─── API ──────────────────────────────────────────────────
const API = {
  async get(p)      { const r=await fetch(p); if(r.status===404)return null; if(!r.ok)throw new Error(await r.text()); return r.json(); },
  async post(p,b)   { const r=await fetch(p,{method:'POST',  headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}); if(!r.ok)throw new Error(await r.text()); return r.json(); },
  async put(p,b)    { const r=await fetch(p,{method:'PUT',   headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}); if(!r.ok)throw new Error(await r.text()); return r.json(); },
  async del(p)      { const r=await fetch(p,{method:'DELETE'}); if(!r.ok)throw new Error(await r.text()); return r.json(); },
};

// ─── Toast ────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type='') {
  const el = $('toast');
  clearTimeout(toastTimer);
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' '+type : '');
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

// ─── Theme ────────────────────────────────────────────────
function loadTheme() {
  document.documentElement.setAttribute('data-theme', localStorage.getItem('ht_theme') || 'dark');
}
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('ht_theme', next);
}

// ─── Header Date ──────────────────────────────────────────
function setHeaderDate() {
  const el = $('app-date');
  if (el) el.textContent = new Date().toLocaleDateString('en-US',
    { weekday:'long', month:'long', day:'numeric' });
}

// ─── Color helpers ────────────────────────────────────────
const COLOR_OPTIONS = ['water','mindset','energy','wellness','health','custom','warning','neutral'];
function accentForColor(color) { return color || 'custom'; }

// ─── Group Settings ───────────────────────────────────────
async function loadGroupSettings() {
  const rows = await API.get('/api/group-settings') || [];
  state.groupSettings = {};
  rows.forEach(r => { state.groupSettings[r.group_name] = r; });
}

function getGroupSetting(name) {
  return state.groupSettings[name] || { color: 'custom', collapsed_by_default: 0 };
}

async function saveGroupSetting(group_name, color, collapsed_by_default) {
  const result = await API.put('/api/group-settings', { group_name, color, collapsed_by_default });
  state.groupSettings[group_name] = result;
}

// ─── Exercises ────────────────────────────────────────────
async function loadExercises() {
  const rows = await API.get('/api/goals') || [];
  state.exercises = rows;
}

function renderGoalBanner() {
  const banner = $('goal-banner');
  if (!banner) return;
  if (!state.exercises.length) { banner.innerHTML = ''; return; }

  banner.innerHTML = state.exercises.map((ex, i) => `
    ${i > 0 ? '<div class="goal-divider"></div>' : ''}
    <div class="goal-card">
      <div class="goal-label">${escHtml(ex.display_name || ex.exercise).toUpperCase()}</div>
      <div class="goal-value" id="goal-val-${ex.exercise}">${ex.current_goal}</div>
      <div class="goal-streak" id="goal-streak-${ex.exercise}">${
        ex.consecutive_hits ? `🔥 ${ex.consecutive_hits} in a row` : (ex.total_hits ? `${ex.total_hits} total hits` : '')
      }</div>
    </div>
  `).join('');
}

function renderExerciseInputs() {
  const container = $('exercise-inputs');
  if (!container) return;

  container.innerHTML = state.exercises.map(ex => `
    <div class="exercise-field" id="exfield-${ex.exercise}">
      <div class="exercise-header">
        <label class="field-label">${escHtml(ex.display_name || ex.exercise)}</label>
        <span class="exercise-goal-badge" id="badge-${ex.exercise}">Goal: ${ex.current_goal}</span>
      </div>
      <div class="exercise-input-row">
        <input type="number" id="ex-${ex.exercise}" data-exercise="${ex.exercise}" data-datakey="${ex.data_key}"
               min="0" max="9999" value="0" class="num-input" placeholder="0" />
        <button type="button" class="complete-btn" data-exercise="${ex.exercise}">✓ Hit Goal</button>
        <div class="exercise-feedback" id="exfb-${ex.exercise}"></div>
      </div>
      <div class="progress-track"><div class="progress-fill" id="exprog-${ex.exercise}" style="width:0%"></div></div>
      <div class="projected-goal" id="exproj-${ex.exercise}"></div>
    </div>
  `).join('');

  // Wire inputs
  state.exercises.forEach(ex => {
    const inp = $(`ex-${ex.exercise}`);
    if (!inp) return;
    inp.addEventListener('input', () => {
      updateExerciseFeedback(ex.exercise, +inp.value || 0);
      const btn = document.querySelector(`.complete-btn[data-exercise="${ex.exercise}"]`);
      if (btn) btn.classList.toggle('done', +inp.value >= ex.current_goal && +inp.value > 0);
    });
  });

  // Wire complete buttons
  container.querySelectorAll('.complete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const ex   = state.exercises.find(e => e.exercise === btn.dataset.exercise);
      const goal = ex?.current_goal || 0;
      if (!goal) return;
      const inp  = $(`ex-${btn.dataset.exercise}`);
      inp.value  = goal;
      btn.classList.add('done');
      updateExerciseFeedback(btn.dataset.exercise, goal);
    });
  });
}

function updateExerciseFeedback(exerciseKey, done) {
  const ex       = state.exercises.find(e => e.exercise === exerciseKey);
  const goal     = ex?.current_goal || 0;
  const consec   = ex?.consecutive_hits || 0;
  const feedback = $(`exfb-${exerciseKey}`);
  const progress = $(`exprog-${exerciseKey}`);
  const projected= $(`exproj-${exerciseKey}`);
  if (!feedback || !goal) return;

  const pct = Math.min(100, Math.round((done / goal) * 100));
  progress.style.width = pct + '%';
  progress.classList.toggle('hit', done >= goal);

  if (done === 0) {
    feedback.textContent = '';
    feedback.className   = 'exercise-feedback';
    projected.textContent= '';
    return;
  }

  const nextGoal = projectedGoal(goal, done, consec);
  if (done >= goal) {
    feedback.textContent = `✓ Goal hit!`;
    feedback.className   = 'exercise-feedback hit';
    projected.textContent= `Tomorrow's goal: ${nextGoal}`;
  } else {
    feedback.textContent = `${goal - done} short — goal stays at ${goal}`;
    feedback.className   = 'exercise-feedback miss';
    projected.textContent= `Tomorrow's goal: ${nextGoal}`;
  }
}

function projectedGoal(currentGoal, done, consec) {
  if (done >= currentGoal) {
    const nc  = consec + 1;
    const pct = nc >= 5 ? 0.10 : nc >= 3 ? 0.07 : 0.05;
    return currentGoal + Math.max(1, Math.ceil(currentGoal * pct));
  }
  return currentGoal; // never goes down
}

function renderSettingsExercises() {
  const list = $('custom-exercise-list');
  if (!list) return;
  const custom = state.exercises.filter(e => !e.is_builtin);
  if (!custom.length) {
    list.innerHTML = '<p class="empty-note">No custom exercises yet.</p>';
    return;
  }
  list.innerHTML = custom.map(ex => `
    <div class="exercise-list-item">
      <span class="eli-name">${escHtml(ex.display_name)}</span>
      <span class="eli-goal">Goal: ${ex.current_goal}</span>
      <button class="chip-delete" data-key="${ex.exercise}" title="Remove">✕</button>
    </div>
  `).join('');
  list.querySelectorAll('.chip-delete').forEach(btn =>
    btn.addEventListener('click', () => deleteExercise(btn.dataset.key))
  );
}

async function addExercise() {
  const name = $('new-exercise-name').value.trim();
  const goal = +$('new-exercise-goal').value || 10;
  if (!name) { showToast('Enter an exercise name', 'error'); return; }
  try {
    await API.post('/api/exercises', { display_name: name, starting_goal: goal });
    $('new-exercise-name').value = '';
    $('new-exercise-goal').value = '10';
    $('add-exercise-form').style.display = 'none';
    await loadExercises();
    renderGoalBanner();
    renderExerciseInputs();
    renderSettingsExercises();
    renderGoalOverrides();
    showToast(`${name} added`, 'success');
  } catch(e) { showToast('Failed to add exercise', 'error'); }
}

async function deleteExercise(key) {
  if (!confirm('Remove this exercise?')) return;
  try {
    await API.del(`/api/exercises/${key}`);
    await loadExercises();
    renderGoalBanner();
    renderExerciseInputs();
    renderSettingsExercises();
    renderGoalOverrides();
    showToast('Exercise removed');
  } catch(e) { showToast('Cannot delete built-in exercise', 'error'); }
}

function renderGoalOverrides() {
  const list = $('goal-override-list');
  if (!list) return;
  list.innerHTML = state.exercises.map(ex => `
    <div class="field-row">
      <label class="field-label">${escHtml(ex.display_name || ex.exercise)}</label>
      <div class="goal-override-row">
        <input type="number" id="override-${ex.exercise}" class="num-input small" min="1" max="9999" placeholder="${ex.current_goal}" />
        <button type="button" class="pill-btn" onclick="applyGoalOverride('${ex.exercise}')">Set</button>
      </div>
    </div>
  `).join('');
}

window.applyGoalOverride = async function(exercise) {
  const inp = $(`override-${exercise}`);
  const val = +inp.value;
  if (!val || val < 1) { showToast('Enter a valid goal', 'error'); return; }
  try {
    await API.put('/api/goals/override', { exercise, new_goal: val });
    await loadExercises();
    renderGoalBanner();
    renderExerciseInputs();
    renderGoalOverrides();
    inp.value = '';
    showToast(`Goal set to ${val}`, 'success');
  } catch(e) { showToast('Failed to update goal', 'error'); }
};

// ─── Custom Fields ────────────────────────────────────────

// Maps group name → the extra-fields slot id inside a built-in section
const BUILTIN_GROUP_SLOTS = {
  'Hydration & Intake': 'extra-fields-hydration',
  'Mindset':            'extra-fields-mindset',
  'Health':             'extra-fields-health',
  'Movement':           'extra-fields-movement',
  'Notes':              'extra-fields-notes',
};

async function loadCustomFields() {
  state.customFields = await API.get('/api/custom-fields') || [];
  renderCustomFieldInputs();
  renderCustomFieldsList();
  renderGroupSettingsUI();
}

function renderCustomFieldInputs() {
  // Clear all built-in slots first
  Object.values(BUILTIN_GROUP_SLOTS).forEach(slotId => {
    const el = $(slotId);
    if (el) el.innerHTML = '';
  });

  const container = $('custom-fields-container');
  if (container) container.innerHTML = '';
  if (!state.customFields.length) return;

  // Split fields: built-in-slot fields vs standalone custom-group fields
  const builtinFields = {};   // slotId → [fields]
  const customGroups  = {};   // groupName → [fields]

  state.customFields.forEach(f => {
    const g      = f.group_name || 'Custom';
    const slotId = BUILTIN_GROUP_SLOTS[g];
    if (slotId) {
      if (!builtinFields[slotId]) builtinFields[slotId] = [];
      builtinFields[slotId].push(f);
    } else {
      if (!customGroups[g]) customGroups[g] = [];
      customGroups[g].push(f);
    }
  });

  // ── Inject into built-in section slots ──
  Object.entries(builtinFields).forEach(([slotId, fields]) => {
    const slot = $(slotId);
    if (!slot) return;
    slot.innerHTML = fields.map(f => {
      const savedVal = state.todayEntry?.custom_data?.[f.field_key];
      return `<div class="custom-input-row" data-key="${f.field_key}">
        <label class="field-label">${escHtml(f.name)}${f.unit ? ` <span class="field-unit">${escHtml(f.unit)}</span>` : ''}</label>
        ${buildCustomInput(f, savedVal)}
      </div>`;
    }).join('');
    wireSlot(slot);
  });

  // ── Render standalone custom groups ──
  if (!container || !Object.keys(customGroups).length) return;

  const iconMap = { 'Sleep':'🌙','Nutrition':'🥗','Custom':'✦' };

  container.innerHTML = Object.entries(customGroups).map(([groupName, fields]) => {
    const gs      = getGroupSetting(groupName);
    const accent  = accentForColor(gs.color);
    const icon    = iconMap[groupName] || '✦';
    const isCollapsedDefault = !!gs.collapsed_by_default;
    const isCollapsed = state.collapseState[groupName] !== undefined
      ? state.collapseState[groupName]
      : isCollapsedDefault;

    return `<div class="form-section ${isCollapsed ? 'collapsed' : ''}" data-accent="${accent}" data-group="${escHtml(groupName)}" style="margin-top:.75rem">
      <div class="section-header collapsible" data-group="${escHtml(groupName)}">
        <span class="section-icon">${icon}</span>
        <span class="section-title">${escHtml(groupName)}</span>
        <svg class="collapse-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="collapsible-body">
        ${fields.map(f => {
          const savedVal = state.todayEntry?.custom_data?.[f.field_key];
          return `<div class="custom-input-row" data-key="${f.field_key}">
            <label class="field-label">${escHtml(f.name)}${f.unit ? ` <span class="field-unit">${escHtml(f.unit)}</span>` : ''}</label>
            ${buildCustomInput(f, savedVal)}
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');

  // Wire collapse toggles
  container.querySelectorAll('.section-header.collapsible').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const section = hdr.closest('.form-section');
      const gname   = hdr.dataset.group;
      const nowCollapsed = !section.classList.contains('collapsed');
      section.classList.toggle('collapsed', nowCollapsed);
      state.collapseState[gname] = nowCollapsed;
    });
  });

  wireSlot(container);
}

// Wire up rating stars and custom steppers inside any container
function wireSlot(container) {
  state.customFields.forEach(f => {
    if (f.field_type === 'rating') {
      const row = container.querySelector(`.rating-stars[data-custom-key="${f.field_key}"]`);
      if (row) wireRatingStars(row, state.todayEntry?.custom_data?.[f.field_key] || 0);
    }
  });
  container.querySelectorAll('.stepper:not([data-wired])').forEach(stepper => {
    stepper.setAttribute('data-wired','1');
    initStepper(stepper);
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
    default:
      return `<div class="stepper" data-field="${f.field_key}" data-step="1" data-min="0" data-max="9999">
        <button type="button" class="step-btn step-down">−</button>
        <span class="step-value">${v || 0}</span>
        <button type="button" class="step-btn step-up">+</button>
      </div>`;
  }
}

function wireRatingStars(container, initial) {
  let current = initial || 0;
  const btns  = container.querySelectorAll('.star-btn');
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
    list.innerHTML = '<p class="empty-note">No custom fields yet.</p>';
    return;
  }
  list.innerHTML = state.customFields.map(f => `
    <div class="custom-field-chip">
      <div class="chip-info">
        <span class="chip-name">${escHtml(f.name)}${f.unit ? ` <span class="field-unit">${escHtml(f.unit)}</span>` : ''}</span>
        <span class="chip-meta">${f.field_type} · ${escHtml(f.group_name || 'Custom')}</span>
      </div>
      <div style="display:flex;gap:.35rem;flex-shrink:0">
        <button class="chip-delete" style="color:var(--accent);font-size:.75rem;padding:0 .4rem" data-id="${f.id}" title="Edit" data-action="edit">✎</button>
        <button class="chip-delete" data-id="${f.id}" data-action="delete" title="Remove">✕</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-action="delete"]').forEach(btn =>
    btn.addEventListener('click', () => deleteCustomField(+btn.dataset.id))
  );
  list.querySelectorAll('[data-action="edit"]').forEach(btn =>
    btn.addEventListener('click', () => openEditFieldModal(+btn.dataset.id))
  );
}

function renderGroupSettingsUI() {
  const container = $('group-settings-list');
  if (!container) return;

  // Only show standalone custom groups (built-in sections handle their own styling)
  const groupNames = [...new Set(
    state.customFields
      .map(f => f.group_name || 'Custom')
      .filter(g => !BUILTIN_GROUP_SLOTS[g])
  )];

  if (!groupNames.length) {
    container.innerHTML = '<p class="empty-note">Add custom fields to a non-built-in group to customise it here.</p>';
    return;
  }

  container.innerHTML = groupNames.map(gname => {
    const gs        = getGroupSetting(gname);
    const color     = gs.color || 'custom';
    const collapsed = !!gs.collapsed_by_default;
    return `<div class="group-setting-card" data-group="${escHtml(gname)}">
      <div class="gsc-top">
        <span class="gsc-name">${escHtml(gname)}</span>
        <label class="gsc-collapsed-toggle">
          <input type="checkbox" class="gsc-collapse-cb" data-group="${escHtml(gname)}" ${collapsed ? 'checked' : ''} />
          Collapsed by default
        </label>
      </div>
      <div class="color-swatches">
        ${COLOR_OPTIONS.map(c => `
          <div class="color-swatch swatch-${c} ${color === c ? 'active' : ''}"
               data-group="${escHtml(gname)}" data-color="${c}" title="${c}"></div>
        `).join('')}
      </div>
    </div>`;
  }).join('');

  // Wire color swatches — with error handling
  container.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', async () => {
      const gname = sw.dataset.group;
      const color = sw.dataset.color;
      const card  = container.querySelector(`.group-setting-card[data-group="${gname}"]`);
      const cb    = card?.querySelector('.gsc-collapse-cb');
      // Optimistic UI update
      card?.querySelectorAll('.color-swatch').forEach(s => s.classList.toggle('active', s.dataset.color === color));
      try {
        await saveGroupSetting(gname, color, cb?.checked || false);
        renderCustomFieldInputs();
        showToast(`${gname} color updated`, 'success');
      } catch(e) {
        showToast('Failed to save color — check server logs', 'error');
        renderGroupSettingsUI(); // revert optimistic update
      }
    });
  });

  // Wire collapse checkboxes — with error handling
  container.querySelectorAll('.gsc-collapse-cb').forEach(cb => {
    cb.addEventListener('change', async () => {
      const gname      = cb.dataset.group;
      const card       = container.querySelector(`.group-setting-card[data-group="${gname}"]`);
      const activeSwatch = card?.querySelector('.color-swatch.active');
      const color      = activeSwatch?.dataset.color || 'custom';
      try {
        await saveGroupSetting(gname, color, cb.checked);
        showToast(`${gname} will ${cb.checked ? 'start collapsed' : 'start expanded'}`, 'success');
      } catch(e) {
        cb.checked = !cb.checked; // revert checkbox
        showToast('Failed to save setting — check server logs', 'error');
      }
    });
  });
}

async function addCustomField() {
  const name  = $('new-field-name').value.trim();
  const type  = $('new-field-type').value;
  const unit  = $('new-field-unit').value.trim();
  const group = $('new-field-group').value.trim() || 'Custom';
  if (!name) { showToast('Enter a field name', 'error'); return; }
  try {
    await API.post('/api/custom-fields', { name, field_type: type, unit, group_name: group });
    $('new-field-name').value = $('new-field-unit').value = $('new-field-group').value = '';
    $('add-field-form').style.display = 'none';
    await loadCustomFields();
    showToast(`"${name}" added to ${group}`, 'success');
  } catch(e) { showToast('Failed to add field', 'error'); }
}

async function deleteCustomField(id) {
  if (!confirm('Remove this custom field?')) return;
  await API.del(`/api/custom-fields/${id}`);
  await loadCustomFields();
  showToast('Field removed');
}

function openEditFieldModal(id) {
  const field = state.customFields.find(f => f.id === id);
  if (!field) return;
  $('edit-field-id').value    = id;
  $('edit-field-name').value  = field.name;
  $('edit-field-unit').value  = field.unit || '';
  $('edit-field-group').value = field.group_name || 'Custom';
  $('edit-field-modal').removeAttribute('hidden');
  document.body.style.overflow = 'hidden';
}

async function saveEditField() {
  const id    = +$('edit-field-id').value;
  const name  = $('edit-field-name').value.trim();
  const unit  = $('edit-field-unit').value.trim();
  const group = $('edit-field-group').value.trim() || 'Custom';
  if (!name) { showToast('Name required', 'error'); return; }
  try {
    await API.put(`/api/custom-fields/${id}`, { name, unit, group_name: group });
    $('edit-field-modal').setAttribute('hidden', '');
    document.body.style.overflow = '';
    await loadCustomFields();
    showToast('Field updated', 'success');
  } catch(e) { showToast('Failed to update field', 'error'); }
}

// ─── Load Today's Entry ───────────────────────────────────
async function loadTodayEntry() {
  state.todayEntry = await API.get(`/api/entries/date/${todayISO()}`);
  if (state.todayEntry) populateForm(state.todayEntry);
}

function populateForm(entry) {
  setStepperValue('water_bottles', entry.water_bottles ?? 0);
  setStepperValue('coffee',        entry.coffee        ?? 0);
  setStepperValue('alcohol',       entry.alcohol       ?? 0);

  ['happiness','stress'].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.value = entry[id] ?? 3;
    $(`${id}-val`).textContent   = el.value;
    $(`${id}-label`).textContent = getMoodLabel(id, +el.value);
    updateSliderFill(el);
  });

  const hn = $('health-notes');
  if (hn) hn.value = entry.health_notes || '';

  const stretch = $('stretching');
  if (stretch) stretch.checked = !!entry.stretching;

  // Exercises
  state.exercises.forEach(ex => {
    const inp = $(`ex-${ex.exercise}`);
    if (!inp) return;
    const done = ex.is_builtin
      ? (entry[ex.data_key] ?? 0)
      : (entry.custom_data?.[ex.data_key] ?? 0);
    inp.value = done;
    updateExerciseFeedback(ex.exercise, done);
    const btn = document.querySelector(`.complete-btn[data-exercise="${ex.exercise}"]`);
    if (btn) btn.classList.toggle('done', done >= ex.current_goal && done > 0);
  });

  const notes = $('notes');
  if (notes) notes.value = entry.notes || '';

  $('last-saved-note').textContent = `Last saved: ${fmtDate(entry.date)}`;
  $('submit-btn').querySelector('.submit-text').textContent = 'Update Today\'s Entry';

  // Re-render custom fields with saved values
  renderCustomFieldInputs();
}

// ─── Steppers ─────────────────────────────────────────────
function initStepper(stepper) {
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
}

function setupSteppers() {
  document.querySelectorAll('.stepper:not([data-wired])').forEach(s => {
    s.setAttribute('data-wired','1');
    initStepper(s);
  });
}

function setStepperValue(field, val) {
  document.querySelectorAll(`[data-field="${field}"]`).forEach(s => {
    s._value = val;
    const sp = s.querySelector('.step-value');
    if (sp) sp.textContent = Math.round(val);
  });
}

// ─── Sliders ──────────────────────────────────────────────
const HAPPINESS_LABELS = { 1:'Rough day', 2:'Below average', 3:'Average', 4:'Pretty good', 5:'Fantastic!' };
const STRESS_LABELS    = { 1:'Very calm',  2:'Mostly calm',  3:'Average', 4:'Quite stressed', 5:'Overwhelmed' };
const getMoodLabel = (id, v) => id === 'happiness' ? (HAPPINESS_LABELS[v]||'') : (STRESS_LABELS[v]||'');

function updateSliderFill(el) {
  const pct = ((+el.value - +el.min) / (+el.max - +el.min)) * 100;
  el.style.background = `linear-gradient(to right, var(--section-accent, var(--accent)) ${pct}%, var(--surface-3) ${pct}%)`;
}

function setupSliders() {
  [['happiness','happiness-val','happiness-label'],['stress','stress-val','stress-label']].forEach(([id,valId,lblId]) => {
    const el = $(id);
    if (!el) return;
    updateSliderFill(el);
    $( lblId).textContent = getMoodLabel(id, +el.value);
    el.addEventListener('input', () => {
      $(valId).textContent = el.value;
      $(lblId).textContent = getMoodLabel(id, +el.value);
      updateSliderFill(el);
    });
  });
}

// ─── Collect Form Data ────────────────────────────────────
function collectFormData() {
  const getStepVal = field => {
    const el = document.querySelector(`[data-field="${field}"]`);
    return el ? (el._value || 0) : 0;
  };

  const custom_data = {};

  // Custom (non-exercise) fields
  state.customFields.forEach(f => {
    const key = f.field_key;
    if (f.field_type === 'boolean') {
      const cb = document.querySelector(`[data-custom-key="${key}"]`);
      custom_data[key] = cb ? cb.checked : false;
    } else if (f.field_type === 'rating') {
      const s = document.querySelector(`.rating-stars[data-custom-key="${key}"]`);
      custom_data[key] = s ? +s.dataset.rating : 0;
    } else if (f.field_type === 'text') {
      const i = document.querySelector(`[data-custom-key="${key}"]`);
      custom_data[key] = i ? i.value.trim() : '';
    } else {
      custom_data[key] = getStepVal(key);
    }
  });

  // Custom exercise values
  state.exercises.filter(e => !e.is_builtin).forEach(ex => {
    const inp = $(`ex-${ex.exercise}`);
    custom_data[ex.data_key] = inp ? (+inp.value || 0) : 0;
  });

  // Built-in exercise values
  const pushupsInp = $('ex-pushups');
  const squatsInp  = $('ex-squats');

  return {
    date:          state.editingDate || todayISO(),
    water_bottles: getStepVal('water_bottles'),
    health_notes:  ($('health-notes')?.value || '').trim(),
    happiness:     +($('happiness')?.value || 3),
    stress:        +($('stress')?.value    || 3),
    coffee:        getStepVal('coffee'),
    alcohol:       getStepVal('alcohol'),
    stretching:    $('stretching')?.checked || false,
    pushups_done:  pushupsInp ? (+pushupsInp.value || 0) : 0,
    squats_done:   squatsInp  ? (+squatsInp.value  || 0) : 0,
    notes:         ($('notes')?.value || '').trim(),
    custom_data,
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

    // Sync updated goals into state
    if (result.goal_updates) {
      Object.entries(result.goal_updates).forEach(([key, upd]) => {
        const ex = state.exercises.find(e => e.exercise === key);
        if (ex) {
          ex.current_goal     = upd.new_goal;
          ex.consecutive_hits = upd.consecutive_hits;
        }
      });
      renderGoalBanner();
      state.exercises.forEach(ex => {
        const inp = $(`ex-${ex.exercise}`);
        if (inp) updateExerciseFeedback(ex.exercise, +inp.value || 0);
      });
    }

    // Clear editing mode
    if (state.editingDate) {
      state.editingDate = null;
      $('edit-banner').style.display = 'none';
    }

    $('last-saved-note').textContent = 'Saved just now ✓';

    // Green flash
    btn.classList.add('saved');
    btn.querySelector('.submit-text').textContent = '✓ Saved!';
    setTimeout(() => {
      btn.classList.remove('saved');
      btn.querySelector('.submit-text').textContent = 'Update Today\'s Entry';
    }, 2000);

    resetFormToDefaults();
    state.historyLoaded = false;
    destroyCharts();

    const gu   = result.goal_updates || {};
    const msgs = Object.entries(gu)
      .filter(([,u]) => u.hit)
      .map(([k, u]) => {
        const ex = state.exercises.find(e => e.exercise === k);
        return `🎯 ${ex?.display_name || k} → ${u.new_goal} tomorrow`;
      });
    showToast(msgs.length ? msgs.join(' · ') : '✓ Entry saved!', 'success');

  } catch(err) {
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
  setStepperValue('water_bottles', 0);
  setStepperValue('coffee', 0);
  setStepperValue('alcohol', 0);

  ['happiness','stress'].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.value = 3;
    $(`${id}-val`).textContent   = '3';
    $(`${id}-label`).textContent = getMoodLabel(id, 3);
    updateSliderFill(el);
  });

  const hn = $('health-notes');
  if (hn) hn.value = '';

  const stretch = $('stretching');
  if (stretch) stretch.checked = false;

  state.exercises.forEach(ex => {
    const inp = $(`ex-${ex.exercise}`);
    if (!inp) return;
    inp.value = 0;
    updateExerciseFeedback(ex.exercise, 0);
    const btn = document.querySelector(`.complete-btn[data-exercise="${ex.exercise}"]`);
    if (btn) btn.classList.remove('done');
  });

  const notes = $('notes');
  if (notes) notes.value = '';

  const saved = state.todayEntry;
  state.todayEntry = null;
  renderCustomFieldInputs();
  state.todayEntry = saved;
}

// ─── Charts ───────────────────────────────────────────────
const chartInstances = {};
function destroyCharts() {
  Object.values(chartInstances).forEach(c => c.destroy());
  Object.keys(chartInstances).forEach(k => delete chartInstances[k]);
}

function renderCharts() {
  if (typeof Chart === 'undefined') return;
  const entries = [...state.historyEntries].reverse().slice(-60);
  if (!entries.length) return;
  destroyCharts();

  const labels = entries.map(e => {
    const d = new Date(e.date + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
  });

  const gridColor = 'rgba(148,163,184,0.08)';
  const tickStyle = { color:'#64748b', font:{ size:10, family:'Barlow' } };
  const legendStyle = { labels:{ color:'#64748b', font:{ family:'Barlow', size:11 }, boxWidth:10, padding:12 } };

  const baseOpts = (yMin, yMax) => ({
    responsive:true, maintainAspectRatio:false,
    animation:{ duration:400 },
    plugins:{ legend: legendStyle },
    scales:{
      x:{ ticks:{...tickStyle, maxRotation:45, autoSkip:true, maxTicksLimit:10}, grid:{ color:gridColor } },
      y:{ min:yMin, max:yMax, ticks:tickStyle, grid:{ color:gridColor } },
    },
  });

  const mood = $('chart-mood');
  if (mood) chartInstances['mood'] = new Chart(mood, {
    type:'line',
    data:{ labels, datasets:[
      { label:'Happiness', data:entries.map(e=>e.happiness), borderColor:'#34d399', backgroundColor:'rgba(52,211,153,0.08)', tension:.4, fill:true, pointRadius:3, pointBackgroundColor:'#34d399' },
      { label:'Stress',    data:entries.map(e=>e.stress),    borderColor:'#f87171', backgroundColor:'rgba(248,113,113,0.08)', tension:.4, fill:true, pointRadius:3, pointBackgroundColor:'#f87171' },
    ]},
    options: baseOpts(1,5),
  });

  const exercise = $('chart-exercise');
  if (exercise) {
    const colors = ['rgba(251,146,60,.75)','rgba(167,139,250,.75)','rgba(52,211,153,.75)','rgba(244,114,182,.75)','rgba(56,189,248,.75)'];
    chartInstances['exercise'] = new Chart(exercise, {
      type:'bar',
      data:{ labels, datasets: state.exercises.map((ex, i) => ({
        label: ex.display_name,
        data: entries.map(e => ex.is_builtin ? (e[ex.data_key]||0) : (e.custom_data?.[ex.data_key]||0)),
        backgroundColor: colors[i % colors.length],
        borderRadius:3,
      }))},
      options: baseOpts(0, undefined),
    });
  }

  const hyd = $('chart-hydration');
  if (hyd) chartInstances['hydration'] = new Chart(hyd, {
    type:'bar',
    data:{ labels, datasets:[
      { label:'Water',   data:entries.map(e=>e.water_bottles), backgroundColor:'rgba(56,189,248,.75)',  borderRadius:3 },
      { label:'Coffee',  data:entries.map(e=>e.coffee),         backgroundColor:'rgba(251,191,36,.75)',  borderRadius:3 },
      { label:'Alcohol', data:entries.map(e=>e.alcohol),        backgroundColor:'rgba(167,139,250,.75)', borderRadius:3 },
    ]},
    options: baseOpts(0, undefined),
  });
}

// ─── History ──────────────────────────────────────────────
async function loadHistory() {
  if (state.historyLoaded) return;
  const [entries, stats] = await Promise.all([
    API.get('/api/entries?limit=365'),
    API.get('/api/stats'),
  ]);
  state.historyEntries = entries || [];
  state.stats          = stats;
  state.historyLoaded  = true;
  renderHistory();
  renderStats();
  setTimeout(renderCharts, 50);
}

function renderStats() {
  const s = state.stats;
  if (!s) return;
  $('stat-streak-num').textContent   = s.streak_days    ?? '0';
  $('stat-entries-num').textContent  = s.total_entries  ?? '0';
  $('stat-happiness-num').textContent= s.last_7_days?.avg_happiness?.toFixed(1) ?? '—';
  $('stat-stress-num').textContent   = s.last_7_days?.avg_stress?.toFixed(1)    ?? '—';
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
    const mon  = d.toLocaleString('default',{ month:'short' }).toUpperCase();
    return `<div class="history-card" data-date="${e.date}">
      <div class="hc-date"><span class="hc-day">${day}</span><span class="hc-month">${mon}</span></div>
      <div class="hc-divider"></div>
      <div class="hc-stats">
        <div class="hc-stat"><span class="hc-stat-val">${e.happiness??'—'}/5</span><span class="hc-stat-lbl">Happy</span></div>
        <div class="hc-stat"><span class="hc-stat-val">${e.stress??'—'}/5</span><span class="hc-stat-lbl">Stress</span></div>
        <div class="hc-stat"><span class="hc-stat-val">${e.water_bottles||'—'}</span><span class="hc-stat-lbl">Water</span></div>
        <div class="hc-stat"><span class="hc-stat-val">${e.pushups_done||'—'}</span><span class="hc-stat-lbl">Pushups</span></div>
        <div class="hc-stat"><span class="hc-stat-val">${e.squats_done||'—'}</span><span class="hc-stat-lbl">Squats</span></div>
        <div class="hc-stat"><span class="hc-stat-val">${e.coffee||'—'}</span><span class="hc-stat-lbl">Coffee</span></div>
      </div>
      <svg class="hc-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </div>`;
  }).join('');

  list.querySelectorAll('.history-card').forEach(card =>
    card.addEventListener('click', () => openEntryModal(card.dataset.date))
  );
}

// ─── Entry Modal ──────────────────────────────────────────
async function openEntryModal(date) {
  const entry = await API.get(`/api/entries/date/${date}`);
  if (!entry) return;
  $('modal-title').textContent = fmtDate(date);
  $('modal-body').innerHTML    = buildModalBody(entry);
  $('modal-overlay').removeAttribute('hidden');
  document.body.style.overflow = 'hidden';
  $('modal-edit-btn')?.addEventListener('click', () => startEditingEntry(date, entry));
}

function buildModalBody(e) {
  const bool = v => v ? '✓ Yes' : '— No';
  let html = `<div class="detail-grid">
    <div class="detail-item"><div class="detail-label">Happiness</div><div class="detail-value">${e.happiness}/5</div></div>
    <div class="detail-item"><div class="detail-label">Stress</div><div class="detail-value">${e.stress}/5</div></div>
    <div class="detail-item"><div class="detail-label">Water</div><div class="detail-value">${e.water_bottles} btl</div></div>
    <div class="detail-item"><div class="detail-label">Coffee</div><div class="detail-value">${e.coffee} cups</div></div>
    <div class="detail-item"><div class="detail-label">Alcohol</div><div class="detail-value">${e.alcohol} drk</div></div>
    <div class="detail-item"><div class="detail-label">Stretching</div><div class="detail-value">${bool(e.stretching)}</div></div>`;

  state.exercises.forEach(ex => {
    const done = ex.is_builtin ? (e[ex.data_key]??0) : (e.custom_data?.[ex.data_key]??0);
    html += `<div class="detail-item"><div class="detail-label">${escHtml(ex.display_name)}</div><div class="detail-value">${done}</div></div>`;
  });

  const cd = e.custom_data || {};
  state.customFields.forEach(f => {
    const val = cd[f.field_key];
    if (val !== undefined && val !== '' && val !== 0 && val !== false) {
      html += `<div class="detail-item"><div class="detail-label">${escHtml(f.name)}</div><div class="detail-value">${escHtml(String(val))}${f.unit?' '+f.unit:''}</div></div>`;
    }
  });
  html += '</div>';

  if (e.health_notes) {
    html += `<div class="detail-label" style="margin-bottom:.4rem;margin-top:.5rem">Health notes:</div>
             <div class="detail-text">${escHtml(e.health_notes)}</div>`;
  }
  if (e.notes) {
    html += `<div class="detail-label" style="margin-bottom:.4rem;margin-top:.5rem">Notes:</div>
             <div class="detail-text">${escHtml(e.notes)}</div>`;
  }

  html += `<div style="margin-top:1rem">
    <button id="modal-edit-btn" class="submit-btn" style="height:44px;font-size:.85rem">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      <span class="submit-text">Edit This Entry</span>
    </button>
  </div>`;
  return html;
}

function closeModal(id='modal-overlay') {
  $(id).setAttribute('hidden','');
  document.body.style.overflow = '';
}

function startEditingEntry(date, entry) {
  closeModal();
  state.editingDate = date;
  $('edit-banner-date').textContent = fmtDate(date);
  $('edit-banner').style.display    = '';
  populateForm(entry);
  switchTab('today');
  $('tab-container').scrollTop = 0;
  $('submit-btn').querySelector('.submit-text').textContent = 'Save Changes';
}

window.cancelEdit = function() {
  state.editingDate = null;
  $('edit-banner').style.display = 'none';
  $('submit-btn').querySelector('.submit-text').textContent = 'Save Today\'s Entry';
  loadTodayEntry().then(() => {
    if (!state.todayEntry) resetFormToDefaults();
    renderCustomFieldInputs();
  });
};

// ─── Export CSV ───────────────────────────────────────────
window.exportCSV = async function() {
  const entries = await API.get('/api/entries?limit=9999');
  if (!entries?.length) { showToast('No data to export', 'error'); return; }

  const allKeys = ['date','water_bottles','health_notes','happiness','stress',
    'coffee','alcohol','stretching','pushups_done','squats_done','notes'];
  state.customFields.forEach(f => allKeys.push(f.field_key));

  const csv = [
    allKeys.join(','),
    ...entries.map(e => {
      const cd = e.custom_data || {};
      return allKeys.map(h => {
        const v = String((h in e ? e[h] : cd[h]) ?? '');
        return v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v.replace(/"/g,'""')}"` : v;
      }).join(',');
    }),
  ].join('\n');

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download = `debrief-${todayISO()}.csv`;
  a.click();
  showToast('CSV downloaded', 'success');
};

// ─── Tabs ─────────────────────────────────────────────────
function switchTab(tabName) {
  document.querySelectorAll('.tab-panel').forEach(p => {
    const on = p.id === `tab-${tabName}`;
    p.classList.toggle('active', on);
    p.hidden = !on;
  });
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabName);
  });
  if (tabName === 'history') loadHistory();
}

// ─── Event wiring ─────────────────────────────────────────
function setupEventListeners() {
  $('theme-toggle').addEventListener('click', toggleTheme);

  document.querySelectorAll('.nav-btn').forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  );

  $('entry-form').addEventListener('submit', submitEntry);

  // Modals
  $('modal-close').addEventListener('click', () => closeModal('modal-overlay'));
  $('modal-overlay').addEventListener('click', e => { if(e.target===$('modal-overlay')) closeModal('modal-overlay'); });
  $('edit-field-close').addEventListener('click', () => closeModal('edit-field-modal'));
  $('edit-field-modal').addEventListener('click', e => { if(e.target===$('edit-field-modal')) closeModal('edit-field-modal'); });
  $('edit-field-save').addEventListener('click', saveEditField);

  // Custom field panel
  $('add-field-btn').addEventListener('click', () => {
    const f = $('add-field-form');
    f.style.display = f.style.display === 'none' ? '' : 'none';
    if (f.style.display !== 'none') $('new-field-name').focus();
  });
  $('save-field-btn').addEventListener('click', addCustomField);
  $('cancel-field-btn').addEventListener('click', () => { $('add-field-form').style.display='none'; });
  $('new-field-name').addEventListener('keydown', e => { if(e.key==='Enter'){e.preventDefault();addCustomField();} });

  // Exercise panel
  $('add-exercise-btn').addEventListener('click', () => {
    const f = $('add-exercise-form');
    f.style.display = f.style.display === 'none' ? '' : 'none';
    if (f.style.display !== 'none') $('new-exercise-name').focus();
  });
  $('save-exercise-btn').addEventListener('click', addExercise);
  $('cancel-exercise-btn').addEventListener('click', () => { $('add-exercise-form').style.display='none'; });

  document.addEventListener('keydown', e => {
    if (e.key==='Escape') {
      closeModal('modal-overlay');
      closeModal('edit-field-modal');
    }
  });
}

// ─── Init ─────────────────────────────────────────────────
async function init() {
  loadTheme();
  setHeaderDate();

  try {
    await Promise.all([loadExercises(), loadGroupSettings()]);
    renderGoalBanner();
    renderExerciseInputs();
    renderGoalOverrides();
    renderSettingsExercises();

    await loadCustomFields();
    await loadTodayEntry();
    renderCustomFieldInputs();
  } catch(e) {
    console.error('Init error:', e);
  }

  setupSteppers();
  setupSliders();
  setupEventListeners();

  $('loading-screen').style.display = 'none';
  $('app').removeAttribute('hidden');
}

document.addEventListener('DOMContentLoaded', init);
