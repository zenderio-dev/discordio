import { Voice } from '../voice.js';
import { $ } from '../core/dom.js';
import { settings, store } from '../core/preferences.js';
import { local, state } from '../core/state.js';
import { addSystemMessage } from '../chat/index.js';

function colorFor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.codePointAt(0)) % 360;
  return `hsl(${h} 70% 62%)`;
}

function paintAvatar(el, name, avatar) {
  if (avatar) {
    el.style.backgroundImage = `url("${avatar}")`;
    el.style.backgroundColor = 'transparent';
    el.textContent = '';
  } else {
    el.style.backgroundImage = '';
    el.style.backgroundColor = colorFor(name || '?');
    el.textContent = [...(name || '?')][0].toUpperCase();
  }
}

function escapeHtml(s) {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

function linkify(s) {
  return escapeHtml(s).replace(
    /https?:\/\/[^\s<]+/g,
    (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`
  );
}

function keyLabel(code) {
  if (!code) return 'не назначена';
  if (code.startsWith('Mouse')) return `Кнопка мыши ${Number(code.slice(5)) + 1}`;
  return code.replace(/^Key/, '').replace(/^Digit/, '');
}

function saveSettings() {
  store.set('settings', settings);
}

function sound(freqs, dur, vol) {
  if (settings.sounds) state.mic?.beep(freqs, dur, vol);
}

const voice = new Voice();

function say(event, beep) {
  if (
    settings.voice &&
    !local.deafened &&
    voice.play(event, { volume: settings.voiceVolume / 100, sinkId: settings.outputDeviceId })
  )
    return;
  if (beep) sound(...beep);
}

function toast(text, ms = 5000) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = '<img src="/img/mascot-face.webp" alt="">';
  el.append(text);
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
}

function warn(text) {
  toast(text, 7000);
  addSystemMessage(text);
}

async function resizeAvatar(file) {
  const bitmap = await createImageBitmap(file);
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const side = Math.min(bitmap.width, bitmap.height);
  canvas
    .getContext('2d')
    .drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  let url = canvas.toDataURL('image/webp', 0.85);
  if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', 0.85);
  return url;
}

export { escapeHtml, keyLabel, linkify, paintAvatar, resizeAvatar, saveSettings, say, toast, warn };

// Bind handlers only after every feature module has been loaded.
export function initFeedback() {
  voice.load();
}
