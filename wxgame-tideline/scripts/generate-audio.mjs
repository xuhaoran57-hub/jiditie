import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderBgm } from './compose-bgm.mjs';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = resolve(projectDir, 'assets', 'audio');
const SAMPLE_RATE = 22050;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function envelope(time, duration, attack = 0.008, release = 0.06) {
  const attackRatio = attack > 0 ? clamp(time / attack, 0, 1) : 1;
  const releaseRatio = release > 0 ? clamp((duration - time) / release, 0, 1) : 1;
  return Math.min(attackRatio, releaseRatio);
}

function sine(frequency, time) {
  return Math.sin(Math.PI * 2 * frequency * time);
}

function triangle(frequency, time) {
  const phase = (frequency * time) % 1;
  return 1 - 4 * Math.abs(Math.round(phase) - phase);
}

function render(duration, sample) {
  const length = Math.max(1, Math.round(duration * SAMPLE_RATE));
  const values = new Int16Array(length);
  for (let index = 0; index < length; index += 1) {
    const time = index / SAMPLE_RATE;
    values[index] = Math.round(clamp(sample(time, duration), -1, 1) * 32767);
  }
  return values;
}

function writeWav(fileName, samples) {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // PCM header size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples.length; index += 1) {
    buffer.writeInt16LE(samples[index], 44 + index * 2);
  }
  writeFileSync(resolve(outputDir, fileName), buffer);
}

function note(time, start, end, from, to, shape = sine) {
  if (time < start || time >= end) return 0;
  const ratio = (time - start) / Math.max(0.0001, end - start);
  const frequency = from + (to - from) * ratio;
  return shape(frequency, time - start);
}

mkdirSync(outputDir, { recursive: true });

writeWav('tideline-loop.wav', renderBgm(SAMPLE_RATE));

writeWav('ui-guide.wav', render(0.16, (time, duration) => {
  return envelope(time, duration) * 0.3 * note(time, 0, duration, 900, 520);
}));

writeWav('ui-success.wav', render(0.42, (time, duration) => {
  const value = note(time, 0, 0.14, 660, 660)
    + 0.8 * note(time, 0.13, 0.27, 880, 880)
    + 0.9 * note(time, 0.26, duration, 1047, 1047);
  return envelope(time, duration, 0.006, 0.08) * 0.22 * value;
}));

writeWav('ui-failure.wav', render(0.35, (time, duration) => {
  return envelope(time, duration) * 0.24 * note(time, 0, duration, 330, 180, triangle);
}));

writeWav('event-alert.wav', render(0.24, (time, duration) => {
  const value = note(time, 0, 0.11, 540, 540) + 0.9 * note(time, 0.11, duration, 760, 760);
  return envelope(time, duration, 0.004, 0.045) * 0.2 * value;
}));

console.log(`程序化音效已生成：${outputDir}`);
