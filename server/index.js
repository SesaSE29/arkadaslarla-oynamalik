// ============================================================
// ARKADAŞLARLA OYNAMALIK - Ana Sunucu
// Express + Socket.IO ile gerçek zamanlı oyun sunucusu
// ============================================================

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const WORDS = require('./words');
const TRIVIA_QUESTIONS = require('./trivia');

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
        gameState: personalState
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
        gameState: cleanState
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
      gameState: cleanState
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
    room.gameState = {
      type: 'kelime-zinciri',
      currentPlayerIndex: 0,
      lastWord: null,
      lastLetter: null,
      usedWords: [],
      timeLeft: 20,
      timerId: null,
      messages: [],
      gameOver: false,
      winner: null
    };
    // Puanları sıfırla
    room.players.forEach(p => p.score = 0);
    this.startTurn(room);
    broadcastRoom(room.code);
  },

  startTurn(room) {
    const state = room.gameState;
    if (state.timerId) clearInterval(state.timerId);
    state.timeLeft = 20;

    state.timerId = setInterval(() => {
      state.timeLeft--;
      io.to(room.code).emit('kelime:timer', { timeLeft: state.timeLeft });
      if (state.timeLeft <= 0) {
        clearInterval(state.timerId);
        this.eliminatePlayer(room, 'Süre doldu!');
      }
    }, 1000);
  },

  submitWord(room, playerId, word) {
    const state = room.gameState;
    if (!state || state.gameOver) return;

    const currentPlayer = room.players[state.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.id !== playerId) return;

    word = word.trim().toLocaleLowerCase('tr-TR');
    if (word.length < 2) {
      io.to(playerId).emit('kelime:error', { message: 'Kelime çok kısa!' });
      return;
    }

    // İlk kelime mi?
    if (state.lastLetter && word[0] !== state.lastLetter) {
      io.to(playerId).emit('kelime:error', { 
        message: `Kelime "${state.lastLetter.toUpperCase()}" harfi ile başlamalı!` 
      });
      return;
    }

    if (state.usedWords.includes(word)) {
      io.to(playerId).emit('kelime:error', { message: 'Bu kelime zaten kullanıldı!' });
      return;
    }

    // Geçerli kelime
    state.usedWords.push(word);
    state.lastWord = word;
    state.lastLetter = word[word.length - 1];
    currentPlayer.score += word.length; // Uzun kelime daha çok puan
    state.messages.push({ player: currentPlayer.name, word, valid: true });

    // Mesaj geçmişini kısa tut
    if (state.messages.length > 15) state.messages.shift();

    // Sonraki oyuncu
    this.nextTurn(room);
    broadcastRoom(room.code);
  },

  eliminatePlayer(room, reason) {
    const state = room.gameState;
    const currentPlayer = room.players[state.currentPlayerIndex];
    if (!currentPlayer) return;

    state.messages.push({ 
      player: currentPlayer.name, 
      word: reason, 
      valid: false 
    });

    // Oyuncuyu elemiş gibi işaretle (basit versiyon: tur atla, son kalan kazanır)
    // Burada basit tutuyoruz: süre dolduğunda sonraki oyuncuya geçer ve elenir
    currentPlayer.eliminated = true;

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

  nextTurn(room) {
    const state = room.gameState;
    if (state.timerId) clearInterval(state.timerId);

    // Sonraki aktif oyuncuyu bul
    let attempts = 0;
    do {
      state.currentPlayerIndex = (state.currentPlayerIndex + 1) % room.players.length;
      attempts++;
    } while (room.players[state.currentPlayerIndex].eliminated && attempts < room.players.length);

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
  EMOJIS: ['🎮','🎲','🎯','🎨','🎭','🎪','🎸','🎺','🚀','⭐','🌈','🍕','🍔','🍩','🦄','🐉','🦊','🐼'],

  start(room) {
    // 8 çift = 16 kart (3-4 kişi için ideal)
    const pairCount = 8;
    const selected = [...this.EMOJIS].sort(() => Math.random() - 0.5).slice(0, pairCount);
    const cards = [...selected, ...selected]
      .sort(() => Math.random() - 0.5)
      .map((emoji, i) => ({ id: i, emoji, flipped: false, matched: false }));

    room.gameState = {
      type: 'hafiza',
      cards,
      currentPlayerIndex: 0,
      flippedIndices: [], // Şu an açık olan kartların indexleri
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
  ROUND_TIME: 75, // saniye
  TOTAL_ROUNDS: 3, // her oyuncu kaç kez çizecek

  start(room) {
    room.players.forEach(p => { p.score = 0; p.eliminated = false; });
    room.gameState = {
      type: 'cizim',
      drawerIndex: 0,
      currentWord: null,
      wordHint: null, // "_ _ _ a _" gibi
      timeLeft: this.ROUND_TIME,
      timerId: null,
      strokes: [], // tüm çizim noktaları
      guesses: [], // { player, text, correct }
      correctGuessers: [], // bu turda doğru bilenler
      roundsPlayed: 0,
      totalRounds: room.players.length * this.TOTAL_ROUNDS,
      gameOver: false,
      winner: null,
      phase: 'drawing' // 'drawing' | 'roundEnd' | 'gameOver'
    };
    this.startRound(room);
  },

  startRound(room) {
    const state = room.gameState;
    if (state.timerId) clearInterval(state.timerId);

    // Rastgele kelime seç (zorluk dağılımı: %50 kolay, %35 orta, %15 zor)
    const r = Math.random();
    let pool;
    if (r < 0.5) pool = WORDS.kolay;
    else if (r < 0.85) pool = WORDS.orta;
    else pool = WORDS.zor;
    state.currentWord = pool[Math.floor(Math.random() * pool.length)];
    state.wordHint = this.generateHint(state.currentWord);

    state.timeLeft = this.ROUND_TIME;
    state.strokes = [];
    state.guesses = [];
    state.correctGuessers = [];
    state.phase = 'drawing';

    // Sadece çizen oyuncuya gerçek kelimeyi gönder
    const drawer = room.players[state.drawerIndex];
    io.to(drawer.id).emit('cizim:word', { word: state.currentWord });

    state.timerId = setInterval(() => {
      state.timeLeft--;
      io.to(room.code).emit('cizim:timer', { timeLeft: state.timeLeft });
      if (state.timeLeft <= 0) {
        this.endRound(room);
      }
    }, 1000);

    broadcastRoom(room.code);
  },

  generateHint(word) {
    // "elma" → "_ _ _ _"  (boşluklar olduğu gibi kalır)
    return word.split('').map(c => c === ' ' ? ' ' : '_').join(' ');
  },

  draw(room, playerId, stroke) {
    const state = room.gameState;
    if (!state || state.phase !== 'drawing') return;
    const drawer = room.players[state.drawerIndex];
    if (!drawer || drawer.id !== playerId) return;

    state.strokes.push(stroke);
    // Tüm odaya yeni çizim noktasını yolla (sadece delta, performans için)
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

  guess(room, playerId, text) {
    const state = room.gameState;
    if (!state || state.phase !== 'drawing') return;
    const player = room.players.find(p => p.id === playerId);
    if (!player) return;

    // Çizen tahmin yapamaz
    const drawer = room.players[state.drawerIndex];
    if (drawer.id === playerId) return;

    // Zaten doğru bildiyse spam'i engelle
    if (state.correctGuessers.includes(playerId)) return;

    text = text.trim();
    if (!text || text.length > 30) return;

    const normalized = text.toLocaleLowerCase('tr-TR').trim();
    const target = state.currentWord.toLocaleLowerCase('tr-TR').trim();

    if (normalized === target) {
      // Doğru tahmin!
      state.correctGuessers.push(playerId);
      // Puan: kalan süreye göre 5-15 arası
      const points = 5 + Math.floor((state.timeLeft / this.ROUND_TIME) * 10);
      player.score += points;
      // Çizen de puan alır (her doğru tahmin için 5)
      drawer.score += 5;

      state.guesses.push({ 
        player: player.name, 
        text: `✅ ${player.name} doğru bildi! (+${points})`, 
        correct: true 
      });

      // Mesajları sınırla
      if (state.guesses.length > 20) state.guesses.shift();

      // Herkes bildiyse turu erken bitir
      const nonDrawerCount = room.players.length - 1;
      if (state.correctGuessers.length >= nonDrawerCount) {
        this.endRound(room);
        return;
      }
      broadcastRoom(room.code);
    } else {
      // Yanlış tahmin - sohbet mesajı olarak göster
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

    // Tüm odaya doğru kelimeyi göster
    io.to(room.code).emit('cizim:reveal', { word: state.currentWord });

    // 5 saniye sonra yeni tur
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
    }, 5000);

    broadcastRoom(room.code);
  },

  stop(room) {
    if (room.gameState && room.gameState.timerId) {
      clearInterval(room.gameState.timerId);
    }
  }
};

// ============================================================
// TRIVIA (BİLGİ YARIŞMASI)
// ============================================================
const Trivia = {
  QUESTION_TIME: 15, // saniye
  TOTAL_QUESTIONS: 10,

  start(room) {
    room.players.forEach(p => { p.score = 0; p.eliminated = false; });

    // Rastgele 10 soru seç
    const shuffled = [...TRIVIA_QUESTIONS].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, this.TOTAL_QUESTIONS);

    room.gameState = {
      type: 'trivia',
      questions: selected,
      currentIndex: 0,
      currentQuestion: null,
      timeLeft: this.QUESTION_TIME,
      timerId: null,
      answers: {}, // { playerId: { answerIndex, timeUsed } }
      phase: 'question', // 'question' | 'reveal' | 'gameOver'
      lastAnswers: null, // önceki sorunun sonuçları
      gameOver: false,
      winner: null
    };
    this.startQuestion(room);
  },

  startQuestion(room) {
    const state = room.gameState;
    if (state.timerId) clearInterval(state.timerId);

    const q = state.questions[state.currentIndex];
    // Doğru cevabı oyunculara gönderme!
    state.currentQuestion = {
      number: state.currentIndex + 1,
      total: state.questions.length,
      question: q.q,
      options: q.a,
      category: q.cat
    };
    state.timeLeft = this.QUESTION_TIME;
    state.answers = {};
    state.phase = 'question';
    state.lastAnswers = null;

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
    if (state.answers[playerId] !== undefined) return; // zaten cevapladı
    if (answerIndex < 0 || answerIndex > 3) return;

    const timeUsed = this.QUESTION_TIME - state.timeLeft;
    state.answers[playerId] = { answerIndex, timeUsed };

    // Tüm oyuncular cevapladıysa erken bitir
    const activeCount = room.players.length;
    if (Object.keys(state.answers).length >= activeCount) {
      setTimeout(() => this.revealAnswer(room), 500);
    } else {
      // Sadece kaç kişi cevapladı bilgisini yolla
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
      if (ans && ans.answerIndex === q.correct) {
        correct = true;
        // Hızlı cevap daha çok puan: max 100, min 50
        const timeFactor = 1 - (ans.timeUsed / this.QUESTION_TIME);
        points = 50 + Math.round(50 * timeFactor);
        player.score += points;
      }
      results.push({
        playerId: player.id,
        playerName: player.name,
        answerIndex: ans ? ans.answerIndex : -1,
        correct,
        points
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
  DISCUSSION_TIME: 60, // gündüz tartışma
  VOTE_TIME: 20,       // gündüz oylama
  NIGHT_TIME: 25,      // gece eylemleri

  start(room) {
    if (room.players.length < 4) {
      io.to(room.host).emit('room:error', { message: 'Vampir Köylü en az 4 oyuncu gerektirir!' });
      return false;
    }

    // Rol dağıtımı
    // 4-5 kişi: 1 vampir, 1 doktor, 1 dedektif, gerisi köylü
    // 6-7 kişi: 2 vampir, 1 doktor, 1 dedektif, gerisi köylü
    // 8 kişi: 2 vampir, 1 doktor, 1 dedektif, gerisi köylü
    const n = room.players.length;
    let vampireCount = n <= 5 ? 1 : 2;
    
    const roles = [];
    for (let i = 0; i < vampireCount; i++) roles.push('vampir');
    roles.push('doktor');
    roles.push('dedektif');
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

    room.gameState = {
      type: 'vampir',
      phase: 'night',         // 'night' | 'dayDiscussion' | 'dayVote' | 'reveal' | 'gameOver'
      dayNumber: 1,
      timeLeft: this.NIGHT_TIME,
      timerId: null,
      nightActions: {
        vampireTargets: {},   // { vampirId: targetId }
        doctorTarget: null,
        detectiveTarget: null
      },
      votes: {},              // { voterId: targetId }
      events: [],             // gece/gün olayları
      chat: [],               // gündüz tartışma sohbeti
      gameOver: false,
      winner: null
    };

    this.startPhase(room, 'night');
    return true;
  },

  startPhase(room, phase) {
    const state = room.gameState;
    if (state.timerId) clearInterval(state.timerId);
    state.phase = phase;

    if (phase === 'night') {
      state.timeLeft = this.NIGHT_TIME;
      state.nightActions = { vampireTargets: {}, doctorTarget: null, detectiveTarget: null };
    } else if (phase === 'dayDiscussion') {
      state.timeLeft = this.DISCUSSION_TIME;
      state.chat = [];
    } else if (phase === 'dayVote') {
      state.timeLeft = this.VOTE_TIME;
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

    const doctorSave = state.nightActions.doctorTarget;
    let killed = null;

    if (killTarget && killTarget !== doctorSave) {
      const victim = room.players.find(p => p.id === killTarget);
      if (victim && victim.alive) {
        victim.alive = false;
        killed = victim.name;
      }
    }

    // Dedektif sonucu - sadece dedektife gönder
    if (state.nightActions.detectiveTarget) {
      const target = room.players.find(p => p.id === state.nightActions.detectiveTarget);
      const detective = room.players.find(p => p.role === 'dedektif' && p.alive);
      if (target && detective) {
        io.to(detective.id).emit('vampir:detectiveResult', {
          targetName: target.name,
          isVampire: target.role === 'vampir'
        });
      }
    }

    // Gece olayı kaydet
    state.events.push({
      day: state.dayNumber,
      type: 'night',
      message: killed ? `🌙 Gece: ${killed} bir vampir saldırısında öldü!` : '🌙 Gece: Doktor kurbanı kurtardı, kimse ölmedi.'
    });

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
    const aliveOthers = room.players.filter(p => p.alive && p.role !== 'vampir').length;

    if (aliveVampires === 0) {
      // Köylüler kazandı
      state.gameOver = true;
      state.phase = 'gameOver';
      state.winner = 'koyluler';
      room.players.forEach(p => {
        if (p.role !== 'vampir') p.score += 1;
      });
      if (state.timerId) clearInterval(state.timerId);
      broadcastRoom(room.code);
      return true;
    }
    if (aliveVampires >= aliveOthers) {
      // Vampirler kazandı
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
    
    state.nightActions.doctorTarget = targetId;
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
    
    state.nightActions.detectiveTarget = targetId;
    io.to(playerId).emit('vampir:actionConfirm', { 
      message: `${target.name} araştırılıyor...` 
    });
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
    return { vampir: '🧛', doktor: '⚕️', dedektif: '🔍', koylu: '👨‍🌾' }[role] || '?';
  },
  roleName(role) {
    return { vampir: 'Vampir', doktor: 'Doktor', dedektif: 'Dedektif', koylu: 'Köylü' }[role] || '?';
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
const Yilan = {
  TICK_RATE: 100,       // ms - sunucu güncellemesi
  ARENA_W: 1000,
  ARENA_H: 700,
  FOOD_COUNT: 30,
  INITIAL_LENGTH: 5,
  SPEED: 3,
  GAME_DURATION: 90,    // saniye

  start(room) {
    if (room.players.length < 2) return false;

    const colors = ['#ff3e8a', '#00d4ff', '#ffd93d', '#6bcf7f', '#a86bff', '#ff9f4a', '#4ade80', '#f472b6'];
    const snakes = {};
    room.players.forEach((p, i) => {
      const startX = 100 + (i % 4) * 200;
      const startY = 100 + Math.floor(i / 4) * 300;
      snakes[p.id] = {
        id: p.id,
        name: p.name,
        color: colors[i % colors.length],
        body: Array.from({ length: this.INITIAL_LENGTH }, (_, j) => ({
          x: startX - j * 10,
          y: startY
        })),
        direction: { x: 1, y: 0 }, // sağa doğru
        nextDirection: { x: 1, y: 0 },
        alive: true,
        score: 0
      };
      p.score = 0;
    });

    const foods = [];
    for (let i = 0; i < this.FOOD_COUNT; i++) {
      foods.push(this.randomFood());
    }

    room.gameState = {
      type: 'yilan',
      snakes,
      foods,
      timeLeft: this.GAME_DURATION,
      tickId: null,
      timerId: null,
      gameOver: false,
      winner: null
    };

    // Oyun döngüsü
    room.gameState.tickId = setInterval(() => this.tick(room), this.TICK_RATE);
    
    // Süre sayacı
    room.gameState.timerId = setInterval(() => {
      room.gameState.timeLeft--;
      if (room.gameState.timeLeft <= 0) {
        this.endGame(room);
      }
    }, 1000);

    broadcastRoom(room.code);
    return true;
  },

  randomFood() {
    return {
      x: Math.floor(Math.random() * (this.ARENA_W - 40)) + 20,
      y: Math.floor(Math.random() * (this.ARENA_H - 40)) + 20
    };
  },

  tick(room) {
    const state = room.gameState;
    if (!state || state.gameOver) return;

    const snakes = state.snakes;
    
    // Her yılanı hareket ettir
    for (const id in snakes) {
      const snake = snakes[id];
      if (!snake.alive) continue;
      
      snake.direction = snake.nextDirection;
      const head = snake.body[0];
      const newHead = {
        x: head.x + snake.direction.x * this.SPEED,
        y: head.y + snake.direction.y * this.SPEED
      };

      // Duvar çarpması
      if (newHead.x < 0 || newHead.x > this.ARENA_W || 
          newHead.y < 0 || newHead.y > this.ARENA_H) {
        snake.alive = false;
        continue;
      }

      // Kendine veya başka yılana çarpma
      let collided = false;
      for (const otherId in snakes) {
        const other = snakes[otherId];
        if (!other.alive) continue;
        // Kendi başını atlama, kendi gövdesine çarpma kontrolü
        const startIdx = (otherId === id) ? 4 : 0;
        for (let i = startIdx; i < other.body.length; i++) {
          const seg = other.body[i];
          const dx = newHead.x - seg.x;
          const dy = newHead.y - seg.y;
          if (dx * dx + dy * dy < 100) { // 10px çap
            collided = true;
            break;
          }
        }
        if (collided) break;
      }
      if (collided) {
        snake.alive = false;
        continue;
      }

      // Yem yeme
      let ate = false;
      for (let i = state.foods.length - 1; i >= 0; i--) {
        const f = state.foods[i];
        const dx = newHead.x - f.x;
        const dy = newHead.y - f.y;
        if (dx * dx + dy * dy < 144) { // 12px
          state.foods.splice(i, 1);
          state.foods.push(this.randomFood());
          snake.score += 1;
          const player = room.players.find(p => p.id === id);
          if (player) player.score = snake.score;
          ate = true;
          break;
        }
      }

      // Yeni başı ekle
      snake.body.unshift(newHead);
      // Yemediyse kuyruğu kes
      if (!ate) snake.body.pop();
    }

    // Sadece 1 yılan veya 0 yılan kaldıysa oyun bitti
    const aliveCount = Object.values(snakes).filter(s => s.alive).length;
    if (aliveCount <= 1 && room.players.length > 1) {
      this.endGame(room);
      return;
    }

    // Tüm oyunculara light state yolla (full broadcast yerine doğrudan tick eventi)
    io.to(room.code).emit('yilan:tick', {
      snakes: Object.fromEntries(Object.entries(snakes).map(([id, s]) => [id, {
        body: s.body, color: s.color, alive: s.alive, name: s.name, score: s.score
      }])),
      foods: state.foods,
      timeLeft: state.timeLeft
    });
  },

  changeDirection(room, playerId, direction) {
    const state = room.gameState;
    if (!state || state.gameOver) return;
    const snake = state.snakes[playerId];
    if (!snake || !snake.alive) return;
    
    // Geri dönmeyi engelle
    if (snake.direction.x === -direction.x && snake.direction.y === -direction.y) return;
    if (Math.abs(direction.x) > 1 || Math.abs(direction.y) > 1) return;
    
    snake.nextDirection = direction;
  },

  endGame(room) {
    const state = room.gameState;
    if (!state || state.gameOver) return;
    state.gameOver = true;
    if (state.tickId) clearInterval(state.tickId);
    if (state.timerId) clearInterval(state.timerId);
    
    // En yüksek skoru bul
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
    
    const deck = this.buildDeck();
    const hands = {};
    room.players.forEach(p => {
      hands[p.id] = [];
      for (let i = 0; i < this.INITIAL_HAND; i++) {
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
      gameState: null
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
    if (room.players.length >= 8) {
      socket.emit('room:error', { message: 'Oda dolu! (max 8 oyuncu)' });
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
