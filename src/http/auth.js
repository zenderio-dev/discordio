import crypto from 'node:crypto';
import { inviteUsable, newId, cleanName, publicUser, hashPassword } from '../domain.js';
import { clientIp } from '../auth/sessions.js';
export function registerAuthRoutes(app, { store, sessions, limiter, config, sendAdmins }) {
  const { db, save, inviteByToken, userByLogin } = store;
  const { sessionUser, startSession, parseCookies } = sessions;
  const { limited, hit } = limiter;
  const { ADMIN_LOGIN } = config;
  // Клиент заранее проверяет приглашение, чтобы сразу сказать, если ссылка протухла.
  app.get('/api/invite/:token', (req, res) => {
    const i = inviteByToken(req.params.token);
    if (!inviteUsable(i))
      return res.status(404).json({ error: 'Приглашение недействительно или уже использовано' });
    res.json({ ok: true, forLogin: i.forLogin });
  });

  app.get('/api/me', (req, res) => {
    const u = sessionUser(req);
    if (!u) return res.status(401).json({ error: 'Не вошёл' });
    res.json({ user: publicUser(u) });
  });

  app.post('/api/register', async (req, res) => {
    const ip = clientIp(req);
    if (limited('reg:' + ip, 5, 3_600_000))
      return res.status(429).json({ error: 'Слишком много регистраций, попробуй позже' });
    const login = String(req.body?.login || '')
      .trim()
      .toLowerCase();
    const name = cleanName(req.body?.name) || login;
    const password = String(req.body?.password || '');
    const invite = inviteByToken(req.body?.invite);
    if (!inviteUsable(invite)) {
      hit('reg:' + ip);
      return res.status(403).json({
        error: 'Регистрация только по ссылке-приглашению. Эта ссылка недействительна или уже использована.',
      });
    }
    if (invite.forLogin && invite.forLogin !== login) {
      return res.status(403).json({ error: `Это приглашение только для логина ${invite.forLogin}` });
    }
    if (!/^[a-z0-9_.-]{3,24}$/.test(login)) {
      return res.status(400).json({ error: 'Логин: 3–24 символа, латиница, цифры, точка, - и _' });
    }
    if (password.length < 6 || password.length > 200)
      return res.status(400).json({ error: 'Пароль минимум 6 символов' });
    if (userByLogin(login)) return res.status(409).json({ error: 'Такой логин уже занят' });
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = await hashPassword(password, salt);
    if (userByLogin(login)) return res.status(409).json({ error: 'Такой логин уже занят' });
    if (!inviteUsable(invite)) return res.status(403).json({ error: 'Приглашение только что закончилось' });
    const user = {
      id: newId(),
      login,
      name,
      salt,
      hash,
      avatar: null,
      createdAt: Date.now(),
      invitedBy: invite.createdBy,
    };
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
    if (limited('login:' + ip, 10, 60_000))
      return res.status(429).json({ error: 'Слишком много попыток, подожди минуту' });
    const login = String(req.body?.login || '')
      .trim()
      .toLowerCase();
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
}
