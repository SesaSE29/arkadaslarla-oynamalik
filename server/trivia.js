// Trivia oyunu — tüm kategori dosyalarını birleştir
// Her kategori ayrı dosyada: server/data/trivia/{kategori}.js
const path = require('path');
const fs = require('fs');

const TRIVIA = [];
const dir = path.join(__dirname, 'data', 'trivia');

try {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  for (const f of files) {
    try {
      const list = require(path.join(dir, f));
      if (Array.isArray(list)) {
        TRIVIA.push(...list);
        console.log(`Trivia "${f}": ${list.length} soru yüklendi`);
      }
    } catch (e) {
      console.warn(`Trivia dosyası yüklenemedi (${f}):`, e.message);
    }
  }
  console.log(`Toplam ${TRIVIA.length} trivia sorusu yüklendi`);
} catch (e) {
  console.error('Trivia dizini okunamadı:', e.message);
}

module.exports = TRIVIA;
