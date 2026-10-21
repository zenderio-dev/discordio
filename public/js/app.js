import { MicPipeline, NS_MODES } from './audio.js';

const $ = (s) => document.querySelector(s);

// ---------- Иконки ----------
const svg = (d) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONS = {
  mic: svg('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8"/>'),
  micOff: svg('<path d="M15 9.3V5a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.9 2.3M5 10a7 7 0 0 0 11.7 5.2M19 10a7 7 0 0 1-.6 2.8M12 17v4M8 21h8M3 3l18 18"/>'),
  head: svg('<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z"/>'),
  headOff: svg('<path d="M3 18v-6a9 9 0 0 1 15.4-6.4M21 12v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3zM3 3l18 18"/>'),
  screen: svg('<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  leave: svg('<path d="M10.7 13.3a16 16 0 0 0 3.4 2.6l1.3-1.3a2 2 0 0 1 2.1-.4c.8.3 1.6.5 2.5.6a2 2 0 0 1 1.7 2v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.7.6 2.5a2 2 0 0 1-.4 2.1L8 9.6M22 2 2 22"/>'),
};

// ---------- Настройки ----------
const DEFAULTS = {
  inputDeviceId: '',
  outputDeviceId: '',
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
if (!(settings.nsMode in NS_MODES)) settings.nsMode = DEFAULTS.nsMode;
const peerVolumes = store.get('volumes', {}); // по имени участника

const SCREEN_PRESETS = {
  '720p30': { width: 1280, height: 720, frameRate: 30, bitrate: 1_500_000, hint: 'detail' },
  '1080p30': { width: 1920, height: 1080, frameRate: 30, bitrate: 3_000_000, hint: 'detail' },
  '1080p60': { width: 1920, height: 1080, frameRate: 60, bitrate: 6_000_000, hint: 'motion' },
};

// ---------- Состояние ----------
let config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let mic = null; // MicPipeline
let ws = null;
let myId = null;
let joinInfo = null; // {room, name, password}
let leaving = false;
let reconnectDelay = 1000;
const local = { muted: false, deafened: false, sharing: false, screenStream: null, speaking: false };
const peers = new Map();
let pttDown = false;
let unread = 0;

// ---------- Утилиты ----------
function colorFor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.codePointAt(0)) % 360;
  return `hsl(${h} 55% 45%)`;
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function linkify(s) {
  return escapeHtml(s).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
}
function keyLabel(code) {
  if (!code) return 'не назначена';
  if (code.startsWith('Mouse')) return `Кнопка мыши ${Number(code.slice(5)) + 1}`;
  return code.replace(/^Key/, '').replace(/^Digit/, '');
}
function saveSettings() {
  store.set('settings', settings);
}
function showBanner(text) {
  const b = $('#banner');
  b.textContent = text || '';
  b.hidden = !text;
}
let toastTimer;
function warn(text) {
  showBanner(text);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => showBanner(''), 6000);
  addSystemMessage(text);
}

// ---------- Микрофон ----------
async function ensureMic() {
  if (mic) return mic;
  mic = new MicPipeline();
  mic.onWarning = warn;
  mic.onLevel = onLevel;
  await mic.init();
  await mic.resume();
  await mic.apply(settings);
  mic.setGate({ muted: local.muted || local.deafened });
  await mic.setOutputDevice(settings.outputDeviceId);
  return mic;
}

function onLevel({ level, open }) {
  // Индикатор в настройках: шкала от -80 до 0 дБ.
  const pct = Math.max(0, Math.min(100, ((level + 80) / 80) * 100));
  for (const id of ['#s-meter-fill', '#s-meter-fill-ptt']) {
    const el = $(id);
    el.style.width = pct + '%';
    el.classList.toggle('open', open);
  }
  if (open !== local.speaking) {
    local.speaking = open;
    const tile = document.querySelector('.tile.self');
    tile?.classList.toggle('speaking', open);
  }
}

function updateGate() {
  mic?.setGate({ muted: local.muted || local.deafened, pttDown });
}

// ---------- Сигнальный сервер ----------
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    reconnectDelay = 1000;
    ws.send(JSON.stringify({ type: 'join', ...joinInfo }));
  };
  ws.onmessage = (e) => handleServer(JSON.parse(e.data));
  ws.onclose = () => {
    if (leaving || !myId) return;
    // Потеряли сервер: сбрасываем соединения и входим заново.
    myId = null;
    for (const id of [...peers.keys()]) removePeer(id, true);
    showBanner('Нет связи с сервером, переподключаюсь…');
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 10000);
  };
}

function sendWs(msg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function sendState() {
  sendWs({
    type: 'state',
    state: {
      muted: local.muted,
      deafened: local.deafened,
      sharing: local.sharing,
      screenStreamId: local.screenStream?.id || null,
    },
  });
}

async function handleServer(msg) {
  switch (msg.type) {
    case 'error':
      if (!myId) {
        if (ws.readyState === WebSocket.OPEN) {
          leaving = true;
          ws.close();
        }
        backToJoin(msg.message);
      }
      break;
    case 'joined': {
      const firstJoin = $('#room').hidden;
      myId = msg.id;
      showBanner('');
      if (firstJoin) {
        enterRoomUi(msg.room);
        $('#messages').innerHTML = '';
        msg.history.forEach(addChatMessage);
        addSystemMessage(msg.peers.length ? `В комнате: ${msg.peers.map((p) => p.name).join(', ')}` : 'Ты первый в комнате. Скинь друзьям ссылку и пароль.');
      } else {
        addSystemMessage('Переподключились');
      }
      renderSelfTile();
      sendState();
      for (const p of msg.peers) createPeer(p);
      break;
    }
    case 'peer-joined':
      createPeer(msg.peer);
      addSystemMessage(`${msg.peer.name} зашёл`);
      mic?.beep([660, 880]);
      break;
    case 'peer-left': {
      const p = peers.get(msg.id);
      if (p) {
        addSystemMessage(`${p.name} вышел`);
        mic?.beep([880, 660]);
      }
      removePeer(msg.id);
      break;
    }
    case 'state': {
      const p = peers.get(msg.id);
      if (!p) break;
      p.state = msg.state;
      updateTile(p);
      renderStage();
      break;
    }
    case 'signal':
      await onSignal(msg.from, msg.data);
      break;
    case 'chat':
      addChatMessage(msg.message);
      if (msg.message.from !== myId) {
        if (chatHidden()) {
          unread++;
          $('#unread').textContent = unread;
          $('#unread').hidden = false;
        }
      }
      break;
  }
}

// ---------- WebRTC (perfect negotiation) ----------
function createPeer(info) {
  if (peers.has(info.id)) return peers.get(info.id);
  const pc = new RTCPeerConnection({ iceServers: config.iceServers });
  const peer = {
    id: info.id,
    name: info.name,
    state: info.state || {},
    pc,
    polite: myId < info.id,
    makingOffer: false,
    ignoreOffer: false,
    audioEls: new Map(),
    micTrack: null,
    screenStream: null,
    screenSenders: [],
    rtt: null,
    tile: null,
  };
  peers.set(info.id, peer);

  pc.addTrack(mic.track, mic.stream);
  if (local.sharing && local.screenStream) addScreenTracks(peer);

  pc.onnegotiationneeded = async () => {
    try {
      peer.makingOffer = true;
      await pc.setLocalDescription();
      sendWs({ type: 'signal', to: peer.id, data: { description: pc.localDescription } });
    } catch (e) {
      console.error('negotiation', e);
    } finally {
      peer.makingOffer = false;
    }
  };
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) sendWs({ type: 'signal', to: peer.id, data: { candidate } });
  };
  pc.onconnectionstatechange = () => {
    updateTile(peer);
    if (pc.connectionState === 'connected') tuneSenders(peer);
    if (pc.connectionState === 'failed') pc.restartIce();
  };
  pc.ontrack = ({ track, streams }) => {
    const stream = streams[0] || new MediaStream([track]);
    if (track.kind === 'video') {
      peer.screenStream = stream;
      stream.addEventListener('removetrack', () => {
        if (!stream.getVideoTracks().length && peer.screenStream === stream) peer.screenStream = null;
        renderStage();
      });
      renderStage();
      return;
    }
    if (stream.id !== peer.state.screenStreamId && !stream.getVideoTracks().length) peer.micTrack = track;
    attachAudio(peer, stream);
  };

  renderPeerTile(peer);
  return peer;
}

async function onSignal(from, data) {
  const peer = peers.get(from);
  if (!peer) return;
  const pc = peer.pc;
  try {
    if (data.description) {
      const desc = data.description;
      const collision = desc.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
      peer.ignoreOffer = !peer.polite && collision;
      if (peer.ignoreOffer) return;
      await pc.setRemoteDescription(desc);
      if (desc.type === 'offer') {
        await pc.setLocalDescription();
        sendWs({ type: 'signal', to: from, data: { description: pc.localDescription } });
      }
    } else if (data.candidate) {
      try {
        await pc.addIceCandidate(data.candidate);
      } catch (e) {
        if (!peer.ignoreOffer) throw e;
      }
    }
  } catch (e) {
    console.error('signal', e);
  }
}

async function tuneSenders(peer) {
  for (const sender of peer.pc.getSenders()) {
    if (!sender.track) continue;
    const params = sender.getParameters();
    if (!params.encodings?.length) continue;
    if (sender.track.kind === 'audio') {
      params.encodings[0].maxBitrate = 96_000;
      params.encodings[0].priority = 'high';
      params.encodings[0].networkPriority = 'high';
    } else {
      const preset = SCREEN_PRESETS[settings.screenQuality];
      params.encodings[0].maxBitrate = preset.bitrate;
      params.encodings[0].maxFramerate = preset.frameRate;
      params.degradationPreference = preset.hint === 'motion' ? 'maintain-framerate' : 'maintain-resolution';
    }
    try {
      await sender.setParameters(params);
    } catch (e) {
      console.warn('setParameters', e);
    }
  }
}

function attachAudio(peer, stream) {
  if (peer.audioEls.has(stream.id)) return;
  const el = new Audio();
  el.autoplay = true;
  el.srcObject = stream;
  el.volume = (peerVolumes[peer.name] ?? 100) / 100;
  el.muted = local.deafened;
  if (settings.outputDeviceId && el.setSinkId) el.setSinkId(settings.outputDeviceId).catch(() => {});
  el.play().catch(() => {});
  peer.audioEls.set(stream.id, el);
  stream.addEventListener('removetrack', () => {
    if (!stream.getAudioTracks().length) {
      el.srcObject = null;
      peer.audioEls.delete(stream.id);
    }
  });
}

function removePeer(id, silent) {
  const peer = peers.get(id);
  if (!peer) return;
  peer.pc.close();
  for (const el of peer.audioEls.values()) el.srcObject = null;
  peer.tile?.remove();
  peers.delete(id);
  if (!silent) renderStage();
}

// ---------- Демонстрация экрана ----------
function addScreenTracks(peer) {
  for (const track of local.screenStream.getTracks()) {
    peer.screenSenders.push(peer.pc.addTrack(track, local.screenStream));
  }
}

async function startShare() {
  const preset = SCREEN_PRESETS[settings.screenQuality];
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: preset.width }, height: { ideal: preset.height }, frameRate: { ideal: preset.frameRate } },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
    });
  } catch (e) {
    if (e.name !== 'NotAllowedError') warn('Не удалось начать демонстрацию: ' + e.message);
    return;
  }
  const video = stream.getVideoTracks()[0];
  video.contentHint = preset.hint;
  video.addEventListener('ended', stopShare);
  local.screenStream = stream;
  local.sharing = true;
  sendState(); // сначала сообщаем id потока, чтобы друзья не приняли звук экрана за микрофон
  for (const peer of peers.values()) {
    addScreenTracks(peer);
    setTimeout(() => tuneSenders(peer), 1500);
  }
  updateControls();
  renderStage();
}

function stopShare() {
  if (!local.sharing) return;
  for (const peer of peers.values()) {
    for (const s of peer.screenSenders) {
      try {
        peer.pc.removeTrack(s);
      } catch {}
    }
    peer.screenSenders = [];
  }
  local.screenStream.getTracks().forEach((t) => t.stop());
  local.screenStream = null;
  local.sharing = false;
  sendState();
  updateControls();
  renderStage();
}

function renderStage() {
  const stage = $('#stage');
  const views = [];
  if (local.sharing && local.screenStream) views.push({ key: 'self', name: 'Твой экран', stream: local.screenStream, self: true });
  for (const p of peers.values()) {
    if (p.state.sharing && p.screenStream && p.screenStream.getVideoTracks().length) {
      views.push({ key: p.id, name: `Экран: ${p.name}`, stream: p.screenStream });
    }
  }
  const existing = new Map([...stage.children].map((el) => [el.dataset.key, el]));
  for (const v of views) {
    let el = existing.get(v.key);
    if (!el) {
      el = document.createElement('div');
      el.className = 'screen-view';
      el.dataset.key = v.key;
      el.innerHTML = `<video autoplay playsinline muted></video><span class="label"></span><button class="fs">⛶</button>`;
      const video = el.querySelector('video');
      el.querySelector('.fs').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen());
      video.ondblclick = () => el.requestFullscreen();
      stage.append(el);
    }
    const video = el.querySelector('video');
    if (video.srcObject !== v.stream) video.srcObject = v.stream;
    el.querySelector('.label').textContent = v.name;
    existing.delete(v.key);
  }
  for (const el of existing.values()) el.remove();
  stage.hidden = views.length === 0;
}

// ---------- Плитки участников ----------
function makeTile(name) {
  const tile = $('#tile-tpl').content.firstElementChild.cloneNode(true);
  const avatar = tile.querySelector('.avatar');
  avatar.textContent = [...name][0]?.toUpperCase() || '?';
  avatar.style.background = colorFor(name);
  tile.querySelector('.tile-name').textContent = name;
  return tile;
}

function renderSelfTile() {
  document.querySelector('.tile.self')?.remove();
  const tile = makeTile(joinInfo.name + ' (ты)');
  tile.querySelector('.avatar').style.background = colorFor(joinInfo.name);
  tile.querySelector('.avatar').textContent = [...joinInfo.name][0]?.toUpperCase();
  tile.classList.add('self');
  $('#tiles').prepend(tile);
  updateSelfTile();
}

function updateSelfTile() {
  const tile = document.querySelector('.tile.self');
  if (!tile) return;
  tile.querySelector('.tile-icons').innerHTML =
    (local.muted || local.deafened ? ICONS.micOff : '') + (local.deafened ? ICONS.headOff : '');
}

function renderPeerTile(peer) {
  const tile = makeTile(peer.name);
  const slider = tile.querySelector('input');
  slider.value = peerVolumes[peer.name] ?? 100;
  slider.title = `Громкость: ${slider.value}%`;
  slider.oninput = () => {
    const v = Number(slider.value);
    peerVolumes[peer.name] = v;
    store.set('volumes', peerVolumes);
    slider.title = `Громкость: ${v}%`;
    for (const el of peer.audioEls.values()) el.volume = v / 100;
  };
  peer.tile = tile;
  $('#tiles').append(tile);
  updateTile(peer);
}

function updateTile(peer) {
  const tile = peer.tile;
  if (!tile) return;
  const s = peer.state;
  tile.querySelector('.tile-icons').innerHTML = (s.muted || s.deafened ? ICONS.micOff : '') + (s.deafened ? ICONS.headOff : '');
  const cs = peer.pc.connectionState;
  tile.classList.toggle('connecting', cs !== 'connected');
  tile.querySelector('.tile-ping').textContent =
    cs === 'connected' ? (peer.rtt != null ? `${peer.rtt} мс` : '') : cs === 'failed' ? 'нет связи' : 'соединяю…';
}

// Кто говорит и пинг: опрашиваем статистику WebRTC.
setInterval(() => {
  for (const peer of peers.values()) {
    const receiver = peer.pc.getReceivers().find((r) => r.track === peer.micTrack);
    const level = receiver?.getSynchronizationSources?.()[0]?.audioLevel ?? 0;
    peer.tile?.classList.toggle('speaking', level > 0.015 && !peer.state.muted);
  }
}, 150);
setInterval(async () => {
  for (const peer of peers.values()) {
    if (peer.pc.connectionState !== 'connected') continue;
    try {
      const stats = await peer.pc.getStats();
      stats.forEach((r) => {
        if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded' && r.currentRoundTripTime != null) {
          peer.rtt = Math.round(r.currentRoundTripTime * 1000);
        }
      });
      updateTile(peer);
    } catch {}
  }
}, 2000);

// ---------- Чат ----------
function chatHidden() {
  const layout = $('.layout');
  return window.innerWidth <= 760 ? !layout.classList.contains('chat-open') : layout.classList.contains('chat-hidden');
}
function addChatMessage(m) {
  const box = $('#messages');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  const el = document.createElement('div');
  el.className = 'msg';
  const time = new Date(m.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  el.innerHTML = `<div class="meta"><b>${escapeHtml(m.name)}</b>${time}</div><div class="text">${linkify(m.text)}</div>`;
  box.append(el);
  if (atBottom || m.from === myId) box.scrollTop = box.scrollHeight;
}
function addSystemMessage(text) {
  const box = $('#messages');
  const el = document.createElement('div');
  el.className = 'msg system';
  el.textContent = text;
  box.append(el);
  box.scrollTop = box.scrollHeight;
}

$('#chat-form').onsubmit = (e) => {
  e.preventDefault();
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  sendWs({ type: 'chat', text });
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
    unread = 0;
    $('#unread').hidden = true;
  }
};

// ---------- Кнопки ----------
function updateControls() {
  const micBtn = $('#btn-mic');
  const micOff = local.muted || local.deafened;
  micBtn.innerHTML = micOff ? ICONS.micOff : ICONS.mic;
  micBtn.classList.toggle('off', micOff);
  const deaf = $('#btn-deafen');
  deaf.innerHTML = local.deafened ? ICONS.headOff : ICONS.head;
  deaf.classList.toggle('off', local.deafened);
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
  mic?.beep(local.muted ? [500] : [800], 0.07);
}
function toggleDeafen() {
  local.deafened = !local.deafened;
  if (!local.deafened) local.muted = false;
  applyDeafen();
  mic?.beep(local.deafened ? [500, 400] : [400, 500], 0.07);
}
function applyDeafen() {
  for (const p of peers.values()) for (const el of p.audioEls.values()) el.muted = local.deafened;
  updateGate();
  updateControls();
  sendState();
}

$('#btn-mic').onclick = toggleMute;
$('#btn-deafen').onclick = toggleDeafen;
$('#btn-share').onclick = () => (local.sharing ? stopShare() : startShare());
$('#btn-settings').onclick = openSettings;
$('#btn-leave').onclick = leave;
$('#copy-link').onclick = async () => {
  const url = `${location.origin}/#${joinInfo.room}`;
  try {
    await navigator.clipboard.writeText(url);
    addSystemMessage(`Ссылка скопирована: ${url} (пароль скажи отдельно)`);
  } catch {
    prompt('Ссылка на комнату:', url);
  }
};

// Push-to-talk: клавиатура, кнопки мыши и экранная кнопка.
function setPtt(down) {
  if (pttDown === down) return;
  pttDown = down;
  $('#btn-ptt').classList.toggle('active', down);
  updateGate();
}
let bindingKey = false;
const isTyping = (e) => e.target.closest?.('input, textarea, select') && !e.target.matches('input[type=range]');
document.addEventListener('keydown', (e) => {
  if (bindingKey) return;
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyM' && myId) {
    e.preventDefault();
    return toggleMute();
  }
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyD' && myId) {
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
  if (!bindingKey && settings.mode === 'ptt' && `Mouse${e.button}` === settings.pttKey) setPtt(true);
});
document.addEventListener('mouseup', (e) => {
  if (settings.mode === 'ptt' && `Mouse${e.button}` === settings.pttKey) setPtt(false);
});
window.addEventListener('blur', () => setPtt(false));
const pttBtn = $('#btn-ptt');
pttBtn.addEventListener('pointerdown', (e) => {
  pttBtn.setPointerCapture(e.pointerId);
  setPtt(true);
});
pttBtn.addEventListener('pointerup', () => setPtt(false));
pttBtn.addEventListener('pointercancel', () => setPtt(false));

// ---------- Окно настроек ----------
let testEl = null;

async function refreshDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const fill = (sel, kind, current) => {
    const list = devices.filter((d) => d.kind === kind && d.deviceId !== 'communications');
    sel.innerHTML = '';
    for (const d of list) {
      const opt = new Option(d.label || (kind === 'audioinput' ? 'Микрофон' : 'Динамики'), d.deviceId === 'default' ? '' : d.deviceId);
      sel.append(opt);
    }
    if (!list.some((d) => d.deviceId === 'default')) sel.prepend(new Option('По умолчанию', ''));
    sel.value = current;
    if (sel.value !== current) sel.value = '';
  };
  fill($('#s-input'), 'audioinput', settings.inputDeviceId);
  fill($('#s-output'), 'audiooutput', settings.outputDeviceId);
  const canSink = 'setSinkId' in HTMLMediaElement.prototype;
  $('#s-output').disabled = !canSink;
  $('#s-output-note').hidden = canSink;
}
navigator.mediaDevices?.addEventListener?.('devicechange', () => {
  if ($('#settings').open) refreshDevices();
});

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
  $('#s-vad-block').hidden = settings.mode !== 'vad';
  $('#s-ptt-block').hidden = settings.mode !== 'ptt';
}

async function openSettings() {
  try {
    await ensureMic();
  } catch (e) {
    return alert(micErrorText(e));
  }
  fillSettingsForm();
  await refreshDevices();
  $('#settings').showModal();
}

let applyTimer;
function applySettings(immediate) {
  saveSettings();
  fillSettingsForm();
  updateControls();
  clearTimeout(applyTimer);
  applyTimer = setTimeout(async () => {
    try {
      await mic?.apply(settings);
    } catch (e) {
      warn(micErrorText(e));
    }
  }, immediate ? 0 : 120);
}

$('#s-input').onchange = (e) => {
  settings.inputDeviceId = e.target.value;
  applySettings(true);
};
$('#s-output').onchange = async (e) => {
  settings.outputDeviceId = e.target.value;
  saveSettings();
  for (const p of peers.values()) for (const el of p.audioEls.values()) el.setSinkId?.(settings.outputDeviceId).catch(() => {});
  testEl?.setSinkId?.(settings.outputDeviceId).catch(() => {});
  mic?.setOutputDevice(settings.outputDeviceId);
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
$('#s-ptt-key').onclick = (e) => {
  const btn = e.currentTarget;
  bindingKey = true;
  btn.classList.add('listening');
  btn.textContent = 'Нажми клавишу или кнопку мыши…';
  const done = (code) => {
    bindingKey = false;
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
  testEl.srcObject = mic.stream;
  if (settings.outputDeviceId) testEl.setSinkId?.(settings.outputDeviceId).catch(() => {});
  testEl.play();
  btn.classList.add('on');
  btn.textContent = 'Остановить проверку';
};
function stopTest() {
  if (!testEl) return;
  testEl.srcObject = null;
  testEl = null;
  $('#s-test').classList.remove('on');
  $('#s-test').textContent = 'Проверить микрофон';
}
$('#settings').addEventListener('close', stopTest);

// ---------- Вход / выход ----------
function micErrorText(e) {
  if (!window.isSecureContext) return 'Браузер даёт доступ к микрофону только по https:// или на localhost. Открой комнату через https-ссылку туннеля.';
  if (e?.name === 'NotAllowedError') return 'Нет доступа к микрофону. Разреши его в настройках сайта (значок замка в адресной строке).';
  if (e?.name === 'NotFoundError') return 'Микрофон не найден.';
  return 'Ошибка микрофона: ' + (e?.message || e);
}

function enterRoomUi(room) {
  $('#join').hidden = true;
  $('#room').hidden = false;
  $('#room-name').textContent = room;
  history.replaceState(null, '', '#' + room);
  document.title = `${room} · discordio`;
  if (window.innerWidth <= 760) $('.layout').classList.remove('chat-open');
  updateControls();
}

function backToJoin(error) {
  myId = null;
  for (const id of [...peers.keys()]) removePeer(id, true);
  if (local.sharing) stopShare();
  $('#tiles').innerHTML = '';
  renderStage();
  $('#room').hidden = true;
  $('#join').hidden = false;
  $('#join-btn').disabled = false;
  document.title = 'discordio';
  const err = $('#join-error');
  err.textContent = error || '';
  err.hidden = !error;
}

function leave() {
  leaving = true;
  ws?.close();
  backToJoin();
}

$('#join-form').onsubmit = async (e) => {
  e.preventDefault();
  $('#join-error').hidden = true;
  $('#join-btn').disabled = true;
  const name = $('#join-name').value.trim();
  const room = $('#join-room').value.trim().toLowerCase();
  const password = $('#join-password').value;
  store.set('name', name);
  try {
    await ensureMic();
  } catch (err) {
    console.error(err);
    return backToJoin(micErrorText(err));
  }
  joinInfo = { name, room, password };
  leaving = false;
  connect();
};
$('#join-settings').onclick = openSettings;

// ---------- Старт ----------
(async () => {
  $('#join-name').value = store.get('name', '');
  $('#join-room').value = decodeURIComponent(location.hash.slice(1)).replace(/^room=/, '');
  if ($('#join-name').value && $('#join-room').value) $('#join-password').focus();
  try {
    config = await (await fetch('/config.json')).json();
  } catch {}
  if (!window.isSecureContext) {
    const err = $('#join-error');
    err.textContent = 'Страница открыта не по https: браузер не даст микрофон. Используй https-ссылку туннеля или localhost.';
    err.hidden = false;
  }
})();

// Для автотестов.
window.__discordio = { peers, local, settings, get mic() { return mic; } };
