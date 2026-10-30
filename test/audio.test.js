import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

test('audio worklet passes voice, mutes and honors push-to-talk', async () => {
  let Processor;
  const context = vm.createContext({
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { postMessage() {} };
      }
    },
    sampleRate: 48000,
    currentFrame: 0,
    registerProcessor: (_name, value) => {
      Processor = value;
    },
  });
  vm.runInContext(
    await fs.readFile(new URL('../public/js/gate-worklet.js', import.meta.url), 'utf8'),
    context
  );
  const gate = new Processor();
  const input = [new Float32Array(128).fill(0.5)];
  const output = [new Float32Array(128)];
  const run = (blocks) => {
    for (let i = 0; i < blocks; i++) {
      gate.process([input], [output]);
      context.currentFrame += 128;
    }
  };
  gate.port.onmessage({ data: { mode: 'open' } });
  run(10);
  assert.ok(output[0][127] > 0.49);
  gate.port.onmessage({ data: { muted: true } });
  run(30);
  assert.ok(output[0][127] < 0.001);
  gate.port.onmessage({ data: { muted: false, mode: 'ptt', pttDown: false } });
  run(100);
  assert.ok(output[0][127] < 0.001);
  gate.port.onmessage({ data: { pttDown: true } });
  run(10);
  assert.ok(output[0][127] > 0.49);
  gate.port.onmessage({ data: { pttDown: false } });
  run(100);
  assert.ok(output[0][127] < 0.001);
});
