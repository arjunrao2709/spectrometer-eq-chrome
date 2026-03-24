'use strict';

// ─── EQ Band Definitions ───────────────────────────────────────────────────────
//
// THREE biquad filters modelled on a DJ mixer:
//   HIGH  – highshelf  @ 3.2 kHz
//   MID   – peaking    @ 1.0 kHz  (Q = 0.7)
//   LOW   – lowshelf   @ 320 Hz
//
const BANDS = [
  { id: 'high', type: 'highshelf', freq: 3200, q: null },
  { id: 'mid',  type: 'peaking',   freq: 1000, q: 0.7  },
  { id: 'low',  type: 'lowshelf',  freq: 320,  q: null },
];

const MIN_DB  = -40;
const MAX_DB  =   6;
const KILL_DB = -30;

// ─── Slider Geometry (must match CSS) ─────────────────────────────────────────
// Track height: 160px  Thumb height: 30px  Available drag range: 130px
// Two-segment mapping (centre = 0 dB):
//   top (thumbY=0)      → +6 dB (MAX_DB)
//   centre (thumbY=65)  →  0 dB
//   bottom (thumbY=130) → −40 dB (MIN_DB / kill)
const TRACK_H  = 160;
const THUMB_H  = 30;
const RANGE    = TRACK_H - THUMB_H;   // 130 px
const CENTER   = RANGE / 2;           // 65 px (= 0 dB)

function thumbTopToDb(top) {
  const t = Math.max(0, Math.min(RANGE, top));
  return t <= CENTER
    ? (1 - t / CENTER) * MAX_DB          // 0 → +6, CENTER → 0
    : -((t - CENTER) / CENTER) * (-MIN_DB); // CENTER → 0, RANGE → −40
}

function dbToThumbTop(db) {
  return db >= 0
    ? (1 - db / MAX_DB) * CENTER
    : CENTER + ((-db) / (-MIN_DB)) * CENTER;
}

// ─── DOM References ────────────────────────────────────────────────────────────
const canvas    = document.getElementById('canvas');
const ctx       = canvas.getContext('2d');
const btn       = document.getElementById('btn-capture');
const statusEl  = document.getElementById('status');
const peakLabel = document.getElementById('peak-label');
const modeSeg   = document.getElementById('mode-seg');

const W = canvas.width;
const H = canvas.height;

let currentMode = 'bars'; // 'bars' | 'wave'

// ─── Segmented Control ─────────────────────────────────────────────────────────
modeSeg.querySelectorAll('.seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    modeSeg.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentMode = btn.dataset.value;
    if (!capturing) drawIdle();
  });
});

// ─── Audio State ───────────────────────────────────────────────────────────────
let audioCtx  = null;
let analyser  = null;
let animId    = null;
let stream    = null;
let capturing = false;

const filters = {};

// Current slider thumb positions (px from top of track), preserved across start/stop
const thumbTops = { high: CENTER, mid: CENTER, low: CENTER };

// ─── Spectrum: Gradients & Peaks ──────────────────────────────────────────────
let barGradient    = null;
let mirrorGradient = null;
let peakValues     = null;
let peakDecay      = null;

const PEAK_HOLD_FRAMES = 30;
const PEAK_DECAY_RATE  = 1.5;

function buildGradients() {
  barGradient = ctx.createLinearGradient(0, H, 0, 0);
  barGradient.addColorStop(0.0, '#0a1a0a');
  barGradient.addColorStop(0.5, '#18a818');
  barGradient.addColorStop(0.75, '#d4b010');
  barGradient.addColorStop(0.9, '#e05010');
  barGradient.addColorStop(1.0, '#cc1010');
}

buildGradients();

// ─── dB Scale ─────────────────────────────────────────────────────────────────
const SPEC_MIN_DB = -90;
const SPEC_MAX_DB = -10;
const DB_LEVELS   = [-80, -60, -40, -20];

function drawDbScale() {
  ctx.save();
  ctx.font        = '9px "Segoe UI", system-ui, sans-serif';
  ctx.lineWidth   = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.fillStyle   = 'rgba(255,255,255,0.22)';

  for (const db of DB_LEVELS) {
    const norm = (db - SPEC_MIN_DB) / (SPEC_MAX_DB - SPEC_MIN_DB);
    const y    = H * (1 - norm);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${db}`, 4, y - 1);
  }
  ctx.restore();
}

function initPeaks(count) {
  peakValues = new Float32Array(count);
  peakDecay  = new Int32Array(count);
}

// ─── Spectrum: Draw Functions ──────────────────────────────────────────────────
function drawIdle() {
  ctx.fillStyle = '#141414';
  ctx.fillRect(0, 0, W, H);
  drawDbScale();
}

drawIdle();

function drawBars(dataArray) {
  ctx.fillStyle = '#141414';
  ctx.fillRect(0, 0, W, H);

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
    ctx.fillStyle = barGradient;
    ctx.fillRect(x, H - barH, barW, barH);
    if (peakValues[i] > 2) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(x, H - peakValues[i] - 1, barW, 2);
    }
  }

  drawDbScale();
  peakLabel.textContent = `Peak: ${Math.round((peak / 255) * 100)}%`;
}

function render() {
  animId = requestAnimationFrame(render);
  if (!analyser) return;

  if (currentMode === 'wave') {
    const td = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(td);
    ctx.fillStyle = '#141414';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.font = '9px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.textBaseline = 'bottom';
    ctx.fillText('0', 4, H / 2 - 1);
    ctx.lineWidth   = 2;
    ctx.strokeStyle = '#18c848';
    ctx.shadowColor = '#10a030';
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
  } else {
    const fd = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(fd);
    drawBars(fd);
  }
}

// ─── Tab Capture ───────────────────────────────────────────────────────────────
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

    for (const b of BANDS) {
      const f = audioCtx.createBiquadFilter();
      f.type            = b.type;
      f.frequency.value = b.freq;
      if (b.q !== null) f.Q.value = b.q;
      const db = thumbTopToDb(thumbTops[b.id]);
      f.gain.value = db <= KILL_DB ? -40 : db;
      filters[b.id] = f;
    }

    analyser = audioCtx.createAnalyser();
    analyser.fftSize               = 2048;
    analyser.smoothingTimeConstant = 0.8;
    analyser.minDecibels           = -90;
    analyser.maxDecibels           = -10;

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

// ─── EQ: Helpers ───────────────────────────────────────────────────────────────
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function formatDb(db) {
  if (db <= KILL_DB) return 'KILL';
  return (db >= 0 ? '+' : '') + db.toFixed(1);
}

// ─── EQ: Slider Update ─────────────────────────────────────────────────────────
function updateSlider(id, top) {
  const t      = clamp(top, 0, RANGE);
  const db     = thumbTopToDb(t);
  const isKill = db <= KILL_DB;

  thumbTops[id] = t;
  document.getElementById(`thumb-${id}`).style.top = `${t}px`;

  const label = document.getElementById(`db-${id}`);
  label.textContent = formatDb(db);
  label.classList.toggle('kill', isKill);

  if (filters[id]) {
    filters[id].gain.value = isKill ? -40 : db;
  }
}

// ─── EQ: Drag & Wheel Interaction ──────────────────────────────────────────────
let dragBand     = null;
let dragStartY   = 0;
let dragStartTop = 0;

document.querySelectorAll('.band-wrap').forEach(wrap => {
  const band  = wrap.dataset.band;
  const track = document.getElementById(`track-${band}`);

  track.addEventListener('mousedown', e => {
    dragBand     = band;
    dragStartY   = e.clientY;
    dragStartTop = thumbTops[band];
    e.preventDefault();
  });

  track.addEventListener('dblclick', () => updateSlider(band, CENTER));

  track.addEventListener('wheel', e => {
    const delta = e.deltaY * 0.4;
    updateSlider(band, clamp(thumbTops[band] + delta, 0, RANGE));
    e.preventDefault();
  }, { passive: false });
});

document.addEventListener('mousemove', e => {
  if (!dragBand) return;
  updateSlider(dragBand, clamp(dragStartTop + (e.clientY - dragStartY), 0, RANGE));
});

document.addEventListener('mouseup', () => { dragBand = null; });

// ─── Init ──────────────────────────────────────────────────────────────────────
BANDS.forEach(b => updateSlider(b.id, CENTER));
