const { app } = require('electron');
const path = require('node:path');
const { createServerConfig } = require('./src/server-config');
const { createWindowController } = require('./src/window');
const { setupPermissions } = require('./src/permissions');
const { createPushToTalk } = require('./src/push-to-talk');
const { createDeepLinks } = require('./src/deep-links');
const { createTray } = require('./src/tray');
const { registerIpc } = require('./src/ipc');

app.commandLine.appendSwitch(
  'disable-features',
  'HardwareMediaKeyHandling,MediaSessionService,SpareRendererForSitePerProcess'
);
app.setAppUserModelId('com.zenderio.discordio');
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

let quitting = false;
// Keep a reference so the tray remains alive for the lifetime of the process.
let _tray;
const configStore = createServerConfig(app);
const windowController = createWindowController({
  rootDir: __dirname,
  configStore,
  isQuitting: () => quitting,
});
const ptt = createPushToTalk({ getWindow: windowController.getWindow });
const { handleDeepLink, linkFromArgv } = createDeepLinks({ configStore, windowController });
registerIpc({ configStore, windowController, ptt });
app.on('second-instance', (_e, argv) => {
  const win = windowController.getWindow();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
  handleDeepLink(linkFromArgv(argv));
});

app.whenReady().then(() => {
  if (!app.isDefaultProtocolClient('discordio')) {
    app.setAsDefaultProtocolClient(
      'discordio',
      process.execPath,
      process.defaultApp ? [path.resolve(process.argv[1])] : []
    );
  }
  setupPermissions(configStore);
  windowController.createWindow();
  _tray = createTray({
    windowController,
    rootDir: __dirname,
    quit: () => {
      quitting = true;
      app.quit();
    },
  });
  handleDeepLink(linkFromArgv(process.argv));
});

app.on('before-quit', () => {
  quitting = true;
  ptt.stop();
});
app.on('window-all-closed', () => app.quit());
