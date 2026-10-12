// Sound effects, all synthesised with the Web Audio API (no audio files, so nothing to license: see docs/CREDITS.md).
// The audio context is only created on the first click / key press (browser autoplay rules), and every sound
// respects the volume setting. Audio only ever reacts to the match; it never changes it.
import { AUDIO_CROWD_BASE, AUDIO_CROWD_EXCITED, AUDIO_MASTER_GAIN } from '../config';
import { settings } from '../settings';
import type { SoundId } from './cues';

type Ctx = AudioContext;

class SoundEngine {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private crowd: { gain: GainNode; filter: BiquadFilterNode; src: AudioBufferSourceNode } | null = null;
  private wantCrowd = false;
  private listening = false;

  /** Start listening for the first user interaction, which is what allows sound to play. Safe to call repeatedly. */
  attachUnlock(target: Window = window): void {
    if (this.listening) return;
    this.listening = true;
    const events = ['pointerdown', 'keydown', 'touchend'] as const;
    const unlock = (): void => {
      this.unlock();
      if (this.ctx && this.ctx.state === 'running') for (const e of events) target.removeEventListener(e, unlock, true);
    };
    for (const e of events) target.addEventListener(e, unlock, true);
  }

  /** Create / resume the audio context. Must run inside a user gesture. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.noise = this.makeNoise(this.ctx);
        this.applyVolume();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      if (this.wantCrowd) this.startCrowdNodes();
    } catch {
      this.ctx = null; // no audio available: stay silent
    }
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Re-read the volume setting (call after it changes). */
  applyVolume(): void {
    if (!this.ctx || !this.master) return;
    const v = Math.min(1, Math.max(0, settings.volume / 100));
    this.master.gain.setTargetAtTime(AUDIO_MASTER_GAIN * v * v, this.ctx.currentTime, 0.02);
  }

  private volume(): number {
    return settings.volume / 100;
  }

  private makeNoise(ctx: Ctx): AudioBuffer {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Is there anything to do? (Not unlocked yet, or the volume is off.) */
  private can(): boolean {
    return this.ready && this.volume() > 0;
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private noiseBurst(t: number, dur: number, peak: number, type: BiquadFilterType, freq: number, q = 0.7): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, peak, 0.003, dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private tone(t: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, peak, 0.004, dur);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** A foot on the ball. `power` 0 (a tap) .. 1 (a full-power shot). */
  kick(power: number): void {
    if (!this.can()) return;
    const t = this.ctx!.currentTime;
    const p = Math.min(1, Math.max(0, power));
    const loud = 0.3 + 0.7 * p;
    this.tone(t, 'sine', 120 + 90 * p, 48, 0.09 + 0.07 * p, 0.9 * loud);
    this.noiseBurst(t, 0.03 + 0.05 * p, 0.55 * loud, 'lowpass', 700 + 2600 * p);
    if (p > 0.55) this.noiseBurst(t, 0.02, 0.35 * loud, 'highpass', 2500); // the crack of a hard strike
  }

  /** The ball rings off the woodwork. */
  post(power: number): void {
    if (!this.can()) return;
    const t = this.ctx!.currentTime;
    const loud = 0.35 + 0.65 * Math.min(1, Math.max(0, power));
    this.tone(t, 'triangle', 1180, 1150, 0.5, 0.45 * loud);
    this.tone(t, 'sine', 1870, 1840, 0.35, 0.25 * loud);
    this.tone(t, 'sine', 560, 540, 0.3, 0.25 * loud);
    this.noiseBurst(t, 0.03, 0.4 * loud, 'bandpass', 3000, 1.2);
  }

  /** The ball thuds into the net. */
  net(power: number): void {
    if (!this.can()) return;
    const t = this.ctx!.currentTime;
    const loud = 0.3 + 0.7 * Math.min(1, Math.max(0, power));
    this.noiseBurst(t, 0.28, 0.6 * loud, 'lowpass', 520);
    this.noiseBurst(t + 0.02, 0.18, 0.2 * loud, 'bandpass', 1800, 0.8);
  }

  /** A referee's pea whistle: `blasts` trills, each `len` seconds. */
  whistle(blasts: number, len: number): void {
    if (!this.can()) return;
    const ctx = this.ctx!;
    for (let i = 0; i < blasts; i++) {
      const t = ctx.currentTime + i * (len + 0.18);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.03);
      g.gain.setValueAtTime(0.5, t + len - 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      // Two close tones plus a fast wobble make the pea rattle.
      const trill = ctx.createGain();
      trill.gain.value = 0.7;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 34;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = 0.3;
      lfo.connect(lfoDepth).connect(trill.gain);
      for (const f of [2870, 3010]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, t);
        osc.frequency.linearRampToValueAtTime(f * 1.03, t + len);
        osc.connect(trill);
        osc.start(t);
        osc.stop(t + len + 0.05);
      }
      trill.connect(g).connect(this.master!);
      lfo.start(t);
      lfo.stop(t + len + 0.05);
    }
  }

  /** The crowd erupts. */
  roar(): void {
    if (!this.can()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.6;
    band.frequency.setValueAtTime(380, t);
    band.frequency.linearRampToValueAtTime(900, t + 0.9);
    band.frequency.linearRampToValueAtTime(600, t + 3.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.35);
    g.gain.setValueAtTime(0.9, t + 1.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.6);
    src.connect(band).connect(g).connect(this.master!);
    src.start(t, Math.random());
    src.stop(t + 3.7);
    // A few cheering "voices": detuned, wavering saws low in the mix.
    for (const f of [220, 277, 330]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f * 0.9, t);
      osc.frequency.linearRampToValueAtTime(f * 1.15, t + 0.8);
      osc.frequency.linearRampToValueAtTime(f, t + 2.6);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      const vg = ctx.createGain();
      vg.gain.setValueAtTime(0.0001, t);
      vg.gain.exponentialRampToValueAtTime(0.06, t + 0.4);
      vg.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
      osc.connect(lp).connect(vg).connect(this.master!);
      osc.start(t);
      osc.stop(t + 2.9);
    }
  }

  /** A short blip to hear the volume while changing it in the settings. */
  blip(): void {
    if (!this.can()) return;
    this.tone(this.ctx!.currentTime, 'sine', 660, 880, 0.12, 0.5);
  }

  playId(id: SoundId): void {
    switch (id) {
      case 'whistle-short':
        return this.whistle(1, 0.45);
      case 'whistle-half':
        return this.whistle(2, 0.6);
      case 'whistle-full':
        return this.whistle(3, 0.7);
      case 'goal':
        this.roar();
        this.net(0.8);
    }
  }

  /** The crowd murmur that runs under the whole match. Starts as soon as the sound is unlocked. */
  startCrowd(): void {
    this.wantCrowd = true;
    if (this.ready) this.startCrowdNodes();
  }

  stopCrowd(): void {
    this.wantCrowd = false;
    const c = this.crowd;
    if (!c || !this.ctx) return;
    this.crowd = null;
    c.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.15);
    c.src.stop(this.ctx.currentTime + 1);
  }

  private startCrowdNodes(): void {
    if (this.crowd || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 520;
    filter.Q.value = 0.35;
    const gain = ctx.createGain();
    gain.gain.value = AUDIO_CROWD_BASE;
    // A slow swell, so the murmur breathes.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.23;
    const depth = ctx.createGain();
    depth.gain.value = 0.015;
    lfo.connect(depth).connect(gain.gain);
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    lfo.start();
    this.crowd = { gain, filter, src };
  }

  /** 0..1: how worked up the crowd is; louder and brighter when the ball is near a goal. */
  setExcitement(e: number): void {
    if (!this.crowd || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.crowd.gain.gain.setTargetAtTime(AUDIO_CROWD_BASE + (AUDIO_CROWD_EXCITED - AUDIO_CROWD_BASE) * e, t, 0.4);
    this.crowd.filter.frequency.setTargetAtTime(480 + 420 * e, t, 0.4);
  }
}

/** The one sound engine. */
export const sound = new SoundEngine();
