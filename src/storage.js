import fs from 'node:fs';
import { newId, newInvite, inviteUsable } from './domain.js';
export function createStore({ DATA_DIR, DB_PATH, UPLOADS_DIR, ADMIN_LOGIN, PUBLIC_URL, PORT }) {
  /** @type {{users: any[], sessions: Record<string, {userId: string, expires: number}>, rooms: any[], invites: any[]}} */
  let db = { users: [], sessions: {}, rooms: [], invites: [] };
  try {
    db = { ...db, ...JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) };
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error(`Не получилось прочитать ${DB_PATH}:`, e.message);
      throw e;
    }
  }
  if (!db.rooms.length) {
    db.rooms.push({ id: newId(), name: 'Общая', createdBy: null, createdAt: Date.now(), history: [] });
  }
  for (const u of db.users) if (u.login === ADMIN_LOGIN) u.role = 'admin';
  // Регистрация только по приглашениям. Если админа ещё нет, выдаём ему личное приглашение.
  if (
    !db.users.some((u) => u.role === 'admin') &&
    !db.invites.some((i) => i.forLogin === ADMIN_LOGIN && inviteUsable(i))
  ) {
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
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const inviteByToken = (token) => db.invites.find((i) => i.token === String(token || ''));
  const inviteUrl = (i) => `${PUBLIC_URL || `http://localhost:${PORT}`}/#invite=${i.token}`;
  const userById = (id) => db.users.find((u) => u.id === id);
  const userByLogin = (login) => db.users.find((u) => u.login === login);
  const roomById = (id) => db.rooms.find((r) => r.id === id);

  function close() {
    clearTimeout(saveTimer);
    saveNow();
  }
  return { db, save, saveNow, close, inviteByToken, inviteUrl, userById, userByLogin, roomById };
}
