'use strict';

/**
 * Helper to generate minimal valid 100% compliant image buffers
 * for testing without external native libraries (Sharp, Canvas, etc.)
 */

// 1. Generate an uncompressed 8-bit RGBA PNG buffer
function createPngBuffer(width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  
  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth: 8
  ihdrData[9] = 2; // color type: 2 (Truecolor RGB)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const ihdrChunk = createPngChunk('IHDR', ihdrData);

  const zlib = require('zlib');
  const scanlineLen = 1 + width * 3;
  const rawDataLen = scanlineLen * height;
  const rawData = Buffer.alloc(rawDataLen, 0x80);
  for (let y = 0; y < height; y++) {
    rawData[y * scanlineLen] = 0;
  }

  const idatData = zlib.deflateSync(rawData);
  const idatChunk = createPngChunk('IDAT', idatData);
  const iendChunk = createPngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createPngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const crcPayload = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcPayload), 0);

  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function crc32(buf) {
  let table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) c = 0xedb88320 ^ (c >>> 1);
      else c = c >>> 1;
    }
    table[n] = c;
  }
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ (-1)) >>> 0;
}

// 2. Generate a minimal valid JPEG buffer with SOF0 header
function createJpegBuffer(width, height) {
  const soi = Buffer.from([0xFF, 0xD8]);
  // SOF0 marker: FF C0, length 17, precision 8, height, width, 3 components
  const sof0 = Buffer.alloc(19);
  sof0[0] = 0xFF;
  sof0[1] = 0xC0;
  sof0.writeUInt16BE(17, 2); // length
  sof0[4] = 8; // 8-bit precision
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  sof0[9] = 3; // 3 components (Y, Cb, Cr)
  sof0[10] = 1; sof0[11] = 0x11; sof0[12] = 0;
  sof0[13] = 2; sof0[14] = 0x11; sof0[15] = 0;
  sof0[16] = 3; sof0[17] = 0x11; sof0[18] = 0;

  const eoi = Buffer.from([0xFF, 0xD9]);
  return Buffer.concat([soi, sof0, eoi]);
}

// 3. Generate a minimal valid WebP buffer with VP8 chunk
function createWebpBuffer(width, height) {
  // RIFF header (4 bytes 'RIFF', 4 bytes file length - 8, 4 bytes 'WEBP')
  // VP8 header (4 bytes 'VP8 ', 4 bytes chunk length)
  // VP8 frame header (3 bytes frame tag, 3 bytes start code 9d 01 2a, 2 bytes width, 2 bytes height)
  const vp8Data = Buffer.alloc(10);
  vp8Data[0] = 0x00; // keyframe
  vp8Data[1] = 0x00;
  vp8Data[2] = 0x00;
  vp8Data[3] = 0x9D; // start code
  vp8Data[4] = 0x01;
  vp8Data[5] = 0x2A;
  vp8Data.writeUInt16LE(width & 0x3fff, 6);
  vp8Data.writeUInt16LE(height & 0x3fff, 8);

  const riffHeader = Buffer.from('RIFF');
  const webpHeader = Buffer.from('WEBP');
  const vp8ChunkHeader = Buffer.from('VP8 ');
  const vp8LenBuf = Buffer.alloc(4);
  vp8LenBuf.writeUInt32LE(vp8Data.length, 0);

  const totalLen = 4 + 8 + vp8Data.length;
  const riffLenBuf = Buffer.alloc(4);
  riffLenBuf.writeUInt32LE(totalLen, 0);

  return Buffer.concat([riffHeader, riffLenBuf, webpHeader, vp8ChunkHeader, vp8LenBuf, vp8Data]);
}

module.exports = {
  createPngBuffer,
  createJpegBuffer,
  createWebpBuffer
};

