import { $ } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { SAY, pick } from '../core/messages.js';
import { local, peers, state, users } from '../core/state.js';
import { paintAvatar, warn } from '../ui/feedback.js';
import { ensureMic } from '../media/microphone.js';
import { sendWs } from '../connection/signaling.js';
import { removePeer } from '../connection/peers.js';
import { renderStage, stopCamera, stopShare } from '../media/streams.js';
import { clearAttachment } from '../chat/index.js';
import { updateControls } from '../ui/controls.js';

function renderMe() {
  if (!state.me) return;
  paintAvatar($('#me-avatar'), state.me.name, state.me.avatar);
  $('#me-name').textContent = state.me.name;
  $('#me-login').textContent = '@' + state.me.login;
  $('#admin-btn').hidden = !state.me.admin;
  const self = document.querySelector('.tile.self');
  if (self) {
    paintAvatar(self.querySelector('.avatar'), state.me.name, state.me.avatar);
    self.querySelector('.tile-name').textContent = state.me.name + ' (ты)';
  }
  if ($('#settings').open) paintAvatar($('#s-avatar'), state.me.name, state.me.avatar);
}

function renderRooms() {
  const list = $('#room-list');
  list.innerHTML = '';
  for (const r of state.rooms) {
    const li = document.createElement('li');
    li.className = 'room-item';
    li.classList.toggle('current', state.currentRoom?.id === r.id);
    li.innerHTML = `
      <div class="room-row">
        <button type="button" class="room-btn" title="Зайти">${ICONS.speaker}<span></span><small></small></button>
        <button type="button" class="mini" data-act="rename" title="Переименовать">✎</button>
        <button type="button" class="mini" data-act="delete" title="Удалить">✕</button>
      </div>`;
    li.querySelector('.room-btn span').textContent = r.name;
    li.querySelector('.room-btn small').textContent = r.members.length || '';
    li.querySelector('.room-btn').onclick = () => joinRoom(r.id);
    li.querySelector('[data-act=rename]').onclick = async () => {
      const name = await askRoomName('Переименовать комнату', r.name);
      if (name && name !== r.name) sendWs({ type: 'rename-room', id: r.id, name });
    };
    const del = li.querySelector('[data-act=delete]');
    del.hidden = r.members.length > 0 || state.rooms.length === 1;
    del.onclick = () => {
      if (confirm(`Удалить комнату «${r.name}»? Её чат тоже пропадёт.`))
        sendWs({ type: 'delete-room', id: r.id });
    };
    if (r.members.length) {
      const ul = document.createElement('ul');
      ul.className = 'member-list';
      for (const m of r.members) {
        const u = users.get(m.userId) || { name: '?' };
        const row = document.createElement('li');
        row.innerHTML = '<div class="avatar"></div><span></span><i></i>';
        paintAvatar(row.querySelector('.avatar'), u.name, u.avatar);
        row.querySelector('span').textContent = u.name + (m.id === state.myId ? ' (ты)' : '');
        row.querySelector('i').innerHTML =
          (m.state.sharing ? '<b class="live">в эфире</b>' : '') +
          (m.state.muted || m.state.deafened ? ICONS.micOff : '') +
          (m.state.deafened ? ICONS.headOff : '');
        ul.append(row);
      }
      li.append(ul);
    }
    list.append(li);
  }
}

function askRoomName(title, value = '') {
  return new Promise((resolve) => {
    const dlg = $('#room-dialog');
    $('#room-dialog-title').textContent = title;
    $('#room-dialog-name').value = value;
    dlg.returnValue = '';
    dlg.onclose = () =>
      resolve(dlg.returnValue === 'ok' ? $('#room-dialog-name').value.replace(/\s+/g, ' ').trim() : null);
    dlg.showModal();
  });
}

const closeSidebar = () => $('#app').classList.remove('side-open');

function micErrorText(e) {
  if (!window.isSecureContext)
    return 'Браузер даёт доступ к микрофону только по https:// или на localhost. Открой сайт по https-ссылке.';
  if (e?.name === 'NotAllowedError')
    return 'Нет доступа к микрофону. Разреши его в настройках сайта (значок замка в адресной строке).';
  if (e?.name === 'NotFoundError') return 'Микрофон не найден. Ты его вообще подключил?';
  return 'Ошибка микрофона: ' + (e?.message || e);
}

async function joinRoom(id) {
  closeSidebar();
  if (state.currentRoom?.id === id || state.joiningRoom === id) return;
  try {
    await ensureMic();
  } catch (e) {
    console.error(e);
    return warn(micErrorText(e));
  }
  // Свежие адреса STUN/TURN: временные логины TURN живут сутки.
  try {
    state.config = await (await fetch('/config.json')).json();
  } catch {}
  state.joiningRoom = id;
  sendWs({ type: 'join', room: id });
}

function resetMedia() {
  if (local.sharing) stopShare();
  if (local.camera) stopCamera();
}

function enterRoomUi(room) {
  $('#lobby').hidden = true;
  $('#room').hidden = false;
  $('#room-name').textContent = room.name;
  history.replaceState(null, '', '#r=' + room.id);
  document.title = `${room.name} · discordio`;
  if (window.innerWidth <= 760) $('.layout').classList.remove('chat-open');
  updateControls();
}

function leaveRoomUi() {
  clearAttachment();
  for (const id of [...peers.keys()]) removePeer(id, true);
  resetMedia();
  state.currentRoom = null;
  state.joiningRoom = null;
  $('#tiles').innerHTML = '';
  renderStage();
  $('#room').hidden = true;
  $('#lobby').hidden = false;
  $('#lobby-text').textContent = pick(SAY.lobby);
  history.replaceState(null, '', location.pathname);
  document.title = 'discordio';
  if (window.innerWidth <= 760) $('#app').classList.add('side-open');
  renderRooms();
}

function leave() {
  sendWs({ type: 'leave' });
  leaveRoomUi();
}

export { enterRoomUi, joinRoom, leave, leaveRoomUi, micErrorText, renderMe, renderRooms, resetMedia };

// Bind handlers only after every feature module has been loaded.
export function initRooms() {
  $('#add-room').onclick = async () => {
    const name = await askRoomName('Новая комната');
    if (name) sendWs({ type: 'create-room', name });
  };

  $('#lobby-menu').onclick = $('#room-menu').onclick = () => $('#app').classList.toggle('side-open');
}
