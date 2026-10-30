import crypto from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(crypto.scrypt);
export function newId() {
  return crypto.randomBytes(6).toString('hex');
}

// ---------- Приглашения ----------
export function newInvite({ maxUses, days, createdBy, forLogin = null }) {
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
export function inviteUsable(i) {
  return !!i && !i.revoked && (!i.expires || i.expires > Date.now()) && (!i.maxUses || i.uses < i.maxUses);
}
export async function hashPassword(password, salt) {
  return (await scrypt(String(password), salt, 32)).toString('hex');
}

export const publicUser = (u) => ({
  id: u.id,
  login: u.login,
  name: u.name,
  avatar: u.avatar || null,
  admin: u.role === 'admin',
});
export const cleanName = (s) =>
  String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32);
export const cleanRoomName = (s) =>
  String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32);
// Аватарка: маленькая картинка data:URL (клиент сам ужимает до 128x128).
export function cleanAvatar(a) {
  a = String(a || '');
  return a.length <= 120_000 && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(a) ? a : null;
}
