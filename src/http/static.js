import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
export function registerStaticRoutes(app, { rootDir, DOWNLOADS_DIR, RELEASES_URL }) {
  // Установщик приложения: если положить .exe в папку downloads/, друзья скачают его прямо
  // с твоего сервера по ссылке /download. Иначе отправляем на страницу релизов GitHub.
  app.get('/download', (_req, res) => {
    let files = [];
    try {
      files = fs
        .readdirSync(DOWNLOADS_DIR)
        .filter((f) => f.toLowerCase().endsWith('.exe'))
        .map((f) => ({ f, t: fs.statSync(path.join(DOWNLOADS_DIR, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
    } catch {}
    if (files.length) return res.download(path.join(DOWNLOADS_DIR, files[0].f));
    res.redirect(RELEASES_URL);
  });
  // Озвучка: клиент берёт отсюда список реплик (файлы public/voice/событие-номер.mp3).
  const VOICE_DIR = path.join(rootDir, 'public', 'voice');
  app.get('/voice/list.json', (_req, res) => {
    let files = [];
    try {
      files = fs.readdirSync(VOICE_DIR).filter((f) => /^[a-z-]+(-\d+)?\.(mp3|ogg|wav)$/.test(f));
    } catch {}
    res.json(files);
  });
  app.use(
    '/vendor/nsup',
    express.static(path.join(rootDir, 'node_modules/@sapphi-red/web-noise-suppressor/dist'))
  );
  app.use(express.static(path.join(rootDir, 'public')));
}
