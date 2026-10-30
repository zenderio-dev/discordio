import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowser } from './helpers/browser.js';

test('client ES modules initialize all handlers and display login', async (t) => {
  const browser = await createBrowser(t);
  const { document, errors } = browser;
  assert.deepEqual(errors, []);
  assert.equal(document.querySelector('#auth').hidden, false);
  assert.equal(document.querySelector('#app').hidden, true);
  for (const selector of ['#auth-form', '#chat-form'])
    assert.equal(typeof document.querySelector(selector).onsubmit, 'function', selector);
  for (const selector of [
    '#btn-mic',
    '#btn-cam',
    '#side-settings',
    '#chat-pick',
    '#admin-btn',
    '#inv-create',
    '#s-avatar',
  ])
    assert.equal(typeof document.querySelector(selector).onclick, 'function', selector);
});

test('client invitation, account, room, chat, mute and settings flows', async (t) => {
  const browser = await createBrowser(t, {
    hash: '#invite=test-token',
    fetch: async (url) => ({
      ok: true,
      json: async () =>
        url === '/voice/list.json'
          ? []
          : url.startsWith('/api/invite/')
            ? { forLogin: 'owner' }
            : url === '/api/me'
              ? { user: { id: 'u1', name: 'Owner', login: 'owner', admin: true } }
              : { iceServers: [] },
    }),
  });
  const { document, window, errors } = browser;
  const { state, local } = browser.module('core/state.js');
  const handleServer = (message) => state.ws.onmessage({ data: JSON.stringify(message) });
  const { settings } = browser.module('core/preferences.js');
  assert.equal(document.querySelector('#auth-login').value, 'owner');
  assert.equal(document.querySelector('#auth-login').readOnly, true);
  assert.equal(document.querySelector('#app').hidden, false);
  state.mic = { track: {}, stream: { getTracks: () => [] }, setGate() {}, beep() {} };
  const room = { id: 'r1', name: 'Test room', members: [] };
  await handleServer({
    type: 'hello',
    id: 'p1',
    resumeKey: 'resume',
    me: state.me,
    users: [state.me],
    rooms: [room],
  });
  assert.match(document.querySelector('#room-list').textContent, /Test room/);
  await handleServer({
    type: 'joined',
    room,
    peers: [],
    history: [
      { name: '<Alice>', userId: 'u2', text: '<script>bad()</script> https://example.com', ts: Date.now() },
    ],
  });
  assert.equal(state.currentRoom.id, 'r1');
  assert.equal(document.querySelectorAll('.tile.self').length, 1);
  assert.equal(document.querySelector('#messages script'), null);
  assert.match(document.querySelector('#messages').textContent, /<script>bad\(\)<\/script>/);
  assert.equal(document.querySelector('#messages a').rel, 'noopener noreferrer');
  document.querySelector('#btn-mic').click();
  assert.equal(local.muted, true);
  assert.equal(state.ws.sent.at(-1).state.muted, true);
  document.querySelector('#chat-input').value = 'hello';
  document.querySelector('#chat-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  assert.equal(state.ws.sent.at(-1).type, 'chat');
  assert.equal(state.ws.sent.at(-1).text, 'hello');
  await handleServer({ type: 'peer-joined', peer: { id: 'p2', userId: 'u2', name: 'Alice', state: {} } });
  assert.equal(document.querySelectorAll('.tile').length, 2);
  await handleServer({ type: 'peer-left', id: 'p2' });
  assert.equal(document.querySelectorAll('.tile').length, 1);
  await handleServer({ type: 'kicked', reason: 'admin' });
  assert.equal(state.currentRoom, null);
  const volume = document.querySelector('#s-voice-volume');
  volume.value = '35';
  volume.dispatchEvent(new window.Event('input'));
  assert.equal(settings.voiceVolume, 35);
  assert.deepEqual(errors, []);
});
