import { deflateSync } from 'node:zlib';

// Keep the measurement fixture generated in memory so no image body is
// checked into the repository or written to a test report. The isolated
// square is deliberately large enough for both the deterministic fallback
// detector and the OpenCV Worker smoke path.
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (bytes) => {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};

const pngChunk = (type, payload) => {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, payload])), 0);
  return Buffer.concat([length, typeBytes, payload, checksum]);
};

export const makeMeasurementFixturePng = () => {
  const width = 400;
  const height = 400;
  const markerLeft = 240;
  const markerTop = 240;
  const markerSize = 80;
  const border = 8;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4;
      const inMarker = x >= markerLeft && x < markerLeft + markerSize && y >= markerTop && y < markerTop + markerSize;
      const inBorder = inMarker && (x - markerLeft < border || markerLeft + markerSize - 1 - x < border || y - markerTop < border || markerTop + markerSize - 1 - y < border);
      raw[offset] = inBorder ? 0 : 250;
      raw[offset + 1] = inBorder ? 0 : 250;
      raw[offset + 2] = inBorder ? 0 : 250;
      raw[offset + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};
