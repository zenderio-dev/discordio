import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createApplication } from '../../src/application.js';
import { createConfig } from '../../src/config.js';

export async function startTestServer(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discordio-test-'));
  const config = createConfig({
    DATA_DIR: directory,
    PORT: '0',
    HOST: '127.0.0.1',
    ADMIN_LOGIN: 'owner',
    RESUME_GRACE_DROP_MS: '2000',
    FUNNEL_WATCHDOG: '0',
    ICE_SERVERS_JSON: '[]',
  });
  const application = createApplication(config);
  application.server.listen(0, '127.0.0.1');
  await once(application.server, 'listening');
  const base = `http://127.0.0.1:${application.server.address().port}`;
  t.after(async () => {
    await application.close();
    // Only the unique temporary directory created above is removed.
    await fs.rm(directory, { recursive: true, force: true });
  });
  async function request(url, { cookie, json, ...options } = {}) {
    const response = await fetch(base + url, {
      ...options,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(json ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      ...(json ? { body: JSON.stringify(json), method: options.method || 'POST' } : {}),
    });
    return response;
  }
  async function register(login, invite, name = login) {
    const response = await request('/api/register', { json: { login, name, password: 'secret123', invite } });
    if (!response.ok) throw Error(`Registration: ${response.status} ${await response.text()}`);
    return { cookie: response.headers.get('set-cookie').split(';')[0], ...(await response.json()) };
  }
  async function socket(cookie, query = '') {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws' + query, { headers: { cookie } });
    const inbox = [];
    const waiting = new Set();
    ws.on('message', (raw) => {
      const value = JSON.parse(raw);
      inbox.push(value);
      for (const wake of waiting) wake();
    });
    async function next(type, predicate = () => true) {
      const find = () => inbox.findIndex((message) => message.type === type && predicate(message));
      if (find() < 0)
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            waiting.delete(wake);
            reject(Error(`Timed out waiting for ${type}; got ${inbox.map((m) => m.type)}`));
          }, 2500);
          const wake = () => {
            if (find() >= 0) {
              clearTimeout(timer);
              waiting.delete(wake);
              resolve();
            }
          };
          waiting.add(wake);
        });
      return inbox.splice(find(), 1)[0];
    }
    await once(ws, 'open');
    return { ws, next, send: (message) => ws.send(JSON.stringify(message)), inbox };
  }
  return { ...application, base, request, register, socket, directory };
}
