// Сторож Tailscale Funnel: проверяет, открывается ли сайт из интернета через каждый узел Funnel,
// и перезапускает Funnel, если узлы перестали отвечать (так бывает, например, после переключения VPN).
import https from 'node:https';
import { execFile } from 'node:child_process';

const CHECK_EVERY_MS = 15_000;
const RESTART_COOLDOWN_MS = 120_000; // после перезапуска узлам нужна минута-две, не дёргаем зря

export function startFunnelWatchdog({ publicUrl, port, log = console.log }) {
  const host = new URL(publicUrl).hostname;
  const bin =
    process.env.TAILSCALE_BIN ||
    (process.platform === 'win32' ? 'C:\\Program Files\\Tailscale\\tailscale.exe' : 'tailscale');
  let badRounds = 0;
  let lastRestart = 0;
  let busy = false;

  // Адреса узлов узнаём у публичного DNS: с этого же компьютера сайт по имени не открывается.
  async function relayIps() {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${host}&type=A`, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    return (data.Answer || []).filter((a) => a.type === 1).map((a) => a.data);
  }

  function probe(ip) {
    return new Promise((resolve) => {
      const req = https.get(
        { host: ip, servername: host, headers: { host }, path: '/config.json', timeout: 8000 },
        (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        }
      );
      req.on('timeout', () => req.destroy());
      req.on('error', () => resolve(false));
    });
  }

  const tailscale = (args) =>
    new Promise((resolve) =>
      execFile(bin, args, { timeout: 30_000, windowsHide: true }, (err, _out, errOut) =>
        resolve(err ? String(errOut || err.message).trim() : '')
      )
    );

  async function check() {
    if (busy) return;
    busy = true;
    try {
      let ips;
      try {
        ips = await relayIps();
      } catch {
        return; // нет интернета: чинить нечего
      }
      if (!ips.length) return;
      const ok = (await Promise.all(ips.map(probe))).filter(Boolean).length;
      if (ok === ips.length) {
        if (badRounds) log(`сторож: Funnel снова в порядке (${ok}/${ips.length})`);
        badRounds = 0;
        return;
      }
      badRounds++;
      log(`сторож: Funnel отвечает через ${ok} из ${ips.length} узлов (проверка ${badRounds})`);
      // Чиним после второй неудачной проверки подряд (~30 с), даже если отвечает часть узлов:
      // браузер друга может попасть как раз на мёртвый узел.
      if (badRounds < 2 || Date.now() - lastRestart < RESTART_COOLDOWN_MS) return;
      lastRestart = Date.now();
      badRounds = 0;
      log('сторож: перезапускаю Funnel');
      await tailscale(['funnel', '--https=443', 'off']);
      const err = await tailscale(['funnel', '--bg', '--yes', String(port)]);
      log(
        err
          ? `сторож: не получилось перезапустить Funnel: ${err}`
          : 'сторож: Funnel перезапущен, узлы оживут за минуту-две'
      );
    } finally {
      busy = false;
    }
  }

  const interval = setInterval(check, CHECK_EVERY_MS).unref();
  const initial = setTimeout(check, 5000).unref();
  log(`сторож Funnel включён: проверяю ${host} раз в ${CHECK_EVERY_MS / 1000} с`);
  return () => {
    clearInterval(interval);
    clearTimeout(initial);
  };
}
