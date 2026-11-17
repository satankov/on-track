import { crc32 } from "node:zlib";

import {
  MAX_PICTURE_PREVIEW_BYTES,
  MAX_PICTURE_PREVIEW_PIXELS,
  picturePreviewMediaType,
  type PicturePreviewMediaType,
} from "../../domain/picture-preview.js";

function validDimensions(width: number, height: number): boolean {
  return (
    width > 0 && height > 0 && width * height <= MAX_PICTURE_PREVIEW_PIXELS
  );
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_DEPTHS: ReadonlyMap<number, readonly number[]> = new Map([
  [0, [1, 2, 4, 8, 16]],
  [2, [8, 16]],
  [3, [1, 2, 4, 8]],
  [4, [8, 16]],
  [6, [8, 16]],
]);

function validPngHeader(bytes: Buffer): boolean {
  return (
    bytes.length >= 33 &&
    bytes.subarray(0, 8).equals(PNG_SIGNATURE) &&
    bytes.readUInt32BE(8) === 13 &&
    bytes.toString("latin1", 12, 16) === "IHDR" &&
    validDimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20)) &&
    PNG_DEPTHS.get(bytes[25])?.includes(bytes[24]) === true &&
    bytes[26] === 0 &&
    bytes[27] === 0 &&
    bytes[28] <= 1
  );
}

// Walk chunk boundaries, so an animation marker in compressed data or text is inert.
// The browser performs the final pixel decode; the server never expands image data.
function isStaticPng(bytes: Buffer): boolean {
  if (!validPngHeader(bytes)) return false;
  let offset = 8;
  let palette = false;
  let dataBytes = 0;
  let dataEnded = false;
  while (offset <= bytes.length - 12) {
    const length = bytes.readUInt32BE(offset);
    const crcOffset = offset + 8 + length;
    const end = crcOffset + 4;
    if (
      end > bytes.length ||
      crc32(bytes.subarray(offset + 4, crcOffset)) !==
        bytes.readUInt32BE(crcOffset)
    )
      return false;
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    switch (type) {
      case "IHDR":
        if (offset !== 8) return false;
        break;
      case "PLTE":
        if (palette || dataBytes || !length || length > 768 || length % 3 !== 0)
          return false;
        palette = true;
        break;
      case "IDAT":
        if (dataEnded || (bytes[25] === 3 && !palette)) return false;
        dataBytes += length;
        break;
      case "IEND":
        return length === 0 && dataBytes > 0 && end === bytes.length;
      case "acTL":
      case "fcTL":
      case "fdAT":
        return false;
      default:
        // Unknown critical chunks change how the image must be interpreted.
        if (!(bytes[offset + 4] & 0x20)) return false;
        if (dataBytes) dataEnded = true;
    }
    offset = end;
  }
  return false;
}

function afterJpegScan(bytes: Buffer, start: number): number {
  // FF00 is an encoded FF byte. Restart markers occur inside entropy-coded scans.
  let pos = start;
  while (pos < bytes.length) {
    const marker = bytes.indexOf(0xff, pos);
    if (marker < 0) return -1;
    pos = marker + 1;
    while (bytes[pos] === 0xff) pos++;
    const code = bytes[pos++];
    if (code === 0 || (code >= 0xd0 && code <= 0xd7)) continue;
    return marker > start ? marker : -1;
  }
  return -1;
}

// Baseline, extended sequential and progressive 8-bit Huffman-coded JPEG.
// Inspect all scans: a later frame or trailing concatenated image must not
// introduce different dimensions after the first one has passed the limit.
function isStaticJpeg(bytes: Buffer): boolean {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let pos = 2;
  let components = 0;
  let scanned = false;
  let quantization = false;
  let huffman = false;
  while (pos < bytes.length) {
    if (bytes[pos++] !== 0xff) return false;
    while (bytes[pos] === 0xff) pos++;
    const code = bytes[pos++];
    if (code === 0xd9) return scanned && pos === bytes.length;
    if (pos + 2 > bytes.length) return false;
    const length = bytes.readUInt16BE(pos);
    const end = pos + length;
    if (length < 2 || end > bytes.length) return false;
    switch (code) {
      case 0xc0: // SOF0
      case 0xc1: // SOF1
      case 0xc2: // SOF2
        if (components || length < 11 || bytes[pos + 2] !== 8) return false;
        components = bytes[pos + 7];
        if (
          components < 1 ||
          components > 4 ||
          length !== 8 + 3 * components ||
          !validDimensions(
            bytes.readUInt16BE(pos + 5),
            bytes.readUInt16BE(pos + 3),
          )
        )
          return false;
        break;
      case 0xdb: // DQT
        if (length < 67) return false;
        quantization = true;
        break;
      case 0xc4: // DHT
        if (length < 20) return false;
        huffman = true;
        break;
      case 0xda: {
        // SOS
        const count = bytes[pos + 2];
        if (
          !quantization ||
          !huffman ||
          count < 1 ||
          count > components ||
          length !== 6 + 2 * count
        )
          return false;
        pos = afterJpegScan(bytes, end);
        if (pos < 0) return false;
        scanned = true;
        continue;
      }
      case 0xdd: // DRI
        if (length !== 4) return false;
        break;
      default:
        // APP0–APP15 (including Exif/ICC) and COM are length-delimited metadata.
        if ((code < 0xe0 || code > 0xef) && code !== 0xfe) return false;
    }
    pos = end;
  }
  return false;
}

export function inspectPicturePreview(
  bytes: Buffer,
  filename: string,
): PicturePreviewMediaType | undefined {
  if (bytes.length > MAX_PICTURE_PREVIEW_BYTES) return undefined;
  const type = picturePreviewMediaType(filename);
  if (type === "image/png" && isStaticPng(bytes)) return type;
  if (type === "image/jpeg" && isStaticJpeg(bytes)) return type;
  return undefined;
}
