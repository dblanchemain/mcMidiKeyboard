// renderer.js — mcMidiKeyboard
// License: GPL-3.0-or-later — D.Blanchemain

// ── État global ──────────────────────────────────────────────────────────────
// Chaque ligne : { id, key (numéro MIDI 0-127 ou null), file, gain, fadeType, fadeIn, fadeOut }
let rows = [];
let nextId = 0;

// Id de la ligne en attente de MIDI Learn (null = pas en mode learn)
let midiLearnTarget = null;

// ── Mode banque ───────────────────────────────────────────────────────────────
let bankModeState = null;
// bankModeState : {
//   banks      : [{keys:[], nbCanaux, polyphonie}],
//   bankIdx    : 0,
//   activeSlot : 'a',
//   loadedIds  : { a: Set<id>, b: Set<id> },
//   activeKeyMap : Map<note, id>,
//   activeVoices : Set<id>,   // IDs dont la voix est encore active
// }

function mkKbId(slot, key) { return `kb_${slot}_${key}`; }


// ── Noms de notes MIDI ────────────────────────────────────────────────────────
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

function midiToName(n) {
  if (n === null || n === undefined || n === '') return '—';
  n = parseInt(n);
  if (isNaN(n) || n < 0 || n > 127) return '?';
  return NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1);
}

// ── Bouton rotatif ───────────────────────────────────────────────────────────
// Calibration absolue (CSS rotate) :
//   gain=-10 →   0°   gain=1 → 130°   gain=10 → 270°
const KNOB_MIN = -10;
const KNOB_MAX = 10;

function gainToDeg(gain) {
  if (gain <= 1) {
    return (gain + 10) / 11 * 130;          // 0° … 130°
  } else {
    return 130 + (gain - 1) / 9 * 140;     // 130° … 270°
  }
}

// ── Modal fade-in/out ────────────────────────────────────────────────────────
const fadeModal       = document.getElementById('fadeModal');
const modalFadeType   = document.getElementById('modalFadeType');
const modalFadeInVal  = document.getElementById('modalFadeInVal');
const modalFadeOutVal = document.getElementById('modalFadeOutVal');
const envCurve        = document.getElementById('envCurve');
const envHandleIn     = document.getElementById('envHandleIn');
const envHandleOut    = document.getElementById('envHandleOut');
const ENV_W = 300, ENV_H = 90;

let modalTargetId = null;  // id de la ligne en cours d'édition
let envInPos  = 0.2;       // 0–1 position relative fade-in
let envOutPos = 0.8;       // 0–1 position relative fade-out

function drawEnvelope() {
  const xIn  = envInPos  * ENV_W;
  const xOut = envOutPos * ENV_W;
  const type = modalFadeType.value;

  const pts = buildEnvelopePoints(xIn, xOut, ENV_W, ENV_H, type);
  envCurve.setAttribute('points', pts.map(([x, y]) => `${x},${y}`).join(' '));

  envHandleIn.style.left  = (xIn  - 3) + 'px';
  envHandleOut.style.left = (xOut - 3) + 'px';
}

function buildEnvelopePoints(xIn, xOut, W, H, type) {
  const pts = [];
  const steps = 60;
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * W;
    let amp;
    if (x <= xIn) {
      const t = xIn > 0 ? x / xIn : 1;
      amp = fadeShape(t, type);
    } else if (x >= xOut) {
      const t = xOut < W ? (x - xOut) / (W - xOut) : 0;
      amp = fadeShape(1 - t, type);
    } else {
      amp = 1;
    }
    pts.push([x, H - amp * H]);
  }
  return pts;
}

function fadeShape(t, type) {
  switch (type) {
    case 'q': return Math.sin((t * Math.PI) / 2);
    case 'h': return Math.sin(t * Math.PI);
    case 't': return t;
    case 'l': return t === 0 ? 0 : Math.log(1 + t * (Math.E - 1));
    case 'p': return 1 - Math.pow(1 - t, 2);
    default:  return t;
  }
}

modalFadeType.addEventListener('change', drawEnvelope);
modalFadeInVal.addEventListener('input', () => {
  const fi = parseFloat(modalFadeInVal.value) || 0;
  const fo = parseFloat(modalFadeOutVal.value) || 0;
  const total = fi + fo;
  if (total > 0) {
    envInPos  = Math.min(fi / (fi + fo + 0.001), 0.5);
    envOutPos = 1 - Math.min(fo / (fi + fo + 0.001), 0.5);
  }
  drawEnvelope();
});
modalFadeOutVal.addEventListener('input', () => {
  modalFadeInVal.dispatchEvent(new Event('input'));
});

// Drag handles
let draggingHandle = null;

function startDrag(e) {
  draggingHandle = e.currentTarget.dataset.handle;
  e.preventDefault();
}
envHandleIn.addEventListener('mousedown',  startDrag);
envHandleOut.addEventListener('mousedown', startDrag);

document.addEventListener('mousemove', (e) => {
  if (!draggingHandle) return;
  const rect = document.getElementById('envContainer').getBoundingClientRect();
  const x = Math.max(0, Math.min(e.clientX - rect.left, ENV_W));
  const norm = x / ENV_W;
  if (draggingHandle === 'in') {
    envInPos = Math.min(norm, envOutPos - 0.05);
  } else {
    envOutPos = Math.max(norm, envInPos + 0.05);
  }
  // Mettre à jour les champs numériques (valeurs en proportion, pas en secondes)
  modalFadeInVal.value  = envInPos.toFixed(2);
  modalFadeOutVal.value = (1 - envOutPos).toFixed(2);
  drawEnvelope();
});

document.addEventListener('mouseup', () => { draggingHandle = null; });

function openFadeModal(id) {
  modalTargetId = id;
  const row = rows.find(r => r.id === id);
  if (!row) return;
  modalFadeType.value    = row.fadeType;
  modalFadeInVal.value   = row.fadeIn;
  modalFadeOutVal.value  = row.fadeOut;
  // Recalculer les positions graphiques
  const fi = parseFloat(row.fadeIn)  || 0;
  const fo = parseFloat(row.fadeOut) || 0;
  const sum = fi + fo + 0.001;
  envInPos  = Math.min(fi / sum, 0.5);
  envOutPos = 1 - Math.min(fo / sum, 0.5);
  drawEnvelope();
  fadeModal.classList.remove('hidden');
}

document.getElementById('modalCancel').addEventListener('click', () => {
  fadeModal.classList.add('hidden');
  modalTargetId = null;
});

document.getElementById('modalOk').addEventListener('click', () => {
  if (modalTargetId === null) return;
  const row = rows.find(r => r.id === modalTargetId);
  if (row) {
    row.fadeType = modalFadeType.value;
    row.fadeIn   = parseFloat(modalFadeInVal.value)  || 0;
    row.fadeOut  = parseFloat(modalFadeOutVal.value) || 0;
    updateFadeCell(row);
    sendRowUpdate(row);
  }
  fadeModal.classList.add('hidden');
  modalTargetId = null;
});

// ── Tri des lignes par key ────────────────────────────────────────────────────

function sortRows() {
  rows.sort((a, b) => {
    if (a.key === null && b.key === null) return 0;
    if (a.key === null) return 1;
    if (b.key === null) return -1;
    return a.key - b.key;
  });
  const tbody = document.getElementById('tableBody');
  for (const row of rows) {
    const tr = document.querySelector(`tr[data-id="${row.id}"]`);
    if (tr) tbody.appendChild(tr);
  }
}

// ── Construction des lignes ──────────────────────────────────────────────────

function makeRow(data = {}) {
  const id = nextId++;
  const rawKey = data.key;
  const key = (rawKey !== undefined && rawKey !== null && rawKey !== '')
    ? parseInt(rawKey) : null;
  const rawCh = data.channel;
  const channel = (rawCh != null && rawCh !== '')
    ? Math.max(1, Math.min(16, parseInt(rawCh))) : null;
  const row = {
    id,
    key:      isNaN(key) ? null : key,
    channel:  isNaN(channel) ? null : channel,
    file:     data.file     ?? '',
    gain:     data.gain     != null ? data.gain : 1,
    fadeType:  data.fadeType ?? 'l',
    fadeIn:    data.fadeIn   ?? 0.1,
    fadeOut:   data.fadeOut  ?? 0.1,
    oneShot:   data.oneShot  ?? false,
    loadState: data.file ? 'loading' : 'idle',
  };
  rows.push(row);
  renderRow(row);
  sendRowUpdate(row);
  sortRows();
  return row;
}

function renderRow(row) {
  const tbody = document.getElementById('tableBody');
  const tr = document.createElement('tr');
  tr.dataset.id = row.id;

  tr.innerHTML = `
    <td class="key-cell">
      <div class="key-inner">
        <input type="number" min="0" max="127" step="1"
               placeholder="—" value="${row.key !== null ? row.key : ''}"
               data-id="${row.id}" class="key-input"/>
        <span class="key-name" data-id="${row.id}">${midiToName(row.key)}</span>
        <button class="learn-btn" data-id="${row.id}" title="MIDI Learn">L</button>
      </div>
    </td>
    <td class="ch-cell">
      <input type="number" min="1" max="16" step="1"
             placeholder="*" value="${row.channel !== null ? row.channel : ''}"
             data-id="${row.id}" class="ch-input" title="Canal MIDI (vide = tous)"/>
    </td>
    <td class="file-cell">
      <button class="pick-file" data-id="${row.id}">…</button>
      <span class="load-dot load-${row.loadState}" data-id="${row.id}" title=""></span>
      <span class="fname ${row.file ? 'set' : ''}" data-id="${row.id}" title="${escHtml(row.file)}">
        ${row.file ? baseName(row.file) : '(aucun)'}
      </span>
    </td>
    <td>
      <div class="knob-wrap" data-id="${row.id}">
        <img class="knob-img" src="images/button1c.svg" alt="gain"
             style="transform:rotate(${gainToDeg(row.gain)}deg)"
             draggable="false"/>
        <span class="knob-val">${Number(row.gain).toFixed(1)}</span>
      </div>
    </td>
    <td>
      <div class="fade-cell" data-id="${row.id}">
        <span class="fade-badge">${row.fadeType}</span>
        <button class="fade-btn" data-id="${row.id}">éditer</button>
      </div>
    </td>
    <td><span class="fadeInDisp" data-id="${row.id}">${Number(row.fadeIn).toFixed(2)}s</span></td>
    <td><span class="fadeOutDisp" data-id="${row.id}">${Number(row.fadeOut).toFixed(2)}s</span></td>
    <td class="mode-cell">
      <label class="mode-toggle" title="One-shot : joue jusqu'à la fin&#10;Sustain : s'arrête au Note Off">
        <input type="checkbox" class="oneshot-chk" data-id="${row.id}" ${row.oneShot ? 'checked' : ''}/>
        <span class="mode-label">${row.oneShot ? '1shot' : 'sust'}</span>
      </label>
    </td>
    <td><button class="del-btn" data-id="${row.id}" title="Supprimer">×</button></td>
  `;
  tbody.appendChild(tr);

  // Knob — drag vertical
  const knobImg = tr.querySelector('.knob-img');
  initKnob(knobImg, row);

  tr.querySelector('.pick-file').addEventListener('click', () => pickFile(row.id));
  tr.querySelector('.fade-btn').addEventListener('click', () => openFadeModal(row.id));
  tr.querySelector('.del-btn').addEventListener('click', () => deleteRow(row.id));
  tr.querySelector('.learn-btn').addEventListener('click', () => toggleLearn(row.id));

  tr.querySelector('.key-input').addEventListener('change', (e) => {
    const v = e.target.value.trim();
    row.key = v === '' ? null : Math.max(0, Math.min(127, parseInt(v) || 0));
    updateKeyName(row);
    sendRowUpdate(row);
    sortRows();
  });

  tr.querySelector('.ch-input').addEventListener('change', (e) => {
    const v = e.target.value.trim();
    row.channel = v === '' ? null : Math.max(1, Math.min(16, parseInt(v) || 1));
    sendRowUpdate(row);
  });

  tr.querySelector('.oneshot-chk').addEventListener('change', (e) => {
    row.oneShot = e.target.checked;
    e.target.nextElementSibling.textContent = row.oneShot ? '1shot' : 'sust';
    sendRowUpdate(row);
  });
}

// ── Knob (bouton rotatif) ────────────────────────────────────────────────────

function initKnob(img, row) {
  let startY = 0;
  let startGain = row.gain;

  img.addEventListener('mousedown', (e) => {
    startY    = e.clientY;
    startGain = row.gain;
    e.preventDefault();

    function onMove(e2) {
      const delta = (startY - e2.clientY) * 0.05;  // px → gain
      const newGain = Math.max(KNOB_MIN, Math.min(KNOB_MAX, startGain + delta));
      row.gain = Math.round(newGain * 10) / 10;
      updateKnob(row);
      sendRowUpdate(row);
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Double-clic → reset à 1
  img.addEventListener('dblclick', () => {
    row.gain = 1;
    updateKnob(row);
    sendRowUpdate(row);
  });
}

function updateKnob(row) {
  const tr = document.querySelector(`tr[data-id="${row.id}"]`);
  if (!tr) return;
  const img = tr.querySelector('.knob-img');
  const val = tr.querySelector('.knob-val');
  img.style.transform = `rotate(${gainToDeg(row.gain)}deg)`;
  val.textContent = Number(row.gain).toFixed(1);
}

// ── MIDI Learn ───────────────────────────────────────────────────────────────

function toggleLearn(id) {
  const prev = midiLearnTarget;
  // Sortir du mode learn sur l'ancienne ligne
  if (prev !== null) {
    const old = document.querySelector(`tr[data-id="${prev}"] .learn-btn`);
    if (old) old.classList.remove('learning');
  }
  midiLearnTarget = (prev === id) ? null : id;
  if (midiLearnTarget !== null) {
    const btn = document.querySelector(`tr[data-id="${id}"] .learn-btn`);
    if (btn) btn.classList.add('learning');
  }
}

function applyMidiLearn(note) {
  if (midiLearnTarget === null) return;
  const row = rows.find(r => r.id === midiLearnTarget);
  if (!row) { midiLearnTarget = null; return; }
  row.key = note;
  const tr = document.querySelector(`tr[data-id="${row.id}"]`);
  if (tr) {
    tr.querySelector('.key-input').value = note;
    tr.querySelector('.learn-btn').classList.remove('learning');
  }
  updateKeyName(row);
  sendRowUpdate(row);
  sortRows();
  midiLearnTarget = null;
}

function updateKeyName(row) {
  const span = document.querySelector(`.key-name[data-id="${row.id}"]`);
  if (span) span.textContent = midiToName(row.key);
}

// ── WebMIDI ───────────────────────────────────────────────────────────────────

function initMidi() {
  if (!navigator.requestMIDIAccess) {
    console.warn('WebMIDI non disponible');
    return;
  }
  navigator.requestMIDIAccess({ sysex: false }).then((access) => {
    const status = document.getElementById('midiStatus');
    function connectAll() {
      let count = 0;
      for (const input of access.inputs.values()) {
        input.onmidimessage = onMidiMessage;
        count++;
      }
      if (status) status.textContent = `MIDI: ${count} entrée(s)`;
    }
    connectAll();
    access.onstatechange = connectAll;
  }).catch((err) => {
    console.warn('MIDI access refusé :', err);
  });
}

function onMidiMessage(e) {
  const [status, note, velocity] = e.data;
  const type    = status & 0xf0;
  const channel = (status & 0x0f) + 1;  // 1-16

  if (type === 0x90 && velocity > 0) {
    // Note On
    if (midiLearnTarget !== null) {
      applyMidiLearn(note);
      return;
    }
    if (bankModeState) {
      const id = bankModeState.activeKeyMap.get(note);
      if (id) {
        window.api.sendAudio({ cmd: 'play', id, velocity });
        bankModeState.activeVoices.add(id);
      }
    } else {
      const row = rows.find(r => r.key === note &&
        (r.channel === null || r.channel === channel));
      if (row && row.file && row.loadState === 'ready') {
        window.api.sendAudio({ cmd: 'play', id: row.id, velocity });
        setRowActive(row.id, true);
      }
    }

  } else if (type === 0x80 || (type === 0x90 && velocity === 0)) {
    // Note Off
    if (bankModeState) {
      const id = bankModeState.activeKeyMap.get(note);
      if (id) window.api.sendAudio({ cmd: 'stop', id });
    } else {
      const row = rows.find(r => r.key === note &&
        (r.channel === null || r.channel === channel));
      if (row) window.api.sendAudio({ cmd: 'stop', id: row.id });
    }
  }
}

initMidi();

// ── Fonctions mode banque ─────────────────────────────────────────────────────

function loadKbBankIntoSlot(bankIdx, slot) {
  const s = bankModeState;
  if (!s || bankIdx >= s.banks.length) return;
  const ids = new Set();
  for (const k of s.banks[bankIdx].keys ?? []) {
    const id = mkKbId(slot, k.key);
    window.api.sendAudio({
      cmd: 'update', id, file: k.file,
      gain:     k.gain     ?? 1,
      fadeType: k.fadeType ?? 'l',
      fadeIn:   k.fadeIn   ?? 0.05,
      fadeOut:  k.fadeOut  ?? 0.1,
      oneShot:  k.oneShot  ?? false,
    });
    ids.add(id);
  }
  s.loadedIds[slot] = ids;
}

function switchKeyboardBank() {
  const s = bankModeState;
  const nextIdx = s.bankIdx + 1;
  if (nextIdx >= s.banks.length) return;

  const prevSlot = s.activeSlot;
  const nextSlot = prevSlot === 'a' ? 'b' : 'a';

  s.bankIdx    = nextIdx;
  s.activeSlot = nextSlot;
  s.activeVoices.clear();

  s.activeKeyMap.clear();
  for (const k of s.banks[nextIdx].keys ?? []) {
    s.activeKeyMap.set(k.key, mkKbId(nextSlot, k.key));
  }

  for (const id of s.loadedIds[prevSlot] ?? []) {
    window.api.sendAudio({ cmd: 'remove', id });
  }
  s.loadedIds[prevSlot] = new Set();

  const futureIdx = nextIdx + 1;
  if (futureIdx < s.banks.length) loadKbBankIntoSlot(futureIdx, prevSlot);

  renderBankRows(s.banks[nextIdx], nextSlot);
  updateBankIndicator();
}

function renderBankRows(bankData, slot) {
  rows = []; nextId = 0;
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '';
  for (const k of bankData.keys ?? []) {
    const id = mkKbId(slot, k.key);
    const tr = document.createElement('tr');
    tr.dataset.bankId = id;
    tr.innerHTML = `
      <td class="key-cell"><div class="key-inner">
        <span class="key-name">${midiToName(k.key)}</span>
      </div></td>
      <td>—</td>
      <td class="file-cell">
        <span class="load-dot load-loading" data-bankid="${id}" title="Chargement…"></span>
        <span class="fname set" title="${escHtml(k.file)}">${baseName(k.file)}</span>
      </td>
      <td><span class="knob-val">${Number(k.gain ?? 1).toFixed(1)}</span></td>
      <td><span class="fade-badge">${k.fadeType ?? 'l'}</span></td>
      <td><span>${Number(k.fadeIn ?? 0.05).toFixed(2)}s</span></td>
      <td><span>${Number(k.fadeOut ?? 0.1).toFixed(2)}s</span></td>
      <td><span>${(k.oneShot ?? false) ? '1shot' : 'sust'}</span></td>
      <td></td>
    `;
    tbody.appendChild(tr);
  }
}

function updateBankIndicator() {
  const el = document.getElementById('bankIndicator');
  if (!el) return;
  if (bankModeState) {
    el.textContent = `Bank ${bankModeState.bankIdx + 1} / ${bankModeState.banks.length}`;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

async function openBankFolder() {
  const folder = await window.api.openFolder();
  if (!folder) return;

  const entries = await window.api.listFolder(folder);
  const bankPattern = /^(.+)_bank(\d+)\.json$/;
  const bankFiles = [];
  for (const e of entries) {
    const m = e.name.match(bankPattern);
    if (m) bankFiles.push({ num: parseInt(m[2]), path: e.full });
  }
  if (!bankFiles.length) { alert('Aucun fichier *_bank*.json dans ce dossier'); return; }
  bankFiles.sort((a, b) => a.num - b.num);

  let nbCanaux = 16, polyphonie = 0;
  const bankDataArr = [];
  for (const b of bankFiles) {
    const text = await window.api.readTextFile(b.path);
    if (!text) { bankDataArr.push({ keys: [] }); continue; }
    try {
      const data = JSON.parse(text);
      nbCanaux   = Math.max(nbCanaux,   data.nbCanaux   ?? 16);
      polyphonie = Math.max(polyphonie, data.polyphonie ?? 0);
      bankDataArr.push({ keys: data.keys ?? [] });
    } catch (_) { bankDataArr.push({ keys: [] }); }
  }

  // Quitter le mode normal
  rows = []; nextId = 0;
  document.getElementById('tableBody').innerHTML = '';
  document.body.classList.add('bank-mode');

  bankModeState = {
    banks:        bankDataArr,
    bankIdx:      0,
    activeSlot:   'a',
    loadedIds:    { a: new Set(), b: new Set() },
    activeKeyMap: new Map(),
    activeVoices: new Set(),
  };

  window.api.restartAudio(nbCanaux);
  if (polyphonie > 0) window.api.sendAudio({ cmd: 'set_polyphonie', value: polyphonie });

  loadKbBankIntoSlot(0, 'a');
  if (bankDataArr.length > 1) loadKbBankIntoSlot(1, 'b');

  for (const k of bankDataArr[0]?.keys ?? []) {
    bankModeState.activeKeyMap.set(k.key, mkKbId('a', k.key));
  }

  renderBankRows(bankDataArr[0], 'a');
  updateBankIndicator();
}

// ── Fichier ──────────────────────────────────────────────────────────────────

async function pickFile(id) {
  const filePath = await window.api.openFile();
  if (!filePath) return;
  const row = rows.find(r => r.id === id);
  if (!row) return;
  row.file = filePath;
  row.loadState = 'loading';
  const tr = document.querySelector(`tr[data-id="${id}"]`);
  const span = tr.querySelector('.fname');
  span.textContent = baseName(filePath);
  span.title = filePath;
  span.classList.add('set');
  updateLoadDot(row);
  sendRowUpdate(row);
}

// Timers de clignotement JS par row.id (fallback si CSS animation ne fonctionne pas)
const blinkTimers = {};

function updateLoadDot(row) {
  const dot = document.querySelector(`.load-dot[data-id="${row.id}"]`);
  if (!dot) return;

  // Arrêter le timer précédent
  if (blinkTimers[row.id]) {
    clearInterval(blinkTimers[row.id]);
    delete blinkTimers[row.id];
    dot.style.opacity = '';
  }

  dot.className = `load-dot load-${row.loadState}`;
  const titles = { idle: '', loading: 'Chargement…', ready: 'Prêt', error: 'Erreur de chargement' };
  dot.title = titles[row.loadState] ?? '';

  if (row.loadState === 'loading') {
    let on = true;
    blinkTimers[row.id] = setInterval(() => {
      dot.style.opacity = (on = !on) ? '1' : '0.1';
    }, 300);
  }
}

// ── Fade cell mise à jour ─────────────────────────────────────────────────────

function updateFadeCell(row) {
  const tr = document.querySelector(`tr[data-id="${row.id}"]`);
  if (!tr) return;
  tr.querySelector('.fade-badge').textContent  = row.fadeType;
  tr.querySelector('.fadeInDisp').textContent  = Number(row.fadeIn).toFixed(2) + 's';
  tr.querySelector('.fadeOutDisp').textContent = Number(row.fadeOut).toFixed(2) + 's';
}

// ── Suppression de ligne ──────────────────────────────────────────────────────

function deleteRow(id) {
  rows = rows.filter(r => r.id !== id);
  const tr = document.querySelector(`tr[data-id="${id}"]`);
  if (tr) tr.remove();
  window.api.sendAudio({ cmd: 'remove', id });
}

// ── Communication audio ───────────────────────────────────────────────────────

function sendRowUpdate(row) {
  window.api.sendAudio({
    cmd:      'update',
    id:       row.id,
    key:      row.key,
    channel:  row.channel,
    file:     row.file,
    gain:     row.gain,
    fadeType: row.fadeType,
    fadeIn:   row.fadeIn,
    fadeOut:  row.fadeOut,
    oneShot:  row.oneShot,
  });
}

// ── Indicateur visuel actif/inactif ──────────────────────────────────────────

function setRowActive(id, active) {
  const tr = document.querySelector(`tr[data-id="${id}"]`);
  if (tr) tr.classList.toggle('row-active', active);
}

// ── Événements audio ─────────────────────────────────────────────────────────

window.api.onAudioEvent((msg) => {
  const status = document.getElementById('statusBar');
  if (msg.type === 'ready') {
    status.textContent = 'audio: prêt';
    status.className   = 'status ok';
  } else if (msg.type === 'error') {
    status.textContent = 'audio: erreur — ' + msg.message;
    status.className   = 'status err';
  } else if (msg.type === 'voice_end') {
    if (bankModeState) {
      bankModeState.activeVoices.delete(msg.id);
      if (bankModeState.activeVoices.size === 0 &&
          bankModeState.bankIdx + 1 < bankModeState.banks.length) {
        switchKeyboardBank();
      }
    } else {
      setRowActive(msg.id, false);
    }
  } else if (msg.type === 'loaded') {
    if (bankModeState) {
      const dot = document.querySelector(`.load-dot[data-bankid="${msg.id}"]`);
      if (dot) { dot.className = 'load-dot load-ready'; dot.title = 'Prêt'; }
    } else {
      const row = rows.find(r => r.id === msg.id);
      if (row) { row.loadState = 'ready'; updateLoadDot(row); }
    }
  } else if (msg.type === 'load_error') {
    if (bankModeState) {
      const dot = document.querySelector(`.load-dot[data-bankid="${msg.id}"]`);
      if (dot) { dot.className = 'load-dot load-error'; dot.title = msg.message ?? 'Erreur'; }
    } else {
      const row = rows.find(r => r.id === msg.id);
      if (row) { row.loadState = 'error'; updateLoadDot(row); }
    }
  }
});

// ── Chargement depuis descripteur JSON ───────────────────────────────────────

function applyDescriptor(data) {
  const items = Array.isArray(data) ? data : (data?.keys ?? []);
  items.forEach(item => makeRow(item));
}

window.api.onLoadDescriptor((data) => {
  applyDescriptor(data);
});

// ── Sauvegarder / Charger ────────────────────────────────────────────────────

document.getElementById('btnSave').addEventListener('click', async () => {
  const { ipcRenderer } = require === undefined ? {} : {};
  // Utiliser showSaveDialog via preload n'est pas exposé — on download
  const json = JSON.stringify(rows.map(({ key, channel, file, gain, fadeType, fadeIn, fadeOut, oneShot }) =>
    ({ key, channel, file, gain, fadeType, fadeIn, fadeOut, oneShot })), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'mcMidiKeyboard.json'; a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('btnLoad').addEventListener('click', async () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        // Quitter le mode banque si actif
        bankModeState = null;
        document.body.classList.remove('bank-mode');
        updateBankIndicator();
        document.getElementById('tableBody').innerHTML = '';
        rows = []; nextId = 0;
        const nbCanaux = !Array.isArray(data) && data.nbCanaux ? data.nbCanaux : 16;
        window.api.restartAudio(nbCanaux);
        applyDescriptor(data);
      } catch (err) {
        alert('Erreur de lecture JSON : ' + err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
});

// ── Ajout ligne ───────────────────────────────────────────────────────────────
document.getElementById('btnAddRow').addEventListener('click', () => {
  if (rows.length === 0) window.api.restartAudio(16);
  makeRow();
});

document.getElementById('btnOpenBanks').addEventListener('click', openBankFolder);

// ── Thèmes ────────────────────────────────────────────────────────────────────
initThemes();

// Appuyer sur Échap annule le MIDI Learn en cours
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && midiLearnTarget !== null) {
    toggleLearn(midiLearnTarget);
  }
});

// ── Utilitaires ──────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function baseName(p) {
  return p.replace(/\\/g, '/').split('/').pop();
}
