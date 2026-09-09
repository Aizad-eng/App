/* Tiny synthesized sound effects (no audio assets needed). */
(function () {
  'use strict';
  let ctx = null, enabled = true, noiseBuf = null;
  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    ctx = new AC();
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }
  function tone(freq, duration, { type = 'sine', gain = 0.2, slide = null, delay = 0 } = {}) {
    const c = ensure(); if (!c || !enabled) return;
    const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = c.createGain(); const t = c.currentTime + delay;
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + duration);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + duration + 0.02);
  }
  function noise(duration, { freq = 800, q = 0.7, gain = 0.4, type = 'lowpass' } = {}) {
    const c = ensure(); if (!c || !enabled) return;
    const src = c.createBufferSource(); src.buffer = noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); const t = c.currentTime;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(f); f.connect(g); g.connect(c.destination); src.start(t); src.stop(t + duration);
  }
  window.SS = window.SS || {};
  window.SS.SFX = {
    unlock() { ensure(); },
    setEnabled(v) { enabled = !!v; },
    jump() { tone(420, 0.09, { type: 'triangle', gain: 0.12, slide: 640 }); },
    star(n) { const base = 660 + Math.min(12, n % 12) * 40; tone(base, 0.12, { type: 'sine', gain: 0.18 }); tone(base * 1.5, 0.18, { type: 'sine', gain: 0.14, delay: 0.06 }); },
    switch() { tone(300, 0.22, { type: 'sawtooth', gain: 0.08, slide: 1200 }); },
    die() { noise(0.35, { freq: 500, gain: 0.5 }); tone(220, 0.35, { type: 'square', gain: 0.1, slide: 60 }); },
    ui() { tone(600, 0.05, { gain: 0.08 }); },
  };
})();
