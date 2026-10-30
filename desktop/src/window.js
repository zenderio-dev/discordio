const { BrowserWindow, shell } = require('electron');
const path = require('node:path');
function createWindowController({ rootDir, configStore, isQuitting }) {
  const { config, serverOrigin, isServerUrl } = configStore;
  const ICON = path.join(rootDir, 'icon.png');
  let win = null;
  function showConnect(error) {
    win.loadFile(path.join(rootDir, 'connect.html'), {
      query: { error: error || '', server: config.server || '' },
    });
  }
  function openServer(hash = '') {
    if (!serverOrigin()) return showConnect();
    win.loadURL(serverOrigin() + '/' + hash);
  }

  function createWindow() {
    win = new BrowserWindow({
      width: 1100,
      height: 720,
      minWidth: 380,
      minHeight: 500,
      show: false,
      backgroundColor: '#fff3f6',
      autoHideMenuBar: true,
      icon: ICON,
      title: 'discordio',
      webPreferences: {
        preload: path.join(rootDir, 'preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    win.setMenu(null);
    win.once('ready-to-show', () => win.show());
    win.on('focus', () => win.flashFrame(false));
    win.on('close', (e) => {
      // Крестик сворачивает в трей, чтобы разговор не обрывался.
      if (!isQuitting()) {
        e.preventDefault();
        win.hide();
      }
    });

    const wc = win.webContents;
    // Внешние ссылки открываем в обычном браузере, а не внутри приложения.
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (e, url) => {
      if (isServerUrl(url) || url.startsWith('file:')) return;
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    });
    wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      if (isMainFrame && code !== -3 && isServerUrl(url))
        showConnect(`Сервер не отвечает (${desc}). Он точно запущен?`);
    });

    openServer();
  }

  return { showConnect, openServer, createWindow, getWindow: () => win };
}
module.exports = { createWindowController };
