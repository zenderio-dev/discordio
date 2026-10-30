import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { JSDOM, VirtualConsole } from 'jsdom';
import { ROOT_DIR } from '../../src/config.js';

// Run the actual ES modules against the actual HTML. Media/browser APIs are
// simulated here; this deliberately does not claim to test a real WebRTC call.
export async function createBrowser(t, { hash = '', fetch: request } = {}) {
  const errors = [];
  const dom = new JSDOM(await fs.readFile(path.join(ROOT_DIR, 'public/index.html'), 'utf8'), {
    url: 'https://discordio.test/' + hash,
    runScripts: 'outside-only',
    virtualConsole: new VirtualConsole().on('jsdomError', (error) => errors.push(error)),
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const context = dom.getInternalVMContext();
  Object.defineProperty(window, 'isSecureContext', { value: true });
  Object.defineProperty(window.navigator, 'mediaDevices', {
    value: { addEventListener() {}, enumerateDevices: async () => [] },
  });
  window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  window.setInterval = () => 0;
  window.clearInterval = () => {};
  window.fetch =
    request ||
    (async (url) => ({
      ok: url === '/config.json',
      json: async () => (url === '/voice/list.json' ? [] : { iceServers: [] }),
    }));
  window.console.error = (...args) => errors.push(args);
  class Socket {
    static OPEN = 1;
    constructor() {
      this.readyState = 1;
      this.sent = [];
    }
    send(value) {
      this.sent.push(JSON.parse(value));
    }
    close() {
      this.readyState = 3;
    }
  }
  window.WebSocket = Socket;
  window.RTCPeerConnection = class {
    constructor() {
      this.connectionState = 'new';
      this.signalingState = 'stable';
    }
    addTrack() {
      return {};
    }
    getSenders() {
      return [];
    }
    getReceivers() {
      return [];
    }
    close() {
      this.connectionState = 'closed';
    }
  };
  const cache = new Map();
  const modules = new Map();
  async function load(file) {
    if (cache.has(file)) return cache.get(file);
    const pending = (async () => {
      const module = new vm.SourceTextModule(await fs.readFile(file, 'utf8'), { context, identifier: file });
      modules.set(file, module);
      return module;
    })();
    cache.set(file, pending);
    return pending;
  }
  const root = await load(path.join(ROOT_DIR, 'public/js/app.js'));
  await root.link((specifier, parent) => load(path.resolve(path.dirname(parent.identifier), specifier)));
  await root.evaluate();
  await root.namespace.ready;
  t.after(() => window.close());
  return {
    window,
    document: window.document,
    errors,
    module: (file) => modules.get(path.join(ROOT_DIR, 'public/js', file)).namespace,
  };
}
