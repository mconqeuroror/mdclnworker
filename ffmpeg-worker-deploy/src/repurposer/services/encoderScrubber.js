/**
 * Byte-level scrubber: replace FFmpeg/Lavf/codec signatures in file buffers with
 * device-like strings so MediaInfo/atoms show iPhone/Android, not FFmpeg.
 * Keeps file length unchanged (in-place replacement, same byte length).
 */
import fs from "fs";

// Same-length replacements: [search, replacement] (bytes)
const SAME_LENGTH_PAIRS = [
  ["FFmpeg", "iPhone"],       // 6 bytes
  ["libx264", "Apple H"],     // 7 bytes
  ["libx265", "Apple H"],     // 7 bytes
  ["Lavc59.", "Apple iPh"],   // 7 bytes (start of Lavc59.x.x)
  ["Lavc60.", "Apple iPh"],   // 7 bytes
];

// Prefix match: look for prefix then overwrite fixed length with replacement (replacement length = overwrite length)
const PREFIX_REPLACEMENTS = [
  { prefix: "Lavf", overwriteLen: 14, replacement: "Apple iPhone 14" },  // Lavf59.20.100 etc.
  { prefix: "Lavc", overwriteLen: 14, replacement: "Apple iPhone 14" },  // Lavcodec
];

function indexOfBytes(buffer, search, fromIndex = 0) {
  const n = search.length;
  if (n === 0 || fromIndex + n > buffer.length) return -1;
  for (let i = fromIndex; i <= buffer.length - n; i++) {
    let match = true;
    for (let j = 0; j < n; j++) {
      if (buffer[i + j] !== search[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

function overwrite(buffer, offset, bytes) {
  for (let i = 0; i < bytes.length && offset + i < buffer.length; i++) {
    buffer[offset + i] = bytes[i];
  }
}

/**
 * Mutates the buffer in place: replaces FFmpeg/Lavf/Lavc/libx264 signatures
 * with device-like strings (same byte length). Safe to call on any buffer.
 * @param {Buffer|Uint8Array} buffer - file bytes (mutated in place)
 * @param {(s: string) => Buffer|Uint8Array} encode - string to bytes (e.g. Buffer.from(s,'utf8') or new TextEncoder().encode(s))
 */
export function scrubEncoderSignatures(buffer, encode) {
  if (!buffer || buffer.length === 0) return;

  for (const [searchStr, replaceStr] of SAME_LENGTH_PAIRS) {
    const search = encode(searchStr);
    const replace = encode(replaceStr);
    if (search.length !== replace.length) continue;
    let pos = 0;
    while ((pos = indexOfBytes(buffer, search, pos)) >= 0) {
      overwrite(buffer, pos, replace);
      pos += search.length;
    }
  }

  for (const { prefix, overwriteLen, replacement } of PREFIX_REPLACEMENTS) {
    const prefixBytes = encode(prefix);
    const replaceBytes = encode(replacement);
    if (replaceBytes.length !== overwriteLen) continue;
    let pos = 0;
    while ((pos = indexOfBytes(buffer, prefixBytes, pos)) >= 0) {
      if (pos + overwriteLen <= buffer.length) {
        overwrite(buffer, pos, replaceBytes);
      }
      pos += overwriteLen;
    }
  }
}

/**
 * Node-only: scrub a file on disk (read → scrub → write). Uses Buffer.
 * @param {string} filePath - path to file
 */
export function scrubEncoderSignaturesInFile(filePath) {
  const buf = fs.readFileSync(filePath);
  scrubEncoderSignatures(buf, (s) => Buffer.from(s, "utf8"));
  fs.writeFileSync(filePath, buf);
}
