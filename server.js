// Сигнальный сервер: раздаёт веб-клиент, хранит аккаунты и комнаты, пересылает
// WebRTC-сигналы и текстовый чат. Голос и видео идут напрямую между участниками.
import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Настройки можно положить в файл .env рядом с server.js (строки вида КЛЮЧ=значение).
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch {}

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_PEERS = Number(process.env.MAX_PEERS || 8);
const MAX_ROOMS = 50;
const HISTORY_SIZE = 200;
const SESSION_DAYS = 180;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const RELEASES_URL = process.env.DESKTOP_DOWNLOAD_URL || 'https://github.com/zenderio-dev/discordio/releases/latest';
// Публичный адрес сервера: из него собираются ссылки-приглашения (с localhost друзьям не зайти).
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
// Этот аккаунт всегда админ.
const ADMIN_LOGIN = (process.env.ADMIN_LOGIN || 'zenderio').toLowerCase();

const scrypt = promisify(crypto.scrypt);

// ---------- Хранилище ----------
// Всё лежит в одном JSON-файле: для компании друзей этого с запасом.
/** @type {{users: any[], sessions: Record<string, {userId: string, expires: number}>, rooms: any[], invites: any[]}} */
let db = { users: [], sessions: {}, rooms: [], invites: [] };
try {
  db = { ...db, ...JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) };
} catch (e) {
  if (e.code !== 'ENOENT') {
    console.error(`Не получилось прочитать ${DB_PATH}:`, e.message);
    process.exit(1);
  }
}
if (!db.rooms.length) {
  db.rooms.push({ id: newId(), name: 'Общая', createdBy: null, createdAt: Date.now(), history: [] });
}
for (const u of db.users) if (u.login === ADMIN_LOGIN) u.role = 'admin';
// Регистрация только по приглашениям. Если админа ещё нет, выдаём ему личное приглашение.
if (!db.users.some((u) => u.role === 'admin') && !db.invites.some((i) => i.forLogin === ADMIN_LOGIN && inviteUsable(i))) {
  db.invites.push(newInvite({ maxUses: 1, days: 0, createdBy: null, forLogin: ADMIN_LOGIN }));
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 500);
}
function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // Пишем во временный файл и переименовываем, чтобы не испортить базу при сбое.
  fs.writeFileSync(DB_PATH + '.tmp', JSON.stringify(db));
  fs.renameSync(DB_PATH + '.tmp', DB_PATH);
}
saveNow();
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (saveTimer) saveNow();
    process.exit(0);
  });
}

function newId() {
  return crypto.randomBytes(6).toString('hex');
}

// ---------- Приглашения ----------
function newInvite({ maxUses, days, createdBy, forLogin = null }) {
  return {
    token: crypto.randomBytes(12).toString('base64url'),
    createdBy,
    createdAt: Date.now(),
    expires: days > 0 ? Date.now() + days * 86_400_000 : 0,
    maxUses, // 0 — без ограничений
    uses: 0,
    usedBy: [],
    forLogin, // приглашение только для этого логина
    revoked: false,
  };
}
function inviteUsable(i) {
  return !!i && !i.revoked && (!i.expires || i.expires > Date.now()) && (!i.maxUses || i.uses < i.maxUses);
}
const inviteByToken = (token) => db.invites.find((i) => i.token === String(token || ''));
const inviteUrl = (i) => `${PUBLIC_URL || `http://localhost:${PORT}`}/#invite=${i.token}`;
const userById = (id) => db.users.find((u) => u.id === id);
const userByLogin = (login) => db.users.find((u) => u.login === login);
const roomById = (id) => db.rooms.find((r) => r.id === id);

async function hashPassword(password, salt) {
  return (await scrypt(String(password), salt, 32)).toString('hex');
}

function iceServers() {
  if (process.env.ICE_SERVERS_JSON) {
    try {
      return JSON.parse(process.env.ICE_SERVERS_JSON);
    } catch (e) {
      console.error('ICE_SERVERS_JSON: не получилось разобрать JSON', e.message);
    }
  }
  const list = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  if (process.env.TURN_URL) {
    list.push({
      urls: process.env.TURN_URL.split(',').map((s) => s.trim()),
      username: process.env.TURN_USER || '',
      credential: process.env.TURN_PASS || '',
    });
  }
  return list;
}

// ---------- Защита от перебора ----------
const attempts = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  attempts.set(key, list);
  return list.length >= max;
}
function hit(key) {
  const list = attempts.get(key) || [];
  list.push(Date.now());
  attempts.set(key, list);
}
setInterval(() => {
  const now = Date.now();
  for (const [k, list] of attempts) if (!list.some((t) => now - t < 3_600_000)) attempts.delete(k);
  for (const [token, s] of Object.entries(db.sessions)) if (s.expires < now) delete db.sessions[token];
}, 600_000).unref();

const clientIp = (req) =>
  String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim() || req.socket.remoteAddress;

// ---------- Сессии ----------
function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function sessionUser(req) {
  const token = parseCookies(req.headers.cookie).sid;
  const s = token && db.sessions[token];
  if (!s || s.expires < Date.now()) return null;
  const user = userById(s.userId);
  return user && !user.banned ? user : null;
}
function startSession(req, res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[token] = { userId: user.id, expires: Date.now() + SESSION_DAYS * 86_400_000 };
  save();
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader(
    'Set-Cookie',
    `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`
  );
}

const publicUser = (u) => ({ id: u.id, login: u.login, name: u.name, avatar: u.avatar || null, admin: u.role === 'admin' });
const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 32);
const cleanRoomName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 32);
// Аватарка: маленькая картинка data:URL (клиент сам ужимает до 128x128).
function cleanAvatar(a) {
  a = String(a || '');
  return a.length <= 120_000 && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(a) ? a : null;
}

// ---------- HTTP ----------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use('/api', express.json({ limit: '16kb' }));

app.get('/config.json', (_req, res) => {
  res.json({ iceServers: iceServers(), maxPeers: MAX_PEERS, publicUrl: PUBLIC_URL || null });
});

// Клиент заранее проверяет приглашение, чтобы сразу сказать, если ссылка протухла.
app.get('/api/invite/:token', (req, res) => {
  const i = inviteByToken(req.params.token);
  if (!inviteUsable(i)) return res.status(404).json({ error: 'Приглашение недействительно или уже использовано' });
  res.json({ ok: true, forLogin: i.forLogin });
});

app.get('/api/me', (req, res) => {
  const u = sessionUser(req);
  if (!u) return res.status(401).json({ error: 'Не вошёл' });
  res.json({ user: publicUser(u) });
});

app.post('/api/register', async (req, res) => {
  const ip = clientIp(req);
  if (limited('reg:' + ip, 5, 3_600_000)) return res.status(429).json({ error: 'Слишком много регистраций, попробуй позже' });
  const login = String(req.body?.login || '').trim().toLowerCase();
  const name = cleanName(req.body?.name) || login;
  const password = String(req.body?.password || '');
  const invite = inviteByToken(req.body?.invite);
  if (!inviteUsable(invite)) {
    hit('reg:' + ip);
    return res.status(403).json({ error: 'Регистрация только по ссылке-приглашению. Эта ссылка недействительна или уже использована.' });
  }
  if (invite.forLogin && invite.forLogin !== login) {
    return res.status(403).json({ error: `Это приглашение только для логина ${invite.forLogin}` });
  }
  if (!/^[a-z0-9_.-]{3,24}$/.test(login)) {
    return res.status(400).json({ error: 'Логин: 3–24 символа, латиница, цифры, точка, - и _' });
  }
  if (password.length < 6 || password.length > 200) return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  if (userByLogin(login)) return res.status(409).json({ error: 'Такой логин уже занят' });
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await hashPassword(password, salt);
  if (userByLogin(login)) return res.status(409).json({ error: 'Такой логин уже занят' });
  if (!inviteUsable(invite)) return res.status(403).json({ error: 'Приглашение только что закончилось' });
  const user = { id: newId(), login, name, salt, hash, avatar: null, createdAt: Date.now(), invitedBy: invite.createdBy };
  if (login === ADMIN_LOGIN) user.role = 'admin';
  db.users.push(user);
  invite.uses++;
  invite.usedBy.push(user.id);
  hit('reg:' + ip);
  sendAdmins();
  startSession(req, res, user);
  console.log(`+ аккаунт ${login}`);
  res.json({ user: publicUser(user) });
});

app.post('/api/login', async (req, res) => {
  const ip = clientIp(req);
  if (limited('login:' + ip, 10, 60_000)) return res.status(429).json({ error: 'Слишком много попыток, подожди минуту' });
  const login = String(req.body?.login || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = userByLogin(login);
  // Считаем хеш и для несуществующего логина, чтобы по времени ответа нельзя было угадать логины.
  const hash = await hashPassword(password, user?.salt || 'x'.repeat(32));
  if (!user || !crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'))) {
    hit('login:' + ip);
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  if (user.banned) return res.status(403).json({ error: 'Аккаунт заблокирован' });
  startSession(req, res, user);
  res.json({ user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie).sid;
  if (token && db.sessions[token]) {
    delete db.sessions[token];
    save();
  }
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

// Установщик приложения: если положить .exe в папку downloads/, друзья скачают его прямо
// с твоего сервера по ссылке /download. Иначе отправляем на страницу релизов GitHub.
app.get('/download', (_req, res) => {
  let files = [];
  try {
    files = fs
      .readdirSync(DOWNLOADS_DIR)
      .filter((f) => f.toLowerCase().endsWith('.exe'))
      .map((f) => ({ f, t: fs.statSync(path.join(DOWNLOADS_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
  } catch {}
  if (files.length) return res.download(path.join(DOWNLOADS_DIR, files[0].f));
  res.redirect(RELEASES_URL);
});
app.use(
  '/vendor/nsup',
  express.static(path.join(__dirname, 'node_modules/@sapphi-red/web-noise-suppressor/dist'))
);
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

// ---------- Голосовые комнаты ----------
/** Подключения: id подключения -> {id, user, ws, roomId, state, lastPoke} */
const clients = new Map();

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
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
  for (const c of clients.values()) if (c.user.id === userId) c.ws.close(code, reason);
  for (const [token, sess] of Object.entries(db.sessions)) if (sess.userId === userId) delete db.sessions[token];
  save();
}
const randomPassword = () => crypto.randomBytes(8).toString('base64url').replace(/[-_]/g, 'x').slice(0, 10);

const freshState = () => ({ muted: false, deafened: false, sharing: false, screenStreamId: null, camera: false, camStreamId: null });

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

server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url, 'http://x').pathname !== '/ws') return socket.destroy();
  const user = sessionUser(req);
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (!user) return ws.close(4001, 'unauthorized');
    wss.emit('connection', ws, req, user);
  });
});

wss.on('connection', (ws, _req, user) => {
  const me = { id: crypto.randomUUID(), user, ws, roomId: null, state: freshState(), preview: null, lastPoke: 0 };
  clients.set(me.id, me);
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  // Новенький онлайн: всем остальным отправляем его профиль.
  sendAll({ type: 'user', user: publicUser(user) });
  send(ws, { type: 'hello', id: me.id, me: publicUser(user), users: usersSnapshot(), rooms: roomsSnapshot(), maxPeers: MAX_PEERS });
  sendAdmins();

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;
    const error = (code, message) => send(ws, { type: 'error', code, message });

    switch (msg.type) {
      case 'create-room': {
        const name = cleanRoomName(msg.name);
        if (!name) return error('bad-room', 'Назови комнату');
        if (db.rooms.length >= MAX_ROOMS) return error('too-many', `Комнат уже ${MAX_ROOMS}, удали лишние`);
        if (db.rooms.some((r) => r.name.toLowerCase() === name.toLowerCase())) return error('exists', 'Такая комната уже есть');
        db.rooms.push({ id: newId(), name, createdBy: user.id, createdAt: Date.now(), history: [] });
        save();
        broadcastRooms();
        console.log(`+ комната «${name}» (${user.login})`);
        return;
      }
      case 'rename-room': {
        const room = roomById(msg.id);
        const name = cleanRoomName(msg.name);
        if (!room || !name) return;
        if (db.rooms.some((r) => r !== room && r.name.toLowerCase() === name.toLowerCase())) return error('exists', 'Такая комната уже есть');
        room.name = name;
        save();
        broadcastRooms();
        return;
      }
      case 'delete-room': {
        const room = roomById(msg.id);
        if (!room) return;
        if (roomMembers(room.id).length) return error('not-empty', 'В комнате кто-то сидит, удалить можно только пустую');
        if (db.rooms.length === 1) return error('last-room', 'Последнюю комнату удалять нельзя');
        db.rooms = db.rooms.filter((r) => r !== room);
        save();
        broadcastRooms();
        console.log(`- комната «${room.name}» (${user.login})`);
        return;
      }
      case 'join': {
        const room = roomById(msg.room);
        if (!room) return error('no-room', 'Такой комнаты нет');
        if (me.roomId === room.id) return;
        const others = roomMembers(room.id);
        // Тот же аккаунт с другого устройства: старое подключение выкидываем из голоса.
        for (const c of others.filter((c) => c.user.id === user.id)) {
          leaveRoom(c);
          send(c.ws, { type: 'kicked', reason: 'elsewhere' });
        }
        if (roomMembers(room.id).length >= MAX_PEERS) return error('full', `Комната заполнена (максимум ${MAX_PEERS})`);
        leaveRoom(me);
        me.roomId = room.id;
        me.state = freshState();
        send(ws, {
          type: 'joined',
          room: { id: room.id, name: room.name },
          peers: roomMembers(room.id)
            .filter((c) => c !== me)
            .map(publicPeer),
          history: room.history,
        });
        sendRoom(room.id, { type: 'peer-joined', peer: publicPeer(me) }, me.id);
        broadcastRooms();
        console.log(`[${room.name}] + ${user.name} (${roomMembers(room.id).length})`);
        return;
      }
      case 'leave':
        leaveRoom(me);
        return;
      case 'profile': {
        if ('avatar' in msg) user.avatar = cleanAvatar(msg.avatar);
        if ('name' in msg) user.name = cleanName(msg.name) || user.name;
        save();
        // Профиль общий для всех подключений этого аккаунта.
        for (const c of clients.values()) if (c.user.id === user.id) c.user = user;
        sendAll({ type: 'user', user: publicUser(user) });
        return;
      }
      case 'ping':
        send(ws, { type: 'pong', t: msg.t });
        return;
    }

    // Команды админа.
    if (user.role === 'admin') {
      const target = msg.userId ? userById(msg.userId) : null;
      switch (msg.type) {
        case 'admin-get':
          send(ws, { type: 'admin-data', ...adminData() });
          return;
        case 'invite-create': {
          const maxUses = [0, 1, 5, 10].includes(Number(msg.maxUses)) ? Number(msg.maxUses) : 1;
          const days = [0, 1, 7, 30].includes(Number(msg.days)) ? Number(msg.days) : 7;
          const invite = newInvite({ maxUses, days, createdBy: user.id });
          // Старые отработавшие приглашения не копим.
          db.invites = db.invites.filter((i) => inviteUsable(i) || Date.now() - i.createdAt < 30 * 86_400_000);
          db.invites.push(invite);
          save();
          send(ws, { type: 'invite-created', url: inviteUrl(invite) });
          sendAdmins();
          console.log(`+ приглашение (${user.login}): ${maxUses || '∞'} раз, ${days || '∞'} дн.`);
          return;
        }
        case 'invite-revoke': {
          const invite = inviteByToken(msg.token);
          if (invite) invite.revoked = true;
          save();
          sendAdmins();
          return;
        }
        case 'kick': {
          if (!target) return;
          for (const c of clients.values()) {
            if (c.user.id !== target.id || !c.roomId) continue;
            leaveRoom(c);
            send(c.ws, { type: 'kicked', reason: 'admin' });
          }
          console.log(`! ${user.login} выгнал ${target.login} из комнаты`);
          return;
        }
        case 'ban': {
          if (!target) return;
          if (target.role === 'admin') return error('admin', 'Админа забанить нельзя');
          target.banned = !!msg.banned;
          if (target.banned) signOutEverywhere(target.id, 4003, 'banned');
          save();
          sendAdmins();
          console.log(`! ${user.login} ${target.banned ? 'забанил' : 'разбанил'} ${target.login}`);
          return;
        }
        case 'reset-password': {
          if (!target) return;
          const password = randomPassword();
          target.salt = crypto.randomBytes(16).toString('hex');
          hashPassword(password, target.salt).then((hash) => {
            target.hash = hash;
            if (target.id !== user.id) signOutEverywhere(target.id, 4001, 'password-reset');
            save();
            send(ws, { type: 'password-reset', login: target.login, password });
            console.log(`! ${user.login} сбросил пароль ${target.login}`);
          });
          return;
        }
      }
    }

    // Дальше только для тех, кто в комнате.
    if (!me.roomId) return;
    switch (msg.type) {
      case 'signal': {
        const target = clients.get(msg.to);
        if (target?.roomId === me.roomId) send(target.ws, { type: 'signal', from: me.id, data: msg.data });
        break;
      }
      case 'state': {
        const s = msg.state || {};
        me.state = {
          muted: !!s.muted,
          deafened: !!s.deafened,
          sharing: !!s.sharing,
          screenStreamId: s.sharing ? String(s.screenStreamId || '').slice(0, 64) : null,
          camera: !!s.camera,
          camStreamId: s.camera ? String(s.camStreamId || '').slice(0, 64) : null,
        };
        if (!me.state.sharing) me.preview = null;
        sendRoom(me.roomId, { type: 'state', id: me.id, state: me.state }, me.id);
        broadcastRooms();
        break;
      }
      case 'chat': {
        const room = roomById(me.roomId);
        const text = String(msg.text || '').slice(0, 2000);
        if (!room || !text.trim()) break;
        const entry = { id: crypto.randomUUID(), from: me.id, userId: user.id, name: user.name, text, ts: Date.now() };
        room.history.push(entry);
        if (room.history.length > HISTORY_SIZE) room.history.shift();
        save();
        sendRoom(me.roomId, { type: 'chat', message: entry });
        break;
      }
      case 'preview': {
        // Снимок экрана стримера для тех, кто стрим не смотрит. Запоминаем последний для новеньких.
        const image = String(msg.image || '');
        if (!me.state.sharing || image.length > 80_000 || !/^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) break;
        me.preview = image;
        sendRoom(me.roomId, { type: 'preview', id: me.id, image }, me.id);
        break;
      }
      case 'poke': {
        const target = clients.get(msg.to);
        const now = Date.now();
        if (target?.roomId !== me.roomId || now - me.lastPoke < 3000) break;
        me.lastPoke = now;
        send(target.ws, { type: 'poke', from: me.id, name: user.name });
        break;
      }
    }
  });

  ws.on('close', () => {
    leaveRoom(me);
    clients.delete(me.id);
    sendAdmins();
  });
});

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

server.listen(PORT, HOST, () => {
  console.log(`discordio слушает http://localhost:${PORT}`);
  if (!PUBLIC_URL) console.log('Подсказка: задай PUBLIC_URL в .env, иначе ссылки-приглашения будут вести на localhost.');
  if (!db.users.some((u) => u.role === 'admin')) {
    const invite = db.invites.find((i) => i.forLogin === ADMIN_LOGIN && inviteUsable(i));
    if (invite) console.log(`Админа ещё нет. Зарегистрируй аккаунт ${ADMIN_LOGIN} по ссылке: ${inviteUrl(invite)}`);
  }
});
