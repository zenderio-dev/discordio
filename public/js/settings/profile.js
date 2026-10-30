import { $ } from '../core/dom.js';
import { state } from '../core/state.js';
import { paintAvatar, resizeAvatar, toast } from '../ui/feedback.js';
import { sendWs } from '../connection/signaling.js';

const avatarInput = $('#avatar-file');

const pickAvatar = () => avatarInput.click();

function setAvatar(url) {
  if (!state.me) return;
  paintAvatar($('#s-avatar'), state.me.name, url);
  sendWs({ type: 'profile', avatar: url });
}

// Bind handlers only after every feature module has been loaded.
export function initProfile() {
  avatarInput.onchange = async () => {
    const file = avatarInput.files[0];
    avatarInput.value = '';
    if (!file) return;
    try {
      setAvatar(await resizeAvatar(file));
    } catch {
      toast('Это вообще картинка? Выбери нормальную, бака.');
    }
  };

  $('#s-name').onchange = (e) => {
    const name = e.target.value.replace(/\s+/g, ' ').trim();
    if (name && name !== state.me?.name) sendWs({ type: 'profile', name });
  };

  $('#s-avatar').onclick = pickAvatar;

  $('#s-avatar-pick').onclick = pickAvatar;

  $('#s-avatar-clear').onclick = () => setAvatar(null);
}
