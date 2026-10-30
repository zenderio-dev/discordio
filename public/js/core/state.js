const users = new Map();

const hashParams = new URLSearchParams(location.hash.slice(1));

const local = {
  muted: false,
  deafened: false,
  sharing: false,
  screenStream: null,
  camera: false,
  camStream: null,
  speaking: false,
};

const peers = new Map();

export const state = {
  config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
  mic: null,
  ws: null,
  me: null,
  myId: null,
  loggedOut: true,
  reconnectDelay: 1000,
  rooms: [],
  currentRoom: null,
  joiningRoom: null,
  autoJoin: hashParams.get('r'),
  inviteToken: hashParams.get('invite'),
  pttDown: false,
  unread: 0,
  watching: null,
  bindingKey: false,
  adminData: null,
};

export { local, peers, users };
