// WebAudio synth: music (100 BPM A-minor) + SFX. No audio files.
export class AudioSys {
  constructor() {
    this.ctx = null; this.master = null; this.muted = false;
    this.musicTimer = null; this.step = 0; this.bar = 0;
    this.engineOsc = null; this.engineGain = null; this.engineFilter = null;
    this.sirenOsc = null; this.sirenGain = null; this.sirenLfo = null;
  }
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.5; }
  tone(freq, dur, type, vol, when) {
    if (!this.ctx) return;
    const t = when ?? this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  noise(dur, vol, when, freq = 4000) {
    if (!this.ctx) return;
    const t = when ?? this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  }
  // Music: 100 BPM, A minor. Am - F - C - G, bass + pad + hat.
  startMusic() {
    if (!this.ensure() || this.musicTimer) return;
    const spb = 60 / 100 / 4; // 16th note
    const roots = [110, 87.31, 130.81, 98];
    const chords = [[220, 261.63, 329.63], [174.61, 220, 261.63], [130.81, 196, 246.94], [98, 146.83, 196]];
    this.musicTimer = setInterval(() => {
      if (!this.ctx || this.muted) { this.step++; if (this.step % 16 === 0) this.bar++; return; }
      const t = this.ctx.currentTime + 0.05;
      const s = this.step % 16, b = this.bar % 4;
      if (s % 4 === 0) this.tone(roots[b], spb * 3.5, 'triangle', 0.2, t);
      if (s === 0) for (const f of chords[b]) this.tone(f, spb * 16, 'sawtooth', 0.025, t);
      if (s % 4 === 2) this.tone(roots[b] * 2, spb * 1.5, 'sine', 0.05, t);
      if (s % 2 === 1) this.noise(spb * 0.5, 0.04, t, 7000);
      this.step++;
      if (this.step % 16 === 0) this.bar++;
    }, spb * 1000);
  }
  setEngine(on, speed01) {
    if (!this.ensure()) return;
    if (on && !this.engineOsc) {
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass'; this.engineFilter.frequency.value = 500;
      this.engineGain = this.ctx.createGain(); this.engineGain.gain.value = 0.0;
      this.engineOsc.connect(this.engineFilter); this.engineFilter.connect(this.engineGain); this.engineGain.connect(this.master);
      this.engineOsc.start();
    }
    if (!this.engineOsc) return;
    const t = this.ctx.currentTime;
    this.engineOsc.frequency.setTargetAtTime(55 + speed01 * 130, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(350 + speed01 * 900, t, 0.08);
    this.engineGain.gain.setTargetAtTime(on ? 0.045 + speed01 * 0.05 : 0, t, 0.1);
  }
  setSiren(on) {
    if (!this.ensure()) return;
    if (on && !this.sirenOsc) {
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'sine'; this.sirenOsc.frequency.value = 750;
      this.sirenLfo = this.ctx.createOscillator();
      this.sirenLfo.type = 'square'; this.sirenLfo.frequency.value = 0.55;
      const lg = this.ctx.createGain(); lg.gain.value = 220;
      this.sirenLfo.connect(lg); lg.connect(this.sirenOsc.frequency);
      this.sirenGain = this.ctx.createGain(); this.sirenGain.gain.value = 0.0;
      this.sirenOsc.connect(this.sirenGain); this.sirenGain.connect(this.master);
      this.sirenOsc.start(); this.sirenLfo.start();
    }
    if (this.sirenGain) this.sirenGain.gain.setTargetAtTime(on ? 0.035 : 0, this.ctx.currentTime, 0.2);
  }
  shot(kind) {
    if (!this.ensure()) return;
    if (kind === 0) { this.noise(0.12, 0.5, undefined, 3200); this.tone(160, 0.08, 'square', 0.18); }
    else if (kind === 1) { this.noise(0.09, 0.4, undefined, 4200); this.tone(220, 0.05, 'square', 0.12); }
    else { this.noise(0.28, 0.7, undefined, 1800); this.tone(90, 0.18, 'sine', 0.35); }
  }
  crash(s) { if (this.ensure()) { this.noise(0.25, Math.min(0.6, 0.2 + s * 0.03), undefined, 900); this.tone(55, 0.25, 'sine', 0.3); } }
  pickup() { if (this.ensure()) { this.tone(660, 0.09, 'sine', 0.18); this.tone(990, 0.14, 'sine', 0.18, this.ctx.currentTime + 0.09); } }
  mission() { if (this.ensure()) { const t = this.ctx.currentTime; [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.16, t + i * 0.11)); } }
  click() { if (this.ensure()) this.tone(880, 0.05, 'sine', 0.1); }
}
