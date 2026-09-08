/* Core game: physics, input (drag to aim, release to fire), rendering. */
(function () {
  'use strict';
  const SS = window.SS;
  const { W, H, WEAPONS, TARGETS, postSegments, stepProjectile } = SS;
  const SFX = SS.SFX;

  const GROUND_Y = H * 0.94;
  const TAU = Math.PI * 2;

  const TARGET_COLORS = {
    bottle: ['#d11a2a', '#7a0a1c', '#e8e8e8'], can: ['#c9d1d9', '#2f6fd6', '#8a94a0'], balloon: ['#ff4f7d', '#ffd166', '#4fd8ff', '#9dff4f', '#c77dff'],
    plate: ['#ffffff', '#2f6fd6'], apple: ['#e5322d', '#3f9d4a', '#6b3a1e'], duck: ['#ffd23f', '#ff8c1a', '#222'], cup: ['#f6e6c8', '#8d5a2b'],
    vase: ['#4a90e2', '#2b5aa0', '#ffffff'], bulb: ['#fff3b0', '#9aa0a6', '#ffe14d'], clay: ['#ff7a1a', '#b34d00'], tomato: ['#e63b2e', '#3f9d4a'],
    egg: ['#fff8ec', '#e2d5bb'], coin: ['#ffd700', '#b8860b'],
  };

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function targetPos(t, time) {
    const m = t.motion;
    if (!m) return { x: t.x, y: t.y, ang: 0 };
    switch (m.kind) {
      case 'bob': return { x: t.x, y: t.y + Math.sin(time * m.speed + m.phase) * m.amp, ang: 0 };
      case 'slide': return { x: clamp(t.x + Math.sin(time * m.speed + m.phase) * m.amp, 50, 440), y: t.y, ang: 0 };
      case 'swing': {
        const a = Math.sin(time * m.speed + m.phase) * m.amp;
        const px = t.x, py = t.y - m.len;
        return { x: px + Math.sin(a) * m.len, y: py + Math.cos(a) * m.len, ang: -a, pivot: { x: px, y: py } };
      }
      case 'rise': { const off = (time * m.speed + m.phase * m.range) % m.range; return { x: t.x, y: t.y + m.range / 2 - off, ang: 0 }; }
      case 'fly': { const off = (time * m.speed + m.phase * m.range) % m.range; return { x: t.x - m.range / 2 + off, y: t.y, ang: 0 }; }
      case 'orbit': return { x: t.x + Math.cos(time * m.speed + m.phase) * m.amp, y: t.y + Math.sin(time * m.speed + m.phase) * m.amp, ang: 0 };
      default: return { x: t.x, y: t.y, ang: 0 };
    }
  }

  /* Where the gun is right now: fixed in drag mode, riding a rail in timing mode. */
  function shooterPos(level, time) {
    const s = level.shooter;
    if (level.control !== 'timing') return { x: s.x, y: s.y };
    const range = s.yMax - s.yMin;
    const m = (time * s.speed + s.phase * range * 2) % (range * 2);
    return { x: s.x, y: s.yMin + (m < range ? m : range * 2 - m) };
  }

  /* All solid rectangles at a given time: {x,y,w,h,angle,type,ref} */
  function obstacleRects(level, time) {
    const out = [];
    for (const o of level.obstacles) {
      if (o.type === 'post') {
        const off = o.motion ? Math.sin(time * o.motion.speed + o.motion.phase) * o.motion.amp : 0;
        for (const s of postSegments(o)) out.push({ x: s.x, y: s.y + off, w: s.w, h: s.h, angle: 0, type: 'post', ref: o });
      } else if (o.type === 'plank') {
        const y = o.y + Math.sin(time * o.motion.speed + o.motion.phase) * o.motion.amp;
        out.push({ x: o.x, y, w: o.w, h: o.h, angle: 0, type: 'plank', ref: o });
      } else if (o.type === 'spinner') {
        out.push({ x: o.x, y: o.y, w: o.len, h: o.thick, angle: time * o.rotSpeed + o.phase, type: 'spinner', ref: o });
      } else if (o.type === 'block') {
        out.push({ x: o.x, y: o.y, w: o.w, h: o.h, angle: 0, type: 'block', ref: o });
      } else if (o.type === 'glass' && o.hp > 0) {
        const post = level.obstacles.find(p => p.type === 'post');
        const off = post && post.motion ? Math.sin(time * post.motion.speed + post.motion.phase) * post.motion.amp : 0;
        out.push({ x: o.x, y: o.y + off, w: o.w, h: o.h, angle: 0, type: 'glass', ref: o });
      }
    }
    return out;
  }

  function circleHitsRect(px, py, r, rect) {
    let dx = px - rect.x, dy = py - rect.y;
    if (rect.angle) {
      const c = Math.cos(-rect.angle), s = Math.sin(-rect.angle);
      const lx = dx * c - dy * s, ly = dx * s + dy * c;
      dx = lx; dy = ly;
    }
    return Math.abs(dx) <= rect.w / 2 + r && Math.abs(dy) <= rect.h / 2 + r;
  }

  function circleHitsTarget(px, py, r, t, pos) {
    if (t.round) return Math.hypot(px - pos.x, py - pos.y) <= t.w / 2 + r;
    return Math.abs(px - pos.x) <= t.w / 2 + r && Math.abs(py - pos.y) <= t.h / 2 + r;
  }

  class Game {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.opts = opts || {};
      this.settings = { aimGuide: 'short', sound: true, transparent: false };
      this.level = null;
      this.running = false;
      this.raf = 0;
      this.lastFrame = 0;
      this.scale = 1; this.offX = 0; this.offY = 0;
      this.pointer = null;
      this._bind();
      this.resize();
    }

    setSettings(s) { Object.assign(this.settings, s); }

    setLevel(level) {
      this.level = JSON.parse(JSON.stringify(level));
      this.time = 0;
      this.status = 'ready';   // ready | playing | won | lost
      this.attempts = 0;
      this.hits = 0;
      this.timeLeft = level.timeLimit || 0;
      this.projectile = null;
      this.particles = [];
      this.floaters = [];
      this.hintPath = null; this.hintUntil = 0;
      this.aim = { active: false, angle: 0.2, power: 0.6, pull: 0 };
      this.endTimer = 0;
      this.lastTick = -1;
      this.shake = 0;
      this._emit();
    }

    start() {
      if (!this.level) return;
      if (this.status === 'ready') this.status = 'playing';
      if (!this.running) { this.running = true; this.lastFrame = performance.now(); this.raf = requestAnimationFrame(this._frame); }
      this._emit();
    }
    pause() { this.running = false; cancelAnimationFrame(this.raf); }
    resume() { if (!this.running && this.level) { this.running = true; this.lastFrame = performance.now(); this.raf = requestAnimationFrame(this._frame); } }
    destroy() { this.pause(); }

    remainingTargets() { return this.level ? this.level.targets.filter(t => t.hp > 0).length : 0; }

    useHint() {
      if (this.status !== 'playing' || !this.level) return false;
      const alive = this.level.hints.filter(h => this.level.targets[h.targetId].hp > 0);
      if (!alive.length) return false;
      const h = alive[Math.floor(Math.random() * alive.length)];
      this.attempts += 1;
      this.hintPath = this._trace(h.angle, h.speed, 2.2, h.shooterY);
      this.hintY = this.level.control === 'timing' ? h.shooterY : null;
      this.hintUntil = this.time + 4;
      this._emit();
      return true;
    }

    state() {
      return {
        status: this.status, attempts: this.attempts, hits: this.hits, remaining: this.remainingTargets(),
        timeLeft: this.timeLeft, par: this.level ? this.level.par : 0, attemptsMax: this.level ? this.level.attemptsMax : 0,
        total: this.level ? this.level.targets.length : 0, wind: this.level ? this.level.wind : 0,
      };
    }

    _emit(type, data) { if (this.opts.onState) this.opts.onState(this.state(), type, data); }

    /* ---------- input ---------- */
    _bind() {
      const c = this.canvas;
      this._frame = this._frame.bind(this);
      const toLogical = (e) => {
        const r = c.getBoundingClientRect();
        return { x: (e.clientX - r.left - this.offX) / this.scale, y: (e.clientY - r.top - this.offY) / this.scale };
      };
      c.addEventListener('pointerdown', (e) => {
        if (this.status !== 'playing' || !this.running) return;
        if (this.pointer && this.pointer.id !== e.pointerId) return;
        e.preventDefault();
        if (this.level.control === 'timing') { this._fire(); return; }
        c.setPointerCapture && c.setPointerCapture(e.pointerId);
        const p = toLogical(e);
        this.pointer = { id: e.pointerId, sx: p.x, sy: p.y, x: p.x, y: p.y };
        this.aim.active = false;
        this._updateAim();
      });
      c.addEventListener('pointermove', (e) => {
        if (!this.pointer || this.pointer.id !== e.pointerId) return;
        e.preventDefault();
        const p = toLogical(e);
        this.pointer.x = p.x; this.pointer.y = p.y;
        this._updateAim();
      });
      const end = (e) => {
        if (!this.pointer || this.pointer.id !== e.pointerId) return;
        e.preventDefault();
        this._updateAim();
        const fire = this.aim.active && e.type === 'pointerup';
        this.pointer = null;
        this.aim.active = false;
        if (fire) this._fire();
      };
      c.addEventListener('pointerup', end);
      c.addEventListener('pointercancel', end);
      window.addEventListener('resize', () => this.resize());
      window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    }

    _updateAim() {
      const p = this.pointer; if (!p) return;
      const dx = p.x - p.sx, dy = p.y - p.sy;
      const pull = Math.hypot(dx, dy);
      const dead = 14;
      if (pull < dead) { this.aim.active = false; this.aim.pull = 0; return; }
      // Pull back (right) to shoot left, pull down to shoot up: slingshot style.
      let angle = Math.atan2(dy, dx);
      angle = clamp(angle, -1.45, 1.45);
      this.aim.active = true;
      this.aim.angle = angle;
      this.aim.pull = pull;
      this.aim.power = clamp((pull - dead) / 300, 0, 1);
    }

    _weapon() { return WEAPONS[this.level.weapon]; }

    _shotAngle() {
      const wep = this._weapon();
      let a = this.level.control === 'timing' ? this.level.fixedAngle : this.aim.angle;
      if (wep.sway) a += (0.035 * Math.sin(this.time * 2.1) + 0.02 * Math.sin(this.time * 5.3 + 1)) * wep.sway;
      return a;
    }
    _shotSpeed() {
      const wep = this._weapon();
      if (this.level.control === 'timing') return this.level.fixedSpeed;
      if (wep.kind === 'gun') return wep.speed;
      return wep.speedMin + (wep.speedMax - wep.speedMin) * this.aim.power;
    }

    _fire() {
      if (this.status !== 'playing' || this.projectile) return;
      if (this.attempts >= this.level.attemptsMax) return;
      const wep = this._weapon();
      const angle = this._shotAngle();
      const speed = this._shotSpeed();
      const s = shooterPos(this.level, this.time);
      const dir = { x: -Math.cos(angle), y: -Math.sin(angle) };
      this.projectile = {
        x: s.x + dir.x * 46, y: s.y + dir.y * 46, vx: dir.x * speed, vy: dir.y * speed,
        r: wep.r, kind: wep.proj, life: 0, spin: 0, trail: [],
      };
      this.attempts += 1;
      this.shake = wep.kind === 'gun' ? 6 : 2;
      if (this.settings.sound) SFX.shot(wep.kind);
      this._emit('shot');
    }

    _trace(angle, speed, seconds, startY) {
      const wep = this._weapon();
      const s = shooterPos(this.level, this.time);
      const y0 = startY === undefined ? s.y : startY;
      const p = { x: s.x - Math.cos(angle) * 46, y: y0 - Math.sin(angle) * 46, vx: -Math.cos(angle) * speed, vy: -Math.sin(angle) * speed };
      const rects = obstacleRects(this.level, this.time);
      const dt = 1 / 240; const pts = [];
      for (let i = 0; i < seconds * 240; i++) {
        stepProjectile(p, wep.gravity, this.level.wind * wep.windFactor, dt);
        if (p.x < -20 || p.y > H + 20 || p.x > W + 20) break;
        if (rects.some(r => circleHitsRect(p.x, p.y, wep.r, r))) break;
        if (i % 4 === 0) pts.push({ x: p.x, y: p.y });
      }
      return pts;
    }

    /* ---------- simulation ---------- */
    _frame(now) {
      if (!this.running) return;
      let dt = (now - this.lastFrame) / 1000;
      this.lastFrame = now;
      if (dt > 0.05) dt = 0.05;
      this._update(dt);
      this._draw();
      this.raf = requestAnimationFrame(this._frame);
    }

    _update(dt) {
      const L = this.level;
      if (this.status === 'playing' || this.status === 'won' || this.status === 'lost') this.time += dt;
      if (this.status === 'playing' && L.timeLimit) {
        this.timeLeft = Math.max(0, this.timeLeft - dt);
        const sec = Math.ceil(this.timeLeft);
        if (sec !== this.lastTick) { this.lastTick = sec; if (sec <= 5 && sec > 0 && this.settings.sound) SFX.tick(); this._emit('tick'); }
        if (this.timeLeft <= 0 && this.remainingTargets() > 0) this._finish('lost', 'time');
      }
      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 40);

      const p = this.projectile;
      if (p) {
        const wep = this._weapon();
        const wind = L.wind * wep.windFactor;
        const sub = 1 / 240;
        let acc = dt;
        while (acc > 0 && this.projectile) {
          const step = Math.min(sub, acc); acc -= step;
          stepProjectile(p, wep.gravity, wind, step);
          p.life += step; p.spin += step * 25;
          if (p.trail.length === 0 || Math.hypot(p.x - p.trail[p.trail.length - 1].x, p.y - p.trail[p.trail.length - 1].y) > 14) {
            p.trail.push({ x: p.x, y: p.y }); if (p.trail.length > 10) p.trail.shift();
          }
          if (p.x < -40 || p.x > W + 40 || p.y > GROUND_Y + 10 || p.y < -H) {
            if (p.y > GROUND_Y - 10 && p.x > -40 && p.x < W + 40) this._spawnSparks(p.x, GROUND_Y, '#b9a27a', 6);
            this.projectile = null; break;
          }
          // targets
          for (const t of L.targets) {
            if (t.hp <= 0) continue;
            const pos = targetPos(t, this.time);
            if (circleHitsTarget(p.x, p.y, p.r, t, pos)) {
              t.hp -= 1;
              if (t.hp <= 0) this._destroyTarget(t, pos);
            }
          }
          // obstacles
          const rects = obstacleRects(L, this.time);
          let stopped = false;
          for (const r of rects) {
            if (!circleHitsRect(p.x, p.y, p.r, r)) continue;
            if (r.type === 'glass') {
              r.ref.hp = 0;
              this._spawnShards(p.x, p.y, ['#bfe9ff', '#ffffff'], 14);
              this._floater(p.x, p.y - 40, 'CRACK', '#bfe9ff');
              if (this.settings.sound) SFX.hit('glass');
              p.vx *= 0.7; p.vy *= 0.7;
            } else {
              this._spawnSparks(p.x, p.y, r.type === 'block' ? '#ddd' : '#ffd166', 10);
              if (this.settings.sound) SFX.block();
              stopped = true;
            }
            break;
          }
          if (stopped) { this.projectile = null; break; }
        }
        if (!this.projectile) this._afterShot();
      }

      // particles
      for (const q of this.particles) {
        q.vy += 1400 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.rot += q.vr * dt; q.life -= dt;
        if (q.y > GROUND_Y && q.vy > 0) { q.y = GROUND_Y; q.vy *= -0.35; q.vx *= 0.7; }
      }
      this.particles = this.particles.filter(q => q.life > 0);
      for (const f of this.floaters) { f.life -= dt; f.y -= 40 * dt; }
      this.floaters = this.floaters.filter(f => f.life > 0);

      if ((this.status === 'won' || this.status === 'lost') && this.endTimer > 0) {
        this.endTimer -= dt;
        if (this.endTimer <= 0) { this.endTimer = 0; this._emit('finished', { result: this.status, reason: this.endReason }); }
      }
    }

    _afterShot() {
      if (this.status !== 'playing') return;
      if (this.remainingTargets() === 0) { this._finish('won'); return; }
      if (this.attempts >= this.level.attemptsMax) this._finish('lost', 'shots');
      this._emit('shotDone');
    }

    _finish(result, reason) {
      if (this.status !== 'playing') return;
      this.status = result; this.endReason = reason || null;
      this.endTimer = result === 'won' ? 0.9 : 0.8;
      this.pointer = null; this.aim.active = false;
      if (this.settings.sound) (result === 'won' ? SFX.win() : SFX.lose());
      this._emit('end');
    }

    _destroyTarget(t, pos) {
      this.hits += 1;
      this._spawnShards(pos.x, pos.y, TARGET_COLORS[t.type] || ['#fff'], 16);
      this._floater(pos.x, pos.y - t.h / 2 - 20, 'HIT!', '#ffd166');
      if (this.settings.sound) SFX.hit(t.type);
      this.shake = Math.max(this.shake, 8);
      this._emit('hit', { target: t });
      if (this.remainingTargets() === 0 && this.status === 'playing') this._finish('won');
    }

    _spawnShards(x, y, colors, n) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, sp = 200 + Math.random() * 500;
        this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 200, rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 20, life: 0.7 + Math.random() * 0.6, size: 6 + Math.random() * 10, color: colors[i % colors.length], kind: 'shard' });
      }
    }
    _spawnSparks(x, y, color, n) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, sp = 150 + Math.random() * 350;
        this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, rot: 0, vr: 0, life: 0.2 + Math.random() * 0.3, size: 3, color, kind: 'spark' });
      }
    }
    _floater(x, y, text, color) { this.floaters.push({ x, y, text, color, life: 0.9 }); }

    /* ---------- rendering ---------- */
    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const cw = this.canvas.clientWidth || window.innerWidth;
      const ch = this.canvas.clientHeight || window.innerHeight;
      this.canvas.width = Math.round(cw * dpr);
      this.canvas.height = Math.round(ch * dpr);
      this.dpr = dpr; this.cw = cw; this.ch = ch;
      const ins = this.opts.insets ? this.opts.insets() : { top: 0, bottom: 0 };
      const top = ins.top || 0, bottom = ins.bottom || 0;
      this.scale = Math.min(cw / W, Math.max(1, ch - top - bottom) / H);
      this.offX = (cw - W * this.scale) / 2;
      this.offY = top + (ch - top - bottom - H * this.scale) / 2;
      if (this.level && !this.running) this._draw();
    }

    _draw() {
      const ctx = this.ctx, L = this.level; if (!L) return;
      const dpr = this.dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, this.cw, this.ch);
      const theme = L.theme;

      // background
      if (!this.settings.transparent) {
        const g = ctx.createLinearGradient(0, 0, 0, this.ch);
        g.addColorStop(0, theme.sky[0]); g.addColorStop(1, theme.sky[1]);
        ctx.fillStyle = g; ctx.fillRect(0, 0, this.cw, this.ch);
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(0, 0, this.cw, this.ch);
      }
      const groundTop = this.offY + GROUND_Y * this.scale;
      ctx.fillStyle = this.settings.transparent ? 'rgba(20,20,30,0.55)' : theme.ground;
      ctx.fillRect(0, groundTop, this.cw, this.ch - groundTop);
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(0, groundTop, this.cw, 4 * this.scale);

      // field transform (with a little screen shake)
      const sx = this.shake ? (Math.random() - 0.5) * this.shake : 0;
      const sy = this.shake ? (Math.random() - 0.5) * this.shake : 0;
      ctx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, (this.offX + sx) * dpr, (this.offY + sy) * dpr);

      this._drawObstacles(ctx);
      this._drawTargets(ctx);
      if (this.hintPath && this.time < this.hintUntil) this._drawPath(ctx, this.hintPath, 'rgba(255,209,102,0.9)', 7);
      this._drawShooter(ctx);
      if (this.projectile) this._drawProjectile(ctx, this.projectile);
      this._drawParticles(ctx);
      this._drawFloaters(ctx);
    }

    _drawPath(ctx, pts, color, size) {
      ctx.fillStyle = color;
      for (let i = 0; i < pts.length; i++) {
        const k = 1 - i / pts.length;
        ctx.globalAlpha = 0.25 + 0.75 * k;
        ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, size * (0.5 + 0.5 * k), 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    _drawObstacles(ctx) {
      const rects = obstacleRects(this.level, this.time);
      for (const r of rects) {
        ctx.save();
        ctx.translate(r.x, r.y);
        if (r.angle) ctx.rotate(r.angle);
        if (r.type === 'post' || r.type === 'plank' || r.type === 'spinner') {
          const g = ctx.createLinearGradient(-r.w / 2, 0, r.w / 2, 0);
          g.addColorStop(0, '#8a5a2b'); g.addColorStop(0.35, '#c98b4a'); g.addColorStop(0.7, '#a86b33'); g.addColorStop(1, '#6f4520');
          ctx.fillStyle = g;
          roundRect(ctx, -r.w / 2, -r.h / 2, r.w, r.h, Math.min(8, r.w / 3)); ctx.fill();
          ctx.strokeStyle = 'rgba(60,30,10,0.55)'; ctx.lineWidth = 2;
          const step = r.type === 'spinner' ? 40 : 60;
          ctx.beginPath();
          if (r.type === 'spinner') { for (let x = -r.w / 2 + step; x < r.w / 2; x += step) { ctx.moveTo(x, -r.h / 2 + 4); ctx.lineTo(x, r.h / 2 - 4); } }
          else { for (let y = -r.h / 2 + step; y < r.h / 2; y += step) { ctx.moveTo(-r.w / 2 + 4, y); ctx.lineTo(r.w / 2 - 4, y + 6); } }
          ctx.stroke();
          if (r.type === 'spinner') { ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(0, 0, 10, 0, TAU); ctx.fill(); }
        } else if (r.type === 'block') {
          ctx.fillStyle = '#7c7f88';
          roundRect(ctx, -r.w / 2, -r.h / 2, r.w, r.h, 6); ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2; ctx.beginPath();
          for (let y = -r.h / 2 + 36; y < r.h / 2; y += 36) { ctx.moveTo(-r.w / 2, y); ctx.lineTo(r.w / 2, y); }
          ctx.stroke();
        } else if (r.type === 'glass') {
          ctx.fillStyle = 'rgba(190,235,255,0.45)';
          ctx.fillRect(-r.w / 2, -r.h / 2, r.w, r.h);
          ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2; ctx.strokeRect(-r.w / 2, -r.h / 2, r.w, r.h);
        }
        ctx.restore();
      }
    }

    _drawTargets(ctx) {
      for (const t of this.level.targets) {
        if (t.hp <= 0) continue;
        const pos = targetPos(t, this.time);
        if (pos.pivot) {
          ctx.strokeStyle = 'rgba(230,220,200,0.8)'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(pos.pivot.x, pos.pivot.y); ctx.lineTo(pos.x, pos.y - t.h / 2 + 4); ctx.stroke();
          ctx.fillStyle = '#555'; ctx.beginPath(); ctx.arc(pos.pivot.x, pos.pivot.y, 6, 0, TAU); ctx.fill();
        }
        ctx.save();
        ctx.translate(pos.x, pos.y);
        if (pos.ang) ctx.rotate(pos.ang);
        drawTarget(ctx, t.type, t.w, t.h);
        ctx.restore();
      }
    }

    _drawShooter(ctx) {
      const L = this.level, wep = this._weapon();
      const timing = L.control === 'timing';
      const s = shooterPos(L, this.time);
      const angle = (timing || this.aim.active) ? this._shotAngle() : this.aim.angle;
      if (timing) {
        // rail the gun rides on
        const r = L.shooter;
        ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(W - 22, r.yMin); ctx.lineTo(W - 22, r.yMax); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath(); ctx.arc(W - 22, r.yMin, 8, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(W - 22, r.yMax, 8, 0, TAU); ctx.fill();
        if (this.hintPath && this.time < this.hintUntil && this.hintY !== null) {
          ctx.strokeStyle = 'rgba(255,209,102,0.95)'; ctx.lineWidth = 5;
          ctx.beginPath(); ctx.moveTo(W - 48, this.hintY); ctx.lineTo(W, this.hintY); ctx.stroke();
        }
        ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(W - 22, s.y, 12, 0, TAU); ctx.fill();
      }
      // arm from the right edge
      ctx.strokeStyle = '#f1c9a5'; ctx.lineWidth = 30; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(W + 30, s.y + 90); ctx.lineTo(s.x + 20, s.y + 10); ctx.stroke();
      ctx.save();
      ctx.translate(s.x, s.y);
      // Muzzle must point along (-cos a, -sin a); the y-flip keeps the grip hanging downward.
      ctx.rotate(Math.PI + angle);
      ctx.scale(1, -1);
      drawWeapon(ctx, wep);
      ctx.restore();

      // aim guide
      if ((timing || this.aim.active) && this.status === 'playing' && this.settings.aimGuide !== 'off') {
        const full = this.settings.aimGuide === 'full';
        const secs = wep.kind === 'gun' ? (full ? 1.2 : 0.16) : (full ? 0.7 : 0.28);
        const pts = this._trace(this._shotAngle(), this._shotSpeed(), secs);
        this._drawPath(ctx, pts, 'rgba(255,255,255,0.85)', 5);
        if (wep.kind === 'arc' && !timing) {
          // power bar
          ctx.fillStyle = 'rgba(0,0,0,0.4)'; roundRect(ctx, s.x - 60, s.y + 70, 120, 14, 7); ctx.fill();
          ctx.fillStyle = '#ffd166'; roundRect(ctx, s.x - 60, s.y + 70, 120 * this.aim.power, 14, 7); ctx.fill();
        }
      }
      if (this.status === 'playing' && !this.projectile && this.attempts === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = 'bold 34px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(timing ? 'Tap when the gun lines up' : 'Drag anywhere to aim, release to fire', W / 2, H - 30);
      }
    }

    _drawProjectile(ctx, p) {
      const ang = Math.atan2(p.vy, p.vx);
      ctx.save();
      // trail
      if (p.trail.length > 1) {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = p.r; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p.trail[0].x, p.trail[0].y);
        for (const q of p.trail) ctx.lineTo(q.x, q.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
      ctx.translate(p.x, p.y);
      if (p.kind === 'bullet') {
        ctx.rotate(ang); ctx.fillStyle = '#ffd166';
        roundRect(ctx, -14, -p.r, 28, p.r * 2, p.r); ctx.fill();
      } else if (p.kind === 'arrow') {
        ctx.rotate(ang);
        ctx.strokeStyle = '#8d5a2b'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(24, 0); ctx.stroke();
        ctx.fillStyle = '#ddd'; ctx.beginPath(); ctx.moveTo(30, 0); ctx.lineTo(16, -7); ctx.lineTo(16, 7); ctx.fill();
        ctx.fillStyle = '#e33'; ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(-30, -8); ctx.lineTo(-22, 0); ctx.lineTo(-30, 8); ctx.fill();
      } else if (p.kind === 'ball') {
        ctx.fillStyle = '#6b6f7a'; ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.beginPath(); ctx.arc(-3, -3, p.r * 0.4, 0, TAU); ctx.fill();
      } else if (p.kind === 'knife') {
        ctx.rotate(p.spin);
        ctx.fillStyle = '#d8dde5'; ctx.beginPath(); ctx.moveTo(-30, 0); ctx.lineTo(0, -7); ctx.lineTo(30, 0); ctx.lineTo(0, 7); ctx.fill();
        ctx.fillStyle = '#333'; roundRect(ctx, -34, -5, 18, 10, 4); ctx.fill();
      } else if (p.kind === 'star') {
        ctx.rotate(p.spin); ctx.fillStyle = '#c9d1d9';
        ctx.beginPath();
        for (let i = 0; i < 8; i++) { const r = i % 2 ? p.r * 0.45 : p.r * 1.4; const a = i * Math.PI / 4; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }

    _drawParticles(ctx) {
      for (const q of this.particles) {
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot);
        ctx.globalAlpha = clamp(q.life * 1.5, 0, 1);
        ctx.fillStyle = q.color;
        if (q.kind === 'spark') { ctx.fillRect(-q.size, -1.5, q.size * 2, 3); }
        else ctx.fillRect(-q.size / 2, -q.size / 3, q.size, q.size * 0.66);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    _drawFloaters(ctx) {
      for (const f of this.floaters) {
        ctx.save();
        ctx.globalAlpha = clamp(f.life * 1.6, 0, 1);
        ctx.font = 'bold 44px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText(f.text, f.x, f.y);
        ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
  }

  /* ---------- vector art ---------- */
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  function drawTarget(ctx, type, w, h) {
    const c = TARGET_COLORS[type] || ['#fff'];
    const hw = w / 2, hh = h / 2;
    switch (type) {
      case 'bottle': {
        ctx.fillStyle = '#5a1a1a';
        ctx.beginPath();
        ctx.moveTo(-hw * 0.32, -hh); ctx.lineTo(hw * 0.32, -hh);
        ctx.lineTo(hw * 0.32, -hh * 0.6); ctx.quadraticCurveTo(hw, -hh * 0.35, hw * 0.85, -hh * 0.05);
        ctx.quadraticCurveTo(hw * 0.7, hh * 0.25, hw, hh * 0.55); ctx.lineTo(hw, hh); ctx.lineTo(-hw, hh); ctx.lineTo(-hw, hh * 0.55);
        ctx.quadraticCurveTo(-hw * 0.7, hh * 0.25, -hw * 0.85, -hh * 0.05); ctx.quadraticCurveTo(-hw, -hh * 0.35, -hw * 0.32, -hh * 0.6);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = c[0]; ctx.fillRect(-hw * 0.95, hh * 0.05, hw * 1.9, hh * 0.5);
        ctx.fillStyle = c[2]; ctx.font = `bold ${Math.round(h * 0.14)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.fillText('Cola', 0, hh * 0.38);
        ctx.fillStyle = '#b8b8b8'; ctx.fillRect(-hw * 0.36, -hh, hw * 0.72, hh * 0.12);
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(-hw * 0.7, -hh * 0.5, hw * 0.2, hh * 1.4);
        break;
      }
      case 'can': {
        ctx.fillStyle = c[1]; roundRect(ctx, -hw, -hh, w, h, 6); ctx.fill();
        ctx.fillStyle = c[0]; ctx.fillRect(-hw, -hh, w, hh * 0.22); ctx.fillRect(-hw, hh * 0.78, w, hh * 0.22);
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, hw * 0.45, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(-hw * 0.8, -hh * 0.7, hw * 0.2, hh * 1.4);
        break;
      }
      case 'balloon': {
        const col = c[Math.abs(Math.round(w * 7)) % c.length];
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, hh * 0.85); ctx.quadraticCurveTo(hw * 0.4, hh * 1.4, 0, hh * 1.9); ctx.stroke();
        ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(0, -hh * 0.1, hw, hh * 0.85, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-hw * 0.15, hh * 0.9); ctx.lineTo(hw * 0.15, hh * 0.9); ctx.lineTo(0, hh * 0.7); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.ellipse(-hw * 0.35, -hh * 0.45, hw * 0.2, hh * 0.28, -0.5, 0, TAU); ctx.fill();
        break;
      }
      case 'plate': {
        ctx.fillStyle = c[0]; ctx.beginPath(); ctx.arc(0, 0, hw, 0, TAU); ctx.fill();
        ctx.strokeStyle = c[1]; ctx.lineWidth = hw * 0.12; ctx.beginPath(); ctx.arc(0, 0, hw * 0.8, 0, TAU); ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, hw * 0.5, 0, TAU); ctx.stroke();
        break;
      }
      case 'apple': case 'tomato': {
        ctx.fillStyle = c[0]; ctx.beginPath(); ctx.arc(0, hh * 0.05, hw, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(-hw * 0.35, -hh * 0.3, hw * 0.25, 0, TAU); ctx.fill();
        ctx.fillStyle = c[1];
        if (type === 'apple') { ctx.fillStyle = c[2]; ctx.fillRect(-2, -hh, 4, hh * 0.35); ctx.fillStyle = c[1]; ctx.beginPath(); ctx.ellipse(hw * 0.3, -hh * 0.85, hw * 0.35, hh * 0.15, 0.6, 0, TAU); ctx.fill(); }
        else { ctx.beginPath(); for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * TAU / 5; ctx.lineTo(Math.cos(a) * hw * 0.5, -hh * 0.55 + Math.sin(a) * hh * 0.3); ctx.lineTo(Math.cos(a + TAU / 10) * hw * 0.2, -hh * 0.55 + Math.sin(a + TAU / 10) * hh * 0.12); } ctx.closePath(); ctx.fill(); }
        break;
      }
      case 'duck': {
        ctx.fillStyle = c[0];
        ctx.beginPath(); ctx.ellipse(hw * 0.1, hh * 0.3, hw * 0.85, hh * 0.6, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(-hw * 0.45, -hh * 0.4, hh * 0.5, 0, TAU); ctx.fill();
        ctx.fillStyle = c[1]; ctx.beginPath(); ctx.moveTo(-hw * 0.8, -hh * 0.45); ctx.lineTo(-hw * 1.15, -hh * 0.25); ctx.lineTo(-hw * 0.8, -hh * 0.1); ctx.fill();
        ctx.fillStyle = c[2]; ctx.beginPath(); ctx.arc(-hw * 0.5, -hh * 0.5, 3, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.beginPath(); ctx.ellipse(hw * 0.25, hh * 0.2, hw * 0.35, hh * 0.3, 0.3, 0, TAU); ctx.fill();
        break;
      }
      case 'cup': {
        ctx.fillStyle = c[0]; ctx.beginPath(); ctx.moveTo(-hw * 0.85, -hh); ctx.lineTo(hw * 0.85, -hh); ctx.lineTo(hw * 0.65, hh); ctx.lineTo(-hw * 0.65, hh); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = c[0]; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(hw * 0.8, -hh * 0.1, hw * 0.35, -Math.PI / 2, Math.PI / 2); ctx.stroke();
        ctx.fillStyle = c[1]; ctx.fillRect(-hw * 0.8, -hh * 0.4, hw * 1.55, hh * 0.3);
        break;
      }
      case 'vase': {
        ctx.fillStyle = c[0];
        ctx.beginPath(); ctx.moveTo(-hw * 0.5, -hh); ctx.lineTo(hw * 0.5, -hh); ctx.lineTo(hw * 0.35, -hh * 0.6);
        ctx.quadraticCurveTo(hw * 1.15, -hh * 0.1, hw * 0.7, hh * 0.6); ctx.lineTo(hw * 0.75, hh); ctx.lineTo(-hw * 0.75, hh); ctx.lineTo(-hw * 0.7, hh * 0.6);
        ctx.quadraticCurveTo(-hw * 1.15, -hh * 0.1, -hw * 0.35, -hh * 0.6); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = c[2]; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-hw * 0.6, hh * 0.1); ctx.quadraticCurveTo(0, hh * 0.35, hw * 0.6, hh * 0.1); ctx.stroke();
        ctx.fillStyle = c[1]; ctx.fillRect(-hw * 0.75, hh * 0.8, hw * 1.5, hh * 0.2);
        break;
      }
      case 'bulb': {
        ctx.fillStyle = c[0]; ctx.beginPath(); ctx.arc(0, -hh * 0.35, hw, 0, TAU); ctx.fill();
        ctx.fillStyle = c[2]; ctx.beginPath(); ctx.arc(0, -hh * 0.35, hw * 0.45, 0, TAU); ctx.fill();
        ctx.fillStyle = c[1]; roundRect(ctx, -hw * 0.5, hh * 0.3, w * 0.5, hh * 0.7, 4); ctx.fill();
        ctx.fillStyle = c[0]; ctx.beginPath(); ctx.moveTo(-hw * 0.6, hh * 0.35); ctx.lineTo(hw * 0.6, hh * 0.35); ctx.lineTo(hw * 0.5, hh * 0.05); ctx.lineTo(-hw * 0.5, hh * 0.05); ctx.fill();
        break;
      }
      case 'clay': {
        ctx.fillStyle = c[1]; ctx.beginPath(); ctx.ellipse(0, hh * 0.2, hw, hh * 0.8, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = c[0]; ctx.beginPath(); ctx.ellipse(0, -hh * 0.1, hw, hh * 0.75, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.ellipse(0, -hh * 0.15, hw * 0.4, hh * 0.3, 0, 0, TAU); ctx.fill();
        break;
      }
      case 'egg': {
        ctx.fillStyle = c[0]; ctx.beginPath(); ctx.ellipse(0, hh * 0.1, hw, hh * 0.9, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = c[1]; ctx.beginPath(); ctx.ellipse(0, -hh * 0.25, hw * 0.85, hh * 0.6, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = c[0]; ctx.beginPath(); ctx.ellipse(0, -hh * 0.2, hw * 0.8, hh * 0.55, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.ellipse(-hw * 0.3, -hh * 0.4, hw * 0.2, hh * 0.2, -0.4, 0, TAU); ctx.fill();
        break;
      }
      case 'coin': {
        ctx.fillStyle = c[1]; ctx.beginPath(); ctx.arc(0, 0, hw, 0, TAU); ctx.fill();
        ctx.fillStyle = c[0]; ctx.beginPath(); ctx.arc(0, 0, hw * 0.8, 0, TAU); ctx.fill();
        ctx.fillStyle = c[1]; ctx.font = `bold ${Math.round(h * 0.9)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$', 0, 2); ctx.textBaseline = 'alphabetic';
        break;
      }
      default: {
        ctx.fillStyle = '#fff'; ctx.fillRect(-hw, -hh, w, h);
      }
    }
  }

  function drawWeapon(ctx, wep) {
    // Drawn with the muzzle pointing to +x; (0,0) is the shooter's hand.
    switch (wep.proj === 'arrow' && wep.kind === 'gun' ? 'crossbow' : wep.name) {
      case 'Bow': {
        ctx.strokeStyle = '#8d5a2b'; ctx.lineWidth = 9; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(-10, 0, 70, -Math.PI * 0.42, Math.PI * 0.42); ctx.stroke();
        ctx.strokeStyle = '#eee'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-10 + Math.cos(-Math.PI * 0.42) * 70, Math.sin(-Math.PI * 0.42) * 70); ctx.lineTo(-40, 0); ctx.lineTo(-10 + Math.cos(Math.PI * 0.42) * 70, Math.sin(Math.PI * 0.42) * 70); ctx.stroke();
        ctx.strokeStyle = '#8d5a2b'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(50, 0); ctx.stroke();
        ctx.fillStyle = '#ddd'; ctx.beginPath(); ctx.moveTo(58, 0); ctx.lineTo(44, -6); ctx.lineTo(44, 6); ctx.fill();
        break;
      }
      case 'Slingshot': {
        ctx.strokeStyle = '#8d5a2b'; ctx.lineWidth = 10; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-30, 0); ctx.lineTo(10, 0); ctx.lineTo(45, -32); ctx.moveTo(10, 0); ctx.lineTo(45, 32); ctx.stroke();
        ctx.strokeStyle = '#333'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(45, -32); ctx.lineTo(-20, 0); ctx.lineTo(45, 32); ctx.stroke();
        ctx.fillStyle = '#6b6f7a'; ctx.beginPath(); ctx.arc(-20, 0, 10, 0, TAU); ctx.fill();
        break;
      }
      case 'Throwing knife': {
        ctx.fillStyle = '#d8dde5'; ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(40, -7); ctx.lineTo(80, 0); ctx.lineTo(40, 7); ctx.fill();
        ctx.fillStyle = '#333'; roundRect(ctx, -20, -6, 32, 12, 5); ctx.fill();
        break;
      }
      case 'Shuriken': {
        ctx.fillStyle = '#c9d1d9'; ctx.beginPath();
        for (let i = 0; i < 8; i++) { const r = i % 2 ? 8 : 26; const a = i * Math.PI / 4; ctx.lineTo(20 + Math.cos(a) * r, Math.sin(a) * r); }
        ctx.closePath(); ctx.fill();
        break;
      }
      case 'crossbow': {
        ctx.fillStyle = '#5b3a1e'; roundRect(ctx, -30, -8, 90, 16, 6); ctx.fill();
        ctx.strokeStyle = '#8d5a2b'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(30, -50); ctx.quadraticCurveTo(50, 0, 30, 50); ctx.stroke();
        ctx.strokeStyle = '#eee'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(30, -50); ctx.lineTo(-10, 0); ctx.lineTo(30, 50); ctx.stroke();
        ctx.fillStyle = '#ddd'; ctx.beginPath(); ctx.moveTo(72, 0); ctx.lineTo(58, -6); ctx.lineTo(58, 6); ctx.fill();
        break;
      }
      case 'Sniper rifle': {
        ctx.fillStyle = '#2b2f36'; roundRect(ctx, -40, -9, 150, 18, 5); ctx.fill();
        ctx.fillStyle = '#5b3a1e'; ctx.beginPath(); ctx.moveTo(-40, -8); ctx.lineTo(-10, -8); ctx.lineTo(-20, 30); ctx.lineTo(-48, 30); ctx.fill();
        ctx.fillStyle = '#111'; roundRect(ctx, 0, -24, 50, 12, 5); ctx.fill();
        ctx.fillStyle = '#2b2f36'; roundRect(ctx, 110, -5, 40, 10, 4); ctx.fill();
        break;
      }
      case 'Revolver': {
        ctx.fillStyle = '#3a3f47'; roundRect(ctx, -10, -11, 90, 20, 6); ctx.fill();
        ctx.fillStyle = '#5b3a1e'; ctx.beginPath(); ctx.moveTo(-12, -4); ctx.lineTo(10, -4); ctx.lineTo(-2, 36); ctx.lineTo(-22, 36); ctx.fill();
        ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(18, 2, 14, 0, TAU); ctx.fill();
        break;
      }
      default: { // Pistol
        ctx.fillStyle = '#2b2f36'; roundRect(ctx, -10, -12, 80, 24, 5); ctx.fill();
        ctx.fillStyle = '#1a1d22'; ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(18, 0); ctx.lineTo(6, 42); ctx.lineTo(-18, 42); ctx.fill();
        ctx.fillStyle = '#444'; ctx.fillRect(20, 12, 6, 12);
      }
    }
    // hand
    ctx.fillStyle = '#f1c9a5'; ctx.beginPath(); ctx.arc(-6, 18, 18, 0, TAU); ctx.fill();
  }

  window.SS.Game = Game;
  window.SS.targetPos = targetPos;
  window.SS.shooterPos = shooterPos;
})();
