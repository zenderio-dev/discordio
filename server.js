import { createApplication } from './src/application.js';
import { createConfig, loadEnv } from './src/config.js';
import { inviteUsable } from './src/domain.js';
import { startFunnelWatchdog } from './src/services/funnel-watchdog.js';

const rawLog = console.log.bind(console);
console.log = (...args) => rawLog(new Date().toLocaleTimeString('ru-RU'), ...args);
const config = createConfig(loadEnv());
const application = createApplication(config);
const { server, store } = application;
const { db, inviteUrl } = store;
const { PORT, HOST, PUBLIC_URL, ADMIN_LOGIN } = config;
let stopWatchdog;
server.listen(PORT, HOST, () => {
  console.log(`discordio слушает http://localhost:${PORT}`);
  if (!PUBLIC_URL)
    console.log('Подсказка: задай PUBLIC_URL в .env, иначе ссылки-приглашения будут вести на localhost.');
  // Сайт выставлен через Tailscale Funnel: следим, чтобы он не пропадал из интернета.
  if (
    /\.ts\.net$/.test(PUBLIC_URL ? new URL(PUBLIC_URL).hostname : '') &&
    process.env.FUNNEL_WATCHDOG !== '0'
  ) {
    stopWatchdog = startFunnelWatchdog({ publicUrl: PUBLIC_URL, port: PORT });
  }
  if (!db.users.some((u) => u.role === 'admin')) {
    const invite = db.invites.find((i) => i.forLogin === ADMIN_LOGIN && inviteUsable(i));
    if (invite)
      console.log(`Админа ещё нет. Зарегистрируй аккаунт ${ADMIN_LOGIN} по ссылке: ${inviteUrl(invite)}`);
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    stopWatchdog?.();
    await application.close();
    process.exit(0);
  });
}
