// Trivia oyunu için Türkçe sorular
// Her soruda: soru, 4 şık, doğru cevap indeksi (0-3), kategori
module.exports = [
  // === COĞRAFYA ===
  { q: 'Türkiye\'nin başkenti neresidir?', a: ['İstanbul', 'Ankara', 'İzmir', 'Bursa'], correct: 1, cat: 'Coğrafya' },
  { q: 'Dünyanın en uzun nehri hangisidir?', a: ['Amazon', 'Nil', 'Yangtze', 'Mississippi'], correct: 1, cat: 'Coğrafya' },
  { q: 'En kalabalık nüfuslu ülke hangisidir?', a: ['Çin', 'Hindistan', 'ABD', 'Endonezya'], correct: 1, cat: 'Coğrafya' },
  { q: 'Hangi kıta dünyanın en küçük kıtasıdır?', a: ['Avrupa', 'Antarktika', 'Avustralya', 'Güney Amerika'], correct: 2, cat: 'Coğrafya' },
  { q: 'Türkiye\'nin en yüksek dağı hangisidir?', a: ['Erciyes', 'Uludağ', 'Ağrı Dağı', 'Kaçkar'], correct: 2, cat: 'Coğrafya' },
  { q: 'Hangi şehir iki kıta üzerinde yer alır?', a: ['Moskova', 'İstanbul', 'Kahire', 'Atina'], correct: 1, cat: 'Coğrafya' },
  { q: 'Dünyanın en büyük okyanusu hangisidir?', a: ['Atlas', 'Hint', 'Pasifik', 'Arktik'], correct: 2, cat: 'Coğrafya' },
  { q: 'Sahara çölü hangi kıtada yer alır?', a: ['Asya', 'Afrika', 'Avustralya', 'Güney Amerika'], correct: 1, cat: 'Coğrafya' },

  // === TARİH ===
  { q: 'Türkiye Cumhuriyeti hangi yıl kuruldu?', a: ['1920', '1922', '1923', '1925'], correct: 2, cat: 'Tarih' },
  { q: 'İstanbul kim tarafından fethedildi?', a: ['I. Selim', 'II. Mehmed', 'Süleyman', 'I. Murad'], correct: 1, cat: 'Tarih' },
  { q: 'II. Dünya Savaşı hangi yıl sona erdi?', a: ['1943', '1944', '1945', '1946'], correct: 2, cat: 'Tarih' },
  { q: 'Atatürk hangi şehirde doğdu?', a: ['İstanbul', 'Ankara', 'Selanik', 'İzmir'], correct: 2, cat: 'Tarih' },
  { q: 'Birinci Dünya Savaşı hangi yıl başladı?', a: ['1912', '1914', '1916', '1918'], correct: 1, cat: 'Tarih' },
  { q: 'Çanakkale Savaşı hangi yıl yapıldı?', a: ['1913', '1915', '1917', '1919'], correct: 1, cat: 'Tarih' },
  { q: 'Hangi medeniyet piramitleri inşa etti?', a: ['Romalılar', 'Mısırlılar', 'Yunanlılar', 'Persler'], correct: 1, cat: 'Tarih' },

  // === BİLİM ===
  { q: 'Suyun kimyasal formülü nedir?', a: ['CO2', 'H2O', 'O2', 'NaCl'], correct: 1, cat: 'Bilim' },
  { q: 'Güneş sistemindeki en büyük gezegen?', a: ['Mars', 'Jüpiter', 'Satürn', 'Neptün'], correct: 1, cat: 'Bilim' },
  { q: 'İnsan vücudunda kaç kemik vardır?', a: ['186', '206', '226', '246'], correct: 1, cat: 'Bilim' },
  { q: 'Yerçekimini ilk kim keşfetti?', a: ['Einstein', 'Newton', 'Galileo', 'Tesla'], correct: 1, cat: 'Bilim' },
  { q: 'Periyodik tabloda "Au" hangi elementtir?', a: ['Gümüş', 'Altın', 'Bakır', 'Alüminyum'], correct: 1, cat: 'Bilim' },
  { q: 'DNA\'nın açılımı nedir?', a: ['Deoksiribo Nükleik Asit', 'Dinamik Nötron Atomu', 'Diatomik Negatif Asit', 'Dilüt Nükleer Anyon'], correct: 0, cat: 'Bilim' },
  { q: 'Ay\'a ilk ayak basan insan kimdir?', a: ['Yuri Gagarin', 'Neil Armstrong', 'Buzz Aldrin', 'John Glenn'], correct: 1, cat: 'Bilim' },
  { q: 'Hangi gezegen "Kızıl Gezegen" olarak bilinir?', a: ['Venüs', 'Mars', 'Jüpiter', 'Merkür'], correct: 1, cat: 'Bilim' },
  { q: 'Işık hızı yaklaşık olarak nedir?', a: ['100.000 km/s', '300.000 km/s', '500.000 km/s', '1.000.000 km/s'], correct: 1, cat: 'Bilim' },

  // === SANAT & EDEBİYAT ===
  { q: '"Mona Lisa" tablosunun ressamı kimdir?', a: ['Van Gogh', 'Picasso', 'Da Vinci', 'Monet'], correct: 2, cat: 'Sanat' },
  { q: '"Hamlet" eserini kim yazdı?', a: ['Shakespeare', 'Tolstoy', 'Goethe', 'Dante'], correct: 0, cat: 'Sanat' },
  { q: '"Çalıkuşu" romanının yazarı kimdir?', a: ['Yaşar Kemal', 'Reşat Nuri Güntekin', 'Halide Edip', 'Sabahattin Ali'], correct: 1, cat: 'Sanat' },
  { q: 'Nobel Edebiyat Ödülü kazanan ilk Türk yazar?', a: ['Yaşar Kemal', 'Orhan Pamuk', 'Nazım Hikmet', 'Sait Faik'], correct: 1, cat: 'Sanat' },
  { q: '"Sefiller" romanının yazarı kimdir?', a: ['Hugo', 'Dumas', 'Balzac', 'Flaubert'], correct: 0, cat: 'Sanat' },
  { q: '"Yıldızlı Gece" tablosu kime aittir?', a: ['Monet', 'Van Gogh', 'Cezanne', 'Renoir'], correct: 1, cat: 'Sanat' },

  // === SPOR ===
  { q: 'FIFA Dünya Kupası kaç yılda bir yapılır?', a: ['2', '3', '4', '5'], correct: 2, cat: 'Spor' },
  { q: 'Bir futbol maçı kaç dakikadır?', a: ['80', '90', '100', '120'], correct: 1, cat: 'Spor' },
  { q: 'Olimpiyat oyunları ilk hangi ülkede yapıldı?', a: ['Roma', 'Atina', 'İstanbul', 'Paris'], correct: 1, cat: 'Spor' },
  { q: 'Basketbol takımında kaç oyuncu sahada olur?', a: ['4', '5', '6', '7'], correct: 1, cat: 'Spor' },
  { q: 'Tenis topu hangi renktir?', a: ['Beyaz', 'Sarı', 'Yeşil', 'Turuncu'], correct: 1, cat: 'Spor' },
  { q: 'En çok Dünya Kupası kazanan ülke?', a: ['Almanya', 'Arjantin', 'Brezilya', 'İtalya'], correct: 2, cat: 'Spor' },

  // === GÜNCEL & POPÜLER KÜLTÜR ===
  { q: 'Hangi şirket "iPhone" üretir?', a: ['Samsung', 'Apple', 'Google', 'Huawei'], correct: 1, cat: 'Teknoloji' },
  { q: 'YouTube hangi yıl kuruldu?', a: ['2003', '2005', '2007', '2009'], correct: 1, cat: 'Teknoloji' },
  { q: 'Tesla\'nın CEO\'su kimdir?', a: ['Bill Gates', 'Elon Musk', 'Mark Zuckerberg', 'Jeff Bezos'], correct: 1, cat: 'Teknoloji' },
  { q: 'Facebook\'un kurucusu kimdir?', a: ['Bill Gates', 'Steve Jobs', 'Mark Zuckerberg', 'Larry Page'], correct: 2, cat: 'Teknoloji' },
  { q: '"Harry Potter" serisinin yazarı kimdir?', a: ['J.K. Rowling', 'J.R.R. Tolkien', 'Stephen King', 'George R.R. Martin'], correct: 0, cat: 'Edebiyat' },

  // === MATEMATİK & MANTIK ===
  { q: 'Pi sayısı yaklaşık olarak nedir?', a: ['2.71', '3.14', '1.61', '4.20'], correct: 1, cat: 'Matematik' },
  { q: 'Bir üçgenin iç açıları toplamı kaç derecedir?', a: ['90', '180', '270', '360'], correct: 1, cat: 'Matematik' },
  { q: '12 x 12 kaçtır?', a: ['124', '134', '144', '154'], correct: 2, cat: 'Matematik' },
  { q: 'Bir saatte kaç saniye vardır?', a: ['360', '600', '3600', '6000'], correct: 2, cat: 'Matematik' },

  // === YEMEK & KÜLTÜR ===
  { q: 'Baklava hangi mutfağa aittir?', a: ['Türk', 'Yunan', 'İtalyan', 'Fransız'], correct: 0, cat: 'Yemek' },
  { q: 'Sushi hangi ülkenin yemeğidir?', a: ['Çin', 'Japonya', 'Kore', 'Tayland'], correct: 1, cat: 'Yemek' },
  { q: 'Türk kahvesi nasıl pişirilir?', a: ['Espresso makinesinde', 'Cezvede', 'French press ile', 'Filtre ile'], correct: 1, cat: 'Yemek' },
  { q: 'Pizzanın anavatanı neresidir?', a: ['İtalya', 'Yunanistan', 'ABD', 'Fransa'], correct: 0, cat: 'Yemek' },

  // === HAYVANLAR & DOĞA ===
  { q: 'En hızlı kara hayvanı hangisidir?', a: ['Aslan', 'Çita', 'Antilop', 'Kurt'], correct: 1, cat: 'Doğa' },
  { q: 'Hangi hayvan en uzun yaşar?', a: ['Fil', 'Kaplumbağa', 'Balina', 'Köpek balığı'], correct: 1, cat: 'Doğa' },
  { q: 'Penguenler nerede yaşar?', a: ['Kuzey Kutbu', 'Güney Kutbu', 'Sahara', 'Amazon'], correct: 1, cat: 'Doğa' },
  { q: 'Bir kelebek kaç ayaklıdır?', a: ['4', '6', '8', '10'], correct: 1, cat: 'Doğa' },
  { q: 'Yarasalar nasıl yön bulur?', a: ['Görüş', 'Yankı', 'Koku', 'Tat'], correct: 1, cat: 'Doğa' }
];
