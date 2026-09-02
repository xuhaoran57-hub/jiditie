import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const entrySource = readFileSync(resolve('game.js'), 'utf8');

function createContext() {
  const timers = [];
  const ticks = [];
  const calls = { runtime: 0, systemInfo: 0, canvas: 0, resize: 0 };
  const context2d = {
    setTransform() {},
    fillRect() {},
    fillText() {},
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext() { return context2d; },
  };
  const sandbox = {
    wx: {
      createCanvas() {
        calls.canvas += 1;
        return canvas;
      },
      nextTick(callback) {
        ticks.push(callback);
      },
      getWindowInfo() {
        calls.systemInfo += 1;
        throw new Error('jsbridge not ready');
      },
      getSystemInfoSync() {
        calls.systemInfo += 1;
        throw new Error('jsbridge not ready');
      },
    },
    require(request) {
      assert.equal(request, './dist/runtime/index.js');
      return {
        createWxGameRuntime() {
          calls.runtime += 1;
          if (calls.runtime === 1) throw new Error('jsbridge not ready');
          return { resize() { calls.resize += 1; } };
        },
      };
    },
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout() {},
  };
  return { sandbox, timers, ticks, calls };
}

function flushQueue(harness) {
  let guard = 0;
  while ((harness.timers.length > 0 || harness.ticks.length > 0) && guard < 20) {
    guard += 1;
    const timer = harness.timers.shift();
    if (timer) timer();
    const tick = harness.ticks.shift();
    if (tick) tick();
  }
  assert.ok(guard < 20, '入口重试队列不应无限循环');
}

test('入口等待 JSBridge 后重试，启动阶段不读取系统信息', () => {
  const harness = createContext();
  vm.runInNewContext(entrySource, harness.sandbox, { filename: 'game.js' });

  assert.equal(harness.calls.runtime, 0);
  assert.equal(harness.calls.systemInfo, 0);
  flushQueue(harness);

  assert.equal(harness.calls.runtime, 2);
  assert.equal(harness.calls.systemInfo, 0);
  assert.equal(harness.calls.canvas, 0);
  assert.equal(harness.calls.resize, 1);
});
