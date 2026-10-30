const { app, Tray, Menu, nativeImage } = require('electron');
const path = require('node:path');
function createTray({ windowController, rootDir, quit }) {
  const { getWindow, showConnect } = windowController;
  const win = getWindow();
  const ICON = path.join(rootDir, 'icon.png');
  let tray;
  const image = nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 });
  tray = new Tray(image);
  tray.setToolTip('discordio');
  const rebuild = () =>
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Открыть', click: () => win.show() },
        { label: 'Сменить сервер', click: () => (win.show(), showConnect()) },
        {
          label: 'Запускать вместе с Windows',
          type: 'checkbox',
          checked: app.getLoginItemSettings().openAtLogin,
          click: (item) => (app.setLoginItemSettings({ openAtLogin: item.checked }), rebuild()),
        },
        { type: 'separator' },
        { label: 'Выйти', click: () => quit() },
      ])
    );
  rebuild();
  tray.on('click', () => (win.isVisible() && win.isFocused() ? win.hide() : win.show()));
  return tray;
}

module.exports = { createTray };
