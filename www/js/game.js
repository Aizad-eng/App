/* Hue Hop: tap to bounce a ball up through rotating colour obstacles.
   The ball can only pass through segments that match its colour. */
(function () {
  'use strict';
  const SS = window.SS = window.SS || {};
  const SFX = SS.SFX;

  const W = 1000;                 // logical width; height follows the screen
  const COLORS = ['#f6df0e', '#ff2d8a', '#8c2bff', '#35e2f2'];
  const BALL_R = 22;
  const GRAVITY = 2700;
  const JUMP = 1320;
  const TAU = Math.PI * 2;

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const mod = (a, n) => ((a % n) + n) % n;
  function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
  }

  /* ---------- obstacle definitions ---------- */
  const TYPES = {
    circle:       { minScore: 0,  make: (o) => { o.rings = [{ r: 300, n: 4, dir: 1 }]; } },
    line:         { minScore: 0,  make: (o) => { o.thick = 46; o.speed = rand(260, 380); } },
    square:       { minScore: 3,  make: (o) => { o.polys = [{ r: 330, n: 4, dir: 1 }]; } },
    doubleCircle: { minScore: 6,  make: (o) => { o.rings = [{ r: 340, n: 4, dir: 1 }, { r: 210, n: 4, dir: -1 }]; } },
    triangle:     { minScore: 9,  make: (o) => { o.polys = [{ r: 360, n: 3, dir: 1 }]; } },
    cross:        { minScore: 12, make: (o) => { o.arms = { r: 330, n: 4 }; } },
    hexagon:      { minScore: 16, make: (o) => { o.polys = [{ r: 320, n: 6, dir: 1 }]; } },
    circleSquare: { minScore: 20, make: (o) => { o.rings = [{ r: 240, n: 4, dir: -1 }]; o.polys = [{ r: 400, n: 4, dir: 1 }]; } },
    tripleCircle: { minScore: 25, make: (o) => { o.rings = [{ r: 380, n: 4, dir: 1 }, { r: 280, n: 4, dir: -1 }, { r: 180, n: 4, dir: 1 }]; } },
  };

  class Game {
    constructor(canvas, opts) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d');
      this.opts = opts || {};
      this.settings = { sound: true };
      this.running = false; this.raf = 0; this.lastFrame = 0;
      this._frame = this._frame.bind(this);
      this._bind();
      this.resize();
      this.reset();
    }

    setSettings(s) { Object.assign(this.settings, s); }

    reset() {
      this.time = 0;
      this.ball = { x: W / 2, y: 0, vy: 0, color: pick(COLORS), trail: [] };
      this.started = false; this.dead = false; this.deadTimer = 0;
      this.score = 0; this.best = this.best || 0;
      this.camY = this.ball.y - this.VH * 0.72;
      this.obstacles = []; this.switchers = []; this.particles = [];
      this.lastY = -600;
      this.shake = 0; this.flash = 0;
      this._fill();
      this._emit('reset');
    }

    start() { if (!this.running) { this.running = true; this.lastFrame = performance.now(); this.raf = requestAnimationFrame(this._frame); } }
    pause() { this.running = false; cancelAnimationFrame(this.raf); }
    resume() { this.start(); }

    state() { return { score: this.score, best: this.best, started: this.started, dead: this.dead, color: this.ball.color }; }
    _emit(type, data) { if (this.opts.onState) this.opts.onState(this.state(), type, data); }

    /* ---------- input ---------- */
    _bind() {
      const c = this.canvas;
      const tap = (e) => { e.preventDefault(); this.jump(); };
      c.addEventListener('pointerdown', tap);
      window.addEventListener('keydown', (e) => { if ((e.code === 'Space' || e.code === 'ArrowUp') && this.running) { e.preventDefault(); this.jump(); } });
      window.addEventListener('resize', () => this.resize());
      window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    }

    jump() {
      if (!this.running || this.dead) return;
      if (!this.started) { this.started = true; this._emit('start'); }
      this.ball.vy = -JUMP;
      if (this.settings.sound) SFX.jump();
      this._emit('jump');
    }

    /* ---------- world generation ---------- */
    _fill() {
      while (this.lastY > this.camY - this.VH * 1.6) this._spawn();
    }

    _spawn() {
      const score = this.score;
      const pool = Object.keys(TYPES).filter(k => TYPES[k].minScore <= score);
      // Favour the newest unlocked types a little so the game keeps changing.
      const type = Math.random() < 0.35 ? pool[pool.length - 1] : pick(pool);
      const spacing = rand(1050, 1250);
      const y = this.lastY - spacing;
      const o = { type, x: W / 2, y, rot: rand(0, TAU), omega: (1.15 + Math.min(2.2, score * 0.055)) * rand(0.85, 1.2) * (Math.random() < 0.5 ? -1 : 1), colors: shuffle(COLORS), thick: 50, star: false, offset: rand(0, W) };
      TYPES[type].make(o);
      if (o.polys) for (const p of o.polys) p.colors = p.n === 3 ? o.colors.slice(0, 3) : (p.n === 6 ? o.colors.concat(o.colors.slice(0, 2)) : o.colors);
      if (o.rings) for (const r of o.rings) r.colors = shuffle(COLORS);
      if (o.arms) o.arms.colors = o.colors;
      this.obstacles.push(o);
      // Colour switcher halfway between the previous obstacle and this one.
      const prev = this.obstacles.length > 1 ? this.obstacles[this.obstacles.length - 2] : null;
      const sy = prev ? (prev.y + y) / 2 : y + spacing * 0.55;
      this.switchers.push({ x: W / 2, y: sy, taken: false, next: o, rot: 0 });
      this.lastY = y;
    }

    /* Colours an obstacle can be passed with (used so a switcher never hands out an impossible colour). */
    _allowedColors(o) {
      if (o.polys && o.polys.some(p => p.n === 3)) return o.polys.find(p => p.n === 3).colors;
      return COLORS;
    }

    /* ---------- collision ---------- */
    _hitColor(o, bx, by, r) {
      const dx = bx - o.x, dy = by - o.y;
      if (o.rings) {
        for (const ring of o.rings) {
          const d = Math.hypot(dx, dy);
          if (d >= ring.r - o.thick / 2 - r && d <= ring.r + o.thick / 2 + r) {
            const a = mod(Math.atan2(dy, dx) - o.rot * ring.dir, TAU);
            return ring.colors[Math.floor(a / (TAU / ring.n))];
          }
        }
      }
      if (o.polys) {
        for (const p of o.polys) {
          const rot = o.rot * p.dir;
          for (let k = 0; k < p.n; k++) {
            const a0 = rot + k * TAU / p.n, a1 = rot + (k + 1) * TAU / p.n;
            const ax = o.x + Math.cos(a0) * p.r, ay = o.y + Math.sin(a0) * p.r;
            const bx2 = o.x + Math.cos(a1) * p.r, by2 = o.y + Math.sin(a1) * p.r;
            if (distToSegment(bx, by, ax, ay, bx2, by2) <= o.thick / 2 + r) return p.colors[k];
          }
        }
      }
      if (o.arms) {
        for (let k = 0; k < o.arms.n; k++) {
          const a = o.rot + k * TAU / o.arms.n;
          const ex = o.x + Math.cos(a) * o.arms.r, ey = o.y + Math.sin(a) * o.arms.r;
          if (distToSegment(bx, by, o.x, o.y, ex, ey) <= o.thick / 2 + r) return o.arms.colors[k];
        }
      }
      if (o.type === 'line') {
        if (Math.abs(dy) <= o.thick / 2 + r) {
          const off = mod(o.offset + this.time * o.speed * Math.sign(o.omega), W);
          return o.colors[Math.floor(mod(bx - off, W) / (W / 4))];
        }
      }
      return null;
    }

    /* ---------- simulation ---------- */
    _frame(now) {
      if (!this.running) return;
      let dt = (now - this.lastFrame) / 1000; this.lastFrame = now;
      if (dt > 0.05) dt = 0.05;
      this._update(dt); this._draw();
      this.raf = requestAnimationFrame(this._frame);
    }

    _update(dt) {
      this.time += dt;
      for (const o of this.obstacles) o.rot += o.omega * dt;
      for (const s of this.switchers) s.rot += dt * 2;
      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 30);
      if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3);

      const b = this.ball;
      if (this.started && !this.dead) {
        const sub = 1 / 240; let acc = dt;
        while (acc > 0 && !this.dead) {
          const step = Math.min(sub, acc); acc -= step;
          b.vy += GRAVITY * step;
          b.y += b.vy * step;
          this._collide();
        }
        // camera only ever moves up
        const target = b.y - this.VH * 0.62;
        if (target < this.camY) this.camY = target;
        if (b.y - this.camY > this.VH + BALL_R * 2) this._die('fell');
        if (b.trail.length === 0 || Math.abs(b.y - b.trail[b.trail.length - 1].y) > 10) { b.trail.push({ x: b.x, y: b.y }); if (b.trail.length > 12) b.trail.shift(); }
      } else if (!this.started) {
        b.y = Math.sin(this.time * 2) * 8; // idle bob
      }
      if (this.dead) {
        this.deadTimer -= dt;
        if (this.deadTimer <= 0 && !this.reported) { this.reported = true; this._emit('gameover', { reason: this.deathReason }); }
      }
      this._fill();
      // cull far below
      this.obstacles = this.obstacles.filter(o => o.y < this.camY + this.VH + 600);
      this.switchers = this.switchers.filter(s => s.y < this.camY + this.VH + 600);
      for (const q of this.particles) { q.vy += 1500 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt; }
      this.particles = this.particles.filter(q => q.life > 0);
    }

    _collide() {
      const b = this.ball;
      for (const o of this.obstacles) {
        if (Math.abs(o.y - b.y) > 520) continue;
        const c = this._hitColor(o, b.x, b.y, BALL_R);
        if (c && c !== b.color) { this._die('hit'); return; }
        if (!o.star && Math.hypot(b.x - o.x, b.y - o.y) < 52) {
          o.star = true; this.score += 1;
          if (this.score > this.best) this.best = this.score;
          this._burst(o.x, o.y, ['#ffffff', '#fff3a0'], 14, 300);
          if (this.settings.sound) SFX.star(this.score);
          this._emit('score');
        }
      }
      for (const s of this.switchers) {
        if (s.taken || Math.abs(s.y - b.y) > 200) continue;
        if (Math.hypot(b.x - s.x, b.y - s.y) < 48) {
          s.taken = true;
          const allowed = this._allowedColors(s.next).filter(c => c !== b.color);
          b.color = pick(allowed.length ? allowed : COLORS);
          this._burst(s.x, s.y, COLORS, 18, 420);
          this.flash = 1;
          if (this.settings.sound) SFX.switch();
          this._emit('switch');
        }
      }
    }

    _die(reason) {
      if (this.dead) return;
      this.dead = true; this.deadTimer = 0.9; this.reported = false; this.deathReason = reason;
      this._burst(this.ball.x, this.ball.y, [this.ball.color, '#ffffff'], 36, 700);
      this.shake = 14;
      if (this.settings.sound) SFX.die();
      this._emit('die', { reason });
    }

    _burst(x, y, colors, n, speed) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, sp = speed * rand(0.3, 1);
        this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 150, life: rand(0.5, 1), size: rand(5, 12), color: colors[i % colors.length] });
      }
    }

    /* ---------- rendering ---------- */
    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const cw = this.canvas.clientWidth || window.innerWidth;
      const ch = this.canvas.clientHeight || window.innerHeight;
      this.canvas.width = Math.round(cw * dpr); this.canvas.height = Math.round(ch * dpr);
      this.dpr = dpr; this.cw = cw; this.ch = ch;
      this.scale = cw / W;
      this.VH = ch / this.scale;
      if (this.ball && !this.started) this.camY = this.ball.y - this.VH * 0.72;
      if (this.ball && !this.running) this._draw();
    }

    _draw() {
      const ctx = this.ctx, dpr = this.dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const g = ctx.createLinearGradient(0, 0, 0, this.ch);
      g.addColorStop(0, '#1b1b2c'); g.addColorStop(1, '#0d0d16');
      ctx.fillStyle = g; ctx.fillRect(0, 0, this.cw, this.ch);
      if (this.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${this.flash * 0.08})`; ctx.fillRect(0, 0, this.cw, this.ch); }

      const sx = this.shake ? (Math.random() - 0.5) * this.shake : 0;
      const sy = this.shake ? (Math.random() - 0.5) * this.shake : 0;
      ctx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, sx * dpr, (sy - this.camY * this.scale) * dpr);

      for (const o of this.obstacles) this._drawObstacle(ctx, o);
      for (const s of this.switchers) if (!s.taken) this._drawSwitcher(ctx, s);
      this._drawParticles(ctx);
      if (!this.dead) this._drawBall(ctx);
    }

    _drawObstacle(ctx, o) {
      ctx.lineWidth = o.thick;
      if (o.rings) {
        ctx.lineCap = 'butt';
        for (const ring of o.rings) {
          const rot = o.rot * ring.dir;
          for (let k = 0; k < ring.n; k++) {
            ctx.strokeStyle = ring.colors[k];
            ctx.beginPath(); ctx.arc(o.x, o.y, ring.r, rot + k * TAU / ring.n, rot + (k + 1) * TAU / ring.n); ctx.stroke();
          }
        }
      }
      if (o.polys) {
        ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
        for (const p of o.polys) {
          const rot = o.rot * p.dir;
          for (let k = 0; k < p.n; k++) {
            const a0 = rot + k * TAU / p.n, a1 = rot + (k + 1) * TAU / p.n;
            // Each side drawn as a quad so the corners meet cleanly.
            const inner = p.r * Math.cos(Math.PI / p.n) - o.thick / 2, outer = p.r * Math.cos(Math.PI / p.n) + o.thick / 2;
            const ri = inner / Math.cos(Math.PI / p.n), ro = outer / Math.cos(Math.PI / p.n);
            ctx.fillStyle = p.colors[k];
            ctx.beginPath();
            ctx.moveTo(o.x + Math.cos(a0) * ro, o.y + Math.sin(a0) * ro);
            ctx.lineTo(o.x + Math.cos(a1) * ro, o.y + Math.sin(a1) * ro);
            ctx.lineTo(o.x + Math.cos(a1) * ri, o.y + Math.sin(a1) * ri);
            ctx.lineTo(o.x + Math.cos(a0) * ri, o.y + Math.sin(a0) * ri);
            ctx.closePath(); ctx.fill();
          }
        }
      }
      if (o.arms) {
        ctx.lineCap = 'round';
        for (let k = 0; k < o.arms.n; k++) {
          const a = o.rot + k * TAU / o.arms.n;
          ctx.strokeStyle = o.arms.colors[k];
          ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + Math.cos(a) * o.arms.r, o.y + Math.sin(a) * o.arms.r); ctx.stroke();
        }
        ctx.fillStyle = '#1b1b2c'; ctx.beginPath(); ctx.arc(o.x, o.y, o.thick * 0.9, 0, TAU); ctx.fill();
      }
      if (o.type === 'line') {
        const off = mod(o.offset + this.time * o.speed * Math.sign(o.omega), W);
        const seg = W / 4;
        for (let k = -4; k < 8; k++) {
          const x0 = off + k * seg;
          if (x0 > W || x0 + seg < 0) continue;
          ctx.fillStyle = o.colors[mod(k, 4)];
          ctx.fillRect(Math.max(0, x0), o.y - o.thick / 2, Math.min(W, x0 + seg) - Math.max(0, x0), o.thick);
        }
      }
      // star
      if (!o.star) this._drawStar(ctx, o.x, o.y, 34, '#ffffff');
    }

    _drawStar(ctx, x, y, r, color) {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const rr = i % 2 ? r * 0.45 : r; const a = -Math.PI / 2 + i * Math.PI / 5;
        ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath(); ctx.fill();
    }

    _drawSwitcher(ctx, s) {
      const r = 34;
      for (let k = 0; k < 4; k++) {
        ctx.fillStyle = COLORS[k];
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.arc(s.x, s.y, r, s.rot + k * Math.PI / 2, s.rot + (k + 1) * Math.PI / 2); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.arc(s.x, s.y, r * 0.35, 0, TAU); ctx.fill();
    }

    _drawBall(ctx) {
      const b = this.ball;
      for (let i = 0; i < b.trail.length; i++) {
        const t = b.trail[i]; const k = (i + 1) / b.trail.length;
        ctx.globalAlpha = k * 0.35; ctx.fillStyle = b.color;
        ctx.beginPath(); ctx.arc(t.x, t.y, BALL_R * (0.3 + 0.6 * k), 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.shadowColor = b.color; ctx.shadowBlur = 30;
      ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(b.x, b.y, BALL_R, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(b.x - 7, b.y - 7, BALL_R * 0.35, 0, TAU); ctx.fill();
      if (!this.started) {
        ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = 'bold 40px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('Tap to jump', W / 2, b.y + 120);
      }
    }

    _drawParticles(ctx) {
      for (const q of this.particles) {
        ctx.globalAlpha = Math.max(0, Math.min(1, q.life * 1.5)); ctx.fillStyle = q.color;
        ctx.beginPath(); ctx.arc(q.x, q.y, q.size / 2, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  SS.Game = Game; SS.COLORS = COLORS; SS.W = W;
})();
