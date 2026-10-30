import crypto from 'node:crypto';
export const clientIp = (req) =>
  String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim() || req.socket.remoteAddress;

export function parseCookies(header) {
  const out = Object.create(null);
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* Ignore a malformed cookie instead of rejecting the entire request. */
    }
  }
  return out;
}
export function createSessions({ db, save, userById }, { SESSION_DAYS }) {
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

  const cleanup = setInterval(() => {
    let changed = false;
    for (const [token, s] of Object.entries(db.sessions)) {
      if (s.expires < Date.now()) {
        delete db.sessions[token];
        changed = true;
      }
    }
    if (changed) save();
  }, 600_000).unref();
  return { sessionUser, startSession, parseCookies, close: () => clearInterval(cleanup) };
}
