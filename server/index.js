// ============================================================
// ARKADAŞLARLA OYNAMALIK - Ana Sunucu
// Express + Socket.IO ile gerçek zamanlı oyun sunucusu
// ============================================================

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const WORDS = require('./words');
const TRIVIA_QUESTIONS = require('./trivia');

// ============================================================
// SÖZLÜK VE KATEGORİ YÜKLEME (Kelime Zinciri için)
// ============================================================
let DICTIONARY = new Set();
const DICT_BY_FIRST_LETTER = {};
try {
  const dictPath = path.join(__dirname, 'data', 'tr-dictionary.txt');
  const raw = fs.readFileSync(dictPath, 'utf8');
  const lines = raw.split(/\r?\n/)
    .map(l => l.trim().toLocaleLowerCase('tr-TR'))
    .filter(l => l && /^[a-zçğıöşüâîû]+$/i.test(l));
  DICTIONARY = new Set(lines);
  for (const w of lines) {
    const first = w[0];
    if (!DICT_BY_FIRST_LETTER[first]) DICT_BY_FIRST_LETTER[first] = new Set();
    DICT_BY_FIRST_LETTER[first].add(w);
  }
  console.log(`Sözlük yüklendi: ${DICTIONARY.size} kelime`);
} catch (e) {
  console.warn('Sözlük yüklenemedi (devam ediliyor):', e.message);
}

const CATEGORIES = {};
const CATEGORY_LABELS = {
  'serbest': 'Serbest',
  'hayvan': 'Hayvan',
  'bitki': 'Bitki',
  'esya': 'Eşya',
  'ulke': 'Ülke',
  'yemek': 'Yemek/İçecek',
  'a-yok': '"A" harfsiz'
};
for (const cat of ['hayvan', 'bitki', 'esya', 'ulke', 'yemek']) {
  try {
    const list = require(`./data/categories/${cat}`)
      .map(w => w.toLocaleLowerCase('tr-TR'));
    CATEGORIES[cat] = new Set(list);
    console.log(`Kategori "${cat}": ${CATEGORIES[cat].size} kelime`);
  } catch (e) {
    console.warn(`Kategori "${cat}" yüklenemedi:`, e.message);
    CATEGORIES[cat] = new Set();
  }
}

// Şehir-İsim-Hayvan için ek kategoriler (sehir, isim, renk, marka)
for (const cat of ['sehir', 'isim', 'renk', 'marka']) {
  try {
    const list = require(`./data/sih/${cat}`)
      .map(w => w.toLocaleLowerCase('tr-TR'));
    CATEGORIES[cat] = new Set(list);
    console.log(`SİH kategori "${cat}": ${CATEGORIES[cat].size} kelime`);
  } catch (e) {
    console.warn(`SİH kategori "${cat}" yüklenemedi:`, e.message);
    CATEGORIES[cat] = new Set();
  }
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Statik dosyaları sun (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Keep-alive endpoint — Render.com 15dk uyku önleme için
app.get('/ping', (req, res) => {
  res.status(200).json({
    ok: true,
    uptime: Math.floor(process.uptime()),
    rooms: Object.keys(rooms).length,
    ts: Date.now()
  });
});

// ============================================================
// ODA YÖNETİMİ
// ============================================================
// rooms = { 'ABCD': { code, host, players: [...], game: null, gameState: {...} } }
const rooms = {};

// 4 haneli rastgele oda kodu üret
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (rooms[code]);
  return code;
}

// Oda durumunu tüm oyunculara yolla
function broadcastRoom(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  
  // gameState'ten serileştirilemeyen alanları çıkar
  let cleanState = null;
  if (room.gameState) {
    cleanState = {};
    for (const key in room.gameState) {
      // Interval/Timeout objelerini ve fonksiyonları atla
      if (key === 'timerId' || key === 'tickId') continue;
      cleanState[key] = room.gameState[key];
    }
  }

  // Vampir oyununda role'leri gizli tut (oyun bitene kadar)
  const hideRoles = room.game === 'vampir' && !room.gameState?.gameOver;
  
  // Codenames: spymaster harici board.role'leri gizle
  const isCodenames = room.game === 'codenames' && cleanState;
  if (isCodenames && cleanState.board) {
    const boardBackup = cleanState.board;
    const spyMap = cleanState.spymasters || {};
    const spyIds = new Set([spyMap.red, spyMap.blue].filter(Boolean));
    const isGameOver = cleanState.gameOver;

    room.players.forEach(p => {
      const personalState = { ...cleanState };
      const isSpy = spyIds.has(p.id);
      if (isSpy || isGameOver) {
        personalState.board = boardBackup; // tüm rolleri gör
      } else {
        // Ajan: sadece revealed olanların rolünü gör
        personalState.board = boardBackup.map(c => c.revealed
          ? c
          : { word: c.word, role: 'hidden', revealed: false }
        );
      }
      io.to(p.id).emit('room:update', {
        code: room.code,
        host: room.host,
        players: room.players.map(op => ({
          id: op.id, name: op.name, score: op.score, alive: op.alive,
          eliminated: op.eliminated, ready: op.ready,
          codenamesTeam: op.codenamesTeam || null,
          codenamesRole: op.codenamesRole || null,
          syToken: op.syToken || null
        })),
        game: room.game,
        gameState: personalState,
        settings: room.settings,
        lobbyChat: room.lobbyChat || []
      });
    });
    return;
  }

  // Pişti: her oyuncuya sadece kendi elini gönder
  if (room.game === 'pisti' && cleanState && cleanState.hands) {
    const handsBackup = cleanState.hands;
    const capturesBackup = cleanState.captures;
    room.players.forEach(p => {
      const personalState = { ...cleanState };
      personalState.hands = {};
      for (const pid in handsBackup) {
        personalState.hands[pid] = (pid === p.id) ? handsBackup[pid] : [];
      }
      // Captures sadece son birkaç kart (görsel için "en üst"); kalanlar sadece sayı
      personalState.capturesTop = {};
      for (const pid in capturesBackup) {
        const arr = capturesBackup[pid] || [];
        personalState.capturesTop[pid] = arr.slice(-3); // son 3 alınan
      }
      delete personalState.captures;
      io.to(p.id).emit('room:update', {
        code: room.code,
        host: room.host,
        players: room.players.map(op => ({
          id: op.id, name: op.name, score: op.score, alive: op.alive,
          eliminated: op.eliminated, ready: op.ready,
          codenamesTeam: op.codenamesTeam || null,
          codenamesRole: op.codenamesRole || null,
          syToken: op.syToken || null
        })),
        game: room.game,
        gameState: personalState,
        settings: room.settings,
        lobbyChat: room.lobbyChat || []
      });
    });
    return;
  }

  // Uno oyununda diğer oyuncuların ellerini gizli tut
  const hideUnoHands = room.game === 'uno';
  if (hideUnoHands && cleanState && cleanState.hands) {
    // hands'i kişiye göre filtrele - aşağıda her socket için ayrı emit
    const handsBackup = cleanState.hands;
    
    // Her oyuncuya özel state yolla
    room.players.forEach(p => {
      const personalState = { ...cleanState };
      // Sadece kendi elini görsün, diğerleri kart sayısı olarak kalsın
      personalState.hands = {};
      for (const pid in handsBackup) {
        if (pid === p.id) {
          personalState.hands[pid] = handsBackup[pid];
        } else {
          // Sadece uzunluk için boş kart dizisi
          personalState.hands[pid] = new Array(handsBackup[pid].length).fill(null);
        }
      }
      
      io.to(p.id).emit('room:update', {
        code: room.code,
        host: room.host,
        players: room.players.map(op => ({
          id: op.id,
          name: op.name,
          score: op.score,
          alive: op.alive,
          eliminated: op.eliminated,
          ready: op.ready,
          codenamesTeam: op.codenamesTeam || null,
          codenamesRole: op.codenamesRole || null,
          syToken: op.syToken || null
        })),
        game: room.game,
        gameState: personalState,
        settings: room.settings,
        lobbyChat: room.lobbyChat || []
      });
    });
    return;
  }
  
  const playersBase = room.players.map(p => ({
    id: p.id,
    name: p.name,
    score: p.score,
    alive: p.alive,
    eliminated: p.eliminated,
    ready: p.ready,
    codenamesTeam: p.codenamesTeam || null,
    codenamesRole: p.codenamesRole || null,
    syToken: p.syToken || null
    // role aşağıda kişiye göre eklenir
  }));

  if (hideRoles) {
    // Her oyuncuya özel mesaj: sadece kendi rolü görünür
    room.players.forEach(p => {
      const personalPlayers = playersBase.map(pl => ({
        ...pl,
        role: pl.id === p.id ? room.players.find(x => x.id === pl.id)?.role : undefined
      }));
      // Vampirler birbirini görsün
      if (p.role === 'vampir') {
        personalPlayers.forEach((pl, i) => {
          if (room.players[i].role === 'vampir') {
            pl.role = 'vampir';
          }
        });
      }
      io.to(p.id).emit('room:update', {
        code: room.code,
        host: room.host,
        players: personalPlayers,
        game: room.game,
        gameState: cleanState,
        settings: room.settings,
        lobbyChat: room.lobbyChat || []
      });
    });
  } else {
    // Oyun bittiyse veya vampir oyunu değilse role bilgisi de yollanır
    const playersWithRoles = playersBase.map(pl => {
      const orig = room.players.find(x => x.id === pl.id);
      return { ...pl, role: orig?.role };
    });
    io.to(roomCode).emit('room:update', {
      code: room.code,
      host: room.host,
      players: playersWithRoles,
      game: room.game,
      gameState: cleanState,
      settings: room.settings,
      lobbyChat: room.lobbyChat || []
    });
  }
}

// Oyuncunun bulunduğu odayı bul
function findPlayerRoom(socketId) {
  for (const code in rooms) {
    const p = rooms[code].players.find(p => p.id === socketId);
    if (p) return { room: rooms[code], player: p };
  }
  return null;
}

// Ortak oyun durdurma
function stopGame(room) {
  if (!room || !room.game) return;
  const stoppers = {
    'kelime-zinciri': KelimeZinciri,
    'hafiza': Hafiza,
    'cizim': Cizim,
    'trivia': Trivia,
    'vampir': Vampir,
    'yilan': Yilan,
    'amiral': AmiralBatti,
    'uno': UnoOyun,
    'sih': SehirIsimHayvan,
    'emoji': EmojiTahmin,
    'codenames': Codenames,
    'syarisi': SehirYarisi,
    'kizma': KizmaBirader,
    'pisti': Pisti
  };
  const stopper = stoppers[room.game];
  if (stopper && typeof stopper.stop === 'function') {
    try { stopper.stop(room); } catch (e) { console.error('Stop error:', e); }
  }
}

// ============================================================
// KELİME ZİNCİRİ OYUNU
// ============================================================
const KelimeZinciri = {
  start(room) {
    const s = room.settings?.kelime || {};
    const maxLives = Math.max(1, Math.min(5, s.lives || 1));
    const maxPasses = Math.max(0, Math.min(3, (s.passesPerPlayer ?? 1)));
    const maxLetterChanges = Math.max(0, Math.min(3, (s.letterChangesPerPlayer ?? 1)));
    const category = (s.category && CATEGORY_LABELS[s.category]) ? s.category : 'serbest';
    const matchMode = (s.matchMode === 'kafiye') ? 'kafiye' : 'son-harf';
    const useDictionary = s.useDictionary !== false;
    const turnTime = s.turnTime || 20;

    const lives = {};
    const passesLeft = {};
    const letterChangesLeft = {};
    for (const p of room.players) {
      lives[p.id] = maxLives;
      passesLeft[p.id] = maxPasses;
      letterChangesLeft[p.id] = maxLetterChanges;
      p.score = 0;
      p.eliminated = false;
    }

    room.gameState = {
      type: 'kelime-zinciri',
      currentPlayerIndex: 0,
      lastWord: null,
      lastLetter: null,
      lastTwoLetters: null,
      usedWords: [],
      timeLeft: turnTime,
      turnTime,
      timerId: null,
      messages: [],
      gameOver: false,
      winner: null,
      lives,
      maxLives,
      passesLeft,
      maxPasses,
      letterChangesLeft,
      maxLetterChanges,
      category,
      categoryLabel: CATEGORY_LABELS[category] || 'Serbest',
      matchMode,
      useDictionary,
      skipNotice: null
    };
    this.startTurn(room);
    broadcastRoom(room.code);
  },

  startTurn(room) {
    const state = room.gameState;
    if (state.timerId) clearInterval(state.timerId);
    state.timeLeft = state.turnTime || 20;

    state.timerId = setInterval(() => {
      state.timeLeft--;
      io.to(room.code).emit('kelime:timer', { timeLeft: state.timeLeft });
      if (state.timeLeft <= 0) {
        clearInterval(state.timerId);
        this.loseLife(room, 'Süre doldu!');
      }
    }, 1000);
  },

  // Aktif kelime havuzunu döndür (kategori / sözlük / yok)
  getWordSource(state) {
    if (state.category === 'a-yok') return DICTIONARY;
    if (state.category && state.category !== 'serbest') return CATEGORIES[state.category] || null;
    if (state.useDictionary) return DICTIONARY;
    return null;
  },

  // ğ -> önceki sesli harf mantığı (son-harf modu için)
  resolveLastLetter(word) {
    let last = word[word.length - 1];
    if (last !== 'ğ') return last;
    const vowels = ['a','e','ı','i','o','ö','u','ü'];
    for (let i = word.length - 2; i >= 0; i--) {
      if (vowels.includes(word[i])) return word[i];
    }
    return 'a';
  },

  // Kelimeden sonraki "gereken başlangıç" değerlerini hesapla
  computeNextRequirement(word, matchMode) {
    if (matchMode === 'kafiye' && word.length >= 2) {
      const last = word[word.length - 1];
      // Son harf ğ ise: kafiye yerine son-harf modunu uygula (geçici)
      if (last === 'ğ') {
        const ll = this.resolveLastLetter(word);
        return { lastLetter: ll, lastTwoLetters: null };
      }
      const lastTwo = word.slice(-2);
      return { lastLetter: lastTwo[0], lastTwoLetters: lastTwo };
    }
    return { lastLetter: this.resolveLastLetter(word), lastTwoLetters: null };
  },

  // Kelime doğrulama
  validateWord(rawWord, state, settings) {
    const word = (rawWord || '').trim().toLocaleLowerCase('tr-TR');
    const minLength = settings.minLength || 2;

    if (word.length < minLength) {
      return { ok: false, error: `Kelime en az ${minLength} harf olmalı!` };
    }
    if (!/^[a-zçğıöşüâîû]+$/i.test(word)) {
      return { ok: false, error: 'Sadece Türkçe harfler!' };
    }

    // Başlangıç eşleşmesi
    if (state.matchMode === 'kafiye' && state.lastTwoLetters) {
      if (!word.startsWith(state.lastTwoLetters)) {
        return { ok: false, error: `Kelime "${state.lastTwoLetters.toUpperCase()}" ile başlamalı! (kafiye modu)` };
      }
    } else if (state.lastLetter) {
      if (word[0] !== state.lastLetter) {
        return { ok: false, error: `Kelime "${state.lastLetter.toUpperCase()}" harfi ile başlamalı!` };
      }
    }

    if (state.usedWords.includes(word)) {
      return { ok: false, error: 'Bu kelime zaten kullanıldı!' };
    }

    // Kategori / sözlük kontrolü
    if (state.category === 'a-yok') {
      if (word.includes('a')) {
        return { ok: false, error: 'Kelimede "a" harfi olamaz!' };
      }
      if (DICTIONARY.size > 0 && !DICTIONARY.has(word)) {
        return { ok: false, error: 'Sözlükte böyle bir kelime yok!' };
      }
    } else if (state.category && state.category !== 'serbest') {
      const list = CATEGORIES[state.category];
      const label = CATEGORY_LABELS[state.category] || state.category;
      if (!list || list.size === 0) {
        return { ok: false, error: `"${label}" kategorisi yüklenemedi!` };
      }
      if (!list.has(word)) {
        return { ok: false, error: `Bu kelime "${label}" kategorisinde değil!` };
      }
    } else if (state.useDictionary) {
      if (DICTIONARY.size > 0 && !DICTIONARY.has(word)) {
        return { ok: false, error: 'Sözlükte böyle bir kelime yok!' };
      }
    }

    return { ok: true, word };
  },

  submitWord(room, playerId, rawWord) {
    const state = room.gameState;
    if (!state || state.gameOver) return;
    const currentPlayer = room.players[state.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.id !== playerId) return;

    const settings = room.settings?.kelime || {};
    const result = this.validateWord(rawWord, state, settings);
    if (!result.ok) {
      io.to(playerId).emit('kelime:error', { message: result.error });
      return;
    }

    const word = result.word;
    state.usedWords.push(word);
    state.lastWord = word;
    const next = this.computeNextRequirement(word, state.matchMode);
    state.lastLetter = next.lastLetter;
    state.lastTwoLetters = next.lastTwoLetters;
    state.skipNotice = null;

    const trueEnding = word[word.length - 1];
    let displayWord = word;
    if (trueEnding === 'ğ') {
      displayWord = `${word} → sıradaki: ${state.lastLetter.toUpperCase()}`;
    }

    currentPlayer.score += word.length;
    state.messages.push({ player: currentPlayer.name, word: displayWord, valid: true });
    if (state.messages.length > 15) state.messages.shift();

    this.nextTurn(room);
    broadcastRoom(room.code);
  },

  pass(room, playerId) {
    const state = room.gameState;
    if (!state || state.gameOver) return;
    const currentPlayer = room.players[state.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.id !== playerId) return;

    if ((state.passesLeft[playerId] || 0) <= 0) {
      io.to(playerId).emit('kelime:error', { message: 'Pas hakkın kalmadı!' });
      return;
    }

    state.passesLeft[playerId]--;
    state.messages.push({
      player: currentPlayer.name,
      word: 'Pas geçti',
      valid: false,
      pass: true
    });
    if (state.messages.length > 15) state.messages.shift();

    io.to(room.code).emit('kelime:passUsed', {
      playerId,
      playerName: currentPlayer.name,
      passesLeft: state.passesLeft[playerId]
    });

    this.nextTurn(room);
    broadcastRoom(room.code);
  },

  changeLetter(room, playerId) {
    const state = room.gameState;
    if (!state || state.gameOver) return;
    const currentPlayer = room.players[state.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.id !== playerId) return;

    if ((state.letterChangesLeft[playerId] || 0) <= 0) {
      io.to(playerId).emit('kelime:error', { message: 'Harf değiş hakkın kalmadı!' });
      return;
    }

    // Mevcut harfle farklı, sözlükte/kategoride mevcut bir sesli harf seç
    const vowels = ['a','e','i','o','u','ı','ö','ü'];
    const currentLetter = state.lastLetter;
    const oldDisplay = (state.matchMode === 'kafiye' && state.lastTwoLetters)
      ? state.lastTwoLetters.toUpperCase()
      : (currentLetter ? currentLetter.toUpperCase() : '?');

    // Geçerli (oynanabilir) sesli harfleri filtrele
    const tempState = { ...state, lastTwoLetters: null }; // kafiye etkisini kaldır
    const playable = [];
    for (const v of vowels) {
      if (v === currentLetter) continue;
      tempState.lastLetter = v;
      if (!this.isDeadEnd(tempState)) playable.push(v);
    }

    let newLetter;
    if (playable.length > 0) {
      newLetter = playable[Math.floor(Math.random() * playable.length)];
    } else {
      // Hiç oynanabilir sesli yoksa: alternatif bul
      newLetter = this.findAlternativeLetter(state) || vowels[Math.floor(Math.random() * vowels.length)];
    }

    state.letterChangesLeft[playerId]--;
    state.lastLetter = newLetter;
    state.lastTwoLetters = null; // kafiye modu sıfırlanır
    state.skipNotice = null;

    state.messages.push({
      player: currentPlayer.name,
      word: `🔀 Harf değişti: ${oldDisplay} → ${newLetter.toUpperCase()}`,
      valid: false,
      letterChange: true
    });
    if (state.messages.length > 15) state.messages.shift();

    io.to(room.code).emit('kelime:letterChanged', {
      playerId,
      playerName: currentPlayer.name,
      from: oldDisplay,
      to: newLetter.toUpperCase(),
      letterChangesLeft: state.letterChangesLeft[playerId]
    });

    // Sıra DEĞİŞMEZ — aynı oyuncu yeni harfle devam eder
    // Süreyi sıfırla (yardım hakkı kullanıldı)
    if (state.timerId) clearInterval(state.timerId);
    this.startTurn(room);
    broadcastRoom(room.code);
  },

  loseLife(room, reason) {
    const state = room.gameState;
    const currentPlayer = room.players[state.currentPlayerIndex];
    if (!currentPlayer) return;

    state.lives[currentPlayer.id] = Math.max(0, (state.lives[currentPlayer.id] || 1) - 1);

    state.messages.push({
      player: currentPlayer.name,
      word: reason,
      valid: false
    });

    io.to(room.code).emit('kelime:lifeLost', {
      playerId: currentPlayer.id,
      playerName: currentPlayer.name,
      livesLeft: state.lives[currentPlayer.id]
    });

    if (state.lives[currentPlayer.id] <= 0) {
      currentPlayer.eliminated = true;
      state.messages.push({
        player: currentPlayer.name,
        word: 'Elendi!',
        valid: false
      });
    }
    if (state.messages.length > 15) state.messages.shift();

    const activePlayers = room.players.filter(p => !p.eliminated);
    if (activePlayers.length <= 1) {
      state.gameOver = true;
      state.winner = activePlayers[0] ? activePlayers[0].name : null;
      if (state.timerId) clearInterval(state.timerId);
      broadcastRoom(room.code);
      return;
    }

    this.nextTurn(room);
    broadcastRoom(room.code);
  },

  // Şu anki gereken başlangıç için en az 1 oynanabilir kelime var mı?
  isDeadEnd(state) {
    const source = this.getWordSource(state);
    if (!source) return false; // Hiç kaynak yoksa çıkmaz tespiti yapılmaz
    const usedSet = new Set(state.usedWords);

    // Kafiye modu: 2 harfli prefix
    if (state.matchMode === 'kafiye' && state.lastTwoLetters) {
      const prefix = state.lastTwoLetters;
      for (const w of source) {
        if (w.length >= 2 && w.startsWith(prefix) && !usedSet.has(w)) {
          if (state.category === 'a-yok' && w.includes('a')) continue;
          return false;
        }
      }
      return true;
    }

    if (!state.lastLetter) return false;
    const firstLetter = state.lastLetter;

    if (state.category === 'a-yok') {
      if (firstLetter === 'a') return true;
      for (const w of source) {
        if (w[0] === firstLetter && !w.includes('a') && !usedSet.has(w)) return false;
      }
      return true;
    }

    if (source === DICTIONARY) {
      const bucket = DICT_BY_FIRST_LETTER[firstLetter];
      if (!bucket) return true;
      for (const w of bucket) {
        if (!usedSet.has(w)) return false;
      }
      return true;
    }

    for (const w of source) {
      if (w[0] === firstLetter && !usedSet.has(w)) return false;
    }
    return true;
  },

  // Çıkmazda atlanacak alternatif harfi bul (önce sesli)
  findAlternativeLetter(state) {
    const source = this.getWordSource(state);
    if (!source) return null;
    const usedSet = new Set(state.usedWords);

    const tryLetter = (ch) => {
      if (state.category === 'a-yok' && ch === 'a') return false;
      if (source === DICTIONARY) {
        const bucket = DICT_BY_FIRST_LETTER[ch];
        if (!bucket) return false;
        for (const w of bucket) {
          if (state.category === 'a-yok' && w.includes('a')) continue;
          if (!usedSet.has(w)) return true;
        }
        return false;
      }
      for (const w of source) {
        if (w[0] !== ch) continue;
        if (state.category === 'a-yok' && w.includes('a')) continue;
        if (!usedSet.has(w)) return true;
      }
      return false;
    };

    const vowels = ['a','e','i','o','u','ı','ö','ü'];
    for (const v of vowels) if (tryLetter(v)) return v;
    for (let c = 97; c <= 122; c++) {
      const ch = String.fromCharCode(c);
      if (tryLetter(ch)) return ch;
    }
    return null;
  },

  nextTurn(room) {
    const state = room.gameState;
    if (state.timerId) clearInterval(state.timerId);

    let attempts = 0;
    do {
      state.currentPlayerIndex = (state.currentPlayerIndex + 1) % room.players.length;
      attempts++;
    } while (room.players[state.currentPlayerIndex].eliminated && attempts < room.players.length);

    // Çıkmaz harf tespiti — sonraki oyuncuya gerçekten oynanabilir bir prefix bırak
    state.skipNotice = null;
    if (state.lastLetter && this.isDeadEnd(state)) {
      const alt = this.findAlternativeLetter(state);
      if (alt && alt !== state.lastLetter) {
        const fromDisplay = (state.matchMode === 'kafiye' && state.lastTwoLetters)
          ? state.lastTwoLetters.toUpperCase()
          : state.lastLetter.toUpperCase();
        state.skipNotice = {
          from: fromDisplay,
          to: alt.toUpperCase(),
          message: `"${fromDisplay}" ile kelime kalmadı → "${alt.toUpperCase()}" harfine atlandı`
        };
        state.lastLetter = alt;
        state.lastTwoLetters = null; // Kafiye modu çıkmazda tek harfe düşer
        io.to(room.code).emit('kelime:skipped', state.skipNotice);
      }
    }

    this.startTurn(room);
  },

  stop(room) {
    if (room.gameState && room.gameState.timerId) {
      clearInterval(room.gameState.timerId);
    }
  }
};

// ============================================================
// HAFIZA OYUNU
// ============================================================
const Hafiza = {
  THEMES: {
    karisik: ['🎮','🎲','🎯','🎨','🎭','🎪','🎸','🎺','🚀','⭐','🌈','🍕','🍔','🍩','🦄','🐉','🦊','🐼','🐶','🐱','🐰','🦁','🐸','🦋','🍎','🍌','🍇','🍉','🌺','🌻','🍄','⚽','🏀','🎁'],
    hayvan:  ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🦅','🦉','🦇','🐺','🐗','🦒','🦓','🐘','🦏','🐪','🐊','🐢','🐍','🦂','🦋','🐌','🐝'],
    yemek:   ['🍕','🍔','🍟','🌭','🍿','🥓','🍳','🧇','🥞','🧀','🍰','🍪','🍩','🍫','🍭','🍦','🍓','🍒','🥑','🌮','🌯','🥗','🍜','🍣','🍱','🍙','🥟','🍤','🍢','🥨','🧋','☕','🥐','🥖'],
    spor:    ['⚽','🏀','🏈','⚾','🎾','🏐','🏉','🎱','🏓','🏸','🥊','🥋','⛳','🏒','🏑','🥍','🎯','🎣','🎽','🛹','🛼','🛷','⛸️','🎿','⛷️','🏂','🤿','🏊','🚴','🧗','🤸','🤾','🤺','🏄'],
    meyve:   ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌽','🥕','🧄','🧅','🥔','🍠','🌶️','🍄','🌰','🍯','🍞','🥨']
  },

  start(room) {
    const settings = room.settings?.hafiza || { pairCount: 8, theme: 'karisik' };
    const themeName = (settings.theme && this.THEMES[settings.theme]) ? settings.theme : 'karisik';
    const themePool = this.THEMES[themeName];
    const pairCount = Math.min(settings.pairCount, themePool.length);
    const selected = [...themePool].sort(() => Math.random() - 0.5).slice(0, pairCount);
    const cards = [...selected, ...selected]
      .sort(() => Math.random() - 0.5)
      .map((emoji, i) => ({ id: i, emoji, flipped: false, matched: false }));

    room.gameState = {
      type: 'hafiza',
      cards,
      pairCount,
      theme: themeName,
      currentPlayerIndex: 0,
      flippedIndices: [],
      lockBoard: false,
      gameOver: false,
      winner: null
    };
    room.players.forEach(p => { p.score = 0; p.eliminated = false; });
    broadcastRoom(room.code);
  },

  flipCard(room, playerId, cardIndex) {
    const state = room.gameState;
    if (!state || state.gameOver || state.lockBoard) return;

    const currentPlayer = room.players[state.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.id !== playerId) return;

    const card = state.cards[cardIndex];
    if (!card || card.flipped || card.matched) return;

    card.flipped = true;
    state.flippedIndices.push(cardIndex);
    broadcastRoom(room.code);

    // İki kart açıldıysa kontrol et
    if (state.flippedIndices.length === 2) {
      state.lockBoard = true;
      const [i1, i2] = state.flippedIndices;
      const c1 = state.cards[i1];
      const c2 = state.cards[i2];

      if (c1.emoji === c2.emoji) {
        // Eşleşme!
        setTimeout(() => {
          c1.matched = true;
          c2.matched = true;
          currentPlayer.score += 1;
          state.flippedIndices = [];
          state.lockBoard = false;

          // Oyun bitti mi?
          if (state.cards.every(c => c.matched)) {
            state.gameOver = true;
            const sorted = [...room.players].sort((a, b) => b.score - a.score);
            state.winner = sorted[0].name;
          }
          broadcastRoom(room.code);
        }, 800);
      } else {
        // Eşleşme yok - kartları kapat ve sıradakine geç
        setTimeout(() => {
          c1.flipped = false;
          c2.flipped = false;
          state.flippedIndices = [];
          state.lockBoard = false;
          state.currentPlayerIndex = (state.currentPlayerIndex + 1) % room.players.length;
          broadcastRoom(room.code);
        }, 1500);
      }
    }
  },

  stop(room) {
    // Hafıza oyunu için temizlik gerekmiyor
  }
};

// ============================================================
// ÇİZİM-TAHMİN OYUNU (Gartic tarzı)
// ============================================================
const Cizim = {
  start(room) {
    const settings = room.settings?.cizim || { roundTime: 75, totalRounds: 3 };
    room.players.forEach(p => { p.score = 0; p.eliminated = false; });
    room.cizimSecret = { currentWord: null, wordChoices: null };
    room.gameState = {
      type: 'cizim',
      drawerIndex: 0,
      wordHint: null,
      hintLevel: 0,
      maxHintLevel: 2,
      timeLeft: settings.roundTime,
      roundTime: settings.roundTime,
      wordSelectTime: 0,
      wordSelectMax: 15,
      timerId: null,
      strokes: [],
      guesses: [],
      correctGuessers: [],
      firstGuesserId: null,
      roundPoints: {},
      roundsPlayed: 0,
      totalRounds: room.players.length * settings.totalRounds,
      gameOver: false,
      winner: null,
      phase: 'wordSelect',
      revealedWord: null,    // tur sonu özetinde gösterilecek
      lastSummary: null
    };
    this.startRound(room);
  },

  startRound(room) {
    const state = room.gameState;
    if (state.timerId) clearInterval(state.timerId);

    const drawer = room.players[state.drawerIndex];
    // 2 farklı kelime seçeneği — zorluk dağılımı
    const picks = [];
    for (let i = 0; i < 2; i++) {
      const r = Math.random();
      let pool;
      if (r < 0.5) pool = WORDS.kolay;
      else if (r < 0.85) pool = WORDS.orta;
      else pool = WORDS.zor;
      let w;
      let tries = 0;
      do {
        w = pool[Math.floor(Math.random() * pool.length)];
        tries++;
      } while (picks.includes(w) && tries < 10);
      picks.push(w);
    }
    room.cizimSecret.wordChoices = picks;
    room.cizimSecret.currentWord = null;

    state.phase = 'wordSelect';
    state.wordSelectTime = state.wordSelectMax;
    state.wordHint = null;
    state.hintLevel = 0;
    state.strokes = [];
    state.guesses = [];
    state.correctGuessers = [];
    state.firstGuesserId = null;
    state.roundPoints = {};
    state.revealedWord = null;
    state.lastSummary = null;
    for (const p of room.players) state.roundPoints[p.id] = 0;

    // Sadece çizene seçenekleri yolla (3 saniye sonra otomatik seç sürecek)
    io.to(drawer.id).emit('cizim:wordChoices', { words: picks });

    state.timerId = setInterval(() => {
      state.wordSelectTime--;
      io.to(room.code).emit('cizim:selectTimer', { timeLeft: state.wordSelectTime });
      if (state.wordSelectTime <= 0) {
        clearInterval(state.timerId);
        // Otomatik ilk kelimeyi seç
        this.selectWord(room, drawer.id, 0);
      }
    }, 1000);

    broadcastRoom(room.code);
  },

  selectWord(room, playerId, index) {
    const state = room.gameState;
    if (!state || state.phase !== 'wordSelect') return;
    const drawer = room.players[state.drawerIndex];
    if (!drawer || drawer.id !== playerId) return;
    const choices = room.cizimSecret?.wordChoices;
    if (!choices) return;

    if (state.timerId) clearInterval(state.timerId);

    const safeIdx = (index === 1) ? 1 : 0;
    const chosen = choices[safeIdx] || choices[0];
    room.cizimSecret.currentWord = chosen;
    room.cizimSecret.wordChoices = null;

    state.phase = 'drawing';
    state.timeLeft = state.roundTime;

    io.to(drawer.id).emit('cizim:word', { word: chosen });

    state.timerId = setInterval(() => {
      state.timeLeft--;
      io.to(room.code).emit('cizim:timer', { timeLeft: state.timeLeft });
      if (state.timeLeft <= 0) {
        this.endRound(room);
      }
    }, 1000);

    broadcastRoom(room.code);
  },

  // level 1: harf sayısı, level 2: baş harf + sayı
  generateHint(word, level) {
    if (!word || level <= 0) return null;
    return word.split('').map((c, i) => {
      if (c === ' ') return ' ';
      if (level >= 2 && i === 0) return c.toLocaleUpperCase('tr-TR');
      return '_';
    }).join(' ');
  },

  revealHint(room, playerId) {
    const state = room.gameState;
    if (!state || state.phase !== 'drawing') return;
    const drawer = room.players[state.drawerIndex];
    if (!drawer || drawer.id !== playerId) return;

    if (state.hintLevel >= state.maxHintLevel) {
      io.to(playerId).emit('cizim:hintError', { message: 'Daha fazla ipucu yok!' });
      return;
    }

    state.hintLevel++;
    const word = room.cizimSecret?.currentWord;
    state.wordHint = this.generateHint(word, state.hintLevel);

    io.to(room.code).emit('cizim:hintRevealed', {
      level: state.hintLevel,
      hint: state.wordHint
    });
    broadcastRoom(room.code);
  },

  draw(room, playerId, stroke) {
    const state = room.gameState;
    if (!state || state.phase !== 'drawing') return;
    const drawer = room.players[state.drawerIndex];
    if (!drawer || drawer.id !== playerId) return;
    state.strokes.push(stroke);
    io.to(room.code).emit('cizim:stroke', stroke);
  },

  clearCanvas(room, playerId) {
    const state = room.gameState;
    if (!state || state.phase !== 'drawing') return;
    const drawer = room.players[state.drawerIndex];
    if (!drawer || drawer.id !== playerId) return;
    state.strokes = [];
    io.to(room.code).emit('cizim:clear');
  },

  undo(room, playerId) {
    const state = room.gameState;
    if (!state || state.phase !== 'drawing') return;
    const drawer = room.players[state.drawerIndex];
    if (!drawer || drawer.id !== playerId) return;
    if (state.strokes.length > 0) state.strokes.pop();
    // Tüm istemciler kendi tuvallerini yeniden çizmeli — strokes listesi yollanır
    io.to(room.code).emit('cizim:undo', { strokes: state.strokes });
  },

  guess(room, playerId, text) {
    const state = room.gameState;
    if (!state || state.phase !== 'drawing') return;
    const player = room.players.find(p => p.id === playerId);
    if (!player) return;

    const drawer = room.players[state.drawerIndex];
    if (drawer.id === playerId) return;
    if (state.correctGuessers.includes(playerId)) return;

    text = text.trim();
    if (!text || text.length > 30) return;

    const normalized = text.toLocaleLowerCase('tr-TR').trim();
    const target = (room.cizimSecret?.currentWord || '').toLocaleLowerCase('tr-TR').trim();

    if (normalized === target) {
      state.correctGuessers.push(playerId);
      const isFirst = state.firstGuesserId === null;
      if (isFirst) state.firstGuesserId = playerId;

      // Puan hesaplama (skribbl.io tarzı, ölçeklenmiş)
      const timeRatio = Math.max(0, state.timeLeft / state.roundTime);
      const base = 4 + Math.round(16 * timeRatio); // 4-20
      const hintMul = [1.0, 0.7, 0.5][state.hintLevel] ?? 0.5;
      const firstBonus = isFirst ? 3 : 0;
      const guesserPoints = Math.max(1, Math.round(base * hintMul) + firstBonus);

      // Çizen her doğru tahminden: 0 ipucu=3, 1=1, 2=1 (ipucu cezası)
      const drawerPerGuess = Math.max(1, 3 - 2 * state.hintLevel);

      player.score += guesserPoints;
      drawer.score += drawerPerGuess;
      state.roundPoints[player.id] = (state.roundPoints[player.id] || 0) + guesserPoints;
      state.roundPoints[drawer.id] = (state.roundPoints[drawer.id] || 0) + drawerPerGuess;

      state.guesses.push({
        player: player.name,
        text: `✅ ${player.name} bildi! (+${guesserPoints})`,
        correct: true
      });
      if (state.guesses.length > 20) state.guesses.shift();

      const nonDrawerCount = room.players.length - 1;
      if (state.correctGuessers.length >= nonDrawerCount) {
        // Herkes bildi: çizene +5 ek bonus
        drawer.score += 5;
        state.roundPoints[drawer.id] = (state.roundPoints[drawer.id] || 0) + 5;
        this.endRound(room);
        return;
      }
      broadcastRoom(room.code);
    } else {
      state.guesses.push({ player: player.name, text, correct: false });
      if (state.guesses.length > 20) state.guesses.shift();
      broadcastRoom(room.code);
    }
  },

  endRound(room) {
    const state = room.gameState;
    if (state.timerId) clearInterval(state.timerId);
    state.phase = 'roundEnd';
    state.roundsPlayed++;

    const revealedWord = room.cizimSecret?.currentWord || '???';
    state.revealedWord = revealedWord;

    const drawerId = room.players[state.drawerIndex].id;
    const summary = room.players.map(p => ({
      id: p.id,
      name: p.name,
      total: p.score,
      thisRound: state.roundPoints[p.id] || 0,
      guessed: state.correctGuessers.includes(p.id),
      wasDrawer: p.id === drawerId
    }));
    state.lastSummary = summary;

    io.to(room.code).emit('cizim:reveal', { word: revealedWord, summary });

    setTimeout(() => {
      if (!rooms[room.code] || rooms[room.code].game !== 'cizim') return;
      if (state.roundsPlayed >= state.totalRounds) {
        state.gameOver = true;
        state.phase = 'gameOver';
        const sorted = [...room.players].sort((a, b) => b.score - a.score);
        state.winner = sorted[0]?.name || null;
        broadcastRoom(room.code);
      } else {
        state.drawerIndex = (state.drawerIndex + 1) % room.players.length;
        this.startRound(room);
      }
    }, 6000);

    broadcastRoom(room.code);
  },

  stop(room) {
    if (room.gameState && room.gameState.timerId) {
      clearInterval(room.gameState.timerId);
    }
    if (room.cizimSecret) delete room.cizimSecret;
  }
};

// ============================================================
// TRIVIA (BİLGİ YARIŞMASI)
// ============================================================
const Trivia = {
  QUESTION_TIME: 15, // saniye
  TOTAL_QUESTIONS: 10,

  start(room) {
    const settings = room.settings?.trivia || { questionTime: 15, totalQuestions: 10, streak: true, fiftyJoker: true };
    room.players.forEach(p => { p.score = 0; p.eliminated = false; });

    // Rastgele soru seç
    const shuffled = [...TRIVIA_QUESTIONS].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, settings.totalQuestions);

    const streaks = {};
    const fiftyLeft = {};
    for (const p of room.players) {
      streaks[p.id] = 0;
      fiftyLeft[p.id] = (settings.fiftyJoker !== false) ? 1 : 0;
    }

    room.gameState = {
      type: 'trivia',
      questions: selected,
      currentIndex: 0,
      currentQuestion: null,
      timeLeft: settings.questionTime,
      questionTime: settings.questionTime,
      timerId: null,
      answers: {},
      phase: 'question',
      lastAnswers: null,
      gameOver: false,
      winner: null,
      // YENI:
      streaks,
      streakEnabled: settings.streak !== false,
      fiftyLeft,
      fiftyJokerEnabled: settings.fiftyJoker !== false,
      fiftyEliminated: {} // per question: { playerId: [idx1, idx2] }
    };
    this.startQuestion(room);
  },

  useFiftyJoker(room, playerId) {
    const state = room.gameState;
    if (!state || state.phase !== 'question') return;
    if (!state.fiftyJokerEnabled) return;
    if ((state.fiftyLeft[playerId] || 0) <= 0) {
      io.to(playerId).emit('trivia:jokerError', { message: 'Joker hakkın kalmadı!' });
      return;
    }
    if (state.fiftyEliminated[playerId]) {
      io.to(playerId).emit('trivia:jokerError', { message: 'Bu soru için zaten kullandın!' });
      return;
    }
    if (state.answers[playerId] !== undefined) {
      io.to(playerId).emit('trivia:jokerError', { message: 'Zaten cevap verdin!' });
      return;
    }

    const q = state.questions[state.currentIndex];
    // Doğru olmayan 3 şıkkı tespit et, 2 tanesini rastgele seç
    const wrongs = [0, 1, 2, 3].filter(i => i !== q.correct);
    const shuffled = wrongs.sort(() => Math.random() - 0.5);
    const eliminated = shuffled.slice(0, 2);

    state.fiftyLeft[playerId]--;
    state.fiftyEliminated[playerId] = eliminated;

    io.to(playerId).emit('trivia:fiftyResult', {
      eliminated,
      jokersLeft: state.fiftyLeft[playerId]
    });
    broadcastRoom(room.code);
  },

  startQuestion(room) {
    const state = room.gameState;
    if (state.timerId) clearInterval(state.timerId);

    const q = state.questions[state.currentIndex];
    state.currentQuestion = {
      number: state.currentIndex + 1,
      total: state.questions.length,
      question: q.q,
      options: q.a,
      category: q.cat
    };
    state.timeLeft = state.questionTime;
    state.answers = {};
    state.phase = 'question';
    state.lastAnswers = null;
    state.fiftyEliminated = {}; // her soru başında sıfırla

    state.timerId = setInterval(() => {
      state.timeLeft--;
      io.to(room.code).emit('trivia:timer', { timeLeft: state.timeLeft });
      if (state.timeLeft <= 0) {
        this.revealAnswer(room);
      }
    }, 1000);

    broadcastRoom(room.code);
  },

  submitAnswer(room, playerId, answerIndex) {
    const state = room.gameState;
    if (!state || state.phase !== 'question') return;
    if (state.answers[playerId] !== undefined) return;
    if (answerIndex < 0 || answerIndex > 3) return;

    const timeUsed = state.questionTime - state.timeLeft;
    state.answers[playerId] = { answerIndex, timeUsed };

    const activeCount = room.players.length;
    if (Object.keys(state.answers).length >= activeCount) {
      setTimeout(() => this.revealAnswer(room), 500);
    } else {
      io.to(room.code).emit('trivia:answerCount', {
        count: Object.keys(state.answers).length,
        total: activeCount
      });
    }
  },

  revealAnswer(room) {
    const state = room.gameState;
    if (!state || state.phase !== 'question') return;
    if (state.timerId) clearInterval(state.timerId);

    const q = state.questions[state.currentIndex];
    const results = [];

    // Puanları hesapla
    room.players.forEach(player => {
      const ans = state.answers[player.id];
      let correct = false;
      let points = 0;
      let streakBonus = 0;
      if (ans && ans.answerIndex === q.correct) {
        correct = true;
        const timeFactor = 1 - (ans.timeUsed / state.questionTime);
        points = 50 + Math.round(50 * timeFactor);
        // Streak bonusu (2'inciden itibaren artar, max +10)
        if (state.streakEnabled) {
          state.streaks[player.id] = (state.streaks[player.id] || 0) + 1;
          if (state.streaks[player.id] >= 2) {
            streakBonus = Math.min(state.streaks[player.id] - 1, 10);
          }
          points += streakBonus;
        }
        player.score += points;
      } else {
        if (state.streakEnabled) state.streaks[player.id] = 0;
      }
      results.push({
        playerId: player.id,
        playerName: player.name,
        answerIndex: ans ? ans.answerIndex : -1,
        correct,
        points,
        streakBonus,
        streak: state.streaks[player.id] || 0
      });
    });

    state.phase = 'reveal';
    state.lastAnswers = {
      correctIndex: q.correct,
      results
    };
    broadcastRoom(room.code);

    // 4 saniye sonra sonraki soru
    setTimeout(() => {
      if (!rooms[room.code] || rooms[room.code].game !== 'trivia') return;
      state.currentIndex++;
      if (state.currentIndex >= state.questions.length) {
        state.gameOver = true;
        state.phase = 'gameOver';
        const sorted = [...room.players].sort((a, b) => b.score - a.score);
        state.winner = sorted[0]?.name || null;
        broadcastRoom(room.code);
      } else {
        this.startQuestion(room);
      }
    }, 4000);
  },

  stop(room) {
    if (room.gameState && room.gameState.timerId) {
      clearInterval(room.gameState.timerId);
    }
  }
};

// ============================================================
// VAMPİR KÖYLÜ
// ============================================================
const Vampir = {
  start(room) {
    if (room.players.length < 4) {
      io.to(room.host).emit('room:error', { message: 'Vampir Köylü en az 4 oyuncu gerektirir!' });
      return false;
    }

    const settings = room.settings?.vampir || {
      discussionTime: 60, voteTime: 20, nightTime: 25,
      extraVampire: false, doctorCount: 1, detectiveCount: 1,
      witch: false, jester: false
    };

    // Rol dağıtımı
    const n = room.players.length;
    let vampireCount;
    if (n <= 5) vampireCount = settings.extraVampire ? 2 : 1;
    else if (n <= 8) vampireCount = 2;
    else vampireCount = 3; // 9-12 kişi: 3 vampir
    const doctorCount = Math.max(0, Math.min(2, settings.doctorCount ?? 1));
    const detectiveCount = Math.max(0, Math.min(2, settings.detectiveCount ?? 1));
    const witchCount = settings.witch ? 1 : 0;
    const jesterCount = settings.jester ? 1 : 0;

    // Toplam özel rol + vampir < n olsun, kalanı köylü
    let specialTotal = vampireCount + doctorCount + detectiveCount + witchCount + jesterCount;
    if (specialTotal >= n) {
      // Vampir hariç önceliğe göre azalt
      const reduceOrder = ['jesterCount', 'witchCount', 'detectiveCount', 'doctorCount'];
      const counts = { jesterCount, witchCount, detectiveCount, doctorCount };
      let i = 0;
      while (specialTotal >= n && i < reduceOrder.length) {
        if (counts[reduceOrder[i]] > 0) {
          counts[reduceOrder[i]]--;
          specialTotal--;
        } else {
          i++;
        }
      }
    }

    const roles = [];
    for (let i = 0; i < vampireCount; i++) roles.push('vampir');
    for (let i = 0; i < doctorCount; i++) roles.push('doktor');
    for (let i = 0; i < detectiveCount; i++) roles.push('dedektif');
    for (let i = 0; i < witchCount; i++) roles.push('cadi');
    for (let i = 0; i < jesterCount; i++) roles.push('soytari');
    while (roles.length < n) roles.push('koylu');

    // Karıştır
    roles.sort(() => Math.random() - 0.5);

    // Oyunculara dağıt
    room.players.forEach((p, i) => {
      p.role = roles[i];
      p.alive = true;
      p.score = 0;
    });

    // Her oyuncuya kendi rolünü gizlice yolla
    room.players.forEach(p => {
      io.to(p.id).emit('vampir:role', { role: p.role });
    });

    // Vampirlere birbirlerini söyle
    const vampires = room.players.filter(p => p.role === 'vampir');
    vampires.forEach(v => {
      io.to(v.id).emit('vampir:teammates', {
        teammates: vampires.filter(t => t.id !== v.id).map(t => t.name)
      });
    });

    // Cadı için iksir durumunu hazırla (oyun boyu, oyuncu başına)
    const witchPotions = {};
    room.players.forEach(p => {
      if (p.role === 'cadi') witchPotions[p.id] = { protect: 1, kill: 1 };
    });

    room.gameState = {
      type: 'vampir',
      phase: 'night',
      dayNumber: 1,
      timeLeft: settings.nightTime,
      nightTime: settings.nightTime,
      discussionTime: settings.discussionTime,
      voteTime: settings.voteTime,
      timerId: null,
      nightActions: {
        vampireTargets: {},
        doctorTargets: {},      // { doctorId: targetId } - çoklu doktor desteği
        detectiveTargets: {},   // { detectiveId: targetId }
        witchProtect: null,     // (cadı koruma hedefi)
        witchKill: null         // (cadı öldürme hedefi)
      },
      votes: {},
      events: [],
      chat: [],
      witchPotions,
      hasWitch: witchCount > 0,
      hasJester: jesterCount > 0,
      gameOver: false,
      winner: null,
      jesterWon: false        // Soytarı oylanırsa true
    };

    this.startPhase(room, 'night');
    return true;
  },

  startPhase(room, phase) {
    const state = room.gameState;
    if (state.timerId) clearInterval(state.timerId);
    state.phase = phase;

    if (phase === 'night') {
      state.timeLeft = state.nightTime;
      state.nightActions = {
        vampireTargets: {},
        doctorTargets: {},
        detectiveTargets: {},
        witchProtect: null,
        witchKill: null
      };
    } else if (phase === 'dayDiscussion') {
      state.timeLeft = state.discussionTime;
      state.chat = [];
    } else if (phase === 'dayVote') {
      state.timeLeft = state.voteTime;
      state.votes = {};
    }

    state.timerId = setInterval(() => {
      state.timeLeft--;
      io.to(room.code).emit('vampir:timer', { timeLeft: state.timeLeft });
      if (state.timeLeft <= 0) {
        this.endPhase(room);
      }
    }, 1000);

    broadcastRoom(room.code);
  },

  endPhase(room) {
    const state = room.gameState;
    if (state.timerId) clearInterval(state.timerId);

    if (state.phase === 'night') {
      this.resolveNight(room);
    } else if (state.phase === 'dayDiscussion') {
      this.startPhase(room, 'dayVote');
    } else if (state.phase === 'dayVote') {
      this.resolveVote(room);
    }
  },

  resolveNight(room) {
    const state = room.gameState;

    // Vampirlerin oyladığı hedef (en çok oy alan)
    const voteCounts = {};
    Object.values(state.nightActions.vampireTargets).forEach(targetId => {
      voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
    });
    let killTarget = null;
    let maxVotes = 0;
    for (const id in voteCounts) {
      if (voteCounts[id] > maxVotes) {
        maxVotes = voteCounts[id];
        killTarget = id;
      }
    }

    // Doktorların koruduğu hedefler (set)
    const protectedIds = new Set(Object.values(state.nightActions.doctorTargets || {}));
    if (state.nightActions.witchProtect) protectedIds.add(state.nightActions.witchProtect);

    const killedNames = [];

    // Vampir saldırısı
    if (killTarget && !protectedIds.has(killTarget)) {
      const victim = room.players.find(p => p.id === killTarget);
      if (victim && victim.alive) {
        victim.alive = false;
        killedNames.push(victim.name);
      }
    }

    // Cadı öldürme iksiri
    if (state.nightActions.witchKill && state.nightActions.witchKill !== state.nightActions.witchProtect) {
      const witchVictim = room.players.find(p => p.id === state.nightActions.witchKill);
      if (witchVictim && witchVictim.alive) {
        witchVictim.alive = false;
        killedNames.push(witchVictim.name + ' (cadı iksiriyle)');
      }
    }

    // Dedektif sonuçları - her dedektife kendi hedefinin sonucu
    for (const [detId, targetId] of Object.entries(state.nightActions.detectiveTargets || {})) {
      const detective = room.players.find(p => p.id === detId);
      const target = room.players.find(p => p.id === targetId);
      if (detective && detective.alive && target) {
        io.to(detective.id).emit('vampir:detectiveResult', {
          targetName: target.name,
          isVampire: target.role === 'vampir'
        });
      }
    }

    // Gece olayı kaydet
    let msg;
    if (killedNames.length === 0) {
      msg = '🌙 Gece: Kimse ölmedi (koruma veya saldırı yok).';
    } else if (killedNames.length === 1) {
      msg = `🌙 Gece: ${killedNames[0]} öldü!`;
    } else {
      msg = `🌙 Gece: ${killedNames.join(', ')} öldü!`;
    }
    state.events.push({ day: state.dayNumber, type: 'night', message: msg });

    // Oyun bitti mi?
    if (this.checkGameOver(room)) return;

    // Gündüz tartışma
    state.dayNumber++;
    this.startPhase(room, 'dayDiscussion');
  },

  resolveVote(room) {
    const state = room.gameState;

    // En çok oy alanı bul
    const voteCounts = {};
    Object.values(state.votes).forEach(targetId => {
      if (targetId !== 'skip') {
        voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
      }
    });

    let eliminated = null;
    let maxVotes = 0;
    let tie = false;
    for (const id in voteCounts) {
      if (voteCounts[id] > maxVotes) {
        maxVotes = voteCounts[id];
        eliminated = id;
        tie = false;
      } else if (voteCounts[id] === maxVotes) {
        tie = true;
      }
    }

    if (eliminated && !tie && maxVotes > 0) {
      const player = room.players.find(p => p.id === eliminated);
      if (player) {
        player.alive = false;
        state.events.push({
          day: state.dayNumber,
          type: 'day',
          message: `☀️ Oylama: ${player.name} köyden kovuldu! (Rolü: ${this.roleEmoji(player.role)} ${this.roleName(player.role)})`
        });

        // Soytarı kazanma kontrolü
        if (player.role === 'soytari') {
          state.jesterWon = true;
          state.gameOver = true;
          state.phase = 'gameOver';
          state.winner = 'soytari';
          player.score += 3; // soytarı kazandığı için bonus
          state.events.push({
            day: state.dayNumber,
            type: 'day',
            message: `🤡 ${player.name} SOYTARIYDI! Köy onu idam etti, kazandı!`
          });
          if (state.timerId) clearInterval(state.timerId);
          broadcastRoom(room.code);
          return;
        }
      }
    } else {
      state.events.push({
        day: state.dayNumber,
        type: 'day',
        message: '☀️ Oylama: Anlaşılamadı, kimse kovulmadı.'
      });
    }

    // Oyun bitti mi?
    if (this.checkGameOver(room)) return;

    // Gece
    this.startPhase(room, 'night');
  },

  checkGameOver(room) {
    const state = room.gameState;
    const aliveVampires = room.players.filter(p => p.alive && p.role === 'vampir').length;
    // Soytarı bağımsız ama yaşayan sayımına dahil değil (köyle savaşmıyor)
    const aliveTownish = room.players.filter(p => p.alive && p.role !== 'vampir' && p.role !== 'soytari').length;

    if (aliveVampires === 0) {
      state.gameOver = true;
      state.phase = 'gameOver';
      state.winner = 'koyluler';
      room.players.forEach(p => {
        if (p.role !== 'vampir' && p.role !== 'soytari') p.score += 1;
      });
      if (state.timerId) clearInterval(state.timerId);
      broadcastRoom(room.code);
      return true;
    }
    if (aliveVampires >= aliveTownish) {
      state.gameOver = true;
      state.phase = 'gameOver';
      state.winner = 'vampirler';
      room.players.forEach(p => {
        if (p.role === 'vampir') p.score += 1;
      });
      if (state.timerId) clearInterval(state.timerId);
      broadcastRoom(room.code);
      return true;
    }
    return false;
  },

  vampireKill(room, playerId, targetId) {
    const state = room.gameState;
    if (!state || state.phase !== 'night') return;
    const player = room.players.find(p => p.id === playerId);
    if (!player || !player.alive || player.role !== 'vampir') return;
    const target = room.players.find(p => p.id === targetId);
    if (!target || !target.alive || target.role === 'vampir') return;
    
    state.nightActions.vampireTargets[playerId] = targetId;
    
    // Diğer vampirlere bildir
    const vampires = room.players.filter(p => p.role === 'vampir' && p.alive);
    vampires.forEach(v => {
      io.to(v.id).emit('vampir:vampireVotes', {
        votes: Object.fromEntries(
          Object.entries(state.nightActions.vampireTargets).map(([vid, tid]) => {
            const voter = room.players.find(p => p.id === vid);
            const tgt = room.players.find(p => p.id === tid);
            return [voter?.name || '?', tgt?.name || '?'];
          })
        )
      });
    });
  },

  doctorSave(room, playerId, targetId) {
    const state = room.gameState;
    if (!state || state.phase !== 'night') return;
    const player = room.players.find(p => p.id === playerId);
    if (!player || !player.alive || player.role !== 'doktor') return;
    const target = room.players.find(p => p.id === targetId);
    if (!target || !target.alive) return;

    state.nightActions.doctorTargets[playerId] = targetId;
    io.to(playerId).emit('vampir:actionConfirm', {
      message: `${target.name} bu gece korumaya alındı.`
    });
  },

  detectiveCheck(room, playerId, targetId) {
    const state = room.gameState;
    if (!state || state.phase !== 'night') return;
    const player = room.players.find(p => p.id === playerId);
    if (!player || !player.alive || player.role !== 'dedektif') return;
    const target = room.players.find(p => p.id === targetId);
    if (!target || !target.alive || target.id === playerId) return;

    state.nightActions.detectiveTargets[playerId] = targetId;
    io.to(playerId).emit('vampir:actionConfirm', {
      message: `${target.name} araştırılıyor...`
    });
  },

  witchPotion(room, playerId, type, targetId) {
    // type: 'protect' veya 'kill'
    const state = room.gameState;
    if (!state || state.phase !== 'night') return;
    const player = room.players.find(p => p.id === playerId);
    if (!player || !player.alive || player.role !== 'cadi') return;
    const potions = state.witchPotions?.[playerId];
    if (!potions || (potions[type] || 0) <= 0) {
      io.to(playerId).emit('vampir:actionConfirm', { message: 'Bu iksir bitti!' });
      return;
    }
    const target = room.players.find(p => p.id === targetId);
    if (!target || !target.alive) return;

    if (type === 'protect') {
      state.nightActions.witchProtect = targetId;
      potions.protect--;
      io.to(playerId).emit('vampir:actionConfirm', {
        message: `${target.name} koruma iksiriyle kurtarıldı. (${potions.protect} koruma kaldı)`
      });
    } else if (type === 'kill') {
      // Cadı kendine kill iksiri kullanamaz
      if (targetId === playerId) {
        io.to(playerId).emit('vampir:actionConfirm', { message: 'Kendine öldürme iksiri kullanamazsın!' });
        return;
      }
      state.nightActions.witchKill = targetId;
      potions.kill--;
      io.to(playerId).emit('vampir:actionConfirm', {
        message: `${target.name} öldürme iksiri kurbanı. (${potions.kill} öldürme kaldı)`
      });
    }
  },

  dayVote(room, playerId, targetId) {
    const state = room.gameState;
    if (!state || state.phase !== 'dayVote') return;
    const player = room.players.find(p => p.id === playerId);
    if (!player || !player.alive) return;
    if (targetId !== 'skip') {
      const target = room.players.find(p => p.id === targetId);
      if (!target || !target.alive) return;
    }
    state.votes[playerId] = targetId;
    broadcastRoom(room.code);
  },

  dayChat(room, playerId, text) {
    const state = room.gameState;
    if (!state || state.phase !== 'dayDiscussion') return;
    const player = room.players.find(p => p.id === playerId);
    if (!player || !player.alive) return;
    text = (text || '').trim().slice(0, 200);
    if (!text) return;
    state.chat.push({ player: player.name, text });
    if (state.chat.length > 50) state.chat.shift();
    broadcastRoom(room.code);
  },

  roleEmoji(role) {
    return { vampir: '🧛', doktor: '⚕️', dedektif: '🔍', cadi: '🧙', soytari: '🤡', koylu: '👨‍🌾' }[role] || '?';
  },
  roleName(role) {
    return { vampir: 'Vampir', doktor: 'Doktor', dedektif: 'Dedektif', cadi: 'Cadı', soytari: 'Soytarı', koylu: 'Köylü' }[role] || '?';
  },

  stop(room) {
    if (room.gameState && room.gameState.timerId) {
      clearInterval(room.gameState.timerId);
    }
  }
};

// ============================================================
// YILAN SAVAŞI (Slither.io basit klonu)
// ============================================================
// ============================================================
// YILAN v2 — büyük arena, boost, çoklu yem türü, ölüm yemi, temiz collision
// ============================================================
const Yilan = {
  TICK_RATE: 60,           // ms
  ARENA_W: 1600,
  ARENA_H: 1100,
  BASE_SPEED: 2.8,         // px/tick
  BOOST_MULT: 1.9,         // boost hız çarpanı
  BOOST_COST_INTERVAL: 1000, // ms — her saniye boost cezası
  BOOST_SEGMENT_COST: 1,   // boost'ta saniyede kaybedilen segment
  INITIAL_LENGTH: 12,
  SEG_SPACING: 8,          // segmentler arası px
  HEAD_RADIUS: 9,
  COLLISION_RADIUS: 8,
  GROW_PER_FOOD: { small: 2, medium: 4, large: 7 },
  POINTS_PER_FOOD: { small: 1, medium: 3, large: 5 },
  FOOD_TYPES: ['small', 'medium', 'large'],
  FOOD_WEIGHTS: [0.65, 0.28, 0.07], // büyük yem nadir
  COLORS: [
    '#ff3e8a', '#00d4ff', '#ffd93d', '#6bcf7f',
    '#a86bff', '#ff9f4a', '#4ade80', '#f472b6',
    '#34d399', '#fb923c', '#60a5fa', '#facc15'
  ],

  start(room) {
    if (room.players.length < 2) return false;
    const settings = room.settings?.yilan || { duration: 120, foodCount: 60, speed: 3 };
    const speedMul = (settings.speed || 3) / 3;

    const snakes = {};
    room.players.forEach((p, i) => {
      // Spawn pozisyonu — arena içinde dağılmış, kenardan uzak
      const cols = 4;
      const cellW = this.ARENA_W / cols;
      const cellH = this.ARENA_H / 3;
      const cx = ((i % cols) + 0.5) * cellW;
      const cy = (Math.floor(i / cols) + 0.5) * cellH;
      // Başlangıç yönü (rastgele)
      const angle = Math.random() * Math.PI * 2;
      const dir = { x: Math.cos(angle), y: Math.sin(angle) };
      const body = [];
      for (let j = 0; j < this.INITIAL_LENGTH; j++) {
        body.push({ x: cx - dir.x * j * this.SEG_SPACING, y: cy - dir.y * j * this.SEG_SPACING });
      }
      snakes[p.id] = {
        id: p.id,
        name: p.name,
        color: this.COLORS[i % this.COLORS.length],
        body,
        direction: dir,
        directionQueue: [],
        boosting: false,
        boostAccumMs: 0,
        alive: true,
        score: 0,
        deathTime: null
      };
      p.score = 0;
    });

    const foods = [];
    for (let i = 0; i < (settings.foodCount || 60); i++) foods.push(this.randomFood());

    room.gameState = {
      type: 'yilan',
      arenaW: this.ARENA_W,
      arenaH: this.ARENA_H,
      snakes,
      foods,
      timeLeft: settings.duration || 120,
      duration: settings.duration || 120,
      foodCount: settings.foodCount || 60,
      baseSpeed: this.BASE_SPEED * speedMul,
      tickId: null,
      timerId: null,
      gameOver: false,
      winner: null
    };

    room.gameState.tickId = setInterval(() => this.tick(room), this.TICK_RATE);
    room.gameState.timerId = setInterval(() => {
      room.gameState.timeLeft--;
      if (room.gameState.timeLeft <= 0) this.endGame(room);
    }, 1000);

    broadcastRoom(room.code);
    return true;
  },

  randomFood(typeOverride = null) {
    let type = typeOverride;
    if (!type) {
      const r = Math.random();
      let acc = 0;
      for (let i = 0; i < this.FOOD_TYPES.length; i++) {
        acc += this.FOOD_WEIGHTS[i];
        if (r < acc) { type = this.FOOD_TYPES[i]; break; }
      }
      if (!type) type = 'small';
    }
    return {
      x: Math.floor(Math.random() * (this.ARENA_W - 40)) + 20,
      y: Math.floor(Math.random() * (this.ARENA_H - 40)) + 20,
      type
    };
  },

  tick(room) {
    const state = room.gameState;
    if (!state || state.gameOver) return;

    const snakes = state.snakes;
    const baseSpeed = state.baseSpeed || this.BASE_SPEED;

    for (const id in snakes) {
      const snake = snakes[id];
      if (!snake.alive) continue;

      // Yön kuyruğundan bir sonrakini al (eğer var ve geçerli ise)
      while (snake.directionQueue.length > 0) {
        const next = snake.directionQueue.shift();
        // Tam tersi yön engelle
        if (snake.direction.x === -next.x && snake.direction.y === -next.y) continue;
        snake.direction = next;
        break;
      }

      // Boost
      const speed = snake.boosting && snake.body.length > 6 ? baseSpeed * this.BOOST_MULT : baseSpeed;
      if (snake.boosting && snake.body.length > 6) {
        snake.boostAccumMs += this.TICK_RATE;
        if (snake.boostAccumMs >= this.BOOST_COST_INTERVAL) {
          snake.boostAccumMs -= this.BOOST_COST_INTERVAL;
          // Boost cezası: tail kaybı + yere yem bırak
          for (let k = 0; k < this.BOOST_SEGMENT_COST && snake.body.length > 6; k++) {
            const tail = snake.body.pop();
            if (tail && Math.random() < 0.5) {
              // %50 olasılıkla yem bırak
              state.foods.push({ x: tail.x, y: tail.y, type: 'small' });
            }
          }
        }
      } else {
        snake.boostAccumMs = 0;
        if (snake.boosting && snake.body.length <= 6) snake.boosting = false;
      }

      const head = snake.body[0];
      const newHead = { x: head.x + snake.direction.x * speed, y: head.y + snake.direction.y * speed };

      // Duvar çarpması
      if (newHead.x < 0 || newHead.x > state.arenaW || newHead.y < 0 || newHead.y > state.arenaH) {
        this.killSnake(state, snake);
        continue;
      }

      // Çarpışma kontrolü — başka yılanların tüm gövdesi + kendi gövdesi (yeterince geride)
      let collided = false;
      const collR2 = this.COLLISION_RADIUS * this.COLLISION_RADIUS;
      const headCollR2 = (this.COLLISION_RADIUS + this.HEAD_RADIUS) * (this.COLLISION_RADIUS + this.HEAD_RADIUS) / 4;
      for (const otherId in snakes) {
        const other = snakes[otherId];
        if (!other.alive) continue;
        // Kendi gövdesinde ilk N segmenti atla (yön değişikliklerinde tight loop'a izin ver)
        const skipFirst = (otherId === id) ? Math.max(6, Math.ceil(this.HEAD_RADIUS / this.SEG_SPACING) + 2) : 0;
        for (let i = skipFirst; i < other.body.length; i++) {
          const seg = other.body[i];
          const dx = newHead.x - seg.x;
          const dy = newHead.y - seg.y;
          if (dx * dx + dy * dy < collR2) { collided = true; break; }
        }
        if (collided) break;
      }
      if (collided) {
        this.killSnake(state, snake);
        continue;
      }

      // Yem yeme
      let grew = 0;
      let points = 0;
      for (let i = state.foods.length - 1; i >= 0; i--) {
        const f = state.foods[i];
        const dx = newHead.x - f.x;
        const dy = newHead.y - f.y;
        if (dx * dx + dy * dy < (this.HEAD_RADIUS + 6) * (this.HEAD_RADIUS + 6)) {
          grew += this.GROW_PER_FOOD[f.type] || 1;
          points += this.POINTS_PER_FOOD[f.type] || 1;
          state.foods.splice(i, 1);
          // Yerine yeni standart yem ekle (sadece toplam sayıyı koru)
          if (state.foods.length < state.foodCount) state.foods.push(this.randomFood());
        }
      }
      if (grew > 0) {
        snake.score += points;
        const player = room.players.find(p => p.id === id);
        if (player) player.score = snake.score;
      }

      // Yeni başı ekle
      snake.body.unshift(newHead);
      // Büyüme miktarı kadar fazla segment tut
      const targetLen = snake.body.length + grew - 1;
      while (snake.body.length > targetLen) snake.body.pop();
    }

    // Oyun bitti mi?
    const aliveCount = Object.values(snakes).filter(s => s.alive).length;
    if (aliveCount <= 1 && room.players.length > 1) {
      this.endGame(room);
      return;
    }

    // Hafif tick payload (broadcast yerine ham emit)
    io.to(room.code).emit('yilan:tick', {
      snakes: Object.fromEntries(Object.entries(snakes).map(([id, s]) => [id, {
        body: s.body, color: s.color, alive: s.alive,
        name: s.name, score: s.score, boosting: s.boosting,
        dir: s.direction
      }])),
      foods: state.foods,
      timeLeft: state.timeLeft
    });
  },

  killSnake(state, snake) {
    snake.alive = false;
    snake.deathTime = Date.now();
    // Ölünce gövdesi yere yem olarak dağılır (her 2 segmentten 1 yem)
    for (let i = 0; i < snake.body.length; i += 2) {
      const seg = snake.body[i];
      const type = Math.random() < 0.15 ? 'large' : (Math.random() < 0.4 ? 'medium' : 'small');
      state.foods.push({ x: seg.x, y: seg.y, type });
    }
    // Yem sayısını sınırla
    while (state.foods.length > state.foodCount * 2) state.foods.shift();
  },

  changeDirection(room, playerId, direction) {
    const state = room.gameState;
    if (!state || state.gameOver) return;
    const snake = state.snakes[playerId];
    if (!snake || !snake.alive) return;
    // Sadece 4 ana yön kabul
    const norm = { x: Math.sign(direction.x) || 0, y: Math.sign(direction.y) || 0 };
    if ((norm.x === 0 && norm.y === 0) || (norm.x !== 0 && norm.y !== 0)) return;
    // Kuyruğa ekle (en fazla 2 birikme)
    if (snake.directionQueue.length >= 2) return;
    // Son kuyruktaki ile aynıysa eklemeye gerek yok
    const lastDir = snake.directionQueue.length > 0
      ? snake.directionQueue[snake.directionQueue.length - 1]
      : snake.direction;
    if (lastDir.x === norm.x && lastDir.y === norm.y) return;
    if (lastDir.x === -norm.x && lastDir.y === -norm.y) return; // anlık geri dönüş yasak
    snake.directionQueue.push(norm);
  },

  setBoost(room, playerId, on) {
    const state = room.gameState;
    if (!state || state.gameOver) return;
    const snake = state.snakes[playerId];
    if (!snake || !snake.alive) return;
    snake.boosting = !!on;
    if (!on) snake.boostAccumMs = 0;
  },

  endGame(room) {
    const state = room.gameState;
    if (!state || state.gameOver) return;
    state.gameOver = true;
    if (state.tickId) clearInterval(state.tickId);
    if (state.timerId) clearInterval(state.timerId);

    const sorted = Object.values(state.snakes).sort((a, b) => b.score - a.score);
    state.winner = sorted[0]?.name || null;
    broadcastRoom(room.code);
  },

  stop(room) {
    if (room.gameState) {
      if (room.gameState.tickId) clearInterval(room.gameState.tickId);
      if (room.gameState.timerId) clearInterval(room.gameState.timerId);
    }
  }
};

// ============================================================
// AMİRAL BATTI
// ============================================================
const AmiralBatti = {
  GRID_SIZE: 8,
  SHIPS: [
    { name: '4lü', size: 4 },
    { name: '3lü', size: 3 },
    { name: '3lü', size: 3 },
    { name: '2li', size: 2 },
    { name: '2li', size: 2 }
  ],

  start(room) {
    // Sadece 2 oyuncu - 2'den çoksa ilk 2'sini kullan
    if (room.players.length < 2) return false;
    
    // Sadece ilk iki oyuncu oynar, diğerleri izleyici
    room.gameState = {
      type: 'amiral',
      phase: 'placement',  // 'placement' | 'battle' | 'gameOver'
      players: [room.players[0].id, room.players[1].id], // sıradaki iki kişi
      boards: {},  // { playerId: { ships: [...], shots: [...] } }
      currentTurn: room.players[0].id,
      gameOver: false,
      winner: null,
      lastMove: null
    };

    // Her iki oyuncu için boş tahta
    room.gameState.players.forEach(pid => {
      room.gameState.boards[pid] = {
        ships: [],     // [{ name, cells: [{x,y, hit}], sunk }]
        shots: [],     // [{ x, y, hit }]  - karşı oyuncunun tahtasına attığı atışlar
        ready: false
      };
    });

    room.players.forEach(p => { p.score = 0; });
    broadcastRoom(room.code);
    return true;
  },

  placeShips(room, playerId, ships) {
    const state = room.gameState;
    if (!state || state.phase !== 'placement') return;
    if (!state.players.includes(playerId)) return;
    
    // Doğrulama: 5 gemi olmalı, hepsi tahta içinde, çakışma yok
    if (!Array.isArray(ships) || ships.length !== this.SHIPS.length) {
      io.to(playerId).emit('amiral:error', { message: 'Eksik gemi yerleştirdin!' });
      return;
    }

    const board = state.boards[playerId];
    const placedShips = [];
    const cellMap = new Set();

    for (let i = 0; i < ships.length; i++) {
      const ship = ships[i];
      const expectedSize = this.SHIPS[i].size;
      if (!ship.cells || ship.cells.length !== expectedSize) {
        io.to(playerId).emit('amiral:error', { message: 'Geçersiz gemi boyutu!' });
        return;
      }
      for (const cell of ship.cells) {
        if (cell.x < 0 || cell.x >= this.GRID_SIZE || cell.y < 0 || cell.y >= this.GRID_SIZE) {
          io.to(playerId).emit('amiral:error', { message: 'Gemi tahta dışında!' });
          return;
        }
        const key = `${cell.x},${cell.y}`;
        if (cellMap.has(key)) {
          io.to(playerId).emit('amiral:error', { message: 'Gemiler çakışıyor!' });
          return;
        }
        cellMap.add(key);
      }
      placedShips.push({
        name: this.SHIPS[i].name,
        cells: ship.cells.map(c => ({ x: c.x, y: c.y, hit: false })),
        sunk: false
      });
    }

    board.ships = placedShips;
    board.ready = true;

    // İki oyuncu da hazırsa savaşa geç
    if (state.players.every(pid => state.boards[pid].ready)) {
      state.phase = 'battle';
    }
    broadcastRoom(room.code);
  },

  shoot(room, playerId, x, y) {
    const state = room.gameState;
    if (!state || state.phase !== 'battle') return;
    if (state.currentTurn !== playerId) return;
    if (!state.players.includes(playerId)) return;
    if (x < 0 || x >= this.GRID_SIZE || y < 0 || y >= this.GRID_SIZE) return;

    const opponent = state.players.find(pid => pid !== playerId);
    const myBoard = state.boards[playerId];
    const opponentBoard = state.boards[opponent];

    // Zaten ateş edilmiş mi?
    if (myBoard.shots.some(s => s.x === x && s.y === y)) return;

    // Hit kontrolü
    let hit = false;
    let sunkShip = null;
    for (const ship of opponentBoard.ships) {
      for (const cell of ship.cells) {
        if (cell.x === x && cell.y === y) {
          cell.hit = true;
          hit = true;
          // Gemi battı mı?
          if (ship.cells.every(c => c.hit)) {
            ship.sunk = true;
            sunkShip = ship.name;
          }
          break;
        }
      }
      if (hit) break;
    }

    myBoard.shots.push({ x, y, hit });
    state.lastMove = { 
      shooter: playerId, 
      x, y, hit, sunkShip,
      shooterName: room.players.find(p => p.id === playerId)?.name 
    };

    // Tüm gemiler battı mı? (oyun bitti)
    const allSunk = opponentBoard.ships.every(s => s.sunk);
    if (allSunk) {
      state.gameOver = true;
      state.phase = 'gameOver';
      const winner = room.players.find(p => p.id === playerId);
      state.winner = winner?.name;
      if (winner) winner.score = 1;
      broadcastRoom(room.code);
      return;
    }

    // İsabet ettiyse tekrar oynar, yoksa sıra değişir
    if (!hit) {
      state.currentTurn = opponent;
    }
    broadcastRoom(room.code);
  },

  stop(room) {
    // Amiral Battı'da timer yok
  }
};

// ============================================================
// UNO BENZERİ
// ============================================================
// ============================================================
// CODENAMES TR
// ============================================================
let CODENAMES_WORDS = [];
try {
  CODENAMES_WORDS = [...new Set(require('./data/codenames-words'))];
  console.log(`Codenames kelime havuzu: ${CODENAMES_WORDS.length} kelime`);
} catch (e) {
  console.warn('Codenames kelimeleri yüklenemedi:', e.message);
}

const Codenames = {
  start(room) {
    // Setup fazı — takım/rol seçimi için boş state
    room.players.forEach(p => {
      p.score = 0;
      p.eliminated = false;
    });
    room.gameState = {
      type: 'codenames',
      phase: 'setup',
      board: null,
      teams: { red: [], blue: [] },
      spymasters: { red: null, blue: null },
      currentTurn: null,
      firstTeam: null,
      currentClue: null,
      guessesLeft: 0,
      remaining: { red: 0, blue: 0 },
      log: [],
      winner: null,
      loseReason: null,
      gameOver: false
    };
    broadcastRoom(room.code);
    return true;
  },

  beginRound(room, hostId) {
    const state = room.gameState;
    if (!state || state.phase !== 'setup') return;
    if (room.host !== hostId) return;

    const s = room.settings?.codenames || {};
    const firstTeam = (s.firstTeam === 'red' || s.firstTeam === 'blue')
      ? s.firstTeam : (Math.random() < 0.5 ? 'red' : 'blue');

    const red = room.players.filter(p => p.codenamesTeam === 'red');
    const blue = room.players.filter(p => p.codenamesTeam === 'blue');
    if (red.length < 2 || blue.length < 2) {
      io.to(hostId).emit('room:error', { message: 'Her takımda en az 2 oyuncu lazım!' });
      return;
    }
    const redSpy = red.find(p => p.codenamesRole === 'spymaster');
    const blueSpy = blue.find(p => p.codenamesRole === 'spymaster');
    if (!redSpy || !blueSpy) {
      io.to(hostId).emit('room:error', { message: 'Her takımda 1 Casus Şefi seçilmeli!' });
      return;
    }

    // 25 random kelime seç
    const shuffled = [...CODENAMES_WORDS].sort(() => Math.random() - 0.5);
    const words = shuffled.slice(0, 25);

    // Roller: ilk takım 9, diğer 8, 7 sivil, 1 suikastçi
    const roles = [];
    for (let i = 0; i < 9; i++) roles.push(firstTeam);
    for (let i = 0; i < 8; i++) roles.push(firstTeam === 'red' ? 'blue' : 'red');
    for (let i = 0; i < 7; i++) roles.push('civilian');
    roles.push('assassin');
    roles.sort(() => Math.random() - 0.5);

    state.board = words.map((w, i) => ({ word: w, role: roles[i], revealed: false }));
    state.teams = { red: red.map(p => p.id), blue: blue.map(p => p.id) };
    state.spymasters = { red: redSpy.id, blue: blueSpy.id };
    state.currentTurn = firstTeam;
    state.firstTeam = firstTeam;
    state.phase = 'clueGiving';
    state.remaining = {
      red: firstTeam === 'red' ? 9 : 8,
      blue: firstTeam === 'blue' ? 9 : 8
    };
    state.log = [`🎮 Oyun başladı! ${firstTeam === 'red' ? '🔴' : '🔵'} takım ilk hamleyi yapacak.`];
    broadcastRoom(room.code);
  },

  giveClue(room, playerId, word, count) {
    const state = room.gameState;
    if (!state || state.phase !== 'clueGiving') return;
    const team = state.currentTurn;
    if (state.spymasters[team] !== playerId) return; // Sadece aktif takımın casus şefi

    word = (word || '').toString().trim().slice(0, 30);
    count = parseInt(count) || 0;
    if (!word) return;
    if (count < 0 || count > 9) return;
    // İpucu kelime board'da olmamalı (revealed olsa bile — kuralı sıkı tut)
    const lowerWord = word.toLocaleLowerCase('tr-TR');
    const inBoard = state.board.some(c => c.word.toLocaleLowerCase('tr-TR') === lowerWord);
    if (inBoard) {
      io.to(playerId).emit('room:error', { message: 'İpucu, tahtadaki kelimelerden olamaz!' });
      return;
    }

    state.currentClue = { word, count, given: true };
    state.phase = 'guessing';
    state.guessesLeft = count + 1; // +1 ekstra tahmin hakkı (klasik kural)
    state.log.unshift(`💡 ${team.toUpperCase()} Casus Şefi: "${word}" — ${count}`);
    if (state.log.length > 12) state.log.pop();
    broadcastRoom(room.code);
  },

  guessCard(room, playerId, cardIndex) {
    const state = room.gameState;
    if (!state || state.phase !== 'guessing') return;
    const team = state.currentTurn;
    // Aktif takımın casus şefi olmayan üyeleri tahmin yapabilir
    if (!state.teams[team].includes(playerId)) return;
    if (state.spymasters[team] === playerId) return;

    const card = state.board[cardIndex];
    if (!card || card.revealed) return;

    card.revealed = true;
    const player = room.players.find(p => p.id === playerId);
    state.log.unshift(`${team === 'red' ? '🔴' : '🔵'} ${player?.name} açtı: ${card.word} → ${this.roleLabel(card.role)}`);
    if (state.log.length > 12) state.log.pop();

    if (card.role === 'assassin') {
      // Suikastçi açıldı → o takım kaybetti
      state.phase = 'gameOver';
      state.gameOver = true;
      state.winner = team === 'red' ? 'blue' : 'red';
      state.loseReason = 'assassin';
      state.log.unshift(`💀 SUİKASTÇİ! ${team.toUpperCase()} kaybetti!`);
      // Puan
      room.players.forEach(p => {
        if (p.codenamesTeam === state.winner) p.score += 1;
      });
      broadcastRoom(room.code);
      return;
    }

    if (card.role === 'red' || card.role === 'blue') {
      state.remaining[card.role]--;
      // Kazanma kontrolü
      if (state.remaining[card.role] === 0) {
        state.phase = 'gameOver';
        state.gameOver = true;
        state.winner = card.role;
        state.log.unshift(`🏆 ${card.role.toUpperCase()} kazandı!`);
        room.players.forEach(p => {
          if (p.codenamesTeam === state.winner) p.score += 1;
        });
        broadcastRoom(room.code);
        return;
      }
    }

    // Sıra mı geçer?
    let switchTurn = false;
    if (card.role !== team) {
      // Yanlış (rakip / sivil) → sıra geçer
      switchTurn = true;
    } else {
      // Doğru → tahmin hakkı azalır
      state.guessesLeft--;
      if (state.guessesLeft <= 0) switchTurn = true;
    }

    if (switchTurn) {
      this._switchTurn(room);
    }

    broadcastRoom(room.code);
  },

  passGuess(room, playerId) {
    // Aktif takımın herhangi bir üyesi pas geçebilir
    const state = room.gameState;
    if (!state || state.phase !== 'guessing') return;
    const team = state.currentTurn;
    if (!state.teams[team].includes(playerId)) return;
    if (state.spymasters[team] === playerId) return;
    const player = room.players.find(p => p.id === playerId);
    state.log.unshift(`⏭️ ${team === 'red' ? '🔴' : '🔵'} ${player?.name} pas geçti`);
    if (state.log.length > 12) state.log.pop();
    this._switchTurn(room);
    broadcastRoom(room.code);
  },

  _switchTurn(room) {
    const state = room.gameState;
    state.currentTurn = state.currentTurn === 'red' ? 'blue' : 'red';
    state.phase = 'clueGiving';
    state.currentClue = null;
    state.guessesLeft = 0;
  },

  roleLabel(role) {
    return { red: '🔴 Kırmızı', blue: '🔵 Mavi', civilian: '⚪ Sivil', assassin: '💀 Suikastçi' }[role] || '?';
  },

  stop(room) {
    // Timer yok
  }
};

// ============================================================
// EMOJİ TAHMİN
// ============================================================
let EMOJI_POOL = [];
try {
  EMOJI_POOL = require('./data/emoji-pool');
  console.log(`Emoji Tahmin havuzu: ${EMOJI_POOL.length} bilmece`);
} catch (e) {
  console.warn('Emoji havuzu yüklenemedi:', e.message);
}

const EmojiTahmin = {
  start(room) {
    const s = room.settings?.emoji || {};
    const questionTime = Math.max(10, Math.min(60, s.questionTime || 30));
    const totalQuestions = Math.max(5, Math.min(30, s.totalQuestions || 10));
    const acceptClose = s.acceptClose !== false;
    const firstBonus = s.firstBonus !== false;
    const category = s.category || 'karisik';

    let pool = EMOJI_POOL;
    if (category !== 'karisik') {
      const filtered = EMOJI_POOL.filter(q => q.category === category);
      if (filtered.length >= 3) pool = filtered;
    }
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, totalQuestions);

    room.players.forEach(p => { p.score = 0; p.eliminated = false; });

    room.gameState = {
      type: 'emoji',
      questions: selected.map(q => ({ emojis: q.emojis, answer: q.answer, aliases: q.aliases || [], category: q.category })),
      currentIndex: 0,
      currentQuestion: null,
      timeLeft: questionTime,
      questionTime,
      totalQuestions: selected.length,
      timerId: null,
      phase: 'question',
      acceptClose,
      firstBonus,
      correctGuessers: [],   // [{ playerId, time, points }]
      guesses: [],           // chat-like
      revealed: false,
      lastResults: null,
      gameOver: false,
      winner: null
    };
    this.startQuestion(room);
  },

  startQuestion(room) {
    const state = room.gameState;
    if (state.timerId) clearInterval(state.timerId);
    const q = state.questions[state.currentIndex];
    state.currentQuestion = {
      number: state.currentIndex + 1,
      total: state.totalQuestions,
      emojis: q.emojis,
      category: q.category
    };
    state.timeLeft = state.questionTime;
    state.phase = 'question';
    state.correctGuessers = [];
    state.guesses = [];
    state.revealed = false;
    state.lastResults = null;

    state.timerId = setInterval(() => {
      state.timeLeft--;
      io.to(room.code).emit('emoji:timer', { timeLeft: state.timeLeft });
      if (state.timeLeft <= 0) {
        this.revealAnswer(room);
      }
    }, 1000);
    broadcastRoom(room.code);
  },

  // Yakın eşleşme — basit Levenshtein
  _close(a, b) {
    a = a.toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ').trim();
    b = b.toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ').trim();
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 2) return false;
    // Levenshtein distance
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1];
        else dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[m][n] <= 1;
  },

  guess(room, playerId, text) {
    const state = room.gameState;
    if (!state || state.phase !== 'question') return;
    const player = room.players.find(p => p.id === playerId);
    if (!player) return;
    if (state.correctGuessers.some(g => g.playerId === playerId)) return; // zaten bildi

    text = (text || '').toString().trim().slice(0, 50);
    if (!text) return;
    const q = state.questions[state.currentIndex];

    const normalize = (s) => s.toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ').trim();
    const norm = normalize(text);
    const target = normalize(q.answer);
    const aliases = (q.aliases || []).map(normalize);

    let correct = false;
    if (norm === target || aliases.includes(norm)) correct = true;
    else if (state.acceptClose && (this._close(norm, target) || aliases.some(a => this._close(norm, a)))) correct = true;

    if (correct) {
      const ratio = state.timeLeft / state.questionTime;
      const base = 6 + Math.round(14 * ratio); // 6-20
      const firstBonus = (state.firstBonus && state.correctGuessers.length === 0) ? 5 : 0;
      const points = base + firstBonus;
      player.score += points;
      state.correctGuessers.push({ playerId, time: state.questionTime - state.timeLeft, points });
      state.guesses.push({ player: player.name, text: `✅ ${player.name} bildi! (+${points})`, correct: true });
      // Tüm aktif oyuncular bildiyse erken bitir (çizen yok, herkes oynar)
      if (state.correctGuessers.length >= room.players.length) {
        this.revealAnswer(room);
        return;
      }
      broadcastRoom(room.code);
    } else {
      state.guesses.push({ player: player.name, text, correct: false });
      if (state.guesses.length > 30) state.guesses.shift();
      broadcastRoom(room.code);
    }
  },

  revealAnswer(room) {
    const state = room.gameState;
    if (!state) return;
    if (state.timerId) clearInterval(state.timerId);
    state.phase = 'reveal';
    state.revealed = true;
    const q = state.questions[state.currentIndex];
    state.lastResults = {
      answer: q.answer,
      emojis: q.emojis,
      correctGuessers: state.correctGuessers.map(g => ({
        playerId: g.playerId,
        playerName: room.players.find(p => p.id === g.playerId)?.name || '?',
        points: g.points
      }))
    };
    broadcastRoom(room.code);

    setTimeout(() => {
      if (!rooms[room.code] || rooms[room.code].game !== 'emoji') return;
      state.currentIndex++;
      if (state.currentIndex >= state.totalQuestions) {
        state.gameOver = true;
        state.phase = 'gameOver';
        const sorted = [...room.players].sort((a, b) => b.score - a.score);
        state.winner = sorted[0]?.name || null;
        broadcastRoom(room.code);
      } else {
        this.startQuestion(room);
      }
    }, 4500);
  },

  stop(room) {
    if (room.gameState?.timerId) clearInterval(room.gameState.timerId);
  }
};

// ============================================================
// ŞEHİR-İSİM-HAYVAN
// ============================================================
const SehirIsimHayvan = {
  CATS: {
    hayvan: { label: 'Hayvan', icon: '🦁' },
    isim:   { label: 'İsim',   icon: '👤' },
    sehir:  { label: 'Şehir',  icon: '🏙️' },
    ulke:   { label: 'Ülke',   icon: '🌍' },
    yemek:  { label: 'Yemek',  icon: '🍕' },
    bitki:  { label: 'Bitki',  icon: '🌿' },
    esya:   { label: 'Eşya',   icon: '🪑' },
    renk:   { label: 'Renk',   icon: '🎨' },
    marka:  { label: 'Marka',  icon: '🚗' }
  },

  // Türkçe ile uyumlu harfler — q/w/x yok, ama "i"/"ı" var
  LETTERS: ['a','b','c','ç','d','e','f','g','h','ı','i','j','k','l','m','n','o','ö','p','r','s','ş','t','u','ü','v','y','z'],

  start(room) {
    const s = room.settings?.sih || {};
    const roundCount = Math.max(1, Math.min(20, s.roundCount || 5));
    const roundTime  = Math.max(20, Math.min(180, s.roundTime || 60));
    const letterMode = s.letterMode === 'host' ? 'host' : 'random';
    const autoValidate = s.autoValidate !== false;
    // Aktif kategoriler — settings.activeCategories array veya default
    let active = Array.isArray(s.activeCategories) ? s.activeCategories.filter(c => this.CATS[c]) : null;
    if (!active || active.length === 0) active = ['hayvan', 'isim', 'sehir'];

    room.players.forEach(p => { p.score = 0; p.eliminated = false; });

    room.gameState = {
      type: 'sih',
      roundCount,
      roundTime,
      roundIndex: 0,
      currentLetter: null,
      activeCategories: active,
      autoValidate,
      letterMode,
      phase: 'letterPick',   // 'letterPick' | 'writing' | 'scoring' | 'gameOver'
      timeLeft: 0,
      timerId: null,
      answers: {},           // { playerId: { [cat]: 'kelime' } }
      submitted: {},         // { playerId: true } - bu turu kilitleyenler
      lastRoundResults: null,
      usedLetters: [],
      gameOver: false,
      winner: null
    };

    this.nextRound(room);
  },

  nextRound(room) {
    const state = room.gameState;
    if (!state) return;
    if (state.timerId) clearInterval(state.timerId);

    if (state.roundIndex >= state.roundCount) {
      this.endGame(room);
      return;
    }

    state.answers = {};
    state.submitted = {};
    state.lastRoundResults = null;
    state.currentLetter = null;

    // Random modda harfi otomatik seç ve writing'e geç
    if (state.letterMode === 'random') {
      const avail = this.LETTERS.filter(l => !state.usedLetters.includes(l));
      const pool = avail.length > 0 ? avail : this.LETTERS;
      state.currentLetter = pool[Math.floor(Math.random() * pool.length)];
      state.usedLetters.push(state.currentLetter);
      this.startWriting(room);
    } else {
      // Host moda → letterPick fazı (host harf seçer)
      state.phase = 'letterPick';
      state.timeLeft = 0;
      broadcastRoom(room.code);
    }
  },

  pickLetter(room, playerId, letter) {
    const state = room.gameState;
    if (!state || state.phase !== 'letterPick') return;
    if (room.host !== playerId) return;
    letter = (letter || '').toLocaleLowerCase('tr-TR');
    if (!this.LETTERS.includes(letter)) return;
    state.currentLetter = letter;
    state.usedLetters.push(letter);
    this.startWriting(room);
  },

  startWriting(room) {
    const state = room.gameState;
    state.phase = 'writing';
    state.roundIndex++;
    state.timeLeft = state.roundTime;
    if (state.timerId) clearInterval(state.timerId);
    state.timerId = setInterval(() => {
      state.timeLeft--;
      io.to(room.code).emit('sih:timer', { timeLeft: state.timeLeft });
      if (state.timeLeft <= 0) {
        clearInterval(state.timerId);
        this.endRound(room);
      }
    }, 1000);
    broadcastRoom(room.code);
  },

  submitAnswers(room, playerId, answers) {
    const state = room.gameState;
    if (!state || state.phase !== 'writing') return;
    const player = room.players.find(p => p.id === playerId);
    if (!player) return;
    // Cevapları temizle/limit
    const clean = {};
    for (const cat of state.activeCategories) {
      const v = (answers?.[cat] || '').toString().trim().toLocaleLowerCase('tr-TR').slice(0, 40);
      clean[cat] = v;
    }
    state.answers[playerId] = clean;
    state.submitted[playerId] = true;

    // STOP mekaniği yok ama herkes kilitledi mi diye bak
    const activePlayers = room.players.filter(p => !p.eliminated);
    if (Object.keys(state.submitted).length >= activePlayers.length) {
      // Herkes gönderdi → turu erken bitir
      if (state.timerId) clearInterval(state.timerId);
      this.endRound(room);
    } else {
      broadcastRoom(room.code);
    }
  },

  // Bir cevap geçerli mi?
  validateAnswer(cat, word, letter) {
    if (!word) return false;
    if (word[0] !== letter) return false;
    // Sadece harf
    if (!/^[a-zçğıöşüâîû ]+$/i.test(word)) return false;
    const set = CATEGORIES[cat];
    if (!set || set.size === 0) {
      // Kategori havuzu yoksa sözlüğe bak (genel geçer fallback)
      return DICTIONARY.has(word);
    }
    if (set.has(word)) return true;
    // İsim için: havuzda yoksa esnek kontrol — sözlük yardımı zayıf
    if (cat === 'isim') {
      // Uzunluğu 3+ olan ve sadece harf olan + sözlükte olmasa bile kabul edilebilir, ama strict mode
      return false;
    }
    return false;
  },

  endRound(room) {
    const state = room.gameState;
    if (!state) return;
    if (state.timerId) clearInterval(state.timerId);
    state.phase = 'scoring';

    const letter = state.currentLetter;
    const cats = state.activeCategories;
    const activePlayers = room.players.filter(p => !p.eliminated);

    // Her kategori için cevapları toparla
    const perCatAnswers = {}; // { cat: { 'word': [playerId, ...] } }
    for (const cat of cats) perCatAnswers[cat] = {};

    for (const p of activePlayers) {
      const ans = state.answers[p.id] || {};
      for (const cat of cats) {
        const w = ans[cat] || '';
        let valid = false;
        if (state.autoValidate) {
          valid = this.validateAnswer(cat, w, letter);
        } else {
          // Manuel mod: sadece harf eşleşmesi + boş değil
          valid = w && w[0] === letter && /^[a-zçğıöşüâîû ]+$/i.test(w);
        }
        if (!valid) continue;
        if (!perCatAnswers[cat][w]) perCatAnswers[cat][w] = [];
        perCatAnswers[cat][w].push(p.id);
      }
    }

    // Puanlama
    const scores = {}; // { playerId: { perCat: {cat:points}, total:int } }
    for (const p of activePlayers) {
      scores[p.id] = { perCat: {}, total: 0 };
    }

    let fullBonusCandidates = new Set(activePlayers.map(p => p.id));
    for (const cat of cats) {
      const cleanCat = perCatAnswers[cat];
      for (const word in cleanCat) {
        const players = cleanCat[word];
        const pts = (players.length === 1) ? 10 : 5;
        for (const pid of players) {
          scores[pid].perCat[cat] = pts;
          scores[pid].total += pts;
        }
      }
      // Tam bonus için: bu kategoride puan almayanları çıkar
      fullBonusCandidates.forEach(pid => {
        if (!scores[pid].perCat[cat]) fullBonusCandidates.delete(pid);
      });
    }

    // Tam bonus (tüm kategorilerde puan aldı) → +15
    fullBonusCandidates.forEach(pid => {
      scores[pid].total += 15;
      scores[pid].fullBonus = true;
    });

    // Skorları oyuncuya işle
    for (const p of activePlayers) {
      p.score += scores[p.id].total;
    }

    // Sonuçları paketle (UI için)
    state.lastRoundResults = {
      letter,
      categories: cats,
      perCatAnswers,    // {cat: {word: [playerNames]}}
      scoresByPlayer: scores,
      playerNames: Object.fromEntries(room.players.map(p => [p.id, p.name]))
    };

    broadcastRoom(room.code);

    // 7sn sonra sonraki tura
    setTimeout(() => {
      if (!rooms[room.code] || rooms[room.code].game !== 'sih') return;
      this.nextRound(room);
    }, 7000);
  },

  endGame(room) {
    const state = room.gameState;
    if (!state) return;
    state.phase = 'gameOver';
    state.gameOver = true;
    if (state.timerId) clearInterval(state.timerId);
    const sorted = [...room.players].sort((a, b) => b.score - a.score);
    state.winner = sorted[0]?.name || null;
    broadcastRoom(room.code);
  },

  stop(room) {
    if (room.gameState?.timerId) clearInterval(room.gameState.timerId);
  }
};

const UnoOyun = {
  COLORS: ['kirmizi', 'sari', 'yesil', 'mavi'],
  NUMBERS: ['0','1','2','3','4','5','6','7','8','9'],
  SPECIALS: ['+2', 'donus', 'pas'], // donus: yön değiştir, pas: sıra atla
  INITIAL_HAND: 7,

  buildDeck() {
    const deck = [];
    this.COLORS.forEach(color => {
      // Her sayıdan 2 tane (0 hariç, 0'dan 1 tane)
      this.NUMBERS.forEach(num => {
        deck.push({ color, value: num });
        if (num !== '0') deck.push({ color, value: num });
      });
      // Her özellikten 2 tane
      this.SPECIALS.forEach(sp => {
        deck.push({ color, value: sp });
        deck.push({ color, value: sp });
      });
    });
    // Joker (4 renk seç): 4 tane
    for (let i = 0; i < 4; i++) {
      deck.push({ color: 'joker', value: '+4' });
      deck.push({ color: 'joker', value: 'joker' });
    }
    // Karıştır
    return deck.sort(() => Math.random() - 0.5);
  },

  start(room) {
    if (room.players.length < 2) return false;
    
    const settings = room.settings?.uno || { initialHand: 7 };
    const deck = this.buildDeck();
    const hands = {};
    room.players.forEach(p => {
      hands[p.id] = [];
      for (let i = 0; i < settings.initialHand; i++) {
        hands[p.id].push(deck.pop());
      }
      p.score = 0;
    });

    // İlk kart (joker olmasın)
    let firstCard;
    do { firstCard = deck.pop(); } while (firstCard.color === 'joker' || this.SPECIALS.includes(firstCard.value));

    room.gameState = {
      type: 'uno',
      deck,
      discard: [firstCard],
      hands,
      currentColor: firstCard.color, // joker oynandığında değişebilir
      currentValue: firstCard.value,
      currentPlayerIndex: 0,
      direction: 1, // 1 veya -1
      drawStack: 0, // toplam çekme sayısı (+2/+4 birikimi)
      gameOver: false,
      winner: null,
      log: [],
      pendingColorPick: null // joker oynandığında renk bekleyen oyuncu
    };

    // Her oyuncuya kendi elini yolla
    room.players.forEach(p => {
      io.to(p.id).emit('uno:hand', { cards: hands[p.id] });
    });

    broadcastRoom(room.code);
    return true;
  },

  canPlay(card, currentColor, currentValue) {
    if (card.color === 'joker') return true;
    if (card.color === currentColor) return true;
    if (card.value === currentValue) return true;
    return false;
  },

  playCard(room, playerId, cardIndex, pickColor) {
    const state = room.gameState;
    if (!state || state.gameOver) return;
    const currentPlayer = room.players[state.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.id !== playerId) return;
    if (state.pendingColorPick) return;

    const hand = state.hands[playerId];
    if (!hand || !hand[cardIndex]) return;
    const card = hand[cardIndex];

    // Drawstack varsa sadece +2 veya +4 oynanabilir
    if (state.drawStack > 0) {
      if (card.value !== '+2' && card.value !== '+4') {
        io.to(playerId).emit('uno:error', { 
          message: `${state.drawStack} kart çekmen lazım! Sadece +2 veya +4 oynayabilirsin.` 
        });
        return;
      }
    }

    if (!this.canPlay(card, state.currentColor, state.currentValue)) {
      io.to(playerId).emit('uno:error', { message: 'Bu kart oynanamaz!' });
      return;
    }

    // Kartı oyna
    hand.splice(cardIndex, 1);
    state.discard.push(card);
    state.currentValue = card.value;

    if (card.color !== 'joker') {
      state.currentColor = card.color;
    }

    state.log.unshift(`${currentPlayer.name} → ${this.cardLabel(card)}`);
    if (state.log.length > 8) state.log.pop();

    // Kazandı mı?
    if (hand.length === 0) {
      state.gameOver = true;
      state.winner = currentPlayer.name;
      currentPlayer.score += 1;
      broadcastRoom(room.code);
      return;
    }

    // UNO! çağrı sistemi: 1 kart kaldıysa 5 sn pencere
    if (hand.length === 1) {
      state.unoPending = state.unoPending || {};
      state.unoPending[playerId] = {
        playerId,
        startTime: Date.now(),
        called: false
      };
      // 5 sn sonra hâlâ çağrılmadıysa pencere otomatik kapanır (yakalama hakkı kalmaz)
      const pendingRef = state.unoPending[playerId];
      setTimeout(() => {
        if (!rooms[room.code] || rooms[room.code].game !== 'uno') return;
        const curr = rooms[room.code].gameState?.unoPending?.[playerId];
        if (curr === pendingRef && !curr.called && !curr.caught) {
          delete rooms[room.code].gameState.unoPending[playerId];
          broadcastRoom(room.code);
        }
      }, 5000);
    }

    // Özel kartlar
    let skipNext = false;
    if (card.value === 'pas') {
      skipNext = true;
    } else if (card.value === 'donus') {
      state.direction *= -1;
      // 2 oyuncuda dönüş = pas gibi davranır
      if (room.players.length === 2) skipNext = true;
    } else if (card.value === '+2') {
      state.drawStack += 2;
    } else if (card.value === '+4') {
      state.drawStack += 4;
    }

    // Joker veya +4 ise renk seçimi bekle
    if (card.color === 'joker') {
      if (pickColor && this.COLORS.includes(pickColor)) {
        state.currentColor = pickColor;
      } else {
        // Renk seçimi gelmediyse rastgele seç (otomatik)
        state.currentColor = this.COLORS[Math.floor(Math.random() * 4)];
      }
      state.log[0] += ` (Renk: ${state.currentColor})`;
    }

    // Sıra ilerlet
    this.advanceTurn(room, skipNext);
    
    // Eli sahibine güncel olarak yolla
    io.to(playerId).emit('uno:hand', { cards: state.hands[playerId] });
    broadcastRoom(room.code);
  },

  drawCard(room, playerId) {
    const state = room.gameState;
    if (!state || state.gameOver) return;
    const currentPlayer = room.players[state.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.id !== playerId) return;
    if (state.pendingColorPick) return;

    const drawCount = state.drawStack > 0 ? state.drawStack : 1;
    const hand = state.hands[playerId];

    // Deste boş ise atılan kartları karıştır (sonuncu hariç)
    if (state.deck.length < drawCount) {
      const lastCard = state.discard.pop();
      state.deck = state.deck.concat(state.discard.sort(() => Math.random() - 0.5));
      state.discard = [lastCard];
    }

    for (let i = 0; i < drawCount && state.deck.length > 0; i++) {
      hand.push(state.deck.pop());
    }

    state.log.unshift(`${currentPlayer.name} ${drawCount} kart çekti`);
    if (state.log.length > 8) state.log.pop();

    state.drawStack = 0;
    
    // Eli yolla ve sıra geç
    io.to(playerId).emit('uno:hand', { cards: hand });
    this.advanceTurn(room, false);
    broadcastRoom(room.code);
  },

  // Oyuncu UNO! der — 5sn penceresinde çağrı
  callUno(room, playerId) {
    const state = room.gameState;
    if (!state || state.gameOver) return;
    const pending = state.unoPending?.[playerId];
    if (!pending) return;
    pending.called = true;
    const player = room.players.find(p => p.id === playerId);
    if (player) {
      state.log.unshift(`📢 ${player.name} "UNO!" dedi`);
      if (state.log.length > 8) state.log.pop();
    }
    io.to(room.code).emit('uno:called', { playerId, playerName: player?.name });
    broadcastRoom(room.code);
  },

  // Başka oyuncu "yakaladı" — UNO demeden 1 karta düşen oyuncuya +2
  catchUno(room, catcherId, targetId) {
    const state = room.gameState;
    if (!state || state.gameOver) return;
    const pending = state.unoPending?.[targetId];
    if (!pending) return;
    if (pending.called || pending.caught) return;
    if (catcherId === targetId) return; // kendine yakalama yok

    pending.caught = true;
    const target = room.players.find(p => p.id === targetId);
    const catcher = room.players.find(p => p.id === catcherId);
    if (!target) return;

    // +2 ceza
    const hand = state.hands[targetId];
    for (let i = 0; i < 2; i++) {
      if (state.deck.length === 0) {
        const last = state.discard.pop();
        state.deck = state.discard.sort(() => Math.random() - 0.5);
        state.discard = [last];
      }
      if (state.deck.length > 0) hand.push(state.deck.pop());
    }
    io.to(targetId).emit('uno:hand', { cards: hand });

    state.log.unshift(`🪤 ${catcher?.name} ${target.name}'i yakaladı! +2 ceza`);
    if (state.log.length > 8) state.log.pop();
    delete state.unoPending[targetId];
    io.to(room.code).emit('uno:caught', { targetId, targetName: target.name, catcherName: catcher?.name });
    broadcastRoom(room.code);
  },

  advanceTurn(room, skipNext) {
    const state = room.gameState;
    const n = room.players.length;
    let next = state.currentPlayerIndex;
    const steps = skipNext ? 2 : 1;
    for (let i = 0; i < steps; i++) {
      next = ((next + state.direction) % n + n) % n;
    }
    state.currentPlayerIndex = next;
  },

  cardLabel(card) {
    const colorEmoji = { kirmizi: '🟥', sari: '🟨', yesil: '🟩', mavi: '🟦', joker: '⬛' };
    return `${colorEmoji[card.color]} ${card.value}`;
  },

  stop(room) {
    // Timer yok
  }
};

// ============================================================
// ŞEHİR YARIŞI (Türkiye temalı emlak oyunu)
// ============================================================
const SY_DATA = require('./data/syarisi-board');
const SY_CARDS = require('./data/syarisi-cards');

const TOKEN_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#1abc9c', '#e67e22', '#34495e'];
const SY_TOKEN_CHARS = ['🦁', '✈️', '👟', '🚗', '🎩', '🚢', '🐶', '🐱', '🦄', '🚲', '🎲', '👑'];

function _syShuffle(n) {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const SehirYarisi = {
  start(room) {
    const s = room.settings?.syarisi || {};
    const startingMoney = s.startingMoney || 1500;

    const turnOrder = room.players.map(p => p.id);
    // Random sıra
    for (let i = turnOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [turnOrder[i], turnOrder[j]] = [turnOrder[j], turnOrder[i]];
    }

    // Token atama: oyuncunun önceden seçtiği syToken varsa kullan; yoksa boştan ata
    const usedTokens = new Set(room.players.map(p => p.syToken).filter(Boolean));
    const players = room.players.map((p, i) => {
      let token = p.syToken;
      if (!token || !SY_TOKEN_CHARS.includes(token)) {
        token = SY_TOKEN_CHARS.find(t => !usedTokens.has(t)) || SY_TOKEN_CHARS[i % SY_TOKEN_CHARS.length];
        usedTokens.add(token);
        p.syToken = token;
      }
      return {
        id: p.id,
        name: p.name,
        money: startingMoney,
        position: 0,
        jailTurns: 0,
        getOutCards: 0,
        bankrupt: false,
        color: TOKEN_COLORS[i % TOKEN_COLORS.length],
        token
      };
    });

    const squares = SY_DATA.BOARD.map(sq => ({
      idx: sq.idx,
      ownerId: null,
      houses: 0,
      hotel: false,
      mortgaged: false
    }));

    room.gameState = {
      type: 'syarisi',
      phase: 'rolling',
      turnPlayerId: turnOrder[0],
      turnOrder,
      dice: [0, 0],
      doublesCount: 0,
      lastRoll: null,
      players,
      squares,
      parkingPot: 0,
      chanceDeck: _syShuffle(SY_CARDS.CHANCE.length),
      ccDeck: _syShuffle(SY_CARDS.COMMUNITY_CHEST.length),
      pendingCard: null,
      pendingBuy: null,
      auction: null,
      log: [`🎮 Şehir Yarışı başladı! İlk sıra: ${players.find(p => p.id === turnOrder[0])?.name}`],
      gameOver: false,
      winner: null
    };
    broadcastRoom(room.code);
    return true;
  },

  rollDice(room, playerId) {
    const st = room.gameState;
    if (!st || st.phase !== 'rolling') return;
    if (st.turnPlayerId !== playerId) return;

    const player = st.players.find(p => p.id === playerId);
    if (!player || player.bankrupt) return;

    const d1 = 1 + Math.floor(Math.random() * 6);
    const d2 = 1 + Math.floor(Math.random() * 6);
    st.dice = [d1, d2];
    st.lastRoll = d1 + d2;
    const isDoubles = d1 === d2;

    // Hapisteki oyuncu
    if (player.jailTurns > 0) {
      if (isDoubles) {
        player.jailTurns = 0;
        st.doublesCount = 0;  // hapisten çıkış doublesı sayılmaz
        this._addLog(st, `🎲 ${player.name} çift attı (${d1}+${d2}) — hapisten çıktı!`);
        this._movePlayer(room, player, d1 + d2, true);
      } else {
        player.jailTurns++;
        this._addLog(st, `🎲 ${player.name} zar attı (${d1}+${d2}) — hapiste kaldı (tur ${player.jailTurns}/3)`);
        if (player.jailTurns > 3) {
          // 3 turdan sonra ceza öde, zorla çık
          if (player.money >= 50) {
            player.money -= 50;
            this._addLog(st, `🔓 ${player.name} 50₺ ödeyip hapisten zorla çıktı`);
            player.jailTurns = 0;
            this._movePlayer(room, player, d1 + d2, true);
          } else {
            this._addLog(st, `💸 ${player.name} parası yetmedi → iflas riski`);
            this._handleDebt(room, player, 50, null);
            // Eğer iflas etmediyse hapisten çıkar
            if (!player.bankrupt) {
              player.jailTurns = 0;
              this._movePlayer(room, player, d1 + d2, true);
            } else {
              this._endTurn(room);
            }
          }
        } else {
          // Sırayı sonlandır
          st.phase = 'rolling';
          this._endTurn(room);
        }
        broadcastRoom(room.code);
        return;
      }
    } else {
      // Normal zar atışı
      if (isDoubles) {
        st.doublesCount++;
        if (st.doublesCount >= 3) {
          this._addLog(st, `🚔 ${player.name} 3. çift! Hapse gidiyor.`);
          this._goToJail(st, player);
          st.doublesCount = 0;
          this._endTurn(room);
          broadcastRoom(room.code);
          return;
        }
      } else {
        st.doublesCount = 0;
      }
      this._addLog(st, `🎲 ${player.name} zar attı: ${d1}+${d2} = ${d1 + d2}${isDoubles ? ' (çift!)' : ''}`);
      this._movePlayer(room, player, d1 + d2, true);
    }
    broadcastRoom(room.code);
  },

  _movePlayer(room, player, steps, collectGo) {
    const st = room.gameState;
    const newPos = (player.position + steps) % 40;
    const passedGo = (player.position + steps) >= 40 && collectGo;
    player.position = newPos;
    if (passedGo) {
      const bonus = room.settings?.syarisi?.goBonus ?? 200;
      player.money += bonus;
      this._addLog(st, `💵 ${player.name} Başlangıç'tan geçti, ${bonus}₺ aldı`);
    }
    this._handleLanding(room, player);
  },

  _moveTo(room, player, targetIdx, collectGo) {
    const st = room.gameState;
    if (collectGo && targetIdx < player.position) {
      const bonus = room.settings?.syarisi?.goBonus ?? 200;
      player.money += bonus;
      this._addLog(st, `💵 ${player.name} Başlangıç'tan geçti, ${bonus}₺ aldı`);
    } else if (targetIdx === 0 && collectGo) {
      const bonus = room.settings?.syarisi?.goBonus ?? 200;
      player.money += bonus;
    }
    player.position = targetIdx;
    this._handleLanding(room, player);
  },

  _handleLanding(room, player) {
    const st = room.gameState;
    const sq = SY_DATA.BOARD[player.position];
    const ownState = st.squares[player.position];
    this._addLog(st, `🚶 ${player.name} → ${sq.name}`);

    if (sq.type === 'go') {
      // Sadece Go karesinde durmak — bonus yok (zaten move sırasında verildi yoksa)
    } else if (sq.type === 'property' || sq.type === 'airport' || sq.type === 'utility') {
      if (!ownState.ownerId) {
        // Boş mülk → satın alma kararı
        st.pendingBuy = { propertyIdx: player.position };
        st.phase = 'awaitBuy';
        return;
      } else if (ownState.ownerId !== player.id && !ownState.mortgaged) {
        const owner = st.players.find(p => p.id === ownState.ownerId);
        if (owner && !owner.bankrupt) {
          // Owner hapisteyse kira alır mı? Klasik kuralda evet.
          const rent = this._getRentDue(st, player.position, st.lastRoll, null);
          this._addLog(st, `💰 ${player.name} → ${owner.name}'a ${rent}₺ kira`);
          this._payOrBankrupt(room, player, owner, rent);
        }
      }
    } else if (sq.type === 'tax') {
      this._addLog(st, `🧾 ${player.name} ${sq.amount}₺ vergi ödüyor`);
      const useParking = room.settings?.syarisi?.parkingPot;
      if (player.money >= sq.amount) {
        player.money -= sq.amount;
        if (useParking) st.parkingPot += sq.amount;
      } else {
        this._handleDebt(room, player, sq.amount, null);
        if (useParking && !player.bankrupt) st.parkingPot += sq.amount;
      }
    } else if (sq.type === 'chance' || sq.type === 'cc') {
      this._drawAndApplyCard(room, player, sq.type);
      // Eğer pendingBuy/auction set olduysa fazı bozma
      if (st.phase === 'awaitBuy' || st.gameOver) return;
    } else if (sq.type === 'jail') {
      // Sadece ziyaret
    } else if (sq.type === 'parking') {
      const useParking = room.settings?.syarisi?.parkingPot;
      if (useParking && st.parkingPot > 0) {
        this._addLog(st, `🅿️ ${player.name} ücretsiz parktan ${st.parkingPot}₺ aldı!`);
        player.money += st.parkingPot;
        st.parkingPot = 0;
      }
    } else if (sq.type === 'goToJail') {
      this._goToJail(st, player);
      st.doublesCount = 0;
      this._endTurn(room);
    }
  },

  _drawAndApplyCard(room, player, deck) {
    const st = room.gameState;
    const deckArr = deck === 'chance' ? st.chanceDeck : st.ccDeck;
    const cardPool = deck === 'chance' ? SY_CARDS.CHANCE : SY_CARDS.COMMUNITY_CHEST;
    if (deckArr.length === 0) {
      // Yeniden karıştır
      const fresh = _syShuffle(cardPool.length);
      if (deck === 'chance') st.chanceDeck = fresh; else st.ccDeck = fresh;
    }
    const cardIdx = (deck === 'chance' ? st.chanceDeck : st.ccDeck).shift();
    const card = cardPool[cardIdx];
    st.pendingCard = { deck, text: card.text, cardIdx };
    this._addLog(st, `🎴 ${player.name} kart çekti: ${card.text}`);
    this._applyCardEffect(room, player, card.effect, deck, cardIdx);
  },

  _applyCardEffect(room, player, effect, deck, cardIdx) {
    const st = room.gameState;
    const e = effect;
    const cardPool = deck === 'chance' ? SY_CARDS.CHANCE : SY_CARDS.COMMUNITY_CHEST;
    const deckArr = deck === 'chance' ? st.chanceDeck : st.ccDeck;

    if (e.type === 'move') {
      this._moveTo(room, player, e.to, e.collectGo);
    } else if (e.type === 'moveBy') {
      // Geri gitmek için negatif; Go bonus verilmez
      const newPos = (player.position + e.n + 40) % 40;
      player.position = newPos;
      this._handleLanding(room, player);
    } else if (e.type === 'moveNearest') {
      const indexes = e.kind === 'airport' ? SY_DATA.AIRPORT_INDEXES : SY_DATA.UTILITY_INDEXES;
      let nearest = indexes.find(i => i > player.position);
      if (nearest === undefined) {
        nearest = indexes[0];
        // Go'dan geçer
        const bonus = room.settings?.syarisi?.goBonus ?? 200;
        player.money += bonus;
      }
      player.position = nearest;
      // Burada özel kira çarpanı uygulanmalı
      const ownState = st.squares[nearest];
      if (ownState.ownerId && ownState.ownerId !== player.id && !ownState.mortgaged) {
        const owner = st.players.find(p => p.id === ownState.ownerId);
        const rent = this._getRentDue(st, nearest, st.lastRoll, { forceMult: e.rentMult });
        this._addLog(st, `💰 ${player.name} → ${owner.name}'a ${rent}₺ özel kira (kart)`);
        this._payOrBankrupt(room, player, owner, rent);
      } else if (!ownState.ownerId) {
        st.pendingBuy = { propertyIdx: nearest };
        st.phase = 'awaitBuy';
        return;
      }
    } else if (e.type === 'pay') {
      this._addLog(st, `💸 ${player.name} ${e.amount}₺ ödüyor`);
      if (player.money >= e.amount) {
        player.money -= e.amount;
        if (room.settings?.syarisi?.parkingPot) st.parkingPot += e.amount;
      } else {
        this._handleDebt(room, player, e.amount, null);
      }
    } else if (e.type === 'collect') {
      player.money += e.amount;
      this._addLog(st, `💵 ${player.name} ${e.amount}₺ kazandı`);
    } else if (e.type === 'payAll') {
      st.players.forEach(p => {
        if (p.id !== player.id && !p.bankrupt) {
          const amt = Math.min(player.money, e.amount);
          if (player.money >= e.amount) {
            player.money -= e.amount;
            p.money += e.amount;
          } else {
            // Eksik kalırsa borç yönet
            this._handleDebt(room, player, e.amount, p);
          }
        }
      });
      this._addLog(st, `💸 ${player.name} her oyuncuya ${e.amount}₺ ödedi`);
    } else if (e.type === 'collectAll') {
      let total = 0;
      st.players.forEach(p => {
        if (p.id !== player.id && !p.bankrupt) {
          const amt = Math.min(p.money, e.amount);
          p.money -= amt;
          total += amt;
        }
      });
      player.money += total;
      this._addLog(st, `💵 ${player.name} herkesten toplam ${total}₺ topladı`);
    } else if (e.type === 'jail') {
      this._goToJail(st, player);
      st.doublesCount = 0;
      this._endTurn(room);
    } else if (e.type === 'getOutFree') {
      player.getOutCards++;
      this._addLog(st, `🎫 ${player.name} hapisten çıkış kartı kazandı`);
      // Kartı destenin dışına çıkar — discard'a koyma, oyuncuda sakla
      return; // deste'ye iade etme
    } else if (e.type === 'payPerProp') {
      let totalHouses = 0, totalHotels = 0;
      st.squares.forEach(s => {
        if (s.ownerId === player.id) {
          if (s.hotel) totalHotels++;
          else totalHouses += s.houses;
        }
      });
      const cost = totalHouses * e.perHouse + totalHotels * e.perHotel;
      if (cost > 0) {
        this._addLog(st, `🔧 ${player.name} bakım ücreti: ${totalHouses} ev × ${e.perHouse}₺ + ${totalHotels} otel × ${e.perHotel}₺ = ${cost}₺`);
        if (player.money >= cost) player.money -= cost;
        else this._handleDebt(room, player, cost, null);
      } else {
        this._addLog(st, `🔧 ${player.name}: bakım yok (mülk yok)`);
      }
    }

    // Kartı discard'a iade (getOutFree hariç)
    if (e.type !== 'getOutFree') {
      // Deste başlığına ekle (basit yaklaşım: discard yığını yok, sona koy)
      if (deck === 'chance') st.chanceDeck.push(cardIdx);
      else st.ccDeck.push(cardIdx);
    }
    st.pendingCard = null;
  },

  _getRentDue(st, squareIdx, diceRoll, opts) {
    const sq = SY_DATA.BOARD[squareIdx];
    const ownState = st.squares[squareIdx];
    if (!ownState.ownerId || ownState.mortgaged) return 0;
    const owner = st.players.find(p => p.id === ownState.ownerId);
    if (!owner) return 0;

    if (sq.type === 'property') {
      if (ownState.hotel) return sq.rent[6];
      if (ownState.houses > 0) return sq.rent[1 + ownState.houses];
      // Tüm set sahipse 2× base
      const ownsFull = this._ownsFullSet(st, owner.id, sq.color);
      return ownsFull ? sq.rent[1] : sq.rent[0];
    } else if (sq.type === 'airport') {
      const count = SY_DATA.AIRPORT_INDEXES.filter(i => st.squares[i].ownerId === owner.id).length;
      let rent = SY_DATA.AIRPORT_RENT[count] || 0;
      if (opts?.forceMult) rent *= opts.forceMult;
      return rent;
    } else if (sq.type === 'utility') {
      if (opts?.forceMult) return diceRoll * opts.forceMult;
      const count = SY_DATA.UTILITY_INDEXES.filter(i => st.squares[i].ownerId === owner.id).length;
      const mult = SY_DATA.UTILITY_MULT[count] || 0;
      return diceRoll * mult;
    }
    return 0;
  },

  _ownsFullSet(st, playerId, color) {
    const group = SY_DATA.COLOR_GROUPS[color];
    if (!group) return false;
    return group.every(idx => st.squares[idx].ownerId === playerId);
  },

  buyProperty(room, playerId) {
    const st = room.gameState;
    if (!st || st.phase !== 'awaitBuy') return;
    if (st.turnPlayerId !== playerId) return;
    if (!st.pendingBuy) return;
    const idx = st.pendingBuy.propertyIdx;
    const sq = SY_DATA.BOARD[idx];
    const player = st.players.find(p => p.id === playerId);
    if (!player || player.money < sq.price) {
      io.to(playerId).emit('room:error', { message: 'Yeterli paran yok!' });
      return;
    }
    player.money -= sq.price;
    st.squares[idx].ownerId = playerId;
    this._addLog(st, `🏠 ${player.name} ${sq.name}'ı ${sq.price}₺'a satın aldı`);
    st.pendingBuy = null;
    st.phase = 'rolling';
    // Çift atmadıysa sıra geçer
    const isDoubles = st.dice[0] === st.dice[1];
    if (!isDoubles) {
      this._endTurn(room);
    }
    broadcastRoom(room.code);
  },

  declineProperty(room, playerId) {
    const st = room.gameState;
    if (!st || st.phase !== 'awaitBuy') return;
    if (st.turnPlayerId !== playerId) return;
    if (!st.pendingBuy) return;
    const idx = st.pendingBuy.propertyIdx;
    const sq = SY_DATA.BOARD[idx];
    const enableAuction = room.settings?.syarisi?.enableAuction !== false;

    if (enableAuction && st.players.filter(p => !p.bankrupt).length >= 2) {
      this._startAuction(room, idx);
      return;
    }

    // Açık artırma yoksa direkt geç
    this._addLog(st, `❌ ${SY_DATA.BOARD[idx].name} satın alınmadı.`);
    st.pendingBuy = null;
    st.phase = 'rolling';
    const isDoubles = st.dice[0] === st.dice[1];
    if (!isDoubles) this._endTurn(room);
    broadcastRoom(room.code);
  },

  _startAuction(room, propertyIdx) {
    const st = room.gameState;
    const sq = SY_DATA.BOARD[propertyIdx];
    st.pendingBuy = null;
    st.phase = 'auction';
    st.auction = {
      propertyIdx,
      currentBid: 0,
      currentBidderId: null,
      passed: [],  // pas geçenler
      eligibleIds: st.players.filter(p => !p.bankrupt).map(p => p.id)
    };
    this._addLog(st, `🔨 ${sq.name} için açık artırma başladı! Başlangıç: 0₺`);
    broadcastRoom(room.code);
  },

  placeBid(room, playerId, amount) {
    const st = room.gameState;
    if (!st || st.phase !== 'auction' || !st.auction) return;
    const a = st.auction;
    if (!a.eligibleIds.includes(playerId)) return;
    if (a.passed.includes(playerId)) return;
    amount = parseInt(amount) || 0;
    if (amount <= a.currentBid) {
      io.to(playerId).emit('room:error', { message: 'Teklif şu anki tekliften yüksek olmalı!' });
      return;
    }
    const player = st.players.find(p => p.id === playerId);
    if (!player || player.money < amount) {
      io.to(playerId).emit('room:error', { message: 'Yeterli paran yok!' });
      return;
    }
    a.currentBid = amount;
    a.currentBidderId = playerId;
    this._addLog(st, `💰 ${player.name}: ${amount}₺ teklif etti`);
    this._checkAuctionEnd(room);
    broadcastRoom(room.code);
  },

  passBid(room, playerId) {
    const st = room.gameState;
    if (!st || st.phase !== 'auction' || !st.auction) return;
    const a = st.auction;
    if (!a.eligibleIds.includes(playerId)) return;
    if (a.passed.includes(playerId)) return;
    a.passed.push(playerId);
    const player = st.players.find(p => p.id === playerId);
    this._addLog(st, `⏭️ ${player.name} pas geçti`);
    this._checkAuctionEnd(room);
    broadcastRoom(room.code);
  },

  _checkAuctionEnd(room) {
    const st = room.gameState;
    const a = st.auction;
    const remaining = a.eligibleIds.filter(id => !a.passed.includes(id));
    // Eğer 1 kişi kaldıysa ve teklifi varsa → kazandı
    // Eğer 0 kaldıysa ama currentBidder varsa → kazandı
    // Eğer 0 ve currentBidder yoksa → kimse almadı
    if (remaining.length <= 1) {
      const sq = SY_DATA.BOARD[a.propertyIdx];
      if (a.currentBidderId) {
        const winner = st.players.find(p => p.id === a.currentBidderId);
        winner.money -= a.currentBid;
        st.squares[a.propertyIdx].ownerId = winner.id;
        this._addLog(st, `🏆 Açık artırma: ${winner.name} ${sq.name}'ı ${a.currentBid}₺'a aldı`);
      } else {
        this._addLog(st, `❌ ${sq.name} satılmadı`);
      }
      st.auction = null;
      st.phase = 'rolling';
      const isDoubles = st.dice[0] === st.dice[1];
      if (!isDoubles) this._endTurn(room);
    }
  },

  buildHouse(room, playerId, squareIdx) {
    const st = room.gameState;
    if (!st || st.gameOver) return;
    const player = st.players.find(p => p.id === playerId);
    if (!player || player.bankrupt) return;
    const ownState = st.squares[squareIdx];
    const sq = SY_DATA.BOARD[squareIdx];
    if (sq.type !== 'property') return;
    if (ownState.ownerId !== playerId) return;
    if (!this._ownsFullSet(st, playerId, sq.color)) {
      io.to(playerId).emit('room:error', { message: 'Önce o renk grubunun tamamına sahip olmalısın!' });
      return;
    }
    // Hiçbiri ipotekli olmamalı
    const groupIdxs = SY_DATA.COLOR_GROUPS[sq.color];
    if (groupIdxs.some(i => st.squares[i].mortgaged)) {
      io.to(playerId).emit('room:error', { message: 'Bu gruptaki ipotekli mülklerini geri al!' });
      return;
    }
    // Eşit dağıtım kuralı: bu mülkteki ev sayısı, gruptakilerin minimum + 0 olmalı
    const houseCount = (s) => s.hotel ? 5 : s.houses;
    const minInGroup = Math.min(...groupIdxs.map(i => houseCount(st.squares[i])));
    if (houseCount(ownState) > minInGroup) {
      io.to(playerId).emit('room:error', { message: 'Eşit dağıtım: önce diğer mülkleri yükselt!' });
      return;
    }
    if (ownState.hotel) {
      io.to(playerId).emit('room:error', { message: 'Zaten otel var!' });
      return;
    }
    if (player.money < sq.houseCost) {
      io.to(playerId).emit('room:error', { message: 'Yeterli paran yok!' });
      return;
    }
    player.money -= sq.houseCost;
    if (ownState.houses < 4) {
      ownState.houses++;
      this._addLog(st, `🏘️ ${player.name} ${sq.name}'a ev inşa etti (${ownState.houses})`);
    } else {
      ownState.houses = 0;
      ownState.hotel = true;
      this._addLog(st, `🏨 ${player.name} ${sq.name}'a OTEL inşa etti!`);
    }
    broadcastRoom(room.code);
  },

  sellHouse(room, playerId, squareIdx) {
    const st = room.gameState;
    if (!st || st.gameOver) return;
    const player = st.players.find(p => p.id === playerId);
    const ownState = st.squares[squareIdx];
    const sq = SY_DATA.BOARD[squareIdx];
    if (sq.type !== 'property') return;
    if (ownState.ownerId !== playerId) return;
    if (!ownState.hotel && ownState.houses === 0) return;
    // Eşit dağıtım: bu mülk max'taysa sat
    const groupIdxs = SY_DATA.COLOR_GROUPS[sq.color];
    const houseCount = (s) => s.hotel ? 5 : s.houses;
    const maxInGroup = Math.max(...groupIdxs.map(i => houseCount(st.squares[i])));
    if (houseCount(ownState) < maxInGroup) {
      io.to(playerId).emit('room:error', { message: 'Eşit dağıtım: önce daha yüksek olan mülkten sat!' });
      return;
    }
    const refund = Math.floor(sq.houseCost / 2);
    if (ownState.hotel) {
      ownState.hotel = false;
      ownState.houses = 4;
      player.money += refund;
      this._addLog(st, `🏚️ ${player.name} ${sq.name} otelini sattı (+${refund}₺) → 4 ev kaldı`);
    } else {
      ownState.houses--;
      player.money += refund;
      this._addLog(st, `🏚️ ${player.name} ${sq.name}'tan ev sattı (+${refund}₺)`);
    }
    broadcastRoom(room.code);
  },

  mortgageProperty(room, playerId, squareIdx) {
    const st = room.gameState;
    if (!st || st.gameOver) return;
    const player = st.players.find(p => p.id === playerId);
    const ownState = st.squares[squareIdx];
    const sq = SY_DATA.BOARD[squareIdx];
    if (ownState.ownerId !== playerId) return;
    if (ownState.mortgaged) return;
    if (ownState.houses > 0 || ownState.hotel) {
      io.to(playerId).emit('room:error', { message: 'Önce evleri/oteli sat!' });
      return;
    }
    const mortgageVal = Math.floor((sq.price || 0) / 2);
    if (mortgageVal <= 0) return;
    ownState.mortgaged = true;
    player.money += mortgageVal;
    this._addLog(st, `📜 ${player.name} ${sq.name}'ı ipotek etti (+${mortgageVal}₺)`);
    broadcastRoom(room.code);
  },

  unmortgageProperty(room, playerId, squareIdx) {
    const st = room.gameState;
    if (!st || st.gameOver) return;
    const player = st.players.find(p => p.id === playerId);
    const ownState = st.squares[squareIdx];
    const sq = SY_DATA.BOARD[squareIdx];
    if (ownState.ownerId !== playerId) return;
    if (!ownState.mortgaged) return;
    const interest = room.settings?.syarisi?.mortgageInterest ?? 10;
    const cost = Math.floor((sq.price / 2) * (1 + interest / 100));
    if (player.money < cost) {
      io.to(playerId).emit('room:error', { message: `İpotek geri alma maliyeti: ${cost}₺` });
      return;
    }
    player.money -= cost;
    ownState.mortgaged = false;
    this._addLog(st, `📜 ${player.name} ${sq.name} ipoteğini kaldırdı (-${cost}₺)`);
    broadcastRoom(room.code);
  },

  payJailFine(room, playerId) {
    const st = room.gameState;
    if (!st) return;
    const player = st.players.find(p => p.id === playerId);
    if (!player || player.jailTurns === 0) return;
    if (st.turnPlayerId !== playerId || st.phase !== 'rolling') return;
    const fine = room.settings?.syarisi?.jailFine ?? 50;
    if (player.money < fine) {
      io.to(playerId).emit('room:error', { message: 'Yeterli paran yok!' });
      return;
    }
    player.money -= fine;
    player.jailTurns = 0;
    this._addLog(st, `🔓 ${player.name} ${fine}₺ ceza ödeyip hapisten çıktı`);
    broadcastRoom(room.code);
  },

  useGetOutCard(room, playerId) {
    const st = room.gameState;
    if (!st) return;
    const player = st.players.find(p => p.id === playerId);
    if (!player || player.jailTurns === 0 || player.getOutCards <= 0) return;
    if (st.turnPlayerId !== playerId) return;
    player.getOutCards--;
    player.jailTurns = 0;
    this._addLog(st, `🎫 ${player.name} hapisten çıkış kartı kullandı`);
    broadcastRoom(room.code);
  },

  endTurn(room, playerId) {
    const st = room.gameState;
    if (!st || st.gameOver) return;
    if (st.turnPlayerId !== playerId) return;
    if (st.phase !== 'rolling') return;
    // Çift atılırsa endTurn değil, oyuncu tekrar zar atmalı
    const isDoubles = st.dice[0] === st.dice[1] && st.lastRoll !== null && st.doublesCount > 0;
    if (isDoubles) {
      io.to(playerId).emit('room:error', { message: 'Çift attın, tekrar zar atmalısın!' });
      return;
    }
    this._endTurn(room);
    broadcastRoom(room.code);
  },

  _endTurn(room) {
    const st = room.gameState;
    st.dice = [0, 0];
    st.lastRoll = null;
    st.doublesCount = 0;
    st.pendingCard = null;
    // Bir sonraki bankrupt olmayan oyuncuya geç
    const order = st.turnOrder;
    const currentIdx = order.indexOf(st.turnPlayerId);
    let next = (currentIdx + 1) % order.length;
    let guard = 0;
    while (guard < order.length) {
      const candidate = st.players.find(p => p.id === order[next]);
      if (candidate && !candidate.bankrupt) {
        st.turnPlayerId = candidate.id;
        st.phase = 'rolling';
        return;
      }
      next = (next + 1) % order.length;
      guard++;
    }
    // Kimse kalmadı?
    this._checkWin(room);
  },

  _goToJail(st, player) {
    player.position = 10;
    player.jailTurns = 1;
    this._addLog(st, `🚔 ${player.name} hapse atıldı!`);
  },

  _payOrBankrupt(room, payer, receiver, amount) {
    if (payer.money >= amount) {
      payer.money -= amount;
      if (receiver) receiver.money += amount;
    } else {
      this._handleDebt(room, payer, amount, receiver);
    }
  },

  _handleDebt(room, payer, amount, receiver) {
    const st = room.gameState;
    // İlk olarak: ev/otel sat + ipotek dahil tüm net worth yeterli mi?
    const liquidationValue = this._netWorth(st, payer);
    if (liquidationValue + payer.money < amount) {
      // İflas
      this._declareBankrupt(room, payer, receiver, amount);
      return;
    }
    // Otomatik olarak satmıyoruz; oyuncuya bildirim göster
    // Basit yaklaşım: önce mümkün olanı satıp ödemeye çalış (otomatik)
    // Daha gelişmiş: oyuncuya manage flag set, sırasını dondur. Şimdilik otomatik.
    this._autoLiquidate(room, payer, amount);
    if (payer.money >= amount) {
      payer.money -= amount;
      if (receiver) receiver.money += amount;
    } else {
      this._declareBankrupt(room, payer, receiver, amount);
    }
  },

  _netWorth(st, player) {
    let val = 0;
    st.squares.forEach((s, idx) => {
      if (s.ownerId === player.id) {
        const sq = SY_DATA.BOARD[idx];
        if (s.mortgaged) {
          // Zaten ipotek edildi, ek değer yok
        } else {
          val += Math.floor((sq.price || 0) / 2); // ipotek değeri
        }
        if (s.houses > 0) val += s.houses * Math.floor(sq.houseCost / 2);
        if (s.hotel) val += 5 * Math.floor(sq.houseCost / 2);
      }
    });
    return val;
  },

  _autoLiquidate(room, player, neededAmount) {
    const st = room.gameState;
    // Önce evleri sat (en pahalıdan)
    const ownedProps = st.squares.map((s, i) => ({ ...s, sq: SY_DATA.BOARD[i] }))
      .filter(s => s.ownerId === player.id);
    // Evleri/otelleri satma — color grubuna göre eşit dağıtım
    const colorMap = {};
    ownedProps.forEach(s => {
      if (s.sq.type === 'property') {
        if (!colorMap[s.sq.color]) colorMap[s.sq.color] = [];
        colorMap[s.sq.color].push(s);
      }
    });
    // Her grup içinde en yüksek seviyeli mülkten sat
    let safety = 0;
    while (player.money < neededAmount && safety < 100) {
      safety++;
      let sold = false;
      Object.values(colorMap).forEach(group => {
        if (player.money >= neededAmount) return;
        const houseCount = (s) => s.hotel ? 5 : s.houses;
        const maxLvl = Math.max(...group.map(houseCount));
        if (maxLvl > 0) {
          const target = group.find(s => houseCount(s) === maxLvl);
          this.sellHouse(room, player.id, target.idx);
          sold = true;
        }
      });
      if (!sold) break;
    }
    // Hâlâ yetersizse mülk ipotek et
    safety = 0;
    while (player.money < neededAmount && safety < 50) {
      safety++;
      const candidate = ownedProps.find(s => {
        const cur = st.squares[s.idx];
        return !cur.mortgaged && cur.houses === 0 && !cur.hotel;
      });
      if (!candidate) break;
      this.mortgageProperty(room, player.id, candidate.idx);
    }
  },

  _declareBankrupt(room, payer, creditor, debt) {
    const st = room.gameState;
    payer.bankrupt = true;
    this._addLog(st, `💀 ${payer.name} iflas etti!`);
    // Tüm mülkler creditor'a ya da bankaya
    st.squares.forEach((s, idx) => {
      if (s.ownerId === payer.id) {
        if (creditor) {
          s.ownerId = creditor.id;
          // İpotekli mülkleri otomatik geri alma — bırak ipotekli olarak
        } else {
          s.ownerId = null;
          s.houses = 0;
          s.hotel = false;
          s.mortgaged = false;
        }
      }
    });
    if (creditor) creditor.money += payer.money;
    payer.money = 0;
    payer.getOutCards = 0;
    // Kazanma kontrolü
    this._checkWin(room);
  },

  _checkWin(room) {
    const st = room.gameState;
    const alive = st.players.filter(p => !p.bankrupt);
    if (alive.length <= 1) {
      st.gameOver = true;
      st.phase = 'gameOver';
      st.winner = alive[0]?.id || null;
      this._addLog(st, `🏆 Oyun bitti! Kazanan: ${alive[0]?.name || '(yok)'}`);
      // Skor güncelle
      alive.forEach(p => {
        const realPlayer = room.players.find(rp => rp.id === p.id);
        if (realPlayer) realPlayer.score = (realPlayer.score || 0) + 1;
      });
    }
  },

  _addLog(st, msg) {
    st.log.unshift(msg);
    if (st.log.length > 30) st.log.pop();
  },

  // --- Takas ---
  proposeTrade(room, fromId, toId, offer) {
    const st = room.gameState;
    if (!st || st.gameOver) return;
    if (room.settings?.syarisi?.enableTrade === false) {
      io.to(fromId).emit('room:error', { message: 'Bu oyunda takas kapalı!' });
      return;
    }
    // offer: { money:int, properties:[idx], getOutCards:int }
    // request: { money:int, properties:[idx], getOutCards:int }
    if (!offer || typeof offer !== 'object') return;
    const from = st.players.find(p => p.id === fromId);
    const to = st.players.find(p => p.id === toId);
    if (!from || !to || from.bankrupt || to.bankrupt || from.id === to.id) return;

    // Validasyon
    const give = offer.give || { money: 0, properties: [], getOutCards: 0 };
    const want = offer.want || { money: 0, properties: [], getOutCards: 0 };
    if ((give.money || 0) < 0 || (want.money || 0) < 0) return;
    if ((give.money || 0) > from.money) return;
    if ((want.money || 0) > to.money) return;
    if ((give.getOutCards || 0) > from.getOutCards) return;
    if ((want.getOutCards || 0) > to.getOutCards) return;
    if (!Array.isArray(give.properties) || !Array.isArray(want.properties)) return;
    const giveOk = give.properties.every(i => st.squares[i]?.ownerId === from.id && st.squares[i].houses === 0 && !st.squares[i].hotel);
    const wantOk = want.properties.every(i => st.squares[i]?.ownerId === to.id && st.squares[i].houses === 0 && !st.squares[i].hotel);
    if (!giveOk || !wantOk) return;

    st.pendingTrade = { fromId, toId, give, want };
    this._addLog(st, `🤝 ${from.name} → ${to.name} takas teklif etti`);
    broadcastRoom(room.code);
  },

  respondTrade(room, playerId, accept) {
    const st = room.gameState;
    if (!st || !st.pendingTrade) return;
    if (st.pendingTrade.toId !== playerId) return;
    const t = st.pendingTrade;
    const from = st.players.find(p => p.id === t.fromId);
    const to = st.players.find(p => p.id === t.toId);
    if (!from || !to) return;

    if (!accept) {
      this._addLog(st, `❌ ${to.name} takası reddetti`);
      st.pendingTrade = null;
      broadcastRoom(room.code);
      return;
    }

    // Uygula
    from.money -= (t.give.money || 0);
    to.money   += (t.give.money || 0);
    to.money   -= (t.want.money || 0);
    from.money += (t.want.money || 0);
    from.getOutCards -= (t.give.getOutCards || 0);
    to.getOutCards   += (t.give.getOutCards || 0);
    to.getOutCards   -= (t.want.getOutCards || 0);
    from.getOutCards += (t.want.getOutCards || 0);
    t.give.properties.forEach(i => { st.squares[i].ownerId = to.id; });
    t.want.properties.forEach(i => { st.squares[i].ownerId = from.id; });

    this._addLog(st, `✅ ${to.name} takası kabul etti`);
    st.pendingTrade = null;
    broadcastRoom(room.code);
  },

  stop(room) {
    // Timer yok
  }
};

// ============================================================
// KIZMA BİRADER (4 oyunculu klasik zar/piyon oyunu)
// ============================================================
const KIZMA_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f']; // kırmızı/mavi/yeşil/sarı
const KIZMA_DEFAULT_TOKENS = ['🔴', '🔵', '🟢', '🟡'];

const KizmaBirader = {
  STARTS: [0, 10, 20, 30],   // her slot için track başlangıç pozisyonu (0-39)
  TRACK_LEN: 40,

  start(room) {
    const turnOrder = room.players.map(p => p.id);
    // Karıştır
    for (let i = turnOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [turnOrder[i], turnOrder[j]] = [turnOrder[j], turnOrder[i]];
    }
    // Maks 4 oyuncu (ilk 4'ü oyuncu, gerisi izleyici)
    const activeIds = turnOrder.slice(0, 4);
    const players = activeIds.map((id, slot) => {
      const orig = room.players.find(p => p.id === id);
      return {
        id, name: orig?.name || 'Oyuncu', slot,
        color: KIZMA_COLORS[slot],
        token: orig?.syToken || KIZMA_DEFAULT_TOKENS[slot],
        winner: false
      };
    });
    const pawns = [];
    players.forEach(p => {
      for (let i = 0; i < 4; i++) {
        pawns.push({
          id: `${p.id}-${i}`,
          ownerId: p.id,
          slot: p.slot,
          state: 'home',       // 'home' | 'track' | 'finish'
          trackPos: -1,
          finishSlot: -1
        });
      }
    });
    room.gameState = {
      type: 'kizma',
      phase: 'rolling',
      turnPlayerId: activeIds[0],
      turnOrder: activeIds,
      die: 0,
      rolledSixes: 0,
      lastRoll: null,
      players,
      pawns,
      pendingMove: null,
      log: [`🎮 Kızma Birader başladı! İlk sıra: ${players[0].name}`],
      gameOver: false,
      winner: null,
      rankings: []   // birinci, ikinci... id'ler
    };
    broadcastRoom(room.code);
    return true;
  },

  rollDie(room, playerId) {
    const st = room.gameState;
    if (!st || st.phase !== 'rolling') return;
    if (st.turnPlayerId !== playerId) return;
    if (st.die !== 0) return; // Önce hareketi bitir
    const player = st.players.find(p => p.id === playerId);
    if (!player || player.winner) return;

    const die = 1 + Math.floor(Math.random() * 6);
    st.die = die;
    st.lastRoll = die;
    this._addLog(st, `🎲 ${player.name} zar attı: ${die}`);

    // 3 ardışık altı kontrolü
    if (die === 6) {
      st.rolledSixes++;
      const penalty = room.settings?.kizma?.threeSixesPenalty || 'loseTurn';
      if (st.rolledSixes >= 3 && penalty === 'loseTurn') {
        this._addLog(st, `🚫 3. altı geldi! Sıra geçti.`);
        st.die = 0;
        this._endTurn(room);
        broadcastRoom(room.code);
        return;
      }
    } else {
      st.rolledSixes = 0;
    }

    const movable = this._getMovablePawns(st, player);
    if (movable.length === 0) {
      this._addLog(st, `⛔ ${player.name} hareket edemiyor.`);
      st.die = 0;
      this._endTurn(room);
      broadcastRoom(room.code);
      return;
    }
    if (movable.length === 1 && room.settings?.kizma?.autoSingleMove !== false) {
      this._movePawn(room, player, movable[0]);
    } else {
      st.phase = 'awaitMove';
      st.pendingMove = { movableIds: movable.map(p => p.id) };
    }
    broadcastRoom(room.code);
  },

  _getMovablePawns(st, player) {
    const die = st.die;
    return st.pawns.filter(p => p.ownerId === player.id && this._canMove(st, p, die, player));
  },

  _canMove(st, pawn, die, player) {
    if (pawn.state === 'home') {
      if (die !== 6) return false;
      const startPos = this.STARTS[player.slot];
      // Kendi piyonu start'ta varsa bloke
      return !st.pawns.some(p => p.ownerId === player.id && p.state === 'track' && p.trackPos === startPos);
    }
    if (pawn.state === 'track') {
      const startPos = this.STARTS[player.slot];
      const distance = (pawn.trackPos - startPos + 40) % 40;
      const newDistance = distance + die;
      if (newDistance < 40) {
        const newPos = (pawn.trackPos + die) % 40;
        return !st.pawns.some(p => p.ownerId === player.id && p.state === 'track' && p.trackPos === newPos);
      } else {
        const newSlot = newDistance - 40;
        if (newSlot > 3) return false;
        return !st.pawns.some(p => p.ownerId === player.id && p.state === 'finish' && p.finishSlot === newSlot);
      }
    }
    if (pawn.state === 'finish') {
      const newSlot = pawn.finishSlot + die;
      if (newSlot > 3) return false;
      return !st.pawns.some(p => p.ownerId === player.id && p.state === 'finish' && p.finishSlot === newSlot);
    }
    return false;
  },

  movePawnChoice(room, playerId, pawnId) {
    const st = room.gameState;
    if (!st || st.phase !== 'awaitMove') return;
    if (st.turnPlayerId !== playerId) return;
    if (!st.pendingMove?.movableIds.includes(pawnId)) return;
    const pawn = st.pawns.find(p => p.id === pawnId);
    const player = st.players.find(p => p.id === playerId);
    if (!pawn || !player) return;
    this._movePawn(room, player, pawn);
    broadcastRoom(room.code);
  },

  _movePawn(room, player, pawn) {
    const st = room.gameState;
    const die = st.die;
    if (pawn.state === 'home') {
      const startPos = this.STARTS[player.slot];
      pawn.state = 'track';
      pawn.trackPos = startPos;
      this._addLog(st, `🚪 ${player.name} eden bir piyon çıkardı (kare ${startPos + 1})`);
      this._captureAt(st, player, startPos);
    } else if (pawn.state === 'track') {
      const startPos = this.STARTS[player.slot];
      const distance = (pawn.trackPos - startPos + 40) % 40;
      const newDistance = distance + die;
      if (newDistance < 40) {
        const newPos = (pawn.trackPos + die) % 40;
        pawn.trackPos = newPos;
        this._addLog(st, `🚶 ${player.name} piyonu ${die} kare ilerletti (→ ${newPos + 1})`);
        this._captureAt(st, player, newPos);
      } else {
        const newSlot = newDistance - 40;
        pawn.state = 'finish';
        pawn.trackPos = -1;
        pawn.finishSlot = newSlot;
        this._addLog(st, `🏁 ${player.name} piyonu finiş slot ${newSlot + 1}'e girdi`);
      }
    } else if (pawn.state === 'finish') {
      pawn.finishSlot += die;
      this._addLog(st, `🏁 ${player.name} finiş slot ${pawn.finishSlot + 1}'e geçti`);
    }

    this._checkWin(room);

    st.pendingMove = null;
    const wasSix = st.lastRoll === 6;
    st.die = 0;

    if (st.gameOver) {
      broadcastRoom(room.code);
      return;
    }

    if (!wasSix) {
      this._endTurn(room);
    } else {
      st.phase = 'rolling';
    }
  },

  _captureAt(st, player, pos) {
    if (st.settings?.kizma?.enableCapture === false) return;
    st.pawns.forEach(p => {
      if (p.ownerId !== player.id && p.state === 'track' && p.trackPos === pos) {
        p.state = 'home';
        p.trackPos = -1;
        const victim = st.players.find(pl => pl.id === p.ownerId);
        this._addLog(st, `💥 ${player.name} → ${victim?.name} piyonu eve gönderildi!`);
      }
    });
  },

  _checkWin(room) {
    const st = room.gameState;
    st.players.forEach(p => {
      if (p.winner) return;
      const myPawns = st.pawns.filter(pa => pa.ownerId === p.id);
      const allFinish = myPawns.every(pa => pa.state === 'finish');
      const uniqueSlots = new Set(myPawns.map(pa => pa.finishSlot)).size === 4;
      if (allFinish && uniqueSlots) {
        p.winner = true;
        st.rankings.push(p.id);
        this._addLog(st, `🏆 ${p.name} oyunu bitirdi! (${st.rankings.length}. sıra)`);
        const real = room.players.find(rp => rp.id === p.id);
        if (real) real.score = (real.score || 0) + (st.rankings.length === 1 ? 3 : st.rankings.length === 2 ? 2 : 1);
      }
    });
    const stopOnFirst = !!room.settings?.kizma?.stopOnFirstWinner;
    const remaining = st.players.filter(p => !p.winner).length;
    if ((stopOnFirst && st.rankings.length >= 1) || remaining <= 1) {
      st.gameOver = true;
      st.phase = 'gameOver';
      st.winner = st.rankings[0] || null;
    }
  },

  _endTurn(room) {
    const st = room.gameState;
    st.die = 0;
    st.rolledSixes = 0;
    st.lastRoll = null;
    st.pendingMove = null;
    const order = st.turnOrder;
    let idx = order.indexOf(st.turnPlayerId);
    for (let i = 0; i < order.length; i++) {
      idx = (idx + 1) % order.length;
      const cand = st.players.find(p => p.id === order[idx]);
      if (cand && !cand.winner) {
        st.turnPlayerId = cand.id;
        st.phase = 'rolling';
        return;
      }
    }
  },

  _addLog(st, msg) {
    st.log.unshift(msg);
    if (st.log.length > 30) st.log.pop();
  },

  stop(room) {}
};

// ============================================================
// İSKAMBİL — Pişti (ve gelecekteki diğer kart oyunları için ortak yardımcılar)
// ============================================================
const ISKAMBIL_RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const ISKAMBIL_SUITS = ['H','D','C','S']; // ♥ ♦ ♣ ♠

function buildIskambilDeck() {
  const deck = [];
  for (const s of ISKAMBIL_SUITS) for (const r of ISKAMBIL_RANKS) deck.push({ rank: r, suit: s });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
function _suitSym(s) { return { H: '♥', D: '♦', C: '♣', S: '♠' }[s] || '?'; }

const Pisti = {
  start(room) {
    if (room.players.length < 2) return false;
    const turnOrder = room.players.map(p => p.id).slice(0, 4);
    for (let i = turnOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [turnOrder[i], turnOrder[j]] = [turnOrder[j], turnOrder[i]];
    }
    const PCOL = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f'];
    const PTOK = ['🦁', '✈️', '👟', '🚗'];
    const players = turnOrder.map((id, i) => {
      const orig = room.players.find(p => p.id === id);
      return {
        id, name: orig?.name || 'Oyuncu', slot: i,
        color: PCOL[i],
        token: orig?.syToken || PTOK[i]
      };
    });

    let deck = buildIskambilDeck();
    const pile = deck.splice(0, 4);
    const hands = {}, captures = {}, scores = {}, pistiCounts = {}, jackPistiCounts = {};
    players.forEach(p => {
      hands[p.id] = deck.splice(0, 4);
      captures[p.id] = [];
      scores[p.id] = 0;
      pistiCounts[p.id] = 0;
      jackPistiCounts[p.id] = 0;
    });

    room.gameState = {
      type: 'pisti',
      phase: 'playing',
      turnPlayerId: turnOrder[0],
      turnOrder,
      players,
      deck,
      pile,
      hands,                   // her oyuncuya gizli broadcastlanır
      captures,
      captureCount: Object.fromEntries(players.map(p => [p.id, 0])),
      handCount:    Object.fromEntries(players.map(p => [p.id, hands[p.id].length])),
      scores,
      pistiCounts,
      jackPistiCounts,
      lastCapturerId: null,
      lastEvent: null,         // {type, playerId, card?}
      log: [`🎴 Pişti başladı! İlk sıra: ${players[0].name}`],
      gameOver: false,
      winner: null,
      roundEndSummary: null,
      targetScore: room.settings?.pisti?.targetScore || 101,
      round: 1
    };
    broadcastRoom(room.code);
    return true;
  },

  playCard(room, playerId, cardIndex) {
    const st = room.gameState;
    if (!st || st.phase !== 'playing') return;
    if (st.turnPlayerId !== playerId) return;
    const hand = st.hands[playerId];
    if (!hand || cardIndex < 0 || cardIndex >= hand.length) return;
    const player = st.players.find(p => p.id === playerId);
    const card = hand.splice(cardIndex, 1)[0];

    let captured = false, pisti = false, jackPisti = false;
    if (st.pile.length > 0) {
      const top = st.pile[st.pile.length - 1];
      const matches = card.rank === top.rank;
      const isJack = card.rank === 'J';
      if (matches || isJack) {
        captured = true;
        if (st.pile.length === 1) {
          if (top.rank === 'J' && isJack) jackPisti = true;
          else if (matches) pisti = true;
        }
      }
    }

    if (captured) {
      st.pile.push(card);
      st.captures[playerId].push(...st.pile);
      st.captureCount[playerId] = st.captures[playerId].length;
      const got = st.pile.length;
      st.pile = [];
      st.lastCapturerId = playerId;
      if (jackPisti) {
        st.jackPistiCounts[playerId]++;
        this._addLog(st, `💥 ${player.name} → J PİŞTİ! (+${this._jackPistiPoints(room)} puan)`);
        st.lastEvent = { type: 'jackPisti', playerId, card };
      } else if (pisti) {
        st.pistiCounts[playerId]++;
        this._addLog(st, `🎯 ${player.name} → PİŞTİ! (+10 puan)`);
        st.lastEvent = { type: 'pisti', playerId, card };
      } else {
        this._addLog(st, `✋ ${player.name} ${card.rank}${_suitSym(card.suit)} ile ${got} kart aldı`);
        st.lastEvent = { type: 'capture', playerId, card, count: got };
      }
    } else {
      st.pile.push(card);
      this._addLog(st, `🃏 ${player.name} ${card.rank}${_suitSym(card.suit)} oynadı`);
      st.lastEvent = { type: 'play', playerId, card };
    }
    st.handCount[playerId] = hand.length;

    // Eller boşaldı + destede kart varsa yeniden dağıt
    const allHandsEmpty = st.players.every(p => st.hands[p.id].length === 0);
    if (allHandsEmpty && st.deck.length > 0) {
      const perPlayer = Math.min(4, Math.floor(st.deck.length / st.players.length));
      for (const p of st.players) {
        st.hands[p.id] = st.deck.splice(0, perPlayer);
        st.handCount[p.id] = st.hands[p.id].length;
      }
      this._addLog(st, `🃏 Yeni el dağıtıldı`);
    }

    // El + deste boş → round biter
    const gameEnd = st.players.every(p => st.hands[p.id].length === 0) && st.deck.length === 0;
    if (gameEnd) {
      this._endRound(room);
      broadcastRoom(room.code);
      return;
    }

    this._nextTurn(room);
    broadcastRoom(room.code);
  },

  _nextTurn(room) {
    const st = room.gameState;
    const order = st.turnOrder;
    const idx = order.indexOf(st.turnPlayerId);
    st.turnPlayerId = order[(idx + 1) % order.length];
  },

  _endRound(room) {
    const st = room.gameState;
    if (st.lastCapturerId && st.pile.length > 0) {
      st.captures[st.lastCapturerId].push(...st.pile);
      st.captureCount[st.lastCapturerId] = st.captures[st.lastCapturerId].length;
      const lastCap = st.players.find(p => p.id === st.lastCapturerId);
      this._addLog(st, `📦 ${lastCap?.name} son kapan, kalan ${st.pile.length} kartı aldı`);
      st.pile = [];
    }
    const summary = [];
    let maxCards = 0;
    st.players.forEach(p => {
      const cards = st.captures[p.id];
      let aces = 0, jacks = 0, twoClubs = 0, tenDiamonds = 0;
      cards.forEach(c => {
        if (c.rank === 'A') aces++;
        if (c.rank === 'J') jacks++;
        if (c.rank === '2' && c.suit === 'C') twoClubs = 2;
        if (c.rank === '10' && c.suit === 'D') tenDiamonds = 3;
      });
      const pisti = st.pistiCounts[p.id];
      const jPisti = st.jackPistiCounts[p.id];
      const pistiPts = pisti * 10 + jPisti * this._jackPistiPoints(room);
      const sub = aces + jacks + twoClubs + tenDiamonds + pistiPts;
      summary.push({ id: p.id, name: p.name, cards: cards.length, aces, jacks, twoClubs, tenDiamonds, pisti, jPisti, mostCards: 0, subtotal: sub });
      if (cards.length > maxCards) maxCards = cards.length;
    });
    const tops = summary.filter(s => s.cards === maxCards);
    if (tops.length === 1) {
      tops[0].mostCards = 3;
      tops[0].subtotal += 3;
    }
    summary.forEach(s => { st.scores[s.id] += s.subtotal; });

    const target = st.targetScore;
    const reached = st.players.filter(p => st.scores[p.id] >= target);
    if (reached.length >= 1) {
      const max = Math.max(...st.players.map(p => st.scores[p.id]));
      const final = st.players.find(p => st.scores[p.id] === max);
      st.gameOver = true;
      st.phase = 'gameOver';
      st.winner = final?.id;
      const real = room.players.find(rp => rp.id === final?.id);
      if (real) real.score = (real.score || 0) + 1;
      this._addLog(st, `🏆 ${final?.name} ${st.scores[final.id]} puanla kazandı!`);
    } else {
      st.phase = 'roundEnd';
    }
    st.roundEndSummary = summary;
  },

  startNextRound(room, playerId) {
    const st = room.gameState;
    if (!st || st.phase !== 'roundEnd') return;
    if (room.host !== playerId) return;
    let deck = buildIskambilDeck();
    const pile = deck.splice(0, 4);
    st.players.forEach(p => {
      st.hands[p.id] = deck.splice(0, 4);
      st.captures[p.id] = [];
      st.captureCount[p.id] = 0;
      st.handCount[p.id] = st.hands[p.id].length;
      st.pistiCounts[p.id] = 0;
      st.jackPistiCounts[p.id] = 0;
    });
    st.deck = deck;
    st.pile = pile;
    st.lastCapturerId = null;
    st.lastEvent = null;
    st.roundEndSummary = null;
    st.phase = 'playing';
    st.round = (st.round || 1) + 1;
    // El sırasını kaydır
    const order = st.turnOrder;
    order.push(order.shift());
    st.turnPlayerId = order[0];
    this._addLog(st, `🎴 ${st.round}. el başladı! İlk sıra: ${st.players.find(pl => pl.id === order[0])?.name}`);
    broadcastRoom(room.code);
  },

  _jackPistiPoints(room) {
    return room.settings?.pisti?.jackPistiBonus === 'double' ? 20 : 10;
  },
  _addLog(st, msg) {
    st.log.unshift(msg);
    if (st.log.length > 30) st.log.pop();
  },
  stop(room) {}
};

// ============================================================
// VARSAYILAN OYUN AYARLARI
// ============================================================
const DEFAULT_SETTINGS = {
  kelime: {
    turnTime: 20,                // saniye
    minLength: 2,                // minimum kelime uzunluğu
    lives: 1,                    // oyuncu başına can (1-5)
    passesPerPlayer: 1,          // oyuncu başına pas hakkı (0-3)
    letterChangesPerPlayer: 1,   // oyuncu başına harf değiş hakkı (0-3)
    category: 'serbest',         // 'serbest'|'hayvan'|'bitki'|'esya'|'ulke'|'yemek'|'a-yok'
    matchMode: 'son-harf',       // 'son-harf'|'kafiye'
    useDictionary: true          // sözlük kontrolü (serbest modda)
  },
  hafiza: {
    pairCount: 8,      // 8 çift = 16 kart (4-18 olabilir)
    theme: 'karisik'   // 'karisik'|'hayvan'|'yemek'|'spor'|'meyve'
  },
  cizim: {
    roundTime: 75,     // her tur saniye
    totalRounds: 3     // her oyuncu kaç kez çizer
  },
  trivia: {
    questionTime: 15,
    totalQuestions: 10,
    streak: true,         // streak bonus aç/kapa
    fiftyJoker: true      // 50:50 joker aç/kapa
  },
  vampir: {
    discussionTime: 60,
    voteTime: 20,
    nightTime: 25,
    extraVampire: false,  // 4-5 kişide 2. vampir
    doctorCount: 1,       // 0-2
    detectiveCount: 1,    // 0-2
    witch: false,         // Cadı dahil mi?
    jester: false         // Soytarı dahil mi?
  },
  yilan: {
    duration: 120,
    foodCount: 60,
    speed: 3
  },
  uno: {
    initialHand: 7
  },
  sih: {
    roundCount: 5,
    roundTime: 60,
    letterMode: 'random',
    autoValidate: true,
    activeCategories: ['hayvan', 'isim', 'sehir']
  },
  emoji: {
    questionTime: 30,
    totalQuestions: 10,
    acceptClose: true,
    firstBonus: true,
    category: 'karisik'
  },
  codenames: {
    firstTeam: 'random' // 'random'|'red'|'blue'
  },
  syarisi: {
    startingMoney: 1500,       // başlangıç parası (500-3000)
    enableAuction: true,       // satın alınmayan mülk açık artırmaya çıksın mı
    enableTrade: true,         // oyuncular takas yapabilsin mi
    parkingPot: false,         // vergi/cezalar Ücretsiz Park'ta birikip oraya gelene veriliyor mu
    walkAnimation: true,       // token kare kare yürüsün mü
    goBonus: 200,              // Başlangıç'tan geçince alınacak para (100-400)
    jailFine: 50,              // hapis cezası
    mortgageInterest: 10       // ipotek geri alma faizi % (5-25)
  },
  kizma: {
    threeSixesPenalty: 'loseTurn',   // '3 altı' kuralı: 'loseTurn'|'none'
    autoSingleMove: true,            // tek seçenek varsa otomatik oyna
    enableCapture: true,             // rakip piyona basınca eve gönder
    stopOnFirstWinner: false,        // ilk biten kazanır → oyunu durdur (kapalıysa sıralama tutar)
    walkAnimation: true              // piyon kare kare yürüsün mü
  },
  pisti: {
    targetScore: 101,                // 51 | 101 | 151 — bu hedefe ulaşan kazanır
    jackPistiBonus: 'double'         // 'double' (20p) | 'single' (10p)
  }
  // Amiral Battı'da ayar yok (klasik kurallar)
};

function cloneSettings() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

// ============================================================
// SOCKET.IO BAĞLANTI YÖNETİMİ
// ============================================================
io.on('connection', (socket) => {
  console.log('Bağlandı:', socket.id);

  // --- Oda Oluştur ---
  socket.on('room:create', ({ name, password }) => {
    name = (name || '').trim().slice(0, 20) || 'Oyuncu';
    password = (password || '').toString().slice(0, 20);
    const code = generateRoomCode();
    const player = { id: socket.id, name, score: 0, eliminated: false, ready: false, codenamesTeam: null, codenamesRole: null };
    rooms[code] = {
      code,
      host: socket.id,
      players: [player],
      game: null,
      gameState: null,
      settings: cloneSettings(),
      lobbyChat: [],
      password: password || null,
      hasPassword: !!password
    };
    socket.join(code);
    socket.emit('room:joined', { code, you: { id: socket.id, name } });
    broadcastRoom(code);
  });

  // --- Odaya Katıl ---
  socket.on('room:join', ({ code, name, password }) => {
    code = (code || '').toUpperCase().trim();
    name = (name || '').trim().slice(0, 20) || 'Oyuncu';
    password = (password || '').toString();
    const room = rooms[code];
    if (!room) {
      socket.emit('room:error', { message: 'Oda bulunamadı!' });
      return;
    }
    // Şifre kontrolü
    if (room.password) {
      if (!password) {
        socket.emit('room:passwordRequired', { code });
        return;
      }
      if (password !== room.password) {
        socket.emit('room:error', { message: 'Şifre yanlış!' });
        return;
      }
    }
    if (room.players.length >= 12) {
      socket.emit('room:error', { message: 'Oda dolu! (max 12 oyuncu)' });
      return;
    }
    if (room.game) {
      socket.emit('room:error', { message: 'Oyun başlamış, bekleyin.' });
      return;
    }
    const player = { id: socket.id, name, score: 0, eliminated: false, ready: false, codenamesTeam: null, codenamesRole: null };
    room.players.push(player);
    socket.join(code);
    socket.emit('room:joined', { code, you: { id: socket.id, name } });
    broadcastRoom(code);
  });


  // --- Hazır toggle ---
  socket.on('room:toggleReady', () => {
    const result = findPlayerRoom(socket.id);
    if (!result) return;
    const { room, player } = result;
    player.ready = !player.ready;
    broadcastRoom(room.code);
  });

  // --- Lobi sohbeti ---
  socket.on('lobby:chat', ({ text }) => {
    const result = findPlayerRoom(socket.id);
    if (!result) return;
    const { room, player } = result;
    text = (text || '').toString().trim().slice(0, 200);
    if (!text) return;
    room.lobbyChat = room.lobbyChat || [];
    room.lobbyChat.push({
      playerId: player.id,
      name: player.name,
      text,
      ts: Date.now()
    });
    if (room.lobbyChat.length > 50) room.lobbyChat.shift();
    broadcastRoom(room.code);
  });

  // --- Hızlı tepki emoji ---
  socket.on('room:reaction', ({ emoji }) => {
    const result = findPlayerRoom(socket.id);
    if (!result) return;
    const { room, player } = result;
    const VALID = ['😄','🔥','👏','❤️','😱'];
    if (!VALID.includes(emoji)) return;
    io.to(room.code).emit('room:reaction', {
      playerId: player.id,
      playerName: player.name,
      emoji
    });
  });

  // --- Odadan Ayrıl ---
  socket.on('room:leave', () => {
    handleDisconnect(socket);
  });

  // --- Ayarları Güncelle (sadece host) ---
  socket.on('room:settings', ({ gameType, settings }) => {
    const result = findPlayerRoom(socket.id);
    if (!result) return;
    const { room } = result;
    if (room.host !== socket.id) {
      socket.emit('room:error', { message: 'Sadece host ayarları değiştirebilir!' });
      return;
    }
    if (room.game) {
      socket.emit('room:error', { message: 'Oyun sırasında ayar değiştirilemez!' });
      return;
    }
    if (!room.settings[gameType]) return;
    
    // Sadece bilinen alanları güncelle ve sınırlar dahilinde
    const limits = {
      kelime: {
        turnTime: [5, 60],
        minLength: [2, 6],
        lives: [1, 5],
        passesPerPlayer: [0, 3],
        letterChangesPerPlayer: [0, 3],
        category: { values: ['serbest', 'hayvan', 'bitki', 'esya', 'ulke', 'yemek', 'a-yok'] },
        matchMode: { values: ['son-harf', 'kafiye'] },
        useDictionary: 'bool'
      },
      hafiza: {
        pairCount: [4, 18],
        theme: { values: ['karisik', 'hayvan', 'yemek', 'spor', 'meyve'] }
      },
      cizim: { roundTime: [30, 180], totalRounds: [1, 5] },
      trivia: {
        questionTime: [5, 30],
        totalQuestions: [5, 30],
        streak: 'bool',
        fiftyJoker: 'bool'
      },
      vampir: {
        discussionTime: [20, 180],
        voteTime: [10, 60],
        nightTime: [10, 60],
        extraVampire: 'bool',
        doctorCount: [0, 2],
        detectiveCount: [0, 2],
        witch: 'bool',
        jester: 'bool'
      },
      yilan: { duration: [30, 300], foodCount: [10, 60], speed: [2, 5] },
      uno: { initialHand: [5, 10] },
      sih: {
        roundCount: [1, 20],
        roundTime: [20, 180],
        letterMode: { values: ['random', 'host'] },
        autoValidate: 'bool',
        activeCategories: { array: true, allowed: ['hayvan','isim','sehir','ulke','yemek','bitki','esya','renk','marka'] }
      },
      emoji: {
        questionTime: [10, 60],
        totalQuestions: [5, 30],
        acceptClose: 'bool',
        firstBonus: 'bool',
        category: { values: ['karisik', 'film', 'dizi', 'şarkı', 'marka', 'yemek', 'yer', 'deyim', 'kavram'] }
      },
      codenames: {
        firstTeam: { values: ['random', 'red', 'blue'] }
      },
      syarisi: {
        startingMoney: [500, 3000],
        enableAuction: 'bool',
        enableTrade: 'bool',
        parkingPot: 'bool',
        walkAnimation: 'bool',
        goBonus: [100, 400],
        jailFine: [0, 200],
        mortgageInterest: [0, 25]
      },
      kizma: {
        threeSixesPenalty: { values: ['loseTurn', 'none'] },
        autoSingleMove: 'bool',
        enableCapture: 'bool',
        stopOnFirstWinner: 'bool',
        walkAnimation: 'bool'
      },
      pisti: {
        targetScore: [51, 251],
        jackPistiBonus: { values: ['double', 'single'] }
      }
    };

    const gameLimits = limits[gameType];
    if (!gameLimits) return;

    for (const key in settings) {
      const lim = gameLimits[key];
      if (!lim) continue;
      const v = settings[key];
      if (lim === 'bool') {
        room.settings[gameType][key] = !!v;
      } else if (Array.isArray(lim) && typeof v === 'number') {
        room.settings[gameType][key] = Math.max(lim[0], Math.min(lim[1], Math.round(v)));
      } else if (typeof lim === 'object' && Array.isArray(lim.values) && typeof v === 'string') {
        if (lim.values.includes(v)) room.settings[gameType][key] = v;
      } else if (typeof lim === 'object' && lim.array && Array.isArray(v)) {
        // Allowed liste içinden filtrele, en az 1 kalmalı
        const filtered = v.filter(item => typeof item === 'string' && lim.allowed.includes(item));
        if (filtered.length > 0) room.settings[gameType][key] = filtered;
      }
    }
    broadcastRoom(room.code);
  });

  // --- Oyun Başlat (sadece host) ---
  function _launchGame(room, gameType, socket) {
    // Geri sayım — tüm istemcilere bildir, 3sn sonra oyunu başlat
    io.to(room.code).emit('game:countdown', { gameType, duration: 3 });
    setTimeout(() => {
      // Oda hâlâ var mı?
      if (!rooms[room.code]) return;
      // Yeterli oyuncu var mı? (disconnect olmuş olabilir)
      if (room.players.length < 2) {
        io.to(room.code).emit('room:error', { message: 'Yetersiz oyuncu, oyun iptal edildi.' });
        room.game = null;
        broadcastRoom(room.code);
        return;
      }
      room.game = gameType;
      if (gameType === 'kelime-zinciri') {
        KelimeZinciri.start(room);
      } else if (gameType === 'hafiza') {
        Hafiza.start(room);
      } else if (gameType === 'cizim') {
        Cizim.start(room);
      } else if (gameType === 'trivia') {
        Trivia.start(room);
      } else if (gameType === 'vampir') {
        const ok = Vampir.start(room);
        if (!ok) { room.game = null; broadcastRoom(room.code); return; }
      } else if (gameType === 'yilan') {
        const ok = Yilan.start(room);
        if (!ok) { room.game = null; broadcastRoom(room.code); return; }
      } else if (gameType === 'amiral') {
        if (room.players.length < 2) {
          if (socket) socket.emit('room:error', { message: 'Amiral Battı 2 oyuncu gerektirir!' });
          room.game = null;
          return;
        }
        AmiralBatti.start(room);
      } else if (gameType === 'uno') {
        const ok = UnoOyun.start(room);
        if (!ok) { room.game = null; broadcastRoom(room.code); return; }
      } else if (gameType === 'sih') {
        SehirIsimHayvan.start(room);
      } else if (gameType === 'emoji') {
        EmojiTahmin.start(room);
      } else if (gameType === 'codenames') {
        Codenames.start(room);
      } else if (gameType === 'syarisi') {
        SehirYarisi.start(room);
      } else if (gameType === 'kizma') {
        if (room.players.length < 2) {
          io.to(room.code).emit('room:error', { message: 'Kızma Birader 2-4 oyuncu gerektirir!' });
          room.game = null; broadcastRoom(room.code); return;
        }
        KizmaBirader.start(room);
      } else if (gameType === 'pisti') {
        if (room.players.length < 2) {
          io.to(room.code).emit('room:error', { message: 'Pişti 2-4 oyuncu gerektirir!' });
          room.game = null; broadcastRoom(room.code); return;
        }
        Pisti.start(room);
      }
    }, 3500);
  }

  socket.on('game:start', ({ gameType }) => {
    const result = findPlayerRoom(socket.id);
    if (!result) return;
    const { room } = result;
    if (room.host !== socket.id) {
      socket.emit('room:error', { message: 'Sadece oda kurucusu oyun başlatabilir!' });
      return;
    }
    if (room.players.length < 2) {
      socket.emit('room:error', { message: 'En az 2 oyuncu lazım!' });
      return;
    }
    _launchGame(room, gameType, socket);
  });

  // Aynı oyunu tekrar başlat (host)
  socket.on('game:replay', () => {
    const result = findPlayerRoom(socket.id);
    if (!result) return;
    const { room } = result;
    if (room.host !== socket.id) {
      socket.emit('room:error', { message: 'Sadece oda kurucusu tekrar başlatabilir!' });
      return;
    }
    if (!room.game) return;
    const gameType = room.game;
    stopGame(room);
    room.gameState = null;
    room.players.forEach(p => { p.score = 0; p.eliminated = false; p.alive = true; p.role = null; });
    _launchGame(room, gameType, socket);
  });

  // --- Oyundan Çık (lobiye dön) ---
  socket.on('game:exit', () => {
    const result = findPlayerRoom(socket.id);
    if (!result) return;
    const { room } = result;
    if (room.host !== socket.id) return;
    
    stopGame(room);
    room.game = null;
    room.gameState = null;
    room.players.forEach(p => { p.score = 0; p.eliminated = false; p.alive = true; p.role = null; });
    broadcastRoom(room.code);
  });

  // --- Kelime Zinciri: Kelime gönder ---
  socket.on('kelime:submit', ({ word }) => {
    const result = findPlayerRoom(socket.id);
    if (!result) return;
    const { room } = result;
    if (room.game !== 'kelime-zinciri') return;
    KelimeZinciri.submitWord(room, socket.id, word);
  });

  // --- Kelime Zinciri: Pas geç ---
  socket.on('kelime:pass', () => {
    const result = findPlayerRoom(socket.id);
    if (!result) return;
    const { room } = result;
    if (room.game !== 'kelime-zinciri') return;
    KelimeZinciri.pass(room, socket.id);
  });

  // --- Kelime Zinciri: Harf değiş ---
  socket.on('kelime:changeLetter', () => {
    const result = findPlayerRoom(socket.id);
    if (!result) return;
    const { room } = result;
    if (room.game !== 'kelime-zinciri') return;
    KelimeZinciri.changeLetter(room, socket.id);
  });

  // --- Hafıza: Kart çevir ---
  socket.on('hafiza:flip', ({ cardIndex }) => {
    const result = findPlayerRoom(socket.id);
    if (!result) return;
    const { room } = result;
    if (room.game !== 'hafiza') return;
    Hafiza.flipCard(room, socket.id, cardIndex);
  });

  // --- Çizim-Tahmin: Çizim noktası ---
  socket.on('cizim:draw', (stroke) => {
    const result = findPlayerRoom(socket.id);
    if (!result) return;
    const { room } = result;
    if (room.game !== 'cizim') return;
    Cizim.draw(room, socket.id, stroke);
  });

  // --- Çizim-Tahmin: Canvas temizle ---
  socket.on('cizim:clear', () => {
    const result = findPlayerRoom(socket.id);
    if (!result) return;
    const { room } = result;
    if (room.game !== 'cizim') return;
    Cizim.clearCanvas(room, socket.id);
  });

  // --- Çizim-Tahmin: Tahmin gönder ---
  socket.on('cizim:selectWord', ({ index }) => {
    const result = findPlayerRoom(socket.id);
    if (!result) return;
    const { room } = result;
    if (room.game !== 'cizim') return;
    Cizim.selectWord(room, socket.id, index);
  });

  socket.on('cizim:revealHint', () => {
    const result = findPlayerRoom(socket.id);
    if (!result) return;
    const { room } = result;
    if (room.game !== 'cizim') return;
    Cizim.revealHint(room, socket.id);
  });

  socket.on('cizim:undo', () => {
    const result = findPlayerRoom(socket.id);
    if (!result) return;
    const { room } = result;
    if (room.game !== 'cizim') return;
    Cizim.undo(room, socket.id);
  });

  socket.on('cizim:guess', ({ text }) => {
    const result = findPlayerRoom(socket.id);
    if (!result) return;
    const { room } = result;
    if (room.game !== 'cizim') return;
    Cizim.guess(room, socket.id, text);
  });

  // --- Trivia: Cevap gönder ---
  socket.on('trivia:answer', ({ answerIndex }) => {
    const result = findPlayerRoom(socket.id);
    if (!result) return;
    const { room } = result;
    if (room.game !== 'trivia') return;
    Trivia.submitAnswer(room, socket.id, answerIndex);
  });

  // --- Trivia: 50:50 Joker ---
  socket.on('trivia:useFifty', () => {
    const result = findPlayerRoom(socket.id);
    if (!result) return;
    const { room } = result;
    if (room.game !== 'trivia') return;
    Trivia.useFiftyJoker(room, socket.id);
  });

  // --- VAMPİR KÖYLÜ ---
  socket.on('vampir:kill', ({ targetId }) => {
    const result = findPlayerRoom(socket.id);
    if (!result || result.room.game !== 'vampir') return;
    Vampir.vampireKill(result.room, socket.id, targetId);
  });

  socket.on('vampir:save', ({ targetId }) => {
    const result = findPlayerRoom(socket.id);
    if (!result || result.room.game !== 'vampir') return;
    Vampir.doctorSave(result.room, socket.id, targetId);
  });

  socket.on('vampir:check', ({ targetId }) => {
    const result = findPlayerRoom(socket.id);
    if (!result || result.room.game !== 'vampir') return;
    Vampir.detectiveCheck(result.room, socket.id, targetId);
  });

  socket.on('vampir:witchPotion', ({ type, targetId }) => {
    const result = findPlayerRoom(socket.id);
    if (!result || result.room.game !== 'vampir') return;
    Vampir.witchPotion(result.room, socket.id, type, targetId);
  });

  socket.on('vampir:vote', ({ targetId }) => {
    const result = findPlayerRoom(socket.id);
    if (!result || result.room.game !== 'vampir') return;
    Vampir.dayVote(result.room, socket.id, targetId);
  });

  socket.on('vampir:chat', ({ text }) => {
    const result = findPlayerRoom(socket.id);
    if (!result || result.room.game !== 'vampir') return;
    Vampir.dayChat(result.room, socket.id, text);
  });

  // --- YILAN SAVAŞI ---
  socket.on('yilan:boost', ({ on }) => {
    const result = findPlayerRoom(socket.id);
    if (!result || result.room.game !== 'yilan') return;
    Yilan.setBoost(result.room, socket.id, !!on);
  });

  socket.on('yilan:direction', ({ direction }) => {
    const result = findPlayerRoom(socket.id);
    if (!result || result.room.game !== 'yilan') return;
    Yilan.changeDirection(result.room, socket.id, direction);
  });

  // --- AMİRAL BATTI ---
  socket.on('amiral:place', ({ ships }) => {
    const result = findPlayerRoom(socket.id);
    if (!result || result.room.game !== 'amiral') return;
    AmiralBatti.placeShips(result.room, socket.id, ships);
  });

  socket.on('amiral:shoot', ({ x, y }) => {
    const result = findPlayerRoom(socket.id);
    if (!result || result.room.game !== 'amiral') return;
    AmiralBatti.shoot(result.room, socket.id, x, y);
  });

  // --- UNO ---
  socket.on('uno:play', ({ cardIndex, pickColor }) => {
    const result = findPlayerRoom(socket.id);
    if (!result || result.room.game !== 'uno') return;
    UnoOyun.playCard(result.room, socket.id, cardIndex, pickColor);
  });

  socket.on('uno:call', () => {
    const result = findPlayerRoom(socket.id);
    if (!result || result.room.game !== 'uno') return;
    UnoOyun.callUno(result.room, socket.id);
  });

  socket.on('uno:catch', ({ targetId }) => {
    const result = findPlayerRoom(socket.id);
    if (!result || result.room.game !== 'uno') return;
    UnoOyun.catchUno(result.room, socket.id, targetId);
  });

  socket.on('uno:draw', () => {
    const result = findPlayerRoom(socket.id);
    if (!result || result.room.game !== 'uno') return;
    UnoOyun.drawCard(result.room, socket.id);
  });

  // --- Şehir-İsim-Hayvan ---
  socket.on('sih:pickLetter', ({ letter }) => {
    const result = findPlayerRoom(socket.id);
    if (!result || result.room.game !== 'sih') return;
    SehirIsimHayvan.pickLetter(result.room, socket.id, letter);
  });
  socket.on('sih:submit', ({ answers }) => {
    const result = findPlayerRoom(socket.id);
    if (!result || result.room.game !== 'sih') return;
    SehirIsimHayvan.submitAnswers(result.room, socket.id, answers);
  });

  // --- Emoji Tahmin ---
  socket.on('emoji:guess', ({ text }) => {
    const result = findPlayerRoom(socket.id);
    if (!result || result.room.game !== 'emoji') return;
    EmojiTahmin.guess(result.room, socket.id, text);
  });

  // --- Codenames lobby takım seçimi ---
  socket.on('codenames:joinTeam', ({ team }) => {
    const result = findPlayerRoom(socket.id);
    if (!result) return;
    const { player, room } = result;
    // Sadece setup fazında takım değiştirilebilir
    if (room.game === 'codenames' && room.gameState?.phase && room.gameState.phase !== 'setup') {
      socket.emit('room:error', { message: 'Oyun başladıktan sonra takım değiştirilemez!' });
      return;
    }
    if (team !== 'red' && team !== 'blue' && team !== null) return;
    // Önceki takımda spy idiyse rolünü bırak
    if (player.codenamesTeam !== team) player.codenamesRole = null;
    player.codenamesTeam = team;
    broadcastRoom(room.code);
  });

  socket.on('codenames:setRole', ({ role }) => {
    const result = findPlayerRoom(socket.id);
    if (!result) return;
    const { player, room } = result;
    // Sadece setup fazında rol değiştirilebilir
    if (room.game === 'codenames' && room.gameState?.phase && room.gameState.phase !== 'setup') {
      socket.emit('room:error', { message: 'Oyun başladıktan sonra rol değiştirilemez!' });
      return;
    }
    if (!player.codenamesTeam) return;
    if (role !== 'spymaster' && role !== 'agent' && role !== null) return;
    if (role === 'spymaster') {
      // Aynı takımda başka spymaster varsa onun rolünü düşür
      room.players.forEach(p => {
        if (p.codenamesTeam === player.codenamesTeam && p.id !== player.id && p.codenamesRole === 'spymaster') {
          p.codenamesRole = 'agent';
        }
      });
    }
    player.codenamesRole = role;
    broadcastRoom(room.code);
  });

  // --- Codenames oyun-içi ---
  socket.on('codenames:clue', ({ word, count }) => {
    const result = findPlayerRoom(socket.id);
    if (!result || result.room.game !== 'codenames') return;
    Codenames.giveClue(result.room, socket.id, word, count);
  });

  socket.on('codenames:guess', ({ cardIndex }) => {
    const result = findPlayerRoom(socket.id);
    if (!result || result.room.game !== 'codenames') return;
    Codenames.guessCard(result.room, socket.id, cardIndex);
  });

  socket.on('codenames:pass', () => {
    const result = findPlayerRoom(socket.id);
    if (!result || result.room.game !== 'codenames') return;
    Codenames.passGuess(result.room, socket.id);
  });

  socket.on('codenames:beginRound', () => {
    const result = findPlayerRoom(socket.id);
    if (!result || result.room.game !== 'codenames') return;
    Codenames.beginRound(result.room, socket.id);
  });

  // --- Şehir Yarışı ---
  function _syRoom() {
    const r = findPlayerRoom(socket.id);
    if (!r || r.room.game !== 'syarisi') return null;
    return r.room;
  }
  socket.on('sy:roll', () => {
    const room = _syRoom(); if (!room) return;
    SehirYarisi.rollDice(room, socket.id);
  });
  socket.on('sy:buy', () => {
    const room = _syRoom(); if (!room) return;
    SehirYarisi.buyProperty(room, socket.id);
  });
  socket.on('sy:decline', () => {
    const room = _syRoom(); if (!room) return;
    SehirYarisi.declineProperty(room, socket.id);
  });
  socket.on('sy:build', ({ squareIdx }) => {
    const room = _syRoom(); if (!room) return;
    SehirYarisi.buildHouse(room, socket.id, parseInt(squareIdx));
  });
  socket.on('sy:sellHouse', ({ squareIdx }) => {
    const room = _syRoom(); if (!room) return;
    SehirYarisi.sellHouse(room, socket.id, parseInt(squareIdx));
  });
  socket.on('sy:mortgage', ({ squareIdx }) => {
    const room = _syRoom(); if (!room) return;
    SehirYarisi.mortgageProperty(room, socket.id, parseInt(squareIdx));
  });
  socket.on('sy:unmortgage', ({ squareIdx }) => {
    const room = _syRoom(); if (!room) return;
    SehirYarisi.unmortgageProperty(room, socket.id, parseInt(squareIdx));
  });
  socket.on('sy:payJail', () => {
    const room = _syRoom(); if (!room) return;
    SehirYarisi.payJailFine(room, socket.id);
  });
  socket.on('sy:useCard', () => {
    const room = _syRoom(); if (!room) return;
    SehirYarisi.useGetOutCard(room, socket.id);
  });
  socket.on('sy:endTurn', () => {
    const room = _syRoom(); if (!room) return;
    SehirYarisi.endTurn(room, socket.id);
  });
  socket.on('sy:bid', ({ amount }) => {
    const room = _syRoom(); if (!room) return;
    SehirYarisi.placeBid(room, socket.id, amount);
  });
  socket.on('sy:passBid', () => {
    const room = _syRoom(); if (!room) return;
    SehirYarisi.passBid(room, socket.id);
  });
  socket.on('sy:proposeTrade', ({ toId, give, want }) => {
    const room = _syRoom(); if (!room) return;
    SehirYarisi.proposeTrade(room, socket.id, toId, { give, want });
  });
  socket.on('sy:respondTrade', ({ accept }) => {
    const room = _syRoom(); if (!room) return;
    SehirYarisi.respondTrade(room, socket.id, !!accept);
  });
  // --- Kızma Birader ---
  function _kzRoom() {
    const r = findPlayerRoom(socket.id);
    if (!r || r.room.game !== 'kizma') return null;
    return r.room;
  }
  socket.on('kizma:roll', () => {
    const room = _kzRoom(); if (!room) return;
    KizmaBirader.rollDie(room, socket.id);
  });
  socket.on('kizma:move', ({ pawnId }) => {
    const room = _kzRoom(); if (!room) return;
    KizmaBirader.movePawnChoice(room, socket.id, pawnId);
  });

  // --- Pişti ---
  function _piRoom() {
    const r = findPlayerRoom(socket.id);
    if (!r || r.room.game !== 'pisti') return null;
    return r.room;
  }
  socket.on('pisti:play', ({ cardIndex }) => {
    const room = _piRoom(); if (!room) return;
    Pisti.playCard(room, socket.id, parseInt(cardIndex));
  });
  socket.on('pisti:nextRound', () => {
    const room = _piRoom(); if (!room) return;
    Pisti.startNextRound(room, socket.id);
  });

  // Token (karakter) seçimi — lobide veya oyun başlamadan
  socket.on('sy:setToken', ({ token }) => {
    const result = findPlayerRoom(socket.id);
    if (!result) return;
    const { room, player } = result;
    if (!SY_TOKEN_CHARS.includes(token)) return;
    // Başka oyuncuda zaten varsa reddet
    const taken = room.players.some(p => p.id !== player.id && p.syToken === token);
    if (taken) {
      socket.emit('room:error', { message: 'Bu karakter zaten başka oyuncuda!' });
      return;
    }
    player.syToken = token;
    // Eğer oyun aktif ve syarisi state'i varsa, oradaki token'ı da güncelle
    if (room.game === 'syarisi' && room.gameState?.players) {
      const sp = room.gameState.players.find(p => p.id === player.id);
      if (sp) sp.token = token;
    }
    broadcastRoom(room.code);
  });

  // --- Bağlantı koptu ---
  socket.on('disconnect', () => {
    console.log('Ayrıldı:', socket.id);
    handleDisconnect(socket);
  });
});

function handleDisconnect(socket) {
  for (const code in rooms) {
    const room = rooms[code];
    const idx = room.players.findIndex(p => p.id === socket.id);
    if (idx !== -1) {
      const leftId = socket.id;
      room.players.splice(idx, 1);
      socket.leave(code);

      if (room.players.length === 0) {
        stopGame(room);
        delete rooms[code];
        return;
      }

      // Host ayrıldıysa yeni host ata
      if (room.host === leftId) {
        room.host = room.players[0].id;
      }

      // Codenames mid-game disconnect handling
      if (room.game === 'codenames' && room.gameState && room.gameState.phase !== 'setup' && !room.gameState.gameOver) {
        _codenamesHandleLeave(room, leftId);
      }

      // Oyun devam ediyorsa ve oyuncu eksilirse oyunu durdur (basit yaklaşım)
      if (room.game && room.players.length < 2) {
        stopGame(room);
        room.game = null;
        room.gameState = null;
      }

      broadcastRoom(code);
      return;
    }
  }
}

// Codenames: bir oyuncu mid-game disconnect olursa state'i tutarlı tut
function _codenamesHandleLeave(room, leftId) {
  const state = room.gameState;
  if (!state) return;

  // teams listesinden çıkar
  if (state.teams) {
    if (state.teams.red) state.teams.red = state.teams.red.filter(id => id !== leftId);
    if (state.teams.blue) state.teams.blue = state.teams.blue.filter(id => id !== leftId);
  }

  // Spymaster çıktı mı?
  let leftSpyTeam = null;
  if (state.spymasters?.red === leftId) leftSpyTeam = 'red';
  else if (state.spymasters?.blue === leftId) leftSpyTeam = 'blue';

  if (leftSpyTeam) {
    // Takımda kalan bir agent var mı? → onu spymaster yap
    const remainingTeammates = room.players.filter(p => p.codenamesTeam === leftSpyTeam);
    if (remainingTeammates.length > 0) {
      const newSpy = remainingTeammates[0];
      newSpy.codenamesRole = 'spymaster';
      state.spymasters[leftSpyTeam] = newSpy.id;
      state.log.unshift(`🕵️ ${newSpy.name} → ${leftSpyTeam.toUpperCase()} takımının yeni Casus Şefi`);
      // Eğer guessing fazındaysak ve yeni spy aktif takımdaysa, ipucuyu iptal edip clueGiving'e geri dön
      if (state.phase === 'guessing' && state.currentTurn === leftSpyTeam) {
        state.phase = 'clueGiving';
        state.currentClue = null;
        state.guessesLeft = 0;
        state.log.unshift(`⚠️ Casus Şefi değişti, ipucu iptal edildi.`);
      }
    } else {
      // Takım komple boşaldı → rakip kazanır
      const winner = leftSpyTeam === 'red' ? 'blue' : 'red';
      state.phase = 'gameOver';
      state.gameOver = true;
      state.winner = winner;
      state.loseReason = 'abandoned';
      state.log.unshift(`🏆 ${leftSpyTeam.toUpperCase()} takım dağıldı → ${winner.toUpperCase()} kazandı!`);
      room.players.forEach(p => {
        if (p.codenamesTeam === winner) p.score += 1;
      });
      return;
    }
  }

  // Bir takım komple boşaldı mı? (spy çıkmamış olsa bile)
  const redCount = room.players.filter(p => p.codenamesTeam === 'red').length;
  const blueCount = room.players.filter(p => p.codenamesTeam === 'blue').length;
  if (redCount === 0 || blueCount === 0) {
    const winner = redCount === 0 ? 'blue' : 'red';
    state.phase = 'gameOver';
    state.gameOver = true;
    state.winner = winner;
    state.loseReason = 'abandoned';
    state.log.unshift(`🏆 Rakip takım dağıldı → ${winner.toUpperCase()} kazandı!`);
    room.players.forEach(p => {
      if (p.codenamesTeam === winner) p.score += 1;
    });
  }
}

// ============================================================
// SUNUCUYU BAŞLAT
// ============================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 Arkadaşlarla Oynamalık çalışıyor: http://localhost:${PORT}`);
});

// Keep-alive: KEEP_ALIVE_URL env değişkeni ayarlıysa kendine ping atar (Render free tier uyku önleme)
// Render dashboard → Environment → KEEP_ALIVE_URL = https://senin-uygulamanin-adi.onrender.com/ping
const KEEP_ALIVE_URL = process.env.KEEP_ALIVE_URL;
if (KEEP_ALIVE_URL) {
  const INTERVAL_MIN = 10;
  console.log(`🔄 Keep-alive aktif: ${KEEP_ALIVE_URL} (her ${INTERVAL_MIN}dk)`);
  setInterval(() => {
    try {
      const fetchFn = (typeof fetch !== 'undefined') ? fetch : null;
      if (fetchFn) {
        fetchFn(KEEP_ALIVE_URL).catch(e => console.warn('Keep-alive fetch hatası:', e.message));
      }
    } catch (e) {
      console.warn('Keep-alive error:', e.message);
    }
  }, INTERVAL_MIN * 60 * 1000);
}
