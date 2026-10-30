const { ipcMain } = require('electron');
function registerIpc({ configStore, windowController, ptt }) {
  const { config, normalizeServer, saveConfig } = configStore;
  const { getWindow, showConnect, openServer } = windowController;
  const { setPttKey } = ptt;
  ipcMain.on('ptt-key', (_e, code) => setPttKey(typeof code === 'string' ? code : null));
  ipcMain.on('flash', () => {
    const win = getWindow();
    if (win && !win.isFocused()) win.flashFrame(true);
  });
  ipcMain.on('change-server', () => showConnect());
  ipcMain.handle('get-server', () => config.server || '');
  ipcMain.handle('set-server', (_e, input) => {
    const origin = normalizeServer(input);
    if (!origin)
      return { ok: false, error: 'Нужен адрес вида https://твой-сервер (или http://localhost:3000)' };
    config.server = origin;
    saveConfig();
    openServer();
    return { ok: true };
  });
}
module.exports = { registerIpc };
