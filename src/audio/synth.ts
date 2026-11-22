// Built-in placeholder sound, made with the Web Audio API. Every cue in
// audio.json plays a real Suno file when one exists under its final name in
// assets/audio/; until then these synths stand in (design bible section 20:
// placeholders with final names, so new assets drop straight in).

type Ctx = AudioContext;

let noiseBuf: AudioBuffer | null = null;
function noise(ctx: Ctx): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const len = ctx.sampleRate;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function env(ctx: Ctx, out: AudioNode, t: number, attack: number, hold: number, release: number, peak: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.setValueAtTime(Math.max(0.0002, peak), t + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  g.connect(out);
  return g;
}

function tone(ctx: Ctx, out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, attack = 0.005) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = env(ctx, out, t, attack, 0, dur, peak);
  o.connect(g);
  o.start(t);
  o.stop(t + attack + dur + 0.05);
}

function hiss(ctx: Ctx, out: AudioNode, t: number, dur: number, peak: number, filter: BiquadFilterType, f0: number, f1: number, q = 1) {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  src.loop = true;
  const bq = ctx.createBiquadFilter();
  bq.type = filter;
  bq.Q.value = q;
  bq.frequency.setValueAtTime(f0, t);
  bq.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = env(ctx, out, t, 0.004, 0, dur, peak);
  src.connect(bq).connect(g);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

function arp(ctx: Ctx, out: AudioNode, t: number, notes: number[], gap: number, type: OscillatorType, peak: number, len = 0.5) {
  notes.forEach((n, i) => {
    tone(ctx, out, t + i * gap, type, NOTE(n), NOTE(n), len, peak, 0.01);
    tone(ctx, out, t + i * gap, 'sine', NOTE(n + 12), NOTE(n + 12), len * 0.7, peak * 0.3, 0.01);
  });
}

function pad(ctx: Ctx, out: AudioNode, t: number, notes: number[], dur: number, peak: number) {
  for (const n of notes) {
    for (const det of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = NOTE(n);
      o.detune.value = det;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      const g = env(ctx, out, t, 0.08, dur * 0.4, dur * 0.6, peak / notes.length);
      o.connect(lp).connect(g);
      o.start(t);
      o.stop(t + dur + 0.2);
    }
  }
}

export function synthSfx(ctx: Ctx, out: AudioNode, id: string, v: number): void {
  const t = ctx.currentTime + 0.005;
  switch (id) {
    case 'ui-click':
      return tone(ctx, out, t, 'sine', 1100, 900, 0.04, 0.25 * v);
    case 'ui-open':
      tone(ctx, out, t, 'triangle', 520, 520, 0.06, 0.2 * v);
      return tone(ctx, out, t + 0.05, 'triangle', 780, 780, 0.08, 0.2 * v);
    case 'ui-error':
      tone(ctx, out, t, 'square', 190, 170, 0.07, 0.12 * v);
      return tone(ctx, out, t + 0.09, 'square', 150, 140, 0.1, 0.12 * v);
    case 'order':
      return tone(ctx, out, t, 'triangle', 640, 960, 0.07, 0.2 * v);
    case 'end-cycle':
      hiss(ctx, out, t, 0.7, 0.25 * v, 'lowpass', 300, 3000);
      tone(ctx, out, t, 'sine', 110, 55, 0.8, 0.5 * v, 0.02);
      return tone(ctx, out, t + 0.05, 'triangle', NOTE(57), NOTE(57), 0.6, 0.12 * v, 0.02);
    case 'shot-ballistic':
      hiss(ctx, out, t, 0.06, 0.4 * v, 'bandpass', 1800, 700, 0.8);
      return tone(ctx, out, t, 'square', 160, 60, 0.05, 0.12 * v);
    case 'shot-laser':
      return tone(ctx, out, t, 'sawtooth', 2200, 280, 0.13, 0.12 * v);
    case 'missile':
      hiss(ctx, out, t, 0.45, 0.3 * v, 'bandpass', 400, 2400, 1.5);
      return tone(ctx, out, t, 'sawtooth', 90, 220, 0.4, 0.08 * v);
    case 'explosion-small':
      hiss(ctx, out, t, 0.45, 0.6 * v, 'lowpass', 1600, 90);
      return tone(ctx, out, t, 'sine', 95, 38, 0.35, 0.6 * v);
    case 'explosion-large':
      hiss(ctx, out, t, 1.1, 0.75 * v, 'lowpass', 2400, 60);
      tone(ctx, out, t, 'sine', 70, 28, 0.9, 0.85 * v);
      return hiss(ctx, out, t + 0.05, 0.6, 0.2 * v, 'highpass', 3000, 6000);
    case 'capture':
      arp(ctx, out, t, [60, 64, 67, 72], 0.07, 'triangle', 0.18 * v, 0.4);
      return tone(ctx, out, t, 'sine', 65, 65, 0.6, 0.3 * v, 0.02);
    case 'unit-online':
      tone(ctx, out, t, 'sine', 300, 900, 0.25, 0.18 * v);
      return tone(ctx, out, t + 0.22, 'sine', 1320, 1320, 0.3, 0.1 * v);
    case 'card-flip':
      return hiss(ctx, out, t, 0.08, 0.35 * v, 'highpass', 2500, 6000);
    case 'reward-common':
      return arp(ctx, out, t, [72, 79], 0.08, 'triangle', 0.16 * v);
    case 'reward-rare':
      return arp(ctx, out, t, [67, 71, 74, 79], 0.07, 'triangle', 0.17 * v);
    case 'reward-epic':
      arp(ctx, out, t, [64, 67, 71, 76, 79], 0.065, 'triangle', 0.17 * v, 0.7);
      return pad(ctx, out, t + 0.2, [52, 59, 64, 67], 1.2, 0.12 * v);
    case 'reward-legendary':
      tone(ctx, out, t, 'sine', 60, 40, 0.6, 0.5 * v);
      arp(ctx, out, t, [62, 66, 69, 74, 78, 81], 0.06, 'triangle', 0.18 * v, 0.8);
      return pad(ctx, out, t + 0.25, [50, 57, 62, 66, 69], 1.8, 0.16 * v);
    case 'reward-mythic':
      hiss(ctx, out, t, 1.4, 0.3 * v, 'lowpass', 200, 4000);
      tone(ctx, out, t, 'sine', 55, 30, 1.2, 0.7 * v);
      arp(ctx, out, t + 0.1, [57, 61, 64, 69, 73, 76, 81], 0.07, 'sawtooth', 0.09 * v, 0.9);
      return pad(ctx, out, t + 0.35, [45, 52, 57, 61, 64, 69], 2.6, 0.2 * v);
    case 'core-pulse':
      return tone(ctx, out, t, 'sine', 220, 330, 0.35, 0.2 * v, 0.05);
    case 'glitch':
      for (let i = 0; i < 5; i++) tone(ctx, out, t + i * 0.035, 'square', 200 + Math.random() * 1600, 100 + Math.random() * 800, 0.025, 0.08 * v);
      return;
    case 'narrator-chime':
      tone(ctx, out, t, 'sine', 1320, 1320, 0.9, 0.08 * v, 0.003);
      return tone(ctx, out, t, 'sine', 1980, 1980, 0.6, 0.04 * v, 0.003);
    case 'abyss-roar':
      hiss(ctx, out, t, 1.2, 0.45 * v, 'lowpass', 600, 80, 3);
      tone(ctx, out, t, 'sawtooth', 70, 38, 1.1, 0.35 * v, 0.08);
      return tone(ctx, out, t + 0.1, 'sawtooth', 104, 52, 0.9, 0.2 * v, 0.1);
    case 'rift-open':
      hiss(ctx, out, t, 0.9, 0.3 * v, 'bandpass', 120, 1800, 4);
      return tone(ctx, out, t, 'sine', 40, 90, 0.9, 0.5 * v, 0.2);
    case 'rift-seal':
      tone(ctx, out, t, 'sine', 160, 40, 0.8, 0.6 * v, 0.005);
      return arp(ctx, out, t + 0.15, [57, 64, 69], 0.09, 'triangle', 0.14 * v, 0.6);
    case 'mother-call':
      tone(ctx, out, t, 'sine', 55, 49, 2.2, 0.55 * v, 0.4);
      tone(ctx, out, t + 0.3, 'triangle', NOTE(76), NOTE(73), 1.6, 0.08 * v, 0.5);
      return hiss(ctx, out, t, 2, 0.15 * v, 'lowpass', 300, 120, 6);
    case 'shot-bio':
      hiss(ctx, out, t, 0.18, 0.3 * v, 'lowpass', 900, 200, 4);
      return tone(ctx, out, t, 'sine', 240, 90, 0.14, 0.25 * v);
    case 'alert':
      tone(ctx, out, t, 'square', 620, 620, 0.14, 0.1 * v);
      tone(ctx, out, t + 0.16, 'square', 460, 460, 0.14, 0.1 * v);
      return tone(ctx, out, t + 0.32, 'square', 620, 620, 0.18, 0.1 * v);
  }
}

// ---------------------------------------------------------------- music

interface Style {
  bpm: number;
  /** Chords as MIDI notes, one per bar (4 beats). */
  chords: number[][];
  /** Notes per beat in the arpeggio, 0 = none. */
  arp: number;
  arpType: OscillatorType;
  bass: 'none' | 'drone' | 'pulse';
  pad: number;
  /** Kick on beats: 0 none, 1 = every beat, 2 = half-time. */
  drums: 0 | 1 | 2;
}

const STYLES: Record<string, Style> = {
  title: { bpm: 64, chords: [[45, 52, 60, 64], [41, 48, 57, 60], [43, 50, 55, 62], [40, 47, 55, 59]], arp: 2, arpType: 'triangle', bass: 'drone', pad: 0.12, drums: 0 },
  forge: { bpm: 84, chords: [[50, 57, 62, 66], [47, 54, 59, 62], [43, 50, 55, 59], [45, 52, 57, 61]], arp: 4, arpType: 'sine', bass: 'none', pad: 0.07, drums: 0 },
  calm: { bpm: 70, chords: [[45, 52, 57, 60], [41, 48, 53, 57], [48, 55, 60, 64], [43, 50, 55, 59]], arp: 2, arpType: 'triangle', bass: 'drone', pad: 0.1, drums: 0 },
  war: { bpm: 116, chords: [[38, 45, 50, 53], [38, 45, 50, 53], [34, 41, 46, 50], [36, 43, 48, 51]], arp: 4, arpType: 'sawtooth', bass: 'pulse', pad: 0.07, drums: 1 },
  victory: { bpm: 72, chords: [[48, 55, 60, 64], [43, 50, 55, 59], [45, 52, 57, 60], [41, 48, 53, 57]], arp: 3, arpType: 'triangle', bass: 'drone', pad: 0.14, drums: 2 },
  abyss: { bpm: 58, chords: [[38, 45, 49, 52], [37, 44, 49, 52], [34, 41, 46, 49], [36, 43, 46, 51]], arp: 1, arpType: 'sine', bass: 'drone', pad: 0.13, drums: 2 },
  boss: { bpm: 96, chords: [[33, 40, 45, 48], [34, 41, 46, 49], [33, 40, 45, 48], [31, 38, 43, 46]], arp: 4, arpType: 'sawtooth', bass: 'pulse', pad: 0.12, drums: 1 },
  defeat: { bpm: 50, chords: [[45, 52, 57, 60], [44, 52, 56, 59], [41, 48, 53, 57], [40, 47, 52, 56]], arp: 1, arpType: 'sine', bass: 'none', pad: 0.08, drums: 0 },
};

/** A small generative score in the cue's mood, until the Suno track exists. */
export class SynthMusic {
  private timer = 0;
  private nextBeat = 0;
  private beat = 0;
  private out: GainNode;
  private style: Style;

  constructor(
    private ctx: Ctx,
    dest: AudioNode,
    cue: string,
  ) {
    this.style = STYLES[cue] ?? STYLES.calm;
    // A little space: feedback delay into a lowpass.
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    const delay = ctx.createDelay(1);
    delay.delayTime.value = (60 / this.style.bpm) * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    this.out.connect(lp).connect(dest);
    lp.connect(delay).connect(fb).connect(delay);
    fb.connect(dest);
  }

  start(fade: number) {
    const t = this.ctx.currentTime;
    this.out.gain.setValueAtTime(0.0001, t);
    this.out.gain.exponentialRampToValueAtTime(1, t + fade);
    this.nextBeat = t + 0.05;
    this.timer = window.setInterval(() => this.schedule(), 120);
    this.schedule();
  }

  stop(fade: number) {
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(Math.max(0.0001, this.out.gain.value), t);
    this.out.gain.exponentialRampToValueAtTime(0.0001, t + fade);
    window.setTimeout(() => {
      window.clearInterval(this.timer);
      this.out.disconnect();
    }, fade * 1000 + 100);
  }

  private schedule() {
    const s = this.style;
    const spb = 60 / s.bpm;
    while (this.nextBeat < this.ctx.currentTime + 0.6) {
      const t = this.nextBeat;
      const bar = Math.floor(this.beat / 4);
      const chord = s.chords[bar % s.chords.length];
      const inBar = this.beat % 4;
      if (inBar === 0) {
        pad(this.ctx, this.out, t, chord.slice(1), spb * 4.2, s.pad);
        if (s.bass === 'drone') tone(this.ctx, this.out, t, 'sine', NOTE(chord[0] - 12), NOTE(chord[0] - 12), spb * 4, 0.16, 0.3);
      }
      if (s.bass === 'pulse') {
        for (let k = 0; k < 2; k++) tone(this.ctx, this.out, t + k * spb / 2, 'sawtooth', NOTE(chord[0] - 12), NOTE(chord[0] - 12), spb * 0.4, 0.09, 0.005);
      }
      if (s.drums && this.beat % s.drums === 0) {
        tone(this.ctx, this.out, t, 'sine', 120, 40, 0.25, 0.35, 0.002);
        if (s.drums === 1 && inBar % 2 === 1) hiss(this.ctx, this.out, t, 0.12, 0.12, 'bandpass', 2000, 1200, 0.7);
      }
      if (s.arp) {
        const step = spb / s.arp;
        for (let k = 0; k < s.arp; k++) {
          const n = chord[(this.beat * s.arp + k) % chord.length] + 12 * ((k + bar) % 2);
          // Sparse, so it breathes.
          if ((this.beat * 7 + k * 3 + bar) % 5 === 0 && s.arp > 1) continue;
          tone(this.ctx, this.out, t + k * step, s.arpType, NOTE(n + 12), NOTE(n + 12), step * 1.6, s.arpType === 'sawtooth' ? 0.025 : 0.05, 0.004);
        }
      }
      this.beat++;
      this.nextBeat += spb;
    }
  }
}
