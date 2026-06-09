#!/usr/bin/env python3
"""
mcMidiKeyboard — audio_server.py
Lecture multicanalien de fichiers audio via JACK (Linux) ou sounddevice (autres OS).
Protocole : JSON line-delimited sur stdin/stdout.
License: GPL-3.0-or-later — D.Blanchemain
"""

import sys
import os
import json
import threading
import math
import platform
import queue
import numpy as np

# ── Détection plateforme ──────────────────────────────────────────────────────

PLATFORM = platform.system()  # 'Linux', 'Windows', 'Darwin'
USE_JACK  = PLATFORM == 'Linux'

# ── Backend audio ─────────────────────────────────────────────────────────────

if USE_JACK:
    try:
        import jack
        import soundfile as sf
        BACKEND = 'jack'
    except ImportError as e:
        USE_JACK = False
        BACKEND  = 'sounddevice'
        _jack_import_error = str(e)
else:
    BACKEND = 'sounddevice'

if BACKEND == 'sounddevice':
    try:
        import sounddevice as sd
        import soundfile as sf
    except ImportError as e:
        emit({'type': 'error', 'message': f'Import sounddevice/soundfile : {e}'})
        sys.exit(1)

# ── Communication JSON ────────────────────────────────────────────────────────

def emit(obj):
    """Envoyer un message JSON au processus Electron."""
    sys.stdout.write(json.dumps(obj) + '\n')
    sys.stdout.flush()

def read_stdin():
    """Lire stdin ligne par ligne et pousser dans la queue."""
    for line in sys.stdin:
        line = line.strip()
        if line:
            try:
                cmd_queue.put(json.loads(line))
            except json.JSONDecodeError:
                pass

cmd_queue = queue.Queue()

# ── État des pistes ───────────────────────────────────────────────────────────

class Track:
    """Représente une ligne du tableau mcMidiKeyboard."""
    def __init__(self, row_id):
        self.id       = row_id
        self.key      = ''
        self.file     = ''
        self.gain     = 1.0        # dB (−10 … 10), 1 = 0 dB (en fait valeur directe)
        self.fade_type = 'l'
        self.fade_in  = 0.1       # secondes
        self.fade_out = 0.1       # secondes
        # données audio
        self.data     = None      # np.ndarray (frames × channels)
        self.sr       = 44100
        self.channels = 1
        # état de lecture
        self.playing  = False
        self.pos      = 0         # position en frames
        self.lock     = threading.Lock()

    def load(self):
        if not self.file or not os.path.exists(self.file):
            return False
        try:
            data, sr = sf.read(self.file, always_2d=True, dtype='float32')
            with self.lock:
                self.data     = data
                self.sr       = sr
                self.channels = data.shape[1]
            return True
        except Exception as e:
            emit({'type': 'error', 'message': f'Lecture {self.file} : {e}'})
            return False

    def gain_linear(self):
        """Convertit la valeur gain (−10..10, 1=neutre) en linéaire."""
        # Interprétation : la valeur est en dB relatif à la valeur 1 = 0 dB
        # gain=1 → 0 dB → amplitude 1.0
        # gain=10 → +20 dB (par exemple) — on fait : dB = (gain-1)*2
        db = (self.gain - 1) * 2.0
        return 10 ** (db / 20.0)

    def compute_envelope(self, n_frames):
        """Calcule l'enveloppe fade-in/fade-out pour n_frames frames."""
        fi = int(self.fade_in  * self.sr)
        fo = int(self.fade_out * self.sr)
        fi = min(fi, n_frames)
        fo = min(fo, n_frames - fi)
        env = np.ones(n_frames, dtype=np.float32)
        if fi > 0:
            t = np.linspace(0, 1, fi, dtype=np.float32)
            env[:fi] = self._fade_curve(t)
        if fo > 0:
            t = np.linspace(1, 0, fo, dtype=np.float32)
            env[n_frames - fo:] *= self._fade_curve(t)
        return env

    def _fade_curve(self, t):
        ft = self.fade_type
        if ft == 'q':
            return np.sin(t * (np.pi / 2))
        elif ft == 'h':
            return np.sin(t * np.pi)
        elif ft == 't':
            return t
        elif ft == 'l':
            return np.log1p(t * (math.e - 1))
        elif ft == 'p':
            return 1 - (1 - t) ** 2
        return t

    def start(self):
        with self.lock:
            self.pos     = 0
            self.playing = True

    def stop(self):
        with self.lock:
            self.playing = False


tracks = {}   # id → Track
tracks_lock = threading.Lock()

def get_or_create(row_id):
    with tracks_lock:
        if row_id not in tracks:
            tracks[row_id] = Track(row_id)
        return tracks[row_id]


# ══════════════════════════════════════════════════════════════════════════════
# BACKEND JACK
# ══════════════════════════════════════════════════════════════════════════════

def run_jack():
    client = jack.Client('mcMidiKeyboard')

    # Ports de sortie : on crée un max de ports au démarrage
    # et on route dynamiquement selon le nombre de canaux des fichiers.
    MAX_PORTS = 16
    out_ports = []
    for i in range(MAX_PORTS):
        p = client.outports.register(f'out_{i+1}')
        out_ports.append(p)

    @client.set_process_callback
    def process(frames):
        # Initialiser les buffers à zéro
        buffers = [np.frombuffer(p.get_buffer(), dtype=np.float32) for p in out_ports]
        for b in buffers:
            b[:] = 0.0

        with tracks_lock:
            active = [t for t in tracks.values() if t.playing and t.data is not None]

        for track in active:
            with track.lock:
                if not track.playing or track.data is None:
                    continue
                remaining = len(track.data) - track.pos
                if remaining <= 0:
                    track.playing = False
                    continue
                chunk_len = min(frames, remaining)
                chunk = track.data[track.pos: track.pos + chunk_len]  # (frames, ch)

                # Enveloppe fade calculée sur tout le fichier pour la cohérence
                env_full  = track.compute_envelope(len(track.data))
                env_chunk = env_full[track.pos: track.pos + chunk_len]

                gain = track.gain_linear()
                n_ch = min(track.channels, MAX_PORTS)

                for ch in range(n_ch):
                    buf = buffers[ch]
                    buf[:chunk_len] += chunk[:, ch] * env_chunk * gain

                track.pos += chunk_len
                if track.pos >= len(track.data):
                    track.playing = False

    @client.set_shutdown_callback
    def shutdown(status, reason):
        emit({'type': 'error', 'message': f'JACK shutdown : {reason}'})

    with client:
        # Connecter aux sorties système si possible
        try:
            target = client.get_ports('system:playback_.*', is_input=True)
            for i, t in enumerate(target):
                if i < len(out_ports):
                    client.connect(out_ports[i], t)
        except Exception:
            pass

        emit({'type': 'ready', 'backend': 'jack'})
        process_commands()


# ══════════════════════════════════════════════════════════════════════════════
# BACKEND sounddevice
# ══════════════════════════════════════════════════════════════════════════════

def run_sounddevice():
    SR = 44100
    BLOCK = 1024

    def audio_callback(outdata, frames, time_info, status):
        outdata[:] = 0.0
        n_out_ch = outdata.shape[1]

        with tracks_lock:
            active = [t for t in tracks.values() if t.playing and t.data is not None]

        for track in active:
            with track.lock:
                if not track.playing or track.data is None:
                    continue
                # Rééchantillonnage simple si SR différent (non implémenté ici)
                remaining = len(track.data) - track.pos
                if remaining <= 0:
                    track.playing = False
                    continue
                chunk_len = min(frames, remaining)
                chunk = track.data[track.pos: track.pos + chunk_len]

                env_full  = track.compute_envelope(len(track.data))
                env_chunk = env_full[track.pos: track.pos + chunk_len]

                gain = track.gain_linear()
                n_ch = min(track.channels, n_out_ch)

                for ch in range(n_ch):
                    outdata[:chunk_len, ch] += chunk[:, ch] * env_chunk * gain

                track.pos += chunk_len
                if track.pos >= len(track.data):
                    track.playing = False

    try:
        device_info = sd.query_devices(kind='output')
        n_out = min(device_info.get('max_output_channels', 2), 16)
    except Exception:
        n_out = 2

    with sd.OutputStream(samplerate=SR, channels=n_out,
                         blocksize=BLOCK, dtype='float32',
                         callback=audio_callback):
        emit({'type': 'ready', 'backend': 'sounddevice'})
        process_commands()


# ══════════════════════════════════════════════════════════════════════════════
# Traitement des commandes
# ══════════════════════════════════════════════════════════════════════════════

def process_commands():
    while True:
        try:
            msg = cmd_queue.get(timeout=1)
        except queue.Empty:
            continue

        cmd = msg.get('cmd')
        row_id = msg.get('id')

        if cmd == 'quit':
            break

        elif cmd == 'update':
            track = get_or_create(row_id)
            old_file = track.file
            track.key       = msg.get('key', '')
            track.gain      = float(msg.get('gain', 1))
            track.fade_type = msg.get('fadeType', 'l')
            track.fade_in   = float(msg.get('fadeIn', 0.1))
            track.fade_out  = float(msg.get('fadeOut', 0.1))
            new_file = msg.get('file', '')
            if new_file and new_file != old_file:
                track.file = new_file
                threading.Thread(target=track.load, daemon=True).start()

        elif cmd == 'remove':
            with tracks_lock:
                t = tracks.pop(row_id, None)
            if t:
                t.stop()

        elif cmd == 'play':
            track = get_or_create(row_id)
            if track.data is None and track.file:
                track.load()
            track.start()

        elif cmd == 'stop':
            track = get_or_create(row_id)
            track.stop()


# ── Entrée ────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    # Lancer la lecture de stdin dans un thread séparé
    t = threading.Thread(target=read_stdin, daemon=True)
    t.start()

    if USE_JACK:
        run_jack()
    else:
        run_sounddevice()
