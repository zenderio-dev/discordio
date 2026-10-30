import { $, desktop } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { SAY } from '../core/messages.js';
import { settings } from '../core/preferences.js';
import { local, peers, state } from '../core/state.js';
import { say, toast } from './feedback.js';
import { updateGate } from '../media/microphone.js';
import { sendState } from '../connection/signaling.js';
import { applyPeerAudio } from '../connection/peers.js';
import { startCamera, startShare, stopCamera, stopShare } from '../media/streams.js';
import { updateSelfTile } from './participants.js';
import { addSystemMessage } from '../chat/index.js';
import { openSettings } from '../settings/index.js';
import { leave } from '../rooms/index.js';

function updateControls() {
  const micBtn = $('#btn-mic');
  const micOff = local.muted || local.deafened;
  micBtn.innerHTML = micOff ? ICONS.micOff : ICONS.mic;
  micBtn.classList.toggle('off', micOff);
  const deaf = $('#btn-deafen');
  deaf.innerHTML = local.deafened ? ICONS.headOff : ICONS.head;
  deaf.classList.toggle('off', local.deafened);
  const cam = $('#btn-cam');
  cam.innerHTML = local.camera ? ICONS.cam : ICONS.camOff;
  cam.classList.toggle('on', local.camera);
  cam.title = local.camera ? 'Выключить камеру' : 'Включить камеру';
  const share = $('#btn-share');
  share.innerHTML = ICONS.screen;
  share.classList.toggle('on', local.sharing);
  share.title = local.sharing ? 'Остановить демонстрацию' : 'Демонстрация экрана';
  $('#btn-settings').innerHTML = ICONS.gear;
  $('#btn-leave').innerHTML = ICONS.leave;
  $('#btn-ptt').hidden = settings.mode !== 'ptt';
  if (!navigator.mediaDevices?.getDisplayMedia) share.hidden = true;
  updateSelfTile();
}

function toggleMute() {
  if (local.deafened) {
    local.deafened = false;
    local.muted = false;
  } else {
    local.muted = !local.muted;
  }
  applyDeafen();
  say(local.muted ? 'mute' : 'unmute', [local.muted ? [500] : [800], 0.07]);
}

function toggleDeafen() {
  local.deafened = !local.deafened;
  if (!local.deafened) local.muted = false;
  applyDeafen();
  // В «глухом» режиме молчит и она, поэтому реплику на выключение звука говорим до него.
  if (local.deafened) {
    local.deafened = false;
    say('deafen', [[500, 400], 0.07]);
    local.deafened = true;
  } else {
    say('undeafen', [[400, 500], 0.07]);
  }
}

function applyDeafen() {
  for (const p of peers.values()) applyPeerAudio(p);
  updateGate();
  updateControls();
  sendState();
}

function setPtt(down) {
  if (state.pttDown === down) return;
  state.pttDown = down;
  $('#btn-ptt').classList.toggle('active', down);
  updateGate();
}

const isTyping = (e) =>
  e.target.closest?.('input, textarea, select') && !e.target.matches('input[type=range]');

const pttBtn = $('#btn-ptt');

function syncDesktopPtt() {
  desktop?.setPttKey(settings.mode === 'ptt' ? settings.pttKey : null);
}

export { setPtt, syncDesktopPtt, updateControls };

// Bind handlers only after every feature module has been loaded.
export function initControls() {
  $('#btn-mic').onclick = toggleMute;

  $('#btn-deafen').onclick = toggleDeafen;

  $('#btn-cam').onclick = () => (local.camera ? stopCamera() : startCamera());

  $('#btn-share').onclick = () => (local.sharing ? stopShare() : startShare());

  $('#btn-settings').onclick = openSettings;

  $('#btn-leave').onclick = leave;

  $('#copy-link').onclick = async () => {
    const url = `${state.config.publicUrl || location.origin}/#r=${state.currentRoom.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast(SAY.copied);
      addSystemMessage(`Ссылка: ${url}`);
    } catch {
      prompt('Ссылка на комнату:', url);
    }
  };

  document.addEventListener('keydown', (e) => {
    if (state.bindingKey) return;
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyM' && state.currentRoom) {
      e.preventDefault();
      return toggleMute();
    }
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyD' && state.currentRoom) {
      e.preventDefault();
      return toggleDeafen();
    }
    if (settings.mode === 'ptt' && e.code === settings.pttKey && !isTyping(e)) {
      e.preventDefault();
      setPtt(true);
    }
  });

  document.addEventListener('keyup', (e) => {
    if (settings.mode === 'ptt' && e.code === settings.pttKey) setPtt(false);
  });

  document.addEventListener('mousedown', (e) => {
    if (!state.bindingKey && settings.mode === 'ptt' && `Mouse${e.button}` === settings.pttKey) setPtt(true);
  });

  document.addEventListener('mouseup', (e) => {
    if (settings.mode === 'ptt' && `Mouse${e.button}` === settings.pttKey) setPtt(false);
  });

  window.addEventListener('blur', () => {
    if (!desktop) setPtt(false);
  });

  pttBtn.addEventListener('pointerdown', (e) => {
    pttBtn.setPointerCapture(e.pointerId);
    setPtt(true);
  });

  pttBtn.addEventListener('pointerup', () => setPtt(false));

  pttBtn.addEventListener('pointercancel', () => setPtt(false));

  desktop?.onPtt((down) => {
    if (settings.mode === 'ptt' && !state.bindingKey) setPtt(down);
  });
}
