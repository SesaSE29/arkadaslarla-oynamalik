// Şans + Toplum Sandığı kartları (Türkçe, özgün metin)
// Efekt tipleri:
//   move:        { type:'move', to: <idx>, collectGo: bool }
//   moveBy:      { type:'moveBy', n: <int> }
//   moveNearest: { type:'moveNearest', kind:'airport'|'utility', rentMult }
//   pay:         { type:'pay', amount: <int>, toBank: bool }
//   collect:     { type:'collect', amount: <int>, fromBank: bool }
//   payAll:      { type:'payAll', amount: <int> }
//   collectAll:  { type:'collectAll', amount: <int> }
//   jail:        { type:'jail' }
//   getOutFree:  { type:'getOutFree' }
//   payPerProp:  { type:'payPerProp', perHouse, perHotel }

const CHANCE = [
  { text: 'Başlangıç noktasına geri dön. 200₺ kazandın.', effect: { type: 'move', to: 0, collectGo: true } },
  { text: 'İzmir\'e iş seyahati! Yoldan geçtiğinde 200₺ al.', effect: { type: 'move', to: 31, collectGo: true } },
  { text: 'Konya yolculuğu. Vardığında pozisyona göre işlem yap.', effect: { type: 'move', to: 23, collectGo: true } },
  { text: 'Bagajın kayboldu! Üç kare geri git.', effect: { type: 'moveBy', n: -3 } },
  { text: 'Uçuş gecikmesi. En yakın havaalanına git, sahibine 2× kira öde.', effect: { type: 'moveNearest', kind: 'airport', rentMult: 2 } },
  { text: 'En yakın hizmet idaresine git. Sahibine zarın 10 katı öde.', effect: { type: 'moveNearest', kind: 'utility', rentMult: 10 } },
  { text: 'Belediye teşvikinden 50₺ kazandın.', effect: { type: 'collect', amount: 50, fromBank: true } },
  { text: 'Bu kartı sakla — hapisten bedavaya çıkış.', effect: { type: 'getOutFree' } },
  { text: 'Hız cezası! Doğruca hapse, Başlangıç\'tan geçmiyorsun.', effect: { type: 'jail' } },
  { text: 'Tüm mülklerin onarımı: her ev için 25₺, her otel için 100₺ öde.', effect: { type: 'payPerProp', perHouse: 25, perHotel: 100 } },
  { text: 'Tahvil faizinden 150₺ kazandın.', effect: { type: 'collect', amount: 150, fromBank: true } },
  { text: 'Vergi iadesi: 20₺ aldın.', effect: { type: 'collect', amount: 20, fromBank: true } },
  { text: 'İstanbul\'a uçuş hediye edildi. Yoldan 200₺ varsa al.', effect: { type: 'move', to: 39, collectGo: false } },
  { text: 'Trafik cezası: 15₺ öde.', effect: { type: 'pay', amount: 15, toBank: true } },
  { text: 'Doğum günün! Her oyuncudan 20₺ topla.', effect: { type: 'collectAll', amount: 20 } },
  { text: 'Atatürk Havalimanı\'na transfer. Yoldan 200₺ varsa al.', effect: { type: 'move', to: 5, collectGo: true } }
];

const COMMUNITY_CHEST = [
  { text: 'Başlangıç\'a dön, 200₺ al.', effect: { type: 'move', to: 0, collectGo: true } },
  { text: 'Banka hesap hatası buldu, sana 200₺ ödedi.', effect: { type: 'collect', amount: 200, fromBank: true } },
  { text: 'Doktora gidip 50₺ ödedin.', effect: { type: 'pay', amount: 50, toBank: true } },
  { text: 'Hapisten çıkış kartı — sakla.', effect: { type: 'getOutFree' } },
  { text: 'Hapse gönderildin. Başlangıç\'tan geçmiyorsun.', effect: { type: 'jail' } },
  { text: 'Düğüne davetlisin. Her oyuncudan 10₺ al.', effect: { type: 'collectAll', amount: 10 } },
  { text: 'Sigorta tazminatı: 100₺ aldın.', effect: { type: 'collect', amount: 100, fromBank: true } },
  { text: 'Vergi iadesi: 20₺ kazandın.', effect: { type: 'collect', amount: 20, fromBank: true } },
  { text: 'Devlet tahvili olgunlaştı: 100₺.', effect: { type: 'collect', amount: 100, fromBank: true } },
  { text: 'Hastane masrafı: 100₺ öde.', effect: { type: 'pay', amount: 100, toBank: true } },
  { text: 'Okul aidatı: 50₺ öde.', effect: { type: 'pay', amount: 50, toBank: true } },
  { text: 'Danışmanlık ücreti aldın: 25₺.', effect: { type: 'collect', amount: 25, fromBank: true } },
  { text: 'Mülk tadilatı: her ev için 40₺, her otel için 115₺ öde.', effect: { type: 'payPerProp', perHouse: 40, perHotel: 115 } },
  { text: 'Yarışmada ikinci oldun: 10₺ kazandın.', effect: { type: 'collect', amount: 10, fromBank: true } },
  { text: 'Miras kaldı! 100₺ kazandın.', effect: { type: 'collect', amount: 100, fromBank: true } },
  { text: 'Mahkeme masrafı: her oyuncuya 50₺ öde.', effect: { type: 'payAll', amount: 50 } }
];

module.exports = { CHANCE, COMMUNITY_CHEST };
