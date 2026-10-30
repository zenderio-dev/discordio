// Озвучка цундерочки: короткие реплики на события комнаты.
// Файлы лежат в /voice/ и называются «событие-номер.mp3» (join-1.mp3, join-2.mp3…):
// на одно событие можно положить несколько вариантов, играет случайный, но не тот же, что в прошлый раз.

// Эти реплики важнее остальных: прерывают текущую, а не ждут её конца.
const URGENT = new Set(['poke', 'talking-muted', 'kicked', 'reconnecting']);

export class Voice {
  constructor() {
    this.lines = {}; // событие -> [url]
    this.last = {};
    this.current = null;
  }

  async load() {
    try {
      const files = await (await fetch('/voice/list.json')).json();
      for (const file of files) {
        const event = file.replace(/(-\d+)?\.\w+$/, '');
        (this.lines[event] ||= []).push('/voice/' + encodeURIComponent(file));
      }
    } catch {}
  }

  has(event) {
    return !!this.lines[event]?.length;
  }

  // false — реплики на это событие нет, пусть играет обычный звук.
  play(event, { volume = 1, sinkId = '' } = {}) {
    const list = this.lines[event];
    if (!list?.length) return false;
    const busy = this.current && !this.current.ended && !this.current.paused;
    if (busy && !URGENT.has(event)) return true; // не перебиваем саму себя
    if (busy) this.current.pause();
    const options = list.length > 1 ? list.filter((u) => u !== this.last[event]) : list;
    const url = options[Math.floor(Math.random() * options.length)];
    this.last[event] = url;
    const audio = new Audio(url);
    audio.volume = Math.max(0, Math.min(1, volume));
    if (sinkId && audio.setSinkId) audio.setSinkId(sinkId).catch(() => {});
    audio.play().catch(() => {});
    this.current = audio;
    return true;
  }
}
