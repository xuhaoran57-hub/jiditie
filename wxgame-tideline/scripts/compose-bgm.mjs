// 原创八小节通勤小品：D 大调，104 BPM，电钢琴、指弹贝斯与轻鼓组。
// 所有音符和混响尾音按整段长度折回，避免循环时切断声音。
export const BGM_INFO = Object.freeze({ bpm: 104, bars: 8, beatsPerBar: 4 });

const TAU = Math.PI * 2;
const frequency = (midi) => 440 * 2 ** ((midi - 69) / 12);
const clamp01 = (value) => Math.max(0, Math.min(1, value));

export function renderBgm(sampleRate = 22050) {
  const beat = 60 / BGM_INFO.bpm;
  const length = Math.round(BGM_INFO.bars * BGM_INFO.beatsPerBar * beat * sampleRate);
  const keys = new Float64Array(length);
  const lead = new Float64Array(length);
  const rhythm = new Float64Array(length);
  let seed = 0x74696465;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  const add = (track, startBeat, seconds, sample) => {
    const start = Math.round(startBeat * beat * sampleRate);
    const count = Math.ceil(seconds * sampleRate);
    for (let i = 0; i < count; i += 1) {
      const index = ((start + i) % length + length) % length;
      track[index] += sample(i / sampleRate, seconds);
    }
  };

  const piano = (track, midi, start, beats, velocity, melody = false) => {
    const hz = frequency(midi);
    const held = beats * beat;
    const release = melody ? 0.2 : 0.32;
    const seconds = held + release;
    add(track, start, seconds, (t) => {
      const attack = Math.sin(clamp01(t / 0.009) * Math.PI / 2) ** 2;
      const tail = t <= held ? 1 : Math.cos(clamp01((t - held) / release) * Math.PI / 2) ** 2;
      const phase = TAU * hz * t;
      const tine = Math.sin(phase + 0.55 * Math.exp(-t * 8) * Math.sin(phase * 2));
      const body = 0.82 * tine + 0.13 * Math.sin(phase * 2) * Math.exp(-t * 5)
        + 0.05 * Math.sin(phase * 3) * Math.exp(-t * 9);
      const decay = melody ? 0.24 + 0.76 * Math.exp(-t * 2.8) : Math.exp(-t * 2.2);
      return velocity * attack * tail * decay * body;
    });
  };

  const bass = (midi, start, beats, velocity) => {
    const hz = frequency(midi);
    const held = beats * beat;
    add(rhythm, start, held + 0.09, (t) => {
      const attack = Math.sin(clamp01(t / 0.012) * Math.PI / 2) ** 2;
      const release = t < held ? 1 : Math.cos(clamp01((t - held) / 0.09) * Math.PI / 2) ** 2;
      const phase = TAU * hz * t;
      // 二次谐波让小手机扬声器也能听出低音走向。
      return velocity * attack * release * Math.exp(-t * 1.5)
        * (Math.sin(phase) + 0.28 * Math.sin(phase * 2) + 0.06 * Math.sin(phase * 3));
    });
  };

  const kick = (start, velocity) => add(rhythm, start, 0.22, (t, seconds) => {
    const phase = TAU * (48 * t + 68 * 0.023 * (1 - Math.exp(-t / 0.023)));
    return velocity * Math.sin(phase) * clamp01(t / 0.003) * Math.exp(-t * 24) * clamp01((seconds - t) / 0.02);
  });

  const snare = (start, velocity) => {
    let smooth = 0;
    let softened = 0;
    add(rhythm, start, 0.16, (t, seconds) => {
      const noise = random() * 2 - 1;
      smooth += 0.16 * (noise - smooth);
      softened += 0.45 * (noise - smooth - softened);
      const body = 0.3 * Math.sin(TAU * 185 * t) * Math.exp(-t * 38);
      return velocity * clamp01(t / 0.002) * clamp01((seconds - t) / 0.02)
        * (softened * Math.exp(-t * 30) + body);
    });
  };

  const hat = (start, velocity, open = false) => {
    let smooth = 0;
    let softened = 0;
    add(rhythm, start, open ? 0.15 : 0.065, (t, seconds) => {
      const noise = random() * 2 - 1;
      smooth += 0.22 * (noise - smooth);
      softened += 0.5 * (noise - smooth - softened);
      return velocity * softened * clamp01(t / 0.003) * Math.exp(-t * (open ? 26 : 65)) * clamp01((seconds - t) / 0.012);
    });
  };

  // 低音与上方和弦分开配器，避免密集的低频和弦。
  const harmony = [
    { root: 38, notes: [54, 57, 61, 64] }, // Dmaj9
    { root: 35, notes: [54, 57, 61, 62] }, // Bm9
    { root: 43, notes: [54, 57, 59, 62] }, // Gmaj9
    { root: 45, notes: [55, 59, 61, 66] }, // A13
    { root: 42, notes: [57, 61, 64, 66] }, // Dmaj9/F#
    { root: 35, notes: [54, 57, 61, 62] }, // Bm9
    { root: 40, notes: [55, 59, 62, 66] }, // Em9
    { root: 45, notes: [55, 59, 61, 66] }, // A13
  ];
  // 留出呼吸的问答旋律；后四小节向上展开，末句回到下一轮的主和弦。
  const melody = [
    [[0.25, 66, 0.7], [1.25, 69, 0.35], [1.85, 71, 0.6], [2.85, 69, 0.65]],
    [[0.25, 66, 0.5], [1.1, 64, 0.35], [1.85, 62, 0.9], [3.15, 66, 0.45]],
    [[0.25, 67, 0.6], [1.25, 71, 0.35], [1.85, 74, 0.75], [3.05, 71, 0.5]],
    [[0.25, 69, 0.65], [1.25, 66, 0.4], [2.05, 64, 0.9]],
    [[0.25, 66, 0.6], [1.25, 69, 0.35], [1.85, 71, 0.4], [2.6, 74, 0.45], [3.35, 76, 0.3]],
    [[0.25, 74, 0.6], [1.25, 73, 0.35], [2.05, 71, 0.75], [3.3, 69, 0.4]],
    [[0.25, 67, 0.6], [1.25, 71, 0.35], [1.85, 74, 0.65], [2.95, 71, 0.55]],
    [[0.25, 73, 0.6], [1.25, 71, 0.35], [2.05, 69, 0.65], [3.15, 64, 0.55]],
  ];

  harmony.forEach((chord, bar) => {
    const start = bar * 4;
    for (const [offset, duration, strength] of [[0.02, 1.65, 0.057], [2.6, 0.85, 0.036]]) {
      chord.notes.forEach((midi, voice) => piano(keys, midi, start + offset + voice * 0.014, duration, strength * (0.92 + random() * 0.12)));
    }
    bass(chord.root, start, 1.25, 0.15);
    bass(chord.root + 7, start + 1.75, 0.45, 0.09);
    bass(chord.root + 12, start + 2.6, 0.55, 0.085);
    bass(chord.root + 7, start + 3.5, 0.3, 0.067);
    melody[bar].forEach(([offset, midi, duration], index) => {
      piano(lead, midi, start + offset, duration, (index === 0 ? 0.17 : 0.145) * (0.94 + random() * 0.12), true);
    });
    kick(start, 0.17); kick(start + 2, 0.135);
    if (bar % 2 === 1) kick(start + 2.75, 0.065);
    snare(start + 1.018, 0.10); snare(start + 3.018, 0.085);
    for (let step = 0; step < 8; step += 1) {
      const offbeat = step % 2 === 1;
      hat(start + step * 0.5 + (offbeat ? 0.055 : 0), (offbeat ? 0.037 : 0.022) * (0.9 + random() * 0.2), step === 7 && bar % 2 === 1);
    }
  });

  const music = keys.map((value, index) => value + lead[index]);
  const wetTaps = [[0.047, 0.13], [0.089, 0.11], [0.151, 0.08], [0.223, 0.055], [0.347, 0.035]]
    .map(([seconds, gain]) => [Math.round(seconds * sampleRate), gain]);
  const delay = Math.round(beat * 0.75 * sampleRate);
  const mix = new Float64Array(length);
  for (let i = 0; i < length; i += 1) {
    let value = music[i] + rhythm[i];
    for (const [offset, gain] of wetTaps) value += music[(i - offset + length) % length] * gain;
    value += lead[(i - delay + length) % length] * 0.095;
    mix[i] = value;
  }

  // 两遍循环预热滤波状态，首尾具有同样的音色和残响，不用整段淡入淡出。
  const alpha = 1 - Math.exp(-TAU * 3600 / sampleRate);
  let low = 0;
  let softer = 0;
  for (let cycle = 0; cycle < 2; cycle += 1) {
    for (let i = 0; i < length; i += 1) {
      low += alpha * (mix[i] - low);
      softer += alpha * (low - softer);
      if (cycle === 1) mix[i] = Math.tanh(softer * 1.25);
    }
  }
  const mean = mix.reduce((sum, value) => sum + value, 0) / length;
  let peak = 0;
  let energy = 0;
  for (let i = 0; i < length; i += 1) {
    mix[i] -= mean;
    peak = Math.max(peak, Math.abs(mix[i]));
    energy += mix[i] ** 2;
  }
  // 留出峰值余量，保持可听清旋律但不盖过操作音效的平均响度。
  const gain = Math.min(0.72 / peak, 0.135 / Math.sqrt(energy / length));
  return Int16Array.from(mix, value => Math.round(value * gain * 32767));
}
