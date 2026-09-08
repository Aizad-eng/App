/* Seeded random number generation so every level can be replayed or shared by code. */
(function () {
  'use strict';

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashString(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h1 ^ h2) >>> 0;
  }

  class RNG {
    constructor(seed) {
      this.seed = seed >>> 0;
      this.next = mulberry32(this.seed);
    }
    float(a = 0, b = 1) { return a + (b - a) * this.next(); }
    int(a, b) { return Math.floor(this.float(a, b + 1)); }
    pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
    chance(p) { return this.next() < p; }
    sign() { return this.next() < 0.5 ? -1 : 1; }
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(this.next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }
  }

  function seedToCode(seed) { return (seed >>> 0).toString(36).toUpperCase(); }
  function codeToSeed(code) {
    const clean = String(code || '').trim().toLowerCase().replace(/[^0-9a-z]/g, '');
    if (!clean) return null;
    const n = parseInt(clean, 36);
    if (!Number.isFinite(n)) return null;
    return n >>> 0;
  }

  window.SS = window.SS || {};
  Object.assign(window.SS, { mulberry32, hashString, RNG, seedToCode, codeToSeed });
})();
