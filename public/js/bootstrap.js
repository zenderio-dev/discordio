import { $, desktop } from './core/dom.js';
import { ICONS } from './core/icons.js';
import { SAY, pick } from './core/messages.js';
import { settings } from './core/preferences.js';
import { local, peers, state } from './core/state.js';
import { warn } from './ui/feedback.js';
import { syncDesktopPtt } from './ui/controls.js';
import { checkInvite, showApp, showAuth, syncAuthForm } from './auth/index.js';

// Bind handlers only after every feature module has been loaded.
export async function startApplication() {
  await (async () => {
    $('#join-bubble').textContent = pick(SAY.greet);
    $('#side-settings').innerHTML = ICONS.gear;
    syncAuthForm();
    if (desktop) {
      $('#change-server').hidden = false;
      $('#change-server').onclick = () => desktop.changeServer();
      syncDesktopPtt();
    } else if (/Windows/.test(navigator.userAgent)) {
      $('#download-link').hidden = false;
      $('#lobby-download').hidden = false;
      const openApp = $('#open-app-link');
      openApp.hidden = false;
      openApp.href = `discordio://${location.host}/${state.autoJoin ? '#r=' + state.autoJoin : ''}`;
    }
    try {
      state.config = await (await fetch('/config.json')).json();
    } catch {}
    const insecure = window.isSecureContext
      ? ''
      : 'Страница открыта не по https: браузер не даст микрофон. Открой сайт по https-ссылке или через localhost.';
    if (state.inviteToken) await checkInvite();
    try {
      const res = await fetch('/api/me');
      if (res.ok) {
        showApp((await res.json()).user);
        if (insecure) warn(insecure);
        return;
      }
    } catch {}
    showAuth(insecure);
  })();

  window.__discordio = {
    peers,
    local,
    settings,
    get mic() {
      return state.mic;
    },
    get ws() {
      return state.ws;
    },
  };
}
