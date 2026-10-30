import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startTestServer } from '../test/helpers/server.js';
import { newInvite } from '../src/domain.js';

const require = createRequire(import.meta.url);
const cleanup = [];
let profile;
try {
  const app = await startTestServer({ after: (callback) => cleanup.push(callback) });
  const owner = await app.register('owner', app.store.db.invites[0].token);
  const invite = newInvite({ maxUses: 1, days: 1, createdBy: owner.user.id });
  app.store.db.invites.push(invite);
  const guest = await app.register('guest', invite.token);
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'discordio-chromium-'));
  const binary = require('../desktop/node_modules/electron');
  const env = {
    ...process.env,
    DISCORDIO_SMOKE_URL: app.base,
    DISCORDIO_SMOKE_COOKIES: JSON.stringify([owner.cookie, guest.cookie]),
    DISCORDIO_SMOKE_PROFILE: profile,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(binary, ['test/electron-smoke.cjs'], { env, windowsHide: true, stdio: 'inherit' });
  const timer = setTimeout(() => child.kill(), 90000);
  const code = await new Promise((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
  clearTimeout(timer);
  if (code !== 0) process.exitCode = 1;
} finally {
  for (const close of cleanup.reverse()) await close();
  if (profile) await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
