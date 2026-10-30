import { $ } from '../core/dom.js';
import { SAY } from '../core/messages.js';
import { state } from '../core/state.js';
import { toast } from '../ui/feedback.js';
import { sendWs } from '../connection/signaling.js';
import { joinRoom } from '../rooms/index.js';
import { checkInvite } from '../auth/index.js';

async function copyText(text, okMessage) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMessage);
  } catch {
    showAdminNotice('Скопируй вручную:', text);
  }
}

function showAdminNotice(title, value) {
  const box = $('#admin-notice');
  box.hidden = false;
  box.innerHTML = '<b></b><code></code><button type="button" class="secondary small">Копировать</button>';
  box.querySelector('b').textContent = title;
  box.querySelector('code').textContent = value;
  box.querySelector('button').onclick = () => copyText(value, 'Скопировала.');
  if (!$('#admin').open) $('#admin').showModal();
}

const fmtDate = (ts) =>
  new Date(ts).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

function renderAdmin() {
  if (!state.adminData) return;
  const invList = $('#inv-list');
  invList.innerHTML = state.adminData.invites.length ? '' : '<li class="hint">Активных приглашений нет.</li>';
  for (const i of state.adminData.invites) {
    const li = document.createElement('li');
    li.innerHTML = `<div class="grow"><code></code><small></small></div>
      <button type="button" class="secondary small" data-act="copy">Копировать</button>
      <button type="button" class="link" data-act="revoke">Отозвать</button>`;
    li.querySelector('code').textContent = i.url;
    li.querySelector('small').textContent = [
      i.forLogin
        ? `только для ${i.forLogin}`
        : `использовано ${i.uses}${i.maxUses ? ' из ' + i.maxUses : ''}`,
      i.expires ? `до ${fmtDate(i.expires)}` : 'бессрочно',
    ].join(' · ');
    li.querySelector('[data-act=copy]').onclick = () => copyText(i.url, SAY.inviteCopied);
    li.querySelector('[data-act=revoke]').onclick = () => {
      if (confirm('Отозвать приглашение? По этой ссылке больше никто не зарегистрируется.'))
        sendWs({ type: 'invite-revoke', token: i.token });
    };
    invList.append(li);
  }

  const userList = $('#user-list');
  userList.innerHTML = '';
  const sorted = [...state.adminData.users].sort(
    (a, b) => b.online - a.online || a.login.localeCompare(b.login)
  );
  for (const u of sorted) {
    const li = document.createElement('li');
    li.classList.toggle('banned', u.banned);
    li.innerHTML = '<div class="grow"><b></b> <span class="muted"></span><small></small></div>';
    li.querySelector('b').textContent = u.name;
    li.querySelector('.muted').textContent = '@' + u.login;
    const room = u.roomId && state.rooms.find((r) => r.id === u.roomId);
    li.querySelector('small').textContent = [
      u.admin && 'админ',
      u.banned ? 'заблокирован' : u.online ? (room ? `в комнате «${room.name}»` : 'онлайн') : 'не в сети',
      `с ${fmtDate(u.createdAt)}`,
    ]
      .filter(Boolean)
      .join(' · ');
    const add = (label, cls, onclick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = label;
      b.onclick = onclick;
      li.append(b);
    };
    if (room && u.id !== state.me.id) {
      add('Выгнать', 'secondary small', () => {
        if (confirm(`Выгнать ${u.name} из комнаты?`)) sendWs({ type: 'kick', userId: u.id });
      });
    }
    if (!u.admin) {
      add(u.banned ? 'Разбанить' : 'Забанить', u.banned ? 'secondary small' : 'danger small', () => {
        if (u.banned || confirm(`Забанить ${u.name}? Его выкинет отовсюду, войти он больше не сможет.`)) {
          sendWs({ type: 'ban', userId: u.id, banned: !u.banned });
        }
      });
    }
    add('Сбросить пароль', 'link', () => {
      if (confirm(`Сбросить пароль ${u.name}? Я придумаю новый, его нужно будет передать.`))
        sendWs({ type: 'reset-password', userId: u.id });
    });
    userList.append(li);
  }
}

export { copyText, renderAdmin, showAdminNotice };

// Bind handlers only after every feature module has been loaded.
export function initAdmin() {
  window.addEventListener('hashchange', () => {
    const params = new URLSearchParams(location.hash.slice(1));
    const invite = params.get('invite');
    const room = params.get('r');
    if (invite && !state.me) {
      state.inviteToken = invite;
      checkInvite();
    } else if (room && state.me && room !== state.currentRoom?.id && state.rooms.some((r) => r.id === room)) {
      joinRoom(room);
    }
  });

  $('#admin-btn').onclick = () => {
    $('#admin-notice').hidden = true;
    sendWs({ type: 'admin-get' });
    renderAdmin();
    $('#admin').showModal();
  };

  $('#inv-create').onclick = () =>
    sendWs({ type: 'invite-create', maxUses: $('#inv-uses').value, days: $('#inv-days').value });
}
