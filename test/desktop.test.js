import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT_DIR } from '../src/config.js';

const require = createRequire(import.meta.url);
const { normalizeServer } = require('../desktop/src/server-config.js');
const { createPushToTalk } = require('../desktop/src/push-to-talk.js');

test('desktop server URLs retain HTTPS and local development behavior', () => {
  assert.equal(normalizeServer('friends.example/path'), 'https://friends.example');
  assert.equal(normalizeServer('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(normalizeServer('http://127.0.0.1:3000'), 'http://127.0.0.1:3000');
  assert.equal(normalizeServer('http://friends.example'), null);
  assert.equal(normalizeServer(''), null);
});

test('global PTT forwards keyboard and mouse press/release and stops hook', () => {
  const hook = new EventEmitter();
  let started = 0;
  let stopped = 0;
  hook.start = () => started++;
  hook.stop = () => stopped++;
  const sent = [];
  const ptt = createPushToTalk({
    getWindow: () => ({ webContents: { send: (...args) => sent.push(args) } }),
    loadHook: () => ({ uIOhook: hook, UiohookKey: { V: 47 } }),
  });
  ptt.setPttKey('KeyV');
  hook.emit('keydown', { keycode: 47 });
  hook.emit('keydown', { keycode: 47 });
  hook.emit('keyup', { keycode: 47 });
  assert.deepEqual(sent, [
    ['ptt', true],
    ['ptt', false],
  ]);
  ptt.setPttKey('Mouse3');
  hook.emit('mousedown', { button: 4 });
  hook.emit('mouseup', { button: 4 });
  assert.deepEqual(sent.slice(-2), [
    ['ptt', true],
    ['ptt', false],
  ]);
  assert.equal(started, 1);
  ptt.setPttKey(null);
  assert.equal(stopped, 1);
});

test('desktop main wires window, permissions, IPC, tray and shutdown', async () => {
  const events = new EventEmitter();
  const ipc = new EventEmitter();
  const handlers = new Map();
  ipc.handle = (name, fn) => handlers.set(name, fn);
  const app = Object.assign(events, {
    commandLine: { appendSwitch() {} },
    setAppUserModelId() {},
    requestSingleInstanceLock: () => true,
    getPath: () => ROOT_DIR,
    whenReady: () => Promise.resolve(),
    isDefaultProtocolClient: () => true,
    getLoginItemSettings: () => ({}),
    quit() {},
  });
  let window;
  class Window extends EventEmitter {
    constructor(options) {
      super();
      window = this;
      this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = (fn) => {
        this.openHandler = fn;
      };
    }
    setMenu() {}
    loadFile() {}
    loadURL() {}
    show() {}
    hide() {}
    flashFrame() {}
    isFocused() {
      return false;
    }
  }
  const permissionHandlers = [];
  const electron = {
    app,
    ipcMain: ipc,
    BrowserWindow: Window,
    session: {
      defaultSession: {
        setPermissionRequestHandler: (fn) => permissionHandlers.push(fn),
        setPermissionCheckHandler: (fn) => permissionHandlers.push(fn),
        setDisplayMediaRequestHandler: (fn) => permissionHandlers.push(fn),
      },
    },
    Tray: class extends EventEmitter {
      setToolTip() {}
      setContextMenu() {}
    },
    Menu: { buildFromTemplate: (value) => value },
    nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
    shell: { openExternal() {} },
  };
  const cache = new Map();
  const desktopRoot = path.join(ROOT_DIR, 'desktop');
  async function preload(directory) {
    for (const name of await fs.readdir(directory)) {
      const file = path.join(directory, name);
      const stat = await fs.stat(file);
      if (stat.isDirectory()) await preload(file);
      else if (name.endsWith('.js')) cache.set(file, { source: await fs.readFile(file, 'utf8') });
    }
  }
  await preload(path.join(desktopRoot, 'src'));
  cache.set(path.join(desktopRoot, 'main.js'), {
    source: await fs.readFile(path.join(desktopRoot, 'main.js'), 'utf8'),
  });
  function load(file) {
    const entry = cache.get(file);
    if (entry.module) return entry.module.exports;
    entry.module = { exports: {} };
    const localRequire = (name) =>
      name === 'electron'
        ? electron
        : name.startsWith('.')
          ? load(path.resolve(path.dirname(file), name + (path.extname(name) ? '' : '.js')))
          : require(name);
    vm.runInThisContext(`(function(require,module,exports,__dirname){${entry.source}\n})`, {
      filename: file,
    })(localRequire, entry.module, entry.module.exports, path.dirname(file));
    return entry.module.exports;
  }
  load(path.join(desktopRoot, 'main.js'));
  await Promise.resolve();
  assert.equal(window.options.webPreferences.contextIsolation, true);
  assert.equal(window.options.webPreferences.sandbox, true);
  assert.equal(window.options.webPreferences.preload, path.join(desktopRoot, 'preload.js'));
  assert.equal(permissionHandlers.length, 3);
  assert.equal(handlers.has('set-server'), true);
  assert.equal(handlers.has('get-server'), true);
  assert.equal(window.openHandler({ url: 'https://example.com' }).action, 'deny');
  const pkg = JSON.parse(await fs.readFile(path.join(desktopRoot, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('src/**/*.js'), 'Packaged app must include extracted modules');
  events.emit('before-quit');
});
