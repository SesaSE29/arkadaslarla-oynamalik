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
document.getElementById('btn-create').addEventListener('click', () => {
  const name = document.getElementById('create-name').value.trim();
  if (!name) {
    showToast('Bir ad gir!', 'error');
    return;
  }
  socket.emit('room:create', { name });
});

document.getElementById('btn-join').addEventListener('click', () => {
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!name) {
    showToast('Bir ad gir!', 'error');
    return;
  }
  if (code.length !== 4) {
    showToast('Oda kodu 4 karakter olmalı!', 'error');
    return;
  }
  socket.emit('room:join', { code, name });
});

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
}

document.getElementById('settings-close').addEventListener('click', closeSettings);
document.getElementById('settings-cancel').addEventListener('click', closeSettings);

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

    const initial = (p.name[0] || '?').toUpperCase();
    const colors = ['#ff3e8a', '#00d4ff', '#ffd93d', '#6bcf7f', '#a86bff', '#ff9f4a', '#4ade80', '#f472b6'];
    const color = colors[p.name.charCodeAt(0) % colors.length];

    li.innerHTML = `
      <span class="player-avatar" style="background:${color}">${initial}</span>
      <span class="player-name-text">${escapeHtml(p.name)}</span>
      ${p.id === state.host ? '<span class="player-tag">👑 HOST</span>' : ''}
      ${p.id === state.you?.id && p.id !== state.host ? '<span class="player-tag you">SEN</span>' : ''}
    `;
    list.appendChild(li);
  });

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

  // İpucu butonu durumu
  const hintBtn = document.getElementById('cizim-hint');
  if (hintBtn) {
    if ((gs.hintLevel || 0) >= (gs.maxHintLevel || 2)) {
      hintBtn.disabled = true;
      hintBtn.textContent = '💡 İpucu (bitti)';
    } else {
      hintBtn.disabled = false;
      const nextLabel = (gs.hintLevel === 0) ? '#1 Harf sayısı (-30% puan)' : '#2 Baş harf (-50% puan)';
      hintBtn.textContent = `💡 ${nextLabel}`;
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

function renderVampir() {
  const gs = state.gameState;
  if (!gs) return;

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
    const sorted = Object.values(yilanState.snakes).sort((a, b) => b.score - a.score).slice(0, 5);
    lb.innerHTML = sorted.map(s => `
      <li class="${s.alive ? '' : 'dead'} ${s.id === state.you?.id ? 'me' : ''}">
        <span class="dot" style="background:${s.color}"></span>
        <span class="lb-name">${escapeHtml(s.name)}</span>
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
    
    // Yerleşmiş gemi?
    for (const ship of amiralState.placedShips) {
      if (ship.cells.some(c => c.x === x && c.y === y)) {
        cell.classList.add('ship');
        break;
      }
    }
    
    // Preview?
    if (previewCells.some(c => c.x === x && c.y === y)) {
      cell.classList.add(previewBad ? 'preview-bad' : 'preview');
    }
  }
}

function renderAmiralBattle() {
  const gs = state.gameState;
  if (!gs) return;

  const myId = state.you?.id;
  const isParticipant = gs.players?.includes(myId);
  const isMyTurn = gs.currentTurn === myId;
  const opponent = gs.players?.find(pid => pid !== myId);
  const myBoard = gs.boards?.[myId];
  const opponentBoard = gs.boards?.[opponent];

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
  const myShots = myBoard?.shots || [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const cell = document.createElement('div');
      cell.className = 'amiral-cell';
      const shot = myShots.find(s => s.x === x && s.y === y);
      if (shot) {
        cell.textContent = shot.hit ? '🔥' : '·';
        cell.classList.add(shot.hit ? 'hit' : 'miss');
        cell.classList.add('disabled');
        // Battı mı kontrolü
        if (shot.hit && opponentBoard) {
          const sunkShip = opponentBoard.ships.find(s => s.sunk && s.cells.some(c => c.x === x && c.y === y));
          if (sunkShip) cell.classList.add('sunk');
        }
      } else if (isMyTurn && isParticipant) {
        cell.addEventListener('click', () => {
          socket.emit('amiral:shoot', { x, y });
        });
      } else {
        cell.classList.add('disabled');
      }
      oppDiv.appendChild(cell);
    }
  }

  // Benim tahtam
  const myDiv = document.getElementById('amiral-my-board');
  myDiv.innerHTML = '';
  const opponentShots = opponentBoard?.shots || [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const cell = document.createElement('div');
      cell.className = 'amiral-cell disabled';
      // Gemim mi var burada?
      let myShip = null;
      if (myBoard) {
        for (const ship of myBoard.ships) {
          if (ship.cells.some(c => c.x === x && c.y === y)) {
            myShip = ship;
            break;
          }
        }
      }
      if (myShip) cell.classList.add('ship');
      // Bana atış olmuş mu?
      const shot = opponentShots.find(s => s.x === x && s.y === y);
      if (shot) {
        cell.textContent = shot.hit ? '🔥' : '·';
        cell.classList.add(shot.hit ? 'hit' : 'miss');
        if (shot.hit && myShip?.sunk) cell.classList.add('sunk');
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
  socket.emit('uno:draw');
});

// Renk seçici
document.querySelectorAll('.picker-color').forEach(btn => {
  btn.addEventListener('click', () => {
    if (unoState.pendingPlay !== null) {
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
    '+2': '+2', '+4': '+4', 'donus': '↻', 'pas': '⊘', 'joker': '★'
  };
  return valueMap[card.value] || card.value;
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

  // Oyuncu çubuğu (herkesin kart sayısı)
  const playersBar = document.getElementById('uno-players-bar');
  playersBar.innerHTML = '';
  state.players.forEach((p, i) => {
    const pill = document.createElement('div');
    pill.className = 'uno-player-pill';
    if (i === gs.currentPlayerIndex) pill.classList.add('active');
    const handCount = gs.hands?.[p.id]?.length || 0;
    pill.innerHTML = `
      <span>${escapeHtml(p.name)}${p.id === state.you?.id ? ' (sen)' : ''}</span>
      <span class="card-count">${handCount}</span>
    `;
    playersBar.appendChild(pill);
  });

  // Discard (en üstteki kart)
  const discardDiv = document.getElementById('uno-discard');
  discardDiv.innerHTML = '';
  if (gs.discard && gs.discard.length) {
    const top = gs.discard[gs.discard.length - 1];
    const card = document.createElement('div');
    card.className = 'uno-card ' + (gs.currentColor || top.color);
    card.textContent = unoCardLabel(top);
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
    cardEl.textContent = unoCardLabel(card);
    if (isMyTurn && unoCardCanPlay(card, gs)) {
      cardEl.classList.add('playable');
      cardEl.addEventListener('click', () => {
        if (card.color === 'joker') {
          // Renk seç
          unoState.pendingPlay = { cardIndex: idx };
          document.getElementById('uno-color-picker').style.display = 'flex';
        } else {
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

  // Eliminated bilgisi gameState'ten geliyor
  if (data.gameState) {
    state.players = data.players;
  }

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
  showToast(message, 'error');
});

socket.on('kelime:timer', ({ timeLeft }) => {
  if (state.gameState) state.gameState.timeLeft = timeLeft;
  const el = document.getElementById('kelime-timer');
  if (el) el.textContent = timeLeft;
});

socket.on('kelime:error', ({ message }) => {
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
  showToast(`🔀 ${playerName} harfi değiştirdi: ${from} → ${to}`, '');
});

socket.on('kelime:passUsed', ({ playerName }) => {
  showToast(`⏭️ ${playerName} pas geçti`, '');
});

socket.on('kelime:lifeLost', ({ playerName, livesLeft }) => {
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

socket.on('cizim:reveal', ({ word }) => {
  // Tur sonu - canvas'ı temizle, yeni tur başlamadan önce
  setTimeout(() => {
    clearCanvas();
    cizimState.secretWord = null;
  }, 5500);
});

// Kelime seçim seçenekleri (sadece çizene)
socket.on('cizim:wordChoices', ({ words }) => {
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
});

socket.on('trivia:answerCount', ({ count, total }) => {
  if (triviaSelected !== -1) {
    const status = document.getElementById('trivia-status');
    if (status) status.textContent = `✓ Cevap verildi (${count}/${total} kişi cevapladı)`;
  }
});

socket.on('trivia:fiftyResult', ({ eliminated }) => {
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
socket.on('yilan:tick', ({ snakes, foods, timeLeft }) => {
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
