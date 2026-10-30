import { $ } from '../core/dom.js';
import { state, users } from '../core/state.js';
import { escapeHtml, linkify, paintAvatar, toast } from '../ui/feedback.js';
import { sendWs } from '../connection/signaling.js';

function chatHidden() {
  const layout = $('.layout');
  return window.innerWidth <= 760
    ? !layout.classList.contains('chat-open')
    : layout.classList.contains('chat-hidden');
}

function addChatMessage(m) {
  const box = $('#messages');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  const el = document.createElement('div');
  el.className = 'msg';
  const time = new Date(m.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  el.innerHTML = `<div class="avatar"></div><div class="msg-body"><div class="meta"><b>${escapeHtml(m.name)}</b>${time}</div><div class="text">${linkify(m.text)}</div></div>`;
  const avatar = users.get(m.userId)?.avatar;
  paintAvatar(el.querySelector('.avatar'), m.name, avatar);
  const stick = atBottom || m.from === state.myId;
  if (m.image && /^[a-f0-9]{24}\.(png|jpg|webp|gif)$/.test(m.image)) {
    const url = `/uploads/${m.image}`;
    const link = document.createElement('a');
    link.className = 'msg-image';
    link.href = url;
    // Открываем поверх чата, а не в новом окне: в приложении внешний браузер не знает про вход.
    link.addEventListener('click', (e) => {
      e.preventDefault();
      openLightbox(url);
    });
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = 'Картинка';
    img.src = url;
    // Картинка догружается позже текста: если чат был прокручен вниз, держим его внизу.
    img.addEventListener('load', () => {
      if (stick) box.scrollTop = box.scrollHeight;
    });
    img.addEventListener('error', () =>
      link.replaceWith(
        Object.assign(document.createElement('div'), {
          className: 'muted',
          textContent: '(картинка недоступна)',
        })
      )
    );
    link.append(img);
    el.querySelector('.msg-body').append(link);
  }
  box.append(el);
  if (stick) box.scrollTop = box.scrollHeight;
}

function openLightbox(url) {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox';
  const img = document.createElement('img');
  img.src = url;
  img.alt = 'Картинка';
  overlay.append(img);
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    close();
  };
  overlay.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

const IMAGE_MAX_SIDE = 1920;

const IMAGE_MAX_BYTES = 7_000_000;

let attachment = null;

let attachJob = 0;

async function prepareImage(file) {
  if (file.type === 'image/gif') return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= 1_500_000) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const toBlob = (type, q) => new Promise((resolve) => canvas.toBlob(resolve, type, q));
  let blob = await toBlob('image/webp', 0.88);
  if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg', 0.88);
  return blob || file;
}

function clearAttachment() {
  attachJob++;
  if (attachment?.preview) URL.revokeObjectURL(attachment.preview);
  attachment = null;
  $('#chat-attach').hidden = true;
  $('#chat-attach').classList.remove('uploading');
}

async function attachImage(file) {
  if (!file || !IMAGE_TYPES.includes(file.type))
    return toast('Это не картинка. Подойдут PNG, JPEG, WebP и GIF');
  if (!state.currentRoom) return;
  clearAttachment();
  const job = attachJob;
  const box = $('#chat-attach');
  const preview = URL.createObjectURL(file);
  $('#chat-attach-img').src = preview;
  $('#chat-attach-status').textContent = 'Загружаю…';
  box.classList.add('uploading');
  box.hidden = false;
  attachment = { name: null, preview };
  try {
    const blob = await prepareImage(file);
    if (blob.size > IMAGE_MAX_BYTES) throw new Error('Картинка слишком большая (максимум 7 МБ)');
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': blob.type },
      body: blob,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.image)
      throw new Error(
        data.error ||
          (res.status === 413
            ? 'Картинка слишком большая (максимум 7 МБ)'
            : 'Не получилось загрузить картинку')
      );
    if (job !== attachJob) return; // пока грузилось, её убрали или заменили
    attachment.name = data.image;
    box.classList.remove('uploading');
    $('#chat-attach-status').textContent = 'Готово, жми отправить';
  } catch (e) {
    if (job !== attachJob) return;
    clearAttachment();
    toast(e.message || 'Не получилось загрузить картинку');
  }
}

function addSystemMessage(text) {
  const box = $('#messages');
  const el = document.createElement('div');
  el.className = 'msg system';
  el.textContent = text;
  box.append(el);
  box.scrollTop = box.scrollHeight;
}

export { addChatMessage, addSystemMessage, chatHidden, clearAttachment };

// Bind handlers only after every feature module has been loaded.
export function initChat() {
  $('#chat-pick').onclick = () => $('#chat-file').click();

  $('#chat-file').onchange = (e) => {
    attachImage(e.target.files[0]);
    e.target.value = '';
  };

  $('#chat-attach-clear').onclick = clearAttachment;

  $('#chat-input').addEventListener('paste', (e) => {
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    attachImage(file);
  });

  {
    const chat = $('#chat');
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    chat.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      chat.classList.add('drop-target');
    });
    chat.addEventListener('dragleave', (e) => {
      if (!chat.contains(e.relatedTarget)) chat.classList.remove('drop-target');
    });
    chat.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      chat.classList.remove('drop-target');
      attachImage(e.dataTransfer.files[0]);
    });
  }

  $('#chat-form').onsubmit = (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim();
    if (attachment && !attachment.name) return toast('Картинка ещё загружается, секундочку');
    if (!text && !attachment) return;
    sendWs({ type: 'chat', text, ...(attachment ? { image: attachment.name } : {}) });
    if (attachment) clearAttachment();
    input.value = '';
    input.style.height = '';
  };

  $('#chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('#chat-form').requestSubmit();
    }
  });

  $('#chat-input').addEventListener('input', (e) => {
    e.target.style.height = '';
    e.target.style.height = e.target.scrollHeight + 'px';
  });

  $('#toggle-chat').onclick = () => {
    const layout = $('.layout');
    if (window.innerWidth <= 760) layout.classList.toggle('chat-open');
    else layout.classList.toggle('chat-hidden');
    if (!chatHidden()) {
      state.unread = 0;
      $('#unread').hidden = true;
    }
  };
}
