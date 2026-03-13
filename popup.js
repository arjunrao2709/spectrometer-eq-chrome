'use strict';

// ─── EQ Band Definitions ──────────────────────────────────────────────────────
//
// DJ rotary mixer EQ uses three shelf/peaking filters:
//   HIGH  – highshelf  at 3.2 kHz  (treble)
//   MID   – peaking    at 1.0 kHz  (mids, Q=0.7 for one-octave width)
//   LOW   – lowshelf   at 320 Hz   (bass)
//
// Each knob sweeps −150° (kill / −40 dB) to +150° (boost / +6 dB).
// The 12 o'clock position is always 0 dB (unity gain).
// Turning below −30 dB is treated as a "kill" (displayed as KILL).
//
const BANDS = [
  { id: 'high', label: 'HIGH', type: 'highshelf', freq: 3200, q: null, color: '#ff6633' },
  { id: 'mid',  label: 'MID',  type: 'peaking',   freq: 1000, q: 0.7,  color: '#ffcc00' },
  { id: 'low',  label: 'LOW',  type: 'lowshelf',  freq: 320,  q: null, color: '#3399ff' },
];

// ─── Knob Range ───────────────────────────────────────────────────────────────
const MIN_ANGLE = -150;   // degrees, counter-clockwise extreme (kill)
const MAX_ANGLE =  150;   // degrees, clockwise extreme (max boost)
const MIN_DB    =  -40;   // dB at MIN_ANGLE  (functionally silent)
const MAX_DB    =    6;   // dB at MAX_ANGLE
const KILL_DB   =  -30;   // threshold below which we label "KILL"

// ─── State ────────────────────────────────────────────────────────────────────
let audioCtx   = null;
let analyser   = null;
let source     = null;    // MediaElementSource or MediaStreamSource
let animId     = null;
let running    = false;
let sourceMode = null;    // 'file' | 'mic'
let audioEl    = null;    // HTMLAudioElement (file mode only)

const filters = {};                              // band id → BiquadFilterNode
const angles  = { high: 0, mid: 0, low: 0 };   // current knob angles (degrees)

// Drag tracking
let dragBand       = null;
let dragStartY     = 0;
let dragStartAngle = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const clamp      = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const angleToDb  = a => MIN_DB + (a - MIN_ANGLE) / (MAX_ANGLE - MIN_ANGLE) * (MAX_DB - MIN_DB);

function formatDb(db) {
  if (db <= KILL_DB) return 'KILL';
  return (db >= 0 ? '+' : '') + db.toFixed(1) + ' dB';
}

// ─── Arc Path Calculation ─────────────────────────────────────────────────────
//
// Coordinate system used for the SVG:
//   - SVG 0° = 3 o'clock, increases clockwise
//   - Our knob 0° = 12 o'clock, increases clockwise
//   - Conversion: svgDeg = knobDeg − 90
//
// Arc center (cx,cy) = (40,40), radius r = 34
// Minimum position (−150°): SVG angle = −240° ≡ 120° → point (23.0, 69.44)
// Maximum position (+150°): SVG angle =   60°          → point (57.0, 69.44)
//
function arcPoint(knobDeg) {
  const rad = (knobDeg - 90) * Math.PI / 180;
  return {
    x: 40 + 34 * Math.cos(rad),
    y: 40 + 34 * Math.sin(rad),
  };
}

function buildArcPath(angle) {
  const start  = arcPoint(MIN_ANGLE);
  const end    = arcPoint(angle);
  const sweep  = angle - MIN_ANGLE;   // 0 … 300 degrees

  if (sweep < 0.5) {
    // Kill position – render nothing (move only, no arc)
    return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`;
  }

  const largeArc = sweep > 180 ? 1 : 0;
  return (
    `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} ` +
    `A 34 34 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`
  );
}

// ─── Knob Update ─────────────────────────────────────────────────────────────
function updateKnob(id, angle) {
  angles[id]   = angle;
  const db     = angleToDb(angle);
  const isKill = db <= KILL_DB;

  // 1. Rotate knob body (the metal circle with pip)
  document.getElementById(`knob-body-${id}`).style.transform = `rotate(${angle}deg)`;

  // 2. Update active arc (SVG fill path)
  document.getElementById(`arc-fill-${id}`).setAttribute('d', buildArcPath(angle));

  // 3. Update dB label
  const label = document.getElementById(`db-${id}`);
  label.textContent = formatDb(db);
  label.classList.toggle('kill', isKill);

  // 4. Apply to Web Audio filter
  if (filters[id]) {
    // At kill the filter gain goes to −40 dB which is ~0.01 linear – effectively silent.
    filters[id].gain.value = isKill ? -40 : db;
  }
}

// ─── Audio Teardown ───────────────────────────────────────────────────────────
function teardown() {
  running = false;
  if (animId)  { cancelAnimationFrame(animId); animId = null; }
  if (source)  { source.disconnect(); source = null; }
  if (audioEl) { audioEl.pause(); audioEl = null; }
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  analyser  = null;
  sourceMode = null;
  Object.keys(filters).forEach(k => delete filters[k]);

  clearCanvas();
  document.getElementById('status').textContent = 'OFF';
  document.getElementById('status').classList.remove('live');
  document.getElementById('btn-play').disabled = true;
  document.getElementById('btn-play').textContent = 'PLAY';
  document.getElementById('btn-play').classList.remove('active');
  document.getElementById('btn-mic').classList.remove('active');
}

// ─── Audio Initialisation (shared) ────────────────────────────────────────────
function createAudioGraph() {
  audioCtx = new AudioContext();

  // Build the three biquad filters
  for (const b of BANDS) {
    const f = audioCtx.createBiquadFilter();
    f.type            = b.type;
    f.frequency.value = b.freq;
    f.gain.value      = angleToDb(angles[b.id]);  // restore current knob position
    if (b.q !== null) f.Q.value = b.q;
    filters[b.id] = f;
  }

  // Re-apply current knob values to filters
  BANDS.forEach(b => {
    if (filters[b.id]) {
      const db = angleToDb(angles[b.id]);
      filters[b.id].gain.value = db <= KILL_DB ? -40 : db;
    }
  });

  // Analyser
  analyser = audioCtx.createAnalyser();
  analyser.fftSize              = 2048;
  analyser.smoothingTimeConstant = 0.8;
}

// Signal chain: source → HIGH filter → MID filter → LOW filter → analyser (→ destination)
function connectChain(connectToDestination) {
  source.connect(filters.high);
  filters.high.connect(filters.mid);
  filters.mid.connect(filters.low);
  filters.low.connect(analyser);
  if (connectToDestination) {
    analyser.connect(audioCtx.destination);
  }
}

// ─── File Mode ────────────────────────────────────────────────────────────────
function startFileMode(file) {
  teardown();
  createAudioGraph();

  audioEl = new Audio();
  audioEl.src  = URL.createObjectURL(file);
  audioEl.loop = true;

  source = audioCtx.createMediaElementSource(audioEl);
  connectChain(true);   // connect to speakers so we can hear the EQ

  running = true;
  sourceMode = 'file';
  renderSpectrum();

  document.getElementById('status').textContent = 'FILE';
  document.getElementById('status').classList.add('live');

  const playBtn = document.getElementById('btn-play');
  playBtn.disabled  = false;
  playBtn.textContent = 'PLAY';
  playBtn.classList.remove('active');
}

function togglePlayback() {
  if (!audioEl) return;
  const btn = document.getElementById('btn-play');
  if (audioEl.paused) {
    audioCtx.resume().then(() => audioEl.play());
    btn.textContent = 'PAUSE';
    btn.classList.add('active');
  } else {
    audioEl.pause();
    btn.textContent = 'PLAY';
    btn.classList.remove('active');
  }
}

// ─── Mic Mode ─────────────────────────────────────────────────────────────────
async function toggleMic() {
  if (sourceMode === 'mic') {
    teardown();
    document.getElementById('btn-mic').classList.remove('active');
    return;
  }

  teardown();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    createAudioGraph();
    source = audioCtx.createMediaStreamSource(stream);
    connectChain(false);   // do NOT route mic to speakers (feedback!)

    running = true;
    sourceMode = 'mic';
    renderSpectrum();

    document.getElementById('status').textContent = 'MIC';
    document.getElementById('status').classList.add('live');
    document.getElementById('btn-mic').classList.add('active');
  } catch (err) {
    const label = err.name === 'NotAllowedError' ? 'MIC DENIED' : 'ERROR';
    document.getElementById('status').textContent = label;
  }
}

// ─── Spectrum Renderer ────────────────────────────────────────────────────────
function clearCanvas() {
  const canvas = document.getElementById('spectrum');
  const ctx    = canvas.getContext('2d');
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function renderSpectrum() {
  if (!running || !analyser) return;

  const canvas = document.getElementById('spectrum');
  const ctx    = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const bufLen = analyser.frequencyBinCount;
  const data   = new Uint8Array(bufLen);
  analyser.getByteFrequencyData(data);

  // Background
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, W, H);

  // Subtle horizontal grid
  ctx.strokeStyle = '#0f0f0f';
  ctx.lineWidth   = 1;
  for (let i = 1; i < 4; i++) {
    const y = Math.round(i * H / 4) + 0.5;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // Frequency bars on a logarithmic scale (20 Hz → 20 kHz)
  const N       = 128;
  const barW    = W / N;
  const nyquist = audioCtx.sampleRate / 2;

  for (let i = 0; i < N; i++) {
    const t    = i / N;
    const freq = 20 * Math.pow(1000, t);         // log scale: 20 Hz to 20 kHz
    const bin  = Math.round(freq / nyquist * bufLen);
    const val  = data[Math.min(bin, bufLen - 1)] / 255;
    const bh   = val * (H - 14);                 // leave room for labels

    if (bh < 1) continue;

    // Colour by band
    let color;
    if      (freq < 320)  color = '#3399ff';     // LOW  – blue
    else if (freq < 3200) color = '#ffcc00';     // MID  – yellow
    else                  color = '#ff6633';     // HIGH – orange

    const x    = Math.round(i * barW);
    const barH = Math.ceil(bh);

    const grad = ctx.createLinearGradient(0, H - 14 - barH, 0, H - 14);
    grad.addColorStop(0, color);
    grad.addColorStop(1, color + '18');
    ctx.fillStyle = grad;
    ctx.fillRect(x, H - 14 - barH, Math.max(1, barW - 1), barH);
  }

  // Crossover marker lines (vertical dashed) – show where LOW/MID/HIGH split
  const crossovers = [
    { freq: 320,  label: '320Hz' },
    { freq: 3200, label: '3.2k'  },
  ];
  ctx.setLineDash([2, 4]);
  ctx.strokeStyle = '#2a2a2a';
  ctx.lineWidth   = 1;
  for (const co of crossovers) {
    const t = Math.log(co.freq / 20) / Math.log(1000);
    const x = Math.round(t * W) + 0.5;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H - 14); ctx.stroke();
  }
  ctx.setLineDash([]);

  // Frequency axis labels
  const freqLabels = [
    [20, '20'],
    [100, '100'],
    [320, '320'],
    [1000, '1k'],
    [3200, '3.2k'],
    [10000, '10k'],
    [20000, '20k'],
  ];
  ctx.fillStyle  = '#2e2e2e';
  ctx.font       = '8px monospace';
  ctx.textAlign  = 'center';
  for (const [freq, lbl] of freqLabels) {
    const t = Math.log(freq / 20) / Math.log(1000);
    ctx.fillText(lbl, t * W, H - 3);
  }

  animId = requestAnimationFrame(renderSpectrum);
}

// ─── Drag Interaction ─────────────────────────────────────────────────────────
//
// Vertical drag on a .knob-wrap controls the rotary position:
//   drag up   → clockwise  → boost
//   drag down → counter-clockwise → cut / kill
//
// Sensitivity: 0.8 degrees per pixel of vertical movement.
//
document.querySelectorAll('.knob-wrap').forEach(wrap => {
  const band = wrap.dataset.band;

  wrap.addEventListener('mousedown', e => {
    dragBand       = band;
    dragStartY     = e.clientY;
    dragStartAngle = angles[band];
    e.preventDefault();
  });

  // Double-click → reset to 0 dB
  wrap.addEventListener('dblclick', () => updateKnob(band, 0));

  // Mouse wheel for fine control
  wrap.addEventListener('wheel', e => {
    const delta = -e.deltaY * 0.5;          // scale scroll speed to degrees
    updateKnob(band, clamp(angles[band] + delta, MIN_ANGLE, MAX_ANGLE));
    e.preventDefault();
  }, { passive: false });
});

document.addEventListener('mousemove', e => {
  if (!dragBand) return;
  const delta    = (dragStartY - e.clientY) * 0.8;
  const newAngle = clamp(dragStartAngle + delta, MIN_ANGLE, MAX_ANGLE);
  updateKnob(dragBand, newAngle);
});

document.addEventListener('mouseup', () => { dragBand = null; });

// ─── Button Wiring ────────────────────────────────────────────────────────────
document.getElementById('btn-file').addEventListener('click', () => {
  document.getElementById('file-input').click();
});

document.getElementById('file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) startFileMode(file);
  e.target.value = ''; // allow re-selecting the same file
});

document.getElementById('btn-mic').addEventListener('click', toggleMic);

document.getElementById('btn-play').addEventListener('click', togglePlayback);

// ─── Initialise Knobs ─────────────────────────────────────────────────────────
// Set every knob to 0 dB (12 o'clock) on load and render the initial arc state.
BANDS.forEach(b => updateKnob(b.id, 0));
clearCanvas();
