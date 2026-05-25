// Hayvan kategorisi - Kelime Zinciri için kabul edilen hayvan adları
// Hepsi küçük harf, Türkçe karakterli, tekil

module.exports = [
  // Memeliler - büyük
  'aslan', 'kaplan', 'leopar', 'çita', 'jaguar', 'puma', 'panter', 'vaşak',
  'fil', 'zürafa', 'gergedan', 'su aygırı', 'manda', 'bizon', 'yak',
  'ayı', 'panda', 'koala',
  'deve', 'lama', 'alpaka',
  'at', 'eşek', 'katır', 'zebra',
  'inek', 'boğa', 'dana', 'buzağı', 'koyun', 'kuzu', 'keçi', 'oğlak',
  'domuz', 'yaban domuzu',
  'geyik', 'karaca', 'ceylan', 'antilop', 'alageyik', 'ren geyiği',
  // Memeliler - küçük/orta
  'kedi', 'köpek', 'tavşan', 'fare', 'sıçan', 'sincap', 'kirpi',
  'kurt', 'tilki', 'çakal', 'sırtlan',
  'gelincik', 'samur', 'sansar', 'porsuk', 'köstebek',
  'su samuru', 'kunduz',
  'yarasa',
  'maymun', 'şempanze', 'goril', 'orangutan', 'babun', 'makak',
  // Deniz memelileri
  'balina', 'yunus', 'fok', 'mors',
  // Kuşlar
  'kuş', 'serçe', 'kanarya', 'papağan', 'muhabbet kuşu', 'güvercin',
  'kartal', 'şahin', 'atmaca', 'doğan', 'akbaba',
  'baykuş', 'puhu',
  'karga', 'kuzgun', 'saksağan',
  'leylek', 'turna', 'flamingo', 'pelikan', 'ibibik', 'martı',
  'tavuk', 'horoz', 'civciv', 'ördek', 'kaz', 'hindi',
  'tavus kuşu', 'devekuşu', 'penguen',
  'sülün', 'keklik', 'bıldırcın', 'çulluk',
  // Sürüngen ve amfibiler
  'yılan', 'kobra', 'piton', 'anakonda', 'engerek',
  'kertenkele', 'iguana', 'bukalemun', 'gekko', 'varan',
  'kaplumbağa', 'timsah', 'aligator',
  'kurbağa', 'semender',
  // Balık
  'balık', 'sazan', 'levrek', 'çipura', 'mezgit', 'hamsi',
  'palamut', 'lüfer', 'somon', 'alabalık', 'sardalye',
  'ton balığı', 'kılıçbalığı', 'köpekbalığı', 'vatoz', 'kalkan',
  'kefal', 'mercan', 'dil balığı', 'orkinos',
  // Deniz canlıları
  'ahtapot', 'mürekkepbalığı', 'kalamar', 'sübye',
  'yengeç', 'ıstakoz', 'karides', 'kerevit',
  'midye', 'istiridye', 'salyangoz',
  'denizyıldızı', 'denizatı', 'denizanası', 'sünger', 'mercan',
  // Böcek ve diğer
  'arı', 'eşek arısı', 'yaban arısı',
  'sinek', 'sivrisinek', 'karasinek',
  'kelebek', 'güve', 'tırtıl',
  'karınca', 'termit',
  'çekirge', 'cırcır böceği', 'peygamberdevesi',
  'uğurböceği', 'hamamböceği',
  'akrep', 'örümcek', 'kene',
  'solucan', 'sülük',
  // Egzotik
  'kanguru', 'vombat', 'opossum', 'tasmanya canavarı',
  'lemur', 'tukan', 'kakadu', 'ara papağanı',
  'kakım', 'vizon', 'sülük'
].map(w => w.toLocaleLowerCase('tr-TR'));
