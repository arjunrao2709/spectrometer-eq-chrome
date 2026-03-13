'use strict';

// ─── EQ Band Definitions (DJ Rotary Mixer) ────────────────────────────────────
//
// Three biquad filters modelled on a DJ rotary mixer:
//   HIGH  – highshelf  @ 3.2 kHz
//   MID   – peaking    @ 1.0 kHz  (Q = 0.7, ~one-octave width)
//   LOW   – lowshelf   @ 320 Hz
//
// Knob range: −150° (kill / −40 dB) to +150° (+6 dB). 12 o'clock = 0 dB.
//
const BANDS = [
  { id: 'high', type: 'highshelf', freq: 3200, q: null },
  { id: 'mid',  type: 'peaking',   freq: 1000, q: 0.7  },
  { id: 'low',  type: 'lowshelf',  freq: 320,  q: null },
];

const MIN_ANGLE = -150;
const MAX_ANGLE =  150;
const MIN_DB    =  -40;
const MAX_DB    =    6;
const KILL_DB   =  -30;

// ─── DOM References ───────────────────────────────────────────────────────────
const canvas     = document.getElementById('canvas');
const ctx        = canvas.getContext('2d');
const vuCanvas   = document.getElementById('vu-canvas');
const vuCtx      = vuCanvas.getContext('2d');
const btn        = document.getElementById('btn-capture');
const statusEl   = document.getElementById('status');
const peakLabel  = document.getElementById('peak-label');
const modeSelect = document.getElementById('mode-select');

const W  = canvas.width;
const H  = canvas.height;
const VW = vuCanvas.width;   // 480
const VH = vuCanvas.height;  // 140

// ─── Audio State ──────────────────────────────────────────────────────────────
let audioCtx  = null;
let analyser  = null;
let animId    = null;
let stream    = null;
let capturing = false;

// EQ filter nodes — populated in startCapture(), cleared in stopCapture()
const filters = {};

// Current knob positions (degrees) — preserved across start/stop cycles
const angles = { high: 0, mid: 0, low: 0 };

// ─── Spectrum: Gradients & Peaks ─────────────────────────────────────────────
let barGradient    = null;
let mirrorGradient = null;
let peakValues     = null;
let peakDecay      = null;

const PEAK_HOLD_FRAMES = 30;
const PEAK_DECAY_RATE  = 1.5;

function buildGradients() {
  // Warm amber/copper spectrum — like vintage phosphor or VU meters on wood gear
  barGradient = ctx.createLinearGradient(0, H, 0, 0);
  barGradient.addColorStop(0.0, '#1a0c02');
  barGradient.addColorStop(0.3, '#6b3010');
  barGradient.addColorStop(0.6, '#c86020');
  barGradient.addColorStop(0.85, '#e09030');
  barGradient.addColorStop(1.0, '#f0c050');

  mirrorGradient = ctx.createLinearGradient(0, 0, 0, H);
  mirrorGradient.addColorStop(0.0, '#f0c050');
  mirrorGradient.addColorStop(0.2, '#e09030');
  mirrorGradient.addColorStop(0.5, '#c86020');
  mirrorGradient.addColorStop(1.0, '#6b3010');
}

buildGradients();

// ─── VU Meter ─────────────────────────────────────────────────────────────────
//
// Classic analog VU meter with ballistic needle.
// Scale: -20 VU to +3 VU  (0 VU ≈ -18 dBFS for digital audio)
// Zones: green (-20→0), amber (0→+2), red (+2→+3)
//

const VU_CX  = VW / 2;   // needle pivot — horizontal centre
const VU_CY  = VH - 12;  // needle pivot — near bottom of canvas
const VU_R   = 108;       // scale arc radius
const VU_AW  = 14;        // arc band stroke width

// Map VU value to angle (degrees from 12 o'clock, + = CW).
// Two-segment: -20→0 VU spans 100°; 0→+3 VU spans 30°.
function vuAngleDeg(vu) {
  return vu <= 0 ? -65 + (vu + 20) * 5 : 35 + vu * 10;
}
function vuAngleRad(vu) {
  return (vuAngleDeg(vu) - 90) * Math.PI / 180;
}

let vuCurrent  = -20;   // currently displayed VU level (animated)
let vuTarget   = -20;   // target level set each render frame
let vuFaceData = null;  // cached ImageData of the static meter face

const VU_MARKS = [
  { vu: -20, label: '-20', major: true  },
  { vu: -10, label: '-10', major: true  },
  { vu:  -7, label: '-7',  major: false },
  { vu:  -5, label: '-5',  major: true  },
  { vu:  -3, label: '-3',  major: false },
  { vu:  -2, label: '-2',  major: false },
  { vu:  -1, label: '',    major: false },
  { vu:   0, label: '0',   major: true  },
  { vu:  +1, label: '',    major: false },
  { vu:  +2, label: '+2',  major: false },
  { vu:  +3, label: '+3',  major: true  },
];

function drawVuFace() {
  const c = vuCtx;

  // Outer walnut frame
  c.fillStyle = '#2a1204';
  c.fillRect(0, 0, VW, VH);

  // Cream meter card
  const MX = 22, MY = 6, MW = VW - 44, MH = VH - 20;
  c.fillStyle = '#f0ebdf';
  c.beginPath(); c.roundRect(MX, MY, MW, MH, 3); c.fill();

  // Coloured scale arc bands
  c.lineCap   = 'butt';
  c.lineWidth = VU_AW;

  c.strokeStyle = '#1e8814';   // green: -20 → 0 VU
  c.beginPath();
  c.arc(VU_CX, VU_CY, VU_R, vuAngleRad(-20), vuAngleRad(0), false);
  c.stroke();

  c.strokeStyle = '#c88a00';   // amber: 0 → +2 VU
  c.beginPath();
  c.arc(VU_CX, VU_CY, VU_R, vuAngleRad(0), vuAngleRad(2), false);
  c.stroke();

  c.strokeStyle = '#cc2000';   // red: +2 → +3 VU
  c.beginPath();
  c.arc(VU_CX, VU_CY, VU_R, vuAngleRad(2), vuAngleRad(3), false);
  c.stroke();

  // Tick marks and labels
  c.lineCap = 'round';
  for (const m of VU_MARKS) {
    const a   = vuAngleRad(m.vu);
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const rOuter = VU_R + 5;
    const rInner = m.major ? VU_R - VU_AW - 12 : VU_R - VU_AW - 7;

    c.strokeStyle = m.vu >= 0 ? '#880800' : '#0e4a08';
    c.lineWidth   = m.major ? 2 : 1.5;
    c.beginPath();
    c.moveTo(VU_CX + rInner * cos, VU_CY + rInner * sin);
    c.lineTo(VU_CX + rOuter * cos, VU_CY + rOuter * sin);
    c.stroke();

    if (m.label) {
      const rL = VU_R - VU_AW - 25;
      c.font         = `bold ${m.major ? 9 : 8}px "Segoe UI", system-ui, sans-serif`;
      c.fillStyle    = m.vu >= 0 ? '#880800' : '#0e4a08';
      c.textAlign    = 'center';
      c.textBaseline = 'middle';
      c.fillText(m.label, VU_CX + rL * cos, VU_CY + rL * sin);
    }
  }

  // "VU" label
  c.font = 'bold 11px Georgia, serif';
  c.fillStyle    = '#4a2808';
  c.textAlign    = 'center';
  c.textBaseline = 'middle';
  c.fillText('VU', VU_CX + 36, VU_CY - 14);

  // Glass-glare overlay on the meter window
  const glare = c.createLinearGradient(MX, MY, MX, MY + MH * 0.4);
  glare.addColorStop(0,   'rgba(255,255,255,0.22)');
  glare.addColorStop(0.5, 'rgba(255,255,255,0.04)');
  glare.addColorStop(1,   'rgba(255,255,255,0)');
  c.fillStyle = glare;
  c.beginPath(); c.roundRect(MX, MY, MW, MH, 3); c.fill();

  // Corner screws (brass Phillips heads)
  for (const [sx, sy] of [
    [MX + 9,      MY + 9     ],
    [MX + MW - 9, MY + 9     ],
    [MX + 9,      MY + MH - 9],
    [MX + MW - 9, MY + MH - 9],
  ]) {
    c.fillStyle   = '#b8a080';
    c.strokeStyle = '#8a6040';
    c.lineWidth   = 1;
    c.beginPath(); c.arc(sx, sy, 4, 0, Math.PI * 2); c.fill(); c.stroke();
    c.strokeStyle = '#5a3a20';
    c.lineWidth   = 0.8;
    c.beginPath(); c.moveTo(sx - 2.5, sy); c.lineTo(sx + 2.5, sy); c.stroke();
    c.beginPath(); c.moveTo(sx, sy - 2.5); c.lineTo(sx, sy + 2.5); c.stroke();
  }

  // Cache the static face so we only putImageData to restore it before each needle draw
  vuFaceData = c.getImageData(0, 0, VW, VH);
}

function drawVuNeedle() {
  if (!vuFaceData) return;
  vuCtx.putImageData(vuFaceData, 0, 0);

  const a   = vuAngleRad(vuCurrent);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const nR  = VU_R + 3;

  // Drop shadow
  vuCtx.save();
  vuCtx.strokeStyle = 'rgba(0,0,0,0.18)';
  vuCtx.lineWidth   = 2.5;
  vuCtx.lineCap     = 'round';
  vuCtx.beginPath();
  vuCtx.moveTo(VU_CX + 1.5, VU_CY + 1.5);
  vuCtx.lineTo(VU_CX + 1.5 + nR * cos, VU_CY + 1.5 + nR * sin);
  vuCtx.stroke();

  // Needle
  vuCtx.strokeStyle = '#100500';
  vuCtx.lineWidth   = 1.5;
  vuCtx.beginPath();
  vuCtx.moveTo(VU_CX, VU_CY);
  vuCtx.lineTo(VU_CX + nR * cos, VU_CY + nR * sin);
  vuCtx.stroke();
  vuCtx.restore();

  // Pivot knob
  vuCtx.fillStyle   = '#7a3a10';
  vuCtx.strokeStyle = '#2e1000';
  vuCtx.lineWidth   = 1;
  vuCtx.beginPath();
  vuCtx.arc(VU_CX, VU_CY, 5, 0, Math.PI * 2);
  vuCtx.fill();
  vuCtx.stroke();
}

drawVuFace();
drawVuNeedle();

// ─── dB Scale ─────────────────────────────────────────────────────────────────
// Must match analyser.minDecibels / maxDecibels set during startCapture().
const SPEC_MIN_DB = -90;
const SPEC_MAX_DB = -10;
const DB_LEVELS   = [-80, -60, -40, -20]; // dB markers to display

// Draws horizontal reference lines with dB labels over the frequency spectrum.
// mode: 'bars' | 'mirror'
function drawDbScale(mode) {
  ctx.save();
  ctx.font        = '9px "Segoe UI", system-ui, sans-serif';
  ctx.lineWidth   = 1;
  ctx.strokeStyle = '#5a2e0e';
  ctx.fillStyle   = '#9a6830';

  for (const db of DB_LEVELS) {
    const norm = (db - SPEC_MIN_DB) / (SPEC_MAX_DB - SPEC_MIN_DB); // 0 → bottom, 1 → top

    if (mode === 'mirror') {
      const offset  = norm * (H / 2);
      const yTop    = H / 2 - offset;
      const yBottom = H / 2 + offset;
      for (const y of [yTop, yBottom]) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${db}`, 3, yTop);
    } else {
      const y = H * (1 - norm);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${db}`, 3, y - 1);
    }
  }
  ctx.restore();
}

function initPeaks(count) {
  peakValues = new Float32Array(count);
  peakDecay  = new Int32Array(count);
}

// ─── Spectrum: Draw Functions ─────────────────────────────────────────────────
function drawIdle() {
  ctx.fillStyle = '#150a02';
  ctx.fillRect(0, 0, W, H);
  drawDbScale('bars');
}

drawIdle();

function drawBars(dataArray) {
  ctx.fillStyle = '#150a02';
  ctx.fillRect(0, 0, W, H);

  const mode     = modeSelect.value;
  const usedBins = Math.floor(dataArray.length * 0.75);
  const barCount = 96;
  const gap      = 2;
  const barW     = (W - gap) / barCount - gap;
  let peak = 0;

  for (let i = 0; i < barCount; i++) {
    const startBin = Math.floor(Math.pow(i / barCount, 1.6) * usedBins);
    const endBin   = Math.floor(Math.pow((i + 1) / barCount, 1.6) * usedBins);
    let sum = 0;
    const count = Math.max(1, endBin - startBin);
    for (let b = startBin; b < endBin; b++) sum += dataArray[b];
    const avg        = sum / count;
    const normalized = avg / 255;
    const barH       = normalized * H;
    if (avg > peak) peak = avg;

    if (normalized * H > peakValues[i]) {
      peakValues[i] = normalized * H;
      peakDecay[i]  = PEAK_HOLD_FRAMES;
    } else {
      if (peakDecay[i] > 0) peakDecay[i]--;
      else peakValues[i] = Math.max(0, peakValues[i] - PEAK_DECAY_RATE);
    }

    const x = gap + i * (barW + gap);

    if (mode === 'mirror') {
      const halfH = H / 2;
      ctx.fillStyle = mirrorGradient;
      ctx.fillRect(x, halfH - barH / 2, barW, barH);
      if (peakValues[i] > 2) {
        ctx.fillStyle = 'rgba(240,200,100,0.75)';
        ctx.fillRect(x, halfH - peakValues[i] / 2 - 1, barW, 2);
        ctx.fillRect(x, halfH + peakValues[i] / 2 - 1, barW, 2);
      }
    } else {
      ctx.fillStyle = barGradient;
      ctx.fillRect(x, H - barH, barW, barH);
      if (peakValues[i] > 2) {
        ctx.fillStyle = 'rgba(240,200,100,0.85)';
        ctx.fillRect(x, H - peakValues[i] - 1, barW, 2);
      }
    }
  }

  // Draw dB scale on top of bars so labels are always legible
  drawDbScale(mode);

  peakLabel.textContent = `Peak: ${Math.round((peak / 255) * 100)}%`;
}

function render() {
  animId = requestAnimationFrame(render);
  if (!analyser) return;

  if (modeSelect.value === 'wave') {
    const td = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(td);
    ctx.fillStyle = '#150a02';
    ctx.fillRect(0, 0, W, H);
    // Zero-crossing reference line
    ctx.strokeStyle = '#5a2e0e';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.font = '9px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#9a6830';
    ctx.textBaseline = 'bottom';
    ctx.fillText('0', 3, H / 2 - 1);
    ctx.lineWidth   = 2;
    ctx.strokeStyle = '#d4901a';
    ctx.shadowColor = '#c87010';
    ctx.shadowBlur  = 8;
    ctx.beginPath();
    const sliceW = W / analyser.fftSize;
    let x = 0;
    for (let i = 0; i < analyser.fftSize; i++) {
      const y = (td[i] / 128.0) * H / 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      x += sliceW;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    peakLabel.textContent = 'Waveform';

    // VU level from time-domain RMS
    let rmsSum = 0;
    for (let i = 0; i < td.length; i++) {
      const s = (td[i] - 128) / 128;
      rmsSum += s * s;
    }
    const rms = Math.sqrt(rmsSum / td.length);
    vuTarget = Math.max(-20, Math.min(3, (rms > 0 ? 20 * Math.log10(rms) : -90) + 18));
  } else {
    const fd = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(fd);
    drawBars(fd);

    // VU level from average frequency-bin amplitude
    let binSum = 0;
    const usedBinsVu = Math.floor(fd.length * 0.75);
    for (let i = 0; i < usedBinsVu; i++) binSum += fd[i];
    const avgByte = binSum / usedBinsVu;
    const dBFSavg = (avgByte / 255) * (SPEC_MAX_DB - SPEC_MIN_DB) + SPEC_MIN_DB;
    vuTarget = Math.max(-20, Math.min(3, dBFSavg + 18));
  }

  // Ballistic smoothing: fast attack (~35% per frame), slow release (~5%)
  if (vuTarget > vuCurrent) vuCurrent += (vuTarget - vuCurrent) * 0.35;
  else                       vuCurrent += (vuTarget - vuCurrent) * 0.05;
  drawVuNeedle();
}

// ─── Tab Capture ──────────────────────────────────────────────────────────────
async function startCapture() {
  try {
    statusEl.textContent = 'Requesting audio capture…';
    const response = await chrome.runtime.sendMessage({ type: 'getStreamId' });
    if (response.error) { statusEl.textContent = `Error: ${response.error}`; return; }

    stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: response.streamId } },
      video: false,
    });

    audioCtx = new AudioContext();
    const tabSource = audioCtx.createMediaStreamSource(stream);

    // Build the 3-band EQ filter chain, seeding each filter with the
    // current knob position so EQ state is preserved across start/stop.
    for (const b of BANDS) {
      const f = audioCtx.createBiquadFilter();
      f.type            = b.type;
      f.frequency.value = b.freq;
      if (b.q !== null) f.Q.value = b.q;
      const db = angleToDb(angles[b.id]);
      f.gain.value = db <= KILL_DB ? -40 : db;
      filters[b.id] = f;
    }

    analyser = audioCtx.createAnalyser();
    analyser.fftSize              = 2048;
    analyser.smoothingTimeConstant = 0.8;
    analyser.minDecibels          = -90;
    analyser.maxDecibels          = -10;

    // Signal chain: tab → HIGH filter → MID filter → LOW filter → analyser → speakers
    tabSource.connect(filters.high);
    filters.high.connect(filters.mid);
    filters.mid.connect(filters.low);
    filters.low.connect(analyser);
    analyser.connect(audioCtx.destination);

    initPeaks(analyser.frequencyBinCount);
    statusEl.style.display = 'none';
    capturing = true;
    btn.textContent = 'Stop';
    btn.classList.add('active');
    render();
  } catch (err) {
    statusEl.textContent = `Failed: ${err.message}`;
  }
}

function stopCapture() {
  if (animId)   { cancelAnimationFrame(animId); animId = null; }
  if (stream)   { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  analyser = null;
  capturing = false;
  Object.keys(filters).forEach(k => delete filters[k]);

  btn.textContent = 'Start';
  btn.classList.remove('active');
  statusEl.style.display   = '';
  statusEl.textContent     = 'Click Start to begin capturing tab audio';
  peakLabel.textContent    = 'Peak: —';
  drawIdle();
}

btn.addEventListener('click', () => capturing ? stopCapture() : startCapture());

// ─── EQ: Helpers ──────────────────────────────────────────────────────────────
const clamp     = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// Two-segment mapping so 12 o'clock (0°) is always 0 dB (unity gain):
//   CCW half  -150° → 0°  :  MIN_DB (-40 dB) → 0 dB  (cut zone)
//   CW  half     0° → 150°:    0 dB → MAX_DB (+6 dB)  (boost zone)
const angleToDb = a => a <= 0
  ? (a / MIN_ANGLE) * MIN_DB   // 0° = 0 dB, -150° = -40 dB
  : (a / MAX_ANGLE) * MAX_DB;  // 0° = 0 dB, +150° = +6 dB

function formatDb(db) {
  if (db <= KILL_DB) return 'KILL';
  return (db >= 0 ? '+' : '') + db.toFixed(1) + ' dB';
}

// ─── EQ: SVG Arc Path ─────────────────────────────────────────────────────────
//
// Arc geometry: cx=40, cy=40, r=34 (inside the 80×80 SVG viewBox).
// Our 0° = 12 o'clock; SVG 0° = 3 o'clock → convert: svgDeg = knobDeg − 90.
// Track spans −150° to +150° (300° sweep, gap at the bottom).
//
function arcPoint(knobDeg) {
  const rad = (knobDeg - 90) * Math.PI / 180;
  return { x: 40 + 34 * Math.cos(rad), y: 40 + 34 * Math.sin(rad) };
}

function buildArcPath(angle) {
  const start = arcPoint(MIN_ANGLE);
  const end   = arcPoint(angle);
  const sweep = angle - MIN_ANGLE;   // 0 … 300 degrees

  if (sweep < 0.5) {
    // Kill position — no visible arc
    return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`;
  }

  const large = sweep > 180 ? 1 : 0;
  return (
    `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} ` +
    `A 34 34 0 ${large} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`
  );
}

// ─── EQ: Knob Update ──────────────────────────────────────────────────────────
function updateKnob(id, angle) {
  angles[id]   = angle;
  const db     = angleToDb(angle);
  const isKill = db <= KILL_DB;

  // Rotate the metal knob body
  document.getElementById(`knob-body-${id}`).style.transform = `rotate(${angle}deg)`;

  // Update the active SVG arc
  document.getElementById(`arc-fill-${id}`).setAttribute('d', buildArcPath(angle));

  // Update dB readout
  const label = document.getElementById(`db-${id}`);
  label.textContent = formatDb(db);
  label.classList.toggle('kill', isKill);

  // Apply to the live filter (if audio is running)
  if (filters[id]) {
    filters[id].gain.value = isKill ? -40 : db;
  }
}

// ─── EQ: Drag & Wheel Interaction ─────────────────────────────────────────────
//
// Drag vertically on a knob:  up → boost,  down → cut / kill.
// Sensitivity: 0.8 degrees per pixel.
// Double-click resets the band to 0 dB (unity).
//
let dragBand       = null;
let dragStartY     = 0;
let dragStartAngle = 0;

document.querySelectorAll('.knob-wrap').forEach(wrap => {
  const band = wrap.dataset.band;

  wrap.addEventListener('mousedown', e => {
    dragBand       = band;
    dragStartY     = e.clientY;
    dragStartAngle = angles[band];
    e.preventDefault();
  });

  wrap.addEventListener('dblclick', () => updateKnob(band, 0));

  wrap.addEventListener('wheel', e => {
    const delta = -e.deltaY * 0.5;
    updateKnob(band, clamp(angles[band] + delta, MIN_ANGLE, MAX_ANGLE));
    e.preventDefault();
  }, { passive: false });
});

document.addEventListener('mousemove', e => {
  if (!dragBand) return;
  const delta = (dragStartY - e.clientY) * 0.8;
  updateKnob(dragBand, clamp(dragStartAngle + delta, MIN_ANGLE, MAX_ANGLE));
});

document.addEventListener('mouseup', () => { dragBand = null; });

// ─── Init ─────────────────────────────────────────────────────────────────────
// Render knobs at 0 dB (12 o'clock) on load.
BANDS.forEach(b => updateKnob(b.id, 0));
