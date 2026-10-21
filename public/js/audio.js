// Цепочка обработки микрофона:
// getUserMedia (эхо/АРУ/шумодав браузера) -> [RNNoise] -> громкость -> гейт -> отправка.
// Выходной трек (this.track) не меняется при смене устройства или шумодава,
// поэтому соединения с друзьями не нужно пересогласовывать.

const NS_BASE = '/vendor/nsup';

export const NS_MODES = {
  off: 'Выключено',
  browser: 'Встроенное в браузер',
  rnnoise: 'RNNoise (нейросеть, рекомендуется)',
};

let nsLib = null;
const loadLib = () => (nsLib ||= import(`${NS_BASE}/index.js`));

export class MicPipeline {
  constructor() {
    this.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    this.dest = this.ctx.createMediaStreamDestination();
    this.stream = this.dest.stream;
    this.track = this.stream.getAudioTracks()[0];
    this.inputGain = this.ctx.createGain();
    this.raw = null;
    this.source = null;
    this.nsNode = null;
    this.gate = null;
    this.applied = {};
    this.wasm = {};
    this.workletsLoaded = new Set();
    this.onLevel = () => {};
    this.onWarning = () => {};
  }

  async init() {
    await this.ctx.audioWorklet.addModule('/js/gate-worklet.js');
    this.gate = new AudioWorkletNode(this.ctx, 'mic-gate', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    this.gate.port.onmessage = (e) => this.onLevel(e.data);
    this.inputGain.connect(this.gate);
    this.gate.connect(this.dest);
  }

  async resume() {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  setGate(params) {
    this.gate?.port.postMessage(params);
  }

  async apply(s) {
    const needMic =
      !this.raw ||
      this.applied.inputDeviceId !== s.inputDeviceId ||
      this.applied.echoCancellation !== s.echoCancellation ||
      this.applied.autoGainControl !== s.autoGainControl ||
      (this.applied.nsMode === 'browser') !== (s.nsMode === 'browser');
    const needNs = needMic || this.applied.nsMode !== s.nsMode;

    if (needMic) await this.openMic(s);
    if (needNs) await this.buildChain(s.nsMode);
    this.inputGain.gain.setTargetAtTime(s.inputVolume / 100, this.ctx.currentTime, 0.02);
    this.setGate({
      mode: s.mode,
      threshold: s.threshold,
      holdMs: s.holdMs,
      pttReleaseMs: s.pttReleaseMs,
    });
    this.applied = { ...s };
  }

  async openMic(s) {
    const audio = {
      echoCancellation: s.echoCancellation,
      autoGainControl: s.autoGainControl,
      noiseSuppression: s.nsMode === 'browser',
      channelCount: 1,
      sampleRate: 48000,
    };
    if (s.inputDeviceId) audio.deviceId = { exact: s.inputDeviceId };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio });
    } catch (e) {
      if (e.name === 'OverconstrainedError' && s.inputDeviceId) {
        // Устройство отключили — берём микрофон по умолчанию.
        delete audio.deviceId;
        stream = await navigator.mediaDevices.getUserMedia({ audio });
        this.onWarning('Выбранный микрофон не найден, использую микрофон по умолчанию');
      } else {
        throw e;
      }
    }
    this.raw?.getTracks().forEach((t) => t.stop());
    this.source?.disconnect();
    this.raw = stream;
    this.source = this.ctx.createMediaStreamSource(stream);
    stream.getAudioTracks()[0].addEventListener('ended', () => {
      this.onWarning('Микрофон отключился. Выбери другой в настройках.');
    });
  }

  async buildChain(mode) {
    this.source.disconnect();
    if (this.nsNode) {
      this.nsNode.disconnect();
      this.nsNode.destroy?.();
      this.nsNode = null;
    }
    if (mode === 'rnnoise') {
      try {
        this.nsNode = await this.createNsNode();
      } catch (e) {
        console.error(e);
        this.onWarning(`Не удалось включить RNNoise: ${e.message}`);
      }
    }
    if (this.nsNode) {
      this.source.connect(this.nsNode);
      this.nsNode.connect(this.inputGain);
    } else {
      this.source.connect(this.inputGain);
    }
  }

  async createNsNode() {
    const lib = await loadLib();
    this.wasm.rnnoise ||= await lib.loadRnnoise({
      url: `${NS_BASE}/rnnoise.wasm`,
      simdUrl: `${NS_BASE}/rnnoise_simd.wasm`,
    });
    await this.addWorklet(`${NS_BASE}/rnnoise/workletProcessor.js`);
    return new lib.RnnoiseWorkletNode(this.ctx, { maxChannels: 1, wasmBinary: this.wasm.rnnoise });
  }

  async addWorklet(url) {
    if (this.workletsLoaded.has(url)) return;
    await this.ctx.audioWorklet.addModule(url);
    this.workletsLoaded.add(url);
  }

  async setOutputDevice(deviceId) {
    // Для системных звуков (вход/выход участников).
    if (this.ctx.setSinkId) {
      try {
        await this.ctx.setSinkId(deviceId || '');
      } catch {}
    }
  }

  // Короткий сигнал для событий комнаты.
  beep(freqs, duration = 0.09, volume = 0.08) {
    const t0 = this.ctx.currentTime;
    freqs.forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.frequency.value = f;
      const start = t0 + i * duration;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(volume, start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(g).connect(this.ctx.destination);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    });
  }

  close() {
    this.raw?.getTracks().forEach((t) => t.stop());
    this.track.stop();
    this.ctx.close();
  }
}
