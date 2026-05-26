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

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Statik dosyaları sun (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, '..', 'public')));

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
          eliminated: op.eliminated
        })),
        game: room.game,
        gameState: personalState,
        settings: room.settings
      });
    });
    return;
  }
  
  const playersBase = room.players.map(p => ({ 
    id: p.id, 
    name: p.name, 
    score: p.score,
    alive: p.alive,
    eliminated: p.eliminated
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
        settings: room.settings
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
      settings: room.settings
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
    'uno': UnoOyun
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
  socket.on('room:create', ({ name }) => {
    name = (name || '').trim().slice(0, 20) || 'Oyuncu';
    const code = generateRoomCode();
    const player = { id: socket.id, name, score: 0, eliminated: false };
    rooms[code] = {
      code,
      host: socket.id,
      players: [player],
      game: null,
      gameState: null,
      settings: cloneSettings()
    };
    socket.join(code);
    socket.emit('room:joined', { code, you: { id: socket.id, name } });
    broadcastRoom(code);
  });

  // --- Odaya Katıl ---
  socket.on('room:join', ({ code, name }) => {
    code = (code || '').toUpperCase().trim();
    name = (name || '').trim().slice(0, 20) || 'Oyuncu';
    const room = rooms[code];
    if (!room) {
      socket.emit('room:error', { message: 'Oda bulunamadı!' });
      return;
    }
    if (room.players.length >= 12) {
      socket.emit('room:error', { message: 'Oda dolu! (max 12 oyuncu)' });
      return;
    }
    if (room.game) {
      socket.emit('room:error', { message: 'Oyun başlamış, bekleyin.' });
      return;
    }
    const player = { id: socket.id, name, score: 0, eliminated: false };
    room.players.push(player);
    socket.join(code);
    socket.emit('room:joined', { code, you: { id: socket.id, name } });
    broadcastRoom(code);
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
      uno: { initialHand: [5, 10] }
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
      }
    }
    broadcastRoom(room.code);
  });

  // --- Oyun Başlat (sadece host) ---
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
        socket.emit('room:error', { message: 'Amiral Battı 2 oyuncu gerektirir!' });
        room.game = null;
        return;
      }
      AmiralBatti.start(room);
    } else if (gameType === 'uno') {
      const ok = UnoOyun.start(room);
      if (!ok) { room.game = null; broadcastRoom(room.code); return; }
    }
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
      room.players.splice(idx, 1);
      socket.leave(code);

      if (room.players.length === 0) {
        stopGame(room);
        delete rooms[code];
        return;
      }

      // Host ayrıldıysa yeni host ata
      if (room.host === socket.id) {
        room.host = room.players[0].id;
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

// ============================================================
// SUNUCUYU BAŞLAT
// ============================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 Arkadaşlarla Oynamalık çalışıyor: http://localhost:${PORT}`);
});
