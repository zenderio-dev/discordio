import { NS_MODES } from '../audio.js';

const DEFAULTS = {
  inputDeviceId: '',
  outputDeviceId: '',
  cameraDeviceId: '',
  inputVolume: 100,
  nsMode: 'rnnoise',
  echoCancellation: true,
  autoGainControl: true,
  mode: 'vad',
  threshold: -50,
  holdMs: 300,
  pttKey: 'KeyV',
  pttReleaseMs: 200,
  screenQuality: '720p30',
  notify: true,
  sounds: true,
  voice: true,
  voiceVolume: 80,
};

const store = {
  get(key, def) {
    try {
      const v = localStorage.getItem('discordio.' + key);
      return v == null ? def : JSON.parse(v);
    } catch {
      return def;
    }
  },
  set(key, v) {
    try {
      localStorage.setItem('discordio.' + key, JSON.stringify(v));
    } catch {}
  },
};

const settings = { ...DEFAULTS, ...store.get('settings', {}) };

const peerVolumes = store.get('volumes2', {});

const peerMuted = store.get('mutedPeers2', {});

const SCREEN_PRESETS = {
  '720p30': { width: 1280, height: 720, frameRate: 30, bitrate: 1_500_000, hint: 'detail' },
  '1080p30': { width: 1920, height: 1080, frameRate: 30, bitrate: 3_000_000, hint: 'detail' },
  '1080p60': { width: 1920, height: 1080, frameRate: 60, bitrate: 6_000_000, hint: 'motion' },
};

const CAMERA = { width: 640, height: 360, frameRate: 24, bitrate: 450_000 };

export { CAMERA, SCREEN_PRESETS, peerMuted, peerVolumes, settings, store };

// Bind handlers only after every feature module has been loaded.
export function initPreferences() {
  if (!(settings.nsMode in NS_MODES)) settings.nsMode = DEFAULTS.nsMode;
}
