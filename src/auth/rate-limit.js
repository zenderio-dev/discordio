export function createRateLimiter() {
  const attempts = new Map();
  function limited(key, max, windowMs) {
    const now = Date.now();
    const list = (attempts.get(key) || []).filter((t) => now - t < windowMs);
    attempts.set(key, list);
    return list.length >= max;
  }
  function hit(key) {
    const list = attempts.get(key) || [];
    list.push(Date.now());
    attempts.set(key, list);
  }
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [k, list] of attempts) if (!list.some((t) => now - t < 3_600_000)) attempts.delete(k);
  }, 600_000).unref();

  return { limited, hit, close: () => clearInterval(cleanup) };
}
