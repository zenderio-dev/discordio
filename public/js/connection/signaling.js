import { $, desktop } from '../core/dom.js';
import { ERRORS, SAY } from '../core/messages.js';
import { settings } from '../core/preferences.js';
import { local, peers, state, users } from '../core/state.js';
import { paintAvatar, say, toast } from '../ui/feedback.js';
import { createPeer, onSignal, removePeer } from './peers.js';
import { renderPeerVideo, renderStage } from '../media/streams.js';
import { renderSelfTile, updateAlone, updateTile } from '../ui/participants.js';
import { addChatMessage, addSystemMessage, chatHidden } from '../chat/index.js';
import { enterRoomUi, joinRoom, leaveRoomUi, renderMe, renderRooms, resetMedia } from '../rooms/index.js';
import { showAuth } from '../auth/index.js';
import { copyText, renderAdmin, showAdminNotice } from '../admin/index.js';

let resumeKey = null;

let outbox = [];

let lastSeq = 0;

let reconnectToast = null;

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const resume = state.currentRoom && resumeKey ? `?resume=${resumeKey}&seq=${lastSeq}` : '';
  const sock = new WebSocket(`${proto}://${location.host}/ws${resume}`);
  state.ws = sock;
  sock.onmessage = (e) => handleServer(JSON.parse(e.data));
  sock.onclose = (e) => {
    if (state.ws !== sock) return;
    state.myId = null;
    if (state.loggedOut) return;
    if (e.code === 4001) return showAuth(); // сессия кончилась
    if (e.code === 4003) return showAuth(SAY.banned);
    // Потеряли сервер. Голос идёт напрямую и пока не рвём его: сервер подержит наше место,
    // а если не дождётся, после переподключения зайдём в комнату заново.
    if (state.currentRoom) {
      state.joiningRoom = state.currentRoom.id;
      // Короткий обрыв не показываем, чтобы не мигать сообщениями.
      reconnectToast ||= setTimeout(() => {
        toast(SAY.reconnecting);
        say('reconnecting');
      }, 2000);
    }
    setTimeout(connect, state.reconnectDelay);
    state.reconnectDelay = Math.min(state.reconnectDelay * 2, 10000);
  };
}

function sendWs(msg) {
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(msg));
  else if (state.currentRoom && outbox.length < 200) outbox.push(msg);
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
  if (msg.seq) lastSeq = msg.seq;
  switch (msg.type) {
    case 'hello':
      state.reconnectDelay = 1000;
      state.myId = msg.id;
      resumeKey = msg.resumeKey;
      if (!msg.resumed) lastSeq = 0;
      state.me = msg.me;
      users.clear();
      for (const u of msg.users) users.set(u.id, u);
      state.rooms = msg.rooms;
      renderMe();
      renderRooms();
      if (reconnectToast) {
        clearTimeout(reconnectToast);
        reconnectToast = null;
        if (msg.resumed || state.joiningRoom) {
          toast(SAY.reconnected);
          say('reconnected');
        }
      }
      if (msg.resumed && state.currentRoom) {
        // Сервер сохранил наше место: досылаем то, что накопилось, соединения с друзьями не трогаем.
        state.joiningRoom = null;
        for (const m of outbox.splice(0)) sendWs(m);
        break;
      }
      outbox = [];
      if (state.joiningRoom) sendWs({ type: 'join', room: state.joiningRoom });
      else if (state.autoJoin && state.rooms.some((r) => r.id === state.autoJoin)) joinRoom(state.autoJoin);
      state.autoJoin = null;
      break;
    case 'rooms':
      state.rooms = msg.rooms;
      renderRooms();
      break;
    case 'user': {
      users.set(msg.user.id, msg.user);
      if (msg.user.id === state.me?.id) {
        state.me = msg.user;
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
      if (state.joiningRoom && ['full', 'no-room'].includes(msg.code)) {
        state.joiningRoom = null;
        if (state.currentRoom) leaveRoomUi();
      }
      toast(ERRORS[msg.code] || msg.message);
      break;
    case 'kicked':
      if (state.currentRoom) leaveRoomUi();
      toast(msg.reason === 'admin' ? SAY.kickedByAdmin : SAY.roomTaken, 7000);
      if (msg.reason === 'admin') say('kicked');
      break;
    case 'admin-data':
      state.adminData = msg;
      renderAdmin();
      break;
    case 'invite-created':
      copyText(msg.url, SAY.inviteCopied);
      break;
    case 'password-reset':
      showAdminNotice(`Новый пароль для ${msg.login}:`, msg.password);
      break;
    case 'joined': {
      const rejoin = state.currentRoom?.id === msg.room.id;
      state.joiningRoom = null;
      for (const id of [...peers.keys()]) removePeer(id, true);
      if (!rejoin && state.currentRoom) resetMedia();
      state.currentRoom = msg.room;
      enterRoomUi(msg.room);
      if (rejoin) {
        toast(SAY.reconnected);
      } else {
        $('#messages').innerHTML = '';
        msg.history.forEach(addChatMessage);
        addSystemMessage(
          msg.peers.length ? `В комнате: ${msg.peers.map((p) => p.name).join(', ')}` : SAY.first
        );
        say(msg.peers.length ? 'enter' : 'alone');
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
      say('join', [[660, 880]]);
      updateAlone();
      break;
    case 'peer-left': {
      const p = peers.get(msg.id);
      if (p) {
        addSystemMessage(SAY.left(p.name));
        say('leave', [[880, 660]]);
      }
      removePeer(msg.id);
      updateAlone();
      break;
    }
    case 'state': {
      const p = peers.get(msg.id);
      if (!p) break;
      if (msg.state.sharing && !p.state.sharing) say('stream');
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
      say('poke', [[1200, 900, 1200], 0.07, 0.1]);
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
      if (msg.message.from !== state.myId) {
        if (chatHidden()) {
          state.unread++;
          $('#unread').textContent = state.unread;
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
  say('message');
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const avatar = users.get(m.userId)?.avatar;
  const n = new Notification(m.name, {
    body: m.text ? m.text.slice(0, 200) : '🖼 Картинка',
    icon: avatar || '/img/icon.svg',
    silent: !settings.sounds,
  });
  n.onclick = () => {
    window.focus();
    n.close();
  };
}

export { connect, sendState, sendWs };
