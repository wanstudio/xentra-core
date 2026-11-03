'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { generateMaterialPrefix, generateMaterialCode } = require('../../domains/material/utils/materialCodeGenerator');

test('Material Code Generator: Prefix extraction', () => {
  // Indonesian compound ingredients
  assert.equal(generateMaterialPrefix('Bawang Merah'), 'BWM');
  assert.equal(generateMaterialPrefix('Bawang Putih Kating'), 'BWP');
  assert.equal(generateMaterialPrefix('Bawang Bombay'), 'BWB');
  assert.equal(generateMaterialPrefix('Bawang Goreng Crispy'), 'BWG');

  // Cabai variations
  assert.equal(generateMaterialPrefix('Cabai Rawit Merah'), 'CBR');
  assert.equal(generateMaterialPrefix('Cabai Rawit Hijau'), 'CBR');
  assert.equal(generateMaterialPrefix('Cabai Merah Keriting'), 'CBK');
  assert.equal(generateMaterialPrefix('Cabai Hijau Besar'), 'CBH');

  // Meats & Seafood with descriptor prefix
  assert.equal(generateMaterialPrefix('Daging Ayam Fillet'), 'AYM');
  assert.equal(generateMaterialPrefix('Daging Ayam Kampung Utuh'), 'AYM');
  assert.equal(generateMaterialPrefix('Daging Sapi Has Luar'), 'SPI');
  assert.equal(generateMaterialPrefix('Daging Bebek Ungkep'), 'BBK');
  assert.equal(generateMaterialPrefix('Ikan Lele Segar'), 'LLE');
  assert.equal(generateMaterialPrefix('Ikan Gurame Hidup'), 'GUR');
  assert.equal(generateMaterialPrefix('Udang Segar Kupas'), 'UDG');

  // Vegetables
  assert.equal(generateMaterialPrefix('Sayur Kangkung Segar'), 'KGK');
  assert.equal(generateMaterialPrefix('Bayam Hijau Segar'), 'BYM');
  assert.equal(generateMaterialPrefix('Tomat Merah Segar'), 'TMT');
  assert.equal(generateMaterialPrefix('Timun Segar Lalap'), 'TMN');
  assert.equal(generateMaterialPrefix('Wortel Lokal'), 'WTL');

  // Condiments, Sauces, Liquids
  assert.equal(generateMaterialPrefix('Garam Halus Dapur'), 'GRM');
  assert.equal(generateMaterialPrefix('Gula Pasir Kristal'), 'GLA');
  assert.equal(generateMaterialPrefix('Minyak Goreng Sawit'), 'MYK');
  assert.equal(generateMaterialPrefix('Minyak Wijen Halal'), 'MWJ');
  assert.equal(generateMaterialPrefix('Susu Kental Manis Putih'), 'SKM');
  assert.equal(generateMaterialPrefix('Susu UHT Full Cream'), 'SSU');
  assert.equal(generateMaterialPrefix('Saus Tiram'), 'STR');
  assert.equal(generateMaterialPrefix('Saos Sambal Botol'), 'SOS');
  assert.equal(generateMaterialPrefix('Kecap Manis Bango'), 'KCP');

  // Herbs & Leaves
  assert.equal(generateMaterialPrefix('Daun Jeruk Purut Lembar'), 'DJR');
  assert.equal(generateMaterialPrefix('Daun Salam Lembar'), 'SLM');
  assert.equal(generateMaterialPrefix('Daun Kemangi Segar'), 'KMG');
  assert.equal(generateMaterialPrefix('Daun Pandan Wangi'), 'DPD');
});

test('Material Code Generator: Sequential code generation and collision avoidance', () => {
  const existingCodes = [
    'AYM-01',
    'AYM-02',
    'BWM-01',
    'CBR-01',
    'CBR-02'
  ];

  assert.equal(generateMaterialCode('Daging Ayam Negeri', existingCodes), 'AYM-03');
  assert.equal(generateMaterialCode('Bawang Merah Brebes', existingCodes), 'BWM-02');
  assert.equal(generateMaterialCode('Cabai Rawit Setan', existingCodes), 'CBR-03');
  assert.equal(generateMaterialCode('Bawang Putih', existingCodes), 'BWP-01');
  assert.equal(generateMaterialCode('Wortel Lokal', existingCodes), 'WTL-01');
});
