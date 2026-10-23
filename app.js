'use strict';

// ========== KONSTANTER ==========
const PLAYER_COLORS = ['#e63946','#4cc9f0','#ffd60a','#2dc653','#f4a261','#a8dadc','#e9c46a','#e76f51'];
const GAME_NAMES = { x01:'X01', cricket:'CRICKET', around:'AROUND THE CLOCK', killer:'KILLER' };
const GAME_SCREENS = { x01:'game', cricket:'cricket-game', around:'atc-game', killer:'killer-game' };
const CR_LABELS = ['20','19','18','17','16','15','Bull'];
const CR_VALS = [20,19,18,17,16,15,25];
const SETUP_INFO = {
  x01: 'Tell ned fra startsummen til null. Du må treffe nøyaktig 0, ellers er det bust.',
  cricket: 'Lukk 20–15 og Bull med tre merker hver (dobbel = 2, trippel = 3). Ekstra merker gir poeng så lenge en annen spiller har tallet åpent. Vinn ved å lukke alt med flest poeng.',
  around: 'Treff 1 til 20 i rekkefølge, deretter Bull. Første i mål vinner.',
  killer: 'Hver spiller har sitt eget tall. Treff dobbel på ditt eget tall for å bli Killer. Som Killer tar du liv fra de andre med dobbel (−1) eller trippel (−2) på tallet deres. Sist i live vinner.'
};

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

// ========== LAGRING ==========
const store = {
  get(k, d) { try { const v = localStorage.getItem('dart.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('dart.' + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem('dart.' + k); } catch {} }
};

const settings = Object.assign(
  { sound:true, voice:true, lang:'en', haptics:true, wake:true, players:['Spiller 1', 'Spiller 2'] },
  store.get('settings', {})
);
const saveSettings = () => store.set('settings', settings);

// ========== LYD ==========
const Snd = (() => {
  let ctx = null;
  function unlock() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
      // iOS lar bare tale etter en brukerhandling, så vi "låser opp" stemmen her
      if ('speechSynthesis' in window) { try { speechSynthesis.speak(new SpeechSynthesisUtterance('')); } catch {} }
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }
  function tone(freq, dur, { type = 'sine', vol = 0.12, delay = 0, to = null } = {}) {
    if (!settings.sound || !ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  const arp = (notes, step, dur, vol) => notes.forEach((f, i) => tone(f, dur, { type:'triangle', vol, delay:i * step }));
  return {
    unlock,
    tap: () => tone(1100, 0.04, { type:'triangle', vol:0.08 }),
    bust: () => { tone(220, 0.25, { type:'sawtooth', vol:0.12, to:110 }); tone(160, 0.35, { type:'sawtooth', vol:0.12, delay:0.2, to:70 }); },
    big: () => arp([523, 659, 784, 1047], 0.07, 0.18, 0.12),
    win: () => arp([523, 659, 784, 1047, 784, 1047], 0.12, 0.22, 0.14),
    kill: () => tone(300, 0.3, { type:'square', vol:0.08, to:600 }),
    hit: () => tone(180, 0.15, { type:'square', vol:0.1, to:90 })
  };
})();

function haptic(ms) {
  if (settings.haptics && navigator.vibrate) navigator.vibrate(ms);
}

// ========== STEMME ==========
const ONES = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const TENS = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
function wordsEn(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  const r = n % 100;
  return ONES[Math.floor(n / 100)] + ' hundred' + (r ? ' and ' + wordsEn(r) : '');
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

const PHRASES = {
  en: {
    tag:'en-GB', prefixes:['en-gb', 'en'],
    score: n => cap(wordsEn(n)) + (n === 180 ? '!' : ''),
    bust: () => 'Bust!',
    win: name => `Game shot! ${name} wins!`,
    killer: name => `${name} is a killer!`,
    out: name => `${name} is eliminated!`
  },
  no: {
    tag:'nb-NO', prefixes:['nb', 'no', 'nn'],
    score: n => String(n) + (n === 180 ? '!' : ''),
    bust: () => 'Bust!',
    win: name => `Spillet er over! ${name} vant!`,
    killer: name => `${name} er en killer!`,
    out: name => `${name} er ute!`
  }
};

let voices = [];
if ('speechSynthesis' in window) {
  const load = () => { voices = speechSynthesis.getVoices(); };
  load();
  if (speechSynthesis.addEventListener) speechSynthesis.addEventListener('voiceschanged', load);
}

function pickVoice(ph) {
  const norm = v => v.lang.toLowerCase().replace('_', '-');
  for (const p of ph.prefixes) {
    const v = voices.find(v => norm(v) === p) || voices.find(v => norm(v).startsWith(p));
    if (v) return v;
  }
  return null;
}

function speak(text, { pitch = 1, rate = 1 } = {}) {
  if (!settings.voice || !('speechSynthesis' in window)) return;
  const ph = PHRASES[settings.lang] || PHRASES.en;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = ph.tag;
  const v = pickVoice(ph);
  if (v) u.voice = v;
  u.pitch = pitch;
  u.rate = rate;
  if (speechSynthesis.speaking || speechSynthesis.pending) {
    speechSynthesis.cancel();
    setTimeout(() => speechSynthesis.speak(u), 40);
  } else {
    speechSynthesis.speak(u);
  }
}

const say = (key, arg, opts) => speak(PHRASES[settings.lang][key](arg), opts);

// ========== SKJERM ==========
let screenId = 'home';
let wakeLock = null;

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
  screenId = id;
  updateWakeLock();
}

async function updateWakeLock() {
  const want = settings.wake && G.active && Object.values(GAME_SCREENS).includes(screenId);
  try {
    if (want && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!want && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') updateWakeLock(); });

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ========== SPILLTILSTAND ==========
let G = freshG();

function freshG() {
  return {
    active:false, over:false, winner:-1, statsId:null, type:'', cfg:null,
    players:[], startTime:0, multiplier:1, doubleOut:false, doubleIn:false, x01Start:501,
    // X01
    currentPlayer:0, currentThrows:[], history:[], turnEnded:false,
    // Cricket / Around the clock / Killer
    cr:null, atc:null, kl:null
  };
}

function persist() {
  if (G.active) store.set('game', { G, screen:screenId });
  else store.del('game');
}

function pushSnap(T) {
  const { hist, ...rest } = T;
  hist.push(JSON.stringify(rest));
  if (hist.length > 300) hist.shift();
}
function popSnap(T) {
  if (!T.hist.length) return false;
  Object.assign(T, JSON.parse(T.hist.pop()));
  return true;
}

let advTimer = null;
function nextIdx(T) {
  const n = G.players.length;
  let i = T.cur;
  for (let k = 0; k < n; k++) {
    i = (i + 1) % n;
    if (!T.out || !T.out[i]) return i;
  }
  return T.cur;
}
function advanceTurn(T, refresh) {
  clearTimeout(advTimer);
  if (G.over) return;
  T.cur = nextIdx(T);
  T.left = 3;
  refresh();
  persist();
}
function scheduleAdvance(T, refresh, delay = 350) {
  clearTimeout(advTimer);
  if (T.left > 0 || G.over) return;
  if (delay === 0) advanceTurn(T, refresh);
  else advTimer = setTimeout(() => advanceTurn(T, refresh), delay);
}

function setMult(m) {
  G.multiplier = m;
  document.querySelectorAll('.mult-btn').forEach(b => b.classList.toggle('selected-mult', +b.dataset.arg === m));
}

// ========== OPPSETT ==========
const setup = { type:'', x01Score:301, doubleOut:false, doubleIn:false, skip:false, lives:3 };
let setupPlayers = [];

function randomNums(count, taken = []) {
  const pool = Array.from({ length:20 }, (_, i) => i + 1).filter(n => !taken.includes(n));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

function selectGame(type) {
  setup.type = type;
  setup.doubleOut = false; setup.doubleIn = false; setup.skip = false; setup.lives = 3;
  const names = settings.players && settings.players.length ? settings.players : ['Spiller 1', 'Spiller 2'];
  setupPlayers = names.slice(0, 8).map(name => ({ name, num:0 }));
  if (type === 'killer') randomNums(setupPlayers.length).forEach((n, i) => { setupPlayers[i].num = n; });

  const titles = { x01:'X01 OPPSETT', cricket:'CRICKET OPPSETT', around:'AROUND THE CLOCK', killer:'KILLER OPPSETT' };
  $('setup-title').textContent = titles[type];
  $('setup-info').textContent = SETUP_INFO[type];
  $('opt-x01').style.display = type === 'x01' ? '' : 'none';
  $('opt-atc').style.display = type === 'around' ? '' : 'none';
  $('opt-killer').style.display = type === 'killer' ? '' : 'none';
  $('players-label').textContent = type === 'killer' ? 'Spillere og tall (maks 8)' : 'Spillere (maks 8)';
  renderSetupOptions();
  renderSetupPlayers();
  showScreen('setup');
}

function renderSetupOptions() {
  document.querySelectorAll('#score-options .score-opt').forEach(el => el.classList.toggle('selected', +el.dataset.arg === setup.x01Score));
  document.querySelectorAll('#lives-options .score-opt').forEach(el => el.classList.toggle('selected', +el.dataset.arg === setup.lives));
  ['doubleOut', 'doubleIn', 'skip'].forEach(k => $('tg-' + k).classList.toggle('on', setup[k]));
  const custom = $('custom-score');
  if (![301, 501, 701, 1001].includes(setup.x01Score)) custom.value = setup.x01Score;
  else custom.value = '';
}

function renderSetupPlayers() {
  const killer = setup.type === 'killer';
  $('player-setup-list').innerHTML = setupPlayers.map((p, i) => `
    <div class="player-setup-row">
      <div class="player-color-dot" style="background:${PLAYER_COLORS[i % 8]}"></div>
      <input class="player-input" data-i="${i}" value="${esc(p.name)}" placeholder="Spillernavn..." maxlength="14">
      ${killer ? `<select class="num-select" data-i="${i}">${Array.from({ length:20 }, (_, k) => `<option value="${k + 1}"${p.num === k + 1 ? ' selected' : ''}>${k + 1}</option>`).join('')}</select>` : ''}
      ${setupPlayers.length > 1 ? `<button class="remove-player-btn" data-act="remove-player" data-arg="${i}">✕</button>` : ''}
    </div>
  `).join('');
}

function startGame() {
  const names = setupPlayers.map((p, i) => p.name.trim() || `Spiller ${i + 1}`);
  if (setup.type === 'killer') {
    if (names.length < 2) { toast('Killer krever minst 2 spillere'); return; }
    const nums = setupPlayers.map(p => p.num);
    if (new Set(nums).size !== nums.length) { toast('Hver spiller må ha et eget tall'); return; }
  }
  if (setup.type === 'x01' && setup.x01Score < 101) { toast('Startsum må være minst 101'); return; }
  settings.players = names;
  saveSettings();
  beginGame({
    type:setup.type, x01Start:setup.x01Score, doubleOut:setup.doubleOut, doubleIn:setup.doubleIn,
    skip:setup.skip, lives:setup.lives,
    players:names.map((name, i) => ({ name, color:PLAYER_COLORS[i % 8], num:setupPlayers[i].num }))
  });
}

function beginGame(cfg) {
  G = freshG();
  G.active = true;
  G.type = cfg.type;
  G.cfg = cfg;
  G.startTime = Date.now();
  G.x01Start = cfg.x01Start;
  G.doubleOut = cfg.doubleOut;
  G.doubleIn = cfg.doubleIn;
  G.players = cfg.players.map(p => ({ name:p.name, color:p.color }));
  const n = G.players.length;

  if (cfg.type === 'x01') {
    G.players.forEach(p => { p.score = cfg.x01Start; p.lockedIn = !cfg.doubleIn; });
  } else if (cfg.type === 'cricket') {
    G.cr = { cur:0, left:3, darts:0, marks:Array.from({ length:n }, () => Array(7).fill(0)), scores:Array(n).fill(0), hist:[] };
  } else if (cfg.type === 'around') {
    G.atc = { cur:0, left:3, darts:0, skip:cfg.skip, pos:Array(n).fill(1), hist:[] };
  } else if (cfg.type === 'killer') {
    G.kl = {
      cur:0, left:3, darts:0, maxLives:cfg.lives, lives:Array(n).fill(cfg.lives),
      killer:Array(n).fill(false), out:Array(n).fill(false), nums:cfg.players.map(p => p.num), hist:[]
    };
  }
  buildGameUI();
  showScreen(GAME_SCREENS[cfg.type]);
  refreshGame();
  persist();
}

function buildGameUI() {
  if (G.type === 'x01') {
    $('players-bar').innerHTML = G.players.map((p, i) => `
      <div class="player-score-panel" id="psp-${i}">
        <div class="player-score-name">${esc(p.name)}</div>
        <div class="player-score-num" id="psn-${i}"></div>
        <div class="player-turn-score" id="pts-${i}"></div>
        <div class="player-darts-left" id="pdl-${i}">${[0, 1, 2].map(d => `<div class="dart-dot" id="dd-${i}-${d}"></div>`).join('')}</div>
      </div>`).join('');
    $('game-title-bar').textContent = G.x01Start + (G.doubleIn ? ' · DI' : '') + (G.doubleOut ? ' · DO' : '');
  } else if (G.type === 'cricket') {
    $('cricket-players-bar').innerHTML = G.players.map((p, i) => `
      <div class="player-score-panel" id="crpsp-${i}">
        <div class="player-score-name">${esc(p.name)}</div>
        <div class="player-score-num" id="crpsn-${i}">0</div>
        <div class="player-darts-left">${[0, 1, 2].map(d => `<div class="dart-dot" id="crd-${i}-${d}"></div>`).join('')}</div>
      </div>`).join('');
  } else if (G.type === 'around') {
    $('atc-players-bar').innerHTML = G.players.map((p, i) => `
      <div class="player-score-panel" id="atcp-${i}">
        <div class="player-score-name">${esc(p.name)}</div>
        <div class="player-score-num" id="atcn-${i}">1</div>
        <div class="player-sub" id="atcs-${i}"></div>
        <div class="player-darts-left">${[0, 1, 2].map(d => `<div class="dart-dot" id="atcd-${i}-${d}"></div>`).join('')}</div>
      </div>`).join('');
    const a = G.atc;
    $('atc-buttons').style.gridTemplateColumns = a.skip ? 'repeat(3,1fr)' : 'repeat(2,1fr)';
    $('atc-buttons').innerHTML =
      `<div class="act-btn hit" data-fast data-act="atc-hit" data-arg="1">TREFF</div>` +
      (a.skip ? `<div class="act-btn hit" data-fast data-act="atc-hit" data-arg="2">DOBBEL<span class="act-sub">+2</span></div>
                 <div class="act-btn hit" data-fast data-act="atc-hit" data-arg="3">TRIPPEL<span class="act-sub">+3</span></div>` : '') +
      `<div class="act-btn miss" data-fast data-act="atc-hit" data-arg="0">MISS</div>` +
      `<div class="act-btn next" data-fast data-act="atc-next" style="${a.skip ? 'grid-column:span 2' : ''}">✓ NESTE</div>`;
  } else if (G.type === 'killer') {
    $('killer-players-bar').innerHTML = G.players.map((p, i) => `
      <div class="player-score-panel" id="klp-${i}">
        <div class="player-score-name">${esc(p.name)}</div>
        <div class="player-score-num" id="kln-${i}">${G.kl.nums[i]}</div>
        <div class="player-sub" id="kls-${i}"></div>
        <div class="player-darts-left">${[0, 1, 2].map(d => `<div class="dart-dot" id="kld-${i}-${d}"></div>`).join('')}</div>
      </div>`).join('');
    $('killer-buttons').style.gridTemplateColumns = 'repeat(2,1fr)';
    $('killer-buttons').innerHTML = G.players.map((p, i) => `
      <div class="act-btn" id="klb-${i}" data-fast data-act="kl-hit" data-arg="${i}"></div>`).join('') +
      `<div class="act-btn miss" data-fast data-act="kl-hit" data-arg="-1">MISS</div>` +
      `<div class="act-btn next" data-fast data-act="kl-next">✓ NESTE</div>`;
  }
  setMult(1);
}

function refreshGame() {
  if (G.type === 'x01') updateX01UI();
  else if (G.type === 'cricket') refreshCricket();
  else if (G.type === 'around') refreshAtc();
  else if (G.type === 'killer') refreshKiller();
}

// ========== X01 ==========
const chips = [0, 1, 2].map(i => $('throw' + i));
let autoConfirmTimer = null;

function curPlayer() { return G.players[G.currentPlayer]; }

function throwLabel(base, mult) {
  if (base === 0) return 'MISS';
  if (base === 50) return 'BULL';
  if (base === 25) return '25';
  return mult === 2 ? `D${base}` : mult === 3 ? `T${base}` : `${base}`;
}

// Regner ut en runde for en spiller: score, bust, seier og hvilke piler som teller
function evalTurn(p, throws) {
  let score = p.score, locked = p.lockedIn, bust = false, win = false, total = 0;
  const counted = [];
  for (const t of throws) {
    if (bust || win) { counted.push(0); continue; }
    if (!locked) {
      if (t.mult === 2) locked = true;
      else { counted.push(0); continue; }
    }
    const next = score - t.val;
    if (next < 0 || (G.doubleOut && next === 1) || (G.doubleOut && next === 0 && t.mult !== 2)) {
      bust = true; counted.push(0); continue;
    }
    score = next;
    total += t.val;
    counted.push(t.val);
    if (next === 0) win = true;
  }
  return { remaining:bust ? p.score : score, bust, win, total:bust ? 0 : total, locked, counted };
}

function throwDart(base) {
  if (G.over || G.currentThrows.length >= 3 || G.turnEnded) return;
  let mult = G.multiplier, val;
  if (base === 0) { mult = 1; val = 0; }
  else if (base === 25) { mult = 1; val = 25; }
  else if (base === 50) { mult = 2; val = 50; }
  else val = base * mult;
  G.currentThrows.push({ base, mult, val, label:throwLabel(base, mult) });
  Snd.tap(); haptic(8);
  setMult(1);
  renderTurn();
  persist();
}

function renderTurn() {
  clearTimeout(autoConfirmTimer);
  const p = curPlayer(), th = G.currentThrows, n = th.length;
  const ev = evalTurn(p, th);
  G.turnEnded = ev.bust || ev.win;

  chips.forEach((chip, i) => {
    const t = th[i];
    const cls = t ? 'throw-chip filled' + (ev.bust ? ' bust' : '') + (ev.counted[i] === 0 && t.val > 0 && !ev.bust ? ' dead' : '') : 'throw-chip';
    const html = `<div class="throw-chip-label">PIL ${i + 1}</div><div class="throw-chip-val">${t ? t.label : '—'}</div>`;
    const key = cls + html;
    if (chip._k !== key) { chip._k = key; chip.className = cls; chip.innerHTML = html; }
  });

  $('turn-dart-num').textContent = `PIL ${Math.min(n + 1, 3)} AV 3`;
  $('turn-total-val').textContent = ev.total;
  $('remaining-info').innerHTML =
    ev.win ? `<div class="remaining-after" style="color:var(--gold);font-size:18px">🏆 VINNER!</div>` :
    ev.bust ? `<div class="bust-warning">💥 BUST!</div>` :
    !ev.locked ? `<div class="remaining-after" style="color:var(--blue)">Trenger double for å starte</div>` :
    n > 0 ? `<div class="remaining-after">→ ${ev.remaining} igjen</div>` : '';

  [0, 1, 2].forEach(d => $(`dd-${G.currentPlayer}-${d}`).classList.toggle('thrown', d < n));
  $(`pts-${G.currentPlayer}`).textContent = n ? `Runde: ${ev.total}` : '';
  updateCheckoutHint(ev.locked ? ev.remaining : 0, 3 - n);
  $('confirm-btn').classList.toggle('disabled', n === 0);

  if (ev.win) autoConfirmTimer = setTimeout(confirmTurn, 400);
  else if (ev.bust) autoConfirmTimer = setTimeout(confirmTurn, 450);
  else if (n === 3) autoConfirmTimer = setTimeout(confirmTurn, 500);
}

function updateCheckoutHint(remaining, dartsLeft) {
  const hint = CHECKOUT_HINTS[remaining];
  if (remaining > 0 && remaining <= 170 && hint && hint.length <= dartsLeft) {
    $('checkout-hint').style.display = 'flex';
    $('checkout-hint-val').textContent = hint.join(' → ');
  } else {
    $('checkout-hint').style.display = 'none';
  }
}

function confirmTurn() {
  clearTimeout(autoConfirmTimer);
  if (G.over || !G.currentThrows.length) return;
  const p = curPlayer();
  const ev = evalTurn(p, G.currentThrows);
  G.history.push({
    player:G.currentPlayer, throws:[...G.currentThrows], prevScore:p.score, prevLocked:p.lockedIn,
    bust:ev.bust, win:ev.win, total:ev.total, counted:ev.counted
  });
  p.lockedIn = ev.locked;
  G.currentThrows = [];

  if (ev.win) {
    p.score = 0;
    finishGame(G.currentPlayer);
    return;
  }
  if (ev.bust) {
    toast('💥 BUST! Ingen poeng denne runden');
    Snd.bust(); haptic(60);
    say('bust');
  } else {
    p.score = ev.remaining;
    if (ev.total >= 100) {
      Snd.big();
      say('score', ev.total, ev.total === 180 ? { pitch:1.25, rate:0.95 } : {});
    }
  }
  G.currentPlayer = (G.currentPlayer + 1) % G.players.length;
  updateX01UI();
  persist();
}

function undoX01() {
  clearTimeout(autoConfirmTimer);
  if (G.currentThrows.length) {
    G.currentThrows.pop();
  } else if (G.history.length) {
    const last = G.history.pop();
    const p = G.players[last.player];
    p.score = last.prevScore;
    p.lockedIn = last.prevLocked;
    G.currentPlayer = last.player;
    G.currentThrows = last.throws.slice(0, -1);
  } else return false;
  updateX01UI();
  persist();
  return true;
}

function x01Stats(pi) {
  let pts = 0, darts = 0, high = 0, n100 = 0, n180 = 0, att = 0, hit = 0;
  for (const h of G.history) {
    if (h.player !== pi) continue;
    darts += h.throws.length;
    if (!h.bust) {
      pts += h.total;
      high = Math.max(high, h.total);
      if (h.total >= 100) n100++;
      if (h.total === 180) n180++;
    }
    let rem = h.prevScore;
    h.throws.forEach((t, i) => {
      if (rem === 50 || (rem >= 2 && rem <= 40 && rem % 2 === 0)) {
        att++;
        if (h.win && i === h.throws.length - 1) hit++;
      }
      rem -= h.counted[i];
    });
  }
  return { pts, darts, high, n100, n180, att, hit, avg:darts ? pts / darts * 3 : 0 };
}

function updateX01UI() {
  G.players.forEach((p, i) => {
    const active = i === G.currentPlayer;
    $(`psp-${i}`).classList.toggle('active-player', active);
    const num = $(`psn-${i}`);
    num.textContent = p.score;
    num.style.color = active ? p.color : 'var(--text)';
    $(`pdl-${i}`).style.display = active ? 'flex' : 'none';
    if (!active) {
      const s = x01Stats(i);
      $(`pts-${i}`).textContent = s.darts ? `Ø ${s.avg.toFixed(1)}` : '';
      [0, 1, 2].forEach(d => $(`dd-${i}-${d}`).classList.remove('thrown'));
    }
  });
  $('turn-player-name').textContent = curPlayer().name;
  renderTurn();
}

// ========== CRICKET ==========
function crWon(pi) {
  const c = G.cr;
  if (!c.marks[pi].every(m => m >= 3)) return false;
  return G.players.every((_, o) => o === pi || c.scores[o] <= c.scores[pi]);
}

function crHit(ni) {
  const c = G.cr;
  if (G.over || c.left <= 0) return;
  pushSnap(c);
  if (ni >= 0) {
    const pi = c.cur;
    const m = Math.min(G.multiplier, ni === 6 ? 2 : 3);
    const own = c.marks[pi][ni];
    const closing = Math.min(m, Math.max(0, 3 - own));
    const extra = m - closing;
    c.marks[pi][ni] = own + closing;
    if (extra > 0 && G.players.some((_, o) => o !== pi && c.marks[o][ni] < 3)) c.scores[pi] += extra * CR_VALS[ni];
  }
  c.left--; c.darts++;
  Snd.tap(); haptic(8);
  setMult(1);
  refreshCricket();
  if (ni >= 0 && crWon(c.cur)) { finishGame(c.cur); return; }
  scheduleAdvance(c, refreshCricket);
  persist();
}

function crEndTurn() {
  const c = G.cr;
  if (G.over || c.left <= 0) return;
  pushSnap(c);
  c.left = 0;
  scheduleAdvance(c, refreshCricket, 0);
}

function undoCricket() {
  clearTimeout(advTimer);
  if (!popSnap(G.cr)) return false;
  refreshCricket();
  persist();
  return true;
}

function renderMarks(count) {
  if (count === 0) return `<span class="cricket-mark empty">·</span>`;
  if (count === 1) return `<span class="cricket-mark scored">/</span>`;
  if (count === 2) return `<span class="cricket-mark scored">X</span>`;
  return `<span class="cricket-mark closed">⊕</span>`;
}

function refreshCricket() {
  const c = G.cr;
  const board = $('cricket-scoreboard');
  board.style.gridTemplateRows = `repeat(7,1fr)`;
  board.innerHTML = CR_LABELS.map((num, ni) => `
    <div class="cricket-row">
      <div class="cricket-num-cell ${ni === 6 ? 'bullseye-row' : ''}">${num}</div>
      ${G.players.map((_, pi) => `
        <div class="cricket-player-cell ${pi === c.cur ? 'active-col' : ''}" data-fast data-act="cr-cell" data-arg="${pi},${ni}">
          <div class="cricket-marks">${renderMarks(c.marks[pi][ni])}</div>
        </div>`).join('')}
    </div>`).join('');
  $('cricket-score-row').innerHTML = `
    <div class="cricket-score-cell"><span class="cricket-score-label">PTS</span></div>
    ${G.players.map((p, i) => `
      <div class="cricket-score-cell">
        <div class="cricket-score-label">${esc(p.name)}</div>
        <div class="cricket-score-val" style="color:${p.color}">${c.scores[i]}</div>
      </div>`).join('')}`;
  G.players.forEach((p, i) => {
    const active = i === c.cur;
    $(`crpsp-${i}`).classList.toggle('active-player', active);
    const num = $(`crpsn-${i}`);
    num.textContent = c.scores[i];
    num.style.color = active ? p.color : 'var(--text)';
    [0, 1, 2].forEach(d => $(`crd-${i}-${d}`).classList.toggle('thrown', active && d < 3 - c.left));
  });
}

// ========== AROUND THE CLOCK ==========
const atcLabel = pos => pos >= 21 ? 'BULL' : String(pos);

function atcHit(k) {
  const a = G.atc;
  if (G.over || a.left <= 0) return;
  pushSnap(a);
  if (k > 0) {
    const p = a.pos[a.cur];
    a.pos[a.cur] = p >= 21 ? 22 : Math.min(21, p + k);
  }
  a.left--; a.darts++;
  Snd.tap(); haptic(8);
  refreshAtc();
  if (a.pos[a.cur] >= 22) { finishGame(a.cur); return; }
  scheduleAdvance(a, refreshAtc);
  persist();
}

function atcEndTurn() {
  const a = G.atc;
  if (G.over || a.left <= 0) return;
  pushSnap(a);
  a.left = 0;
  scheduleAdvance(a, refreshAtc, 0);
}

function undoAtc() {
  clearTimeout(advTimer);
  if (!popSnap(G.atc)) return false;
  refreshAtc();
  persist();
  return true;
}

function refreshAtc() {
  const a = G.atc;
  G.players.forEach((p, i) => {
    const active = i === a.cur;
    $(`atcp-${i}`).classList.toggle('active-player', active);
    const num = $(`atcn-${i}`);
    num.textContent = a.pos[i] >= 22 ? '✓' : atcLabel(a.pos[i]);
    num.style.color = active ? p.color : 'var(--text)';
    $(`atcs-${i}`).textContent = `${Math.min(a.pos[i] - 1, 21)}/21`;
    [0, 1, 2].forEach(d => $(`atcd-${i}-${d}`).classList.toggle('thrown', active && d < 3 - a.left));
  });
  const pos = a.pos[a.cur];
  $('atc-player-name').textContent = G.players[a.cur].name;
  $('atc-dart-num').textContent = `PIL ${Math.min(4 - a.left, 3)} AV 3`;
  $('atc-target-val').textContent = atcLabel(pos);
  $('atc-target-val').style.color = G.players[a.cur].color;
  $('atc-progress-bar').style.width = `${Math.min(pos - 1, 21) / 21 * 100}%`;
}

// ========== KILLER ==========
const hearts = (l, max) => '♥'.repeat(l) + '<span style="opacity:.25">' + '♥'.repeat(max - l) + '</span>';

function klHit(target) {
  const k = G.kl;
  if (G.over || k.left <= 0) return;
  pushSnap(k);
  const m = G.multiplier;
  let ev = '';
  if (target >= 0 && m >= 2) {
    if (target === k.cur) {
      if (!k.killer[k.cur]) { k.killer[k.cur] = true; ev = 'killer'; }
    } else if (k.killer[k.cur] && !k.out[target]) {
      k.lives[target] = Math.max(0, k.lives[target] - (m === 3 ? 2 : 1));
      if (k.lives[target] === 0) { k.out[target] = true; ev = 'out'; }
      else ev = 'hit';
    }
  }
  k.left--; k.darts++;
  setMult(1);
  haptic(8);
  if (ev === 'killer') { Snd.kill(); haptic(40); say('killer', G.players[k.cur].name); }
  else if (ev === 'out') { Snd.bust(); haptic(60); say('out', G.players[target].name); }
  else if (ev === 'hit') { Snd.hit(); haptic(30); }
  else Snd.tap();
  refreshKiller();
  const alive = k.out.map((o, i) => o ? -1 : i).filter(i => i >= 0);
  if (alive.length === 1) { finishGame(alive[0]); return; }
  scheduleAdvance(k, refreshKiller);
  persist();
}

function klEndTurn() {
  const k = G.kl;
  if (G.over || k.left <= 0) return;
  pushSnap(k);
  k.left = 0;
  scheduleAdvance(k, refreshKiller, 0);
}

function undoKiller() {
  clearTimeout(advTimer);
  if (!popSnap(G.kl)) return false;
  refreshKiller();
  persist();
  return true;
}

function refreshKiller() {
  const k = G.kl;
  G.players.forEach((p, i) => {
    const active = i === k.cur;
    const panel = $(`klp-${i}`);
    panel.classList.toggle('active-player', active);
    panel.classList.toggle('out', k.out[i]);
    $(`kln-${i}`).style.color = active ? p.color : 'var(--text)';
    $(`kls-${i}`).innerHTML = k.out[i] ? 'UTE' : `<span class="hearts">${hearts(k.lives[i], k.maxLives)}</span>`;
    [0, 1, 2].forEach(d => $(`kld-${i}-${d}`).classList.toggle('thrown', active && d < 3 - k.left));
    const btn = $(`klb-${i}`);
    btn.classList.toggle('out', k.out[i]);
    btn.innerHTML = `<span style="color:${p.color}">${k.nums[i]}</span><span class="act-sub">${esc(p.name)} ${k.killer[i] ? '<span class="badge-killer">💀</span>' : ''}</span>`;
  });
  $('kl-player-name').textContent = G.players[k.cur].name;
  $('kl-status').textContent = k.killer[k.cur] ? '💀 Killer – ta liv fra de andre' : `Treff dobbel ${k.nums[k.cur]} for å bli Killer`;
  $('kl-dart-num').textContent = `PIL ${Math.min(4 - k.left, 3)} AV 3`;
}

// ========== UNDO / VINNER ==========
function undoGame() {
  if (G.over) return false;
  let done = false;
  if (G.type === 'x01') done = undoX01();
  else if (G.type === 'cricket') done = undoCricket();
  else if (G.type === 'around') done = undoAtc();
  else if (G.type === 'killer') done = undoKiller();
  if (done) { toast('↩ Angret siste pil'); haptic(10); }
  return done;
}

function totalDarts() {
  if (G.type === 'x01') return G.history.reduce((s, h) => s + h.throws.length, 0);
  return (G.cr || G.atc || G.kl).darts;
}

function finishGame(wi) {
  G.over = true;
  G.winner = wi;
  G.currentThrows = [];
  G.statsId = recordGame(wi);
  clearTimeout(advTimer);
  clearTimeout(autoConfirmTimer);
  persist();
  Snd.win(); haptic([60, 40, 60]);
  say('win', G.players[wi].name);
  if (G.type === 'x01') updateX01UI();
  setTimeout(() => { if (G.over) showWinner(); }, 600);
}

function showWinner() {
  const w = G.players[G.winner];
  $('winner-name').textContent = w.name;
  $('winner-name').style.color = '';
  $('winner-game-name').textContent = G.type === 'x01' ? String(G.x01Start) : GAME_NAMES[G.type];

  const elapsed = Math.round((Date.now() - G.startTime) / 1000);
  let html = `
    <div class="winner-stat"><span class="winner-stat-label">Spilletid</span><span class="winner-stat-val">${Math.floor(elapsed / 60)}m ${elapsed % 60}s</span></div>
    <div class="winner-stat"><span class="winner-stat-label">Piler kastet</span><span class="winner-stat-val">${totalDarts()}</span></div>
    <div class="winner-stat"><span class="winner-stat-label">Spillere</span><span class="winner-stat-val">${G.players.length}</span></div>`;
  if (G.type === 'x01') {
    html += `<table class="stat-table"><thead><tr><th></th><th>Snitt</th><th>Høyest</th><th>100+</th><th>180</th><th>Dbl%</th></tr></thead><tbody>` +
      G.players.map((p, i) => {
        const s = x01Stats(i);
        return `<tr><td style="color:${p.color}">${esc(p.name)}</td><td>${s.avg.toFixed(1)}</td><td>${s.high}</td><td>${s.n100}</td><td>${s.n180}</td><td>${s.att ? Math.round(s.hit / s.att * 100) + '%' : '–'}</td></tr>`;
      }).join('') + `</tbody></table>`;
  }
  $('winner-stats').innerHTML = html;
  showScreen('winner');
}

function undoWin() {
  if (!G.over) return;
  removeGame(G.statsId);
  G.over = false; G.winner = -1; G.statsId = null;
  if (G.type === 'x01') {
    // seiersrunden ligger sist i historikken
    undoX01();
  } else {
    const T = G.cr || G.atc || G.kl;
    popSnap(T);
  }
  showScreen(GAME_SCREENS[G.type]);
  refreshGame();
  persist();
  toast('↩ Angret siste pil');
}

function rematch() {
  const cfg = JSON.parse(JSON.stringify(G.cfg));
  cfg.players.push(cfg.players.shift()); // annen spiller starter
  beginGame(cfg);
}

function endGame() {
  clearTimeout(advTimer);
  clearTimeout(autoConfirmTimer);
  G = freshG();
  persist();
  showScreen('home');
}

// ========== STATISTIKK ==========
function recordGame(wi) {
  const rec = {
    id:Date.now(), type:G.type, label:G.type === 'x01' ? String(G.x01Start) : GAME_NAMES[G.type],
    dur:Math.round((Date.now() - G.startTime) / 1000), winner:G.players[wi].name,
    players:G.players.map((p, i) => Object.assign({ name:p.name, win:i === wi }, G.type === 'x01' ? x01Stats(i) : {}))
  };
  const games = store.get('games', []);
  games.push(rec);
  store.set('games', games.slice(-300));
  return rec.id;
}

function removeGame(id) {
  store.set('games', store.get('games', []).filter(g => g.id !== id));
}

function renderStats() {
  const games = store.get('games', []);
  const body = $('stats-body');
  if (!games.length) {
    body.innerHTML = `<div class="stats-note">Ingen spill ennå. Spill en runde, så dukker statistikken opp her.</div>`;
    return;
  }
  const by = {};
  for (const g of games) for (const p of g.players) {
    const k = p.name.trim().toLowerCase();
    const o = by[k] || (by[k] = { name:p.name, games:0, wins:0, pts:0, darts:0, high:0, n100:0, n180:0, att:0, hit:0 });
    o.games++;
    if (p.win) o.wins++;
    o.pts += p.pts || 0; o.darts += p.darts || 0; o.high = Math.max(o.high, p.high || 0);
    o.n100 += p.n100 || 0; o.n180 += p.n180 || 0; o.att += p.att || 0; o.hit += p.hit || 0;
  }
  const cell = (v, l) => `<div><div class="stat-cell-val">${v}</div><div class="stat-cell-label">${l}</div></div>`;
  const cards = Object.values(by).sort((a, b) => b.games - a.games || b.wins - a.wins).map(o => `
    <div class="stat-card">
      <div class="stat-card-name">${esc(o.name)}</div>
      <div class="stat-grid">
        ${cell(o.games, 'Spill')}${cell(o.wins, 'Seiere')}
        ${cell(Math.round(o.wins / o.games * 100) + '%', 'Seier%')}
        ${cell(o.darts ? (o.pts / o.darts * 3).toFixed(1) : '–', 'Snitt X01')}
        ${cell(o.high || '–', 'Høyeste')}${cell(o.n100, '100+')}${cell(o.n180, '180')}
        ${cell(o.att ? Math.round(o.hit / o.att * 100) + '%' : '–', 'Dbl%')}
      </div>
    </div>`).join('');
  const recent = games.slice(-10).reverse().map(g => {
    const d = new Date(g.id).toLocaleDateString('nb-NO', { day:'2-digit', month:'2-digit' });
    return `<div class="game-row"><span>${d} · ${esc(g.label)} · 🏆 ${esc(g.winner)}</span><span>${Math.floor(g.dur / 60)}m ${g.dur % 60}s</span></div>`;
  }).join('');
  body.innerHTML = `
    <div class="setup-label">Spillere</div>${cards}
    <div class="setup-label" style="margin-top:8px">Siste spill</div><div>${recent}</div>
    <button class="danger-btn" data-act="clear-stats">Nullstill statistikk</button>`;
}

// ========== INNSTILLINGER ==========
function renderSettings() {
  ['sound', 'voice', 'haptics', 'wake'].forEach(k => $('st-' + k).classList.toggle('on', settings[k]));
  document.querySelectorAll('#lang-options .score-opt').forEach(el => el.classList.toggle('selected', el.dataset.arg === settings.lang));
}

// ========== HANDLINGER ==========
const ACT = {
  'select-game': el => selectGame(el.dataset.arg),
  'home': () => showScreen('home'),
  'home-finish': () => endGame(),
  'quit': () => { if (confirm('Avslutte spillet?')) endGame(); },
  'score': el => { setup.x01Score = +el.dataset.arg; renderSetupOptions(); },
  'toggle': el => { setup[el.dataset.arg] = !setup[el.dataset.arg]; renderSetupOptions(); },
  'lives': el => { setup.lives = +el.dataset.arg; renderSetupOptions(); },
  'rand-nums': () => { randomNums(setupPlayers.length).forEach((n, i) => { setupPlayers[i].num = n; }); renderSetupPlayers(); },
  'add-player': () => {
    if (setupPlayers.length >= 8) { toast('Maks 8 spillere!'); return; }
    const num = setup.type === 'killer' ? (randomNums(1, setupPlayers.map(p => p.num))[0] || 1) : 0;
    setupPlayers.push({ name:`Spiller ${setupPlayers.length + 1}`, num });
    renderSetupPlayers();
  },
  'remove-player': el => { setupPlayers.splice(+el.dataset.arg, 1); renderSetupPlayers(); },
  'start': () => startGame(),
  'undo': () => undoGame(),
  'undo-win': () => undoWin(),
  'rematch': () => rematch(),
  'throw': el => throwDart(+el.dataset.arg),
  'mult': el => setMult(+el.dataset.arg),
  'confirm': () => confirmTurn(),
  'cr-hit': el => crHit(+el.dataset.arg),
  'cr-next': () => crEndTurn(),
  'cr-cell': el => { const [pi, ni] = el.dataset.arg.split(',').map(Number); if (pi === G.cr.cur) crHit(ni); },
  'atc-hit': el => atcHit(+el.dataset.arg),
  'atc-next': () => atcEndTurn(),
  'kl-hit': el => klHit(+el.dataset.arg),
  'kl-next': () => klEndTurn(),
  'open-stats': () => { renderStats(); showScreen('stats'); },
  'open-settings': () => { renderSettings(); showScreen('settings'); },
  'set-toggle': el => { const k = el.dataset.arg; settings[k] = !settings[k]; saveSettings(); renderSettings(); if (k === 'wake') updateWakeLock(); },
  'set-lang': el => { settings.lang = el.dataset.arg; saveSettings(); renderSettings(); say('score', 180, { pitch:1.25, rate:0.95 }); },
  'test-voice': () => { Snd.big(); say('score', 180, { pitch:1.25, rate:0.95 }); },
  'clear-stats': () => { if (confirm('Slette all statistikk?')) { store.del('games'); renderStats(); } }
};

// Spillknapper (data-fast) reagerer på pointerdown for å slippe ventetiden til click
document.addEventListener('pointerdown', e => {
  const el = e.target.closest('[data-fast]');
  if (!el || (e.pointerType === 'mouse' && e.button !== 0)) return;
  Snd.unlock();
  const fn = ACT[el.dataset.act];
  if (fn) fn(el);
});

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.hasAttribute('data-fast')) return;
  Snd.unlock();
  const fn = ACT[el.dataset.act];
  if (fn) fn(el);
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.classList.contains('player-input')) setupPlayers[+t.dataset.i].name = t.value;
  else if (t.id === 'custom-score') {
    const v = parseInt(t.value);
    if (v > 0) {
      setup.x01Score = v;
      document.querySelectorAll('#score-options .score-opt').forEach(el => el.classList.remove('selected'));
    }
  }
});

document.addEventListener('change', e => {
  if (e.target.classList.contains('num-select')) setupPlayers[+e.target.dataset.i].num = +e.target.value;
});

// ========== OPPSTART ==========
function buildStaticUI() {
  document.querySelectorAll('.multiplier-row').forEach(row => {
    row.innerHTML = ['ENKEL', 'DOBBEL', 'TRIPPEL'].map((l, i) =>
      `<div class="mult-btn${i === 0 ? ' selected-mult' : ''}" data-mult="${i + 1}" data-arg="${i + 1}" data-fast data-act="mult">${l}</div>`).join('');
  });

  let html = Array.from({ length:20 }, (_, i) => i + 1).map(n =>
    `<div class="num-btn" data-fast data-act="throw" data-arg="${n}">${n}</div>`).join('');
  html += `<div class="num-btn bull" data-fast data-act="throw" data-arg="25">25<div class="num-btn-sub">BULL</div></div>`;
  html += `<div class="num-btn bullseye" data-fast data-act="throw" data-arg="50">50<div class="num-btn-sub">BULL</div></div>`;
  html += `<div class="num-btn miss" data-fast data-act="throw" data-arg="0">MISS</div>`;
  html += `<div class="num-btn confirm-btn disabled" id="confirm-btn" data-fast data-act="confirm">✓<div class="num-btn-sub">NESTE</div></div>`;
  $('numpad').innerHTML = html;

  $('cricket-numpad').innerHTML = CR_LABELS.map((n, i) =>
    `<div class="cr-num-btn ${i === 6 ? 'cr-bull' : ''}" data-fast data-act="cr-hit" data-arg="${i}">${n}</div>`).join('') +
    `<div class="cr-num-btn cr-miss" data-fast data-act="cr-hit" data-arg="-1">MISS</div>` +
    `<div class="cr-num-btn cr-next" data-fast data-act="cr-next">✓ NESTE</div>`;
}

function restoreGame() {
  const s = store.get('game', null);
  if (!s || !s.G || !s.G.active) return false;
  G = s.G;
  G.turnEnded = false;
  buildGameUI();
  if (G.over) { showWinner(); return true; }
  showScreen(GAME_SCREENS[G.type]);
  refreshGame();
  const T = G.cr || G.atc || G.kl;
  if (T && T.left <= 0) advanceTurn(T, G.cr ? refreshCricket : G.atc ? refreshAtc : refreshKiller);
  toast('▶ Fortsatte pågående spill');
  return true;
}

buildStaticUI();
renderSettings();
restoreGame();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
