# 🎮 Arkadaşlarla Oynamalık

Arkadaşlarınla online oynayabileceğin, oda kodu ile davet sistemli, çoklu oyun platformu.

## 🎯 Mevcut Oyunlar (8 oyun!)

**Sosyal & Parti Oyunları**
- **🔤 Kelime Zinciri** — Son harften başla, süre içinde yazamayan elenir!
- **🎨 Çizim-Tahmin** — Gartic tarzı! Birisi çizer, diğerleri sohbetten tahmin eder.
- **🧛 Vampir Köylü** — Roller gizli, gece/gündüz döngüsü, oylamayla vampirleri yakala! (4-8 kişi)
- **🎯 Trivia** — Genel kültür yarışması, hızlı cevapla daha çok puan.

**Strateji & Klasik**
- **🧠 Hafıza Oyunu** — Sırayla kart çevir, en çok çift bulan kazanır.
- **⚓ Amiral Battı** — Gemilerini yerleştir, rakibinin gemilerini batır! (2 kişi)
- **🃏 Uno Benzeri** — Renk/sayı eşle, +2, +4, dönüş, pas kartları!

**Hızlı Refleks**
- **🐍 Yılan Savaşı** — Slither.io tarzı! Yem ye, büyü, kimse seni yutmadan en uzun ol.

## ⚙️ Ayarlanabilir Her Şey!

Lobideki **⚙️ Ayarlar** butonu ile (sadece host) her oyunun ayarlarını değiştirebilirsin:

| Oyun | Ayarlar |
|------|---------|
| Kelime Zinciri | Tur süresi (5-60sn), min. kelime uzunluğu (2-6 harf) |
| Hafıza | Kart çifti sayısı (4-18 çift) |
| Çizim-Tahmin | Tur süresi (30-180sn), her oyuncu kaç tur çizer (1-5) |
| Trivia | Soru süresi (5-30sn), toplam soru (5-30) |
| Vampir Köylü | Gece/tartışma/oylama süreleri, ekstra vampir (4-5 kişide 2 vampir) |
| Yılan Savaşı | Süre (30-300sn), yem sayısı (10-60), hız (2-5) |
| Uno | Başlangıç el kartı (5-10) |

Ayarlar tüm odaya yansır, herkes anlık görür.

---

## 🚀 RENDER.COM'A NASIL YÜKLENİR (Adım Adım)

Hiç kod yazmadan, sadece tıklayarak yükleyeceksin. Tahmini süre: **15 dakika**.

### Adım 1: GitHub Hesabı Aç (varsa atla)

1. https://github.com/ adresine git
2. **Sign up** ile ücretsiz hesap aç

### Adım 2: Bu Projeyi GitHub'a Yükle

1. https://github.com/new adresine git
2. Repository name: `arkadaslarla-oynamalik` yaz
3. **Public** seç
4. **Create repository** tıkla
5. Açılan sayfada **uploading an existing file** linkine tıkla
6. Bilgisayarındaki `arkadaslarla-oynamalik` klasörünün **içindeki tüm dosyaları** seç ve sürükle-bırak yap
   - ⚠️ `node_modules` klasörü varsa onu YÜKLEME
7. En alttaki **Commit changes** butonuna tıkla

### Adım 3: Render.com Hesabı Aç

1. https://render.com adresine git
2. **Get Started** → GitHub ile giriş yap (en kolay yol)
3. GitHub'a erişim izni ver

### Adım 4: Yeni Web Service Oluştur

1. Render panelinde sağ üstte **+ New** → **Web Service** tıkla
2. **Build and deploy from a Git repository** seç → **Next**
3. Az önce oluşturduğun `arkadaslarla-oynamalik` repository'sini bul → **Connect**
4. Aşağıdaki ayarları yap:

   | Alan | Değer |
   |------|-------|
   | Name | `arkadaslarla-oynamalik` (veya istediğin) |
   | Region | `Frankfurt` (Türkiye'ye en yakını) |
   | Branch | `main` |
   | Runtime | `Node` |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Instance Type | **Free** |

5. En alttaki **Create Web Service** butonuna tıkla
6. 3-5 dakika bekle. "Live" yazısını görünce hazır!

### Adım 5: Sitene Gir ve Arkadaşlarınla Oyna

1. Render sayfanın üstündeki adresi kopyala (örn: `https://arkadaslarla-oynamalik.onrender.com`)
2. Tarayıcıda aç
3. Adını gir, **Oda Oluştur**'a tıkla
4. Oluşan 4 haneli kodu arkadaşlarına gönder
5. Onlar siteye girip o kodu yazınca yanına gelir
6. Bir oyun seç, **başla**!

---

## ⚠️ ÖNEMLİ: Render Ücretsiz Plan Uyarıları

- **Uyku modu:** 15 dakika kullanılmazsa sunucu uykuya geçer. İlk açan kişi 30-50 saniye beklemek zorunda kalır. Arkadaşlara "ilk gireceğin biraz bekle" demen yeterli.
- **Aylık 750 saat sınırı:** Tek site için bu süre fazlasıyla yetiyor.
- Daha iyi performans isterseniz aylık **$7'lık Starter plan**'a geçebilirsiniz (uyumayan, daha hızlı).

---

## 💻 Bilgisayarında Test Etmek İstersen (opsiyonel)

Sadece deneyip görmek için:

```bash
# 1. Node.js kur: https://nodejs.org (LTS versiyon)
# 2. Bu klasöre gir
cd arkadaslarla-oynamalik

# 3. Bağımlılıkları yükle
npm install

# 4. Çalıştır
npm start

# 5. Tarayıcıda aç
# http://localhost:3000
```

Arkadaşlarınla aynı evdeysen ve aynı WiFi'da olduğunuzda IP adresinle paylaşabilirsin ama farklı şehirlerdeyseniz Render.com şart.

---

## 📁 Proje Yapısı

```
arkadaslarla-oynamalik/
├── package.json          # Bağımlılıklar
├── render.yaml          # Render yapılandırması
├── server/
│   └── index.js         # Sunucu + oyun mantığı
└── public/
    ├── index.html       # Tüm ekranlar
    ├── css/
    │   └── style.css    # Tasarım
    └── js/
        └── app.js       # Frontend mantığı
```

---

## 🛠️ Sıkça Sorulanlar

**S: Kelime Zinciri'nde kelime ğ ile bittiğinde ne olur?**  
C: Türkçe'de ğ ile başlayan kelime olmadığı için, otomatik olarak bir önceki sesli harfe atlar. Örnek: "tebliğ" yazınca, sonraki kelimenin "i" harfi ile başlaması gerekir.

**S: Amiral Battı'da gemi nasıl yerleştirilir?**  
C: Mouse ile geminin başlangıç hücresine tıkla. Gemi otomatik yerleşir. **R tuşu** ile (veya "↻ Döndür" butonuyla) yatay/dikey çevirebilirsin. Yanlış yaparsan "⟲ Baştan Başla" tuşu var.

**S: Maksimum kaç kişi aynı odada oynayabilir?**  
C: 8 kişi. Lobi performansı için sınır koyduk.

**S: Vampir Köylü için kaç kişi lazım?**  
C: En az 4 kişi! 4-5 kişi: 1 vampir. 6-8 kişi: 2 vampir. Her oyunda 1 doktor + 1 dedektif var.

**S: Amiral Battı kaç kişilik?**  
C: Sadece 2 kişi oynar — odada daha fazla kişi varsa, ilk 2 oyuncu oynar, diğerleri izler.

**S: Yılan Savaşı'nda nasıl yön değiştiririm?**  
C: Bilgisayarda ok tuşları veya WASD. Mobilde ekran altındaki d-pad ile.

**S: Yeni oyun eklemek istersem?**  
C: Bana söyle. Listende olmayan oyunlar da eklenebilir.

**S: Oyun ortasında biri çıkarsa ne olur?**  
C: 2'den az kişi kalırsa oyun otomatik durur, herkes lobiye döner.

**S: Sayfa yenilenirse?**  
C: O kişinin oda bağlantısı kopar, tekrar kodla katılması gerekir.

**S: Render uyandıktan sonra ilk girene neden 30-50 sn bekletiyor?**  
C: Ücretsiz plan özelliği. **Keep-alive** ile çözebilirsin (aşağı bak).

---

## 🔄 Render Keep-Alive (15dk uyku engelleme)

Render ücretsiz plan 15dk hareketsizlikten sonra sunucuyu uyutur. 3 çözüm:

### Yöntem 1: Sunucu kendisine ping atar (kolay)
Render dashboard → Settings → **Environment** → env var ekle:
```
KEEP_ALIVE_URL = https://SENIN_UYGULAMA_ADIN.onrender.com/ping
```
Sunucu her 10 dakikada bir kendine HTTP GET atar → uyumaz.

### Yöntem 2: Harici cron (cron-job.org)
1. cron-job.org → ücretsiz hesap aç
2. Yeni cron: URL = `https://SENIN_UYGULAMA.onrender.com/ping`, interval = 10dk

### Yöntem 3: UptimeRobot
uptimerobot.com ücretsiz: 5dk aralıkla ping atar, hem uyku engeller hem uptime izler.

`/ping` endpoint döner:
```json
{ "ok": true, "uptime": 1234, "rooms": 3, "ts": 1730000000000 }
```

---

İyi eğlenceler! 🎉
