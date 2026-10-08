// Draws the PWA icons (a pixel-art radar scope) and writes them as PNGs with nothing but Node built-ins.
// Usage: node tools/icons.mjs  ->  apps/web/public/icons/{icon-192,icon-512,maskable-512}.png
import { mkdirSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

const NAVY = [7, 14, 28], RING = [47, 143, 114], FAINT = [22, 50, 74], INNER = [29, 79, 69], GREEN = [79, 240, 180], WHITE = [232, 240, 251];
const N = 32, C = 15.5;

/** The 32×32 art: colour of grid cell (x, y). */
function art(x, y) {
  const dx = x - C, dy = y - C, r = Math.hypot(dx, dy);
  if (Math.abs(r - 13) < 0.75) return RING;
  if (r > 13) return NAVY;
  if ((x === 21 || x === 22) && (y === 9 || y === 10)) return GREEN; // the blip
  if ((x === 19 && y === 12) || (x === 17 && y === 14)) return INNER; // its trail
  if (x === 15 && y === 15) return WHITE;
  // A clockwise sweep at -45° (up and right) with a fading wedge behind it.
  const behind = (-45 - (Math.atan2(dy, dx) * 180) / Math.PI + 720) % 360;
  if (behind < 55 && r > 1) { const k = 1 - behind / 55; return NAVY.map((c, i) => Math.round(c + (GREEN[i] - c) * k * 0.55)); }
  if (Math.abs(r - 7) < 0.5) return INNER;
  if (x === 15 || y === 15) return FAINT;
  return NAVY;
}

/** `size` px PNG; the art fills `fill` of it (maskable icons keep it inside the safe zone). */
function png(size, fill) {
  const px = Math.floor((size * fill) / N), off = Math.floor((size - px * N) / 2);
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const gx = Math.floor((x - off) / px), gy = Math.floor((y - off) / px);
      const c = gx >= 0 && gx < N && gy >= 0 && gy < N ? art(gx, gy) : NAVY;
      raw.set(c, y * (size * 3 + 1) + 1 + x * 3);
    }
  }
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii'); data.copy(b, 8);
    b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const dir = new URL('../apps/web/public/icons/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('icon-192.png', dir), png(192, 1));
writeFileSync(new URL('icon-512.png', dir), png(512, 1));
writeFileSync(new URL('maskable-512.png', dir), png(512, 0.75));
console.log('wrote', dir.pathname);
