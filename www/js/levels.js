/* Procedural level generator. Every level is derived from a seed + tier, so the
   supply of challenges is unlimited and any level can be replayed by its code. */
(function () {
  'use strict';
  const { RNG } = window.SS;

  const W = 1000;   // logical field width
  const H = 1800;   // logical field height

  const WEAPONS = {
    pistol:    { name: 'Pistol',         kind: 'gun', speed: 1700, gravity: 260,  proj: 'bullet', r: 8,  minTier: 1,  windFactor: 0.25 },
    revolver:  { name: 'Revolver',       kind: 'gun', speed: 1350, gravity: 480,  proj: 'bullet', r: 9,  minTier: 3,  windFactor: 0.3 },
    bow:       { name: 'Bow',            kind: 'arc', speedMin: 800, speedMax: 1750, gravity: 950, proj: 'arrow', r: 8, minTier: 2, windFactor: 1 },
    slingshot: { name: 'Slingshot',      kind: 'arc', speedMin: 700, speedMax: 1550, gravity: 1250, proj: 'ball', r: 12, minTier: 4, windFactor: 0.8 },
    sniper:    { name: 'Sniper rifle',   kind: 'gun', speed: 2700, gravity: 110,  proj: 'bullet', r: 6,  minTier: 5,  windFactor: 0.15, sway: 1 },
    knife:     { name: 'Throwing knife', kind: 'arc', speedMin: 900, speedMax: 1650, gravity: 850, proj: 'knife', r: 10, minTier: 6, windFactor: 0.9 },
    shuriken:  { name: 'Shuriken',       kind: 'gun', speed: 1500, gravity: 220,  proj: 'star', r: 12, minTier: 7, windFactor: 0.6 },
    crossbow:  { name: 'Crossbow',       kind: 'gun', speed: 2100, gravity: 380,  proj: 'arrow', r: 8,  minTier: 9,  windFactor: 0.35 },
  };

  const TARGETS = {
    bottle:  { name: 'Bottle',   w: 54, h: 112, minTier: 1,  plural: 'Bottles' },
    can:     { name: 'Can',      w: 50, h: 74,  minTier: 1,  plural: 'Cans' },
    balloon: { name: 'Balloon',  w: 70, h: 86,  minTier: 2,  plural: 'Balloons' },
    plate:   { name: 'Plate',    w: 78, h: 78,  minTier: 2,  plural: 'Plates', round: true },
    apple:   { name: 'Apple',    w: 50, h: 50,  minTier: 3,  plural: 'Apples', round: true },
    duck:    { name: 'Duck',     w: 84, h: 62,  minTier: 3,  plural: 'Ducks' },
    cup:     { name: 'Cup',      w: 56, h: 60,  minTier: 4,  plural: 'Cups' },
    vase:    { name: 'Vase',     w: 62, h: 104, minTier: 4,  plural: 'Vases' },
    bulb:    { name: 'Bulb',     w: 46, h: 72,  minTier: 5,  plural: 'Bulbs' },
    clay:    { name: 'Clay disc', w: 66, h: 30, minTier: 5,  plural: 'Clay discs' },
    tomato:  { name: 'Tomato',   w: 46, h: 42,  minTier: 6,  plural: 'Tomatoes', round: true },
    egg:     { name: 'Egg',      w: 40, h: 52,  minTier: 7,  plural: 'Eggs' },
    coin:    { name: 'Coin',     w: 32, h: 32,  minTier: 9,  plural: 'Coins', round: true },
  };

  const THEMES = [
    { name: 'Studio',   sky: ['#2b2f7a', '#141633'], ground: '#1a1c3a', accent: '#7c83ff' },
    { name: 'Sunset',   sky: ['#ff8a5b', '#5a2a7a'], ground: '#2d1a3d', accent: '#ffd166' },
    { name: 'Meadow',   sky: ['#7fd3ff', '#c9f0ff'], ground: '#3f9d4a', accent: '#ffffff', dark: false },
    { name: 'Night',    sky: ['#05070f', '#182340'], ground: '#0c1020', accent: '#9bd4ff' },
    { name: 'Desert',   sky: ['#ffd89b', '#ff9d6c'], ground: '#c98a4b', accent: '#5b2a0f', dark: false },
    { name: 'Arctic',   sky: ['#dfe9f3', '#9fb7d3'], ground: '#e8f1fb', accent: '#1f3a5a', dark: false },
    { name: 'Neon',     sky: ['#1a0033', '#33004d'], ground: '#0d0019', accent: '#ff2ea6' },
    { name: 'Forest',   sky: ['#3d7a5c', '#0f2b1f'], ground: '#122a1a', accent: '#d7ffb0' },
  ];

  const ADJ = ['Steady', 'Sharp', 'Quick', 'Narrow', 'Twisted', 'Dizzy', 'Silent', 'Wild', 'Lucky', 'Frozen', 'Blazing', 'Tricky', 'Golden', 'Rusty', 'Wobbly'];
  const NOUN = ['Row', 'Stand', 'Gallery', 'Alley', 'Shelf', 'Line-up', 'Parade', 'Cascade', 'Circus', 'Stack'];

  const SHOOTER_X = 880;
  const POST_X = 500;
  const TARGET_X_MIN = 90;
  const TARGET_X_MAX = 400;

  function difficultyCurve(tier) {
    // Smooth 0..1 difficulty; grows fast early, keeps creeping later.
    return 1 - Math.exp(-Math.max(0, tier - 1) / 9);
  }

  /* --- physics helpers shared with the game so generated solutions are exact --- */
  function stepProjectile(p, g, wind, dt) {
    p.vy += g * dt;
    p.vx += wind * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }

  function rectContains(rect, x, y, pad) {
    pad = pad || 0;
    return x >= rect.x - rect.w / 2 - pad && x <= rect.x + rect.w / 2 + pad &&
           y >= rect.y - rect.h / 2 - pad && y <= rect.y + rect.h / 2 + pad;
  }

  function postSegments(post) {
    // Convert the gap list into solid segments (rects in centre coordinates).
    const segs = [];
    let y = 0;
    const gaps = post.gaps.slice().sort((a, b) => a.y0 - b.y0);
    for (const g of gaps) {
      if (g.y0 > y) segs.push({ x: post.x, y: (y + g.y0) / 2, w: post.w, h: g.y0 - y });
      y = g.y1;
    }
    const bottom = H * 0.94 + 12; // post sinks slightly into the ground line
    if (y < bottom) segs.push({ x: post.x, y: (y + bottom) / 2, w: post.w, h: bottom - y });
    return segs;
  }

  function staticBlockers(level) {
    const rects = [];
    for (const o of level.obstacles) {
      if (o.type === 'post') rects.push(...postSegments(o));
      else if (o.type === 'block' || o.type === 'glass') rects.push({ x: o.x, y: o.y, w: o.w, h: o.h });
    }
    return rects;
  }

  /* Simulate one shot and return the sampled path (or null if it hits a blocker before
     reaching the target zone). */
  function tracePath(level, angle, speed, blockers, radius) {
    const wep = WEAPONS[level.weapon];
    const p = { x: level.shooter.x, y: level.shooter.y, vx: -Math.cos(angle) * speed, vy: -Math.sin(angle) * speed };
    const dt = 1 / 240;
    const path = [];
    const wind = level.wind * wep.windFactor;
    for (let i = 0; i < 240 * 6; i++) {
      stepProjectile(p, wep.gravity, wind, dt);
      if (p.x < -50 || p.y > H + 50 || p.x > W + 50) break;
      for (const b of blockers) {
        if (rectContains(b, p.x, p.y, radius)) return { path, blocked: true };
      }
      path.push({ x: p.x, y: p.y, t: i * dt });
    }
    return { path, blocked: false };
  }

  /* Find the launch angle that makes a shot pass through `pt` (iterative drop correction). */
  function solveAngle(level, pt, speed) {
    const wep = WEAPONS[level.weapon];
    const sx = level.shooter.x, sy = level.shooter.y;
    const dist = sx - pt.x;
    let angle = Math.atan2(sy - pt.y, dist);
    for (let iter = 0; iter < 6; iter++) {
      const p = { x: sx, y: sy, vx: -Math.cos(angle) * speed, vy: -Math.sin(angle) * speed };
      const dt = 1 / 480;
      let yAt = null;
      for (let i = 0; i < 480 * 4; i++) {
        stepProjectile(p, wep.gravity, level.wind * wep.windFactor, dt);
        if (p.x <= pt.x) { yAt = p.y; break; }
      }
      if (yAt === null) break;
      const err = yAt - pt.y; // positive = passed below the point, so aim higher
      angle += Math.atan2(err, dist);
      if (Math.abs(err) < 0.5) break;
    }
    return angle;
  }

  function generateLevel(seed, tier, options) {
    options = options || {};
    const rng = new RNG(seed);
    const t = Math.max(1, Math.floor(tier));
    const d = difficultyCurve(t);

    // ----- weapon -----
    let weaponPool = Object.keys(WEAPONS).filter(k => WEAPONS[k].minTier <= t);
    if (options.weapon && WEAPONS[options.weapon]) weaponPool = [options.weapon];
    const weaponKey = t === 1 ? 'pistol' : rng.pick(weaponPool);
    const wep = WEAPONS[weaponKey];

    // ----- theme / wind / shooter -----
    const theme = THEMES[rng.int(0, THEMES.length - 1)];
    const wind = (t >= 4 && rng.chance(0.35 + d * 0.3)) ? rng.sign() * rng.float(90, 180 + d * 260) : 0;
    const shooter = { x: SHOOTER_X, y: rng.float(H * 0.32, H * 0.78) };

    const level = {
      seed, tier: t, weapon: weaponKey, theme, wind, shooter,
      targets: [], obstacles: [], hints: [],
      timeLimit: 0, W, H,
    };

    let count = 1 + Math.floor(t / 2) + (t >= 3 ? rng.int(0, 1) : 0);
    count = Math.min(count, 7);
    if (options.targetCount) count = options.targetCount;

    // ----- obstacles -----
    if (wep.kind === 'gun') {
      // The signature wooden post with gaps between the shooter and the targets.
      const gapCount = Math.max(t <= 2 ? 3 : (t <= 6 ? 2 : rng.int(1, 2)), Math.min(4, Math.ceil(count / 2.5)));
      const gapH = Math.round(H * (0.095 - d * 0.052)); // 171 -> ~80 px
      const gaps = [];
      // First gap sits within comfortable reach of the shooter, the rest are random.
      const firstY0 = Math.min(H * 0.88 - gapH, Math.max(H * 0.12, shooter.y + rng.float(-150, 150) - gapH / 2));
      gaps.push({ y0: firstY0, y1: firstY0 + gapH });
      let tries = 0;
      while (gaps.length < gapCount && tries++ < 200) {
        const y0 = rng.float(H * 0.12, H * 0.88 - gapH);
        if (gaps.every(g => Math.abs(g.y0 - y0) > gapH * 2.2)) gaps.push({ y0, y1: y0 + gapH });
      }
      const post = { type: 'post', x: POST_X, w: 48, gaps, motion: null };
      if (t >= 8 && rng.chance(0.4)) post.motion = { kind: 'bob', amp: rng.float(30, 60 + d * 80), speed: rng.float(0.6, 1.4), phase: rng.float(0, 6.28) };
      level.obstacles.push(post);

      if (t >= 6 && gaps.length >= 2 && rng.chance(0.3)) {
        // A pane of glass across one of the extra gaps: costs a shot to break.
        const g = gaps[rng.int(1, gaps.length - 1)];
        g.glass = true;
        level.obstacles.push({ type: 'glass', x: POST_X, y: (g.y0 + g.y1) / 2, w: 14, h: g.y1 - g.y0, hp: 1 });
      }
      if (t >= 5 && rng.chance(0.35 + d * 0.25)) {
        level.obstacles.push({
          type: 'plank', x: rng.float(250, 420), y: rng.float(H * 0.3, H * 0.7), w: 26, h: rng.float(120, 220),
          motion: { kind: 'slide-y', amp: rng.float(180, 320), speed: rng.float(0.8, 1.6 + d), phase: rng.float(0, 6.28) },
        });
      }
      if (t >= 7 && rng.chance(0.3 + d * 0.2)) {
        level.obstacles.push({ type: 'spinner', x: rng.float(220, 400), y: rng.float(H * 0.25, H * 0.75), len: rng.float(160, 260), thick: 22, rotSpeed: rng.sign() * rng.float(1.2, 2.2 + d * 1.5), phase: rng.float(0, 6.28) });
      }
    } else {
      // Arc weapons: low walls and hanging planks to lob over / under.
      const wallCount = rng.int(1, 2 + (t >= 5 ? 1 : 0));
      for (let i = 0; i < wallCount; i++) {
        const h = rng.float(H * 0.12, H * (0.22 + d * 0.3));
        const x = rng.float(300, 640);
        level.obstacles.push({ type: 'block', x, y: H - h / 2, w: rng.float(40, 80), h });
      }
      if (t >= 3 && rng.chance(0.5)) {
        const h = rng.float(H * 0.1, H * (0.2 + d * 0.25));
        level.obstacles.push({ type: 'block', x: rng.float(300, 640), y: h / 2, w: rng.float(40, 70), h });
      }
      if (t >= 6 && rng.chance(0.4)) {
        level.obstacles.push({
          type: 'plank', x: rng.float(240, 440), y: rng.float(H * 0.3, H * 0.7), w: 26, h: rng.float(120, 220),
          motion: { kind: 'slide-y', amp: rng.float(150, 300), speed: rng.float(0.7, 1.4 + d), phase: rng.float(0, 6.28) },
        });
      }
    }

    // ----- targets -----
    const targetPool = Object.keys(TARGETS).filter(k => TARGETS[k].minTier <= t);
    const primaryType = rng.pick(targetPool);
    const mixed = t >= 4 && rng.chance(0.5);
    const scale = 1 - Math.min(0.32, (t - 1) * 0.028);

    const blockers = staticBlockers(level);
    const placed = [];
    const motionKinds = ['bob', 'slide'];
    if (t >= 4) motionKinds.push('swing', 'rise');
    if (t >= 5) motionKinds.push('fly', 'orbit');
    const pMove = Math.min(0.9, (t - 1) * 0.13);

    let attempts = 0;
    while (placed.length < count && attempts++ < 400) {
      // Sample a valid shot, then drop a target somewhere on its path in the target zone.
      let angle, speed;
      if (wep.kind === 'gun') {
        // Aim through a random point inside a random gap, correcting for bullet drop.
        const post = level.obstacles.find(o => o.type === 'post');
        const gap = rng.pick(post.gaps.filter(g => !g.glass));
        const margin = wep.r + 6;
        const gy = rng.float(gap.y0 + margin, gap.y1 - margin);
        speed = wep.speed;
        angle = solveAngle(level, { x: POST_X, y: gy }, speed);
      } else {
        angle = rng.float(-0.3, 1.35);
        speed = rng.float(wep.speedMin, wep.speedMax);
      }
      const trace = tracePath(level, angle, speed, blockers, wep.r);
      const zone = trace.path.filter(pt => pt.x >= TARGET_X_MIN && pt.x <= TARGET_X_MAX && pt.y >= H * 0.08 && pt.y <= H * 0.93);
      if (trace.blocked || zone.length === 0) continue;
      const pt = zone[rng.int(0, zone.length - 1)];
      const typeKey = (mixed && rng.chance(0.5)) ? rng.pick(targetPool) : primaryType;
      const spec = TARGETS[typeKey];
      const w = spec.w * scale, h = spec.h * scale;
      // Keep targets apart from each other and away from blockers.
      const tooClose = placed.some(o => Math.abs(o.x - pt.x) < (o.w + w) / 2 + 16 && Math.abs(o.y - pt.y) < (o.h + h) / 2 + 16);
      const inBlocker = blockers.some(b => rectContains(b, pt.x, pt.y, Math.max(w, h)));
      if (tooClose || inBlocker) continue;

      let motion = null;
      if (rng.chance(pMove)) {
        const kind = rng.pick(motionKinds);
        const speedMul = 0.7 + d * 1.2;
        if (kind === 'bob' || kind === 'slide') motion = { kind, amp: rng.float(40, 90 + d * 120), speed: rng.float(0.8, 1.6) * speedMul, phase: rng.float(0, 6.28) };
        else if (kind === 'swing') motion = { kind, amp: rng.float(0.4, 0.9), len: rng.float(90, 200), speed: rng.float(1.2, 2) * speedMul, phase: rng.float(0, 6.28) };
        else if (kind === 'rise') motion = { kind, range: rng.float(160, 320), speed: rng.float(50, 90) * speedMul, phase: rng.float(0, 1) };
        else if (kind === 'fly') motion = { kind, range: rng.float(160, 300), speed: rng.float(80, 130) * speedMul, phase: rng.float(0, 1) };
        else if (kind === 'orbit') motion = { kind, amp: rng.float(40, 80 + d * 60), speed: rng.float(0.8, 1.6) * speedMul, phase: rng.float(0, 6.28) };
      }
      const target = { id: placed.length, type: typeKey, x: pt.x, y: pt.y, w, h, round: !!spec.round, motion, hp: 1 };
      placed.push(target);
      level.hints.push({ targetId: target.id, angle, speed });
    }
    level.targets = placed;

    // ----- rules -----
    const n = placed.length;
    level.par = n + Math.max(1, Math.round(n * (0.9 - d * 0.5)));
    level.attemptsMax = Math.max(n * 2 + 2, level.par + 3);
    if (t >= 6 && rng.chance(0.25)) level.timeLimit = Math.round(14 + n * (7 - d * 3));

    // ----- name -----
    const feature = wind ? 'Windy' : (level.obstacles.some(o => o.type === 'spinner') ? 'Spinning' : (level.timeLimit ? 'Rush' : rng.pick(ADJ)));
    const mainType = TARGETS[primaryType];
    level.name = `${feature} ${mainType.name} ${rng.pick(NOUN)}`;
    level.summary = `${n} ${n === 1 ? mainType.name.toLowerCase() : mainType.plural.toLowerCase()}${mixed ? ' & more' : ''}`;
    return level;
  }

  function tierForRandomDifficulty(diff) {
    return { easy: 1, medium: 4, hard: 8, insane: 13 }[diff] || 4;
  }

  window.SS = window.SS || {};
  Object.assign(window.SS, {
    W, H, WEAPONS, TARGETS, THEMES, generateLevel, postSegments, stepProjectile, rectContains, tierForRandomDifficulty,
  });
})();
