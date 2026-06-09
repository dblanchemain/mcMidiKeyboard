# mcMidiKeyboard

Lecteur audio multicanal déclenché par clavier MIDI/ordinateur.

## Prérequis

```bash
npm install
pip3 install soundfile numpy
# Linux (JACK) :
pip3 install jack soundfile numpy
# Windows / macOS :
pip3 install sounddevice soundfile numpy
```

## Démarrage

```bash
npm start
# Avec un descripteur JSON au démarrage :
npx electron . /chemin/vers/descripteur.json
```

## Format du descripteur JSON

```json
[
  {
    "key": "a",
    "file": "/chemin/vers/fichier.wav",
    "gain": 1,
    "fadeType": "l",
    "fadeIn": 0.1,
    "fadeOut": 0.2
  }
]
```

`fadeType` : `q` (qt sinusoïde), `h` (demi-sinus), `t` (linéaire), `l` (logarithmique), `p` (parabolique inversée)

## Architecture

- `main.js` — processus principal Electron
- `renderer.js` — interface utilisateur
- `python/audio_server.py` — serveur audio (JACK sur Linux, sounddevice sur Windows/macOS)

## License

GPL-3.0-or-later
