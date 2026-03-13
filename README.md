# Spectrometer EQ

A Chrome extension that combines a real-time audio spectrum analyzer with a 3-band rotary EQ modelled on a DJ rotary mixer (e.g. Allen & Heath Xone, Rane MP2015).

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Manifest](https://img.shields.io/badge/manifest-v3-green.svg)
![Platform](https://img.shields.io/badge/platform-Chrome-yellow.svg)

---

## Features

- **Real-time spectrum analyzer** — 128 log-scale bars from 20 Hz to 20 kHz, color-coded by frequency band
- **3-band rotary EQ** — High, Mid, and Low bands with independent control, each styled as a physical rotary knob
- **Kill switch** — Turning any knob fully counter-clockwise cuts the band to −40 dB (shown as `KILL`)
- **Two input modes** — Load an audio file (EQ applied to playback) or use the microphone (analysis only)
- **Crossover markers** — Visual guides at 320 Hz and 3.2 kHz separating the three bands in the spectrum display

---

## EQ Design

Each band uses a Web Audio API `BiquadFilterNode` with parameters matched to a DJ rotary mixer:

| Band | Filter Type  | Frequency | Q   | Range           |
|------|-------------|-----------|-----|-----------------|
| HIGH | `highshelf` | 3.2 kHz   | —   | −40 dB to +6 dB |
| MID  | `peaking`   | 1.0 kHz   | 0.7 | −40 dB to +6 dB |
| LOW  | `lowshelf`  | 320 Hz    | —   | −40 dB to +6 dB |

**Signal chain:**
```
Audio Source → HIGH filter → MID filter → LOW filter → Analyser [→ Output]
```

The analyser node feeds the spectrum canvas. In file mode the chain connects to the audio destination (speakers); in mic mode it does not, to prevent feedback.

**Knob mapping:**

```
−150°  ────────────  0°  ────────────  +150°
 KILL            0 dB (unity)         +6 dB boost
```

---

## Knob Controls

| Interaction | Action |
|---|---|
| Drag up / down | Rotate knob (0.8° per pixel) |
| Mouse wheel | Fine-trim the knob |
| Double-click | Reset band to 0 dB |

---

## Installation

This extension is not published to the Chrome Web Store. Install it locally as an unpacked extension:

1. Clone the repository:
   ```bash
   git clone https://github.com/arjunrao2709/spectrometer-eq-chrome.git
   ```

2. Open Chrome and navigate to `chrome://extensions`

3. Enable **Developer mode** (toggle in the top-right corner)

4. Click **Load unpacked** and select the cloned directory

5. The extension icon will appear in your toolbar — click it to open the popup

---

## Usage

### Audio File Mode
1. Click **LOAD FILE** and select any audio file (MP3, WAV, OGG, FLAC, etc.)
2. Click **PLAY** to start playback
3. Adjust the HIGH, MID, and LOW knobs to shape the sound in real time
4. The spectrum display updates live, color-coded by band

### Microphone Mode
1. Click **MIC** and allow microphone access when prompted
2. The spectrum analyzer will display the incoming mic signal processed through the EQ
3. Audio is not routed to speakers in this mode to prevent feedback
4. Click **MIC** again to stop

---

## Project Structure

```
spectrometer-eq-chrome/
├── manifest.json   # Chrome Extension Manifest V3
├── popup.html      # Extension popup UI
├── styles.css      # Dark DJ mixer theme
└── popup.js        # Web Audio API engine, EQ logic, knob interaction
```

---

## Browser Compatibility

| Browser | Supported |
|---------|-----------|
| Chrome 88+ | Yes |
| Edge 88+ (Chromium) | Yes |
| Firefox | No (uses Chrome Extension APIs) |
| Safari | No |

Requires Web Audio API and `getUserMedia` support (both available in all modern Chromium-based browsers).

---

## Contributing

Contributions are welcome. Please open an issue before submitting a pull request for significant changes.

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes with a clear message
4. Push to your fork and open a pull request

---

## License

MIT License — see [LICENSE](LICENSE) for details.
