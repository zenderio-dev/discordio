const { session, desktopCapturer, ipcMain } = require('electron');
function setupPermissions({ isServerUrl }) {
  const allowed = new Set([
    'media',
    'notifications',
    'clipboard-sanitized-write',
    'fullscreen',
    'display-capture',
  ]);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(allowed.has(permission) && isServerUrl(details.requestingUrl));
  });
  session.defaultSession.setPermissionCheckHandler(
    (_wc, permission, origin) => allowed.has(permission) && isServerUrl(origin)
  );

  // Демонстрация экрана: показываем свой выбор окна/экрана внутри интерфейса.
  let pickId = 0;
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
      });
      const id = ++pickId;
      const list = sources.map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }));
      const choice = await new Promise((resolve) => {
        const onPick = (_e, replyId, result) => {
          if (replyId !== id) return;
          ipcMain.removeListener('source-picked', onPick);
          resolve(result);
        };
        ipcMain.on('source-picked', onPick);
        request.frame.send('pick-source', id, list);
      });
      const source = choice && sources.find((s) => s.id === choice.id);
      if (!source) return callback({});
      // Ключ audio передаём только со значением: на audio: undefined Electron бросает
      // исключение, и демонстрация без звука не запускалась.
      const result = { video: source };
      if (choice.audio && process.platform === 'win32') result.audio = 'loopback';
      callback(result);
    } catch (e) {
      console.error(e);
      callback({});
    }
  });
}

module.exports = { setupPermissions };
