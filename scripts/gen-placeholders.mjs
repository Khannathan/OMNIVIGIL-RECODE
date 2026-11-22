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

const MAKERS = {
  ...TILES,
  'unit_observer-drone_idle.png': () => sheet(drone),
  'unit_sentinel-trooper_idle.png': () => sheet(trooper),
  'structure_ai-node_stage1.png': () => node(1),
  'structure_ai-node_stage2.png': () => node(2),
  'structure_ai-node_stage3.png': () => node(3),
  'icon_energy.png': iconEnergy,
  'icon_compute.png': iconCompute,
  'icon_matter.png': iconMatter,
  'ui_core_idle.png': () => core('idle'),
  'ui_core_pulse.png': () => core('pulse'),
  'ui_core_glitch.png': () => core('glitch'),
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
