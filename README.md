# Bir Kelime Bir İşlem v5.1

## v5.1'de neler düzeltildi/eklendi?

**Düzeltmeler:**
- ✅ Ayar değiştirirken oda atma sorunu → Aktif select'ler korunuyor, kullanıcı yazarken bozulmuyor
- ✅ Animasyon her cevap girişinde tetikleniyordu → Sadece tur başlangıcında çalışıyor
- ✅ Hızlı mesaj butonlarındaki yazılar görünmüyordu → Tüm temalarda okunaklı
- ✅ Mod seçince mantıksız tur/süre seçilebiliyordu → Preset bazlı kısıtlamalar:
  - **Düello:** 3 tur sabit, süreler kilitli (30/45 sn)
  - **Hızlı:** En fazla 30 sn süre
  - **Maraton:** En az 7 tur

**Yeni Temalar (8 tema):**
- 🌙 Karanlık (varsayılan)
- ☀ Aydınlık
- 🟢 Retro
- 📜 Kâğıt
- 💜 **Neon** — Mor-pembe sentetik wave
- 🌲 **Orman** — Yeşil-toprak doğal
- 🌊 **Okyanus** — Mavi-turkuaz huzurlu
- 😈 **Trol** — Komik mesajlar! Cevap verdikçe ekrana "VAYY!", "EFSANE!", "EHEHE", "KAFAN İYİ Mİ?" gibi yazılar uçuşur

## Kurulum

Önceki versiyonların aynısı:

1. GitHub'da yeni public repo (örn. `kelime-islem-v5-1`)
2. ZIP içeriğini yükle (`server.js`, `package.json`, `README.md`, `public/`)
3. Render → New Web Service → repo seç
4. Build: `npm install`, Start: `npm start`, Free, Frankfurt
5. Deploy → 2-3 dakika

İstersen v5'in repo'sunda dosyaları güncelleyip aynı Render service'i kullanabilirsin (yeni URL'e gerek yok).

## Trol Tema Hakkında

Trol temasını seçtikten sonra oyna! Her cevap onayında ekranın rastgele bir yerinde:
- **İyi cevapta:** "VAYY!", "EFSANE!", "KRALSIN!", "TAMAM HOCAM!"
- **Yakın cevapta:** "HMMM", "BAKALIM", "DEVAM DEVAM"
- **Kötü cevapta:** "EHEHE", "KAFAN İYİ Mİ?", "GERÇEKTEN Mİ?", "KUSURA BAKMA"

Renkli, dönen yazılarla ekran "trol" oluyor 😈

## Preset Kısıtlama Detayı

| Preset | Tur | Kelime Süresi | İşlem Süresi | Notlar |
|--------|-----|---------------|--------------|--------|
| Normal | 3-20 | 20-90 sn | 25-120 sn | Tam serbest |
| Düello | 3 | 30 sn | 45 sn | Hepsi kilitli, max 2 oyuncu |
| Hızlı | 3-10 | 20-30 sn | 25-30 sn | Süre kısıtlı |
| Maraton | 7-20 | 20-90 sn | 25-120 sn | Min 7 tur |
