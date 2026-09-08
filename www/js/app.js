/* Screens, modes, progress and PWA glue. */
(function () {
  'use strict';
  const SS = window.SS;
  const { generateLevel, hashString, seedToCode, codeToSeed, WEAPONS, TARGETS, SFX, tierForRandomDifficulty } = SS;

  const SAVE_KEY = 'sharpshot.save.v1';
  const DEFAULT_SAVE = {
    endlessLevel: 1, best: {}, stars: {},
    settings: { control: 'timing', aimGuide: 'short', sound: true, camera: false, haptic: true, p1: 'Player 1', p2: 'Player 2', randomDiff: 'medium', duelDiff: 'medium', randomWeapon: '' },
    duel: { p1: 0, p2: 0, rounds: 0 },
  };
  let save = loadSave();

  function loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return JSON.parse(JSON.stringify(DEFAULT_SAVE));
      const s = JSON.parse(raw);
      return { ...JSON.parse(JSON.stringify(DEFAULT_SAVE)), ...s, settings: { ...DEFAULT_SAVE.settings, ...(s.settings || {}) }, duel: { ...DEFAULT_SAVE.duel, ...(s.duel || {}) } };
    } catch (e) { return JSON.parse(JSON.stringify(DEFAULT_SAVE)); }
  }
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* private mode */ } }

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const show = (id) => { $$('.screen').forEach(s => s.classList.toggle('active', s.id === id)); };
  const setHidden = (el, v) => { if (el) el.hidden = !!v; };

  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }
  function haptic(ms) { if (save.settings.haptic && navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { /* ignore */ } } }

  /* ---------- session ---------- */
  const session = { mode: null, seed: 0, tier: 1, level: null, player: 1, results: {}, weapon: '' };
  const canvas = $('#game');
  const hudEl = $('#hud');
  const game = new SS.Game(canvas, { onState, insets: () => ({ top: (hudEl ? hudEl.offsetHeight : 0) + 6, bottom: 10 }) });

  // Codes look like 7T-K3P9A2: tier, T for tap-timing (no letter = drag aim), then the seed.
  function levelCode(seed, tier, control) { return `${tier}${control === 'timing' ? 'T' : ''}-${seedToCode(seed)}`; }
  function parseCode(code) {
    const m = String(code || '').trim().toUpperCase().match(/^(\d{1,3})(T?)\s*[-_ ]\s*([0-9A-Z]{1,8})$/);
    if (!m) return null;
    const seed = codeToSeed(m[3]); const tier = parseInt(m[1], 10);
    if (seed === null || !(tier >= 1)) return null;
    return { seed, tier, control: m[2] === 'T' ? 'timing' : 'drag' };
  }
  function randomSeed() {
    if (window.crypto && crypto.getRandomValues) { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] >>> 0; }
    return Math.floor(Math.random() * 4294967296) >>> 0;
  }
  function dayInfo() {
    const d = new Date();
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dayIndex = Math.floor(d.getTime() / 86400000);
    return { key, dayIndex, label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) };
  }

  function applyGameSettings() {
    game.setSettings({ aimGuide: save.settings.aimGuide, sound: save.settings.sound, transparent: save.settings.camera && cameraActive });
    SFX.setEnabled(save.settings.sound);
  }

  /* ---------- camera background ---------- */
  let cameraActive = false;
  let cameraStream = null;
  const camEl = $('#cam');
  async function startCamera() {
    if (cameraActive || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      camEl.srcObject = cameraStream; camEl.hidden = false;
      await camEl.play().catch(() => {});
      cameraActive = true;
      return true;
    } catch (e) {
      toast('Camera not available');
      save.settings.camera = false; persist(); syncSettingsUI();
      return false;
    }
  }
  function stopCamera() {
    if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null; cameraActive = false; camEl.srcObject = null; camEl.hidden = true;
  }

  /* ---------- starting levels ---------- */
  function beginLevel(mode, seed, tier, extra) {
    session.mode = mode; session.seed = seed >>> 0; session.tier = tier;
    session.control = (extra && extra.control) || save.settings.control || 'timing';
    session.level = generateLevel(session.seed, tier, { weapon: extra && extra.weapon, control: session.control });
    if (mode !== 'duel') { session.player = 1; session.results = {}; }
    game.setLevel(session.level);
    applyGameSettings();
    show('screen-game');
    game.resize();
    if (save.settings.camera) startCamera().then(applyGameSettings);
    showIntro();
  }

  function modeLabel() {
    switch (session.mode) {
      case 'endless': return `Endless • Level ${session.tier}`;
      case 'daily': return `Daily challenge • ${dayInfo().label}`;
      case 'duel': return `Duel • Round ${save.duel.rounds + 1}`;
      default: return `Random • Tier ${session.tier}`;
    }
  }

  function levelExtras(L) {
    const parts = [];
    if (L.control === 'timing' && WEAPONS[L.weapon].kind === 'arc') parts.push('Fixed arc');
    if (L.wind) parts.push('Wind');
    if (L.timeLimit) parts.push(`${L.timeLimit}s limit`);
    if (L.obstacles.some(o => o.type === 'glass')) parts.push('Glass');
    if (L.obstacles.some(o => o.type === 'plank')) parts.push('Sliding plank');
    if (L.obstacles.some(o => o.type === 'spinner')) parts.push('Spinner');
    if (L.targets.some(t => t.motion)) parts.push('Moving targets');
    if (WEAPONS[L.weapon].sway) parts.push('Sway');
    return parts.length ? parts.join(', ') : 'None';
  }

  function showIntro() {
    const L = session.level;
    $('#intro-mode').textContent = modeLabel();
    $('#intro-name').textContent = L.name;
    $('#intro-weapon').textContent = WEAPONS[L.weapon].name;
    $('#intro-targets').textContent = L.summary;
    $('#intro-par').textContent = `${L.par} shots (max ${L.attemptsMax})`;
    $('#intro-extras').textContent = levelExtras(L);
    $('#intro-code').textContent = levelCode(session.seed, session.tier, session.control);
    const pl = $('#intro-player');
    if (session.mode === 'duel') { pl.hidden = false; pl.textContent = `${playerName(session.player)}, you're up`; }
    else pl.hidden = true;
    $('#btn-start').querySelector('.btn-title').textContent = session.mode === 'duel' ? `Start as ${playerName(session.player)}` : 'Start';
    setHidden($('#overlay-pause'), true); setHidden($('#overlay-result'), true);
    setHidden($('#overlay-intro'), false);
    updateHud(game.state());
  }

  function playerName(n) { return (n === 1 ? save.settings.p1 : save.settings.p2) || `Player ${n}`; }

  function startPlaying() {
    SFX.unlock();
    setHidden($('#overlay-intro'), true);
    game.start();
  }

  /* ---------- HUD ---------- */
  function updateHud(st) {
    const L = session.level; if (!L) return;
    $('#hud-name').textContent = L.name;
    const hp = $('#hud-player');
    if (session.mode === 'duel') { hp.hidden = false; hp.textContent = playerName(session.player); } else hp.hidden = true;
    $('#hud-targets').textContent = `${st.remaining}/${st.total}`;
    $('#hud-shots').textContent = `${st.attempts}/${st.attemptsMax}`;
    const shotsStat = $('#hud-shots').parentElement;
    shotsStat.classList.toggle('warn', st.attempts >= st.attemptsMax - 1 && st.remaining > 0);
    shotsStat.classList.toggle('good', st.attempts <= st.par && st.attempts > 0);
    const timeStat = $('#stat-time');
    if (L.timeLimit) { timeStat.hidden = false; $('#hud-timer').textContent = `${Math.ceil(st.timeLeft)}s`; timeStat.classList.toggle('warn', st.timeLeft <= 5); }
    else timeStat.hidden = true;
    const windStat = $('#stat-wind');
    if (L.wind) {
      windStat.hidden = false;
      const strength = Math.min(3, Math.ceil(Math.abs(L.wind) / 150));
      $('#hud-wind').textContent = (L.wind > 0 ? '→' : '←').repeat(strength);
    } else windStat.hidden = true;
    $('#btn-hint').disabled = st.status !== 'playing';
  }

  function onState(st, type, data) {
    updateHud(st);
    if (type === 'hit') haptic(30);
    if (type === 'shot') haptic(10);
    if (type === 'finished') showResult(data.result, data.reason, st);
  }

  /* ---------- results ---------- */
  function starsFor(attempts, L) {
    const n = L.targets.length;
    if (attempts <= n) return 3;
    if (attempts <= L.par) return 2;
    return 1;
  }
  function starHtml(n) { let s = ''; for (let i = 0; i < 3; i++) s += `<span class="${i < n ? '' : 'off'}">★</span>`; return s; }

  function showResult(result, reason, st) {
    const L = session.level;
    const code = levelCode(session.seed, session.tier, session.control);
    const eyebrow = $('#result-eyebrow'), title = $('#result-title'), stars = $('#result-stars'), detail = $('#result-detail');
    const btnNext = $('#btn-next'), btnRetry = $('#btn-retry'), score = $('#result-score');
    score.hidden = true;
    stars.innerHTML = '';
    if (session.mode === 'duel') return showDuelResult(result, st);

    eyebrow.textContent = modeLabel();
    if (result === 'won') {
      const s = starsFor(st.attempts, L);
      title.textContent = s === 3 ? 'Perfect!' : (s === 2 ? 'Cleared under par!' : 'Cleared!');
      stars.innerHTML = starHtml(s);
      const prevBest = save.best[code];
      const isBest = !prevBest || st.attempts < prevBest;
      if (isBest) save.best[code] = st.attempts;
      save.stars[code] = Math.max(save.stars[code] || 0, s);
      detail.textContent = `${st.attempts} shot${st.attempts === 1 ? '' : 's'} for ${L.targets.length} target${L.targets.length === 1 ? '' : 's'} (par ${L.par}).` + (prevBest ? (isBest ? ' New best!' : ` Best: ${prevBest}.`) : '');
      if (session.mode === 'endless' && session.tier >= save.endlessLevel) save.endlessLevel = session.tier + 1;
      persist();
      btnNext.hidden = false;
      btnNext.querySelector('.btn-title').textContent = session.mode === 'endless' ? `Level ${session.tier + 1}` : (session.mode === 'random' ? 'Another random level' : 'Back to menu');
      btnRetry.textContent = 'Replay this level';
    } else {
      title.textContent = reason === 'time' ? "Time's up" : 'Out of shots';
      detail.textContent = `${st.remaining} target${st.remaining === 1 ? '' : 's'} left. ${reason === 'time' ? 'Shoot faster next time.' : 'Take your time and use the aim guide.'}`;
      btnNext.hidden = session.mode !== 'random';
      btnNext.querySelector('.btn-title').textContent = 'Another random level';
      btnRetry.textContent = 'Try again';
    }
    setHidden($('#overlay-result'), false);
    refreshHome();
  }

  function showDuelResult(result, st) {
    const eyebrow = $('#result-eyebrow'), title = $('#result-title'), stars = $('#result-stars'), detail = $('#result-detail');
    const btnNext = $('#btn-next'), btnRetry = $('#btn-retry'), score = $('#result-score');
    const shots = result === 'won' ? st.attempts : Infinity;
    session.results[session.player] = shots;
    const fmt = (v) => v === Infinity ? 'DNF' : `${v} shot${v === 1 ? '' : 's'}`;
    eyebrow.textContent = `Duel • ${playerName(session.player)}`;
    btnRetry.hidden = true;
    if (session.player === 1) {
      title.textContent = result === 'won' ? `${fmt(shots)}` : 'Did not finish';
      detail.textContent = `Now pass the phone to ${playerName(2)}. Same level, fewer shots wins.`;
      btnNext.hidden = false; btnNext.querySelector('.btn-title').textContent = `Pass to ${playerName(2)}`;
      stars.innerHTML = result === 'won' ? starHtml(starsFor(st.attempts, session.level)) : '';
    } else {
      const a = session.results[1], b = session.results[2];
      let winner = 0;
      if (a < b) winner = 1; else if (b < a) winner = 2;
      save.duel.rounds += 1;
      if (winner === 1) save.duel.p1 += 1; else if (winner === 2) save.duel.p2 += 1;
      persist();
      title.textContent = winner ? `${playerName(winner)} wins!` : 'Tie! Sudden death';
      detail.textContent = `${playerName(1)}: ${fmt(a)} • ${playerName(2)}: ${fmt(b)}`;
      stars.innerHTML = winner ? '🏆' : '⚔️';
      score.hidden = false; score.innerHTML = scoreboardHtml();
      btnNext.hidden = false; btnNext.querySelector('.btn-title').textContent = winner ? 'Next round' : 'Sudden death round';
      session.nextDuelTier = winner ? session.tier : session.tier + 1;
    }
    setHidden($('#overlay-result'), false);
  }

  function scoreboardHtml() {
    return `<div><div class="name">${escapeHtml(playerName(1))}</div><div class="pts">${save.duel.p1}</div></div><div class="vs">vs</div><div><div class="name">${escapeHtml(playerName(2))}</div><div class="pts">${save.duel.p2}</div></div>`;
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function nextAction() {
    setHidden($('#overlay-result'), true);
    if (session.mode === 'endless') return beginLevel('endless', hashString('endless:' + (session.tier + 1)), session.tier + 1, { control: session.control });
    if (session.mode === 'random') return beginLevel('random', randomSeed(), randomTier(save.settings.randomDiff), { weapon: save.settings.randomWeapon, control: session.control });
    if (session.mode === 'duel') {
      if (session.player === 1) {
        session.player = 2;
        game.setLevel(session.level); applyGameSettings(); showIntro();
      } else {
        session.player = 1; session.results = {};
        beginLevel('duel', randomSeed(), session.nextDuelTier || session.tier, { control: session.control });
      }
      return;
    }
    quitToMenu();
  }

  function randomTier(diff) { return tierForRandomDifficulty(diff) + Math.floor(Math.random() * 3); }

  function retryLevel() {
    setHidden($('#overlay-result'), true); setHidden($('#overlay-pause'), true);
    game.setLevel(session.level); applyGameSettings(); showIntro();
  }

  function quitToMenu() {
    game.pause();
    stopCamera();
    setHidden($('#overlay-pause'), true); setHidden($('#overlay-result'), true);
    refreshHome();
    show('screen-home');
  }

  async function shareCode() {
    const code = levelCode(session.seed, session.tier, session.control);
    const url = `${location.origin}${location.pathname}#${code}`;
    const text = `Beat my SharpShot level "${session.level.name}"! Code ${code}`;
    if (navigator.share) { try { await navigator.share({ title: 'SharpShot', text, url }); return; } catch (e) { /* cancelled */ } }
    try { await navigator.clipboard.writeText(`${text} ${url}`); toast('Code copied'); } catch (e) { toast(`Code: ${code}`); }
  }

  /* ---------- home / settings ---------- */
  function refreshHome() {
    $('#endless-sub').textContent = `Level ${save.endlessLevel}`;
    const d = dayInfo();
    const code = levelCode(hashString('daily:' + d.key), dailyTier(), save.settings.control);
    const best = save.best[code];
    $('#daily-sub').textContent = best ? `${d.label} • your best: ${best} shots` : `${d.label} • same level for everyone`;
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream;
    const standalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    $('#install-tip').hidden = !(isIOS && !standalone);
  }
  function dailyTier() { return 3 + (dayInfo().dayIndex % 9); }

  function syncSettingsUI() {
    $$('#seg-control button').forEach(b => b.classList.toggle('on', b.dataset.v === save.settings.control));
    $$('#seg-aim button').forEach(b => b.classList.toggle('on', b.dataset.v === save.settings.aimGuide));
    $('#tog-sound').checked = !!save.settings.sound;
    $('#tog-camera').checked = !!save.settings.camera;
    $('#tog-haptic').checked = !!save.settings.haptic;
    $$('#seg-diff button').forEach(b => b.classList.toggle('on', b.dataset.v === save.settings.randomDiff));
    $$('#seg-duel-diff button').forEach(b => b.classList.toggle('on', b.dataset.v === save.settings.duelDiff));
    $$('#seg-weapon button').forEach(b => b.classList.toggle('on', b.dataset.v === (save.settings.randomWeapon || '')));
    $('#duel-p1').value = save.settings.p1; $('#duel-p2').value = save.settings.p2;
    const sb = $('#duel-score');
    sb.hidden = !(save.duel.p1 || save.duel.p2); sb.innerHTML = scoreboardHtml();
  }

  function segHandler(sel, onPick) {
    $$(sel + ' button').forEach(b => b.addEventListener('click', () => {
      $$(sel + ' button').forEach(x => x.classList.toggle('on', x === b));
      onPick(b.dataset.v); SFX.ui();
    }));
  }

  function bind() {
    // weapon chips
    const segW = $('#seg-weapon');
    Object.keys(WEAPONS).forEach(k => { const b = document.createElement('button'); b.dataset.v = k; b.textContent = WEAPONS[k].name; segW.appendChild(b); });

    $('#btn-endless').addEventListener('click', () => beginLevel('endless', hashString('endless:' + save.endlessLevel), save.endlessLevel));
    $('#btn-daily').addEventListener('click', () => beginLevel('daily', hashString('daily:' + dayInfo().key), dailyTier()));
    $('#btn-random').addEventListener('click', () => { syncSettingsUI(); show('screen-random'); });
    $('#btn-duel').addEventListener('click', () => { syncSettingsUI(); show('screen-duel'); });
    $('#btn-settings').addEventListener('click', () => { syncSettingsUI(); show('screen-settings'); });
    $('#btn-help').addEventListener('click', () => show('screen-help'));
    $$('[data-back]').forEach(b => b.addEventListener('click', () => { refreshHome(); show('screen-home'); }));

    segHandler('#seg-diff', v => { save.settings.randomDiff = v; persist(); });
    segHandler('#seg-weapon', v => { save.settings.randomWeapon = v; persist(); });
    segHandler('#seg-duel-diff', v => { save.settings.duelDiff = v; persist(); });
    segHandler('#seg-control', v => { save.settings.control = v; persist(); refreshHome(); });
    segHandler('#seg-aim', v => { save.settings.aimGuide = v; persist(); applyGameSettings(); });

    $('#btn-random-go').addEventListener('click', () => beginLevel('random', randomSeed(), randomTier(save.settings.randomDiff), { weapon: save.settings.randomWeapon }));
    $('#btn-code-go').addEventListener('click', () => {
      const p = parseCode($('#code-input').value);
      if (!p) return toast('That code does not look right');
      $('#code-input').blur();
      beginLevel('random', p.seed, p.tier, { control: p.control });
    });
    $('#code-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-code-go').click(); });

    const readNames = () => {
      save.settings.p1 = $('#duel-p1').value.trim() || 'Player 1';
      save.settings.p2 = $('#duel-p2').value.trim() || 'Player 2';
      persist();
    };
    $('#btn-duel-go').addEventListener('click', () => {
      readNames();
      session.player = 1; session.results = {};
      beginLevel('duel', randomSeed(), randomTier(save.settings.duelDiff));
    });
    $('#btn-duel-reset').addEventListener('click', () => { save.duel = { p1: 0, p2: 0, rounds: 0 }; persist(); syncSettingsUI(); toast('Score reset'); });

    $('#tog-sound').addEventListener('change', e => { save.settings.sound = e.target.checked; persist(); applyGameSettings(); });
    $('#tog-haptic').addEventListener('change', e => { save.settings.haptic = e.target.checked; persist(); });
    $('#tog-camera').addEventListener('change', async e => {
      save.settings.camera = e.target.checked; persist();
      if (save.settings.camera) { const ok = await startCamera(); if (ok) toast('Camera background on'); stopCamera(); }
    });
    $('#btn-reset').addEventListener('click', () => {
      if (!confirm('Reset all progress, best scores and duel score?')) return;
      save = JSON.parse(JSON.stringify(DEFAULT_SAVE)); persist(); syncSettingsUI(); refreshHome(); toast('Progress reset');
    });

    // game overlays
    $('#btn-start').addEventListener('click', startPlaying);
    $('#btn-intro-back').addEventListener('click', quitToMenu);
    $('#btn-pause').addEventListener('click', () => { if (game.status !== 'playing') return; game.pause(); setHidden($('#overlay-pause'), false); });
    $('#btn-resume').addEventListener('click', () => { setHidden($('#overlay-pause'), true); game.resume(); });
    $('#btn-restart').addEventListener('click', retryLevel);
    $('#btn-quit').addEventListener('click', quitToMenu);
    $('#btn-hint').addEventListener('click', () => { if (game.useHint()) toast('Hint shown (cost 1 shot)'); });
    $('#btn-next').addEventListener('click', nextAction);
    $('#btn-retry').addEventListener('click', retryLevel);
    $('#btn-share').addEventListener('click', shareCode);
    $('#btn-result-menu').addEventListener('click', quitToMenu);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && game.status === 'playing' && game.running) { game.pause(); setHidden($('#overlay-pause'), false); }
    });
    // Block iOS double-tap zoom and rubber-banding on the game screen.
    document.addEventListener('touchmove', e => { if (e.target === canvas) e.preventDefault(); }, { passive: false });
    let lastTouch = 0;
    document.addEventListener('touchend', e => { const now = Date.now(); if (now - lastTouch < 300 && e.target === canvas) e.preventDefault(); lastTouch = now; }, { passive: false });
  }

  function handleHashCode() {
    const p = parseCode(location.hash.slice(1));
    if (p) { history.replaceState(null, '', location.pathname); beginLevel('random', p.seed, p.tier, { control: p.control }); return true; }
    return false;
  }

  function registerSW() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
  }

  SS.game = game;
  bind();
  syncSettingsUI();
  refreshHome();
  applyGameSettings();
  registerSW();
  if (!handleHashCode()) show('screen-home');
})();
