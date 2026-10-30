function createPushToTalk({ getWindow, loadHook = () => require('uiohook-napi') }) {
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
      lib = loadHook();
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
      getWindow()?.webContents.send('ptt', down);
    };
    hook.on('keydown', (e) => pttTarget?.type === 'key' && e.keycode === pttTarget.code && send(true));
    hook.on('keyup', (e) => pttTarget?.type === 'key' && e.keycode === pttTarget.code && send(false));
    hook.on('mousedown', (e) => pttTarget?.type === 'mouse' && e.button === pttTarget.button && send(true));
    hook.on('mouseup', (e) => pttTarget?.type === 'mouse' && e.button === pttTarget.button && send(false));
    hook.start();
  }

  return { setPttKey, stop: () => hook?.stop() };
}
module.exports = { createPushToTalk };
