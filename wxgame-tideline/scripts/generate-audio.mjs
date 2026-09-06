import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

function midiFrequency(noteNumber) {
  return 440 * (2 ** ((noteNumber - 69) / 12));
}

function sequenceTone(time, noteNumbers, step, amplitude, shape = triangle) {
  const cycle = noteNumbers.length * step;
  const local = ((time % cycle) + cycle) % cycle;
  const index = Math.min(noteNumbers.length - 1, Math.floor(local / step));
  const offset = local - index * step;
  const duration = step * 0.86;
  const noteNumber = noteNumbers[index];
  if (!Number.isFinite(noteNumber)) return 0;
  const frequency = midiFrequency(noteNumber);
  return envelope(offset, duration, 0.012, Math.min(0.1, step * 0.32))
    * amplitude
    * shape(frequency, offset);
}

function pulse(time, interval, frequency, amplitude) {
  const offset = ((time % interval) + interval) % interval;
  const duration = Math.min(0.14, interval * 0.42);
  return offset < duration
    ? envelope(offset, duration, 0.002, Math.min(0.06, duration * 0.55))
      * amplitude
      * sine(frequency, offset)
    : 0;
}

mkdirSync(outputDir, { recursive: true });

writeWav('tideline-loop.wav', render(8, (time) => {
  // 120 BPM、G 大调的四小节进行；跳动短句、分解和弦、低音和轻鼓点形成
  // 与上一版不同的明亮律动，并在 8 秒边界回到同一拍点实现无缝循环。
  const melody = sequenceTone(
    time,
    [83, 86, 91, 86, 83, 81, 83, 86,
      81, 78, 81, 86, 84, 81, 78, 81,
      83, 88, 91, 88, 86, 83, 81, 83,
      79, 84, 88, 86, 84, 79, 81, 83],
    0.25,
    0.14,
    (frequency, offset) => 0.62 * triangle(frequency, offset)
      + 0.3 * sine(frequency * 2, offset)
      + 0.08 * sine(frequency * 4, offset),
  );
  const bass = sequenceTone(
    time,
    [43, 43, 43, 43, 38, 38, 38, 38, 40, 40, 40, 40, 36, 36, 36, 36],
    0.5,
    0.1,
    (frequency, offset) => 0.72 * triangle(frequency, offset) + 0.28 * sine(frequency * 2, offset),
  );
  const chords = [
    [196, 247, 294],
    [147, 185, 220],
    [165, 196, 247],
    [131, 165, 196],
  ];
  const chordIndex = Math.min(chords.length - 1, Math.floor(time / 2));
  const chordLocal = time - chordIndex * 2;
  const chordFade = envelope(chordLocal, 2, 0.1, 0.1);
  const pad = chordFade * 0.024 * (
    sine(chords[chordIndex][0], time)
    + 0.68 * sine(chords[chordIndex][1], time)
    + 0.48 * sine(chords[chordIndex][2], time)
  );
  const beat = pulse(time, 0.5, 104, 0.036)
    + pulse(time - 0.25, 0.5, 208, 0.017)
    + pulse(time - 0.375, 1, 312, 0.008);
  return 0.94 * (melody + bass + pad + beat);
}));

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
