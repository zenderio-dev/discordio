import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
export function registerUploads(app, { config, store, sessions, limiter }) {
  const { UPLOADS_DIR, MAX_UPLOAD_BYTES } = config;
  const { db } = store;
  const { sessionUser } = sessions;
  const { limited, hit } = limiter;
  const UPLOAD_NAME = /^[a-f0-9]{24}\.(png|jpg|webp|gif)$/;
  const UPLOAD_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

  // Тип определяем по началу файла, а не по тому, что заявил клиент.
  function sniffImage(buf) {
    if (buf.length < 12) return null;
    if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
      return 'png';
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
    const head = buf.toString('latin1', 0, 12);
    if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'gif';
    if (head.startsWith('RIFF') && head.slice(8) === 'WEBP') return 'webp';
    return null;
  }
  const uploadExists = (name) => UPLOAD_NAME.test(name) && fs.existsSync(path.join(UPLOADS_DIR, name));

  app.post(
    '/api/upload',
    express.raw({ type: Object.values(UPLOAD_TYPES), limit: MAX_UPLOAD_BYTES }),
    async (req, res) => {
      const user = sessionUser(req);
      if (!user) return res.status(401).json({ error: 'Не вошёл' });
      if (limited('up:' + user.id, 20, 60_000))
        return res.status(429).json({ error: 'Слишком много картинок, подожди минуту' });
      const buf = req.body;
      const ext = Buffer.isBuffer(buf) ? sniffImage(buf) : null;
      if (!ext) return res.status(400).json({ error: 'Это не картинка (нужны PNG, JPEG, WebP или GIF)' });
      hit('up:' + user.id);
      const name = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
      try {
        await fs.promises.writeFile(path.join(UPLOADS_DIR, name), buf);
      } catch (e) {
        console.error('Не получилось сохранить картинку:', e.message);
        return res.status(500).json({ error: 'Не получилось сохранить картинку' });
      }
      console.log(`+ картинка (${user.login}): ${name}, ${Math.round(buf.length / 1024)} КБ`);
      res.json({ image: name });
    }
  );

  // Смотреть картинки могут только вошедшие. Имя случайное, а тип жёстко задан расширением.
  app.get('/uploads/:name', (req, res) => {
    const name = req.params.name;
    if (!UPLOAD_NAME.test(name)) return res.sendStatus(404);
    if (!sessionUser(req)) return res.sendStatus(401);
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
    res.sendFile(name, { root: UPLOADS_DIR, dotfiles: 'deny' }, (err) => {
      if (err && !res.headersSent) res.sendStatus(404);
    });
  });

  // Удаляем файлы, которых уже нет ни в одной истории чата (сообщение выпало из последних 200).
  // Свежие не трогаем: их могли только что загрузить и ещё не отправить.
  function pruneUploads() {
    const used = new Set();
    for (const r of db.rooms) for (const m of r.history) if (m.image) used.add(m.image);
    fs.readdir(UPLOADS_DIR, (err, files) => {
      if (err) return;
      for (const f of files) {
        if (used.has(f)) continue;
        const p = path.join(UPLOADS_DIR, f);
        fs.stat(p, (e, st) => {
          if (!e && Date.now() - st.mtimeMs > 600_000) fs.unlink(p, () => {});
        });
      }
    });
  }
  pruneUploads();
  const cleanup = setInterval(pruneUploads, 600_000).unref();

  return { uploadExists, close: () => clearInterval(cleanup) };
}
