// Мост между страницей и приложением. Отдаём странице только эти функции.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('discordioDesktop', {
  setPttKey: (code) => ipcRenderer.send('ptt-key', code),
  onPtt: (cb) => ipcRenderer.on('ptt', (_e, down) => cb(!!down)),
  onPickSource: (handler) =>
    ipcRenderer.on('pick-source', async (_e, id, sources) => {
      let result = null;
      try {
        result = await handler(sources);
      } catch {}
      ipcRenderer.send('source-picked', id, result);
    }),
  flash: () => ipcRenderer.send('flash'),
  changeServer: () => ipcRenderer.send('change-server'),
  getServer: () => ipcRenderer.invoke('get-server'),
  setServer: (url) => ipcRenderer.invoke('set-server', url),
});
