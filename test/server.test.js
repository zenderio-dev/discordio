import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { startTestServer } from './helpers/server.js';
import { createApplication } from '../src/application.js';

test('HTTP: invitations, sessions, static modules, uploads and durable data', async (t) => {
  const app = await startTestServer(t);
  assert.equal((await app.request('/api/me')).status, 401);
  assert.equal((await app.request('/api/me', { cookie: 'sid=%E0%A4%A' })).status, 401);
  assert.equal(
    (await app.request('/api/register', { json: { login: 'user', password: 'secret123' } })).status,
    403
  );
  const invite = app.store.db.invites[0].token;
  assert.equal((await app.request('/api/invite/' + invite)).status, 200);
  const owner = await app.register('owner', invite);
  assert.equal(owner.user.admin, true);
  assert.equal((await app.request('/api/invite/' + invite)).status, 404);
  assert.equal((await app.request('/api/me', { cookie: owner.cookie })).status, 200);
  assert.equal(
    (await app.request('/api/login', { json: { login: 'owner', password: 'wrong' } })).status,
    401
  );
  assert.equal(
    (await app.request('/api/login', { json: { login: 'owner', password: 'secret123' } })).status,
    200
  );
  for (const file of [
    '/',
    '/js/app.js',
    '/js/core/state.js',
    '/js/media/microphone.js',
    '/js/gate-worklet.js',
    '/vendor/nsup/index.js',
    '/voice/list.json',
  ]) {
    const response = await app.request(file);
    assert.equal(response.status, 200, file);
    if (file.endsWith('.js')) assert.match(response.headers.get('content-type'), /javascript/);
  }
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
  assert.equal(
    (
      await app.request('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'image/png' },
        body: png,
      })
    ).status,
    401
  );
  const uploaded = await app.request('/api/upload', {
    method: 'POST',
    cookie: owner.cookie,
    headers: { 'Content-Type': 'image/png' },
    body: png,
  });
  assert.equal(uploaded.status, 200);
  const { image } = await uploaded.json();
  assert.equal((await app.request('/uploads/' + image)).status, 401);
  assert.equal((await app.request('/uploads/' + image, { cookie: owner.cookie })).status, 200);
  assert.equal(
    (
      await app.request('/api/upload', {
        method: 'POST',
        cookie: owner.cookie,
        headers: { 'Content-Type': 'image/png' },
        body: Buffer.from('not an image'),
      })
    ).status,
    400
  );
  app.store.saveNow();
  const db = JSON.parse(await fs.readFile(path.join(app.directory, 'db.json'), 'utf8'));
  assert.equal(db.users[0].login, 'owner');
  assert.equal(db.users[0].password, undefined);
  assert.equal(db.users[0].hash.length, 64);
  await app.request('/api/logout', { method: 'POST', cookie: owner.cookie });
  assert.equal((await app.request('/api/me', { cookie: owner.cookie })).status, 401);
});

test('WebSocket: rooms, signaling isolation, chat, resume replay and moderation', async (t) => {
  const app = await startTestServer(t);
  const owner = await app.register('owner', app.store.db.invites[0].token);
  const admin = await app.socket(owner.cookie);
  const hello = await admin.next('hello');
  admin.send({ type: 'invite-create', maxUses: 5, days: 1 });
  const invitation = await admin.next('invite-created');
  const token = new URL(invitation.url).hash.split('invite=')[1];
  const user = await app.register('guest', token, '<Guest>');
  const guest = await app.socket(user.cookie);
  const guestHello = await guest.next('hello');
  const room = hello.rooms[0];
  admin.send({ type: 'join', room: room.id });
  await admin.next('joined');
  guest.send({ type: 'join', room: room.id });
  const joined = await guest.next('joined');
  assert.equal(joined.peers[0].id, hello.id);
  await admin.next('peer-joined');
  guest.send({ type: 'signal', to: hello.id, data: { candidate: { candidate: 'test' } } });
  assert.equal((await admin.next('signal')).from, guestHello.id);
  guest.send({ type: 'state', state: { muted: true } });
  assert.equal((await admin.next('state')).state.muted, true);
  guest.send({ type: 'chat', text: 'hello room' });
  assert.equal((await admin.next('chat')).message.text, 'hello room');
  const lastChat = await guest.next('chat');
  // Terminate the transport to exercise the grace period and replay buffer.
  const closed = once(guest.ws, 'close');
  guest.ws.terminate();
  await closed;
  admin.send({ type: 'chat', text: 'while disconnected' });
  await admin.next('chat', (m) => m.message.text === 'while disconnected');
  const resumed = await app.socket(user.cookie, `?resume=${guestHello.resumeKey}&seq=${lastChat.seq}`);
  const resumedHello = await resumed.next('hello');
  assert.equal(resumedHello.resumed, true);
  assert.equal(resumedHello.id, guestHello.id);
  assert.equal((await resumed.next('chat')).message.text, 'while disconnected');
  admin.send({ type: 'create-room', name: 'Other' });
  const rooms = await admin.next('rooms', (m) => m.rooms.some((r) => r.name === 'Other'));
  const other = rooms.rooms.find((r) => r.name === 'Other');
  resumed.send({ type: 'join', room: other.id });
  assert.equal((await resumed.next('joined')).history.length, 0);
  admin.send({ type: 'chat', text: 'private room' });
  await admin.next('chat', (m) => m.message.text === 'private room');
  resumed.send({ type: 'ping', t: 'barrier' });
  await resumed.next('pong');
  assert.equal(
    resumed.inbox.some((m) => m.type === 'chat' && m.message.text === 'private room'),
    false
  );
  resumed.send({ type: 'ban', userId: owner.user.id, banned: true });
  resumed.send({ type: 'ping', t: 'barrier2' });
  await resumed.next('pong', (m) => m.t === 'barrier2');
  assert.equal(app.store.userById(owner.user.id).banned, undefined);
  admin.send({ type: 'kick', userId: user.user.id });
  assert.equal((await resumed.next('kicked')).reason, 'admin');
  admin.send({ type: 'ban', userId: user.user.id, banned: true });
  const [code] = await once(resumed.ws, 'close');
  assert.equal(code, 4003);
  assert.equal((await app.request('/api/me', { cookie: user.cookie })).status, 401);
  assert.equal(
    (await app.request('/api/login', { json: { login: 'guest', password: 'secret123' } })).status,
    403
  );
  app.store.saveNow();
  const db = JSON.parse(await fs.readFile(path.join(app.directory, 'db.json'), 'utf8'));
  assert.equal(db.rooms.find((r) => r.id === room.id).history.at(-1).text, 'private room');
  admin.ws.close();
});

test('extracted commands: rename/delete, profiles, revoked invites, password reset and restart', async (t) => {
  const app = await startTestServer(t);
  const owner = await app.register('owner', app.store.db.invites[0].token);
  const admin = await app.socket(owner.cookie);
  const hello = await admin.next('hello');
  admin.send({ type: 'create-room', name: 'Temporary' });
  const created = await admin.next('rooms', (m) => m.rooms.some((r) => r.name === 'Temporary'));
  const room = created.rooms.find((r) => r.name === 'Temporary');
  admin.send({ type: 'rename-room', id: room.id, name: 'Renamed' });
  await admin.next('rooms', (m) => m.rooms.some((r) => r.name === 'Renamed'));
  admin.send({ type: 'delete-room', id: room.id });
  await admin.next('rooms', (m) => !m.rooms.some((r) => r.id === room.id));
  admin.send({ type: 'delete-room', id: hello.rooms[0].id });
  assert.equal((await admin.next('error')).code, 'last-room');
  admin.send({ type: 'profile', name: 'New owner' });
  await admin.next('user', (m) => m.user.name === 'New owner');
  admin.send({ type: 'invite-create', maxUses: 5, days: 1 });
  const invitation = await admin.next('invite-created');
  const token = new URL(invitation.url).hash.split('invite=')[1];
  const guest = await app.register('guest', token);
  admin.send({ type: 'invite-revoke', token });
  admin.send({ type: 'ping', t: 'revoked' });
  await admin.next('pong', (m) => m.t === 'revoked');
  assert.equal((await app.request('/api/invite/' + token)).status, 404);
  admin.send({ type: 'reset-password', userId: guest.user.id });
  const reset = await admin.next('password-reset');
  assert.equal((await app.request('/api/me', { cookie: guest.cookie })).status, 401);
  assert.equal(
    (await app.request('/api/login', { json: { login: 'guest', password: reset.password } })).status,
    200
  );
  admin.ws.send('invalid JSON');
  admin.ws.send('null');
  admin.send({ type: 'ping', t: 'still-alive' });
  await admin.next('pong', (m) => m.t === 'still-alive');
  admin.ws.close();
  await app.close();
  const restored = createApplication(app.config);
  try {
    assert.equal(restored.store.userById(owner.user.id).name, 'New owner');
    assert.equal(restored.store.db.rooms.length, 1);
    assert.equal(restored.store.inviteByToken(token).revoked, true);
    assert.equal(restored.store.userById(guest.user.id).hash.length, 64);
  } finally {
    await restored.close();
  }
});
