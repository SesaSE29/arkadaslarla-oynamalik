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

document.getElementById('btn-settings').addEventListener('click', () => {
  settingsModal.style.display = 'flex';
  applySettingsToUI();
});
document.getElementById('settings-close').addEventListener('click', () => {
  settingsModal.style.display = 'none';
});
settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) settingsModal.style.display = 'none';
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

// Oyun seçme kartları
document.querySelectorAll('.game-card:not(.disabled)').forEach(card => {
  card.addEventListener('click', () => {
    const gameType = card.dataset.game;
    if (!gameType) return;
    if (state.you.id !== state.host) {
      showToast('Sadece oda kurucusu oyun başlatabilir!', 'error');
      return;
    }
    if (state.players.length < 2) {
      showToast('En az 2 oyuncu lazım!', 'error');
      return;
    }
    socket.emit('game:start', { gameType });
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

function renderHafiza() {
  const gs = state.gameState;
  if (!gs) return;

  const currentPlayer = state.players[gs.currentPlayerIndex];
  const isMyTurn = currentPlayer && currentPlayer.id === state.you?.id;

  document.getElementById('hafiza-current-player').textContent = 
    currentPlayer ? `${currentPlayer.name}${isMyTurn ? ' (SEN)' : ''}` : '-';

  // Board
  const board = document.getElementById('hafiza-board');
  board.innerHTML = '';
  gs.cards.forEach((card, idx) => {
    const btn = document.createElement('button');
    btn.className = 'memory-card';
    if (card.flipped) btn.classList.add('flipped');
    if (card.matched) btn.classList.add('matched');
    btn.innerHTML = `
      <div class="inner">
        <div class="face front">?</div>
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

// Kelime Zinciri için canlı skor tablosu (kalp ikonları + pas hakkı)
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
    const maxLives = gs.maxLives || 1;

    let hearts = '';
    for (let k = 0; k < maxLives; k++) {
      hearts += `<span class="heart ${k < livesLeft ? 'filled' : 'empty'}">${k < livesLeft ? '❤️' : '🤍'}</span>`;
    }

    pill.innerHTML = `
      <span class="name">${escapeHtml(p.name)}</span>
      <span class="lives" title="Kalan can">${hearts}</span>
      ${gs.maxPasses > 0 ? `<span class="pass-info" title="Kalan pas">⏭️${passesLeft}</span>` : ''}
      <span class="score">${p.score || 0}</span>
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
  lineWidth: 4,
  lastX: 0,
  lastY: 0,
  secretWord: null // sadece çizen oyuncu için
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
    cizimState.lineWidth = btn.classList.contains('eraser') ? 20 : 4;
  });
});

// Canvas temizle
document.getElementById('cizim-clear').addEventListener('click', () => {
  if (!isCurrentDrawer()) return;
  socket.emit('cizim:clear');
  clearCanvas();
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
  document.getElementById('cizim-timer').textContent = gs.timeLeft;

  // Kelime gösterimi: çizen oyuncuya gerçek kelime, diğerlerine boşluk
  const wordEl = document.getElementById('cizim-word');
  if (isDrawer && cizimState.secretWord) {
    wordEl.textContent = cizimState.secretWord.toUpperCase();
    wordEl.style.color = 'var(--color-primary)';
  } else {
    wordEl.textContent = gs.wordHint || '_';
    wordEl.style.color = 'var(--color-secondary-dark)';
  }

  // Araç çubuğu sadece çizen için
  document.getElementById('cizim-tools').style.display = isDrawer ? 'flex' : 'none';
  
  // Tahmin alanı sadece çizmeyen için
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

  // Reveal ekranı (tur sonu)
  const revealEl = document.getElementById('cizim-reveal');
  if (gs.phase === 'roundEnd' && !gs.gameOver) {
    document.getElementById('cizim-reveal-word').textContent = gs.currentWord || '?';
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
        if (triviaSelected === i) {
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
      } else {
        btn.disabled = true;
      }
      opts.appendChild(btn);
    });
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
    // Yeni soru için seçimi sıfırla
    setTimeout(() => { triviaSelected = -1; }, 100);
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
  detectiveResults: [] // önceki dedektif kontrolleri
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
    const emojiMap = { vampir: '🧛', doktor: '⚕️', dedektif: '🔍', koylu: '👨‍🌾' };
    const nameMap = { vampir: 'Vampir', doktor: 'Doktor', dedektif: 'Dedektif', koylu: 'Köylü' };
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
          } else if (gs.phase === 'dayVote') {
            socket.emit('vampir:vote', { targetId: p.id });
          }
          renderVampir();
        });
      }
    }
    // Kendine de doktor olarak oy verebilir (kendini koru)
    else if (isAlive && p.id === state.you?.id && vampirState.myRole === 'doktor' && gs.phase === 'night') {
      item.classList.add('selectable');
      if (vampirState.selectedTarget === p.id) item.classList.add('selected');
      item.addEventListener('click', () => {
        vampirState.selectedTarget = p.id;
        socket.emit('vampir:save', { targetId: p.id });
        renderVampir();
      });
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
    } else {
      msg = '😴 <strong>Köylüsün, uyuyorsun...</strong> Sabah neler olduğunu öğreneceksin.';
    }
    actionDiv.innerHTML = `<p class="vampir-instructions">${msg}</p>`;
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
  lastTick: null
};

document.getElementById('yilan-exit').addEventListener('click', exitGame);
document.getElementById('yilan-back-lobby').addEventListener('click', exitGame);

// Yön kontrolü
function setYilanDir(dx, dy) {
  if (state.game !== 'yilan') return;
  socket.emit('yilan:direction', { direction: { x: dx, y: dy } });
}

document.addEventListener('keydown', (e) => {
  if (state.game !== 'yilan') return;
  if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') { setYilanDir(0, -1); e.preventDefault(); }
  else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') { setYilanDir(0, 1); e.preventDefault(); }
  else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { setYilanDir(-1, 0); e.preventDefault(); }
  else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { setYilanDir(1, 0); e.preventDefault(); }
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
  btn.addEventListener('touchstart', handler);
});

function drawYilan() {
  const ARENA_W = 1000;
  const ARENA_H = 700;
  yilanCtx.fillStyle = '#0a0420';
  yilanCtx.fillRect(0, 0, yilanCanvas.width, yilanCanvas.height);

  // Grid çizgileri
  yilanCtx.strokeStyle = 'rgba(255,255,255,0.05)';
  yilanCtx.lineWidth = 1;
  for (let i = 0; i < ARENA_W; i += 50) {
    yilanCtx.beginPath();
    yilanCtx.moveTo(i, 0);
    yilanCtx.lineTo(i, ARENA_H);
    yilanCtx.stroke();
  }
  for (let i = 0; i < ARENA_H; i += 50) {
    yilanCtx.beginPath();
    yilanCtx.moveTo(0, i);
    yilanCtx.lineTo(ARENA_W, i);
    yilanCtx.stroke();
  }

  // Yemler
  yilanState.foods.forEach(f => {
    yilanCtx.fillStyle = '#ffd93d';
    yilanCtx.beginPath();
    yilanCtx.arc(f.x, f.y, 6, 0, Math.PI * 2);
    yilanCtx.fill();
    yilanCtx.fillStyle = '#fff5b8';
    yilanCtx.beginPath();
    yilanCtx.arc(f.x - 2, f.y - 2, 2, 0, Math.PI * 2);
    yilanCtx.fill();
  });

  // Yılanlar
  for (const id in yilanState.snakes) {
    const snake = yilanState.snakes[id];
    if (!snake.body || snake.body.length === 0) continue;

    if (!snake.alive) {
      yilanCtx.globalAlpha = 0.3;
    }

    // Gövde
    yilanCtx.strokeStyle = snake.color;
    yilanCtx.lineWidth = 14;
    yilanCtx.lineCap = 'round';
    yilanCtx.lineJoin = 'round';
    yilanCtx.beginPath();
    yilanCtx.moveTo(snake.body[0].x, snake.body[0].y);
    for (let i = 1; i < snake.body.length; i++) {
      yilanCtx.lineTo(snake.body[i].x, snake.body[i].y);
    }
    yilanCtx.stroke();

    // Baş
    const head = snake.body[0];
    yilanCtx.fillStyle = snake.color;
    yilanCtx.beginPath();
    yilanCtx.arc(head.x, head.y, 9, 0, Math.PI * 2);
    yilanCtx.fill();
    
    // Gözler
    yilanCtx.fillStyle = 'white';
    yilanCtx.beginPath();
    yilanCtx.arc(head.x - 3, head.y - 3, 2.5, 0, Math.PI * 2);
    yilanCtx.arc(head.x + 3, head.y - 3, 2.5, 0, Math.PI * 2);
    yilanCtx.fill();
    yilanCtx.fillStyle = '#1a0b2e';
    yilanCtx.beginPath();
    yilanCtx.arc(head.x - 3, head.y - 3, 1.2, 0, Math.PI * 2);
    yilanCtx.arc(head.x + 3, head.y - 3, 1.2, 0, Math.PI * 2);
    yilanCtx.fill();

    // İsim etiketi
    yilanCtx.globalAlpha = snake.alive ? 1 : 0.5;
    yilanCtx.fillStyle = 'white';
    yilanCtx.font = 'bold 14px Fredoka, sans-serif';
    yilanCtx.textAlign = 'center';
    yilanCtx.fillText(snake.name, head.x, head.y - 16);
    
    yilanCtx.globalAlpha = 1;
  }
}

function renderYilan() {
  const gs = state.gameState;
  if (!gs) return;
  document.getElementById('yilan-timer').textContent = gs.timeLeft;

  // Skor tablosu
  renderScoreboard('yilan-scoreboard', -1);

  const me = yilanState.snakes[state.you?.id];
  if (me && !me.alive) {
    document.getElementById('yilan-status').textContent = '💀 Öldün! Sonucu bekle...';
  } else {
    document.getElementById('yilan-status').textContent = 
      `Skor: ${me?.score || 0} | Yem ye, çarpma!`;
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
        <span>${p.score} yem</span>
      </div>
    `).join('');
    gameOverEl.style.display = 'flex';
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
  }, 5000);
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
    // Skorları güncelle
    for (const id in snakes) {
      const p = state.players.find(p => p.id === id);
      if (p) p.score = snakes[id].score;
    }
  }
  drawYilan();
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
