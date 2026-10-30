import { NS_MODES } from '../audio.js';
import { $, desktop } from '../core/dom.js';
import { settings } from '../core/preferences.js';
import { local, peers, state } from '../core/state.js';
import { keyLabel, paintAvatar, saveSettings, say, warn } from '../ui/feedback.js';
import { ensureMic } from '../media/microphone.js';
import { startCamera, stopCamera } from '../media/streams.js';
import { setPtt, syncDesktopPtt, updateControls } from '../ui/controls.js';
import { micErrorText } from '../rooms/index.js';

let testEl = null;

async function refreshDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const fill = (sel, kind, current, fallback) => {
    const list = devices.filter((d) => d.kind === kind && d.deviceId !== 'communications');
    sel.innerHTML = '';
    for (const d of list) {
      sel.append(new Option(d.label || fallback, d.deviceId === 'default' ? '' : d.deviceId));
    }
    if (!list.some((d) => d.deviceId === 'default')) sel.prepend(new Option('По умолчанию', ''));
    sel.value = current;
    if (sel.value !== current) sel.value = '';
  };
  fill($('#s-input'), 'audioinput', settings.inputDeviceId, 'Микрофон');
  fill($('#s-output'), 'audiooutput', settings.outputDeviceId, 'Динамики');
  fill($('#s-camera'), 'videoinput', settings.cameraDeviceId, 'Камера');
  const canSink = 'setSinkId' in HTMLMediaElement.prototype;
  $('#s-output').disabled = !canSink;
  $('#s-output-note').hidden = canSink;
}

function fillSettingsForm() {
  const ns = $('#s-ns');
  ns.innerHTML = '';
  for (const [k, v] of Object.entries(NS_MODES)) ns.append(new Option(v, k));
  ns.value = settings.nsMode;
  $('#s-volume').value = settings.inputVolume;
  $('#s-volume-val').textContent = settings.inputVolume + '%';
  $('#s-echo').checked = settings.echoCancellation;
  $('#s-agc').checked = settings.autoGainControl;
  document.querySelector(`#s-mode input[value=${settings.mode}]`).checked = true;
  $('#s-threshold').value = settings.threshold;
  $('#s-threshold-val').textContent = settings.threshold + ' дБ';
  $('#s-meter-mark').style.left = ((settings.threshold + 80) / 80) * 100 + '%';
  $('#s-ptt-key').textContent = keyLabel(settings.pttKey);
  $('#s-ptt-release').value = settings.pttReleaseMs;
  $('#s-ptt-release-val').textContent = settings.pttReleaseMs + ' мс';
  $('#s-screen').value = settings.screenQuality;
  $('#s-notify').checked = settings.notify;
  $('#s-sounds').checked = settings.sounds;
  $('#s-voice').checked = settings.voice;
  $('#s-voice-volume').value = settings.voiceVolume;
  $('#s-voice-volume-val').textContent = settings.voiceVolume + '%';
  $('#s-voice-block').hidden = !settings.voice;
  $('#s-vad-block').hidden = settings.mode !== 'vad';
  $('#s-ptt-block').hidden = settings.mode !== 'ptt';
  $('#s-ptt-hint').textContent = desktop
    ? 'Клавиша работает везде, даже когда ты в игре.'
    : 'В браузере клавиша работает, только пока окно активно. В приложении для Windows — везде, даже в игре.';
  paintAvatar($('#s-avatar'), state.me?.name || '?', state.me?.avatar);
  $('#s-name').value = state.me?.name || '';
  $('#s-name').disabled = !state.me;
}

async function openSettings() {
  try {
    await ensureMic();
  } catch (e) {
    return alert(micErrorText(e));
  }
  fillSettingsForm();
  await refreshDevices();
  state.mic.setGate({ report: true });
  $('#settings').showModal();
}

let applyTimer;

function applySettings(immediate) {
  saveSettings();
  fillSettingsForm();
  updateControls();
  syncDesktopPtt();
  clearTimeout(applyTimer);
  applyTimer = setTimeout(
    async () => {
      try {
        await state.mic?.apply(settings);
      } catch (e) {
        warn(micErrorText(e));
      }
    },
    immediate ? 0 : 120
  );
}

function stopTest() {
  if (!testEl) return;
  testEl.srcObject = null;
  testEl = null;
  $('#s-test').classList.remove('on');
  $('#s-test').textContent = 'Проверить микрофон';
}

export { openSettings };

// Bind handlers only after every feature module has been loaded.
export function initSettings() {
  navigator.mediaDevices?.addEventListener?.('devicechange', () => {
    if ($('#settings').open) refreshDevices();
  });

  $('#s-input').onchange = (e) => {
    settings.inputDeviceId = e.target.value;
    applySettings(true);
  };

  $('#s-output').onchange = async (e) => {
    settings.outputDeviceId = e.target.value;
    saveSettings();
    for (const p of peers.values())
      for (const el of p.audioEls.values()) el.setSinkId?.(settings.outputDeviceId).catch(() => {});
    testEl?.setSinkId?.(settings.outputDeviceId).catch(() => {});
    state.mic?.setOutputDevice(settings.outputDeviceId);
  };

  $('#s-camera').onchange = async (e) => {
    settings.cameraDeviceId = e.target.value;
    saveSettings();
    if (local.camera) {
      stopCamera();
      await startCamera();
    }
  };

  $('#s-volume').oninput = (e) => {
    settings.inputVolume = Number(e.target.value);
    applySettings();
  };

  $('#s-ns').onchange = (e) => {
    settings.nsMode = e.target.value;
    applySettings(true);
  };

  $('#s-echo').onchange = (e) => {
    settings.echoCancellation = e.target.checked;
    applySettings(true);
  };

  $('#s-agc').onchange = (e) => {
    settings.autoGainControl = e.target.checked;
    applySettings(true);
  };

  $('#s-mode').onchange = (e) => {
    settings.mode = e.target.value;
    setPtt(false);
    applySettings(true);
  };

  $('#s-threshold').oninput = (e) => {
    settings.threshold = Number(e.target.value);
    applySettings();
  };

  $('#s-ptt-release').oninput = (e) => {
    settings.pttReleaseMs = Number(e.target.value);
    applySettings();
  };

  $('#s-screen').onchange = (e) => {
    settings.screenQuality = e.target.value;
    saveSettings();
  };

  $('#s-notify').onchange = (e) => {
    settings.notify = e.target.checked;
    saveSettings();
    if (settings.notify && 'Notification' in window) Notification.requestPermission().catch(() => {});
  };

  $('#s-voice').onchange = (e) => {
    settings.voice = e.target.checked;
    saveSettings();
    fillSettingsForm();
    if (settings.voice) say('enter');
  };

  $('#s-voice-volume').oninput = (e) => {
    settings.voiceVolume = Number(e.target.value);
    saveSettings();
    $('#s-voice-volume-val').textContent = settings.voiceVolume + '%';
  };

  $('#s-voice-volume').onchange = () => say('poke');

  $('#s-sounds').onchange = (e) => {
    settings.sounds = e.target.checked;
    saveSettings();
  };

  $('#s-ptt-key').onclick = (e) => {
    const btn = e.currentTarget;
    state.bindingKey = true;
    btn.classList.add('listening');
    btn.textContent = 'Нажми клавишу или кнопку мыши…';
    const done = (code) => {
      state.bindingKey = false;
      btn.classList.remove('listening');
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onMouse, true);
      if (code) settings.pttKey = code;
      applySettings(true);
    };
    const onKey = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      done(ev.code === 'Escape' ? null : ev.code);
    };
    const onMouse = (ev) => {
      if (ev.button === 0 && ev.target === btn) return; // это клик по самой кнопке
      ev.preventDefault();
      done(`Mouse${ev.button}`);
    };
    setTimeout(() => {
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('mousedown', onMouse, true);
    });
  };

  $('#s-test').onclick = () => {
    const btn = $('#s-test');
    if (testEl) return stopTest();
    testEl = new Audio();
    testEl.srcObject = state.mic.stream;
    if (settings.outputDeviceId) testEl.setSinkId?.(settings.outputDeviceId).catch(() => {});
    testEl.play();
    btn.classList.add('on');
    btn.textContent = 'Остановить проверку';
  };

  $('#settings').addEventListener('close', () => {
    stopTest();
    state.mic?.setGate({ report: false });
  });
}
