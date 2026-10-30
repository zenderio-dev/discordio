import { LOBBY_COMMANDS, createLobbyCommands } from './lobby-commands.js';
import { ADMIN_COMMANDS, createAdminCommands } from './admin-commands.js';
import { createRoomMessages } from './room-messages.js';

export function createMessageHandler(services) {
  const lobby = createLobbyCommands(services);
  const admin = createAdminCommands(services);
  const room = createRoomMessages(services);
  return function handleMessage(me, raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;
    const error = (code, message) => services.transport.send(me.ws, { type: 'error', code, message });
    if (LOBBY_COMMANDS.has(msg.type)) return lobby(me, msg, error);
    if (ADMIN_COMMANDS.has(msg.type)) return admin(me, msg, error);
    if (me.roomId) room(me, msg);
  };
}
