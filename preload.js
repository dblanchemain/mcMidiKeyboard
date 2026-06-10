// preload.js — pont sécurisé entre renderer et main
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFile:        () => ipcRenderer.invoke('open-file-dialog'),
  sendAudio:       (msg) => ipcRenderer.send('audio-cmd', msg),
  restartAudio:    (maxPorts) => ipcRenderer.send('restart-audio-server', maxPorts),
  onAudioEvent:    (cb) => ipcRenderer.on('audio-event', (_e, msg) => cb(msg)),
  onLoadDescriptor:(cb) => ipcRenderer.on('load-descriptor', (_e, data) => cb(data)),
});
