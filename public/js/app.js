import { MicPipeline, NS_MODES } from './audio.js';

const $ = (s) => document.querySelector(s);
// Мост к приложению для Windows (есть только внутри Electron).
const desktop = window.discordioDesktop || null;

// ---------- Иконки ----------
const svg = (d) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONS = {
  mic: svg('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8"/>'),
  micOff: svg('<path d="M15 9.3V5a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.9 2.3M5 10a7 7 0 0 0 11.7 5.2M19 10a7 7 0 0 1-.6 2.8M12 17v4M8 21h8M3 3l18 18"/>'),
  head: svg('<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z"/>'),
  headOff: svg('<path d="M3 18v-6a9 9 0 0 1 15.4-6.4M21 12v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3zM3 3l18 18"/>'),
  cam: svg('<path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>'),
  camOff: svg('<path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5 0h4a2 2 0 0 1 2 2v3.3l1 1L23 7v10M1 1l22 22"/>'),
  screen: svg('<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  leave: svg('<path d="M10.7 13.3a16 16 0 0 0 3.4 2.6l1.3-1.3a2 2 0 0 1 2.1-.4c.8.3 1.6.5 2.5.6a2 2 0 0 1 1.7 2v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.7.6 2.5a2 2 0 0 1-.4 2.1L8 9.6M22 2 2 22"/>'),
  speaker: svg('<path d="M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7"/>'),
  speakerOff: svg('<path d="M11 5 6 9H2v6h4l5 4V5zM22 9l-6 6M16 9l6 6"/>'),
};

// ---------- Цундере-фразы ----------
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const SAY = {
  greet: [
    'Ч-чего уставился? Заходи уже, раз пришёл!',
    'Н-не то чтобы я тебя ждала, бака!',
    'Опять ты? ...Ладно, проходи.',
    'Пароль не забудь, дурак!',
    'Хмф. Друзья уже ждут. Не я, а друзья!',
  ],
  lobby: [
    'Ну и чего стоишь? Выбери комнату, бака!',
    'Заходи в комнату. Не то чтобы я подсказывала... просто так получилось.',
    'Хмф. Заходи, где народ. Или создай свою, если такой особенный.',
  ],
  roomTaken: 'Ты зашёл в эту комнату с другого устройства, отсюда я тебя вывела.',
  kickedByAdmin: 'Админ выгнал тебя из комнаты. Хмф, сам виноват!',
  banned: 'Аккаунт заблокирован. Ну и дела...',
  inviteCopied: 'Ссылку-приглашение скопировала. Отдай её другу!',
  loggedOut: 'Ушёл, значит? Ну и ладно... Возвращайся. Если хочешь!',
  joined: (n) => pick([`${n} пришёл. Хмф, не то чтобы кто-то ждал!`, `${n} всё-таки явился. Наконец-то... то есть, ой, неважно!`, `${n} тут. Ну привет, раз так.`]),
  left: (n) => pick([`${n} ушёл. Ну и пусть! Мне всё равно... правда!`, `${n} сбежал. Б-бака...`, `${n} вышел. Не очень-то и хотелось.`]),
  first: 'Ты первый в комнате. Нажми «Пригласить» и скинь друзьям ссылку, а то так и будешь сидеть один.',
  mutedTalking: 'Эй! Ты говоришь, а микрофон выключен. Бака!',
  pokedBy: (n) => `${n} тыкнул тебя! Хмф, внимания захотелось?`,
  poked: (n) => `Ты тыкнул ${n}. Доволен?`,
  copied: 'Ссылку скопировала. Н-не ради тебя, а ради друзей!',
  reconnecting: 'Связь пропала... Н-не уходи, переподключаюсь!',
  reconnected: 'Вернулись. Я не волновалась, если что.',
};
const ERRORS = {
  full: 'Тут уже полно народу! Подожди, нетерпеливый.',
  'not-empty': 'Там кто-то сидит! Удалить можно только пустую комнату, бака.',
  'last-room': 'Последнюю комнату не отдам!',
  exists: 'Такая комната уже есть. Придумай что-нибудь своё!',
  'no-room': 'Этой комнаты больше нет.',
};

// ---------- Настройки ----------
const DEFAULTS = {
  inputDeviceId: '',
  outputDeviceId: '',
  cameraDeviceId: '',
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
  notify: true,
  sounds: true,
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
const peerVolumes = store.get('volumes2', {}); // по id аккаунта участника
const peerMuted = store.get('mutedPeers2', {}); // заглушённые «для себя», по id аккаунта

const SCREEN_PRESETS = {
  '720p30': { width: 1280, height: 720, frameRate: 30, bitrate: 1_500_000, hint: 'detail' },
  '1080p30': { width: 1920, height: 1080, frameRate: 30, bitrate: 3_000_000, hint: 'detail' },
  '1080p60': { width: 1920, height: 1080, frameRate: 60, bitrate: 6_000_000, hint: 'motion' },
};
// Камера намеренно скромная: 360p и 24 к/с почти не грузят ни сеть, ни процессор.
const CAMERA = { width: 640, height: 360, frameRate: 24, bitrate: 450_000 };

// ---------- Состояние ----------
let config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let mic = null; // MicPipeline
let ws = null;
let me = null; // мой аккаунт {id, login, name, avatar}
let myId = null; // id текущего подключения к серверу
let loggedOut = true;
let reconnectDelay = 1000;
const users = new Map(); // аккаунты онлайн: id -> {id, login, name, avatar}
let rooms = []; // [{id, name, members: [{id, userId, state}]}]
let currentRoom = null; // {id, name}, если я в голосовой комнате
let joiningRoom = null; // id комнаты, в которую сейчас захожу (или перезахожу после обрыва)
const hashParams = new URLSearchParams(location.hash.slice(1));
let autoJoin = hashParams.get('r'); // ссылка на комнату: #r=id
let inviteToken = hashParams.get('invite'); // ссылка-приглашение: #invite=токен
const local = {
  muted: false,
  deafened: false,
  sharing: false,
  screenStream: null,
  camera: false,
  camStream: null,
  speaking: false,
};
const peers = new Map();
let pttDown = false;
let unread = 0;

// ---------- Утилиты ----------
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
function sound(freqs, dur, vol) {
  if (settings.sounds) mic?.beep(freqs, dur, vol);
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

// Уменьшаем картинку до 128x128 (обрезка по центру), чтобы аватарка весила ~10 КБ.
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

let loudMutedTimer = null;
let lastMutedHint = 0;
function onLevel({ level, open, loudMuted }) {
  if ($('#settings').open) {
    // Индикатор в настройках: шкала от -80 до 0 дБ.
    const pct = Math.max(0, Math.min(100, ((level + 80) / 80) * 100));
    for (const id of ['#s-meter-fill', '#s-meter-fill-ptt']) {
      const el = $(id);
      el.style.width = pct + '%';
      el.classList.toggle('open', open);
    }
  }
  if (open !== local.speaking) {
    local.speaking = open;
    document.querySelector('.tile.self')?.classList.toggle('speaking', open);
  }
  // Подсказка «ты в муте», если человек говорит дольше секунды.
  clearTimeout(loudMutedTimer);
  if (loudMuted && currentRoom && local.muted && !local.deafened && Date.now() - lastMutedHint > 30000) {
    loudMutedTimer = setTimeout(() => {
      lastMutedHint = Date.now();
      toast(SAY.mutedTalking);
    }, 1000);
  }
}

function updateGate() {
  mic?.setGate({ muted: local.muted || local.deafened, pttDown });
}

// ---------- Сигнальный сервер ----------
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}/ws`);
  ws = sock;
  sock.onmessage = (e) => handleServer(JSON.parse(e.data));
  sock.onclose = (e) => {
    if (ws !== sock) return;
    myId = null;
    if (loggedOut) return;
    if (e.code === 4001) return showAuth(); // сессия кончилась
    if (e.code === 4003) return showAuth(SAY.banned);
    // Потеряли сервер: сбрасываем соединения, после переподключения вернёмся в ту же комнату.
    if (currentRoom) {
      joiningRoom = currentRoom.id;
      for (const id of [...peers.keys()]) removePeer(id, true);
      toast(SAY.reconnecting);
    }
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
      camera: local.camera,
      camStreamId: local.camStream?.id || null,
    },
  });
}

async function handleServer(msg) {
  switch (msg.type) {
    case 'hello':
      reconnectDelay = 1000;
      myId = msg.id;
      me = msg.me;
      users.clear();
      for (const u of msg.users) users.set(u.id, u);
      rooms = msg.rooms;
      renderMe();
      renderRooms();
      if (joiningRoom) sendWs({ type: 'join', room: joiningRoom });
      else if (autoJoin && rooms.some((r) => r.id === autoJoin)) joinRoom(autoJoin);
      autoJoin = null;
      break;
    case 'rooms':
      rooms = msg.rooms;
      renderRooms();
      break;
    case 'user': {
      users.set(msg.user.id, msg.user);
      if (msg.user.id === me?.id) {
        me = msg.user;
        renderMe();
      }
      for (const p of peers.values()) {
        if (p.userId !== msg.user.id) continue;
        p.name = msg.user.name;
        p.avatar = msg.user.avatar;
        paintAvatar(p.tile.querySelector('.avatar'), p.name, p.avatar);
        p.tile.querySelector('.tile-name').textContent = p.name;
      }
      renderRooms();
      break;
    }
    case 'error':
      if (joiningRoom && ['full', 'no-room'].includes(msg.code)) {
        joiningRoom = null;
        if (currentRoom) leaveRoomUi();
      }
      toast(ERRORS[msg.code] || msg.message);
      break;
    case 'kicked':
      if (currentRoom) leaveRoomUi();
      toast(msg.reason === 'admin' ? SAY.kickedByAdmin : SAY.roomTaken, 7000);
      break;
    case 'admin-data':
      adminData = msg;
      renderAdmin();
      break;
    case 'invite-created':
      copyText(msg.url, SAY.inviteCopied);
      break;
    case 'password-reset':
      showAdminNotice(`Новый пароль для ${msg.login}:`, msg.password);
      break;
    case 'joined': {
      const rejoin = currentRoom?.id === msg.room.id;
      joiningRoom = null;
      for (const id of [...peers.keys()]) removePeer(id, true);
      if (!rejoin && currentRoom) resetMedia();
      currentRoom = msg.room;
      enterRoomUi(msg.room);
      if (rejoin) {
        toast(SAY.reconnected);
      } else {
        $('#messages').innerHTML = '';
        msg.history.forEach(addChatMessage);
        addSystemMessage(msg.peers.length ? `В комнате: ${msg.peers.map((p) => p.name).join(', ')}` : SAY.first);
        if (settings.notify && 'Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission().catch(() => {});
        }
      }
      renderSelfTile();
      sendState();
      // Новичок ждёт предложения от тех, кто уже в комнате: так обе стороны не шлют offer одновременно.
      for (const p of msg.peers) createPeer(p, true);
      updateAlone();
      renderRooms();
      break;
    }
    case 'peer-joined':
      createPeer(msg.peer);
      addSystemMessage(SAY.joined(msg.peer.name));
      sound([660, 880]);
      updateAlone();
      break;
    case 'peer-left': {
      const p = peers.get(msg.id);
      if (p) {
        addSystemMessage(SAY.left(p.name));
        sound([880, 660]);
      }
      removePeer(msg.id);
      updateAlone();
      break;
    }
    case 'state': {
      const p = peers.get(msg.id);
      if (!p) break;
      p.state = msg.state;
      if (!p.state.sharing) p.preview = null;
      updateTile(p);
      renderPeerVideo(p);
      renderStage();
      break;
    }
    case 'preview': {
      const p = peers.get(msg.id);
      if (!p || !p.state.sharing) break;
      p.preview = msg.image;
      renderStage();
      break;
    }
    case 'poke':
      toast(SAY.pokedBy(msg.name));
      sound([1200, 900, 1200], 0.07, 0.1);
      desktop?.flash();
      break;
    case 'signal': {
      // Сигналы одного участника обрабатываем строго по очереди.
      const p = peers.get(msg.from);
      if (p) p.signalQueue = p.signalQueue.then(() => onSignal(msg.from, msg.data));
      break;
    }
    case 'chat':
      addChatMessage(msg.message);
      if (msg.message.from !== myId) {
        if (chatHidden()) {
          unread++;
          $('#unread').textContent = unread;
          $('#unread').hidden = false;
        }
        notifyMessage(msg.message);
      }
      break;
  }
}

function notifyMessage(m) {
  if (!settings.notify || (document.hasFocus() && !document.hidden)) return;
  desktop?.flash();
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const avatar = users.get(m.userId)?.avatar;
  const n = new Notification(m.name, { body: m.text.slice(0, 200), icon: avatar || '/img/icon.svg', silent: !settings.sounds });
  n.onclick = () => {
    window.focus();
    n.close();
  };
}

// ---------- WebRTC (perfect negotiation) ----------
function createPeer(info, waitForOffer = false) {
  if (peers.has(info.id)) return peers.get(info.id);
  const pc = new RTCPeerConnection({ iceServers: config.iceServers });
  const peer = {
    id: info.id,
    userId: info.userId,
    name: info.name,
    avatar: info.avatar || null,
    state: info.state || {},
    preview: info.preview || null, // снимок экрана, пока его стрим не смотрю
    wantsScreen: false, // этот участник смотрит мой стрим
    pc,
    polite: myId < info.id,
    makingOffer: false,
    ignoreOffer: false,
    audioEls: new Map(),
    micTrack: null,
    videoStreams: new Set(),
    screenSenders: [],
    camSenders: [],
    rtt: null,
    tile: null,
    pendingCandidates: [],
    signalQueue: Promise.resolve(),
    watchdog: null,
  };
  peers.set(info.id, peer);
  // Страховка: если соединение так и не поднялось, «невежливая» сторона перезапускает ICE.
  peer.watchdog = setInterval(() => {
    if (!peer.polite && !peer.waitingOffer && ['new', 'failed'].includes(pc.connectionState) && pc.signalingState === 'stable') pc.restartIce();
  }, 8000);

  peer.waitingOffer = waitForOffer;
  if (!waitForOffer) addLocalTracks(peer);

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
      peer.videoStreams.add(stream);
      stream.addEventListener('removetrack', () => {
        if (!stream.getVideoTracks().length) peer.videoStreams.delete(stream);
        renderPeerVideo(peer);
        renderStage();
      });
      renderPeerVideo(peer);
      renderStage();
      return;
    }
    const isMic = stream.id !== peer.state.screenStreamId && stream.id !== peer.state.camStreamId && !stream.getVideoTracks().length;
    if (isMic) peer.micTrack = track;
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
    if ('watch' in data) {
      // Друг начал или перестал смотреть мой стрим: экран шлём только тем, кто смотрит.
      peer.wantsScreen = !!data.watch;
      if (peer.wantsScreen) sendScreenTo(peer);
      else {
        removeSenders(peer, peer.screenSenders);
        peer.screenSenders = [];
      }
    } else if (data.description) {
      const desc = data.description;
      const collision = desc.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
      peer.ignoreOffer = !peer.polite && collision;
      if (peer.ignoreOffer) return;
      await pc.setRemoteDescription(desc);
      // Кандидаты, пришедшие раньше описания, применяем теперь.
      for (const c of peer.pendingCandidates.splice(0)) pc.addIceCandidate(c).catch(() => {});
      if (desc.type === 'offer') {
        if (peer.waitingOffer) {
          // Треки встают в уже предложенные слоты, поэтому ответ сразу их содержит.
          peer.waitingOffer = false;
          addLocalTracks(peer);
        }
        await pc.setLocalDescription();
        sendWs({ type: 'signal', to: from, data: { description: pc.localDescription } });
      }
    } else if (data.candidate) {
      if (!pc.remoteDescription) {
        peer.pendingCandidates.push(data.candidate);
        return;
      }
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
  const camTrack = local.camStream?.getVideoTracks()[0];
  for (const sender of peer.pc.getSenders()) {
    if (!sender.track) continue;
    const params = sender.getParameters();
    if (!params.encodings?.length) continue;
    const enc = params.encodings[0];
    if (sender.track.kind === 'audio') {
      enc.maxBitrate = sender.track === mic.track ? 64_000 : 128_000;
      if (sender.track === mic.track) {
        enc.priority = 'high';
        enc.networkPriority = 'high';
      }
    } else if (sender.track === camTrack) {
      enc.maxBitrate = CAMERA.bitrate;
      enc.maxFramerate = CAMERA.frameRate;
      params.degradationPreference = 'balanced';
    } else {
      const preset = SCREEN_PRESETS[settings.screenQuality];
      enc.maxBitrate = preset.bitrate;
      enc.maxFramerate = preset.frameRate;
      params.degradationPreference = preset.hint === 'motion' ? 'maintain-framerate' : 'maintain-resolution';
    }
    try {
      await sender.setParameters(params);
    } catch (e) {
      console.warn('setParameters', e);
    }
  }
}

function applyPeerAudio(peer) {
  for (const el of peer.audioEls.values()) {
    el.volume = (peerVolumes[peer.userId] ?? 100) / 100;
    el.muted = local.deafened || !!peerMuted[peer.userId];
  }
}

function attachAudio(peer, stream) {
  if (peer.audioEls.has(stream.id)) return;
  const el = new Audio();
  el.autoplay = true;
  el.srcObject = stream;
  if (settings.outputDeviceId && el.setSinkId) el.setSinkId(settings.outputDeviceId).catch(() => {});
  peer.audioEls.set(stream.id, el);
  applyPeerAudio(peer);
  el.play().catch(() => {});
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
  clearInterval(peer.watchdog);
  peer.pc.close();
  for (const el of peer.audioEls.values()) el.srcObject = null;
  peer.tile?.remove();
  peers.delete(id);
  if (watching === id) watching = null;
  if (!silent) renderStage();
}

function addLocalTracks(peer) {
  peer.pc.addTrack(mic.track, mic.stream);
  if (peer.wantsScreen) sendScreenTo(peer);
  if (local.camera && local.camStream) peer.camSenders = addTracks(peer, local.camStream);
}

function sendScreenTo(peer) {
  // Пока соединение не согласовано, треки добавит addLocalTracks.
  if (!local.sharing || !local.screenStream || peer.screenSenders.length || peer.waitingOffer) return;
  peer.screenSenders = addTracks(peer, local.screenStream);
  setTimeout(() => tuneSenders(peer), 1500);
}

// ---------- Камера и демонстрация экрана ----------
function addTracks(peer, stream) {
  return stream.getTracks().map((track) => peer.pc.addTrack(track, stream));
}
function removeSenders(peer, senders) {
  for (const s of senders) {
    try {
      peer.pc.removeTrack(s);
    } catch {}
  }
}

async function startCamera() {
  const video = { width: { ideal: CAMERA.width }, height: { ideal: CAMERA.height }, frameRate: { ideal: CAMERA.frameRate } };
  if (settings.cameraDeviceId) video.deviceId = { exact: settings.cameraDeviceId };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video });
  } catch (e) {
    return warn(e.name === 'NotAllowedError' ? 'Нет доступа к камере. Разреши её в настройках.' : 'Камера не включилась: ' + e.message);
  }
  stream.getVideoTracks()[0].contentHint = 'motion';
  stream.getVideoTracks()[0].addEventListener('ended', stopCamera);
  local.camStream = stream;
  local.camera = true;
  sendState(); // сначала id потока, чтобы друзья знали, что это камера, а не экран
  for (const peer of peers.values()) {
    if (peer.waitingOffer) continue; // получит камеру вместе с остальными треками
    peer.camSenders = addTracks(peer, stream);
    setTimeout(() => tuneSenders(peer), 1500);
  }
  updateControls();
  renderSelfVideo();
}

function stopCamera() {
  if (!local.camera) return;
  for (const peer of peers.values()) {
    removeSenders(peer, peer.camSenders);
    peer.camSenders = [];
  }
  local.camStream.getTracks().forEach((t) => t.stop());
  local.camStream = null;
  local.camera = false;
  sendState();
  updateControls();
  renderSelfVideo();
}

async function startShare() {
  const preset = SCREEN_PRESETS[settings.screenQuality];
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: preset.width }, height: { ideal: preset.height }, frameRate: { ideal: preset.frameRate } },
      // restrictOwnAudio: в стрим не попадает то, что играет сама страница (голоса друзей,
      // звук чужих стримов). Без этого два стримера со звуком гоняют звук по кругу.
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, restrictOwnAudio: true },
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
    });
  } catch (e) {
    if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') warn('Не удалось начать демонстрацию: ' + e.message);
    return;
  }
  const video = stream.getVideoTracks()[0];
  video.contentHint = preset.hint;
  video.addEventListener('ended', stopShare);
  local.screenStream = stream;
  local.sharing = true;
  // Сам стрим уйдёт только тем, кто нажмёт «Смотреть». Остальным — редкие снимки для превью.
  local.stopPreviews = startPreviews(stream);
  sendState();
  updateControls();
  renderStage();
}

function stopShare() {
  if (!local.sharing) return;
  for (const peer of peers.values()) {
    removeSenders(peer, peer.screenSenders);
    peer.screenSenders = [];
    peer.wantsScreen = false;
  }
  local.stopPreviews?.();
  local.screenStream.getTracks().forEach((t) => t.stop());
  local.screenStream = null;
  local.sharing = false;
  if (watching === 'self') watching = null;
  sendState();
  updateControls();
  renderStage();
}

// Превью стрима: маленький JPEG раз в несколько секунд через сервер (~10 КБ вместо видеопотока).
const PREVIEW = { width: 320, height: 180, everyMs: 5000 };
function startPreviews(stream) {
  const video = document.createElement('video');
  video.muted = true;
  video.srcObject = stream;
  video.play().catch(() => {});
  const canvas = document.createElement('canvas');
  canvas.width = PREVIEW.width;
  canvas.height = PREVIEW.height;
  const ctx = canvas.getContext('2d');
  const snap = () => {
    if (!video.videoWidth || !peers.size) return;
    const k = Math.min(PREVIEW.width / video.videoWidth, PREVIEW.height / video.videoHeight);
    const w = video.videoWidth * k;
    const h = video.videoHeight * k;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, PREVIEW.width, PREVIEW.height);
    ctx.drawImage(video, (PREVIEW.width - w) / 2, (PREVIEW.height - h) / 2, w, h);
    sendWs({ type: 'preview', image: canvas.toDataURL('image/jpeg', 0.6) });
  };
  const first = setTimeout(snap, 800);
  const timer = setInterval(snap, PREVIEW.everyMs);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
    video.srcObject = null;
  };
}

// Смотреть можно только один стрим за раз; id участника, 'self' или null.
let watching = null;
function watchStream(id) {
  if (watching === id) return;
  if (watching && watching !== 'self') sendWs({ type: 'signal', to: watching, data: { watch: false } });
  watching = id;
  if (id && id !== 'self') sendWs({ type: 'signal', to: id, data: { watch: true } });
  renderStage();
}

// Видеопотоки участника: камера — тот, что объявлен как camStreamId, остальное — экран.
function peerCamStream(peer) {
  if (!peer.state.camera) return null;
  for (const s of peer.videoStreams) if (s.id === peer.state.camStreamId && s.getVideoTracks().length) return s;
  return null;
}
function peerScreenStream(peer) {
  if (!peer.state.sharing) return null;
  for (const s of peer.videoStreams) if (s.id !== peer.state.camStreamId && s.getVideoTracks().length) return s;
  return null;
}

function setTileVideo(tile, stream) {
  const media = tile.querySelector('.tile-media');
  let video = media.querySelector('video');
  if (stream) {
    if (!video) {
      video = document.createElement('video');
      video.autoplay = video.playsInline = video.muted = true;
      media.append(video);
    }
    if (video.srcObject !== stream) video.srcObject = stream;
  } else if (video) {
    video.srcObject = null;
    video.remove();
  }
  tile.querySelector('.avatar').hidden = !!stream;
  tile.classList.toggle('has-video', !!stream);
}
function renderPeerVideo(peer) {
  if (peer.tile) setTileVideo(peer.tile, peerCamStream(peer));
}
function renderSelfVideo() {
  const tile = document.querySelector('.tile.self');
  if (tile) setTileVideo(tile, local.camStream);
}

// Сцена: сверху стрим, который смотришь (один), под ним карточки остальных стримов с превью.
function renderStage() {
  const stage = $('#stage');
  const streams = [];
  if (local.sharing && local.screenStream) streams.push({ id: 'self', name: 'Твой экран' });
  for (const p of peers.values()) if (p.state.sharing) streams.push({ id: p.id, name: p.name, peer: p });
  if (watching && !streams.some((s) => s.id === watching)) watching = null;

  let main = stage.querySelector('.screen-view');
  const watched = streams.find((s) => s.id === watching);
  if (watched) {
    if (!main) {
      main = document.createElement('div');
      main.className = 'screen-view';
      main.innerHTML = `<video autoplay playsinline muted></video><span class="label"></span>
        <div class="view-actions"><button class="fs" title="На весь экран">⛶</button><button class="unwatch" title="Перестать смотреть">✕</button></div>`;
      main.querySelector('.fs').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : main.requestFullscreen());
      main.querySelector('.unwatch').onclick = () => watchStream(null);
      main.querySelector('video').ondblclick = () => main.requestFullscreen();
      stage.prepend(main);
    }
    const stream = watched.peer ? peerScreenStream(watched.peer) : local.screenStream;
    const video = main.querySelector('video');
    if (video.srcObject !== stream) video.srcObject = stream;
    // Пока видео не пришло, показываем превью и «подключаюсь».
    main.classList.toggle('loading', !stream);
    main.style.backgroundImage = !stream && watched.peer?.preview ? `url("${watched.peer.preview}")` : '';
    main.querySelector('.label').textContent = watched.peer ? `Экран: ${watched.name}` : watched.name;
  } else if (main) {
    main.querySelector('video').srcObject = null;
    main.remove();
  }

  let cards = stage.querySelector('.stream-cards');
  if (!cards) {
    cards = document.createElement('div');
    cards.className = 'stream-cards';
    stage.append(cards);
  }
  const existing = new Map([...cards.children].map((el) => [el.dataset.key, el]));
  for (const s of streams) {
    if (s.id === watching) continue;
    let card = existing.get(s.id);
    existing.delete(s.id);
    if (!card) {
      card = document.createElement('button');
      card.type = 'button';
      card.className = 'stream-card';
      card.dataset.key = s.id;
      card.title = 'Смотреть';
      card.innerHTML = `<span class="live">в эфире</span><span class="label"></span><span class="watch">Смотреть</span>`;
      card.onclick = () => watchStream(s.id);
      // Свой экран показываем вживую: он и так есть локально, сеть не тратится.
      card.prepend(document.createElement(s.peer ? 'img' : 'video'));
      if (!s.peer) {
        const v = card.querySelector('video');
        v.autoplay = v.muted = v.playsInline = true;
        v.srcObject = local.screenStream;
      }
      cards.append(card);
    }
    card.querySelector('.label').textContent = s.name;
    if (s.peer) {
      const img = card.querySelector('img');
      img.hidden = !s.peer.preview;
      if (s.peer.preview && img.src !== s.peer.preview) img.src = s.peer.preview;
      card.classList.toggle('no-preview', !s.peer.preview);
    }
  }
  for (const el of existing.values()) {
    const v = el.querySelector('video');
    if (v) v.srcObject = null;
    el.remove();
  }
  cards.hidden = !cards.children.length;
  stage.hidden = streams.length === 0;
}

// ---------- Плитки участников ----------
function makeTile(name, avatar) {
  const tile = $('#tile-tpl').content.firstElementChild.cloneNode(true);
  paintAvatar(tile.querySelector('.avatar'), name, avatar);
  tile.querySelector('.tile-name').textContent = name;
  return tile;
}

function renderSelfTile() {
  document.querySelector('.tile.self')?.remove();
  const tile = makeTile(me.name, me.avatar);
  tile.querySelector('.tile-name').textContent = me.name + ' (ты)';
  tile.classList.add('self');
  $('#tiles').prepend(tile);
  updateSelfTile();
  renderSelfVideo();
}

function updateSelfTile() {
  const tile = document.querySelector('.tile.self');
  if (!tile) return;
  tile.querySelector('.tile-icons').innerHTML =
    (local.muted || local.deafened ? ICONS.micOff : '') + (local.deafened ? ICONS.headOff : '');
}

function renderPeerTile(peer) {
  const tile = makeTile(peer.name, peer.avatar);
  const slider = tile.querySelector('input');
  slider.value = peerVolumes[peer.userId] ?? 100;
  slider.title = `Громкость: ${slider.value}%`;
  slider.oninput = () => {
    const v = Number(slider.value);
    peerVolumes[peer.userId] = v;
    store.set('volumes2', peerVolumes);
    slider.title = `Громкость: ${v}%`;
    applyPeerAudio(peer);
  };
  tile.querySelector('.mute-for-me').onclick = () => {
    if (peerMuted[peer.userId]) delete peerMuted[peer.userId];
    else peerMuted[peer.userId] = true;
    store.set('mutedPeers2', peerMuted);
    applyPeerAudio(peer);
    updateTile(peer);
  };
  tile.querySelector('.poke').onclick = () => {
    sendWs({ type: 'poke', to: peer.id });
    toast(SAY.poked(peer.name), 3000);
  };
  const kick = tile.querySelector('.kick');
  kick.hidden = !me?.admin;
  kick.onclick = () => {
    if (confirm(`Выгнать ${peer.name} из комнаты?`)) sendWs({ type: 'kick', userId: peer.userId });
  };
  peer.tile = tile;
  $('#tiles').append(tile);
  updateTile(peer);
  renderPeerVideo(peer);
}

function updateTile(peer) {
  const tile = peer.tile;
  if (!tile) return;
  const s = peer.state;
  const mutedForMe = !!peerMuted[peer.userId];
  tile.querySelector('.tile-icons').innerHTML =
    (s.muted || s.deafened ? ICONS.micOff : '') +
    (s.deafened ? ICONS.headOff : '') +
    (mutedForMe ? `<span class="mine" title="Заглушён для тебя">${ICONS.speakerOff}</span>` : '');
  const muteBtn = tile.querySelector('.mute-for-me');
  muteBtn.innerHTML = mutedForMe ? ICONS.speakerOff : ICONS.speaker;
  muteBtn.classList.toggle('active', mutedForMe);
  muteBtn.title = mutedForMe ? 'Снова слышать' : 'Заглушить для себя';
  tile.classList.toggle('local-muted', mutedForMe);
  const cs = peer.pc.connectionState;
  tile.classList.toggle('connecting', cs !== 'connected');
  tile.querySelector('.tile-ping').textContent =
    cs === 'connected' ? (peer.rtt != null ? `${peer.rtt} мс` : '') : cs === 'failed' ? 'нет связи' : 'соединяю…';
}

function updateAlone() {
  $('#alone').hidden = peers.size > 0 || !currentRoom;
}

// Кто говорит и пинг. Пока окно свёрнуто, не опрашиваем — экономим процессор.
setInterval(() => {
  if (document.hidden) return;
  for (const peer of peers.values()) {
    const receiver = peer.pc.getReceivers().find((r) => r.track === peer.micTrack);
    const level = receiver?.getSynchronizationSources?.()[0]?.audioLevel ?? 0;
    peer.tile?.classList.toggle('speaking', level > 0.015 && !peer.state.muted && !peerMuted[peer.userId]);
  }
}, 200);
setInterval(async () => {
  if (document.hidden) return;
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
}, 3000);

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
  el.innerHTML = `<div class="avatar"></div><div class="msg-body"><div class="meta"><b>${escapeHtml(m.name)}</b>${time}</div><div class="text">${linkify(m.text)}</div></div>`;
  const avatar = users.get(m.userId)?.avatar;
  paintAvatar(el.querySelector('.avatar'), m.name, avatar);
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
  sound(local.muted ? [500] : [800], 0.07);
}
function toggleDeafen() {
  local.deafened = !local.deafened;
  if (!local.deafened) local.muted = false;
  applyDeafen();
  sound(local.deafened ? [500, 400] : [400, 500], 0.07);
}
function applyDeafen() {
  for (const p of peers.values()) applyPeerAudio(p);
  updateGate();
  updateControls();
  sendState();
}

$('#btn-mic').onclick = toggleMute;
$('#btn-deafen').onclick = toggleDeafen;
$('#btn-cam').onclick = () => (local.camera ? stopCamera() : startCamera());
$('#btn-share').onclick = () => (local.sharing ? stopShare() : startShare());
$('#btn-settings').onclick = openSettings;
$('#btn-leave').onclick = leave;
$('#copy-link').onclick = async () => {
  const url = `${config.publicUrl || location.origin}/#r=${currentRoom.id}`;
  try {
    await navigator.clipboard.writeText(url);
    toast(SAY.copied);
    addSystemMessage(`Ссылка: ${url}`);
  } catch {
    prompt('Ссылка на комнату:', url);
  }
};

// Push-to-talk: клавиатура, кнопки мыши, экранная кнопка и глобальная клавиша в приложении.
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
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyM' && currentRoom) {
    e.preventDefault();
    return toggleMute();
  }
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyD' && currentRoom) {
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
// В браузере отпускаем при потере фокуса (иначе keyup не придёт). В приложении клавиша глобальная.
window.addEventListener('blur', () => {
  if (!desktop) setPtt(false);
});
const pttBtn = $('#btn-ptt');
pttBtn.addEventListener('pointerdown', (e) => {
  pttBtn.setPointerCapture(e.pointerId);
  setPtt(true);
});
pttBtn.addEventListener('pointerup', () => setPtt(false));
pttBtn.addEventListener('pointercancel', () => setPtt(false));

function syncDesktopPtt() {
  desktop?.setPttKey(settings.mode === 'ptt' ? settings.pttKey : null);
}
desktop?.onPtt((down) => {
  if (settings.mode === 'ptt' && !bindingKey) setPtt(down);
});

// ---------- Окно настроек ----------
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
  $('#s-notify').checked = settings.notify;
  $('#s-sounds').checked = settings.sounds;
  $('#s-vad-block').hidden = settings.mode !== 'vad';
  $('#s-ptt-block').hidden = settings.mode !== 'ptt';
  $('#s-ptt-hint').textContent = desktop
    ? 'Клавиша работает везде, даже когда ты в игре.'
    : 'В браузере клавиша работает, только пока окно активно. В приложении для Windows — везде, даже в игре.';
  paintAvatar($('#s-avatar'), me?.name || '?', me?.avatar);
  $('#s-name').value = me?.name || '';
  $('#s-name').disabled = !me;
}

async function openSettings() {
  try {
    await ensureMic();
  } catch (e) {
    return alert(micErrorText(e));
  }
  fillSettingsForm();
  await refreshDevices();
  mic.setGate({ report: true });
  $('#settings').showModal();
}

let applyTimer;
function applySettings(immediate) {
  saveSettings();
  fillSettingsForm();
  updateControls();
  syncDesktopPtt();
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
$('#s-sounds').onchange = (e) => {
  settings.sounds = e.target.checked;
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
$('#settings').addEventListener('close', () => {
  stopTest();
  mic?.setGate({ report: false });
});

// Аватарка
const avatarInput = $('#avatar-file');
const pickAvatar = () => avatarInput.click();
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
// Профиль хранится на сервере; он же разошлёт обновление всем, включая нас самих.
function setAvatar(url) {
  if (!me) return;
  paintAvatar($('#s-avatar'), me.name, url);
  sendWs({ type: 'profile', avatar: url });
}
$('#s-name').onchange = (e) => {
  const name = e.target.value.replace(/\s+/g, ' ').trim();
  if (name && name !== me?.name) sendWs({ type: 'profile', name });
};
$('#s-avatar').onclick = pickAvatar;
$('#s-avatar-pick').onclick = pickAvatar;
$('#s-avatar-clear').onclick = () => setAvatar(null);

// Выбор экрана в приложении (браузер показывает свой).
desktop?.onPickSource(
  (sources) =>
    new Promise((resolve) => {
      const dlg = $('#picker');
      const list = $('#picker-list');
      list.innerHTML = '';
      const finish = (id) => {
        dlg.close();
        resolve(id ? { id, audio: $('#picker-audio').checked } : null);
      };
      for (const s of sources) {
        const b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = `<img alt=""><span></span>`;
        b.querySelector('img').src = s.thumbnail;
        b.querySelector('span').textContent = s.name;
        b.onclick = () => finish(s.id);
        list.append(b);
      }
      $('#picker-cancel').onclick = () => finish(null);
      dlg.oncancel = () => finish(null);
      dlg.showModal();
    })
);

// ---------- Список комнат ----------
function renderMe() {
  if (!me) return;
  paintAvatar($('#me-avatar'), me.name, me.avatar);
  $('#me-name').textContent = me.name;
  $('#me-login').textContent = '@' + me.login;
  $('#admin-btn').hidden = !me.admin;
  const self = document.querySelector('.tile.self');
  if (self) {
    paintAvatar(self.querySelector('.avatar'), me.name, me.avatar);
    self.querySelector('.tile-name').textContent = me.name + ' (ты)';
  }
  if ($('#settings').open) paintAvatar($('#s-avatar'), me.name, me.avatar);
}

function renderRooms() {
  const list = $('#room-list');
  list.innerHTML = '';
  for (const r of rooms) {
    const li = document.createElement('li');
    li.className = 'room-item';
    li.classList.toggle('current', currentRoom?.id === r.id);
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
    del.hidden = r.members.length > 0 || rooms.length === 1;
    del.onclick = () => {
      if (confirm(`Удалить комнату «${r.name}»? Её чат тоже пропадёт.`)) sendWs({ type: 'delete-room', id: r.id });
    };
    if (r.members.length) {
      const ul = document.createElement('ul');
      ul.className = 'member-list';
      for (const m of r.members) {
        const u = users.get(m.userId) || { name: '?' };
        const row = document.createElement('li');
        row.innerHTML = '<div class="avatar"></div><span></span><i></i>';
        paintAvatar(row.querySelector('.avatar'), u.name, u.avatar);
        row.querySelector('span').textContent = u.name + (m.id === myId ? ' (ты)' : '');
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

// prompt() в приложении не работает, поэтому своё окошко.
function askRoomName(title, value = '') {
  return new Promise((resolve) => {
    const dlg = $('#room-dialog');
    $('#room-dialog-title').textContent = title;
    $('#room-dialog-name').value = value;
    dlg.returnValue = '';
    dlg.onclose = () => resolve(dlg.returnValue === 'ok' ? $('#room-dialog-name').value.replace(/\s+/g, ' ').trim() : null);
    dlg.showModal();
  });
}
$('#add-room').onclick = async () => {
  const name = await askRoomName('Новая комната');
  if (name) sendWs({ type: 'create-room', name });
};

const closeSidebar = () => $('#app').classList.remove('side-open');
$('#lobby-menu').onclick = $('#room-menu').onclick = () => $('#app').classList.toggle('side-open');

// ---------- Вход в комнату и выход ----------
function micErrorText(e) {
  if (!window.isSecureContext) return 'Браузер даёт доступ к микрофону только по https:// или на localhost. Открой сайт по https-ссылке.';
  if (e?.name === 'NotAllowedError') return 'Нет доступа к микрофону. Разреши его в настройках сайта (значок замка в адресной строке).';
  if (e?.name === 'NotFoundError') return 'Микрофон не найден. Ты его вообще подключил?';
  return 'Ошибка микрофона: ' + (e?.message || e);
}

async function joinRoom(id) {
  closeSidebar();
  if (currentRoom?.id === id || joiningRoom === id) return;
  try {
    await ensureMic();
  } catch (e) {
    console.error(e);
    return warn(micErrorText(e));
  }
  joiningRoom = id;
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
  for (const id of [...peers.keys()]) removePeer(id, true);
  resetMedia();
  currentRoom = null;
  joiningRoom = null;
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

// ---------- Аккаунт ----------
const authMode = () => document.querySelector('#auth-tabs input:checked').value;
function syncAuthForm() {
  const reg = authMode() === 'register';
  $('#auth-name-row').hidden = !reg;
  $('#auth-btn').textContent = reg ? 'Создать аккаунт' : 'Войти';
  $('#auth-password').autocomplete = reg ? 'new-password' : 'current-password';
}
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
        invite: inviteToken,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Ошибка сервера (${res.status})`);
    $('#auth-password').value = '';
    if (reg) {
      inviteToken = null;
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

function showAuth(error) {
  loggedOut = true;
  if (currentRoom) leaveRoomUi();
  me = null;
  const sock = ws;
  ws = null;
  sock?.close();
  $('#app').hidden = true;
  $('#auth').hidden = false;
  $('#join-bubble').textContent = pick(SAY.greet);
  const err = $('#auth-error');
  err.textContent = error || '';
  err.hidden = !error;
}

function showApp(user) {
  me = user;
  loggedOut = false;
  $('#auth').hidden = true;
  $('#app').hidden = false;
  $('#lobby').hidden = !!currentRoom;
  $('#lobby-text').textContent = pick(SAY.lobby);
  renderMe();
  // На телефоне список комнат спрятан в меню: в лобби сразу его открываем.
  if (!currentRoom && window.innerWidth <= 760) $('#app').classList.add('side-open');
  connect();
}

$('#logout').onclick = async () => {
  if (!confirm('Выйти из аккаунта?')) return;
  showAuth();
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  toast(SAY.loggedOut);
};
$('#side-settings').onclick = openSettings;

// ---------- Приглашение при регистрации ----------
async function checkInvite() {
  const hint = $('#auth-invite');
  hint.hidden = false;
  try {
    const res = await fetch('/api/invite/' + encodeURIComponent(inviteToken));
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
    inviteToken = null;
    hint.textContent = e.message || 'Приглашение недействительно';
    hint.classList.add('error');
  }
}

// ---------- Админка ----------
let adminData = null;

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

const fmtDate = (ts) => new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function renderAdmin() {
  if (!adminData) return;
  const invList = $('#inv-list');
  invList.innerHTML = adminData.invites.length ? '' : '<li class="hint">Активных приглашений нет.</li>';
  for (const i of adminData.invites) {
    const li = document.createElement('li');
    li.innerHTML = `<div class="grow"><code></code><small></small></div>
      <button type="button" class="secondary small" data-act="copy">Копировать</button>
      <button type="button" class="link" data-act="revoke">Отозвать</button>`;
    li.querySelector('code').textContent = i.url;
    li.querySelector('small').textContent = [
      i.forLogin ? `только для ${i.forLogin}` : `использовано ${i.uses}${i.maxUses ? ' из ' + i.maxUses : ''}`,
      i.expires ? `до ${fmtDate(i.expires)}` : 'бессрочно',
    ].join(' · ');
    li.querySelector('[data-act=copy]').onclick = () => copyText(i.url, SAY.inviteCopied);
    li.querySelector('[data-act=revoke]').onclick = () => {
      if (confirm('Отозвать приглашение? По этой ссылке больше никто не зарегистрируется.')) sendWs({ type: 'invite-revoke', token: i.token });
    };
    invList.append(li);
  }

  const userList = $('#user-list');
  userList.innerHTML = '';
  const sorted = [...adminData.users].sort((a, b) => b.online - a.online || a.login.localeCompare(b.login));
  for (const u of sorted) {
    const li = document.createElement('li');
    li.classList.toggle('banned', u.banned);
    li.innerHTML = '<div class="grow"><b></b> <span class="muted"></span><small></small></div>';
    li.querySelector('b').textContent = u.name;
    li.querySelector('.muted').textContent = '@' + u.login;
    const room = u.roomId && rooms.find((r) => r.id === u.roomId);
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
    if (room && u.id !== me.id) {
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
      if (confirm(`Сбросить пароль ${u.name}? Я придумаю новый, его нужно будет передать.`)) sendWs({ type: 'reset-password', userId: u.id });
    });
    userList.append(li);
  }
}

// Ссылку вставили в уже открытую вкладку: страница не перезагружается, меняется только #.
window.addEventListener('hashchange', () => {
  const params = new URLSearchParams(location.hash.slice(1));
  const invite = params.get('invite');
  const room = params.get('r');
  if (invite && !me) {
    inviteToken = invite;
    checkInvite();
  } else if (room && me && room !== currentRoom?.id && rooms.some((r) => r.id === room)) {
    joinRoom(room);
  }
});

$('#admin-btn').onclick = () => {
  $('#admin-notice').hidden = true;
  sendWs({ type: 'admin-get' });
  renderAdmin();
  $('#admin').showModal();
};
$('#inv-create').onclick = () => sendWs({ type: 'invite-create', maxUses: $('#inv-uses').value, days: $('#inv-days').value });

// ---------- Старт ----------
(async () => {
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
    openApp.href = `discordio://${location.host}/${autoJoin ? '#r=' + autoJoin : ''}`;
  }
  try {
    config = await (await fetch('/config.json')).json();
  } catch {}
  const insecure = window.isSecureContext
    ? ''
    : 'Страница открыта не по https: браузер не даст микрофон. Открой сайт по https-ссылке или через localhost.';
  if (inviteToken) await checkInvite();
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

// Для автотестов.
window.__discordio = { peers, local, settings, get mic() { return mic; } };
