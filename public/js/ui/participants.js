import { $ } from '../core/dom.js';
import { ICONS } from '../core/icons.js';
import { SAY } from '../core/messages.js';
import { peerMuted, peerVolumes, store } from '../core/preferences.js';
import { local, peers, state } from '../core/state.js';
import { paintAvatar, toast } from './feedback.js';
import { sendWs } from '../connection/signaling.js';
import { applyPeerAudio } from '../connection/peers.js';
import { renderPeerVideo, renderSelfVideo } from '../media/streams.js';

function makeTile(name, avatar) {
  const tile = $('#tile-tpl').content.firstElementChild.cloneNode(true);
  paintAvatar(tile.querySelector('.avatar'), name, avatar);
  tile.querySelector('.tile-name').textContent = name;
  return tile;
}

function renderSelfTile() {
  document.querySelector('.tile.self')?.remove();
  const tile = makeTile(state.me.name, state.me.avatar);
  tile.querySelector('.tile-name').textContent = state.me.name + ' (ты)';
  tile.classList.add('self');
  $('#tiles').prepend(tile);
  updateSelfTile();
  renderSelfVideo();
}

function updateSelfTile() {
  const tile = document.querySelector('.tile.self');
  if (!tile) return;
  tile.querySelector('.tile-icons').innerHTML =
    (local.muted || local.deafened ? ICONS.micOff : '') + (local.deafened ? ICONS.headOff : '');
}

function renderPeerTile(peer) {
  const tile = makeTile(peer.name, peer.avatar);
  const slider = tile.querySelector('input');
  slider.value = peerVolumes[peer.userId] ?? 100;
  slider.title = `Громкость: ${slider.value}%`;
  slider.oninput = () => {
    const v = Number(slider.value);
    peerVolumes[peer.userId] = v;
    store.set('volumes2', peerVolumes);
    slider.title = `Громкость: ${v}%`;
    applyPeerAudio(peer);
  };
  tile.querySelector('.mute-for-me').onclick = () => {
    if (peerMuted[peer.userId]) delete peerMuted[peer.userId];
    else peerMuted[peer.userId] = true;
    store.set('mutedPeers2', peerMuted);
    applyPeerAudio(peer);
    updateTile(peer);
  };
  tile.querySelector('.poke').onclick = () => {
    sendWs({ type: 'poke', to: peer.id });
    toast(SAY.poked(peer.name), 3000);
  };
  const kick = tile.querySelector('.kick');
  kick.hidden = !state.me?.admin;
  kick.onclick = () => {
    if (confirm(`Выгнать ${peer.name} из комнаты?`)) sendWs({ type: 'kick', userId: peer.userId });
  };
  peer.tile = tile;
  $('#tiles').append(tile);
  updateTile(peer);
  renderPeerVideo(peer);
}

function updateTile(peer) {
  const tile = peer.tile;
  if (!tile) return;
  const s = peer.state;
  const mutedForMe = !!peerMuted[peer.userId];
  tile.querySelector('.tile-icons').innerHTML =
    (s.muted || s.deafened ? ICONS.micOff : '') +
    (s.deafened ? ICONS.headOff : '') +
    (mutedForMe ? `<span class="mine" title="Заглушён для тебя">${ICONS.speakerOff}</span>` : '');
  const muteBtn = tile.querySelector('.mute-for-me');
  muteBtn.innerHTML = mutedForMe ? ICONS.speakerOff : ICONS.speaker;
  muteBtn.classList.toggle('active', mutedForMe);
  muteBtn.title = mutedForMe ? 'Снова слышать' : 'Заглушить для себя';
  tile.classList.toggle('local-muted', mutedForMe);
  const cs = peer.pc.connectionState;
  tile.classList.toggle('connecting', cs !== 'connected');
  tile.querySelector('.tile-ping').textContent =
    cs === 'connected'
      ? peer.rtt != null
        ? `${peer.rtt} мс`
        : ''
      : cs === 'failed'
        ? 'нет связи'
        : 'соединяю…';
}

function updateAlone() {
  $('#alone').hidden = peers.size > 0 || !state.currentRoom;
}

async function linkStats(peer) {
  const stats = await peer.pc.getStats();
  let pair = null;
  stats.forEach((r) => {
    if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId);
  });
  if (!pair)
    stats.forEach((r) => r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded' && (pair = r));
  const local = pair && stats.get(pair.localCandidateId);
  const remote = pair && stats.get(pair.remoteCandidateId);
  let lost = 0;
  let got = 0;
  let jitter = 0;
  stats.forEach((r) => {
    if (r.type === 'inbound-rtp' && r.kind === 'audio') {
      lost += r.packetsLost || 0;
      got += r.packetsReceived || 0;
      jitter = Math.max(jitter, r.jitter || 0);
    }
  });
  return {
    rtt: pair?.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null,
    route:
      local && remote
        ? `${local.candidateType}/${local.protocol} ↔ ${remote.candidateType}/${remote.protocol}`
        : '?',
    lost: got + lost ? Math.round((lost / (got + lost)) * 1000) / 10 : 0,
    jitter: Math.round(jitter * 1000),
  };
}

let lastLinkReport = 0;

export { renderPeerTile, renderSelfTile, updateAlone, updateSelfTile, updateTile };

// Bind handlers only after every feature module has been loaded.
export function initParticipantStats() {
  setInterval(() => {
    if (document.hidden) return;
    for (const peer of peers.values()) {
      const receiver = peer.pc.getReceivers().find((r) => r.track === peer.micTrack);
      const level = receiver?.getSynchronizationSources?.()[0]?.audioLevel ?? 0;
      peer.tile?.classList.toggle('speaking', level > 0.015 && !peer.state.muted && !peerMuted[peer.userId]);
    }
  }, 200);

  setInterval(async () => {
    // Раз в 30 секунд отправляем сводку на сервер — по логу видно, у кого и почему вырос пинг.
    const report = Date.now() - lastLinkReport > 30000;
    if (document.hidden && !report) return;
    if (report) lastLinkReport = Date.now();
    for (const peer of peers.values()) {
      if (peer.pc.connectionState !== 'connected') continue;
      try {
        const s = await linkStats(peer);
        peer.rtt = s.rtt;
        updateTile(peer);
        if (report) sendWs({ type: 'link', to: peer.id, ...s });
      } catch {}
    }
  }, 3000);
}
