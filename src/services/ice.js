export function createIceService(env) {
  function iceServers() {
    if (env.ICE_SERVERS_JSON) {
      try {
        return JSON.parse(env.ICE_SERVERS_JSON);
      } catch (e) {
        console.error('ICE_SERVERS_JSON: не получилось разобрать JSON', e.message);
      }
    }
    const list = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
    if (env.TURN_URL) {
      list.push({
        urls: env.TURN_URL.split(',').map((s) => s.trim()),
        username: env.TURN_USER || '',
        credential: env.TURN_PASS || '',
      });
    }
    return list;
  }

  // TURN от Cloudflare: посредник для тех, кто не может соединиться напрямую (оба за «серым» NAT).
  // Временные логины берём по API; сам ключ остаётся на сервере.
  let cfTurn = { servers: null, expires: 0 };
  async function cloudflareTurn() {
    const keyId = env.CF_TURN_KEY_ID;
    const token = env.CF_TURN_API_TOKEN;
    if (!keyId || !token) return null;
    if (cfTurn.servers && cfTurn.expires > Date.now()) return cfTurn.servers;
    try {
      const res = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ttl: 86_400 }),
          signal: AbortSignal.timeout(8000),
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const servers = [].concat((await res.json()).iceServers || []).map((srv) => ({
        ...srv,
        // Порт 53 браузеры всё равно не пускают.
        urls: [].concat(srv.urls).filter((u) => !/:53(\?|$)/.test(u)),
      }));
      cfTurn = { servers, expires: Date.now() + 12 * 3_600_000 }; // логины живут сутки, обновляем дважды
      return servers;
    } catch (e) {
      console.log('TURN Cloudflare: не получилось получить логины:', e.message);
      return cfTurn.servers; // старые ещё могут быть живы
    }
  }

  return { iceServers, cloudflareTurn };
}
