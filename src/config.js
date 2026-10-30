import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT_DIR = fileURLToPath(new URL('../', import.meta.url));
export function loadEnv(env = process.env, rootDir = ROOT_DIR) {
  try {
    for (const line of fs.readFileSync(path.join(rootDir, '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return env;
}
export function createConfig(env = process.env, rootDir = ROOT_DIR) {
  const PORT = Number(env.PORT || 3000);
  const HOST = env.HOST || '0.0.0.0';
  const MAX_PEERS = Number(env.MAX_PEERS || 8);
  const MAX_ROOMS = 50;
  // Сколько держать место в комнате, если связь с сервером оборвалась: голос в это время идёт напрямую.
  // Сбой Funnel длится до пары минут, поэтому при обрыве (1006) ждём дольше.
  const RESUME_GRACE_MS = Number(env.RESUME_GRACE_MS || 15_000);
  const RESUME_GRACE_DROP_MS = Number(env.RESUME_GRACE_DROP_MS || 120_000);
  // Сколько последних отправленных сообщений помнить для каждого подключения, чтобы дослать после обрыва.
  const RESUME_BUFFER_BYTES = 4_000_000;
  const HISTORY_SIZE = 200;
  const SESSION_DAYS = 180;
  const DATA_DIR = env.DATA_DIR || path.join(rootDir, 'data');
  const DB_PATH = path.join(DATA_DIR, 'db.json');
  const DOWNLOADS_DIR = path.join(rootDir, 'downloads');
  // Картинки из чата лежат рядом с базой; в сообщении хранится только имя файла.
  const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
  const MAX_UPLOAD_BYTES = 8_000_000;
  const RELEASES_URL =
    env.DESKTOP_DOWNLOAD_URL || 'https://github.com/zenderio-dev/discordio/releases/latest';
  // Публичный адрес сервера: из него собираются ссылки-приглашения (с localhost друзьям не зайти).
  const PUBLIC_URL = (env.PUBLIC_URL || '').replace(/\/+$/, '');
  // Этот аккаунт всегда админ.
  const ADMIN_LOGIN = (env.ADMIN_LOGIN || 'zenderio').toLowerCase();

  return {
    PORT,
    HOST,
    MAX_PEERS,
    MAX_ROOMS,
    RESUME_GRACE_MS,
    RESUME_GRACE_DROP_MS,
    RESUME_BUFFER_BYTES,
    HISTORY_SIZE,
    SESSION_DAYS,
    DATA_DIR,
    DB_PATH,
    DOWNLOADS_DIR,
    UPLOADS_DIR,
    MAX_UPLOAD_BYTES,
    RELEASES_URL,
    PUBLIC_URL,
    ADMIN_LOGIN,
    rootDir,
    env,
  };
}
