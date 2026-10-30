import { MicPipeline } from '../audio.js';
import { $ } from '../core/dom.js';
import { SAY } from '../core/messages.js';
import { settings } from '../core/preferences.js';
import { local, state } from '../core/state.js';
import { say, toast, warn } from '../ui/feedback.js';

async function ensureMic() {
  if (state.mic) return state.mic;
  state.mic = new MicPipeline();
  state.mic.onWarning = warn;
  state.mic.onLevel = onLevel;
  await state.mic.init();
  await state.mic.resume();
  await state.mic.apply(settings);
  state.mic.setGate({ muted: local.muted || local.deafened });
  await state.mic.setOutputDevice(settings.outputDeviceId);
  return state.mic;
}

let loudMutedTimer = null;

let lastMutedHint = 0;

function onLevel({ level, open, loudMuted }) {
  if ($('#settings').open) {
    // Индикатор в настройках: шкала от -80 до 0 дБ.
    const pct = Math.max(0, Math.min(100, ((level + 80) / 80) * 100));
    for (const id of ['#s-meter-fill', '#s-meter-fill-ptt']) {
      const el = $(id);
      el.style.width = pct + '%';
      el.classList.toggle('open', open);
    }
  }
  if (open !== local.speaking) {
    local.speaking = open;
    document.querySelector('.tile.self')?.classList.toggle('speaking', open);
  }
  // Подсказка «ты в муте», если человек говорит дольше секунды.
  clearTimeout(loudMutedTimer);
  if (
    loudMuted &&
    state.currentRoom &&
    local.muted &&
    !local.deafened &&
    Date.now() - lastMutedHint > 30000
  ) {
    loudMutedTimer = setTimeout(() => {
      lastMutedHint = Date.now();
      toast(SAY.mutedTalking);
      say('talking-muted');
    }, 1000);
  }
}

function updateGate() {
  state.mic?.setGate({ muted: local.muted || local.deafened, pttDown: state.pttDown });
}

export { ensureMic, updateGate };
