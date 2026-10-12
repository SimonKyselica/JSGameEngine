import { assert } from '../core/assert';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
/** Largest payload of one stored (uncompressed) deflate block. */
const MAX_STORED_BLOCK = 0xffff;

const CRC_TABLE = createCrcTable();

/**
 * Encodes straight-alpha RGBA8 pixels (top row first) as a PNG file.
 *
 * The image data is stored without compression. That keeps the encoder tiny and free of
 * dependencies, which is all the engine needs for generated placeholder and test images.
 */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  assert(Number.isInteger(width) && width > 0, 'PNG width must be a positive integer');
  assert(Number.isInteger(height) && height > 0, 'PNG height must be a positive integer');
  assert(rgba.length === width * height * 4, 'PNG pixel data must be width * height * 4 bytes');

  // Each scanline is prefixed with a filter byte; 0 means "no filter".
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let row = 0; row < height; row++) {
    raw.set(rgba.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  }

  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 6; // color type: RGBA
  // compression, filter and interlace methods stay 0

  return concatBytes([
    Uint8Array.from(PNG_SIGNATURE),
    createChunk('IHDR', header),
    createChunk('IDAT', zlibStore(raw)),
    createChunk('IEND', new Uint8Array(0)),
  ]);
}

/** Reads the dimensions from a PNG file header. Returns `null` when the data is not a PNG. */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Wraps data in a zlib stream made of stored deflate blocks. */
function zlibStore(data: Uint8Array): Uint8Array {
  const blockCount = Math.max(1, Math.ceil(data.length / MAX_STORED_BLOCK));
  const result = new Uint8Array(2 + data.length + blockCount * 5 + 4);
  const view = new DataView(result.buffer);
  result[0] = 0x78; // deflate, 32K window
  result[1] = 0x01; // no preset dictionary, fastest compression level

  let offset = 2;
  for (let block = 0; block < blockCount; block++) {
    const start = block * MAX_STORED_BLOCK;
    const length = Math.min(MAX_STORED_BLOCK, data.length - start);
    result[offset++] = block === blockCount - 1 ? 1 : 0; // final-block flag, type "stored"
    view.setUint16(offset, length, true);
    view.setUint16(offset + 2, ~length & 0xffff, true);
    offset += 4;
    result.set(data.subarray(start, start + length), offset);
    offset += length;
  }
  view.setUint32(offset, adler32(data));
  return result;
}

function createChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index++) {
    chunk[4 + index] = type.charCodeAt(index);
  }
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

function createCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
