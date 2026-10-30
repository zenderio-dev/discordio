// Optional real Chromium/WebRTC check. Run through `npm run test:electron`.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
app.setPath('userData', process.env.DISCORDIO_SMOKE_PROFILE);
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const failures = [];
const windows = [];
const base = process.env.DISCORDIO_SMOKE_URL;

async function waitFor(win, expression, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await win.webContents.executeJavaScript(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error(`Timed out: ${label}`);
}

async function open(cookie, index) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: `smoke-${index}`,
      preload: path.resolve(__dirname, '../desktop/preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  windows.push(win);
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error') failures.push(details.message);
  });
  win.webContents.on('render-process-gone', (_event, details) => failures.push(details.reason));
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(true));
  const [name, value] = cookie.split('=');
  await win.webContents.session.cookies.set({ url: base, name, value });
  await win.loadURL(base);
  await waitFor(
    win,
    '!!window.__discordio?.ws && !!document.querySelector(".room-btn")',
    'authenticated lobby'
  );
  await win.webContents.executeJavaScript('document.querySelector(".room-btn").click()');
  await waitFor(
    win,
    '!document.querySelector("#room").hidden && !!window.__discordio.mic?.track',
    'microphone and room'
  );
  await waitFor(win, '!!window.__discordio.mic.nsNode', 'RNNoise worklet');
  return win;
}

app.whenReady().then(async () => {
  try {
    const cookies = JSON.parse(process.env.DISCORDIO_SMOKE_COOKIES);
    const first = await open(cookies[0], 0);
    const second = await open(cookies[1], 1);
    for (const win of windows) {
      await waitFor(
        win,
        '[...window.__discordio.peers.values()].some(p => p.pc.connectionState === "connected" && p.micTrack?.readyState === "live")',
        'real WebRTC audio connection'
      );
    }
    await first.webContents.executeJavaScript(
      'document.querySelector("#chat-input").value = "Chromium smoke message"; document.querySelector("#chat-form").requestSubmit()'
    );
    await waitFor(
      second,
      'document.querySelector("#messages").textContent.includes("Chromium smoke message")',
      'chat delivery'
    );
    await first.webContents.executeJavaScript('document.querySelector("#btn-cam").click()');
    await waitFor(
      second,
      '[...window.__discordio.peers.values()].some(p => p.videoStreams.size > 0)',
      'remote camera stream'
    );
    // Simulate capture with synthetic media; never capture the user's desktop.
    await first.webContents.executeJavaScript(
      'navigator.mediaDevices.getDisplayMedia = () => navigator.mediaDevices.getUserMedia({ video: true, audio: true }); document.querySelector("#btn-share").click()'
    );
    await waitFor(second, '!!document.querySelector(".stream-card")', 'screen share announcement');
    await second.webContents.executeJavaScript('document.querySelector(".stream-card").click()');
    await waitFor(
      second,
      '!!document.querySelector(".screen-view video")?.srcObject?.getVideoTracks().length',
      'screen share delivery'
    );
    await first.webContents.executeJavaScript('document.querySelector("#btn-share").click()');
    await waitFor(second, '!document.querySelector(".screen-view")', 'screen share stop');
    await first.webContents.executeJavaScript('document.querySelector("#btn-mic").click()');
    await waitFor(
      second,
      '[...window.__discordio.peers.values()].some(p => p.state.muted)',
      'remote mute state'
    );
    await first.webContents.executeJavaScript('document.querySelector("#btn-settings").click()');
    await waitFor(first, 'document.querySelector("#settings").open', 'settings dialog');
    await first.webContents.executeJavaScript(
      'document.querySelector("#settings").close(); document.querySelector("#btn-cam").click(); document.querySelector("#btn-leave").click()'
    );
    await waitFor(second, 'window.__discordio.peers.size === 0', 'peer departure');
    if (failures.length) throw Error(failures.join('\n'));
    console.log(
      'ELECTRON_SMOKE_OK: real audio connection, RNNoise, camera, synthetic screen share, chat, mute, settings, departure'
    );
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
