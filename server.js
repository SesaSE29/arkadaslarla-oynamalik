// server.js - Bir Kelime Bir İşlem v5
const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// Keep-alive endpoint
app.get('/ping', (req, res) => res.send('pong'));

// =============================
// HARF DAĞILIMI
// =============================
const VOWELS = ['A','A','A','A','A','A','A','A','A','A','A','A','E','E','E','E','E','E','E','E','I','I','I','I','I','İ','İ','İ','İ','İ','İ','İ','İ','İ','İ','O','O','O','O','O','Ö','Ö','U','U','U','U','Ü','Ü'];
const CONSONANTS = ['B','B','B','C','C','Ç','Ç','D','D','D','D','F','G','G','Ğ','H','J','K','K','K','K','K','K','K','L','L','L','L','L','L','L','M','M','M','M','N','N','N','N','N','N','N','P','P','P','R','R','R','R','R','R','S','S','S','S','Ş','Ş','T','T','T','T','T','V','Y','Y','Y','Y','Z','Z'];
const ALL_LETTERS = 'ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ'.split('');

function randomLetters(count = 9) {
  const letters = [];
  const vowelCount = Math.floor(count * 0.4);
  const consCount = count - vowelCount;
  for (let i = 0; i < vowelCount; i++) letters.push(VOWELS[Math.floor(Math.random()*VOWELS.length)]);
  for (let i = 0; i < consCount; i++) letters.push(CONSONANTS[Math.floor(Math.random()*CONSONANTS.length)]);
  shuffle(letters);
  return letters;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// =============================
// KELİME LİSTESİ
// =============================
let WORD_LIST = [];
let WORD_LIST_BY_LEN = {};

function loadWordList() {
  console.log('Kelime listesi yükleniyor...');
  const url = 'https://raw.githubusercontent.com/mertemin/turkish-word-list/master/words.txt';
  https.get(url, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      const words = data.split('\n').map(w => w.trim().toLocaleLowerCase('tr-TR')).filter(w => w.length >= 2 && w.length <= 12 && /^[a-zçğıiöşü]+$/i.test(w));
      WORD_LIST = [...new Set(words)];
      WORD_LIST_BY_LEN = {};
      WORD_LIST.forEach(w => {
        const len = [...w].length;
        if (!WORD_LIST_BY_LEN[len]) WORD_LIST_BY_LEN[len] = [];
        WORD_LIST_BY_LEN[len].push(w);
      });
      console.log(`Kelime listesi hazır: ${WORD_LIST.length} kelime`);
    });
  }).on('error', (e) => console.error('Kelime listesi yüklenemedi:', e.message));
}
loadWordList();

function findLongestPossibleWord(letters, requiredLetter = null) {
  if (WORD_LIST.length === 0) return null;
  const pool = {};
  letters.forEach(l => {
    const lo = l.toLocaleLowerCase('tr-TR');
    pool[lo] = (pool[lo] || 0) + 1;
  });
  const reqLo = requiredLetter ? requiredLetter.toLocaleLowerCase('tr-TR') : null;
  for (let len = 9; len >= 2; len--) {
    const candidates = WORD_LIST_BY_LEN[len];
    if (!candidates) continue;
    for (const w of candidates) {
      if (reqLo && !w.includes(reqLo)) continue;
      const poolCopy = { ...pool };
      let ok = true;
      for (const ch of w) {
        if (!poolCopy[ch] || poolCopy[ch] <= 0) { ok = false; break; }
        poolCopy[ch]--;
      }
      if (ok) return w;
    }
  }
  return null;
}

// =============================
// ÇÖZÜLEBİLİR BULMACA
// =============================
function reachableTargets(numbers, maxResults = 500) {
  const results = new Set();
  let stopFlag = false;
  function recurse(nums) {
    if (stopFlag) return;
    nums.forEach(n => {
      if (n >= 100 && n <= 999) results.add(n);
      if (results.size >= maxResults) stopFlag = true;
    });
    if (nums.length < 2 || stopFlag) return;
    for (let i = 0; i < nums.length && !stopFlag; i++) {
      for (let j = 0; j < nums.length && !stopFlag; j++) {
        if (i === j) continue;
        const rest = nums.filter((_, k) => k !== i && k !== j);
        const a = nums[i], b = nums[j];
        const ops = [a+b, a-b, a*b];
        if (b !== 0 && a % b === 0) ops.push(a/b);
        ops.forEach(r => {
          if (r > 0 && Number.isInteger(r)) recurse([...rest, r]);
        });
      }
    }
  }
  recurse(numbers);
  return results;
}

function findSolutionForTarget(numbers, target) {
  let solution = null;
  function recurse(nums, history) {
    if (solution) return;
    for (const n of nums) {
      if (n === target) { solution = [...history]; return; }
    }
    if (nums.length < 2 || solution) return;
    for (let i = 0; i < nums.length && !solution; i++) {
      for (let j = 0; j < nums.length && !solution; j++) {
        if (i === j) continue;
        const rest = nums.filter((_, k) => k !== i && k !== j);
        const a = nums[i], b = nums[j];
        const opsArr = [
          { op: '+', val: a + b },
          { op: '-', val: a - b },
          { op: '*', val: a * b },
        ];
        if (b !== 0 && a % b === 0) opsArr.push({ op: '/', val: a / b });
        for (const { op, val } of opsArr) {
          if (val > 0 && Number.isInteger(val)) {
            recurse([...rest, val], [...history, { a, op, b, result: val }]);
          }
        }
      }
    }
  }
  recurse(numbers, []);
  return solution;
}

function randomMathPuzzle() {
  let tries = 0;
  while (tries < 30) {
    tries++;
    const large = [25, 50, 75, 100];
    const nums = [];
    const largeCount = 1 + Math.floor(Math.random()*2);
    const usedLarge = [...large];
    for (let i = 0; i < largeCount; i++) {
      const idx = Math.floor(Math.random()*usedLarge.length);
      nums.push(usedLarge.splice(idx,1)[0]);
    }
    while (nums.length < 6) nums.push(1 + Math.floor(Math.random()*10));
    shuffle(nums);
    const reachable = reachableTargets(nums);
    const valid = [...reachable].filter(n => n >= 101 && n <= 999);
    if (valid.length > 0) {
      const target = valid[Math.floor(Math.random()*valid.length)];
      return { numbers: nums, target };
    }
  }
  return { numbers: [1, 2, 3, 4, 25, 100], target: 250 };
}

function dailySeed() {
  const now = new Date();
  const dateStr = now.getUTCFullYear() + '-' + (now.getUTCMonth()+1) + '-' + now.getUTCDate();
  let h = 0;
  for (let i = 0; i < dateStr.length; i++) h = (h * 31 + dateStr.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function seededRandom(seed) {
  let s = seed;
  return function() { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function generateDailyPuzzles() {
  const rng = seededRandom(dailySeed());
  const letters = [];
  const vowelCount = 3 + Math.floor(rng()*2);
  const consCount = 9 - vowelCount;
  for (let i = 0; i < vowelCount; i++) letters.push(VOWELS[Math.floor(rng()*VOWELS.length)]);
  for (let i = 0; i < consCount; i++) letters.push(CONSONANTS[Math.floor(rng()*CONSONANTS.length)]);
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  const large = [25, 50, 75, 100];
  const nums = [];
  const largeCount = 1 + Math.floor(rng()*2);
  const usedLarge = [...large];
  for (let i = 0; i < largeCount; i++) {
    const idx = Math.floor(rng()*usedLarge.length);
    nums.push(usedLarge.splice(idx,1)[0]);
  }
  while (nums.length < 6) nums.push(1 + Math.floor(rng()*10));
  for (let i = nums.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [nums[i], nums[j]] = [nums[j], nums[i]];
  }
  const reachable = reachableTargets(nums);
  const valid = [...reachable].filter(n => n >= 101 && n <= 999);
  const target = valid.length > 0 ? valid[Math.floor(rng()*valid.length)] : 250;
  return { date: new Date().toISOString().slice(0, 10), letters, numbers: nums, target };
}

// =============================
// PUANLAMA
// =============================
function wordScore(len) {
  if (len < 4) return len;
  if (len === 4) return 4;
  if (len === 5) return 6;
  if (len === 6) return 9;
  if (len === 7) return 12;
  return 16;
}

function mathScore(diff) {
  if (diff === 0) return 10;
  if (diff === 1) return 8;
  if (diff === 2) return 6;
  if (diff === 3) return 5;
  if (diff === 4) return 4;
  if (diff === 5) return 3;
  if (diff <= 10) return 2;
  if (diff <= 20) return 1;
  return 0;
}

// =============================
// ODA YÖNETİMİ
// =============================
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

const rooms = {};

const PRESETS = {
  normal: { rounds: 6, timeLimitWord: 45, timeLimitMath: 60 },
  duel: { rounds: 3, timeLimitWord: 30, timeLimitMath: 45, maxPlayers: 2, locked: true },
  fast: { rounds: 6, timeLimitWord: 20, timeLimitMath: 25, maxTimeWord: 30, maxTimeMath: 30 },
  marathon: { rounds: 20, timeLimitWord: 45, timeLimitMath: 60, minRounds: 7 },
};

// Preset bazlı limit kontrolü
function clampSettings(settings, preset) {
  const p = PRESETS[preset];
  if (!p) return settings;
  if (p.locked) {
    settings.rounds = p.rounds;
    settings.timeLimitWord = p.timeLimitWord;
    settings.timeLimitMath = p.timeLimitMath;
  }
  if (p.maxTimeWord && settings.timeLimitWord > p.maxTimeWord) settings.timeLimitWord = p.maxTimeWord;
  if (p.maxTimeMath && settings.timeLimitMath > p.maxTimeMath) settings.timeLimitMath = p.maxTimeMath;
  if (p.minRounds && settings.rounds < p.minRounds) settings.rounds = p.minRounds;
  if (p.maxRounds && settings.rounds > p.maxRounds) settings.rounds = p.maxRounds;
  return settings;
}

function createRoom(hostSocketId, password = '') {
  let code;
  do { code = generateRoomCode(); } while (rooms[code]);
  rooms[code] = {
    code,
    password: password || '',
    host: hostSocketId,
    players: [],
    settings: {
      rounds: 6, timeLimitWord: 45, timeLimitMath: 60,
      jokersPerPlayer: 1, order: 'alternate', gameMode: 'mixed',
      preset: 'normal',
    },
    state: 'lobby',
    currentRound: 0,
    rounds_plan: [],
    currentData: null,
    answers: {},
    answerTimes: {}, // hızlı bonus için
    timerInterval: null,
    timeLeft: 0,
    timerStartedAt: 0,
    countdown: null,
    countdownInterval: null,
    roundHistory: [],
    chatLog: [],
    bonusRounds: [], // x2 puan turları
  };
  return code;
}

function broadcastRoom(code) {
  const room = rooms[code];
  if (!room) return;
  io.to(code).emit('room_state', getPublicState(room));
}

function getPublicState(room) {
  const isBonus = room.bonusRounds.includes(room.currentRound);
  let requiredLetter = null;
  if (room.currentData && room.currentData.type === 'word' && room.currentData.requiredLetter) {
    requiredLetter = room.currentData.requiredLetter;
  }
  return {
    code: room.code,
    hasPassword: !!room.password,
    state: room.state,
    settings: room.settings,
    players: room.players.map(p => ({
      id: p.id, name: p.name, avatar: p.avatar, score: p.score,
      jokersLeft: p.jokersLeft, connected: p.connected,
      hasAnswered: room.answers[p.id] !== undefined,
      badges: p.badges || [],
      typing: p.typing || false,
    })),
    currentRound: room.currentRound,
    totalRounds: room.settings.rounds,
    roundType: room.currentData ? room.currentData.type : null,
    letters: room.currentData && room.currentData.type === 'word' ? room.currentData.letters : null,
    numbers: room.currentData && room.currentData.type === 'math' ? room.currentData.numbers : null,
    target: room.currentData && room.currentData.type === 'math' ? room.currentData.target : null,
    requiredLetter,
    isBonus,
    timeLeft: room.timeLeft,
    countdown: room.countdown,
    hostId: room.host,
  };
}

function endRoundAnswering(code) {
  const room = rooms[code];
  if (!room) return;
  if (room.timerInterval) { clearInterval(room.timerInterval); room.timerInterval = null; }
  room.players.forEach(p => {
    if (p.connected && room.answers[p.id] === undefined) {
      room.answers[p.id] = { empty: true };
    }
  });
  room.state = 'answering';
  room.timeLeft = 0;
  io.to(code).emit('tick', { timeLeft: 0 });
  broadcastRoom(code);
}

function startTimer(code) {
  const room = rooms[code];
  if (!room) return;
  const limit = room.currentData.type === 'word' ? room.settings.timeLimitWord : room.settings.timeLimitMath;
  room.timeLeft = limit;
  room.timerStartedAt = Date.now();
  room.state = 'playing';
  broadcastRoom(code);
  if (room.timerInterval) clearInterval(room.timerInterval);
  room.timerInterval = setInterval(() => {
    room.timeLeft--;
    io.to(code).emit('tick', { timeLeft: room.timeLeft });
    if (room.timeLeft <= 0) endRoundAnswering(code);
  }, 1000);
}

function planRounds(settings) {
  const plan = [];
  const mode = settings.gameMode || 'mixed';
  if (mode === 'word-only') {
    for (let i = 0; i < settings.rounds; i++) plan.push('word');
  } else if (mode === 'math-only') {
    for (let i = 0; i < settings.rounds; i++) plan.push('math');
  } else {
    const order = settings.order;
    if (order === 'alternate') {
      for (let i = 0; i < settings.rounds; i++) plan.push(i % 2 === 0 ? 'word' : 'math');
    } else if (order === 'word-first') {
      const half = Math.ceil(settings.rounds/2);
      for (let i = 0; i < settings.rounds; i++) plan.push(i < half ? 'word' : 'math');
    } else {
      for (let i = 0; i < settings.rounds; i++) plan.push(Math.random() < 0.5 ? 'word' : 'math');
    }
  }
  return plan;
}

function planBonusRounds(rounds) {
  // 1 bonus tur (puanlar x2), oyunun ortasında
  if (rounds < 4) return [];
  const bonusIdx = Math.floor(rounds / 2);
  return [bonusIdx];
}

function buildRoundData(room) {
  const type = room.rounds_plan[room.currentRound];
  if (type === 'word') {
    const letters = randomLetters(9);
    // Bazı turlarda zorunlu harf koy (her 3 turda 1)
    let requiredLetter = null;
    if ((room.currentRound + 1) % 3 === 0) {
      // havuzdan rastgele bir harf seç
      requiredLetter = letters[Math.floor(Math.random() * letters.length)];
    }
    return { type: 'word', letters, requiredLetter };
  } else {
    return { type: 'math', ...randomMathPuzzle() };
  }
}

function setupNextRound(code) {
  const room = rooms[code];
  if (!room) return;
  if (room.timerInterval) { clearInterval(room.timerInterval); room.timerInterval = null; }
  if (room.countdownInterval) { clearInterval(room.countdownInterval); room.countdownInterval = null; }
  room.currentData = buildRoundData(room);
  room.answers = {};
  room.answerTimes = {};
  room.state = 'ready';
  const limit = room.currentData.type === 'word' ? room.settings.timeLimitWord : room.settings.timeLimitMath;
  room.timeLeft = limit;
  room.countdown = null;
  broadcastRoom(code);
}

function startCountdown(code) {
  const room = rooms[code];
  if (!room) return;
  if (room.countdownInterval) clearInterval(room.countdownInterval);
  const nextRoundNum = room.currentRound + 1;
  if (nextRoundNum >= room.settings.rounds) {
    room.state = 'finished';
    const ranked = [...room.players].sort((a,b) => b.score - a.score);
    // Rozetleri hesapla
    awardBadges(room);
    io.to(code).emit('game_finished', {
      ranking: ranked.map(p => ({ name: p.name, avatar: p.avatar, score: p.score, badges: p.badges })),
      history: room.roundHistory,
    });
    broadcastRoom(code);
    return;
  }
  room.countdown = 3;
  room.state = 'countdown';
  broadcastRoom(code);
  room.countdownInterval = setInterval(() => {
    room.countdown--;
    if (room.countdown <= 0) {
      clearInterval(room.countdownInterval);
      room.countdownInterval = null;
      room.countdown = null;
      room.currentRound++;
      room.currentData = buildRoundData(room);
      room.answers = {};
      room.answerTimes = {};
      room.state = 'ready';
      const limit = room.currentData.type === 'word' ? room.settings.timeLimitWord : room.settings.timeLimitMath;
      room.timeLeft = limit;
      broadcastRoom(code);
      setTimeout(() => startTimer(code), 100);
    } else {
      io.to(code).emit('countdown_tick', { countdown: room.countdown });
    }
  }, 1000);
}

function awardBadges(room) {
  // En uzun kelime, en iyi işlem, en hızlı, vb.
  const stats = {};
  room.players.forEach(p => {
    stats[p.id] = { longestWord: '', bestMathDiff: Infinity, totalAnswers: 0, fastAnswers: 0 };
    p.badges = [];
  });
  room.roundHistory.forEach(h => {
    h.results.forEach(r => {
      const player = room.players.find(p => p.name === r.name);
      if (!player) return;
      const ps = stats[player.id];
      ps.totalAnswers++;
      if (h.roundType === 'word' && r.word) {
        if (r.word.length > (ps.longestWord ? ps.longestWord.length : 0)) ps.longestWord = r.word;
      } else if (h.roundType === 'math' && r.result !== undefined) {
        const d = Math.abs(r.result - h.target);
        if (d < ps.bestMathDiff) ps.bestMathDiff = d;
      }
    });
  });
  // En uzun kelime
  let longestPlayer = null, longestLen = 0;
  room.players.forEach(p => {
    const l = stats[p.id].longestWord.length;
    if (l > longestLen) { longestLen = l; longestPlayer = p; }
  });
  if (longestPlayer && longestLen >= 5) longestPlayer.badges.push({ icon: '📚', label: 'Kelimeci' });
  // En iyi işlem
  let mathPlayer = null, bestDiff = Infinity;
  room.players.forEach(p => {
    if (stats[p.id].bestMathDiff < bestDiff) { bestDiff = stats[p.id].bestMathDiff; mathPlayer = p; }
  });
  if (mathPlayer && bestDiff === 0) mathPlayer.badges.push({ icon: '🎯', label: 'Matematikçi' });
  else if (mathPlayer && bestDiff <= 3) mathPlayer.badges.push({ icon: '🧮', label: 'Hesapçı' });
  // En yüksek skor
  const top = [...room.players].sort((a,b) => b.score - a.score)[0];
  if (top) top.badges.push({ icon: '👑', label: 'Şampiyon' });
}

function computeResults(room) {
  const isWord = room.currentData.type === 'word';
  const isBonus = room.bonusRounds.includes(room.currentRound);
  const results = [];
  let bestAnswer = null;
  const requiredLetter = room.currentData.requiredLetter;

  if (isWord) {
    bestAnswer = findLongestPossibleWord(room.currentData.letters, requiredLetter);
    // En hızlı zaman
    let fastestTime = Infinity;
    room.players.forEach(p => {
      const t = room.answerTimes[p.id];
      if (t !== undefined && t < fastestTime) fastestTime = t;
    });
    room.players.forEach(p => {
      const ans = room.answers[p.id];
      let pts = 0, info = {};
      let speedBonus = 0;
      if (ans && ans.word && !ans.empty) {
        // Zorunlu harf kontrolü
        const reqOk = !requiredLetter || ans.word.toLocaleLowerCase('tr-TR').includes(requiredLetter.toLocaleLowerCase('tr-TR'));
        if (ans.tdkValid === true && reqOk) {
          pts = wordScore(ans.word.length) - (ans.jokerCount || 0) * 2;
          if (pts < 0) pts = 0;
          // Hızlı cevap bonusu
          const t = room.answerTimes[p.id];
          if (t !== undefined && t <= 10000) speedBonus = 2;
        }
        info = {
          word: ans.word, tdkValid: ans.tdkValid, tdkUnknown: ans.tdkUnknown,
          jokerCount: ans.jokerCount || 0,
          missingRequired: requiredLetter && !reqOk,
        };
        if (ans.jokerCount > 0 && ans.tdkValid === true && reqOk) {
          p.jokersLeft = Math.max(0, p.jokersLeft - ans.jokerCount);
        }
      }
      pts += speedBonus;
      if (isBonus && pts > 0) pts *= 2;
      p.score += pts;
      results.push({ id: p.id, name: p.name, points: pts, speedBonus, isBonus, ...info });
    });
  } else {
    const target = room.currentData.target;
    bestAnswer = findSolutionForTarget(room.currentData.numbers, target);
    let minDiff = Infinity;
    room.players.forEach(p => {
      const ans = room.answers[p.id];
      if (ans && ans.result !== undefined && !ans.empty) {
        const d = Math.abs(ans.result - target);
        if (d < minDiff) minDiff = d;
      }
    });
    room.players.forEach(p => {
      const ans = room.answers[p.id];
      let pts = 0, info = {};
      let speedBonus = 0;
      if (ans && ans.result !== undefined && !ans.empty) {
        const diff = Math.abs(ans.result - target);
        const isClosest = diff === minDiff;
        pts = mathScore(diff);
        if (isClosest && diff > 0 && diff <= 20) pts += 1;
        // Hızlı bonus
        const t = room.answerTimes[p.id];
        if (t !== undefined && t <= 10000 && pts > 0) speedBonus = 2;
        info = { result: ans.result, diff, expression: ans.expression || '' };
      }
      pts += speedBonus;
      if (isBonus && pts > 0) pts *= 2;
      p.score += pts;
      results.push({ id: p.id, name: p.name, points: pts, speedBonus, isBonus, ...info });
    });
  }
  return { results, bestAnswer, requiredLetter, isBonus };
}

// =============================
// SOCKET HANDLERS
// =============================
io.on('connection', (socket) => {

  socket.on('create_room', ({ name, avatar, password, preset }, cb) => {
    const code = createRoom(socket.id, password || '');
    socket.join(code);
    const room = rooms[code];
    if (preset && PRESETS[preset]) {
      Object.assign(room.settings, PRESETS[preset]);
      room.settings.preset = preset;
    }
    room.players.push({
      id: socket.id,
      name: (name || 'Sunucu').slice(0, 20),
      avatar: avatar || '🦊',
      score: 0,
      jokersLeft: room.settings.jokersPerPlayer,
      connected: true,
      badges: [],
    });
    socket.data.roomCode = code;
    cb({ ok: true, code });
    broadcastRoom(code);
  });

  socket.on('join_room', ({ code, name, avatar, password }, cb) => {
    code = (code || '').toUpperCase().trim();
    const room = rooms[code];
    if (!room) return cb({ ok: false, error: 'Oda bulunamadı' });
    if (room.password && room.password !== (password || '')) {
      return cb({ ok: false, error: 'Yanlış şifre', needsPassword: true });
    }
    if (room.state !== 'lobby') {
      const existing = room.players.find(p => p.name.toLowerCase() === (name||'').toLowerCase());
      if (existing) {
        existing.id = socket.id;
        existing.connected = true;
        socket.join(code);
        socket.data.roomCode = code;
        cb({ ok: true, code, rejoin: true });
        broadcastRoom(code);
        return;
      }
      return cb({ ok: false, error: 'Oyun başladı, yeni oyuncu eklenemez' });
    }
    const maxP = (room.settings.preset === 'duel') ? 2 : 8;
    if (room.players.length >= maxP) return cb({ ok: false, error: `Oda dolu (max ${maxP})` });
    const cleanName = (name || 'Oyuncu').slice(0, 20).trim() || 'Oyuncu';
    if (room.players.some(p => p.name.toLowerCase() === cleanName.toLowerCase())) {
      return cb({ ok: false, error: 'Bu isim alınmış' });
    }
    socket.join(code);
    socket.data.roomCode = code;
    room.players.push({
      id: socket.id, name: cleanName, avatar: avatar || '🐱', score: 0,
      jokersLeft: room.settings.jokersPerPlayer, connected: true, badges: [],
    });
    cb({ ok: true, code });
    broadcastRoom(code);
  });

  socket.on('check_room', ({ code }, cb) => {
    code = (code || '').toUpperCase().trim();
    const room = rooms[code];
    if (!room) return cb({ exists: false });
    cb({ exists: true, hasPassword: !!room.password });
  });

  socket.on('update_settings', (settings) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || room.host !== socket.id || room.state !== 'lobby') return;
    if (settings.preset && PRESETS[settings.preset]) {
      const pSet = PRESETS[settings.preset];
      // Sadece preset değerlerini set et (locked, maxTime gibi meta'lar settings'e gitmesin)
      if (pSet.rounds) room.settings.rounds = pSet.rounds;
      if (pSet.timeLimitWord) room.settings.timeLimitWord = pSet.timeLimitWord;
      if (pSet.timeLimitMath) room.settings.timeLimitMath = pSet.timeLimitMath;
      room.settings.preset = settings.preset;
    }
    const currentPreset = room.settings.preset || 'normal';
    if (settings.rounds) room.settings.rounds = parseInt(settings.rounds);
    if (settings.timeLimitWord) room.settings.timeLimitWord = parseInt(settings.timeLimitWord);
    if (settings.timeLimitMath) room.settings.timeLimitMath = parseInt(settings.timeLimitMath);
    // Limitleri uygula
    clampSettings(room.settings, currentPreset);
    if (settings.jokersPerPlayer !== undefined) {
      room.settings.jokersPerPlayer = parseInt(settings.jokersPerPlayer);
      room.players.forEach(p => p.jokersLeft = room.settings.jokersPerPlayer);
    }
    if (settings.order) room.settings.order = settings.order;
    if (settings.gameMode) room.settings.gameMode = settings.gameMode;
    broadcastRoom(code);
  });

  socket.on('kick_player', ({ playerId }) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    if (playerId === room.host) return;
    const idx = room.players.findIndex(p => p.id === playerId);
    if (idx === -1) return;
    room.players.splice(idx, 1);
    delete room.answers[playerId];
    const kickedSocket = io.sockets.sockets.get(playerId);
    if (kickedSocket) {
      kickedSocket.emit('kicked');
      kickedSocket.leave(code);
    }
    broadcastRoom(code);
  });

  socket.on('start_game', () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || room.host !== socket.id || room.state !== 'lobby') return;
    if (room.players.length < 1) return;
    room.currentRound = 0;
    room.rounds_plan = planRounds(room.settings);
    room.bonusRounds = planBonusRounds(room.settings.rounds);
    room.roundHistory = [];
    setupNextRound(code);
  });

  socket.on('start_timer', () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    if (room.state !== 'ready') return;
    startTimer(code);
  });

  socket.on('submit_answer', (answer, cb) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return cb && cb({ ok: false });
    if (room.state !== 'answering' && room.state !== 'playing' && room.state !== 'ready') return cb && cb({ ok: false, error: 'Cevap zamanı değil' });
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return cb && cb({ ok: false });
    room.answers[player.id] = answer;
    // Cevap süresini kaydet
    if (room.timerStartedAt && room.state === 'playing') {
      room.answerTimes[player.id] = Date.now() - room.timerStartedAt;
    }
    const connectedPlayers = room.players.filter(p => p.connected);
    const allAnswered = connectedPlayers.every(p => room.answers[p.id] !== undefined);
    if (allAnswered && (room.state === 'playing' || room.state === 'ready')) {
      endRoundAnswering(code);
    } else {
      // broadcastRoom yapma! Sadece "X cevap verdi" durumunu yolla
      io.to(code).emit('player_answered', {
        playerId: player.id,
        playerName: player.name,
        scoreboard: room.players.map(p => ({
          id: p.id, name: p.name, avatar: p.avatar, score: p.score,
          jokersLeft: p.jokersLeft, connected: p.connected,
          hasAnswered: room.answers[p.id] !== undefined,
          typing: p.typing || false,
        })),
      });
    }
    cb && cb({ ok: true });
  });

  socket.on('clear_answer', () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return;
    if (room.state !== 'playing') return;
    delete room.answers[socket.id];
    delete room.answerTimes[socket.id];
    // broadcastRoom yapma, sadece kendi durumumu güncelle
    io.to(code).emit('player_unanswered', {
      playerId: socket.id,
      scoreboard: room.players.map(p => ({
        id: p.id, name: p.name, avatar: p.avatar, score: p.score,
        jokersLeft: p.jokersLeft, connected: p.connected,
        hasAnswered: room.answers[p.id] !== undefined,
        typing: p.typing || false,
      })),
    });
  });

  socket.on('show_results', () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    if (room.state !== 'answering') return;
    const { results, bestAnswer, requiredLetter, isBonus } = computeResults(room);
    room.state = 'results';
    room.lastResults = results;
    const histEntry = {
      roundNum: room.currentRound + 1,
      roundType: room.currentData.type,
      target: room.currentData.target,
      letters: room.currentData.letters,
      numbers: room.currentData.numbers,
      requiredLetter, isBonus,
      bestAnswer,
      results: results.map(r => ({ name: r.name, points: r.points, word: r.word, result: r.result, expression: r.expression })),
    };
    room.roundHistory.push(histEntry);
    io.to(code).emit('round_results', {
      results, roundType: room.currentData.type, target: room.currentData.target,
      bestAnswer, requiredLetter, isBonus,
      scoreboard: room.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, score: p.score })).sort((a,b) => b.score - a.score),
    });
    broadcastRoom(code);
  });

  socket.on('force_end_round', () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    if (room.state !== 'playing' && room.state !== 'ready') return;
    endRoundAnswering(code);
  });

  socket.on('next_round', () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    if (room.state !== 'results') return;
    startCountdown(code);
  });

  socket.on('restart_lobby', () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || room.host !== socket.id) return;
    room.state = 'lobby';
    room.currentRound = 0;
    room.rounds_plan = [];
    room.bonusRounds = [];
    room.currentData = null;
    room.answers = {};
    room.answerTimes = {};
    room.roundHistory = [];
    room.countdown = null;
    room.players.forEach(p => {
      p.score = 0;
      p.jokersLeft = room.settings.jokersPerPlayer;
      p.badges = [];
    });
    if (room.timerInterval) { clearInterval(room.timerInterval); room.timerInterval = null; }
    if (room.countdownInterval) { clearInterval(room.countdownInterval); room.countdownInterval = null; }
    broadcastRoom(code);
  });

  socket.on('emoji', ({ emoji, targetId }) => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms[code];
    if (!room) return;
    const sender = room.players.find(p => p.id === socket.id);
    if (!sender) return;
    let targetName = null;
    if (targetId) {
      const t = room.players.find(p => p.id === targetId);
      if (t) targetName = t.name;
    }
    io.to(code).emit('emoji_broadcast', { from: sender.name, fromAvatar: sender.avatar, emoji, targetName });
  });

  socket.on('chat', ({ text }) => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms[code];
    if (!room) return;
    // Sadece lobby ve results sırasında
    if (room.state !== 'lobby' && room.state !== 'results' && room.state !== 'finished' && room.state !== 'countdown') return;
    const sender = room.players.find(p => p.id === socket.id);
    if (!sender) return;
    const msg = (text || '').slice(0, 200).trim();
    if (!msg) return;
    const entry = { from: sender.name, avatar: sender.avatar, text: msg, ts: Date.now() };
    room.chatLog.push(entry);
    if (room.chatLog.length > 50) room.chatLog.shift();
    io.to(code).emit('chat_msg', entry);
  });

  socket.on('typing', ({ isTyping }) => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms[code];
    if (!room) return;
    const p = room.players.find(p => p.id === socket.id);
    if (!p) return;
    p.typing = !!isTyping;
    // broadcastRoom yapma! Sadece typing event'i yolla (DOM resetlenmesin)
    socket.to(code).emit('typing_update', { playerId: socket.id, typing: !!isTyping });
  });

  socket.on('daily_get', (cb) => {
    cb && cb(generateDailyPuzzles());
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms[code];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) player.connected = false;
    if (room.host === socket.id) {
      setTimeout(() => {
        if (rooms[code] && rooms[code].players.every(p => !p.connected)) {
          if (rooms[code].timerInterval) clearInterval(rooms[code].timerInterval);
          if (rooms[code].countdownInterval) clearInterval(rooms[code].countdownInterval);
          delete rooms[code];
        }
      }, 5 * 60 * 1000);
    }
    broadcastRoom(code);
  });
});

// Keep-alive self ping (Render uyumasın diye)
const SELF_URL = process.env.SELF_URL || '';
if (SELF_URL) {
  setInterval(() => {
    try {
      https.get(SELF_URL + '/ping', () => {}).on('error', () => {});
    } catch(e) {}
  }, 14 * 60 * 1000); // 14 dk
}

server.listen(PORT, () => {
  console.log(`Bir Kelime Bir İşlem v5 sunucusu: http://localhost:${PORT}`);
});
