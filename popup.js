const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const btn = document.getElementById('btn-capture');
const statusEl = document.getElementById('status');
const peakLabel = document.getElementById('peak-label');
const modeSelect = document.getElementById('mode-select');

const W = canvas.width;
const H = canvas.height;

let audioCtx = null, analyser = null, animId = null, stream = null, capturing = false;
let barGradient = null, mirrorGradient = null;
let peakValues = null, peakDecay = null;
const PEAK_HOLD_FRAMES = 30;
const PEAK_DECAY_RATE = 1.5;

function buildGradients() {
  barGradient = ctx.createLinearGradient(0, H, 0, 0);
  barGradient.addColorStop(0.0, '#1a0a3a');
  barGradient.addColorStop(0.3, '#3b1fa8');
  barGradient.addColorStop(0.6, '#a020f0');
  barGradient.addColorStop(0.8, '#ff2080');
  barGradient.addColorStop(1.0, '#ff8040');

  mirrorGradient = ctx.createLinearGradient(0, 0, 0, H);
  mirrorGradient.addColorStop(0.0, '#ff8040');
  mirrorGradient.addColorStop(0.2, '#ff2080');
  mirrorGradient.addColorStop(0.5, '#a020f0');
  mirrorGradient.addColorStop(1.0, '#3b1fa8');
}

buildGradients();

function initPeaks(count) {
  peakValues = new Float32Array(count);
  peakDecay = new Int32Array(count);
}

function drawIdle() {
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#111122';
  ctx.lineWidth = 1;
  for (let y = 0; y < H; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
}

drawIdle();

function drawBars(dataArray) {
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#111122';
  ctx.lineWidth = 1;
  for (let y = 0; y < H; y += 44) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  const mode = modeSelect.value;
  const usedBins = Math.floor(dataArray.length * 0.75);
  const barCount = 96;
  const gap = 2;
  const barW = (W - gap) / barCount - gap;
  let peak = 0;

  for (let i = 0; i < barCount; i++) {
    const startBin = Math.floor(Math.pow(i / barCount, 1.6) * usedBins);
    const endBin = Math.floor(Math.pow((i + 1) / barCount, 1.6) * usedBins);
    let sum = 0;
    const count = Math.max(1, endBin - startBin);
    for (let b = startBin; b < endBin; b++) sum += dataArray[b];
    const avg = sum / count;
    const normalized = avg / 255;
    const barH = normalized * H;
    if (avg > peak) peak = avg;

    if (normalized * H > peakValues[i]) {
      peakValues[i] = normalized * H;
      peakDecay[i] = PEAK_HOLD_FRAMES;
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
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillRect(x, halfH - peakValues[i] / 2 - 1, barW, 2);
        ctx.fillRect(x, halfH + peakValues[i] / 2 - 1, barW, 2);
      }
    } else {
      ctx.fillStyle = barGradient;
      ctx.fillRect(x, H - barH, barW, barH);
      if (peakValues[i] > 2) {
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillRect(x, H - peakValues[i] - 1, barW, 2);
      }
    }
  }

  peakLabel.textContent = `Peak: ${Math.round((peak / 255) * 100)}%`;
}

function render() {
  animId = requestAnimationFrame(render);
  if (!analyser) return;

  if (modeSelect.value === 'wave') {
    const td = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(td);
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#111122';
    ctx.lineWidth = 1;
    for (let y = 0; y < H; y += 44) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#a020f0';
    ctx.shadowColor = '#a020f0';
    ctx.shadowBlur = 8;
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
    const source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    analyser.minDecibels = -90;
    analyser.maxDecibels = -10;
   source.connect(analyser);
   source.connect(audioCtx.destination); // Route audio back to speakers

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
  if (animId) { cancelAnimationFrame(animId); animId = null; }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  analyser = null;
  capturing = false;
  btn.textContent = 'Start';
  btn.classList.remove('active');
  statusEl.style.display = '';
  statusEl.textContent = 'Click Start to begin capturing audio';
  peakLabel.textContent = 'Peak: —';
  drawIdle();
}

btn.addEventListener('click', () => capturing ? stopCapture() : startCapture());


