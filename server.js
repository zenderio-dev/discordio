// Сигнальный сервер: раздаёт веб-клиент, держит комнаты, пересылает
// WebRTC-сигналы и текстовый чат. Голос и видео идут напрямую между браузерами.
import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_PEERS = Number(process.env.MAX_PEERS || 8);
const HISTORY_SIZE = 200;

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

const app = express();
app.disable('x-powered-by');
app.get('/config.json', (_req, res) => {
  res.json({ iceServers: iceServers(), maxPeers: MAX_PEERS });
});
app.use(
  '/vendor/nsup',
  express.static(path.join(__dirname, 'node_modules/@sapphi-red/web-noise-suppressor/dist'))
);
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024 });

/** @type {Map<string, {salt: Buffer, hash: Buffer, peers: Map<string, any>, history: any[]}>} */
const rooms = new Map();

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 32);
}

// Простая защита от перебора паролей: не больше 10 неудачных входов в минуту с одного IP.
const failures = new Map();
function tooManyFailures(ip) {
  const now = Date.now();
  const list = (failures.get(ip) || []).filter((t) => now - t < 60_000);
  failures.set(ip, list);
  return list.length >= 10;
}
function recordFailure(ip) {
  const list = failures.get(ip) || [];
  list.push(Date.now());
  failures.set(ip, list);
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg, exceptId) {
  for (const [id, peer] of room.peers) {
    if (id !== exceptId) send(peer.ws, msg);
  }
}

function publicPeer(p) {
  return { id: p.id, name: p.name, state: p.state };
}

const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 32);
const cleanRoom = (s) => String(s || '').trim().toLowerCase().slice(0, 64);

wss.on('connection', (ws, req) => {
  const ip =
    String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '')
      .split(',')[0]
      .trim() || req.socket.remoteAddress;
  let room = null;
  let roomId = null;
  let me = null;

  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'join') {
      if (me) return;
      const rid = cleanRoom(msg.room);
      const name = cleanName(msg.name);
      const password = String(msg.password || '');
      if (!/^[a-z0-9_-]{1,64}$/.test(rid)) {
        return send(ws, { type: 'error', code: 'bad-room', message: 'Имя комнаты: латиница, цифры, - и _' });
      }
      if (!name) return send(ws, { type: 'error', code: 'bad-name', message: 'Укажи имя' });
      if (password.length < 4) {
        return send(ws, { type: 'error', code: 'bad-password', message: 'Пароль минимум 4 символа' });
      }
      if (tooManyFailures(ip)) {
        return send(ws, { type: 'error', code: 'rate-limit', message: 'Слишком много попыток, подожди минуту' });
      }

      let r = rooms.get(rid);
      if (!r) {
        // Первый вошедший задаёт пароль комнаты. Комната живёт, пока в ней кто-то есть.
        const salt = crypto.randomBytes(16);
        r = { salt, hash: hashPassword(password, salt), peers: new Map(), history: [] };
        rooms.set(rid, r);
      } else if (!crypto.timingSafeEqual(hashPassword(password, r.salt), r.hash)) {
        recordFailure(ip);
        return send(ws, { type: 'error', code: 'wrong-password', message: 'Неверный пароль' });
      }
      if (r.peers.size >= MAX_PEERS) {
        return send(ws, { type: 'error', code: 'full', message: `Комната заполнена (максимум ${MAX_PEERS})` });
      }

      room = r;
      roomId = rid;
      me = {
        id: crypto.randomUUID(),
        name,
        ws,
        state: { muted: false, deafened: false, sharing: false, screenStreamId: null },
      };
      send(ws, {
        type: 'joined',
        id: me.id,
        room: rid,
        peers: [...room.peers.values()].map(publicPeer),
        history: room.history,
      });
      room.peers.set(me.id, me);
      broadcast(room, { type: 'peer-joined', peer: publicPeer(me) }, me.id);
      console.log(`[${rid}] + ${name} (${room.peers.size})`);
      return;
    }

    if (!me) return;

    switch (msg.type) {
      case 'signal': {
        const target = room.peers.get(msg.to);
        if (target) send(target.ws, { type: 'signal', from: me.id, data: msg.data });
        break;
      }
      case 'state': {
        const s = msg.state || {};
        me.state = {
          muted: !!s.muted,
          deafened: !!s.deafened,
          sharing: !!s.sharing,
          screenStreamId: s.sharing ? String(s.screenStreamId || '').slice(0, 64) : null,
        };
        broadcast(room, { type: 'state', id: me.id, state: me.state }, me.id);
        break;
      }
      case 'chat': {
        const text = String(msg.text || '').slice(0, 2000);
        if (!text.trim()) break;
        const entry = { id: crypto.randomUUID(), from: me.id, name: me.name, text, ts: Date.now() };
        room.history.push(entry);
        if (room.history.length > HISTORY_SIZE) room.history.shift();
        broadcast(room, { type: 'chat', message: entry });
        break;
      }
      case 'ping':
        send(ws, { type: 'pong', t: msg.t });
        break;
    }
  });

  ws.on('close', () => {
    if (!me || !room) return;
    room.peers.delete(me.id);
    broadcast(room, { type: 'peer-left', id: me.id });
    console.log(`[${roomId}] - ${me.name} (${room.peers.size})`);
    if (room.peers.size === 0) rooms.delete(roomId);
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
});
