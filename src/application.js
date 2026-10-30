import express from 'express';
import http from 'node:http';
import { createConfig } from './config.js';
import { createStore } from './storage.js';
import { createSessions } from './auth/sessions.js';
import { createRateLimiter } from './auth/rate-limit.js';
import { createIceService } from './services/ice.js';
import { registerAuthRoutes } from './http/auth.js';
import { registerUploads } from './http/uploads.js';
import { registerStaticRoutes } from './http/static.js';
import { createRealtime } from './realtime/index.js';

// Creating an application never opens a port. Tests can supply an isolated DATA_DIR.
export function createApplication(config = createConfig()) {
  const store = createStore(config);
  const sessions = createSessions(store, config);
  const limiter = createRateLimiter();
  const ice = createIceService(config.env);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use('/api', express.json({ limit: '16kb' }));
  app.get('/config.json', async (_req, res) => {
    const turn = await ice.cloudflareTurn();
    res.json({
      iceServers: [...ice.iceServers(), ...(turn || [])],
      maxPeers: config.MAX_PEERS,
      publicUrl: config.PUBLIC_URL || null,
    });
  });
  let realtime;
  registerAuthRoutes(app, { store, sessions, limiter, config, sendAdmins: () => realtime?.sendAdmins() });
  const uploads = registerUploads(app, { config, store, sessions, limiter });
  registerStaticRoutes(app, config);
  const server = http.createServer(app);
  realtime = createRealtime(server, { config, store, sessions, uploads });
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    realtime.close();
    uploads.close();
    sessions.close();
    limiter.close();
    store.close();
    if (server.listening)
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
  return { app, server, store, config, close };
}
