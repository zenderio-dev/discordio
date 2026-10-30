import crypto from 'node:crypto';
import { newInvite, inviteUsable, hashPassword } from '../domain.js';
const randomPassword = () => crypto.randomBytes(8).toString('base64url').replace(/[-_]/g, 'x').slice(0, 10);
export const ADMIN_COMMANDS = new Set([
  'admin-get',
  'invite-create',
  'invite-revoke',
  'kick',
  'ban',
  'reset-password',
]);
export function createAdminCommands({ store, transport, rooms, administration }) {
  const { db, save, inviteByToken, inviteUrl, userById } = store;
  const { clients, send } = transport;
  const { leaveRoom } = rooms;
  const { sendAdmins, adminData, signOutEverywhere } = administration;
  return function handleAdminCommand(me, msg, error) {
    const { ws, user } = me;
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
          db.invites = db.invites.filter(
            (i) => inviteUsable(i) || Date.now() - i.createdAt < 30 * 86_400_000
          );
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
  };
}
