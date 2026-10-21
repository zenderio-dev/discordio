// discordio для Windows: окно с веб-клиентом твоего сервера плюс то, что браузер не умеет:
// глобальный push-to-talk, трей, свой выбор экрана и ссылки discordio://.
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  shell,
  session,
  desktopCapturer,
  nativeImage,
  dialog,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// Экономим ресурсы: выключаем ненужные службы Chromium.
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService,SpareRendererForSitePerProcess');
app.setAppUserModelId('com.zenderio.discordio'); // без этого Windows не показывает уведомления

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const ICON = path.join(__dirname, 'icon.png');
let config = {};
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch {}
const saveConfig = () => fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

let win = null;
let tray = null;
let quitting = false;

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
const serverOrigin = () => config.server || null;
const isServerUrl = (url) => {
  try {
    return !!serverOrigin() && new URL(url).origin === serverOrigin();
  } catch {
    return false;
  }
};

function showConnect(error) {
  win.loadFile(path.join(__dirname, 'connect.html'), { query: { error: error || '', server: config.server || '' } });
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
      preload: path.join(__dirname, 'preload.js'),
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
    if (!quitting) {
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
    if (isMainFrame && code !== -3 && isServerUrl(url)) showConnect(`Сервер не отвечает (${desc}). Он точно запущен?`);
  });

  openServer();
}

// Разрешения (микрофон, камера, уведомления) — только для своего сервера.
function setupPermissions() {
  const allowed = new Set(['media', 'notifications', 'clipboard-sanitized-write', 'fullscreen', 'display-capture']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(allowed.has(permission) && isServerUrl(details.requestingUrl));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => allowed.has(permission) && isServerUrl(origin));

  // Демонстрация экрана: показываем свой выбор окна/экрана внутри интерфейса.
  let pickId = 0;
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
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

// ---------- Глобальный push-to-talk ----------
// Ловим клавишу даже когда окно не в фокусе (например, в игре). Хук включается только в режиме PTT.
let hook = null;
let pttTarget = null; // { type: 'key', code } | { type: 'mouse', button }
let pttDown = false;

function domCodeToUiohook(code, UiohookKey) {
  const special = {
    ControlLeft: 'Ctrl',
    ControlRight: 'CtrlRight',
    AltLeft: 'Alt',
    AltRight: 'AltRight',
    ShiftLeft: 'Shift',
    ShiftRight: 'ShiftRight',
    MetaLeft: 'Meta',
    MetaRight: 'MetaRight',
  };
  const name = special[code] || code.replace(/^Key/, '').replace(/^Digit/, '');
  return UiohookKey[name];
}

function setPttKey(code) {
  if (!code) {
    pttTarget = null;
    if (hook) {
      hook.stop();
      hook = null;
    }
    return;
  }
  let lib;
  try {
    lib = require('uiohook-napi');
  } catch (e) {
    console.error('uiohook-napi недоступен', e);
    return;
  }
  if (code.startsWith('Mouse')) {
    // DOM: 1 — средняя, 2 — правая, 3/4 — боковые. libuiohook: 3 — средняя, 2 — правая, 4/5 — боковые.
    const dom = Number(code.slice(5));
    pttTarget = { type: 'mouse', button: { 0: 1, 1: 3, 2: 2, 3: 4, 4: 5 }[dom] };
  } else {
    const keycode = domCodeToUiohook(code, lib.UiohookKey);
    pttTarget = keycode == null ? null : { type: 'key', code: keycode };
  }
  if (!pttTarget || hook) return;
  hook = lib.uIOhook;
  const send = (down) => {
    if (pttDown === down) return;
    pttDown = down;
    win?.webContents.send('ptt', down);
  };
  hook.on('keydown', (e) => pttTarget?.type === 'key' && e.keycode === pttTarget.code && send(true));
  hook.on('keyup', (e) => pttTarget?.type === 'key' && e.keycode === pttTarget.code && send(false));
  hook.on('mousedown', (e) => pttTarget?.type === 'mouse' && e.button === pttTarget.button && send(true));
  hook.on('mouseup', (e) => pttTarget?.type === 'mouse' && e.button === pttTarget.button && send(false));
  hook.start();
}

// ---------- Ссылки discordio://host/#room ----------
async function handleDeepLink(link) {
  if (!link || !link.startsWith('discordio://')) return;
  const rest = link.slice('discordio://'.length).replace(/\/$/, '');
  const [hostPart, ...roomParts] = rest.split(/\/#?|#/);
  const origin = normalizeServer(hostPart);
  if (!origin) return;
  const room = roomParts.join('').replace(/[^A-Za-z0-9_-]/g, '');
  if (origin !== config.server) {
    // Защита от чужих ссылок: сервер получит доступ к микрофону, поэтому спрашиваем.
    const { response } = await dialog.showMessageBox(win, {
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
  win.show();
  openServer(room ? '#' + room : '');
}
const linkFromArgv = (argv) => argv.find((a) => a.startsWith('discordio://'));

// ---------- Трей ----------
function createTray() {
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
        { label: 'Выйти', click: () => ((quitting = true), app.quit()) },
      ])
    );
  rebuild();
  tray.on('click', () => (win.isVisible() && win.isFocused() ? win.hide() : win.show()));
}

// ---------- IPC ----------
ipcMain.on('ptt-key', (_e, code) => setPttKey(typeof code === 'string' ? code : null));
ipcMain.on('flash', () => {
  if (win && !win.isFocused()) win.flashFrame(true);
});
ipcMain.on('change-server', () => showConnect());
ipcMain.handle('get-server', () => config.server || '');
ipcMain.handle('set-server', (_e, input) => {
  const origin = normalizeServer(input);
  if (!origin) return { ok: false, error: 'Нужен адрес вида https://твой-сервер (или http://localhost:3000)' };
  config.server = origin;
  saveConfig();
  openServer();
  return { ok: true };
});

app.on('second-instance', (_e, argv) => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
  handleDeepLink(linkFromArgv(argv));
});

app.whenReady().then(() => {
  if (!app.isDefaultProtocolClient('discordio')) {
    app.setAsDefaultProtocolClient('discordio', process.execPath, process.defaultApp ? [path.resolve(process.argv[1])] : []);
  }
  setupPermissions();
  createWindow();
  createTray();
  handleDeepLink(linkFromArgv(process.argv));
});

app.on('before-quit', () => {
  quitting = true;
  hook?.stop();
});
app.on('window-all-closed', () => app.quit());
