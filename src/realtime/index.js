import { freshState } from './state.js';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { publicUser, inviteUsable } from '../domain.js';
import { createMessageHandler } from './messages.js';
export function createRealtime(server, { config, store, sessions, uploads }) {
  const { MAX_PEERS, RESUME_GRACE_MS, RESUME_GRACE_DROP_MS, RESUME_BUFFER_BYTES } = config;
  const { db, save, inviteUrl, roomById } = store;
  const { sessionUser } = sessions;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  let shuttingDown = false;
  // ---------- Голосовые комнаты ----------
  /** Подключения: id подключения -> {id, user, ws, roomId, state, lastPoke} */
  const clients = new Map();

  // Каждое сообщение участнику получает номер и запоминается. Если связь оборвалась, часть сообщений
  // могла уйти в уже мёртвый сокет; после возврата клиент скажет, что получил последним, и мы дошлём остальное.
  function send(ws, msg) {
    const c = ws.client;
    if (!c) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      return;
    }
    const data = JSON.stringify({ ...msg, seq: ++c.seq });
    c.sent.push({ seq: c.seq, data });
    c.sentBytes += data.length;
    while (c.sentBytes > RESUME_BUFFER_BYTES && c.sent.length > 1) c.sentBytes -= c.sent.shift().data.length;
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
  function sendAll(msg) {
    for (const c of clients.values()) send(c.ws, msg);
  }
  const roomMembers = (roomId) => [...clients.values()].filter((c) => c.roomId === roomId);
  function sendRoom(roomId, msg, exceptId) {
    for (const c of roomMembers(roomId)) if (c.id !== exceptId) send(c.ws, msg);
  }

  const publicPeer = (c) => ({
    id: c.id,
    userId: c.user.id,
    name: c.user.name,
    avatar: c.user.avatar || null,
    state: c.state,
    preview: c.preview,
  });
  function roomsSnapshot() {
    return db.rooms.map((r) => ({
      id: r.id,
      name: r.name,
      members: roomMembers(r.id).map((c) => ({ id: c.id, userId: c.user.id, state: c.state })),
    }));
  }
  // Список комнат с участниками видят все, кто онлайн. Аватарки шлём отдельно (они тяжёлые).
  let roomsTimer = null;
  function broadcastRooms() {
    if (roomsTimer) return;
    roomsTimer = setTimeout(() => {
      roomsTimer = null;
      sendAll({ type: 'rooms', rooms: roomsSnapshot() });
      sendAdmins();
    }, 50);
  }
  function usersSnapshot() {
    const online = new Set([...clients.values()].map((c) => c.user.id));
    return db.users.filter((u) => online.has(u.id)).map(publicUser);
  }

  // ---------- Админка ----------
  function adminData() {
    const where = new Map();
    for (const c of clients.values()) where.set(c.user.id, where.get(c.user.id) || c.roomId || null);
    return {
      users: db.users.map((u) => ({
        id: u.id,
        login: u.login,
        name: u.name,
        admin: u.role === 'admin',
        banned: !!u.banned,
        createdAt: u.createdAt,
        online: where.has(u.id),
        roomId: where.get(u.id) || null,
      })),
      invites: db.invites.filter(inviteUsable).map((i) => ({
        token: i.token,
        url: inviteUrl(i),
        createdAt: i.createdAt,
        expires: i.expires,
        maxUses: i.maxUses,
        uses: i.uses,
        forLogin: i.forLogin,
      })),
    };
  }
  function sendAdmins() {
    const admins = [...clients.values()].filter((c) => c.user.role === 'admin');
    if (!admins.length) return;
    const msg = { type: 'admin-data', ...adminData() };
    for (const c of admins) send(c.ws, msg);
  }
  // Выкидываем аккаунт отовсюду: закрываем подключения и сессии.
  function signOutEverywhere(userId, code, reason) {
    for (const c of clients.values()) {
      if (c.user.id !== userId) continue;
      if (c.dropped) dropClient(c);
      else c.ws.close(code, reason);
    }
    for (const [token, sess] of Object.entries(db.sessions))
      if (sess.userId === userId) delete db.sessions[token];
    save();
  }

  function leaveRoom(c) {
    if (!c.roomId) return;
    const roomId = c.roomId;
    c.roomId = null;
    c.state = freshState();
    c.preview = null;
    sendRoom(roomId, { type: 'peer-left', id: c.id });
    console.log(`[${roomById(roomId)?.name}] - ${c.user.name}`);
    broadcastRooms();
  }

  const handleMessage = createMessageHandler({
    config,
    store,
    uploads,
    transport: { clients, send, sendAll, sendRoom, roomMembers },
    rooms: { publicPeer, broadcastRooms, leaveRoom },
    administration: { sendAdmins, adminData, signOutEverywhere },
  });

  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://x').pathname !== '/ws') return socket.destroy();
    const user = sessionUser(req);
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (!user) return ws.close(4001, 'unauthorized');
      wss.emit('connection', ws, req, user);
    });
  });

  const hello = (me, resumed) => ({
    type: 'hello',
    resumed,
    id: me.id,
    resumeKey: me.resumeKey,
    me: publicUser(me.user),
    users: usersSnapshot(),
    rooms: roomsSnapshot(),
    maxPeers: MAX_PEERS,
  });

  wss.on('connection', (ws, req, user) => {
    const via = req.headers['tailscale-funnel-request'] ? 'интернет' : 'локально';
    // Вернулся после обрыва связи: подхватываем его старое место, никто ничего не заметит.
    const params = new URL(req.url, 'http://x').searchParams;
    const resumeKey = params.get('resume');
    const old =
      resumeKey && [...clients.values()].find((c) => c.resumeKey === resumeKey && c.user.id === user.id);
    if (old) {
      if (resumeClient(old, ws, via, Number(params.get('seq')) || 0)) return;
      dropClient(old); // слишком много пропущено: пусть заходит заново
    }

    console.log(`~ подключился ${user.login} (${via})`);
    const me = {
      id: crypto.randomUUID(),
      user,
      ws,
      resumeKey: crypto.randomBytes(16).toString('hex'),
      dropped: null,
      seq: 0,
      sent: [],
      sentBytes: 0,
      roomId: null,
      state: freshState(),
      preview: null,
      lastPoke: 0,
    };
    clients.set(me.id, me);
    attachSocket(me, ws);

    // Новенький онлайн: всем остальным отправляем его профиль.
    sendAll({ type: 'user', user: publicUser(user) });
    ws.send(JSON.stringify(hello(me, false)));
    sendAdmins();
  });

  function attachSocket(me, ws) {
    ws.client = me;
    me.ws = ws;
    me.opened = Date.now();
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    ws.on('message', (raw) => handleMessage(me, raw));
    ws.on('close', (code) => onSocketClose(me, ws, code));
  }

  function resumeClient(me, ws, via, lastSeq) {
    // Нужные сообщения уже выпали из памяти — честно вернуть место не выйдет.
    if (me.sent.length && me.sent[0].seq > lastSeq + 1) return false;
    clearTimeout(me.dropped);
    me.dropped = null;
    const oldWs = me.ws;
    attachSocket(me, ws);
    if (oldWs.readyState === oldWs.OPEN) oldWs.close(1000); // старый сокет ещё не понял, что умер
    const missed = me.sent.filter((m) => m.seq > lastSeq);
    console.log(`~ ${me.user.login} вернулся (${via}), досылаю пропущенное: ${missed.length}`);
    ws.send(JSON.stringify(hello(me, true)));
    for (const m of missed) ws.send(m.data);
    sendAdmins();
    return true;
  }

  function onSocketClose(me, ws, code) {
    if (shuttingDown) return;
    if (me.ws !== ws) return; // уже переподключился другим сокетом
    const alive = Math.round((Date.now() - me.opened) / 1000);
    // 1000 — клиент закрыл сам (выход), 1001 — закрыл вкладку или обновил страницу,
    // 4001/4003 — выкинул сервер. Остальное — обрыв связи: держим место.
    if (me.roomId && ![1000, 1001, 4001, 4003].includes(code)) {
      const grace = code === 1006 ? RESUME_GRACE_DROP_MS : RESUME_GRACE_MS;
      console.log(
        `~ связь с ${me.user.login} оборвалась (код ${code}, был на связи ${alive} с), держу место ${grace / 1000} с`
      );
      me.ws = { readyState: 3, OPEN: 1, client: me, close() {} }; // сообщения копятся в me.sent
      me.dropped = setTimeout(() => {
        console.log(`~ ${me.user.login} не вернулся`);
        dropClient(me);
      }, grace);
      return;
    }
    console.log(`~ отключился ${me.user.login}, код ${code}, был на связи ${alive} с`);
    dropClient(me);
  }

  function dropClient(me) {
    clearTimeout(me.dropped);
    me.dropped = null;
    leaveRoom(me);
    clients.delete(me.id);
    sendAdmins();
  }

  // Отключаем «мёртвые» соединения (ноутбук уснул, пропала сеть).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 15_000);
  wss.on('close', () => clearInterval(heartbeat));

  function close() {
    shuttingDown = true;
    clearTimeout(roomsTimer);
    clearInterval(heartbeat);
    for (const c of clients.values()) {
      clearTimeout(c.dropped);
      c.ws.terminate?.();
    }
    clients.clear();
    wss.close();
  }
  return { sendAdmins, close };
}
