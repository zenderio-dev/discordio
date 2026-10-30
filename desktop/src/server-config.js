const fs = require('node:fs');
const path = require('node:path');
function normalizeServer(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname)) return null;
    return u.origin;
  } catch {
    return null;
  }
}

function createServerConfig(app) {
  const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {}
  const saveConfig = () => fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

  const serverOrigin = () => config.server || null;
  const isServerUrl = (url) => {
    try {
      return !!serverOrigin() && new URL(url).origin === serverOrigin();
    } catch {
      return false;
    }
  };

  return { config, saveConfig, normalizeServer, serverOrigin, isServerUrl };
}
module.exports = { createServerConfig, normalizeServer };
