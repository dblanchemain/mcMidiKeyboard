// renderer.js — mcMidiKeyboard
// License: GPL-3.0-or-later — D.Blanchemain

// ── État global ──────────────────────────────────────────────────────────────
// Chaque ligne : { id, key, file, gain, fadeType, fadeIn, fadeOut }
let rows = [];
let nextId = 0;

// ── Constantes bouton rotatif ────────────────────────────────────────────────
const KNOB_MIN = -10;
const KNOB_MAX = 10;
const KNOB_DEG_MIN = -135;   // position min en degrés (vers la gauche)
const KNOB_DEG_MAX = 135;    // position max (vers la droite)
// valeur 1 → position haute → 0° de rotation (pointeur en haut)
const KNOB_CENTER = 1;

function gainToDeg(gain) {
  const norm = (gain - KNOB_MIN) / (KNOB_MAX - KNOB_MIN);  // 0–1
  return KNOB_DEG_MIN + norm * (KNOB_DEG_MAX - KNOB_DEG_MIN);
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

// ── Construction des lignes ──────────────────────────────────────────────────

function makeRow(data = {}) {
  const id = nextId++;
  const row = {
    id,
    key:      data.key      ?? '',
    file:     data.file     ?? '',
    gain:     data.gain     != null ? data.gain : 1,
    fadeType: data.fadeType ?? 'l',
    fadeIn:   data.fadeIn   ?? 0.1,
    fadeOut:  data.fadeOut  ?? 0.1,
  };
  rows.push(row);
  renderRow(row);
  return row;
}

function renderRow(row) {
  const tbody = document.getElementById('tableBody');
  const tr = document.createElement('tr');
  tr.dataset.id = row.id;

  tr.innerHTML = `
    <td class="key-cell">
      <input type="text" maxlength="1" placeholder="?" value="${escHtml(row.key)}" data-id="${row.id}" class="key-input"/>
    </td>
    <td class="file-cell">
      <button class="pick-file" data-id="${row.id}">…</button>
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
    <td><button class="del-btn" data-id="${row.id}" title="Supprimer">×</button></td>
  `;
  tbody.appendChild(tr);

  // Knob — drag vertical
  const knobImg = tr.querySelector('.knob-img');
  initKnob(knobImg, row);

  tr.querySelector('.pick-file').addEventListener('click', () => pickFile(row.id));
  tr.querySelector('.fade-btn').addEventListener('click', () => openFadeModal(row.id));
  tr.querySelector('.del-btn').addEventListener('click', () => deleteRow(row.id));
  tr.querySelector('.key-input').addEventListener('input', (e) => {
    row.key = e.target.value.slice(-1);
    e.target.value = row.key;
    sendRowUpdate(row);
  });
  tr.querySelector('.key-input').addEventListener('keydown', (e) => {
    // Capturer la touche MIDI / clavier directement
    if (e.key.length === 1) {
      row.key = e.key;
      e.target.value = e.key;
      sendRowUpdate(row);
      e.preventDefault();
    }
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

// ── Fichier ──────────────────────────────────────────────────────────────────

async function pickFile(id) {
  const filePath = await window.api.openFile();
  if (!filePath) return;
  const row = rows.find(r => r.id === id);
  if (!row) return;
  row.file = filePath;
  const tr = document.querySelector(`tr[data-id="${id}"]`);
  const span = tr.querySelector('.fname');
  span.textContent = baseName(filePath);
  span.title = filePath;
  span.classList.add('set');
  sendRowUpdate(row);
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
    file:     row.file,
    gain:     row.gain,
    fadeType: row.fadeType,
    fadeIn:   row.fadeIn,
    fadeOut:  row.fadeOut,
  });
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
  }
});

// ── Chargement depuis descripteur JSON ───────────────────────────────────────

window.api.onLoadDescriptor((data) => {
  if (Array.isArray(data)) {
    data.forEach(item => makeRow(item));
  }
});

// ── Sauvegarder / Charger ────────────────────────────────────────────────────

document.getElementById('btnSave').addEventListener('click', async () => {
  const { ipcRenderer } = require === undefined ? {} : {};
  // Utiliser showSaveDialog via preload n'est pas exposé — on download
  const json = JSON.stringify(rows.map(({ key, file, gain, fadeType, fadeIn, fadeOut }) =>
    ({ key, file, gain, fadeType, fadeIn, fadeOut })), null, 2);
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
        document.getElementById('tableBody').innerHTML = '';
        rows = []; nextId = 0;
        if (Array.isArray(data)) data.forEach(item => makeRow(item));
      } catch (err) {
        alert('Erreur de lecture JSON : ' + err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
});

// ── Ajout ligne ───────────────────────────────────────────────────────────────
document.getElementById('btnAddRow').addEventListener('click', () => makeRow());

// ── Clavier MIDI (clavier physique → déclenchement) ──────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.target.classList.contains('key-input')) return;  // ne pas interférer avec l'édition
  if (e.repeat) return;
  const row = rows.find(r => r.key === e.key);
  if (row && row.file) {
    window.api.sendAudio({ cmd: 'play', id: row.id });
  }
});

document.addEventListener('keyup', (e) => {
  if (e.repeat) return;
  const row = rows.find(r => r.key === e.key);
  if (row) {
    window.api.sendAudio({ cmd: 'stop', id: row.id });
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
