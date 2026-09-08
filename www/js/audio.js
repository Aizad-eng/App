/* Tiny synthesized sound effects (no audio assets needed). */
(function () {
  'use strict';
  let ctx = null;
  let enabled = true;
  let noiseBuf = null;

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function noise(duration, { freq = 1200, q = 0.7, gain = 0.5, type = 'bandpass', decay = duration } = {}) {
    const c = ensure(); if (!c || !enabled) return;
    const src = c.createBufferSource(); src.buffer = noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    const t = c.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start(t); src.stop(t + duration);
  }

  function tone(freq, duration, { type = 'sine', gain = 0.25, slide = null } = {}) {
    const c = ensure(); if (!c || !enabled) return;
    const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = c.createGain();
    const t = c.currentTime;
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + duration);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + duration);
  }

  const SFX = {
    unlock() { ensure(); },
    setEnabled(v) { enabled = !!v; },
    shot(kind) {
      if (kind === 'gun') { noise(0.18, { freq: 900, q: 0.5, gain: 0.8, decay: 0.16 }); tone(160, 0.12, { type: 'square', gain: 0.12, slide: 50 }); }
      else if (kind === 'arc') { noise(0.14, { freq: 2200, q: 1.5, gain: 0.3, decay: 0.12 }); tone(420, 0.08, { type: 'triangle', gain: 0.08, slide: 200 }); }
    },
    hit(type) {
      if (type === 'balloon') { noise(0.12, { freq: 1800, q: 0.8, gain: 0.7, decay: 0.1 }); tone(700, 0.06, { gain: 0.15, slide: 300 }); }
      else if (type === 'bottle' || type === 'vase' || type === 'bulb' || type === 'plate' || type === 'cup' || type === 'glass') {
        noise(0.35, { freq: 4200, q: 2.5, gain: 0.5, decay: 0.3, type: 'highpass' }); tone(2400, 0.2, { type: 'triangle', gain: 0.08, slide: 1400 });
      } else if (type === 'can' || type === 'coin') { tone(1200, 0.12, { type: 'square', gain: 0.12, slide: 500 }); noise(0.1, { freq: 3000, gain: 0.25, decay: 0.08 }); }
      else { noise(0.14, { freq: 500, q: 0.7, gain: 0.5, decay: 0.12, type: 'lowpass' }); tone(220, 0.1, { gain: 0.15, slide: 90 }); }
    },
    block() { noise(0.1, { freq: 600, q: 0.8, gain: 0.35, decay: 0.09, type: 'lowpass' }); tone(140, 0.07, { type: 'square', gain: 0.08, slide: 60 }); },
    win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.25, { type: 'triangle', gain: 0.2 }), i * 110)); },
    lose() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.3, { type: 'sawtooth', gain: 0.1 }), i * 160)); },
    tick() { tone(1000, 0.04, { type: 'square', gain: 0.06 }); },
    ui() { tone(600, 0.05, { type: 'sine', gain: 0.08 }); },
  };

  window.SS = window.SS || {};
  window.SS.SFX = SFX;
})();
