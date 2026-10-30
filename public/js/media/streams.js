import { $ } from '../core/dom.js';
import { CAMERA, SCREEN_PRESETS, settings } from '../core/preferences.js';
import { local, peers, state } from '../core/state.js';
import { say, warn } from '../ui/feedback.js';
import { sendState, sendWs } from '../connection/signaling.js';
import { tuneSenders } from '../connection/peers.js';
import { updateControls } from '../ui/controls.js';

function addTracks(peer, stream) {
  return stream.getTracks().map((track) => peer.pc.addTrack(track, stream));
}

function removeSenders(peer, senders) {
  for (const s of senders) {
    try {
      peer.pc.removeTrack(s);
    } catch {}
  }
}

async function startCamera() {
  const video = {
    width: { ideal: CAMERA.width },
    height: { ideal: CAMERA.height },
    frameRate: { ideal: CAMERA.frameRate },
  };
  if (settings.cameraDeviceId) video.deviceId = { exact: settings.cameraDeviceId };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video });
  } catch (e) {
    return warn(
      e.name === 'NotAllowedError'
        ? 'Нет доступа к камере. Разреши её в настройках.'
        : 'Камера не включилась: ' + e.message
    );
  }
  stream.getVideoTracks()[0].contentHint = 'motion';
  stream.getVideoTracks()[0].addEventListener('ended', stopCamera);
  local.camStream = stream;
  local.camera = true;
  sendState(); // сначала id потока, чтобы друзья знали, что это камера, а не экран
  for (const peer of peers.values()) {
    if (peer.waitingOffer) continue; // получит камеру вместе с остальными треками
    peer.camSenders = addTracks(peer, stream);
    setTimeout(() => tuneSenders(peer), 1500);
  }
  updateControls();
  renderSelfVideo();
}

function stopCamera() {
  if (!local.camera) return;
  for (const peer of peers.values()) {
    removeSenders(peer, peer.camSenders);
    peer.camSenders = [];
  }
  local.camStream.getTracks().forEach((t) => t.stop());
  local.camStream = null;
  local.camera = false;
  sendState();
  updateControls();
  renderSelfVideo();
}

async function startShare() {
  const preset = SCREEN_PRESETS[settings.screenQuality];
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: preset.width },
        height: { ideal: preset.height },
        frameRate: { ideal: preset.frameRate },
      },
      // restrictOwnAudio: в стрим не попадает то, что играет сама страница (голоса друзей,
      // звук чужих стримов). Без этого два стримера со звуком гоняют звук по кругу.
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        restrictOwnAudio: true,
      },
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
    });
  } catch (e) {
    if (e.name !== 'NotAllowedError' && e.name !== 'AbortError')
      warn('Не удалось начать демонстрацию: ' + e.message);
    return;
  }
  const video = stream.getVideoTracks()[0];
  video.contentHint = preset.hint;
  video.addEventListener('ended', stopShare);
  local.screenStream = stream;
  local.sharing = true;
  // Сам стрим уйдёт только тем, кто нажмёт «Смотреть». Остальным — редкие снимки для превью.
  local.stopPreviews = startPreviews(stream);
  say('mystream');
  sendState();
  updateControls();
  renderStage();
}

function stopShare() {
  if (!local.sharing) return;
  for (const peer of peers.values()) {
    removeSenders(peer, peer.screenSenders);
    peer.screenSenders = [];
    peer.wantsScreen = false;
  }
  local.stopPreviews?.();
  local.screenStream.getTracks().forEach((t) => t.stop());
  local.screenStream = null;
  local.sharing = false;
  if (state.watching === 'self') state.watching = null;
  sendState();
  updateControls();
  renderStage();
}

const PREVIEW = { width: 320, height: 180, everyMs: 5000 };

function startPreviews(stream) {
  const video = document.createElement('video');
  video.muted = true;
  video.srcObject = stream;
  video.play().catch(() => {});
  const canvas = document.createElement('canvas');
  canvas.width = PREVIEW.width;
  canvas.height = PREVIEW.height;
  const ctx = canvas.getContext('2d');
  const snap = () => {
    if (!video.videoWidth || !peers.size) return;
    const k = Math.min(PREVIEW.width / video.videoWidth, PREVIEW.height / video.videoHeight);
    const w = video.videoWidth * k;
    const h = video.videoHeight * k;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, PREVIEW.width, PREVIEW.height);
    ctx.drawImage(video, (PREVIEW.width - w) / 2, (PREVIEW.height - h) / 2, w, h);
    sendWs({ type: 'preview', image: canvas.toDataURL('image/jpeg', 0.6) });
  };
  const first = setTimeout(snap, 800);
  const timer = setInterval(snap, PREVIEW.everyMs);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
    video.srcObject = null;
  };
}

function watchStream(id) {
  if (state.watching === id) return;
  if (state.watching && state.watching !== 'self')
    sendWs({ type: 'signal', to: state.watching, data: { watch: false } });
  state.watching = id;
  if (id && id !== 'self') sendWs({ type: 'signal', to: id, data: { watch: true } });
  renderStage();
}

function peerCamStream(peer) {
  if (!peer.state.camera) return null;
  for (const s of peer.videoStreams)
    if (s.id === peer.state.camStreamId && s.getVideoTracks().length) return s;
  return null;
}

function peerScreenStream(peer) {
  if (!peer.state.sharing) return null;
  for (const s of peer.videoStreams)
    if (s.id !== peer.state.camStreamId && s.getVideoTracks().length) return s;
  return null;
}

function setTileVideo(tile, stream) {
  const media = tile.querySelector('.tile-media');
  let video = media.querySelector('video');
  if (stream) {
    if (!video) {
      video = document.createElement('video');
      video.autoplay = video.playsInline = video.muted = true;
      media.append(video);
    }
    if (video.srcObject !== stream) video.srcObject = stream;
  } else if (video) {
    video.srcObject = null;
    video.remove();
  }
  tile.querySelector('.avatar').hidden = !!stream;
  tile.classList.toggle('has-video', !!stream);
}

function renderPeerVideo(peer) {
  if (peer.tile) setTileVideo(peer.tile, peerCamStream(peer));
}

function renderSelfVideo() {
  const tile = document.querySelector('.tile.self');
  if (tile) setTileVideo(tile, local.camStream);
}

function renderStage() {
  const stage = $('#stage');
  const streams = [];
  if (local.sharing && local.screenStream) streams.push({ id: 'self', name: 'Твой экран' });
  for (const p of peers.values()) if (p.state.sharing) streams.push({ id: p.id, name: p.name, peer: p });
  if (state.watching && !streams.some((s) => s.id === state.watching)) state.watching = null;

  let main = stage.querySelector('.screen-view');
  const watched = streams.find((s) => s.id === state.watching);
  if (watched) {
    if (!main) {
      main = document.createElement('div');
      main.className = 'screen-view';
      main.innerHTML = `<video autoplay playsinline muted></video><span class="label"></span>
        <div class="view-actions"><button class="fs" title="На весь экран">⛶</button><button class="unwatch" title="Перестать смотреть">✕</button></div>`;
      main.querySelector('.fs').onclick = () =>
        document.fullscreenElement ? document.exitFullscreen() : main.requestFullscreen();
      main.querySelector('.unwatch').onclick = () => watchStream(null);
      main.querySelector('video').ondblclick = () => main.requestFullscreen();
      stage.prepend(main);
    }
    const stream = watched.peer ? peerScreenStream(watched.peer) : local.screenStream;
    const video = main.querySelector('video');
    if (video.srcObject !== stream) video.srcObject = stream;
    // Пока видео не пришло, показываем превью и «подключаюсь».
    main.classList.toggle('loading', !stream);
    main.style.backgroundImage = !stream && watched.peer?.preview ? `url("${watched.peer.preview}")` : '';
    main.querySelector('.label').textContent = watched.peer ? `Экран: ${watched.name}` : watched.name;
  } else if (main) {
    main.querySelector('video').srcObject = null;
    main.remove();
  }

  let cards = stage.querySelector('.stream-cards');
  if (!cards) {
    cards = document.createElement('div');
    cards.className = 'stream-cards';
    stage.append(cards);
  }
  const existing = new Map([...cards.children].map((el) => [el.dataset.key, el]));
  for (const s of streams) {
    if (s.id === state.watching) continue;
    let card = existing.get(s.id);
    existing.delete(s.id);
    if (!card) {
      card = document.createElement('button');
      card.type = 'button';
      card.className = 'stream-card';
      card.dataset.key = s.id;
      card.title = 'Смотреть';
      card.innerHTML = `<span class="live">в эфире</span><span class="label"></span><span class="watch">Смотреть</span>`;
      card.onclick = () => watchStream(s.id);
      // Свой экран показываем вживую: он и так есть локально, сеть не тратится.
      card.prepend(document.createElement(s.peer ? 'img' : 'video'));
      if (!s.peer) {
        const v = card.querySelector('video');
        v.autoplay = v.muted = v.playsInline = true;
        v.srcObject = local.screenStream;
      }
      cards.append(card);
    }
    card.querySelector('.label').textContent = s.name;
    if (s.peer) {
      const img = card.querySelector('img');
      img.hidden = !s.peer.preview;
      if (s.peer.preview && img.src !== s.peer.preview) img.src = s.peer.preview;
      card.classList.toggle('no-preview', !s.peer.preview);
    }
  }
  for (const el of existing.values()) {
    const v = el.querySelector('video');
    if (v) v.srcObject = null;
    el.remove();
  }
  cards.hidden = !cards.children.length;
  stage.hidden = streams.length === 0;
}

export {
  addTracks,
  removeSenders,
  renderPeerVideo,
  renderSelfVideo,
  renderStage,
  startCamera,
  startShare,
  stopCamera,
  stopShare,
};
