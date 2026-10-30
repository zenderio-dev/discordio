import { CAMERA, SCREEN_PRESETS, peerMuted, peerVolumes, settings } from '../core/preferences.js';
import { local, peers, state } from '../core/state.js';
import { sendWs } from './signaling.js';
import { addTracks, removeSenders, renderPeerVideo, renderStage } from '../media/streams.js';
import { renderPeerTile, updateTile } from '../ui/participants.js';

function createPeer(info, waitForOffer = false) {
  if (peers.has(info.id)) return peers.get(info.id);
  const pc = new RTCPeerConnection({ iceServers: state.config.iceServers });
  const peer = {
    id: info.id,
    userId: info.userId,
    name: info.name,
    avatar: info.avatar || null,
    state: info.state || {},
    preview: info.preview || null, // снимок экрана, пока его стрим не смотрю
    wantsScreen: false, // этот участник смотрит мой стрим
    pc,
    polite: state.myId < info.id,
    makingOffer: false,
    ignoreOffer: false,
    audioEls: new Map(),
    micTrack: null,
    videoStreams: new Set(),
    screenSenders: [],
    camSenders: [],
    rtt: null,
    tile: null,
    pendingCandidates: [],
    signalQueue: Promise.resolve(),
    watchdog: null,
  };
  peers.set(info.id, peer);
  // Страховка: если соединение так и не поднялось, «невежливая» сторона перезапускает ICE.
  peer.watchdog = setInterval(() => {
    if (
      !peer.polite &&
      !peer.waitingOffer &&
      ['new', 'failed'].includes(pc.connectionState) &&
      pc.signalingState === 'stable'
    )
      pc.restartIce();
  }, 8000);

  peer.waitingOffer = waitForOffer;
  if (!waitForOffer) addLocalTracks(peer);
  // Не соединились за 15 секунд — сообщаем серверу, чтобы в логе было видно, в чём дело.
  peer.diagTimer = setTimeout(() => reportStuck(peer), 15000);

  pc.onnegotiationneeded = async () => {
    try {
      peer.makingOffer = true;
      await pc.setLocalDescription();
      sendWs({ type: 'signal', to: peer.id, data: { description: pc.localDescription } });
    } catch (e) {
      console.error('negotiation', e);
    } finally {
      peer.makingOffer = false;
    }
  };
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) sendWs({ type: 'signal', to: peer.id, data: { candidate } });
  };
  pc.onconnectionstatechange = () => {
    updateTile(peer);
    clearTimeout(peer.iceTimer);
    if (pc.connectionState === 'connected') tuneSenders(peer);
    if (pc.connectionState === 'failed') {
      pc.restartIce();
      reportStuck(peer);
    }
    // Сменилась сеть (включили VPN, переключился Wi-Fi): не ждём 'failed', переподбираем маршрут сразу.
    if (pc.connectionState === 'disconnected') {
      peer.iceTimer = setTimeout(() => {
        if (pc.connectionState === 'disconnected' && !peer.polite) pc.restartIce();
      }, 3000);
    }
  };
  pc.ontrack = ({ track, streams }) => {
    const stream = streams[0] || new MediaStream([track]);
    if (track.kind === 'video') {
      peer.videoStreams.add(stream);
      stream.addEventListener('removetrack', () => {
        if (!stream.getVideoTracks().length) peer.videoStreams.delete(stream);
        renderPeerVideo(peer);
        renderStage();
      });
      renderPeerVideo(peer);
      renderStage();
      return;
    }
    const isMic =
      stream.id !== peer.state.screenStreamId &&
      stream.id !== peer.state.camStreamId &&
      !stream.getVideoTracks().length;
    if (isMic) peer.micTrack = track;
    attachAudio(peer, stream);
  };

  renderPeerTile(peer);
  return peer;
}

async function reportStuck(peer) {
  if (peer.reported || peers.get(peer.id) !== peer || peer.pc.connectionState === 'connected') return;
  peer.reported = true;
  const local = new Set();
  const remote = new Set();
  try {
    (await peer.pc.getStats()).forEach((r) => {
      if (r.type === 'local-candidate') local.add(`${r.candidateType}/${r.protocol}`);
      if (r.type === 'remote-candidate') remote.add(`${r.candidateType}/${r.protocol}`);
    });
  } catch {}
  const state = `${peer.pc.connectionState}/${peer.pc.iceConnectionState}`;
  sendWs({ type: 'diag', to: peer.id, state, local: [...local], remote: [...remote] });
}

async function onSignal(from, data) {
  const peer = peers.get(from);
  if (!peer) return;
  const pc = peer.pc;
  try {
    if ('watch' in data) {
      // Друг начал или перестал смотреть мой стрим: экран шлём только тем, кто смотрит.
      peer.wantsScreen = !!data.watch;
      if (peer.wantsScreen) sendScreenTo(peer);
      else {
        removeSenders(peer, peer.screenSenders);
        peer.screenSenders = [];
      }
    } else if (data.description) {
      const desc = data.description;
      const collision = desc.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
      peer.ignoreOffer = !peer.polite && collision;
      if (peer.ignoreOffer) return;
      await pc.setRemoteDescription(desc);
      // Кандидаты, пришедшие раньше описания, применяем теперь.
      for (const c of peer.pendingCandidates.splice(0)) pc.addIceCandidate(c).catch(() => {});
      if (desc.type === 'offer') {
        if (peer.waitingOffer) {
          // Треки встают в уже предложенные слоты, поэтому ответ сразу их содержит.
          peer.waitingOffer = false;
          addLocalTracks(peer);
        }
        await pc.setLocalDescription();
        sendWs({ type: 'signal', to: from, data: { description: pc.localDescription } });
      }
    } else if (data.candidate) {
      if (!pc.remoteDescription) {
        peer.pendingCandidates.push(data.candidate);
        return;
      }
      try {
        await pc.addIceCandidate(data.candidate);
      } catch (e) {
        if (!peer.ignoreOffer) throw e;
      }
    }
  } catch (e) {
    console.error('signal', e);
  }
}

async function tuneSenders(peer) {
  const camTrack = local.camStream?.getVideoTracks()[0];
  for (const sender of peer.pc.getSenders()) {
    if (!sender.track) continue;
    const params = sender.getParameters();
    if (!params.encodings?.length) continue;
    const enc = params.encodings[0];
    if (sender.track.kind === 'audio') {
      enc.maxBitrate = sender.track === state.mic.track ? 64_000 : 128_000;
      if (sender.track === state.mic.track) {
        enc.priority = 'high';
        enc.networkPriority = 'high';
      }
    } else if (sender.track === camTrack) {
      enc.maxBitrate = CAMERA.bitrate;
      enc.maxFramerate = CAMERA.frameRate;
      params.degradationPreference = 'balanced';
    } else {
      const preset = SCREEN_PRESETS[settings.screenQuality];
      enc.maxBitrate = preset.bitrate;
      enc.maxFramerate = preset.frameRate;
      params.degradationPreference = preset.hint === 'motion' ? 'maintain-framerate' : 'maintain-resolution';
    }
    try {
      await sender.setParameters(params);
    } catch (e) {
      console.warn('setParameters', e);
    }
  }
}

function applyPeerAudio(peer) {
  for (const el of peer.audioEls.values()) {
    el.volume = (peerVolumes[peer.userId] ?? 100) / 100;
    el.muted = local.deafened || !!peerMuted[peer.userId];
  }
}

function attachAudio(peer, stream) {
  if (peer.audioEls.has(stream.id)) return;
  const el = new Audio();
  el.autoplay = true;
  el.srcObject = stream;
  if (settings.outputDeviceId && el.setSinkId) el.setSinkId(settings.outputDeviceId).catch(() => {});
  peer.audioEls.set(stream.id, el);
  applyPeerAudio(peer);
  el.play().catch(() => {});
  stream.addEventListener('removetrack', () => {
    if (!stream.getAudioTracks().length) {
      el.srcObject = null;
      peer.audioEls.delete(stream.id);
    }
  });
}

function removePeer(id, silent) {
  const peer = peers.get(id);
  if (!peer) return;
  clearInterval(peer.watchdog);
  clearTimeout(peer.iceTimer);
  clearTimeout(peer.diagTimer);
  peer.pc.close();
  for (const el of peer.audioEls.values()) el.srcObject = null;
  peer.tile?.remove();
  peers.delete(id);
  if (state.watching === id) state.watching = null;
  if (!silent) renderStage();
}

function addLocalTracks(peer) {
  peer.pc.addTrack(state.mic.track, state.mic.stream);
  if (peer.wantsScreen) sendScreenTo(peer);
  if (local.camera && local.camStream) peer.camSenders = addTracks(peer, local.camStream);
}

function sendScreenTo(peer) {
  // Пока соединение не согласовано, треки добавит addLocalTracks.
  if (!local.sharing || !local.screenStream || peer.screenSenders.length || peer.waitingOffer) return;
  peer.screenSenders = addTracks(peer, local.screenStream);
  setTimeout(() => tuneSenders(peer), 1500);
}

export { applyPeerAudio, createPeer, onSignal, removePeer, tuneSenders };
