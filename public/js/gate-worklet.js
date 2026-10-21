// AudioWorklet: измеряет уровень микрофона и пропускает звук по режиму
// (голосовая активация, push-to-talk или всегда открыт). Работает в аудиопотоке,
// поэтому не зависит от того, что вкладка в фоне.
class MicGateProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mode = 'vad'; // 'vad' | 'ptt' | 'open'
    this.threshold = -50; // дБ
    this.holdMs = 300;
    this.pttReleaseMs = 150;
    this.muted = false;
    this.pttDown = false;
    this.pttReleasedAt = -1;
    this.lastLoudAt = -1e9;
    this.gain = 0;
    this.levelDb = -100;
    this.peakDb = -100;
    this.blocks = 0;
    this.port.onmessage = (e) => Object.assign(this, e.data);
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    const ch = input && input[0];
    const nowMs = (currentFrame / sampleRate) * 1000;

    let sum = 0;
    if (ch) for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
    const rms = ch ? Math.sqrt(sum / ch.length) : 0;
    const db = rms > 1e-6 ? 20 * Math.log10(rms) : -100;
    // Быстрая атака, медленный спад — так индикатор и детектор не «дрожат».
    this.levelDb = db > this.levelDb ? db : this.levelDb * 0.9 + db * 0.1;
    if (db > this.peakDb) this.peakDb = db;

    let open;
    if (this.muted) open = false;
    else if (this.mode === 'open') open = true;
    else if (this.mode === 'ptt') {
      if (this.pttDown) {
        open = true;
        this.pttReleasedAt = -1;
      } else {
        if (this.pttReleasedAt < 0) this.pttReleasedAt = nowMs;
        open = nowMs - this.pttReleasedAt < this.pttReleaseMs && this.gain > 0;
      }
    } else {
      if (this.levelDb >= this.threshold) this.lastLoudAt = nowMs;
      open = nowMs - this.lastLoudAt < this.holdMs;
    }

    // Плавное открытие/закрытие без щелчков: ~3 мс атака, ~25 мс спад.
    const target = open ? 1 : 0;
    const coef = open ? 0.06 : 0.008;
    for (let c = 0; c < output.length; c++) {
      const src = input && (input[c] || input[0]);
      const out = output[c];
      let g = this.gain;
      for (let i = 0; i < out.length; i++) {
        g += (target - g) * coef;
        out[i] = src ? src[i] * g : 0;
      }
      if (c === output.length - 1) this.gain = g;
    }

    if (++this.blocks >= 8) {
      this.blocks = 0;
      this.port.postMessage({ level: this.levelDb, peak: this.peakDb, open });
      this.peakDb = -100;
    }
    return true;
  }
}

registerProcessor('mic-gate', MicGateProcessor);
