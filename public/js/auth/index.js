import { $ } from '../core/dom.js';
import { SAY, pick } from '../core/messages.js';
import { state } from '../core/state.js';
import { toast } from '../ui/feedback.js';
import { connect } from '../connection/signaling.js';
import { openSettings } from '../settings/index.js';
import { leaveRoomUi, renderMe } from '../rooms/index.js';

const authMode = () => document.querySelector('#auth-tabs input:checked').value;

function syncAuthForm() {
  const reg = authMode() === 'register';
  $('#auth-name-row').hidden = !reg;
  $('#auth-btn').textContent = reg ? 'Создать аккаунт' : 'Войти';
  $('#auth-password').autocomplete = reg ? 'new-password' : 'current-password';
}

function showAuth(error) {
  state.loggedOut = true;
  if (state.currentRoom) leaveRoomUi();
  state.me = null;
  const sock = state.ws;
  state.ws = null;
  sock?.close(1000);
  $('#app').hidden = true;
  $('#auth').hidden = false;
  $('#join-bubble').textContent = pick(SAY.greet);
  const err = $('#auth-error');
  err.textContent = error || '';
  err.hidden = !error;
}

function showApp(user) {
  state.me = user;
  state.loggedOut = false;
  $('#auth').hidden = true;
  $('#app').hidden = false;
  $('#lobby').hidden = !!state.currentRoom;
  $('#lobby-text').textContent = pick(SAY.lobby);
  renderMe();
  // На телефоне список комнат спрятан в меню: в лобби сразу его открываем.
  if (!state.currentRoom && window.innerWidth <= 760) $('#app').classList.add('side-open');
  connect();
}

async function checkInvite() {
  const hint = $('#auth-invite');
  hint.hidden = false;
  try {
    const res = await fetch('/api/invite/' + encodeURIComponent(state.inviteToken));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    $('#auth-register-tab').hidden = false;
    document.querySelector('#auth-tabs input[value=register]').checked = true;
    if (data.forLogin) {
      $('#auth-login').value = data.forLogin;
      $('#auth-login').readOnly = true;
    }
    hint.textContent = 'Тебя пригласили! Придумай логин и пароль. Н-не то чтобы я радовалась новенькому...';
    syncAuthForm();
  } catch (e) {
    state.inviteToken = null;
    hint.textContent = e.message || 'Приглашение недействительно';
    hint.classList.add('error');
  }
}

export { checkInvite, showApp, showAuth, syncAuthForm };

// Bind handlers only after every feature module has been loaded.
export function initAuth() {
  $('#auth-tabs').onchange = syncAuthForm;

  $('#auth-form').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#auth-error');
    err.hidden = true;
    $('#auth-btn').disabled = true;
    const reg = authMode() === 'register';
    try {
      const res = await fetch(reg ? '/api/register' : '/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          login: $('#auth-login').value.trim(),
          password: $('#auth-password').value,
          name: $('#auth-name').value,
          invite: state.inviteToken,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Ошибка сервера (${res.status})`);
      $('#auth-password').value = '';
      if (reg) {
        state.inviteToken = null;
        $('#auth-invite').hidden = $('#auth-register-tab').hidden = true;
        document.querySelector('#auth-tabs input[value=login]').checked = true;
        syncAuthForm();
        history.replaceState(null, '', location.pathname);
      }
      showApp(data.user);
    } catch (e2) {
      err.textContent = e2 instanceof TypeError ? 'Сервер не отвечает. Он точно запущен?' : e2.message;
      err.hidden = false;
    } finally {
      $('#auth-btn').disabled = false;
    }
  };

  $('#logout').onclick = async () => {
    if (!confirm('Выйти из аккаунта?')) return;
    showAuth();
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    toast(SAY.loggedOut);
  };

  $('#side-settings').onclick = openSettings;
}
