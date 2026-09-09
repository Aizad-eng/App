/* Screens, score persistence and PWA glue for Hue Hop. */
(function () {
  'use strict';
  const SS = window.SS; const SFX = SS.SFX;
  const SAVE_KEY = 'huehop.save.v1';
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  let save = { best: 0, games: 0, sound: true, haptic: true };
  try { save = { ...save, ...JSON.parse(localStorage.getItem(SAVE_KEY) || '{}') }; } catch (e) { /* ignore */ }
  const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } };
  const haptic = (ms) => { if (save.haptic && navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { /* ignore */ } } };
  const show = (id) => $$('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  const setHidden = (el, v) => { el.hidden = !!v; };

  const canvas = $('#game');
  const game = new SS.Game(canvas, { onState });
  game.best = save.best;
  SS.game = game;

  function onState(st, type, data) {
    $('#hud-score').textContent = st.score;
    $('#hud-score').style.color = st.color;
    if (type === 'score') { haptic(10); pop($('#hud-score')); }
    if (type === 'switch') haptic(15);
    if (type === 'die') haptic(60);
    if (type === 'gameover') showGameOver(st, data);
    if (type === 'start') { setHidden($('#hud-hint'), true); }
  }
  function pop(el) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }

  function refreshHome() {
    $('#home-best').textContent = save.best;
    $('#home-games').textContent = save.games;
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream;
    const standalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    $('#install-tip').hidden = !(isIOS && !standalone);
    $('#tog-sound').checked = !!save.sound; $('#tog-haptic').checked = !!save.haptic;
  }

  function play() {
    SFX.unlock(); SFX.setEnabled(save.sound);
    game.setSettings({ sound: save.sound });
    game.reset();
    setHidden($('#overlay-over'), true); setHidden($('#overlay-pause'), true); setHidden($('#hud-hint'), false);
    show('screen-game');
    game.resize();
    game.start();
  }

  function showGameOver(st, data) {
    save.games += 1;
    const isBest = st.score > 0 && st.score >= save.best && st.score > (save.prevBest || 0);
    if (st.score > save.best) save.best = st.score;
    persist();
    $('#over-score').textContent = st.score;
    $('#over-best').textContent = save.best;
    $('#over-title').textContent = st.score === 0 ? 'Ouch' : (isBest ? 'New best!' : pick(['So close', 'Nice run', 'Keep going', 'Colour clash']));
    $('#over-sub').textContent = data && data.reason === 'fell' ? 'You fell out of the screen.' : 'Wrong colour. Only pass through your own colour.';
    setHidden($('#overlay-over'), false);
  }
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  function quit() { game.pause(); refreshHome(); show('screen-home'); }

  async function share() {
    const text = `I scored ${save.best} in Hue Hop. Can you beat it?`;
    const url = location.href.split('#')[0];
    if (navigator.share) { try { await navigator.share({ title: 'Hue Hop', text, url }); return; } catch (e) { /* cancelled */ } }
    try { await navigator.clipboard.writeText(`${text} ${url}`); toast('Copied'); } catch (e) { toast(text); }
  }
  let toastTimer = 0;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2000); }

  $('#btn-play').addEventListener('click', play);
  $('#btn-retry').addEventListener('click', play);
  $('#btn-over-menu').addEventListener('click', quit);
  $('#btn-share').addEventListener('click', share);
  $('#btn-pause').addEventListener('click', () => { if (!game.running || game.dead) return; game.pause(); setHidden($('#overlay-pause'), false); });
  $('#btn-resume').addEventListener('click', () => { setHidden($('#overlay-pause'), true); game.resume(); });
  $('#btn-restart').addEventListener('click', play);
  $('#btn-quit').addEventListener('click', quit);
  $('#tog-sound').addEventListener('change', e => { save.sound = e.target.checked; persist(); SFX.setEnabled(save.sound); game.setSettings({ sound: save.sound }); });
  $('#tog-haptic').addEventListener('change', e => { save.haptic = e.target.checked; persist(); });
  $('#btn-reset').addEventListener('click', () => { if (confirm('Reset your best score?')) { save.best = 0; save.games = 0; game.best = 0; persist(); refreshHome(); toast('Reset'); } });

  document.addEventListener('visibilitychange', () => { if (document.hidden && game.running && game.started && !game.dead) { game.pause(); setHidden($('#overlay-pause'), false); } });
  document.addEventListener('touchmove', e => { if (e.target === canvas) e.preventDefault(); }, { passive: false });
  let lastTouch = 0;
  document.addEventListener('touchend', e => { const now = Date.now(); if (now - lastTouch < 300 && e.target === canvas) e.preventDefault(); lastTouch = now; }, { passive: false });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  refreshHome();
  show('screen-home');
})();
