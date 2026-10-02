// Plan v2 — besin tablosu, öğün şablonları, hedefler ve kurallar.
// Öğün değerleri elle yazılmaz; aşağıdaki 100 g tablosundan hesaplanır.

// 100 g başına: [kcal, protein, karbonhidrat, yağ, lif]
export const FOODS = {
  yumurta:     { ad: 'Haşlanmış yumurta',            v: [143, 12.6, 0.7, 9.5, 0] },
  peynir:      { ad: 'Az yağlı beyaz peynir',        v: [170, 18, 1, 10.5, 0] },
  salata:      { ad: 'Salatalık, domates, yeşillik', v: [18, 1, 3, 0.2, 1.2] },
  zeytin:      { ad: 'Zeytin',                        v: [145, 1, 1, 15, 3] },
  ekmek:       { ad: 'Tam buğday / çavdar ekmeği',   v: [215, 8, 38, 2, 7.5] },
  zeytinyagi:  { ad: 'Zeytinyağı',                    v: [884, 0, 0, 100, 0] },
  patates:     { ad: 'Haşlanmış patates (soğutulmuş)', v: [77, 2, 17, 0.1, 1.8] },
  ton:         { ad: 'Ton balığı (kendi suyunda, süzülmüş)', v: [110, 25, 0, 1, 0] },
  skyr:        { ad: 'Sade skyr',                     v: [63, 11, 4, 0.2, 0] },
  musli:       { ad: 'Basis müsli (şekersiz)',        v: [360, 11, 60, 6.5, 9] },
  soya:        { ad: 'Soya gevreği',                  v: [400, 40, 6, 20, 16] },
  muz:         { ad: 'Muz',                           v: [89, 1.1, 20, 0.3, 2.6] },
  berry:       { ad: 'Orman meyvesi',                 v: [45, 0.9, 7.5, 0.4, 4] },
  seftali:     { ad: 'Şeftali (veya 1 avuç kiraz/üzüm)', v: [41, 0.9, 9, 0.1, 1.5] },
  ceviz:       { ad: 'Ceviz içi',                     v: [670, 15, 7, 65, 6.5] },
  knacke:      { ad: 'Knäckebrot',                    v: [340, 10, 62, 2, 15] },
  humus:       { ad: 'Humus',                         v: [260, 7, 12, 19, 5] },
  cigsebze:    { ad: 'Çiğ sebze (biber, havuç, salatalık)', v: [28, 1, 5, 0.2, 2] },
  kefir:       { ad: 'Kefir / sade ayran',            v: [50, 3.4, 4, 1.5, 0] },
  badem:       { ad: 'Çiğ badem / fındık',            v: [600, 21, 6, 53, 12] },
  cottage:     { ad: 'Körniger Frischkäse (cottage)', v: [98, 12.5, 2.5, 4.3, 0] },
  tavuk:       { ad: 'Tavuk göğsü (çiğ ağırlık)',     v: [110, 23, 0, 1.5, 0] },
  kiyma:       { ad: 'Yağsız kıyma, en çok %10 yağ (çiğ)', v: [170, 20, 0, 10, 0] },
  et:          { ad: 'Yağsız kırmızı et (çiğ ağırlık)', v: [135, 21.5, 0, 5, 0] },
  somon:       { ad: 'Somon (çiğ ağırlık)',           v: [200, 20, 0, 13.5, 0] },
  firinsebze:  { ad: 'Fırın sebze (dondurulmuş karışım olur)', v: [35, 2.2, 5, 0.4, 2.8] },
  bulgur:      { ad: 'Pişmiş bulgur',                 v: [83, 3.1, 18.6, 0.2, 4.5] },
  mercimek:    { ad: 'Pişmiş yeşil mercimek / nohut', v: [116, 9, 20, 0.4, 8] },
};

// [besin, gram, isteğe bağlı ev ölçüsü]
const T = [
  // Öğle
  { id: 'L-A', slot: 'ogle', ad: 'Yumurta–peynir tabağı',
    ic: [['yumurta', 106, '2 adet'], ['peynir', 60], ['salata', 350, 'büyük kâse'], ['zeytin', 20, '5 adet'], ['ekmek', 45, '1 dilim'], ['zeytinyagi', 5, '1 tatlı kaşığı']] },
  { id: 'L-B', slot: 'ogle', ad: 'Patatesli salata (ekmeksiz)',
    ic: [['yumurta', 106, '2 adet'], ['peynir', 60], ['salata', 350, 'büyük kâse'], ['zeytin', 20, '5 adet'], ['patates', 150, '1 orta boy'], ['zeytinyagi', 5, '1 tatlı kaşığı']] },
  { id: 'L-C', slot: 'ogle', ad: 'Ton balıklı salata',
    ic: [['ton', 130, '1 kutu'], ['yumurta', 53, '1 adet'], ['salata', 350, 'büyük kâse'], ['zeytin', 20, '5 adet'], ['ekmek', 45, '1 dilim'], ['zeytinyagi', 5, '1 tatlı kaşığı']] },
  { id: 'L-D', slot: 'ogle', ad: 'Sebzeli omlet',
    ic: [['yumurta', 159, '3 adet'], ['peynir', 30], ['salata', 250], ['ekmek', 45, '1 dilim'], ['zeytinyagi', 5, '1 tatlı kaşığı']] },
  // 1. ara öğün
  { id: 'S1-A', slot: 'ara1', ad: 'Skyr kâsesi, orman meyveli',
    ic: [['skyr', 250], ['musli', 30, '3 yemek kaşığı'], ['soya', 10, '1 yemek kaşığı'], ['berry', 80, '1 avuç']] },
  { id: 'S1-B', slot: 'ara1', ad: 'Skyr kâsesi, muzlu',
    ic: [['skyr', 250], ['musli', 30, '3 yemek kaşığı'], ['soya', 10, '1 yemek kaşığı'], ['muz', 60, 'yarım']] },
  { id: 'S1-C', slot: 'ara1', ad: 'Skyr kâsesi, şeftalili',
    ic: [['skyr', 250], ['musli', 30, '3 yemek kaşığı'], ['soya', 10, '1 yemek kaşığı'], ['seftali', 150, '1 adet']] },
  // 2. ara öğün
  { id: 'S2-A', slot: 'ara2', ad: 'Ceviz ve meyve',
    ic: [['ceviz', 20, '5 adet'], ['seftali', 150, '1 porsiyon']] },
  { id: 'S2-B', slot: 'ara2', ad: 'Knäckebrot ve humus',
    ic: [['knacke', 20, '2 adet'], ['humus', 30, '2 yemek kaşığı'], ['cigsebze', 100]] },
  { id: 'S2-C', slot: 'ara2', ad: 'Kefir ve badem',
    ic: [['kefir', 200, '1 bardak'], ['badem', 15, '12 adet']] },
  { id: 'S2-D', slot: 'ara2', ad: 'Cottage ve çiğ sebze',
    ic: [['cottage', 150], ['cigsebze', 100]] },
  // Akşam
  { id: 'D-A', slot: 'aksam', ad: 'Tavuk ve fırın sebze',
    ic: [['tavuk', 200], ['firinsebze', 350], ['bulgur', 100, '4 yemek kaşığı'], ['zeytinyagi', 10, '2 tatlı kaşığı']] },
  { id: 'D-B', slot: 'aksam', ad: 'Köfte ve salata',
    ic: [['kiyma', 180], ['salata', 350, 'büyük kâse'], ['bulgur', 100, '4 yemek kaşığı'], ['zeytinyagi', 5, '1 tatlı kaşığı']] },
  { id: 'D-C', slot: 'aksam', ad: 'Kırmızı et ve fırın sebze',
    ic: [['et', 200], ['firinsebze', 350], ['zeytinyagi', 10, '2 tatlı kaşığı']] },
  { id: 'D-D', slot: 'aksam', ad: 'Somon ve fırın sebze',
    ic: [['somon', 150], ['firinsebze', 350], ['bulgur', 100, '4 yemek kaşığı'], ['zeytinyagi', 5, '1 tatlı kaşığı']] },
  { id: 'D-E', slot: 'aksam', ad: 'Mercimek ve tavuk',
    ic: [['mercimek', 250], ['tavuk', 100], ['salata', 250], ['zeytinyagi', 5, '1 tatlı kaşığı']] },
  // Gece (yalnızca çok açsan ya da protein eksikse)
  { id: 'N-A', slot: 'gece', ad: 'Sade skyr',
    ic: [['skyr', 150]] },
  // Antrenman günü ekleri
  { id: 'T-A', slot: 'ant', ad: 'Antrenman öncesi muz',
    ic: [['muz', 120, '1 adet']] },
  { id: 'T-B', slot: 'ant', ad: 'Antrenman sonrası skyr',
    ic: [['skyr', 150]] },
];

const r1 = (x) => Math.round(x * 10) / 10;

export function macros(ic) {
  const s = [0, 0, 0, 0, 0];
  for (const [k, g] of ic) FOODS[k].v.forEach((v, i) => { s[i] += (v * g) / 100; });
  return { kcal: Math.round(s[0]), p: r1(s[1]), c: r1(s[2]), f: r1(s[3]), fib: r1(s[4]) };
}

export const MEALS = T.map((t) => ({
  ...t,
  ...macros(t.ic),
  items: t.ic.map(([k, g, olcu]) => ({
    n: FOODS[k].ad, g, olcu: olcu || '',
    kcal: Math.round((FOODS[k].v[0] * g) / 100),
    p: r1((FOODS[k].v[1] * g) / 100),
  })),
}));

export const MEAL_BY_ID = Object.fromEntries(MEALS.map((m) => [m.id, m]));

export const SLOTS = [
  { id: 'ogle', ad: 'Öğle', saat: '12:00' },
  { id: 'ara1', ad: '1. ara öğün', saat: '14:30' },
  { id: 'ara2', ad: '2. ara öğün', saat: '16:00' },
  { id: 'aksam', ad: 'Akşam', saat: '18:00' },
  { id: 'gece', ad: 'Saat 20:00 sonrası', saat: '20:00' },
];
export const SLOT_AD = {
  sabah: 'Sabah', ogle: 'Öğle', ara1: '1. ara öğün', ara2: '2. ara öğün',
  aksam: 'Akşam', gece: 'Gece', ant: 'Antrenman',
};

export function slotByTime(d) {
  const h = d.getHours() + d.getMinutes() / 60;
  if (h < 10.5) return 'sabah';
  if (h < 13.75) return 'ogle';
  if (h < 15.5) return 'ara1';
  if (h < 17.25) return 'ara2';
  if (h < 20) return 'aksam';
  return 'gece';
}

// Haftalık esnek bütçe için tek dokunuşluk kalemler
export const FLEX = [
  { id: 'F-BIRA33', ad: 'Bira 0,33 l', kcal: 140, p: 1, c: 11, f: 0, fib: 0, flags: ['alkol'] },
  { id: 'F-BIRA50', ad: 'Bira 0,5 l', kcal: 215, p: 2, c: 17, f: 0, fib: 0, flags: ['alkol'] },
];

export const DEFAULTS = {
  startDate: '2026-10-05',
  startKg: 86,
  targetDate: '2026-12-31',
  targetKg: 78,
  kcalRest: 1550,
  kcalTrain: 1750,
  protein: 135,
  proteinMin: 120,
  fiber: 30,
  steps: 8000,
  water: 2500,
  model: 'claude-haiku-4-5-20251001',
};

export const RULES = {
  hergun: [
    'Günde en az 2–2,5 litre su.',
    'Günde 8.000 adım. Masa başında açığın en ucuz kısmı bu.',
    'Et, tavuk ve balık çiğ ağırlıkla tartılır.',
    'Pişirme ve salata yağı ölçülür: 1 tatlı kaşığı zeytinyağı yaklaşık 45 kcal.',
    'Kuruyemiş çiğ ve tuzsuz, 20–25 g ve tartılarak. Ceviz, badem, fındık, fıstık aynı kurala tabi.',
    'Meyve günde 2 porsiyon. Belirleyici olan toplam kalori, meyvenin kendisi değil.',
    'Patatesi salataya eklersen o gün ekmek yok. Haşlayıp soğutulmuş patates daha uzun tok tutar.',
    'Saat 20:00 sonrası bitki çayı. Çok açsan ya da protein eksikse 150 g sade skyr.',
  ],
  haftalik: [
    '1 esnek akşam yemeği (dışarıda ya da plan dışı), 700 kcal civarı.',
    '1 bira (0,33 l) veya 200 kcal’e kadar 1 küçük tatlı. Yanında cips, fıstık, kızartma yok.',
  ],
  yok: [
    'Şekerli içecek: kola, gazoz, meyve suyu.',
    'Yağda kızartma, patates kızartması.',
    'Cips ve tuzlu, kavrulmuş kuruyemiş.',
    'Hamur işi: simit, poğaça, börek, kruvasan, bretzel.',
    'Beyaz ekmek, tost ekmeği, lavaş.',
  ],
  spor: [
    'Haftada 3 antrenman: spinning veya kettlebell (swing, halo) ve karın.',
    'En az 2 gün kettlebell sabit. Açıkta kası koruyan şey direnç antrenmanı.',
    'Antrenman günü 1.750 kcal: öncesinde 1 muz, sonrasında 150 g skyr eklenir.',
  ],
  surec: [
    'Her sabah aynı koşulda tartıl. Tek günlük sayıya değil 7 günlük ortalamaya bak.',
    'Ortalama iki hafta üst üste çizginin 0,7 kg üstündeyse: 100 kcal düş ya da 2.000 adım ekle.',
    '1.500 kcal’in altına inme.',
    '78 kg’a varınca kalori 2–3 haftada kademeli olarak koruma düzeyine çıkar.',
  ],
  rotasyon: [
    ['Pazartesi', 'Tavuk ve fırın sebze'],
    ['Salı', 'Somon ve fırın sebze'],
    ['Çarşamba', 'Mercimek ve tavuk'],
    ['Perşembe', 'Köfte ve salata'],
    ['Cuma', 'Kırmızı et ve fırın sebze'],
    ['Cumartesi', 'Somon ya da esnek öğün'],
    ['Pazar', 'Mercimek ve tavuk'],
  ],
};

// ——— Tarih ve hedef çizgisi yardımcıları ———
export const dayKey = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};
export const parseDay = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
};
export const addDays = (s, n) => {
  const d = parseDay(s);
  d.setDate(d.getDate() + n);
  return dayKey(d);
};
export const diffDays = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000);

// Hedef çizgisinin o gündeki değeri (başlangıçtan önce başlangıç, sondan sonra hedef)
export function targetAt(day, s) {
  const total = diffDays(s.startDate, s.targetDate);
  const t = Math.min(Math.max(diffDays(s.startDate, day), 0), total);
  return s.startKg + ((s.targetKg - s.startKg) * t) / total;
}

// Kısa plan özeti: analiz isteğine eklenir (token tasarrufu için tek satır/öğün)
const KISA = {
  yumurta: 'yumurta', peynir: 'beyaz peynir', salata: 'salata', zeytin: 'zeytin', ekmek: 'tam buğday ekmek',
  zeytinyagi: 'zeytinyağı', patates: 'haşlanmış patates', ton: 'ton balığı', skyr: 'skyr', musli: 'müsli',
  soya: 'soya gevreği', muz: 'muz', berry: 'berry', seftali: 'şeftali', ceviz: 'ceviz', knacke: 'knäckebrot',
  humus: 'humus', cigsebze: 'çiğ sebze', kefir: 'kefir/ayran', badem: 'badem', cottage: 'cottage',
  tavuk: 'tavuk göğsü', kiyma: 'köfte', et: 'kırmızı et', somon: 'somon', firinsebze: 'fırın sebze',
  bulgur: 'bulgur', mercimek: 'mercimek',
};
export function planDigest() {
  return MEALS.map((m) => `${m.id}: ${m.ic.map(([k, g]) => `${KISA[k]} ${g}g`).join(', ')} = ${m.kcal} kcal, ${Math.round(m.p)}p`).join('\n');
}
