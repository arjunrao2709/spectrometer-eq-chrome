# Spectrometer EQ

A Chrome extension that captures tab audio and displays a real-time spectrum analyzer with a 3-band EQ.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Manifest](https://img.shields.io/badge/manifest-v3-green.svg)
![Version](https://img.shields.io/badge/version-2.0-brightgreen.svg)
![Platform](https://img.shields.io/badge/platform-Chrome-yellow.svg)

---

## Features

- **Real-time spectrum analyzer** — 96 log-scale bars from 20 Hz to 20 kHz, color-coded green → yellow → red
- **3-band parametric EQ** — High, Mid, and Low bands controlled via vertical sliders
- **Kill switch** — Dragging any slider to the bottom cuts the band to −40 dB (shown as `KILL`)
- **Two display modes** — Bars (frequency spectrum) and Wave (time-domain waveform)
- **Side panel UI** — Opens as a persistent Chrome side panel, stays visible while you browse

---

## EQ Design

Each band uses a Web Audio API `BiquadFilterNode` with parameters matched to a DJ mixer:

| Band | Filter Type  | Frequency | Q   | Range           |
|------|-------------|-----------|-----|-----------------|
| HIGH | `highshelf` | 3.2 kHz   | —   | −40 dB to +6 dB |
| MID  | `peaking`   | 1.0 kHz   | 0.7 | −40 dB to +6 dB |
| LOW  | `lowshelf`  | 320 Hz    | —   | −40 dB to +6 dB |

**Signal chain:**
```
Tab Audio → HIGH filter → MID filter → LOW filter → Analyser → Speakers
```

**Slider mapping:**

```
Top    ──── +6 dB (boost)
Centre ────  0 dB (unity)
Bottom ──── −40 dB (kill)
```

The mapping is two-segment: the physical centre always corresponds to 0 dB regardless of the asymmetric dB range.

---

## Slider Controls

| Interaction | Action |
|---|---|
| Drag up / down | Adjust gain continuously |
| Mouse wheel | Fine-trim the band |
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

5. Click the extension icon in your toolbar to open the side panel

---

## Usage

1. Open any tab playing audio (YouTube, Spotify web, etc.)
2. Click the **Spectrometer EQ** icon to open the side panel
3. Click **Start** — Chrome will prompt for tab capture permission
4. The spectrum display activates; adjust **High**, **Mid**, and **Low** sliders to shape the sound in real time
5. Switch between **Bars** and **Wave** modes using the segmented control at the top
6. Click **Stop** to end capture

---

## Project Structure

```
spectrometer-eq-chrome/
├── manifest.json   # Chrome Extension Manifest V3
├── background.js   # Service worker — handles tab capture and side panel
├── popup.html      # Side panel UI
├── styles.css      # Minimal dark theme
└── popup.js        # Web Audio API engine, EQ logic, slider interaction
```

---

## Browser Compatibility

| Browser | Supported |
|---------|-----------|
| Chrome 114+ | Yes (Side Panel API required) |
| Edge 114+ (Chromium) | Yes |
| Firefox | No |
| Safari | No |

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
