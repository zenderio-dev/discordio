import { newId, cleanRoomName, cleanAvatar, cleanName, publicUser } from '../domain.js';
import { freshState } from './state.js';
export const LOBBY_COMMANDS = new Set([
  'create-room',
  'rename-room',
  'delete-room',
  'join',
  'leave',
  'profile',
  'ping',
]);
export function createLobbyCommands({ config, store, transport, rooms }) {
  const { MAX_ROOMS, MAX_PEERS } = config;
  const { db, save, roomById } = store;
  const { clients, send, sendAll, sendRoom, roomMembers } = transport;
  const { publicPeer, broadcastRooms, leaveRoom } = rooms;
  return function handleLobbyCommand(me, msg, error) {
    const { ws, user } = me;
    switch (msg.type) {
      case 'create-room': {
        const name = cleanRoomName(msg.name);
        if (!name) return error('bad-room', 'Назови комнату');
        if (db.rooms.length >= MAX_ROOMS) return error('too-many', `Комнат уже ${MAX_ROOMS}, удали лишние`);
        if (db.rooms.some((r) => r.name.toLowerCase() === name.toLowerCase()))
          return error('exists', 'Такая комната уже есть');
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
        if (db.rooms.some((r) => r !== room && r.name.toLowerCase() === name.toLowerCase()))
          return error('exists', 'Такая комната уже есть');
        room.name = name;
        save();
        broadcastRooms();
        return;
      }
      case 'delete-room': {
        const room = roomById(msg.id);
        if (!room) return;
        if (roomMembers(room.id).length)
          return error('not-empty', 'В комнате кто-то сидит, удалить можно только пустую');
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
        if (roomMembers(room.id).length >= MAX_PEERS)
          return error('full', `Комната заполнена (максимум ${MAX_PEERS})`);
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
  };
}
