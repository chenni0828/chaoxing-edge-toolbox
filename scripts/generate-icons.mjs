import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const output = fileURLToPath(new URL('../public/icons/', import.meta.url));
await mkdir(output, { recursive: true });
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="#0f766e"/><path d="M31 32h26c5 0 7 4 7 8 0-4 2-8 7-8h26v61H71c-4 0-7 3-7 6-1-3-4-6-7-6H31z" fill="#fff"/><path d="M64 40v52M40 48h13M40 60h13M76 48h12M76 60h12M76 72h12" fill="none" stroke="#0f766e" stroke-width="5" stroke-linecap="round"/></svg>';
await writeFile(resolve(output, 'icon.svg'), `${svg}\n`);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const label = Buffer.from(type);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([label, data])));
  return Buffer.concat([size, label, data, checksum]);
}
function insideRoundRect(x, y, left, top, width, height, radius) {
  const dx = Math.max(left + radius - x, 0, x - (left + width - radius));
  const dy = Math.max(top + radius - y, 0, y - (top + height - radius));
  return x >= left && x <= left + width && y >= top && y <= top + height && dx * dx + dy * dy <= radius * radius;
}
function colorAt(x, y) {
  if (!insideRoundRect(x, y, 0, 0, 128, 128, 28)) return [0, 0, 0, 0];
  let color = [15, 118, 110, 255];
  if (x >= 30 && x <= 98 && y >= 32 && y <= 94) color = [255, 255, 255, 255];
  if (insideRoundRect(x, y, 61.5, 39, 5, 57, 2.5)) color = [15, 118, 110, 255];
  for (const [left, top, width] of [[39, 46, 16], [39, 58, 16], [74, 46, 16], [74, 58, 16], [74, 70, 16]]) {
    if (insideRoundRect(x, y, left, top, width, 5, 2.5)) color = [15, 118, 110, 255];
  }
  return color;
}
for (const size of [16, 32, 48, 128]) {
  const rowSize = 1 + size * 4;
  const data = Buffer.alloc(size * rowSize);
  const samples = 4;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const channels = [0, 0, 0, 0];
    for (let sy = 0; sy < samples; sy += 1) for (let sx = 0; sx < samples; sx += 1) {
      const color = colorAt((x + (sx + 0.5) / samples) * 128 / size, (y + (sy + 0.5) / samples) * 128 / size);
      for (let c = 0; c < 4; c += 1) channels[c] += color[c] / (samples * samples);
    }
    for (let c = 0; c < 4; c += 1) data[y * rowSize + 1 + x * 4 + c] = Math.round(channels[c]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  await writeFile(resolve(output, `icon${size}.png`), Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(data)), chunk('IEND', Buffer.alloc(0)),
  ]));
}
console.log('已生成 public/icons/。');
