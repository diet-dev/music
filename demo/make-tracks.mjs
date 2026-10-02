import { writeFileSync } from "node:fs";

const rate = 44100;

function wav(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

const normalize = (s, peak = 0.8) => {
  let max = 0;
  for (const v of s) max = Math.max(max, Math.abs(v));
  const k = max > 0 ? peak / max : 1;
  return s.map((v) => v * k);
};

function make(dur, render) {
  const N = rate * dur;
  const s = new Float64Array(N);
  render(s, dur);
  return normalize(Array.from(s));
}

const sine = (t, f) => Math.sin(2 * Math.PI * f * t);
const saw = (t, f) => 2 * ((t * f) % 1) - 1;
const square = (t, f) => (((t * f) % 1) < 0.5 ? 1 : -1);
const bass = (t, f) => sine(t, f) + 0.5 * sine(t, f * 2) + 0.25 * sine(t, f * 3);

const note = (s, at, len, freq, amp, tau, shape) => {
  const start = Math.floor(at * rate);
  const end = Math.min(s.length, start + Math.floor(len * rate));
  for (let i = start; i < end; i++) {
    const t = (i - start) / rate;
    const env = Math.exp(-t / tau) * (1 - Math.exp(-t / 0.003));
    s[i] += amp * env * shape(t, freq);
  }
};

const noise = (s, at, len, amp, tau) => {
  const start = Math.floor(at * rate);
  const end = Math.min(s.length, start + Math.floor(len * rate));
  for (let i = start; i < end; i++) {
    const t = (i - start) / rate;
    s[i] += amp * Math.exp(-t / tau) * (Math.random() * 2 - 1);
  }
};

/** Удар с падением высоты (кик/бомба). */
const hit = (s, at, f0, f1, amp, tau) => {
  const start = Math.floor(at * rate);
  const end = Math.min(s.length, start + Math.floor((tau * 6) * rate));
  let phase = 0;
  for (let i = start; i < end; i++) {
    const t = (i - start) / rate;
    const f = f1 + (f0 - f1) * Math.exp(-t / (tau * 0.4));
    phase += (2 * Math.PI * f) / rate;
    s[i] += amp * Math.exp(-t / tau) * Math.sin(phase);
  }
};

/** Тёплый пад: две расстроенные синусоиды на тон, затухает внутри слота — стык лупа без щелчка. */
const pad = (s, at, tones, dur = 2) => {
  const start = Math.floor(at * rate);
  const len = Math.floor(dur * rate);
  for (const f of tones) {
    for (const det of [-0.6, 0.6]) {
      let phase = 0;
      for (let i = 0; i < len && start + i < s.length; i++) {
        const t = i / rate;
        const env = Math.min(1, t / 0.4) * Math.min(1, (dur - t) / 0.5);
        phase += (2 * Math.PI * (f + det)) / rate;
        s[start + i] += 0.045 * env * Math.sin(phase);
      }
    }
  }
};

const menu = make(8, (s) => {
  const chords = [
    { root: 110, tones: [220, 261.63, 329.63] },
    { root: 87.31, tones: [174.61, 220, 261.63] },
    { root: 130.81, tones: [196, 261.63, 329.63] },
    { root: 98, tones: [196, 246.94, 293.66] },
  ];
  chords.forEach((ch, ci) => {
    const at = ci * 2;
    pad(s, at, ch.tones);
    note(s, at, 1.9, ch.root, 0.16, 0.6, sine);
  });
  const mel = [
    [1.0, 523.25],
    [1.75, 659.26],
    [2.75, 523.25],
    [3.5, 698.46],
    [4.75, 587.33],
    [5.5, 783.99],
    [6.0, 587.33],
    [7.0, 493.88],
  ];
  mel.forEach(([at, f]) => {
    note(s, at, 1.2, f, 0.12, 0.35, sine);
    note(s, at + 0.375, 1.0, f, 0.05, 0.3, sine);
  });
});

const battle = make(4, (s) => {
  const bassLine = [82.5, 82.5, 98, 82.5, 87.3, 82.5, 73.5, 78];
  for (let i = 0; i < 32; i++) {
    const step = i * 0.125;
    if (i % 2 === 0) note(s, step, 0.12, bassLine[(i >> 2) % 8], 0.22, 0.05, bass);
    else if (i % 8 === 7) note(s, step, 0.1, bassLine[(i >> 2) % 8], 0.14, 0.03, bass);
  }
  for (let b = 0; b < 4; b++) {
    hit(s, b, 150, 45, 0.55, 0.09);
    noise(s, b + 0.25, 0.04, 0.05, 0.008);
    noise(s, b + 0.5, 0.09, 0.16, 0.02);
    noise(s, b + 0.75, 0.04, 0.05, 0.008);
  }
  const stabs = [164.81, 196, 146.83, 174.61];
  for (let b = 0; b < 4; b++) {
    note(s, b + 0.5, 0.2, stabs[b], 0.11, 0.06, saw);
    note(s, b + 0.5, 0.2, stabs[b] * 2, 0.05, 0.05, saw);
  }
});

const boss = make(4, (s) => {
  for (let i = 0; i < s.length; i++) {
    const t = i / rate;
    const trem = 0.8 + 0.2 * Math.sin(2 * Math.PI * 0.5 * t);
    const vib = 1 + 0.012 * Math.sin(2 * Math.PI * 5 * t);
    s[i] += trem * (0.11 * sine(t, 55 * vib) + 0.08 * saw(t, 55 * vib) + 0.07 * saw(t, 78));
  }
  for (let k = 0; k < 32; k++) note(s, k * 0.125, 0.11, 110, 0.13, 0.035, square);
  hit(s, 0, 95, 40, 0.6, 0.3);
  hit(s, 2, 95, 40, 0.6, 0.3);
  const bells = [415.3, 622.25, 830.6];
  bells.forEach((f, k) => note(s, 1.5, 1.2, f, 0.05 - k * 0.012, 0.35, sine));
  bells.forEach((f, k) => note(s, 3.5, 0.45, f * 0.944, 0.04 - k * 0.01, 0.2, sine));
});

writeFileSync(new URL("./public/menu.wav", import.meta.url), wav(menu));
writeFileSync(new URL("./public/battle.wav", import.meta.url), wav(battle));
writeFileSync(new URL("./public/boss.wav", import.meta.url), wav(boss));
console.log("tracks regenerated");
