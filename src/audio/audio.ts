// Music and sound (M2). Loads Suno files from assets/audio/ by their final
// names (src/content/audio.json); anything missing plays a built-in synth
// placeholder instead, so the game is never silent and never breaks.
// Browsers only allow sound after a click or key press: call unlock() then.

import { AUDIO, AudioDef } from '../content';
import { SynthMusic, synthSfx } from './synth';

export interface AudioSettings {
  music: number;
  sfx: number;
  muted: boolean;
}

const KEY = 'omnivigil.audio';

function loadSettings(): AudioSettings {
  const base: AudioSettings = { music: 0.6, sfx: 0.8, muted: false };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...base, ...(JSON.parse(raw) as Partial<AudioSettings>) };
  } catch {
    /* storage blocked */
  }
  return base;
}

interface Playing {
  id: string;
  stop(fade: number): void;
}

export class AudioDirector {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private last = new Map<string, number>();
  private playing: Playing | null = null;
  private wanted: string | null = null;
  settings = loadSettings();

  constructor(private base = 'audio/') {}

  /** Create or resume the audio context. Safe to call on every gesture. */
  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.sfxBus = this.ctx.createGain();
      this.musicBus.connect(this.master);
      this.sfxBus.connect(this.master);
      this.apply();
      // Warm the cache for the sounds every cycle uses.
      for (const d of AUDIO.sfx) void this.buffer(d);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.wanted && this.playing?.id !== this.wanted) this.music(this.wanted);
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.settings));
    } catch {
      /* storage blocked */
    }
    this.apply();
  }

  private apply() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : 1, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.settings.music * 0.55, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.settings.sfx, t, 0.05);
  }

  private buffer(def: AudioDef): Promise<AudioBuffer | null> {
    let p = this.buffers.get(def.file);
    if (!p) {
      const ctx = this.ctx!;
      p = fetch(this.base + def.file)
        .then((r) => {
          const type = r.headers.get('content-type') ?? '';
          if (!r.ok || type.includes('text/html')) return null;
          return r.arrayBuffer().then((b) => ctx.decodeAudioData(b));
        })
        .catch(() => null);
      this.buffers.set(def.file, p);
    }
    return p;
  }

  /** A sound effect. `intensity` scales its volume (distant fights are quieter). */
  play(id: string, intensity = 1) {
    if (!this.ctx || this.settings.muted || this.settings.sfx <= 0) return;
    const now = this.ctx.currentTime;
    if (now - (this.last.get(id) ?? -1) < 0.045) return; // no machine-gun stacking
    this.last.set(id, now);
    const def = AUDIO.sfx.find((d) => d.id === id);
    const vol = (def?.volume ?? 0.7) * intensity;
    if (!def) return synthSfx(this.ctx, this.sfxBus, id, vol);
    const ctx = this.ctx;
    void this.buffer(def).then((buf) => {
      if (!buf) return synthSfx(ctx, this.sfxBus, id, vol);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = 0.96 + Math.random() * 0.08;
      const g = ctx.createGain();
      g.gain.value = vol;
      src.connect(g).connect(this.sfxBus);
      src.start();
    });
  }

  /** Switch the music cue, crossfading. Remembered until sound is unlocked. */
  music(id: string | null, fade = 1.6) {
    this.wanted = id;
    if (!this.ctx || this.playing?.id === id) return;
    const old = this.playing;
    this.playing = null;
    old?.stop(fade);
    if (!id) return;
    const def = AUDIO.music.find((d) => d.id === id);
    const ctx = this.ctx;
    const token = { id, stop: (_f: number) => {} } as Playing;
    this.playing = token;
    const startSynth = () => {
      const m = new SynthMusic(ctx, this.musicBus, id);
      m.start(fade);
      token.stop = (f) => m.stop(f);
    };
    if (!def) return startSynth();
    void this.buffer(def).then((buf) => {
      if (this.playing !== token) return;
      if (!buf) return startSynth();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = ctx.createGain();
      const t = ctx.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(def.volume ?? 0.8, t + fade);
      src.connect(g).connect(this.musicBus);
      src.start();
      token.stop = (f) => {
        const n = ctx.currentTime;
        g.gain.cancelScheduledValues(n);
        g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), n);
        g.gain.exponentialRampToValueAtTime(0.0001, n + f);
        src.stop(n + f + 0.1);
      };
    });
  }
}

export const audio = new AudioDirector();
