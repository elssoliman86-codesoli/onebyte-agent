import { strFromU8 } from 'fflate';

/** Conservative limits for imports on memory-constrained mobile devices. */
export const ZIP_IMPORT_LIMITS = {
  archiveBytes: 32 * 1024 * 1024,
  fileBytes: 25 * 1024 * 1024,
  totalBytes: 80 * 1024 * 1024,
  entries: 500,
  maxCompressionRatio: 200,
} as const;

export function base64ToBytes(value: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = value.replace(/\s/g, '').replace(/=+$/, '');
  const output = new Uint8Array(Math.floor(clean.length * 3 / 4));
  let buffer = 0, bits = 0, offset = 0;
  for (const char of clean) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new Error('ملف ZIP غير صالح (Base64).');
    buffer = (buffer << 6) | digit;
    bits += 6;
    if (bits >= 8) { bits -= 8; output[offset++] = (buffer >> bits) & 255; }
  }
  return output.slice(0, offset);
}

/**
 * Validate the ZIP central directory before decompression. This blocks path
 * traversal, symlinks, encrypted/multi-volume/ZIP64 archives, oversized files,
 * and high-ratio ZIP bombs before fflate allocates extracted buffers.
 */
export function preflightZip(archive: Uint8Array): void {
  if (archive.length < 22) throw new Error('ملف ZIP أقصر من الحد الأدنى.');
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const min = Math.max(0, archive.length - 65557);
  let eocd = -1;
  for (let i = archive.length - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ملف ZIP لا يحتوي على نهاية مركزية سليمة.');
  const disk = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const diskEntries = view.getUint16(eocd + 8, true);
  const entriesCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== entriesCount || entriesCount === 0xffff ||
      centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error('الأرشيف متعدد الأجزاء أو ZIP64 غير مدعوم في استيراد الهاتف.');
  }
  if (entriesCount > ZIP_IMPORT_LIMITS.entries || centralOffset + centralSize > eocd) {
    throw new Error('فهرس ZIP غير صالح أو يتجاوز حد الملفات.');
  }
  let cursor = centralOffset, total = 0, files = 0;
  const seen = new Set<string>();
  while (cursor < centralOffset + centralSize) {
    if (cursor + 46 > centralOffset + centralSize || view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error('فهرس ZIP تالف.');
    }
    const flags = view.getUint16(cursor + 8, true);
    const compressed = view.getUint32(cursor + 20, true);
    const uncompressed = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const externalAttributes = view.getUint32(cursor + 38, true);
    if (flags & 1) throw new Error('الأرشيف المشفر بكلمة مرور غير مدعوم.');
    if (compressed === 0xffffffff || uncompressed === 0xffffffff) throw new Error('ملفات ZIP64 غير مدعومة.');
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd + extraLength + commentLength > centralOffset + centralSize) throw new Error('اسم ملف تالف داخل ZIP.');
    const path = strFromU8(archive.subarray(nameStart, nameEnd));
    const isDirectory = path.endsWith('/');
    if (!path || path.includes(String.fromCharCode(0)) || path.startsWith('/') || path.includes('\\') || /^[a-zA-Z]:/.test(path) ||
        path.split('/').some(part => part === '.' || part === '..')) {
      throw new Error('مسار غير آمن داخل الأرشيف: ' + path);
    }
    const unixMode = externalAttributes >>> 16;
    if ((unixMode & 0xf000) === 0xa000) throw new Error('الأرشيف يحتوي على رابط رمزي غير مسموح.');
    if (!isDirectory) {
      files++;
      if (seen.has(path)) throw new Error('اسم ملف مكرر داخل الأرشيف: ' + path);
      seen.add(path);
      if (uncompressed > ZIP_IMPORT_LIMITS.fileBytes) throw new Error('الملف ' + path + ' يتجاوز حد 25MB.');
      total += uncompressed;
      if (total > ZIP_IMPORT_LIMITS.totalBytes) throw new Error('الحجم بعد فك الضغط يتجاوز 80MB.');
      if (uncompressed > 1024 * 1024 &&
          (compressed === 0 || uncompressed / compressed > ZIP_IMPORT_LIMITS.maxCompressionRatio)) {
        throw new Error('الأرشيف يحتوي على نسبة ضغط غير آمنة (احتمال ZIP bomb).');
      }
    }
    cursor = nameEnd + extraLength + commentLength;
  }
  if (cursor !== centralOffset + centralSize) throw new Error('حجم فهرس ZIP لا يتطابق مع محتواه.');
  if (files === 0) throw new Error('الأرشيف لا يحتوي على ملفات.');
}
