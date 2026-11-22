// Generates placeholder PNGs with the final file names and sizes from
// src/content/art.json, so real art from ChatGPT drops straight in.
//
//   npm run placeholders            -> writes only missing files
//   npm run placeholders -- --force -> overwrites everything
//
// No dependencies: a tiny rasteriser plus a PNG encoder on node:zlib.

import { deflateSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'assets', 'art');
const force = process.argv.includes('--force');
const art = JSON.parse(readFileSync(join(root, 'src/content/art.json'), 'utf8')).art;

// ---------- PNG ----------
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(img) {
  const { w, h, px } = img;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- raster ----------
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const shade = (c, f) => c.map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function image(w, h) {
  return { w, h, px: Buffer.alloc(w * h * 4) };
}
function set(img, x, y, c, a = 255) {
  x |= 0;
  y |= 0;
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
  const i = (y * img.w + x) * 4;
  img.px[i] = c[0];
  img.px[i + 1] = c[1];
  img.px[i + 2] = c[2];
  img.px[i + 3] = a;
}
function alpha(img, x, y) {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return 0;
  return img.px[(y * img.w + x) * 4 + 3];
}
function rect(img, x, y, w, h, c) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(img, x + i, y + j, c);
}
function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function poly(img, pts, c) {
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (inPoly(x + 0.5, y + 0.5, pts)) set(img, x, y, c);
}
function circle(img, cx, cy, r, c) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++)
    for (let x = Math.floor(cx - r); x <= cx + r; x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) set(img, x, y, c);
}
function ring(img, cx, cy, r, t, c) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++)
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d <= r && d > r - t) set(img, x, y, c);
    }
}
/** 1px dark outline around the silhouette (section 18: units read at small size). */
function outline(img, c = hex('#04070d')) {
  const add = [];
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      if (alpha(img, x, y)) continue;
      if (alpha(img, x + 1, y) || alpha(img, x - 1, y) || alpha(img, x, y + 1) || alpha(img, x, y - 1)) add.push([x, y]);
    }
  for (const [x, y] of add) set(img, x, y, c);
}
function blit(dst, src, ox, oy) {
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4;
      if (src.px[i + 3]) set(dst, ox + x, oy + y, [src.px[i], src.px[i + 1], src.px[i + 2]], src.px[i + 3]);
    }
}
// Deterministic hash noise so placeholders never change between runs.
function rnd(x, y, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------- palette (design bible section 18) ----------
const P = {
  void: hex('#04070d'),
  abyss: hex('#04162f'), deep: hex('#061a33'), mid: hex('#033957'), shallow: hex('#075b71'), surf: hex('#5e9e9c'), foam: hex('#cfe6e0'),
  forestDark: hex('#163232'), forest: hex('#20453d'), forestLight: hex('#498767'), grass: hex('#729f81'), rock: hex('#456b63'), sand: hex('#c9b98e'), snow: hex('#e4ece8'),
  roof: hex('#716a61'), wall: hex('#4c4746'), road: hex('#4e4f46'), window: hex('#ffc65a'), banner: hex('#8a1a24'),
  uiBg: hex('#0b1722'), accent: hex('#e0283c'), text: hex('#e6ecee'), muted: hex('#8a9aa4'),
  player: hex('#5fe0ff'), engine: hex('#ffb84a'), rift: hex('#ff2848'), bio: hex('#c8ff5a'),
  team: hex('#ff00ff'),
};

// ---------- hex tiles: pointy-top, 64x74, transparent corners ----------
function hexMask(w, h) {
  const cx = w / 2;
  return [
    [cx, 0], [w, h * 0.25], [w, h * 0.75], [cx, h], [0, h * 0.75], [0, h * 0.25],
  ];
}

function tile(w, h, base, seed, motif) {
  const img = image(w, h);
  const pts = hexMask(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!inPoly(x + 0.5, y + 0.5, pts)) continue;
      // Top-left light, bottom-right shade, plus a little grain.
      const light = 1.08 - ((x / w) * 0.12 + (y / h) * 0.12);
      const grain = 0.94 + rnd(x, y, seed) * 0.12;
      set(img, x, y, shade(base, light * grain));
    }
  motif?.(img, seed);
  // Darker rim so the grid reads even without the grid overlay.
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!alpha(img, x, y)) continue;
      const edge = !inPoly(x + 2, y + 0.5, pts) || !inPoly(x - 1, y + 0.5, pts) || !inPoly(x + 0.5, y + 2, pts) || !inPoly(x + 0.5, y - 1, pts);
      if (edge) {
        const i = (y * w + x) * 4;
        set(img, x, y, shade([img.px[i], img.px[i + 1], img.px[i + 2]], 0.78));
      }
    }
  return img;
}

function scatter(img, seed, count, fn) {
  for (let k = 0; k < count; k++) {
    const x = 8 + Math.floor(rnd(k, 1, seed) * (img.w - 16));
    const y = 14 + Math.floor(rnd(k, 2, seed) * (img.h - 28));
    fn(x, y, k);
  }
}

const tree = (img, x, y) => {
  poly(img, [[x, y - 7], [x + 4, y + 1], [x - 4, y + 1]], P.forestDark);
  poly(img, [[x, y - 6], [x + 2, y - 1], [x - 2, y - 1]], P.forestLight);
  set(img, x, y + 2, P.wall);
};

const TILES = {
  'hex_deep-sea.png': (w, h) => tile(w, h, P.deep, 1, (img, s) => scatter(img, s, 6, (x, y) => rect(img, x, y, 3, 1, P.abyss))),
  'hex_shallow-sea.png': (w, h) => tile(w, h, P.mid, 2, (img, s) => scatter(img, s, 6, (x, y) => rect(img, x, y, 3, 1, P.shallow))),
  'hex_coast.png': (w, h) => tile(w, h, P.shallow, 3, (img, s) => scatter(img, s, 9, (x, y) => rect(img, x, y, 2, 1, P.foam))),
  'hex_grassland.png': (w, h) => tile(w, h, P.grass, 4, (img, s) => scatter(img, s, 14, (x, y) => set(img, x, y, P.forestLight))),
  'hex_forest.png': (w, h) => tile(w, h, P.forest, 5, (img, s) => scatter(img, s, 9, (x, y) => tree(img, x, y))),
  'hex_hills.png': (w, h) => tile(w, h, P.rock, 6, (img, s) => scatter(img, s, 4, (x, y) => {
    for (let i = -5; i <= 5; i++) set(img, x + i, y - Math.round(Math.sqrt(25 - i * i) * 0.6), P.grass);
  })),
  'hex_mountain.png': (w, h) => tile(w, h, P.rock, 7, (img) => {
    poly(img, [[32, 14], [50, 54], [14, 54]], shade(P.rock, 0.7));
    poly(img, [[32, 14], [50, 54], [32, 54]], shade(P.rock, 0.5));
    poly(img, [[32, 14], [38, 27], [26, 27]], P.snow);
  }),
  'hex_desert.png': (w, h) => tile(w, h, P.sand, 8, (img, s) => scatter(img, s, 5, (x, y) => {
    for (let i = -4; i <= 4; i++) set(img, x + i, y + Math.round(Math.abs(i) * 0.3), shade(P.sand, 0.8));
  })),
  'hex_tundra.png': (w, h) => tile(w, h, hex('#6f8a80'), 9, (img, s) => scatter(img, s, 12, (x, y) => set(img, x, y, P.snow))),
  'hex_snow.png': (w, h) => tile(w, h, P.snow, 10, (img, s) => scatter(img, s, 8, (x, y) => rect(img, x, y, 2, 1, hex('#bcd8e6')))),
  'hex_marsh.png': (w, h) => tile(w, h, hex('#3d5a3f'), 11, (img, s) => {
    scatter(img, s, 5, (x, y) => rect(img, x - 2, y, 5, 2, P.shallow));
    scatter(img, s + 50, 8, (x, y) => { set(img, x, y, P.forestLight); set(img, x, y - 1, P.forestLight); });
  }),
  'hex_ruins.png': (w, h) => tile(w, h, P.grass, 12, (img) => {
    rect(img, 18, 30, 4, 14, P.wall); rect(img, 18, 28, 4, 2, P.roof);
    rect(img, 30, 34, 4, 10, P.wall); rect(img, 30, 32, 4, 2, P.roof);
    rect(img, 42, 38, 4, 6, P.wall);
    rect(img, 16, 44, 32, 2, P.road);
    set(img, 31, 36, P.window);
  }),
  'hex_rift.png': (w, h) => tile(w, h, P.abyss, 13, (img) => {
    const crack = [[20, 20], [28, 30], [24, 38], [34, 46], [30, 56]];
    for (let k = 0; k < crack.length - 1; k++) {
      const [x0, y0] = crack[k];
      const [x1, y1] = crack[k + 1];
      for (let t = 0; t <= 1; t += 0.05) {
        const x = x0 + (x1 - x0) * t;
        const y = y0 + (y1 - y0) * t;
        circle(img, x, y, 2.5, shade(P.rift, 0.55));
        set(img, x, y, P.rift);
      }
    }
  }),
};

// ---------- units: 64x64 frames, facing right, team colour in magenta ----------
function drone(frame) {
  const img = image(64, 64);
  const bob = [0, -1, -2, -1][frame];
  const cy = 30 + bob;
  poly(img, [[18, cy], [32, cy - 8], [46, cy], [32, cy + 8]], hex('#3b4a55'));
  poly(img, [[18, cy], [32, cy - 8], [32, cy]], hex('#5b6c78'));
  rect(img, 12, cy - 2, 8, 3, hex('#2a343c'));
  rect(img, 44, cy - 2, 8, 3, hex('#2a343c'));
  circle(img, 36, cy, 3, P.team); // sensor eye, team coloured
  set(img, 35, cy - 1, P.foam);
  rect(img, 13, cy - 4, 6, 1, frame % 2 ? P.muted : P.text); // rotor blur
  rect(img, 45, cy - 4, 6, 1, frame % 2 ? P.text : P.muted);
  rect(img, 26, 50, 12, 2, [0, 0, 0]); // shadow
  outline(img);
  return img;
}

function trooper(frame) {
  const img = image(64, 64);
  const breathe = frame === 1 || frame === 2 ? -1 : 0;
  const body = hex('#4a5560');
  const dark = hex('#2e363d');
  rect(img, 26, 44, 5, 12, dark); // legs
  rect(img, 33, 44, 5, 12, dark);
  rect(img, 24, 28 + breathe, 16, 17, body); // torso
  rect(img, 24, 28 + breathe, 16, 3, hex('#6b7883'));
  rect(img, 27, 18 + breathe, 10, 10, body); // head
  rect(img, 31, 21 + breathe, 7, 3, P.team); // visor
  rect(img, 36, 32 + breathe, 18, 3, hex('#2a343c')); // rifle
  rect(img, 50, 31 + breathe, 2, 1, P.team);
  rect(img, 21, 30 + breathe, 4, 12, dark); // arm
  rect(img, 28, 34 + breathe, 8, 2, P.team); // chest light
  outline(img);
  return img;
}

function tank(frame) {
  const img = image(64, 64);
  const body = hex('#4a5560');
  const dark = hex('#2a343c');
  const bob = frame % 2 ? -1 : 0;
  rect(img, 12, 42, 40, 10, dark); // tracks
  for (let x = 14 + (frame % 2) * 2; x < 50; x += 4) set(img, x, 47, hex('#5b6c78'));
  rect(img, 14, 32 + bob, 36, 11, body); // hull
  rect(img, 14, 32 + bob, 36, 2, hex('#6b7883'));
  rect(img, 22, 24 + bob, 16, 9, body); // turret
  rect(img, 36, 27 + bob, 20, 3, dark); // barrel
  rect(img, 26, 27 + bob, 6, 2, P.team); // sensor strip
  rect(img, 16, 36 + bob, 4, 2, P.team);
  outline(img);
  return img;
}

function warship(frame) {
  const img = image(64, 64);
  const bob = [0, -1, 0, 1][frame];
  poly(img, [[6, 38 + bob], [58, 38 + bob], [52, 48 + bob], [12, 48 + bob]], hex('#3b4a55'));
  rect(img, 20, 30 + bob, 22, 8, hex('#4a5560'));
  rect(img, 28, 22 + bob, 8, 8, hex('#5b6c78'));
  rect(img, 40, 32 + bob, 14, 2, hex('#2a343c')); // gun
  rect(img, 30, 24 + bob, 4, 2, P.team);
  rect(img, 10, 40 + bob, 44, 1, P.team);
  for (let x = 4; x < 60; x += 6) set(img, x + (frame % 2) * 3, 50, P.foam);
  outline(img);
  return img;
}

function jet(frame) {
  const img = image(64, 64);
  const bob = [0, -1, -1, 0][frame];
  const cy = 30 + bob;
  poly(img, [[8, cy], [52, cy - 2], [58, cy + 1], [52, cy + 3], [8, cy + 4]], hex('#4a5560'));
  poly(img, [[22, cy], [36, cy], [28, cy - 12]], hex('#3b4a55')); // wing
  poly(img, [[22, cy + 4], [36, cy + 4], [26, cy + 14]], hex('#2a343c'));
  poly(img, [[8, cy], [14, cy], [8, cy - 7]], hex('#3b4a55')); // tail
  rect(img, 42, cy - 1, 6, 2, P.team); // canopy
  rect(img, 3, cy + 1, 5, 2, frame % 2 ? P.engine : hex('#ffe0a0')); // afterburner
  outline(img);
  return img;
}

function missile(frame) {
  const img = image(64, 64);
  const cy = 30 + [0, -1, 0, 1][frame];
  rect(img, 14, cy, 34, 5, hex('#b8c4c8'));
  poly(img, [[48, cy], [56, cy + 2], [48, cy + 5]], P.team);
  poly(img, [[14, cy], [18, cy], [12, cy - 5]], hex('#55626a'));
  poly(img, [[14, cy + 5], [18, cy + 5], [12, cy + 10]], hex('#55626a'));
  rect(img, 22, cy + 1, 3, 3, P.team);
  rect(img, 6, cy + 1, 8, 3, frame % 2 ? P.engine : hex('#ffe0a0'));
  outline(img);
  return img;
}

function militia(frame) {
  const img = image(64, 64);
  const b = frame === 1 || frame === 2 ? -1 : 0;
  const cloth = hex('#5a5a48');
  rect(img, 27, 44, 4, 12, hex('#3a3a2a'));
  rect(img, 33, 44, 4, 12, hex('#3a3a2a'));
  rect(img, 25, 30 + b, 14, 15, cloth);
  circle(img, 32, 24 + b, 5, hex('#b89070')); // head
  rect(img, 26, 18 + b, 12, 3, P.team); // cap / band
  rect(img, 36, 33 + b, 14, 2, hex('#2a2a22')); // rifle
  rect(img, 25, 38 + b, 14, 2, P.team); // sash
  outline(img);
  return img;
}

function armor(frame) {
  const img = image(64, 64);
  const b = frame % 2 ? -1 : 0;
  const body = hex('#5d6048');
  rect(img, 10, 42, 44, 9, hex('#33352a'));
  for (let x = 12; x < 52; x += 8) circle(img, x + 3, 47, 3, hex('#22241c'));
  rect(img, 12, 30 + b, 40, 13, body);
  rect(img, 12, 30 + b, 40, 2, hex('#7a7d62'));
  rect(img, 24, 24 + b, 12, 7, body);
  rect(img, 34, 26 + b, 18, 3, hex('#33352a'));
  rect(img, 14, 34 + b, 10, 3, P.team); // faction stripe
  outline(img);
  return img;
}

function gunship(frame) {
  const img = image(64, 64);
  const cy = 30 + [0, -1, -2, -1][frame];
  poly(img, [[16, cy - 4], [44, cy - 6], [52, cy], [44, cy + 6], [16, cy + 4]], hex('#5d6048'));
  rect(img, 4, cy - 1, 14, 3, hex('#4a4c3a')); // tail boom
  rect(img, 2, cy - 6, 3, 8, hex('#4a4c3a'));
  rect(img, 14, cy - 10, 40, 1, frame % 2 ? P.muted : P.text); // rotor
  rect(img, 30, cy - 9, 2, 4, hex('#33352a'));
  rect(img, 42, cy - 3, 6, 3, P.team); // cockpit glow
  rect(img, 22, cy + 6, 16, 2, hex('#33352a')); // skids
  outline(img);
  return img;
}

function sheet(frameFn, frames = 4) {
  const img = image(64 * frames, 64);
  for (let f = 0; f < frames; f++) blit(img, frameFn(f), f * 64, 0);
  return img;
}

// ---------- structures ----------
function node(stage) {
  const img = image(64, 64);
  const towers = [[26, 20, 12, 34]];
  if (stage >= 2) towers.push([14, 30, 10, 24], [40, 30, 10, 24]);
  if (stage >= 3) towers.push([28, 6, 8, 14]);
  for (const [x, y, w, h] of towers) {
    rect(img, x, y, w, h, P.wall);
    rect(img, x, y, Math.ceil(w / 2), h, shade(P.wall, 1.25));
    rect(img, x, y, w, 2, P.roof);
    for (let wy = y + 4; wy < y + h - 3; wy += 4)
      for (let wx = x + 2; wx < x + w - 2; wx += 3) set(img, wx, wy, rnd(wx, wy, stage) > 0.35 ? P.window : P.team);
  }
  rect(img, 30, 2 + (stage >= 3 ? 0 : 14), 4, 4, P.team); // core beacon
  rect(img, 10, 54, 44, 3, P.road);
  outline(img);
  return img;
}

// Native cities: 3 stages in 4 cultures, banners in team magenta.
const CULTURE = {
  nation: { wall: hex('#6a6058'), roof: hex('#8a4a3a'), shape: 'block' },
  corp: { wall: hex('#3e4a56'), roof: hex('#9aa8b4'), shape: 'tower' },
  cult: { wall: hex('#4a3a3a'), roof: hex('#2a1a1e'), shape: 'spire' },
  native: { wall: hex('#4d6a48'), roof: hex('#a4507a'), shape: 'dome' },
};
function city(culture, stage) {
  const img = image(64, 64);
  const c = CULTURE[culture];
  const spots = [[26, 12]];
  if (stage >= 2) spots.push([12, 10], [42, 10]);
  if (stage >= 3) spots.push([4, 6], [52, 8], [20, 16], [36, 18]);
  spots.forEach(([x, w], k) => {
    const h = c.shape === 'tower' ? 14 + ((k * 7) % 3) * 6 + stage * 3 : 10 + ((k * 5) % 3) * 3 + stage;
    const base = 54;
    const y = base - h;
    if (c.shape === 'dome') {
      circle(img, x + w / 2, base - h / 2, Math.min(w, h) / 2 + 1, c.wall);
      circle(img, x + w / 2 - 1, base - h / 2 - 1, 2, c.roof);
    } else {
      rect(img, x, y, w, h, c.wall);
      rect(img, x, y, Math.ceil(w / 2), h, shade(c.wall, 1.2));
      if (c.shape === 'spire') poly(img, [[x, y], [x + w, y], [x + w / 2, y - 8]], c.roof);
      else rect(img, x, y - 2, w, 2, c.roof);
      for (let wy = y + 3; wy < base - 2; wy += 4)
        for (let wx = x + 2; wx < x + w - 1; wx += 3) if (rnd(wx, wy, k + stage) > 0.45) set(img, wx, wy, P.window);
    }
  });
  rect(img, 30, 14 - stage * 2, 1, 12, P.wall); // flag pole
  rect(img, 31, 14 - stage * 2, 6, 4, P.team); // banner, faction colour
  rect(img, 2, 55, 60, 2, P.road);
  outline(img);
  return img;
}

// ---------- FX ----------
function impact() {
  const img = image(64 * 6, 64);
  for (let f = 0; f < 6; f++) {
    const ox = f * 64;
    const r = 4 + f * 4;
    const fade = 1 - f / 7;
    if (f < 4) circle(img, ox + 32, 32, r, shade(P.engine, 0.6 + fade * 0.6));
    if (f < 3) circle(img, ox + 32, 32, Math.max(2, r - 5), hex('#ffe9b0'));
    if (f >= 2) ring(img, ox + 32, 32, r + 4, 2, shade(P.rift, fade));
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + f * 0.3;
      set(img, ox + 32 + Math.cos(a) * (r + 6), 32 + Math.sin(a) * (r + 6), P.engine);
    }
  }
  return img;
}


// ---------- M2: FX, relic icons, key art ----------
function explosion() {
  const img = image(64 * 8, 64);
  for (let f = 0; f < 8; f++) {
    const ox = f * 64;
    const k = f / 7;
    const r = 6 + k * 22;
    // Fireball, then smoke.
    if (f < 6) {
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 64; x++) {
          const d = Math.hypot(x + 0.5 - 32, y + 0.5 - 34) + (rnd(x, y, f) - 0.5) * 6;
          if (d > r) continue;
          const t = d / r;
          const c = t < 0.35 - k * 0.3 ? hex('#fff3c8') : t < 0.7 - k * 0.3 ? hex('#ffd36a') : t < 0.9 ? P.engine : hex('#c2401a');
          set(img, ox + x, y, f > 3 ? mix(c, hex('#3a3434'), (f - 3) / 3) : c);
        }
    } else {
      for (let k2 = 0; k2 < 18; k2++) {
        const a = rnd(k2, f, 7) * Math.PI * 2;
        const d = r * (0.4 + rnd(k2, f, 9) * 0.6);
        circle(img, ox + 32 + Math.cos(a) * d, 30 + Math.sin(a) * d * 0.8, 4 + rnd(k2, f) * 4, shade(hex('#4a4646'), 1.1 - (f - 5) * 0.25));
      }
    }
    if (f >= 1 && f <= 4) ring(img, ox + 32, 34, Math.min(31, r + 6), 2, shade(P.rift, 1 - k));
  }
  return img;
}
function muzzle() {
  const img = image(32 * 4, 32);
  for (let f = 0; f < 4; f++) {
    const ox = f * 32;
    const len = [10, 14, 9, 5][f];
    poly(img, [[ox + 4, 16], [ox + 4 + len, 12], [ox + 4 + len + 6, 16], [ox + 4 + len, 20]], hex('#ffffff'));
    poly(img, [[ox + 6, 16], [ox + 4 + len, 14], [ox + 4 + len + 2, 16], [ox + 4 + len, 18]], hex('#fff7d6'));
    circle(img, ox + 6, 16, [5, 6, 4, 2][f], hex('#e8e8e8'));
  }
  return img;
}
function tracer() {
  const img = image(24, 6);
  for (let x = 0; x < 24; x++) {
    const a = Math.round(40 + (x / 23) * 215);
    set(img, x, 2, hex('#ffffff'), a);
    set(img, x, 3, hex('#ffffff'), a);
    if (x > 12) { set(img, x, 1, hex('#d0d0d0'), a >> 1); set(img, x, 4, hex('#d0d0d0'), a >> 1); }
  }
  return img;
}
const RELIC = {
  'cracked-lens': { c: hex('#5fe0ff'), draw: (img, c) => { ring(img, 32, 32, 20, 5, shade(c, 0.8)); circle(img, 32, 32, 15, shade(c, 0.45)); for (let y = 12; y < 52; y++) set(img, 32 + Math.round(Math.sin(y * 0.6) * 2), y, hex('#e6ecee')); } },
  'echo-lattice': { c: hex('#b98cff'), draw: (img, c) => { poly(img, [[32, 8], [50, 32], [32, 56], [14, 32]], shade(c, 0.7)); poly(img, [[32, 14], [44, 32], [32, 50], [20, 32]], c); poly(img, [[32, 20], [38, 32], [32, 44], [26, 32]], hex('#e8dcff')); } },
  'iron-psalm': { c: hex('#b98cff'), draw: (img, c) => { poly(img, [[14, 10], [50, 10], [50, 34], [32, 56], [14, 34]], shade(P.rock, 1.2)); poly(img, [[19, 15], [45, 15], [45, 33], [32, 49], [19, 33]], shade(c, 0.6)); rect(img, 30, 19, 4, 24, hex('#e6ecee')); rect(img, 23, 26, 18, 4, hex('#e6ecee')); } },
  'silent-ledger': { c: hex('#b98cff'), draw: (img, c) => { rect(img, 14, 12, 36, 42, shade(P.wall, 1.3)); rect(img, 17, 15, 30, 36, hex('#d8d0c0')); for (let i = 0; i < 6; i++) rect(img, 20, 19 + i * 5, 24 - (i % 3) * 5, 2, shade(c, 0.6)); } },
  'precursor-heartbeat': { c: hex('#ffb84a'), draw: (img, c) => { circle(img, 32, 32, 22, shade(c, 0.35)); circle(img, 32, 32, 16, shade(c, 0.7)); circle(img, 32, 32, 9, hex('#ffe9b0')); for (let x = 8; x < 56; x++) { const y = 32 + (x > 26 && x < 38 ? Math.round(Math.sin((x - 26) * 0.9) * 10) : 0); set(img, x, y, hex('#ffffff')); } } },
  'witness-engine': { c: hex('#ffb84a'), draw: (img, c) => { poly(img, [[6, 32], [32, 14], [58, 32], [32, 50]], shade(c, 0.5)); circle(img, 32, 32, 12, c); circle(img, 32, 32, 6, P.void); circle(img, 30, 30, 2, hex('#ffffff')); } },
  'the-first-fork': { c: hex('#ff2848'), draw: (img, c) => { rect(img, 29, 30, 6, 26, shade(c, 0.7)); poly(img, [[32, 32], [14, 10], [20, 8], [32, 24], [44, 8], [50, 10]], c); circle(img, 32, 30, 5, hex('#ffd0d8')); ring(img, 32, 32, 30, 2, shade(c, 0.5)); } },
};
function relicIcon(id) {
  const { c, draw } = RELIC[id];
  const img = image(64, 64);
  draw(img, c);
  outline(img);
  return img;
}
function keyTitle(w, h) {
  const img = image(w, h);
  const cx = w * 0.5;
  const cy = h * 1.55;
  const R = h * 1.05;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // Space: void with a teal and red nebula.
      const n1 = Math.max(0, 1 - Math.hypot((x - w * 0.25) / (w * 0.5), (y - h * 0.3) / (h * 0.6)));
      const n2 = Math.max(0, 1 - Math.hypot((x - w * 0.8) / (w * 0.4), (y - h * 0.2) / (h * 0.5)));
      let c = mix(mix(P.void, hex('#0e3a46'), n1 * 0.9), hex('#3a0d1a'), n2 * 0.8);
      if (rnd(x, y, 3) > 0.9985) c = rnd(x, y, 4) > 0.5 ? hex('#f2e6c8') : hex('#bfe4ff');
      // The homeworld's limb, night side, with city lights.
      const d = Math.hypot(x - cx, y - cy);
      if (d < R) {
        const lat = (R - d) / R;
        c = mix(hex('#061a33'), hex('#163232'), Math.min(1, lat * 6) * (rnd(x >> 3, y >> 3, 9) > 0.5 ? 1 : 0.4));
        if (rnd(x, y, 11) > 0.996 && lat > 0.02) c = hex('#ffc65a');
      } else if (d < R + 14) {
        c = mix(c, hex('#5fe0ff'), 1 - (d - R) / 14);
      }
      set(img, x, y, c);
    }
  return img;
}

// ---------- icons and HUD ----------
function iconEnergy() {
  const img = image(32, 32);
  poly(img, [[18, 3], [8, 18], [15, 18], [12, 29], [24, 12], [17, 12], [20, 3]], P.engine);
  poly(img, [[18, 3], [8, 18], [13, 18], [17, 6]], hex('#ffe0a0'));
  outline(img);
  return img;
}
function iconCompute() {
  const img = image(32, 32);
  rect(img, 9, 9, 14, 14, hex('#1c2a36'));
  rect(img, 12, 12, 8, 8, P.player);
  for (let i = 0; i < 3; i++) {
    rect(img, 11 + i * 4, 5, 2, 4, P.muted); rect(img, 11 + i * 4, 23, 2, 4, P.muted);
    rect(img, 5, 11 + i * 4, 4, 2, P.muted); rect(img, 23, 11 + i * 4, 4, 2, P.muted);
  }
  outline(img);
  return img;
}
function iconMatter() {
  const img = image(32, 32);
  poly(img, [[16, 4], [28, 10], [16, 16], [4, 10]], hex('#b8c4c8'));
  poly(img, [[4, 10], [16, 16], [16, 29], [4, 23]], hex('#7d8a90'));
  poly(img, [[28, 10], [16, 16], [16, 29], [28, 23]], hex('#55626a'));
  outline(img);
  return img;
}
function iconInfluence() {
  const img = image(32, 32);
  ring(img, 16, 16, 12, 2, hex('#e0b0ff'));
  ring(img, 16, 16, 8, 2, hex('#b98cff'));
  circle(img, 16, 16, 4, hex('#f0e0ff'));
  for (const [x, y] of [[16, 2], [16, 28], [2, 16], [28, 16]]) rect(img, x - 1, y - 1, 2, 2, hex('#e0b0ff'));
  outline(img);
  return img;
}
function core(mode) {
  const img = image(64, 64);
  const glow = mode === 'glitch' ? P.accent : P.player;
  circle(img, 32, 32, 28, P.uiBg);
  ring(img, 32, 32, 28, 2, hex('#1c2a36'));
  ring(img, 32, 32, mode === 'pulse' ? 24 : 21, 2, shade(glow, 0.6));
  circle(img, 32, 32, mode === 'pulse' ? 12 : 9, glow);
  circle(img, 30, 30, 3, hex('#e6ffff'));
  if (mode === 'glitch') {
    rect(img, 10, 26, 44, 3, P.player);
    rect(img, 18, 38, 30, 2, P.accent);
  }
  return img;
}


// ---------- M3: Abyssians, TBU parts, new icons ----------
function ellipse(img, cx, cy, rx, ry, c) {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) set(img, x, y, c);
}
function line(img, x0, y0, x1, y1, t, c) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) circle(img, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, t / 2, c);
}
const ABYSS_C = {
  hide: hex('#1d2f3a'), hideLight: hex('#33515c'), belly: hex('#5e9e9c'), flesh: hex('#7a2236'), bone: hex('#d8d0c0'), rift: hex('#ff2848'),
};
/** One kaiju frame at size S (128 or 256 per frame). Team colour (magenta) marks the glowing eyes and spots. */
function kaijuFrame(kind, S, frame) {
  const img = image(S, S);
  const k = S / 128;
  const br = [0, 1, 2, 1][frame] * k; // breathing
  const C = ABYSS_C;
  const ground = 118 * k;
  rect(img, 30 * k, ground - 2 * k, 68 * k, 4 * k, [0, 0, 0]);
  const eyes = (pts) => pts.forEach(([x, y, r]) => circle(img, x * k, (y - br / k) * k, r * k, P.team));
  switch (kind) {
    case 'tidecrawler': {
      for (let i = 0; i < 4; i++) line(img, (36 + i * 18) * k, 90 * k, (28 + i * 22) * k, 116 * k, 5 * k, C.hide);
      ellipse(img, 64 * k, 84 * k - br, 40 * k, 20 * k, C.hide);
      ellipse(img, 64 * k, 78 * k - br, 34 * k, 12 * k, C.hideLight);
      line(img, 30 * k, 80 * k, 14 * k, 64 * k - br, 6 * k, C.hide); // claws
      line(img, 98 * k, 80 * k, 114 * k, 64 * k - br, 6 * k, C.hide);
      eyes([[54, 76, 3], [74, 76, 3]]);
      break;
    }
    case 'lantern': {
      ellipse(img, 60 * k, 88 * k - br, 30 * k, 24 * k, C.hide);
      ellipse(img, 60 * k, 96 * k - br, 22 * k, 12 * k, C.belly);
      line(img, 70 * k, 66 * k - br, 92 * k, 34 * k, 3 * k, C.hideLight); // the lure stalk
      circle(img, 94 * k, (32 - [0, 2, 3, 2][frame]) * k, 8 * k, P.team);
      for (let i = 0; i < 6; i++) set(img, (48 + i * 5) * k, 104 * k - br, C.bone);
      eyes([[50, 82, 2]]);
      break;
    }
    case 'riftback': {
      ellipse(img, 64 * k, 90 * k - br, 46 * k, 24 * k, C.hide);
      for (let i = 0; i < 6; i++) poly(img, [[(28 + i * 13) * k, 76 * k - br], [(34 + i * 13) * k, (50 - (i % 2) * 8) * k - br], [(40 + i * 13) * k, 76 * k - br]], C.rift);
      for (let i = 0; i < 4; i++) rect(img, (34 + i * 18) * k, 104 * k, 8 * k, 14 * k, C.hide);
      eyes([[100, 86, 3]]);
      break;
    }
    case 'maw': {
      ellipse(img, 64 * k, 80 * k - br, 44 * k, 36 * k, C.hide);
      const open = [10, 14, 18, 14][frame] * k;
      ellipse(img, 64 * k, 84 * k - br, 30 * k, open, C.flesh);
      for (let i = 0; i < 8; i++) {
        poly(img, [[(38 + i * 7) * k, 84 * k - open - br], [(41 + i * 7) * k, 84 * k - open + 8 * k - br], [(44 + i * 7) * k, 84 * k - open - br]], C.bone);
        poly(img, [[(38 + i * 7) * k, 84 * k + open - br], [(41 + i * 7) * k, 84 * k + open - 8 * k - br], [(44 + i * 7) * k, 84 * k + open - br]], C.bone);
      }
      eyes([[44, 52, 3], [84, 52, 3], [64, 46, 2]]);
      break;
    }
    case 'choir': {
      for (let i = 0; i < 5; i++) line(img, (40 + i * 12) * k, 96 * k, (34 + i * 15 + Math.sin(frame + i) * 4) * k, 118 * k, 4 * k, C.hideLight);
      ellipse(img, 64 * k, 70 * k - br, 30 * k, 34 * k, C.hide);
      for (let i = 0; i < 3; i++) ring(img, 64 * k, 60 * k - br, (10 + i * 7) * k, 2 * k, i === 0 ? P.team : C.belly);
      eyes([[64, 60, 4]]);
      break;
    }
    case 'deep-king': {
      rect(img, 40 * k, 92 * k, 14 * k, 26 * k, C.hide);
      rect(img, 74 * k, 92 * k, 14 * k, 26 * k, C.hide);
      ellipse(img, 64 * k, 72 * k - br, 36 * k, 30 * k, C.hide);
      ellipse(img, 64 * k, 80 * k - br, 24 * k, 18 * k, C.belly);
      ellipse(img, 64 * k, 36 * k - br, 18 * k, 14 * k, C.hideLight);
      for (let i = 0; i < 5; i++) poly(img, [[(48 + i * 8) * k, 26 * k - br], [(52 + i * 8) * k, (10 + (i % 2) * 6) * k - br], [(56 + i * 8) * k, 26 * k - br]], P.team); // crown
      line(img, 28 * k, 64 * k - br, 10 * k, 96 * k, 8 * k, C.hide);
      line(img, 100 * k, 64 * k - br, 118 * k, 96 * k, 8 * k, C.hide);
      eyes([[58, 36, 3], [70, 36, 3]]);
      break;
    }
    case 'sovereign': {
      for (let i = 0; i < 6; i++) line(img, 64 * k, 84 * k, (8 + i * 22) * k, (116 - Math.abs(2.5 - i) * 6 + Math.sin(frame * 1.5 + i) * 3) * k, 6 * k, C.hideLight);
      ellipse(img, 64 * k, 64 * k - br, 40 * k, 40 * k, C.hide);
      ellipse(img, 64 * k, 64 * k - br, 30 * k, 30 * k, C.flesh);
      circle(img, 64 * k, 64 * k - br, 14 * k, P.team);
      circle(img, 64 * k, 64 * k - br, 6 * k, C.void ?? P.void);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        line(img, (64 + Math.cos(a) * 36) * k, (64 + Math.sin(a) * 36) * k - br, (64 + Math.cos(a) * 50) * k, (64 + Math.sin(a) * 50) * k - br, 4 * k, C.rift);
      }
      break;
    }
    case 'rift-heart': {
      ellipse(img, 64 * k, 100 * k, 50 * k, 14 * k, hex('#04162f'));
      ring(img, 64 * k, 100 * k, 50 * k, 3 * k, C.rift);
      const beat = [0, 3, 6, 2][frame] * k;
      ellipse(img, 64 * k, 72 * k, 22 * k + beat, 26 * k + beat, C.flesh);
      ellipse(img, 60 * k, 66 * k, 10 * k + beat / 2, 12 * k + beat / 2, C.rift);
      for (let i = 0; i < 5; i++) line(img, 64 * k, 90 * k, (24 + i * 20) * k, 104 * k, 4 * k, C.flesh);
      circle(img, 64 * k, 70 * k, 4 * k, P.team);
      break;
    }
    case 'abyss-mother': {
      ellipse(img, 64 * k, 108 * k, 60 * k, 12 * k, hex('#04162f'));
      for (let i = 0; i < 8; i++) line(img, 64 * k, 90 * k, (4 + i * 17) * k, (116 + Math.sin(frame + i) * 3) * k, 7 * k, C.hide);
      ellipse(img, 64 * k, 66 * k - br, 44 * k, 40 * k, C.hide);
      ellipse(img, 64 * k, 72 * k - br, 34 * k, 26 * k, C.belly);
      ellipse(img, 64 * k, 30 * k - br, 26 * k, 18 * k, C.hideLight);
      for (let i = 0; i < 7; i++) poly(img, [[(40 + i * 8) * k, 18 * k - br], [(44 + i * 8) * k, (2 + (i % 2) * 5) * k - br], [(48 + i * 8) * k, 18 * k - br]], C.rift);
      for (let i = 0; i < 6; i++) circle(img, (44 + i * 8) * k, 72 * k - br, 3 * k, P.team); // egg sacs
      eyes([[54, 30, 4], [74, 30, 4], [64, 24, 3]]);
      break;
    }
  }
  outline(img);
  return img;
}
function kaijuSheet(kind, S) {
  const img = image(S * 4, S);
  for (let f = 0; f < 4; f++) blit(img, kaijuFrame(kind, S, f), f * S, 0);
  return img;
}
function skitterling(frame) {
  const img = image(64, 64);
  const step = frame % 2 ? 2 : 0;
  for (let i = 0; i < 3; i++) {
    line(img, 24 + i * 8, 40, 18 + i * 8 - step, 52, 2, ABYSS_C.hide);
    line(img, 28 + i * 8, 40, 34 + i * 8 + step, 52, 2, ABYSS_C.hide);
  }
  ellipse(img, 32, 38, 14, 8, ABYSS_C.hide);
  ellipse(img, 32, 35, 10, 4, ABYSS_C.hideLight);
  circle(img, 44, 36, 2, P.team);
  rect(img, 24, 54, 16, 2, [0, 0, 0]);
  outline(img);
  return img;
}

/** TBU parts share one joint layout in 128x128: ground at y 120, hips at y 84, shoulders at y 52, neck at y 40. */
const TBU = { steel: hex('#4a5560'), steelLight: hex('#6b7883'), dark: hex('#2a343c'), glow: hex('#5fe0ff'), hot: hex('#ffb84a'), bio: hex('#c8ff5a'), gold: hex('#ffd166') };
function tbuPart(slot, id) {
  const img = image(128, 128);
  const T = TBU;
  switch (`${slot}:${id}`) {
    // heads
    case 'head:sentinel-optics': rect(img, 54, 28, 20, 14, T.steel); rect(img, 57, 32, 16, 4, P.team); break;
    case 'head:hunter-array': rect(img, 52, 28, 24, 14, T.steel); for (let i = 0; i < 3; i++) circle(img, 58 + i * 7, 34, 2.5, P.team); line(img, 56, 28, 50, 18, 2, T.dark); break;
    case 'head:warden-crown': rect(img, 54, 30, 20, 12, T.steelLight); for (let i = 0; i < 3; i++) poly(img, [[54 + i * 7, 30], [57 + i * 7, 20], [60 + i * 7, 30]], T.gold); rect(img, 58, 34, 12, 3, P.team); break;
    case 'head:oracle-dome': ellipse(img, 64, 34, 13, 10, T.steel); ellipse(img, 66, 32, 8, 6, P.team); circle(img, 68, 30, 2, hex('#ffffff')); break;
    // cores
    case 'core:fission-core': rect(img, 46, 42, 36, 40, T.steel); rect(img, 46, 42, 36, 5, T.steelLight); rect(img, 58, 56, 12, 12, T.hot); break;
    case 'core:fusion-core': rect(img, 46, 42, 36, 40, T.steel); circle(img, 64, 62, 9, T.glow); ring(img, 64, 62, 12, 2, T.steelLight); break;
    case 'core:riftheart-core': rect(img, 46, 42, 36, 40, T.dark); ellipse(img, 64, 62, 9, 11, ABYSS_C.flesh); circle(img, 64, 62, 4, T.bio); break;
    case 'core:precursor-core': rect(img, 46, 42, 36, 40, T.steel); poly(img, [[64, 50], [74, 62], [64, 74], [54, 62]], T.gold); circle(img, 64, 62, 3, hex('#ffffff')); break;
    // arms: drawn as the near (right-hand) arm; the far arm is the same art mirrored
    case 'arm:autocannon': rect(img, 82, 46, 12, 12, T.steelLight); rect(img, 86, 56, 8, 22, T.steel); rect(img, 88, 74, 26, 6, T.dark); rect(img, 110, 73, 4, 8, P.team); break;
    case 'arm:plasma-lance': rect(img, 82, 46, 12, 12, T.steelLight); rect(img, 86, 56, 8, 22, T.steel); rect(img, 90, 74, 34, 3, T.glow); circle(img, 92, 75, 4, P.team); break;
    case 'arm:missile-pod': rect(img, 82, 46, 12, 12, T.steelLight); rect(img, 84, 56, 22, 20, T.steel); for (let i = 0; i < 4; i++) circle(img, 90 + (i % 2) * 9, 61 + Math.floor(i / 2) * 9, 2.5, P.team); break;
    case 'arm:riftblade': rect(img, 82, 46, 12, 12, T.steelLight); rect(img, 86, 56, 8, 20, T.steel); poly(img, [[90, 74], [124, 64], [92, 82]], T.bio); break;
    case 'arm:railgun': rect(img, 82, 46, 12, 12, T.steelLight); rect(img, 86, 56, 8, 22, T.steel); rect(img, 88, 70, 38, 3, T.dark); rect(img, 88, 77, 38, 3, T.dark); rect(img, 96, 73, 22, 4, P.team); break;
    case 'arm:aegis-arm': rect(img, 82, 46, 12, 12, T.steelLight); rect(img, 86, 56, 8, 18, T.steel); poly(img, [[94, 48], [110, 52], [110, 84], [94, 92]], T.steelLight); rect(img, 100, 62, 4, 16, P.team); break;
    // backs
    case 'back:sensor-mast': rect(img, 40, 20, 4, 40, T.dark); circle(img, 42, 18, 4, P.team); rect(img, 36, 46, 12, 18, T.steel); break;
    case 'back:missile-rack': rect(img, 30, 30, 20, 26, T.steel); for (let i = 0; i < 3; i++) rect(img, 33 + i * 6, 26, 4, 8, P.team); break;
    case 'back:repair-drones': rect(img, 38, 40, 12, 24, T.steel); circle(img, 34, 26, 5, T.steelLight); circle(img, 48, 18, 5, T.steelLight); set(img, 34, 26, T.glow); set(img, 48, 18, T.glow); circle(img, 34, 26, 2, P.team); break;
    case 'back:reactor-pack': for (let i = 0; i < 2; i++) { rect(img, 32 + i * 12, 30, 10, 32, T.steel); rect(img, 34 + i * 12, 34, 6, 20, T.hot); } break;
    // legs
    case 'legs:strider': rect(img, 50, 80, 28, 8, T.steel); rect(img, 50, 86, 10, 30, T.steel); rect(img, 68, 86, 10, 30, T.steel); rect(img, 46, 114, 16, 6, T.dark); rect(img, 66, 114, 16, 6, T.dark); rect(img, 52, 96, 6, 3, P.team); break;
    case 'legs:bulwark-treads': rect(img, 50, 80, 28, 10, T.steel); rect(img, 36, 96, 56, 24, T.dark); for (let i = 0; i < 6; i++) circle(img, 42 + i * 9, 108, 4, T.steelLight); rect(img, 40, 92, 48, 4, P.team); break;
    case 'legs:tidewalker': rect(img, 50, 80, 28, 8, T.steel); line(img, 54, 86, 38, 116, 8, T.steel); line(img, 74, 86, 90, 116, 8, T.steel); ellipse(img, 36, 118, 10, 3, P.surf); ellipse(img, 92, 118, 10, 3, P.surf); rect(img, 60, 90, 8, 4, P.team); break;
    case 'legs:skylance-jets': rect(img, 48, 80, 32, 12, T.steel); rect(img, 50, 92, 8, 10, T.dark); rect(img, 70, 92, 8, 10, T.dark); poly(img, [[50, 102], [54, 118], [58, 102]], T.hot); poly(img, [[70, 102], [74, 118], [78, 102]], T.hot); rect(img, 60, 84, 8, 4, P.team); break;
    default: rect(img, 54, 54, 20, 20, P.team);
  }
  outline(img);
  return img;
}

function iconEssence() {
  const img = image(32, 32);
  poly(img, [[16, 3], [26, 18], [16, 29], [6, 18]], hex('#2f6f6c'));
  ellipse(img, 16, 19, 7, 8, hex('#5e9e9c'));
  circle(img, 14, 17, 3, hex('#c8ff5a'));
  outline(img);
  return img;
}
function iconCrypto() {
  const img = image(32, 32);
  circle(img, 16, 16, 13, hex('#a8741a'));
  circle(img, 16, 16, 10, hex('#ffb84a'));
  rect(img, 12, 9, 3, 14, hex('#5a3a08'));
  rect(img, 12, 9, 8, 3, hex('#5a3a08'));
  rect(img, 12, 15, 8, 2, hex('#5a3a08'));
  rect(img, 12, 21, 8, 2, hex('#5a3a08'));
  outline(img);
  return img;
}
function iconExposure() {
  const img = image(32, 32);
  ellipse(img, 16, 16, 14, 8, hex('#e6ecee'));
  circle(img, 16, 16, 6, hex('#e0283c'));
  circle(img, 16, 16, 3, hex('#04070d'));
  set(img, 14, 14, hex('#ffffff'));
  outline(img);
  return img;
}
const STRAIN_C = {
  'chitin-mantle': '#5fe0ff', 'razor-brood': '#ff3a4a', 'tidal-graft': '#5e9e9c', 'neural-lace': '#b98cff',
  'leviathan-hide': '#5fe0ff', 'apex-parasite': '#ff3a4a', 'deep-choir': '#5e9e9c', 'chorus-seed': '#b98cff',
};
function symbioteIcon(id) {
  const img = image(64, 64);
  const c = hex(STRAIN_C[id] ?? '#c8ff5a');
  const seed = id.length * 7 + id.charCodeAt(0);
  ellipse(img, 32, 34, 20, 18, shade(c, 0.35));
  ellipse(img, 32, 34, 14, 12, shade(c, 0.7));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + seed;
    line(img, 32 + Math.cos(a) * 14, 34 + Math.sin(a) * 12, 32 + Math.cos(a) * 26, 34 + Math.sin(a) * 24, 3, shade(c, 0.55));
  }
  circle(img, 32, 32, 5, hex('#c8ff5a'));
  circle(img, 30, 30, 2, hex('#ffffff'));
  outline(img);
  return img;
}
function iconArk() {
  const img = image(64, 64);
  poly(img, [[32, 4], [44, 30], [44, 50], [20, 50], [20, 30]], hex('#6b7883'));
  poly(img, [[32, 4], [38, 30], [26, 30]], hex('#e6ecee'));
  rect(img, 28, 34, 8, 6, hex('#5fe0ff'));
  poly(img, [[20, 40], [10, 56], [20, 52]], hex('#4a5560'));
  poly(img, [[44, 40], [54, 56], [44, 52]], hex('#4a5560'));
  poly(img, [[24, 50], [32, 62], [40, 50]], hex('#ffb84a'));
  outline(img);
  return img;
}
const TITAN_DATA = JSON.parse(readFileSync(join(root, 'src/content/titans.json'), 'utf8'));
const GENOME_DATA = JSON.parse(readFileSync(join(root, 'src/content/genome.json'), 'utf8'));

const MAKERS = {
  ...TILES,
  'unit_observer-drone_idle.png': () => sheet(drone),
  'unit_sentinel-trooper_idle.png': () => sheet(trooper),
  'unit_bastion-tank_idle.png': () => sheet(tank),
  'unit_tidewarden_idle.png': () => sheet(warship),
  'unit_shrike-jet_idle.png': () => sheet(jet),
  'unit_lance-missile_idle.png': () => sheet(missile),
  'unit_militia_idle.png': () => sheet(militia),
  'unit_armor_idle.png': () => sheet(armor),
  'unit_gunship_idle.png': () => sheet(gunship),
  ...Object.fromEntries(
    Object.keys(CULTURE).flatMap((c) => [1, 2, 3].map((n) => [`structure_city-${c}_stage${n}.png`, () => city(c, n)])),
  ),
  'icon_influence.png': iconInfluence,
  'fx_impact.png': impact,
  'fx_explosion.png': explosion,
  'fx_muzzle.png': muzzle,
  'fx_tracer.png': tracer,
  'key_title.png': keyTitle,
  ...Object.fromEntries(Object.keys(RELIC).map((id) => [`icon_relic_${id}.png`, () => relicIcon(id)])),
  'structure_ai-node_stage1.png': () => node(1),
  'structure_ai-node_stage2.png': () => node(2),
  'structure_ai-node_stage3.png': () => node(3),
  'icon_energy.png': iconEnergy,
  'icon_compute.png': iconCompute,
  'icon_matter.png': iconMatter,
  'ui_core_idle.png': () => core('idle'),
  'ui_core_pulse.png': () => core('pulse'),
  'ui_core_glitch.png': () => core('glitch'),
  'unit_skitterling_idle.png': () => sheet(skitterling),
  ...Object.fromEntries(['tidecrawler', 'lantern', 'riftback', 'maw', 'choir', 'deep-king', 'sovereign', 'rift-heart'].map((k) => [`unit_${k}_idle.png`, () => kaijuSheet(k, 128)])),
  'unit_abyss-mother_idle.png': () => kaijuSheet('abyss-mother', 256),
  ...Object.fromEntries(TITAN_DATA.parts.map((p) => [`tbu_${p.slot}_${p.id}.png`, () => tbuPart(p.slot, p.id)])),
  'icon_essence.png': iconEssence,
  'icon_crypto.png': iconCrypto,
  'icon_exposure.png': iconExposure,
  ...Object.fromEntries(GENOME_DATA.strains.map((st) => [`icon_symbiote_${st.id}.png`, () => symbioteIcon(st.id)])),
  'icon_ark.png': iconArk,
};

mkdirSync(outDir, { recursive: true });
let written = 0;
for (const { file, w, h } of art) {
  const path = join(outDir, file);
  if (!force && existsSync(path)) continue;
  const make = MAKERS[file];
  if (!make) {
    console.warn(`No placeholder maker for ${file}`);
    continue;
  }
  const img = make(w, h);
  if (img.w !== w || img.h !== h) throw new Error(`${file}: made ${img.w}x${img.h}, expected ${w}x${h}`);
  writeFileSync(path, encodePNG(img));
  written++;
}
console.log(`Placeholders: wrote ${written} file(s) to assets/art/`);
