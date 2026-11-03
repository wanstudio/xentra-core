'use strict';

const PRIMARY_MAP = new Map([
  ['ayam', 'AYM'], ['sapi', 'SPI'], ['kambing', 'KBG'], ['bebek', 'BBK'],
  ['ikan', 'IKN'], ['gurame', 'GUR'], ['lele', 'LLE'], ['nila', 'NLA'],
  ['kakap', 'KKP'], ['tongkol', 'TGL'], ['tenggiri', 'TGR'], ['cumi', 'CMI'],
  ['udang', 'UDG'], ['kepiting', 'KPT'], ['teri', 'TRI'],
  ['tahu', 'TAH'], ['tempe', 'TMP'], ['telur', 'TLR'],
  ['kangkung', 'KGK'], ['bayam', 'BYM'], ['sawi', 'SWI'], ['kol', 'KOL'],
  ['terong', 'TRG'], ['timun', 'TMN'], ['tomat', 'TMT'], ['wortel', 'WTL'],
  ['kentang', 'KTG'], ['labu', 'LBU'], ['tauge', 'TGE'], ['toge', 'TGE'],
  ['buncis', 'BCS'], ['kacang', 'KCG'], ['jagung', 'JGG'], ['jamur', 'JMR'],
  ['bawang', 'BWG'], ['cabai', 'CBA'], ['cabe', 'CBA'],
  ['kunyit', 'KNY'], ['jahe', 'JHE'], ['lengkuas', 'LKS'], ['kencur', 'KNC'],
  ['ketumbar', 'KTM'], ['kemiri', 'KMR'], ['serai', 'SER'], ['sereh', 'SER'],
  ['pala', 'PLA'], ['merica', 'MRC'], ['lada', 'LDA'], ['terasi', 'TRS'],
  ['garam', 'GRM'], ['gula', 'GLA'], ['royco', 'RYC'], ['masako', 'MSK'],
  ['micin', 'MSG'], ['msg', 'MSG'], ['kecap', 'KCP'],
  ['beras', 'BRS'], ['tepung', 'TPG'], ['mie', 'MIE'], ['bihun', 'BHN'],
  ['minyak', 'MYK'], ['mentega', 'MTG'], ['margarin', 'MGR'], ['keju', 'KJU'],
  ['santan', 'STN'], ['susu', 'SSU'], ['kopi', 'KOP'], ['teh', 'TEH'],
  ['cokelat', 'CKL'], ['coklat', 'CKL'], ['milo', 'MLO'], ['matcha', 'MTC'],
  ['jeruk', 'JRK'], ['mangga', 'MGA'], ['alpukat', 'APK'], ['pisang', 'PSG'],
  ['stroberi', 'STB'], ['strawberry', 'STB'], ['pandan', 'PDN'], ['wijen', 'WJN'],
  ['roti', 'RTI'], ['singkong', 'SKG'], ['ubi', 'UBI'], ['vanili', 'VNL']
]);

function getMnemonicFallback(word) {
  if (!word) return 'MAT';
  const clean = String(word).toLowerCase().replace(/[^a-z]/g, '');
  if (clean.length === 0) return 'MAT';
  if (clean.length <= 3) return clean.toUpperCase().padEnd(3, 'X');

  const first = clean[0];
  const rest = clean.slice(1);
  const consonants = rest.replace(/[aeiou]/g, '');

  if (consonants.length >= 2) {
    return (first + consonants.slice(0, 2)).toUpperCase();
  } else if (consonants.length === 1) {
    const vowels = rest.replace(/[^aeiou]/g, '');
    return (first + consonants[0] + (vowels[0] || 'X')).toUpperCase();
  } else {
    return (first + rest.slice(0, 2)).toUpperCase();
  }
}

function generateMaterialPrefix(name) {
  if (!name || typeof name !== 'string') return 'MAT';

  const rawClean = name.trim().toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  let words = rawClean.split(/\s+/).filter(Boolean);
  if (!words.length) return 'MAT';

  // Check specific F&B compound phrases first
  if (words.includes('bawang')) {
    if (words.includes('merah')) return 'BWM';
    if (words.includes('putih')) return 'BWP';
    if (words.includes('bombay')) return 'BWB';
    if (words.includes('goreng')) return 'BWG';
    if (words.includes('daun')) return 'DBW';
    return 'BWG';
  }
  if (words.includes('cabai') || words.includes('cabe')) {
    if (words.includes('rawit')) return 'CBR';
    if (words.includes('keriting')) return 'CBK';
    if (words.includes('hijau')) return 'CBH';
    if (words.includes('merah')) return 'CBM';
    if (words.includes('bubuk')) return 'CBB';
    return 'CBA';
  }
  if (words.includes('daun')) {
    if (words.includes('jeruk')) return 'DJR';
    if (words.includes('salam')) return 'SLM';
    if (words.includes('kemangi')) return 'KMG';
    if (words.includes('pandan')) return 'DPD';
    if (words.includes('bawang')) return 'DBW';
    if (words.includes('pisang')) return 'DPS';
  }
  if (words.includes('es') && words.includes('batu')) return 'ESB';
  if (words.includes('saus') || words.includes('saos')) {
    if (words.includes('tiram')) return 'STR';
    if (words.includes('sambal')) return 'SOS';
    if (words.includes('tomat')) return 'SOT';
    if (words.includes('keju')) return 'SKJ';
    if (words.includes('teriyaki')) return 'STY';
    if (words.includes('barbeque') || words.includes('bbq')) return 'SBB';
    return 'SOS';
  }
  if (words.includes('susu')) {
    if (words.includes('kental') || words.includes('skm')) return 'SKM';
    if (words.includes('uht')) return 'SSU';
    if (words.includes('evaporasi')) return 'SEV';
    if (words.includes('bubuk')) return 'SBU';
  }
  if (words.includes('air')) {
    if (words.includes('mineral') || words.includes('botol')) return 'AMB';
    if (words.includes('soda')) return 'SDA';
    if (words.includes('kelapa')) return 'AKL';
    if (words.includes('masak') || words.includes('ro') || words.includes('bersih')) return 'AIR';
  }
  if (words.includes('minyak')) {
    if (words.includes('wijen')) return 'MWJ';
    if (words.includes('zaitun') || words.includes('olive')) return 'MZT';
    return 'MYK';
  }
  if (words.includes('gula')) {
    if (words.includes('aren') || words.includes('jawa')) return 'GLA';
    if (words.includes('merah')) return 'GLM';
    if (words.includes('batu')) return 'GLB';
    if (words.includes('halus')) return 'GLH';
    return 'GLA';
  }
  if (words.includes('tepung')) {
    if (words.includes('terigu')) return 'TPG';
    if (words.includes('beras')) return 'TPG';
    if (words.includes('tapioka') || words.includes('maizena')) return 'TPG';
    if (words.includes('roti') || words.includes('panir')) return 'TPR';
    return 'TPG';
  }
  if (words.includes('sirup') || words.includes('syrup')) {
    if (words.includes('merah') || words.includes('pandan') || words.includes('cocopandan')) return 'SRP';
    return 'SYR';
  }
  if (words.includes('powder')) return 'PDR';
  if (words.includes('kulit') && words.includes('pangsit')) return 'PNG';
  if (words.includes('dumpling')) return 'DMP';
  if (words.includes('kencur') && words.includes('beras')) return 'BKC';

  // Category prefixes to peel off: e.g. "Daging Ayam" -> "Ayam", "Sayur Kangkung" -> "Kangkung"
  const CATEGORY_PREFIXES = ['daging', 'sayur', 'sayuran', 'bumbu', 'bahan', 'ikan', 'buah', 'biji', 'daun', 'kulit'];
  const DESCRIPTOR_SUFFIXES = ['segar', 'mentah', 'halus', 'bubuk', 'kristal', 'papan', 'kotak', 'karkas', 'utuh', 'potong', 'kemasan', 'botol', 'cair', 'lembar', 'batang', 'fillet', 'kating', 'medan', 'dapur', 'sawit', 'plain', 'tube', 'ro', 'flavor', 'kuning', 'putih', 'merah', 'hijau', 'hitam', 'iris', 'giling', 'cincang'];

  if (CATEGORY_PREFIXES.includes(words[0]) && words.length > 1) {
    words = words.slice(1);
  }

  while (words.length > 1 && DESCRIPTOR_SUFFIXES.includes(words[words.length - 1])) {
    words.pop();
  }

  // Check PRIMARY_MAP for word 0
  if (PRIMARY_MAP.has(words[0])) {
    return PRIMARY_MAP.get(words[0]);
  }

  if (words.length === 1) {
    return getMnemonicFallback(words[0]);
  }

  // If 2 words left, e.g. "Wortel Impor" -> WTL, "Beras Merah" -> BRS
  if (PRIMARY_MAP.has(words[1])) {
    return PRIMARY_MAP.get(words[1]);
  }

  // Combined initials of first two words + consonant of word 2
  const w1 = words[0];
  const w2 = words[1];
  const c1 = w1[0] || 'M';
  const c2 = w2[0] || 'A';
  const c3 = (w2[1] && !/[aeiou]/.test(w2[1])) ? w2[1] : (w1[1] || w2[2] || 'T');
  return (c1 + c2 + c3).toUpperCase();
}

function generateMaterialCode(name, existingCodes = []) {
  const prefix = generateMaterialPrefix(name);
  const pattern = new RegExp(`^${prefix}-(\\d+)$`, 'i');
  let maxNum = 0;

  for (const item of existingCodes) {
    const rawCode = typeof item === 'string' ? item : item?.material_code || '';
    const match = String(rawCode).trim().match(pattern);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }

  const nextNum = maxNum + 1;
  const numStr = nextNum < 100 ? String(nextNum).padStart(2, '0') : String(nextNum);
  return `${prefix}-${numStr}`;
}

module.exports = {
  generateMaterialPrefix,
  generateMaterialCode
};
