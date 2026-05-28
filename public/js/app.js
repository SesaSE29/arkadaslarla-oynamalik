// ============================================================
// ARKADAŞLARLA OYNAMALIK - Frontend
// Tüm ekranlar, Socket.IO iletişimi, oyun mantığı
// ============================================================

const socket = io();

// Genel durum
const state = {
  roomCode: null,
  you: null,        // { id, name }
  players: [],
  host: null,
  game: null,
  gameState: null,
  settings: null    // sunucudan gelen oyun ayarları
};

// ============================================================
// EKRAN GEÇİŞLERİ
// ============================================================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
  // Reaction barı: sadece oyun ekranlarında (home/lobby hariç)
  const reactionBar = document.getElementById('reaction-bar');
  if (reactionBar) {
    const inGame = id && id !== 'screen-home' && id !== 'screen-lobby';
    reactionBar.style.display = inGame ? 'flex' : 'none';
  }
}

// ============================================================
// AVATAR SİSTEMİ — hayvan emoji + renk (isim hash'inden)
// ============================================================
const AVATAR_ANIMALS = [
  '🦁','🐯','🐶','🐱','🦊','🐻','🐼','🐨','🐰','🐭','🐹','🐮','🐷','🐸',
  '🐵','🐔','🐧','🦅','🦉','🦇','🐺','🐗','🦒','🦓','🐘','🦏','🐪','🐊',
  '🐢','🐍','🦋','🐝','🦄','🐙','🦈','🐳','🐬','🦀','🦐','🦔'
];
const AVATAR_COLORS = [
  '#ff3e8a', '#00d4ff', '#ffd93d', '#6bcf7f', '#a86bff',
  '#ff9f4a', '#4ade80', '#f472b6', '#fb923c', '#60a5fa',
  '#facc15', '#34d399'
];

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function avatarFor(player) {
  // playerId varsa o, yoksa name'den hash; oturum boyu kalıcı
  const seed = (player.id || '') + '|' + (player.name || '?');
  const h = hashStr(seed);
  return {
    emoji: AVATAR_ANIMALS[h % AVATAR_ANIMALS.length],
    color: AVATAR_COLORS[(h >> 4) % AVATAR_COLORS.length]
  };
}

function avatarHTML(player, size = 'md') {
  const a = avatarFor(player);
  const pid = player.id || '';
  return `<span class="avatar avatar-${size}" data-player-id="${pid}" style="background:${a.color}">${a.emoji}</span>`;
}

// ============================================================
// TOAST BİLDİRİM
// ============================================================
let toastTimer = null;
function showToast(message, type = '') {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.className = 'toast show ' + type;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.className = 'toast ' + type;
  }, 2500);
}

// ============================================================
// GİRİŞ EKRANI
// ============================================================
const PREFS_KEY = 'aoynamalik_prefs';
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; }
}
function savePrefs(patch) {
  const p = loadPrefs();
  Object.assign(p, patch);
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch {}
}

// Rastgele TR isim üreteci
const RANDOM_ADJ = ['Cesur', 'Hızlı', 'Akıllı', 'Zarif', 'Şaşkın', 'Kurnaz', 'Mutlu', 'Asi', 'Sevimli', 'Vahşi', 'Çılgın', 'Süper', 'Mega', 'Mistik', 'Efsane', 'Gizli', 'Şanslı', 'Yaramaz', 'Kahraman', 'Bilge'];
const RANDOM_NOUN = ['Kaplan', 'Aslan', 'Kartal', 'Kurt', 'Tilki', 'Ayı', 'Panda', 'Yunus', 'Şahin', 'Penguen', 'Kelebek', 'Geyik', 'Vaşak', 'Baykuş', 'Ahtapot', 'Yılan', 'Köpekbalığı', 'Bukalemun', 'Maymun', 'Su Aygırı'];
function randomName() {
  return RANDOM_ADJ[Math.floor(Math.random() * RANDOM_ADJ.length)]
    + ' ' + RANDOM_NOUN[Math.floor(Math.random() * RANDOM_NOUN.length)];
}

// Sayfa açılışında son ismi inputlara koy
(function initSavedName() {
  const prefs = loadPrefs();
  if (prefs.name) {
    const c = document.getElementById('create-name');
    const j = document.getElementById('join-name');
    if (c) c.value = prefs.name;
    if (j) j.value = prefs.name;
  }
})();

// ============================================================
// SES MOTORU — Web Audio API ile sentetik ses (dosya yok)
// ============================================================
const SFX = (() => {
  let ctx = null;
  let masterGain = null;
  let muted = false;
  let userInteracted = false;

  function ensureCtx() {
    if (ctx) {
      // Suspended ise resume dene (sadece user gesture sonrası garantili)
      if (ctx.state === 'suspended' && userInteracted) {
        ctx.resume().catch(() => {});
      }
      return ctx;
    }
    if (!userInteracted) return null; // İlk kullanıcı etkileşimine kadar bekle
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.35;
      masterGain.connect(ctx.destination);
    } catch (e) { ctx = null; }
    return ctx;
  }

  // Kullanıcı ilk gesture'da context'i prime et
  function primeOnFirstInteraction() {
    if (userInteracted) return;
    userInteracted = true;
    ensureCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }
  // Geniş kapsamlı listener — herhangi bir etkileşimde tetiklenir
  ['click', 'touchstart', 'keydown'].forEach(ev => {
    document.addEventListener(ev, primeOnFirstInteraction, { once: false, capture: true });
  });

  function setMuted(m) {
    muted = m;
    savePrefs({ muted: m });
    if (masterGain) masterGain.gain.value = m ? 0 : 0.35;
  }

  // Tek bir ton (osc + envelope)
  function tone(freq, dur = 0.12, type = 'sine', vol = 0.5, attack = 0.005, decay = null) {
    if (muted) return;
    const c = ensureCtx();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const now = c.currentTime;
    const dec = decay ?? dur;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(vol, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dec);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(now);
    osc.stop(now + dec + 0.02);
  }

  // Frekans rampası (örn: süpürmeler, patlamalar)
  function sweep(fromF, toF, dur = 0.2, type = 'sawtooth', vol = 0.4) {
    if (muted) return;
    const c = ensureCtx();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    const now = c.currentTime;
    osc.frequency.setValueAtTime(fromF, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, toF), now + dur);
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  // Gürültü (patlama, sıçrama)
  function noise(dur = 0.2, vol = 0.5, filterFreq = null) {
    if (muted) return;
    const c = ensureCtx();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    const now = c.currentTime;
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(g);
    if (filterFreq) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filterFreq;
      g.connect(f);
      f.connect(masterGain);
    } else {
      g.connect(masterGain);
    }
    src.start(now);
    src.stop(now + dur);
  }

  // Akor / hızlı arpej
  function arpeggio(freqs, step = 0.06, type = 'square', vol = 0.4) {
    freqs.forEach((f, i) => setTimeout(() => tone(f, 0.12, type, vol), i * step * 1000));
  }

  // -------- Yüksek seviye efektler --------
  return {
    setMuted, isMuted: () => muted,
    // UI
    click:    () => tone(900, 0.05, 'square', 0.2),
    hover:    () => tone(1200, 0.03, 'sine', 0.15),
    success:  () => arpeggio([523, 659, 784], 0.07, 'triangle', 0.4),
    error:    () => sweep(440, 110, 0.22, 'sawtooth', 0.35),
    notify:   () => arpeggio([880, 1320], 0.08, 'sine', 0.35),
    win:      () => arpeggio([523, 659, 784, 1047, 1319], 0.09, 'triangle', 0.45),
    lose:     () => arpeggio([392, 311, 247, 196], 0.12, 'sawtooth', 0.35),

    // Kelime Zinciri
    kelimeOk:   () => tone(700, 0.1, 'triangle', 0.35),
    kelimeErr:  () => sweep(330, 110, 0.18, 'sawtooth', 0.3),
    kelimePass: () => tone(450, 0.15, 'sine', 0.3),
    kelimeLife: () => sweep(220, 80, 0.3, 'square', 0.4),
    kelimeChange: () => arpeggio([440, 660], 0.08, 'square', 0.3),

    // Hafıza
    cardFlip:  () => tone(800, 0.06, 'triangle', 0.25),
    match:     () => arpeggio([523, 784, 1047], 0.06, 'sine', 0.4),
    noMatch:   () => tone(220, 0.15, 'sawtooth', 0.25),

    // Çizim
    cizimCorrect: () => arpeggio([659, 784, 988], 0.08, 'triangle', 0.4),
    cizimHint:    () => tone(550, 0.18, 'sine', 0.3),
    cizimReveal:  () => arpeggio([523, 392], 0.15, 'sine', 0.35),

    // Trivia
    triviaCorrect: () => arpeggio([659, 880, 1175], 0.07, 'triangle', 0.45),
    triviaWrong:   () => sweep(330, 130, 0.3, 'sawtooth', 0.4),
    triviaTick:    () => tone(1100, 0.04, 'square', 0.2),
    triviaFifty:   () => arpeggio([440, 880], 0.08, 'square', 0.35),

    // Vampir
    vampirNight:  () => sweep(330, 165, 0.6, 'sine', 0.4),
    vampirDay:    () => arpeggio([523, 659, 784], 0.1, 'triangle', 0.4),
    vampirDeath:  () => { sweep(220, 60, 0.5, 'sawtooth', 0.4); setTimeout(() => noise(0.3, 0.25, 800), 100); },
    vampirVote:   () => tone(660, 0.08, 'square', 0.3),

    // Yılan
    yilanEat:        () => tone(880, 0.06, 'triangle', 0.3),
    yilanEatMed:     () => arpeggio([880, 1100], 0.05, 'triangle', 0.35),
    yilanEatLarge:   () => arpeggio([880, 1100, 1320], 0.05, 'triangle', 0.4),
    yilanBoostStart: () => sweep(440, 880, 0.15, 'sawtooth', 0.25),
    yilanDeath:      () => { sweep(440, 80, 0.4, 'sawtooth', 0.4); setTimeout(() => noise(0.25, 0.3, 600), 80); },

    // Amiral Battı
    amiralShoot: () => sweep(880, 220, 0.18, 'sawtooth', 0.35),
    amiralHit:   () => { noise(0.35, 0.55, 600); setTimeout(() => sweep(220, 60, 0.3, 'square', 0.45), 50); },
    amiralMiss:  () => { sweep(660, 220, 0.15, 'sine', 0.25); setTimeout(() => noise(0.18, 0.25, 2000), 80); },
    amiralSunk:  () => { noise(0.6, 0.7, 400); setTimeout(() => sweep(180, 50, 0.5, 'sawtooth', 0.5), 100); setTimeout(() => arpeggio([196, 165, 131], 0.1, 'sawtooth', 0.35), 350); },
    amiralPlace: () => tone(600, 0.06, 'square', 0.25),

    // Uno
    unoPlay:   () => tone(750, 0.07, 'square', 0.3),
    unoDraw:   () => sweep(550, 330, 0.15, 'triangle', 0.3),
    unoPlus2:  () => arpeggio([440, 330, 220], 0.07, 'sawtooth', 0.4),
    unoPlus4:  () => arpeggio([440, 330, 220, 110], 0.07, 'sawtooth', 0.45),
    unoSkip:   () => sweep(880, 220, 0.2, 'square', 0.3),
    unoReverse:() => { tone(660, 0.1, 'triangle', 0.3); setTimeout(() => tone(440, 0.1, 'triangle', 0.3), 100); },
    unoCall:   () => arpeggio([880, 988, 1175, 1319], 0.07, 'square', 0.5),
    unoCatch:  () => sweep(660, 165, 0.25, 'sawtooth', 0.4)
  };
})();

// ============================================================
// TEKRAR OYNA — tüm game-over ekranlarında ortak
// ============================================================
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-replay]');
  if (!btn) return;
  if (state.you?.id !== state.host) {
    showToast('Sadece host tekrar başlatabilir!', 'error');
    return;
  }
  SFX.click();
  socket.emit('game:replay');
});

// Host-only butonların görünürlüğü — room:update'te güncellenecek
function updateHostOnlyVisibility() {
  const isHost = state.you?.id === state.host;
  document.querySelectorAll('.host-only').forEach(el => {
    el.style.display = isHost ? '' : 'none';
  });
}

// ============================================================
// YARDIM/SSS + KLAVYE KISAYOLLARI MODALI
// ============================================================
const helpModal = document.getElementById('help-modal');

function openHelp(tab = 'rules') {
  if (!helpModal) return;
  helpModal.style.display = 'flex';
  document.querySelectorAll('.help-tab').forEach(t => t.classList.toggle('active', t.dataset.htab === tab));
  document.querySelectorAll('.help-pane').forEach(p => p.classList.toggle('active', p.dataset.hpane === tab));
}
function closeHelp() {
  if (helpModal) helpModal.style.display = 'none';
}

document.getElementById('help-toggle')?.addEventListener('click', () => openHelp('rules'));
document.getElementById('help-close')?.addEventListener('click', closeHelp);
helpModal?.addEventListener('click', (e) => {
  if (e.target === helpModal) closeHelp();
});

document.querySelectorAll('.help-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const t = tab.dataset.htab;
    document.querySelectorAll('.help-tab').forEach(x => x.classList.toggle('active', x === tab));
    document.querySelectorAll('.help-pane').forEach(p => p.classList.toggle('active', p.dataset.hpane === t));
  });
});

// Klavye kısayolları: ? / F1 → yardım, Esc → kapat, Trivia 1-4
document.addEventListener('keydown', (e) => {
  // Input içindeysek genel kısayolları çalıştırma
  const tag = e.target.tagName;
  const isInput = (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable);

  if (!isInput && (e.key === '?' || e.key === 'F1')) {
    e.preventDefault();
    if (helpModal.style.display === 'none' || !helpModal.style.display) openHelp('rules');
    else closeHelp();
  }
  if (e.key === 'Escape') {
    // Açık modalları sırayla kapat
    const openModals = [
      ['help-modal', closeHelp],
      ['qr-modal', () => { document.getElementById('qr-modal').style.display = 'none'; }],
      ['password-modal', () => { document.getElementById('password-modal').style.display = 'none'; pendingJoin = null; }],
      ['settings-modal', () => closeSettings()],
      ['theme-picker', () => { document.getElementById('theme-picker').style.display = 'none'; }]
    ];
    for (const [id, fn] of openModals) {
      const el = document.getElementById(id);
      if (el && el.style.display && el.style.display !== 'none') {
        fn();
        return;
      }
    }
  }

  // Trivia 1-4 kısayolları
  if (!isInput && state.game === 'trivia' && state.gameState?.phase === 'question') {
    const n = parseInt(e.key);
    if (n >= 1 && n <= 4) {
      const optBtn = document.querySelectorAll('#trivia-options .trivia-option')[n - 1];
      if (optBtn && !optBtn.disabled) optBtn.click();
    }
  }
});

// ============================================================
// HIZLI TEPKİ EMOJİLERİ
// ============================================================
document.querySelectorAll('.reaction-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const emoji = btn.dataset.emoji;
    if (!emoji) return;
    SFX.click();
    socket.emit('room:reaction', { emoji });
    btn.classList.remove('pulse');
    void btn.offsetWidth;
    btn.classList.add('pulse');
  });
});

// Reaction'ı oyuncunun avatarı üzerinde göster
function spawnReaction(playerId, emoji) {
  // İlgili oyuncunun avatarını bul (ilk eşleşen, en yakın görünür)
  const candidates = document.querySelectorAll(`[data-player-id="${playerId}"]`);
  let target = null;
  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0) {
      target = el; break;
    }
  }
  const layer = document.getElementById('reaction-layer');
  if (!layer) return;
  const floater = document.createElement('div');
  floater.className = 'reaction-floater';
  floater.textContent = emoji;
  if (target) {
    const rect = target.getBoundingClientRect();
    floater.style.left = (rect.left + rect.width / 2) + 'px';
    floater.style.top = (rect.top - 4) + 'px';
  } else {
    // Avatar görünmüyorsa ekran ortasından yukarı
    floater.style.left = '50%';
    floater.style.top = (window.innerHeight - 200) + 'px';
    floater.style.transform = 'translateX(-50%)';
  }
  layer.appendChild(floater);
  setTimeout(() => floater.remove(), 2200);
}

socket.on('room:reaction', ({ playerId, emoji }) => {
  spawnReaction(playerId, emoji);
});

// ============================================================
// 3-2-1 GERİ SAYIM
// ============================================================
function showCountdown(onDone) {
  const overlay = document.getElementById('countdown-overlay');
  const num = document.getElementById('countdown-number');
  if (!overlay || !num) { onDone?.(); return; }
  overlay.style.display = 'flex';
  let n = 3;
  const tick = () => {
    if (n === 0) {
      num.textContent = 'BAŞLA!';
      num.style.fontSize = 'clamp(4rem, 12vw, 8rem)';
      SFX.success();
      setTimeout(() => {
        overlay.style.display = 'none';
        num.style.fontSize = '';
        onDone?.();
      }, 800);
      return;
    }
    num.textContent = n;
    num.style.fontSize = '';
    // re-trigger animation
    num.style.animation = 'none';
    void num.offsetWidth;
    num.style.animation = '';
    SFX.triviaTick();
    n--;
    setTimeout(tick, 1000);
  };
  tick();
}

// ============================================================
// KONFETİ (kazanma kutlaması)
// ============================================================
const Confetti = (() => {
  const canvas = document.getElementById('confetti-canvas');
  const ctx = canvas?.getContext('2d');
  let particles = [];
  let animId = null;
  function getColors() {
    // Tema değişkenlerinden oku — tema değiştiğinde otomatik adapte
    const css = getComputedStyle(document.documentElement);
    const v = (name, fallback) => (css.getPropertyValue(name).trim() || fallback);
    return [
      v('--color-primary', '#ff3e8a'),
      v('--color-secondary', '#00d4ff'),
      v('--color-accent-1', '#ffd93d'),
      v('--color-accent-2', '#6bcf7f'),
      v('--color-accent-3', '#a86bff'),
      v('--color-danger', '#ff5757'),
      v('--color-success', '#4ade80')
    ];
  }

  function resize() {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);

  function spawn(count = 120, fromTop = true) {
    if (!canvas) return;
    resize();
    const themeColors = getColors();
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: fromTop ? -20 - Math.random() * 100 : canvas.height / 2,
        vx: (Math.random() - 0.5) * 6,
        vy: fromTop ? Math.random() * 3 + 2 : (Math.random() - 0.5) * 12 - 4,
        gravity: 0.18 + Math.random() * 0.08,
        size: Math.random() * 8 + 4,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.3,
        color: themeColors[Math.floor(Math.random() * themeColors.length)],
        shape: Math.random() < 0.5 ? 'rect' : 'circle',
        opacity: 1
      });
    }
  }

  function step() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += p.gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.opacity -= 0.003;
      if (p.y > canvas.height + 50 || p.opacity <= 0) {
        particles.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.opacity);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') {
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    if (particles.length > 0) {
      animId = requestAnimationFrame(step);
      canvas.classList.add('active');
    } else {
      animId = null;
      canvas.classList.remove('active');
    }
  }

  function celebrate(intensity = 'normal') {
    if (!canvas) return;
    const count = intensity === 'big' ? 250 : 120;
    spawn(count, true);
    // Yan patlamalar
    if (intensity === 'big') {
      setTimeout(() => spawn(80, false), 200);
      setTimeout(() => spawn(80, false), 600);
    }
    if (!animId) step();
  }
  return { celebrate };
})();

// ============================================================
// SEKME BAŞLIK FLAŞI + SIRA-BİLDİRİM
// ============================================================
const ORIG_TITLE = document.title;
let titleFlashTimer = null;
let titleFlashOn = false;

function startTitleFlash(message = '⚡ Sıra sende!') {
  if (titleFlashTimer) return;
  titleFlashTimer = setInterval(() => {
    titleFlashOn = !titleFlashOn;
    document.title = titleFlashOn ? message : ORIG_TITLE;
  }, 900);
}
function stopTitleFlash() {
  if (titleFlashTimer) { clearInterval(titleFlashTimer); titleFlashTimer = null; }
  document.title = ORIG_TITLE;
  titleFlashOn = false;
}
// Kullanıcı sekmeye geri dönünce flaşı kapat
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) stopTitleFlash();
});

// Oyun bitti — konfeti + ses (oyun başına bir kez)
let _lastGameOverKey = null;
function checkGameOverCelebration(data) {
  if (!data || !data.gameState || !data.gameState.gameOver) {
    return;
  }
  // Aynı oyun bitişini tekrar tetikleme
  const key = `${data.code}-${data.game}-${data.gameState.winner || 'x'}`;
  if (key === _lastGameOverKey) return;
  _lastGameOverKey = key;

  // Kazanan kendi adımsa daha yoğun konfeti + büyük kazanma sesi
  const myName = state.you ? data.players.find(p => p.id === state.you.id)?.name : null;
  const won = data.gameState.winner === myName;
  // Yılan/Vampir takım kazanması farklı: skor karşılaştır
  let confettiLevel = 'normal';
  let winSound = SFX.win;
  if (won) {
    confettiLevel = 'big';
  } else {
    // Vampir köyleri/vampirler/jester kontrolü
    if (data.game === 'vampir' && data.gameState.winner === 'koyluler') {
      const meInRoom = data.players.find(p => p.id === state.you?.id);
      if (meInRoom?.role && meInRoom.role !== 'vampir' && meInRoom.role !== 'soytari') confettiLevel = 'big';
    } else if (data.game === 'vampir' && data.gameState.winner === 'vampirler') {
      const meInRoom = data.players.find(p => p.id === state.you?.id);
      if (meInRoom?.role === 'vampir') confettiLevel = 'big';
    } else if (data.game === 'vampir' && data.gameState.winner === 'soytari') {
      // soytarı kazandı: jester olansa büyük
      const meInRoom = data.players.find(p => p.id === state.you?.id);
      if (meInRoom?.role === 'soytari') confettiLevel = 'big';
    }
  }

  // Kaybedenler için hafif "lose" sesi
  setTimeout(() => {
    if (confettiLevel === 'big') {
      SFX.win();
      Confetti.celebrate('big');
    } else {
      // Herkes için yine de küçük konfeti (kazanan birisi var)
      Confetti.celebrate('normal');
      SFX.win();
    }
  }, 200);
}

// Sıra bana geldi mi? — room:update'te tespit
let _wasMyTurnLast = false;
function checkMyTurnNotification(data) {
  if (!data || !data.gameState || !state.you) return;
  const gs = data.gameState;
  let isMyTurn = false;

  if (gs.type === 'kelime-zinciri') {
    const cur = data.players[gs.currentPlayerIndex];
    isMyTurn = cur?.id === state.you.id && !gs.gameOver;
  } else if (gs.type === 'hafiza') {
    const cur = data.players[gs.currentPlayerIndex];
    isMyTurn = cur?.id === state.you.id && !gs.gameOver;
  } else if (gs.type === 'cizim') {
    const drawer = data.players[gs.drawerIndex];
    isMyTurn = drawer?.id === state.you.id && gs.phase === 'wordSelect';
  } else if (gs.type === 'amiral') {
    isMyTurn = gs.currentTurn === state.you.id && gs.phase === 'battle';
  } else if (gs.type === 'uno') {
    const cur = data.players[gs.currentPlayerIndex];
    isMyTurn = cur?.id === state.you.id && !gs.gameOver;
  }

  if (isMyTurn && !_wasMyTurnLast) {
    // Yeni sıra → ses + (sekme dışındaysa flash)
    if (document.hidden) {
      SFX.notify();
      startTitleFlash('⚡ Sıra sende!');
    }
  } else if (!isMyTurn) {
    if (titleFlashTimer) stopTitleFlash();
  }
  _wasMyTurnLast = isMyTurn;
}

// Mute durumunu yükle ve buton bağla
(function initMute() {
  const prefs = loadPrefs();
  const btn = document.getElementById('sound-toggle');
  function updateBtn() {
    if (!btn) return;
    btn.textContent = SFX.isMuted() ? '🔇' : '🔊';
    btn.title = SFX.isMuted() ? 'Sesi aç' : 'Sesi kapat';
  }
  if (prefs.muted) SFX.setMuted(true);
  updateBtn();
  if (btn) {
    btn.addEventListener('click', () => {
      SFX.setMuted(!SFX.isMuted());
      updateBtn();
      if (!SFX.isMuted()) SFX.click(); // test
    });
  }
})();

// ============================================================
// TEMA & TAM EKRAN
// ============================================================
function applyTheme(theme) {
  if (!['pembe', 'karanlik', 'pastel'].includes(theme)) theme = 'pembe';
  document.documentElement.setAttribute('data-theme', theme);
  savePrefs({ theme });
}
(function initTheme() {
  const prefs = loadPrefs();
  applyTheme(prefs.theme || 'pembe');
})();

const themeBtn = document.getElementById('theme-toggle');
const themePicker = document.getElementById('theme-picker');
if (themeBtn && themePicker) {
  themeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    themePicker.style.display = themePicker.style.display === 'none' ? 'flex' : 'none';
  });
  themePicker.querySelectorAll('.theme-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      applyTheme(opt.dataset.theme);
      themePicker.style.display = 'none';
    });
  });
  document.addEventListener('click', (e) => {
    if (!themePicker.contains(e.target) && e.target !== themeBtn) {
      themePicker.style.display = 'none';
    }
  });
}

// Tam ekran butonu (yalnızca destekleyen tarayıcılarda göster)
const fsBtn = document.getElementById('fullscreen-toggle');
if (fsBtn && document.documentElement.requestFullscreen) {
  fsBtn.style.display = '';
  fsBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });
  document.addEventListener('fullscreenchange', () => {
    fsBtn.textContent = document.fullscreenElement ? '⛶' : '⛶';
    fsBtn.title = document.fullscreenElement ? 'Tam ekrandan çık' : 'Tam ekran';
  });
}

document.getElementById('btn-create').addEventListener('click', () => {
  let name = document.getElementById('create-name').value.trim();
  if (!name) name = randomName();
  const password = document.getElementById('create-password').value;
  savePrefs({ name });
  socket.emit('room:create', { name, password });
});

// Pending join state — şifre gerekirse kullanılmak üzere
let pendingJoin = null;

function doJoin(name, code, password) {
  socket.emit('room:join', { code, name, password: password || '' });
}

document.getElementById('btn-join').addEventListener('click', () => {
  let name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!name) name = randomName();
  if (code.length !== 4) {
    showToast('Oda kodu 4 karakter olmalı!', 'error');
    return;
  }
  savePrefs({ name });
  pendingJoin = { name, code };
  doJoin(name, code, '');
});

// Sunucu şifre istediğinde modal aç
socket.on('room:passwordRequired', ({ code }) => {
  if (!pendingJoin) return;
  document.getElementById('password-error').textContent = '';
  document.getElementById('join-password').value = '';
  document.getElementById('password-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('join-password').focus(), 100);
});

function submitPassword() {
  const pw = document.getElementById('join-password').value;
  if (!pw) {
    document.getElementById('password-error').textContent = 'Şifre boş olamaz';
    return;
  }
  if (!pendingJoin) return;
  doJoin(pendingJoin.name, pendingJoin.code, pw);
}

document.getElementById('password-ok').addEventListener('click', submitPassword);
document.getElementById('join-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitPassword();
});
document.getElementById('password-cancel').addEventListener('click', () => {
  document.getElementById('password-modal').style.display = 'none';
  pendingJoin = null;
});

// (Birleşik room:error handler aşağıda — şifre yanlışsa modal'da, yoksa toast'ta gösterir)

// Enter ile gönder
document.getElementById('create-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-create').click();
});
document.getElementById('join-code').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-join').click();
});

// ============================================================
// LOBİ EKRANI
// ============================================================
// ============================================================
// LOBI SOHBETİ
// ============================================================
function renderLobbyChat() {
  const list = document.getElementById('lobby-chat-list');
  if (!list) return;
  const chat = state.lobbyChat || [];
  if (chat.length === 0) {
    list.innerHTML = '<p class="lobby-chat-empty">Henüz mesaj yok. İlk sen yaz!</p>';
    return;
  }
  list.innerHTML = chat.map(m => {
    const isMe = m.playerId === state.you?.id;
    return `
      <div class="lobby-chat-msg ${isMe ? 'is-me' : ''}">
        ${avatarHTML({ id: m.playerId, name: m.name }, 'sm')}
        <div class="msg-body">
          <span class="msg-name">${escapeHtml(m.name)}${isMe ? ' (sen)' : ''}</span>
          <span class="msg-text">${escapeHtml(m.text)}</span>
        </div>
      </div>
    `;
  }).join('');
  list.scrollTop = list.scrollHeight;
}

function sendLobbyChat() {
  const input = document.getElementById('lobby-chat-input');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('lobby:chat', { text });
  input.value = '';
}

document.getElementById('lobby-chat-send')?.addEventListener('click', sendLobbyChat);
document.getElementById('lobby-chat-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendLobbyChat();
});

document.getElementById('lobby-ready-btn')?.addEventListener('click', () => {
  socket.emit('room:toggleReady');
  SFX.click();
});

document.getElementById('btn-leave').addEventListener('click', () => {
  if (confirm('Odadan ayrılmak istediğine emin misin?')) {
    socket.emit('room:leave');
    location.reload();
  }
});

document.getElementById('btn-copy-code').addEventListener('click', () => {
  if (!state.roomCode) return;
  navigator.clipboard.writeText(state.roomCode).then(() => {
    showToast('Oda kodu kopyalandı! ' + state.roomCode, 'success');
  }).catch(() => {
    showToast('Kopyalanamadı, manuel paylaş: ' + state.roomCode);
  });
});

// Davet linki — paylaşılabilir URL üret
function buildInviteUrl(code) {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('room', code);
  return url.toString();
}

document.getElementById('btn-copy-link').addEventListener('click', () => {
  if (!state.roomCode) return;
  const url = buildInviteUrl(state.roomCode);
  navigator.clipboard.writeText(url).then(() => {
    showToast('🔗 Davet linki kopyalandı!', 'success');
  }).catch(() => {
    showToast('Kopyalanamadı: ' + url);
  });
});

// QR modali
document.getElementById('btn-show-qr').addEventListener('click', () => {
  if (!state.roomCode) return;
  const url = buildInviteUrl(state.roomCode);
  const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=' + encodeURIComponent(url);
  document.getElementById('qr-image').src = qrUrl;
  document.getElementById('qr-url').textContent = url;
  document.getElementById('qr-modal').style.display = 'flex';
});
document.getElementById('qr-close').addEventListener('click', () => {
  document.getElementById('qr-modal').style.display = 'none';
});
document.getElementById('qr-copy-link').addEventListener('click', () => {
  document.getElementById('btn-copy-link').click();
});
document.getElementById('qr-modal').addEventListener('click', (e) => {
  if (e.target.id === 'qr-modal') {
    document.getElementById('qr-modal').style.display = 'none';
  }
});

// URL'den oda kodu varsa form'a yaz (otomatik katılma yok, isim girilmesi şart)
(function checkInviteUrl() {
  const params = new URLSearchParams(window.location.search);
  const inviteCode = params.get('room');
  if (inviteCode && /^[A-Z0-9]{4}$/i.test(inviteCode)) {
    const codeInput = document.getElementById('join-code');
    if (codeInput) codeInput.value = inviteCode.toUpperCase();
    showToast('🔗 Davet linkiyle geldin! İsmini gir ve "Katıl"a bas.', '');
    // Scroll to join section
    setTimeout(() => {
      document.getElementById('join-name')?.focus();
    }, 300);
  }
})();

// ============================================================
// AYARLAR MODALI
// ============================================================
const settingsModal = document.getElementById('settings-modal');
let isSettingsBuilding = false; // sunucudan gelirken event tetiklenmesini engelle
let pendingGameType = null;     // ayarlar modal'ı bir oyun için açıldıysa hangisi

// Oyun bilgileri — kart tipinden ayar paneline / başlık bilgisine map
const GAME_INFO = {
  'kelime-zinciri': { tab: 'kelime', icon: '🔤', name: 'Kelime Zinciri' },
  'hafiza':         { tab: 'hafiza', icon: '🧠', name: 'Hafıza Oyunu' },
  'cizim':          { tab: 'cizim',  icon: '🎨', name: 'Çizim-Tahmin' },
  'trivia':         { tab: 'trivia', icon: '🎯', name: 'Trivia' },
  'vampir':         { tab: 'vampir', icon: '🧛', name: 'Vampir Köylü' },
  'yilan':          { tab: 'yilan',  icon: '🐍', name: 'Yılan Savaşı' },
  'amiral':         { tab: null,     icon: '⚓', name: 'Amiral Battı' }, // ayar yok
  'uno':            { tab: 'uno',    icon: '🃏', name: 'Uno Benzeri' }
};

function closeSettings() {
  settingsModal.style.display = 'none';
  pendingGameType = null;
}

function renderReadyPanel() {
  const row = document.getElementById('ready-row');
  if (!row) return;
  const isHost = state.you?.id === state.host;
  const total = state.players.length;
  const readyCount = state.players.filter(p => p.ready || p.id === state.host).length;

  row.innerHTML = `
    <div class="ready-list">
      ${state.players.map(p => {
        const isMe = p.id === state.you?.id;
        const ready = p.ready || p.id === state.host; // host her zaman hazır sayılır
        return `
          <span class="ready-chip ${ready ? 'is-ready' : ''} ${isMe ? 'is-me' : ''}">
            ${avatarHTML(p, 'sm')}
            <span>${escapeHtml(p.name)}${p.id === state.host ? ' 👑' : ''}</span>
            ${ready ? '<span class="ready-tick">✓</span>' : ''}
          </span>
        `;
      }).join('')}
    </div>
    <p class="ready-stat">${readyCount}/${total} hazır</p>
  `;

  // Hazırım butonu (sadece non-host)
  const readyBtn = document.getElementById('settings-ready-btn');
  const me = state.players.find(p => p.id === state.you?.id);
  if (readyBtn) {
    if (isHost) {
      readyBtn.style.display = 'none';
    } else {
      readyBtn.style.display = '';
      readyBtn.textContent = me?.ready ? '✓ Hazırım' : '✋ Hazırım';
      readyBtn.classList.toggle('btn-ready-on', !!me?.ready);
    }
  }

  // Başlat butonunda hazır sayısı
  const startBtn = document.getElementById('settings-start');
  if (startBtn) {
    const allReady = readyCount === total;
    startBtn.textContent = allReady ? '▶ Başlat' : `▶ Başlat (${readyCount}/${total} hazır)`;
    startBtn.style.opacity = allReady ? '1' : '0.85';
  }
}

function openSettingsForGame(gameType) {
  const info = GAME_INFO[gameType];
  if (!info) return;
  pendingGameType = gameType;

  // Başlık
  document.getElementById('settings-title').textContent = `${info.icon} ${info.name} — Ayarlar`;

  // Tab bar gizli (tek oyuna odakla)
  document.getElementById('settings-tabs').style.display = 'none';

  // Doğru paneli aktif et
  document.querySelectorAll('.settings-pane').forEach(p => p.classList.remove('active'));
  const emptyEl = document.getElementById('settings-empty');
  if (info.tab) {
    const pane = document.querySelector(`.settings-pane[data-pane="${info.tab}"]`);
    if (pane) pane.classList.add('active');
    if (emptyEl) emptyEl.style.display = 'none';
    document.getElementById('settings-hint').textContent = 'Ayarları düzenle, sonra "Başlat"a bas.';
  } else {
    if (emptyEl) emptyEl.style.display = 'block';
    document.getElementById('settings-hint').textContent = 'Hazırsan başlat!';
  }

  settingsModal.style.display = 'flex';
  applySettingsToUI();
  renderReadyPanel();
}

document.getElementById('settings-close').addEventListener('click', closeSettings);
document.getElementById('settings-cancel').addEventListener('click', closeSettings);

// Hazırım butonu
document.getElementById('settings-ready-btn').addEventListener('click', () => {
  socket.emit('room:toggleReady');
  SFX.click();
});

document.getElementById('settings-start').addEventListener('click', () => {
  if (!pendingGameType) return;
  if (state.you?.id !== state.host) {
    showToast('Sadece oda kurucusu oyun başlatabilir!', 'error');
    return;
  }
  if (state.players.length < 2) {
    showToast('En az 2 oyuncu lazım!', 'error');
    return;
  }
  // Hepsi hazır mı? Değilse onay iste
  const total = state.players.length;
  const readyCount = state.players.filter(p => p.ready || p.id === state.host).length;
  if (readyCount < total) {
    if (!confirm(`${total - readyCount} oyuncu henüz hazır değil. Yine de başlatmak istiyor musun?`)) return;
  }
  socket.emit('game:start', { gameType: pendingGameType });
  closeSettings();
});

settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) closeSettings();
});

// Tab değiştirme
document.querySelectorAll('.settings-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.settings-pane').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.querySelector(`.settings-pane[data-pane="${tab.dataset.tab}"]`).classList.add('active');
  });
});

// Slider/checkbox/select değişimleri - sunucuya yolla
document.querySelectorAll('.settings-pane input[type="range"], .settings-pane input[type="checkbox"], .settings-pane select').forEach(input => {
  const eventName = input.tagName === 'SELECT' ? 'change' : 'input';
  input.addEventListener(eventName, () => {
    if (isSettingsBuilding) return;
    const game = input.dataset.game;
    const key = input.dataset.key;
    if (!game || !key) return;

    // Görseli güncelle
    if (input.type === 'range') {
      const valEl = document.getElementById(`set-${game}-${key}-val`);
      if (valEl) valEl.textContent = input.value;
      if (game === 'hafiza' && key === 'pairCount') {
        const cardsEl = document.getElementById('set-hafiza-cards');
        if (cardsEl) cardsEl.textContent = parseInt(input.value) * 2;
      }
    }

    if (state.you?.id !== state.host) return;

    let value;
    if (input.type === 'checkbox') value = input.checked;
    else if (input.tagName === 'SELECT') value = input.value;
    else value = parseInt(input.value);

    socket.emit('room:settings', {
      gameType: game,
      settings: { [key]: value }
    });
  });
});

// Sunucudan gelen ayarları UI'a uygula
function applySettingsToUI() {
  if (!state.settings) return;
  isSettingsBuilding = true;
  
  for (const game in state.settings) {
    const cfg = state.settings[game];
    for (const key in cfg) {
      const input = document.getElementById(`set-${game}-${key}`);
      if (!input) continue;
      if (input.type === 'checkbox') {
        input.checked = !!cfg[key];
      } else if (input.tagName === 'SELECT') {
        input.value = cfg[key];
      } else {
        input.value = cfg[key];
        const valEl = document.getElementById(`set-${game}-${key}-val`);
        if (valEl) valEl.textContent = cfg[key];
      }
    }
  }
  
  // Hafıza özel: kart sayısı
  if (state.settings.hafiza) {
    const cardsEl = document.getElementById('set-hafiza-cards');
    if (cardsEl) cardsEl.textContent = state.settings.hafiza.pairCount * 2;
  }
  
  // Host olmayan kişide tüm input'ları disable et
  const isHost = state.you?.id === state.host;
  document.querySelectorAll('.settings-pane input, .settings-pane select').forEach(i => {
    i.disabled = !isHost;
  });
  document.getElementById('settings-host-warning').style.display = isHost ? 'none' : 'block';
  
  isSettingsBuilding = false;
}

// Oyun seçme kartları — ayarlar modal'ını aç (oyunu hemen başlatma)
document.querySelectorAll('.game-card:not(.disabled)').forEach(card => {
  card.addEventListener('click', () => {
    const gameType = card.dataset.game;
    if (!gameType) return;
    if (state.you?.id !== state.host) {
      showToast('Sadece oda kurucusu oyun başlatabilir!', 'error');
      return;
    }
    if (state.players.length < 2) {
      showToast('En az 2 oyuncu lazım!', 'error');
      return;
    }
    openSettingsForGame(gameType);
  });
});

function renderLobby() {
  document.getElementById('room-code').textContent = state.roomCode || '----';
  document.getElementById('player-count').textContent = state.players.length;

  const list = document.getElementById('players-list');
  list.innerHTML = '';
  state.players.forEach(p => {
    const li = document.createElement('li');
    if (p.id === state.host) li.classList.add('is-host');
    if (p.id === state.you?.id) li.classList.add('is-you');
    const isReady = p.ready || p.id === state.host;

    li.innerHTML = `
      ${avatarHTML(p, 'md')}
      <span class="player-name-text">${escapeHtml(p.name)}</span>
      ${p.id === state.host ? '<span class="player-tag">👑 HOST</span>' : ''}
      ${p.id === state.you?.id && p.id !== state.host ? '<span class="player-tag you">SEN</span>' : ''}
      ${isReady && p.id !== state.host ? '<span class="player-tag ready-tag">✓ HAZIR</span>' : ''}
    `;
    list.appendChild(li);
  });

  // Non-host için Hazırım butonu lobide
  const lobbyReadyBtn = document.getElementById('lobby-ready-btn');
  if (lobbyReadyBtn) {
    const isHost = state.you?.id === state.host;
    const me = state.players.find(p => p.id === state.you?.id);
    if (isHost) {
      lobbyReadyBtn.style.display = 'none';
    } else {
      lobbyReadyBtn.style.display = '';
      lobbyReadyBtn.textContent = me?.ready ? '✓ Hazırım (vazgeç)' : '✋ Hazırım';
      lobbyReadyBtn.classList.toggle('btn-ready-on', !!me?.ready);
    }
  }

  // Host ipucu
  const hint = document.getElementById('host-hint');
  if (state.you?.id === state.host) {
    if (state.players.length < 2) {
      hint.textContent = '⏳ En az 1 arkadaşının daha katılmasını bekle...';
    } else {
      hint.textContent = '✅ Bir oyun seçip başlat!';
    }
  } else {
    hint.textContent = '⏳ Oda kurucusunun oyun başlatmasını bekle...';
  }
}

// ============================================================
// KELİME ZİNCİRİ ARAYÜZÜ
// ============================================================
document.getElementById('kelime-submit').addEventListener('click', submitKelime);
document.getElementById('kelime-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') submitKelime();
});
document.getElementById('kelime-exit').addEventListener('click', exitGame);
document.getElementById('kelime-back-lobby').addEventListener('click', exitGame);
document.getElementById('kelime-pass').addEventListener('click', () => {
  socket.emit('kelime:pass');
});
document.getElementById('kelime-change-letter').addEventListener('click', () => {
  socket.emit('kelime:changeLetter');
});

// Mobil: input fokuslandığında ekrana kaydır (klavye altında kalmasın)
document.getElementById('kelime-input').addEventListener('focus', () => {
  setTimeout(() => {
    document.getElementById('kelime-input-area')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 200);
});

function submitKelime() {
  const input = document.getElementById('kelime-input');
  const word = input.value.trim();
  if (!word) return;
  socket.emit('kelime:submit', { word });
  input.value = '';
  document.getElementById('kelime-error').textContent = '';
}

const CATEGORY_NAMES = {
  'serbest': 'Serbest',
  'hayvan': '🐾 Hayvan',
  'bitki': '🌿 Bitki',
  'esya': '🪑 Eşya',
  'ulke': '🌍 Ülke',
  'yemek': '🍽️ Yemek',
  'a-yok': '🚫 "A" yok'
};

function renderKelimeZinciri() {
  const gs = state.gameState;
  if (!gs) return;

  const currentPlayer = state.players[gs.currentPlayerIndex];
  const isMyTurn = currentPlayer && currentPlayer.id === state.you?.id;

  document.getElementById('kelime-current-player').textContent = currentPlayer ? currentPlayer.name : '-';

  // Harf gösterimi: kafiye modunda 2 harf, normal modda 1 harf
  const letterEl = document.getElementById('kelime-letter');
  if (gs.matchMode === 'kafiye' && gs.lastTwoLetters) {
    letterEl.textContent = gs.lastTwoLetters.toUpperCase();
  } else {
    letterEl.textContent = gs.lastLetter ? gs.lastLetter.toUpperCase() : '✨';
  }
  document.getElementById('kelime-timer').textContent = gs.timeLeft;

  // Mod rozetleri
  const catBadge = document.getElementById('kelime-category-badge');
  const modeBadge = document.getElementById('kelime-mode-badge');
  const dictBadge = document.getElementById('kelime-dict-badge');
  if (catBadge) catBadge.textContent = CATEGORY_NAMES[gs.category] || 'Serbest';
  if (modeBadge) modeBadge.textContent = gs.matchMode === 'kafiye' ? '🎵 Kafiye (son 2 harf)' : 'Son harf';
  if (dictBadge) {
    const dictActive = gs.useDictionary && (!gs.category || gs.category === 'serbest' || gs.category === 'a-yok');
    dictBadge.style.display = dictActive ? '' : 'none';
  }

  // Çıkmaz harf bildirimi
  const skipNoticeEl = document.getElementById('kelime-skip-notice');
  if (skipNoticeEl) {
    if (gs.skipNotice && gs.skipNotice.message) {
      skipNoticeEl.textContent = '↪ ' + gs.skipNotice.message;
      skipNoticeEl.style.display = '';
    } else {
      skipNoticeEl.style.display = 'none';
    }
  }

  // Input alanı
  const inputArea = document.getElementById('kelime-input-area');
  const input = document.getElementById('kelime-input');
  if (isMyTurn && !gs.gameOver) {
    inputArea.classList.remove('locked');
    input.disabled = false;
    const startWith = (gs.matchMode === 'kafiye' && gs.lastTwoLetters) ? gs.lastTwoLetters : gs.lastLetter;
    input.placeholder = startWith
      ? `"${startWith.toUpperCase()}" ile başlayan kelime...`
      : 'İlk kelimeyi yaz!';
    setTimeout(() => input.focus(), 50);
  } else {
    inputArea.classList.add('locked');
    input.disabled = true;
    input.placeholder = `${currentPlayer?.name || '...'} yazıyor...`;
  }

  // Pas butonu
  const passBtn = document.getElementById('kelime-pass');
  const passCountEl = document.getElementById('kelime-pass-count');
  const myPasses = (gs.passesLeft && state.you) ? (gs.passesLeft[state.you.id] || 0) : 0;
  if (passCountEl) passCountEl.textContent = myPasses;
  if (passBtn) {
    const canPass = isMyTurn && !gs.gameOver && myPasses > 0;
    passBtn.disabled = !canPass;
    passBtn.style.display = (gs.maxPasses > 0) ? '' : 'none';
  }

  // Harf Değiş butonu
  const changeBtn = document.getElementById('kelime-change-letter');
  const changeCountEl = document.getElementById('kelime-change-count');
  const myChanges = (gs.letterChangesLeft && state.you) ? (gs.letterChangesLeft[state.you.id] || 0) : 0;
  if (changeCountEl) changeCountEl.textContent = myChanges;
  if (changeBtn) {
    const canChange = isMyTurn && !gs.gameOver && myChanges > 0 && gs.lastLetter;
    changeBtn.disabled = !canChange;
    changeBtn.style.display = ((gs.maxLetterChanges || 0) > 0) ? '' : 'none';
  }

  // Kelime geçmişi
  const history = document.getElementById('kelime-history');
  if (gs.messages.length === 0) {
    history.innerHTML = '<p class="empty">Henüz kelime yok. İlk oyuncu başlasın!</p>';
  } else {
    history.innerHTML = gs.messages.map(m => `
      <div class="entry ${m.valid ? '' : 'invalid'} ${m.pass ? 'is-pass' : ''}">
        <span class="player">${escapeHtml(m.player)}:</span>
        <span class="word">${escapeHtml(m.word)}</span>
      </div>
    `).join('');
    history.scrollTop = history.scrollHeight;
  }

  renderKelimeScoreboard(gs);

  // Oyun bitti mi?
  const gameOverEl = document.getElementById('kelime-gameover');
  if (gs.gameOver) {
    document.getElementById('kelime-winner').textContent = gs.winner || 'Berabere';
    gameOverEl.style.display = 'flex';
  } else {
    gameOverEl.style.display = 'none';
  }
}

// ============================================================
// HAFIZA OYUNU ARAYÜZÜ
// ============================================================
document.getElementById('hafiza-exit').addEventListener('click', exitGame);
document.getElementById('hafiza-back-lobby').addEventListener('click', exitGame);

const HAFIZA_THEME_LABELS = {
  'karisik': '🎨 Karışık',
  'hayvan':  '🐾 Hayvanlar',
  'yemek':   '🍕 Yemekler',
  'spor':    '⚽ Spor',
  'meyve':   '🍎 Meyve & Sebze'
};

let _hafizaLastMatched = 0;
let _hafizaLastFlipped = 0;
function renderHafiza() {
  const gs = state.gameState;
  if (!gs) return;

  const currentPlayer = state.players[gs.currentPlayerIndex];
  const isMyTurn = currentPlayer && currentPlayer.id === state.you?.id;

  document.getElementById('hafiza-current-player').textContent =
    currentPlayer ? `${currentPlayer.name}${isMyTurn ? ' (SEN)' : ''}` : '-';

  // Tema rozeti
  const themeBadge = document.getElementById('hafiza-theme-badge');
  if (themeBadge) themeBadge.textContent = HAFIZA_THEME_LABELS[gs.theme] || '🎨 Karışık';

  // İlerleme
  const matchedCount = gs.cards.filter(c => c.matched).length / 2;
  // Match tespiti — sayı arttıysa match sesi
  if (matchedCount > _hafizaLastMatched) SFX.match();
  // Yanlış: 2 kart açık -> 0 açık (matched değişmedi) = no-match
  const flippedNow = gs.cards.filter(c => c.flipped && !c.matched).length;
  if (_hafizaLastFlipped === 2 && flippedNow === 0 && matchedCount === _hafizaLastMatched) {
    SFX.noMatch();
  }
  _hafizaLastMatched = matchedCount;
  _hafizaLastFlipped = flippedNow;
  const progressEl = document.getElementById('hafiza-progress-text');
  if (progressEl) progressEl.textContent = `${matchedCount} / ${gs.pairCount}`;

  // Board — auto-fit sütun sayısı
  const board = document.getElementById('hafiza-board');
  if (gs.theme) board.dataset.theme = gs.theme;
  const totalCards = gs.cards.length;
  // 4 sütun (≤16 kart), 6 sütun (>16 kart), 8 sütun (>30 kart)
  let cols = 4;
  if (totalCards > 30) cols = 6;
  else if (totalCards > 20) cols = 5;
  else if (totalCards > 16) cols = 5;
  board.style.setProperty('--hafiza-cols', cols);

  board.innerHTML = '';
  gs.cards.forEach((card, idx) => {
    const btn = document.createElement('button');
    btn.className = 'memory-card';
    if (card.flipped) btn.classList.add('flipped');
    if (card.matched) btn.classList.add('matched');
    btn.innerHTML = `
      <div class="inner">
        <div class="face front">
          <span class="card-mark">?</span>
        </div>
        <div class="face back">${card.emoji}</div>
      </div>
    `;
    btn.addEventListener('click', () => {
      if (!isMyTurn) {
        showToast('Sıra sende değil!', 'error');
        return;
      }
      if (gs.lockBoard || card.flipped || card.matched) return;
      SFX.cardFlip();
      socket.emit('hafiza:flip', { cardIndex: idx });
    });
    board.appendChild(btn);
  });

  renderScoreboard('hafiza-scoreboard', gs.currentPlayerIndex);

  // Oyun bitti mi?
  const gameOverEl = document.getElementById('hafiza-gameover');
  if (gs.gameOver) {
    document.getElementById('hafiza-winner').textContent = gs.winner || 'Berabere';
    gameOverEl.style.display = 'flex';
  } else {
    gameOverEl.style.display = 'none';
  }
}

// ============================================================
// SKOR TABLOSU (ortak)
// ============================================================
function renderScoreboard(elementId, activeIndex) {
  const el = document.getElementById(elementId);
  el.innerHTML = '';
  state.players.forEach((p, i) => {
    const pill = document.createElement('div');
    pill.className = 'score-pill';
    if (i === activeIndex) pill.classList.add('active');
    if (p.eliminated) pill.classList.add('eliminated');
    pill.innerHTML = `
      ${avatarHTML(p, 'sm')}
      <span class="name">${escapeHtml(p.name)}</span>
      <span class="score">${p.score || 0}</span>
    `;
    el.appendChild(pill);
  });
}

// Kelime Zinciri için canlı skor tablosu (kalp ikonları + pas + harf değiş)
// Not: Puan gösterilmiyor — kazanan = son ayakta kalan
function renderKelimeScoreboard(gs) {
  const el = document.getElementById('kelime-scoreboard');
  el.innerHTML = '';
  state.players.forEach((p, i) => {
    const pill = document.createElement('div');
    pill.className = 'score-pill kelime-pill';
    if (i === gs.currentPlayerIndex) pill.classList.add('active');
    if (p.eliminated) pill.classList.add('eliminated');

    const livesLeft = gs.lives ? (gs.lives[p.id] ?? 0) : 0;
    const passesLeft = gs.passesLeft ? (gs.passesLeft[p.id] ?? 0) : 0;
    const changesLeft = gs.letterChangesLeft ? (gs.letterChangesLeft[p.id] ?? 0) : 0;
    const maxLives = gs.maxLives || 1;

    let hearts = '';
    for (let k = 0; k < maxLives; k++) {
      hearts += `<span class="heart ${k < livesLeft ? 'filled' : 'empty'}">${k < livesLeft ? '❤️' : '🤍'}</span>`;
    }

    const tools = [];
    if (gs.maxPasses > 0) tools.push(`<span class="tool-info" title="Kalan pas">⏭️${passesLeft}</span>`);
    if ((gs.maxLetterChanges || 0) > 0) tools.push(`<span class="tool-info" title="Kalan harf değiş">🔀${changesLeft}</span>`);

    pill.innerHTML = `
      <span class="name">${escapeHtml(p.name)}</span>
      <span class="lives" title="Kalan can">${hearts}</span>
      ${tools.length ? `<span class="tools">${tools.join('')}</span>` : ''}
      ${p.eliminated ? `<span class="elim-tag">elendi</span>` : ''}
    `;
    el.appendChild(pill);
  });
}

// ============================================================
// OYUNDAN ÇIKIŞ (host)
// ============================================================
function exitGame() {
  if (state.you?.id === state.host) {
    socket.emit('game:exit');
  } else {
    showToast('Sadece host lobiye dönebilir. Beklemek istemiyorsan "Ayrıl" tuşu var.', '');
  }
}

// ============================================================
// ÇİZİM-TAHMİN ARAYÜZÜ
// ============================================================
const cizimCanvas = document.getElementById('cizim-canvas');
const cizimCtx = cizimCanvas.getContext('2d');
const cizimState = {
  drawing: false,
  color: '#1a0b2e',
  brushSize: 6,
  lineWidth: 6,
  lastX: 0,
  lastY: 0,
  secretWord: null, // sadece çizen oyuncu için
  isEraser: false
};

// Canvas boyutunu CSS'e göre ayarla (yüksek DPI desteği)
function setupCanvas() {
  const rect = cizimCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  cizimCanvas.width = rect.width * dpr;
  cizimCanvas.height = rect.height * dpr;
  cizimCtx.scale(dpr, dpr);
  cizimCtx.lineCap = 'round';
  cizimCtx.lineJoin = 'round';
}

function getCanvasPos(e) {
  const rect = cizimCanvas.getBoundingClientRect();
  let clientX, clientY;
  if (e.touches) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  } else {
    clientX = e.clientX;
    clientY = e.clientY;
  }
  // 0-1 arası normalize edilmiş koordinatlar (farklı ekran boylarında çalışsın diye)
  return {
    x: (clientX - rect.left) / rect.width,
    y: (clientY - rect.top) / rect.height
  };
}

function isCurrentDrawer() {
  const gs = state.gameState;
  if (!gs || gs.type !== 'cizim') return false;
  const drawer = state.players[gs.drawerIndex];
  return drawer && drawer.id === state.you?.id;
}

function startDraw(e) {
  if (!isCurrentDrawer()) return;
  if (state.gameState?.phase !== 'drawing') return;
  e.preventDefault();
  cizimState.drawing = true;
  const pos = getCanvasPos(e);
  cizimState.lastX = pos.x;
  cizimState.lastY = pos.y;
}

function draw(e) {
  if (!cizimState.drawing || !isCurrentDrawer()) return;
  if (state.gameState?.phase !== 'drawing') return;
  e.preventDefault();
  const pos = getCanvasPos(e);
  const stroke = {
    x1: cizimState.lastX, y1: cizimState.lastY,
    x2: pos.x, y2: pos.y,
    color: cizimState.color,
    width: cizimState.lineWidth
  };
  drawStroke(stroke);
  socket.emit('cizim:draw', stroke);
  cizimState.lastX = pos.x;
  cizimState.lastY = pos.y;
}

function endDraw() {
  cizimState.drawing = false;
}

function drawStroke(stroke) {
  const rect = cizimCanvas.getBoundingClientRect();
  cizimCtx.strokeStyle = stroke.color;
  cizimCtx.lineWidth = stroke.width || 4;
  cizimCtx.beginPath();
  cizimCtx.moveTo(stroke.x1 * rect.width, stroke.y1 * rect.height);
  cizimCtx.lineTo(stroke.x2 * rect.width, stroke.y2 * rect.height);
  cizimCtx.stroke();
}

function clearCanvas() {
  cizimCtx.clearRect(0, 0, cizimCanvas.width, cizimCanvas.height);
}

// Mouse events
cizimCanvas.addEventListener('mousedown', startDraw);
cizimCanvas.addEventListener('mousemove', draw);
cizimCanvas.addEventListener('mouseup', endDraw);
cizimCanvas.addEventListener('mouseleave', endDraw);
// Touch events
cizimCanvas.addEventListener('touchstart', startDraw, { passive: false });
cizimCanvas.addEventListener('touchmove', draw, { passive: false });
cizimCanvas.addEventListener('touchend', endDraw);

// Renk seçme
document.querySelectorAll('.tool-btn[data-color]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tool-btn[data-color]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    cizimState.color = btn.dataset.color;
    cizimState.isEraser = btn.classList.contains('eraser');
    cizimState.lineWidth = cizimState.isEraser ? Math.max(20, cizimState.brushSize * 3) : cizimState.brushSize;
  });
});

// Fırça boyutu
document.querySelectorAll('.tool-btn[data-brush]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tool-btn[data-brush]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    cizimState.brushSize = parseInt(btn.dataset.brush) || 6;
    cizimState.lineWidth = cizimState.isEraser ? Math.max(20, cizimState.brushSize * 3) : cizimState.brushSize;
  });
});

// Canvas temizle
document.getElementById('cizim-clear').addEventListener('click', () => {
  if (!isCurrentDrawer()) return;
  socket.emit('cizim:clear');
  clearCanvas();
});

// Geri al
document.getElementById('cizim-undo').addEventListener('click', () => {
  if (!isCurrentDrawer()) return;
  socket.emit('cizim:undo');
});

// İpucu aç
document.getElementById('cizim-hint').addEventListener('click', () => {
  if (!isCurrentDrawer()) return;
  socket.emit('cizim:revealHint');
});

// Kelime seçimi (çizen tarafında)
document.querySelectorAll('.word-choice-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const idx = parseInt(btn.dataset.index) || 0;
    socket.emit('cizim:selectWord', { index: idx });
    document.getElementById('cizim-word-select').style.display = 'none';
  });
});

// Tahmin gönder
document.getElementById('cizim-guess-btn').addEventListener('click', sendGuess);
document.getElementById('cizim-guess').addEventListener('keydown', e => {
  if (e.key === 'Enter') sendGuess();
});

function sendGuess() {
  const input = document.getElementById('cizim-guess');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('cizim:guess', { text });
  input.value = '';
}

document.getElementById('cizim-exit').addEventListener('click', exitGame);
document.getElementById('cizim-back-lobby').addEventListener('click', exitGame);

function renderCizim() {
  const gs = state.gameState;
  if (!gs) return;

  const drawer = state.players[gs.drawerIndex];
  const isDrawer = drawer && drawer.id === state.you?.id;

  document.getElementById('cizim-drawer-name').textContent = drawer ? drawer.name : '-';
  document.getElementById('cizim-round').textContent =
    `${gs.roundsPlayed + 1}/${gs.totalRounds}`;
  document.getElementById('cizim-timer').textContent = (gs.phase === 'wordSelect') ? (gs.wordSelectTime || 0) : gs.timeLeft;

  // Kelime seçimi modali
  const selectModal = document.getElementById('cizim-word-select');
  if (gs.phase === 'wordSelect') {
    if (isDrawer) {
      // Çizen için seçim modal'ı; sözcükler cizim:wordChoices event ile gelir
      // Sadece görünmüyorsa açma — wordChoices event handler açar
    } else {
      selectModal.style.display = 'none';
    }
  } else {
    selectModal.style.display = 'none';
  }

  // Kelime gösterimi: çizen oyuncuya gerçek kelime, diğerlerine ipucu varsa, yoksa boş
  const wordEl = document.getElementById('cizim-word');
  if (gs.phase === 'wordSelect') {
    wordEl.textContent = '...';
    wordEl.style.color = 'var(--color-text-light)';
  } else if (isDrawer && cizimState.secretWord) {
    wordEl.textContent = cizimState.secretWord.toUpperCase();
    wordEl.style.color = 'var(--color-primary)';
  } else if (gs.wordHint) {
    wordEl.textContent = gs.wordHint;
    wordEl.style.color = 'var(--color-secondary-dark, #006ea3)';
  } else {
    // Henüz ipucu yok - tahmin etmek için sadece çizimi izle
    wordEl.textContent = '🤐 gizli';
    wordEl.style.color = 'var(--color-text-light, #6b7280)';
  }

  // Araç çubuğu sadece çizen için ve çizim fazında
  const tools = document.getElementById('cizim-tools');
  tools.style.display = (isDrawer && gs.phase === 'drawing') ? 'flex' : 'none';

  // İpucu butonu durumu (mobilde kısa metin)
  const hintBtn = document.getElementById('cizim-hint');
  if (hintBtn) {
    const isMobile = window.innerWidth <= 640;
    if ((gs.hintLevel || 0) >= (gs.maxHintLevel || 2)) {
      hintBtn.disabled = true;
      hintBtn.textContent = isMobile ? '💡 ✓' : '💡 İpucu (bitti)';
    } else {
      hintBtn.disabled = false;
      if (isMobile) {
        hintBtn.textContent = (gs.hintLevel === 0) ? '💡 -30%' : '💡 -50%';
      } else {
        const nextLabel = (gs.hintLevel === 0) ? '#1 Harf sayısı (-30% puan)' : '#2 Baş harf (-50% puan)';
        hintBtn.textContent = `💡 ${nextLabel}`;
      }
    }
  }

  // Tahmin alanı sadece çizmeyen ve drawing fazında
  const guessWrap = document.getElementById('cizim-guess-wrap');
  if (isDrawer || gs.phase !== 'drawing') {
    guessWrap.classList.add('disabled');
  } else {
    guessWrap.classList.remove('disabled');
  }

  // Canvas cursor
  cizimCanvas.classList.toggle('guessing', !isDrawer);

  // Sohbet/tahminler
  const chat = document.getElementById('cizim-chat');
  if (!gs.guesses || gs.guesses.length === 0) {
    chat.innerHTML = '<p class="empty">Henüz tahmin yok...</p>';
  } else {
    chat.innerHTML = gs.guesses.map(g => `
      <div class="guess-entry ${g.correct ? 'correct' : ''}">
        ${g.correct ? '' : `<span class="player">${escapeHtml(g.player)}:</span>`}
        <span class="text">${escapeHtml(g.text)}</span>
      </div>
    `).join('');
    chat.scrollTop = chat.scrollHeight;
  }

  renderScoreboard('cizim-scoreboard', gs.drawerIndex);

  // Reveal ekranı (tur sonu) — ara skor özetli
  const revealEl = document.getElementById('cizim-reveal');
  if (gs.phase === 'roundEnd' && !gs.gameOver) {
    document.getElementById('cizim-reveal-word').textContent = gs.revealedWord || gs.currentWord || '?';
    const summaryEl = document.getElementById('cizim-reveal-summary');
    if (summaryEl && gs.lastSummary) {
      const sorted = [...gs.lastSummary].sort((a, b) => b.total - a.total);
      summaryEl.innerHTML = sorted.map(s => `
        <div class="summary-row ${s.wasDrawer ? 'is-drawer' : (s.guessed ? 'is-correct' : 'is-wrong')}">
          <span class="sum-name">${s.wasDrawer ? '🎨 ' : (s.guessed ? '✅ ' : '❌ ')}${escapeHtml(s.name)}</span>
          <span class="sum-this">+${s.thisRound}</span>
          <span class="sum-total">${s.total}</span>
        </div>
      `).join('');
    } else if (summaryEl) {
      summaryEl.innerHTML = '';
    }
    revealEl.style.display = 'flex';
  } else {
    revealEl.style.display = 'none';
  }

  // Oyun bitti
  const gameOverEl = document.getElementById('cizim-gameover');
  if (gs.gameOver) {
    document.getElementById('cizim-winner').textContent = gs.winner || 'Berabere';
    gameOverEl.style.display = 'flex';
    revealEl.style.display = 'none';
  } else {
    gameOverEl.style.display = 'none';
  }
}

// ============================================================
// TRIVIA ARAYÜZÜ
// ============================================================
document.getElementById('trivia-exit').addEventListener('click', exitGame);
document.getElementById('trivia-back-lobby').addEventListener('click', exitGame);

let triviaSelected = -1; // bu sorudaki seçim
let triviaFiftyEliminated = []; // 50:50 ile elenen şık index'leri (bu soru)

document.getElementById('trivia-fifty').addEventListener('click', () => {
  socket.emit('trivia:useFifty');
});

function renderTrivia() {
  const gs = state.gameState;
  if (!gs) return;

  // Üst bilgi
  if (gs.currentQuestion) {
    document.getElementById('trivia-number').textContent = 
      `Soru ${gs.currentQuestion.number}/${gs.currentQuestion.total}`;
    document.getElementById('trivia-category').textContent = gs.currentQuestion.category || '';
    document.getElementById('trivia-question').textContent = gs.currentQuestion.question;
  }
  document.getElementById('trivia-timer').textContent = gs.timeLeft;

  // Şıklar
  const opts = document.getElementById('trivia-options');
  opts.innerHTML = '';
  if (gs.currentQuestion && gs.currentQuestion.options) {
    const letters = ['A', 'B', 'C', 'D'];
    gs.currentQuestion.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'trivia-option';
      btn.innerHTML = `
        <span class="letter">${letters[i]}</span>
        <span class="text">${escapeHtml(opt)}</span>
      `;
      // Sonuç gösteriliyorsa renkler
      if (gs.phase === 'reveal' && gs.lastAnswers) {
        btn.disabled = true;
        if (i === gs.lastAnswers.correctIndex) {
          btn.classList.add('correct');
        }
        const myResult = gs.lastAnswers.results.find(r => r.playerId === state.you?.id);
        if (myResult && myResult.answerIndex === i && i !== gs.lastAnswers.correctIndex) {
          btn.classList.add('wrong');
        }
      } else if (gs.phase === 'question') {
        // 50:50 ile elenen şık
        if (triviaFiftyEliminated.includes(i)) {
          btn.classList.add('eliminated');
          btn.disabled = true;
        } else if (triviaSelected === i) {
          btn.classList.add('selected');
          btn.disabled = true;
        } else if (triviaSelected !== -1) {
          btn.disabled = true;
        } else {
          btn.addEventListener('click', () => {
            triviaSelected = i;
            socket.emit('trivia:answer', { answerIndex: i });
            renderTrivia();
          });
        }
        // Kahoot tarzı renkli kart
        btn.classList.add(`opt-${i}`);
      } else {
        btn.disabled = true;
      }
      opts.appendChild(btn);
    });
  }

  // 50:50 buton durumu
  const fiftyBtn = document.getElementById('trivia-fifty');
  const fiftyCount = document.getElementById('trivia-fifty-count');
  const myFifty = (gs.fiftyLeft && state.you) ? (gs.fiftyLeft[state.you.id] || 0) : 0;
  const usedThisQ = (gs.fiftyEliminated && state.you) ? !!gs.fiftyEliminated[state.you.id] : false;
  if (fiftyCount) fiftyCount.textContent = myFifty;
  if (fiftyBtn) {
    const canUse = gs.phase === 'question' && triviaSelected === -1 && myFifty > 0 && !usedThisQ;
    fiftyBtn.disabled = !canUse;
    fiftyBtn.style.display = (gs.fiftyJokerEnabled !== false) ? '' : 'none';
  }

  // Durum mesajı
  const status = document.getElementById('trivia-status');
  if (gs.phase === 'question') {
    if (triviaSelected !== -1) {
      status.textContent = '✓ Cevabını gönderdin. Diğerleri bekleniyor...';
    } else {
      status.textContent = 'Bir cevap seç!';
    }
  } else if (gs.phase === 'reveal') {
    const myResult = gs.lastAnswers?.results.find(r => r.playerId === state.you?.id);
    // Reveal sesini sadece bir kez çal
    if (!gs._sfxPlayed) {
      gs._sfxPlayed = true;
      if (myResult && myResult.correct) SFX.triviaCorrect();
      else if (myResult && myResult.answerIndex >= 0) SFX.triviaWrong();
    }
    if (myResult && myResult.correct) {
      status.textContent = `🎉 Doğru! +${myResult.points} puan`;
    } else if (myResult && myResult.answerIndex >= 0) {
      status.textContent = '❌ Yanlış cevap';
    } else {
      status.textContent = '⏰ Cevap vermedin';
    }
    // Yeni soru için seçimleri sıfırla
    setTimeout(() => {
      triviaSelected = -1;
      triviaFiftyEliminated = [];
    }, 100);
    // Streak bilgisi
    const myResult2 = gs.lastAnswers?.results.find(r => r.playerId === state.you?.id);
    if (myResult2 && myResult2.streakBonus > 0) {
      showToast(`🔥 ${myResult2.streak}\'li streak! +${myResult2.streakBonus} bonus`, '');
    }
  }

  renderScoreboard('trivia-scoreboard', -1);

  // Oyun bitti
  const gameOverEl = document.getElementById('trivia-gameover');
  if (gs.gameOver) {
    document.getElementById('trivia-winner').textContent = gs.winner || 'Berabere';
    // Tüm skorlar
    const sorted = [...state.players].sort((a, b) => b.score - a.score);
    const finalScores = document.getElementById('trivia-final-scores');
    finalScores.innerHTML = sorted.map((p, i) => `
      <div class="row ${i === 0 ? 'winner' : ''}">
        <span>${i + 1}. ${escapeHtml(p.name)}</span>
        <span>${p.score} puan</span>
      </div>
    `).join('');
    gameOverEl.style.display = 'flex';
  } else {
    gameOverEl.style.display = 'none';
  }
}

// ============================================================
// VAMPİR KÖYLÜ ARAYÜZÜ
// ============================================================
const vampirState = {
  myRole: null,
  teammates: [], // vampir takım arkadaşları
  selectedTarget: null,
  detectiveResults: [], // önceki dedektif kontrolleri
  witchMode: null // 'protect' | 'kill' | null
};

document.getElementById('vampir-exit').addEventListener('click', exitGame);
document.getElementById('vampir-back-lobby').addEventListener('click', exitGame);

let _vampirLastPhase = null;
function renderVampir() {
  const gs = state.gameState;
  if (!gs) return;

  // Faz değişikliklerinde ses
  if (gs.phase !== _vampirLastPhase) {
    if (gs.phase === 'night') SFX.vampirNight();
    else if (gs.phase === 'dayDiscussion') SFX.vampirDay();
    _vampirLastPhase = gs.phase;
  }

  const me = state.players.find(p => p.id === state.you?.id);
  const isAlive = me?.alive !== false;

  // Faz başlığı
  const phaseEl = document.getElementById('vampir-phase');
  const phaseMap = {
    night: { text: '🌙 Gece', cls: 'night' },
    dayDiscussion: { text: '☀️ Tartışma', cls: 'day' },
    dayVote: { text: '🗳️ Oylama', cls: 'day' },
    reveal: { text: '👁️ Sonuç', cls: 'day' },
    gameOver: { text: '🏆 Bitti', cls: 'day' }
  };
  const phaseInfo = phaseMap[gs.phase] || phaseMap.night;
  phaseEl.textContent = phaseInfo.text;
  phaseEl.className = 'vampir-phase ' + phaseInfo.cls;
  document.getElementById('vampir-day').textContent = `Gün ${gs.dayNumber || 1}`;
  document.getElementById('vampir-timer').textContent = gs.timeLeft;

  // Kendi rolüm
  const roleEl = document.getElementById('vampir-my-role');
  if (vampirState.myRole) {
    const emojiMap = { vampir: '🧛', doktor: '⚕️', dedektif: '🔍', cadi: '🧙', soytari: '🤡', koylu: '👨‍🌾' };
    const nameMap = { vampir: 'Vampir', doktor: 'Doktor', dedektif: 'Dedektif', cadi: 'Cadı', soytari: 'Soytarı', koylu: 'Köylü' };
    roleEl.textContent = `${emojiMap[vampirState.myRole]} ${nameMap[vampirState.myRole]}`;
  }

  // Oyuncu listesi - faza göre seçilebilir
  const playersDiv = document.getElementById('vampir-players');
  playersDiv.innerHTML = '';
  state.players.forEach(p => {
    const item = document.createElement('div');
    item.className = 'vampir-player-item';
    if (p.alive === false) item.classList.add('dead');
    if (p.id === state.you?.id) item.style.fontWeight = '700';

    let label = escapeHtml(p.name);
    if (p.id === state.you?.id) label += ' (sen)';

    // Vampir takım arkadaşlarını işaretle
    if (vampirState.myRole === 'vampir' && p.role === 'vampir' && p.id !== state.you?.id) {
      label += ' 🧛';
    }

    // Dedektif sonucu varsa göster
    const detResult = vampirState.detectiveResults.find(r => r.name === p.name);
    if (detResult && vampirState.myRole === 'dedektif') {
      label += detResult.isVampire ? ' ⚠️🧛' : ' ✅';
    }

    item.innerHTML = `<span>${label}</span>`;

    // Oylama gösterimi
    if (gs.phase === 'dayVote' && gs.votes) {
      const voteCount = Object.values(gs.votes).filter(v => v === p.id).length;
      if (voteCount > 0) {
        item.innerHTML += `<span class="vote-count">${voteCount}</span>`;
      }
    }

    // Seçilebilirlik
    if (isAlive && p.alive !== false && p.id !== state.you?.id) {
      let canSelect = false;
      if (gs.phase === 'night') {
        if (vampirState.myRole === 'vampir' && p.role !== 'vampir') canSelect = true;
        if (vampirState.myRole === 'doktor') canSelect = true;
        if (vampirState.myRole === 'dedektif') canSelect = true;
        if (vampirState.myRole === 'cadi' && vampirState.witchMode) canSelect = true;
      } else if (gs.phase === 'dayVote') {
        canSelect = true;
      }
      if (canSelect) {
        item.classList.add('selectable');
        if (vampirState.selectedTarget === p.id) item.classList.add('selected');
        item.addEventListener('click', () => {
          vampirState.selectedTarget = p.id;
          if (gs.phase === 'night') {
            if (vampirState.myRole === 'vampir') socket.emit('vampir:kill', { targetId: p.id });
            else if (vampirState.myRole === 'doktor') socket.emit('vampir:save', { targetId: p.id });
            else if (vampirState.myRole === 'dedektif') socket.emit('vampir:check', { targetId: p.id });
            else if (vampirState.myRole === 'cadi' && vampirState.witchMode) {
              socket.emit('vampir:witchPotion', { type: vampirState.witchMode, targetId: p.id });
              vampirState.witchMode = null;
            }
          } else if (gs.phase === 'dayVote') {
            socket.emit('vampir:vote', { targetId: p.id });
          }
          renderVampir();
        });
      }
    }
    // Kendine doktor / cadı koruma — koruma için seç
    else if (isAlive && p.id === state.you?.id && gs.phase === 'night') {
      if (vampirState.myRole === 'doktor') {
        item.classList.add('selectable');
        if (vampirState.selectedTarget === p.id) item.classList.add('selected');
        item.addEventListener('click', () => {
          vampirState.selectedTarget = p.id;
          socket.emit('vampir:save', { targetId: p.id });
          renderVampir();
        });
      } else if (vampirState.myRole === 'cadi' && vampirState.witchMode === 'protect') {
        item.classList.add('selectable');
        if (vampirState.selectedTarget === p.id) item.classList.add('selected');
        item.addEventListener('click', () => {
          vampirState.selectedTarget = p.id;
          socket.emit('vampir:witchPotion', { type: 'protect', targetId: p.id });
          vampirState.witchMode = null;
          renderVampir();
        });
      }
    }

    playersDiv.appendChild(item);
  });

  // Aksiyon paneli
  const actionDiv = document.getElementById('vampir-action-content');
  actionDiv.innerHTML = '';

  if (!isAlive) {
    actionDiv.innerHTML = '<p class="vampir-instructions">💀 Öldün! İzlemeye devam et.</p>';
  } else if (gs.gameOver) {
    actionDiv.innerHTML = '<p class="vampir-instructions">Oyun bitti.</p>';
  } else if (gs.phase === 'night') {
    let msg = '';
    if (vampirState.myRole === 'vampir') {
      msg = '🌙 <strong>Vampir gecesi!</strong> Öldürmek istediğin oyuncuyu seç. Diğer vampirlerle aynı kişiyi seçmelisin.';
    } else if (vampirState.myRole === 'doktor') {
      msg = '⚕️ <strong>Doktor gecesi!</strong> Bu gece kimi koruyacaksın? Kendini de seçebilirsin.';
    } else if (vampirState.myRole === 'dedektif') {
      msg = '🔍 <strong>Dedektif gecesi!</strong> Vampir mi diye bakmak için bir oyuncu seç.';
    } else if (vampirState.myRole === 'cadi') {
      const myPotions = (gs.witchPotions && state.you) ? gs.witchPotions[state.you.id] : null;
      const protectLeft = myPotions?.protect ?? 0;
      const killLeft = myPotions?.kill ?? 0;
      msg = `🧙 <strong>Cadı gecesi!</strong> İksir kullanmak için aşağıdan birini seç.<br>
        Kalan iksir: 🛡️ Koruma ×${protectLeft} | 💀 Öldürme ×${killLeft}`;
      msg += `
        <div class="witch-controls" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" id="witch-mode-protect" ${protectLeft <= 0 ? 'disabled' : ''}>🛡️ Koruma modu</button>
          <button class="btn btn-secondary btn-sm" id="witch-mode-kill" ${killLeft <= 0 ? 'disabled' : ''}>💀 Öldürme modu</button>
          <button class="btn btn-ghost btn-sm" id="witch-mode-pass">Bu gece pas</button>
        </div>
        <p class="vampir-instructions" style="margin-top:8px;font-size:0.85rem">
          Mod seç → sonra alttaki oyuncu listesinden hedef tıkla.
          <strong>Mevcut mod: ${vampirState.witchMode || 'yok'}</strong>
        </p>`;
    } else if (vampirState.myRole === 'soytari') {
      msg = '🤡 <strong>Soytarısın!</strong> Hedefin gündüz oylamada idam edilmek. Diğerlerine vampir gibi davran ki seni assınlar!';
    } else {
      msg = '😴 <strong>Köylüsün, uyuyorsun...</strong> Sabah neler olduğunu öğreneceksin.';
    }
    actionDiv.innerHTML = `<p class="vampir-instructions">${msg}</p>`;

    // Cadı mod butonları
    const protBtn = document.getElementById('witch-mode-protect');
    if (protBtn) protBtn.addEventListener('click', () => { vampirState.witchMode = 'protect'; renderVampir(); });
    const killBtn = document.getElementById('witch-mode-kill');
    if (killBtn) killBtn.addEventListener('click', () => { vampirState.witchMode = 'kill'; renderVampir(); });
    const passBtn = document.getElementById('witch-mode-pass');
    if (passBtn) passBtn.addEventListener('click', () => { vampirState.witchMode = null; renderVampir(); });
  } else if (gs.phase === 'dayDiscussion') {
    actionDiv.innerHTML = `
      <p class="vampir-instructions">💬 <strong>Tartışma zamanı!</strong> Vampirleri bulmak için konuşun.</p>
      <div class="vampir-chat" id="vampir-chat-box"></div>
      <div class="vampir-chat-input">
        <input type="text" id="vampir-chat-input" placeholder="Mesaj yaz..." maxlength="200"/>
        <button class="btn btn-primary btn-sm" id="vampir-chat-send">Gönder</button>
      </div>
    `;
    // Chat doldur
    const chatBox = document.getElementById('vampir-chat-box');
    if (gs.chat && gs.chat.length) {
      chatBox.innerHTML = gs.chat.map(m => `
        <div class="vampir-chat-msg">
          <span class="player">${escapeHtml(m.player)}:</span>
          <span>${escapeHtml(m.text)}</span>
        </div>
      `).join('');
      chatBox.scrollTop = chatBox.scrollHeight;
    } else {
      chatBox.innerHTML = '<p style="text-align:center;color:var(--color-text-light);padding:20px;font-style:italic">Henüz mesaj yok...</p>';
    }
    // Send handlers
    const sendBtn = document.getElementById('vampir-chat-send');
    const sendInput = document.getElementById('vampir-chat-input');
    const sendMsg = () => {
      const text = sendInput.value.trim();
      if (text) {
        socket.emit('vampir:chat', { text });
        sendInput.value = '';
      }
    };
    sendBtn.addEventListener('click', sendMsg);
    sendInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendMsg(); });
  } else if (gs.phase === 'dayVote') {
    const skipBtn = `<button class="btn btn-ghost btn-sm" id="vampir-skip-vote" style="margin-top:12px">Boş Oy Kullan</button>`;
    actionDiv.innerHTML = `
      <p class="vampir-instructions">🗳️ <strong>Oylama!</strong> Vampir olduğundan şüphelendiğin oyuncuyu seç.</p>
      ${skipBtn}
    `;
    document.getElementById('vampir-skip-vote')?.addEventListener('click', () => {
      socket.emit('vampir:vote', { targetId: 'skip' });
      vampirState.selectedTarget = 'skip';
      showToast('Boş oy kullandın', 'success');
    });
  }

  // Olaylar
  const eventsDiv = document.getElementById('vampir-events');
  if (gs.events && gs.events.length) {
    eventsDiv.innerHTML = gs.events.slice().reverse().map(e => `
      <div class="vampir-event ${e.type}">${escapeHtml(e.message)}</div>
    `).join('');
  } else {
    eventsDiv.innerHTML = '<p style="text-align:center;color:var(--color-text-light);padding:20px;font-style:italic">Henüz olay yok</p>';
  }

  // Oyun bitti
  const gameOverEl = document.getElementById('vampir-gameover');
  if (gs.gameOver) {
    document.getElementById('vampir-winner-title').textContent = 
      gs.winner === 'vampirler' ? '🧛 Vampirler Kazandı!' : '👨‍🌾 Köylüler Kazandı!';
    document.getElementById('vampir-winner-msg').textContent = 
      gs.winner === 'vampirler' ? 'Vampirler köyü ele geçirdi!' : 'Köylüler tüm vampirleri yakaladı!';
    
    // Tüm rolleri açıkla
    const reveal = document.getElementById('vampir-roles-reveal');
    const emojiMap = { vampir: '🧛', doktor: '⚕️', dedektif: '🔍', koylu: '👨‍🌾' };
    const nameMap = { vampir: 'Vampir', doktor: 'Doktor', dedektif: 'Dedektif', koylu: 'Köylü' };
    reveal.innerHTML = '<p style="font-weight:700;margin-bottom:8px">Tüm Roller:</p>' + 
      state.players.map(p => `
        <div class="reveal-row">
          ${emojiMap[p.role] || '?'} <strong>${escapeHtml(p.name)}</strong> — ${nameMap[p.role] || '?'} ${p.alive === false ? '💀' : ''}
        </div>
      `).join('');
    gameOverEl.style.display = 'flex';
  } else {
    gameOverEl.style.display = 'none';
  }
}

// ============================================================
// YILAN SAVAŞI ARAYÜZÜ
// ============================================================
const yilanCanvas = document.getElementById('yilan-canvas');
const yilanCtx = yilanCanvas.getContext('2d');
const yilanState = {
  snakes: {},
  foods: [],
  arenaW: 1600,
  arenaH: 1100,
  camera: { x: 0, y: 0 },
  boostHeld: false,
  animFrame: null,
  starField: null
};

document.getElementById('yilan-exit').addEventListener('click', exitGame);
document.getElementById('yilan-back-lobby').addEventListener('click', exitGame);

function setYilanDir(dx, dy) {
  if (state.game !== 'yilan') return;
  socket.emit('yilan:direction', { direction: { x: dx, y: dy } });
}

function setYilanBoost(on) {
  if (state.game !== 'yilan') return;
  if (yilanState.boostHeld === on) return;
  yilanState.boostHeld = on;
  if (on) SFX.yilanBoostStart();
  socket.emit('yilan:boost', { on });
}

document.addEventListener('keydown', (e) => {
  if (state.game !== 'yilan') return;
  if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') { setYilanDir(0, -1); e.preventDefault(); }
  else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') { setYilanDir(0, 1); e.preventDefault(); }
  else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { setYilanDir(-1, 0); e.preventDefault(); }
  else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { setYilanDir(1, 0); e.preventDefault(); }
  else if (e.key === 'Shift') { setYilanBoost(true); e.preventDefault(); }
});
document.addEventListener('keyup', (e) => {
  if (state.game !== 'yilan') return;
  if (e.key === 'Shift') { setYilanBoost(false); e.preventDefault(); }
});

// Mobil d-pad
document.querySelectorAll('.d-btn').forEach(btn => {
  const dirMap = { up: [0,-1], down: [0,1], left: [-1,0], right: [1,0] };
  const handler = (e) => {
    e.preventDefault();
    const d = dirMap[btn.dataset.dir];
    if (d) setYilanDir(d[0], d[1]);
  };
  btn.addEventListener('click', handler);
  btn.addEventListener('touchstart', handler, { passive: false });
});

// Mobil boost butonu (basılı tutma)
const boostBtn = document.getElementById('yilan-boost-btn');
if (boostBtn) {
  const start = (e) => { e.preventDefault(); setYilanBoost(true); };
  const end = (e) => { e.preventDefault(); setYilanBoost(false); };
  boostBtn.addEventListener('mousedown', start);
  boostBtn.addEventListener('mouseup', end);
  boostBtn.addEventListener('mouseleave', end);
  boostBtn.addEventListener('touchstart', start, { passive: false });
  boostBtn.addEventListener('touchend', end);
}

// Yıldız alan üret (arka plan dekoru)
function buildStarField() {
  if (yilanState.starField) return;
  const stars = [];
  const N = 120;
  for (let i = 0; i < N; i++) {
    stars.push({
      x: Math.random() * yilanState.arenaW,
      y: Math.random() * yilanState.arenaH,
      r: Math.random() * 1.4 + 0.3,
      a: Math.random() * 0.6 + 0.2
    });
  }
  yilanState.starField = stars;
}

// Canvas boyutu (responsive)
function resizeYilanCanvas() {
  const wrap = document.querySelector('.yilan-arena-wrap');
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  yilanCanvas.width = rect.width * dpr;
  yilanCanvas.height = rect.height * dpr;
  yilanCanvas.style.width = rect.width + 'px';
  yilanCanvas.style.height = rect.height + 'px';
  yilanCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resizeYilanCanvas);

function drawYilan() {
  const cssW = yilanCanvas.clientWidth || yilanCanvas.width;
  const cssH = yilanCanvas.clientHeight || yilanCanvas.height;
  const arenaW = yilanState.arenaW;
  const arenaH = yilanState.arenaH;

  // Kamerayı oyuncunun yılanına merkezle (yoksa arena merkezi)
  const me = yilanState.snakes[state.you?.id];
  let camX = arenaW / 2 - cssW / 2;
  let camY = arenaH / 2 - cssH / 2;
  if (me && me.body && me.body.length > 0) {
    camX = me.body[0].x - cssW / 2;
    camY = me.body[0].y - cssH / 2;
  }
  // Arena sınırlarına clamp
  camX = Math.max(0, Math.min(arenaW - cssW, camX));
  camY = Math.max(0, Math.min(arenaH - cssH, camY));
  yilanState.camera.x = camX;
  yilanState.camera.y = camY;

  // Arka plan
  const grad = yilanCtx.createRadialGradient(cssW / 2, cssH / 2, 100, cssW / 2, cssH / 2, Math.max(cssW, cssH));
  grad.addColorStop(0, '#1a0b3a');
  grad.addColorStop(1, '#05021a');
  yilanCtx.fillStyle = grad;
  yilanCtx.fillRect(0, 0, cssW, cssH);

  // Kamera offsetli world coords
  yilanCtx.save();
  yilanCtx.translate(-camX, -camY);

  // Yıldızlar
  if (yilanState.starField) {
    for (const s of yilanState.starField) {
      yilanCtx.globalAlpha = s.a;
      yilanCtx.fillStyle = '#ffffff';
      yilanCtx.beginPath();
      yilanCtx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      yilanCtx.fill();
    }
    yilanCtx.globalAlpha = 1;
  }

  // Arena sınırı (kırmızımsı parlak çerçeve)
  yilanCtx.strokeStyle = 'rgba(255, 62, 138, 0.6)';
  yilanCtx.lineWidth = 4;
  yilanCtx.shadowColor = '#ff3e8a';
  yilanCtx.shadowBlur = 20;
  yilanCtx.strokeRect(0, 0, arenaW, arenaH);
  yilanCtx.shadowBlur = 0;

  // Grid (zayıf çizgiler)
  yilanCtx.strokeStyle = 'rgba(255,255,255,0.06)';
  yilanCtx.lineWidth = 1;
  const gridSize = 80;
  const startX = Math.floor(camX / gridSize) * gridSize;
  const startY = Math.floor(camY / gridSize) * gridSize;
  for (let x = startX; x < camX + cssW + gridSize; x += gridSize) {
    yilanCtx.beginPath();
    yilanCtx.moveTo(x, Math.max(0, camY));
    yilanCtx.lineTo(x, Math.min(arenaH, camY + cssH));
    yilanCtx.stroke();
  }
  for (let y = startY; y < camY + cssH + gridSize; y += gridSize) {
    yilanCtx.beginPath();
    yilanCtx.moveTo(Math.max(0, camX), y);
    yilanCtx.lineTo(Math.min(arenaW, camX + cssW), y);
    yilanCtx.stroke();
  }

  // Yemler — viewport içindekileri çiz
  const foodStyles = {
    small:  { r: 5,  color: '#ffd93d', glow: '#fff5b8', pulse: 0 },
    medium: { r: 8,  color: '#00d4ff', glow: '#a0eaff', pulse: 0.15 },
    large:  { r: 12, color: '#a86bff', glow: '#dfc9ff', pulse: 0.25 }
  };
  const t = Date.now() / 400;
  yilanState.foods.forEach(f => {
    if (f.x < camX - 30 || f.x > camX + cssW + 30 || f.y < camY - 30 || f.y > camY + cssH + 30) return;
    const s = foodStyles[f.type] || foodStyles.small;
    const r = s.r * (1 + Math.sin(t + (f.x + f.y) * 0.01) * s.pulse);
    yilanCtx.shadowColor = s.color;
    yilanCtx.shadowBlur = 12;
    yilanCtx.fillStyle = s.color;
    yilanCtx.beginPath();
    yilanCtx.arc(f.x, f.y, r, 0, Math.PI * 2);
    yilanCtx.fill();
    yilanCtx.shadowBlur = 0;
    yilanCtx.fillStyle = s.glow;
    yilanCtx.beginPath();
    yilanCtx.arc(f.x - r * 0.3, f.y - r * 0.3, r * 0.35, 0, Math.PI * 2);
    yilanCtx.fill();
  });

  // Yılanlar — önce ölüleri, sonra canlıları (canlılar üstte)
  const drawSnake = (snake) => {
    if (!snake.body || snake.body.length === 0) return;
    yilanCtx.globalAlpha = snake.alive ? 1 : 0.25;

    // Glow
    yilanCtx.shadowColor = snake.color;
    yilanCtx.shadowBlur = snake.boosting ? 22 : 12;

    // Gövde — kuyruktan başa doğru, kalınlık artarak
    const bodyLen = snake.body.length;
    yilanCtx.lineCap = 'round';
    yilanCtx.lineJoin = 'round';
    yilanCtx.strokeStyle = snake.color;
    yilanCtx.lineWidth = 14;
    yilanCtx.beginPath();
    yilanCtx.moveTo(snake.body[bodyLen - 1].x, snake.body[bodyLen - 1].y);
    for (let i = bodyLen - 2; i >= 0; i--) {
      yilanCtx.lineTo(snake.body[i].x, snake.body[i].y);
    }
    yilanCtx.stroke();

    yilanCtx.shadowBlur = 0;

    // Baş
    const head = snake.body[0];
    yilanCtx.fillStyle = snake.color;
    yilanCtx.beginPath();
    yilanCtx.arc(head.x, head.y, 10, 0, Math.PI * 2);
    yilanCtx.fill();

    // Boost halkası
    if (snake.boosting) {
      yilanCtx.strokeStyle = '#fff';
      yilanCtx.lineWidth = 2;
      yilanCtx.globalAlpha = 0.7;
      yilanCtx.beginPath();
      yilanCtx.arc(head.x, head.y, 13 + Math.sin(t * 3) * 2, 0, Math.PI * 2);
      yilanCtx.stroke();
      yilanCtx.globalAlpha = snake.alive ? 1 : 0.25;
    }

    // Gözler (yöne göre)
    const dir = snake.dir || { x: 1, y: 0 };
    const eyeDx = -dir.y * 3.5;
    const eyeDy = dir.x * 3.5;
    const eyeFwd = 3;
    yilanCtx.fillStyle = 'white';
    yilanCtx.beginPath();
    yilanCtx.arc(head.x + dir.x * eyeFwd + eyeDx, head.y + dir.y * eyeFwd + eyeDy, 2.8, 0, Math.PI * 2);
    yilanCtx.arc(head.x + dir.x * eyeFwd - eyeDx, head.y + dir.y * eyeFwd - eyeDy, 2.8, 0, Math.PI * 2);
    yilanCtx.fill();
    yilanCtx.fillStyle = '#0a0420';
    yilanCtx.beginPath();
    yilanCtx.arc(head.x + dir.x * (eyeFwd + 0.8) + eyeDx, head.y + dir.y * (eyeFwd + 0.8) + eyeDy, 1.3, 0, Math.PI * 2);
    yilanCtx.arc(head.x + dir.x * (eyeFwd + 0.8) - eyeDx, head.y + dir.y * (eyeFwd + 0.8) - eyeDy, 1.3, 0, Math.PI * 2);
    yilanCtx.fill();

    // İsim etiketi
    yilanCtx.font = 'bold 14px Fredoka, sans-serif';
    yilanCtx.textAlign = 'center';
    yilanCtx.fillStyle = 'rgba(0,0,0,0.6)';
    yilanCtx.fillText(snake.name, head.x + 1, head.y - 18 + 1);
    yilanCtx.fillStyle = 'white';
    yilanCtx.fillText(snake.name, head.x, head.y - 18);

    yilanCtx.globalAlpha = 1;
  };

  const all = Object.values(yilanState.snakes);
  all.filter(s => !s.alive).forEach(drawSnake);
  all.filter(s => s.alive).forEach(drawSnake);

  yilanCtx.restore();
}

// Render döngüsü (60fps, interpolasyon yok ama akıcı)
function startYilanRenderLoop() {
  if (yilanState.animFrame) return;
  const loop = () => {
    if (state.game !== 'yilan') {
      yilanState.animFrame = null;
      return;
    }
    drawYilan();
    yilanState.animFrame = requestAnimationFrame(loop);
  };
  yilanState.animFrame = requestAnimationFrame(loop);
}
function stopYilanRenderLoop() {
  if (yilanState.animFrame) {
    cancelAnimationFrame(yilanState.animFrame);
    yilanState.animFrame = null;
  }
}

function renderYilan() {
  const gs = state.gameState;
  if (!gs) return;
  if (gs.arenaW) yilanState.arenaW = gs.arenaW;
  if (gs.arenaH) yilanState.arenaH = gs.arenaH;
  buildStarField();
  resizeYilanCanvas();
  startYilanRenderLoop();

  document.getElementById('yilan-timer').textContent = gs.timeLeft;
  renderScoreboard('yilan-scoreboard', -1);

  const me = yilanState.snakes[state.you?.id];
  const statusEl = document.getElementById('yilan-status');
  if (me && !me.alive) {
    statusEl.textContent = '💀 Öldün — başkalarını izle';
    const deathOv = document.getElementById('yilan-death-overlay');
    if (deathOv) deathOv.style.display = '';
  } else {
    statusEl.textContent = 'WASD / oklar · SHIFT = boost (gövde harcar)';
    const deathOv = document.getElementById('yilan-death-overlay');
    if (deathOv) deathOv.style.display = 'none';
  }

  // Self stats
  const selfLen = document.getElementById('yilan-self-len');
  const selfScore = document.getElementById('yilan-self-score');
  if (selfLen) selfLen.textContent = `Uzunluk: ${me?.body?.length || 0}`;
  if (selfScore) selfScore.textContent = `Skor: ${me?.score || 0}`;

  // Lider tablosu — yılanları skoruna göre sırala
  const lb = document.getElementById('yilan-leaderboard-list');
  if (lb) {
    const entries = Object.entries(yilanState.snakes).sort(([,a], [,b]) => b.score - a.score).slice(0, 5);
    lb.innerHTML = entries.map(([id, s]) => `
      <li class="${s.alive ? '' : 'dead'} ${id === state.you?.id ? 'me' : ''}">
        <span class="dot" style="background:${s.color}"></span>
        <span class="lb-name">${escapeHtml(s.name || '?')}</span>
        <span class="lb-score">${s.score}</span>
      </li>
    `).join('');
  }

  // Oyun bitti
  const gameOverEl = document.getElementById('yilan-gameover');
  if (gs.gameOver) {
    document.getElementById('yilan-winner').textContent = gs.winner || 'Berabere';
    const sorted = [...state.players].sort((a, b) => b.score - a.score);
    const finalScores = document.getElementById('yilan-final-scores');
    finalScores.innerHTML = sorted.map((p, i) => `
      <div class="row ${i === 0 ? 'winner' : ''}">
        <span>${i + 1}. ${escapeHtml(p.name)}</span>
        <span>${p.score} puan</span>
      </div>
    `).join('');
    gameOverEl.style.display = 'flex';
    stopYilanRenderLoop();
  } else {
    gameOverEl.style.display = 'none';
  }
}

// ============================================================
// AMİRAL BATTI ARAYÜZÜ
// ============================================================
const amiralState = {
  shipSizes: [4, 3, 3, 2, 2],
  shipNames: ['4lü', '3lü', '3lü', '2li', '2li'],
  currentShipIndex: 0,
  placedShips: [],     // [{ name, cells: [{x,y}] }]
  orientation: 'horizontal', // 'horizontal' | 'vertical'
  hoverCell: null,
  myReady: false
};

document.getElementById('amiral-exit').addEventListener('click', exitGame);
document.getElementById('amiral-back-lobby').addEventListener('click', exitGame);
document.getElementById('amiral-rotate').addEventListener('click', () => {
  amiralState.orientation = amiralState.orientation === 'horizontal' ? 'vertical' : 'horizontal';
  updateCurrentShipLabel();
  updatePlacementVisuals();
});

// "Yerleştir" butonu — hoverCell pozisyonunda gemiyi koyar (mobil için kritik)
document.getElementById('amiral-place-here').addEventListener('click', () => {
  const idx = amiralState.currentShipIndex;
  if (idx >= amiralState.shipSizes.length) {
    showToast('Tüm gemiler yerleşti, Hazırım\'a bas!', '');
    return;
  }
  if (!amiralState.hoverCell) {
    showToast('Önce tahtada bir kareye dokun!', 'error');
    return;
  }
  const { x, y } = amiralState.hoverCell;
  const cells = getShipCells(x, y, amiralState.shipSizes[idx], amiralState.orientation);
  if (canPlaceShip(cells)) {
    amiralState.placedShips.push({ name: amiralState.shipNames[idx], cells });
    amiralState.currentShipIndex++;
    SFX.amiralPlace();
    updateCurrentShipLabel();
    updatePlacementVisuals();
  } else {
    SFX.error();
    showToast('Buraya yerleştiremezsin!', 'error');
  }
});
document.getElementById('amiral-restart').addEventListener('click', () => {
  amiralState.currentShipIndex = 0;
  amiralState.placedShips = [];
  amiralState.myReady = false;
  document.getElementById('amiral-waiting').style.display = 'none';
  updateCurrentShipLabel();
  updatePlacementVisuals();
});
document.getElementById('amiral-confirm').addEventListener('click', () => {
  socket.emit('amiral:place', { ships: amiralState.placedShips });
  amiralState.myReady = true;
  document.getElementById('amiral-waiting').style.display = 'block';
  document.getElementById('amiral-confirm').style.display = 'none';
});

// R tuşu ile döndürme
document.addEventListener('keydown', e => {
  if (state.game === 'amiral' && (e.key === 'r' || e.key === 'R')) {
    document.getElementById('amiral-rotate')?.click();
  }
});

function updateCurrentShipLabel() {
  const idx = amiralState.currentShipIndex;
  if (idx >= amiralState.shipSizes.length) {
    document.getElementById('amiral-current-ship').textContent = '✅ Tüm gemiler yerleşti!';
    document.getElementById('amiral-confirm').style.display = 'inline-flex';
  } else {
    document.getElementById('amiral-current-ship').textContent = 
      `${amiralState.shipNames[idx]} gemi (${amiralState.orientation === 'horizontal' ? 'yatay' : 'dikey'})`;
    document.getElementById('amiral-confirm').style.display = 'none';
  }
}

function getShipCells(startX, startY, size, orientation) {
  const cells = [];
  for (let i = 0; i < size; i++) {
    if (orientation === 'horizontal') {
      cells.push({ x: startX + i, y: startY });
    } else {
      cells.push({ x: startX, y: startY + i });
    }
  }
  return cells;
}

function canPlaceShip(cells) {
  for (const c of cells) {
    if (c.x < 0 || c.x >= 8 || c.y < 0 || c.y >= 8) return false;
    for (const ship of amiralState.placedShips) {
      for (const sc of ship.cells) {
        if (sc.x === c.x && sc.y === c.y) return false;
      }
    }
  }
  return true;
}

function renderAmiralPlacement(forceRedraw = false) {
  const board = document.getElementById('amiral-placement-board');
  
  // Sadece ilk açılışta veya zorla istenirse tam yeniden çiz
  if (forceRedraw || board.children.length !== 64) {
    board.innerHTML = '';
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const cell = document.createElement('div');
        cell.className = 'amiral-cell';
        cell.dataset.x = x;
        cell.dataset.y = y;
        board.appendChild(cell);
      }
    }
    // Event listener'ları sadece bir kez, board'a (event delegation)
    if (!board.dataset.bound) {
      board.dataset.bound = '1';
      board.addEventListener('mousemove', (e) => {
        const cell = e.target.closest('.amiral-cell');
        if (!cell) return;
        const x = parseInt(cell.dataset.x);
        const y = parseInt(cell.dataset.y);
        if (amiralState.hoverCell?.x === x && amiralState.hoverCell?.y === y) return;
        amiralState.hoverCell = { x, y };
        updatePlacementVisuals();
      });
      board.addEventListener('mouseleave', () => {
        amiralState.hoverCell = null;
        updatePlacementVisuals();
      });
      board.addEventListener('click', (e) => {
        const cell = e.target.closest('.amiral-cell');
        if (!cell) return;
        const idx = amiralState.currentShipIndex;
        if (idx >= amiralState.shipSizes.length) return;
        const x = parseInt(cell.dataset.x);
        const y = parseInt(cell.dataset.y);
        const cells = getShipCells(x, y, amiralState.shipSizes[idx], amiralState.orientation);
        if (canPlaceShip(cells)) {
          amiralState.placedShips.push({ name: amiralState.shipNames[idx], cells });
          amiralState.currentShipIndex++;
          updateCurrentShipLabel();
          updatePlacementVisuals();
        } else {
          showToast('Buraya yerleştiremezsin!', 'error');
        }
      });
      // Mobil destek için touch
      board.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const cell = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.amiral-cell');
        if (!cell) return;
        const x = parseInt(cell.dataset.x);
        const y = parseInt(cell.dataset.y);
        amiralState.hoverCell = { x, y };
        updatePlacementVisuals();
      }, { passive: false });
    }
  }
  updatePlacementVisuals();
}

// Sadece görseli güncelle (DOM elementlerini yeniden yaratma)
function updatePlacementVisuals() {
  const board = document.getElementById('amiral-placement-board');
  if (!board || board.children.length !== 64) return;
  
  const idx = amiralState.currentShipIndex;
  const currentSize = idx < amiralState.shipSizes.length ? amiralState.shipSizes[idx] : 0;
  
  let previewCells = [];
  let previewBad = false;
  if (amiralState.hoverCell && idx < amiralState.shipSizes.length) {
    previewCells = getShipCells(amiralState.hoverCell.x, amiralState.hoverCell.y, currentSize, amiralState.orientation);
    previewBad = !canPlaceShip(previewCells);
  }
  
  for (let i = 0; i < 64; i++) {
    const cell = board.children[i];
    const x = parseInt(cell.dataset.x);
    const y = parseInt(cell.dataset.y);
    
    cell.className = 'amiral-cell';

    // Yerleşmiş gemi? — pos bilgisiyle göster
    for (const ship of amiralState.placedShips) {
      const cells = [...ship.cells].sort((a, b) => (a.y - b.y) || (a.x - b.x));
      const idxInShip = cells.findIndex(c => c.x === x && c.y === y);
      if (idxInShip >= 0) {
        const orient = cells.every(c => c.y === cells[0].y) ? 'h' : 'v';
        let pos = 'mid';
        if (cells.length === 1) pos = 'single';
        else if (idxInShip === 0) pos = 'head';
        else if (idxInShip === cells.length - 1) pos = 'tail';
        cell.classList.add('ship', `ship-${orient}`, `ship-${pos}`);
        break;
      }
    }

    // Preview?
    if (previewCells.some(c => c.x === x && c.y === y)) {
      cell.classList.add(previewBad ? 'preview-bad' : 'preview');
    }
  }
}

// Gemi hücre haritası oluştur — her cell'in head/mid/tail + yön bilgisi
function buildShipCellMap(board) {
  const map = {};
  if (!board || !board.ships) return map;
  for (const ship of board.ships) {
    if (!ship.cells || ship.cells.length === 0) continue;
    const cells = [...ship.cells].sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const orient = cells.every(c => c.y === cells[0].y) ? 'h' : 'v';
    cells.forEach((c, i) => {
      let pos = 'mid';
      if (cells.length === 1) pos = 'single';
      else if (i === 0) pos = 'head';
      else if (i === cells.length - 1) pos = 'tail';
      map[`${c.x},${c.y}`] = { pos, orient, sunk: !!ship.sunk, len: cells.length };
    });
  }
  return map;
}

let _amiralLastMoveKey = null;
function renderAmiralBattle() {
  const gs = state.gameState;
  if (!gs) return;

  const myId = state.you?.id;
  const isParticipant = gs.players?.includes(myId);
  const isMyTurn = gs.currentTurn === myId;
  const opponent = gs.players?.find(pid => pid !== myId);
  const myBoard = gs.boards?.[myId];
  const opponentBoard = gs.boards?.[opponent];
  const lastMove = gs.lastMove;

  // Ses efektleri: yeni hamle algıla
  if (lastMove) {
    const key = `${lastMove.shooter}-${lastMove.x}-${lastMove.y}`;
    if (key !== _amiralLastMoveKey) {
      _amiralLastMoveKey = key;
      if (lastMove.sunkShip) SFX.amiralSunk();
      else if (lastMove.hit) SFX.amiralHit();
      else SFX.amiralMiss();
    }
  }

  // Sıra durumu
  const turnInfo = document.getElementById('amiral-opponent-turn');
  if (!isParticipant) {
    turnInfo.textContent = '👀 İzliyorsun';
    turnInfo.classList.add('waiting');
  } else if (isMyTurn) {
    turnInfo.textContent = '🎯 Sıra sende! Bir kareye tıkla.';
    turnInfo.classList.remove('waiting');
  } else {
    const oppName = state.players.find(p => p.id === opponent)?.name;
    turnInfo.textContent = `⏳ ${oppName} oynuyor...`;
    turnInfo.classList.add('waiting');
  }

  // Kalan gemiler
  if (myBoard) {
    const remaining = myBoard.ships.filter(s => !s.sunk).length;
    document.getElementById('amiral-my-ships').textContent = `${remaining}/5 gemi kaldı`;
  }

  // Rakibin tahtası (atış yapacağım yer)
  const oppDiv = document.getElementById('amiral-opponent-board');
  oppDiv.innerHTML = '';
  // Rakibin gemilerinden sadece batanları görebiliriz
  const oppSunkShipMap = {};
  if (opponentBoard && opponentBoard.ships) {
    const sunkShips = opponentBoard.ships.filter(s => s.sunk);
    for (const ship of sunkShips) {
      const cells = [...ship.cells].sort((a, b) => (a.y - b.y) || (a.x - b.x));
      const orient = cells.every(c => c.y === cells[0].y) ? 'h' : 'v';
      cells.forEach((c, i) => {
        let pos = 'mid';
        if (cells.length === 1) pos = 'single';
        else if (i === 0) pos = 'head';
        else if (i === cells.length - 1) pos = 'tail';
        oppSunkShipMap[`${c.x},${c.y}`] = { pos, orient, sunk: true };
      });
    }
  }
  const myShots = myBoard?.shots || [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const cell = document.createElement('div');
      cell.className = 'amiral-cell';
      cell.dataset.coord = `${'ABCDEFGH'[x]}${y + 1}`;

      const shipInfo = oppSunkShipMap[`${x},${y}`];
      if (shipInfo) {
        cell.classList.add('ship', `ship-${shipInfo.orient}`, `ship-${shipInfo.pos}`, 'ship-sunk');
      }

      const shot = myShots.find(s => s.x === x && s.y === y);
      if (shot) {
        cell.classList.add(shot.hit ? 'hit' : 'miss');
        cell.classList.add('disabled');
        cell.innerHTML = shot.hit ? '<span class="hit-mark">💥</span>' : '<span class="miss-mark">●</span>';
        if (shot.hit && shipInfo?.sunk) cell.classList.add('sunk');
      } else if (isMyTurn && isParticipant) {
        cell.classList.add('targetable');
        cell.addEventListener('click', () => {
          SFX.amiralShoot();
          socket.emit('amiral:shoot', { x, y });
        });
      } else {
        cell.classList.add('disabled');
      }

      // Son atış vurgusu (ben opp'a vurmuşsam)
      if (lastMove && lastMove.shooter === myId && lastMove.x === x && lastMove.y === y) {
        cell.classList.add('last-shot');
      }

      oppDiv.appendChild(cell);
    }
  }

  // Benim tahtam (kendi gemilerimi görüyorum)
  const myDiv = document.getElementById('amiral-my-board');
  myDiv.innerHTML = '';
  const myShipMap = buildShipCellMap(myBoard);
  const opponentShots = opponentBoard?.shots || [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const cell = document.createElement('div');
      cell.className = 'amiral-cell disabled';
      cell.dataset.coord = `${'ABCDEFGH'[x]}${y + 1}`;

      const shipInfo = myShipMap[`${x},${y}`];
      if (shipInfo) {
        cell.classList.add('ship', `ship-${shipInfo.orient}`, `ship-${shipInfo.pos}`);
        if (shipInfo.sunk) cell.classList.add('ship-sunk');
      }

      const shot = opponentShots.find(s => s.x === x && s.y === y);
      if (shot) {
        cell.innerHTML = shot.hit ? '<span class="hit-mark">💥</span>' : '<span class="miss-mark">●</span>';
        cell.classList.add(shot.hit ? 'hit' : 'miss');
        if (shot.hit && shipInfo?.sunk) cell.classList.add('sunk');
      }

      // Son atış vurgusu (opp bana vurmuşsa)
      if (lastMove && lastMove.shooter && lastMove.shooter !== myId && lastMove.x === x && lastMove.y === y) {
        cell.classList.add('last-shot');
      }

      myDiv.appendChild(cell);
    }
  }

  // Log
  const log = document.getElementById('amiral-log');
  if (gs.lastMove) {
    const m = gs.lastMove;
    let msg = `${m.shooterName} (${m.x+1}, ${m.y+1}): `;
    let cls = '';
    if (m.sunkShip) { msg += `🔥 ${m.sunkShip} BATTI!`; cls = 'sunk'; }
    else if (m.hit) { msg += '🎯 İSABET!'; cls = 'hit'; }
    else { msg += 'ıska'; }
    // Sadece son hamle log'da gösteriliyor (sunucu sadece son hamleyi tutuyor)
    log.innerHTML = `<div class="log-entry ${cls}">${msg}</div>`;
  } else {
    log.innerHTML = '<div class="log-entry">Savaş başladı!</div>';
  }
}

function renderAmiral() {
  const gs = state.gameState;
  if (!gs) return;

  const myId = state.you?.id;
  const isParticipant = gs.players?.includes(myId);

  if (gs.phase === 'placement') {
    document.getElementById('amiral-placement').style.display = 'block';
    document.getElementById('amiral-battle').style.display = 'none';
    
    if (!isParticipant) {
      document.getElementById('amiral-status').textContent = '👀 İzleyicisin. Oyuncular gemilerini yerleştiriyor...';
      const board = document.getElementById('amiral-placement-board');
      if (board.children.length !== 1 || board.firstChild?.tagName !== 'P') {
        board.innerHTML = '<p style="text-align:center;padding:40px;color:var(--color-text-light)">2 oyuncu yerleştirme yapıyor...</p>';
      }
      document.querySelector('.amiral-place-controls').style.display = 'none';
    } else {
      document.querySelector('.amiral-place-controls').style.display = 'flex';
      document.getElementById('amiral-status').textContent = amiralState.myReady ? 
        'Hazırsın! Rakip bekleniyor...' : 'Gemilerini yerleştir!';
      
      if (!amiralState.myReady) {
        // Board zaten çizilmemişse çiz (yoksa sadece görseli güncelle)
        const board = document.getElementById('amiral-placement-board');
        if (board.children.length !== 64) {
          renderAmiralPlacement(true);
        } else {
          updatePlacementVisuals();
        }
        updateCurrentShipLabel();
      }
      // Karşı taraf hazır mı kontrol
      const opponentReady = gs.players.some(pid => pid !== myId && gs.boards[pid]?.ready);
      if (amiralState.myReady && !opponentReady) {
        document.getElementById('amiral-waiting').style.display = 'block';
      } else if (amiralState.myReady && opponentReady) {
        // İki taraf da hazır, savaş başlayacak
        document.getElementById('amiral-waiting').style.display = 'none';
      }
    }
  } else if (gs.phase === 'battle') {
    document.getElementById('amiral-placement').style.display = 'none';
    document.getElementById('amiral-battle').style.display = 'block';
    document.getElementById('amiral-status').textContent = isParticipant ? '⚔️ Savaş!' : '👀 İzliyorsun';
    renderAmiralBattle();
  } else if (gs.phase === 'gameOver' || gs.gameOver) {
    renderAmiralBattle();
  }

  const gameOverEl = document.getElementById('amiral-gameover');
  if (gs.gameOver) {
    document.getElementById('amiral-winner').textContent = gs.winner || '-';
    gameOverEl.style.display = 'flex';
  } else {
    gameOverEl.style.display = 'none';
  }
}

// Amiral state sıfırlama (yeni oyun başlangıcında)
function resetAmiralState() {
  amiralState.currentShipIndex = 0;
  amiralState.placedShips = [];
  amiralState.orientation = 'horizontal';
  amiralState.hoverCell = null;
  amiralState.myReady = false;
  // Placement board'u sıfırla (event delegation bayrağı dahil)
  const board = document.getElementById('amiral-placement-board');
  if (board) {
    board.innerHTML = '';
    delete board.dataset.bound;
  }
  const waiting = document.getElementById('amiral-waiting');
  if (waiting) waiting.style.display = 'none';
}

// ============================================================
// UNO BENZERİ ARAYÜZÜ
// ============================================================
const unoState = {
  myHand: [],
  pendingPlay: null // joker oynandığında renk bekleniyor mu
};

document.getElementById('uno-exit').addEventListener('click', exitGame);
document.getElementById('uno-back-lobby').addEventListener('click', exitGame);

document.getElementById('uno-deck').addEventListener('click', () => {
  SFX.unoDraw();
  socket.emit('uno:draw');
});

// UNO! butonu
document.getElementById('uno-call-btn').addEventListener('click', () => {
  SFX.unoCall();
  socket.emit('uno:call');
});

// Renk seçici
document.querySelectorAll('.picker-color').forEach(btn => {
  btn.addEventListener('click', () => {
    if (unoState.pendingPlay !== null) {
      const playingCard = unoState.myHand[unoState.pendingPlay.cardIndex];
      if (playingCard?.value === '+4') SFX.unoPlus4();
      else SFX.unoPlay();
      socket.emit('uno:play', {
        cardIndex: unoState.pendingPlay.cardIndex,
        pickColor: btn.dataset.color
      });
      unoState.pendingPlay = null;
      document.getElementById('uno-color-picker').style.display = 'none';
    }
  });
});

function unoCardCanPlay(card, gs) {
  if (!gs) return false;
  if (gs.drawStack > 0) {
    return card.value === '+2' || card.value === '+4';
  }
  if (card.color === 'joker') return true;
  if (card.color === gs.currentColor) return true;
  if (card.value === gs.currentValue) return true;
  return false;
}

function unoCardLabel(card) {
  const valueMap = {
    '+2': '+2', '+4': '+4', 'donus': '⥃', 'pas': '⊘', 'joker': '★'
  };
  return valueMap[card.value] || String(card.value);
}

// Orijinal Uno görünümlü kart HTML'i oluştur
function buildUnoCardHTML(card, colorOverride) {
  const color = colorOverride || card.color;
  const label = unoCardLabel(card);
  const isJoker = color === 'joker';
  return `
    <span class="corner tl">${label}</span>
    <div class="oval">
      <span class="big">${label}</span>
    </div>
    <span class="corner br">${label}</span>
  `;
}

function renderUno() {
  const gs = state.gameState;
  if (!gs) return;

  // Üst bilgi
  const currentPlayer = state.players[gs.currentPlayerIndex];
  document.getElementById('uno-current-player').textContent = 
    currentPlayer ? currentPlayer.name + (currentPlayer.id === state.you?.id ? ' (SEN)' : '') : '-';
  document.getElementById('uno-direction').textContent = gs.direction === 1 ? '→' : '←';
  
  const colorDot = document.getElementById('uno-color-dot');
  colorDot.className = 'uno-color-dot';
  if (gs.currentColor && gs.currentColor !== 'joker') {
    colorDot.classList.add(gs.currentColor);
  }

  // Oyuncu çubuğu (herkesin kart sayısı + UNO yakala butonları)
  const playersBar = document.getElementById('uno-players-bar');
  playersBar.innerHTML = '';
  const unoPending = gs.unoPending || {};
  state.players.forEach((p, i) => {
    const pill = document.createElement('div');
    pill.className = 'uno-player-pill';
    if (i === gs.currentPlayerIndex) pill.classList.add('active');
    const handCount = gs.hands?.[p.id]?.length || 0;
    const pendingForThis = unoPending[p.id];

    let trailing = '';
    // 1 kart kaldıysa ve henüz "UNO" demediyse — yakalama hakkı
    if (pendingForThis && !pendingForThis.called && !pendingForThis.caught && p.id !== state.you?.id) {
      trailing = `<button class="btn-uno-catch" data-target="${p.id}">🪤 Yakala!</button>`;
    } else if (pendingForThis && pendingForThis.called) {
      trailing = `<span class="uno-called-tag">📢 UNO!</span>`;
    }

    pill.innerHTML = `
      <span>${escapeHtml(p.name)}${p.id === state.you?.id ? ' (sen)' : ''}</span>
      <span class="card-count">${handCount}</span>
      ${trailing}
    `;
    playersBar.appendChild(pill);
  });

  // Yakala butonları
  playersBar.querySelectorAll('.btn-uno-catch').forEach(btn => {
    btn.addEventListener('click', () => {
      SFX.unoCatch();
      socket.emit('uno:catch', { targetId: btn.dataset.target });
    });
  });

  // Kendi UNO butonu — 1 karta düşmüş ve henüz çağırmadıysam
  const myPending = state.you ? unoPending[state.you.id] : null;
  const callBtn = document.getElementById('uno-call-btn');
  if (callBtn) {
    const myHandCount = state.you ? (gs.hands?.[state.you.id]?.length || 0) : 0;
    if (myHandCount === 1 && myPending && !myPending.called && !myPending.caught) {
      callBtn.style.display = '';
    } else {
      callBtn.style.display = 'none';
    }
  }

  // Discard (en üstteki kart)
  const discardDiv = document.getElementById('uno-discard');
  discardDiv.innerHTML = '';
  if (gs.discard && gs.discard.length) {
    const top = gs.discard[gs.discard.length - 1];
    const displayColor = (top.color === 'joker' && gs.currentColor && gs.currentColor !== 'joker') ? gs.currentColor : top.color;
    const card = document.createElement('div');
    card.className = 'uno-card ' + displayColor;
    if (top.value === '+4') card.dataset.value = '+4';
    card.innerHTML = buildUnoCardHTML(top, displayColor);
    discardDiv.appendChild(card);
    const label = document.createElement('span');
    label.className = 'uno-deck-label';
    label.textContent = 'Atılan';
    discardDiv.appendChild(label);
  }

  // Deck bilgisi (kalan kart sayısı yerine "Çek")
  // Drawstack varsa göster
  const deckLabel = document.querySelector('#uno-deck .uno-deck-label');
  if (gs.drawStack > 0) {
    deckLabel.textContent = `Çek (+${gs.drawStack})`;
    deckLabel.style.color = 'var(--color-danger)';
    deckLabel.style.fontWeight = '700';
  } else {
    deckLabel.textContent = 'Çek';
    deckLabel.style.color = '';
    deckLabel.style.fontWeight = '';
  }

  // Log
  const log = document.getElementById('uno-log');
  if (gs.log && gs.log.length) {
    log.innerHTML = gs.log.map(l => `<div class="uno-log-entry">${escapeHtml(l)}</div>`).join('');
  } else {
    log.innerHTML = '';
  }

  // Kendi elim
  const handDiv = document.getElementById('uno-hand');
  handDiv.innerHTML = '';
  const isMyTurn = currentPlayer?.id === state.you?.id;
  unoState.myHand.forEach((card, idx) => {
    const cardEl = document.createElement('div');
    cardEl.className = 'uno-card ' + card.color;
    if (card.value === '+4') cardEl.dataset.value = '+4';
    cardEl.innerHTML = buildUnoCardHTML(card);
    if (isMyTurn && unoCardCanPlay(card, gs)) {
      cardEl.classList.add('playable');
      cardEl.addEventListener('click', () => {
        if (card.color === 'joker') {
          // Renk seç
          unoState.pendingPlay = { cardIndex: idx };
          document.getElementById('uno-color-picker').style.display = 'flex';
        } else {
          // Karta göre ses
          if (card.value === '+2') SFX.unoPlus2();
          else if (card.value === 'donus') SFX.unoReverse();
          else if (card.value === 'pas') SFX.unoSkip();
          else SFX.unoPlay();
          socket.emit('uno:play', { cardIndex: idx });
        }
      });
    } else {
      cardEl.classList.add('disabled');
    }
    handDiv.appendChild(cardEl);
  });

  // Oyun bitti
  const gameOverEl = document.getElementById('uno-gameover');
  if (gs.gameOver) {
    document.getElementById('uno-winner').textContent = gs.winner || '-';
    gameOverEl.style.display = 'flex';
  } else {
    gameOverEl.style.display = 'none';
  }
}

// ============================================================
// SOCKET.IO OLAYLARI
// ============================================================
socket.on('room:joined', ({ code, you }) => {
  state.roomCode = code;
  state.you = you;
  pendingJoin = null;
  const pm = document.getElementById('password-modal');
  if (pm) pm.style.display = 'none';
  showScreen('screen-lobby');
});

socket.on('room:update', (data) => {
  state.roomCode = data.code;
  state.host = data.host;
  state.players = data.players.map(p => ({
    ...p,
    eliminated: state.players.find(op => op.id === p.id)?.eliminated || false
  }));
  state.game = data.game;
  state.gameState = data.gameState;
  state.settings = data.settings || state.settings;
  state.lobbyChat = data.lobbyChat || [];

  // Lobi sohbeti güncelle (lobby ekranındaysa)
  renderLobbyChat();

  // Eliminated bilgisi gameState'ten geliyor
  if (data.gameState) {
    state.players = data.players;
  }

  // Sıra bildirimi
  checkMyTurnNotification(data);

  // Oyun bitti tespit → konfeti + ses
  checkGameOverCelebration(data);

  // Host-only butonlar
  updateHostOnlyVisibility();

  // Ready panel (settings modal açıksa güncelle)
  if (settingsModal.style.display !== 'none') renderReadyPanel();

  // Ayarlar modalı açıksa güncelle
  if (settingsModal && settingsModal.style.display === 'flex') {
    applySettingsToUI();
  }

  // Hangi ekran?
  if (!data.game) {
    showScreen('screen-lobby');
    renderLobby();
  } else if (data.game === 'kelime-zinciri') {
    showScreen('screen-kelime');
    renderKelimeZinciri();
  } else if (data.game === 'hafiza') {
    showScreen('screen-hafiza');
    renderHafiza();
  } else if (data.game === 'cizim') {
    if (document.getElementById('screen-cizim').classList.contains('active') === false) {
      showScreen('screen-cizim');
      setTimeout(setupCanvas, 50);
    } else {
      showScreen('screen-cizim');
    }
    renderCizim();
  } else if (data.game === 'trivia') {
    showScreen('screen-trivia');
    renderTrivia();
  } else if (data.game === 'vampir') {
    showScreen('screen-vampir');
    renderVampir();
  } else if (data.game === 'yilan') {
    showScreen('screen-yilan');
    renderYilan();
  } else if (data.game === 'amiral') {
    // Yeni oyun başlangıcında state'i sıfırla
    if (!document.getElementById('screen-amiral').classList.contains('active')) {
      resetAmiralState();
    }
    showScreen('screen-amiral');
    renderAmiral();
  } else if (data.game === 'uno') {
    showScreen('screen-uno');
    renderUno();
  }
});

socket.on('room:error', ({ message }) => {
  // Şifre yanlışsa modal'da inline göster (toast yok)
  if (/şifre yanlış/i.test(message) && pendingJoin) {
    const errEl = document.getElementById('password-error');
    const pwInput = document.getElementById('join-password');
    if (errEl) errEl.textContent = '❌ ' + message;
    if (pwInput) { pwInput.value = ''; pwInput.focus(); }
    return;
  }
  showToast(message, 'error');
});

socket.on('game:countdown', () => {
  showCountdown();
});

socket.on('kelime:timer', ({ timeLeft }) => {
  if (state.gameState) state.gameState.timeLeft = timeLeft;
  const el = document.getElementById('kelime-timer');
  if (el) el.textContent = timeLeft;
});

socket.on('kelime:error', ({ message }) => {
  SFX.kelimeErr();
  const errEl = document.getElementById('kelime-error');
  if (errEl) {
    errEl.textContent = '❌ ' + message;
    setTimeout(() => { errEl.textContent = ''; }, 3000);
  }
});

socket.on('kelime:skipped', ({ message }) => {
  showToast('↪ ' + message, '');
});

socket.on('kelime:letterChanged', ({ playerName, from, to }) => {
  SFX.kelimeChange();
  showToast(`🔀 ${playerName} harfi değiştirdi: ${from} → ${to}`, '');
});

socket.on('kelime:passUsed', ({ playerName }) => {
  SFX.kelimePass();
  showToast(`⏭️ ${playerName} pas geçti`, '');
});

socket.on('kelime:lifeLost', ({ playerName, livesLeft }) => {
  SFX.kelimeLife();
  if (livesLeft > 0) {
    showToast(`💔 ${playerName} can kaybetti (${livesLeft} kaldı)`, '');
  } else {
    showToast(`☠️ ${playerName} elendi!`, 'error');
  }
});

// --- ÇİZİM-TAHMİN ---
socket.on('cizim:word', ({ word }) => {
  // Sadece çizen oyuncuya geliyor
  cizimState.secretWord = word;
  renderCizim();
});

socket.on('cizim:stroke', (stroke) => {
  // Çizen kendisi zaten görüyor, başkalarına çiz
  if (!isCurrentDrawer()) {
    drawStroke(stroke);
  }
});

socket.on('cizim:clear', () => {
  if (!isCurrentDrawer()) {
    clearCanvas();
  }
});

socket.on('cizim:timer', ({ timeLeft }) => {
  if (state.gameState) state.gameState.timeLeft = timeLeft;
  const el = document.getElementById('cizim-timer');
  if (el) el.textContent = timeLeft;
});

socket.on('cizim:reveal', ({ word, summary }) => {
  SFX.cizimReveal();
  // Eğer ben doğru bildiysem ekstra ses
  const me = summary?.find(s => s.id === state.you?.id);
  if (me && me.guessed) setTimeout(() => SFX.cizimCorrect(), 150);
  // Tur sonu - canvas'ı temizle, yeni tur başlamadan önce
  setTimeout(() => {
    clearCanvas();
    cizimState.secretWord = null;
  }, 5500);
});

// Kelime seçim seçenekleri (sadece çizene)
socket.on('cizim:wordChoices', ({ words }) => {
  SFX.notify();
  const modal = document.getElementById('cizim-word-select');
  if (!modal || !words || words.length < 2) return;
  document.getElementById('cizim-word-0').textContent = words[0];
  document.getElementById('cizim-word-1').textContent = words[1];
  modal.style.display = 'flex';
});

socket.on('cizim:selectTimer', ({ timeLeft }) => {
  if (state.gameState) state.gameState.wordSelectTime = timeLeft;
  const el = document.getElementById('cizim-select-timer');
  if (el) el.textContent = timeLeft;
  const topTimer = document.getElementById('cizim-timer');
  if (topTimer && state.gameState?.phase === 'wordSelect') topTimer.textContent = timeLeft;
});

socket.on('cizim:undo', ({ strokes }) => {
  // Tüm istemciler canvas'ı sıfırlayıp stroke listesini yeniden çizer
  clearCanvas();
  if (Array.isArray(strokes)) {
    strokes.forEach(s => drawStroke(s));
  }
});

socket.on('cizim:hintRevealed', ({ level, hint }) => {
  SFX.cizimHint();
  if (state.gameState) {
    state.gameState.hintLevel = level;
    state.gameState.wordHint = hint;
  }
  renderCizim();
  showToast(`💡 İpucu açıldı (seviye ${level})`, '');
});

socket.on('cizim:hintError', ({ message }) => {
  showToast(message, 'error');
});

// --- TRIVIA ---
socket.on('trivia:timer', ({ timeLeft }) => {
  if (state.gameState) state.gameState.timeLeft = timeLeft;
  const el = document.getElementById('trivia-timer');
  if (el) el.textContent = timeLeft;
  // Son 3 saniyede tick
  if (timeLeft > 0 && timeLeft <= 3 && state.gameState?.phase === 'question') SFX.triviaTick();
});

socket.on('trivia:answerCount', ({ count, total }) => {
  if (triviaSelected !== -1) {
    const status = document.getElementById('trivia-status');
    if (status) status.textContent = `✓ Cevap verildi (${count}/${total} kişi cevapladı)`;
  }
});

socket.on('trivia:fiftyResult', ({ eliminated }) => {
  SFX.triviaFifty();
  triviaFiftyEliminated = eliminated || [];
  renderTrivia();
  showToast('50:50 kullanıldı — 2 yanlış şık elendi', '');
});

socket.on('trivia:jokerError', ({ message }) => {
  showToast(message, 'error');
});

// --- VAMPİR KÖYLÜ ---
socket.on('vampir:role', ({ role }) => {
  vampirState.myRole = role;
  vampirState.teammates = [];
  vampirState.selectedTarget = null;
  vampirState.detectiveResults = [];
  renderVampir();
});

socket.on('vampir:teammates', ({ teammates }) => {
  vampirState.teammates = teammates;
  if (teammates.length > 0) {
    showToast('🧛 Vampir takımın: ' + teammates.join(', '), 'success');
  } else {
    showToast('🧛 Tek vampir sensin!', 'success');
  }
});

socket.on('vampir:detectiveResult', ({ targetName, isVampire }) => {
  vampirState.detectiveResults.push({ name: targetName, isVampire });
  if (isVampire) {
    showToast(`⚠️ ${targetName} VAMPİR!`, 'error');
  } else {
    showToast(`✅ ${targetName} vampir değil`, 'success');
  }
  renderVampir();
});

socket.on('vampir:actionConfirm', ({ message }) => {
  showToast(message, 'success');
});

socket.on('vampir:vampireVotes', ({ votes }) => {
  // Vampirlerin birbirinin oyunu görmesi için
  const messages = Object.entries(votes).map(([voter, target]) => `${voter} → ${target}`);
  if (messages.length > 0) {
    showToast('🧛 Vampir oyları: ' + messages.join(' | '), '');
  }
});

socket.on('vampir:timer', ({ timeLeft }) => {
  if (state.gameState) state.gameState.timeLeft = timeLeft;
  const el = document.getElementById('vampir-timer');
  if (el) el.textContent = timeLeft;
});

// --- YILAN SAVAŞI ---
let _yilanLastScore = 0;
let _yilanWasAlive = true;
socket.on('yilan:tick', ({ snakes, foods, timeLeft }) => {
  // Ses tespiti: kendi skorum arttıysa yedim, alive→dead olduysam öldüm
  const me = snakes[state.you?.id];
  if (me) {
    if (me.score > _yilanLastScore) {
      const diff = me.score - _yilanLastScore;
      if (diff >= 5) SFX.yilanEatLarge();
      else if (diff >= 3) SFX.yilanEatMed();
      else SFX.yilanEat();
    }
    if (_yilanWasAlive && !me.alive) {
      SFX.yilanDeath();
      // Ölüm overlay'i ve statüsünü doğrudan güncelle (room:update beklemeden)
      const deathOv = document.getElementById('yilan-death-overlay');
      if (deathOv) deathOv.style.display = '';
      const statusEl = document.getElementById('yilan-status');
      if (statusEl) statusEl.textContent = '💀 Öldün — başkalarını izle';
    }
    // Yeniden canlanma (örn. tekrar oyna) durumunda overlay'i kapat
    if (!_yilanWasAlive && me.alive) {
      const deathOv = document.getElementById('yilan-death-overlay');
      if (deathOv) deathOv.style.display = 'none';
    }
    _yilanLastScore = me.score;
    _yilanWasAlive = me.alive;

    // Self stat anlık güncelle
    const selfLen = document.getElementById('yilan-self-len');
    const selfScore = document.getElementById('yilan-self-score');
    if (selfLen) selfLen.textContent = `Uzunluk: ${me?.body?.length || 0}`;
    if (selfScore) selfScore.textContent = `Skor: ${me?.score || 0}`;
  }
  // Lider tablosu anlık güncelle
  const lb = document.getElementById('yilan-leaderboard-list');
  if (lb) {
    const entries = Object.entries(snakes).sort(([,a], [,b]) => b.score - a.score).slice(0, 5);
    lb.innerHTML = entries.map(([id, s]) => `
      <li class="${s.alive ? '' : 'dead'} ${id === state.you?.id ? 'me' : ''}">
        <span class="dot" style="background:${s.color}"></span>
        <span class="lb-name">${escapeHtml(s.name || '?')}</span>
        <span class="lb-score">${s.score}</span>
      </li>
    `).join('');
  }
  yilanState.snakes = snakes;
  yilanState.foods = foods;
  if (state.gameState) {
    state.gameState.timeLeft = timeLeft;
    for (const id in snakes) {
      const p = state.players.find(p => p.id === id);
      if (p) p.score = snakes[id].score;
    }
  }
  // Render loop kendi çizimini yapar (rAF)
  // Timer'ı güncelle (her saniyede bir yapsak yeterli ama burada her tick'te güncel olur)
  const timerEl = document.getElementById('yilan-timer');
  if (timerEl) timerEl.textContent = timeLeft;
});

// --- AMİRAL BATTI ---
socket.on('amiral:error', ({ message }) => {
  showToast(message, 'error');
});

// --- UNO ---
socket.on('uno:hand', ({ cards }) => {
  unoState.myHand = cards;
  renderUno();
});

socket.on('uno:error', ({ message }) => {
  showToast(message, 'error');
});

socket.on('disconnect', () => {
  showToast('Sunucu bağlantısı koptu! Sayfayı yenile.', 'error');
});

socket.on('connect', () => {
  console.log('Bağlandı:', socket.id);
});

// ============================================================
// YARDIMCILAR
// ============================================================
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Sayfa kapanırken temiz çık
window.addEventListener('beforeunload', () => {
  socket.emit('room:leave');
});

// Canvas yeniden boyutlandırma (çizim ekranı açıkken)
window.addEventListener('resize', () => {
  if (document.getElementById('screen-cizim').classList.contains('active')) {
    setupCanvas();
  }
});
