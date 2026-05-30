// Şehir Yarışı — 40 kareli Türkiye şehirleri tahtası
// type: 'go' | 'property' | 'airport' | 'utility' | 'tax' | 'chance' | 'cc' | 'jail' | 'parking' | 'goToJail'

const BOARD = [
  { idx: 0,  type: 'go',       name: 'Başlangıç' },
  { idx: 1,  type: 'property', name: 'Hakkari',     color: 'brown',  price: 60,  rent: [2, 4, 10, 30, 90, 160, 250],     houseCost: 50 },
  { idx: 2,  type: 'cc',       name: 'Toplum Sandığı' },
  { idx: 3,  type: 'property', name: 'Şırnak',      color: 'brown',  price: 60,  rent: [4, 8, 20, 60, 180, 320, 450],    houseCost: 50 },
  { idx: 4,  type: 'tax',      name: 'Gelir Vergisi', amount: 200 },
  { idx: 5,  type: 'airport',  name: 'Atatürk Havalimanı', price: 200 },
  { idx: 6,  type: 'property', name: 'Kars',        color: 'lblue',  price: 100, rent: [6, 12, 30, 90, 270, 400, 550],   houseCost: 50 },
  { idx: 7,  type: 'chance',   name: 'Şans' },
  { idx: 8,  type: 'property', name: 'Ardahan',     color: 'lblue',  price: 100, rent: [6, 12, 30, 90, 270, 400, 550],   houseCost: 50 },
  { idx: 9,  type: 'property', name: 'Iğdır',       color: 'lblue',  price: 120, rent: [8, 16, 40, 100, 300, 450, 600],  houseCost: 50 },
  { idx: 10, type: 'jail',     name: 'Hapishane / Ziyaret' },
  { idx: 11, type: 'property', name: 'Sinop',       color: 'pink',   price: 140, rent: [10, 20, 50, 150, 450, 625, 750], houseCost: 100 },
  { idx: 12, type: 'utility',  name: 'Elektrik İdaresi', price: 150 },
  { idx: 13, type: 'property', name: 'Bartın',      color: 'pink',   price: 140, rent: [10, 20, 50, 150, 450, 625, 750], houseCost: 100 },
  { idx: 14, type: 'property', name: 'Düzce',       color: 'pink',   price: 160, rent: [12, 24, 60, 180, 500, 700, 900], houseCost: 100 },
  { idx: 15, type: 'airport',  name: 'Esenboğa Havalimanı', price: 200 },
  { idx: 16, type: 'property', name: 'Kütahya',     color: 'orange', price: 180, rent: [14, 28, 70, 200, 550, 750, 950], houseCost: 100 },
  { idx: 17, type: 'cc',       name: 'Toplum Sandığı' },
  { idx: 18, type: 'property', name: 'Uşak',        color: 'orange', price: 180, rent: [14, 28, 70, 200, 550, 750, 950], houseCost: 100 },
  { idx: 19, type: 'property', name: 'Manisa',      color: 'orange', price: 200, rent: [16, 32, 80, 220, 600, 800, 1000],houseCost: 100 },
  { idx: 20, type: 'parking',  name: 'Ücretsiz Park' },
  { idx: 21, type: 'property', name: 'Eskişehir',   color: 'red',    price: 220, rent: [18, 36, 90, 250, 700, 875, 1050],houseCost: 150 },
  { idx: 22, type: 'chance',   name: 'Şans' },
  { idx: 23, type: 'property', name: 'Konya',       color: 'red',    price: 220, rent: [18, 36, 90, 250, 700, 875, 1050],houseCost: 150 },
  { idx: 24, type: 'property', name: 'Kayseri',     color: 'red',    price: 240, rent: [20, 40, 100, 300, 750, 925, 1100],houseCost: 150 },
  { idx: 25, type: 'airport',  name: 'A. Menderes Havalimanı', price: 200 },
  { idx: 26, type: 'property', name: 'Bursa',       color: 'yellow', price: 260, rent: [22, 44, 110, 330, 800, 975, 1150],houseCost: 150 },
  { idx: 27, type: 'property', name: 'Antalya',     color: 'yellow', price: 260, rent: [22, 44, 110, 330, 800, 975, 1150],houseCost: 150 },
  { idx: 28, type: 'utility',  name: 'Su İdaresi', price: 150 },
  { idx: 29, type: 'property', name: 'Adana',       color: 'yellow', price: 280, rent: [24, 48, 120, 360, 850, 1025, 1200],houseCost: 150 },
  { idx: 30, type: 'goToJail', name: 'Hapse Git!' },
  { idx: 31, type: 'property', name: 'İzmir',       color: 'green',  price: 300, rent: [26, 52, 130, 390, 900, 1100, 1275],houseCost: 200 },
  { idx: 32, type: 'property', name: 'Ankara',      color: 'green',  price: 300, rent: [26, 52, 130, 390, 900, 1100, 1275],houseCost: 200 },
  { idx: 33, type: 'cc',       name: 'Toplum Sandığı' },
  { idx: 34, type: 'property', name: 'Trabzon',     color: 'green',  price: 320, rent: [28, 56, 150, 450, 1000, 1200, 1400],houseCost: 200 },
  { idx: 35, type: 'airport',  name: 'Sabiha Gökçen Havalimanı', price: 200 },
  { idx: 36, type: 'chance',   name: 'Şans' },
  { idx: 37, type: 'property', name: 'Gümüşhane',   color: 'dblue',  price: 350, rent: [35, 70, 175, 500, 1100, 1300, 1500],houseCost: 200 },
  { idx: 38, type: 'tax',      name: 'Lüks Vergisi', amount: 100 },
  { idx: 39, type: 'property', name: 'İstanbul',    color: 'dblue',  price: 400, rent: [50, 100, 200, 600, 1400, 1700, 2000],houseCost: 200 }
];

const COLOR_GROUPS = {};
BOARD.forEach(sq => {
  if (sq.type === 'property') {
    if (!COLOR_GROUPS[sq.color]) COLOR_GROUPS[sq.color] = [];
    COLOR_GROUPS[sq.color].push(sq.idx);
  }
});

const AIRPORT_INDEXES = BOARD.filter(s => s.type === 'airport').map(s => s.idx);
const UTILITY_INDEXES = BOARD.filter(s => s.type === 'utility').map(s => s.idx);

// Havaalanı kirası: sahip olunan havaalanı sayısına göre
const AIRPORT_RENT = [0, 25, 50, 100, 200];
// Hizmet çarpanı: 1 hizmet → 4× zar, 2 hizmet → 10× zar
const UTILITY_MULT = [0, 4, 10];

module.exports = { BOARD, COLOR_GROUPS, AIRPORT_INDEXES, UTILITY_INDEXES, AIRPORT_RENT, UTILITY_MULT };
