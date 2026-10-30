const { dialog } = require('electron');
function createDeepLinks({ configStore, windowController }) {
  const { config, normalizeServer, saveConfig } = configStore;
  const { getWindow, openServer } = windowController;
  async function handleDeepLink(link) {
    if (!link || !link.startsWith('discordio://')) return;
    const rest = link.slice('discordio://'.length).replace(/\/$/, '');
    const [hostPart, ...roomParts] = rest.split(/\/#?|#/);
    const origin = normalizeServer(hostPart);
    if (!origin) return;
    const room = roomParts.join('').replace(/[^A-Za-z0-9_-]/g, '');
    if (origin !== config.server) {
      // Защита от чужих ссылок: сервер получит доступ к микрофону, поэтому спрашиваем.
      const { response } = await dialog.showMessageBox(getWindow(), {
        type: 'question',
        buttons: ['Подключиться', 'Отмена'],
        defaultId: 0,
        cancelId: 1,
        title: 'discordio',
        message: `Подключиться к серверу ${origin}?`,
        detail: 'Соглашайся, только если ссылку прислал друг.',
      });
      if (response !== 0) return;
      config.server = origin;
      saveConfig();
    }
    getWindow().show();
    openServer(room ? '#' + room : '');
  }
  const linkFromArgv = (argv) => argv.find((a) => a.startsWith('discordio://'));

  return { handleDeepLink, linkFromArgv };
}
module.exports = { createDeepLinks };
