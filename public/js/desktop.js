import { $, desktop } from './core/dom.js';

// Bind handlers only after every feature module has been loaded.
export function initDesktop() {
  desktop?.onPickSource(
    (sources) =>
      new Promise((resolve) => {
        const dlg = $('#picker');
        const list = $('#picker-list');
        list.innerHTML = '';
        const finish = (id) => {
          dlg.close();
          resolve(id ? { id, audio: $('#picker-audio').checked } : null);
        };
        for (const s of sources) {
          const b = document.createElement('button');
          b.type = 'button';
          b.innerHTML = `<img alt=""><span></span>`;
          b.querySelector('img').src = s.thumbnail;
          b.querySelector('span').textContent = s.name;
          b.onclick = () => finish(s.id);
          list.append(b);
        }
        $('#picker-cancel').onclick = () => finish(null);
        dlg.oncancel = () => finish(null);
        dlg.showModal();
      })
  );
}
