import crypto from 'node:crypto';
export function createRoomMessages({ config, store, transport, rooms, uploads }) {
  const { HISTORY_SIZE } = config;
  const { save, roomById } = store;
  const { clients, send, sendRoom } = transport;
  const { broadcastRooms } = rooms;
  const { uploadExists } = uploads;
  return function handleRoomMessage(me, msg) {
    const { user } = me;
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
        const image = typeof msg.image === 'string' && uploadExists(msg.image) ? msg.image : null;
        if (!room || (!text.trim() && !image)) break;
        const entry = {
          id: crypto.randomUUID(),
          from: me.id,
          userId: user.id,
          name: user.name,
          text,
          ts: Date.now(),
        };
        if (image) entry.image = image;
        room.history.push(entry);
        if (room.history.length > HISTORY_SIZE) room.history.shift();
        save();
        sendRoom(me.roomId, { type: 'chat', message: entry });
        break;
      }
      case 'preview': {
        // Снимок экрана стримера для тех, кто стрим не смотрит. Запоминаем последний для новеньких.
        const image = String(msg.image || '');
        if (
          !me.state.sharing ||
          image.length > 80_000 ||
          !/^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)
        )
          break;
        me.preview = image;
        sendRoom(me.roomId, { type: 'preview', id: me.id, image }, me.id);
        break;
      }
      case 'link': {
        // Сводка клиента о голосовом соединении с участником (раз в 30 с).
        const other = clients.get(msg.to);
        const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : '?');
        console.log(
          `~ связь ${user.login} → ${other?.user.login || '?'}: ${num(msg.rtt)} мс, маршрут ${String(msg.route).slice(0, 60)}, ` +
            `потери ${num(msg.lost)}%, джиттер ${num(msg.jitter)} мс`
        );
        break;
      }
      case 'diag': {
        // Клиент сообщает, что с кем-то так и не соединился: пишем в лог, чтобы было видно почему.
        const other = clients.get(msg.to);
        const kinds = (list) =>
          []
            .concat(list || [])
            .map(String)
            .slice(0, 10)
            .join(',') || 'нет';
        console.log(
          `! нет голоса: ${user.login} ↔ ${other?.user.login || '?'} (${String(msg.state).slice(0, 20)}); ` +
            `у ${user.login} кандидаты: ${kinds(msg.local)}, от собеседника: ${kinds(msg.remote)}`
        );
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
  };
}
