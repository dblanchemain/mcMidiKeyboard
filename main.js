// mcMidiKeyboard — main process
// License: GPL-3.0-or-later — D.Blanchemain

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

// WebMIDI via ALSA sur Linux
app.commandLine.appendSwitch('enable-web-midi');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');

let mainWindow;
let audioProcess = null;

// Argument JSON descriptor passé en ligne de commande
// Usage : electron . /path/to/descriptor.json
const descriptorArg = (() => {
  const args = process.argv.slice(2);
  for (const a of args) {
    if (!a.startsWith('--') && fs.existsSync(a)) return a;
  }
  return null;
})();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 700,
    minHeight: 400,
    title: 'mcMidiKeyboard',
    backgroundColor: '#1e1e2e',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('index.html');

  mainWindow.webContents.on('did-finish-load', () => {
    if (descriptorArg) {
      try {
        const data = JSON.parse(fs.readFileSync(descriptorArg, 'utf8'));
        mainWindow.webContents.send('load-descriptor', data);
      } catch (e) {
        console.error('Erreur lecture descripteur :', e.message);
      }
    }
  });

  mainWindow.on('closed', () => {
    stopAudioServer();
    mainWindow = null;
  });
}

// ── Audio server Python ─────────────────────────────────────────────────────

function startAudioServer() {
  if (audioProcess) return;
  const base   = app.isPackaged ? process.resourcesPath : __dirname;
  const script = path.join(base, 'python', 'audio_server.py');
  audioProcess = spawn('python3', [script], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  audioProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (mainWindow) mainWindow.webContents.send('audio-event', msg);
      } catch (_) {}
    }
  });

  audioProcess.stderr.on('data', (d) => {
    const txt = d.toString().trim();
    console.error('[audio]', txt);
    if (mainWindow) mainWindow.webContents.send('audio-event',
      { type: 'error', message: txt.split('\n').pop() });
  });

  audioProcess.on('exit', (code) => {
    console.log('[audio] exit', code);
    audioProcess = null;
  });
}

function stopAudioServer() {
  if (audioProcess) {
    sendToAudio({ cmd: 'quit' });
    audioProcess.kill();
    audioProcess = null;
  }
}

function sendToAudio(msg) {
  if (audioProcess && audioProcess.stdin.writable) {
    audioProcess.stdin.write(JSON.stringify(msg) + '\n');
  }
}

// ── IPC handlers ────────────────────────────────────────────────────────────

ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['wav', 'aif', 'aiff', 'flac', 'ogg', 'mp3'] }],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.on('audio-cmd', (_event, msg) => {
  sendToAudio(msg);
});

ipcMain.on('start-audio-server', () => {
  startAudioServer();
});

// ── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  startAudioServer();
});

app.on('window-all-closed', () => {
  stopAudioServer();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
