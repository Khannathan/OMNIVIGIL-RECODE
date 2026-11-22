// WebGL2 sprite batcher. One texture atlas, two instanced draw calls per
// frame: normal sprites, then an additive glow layer for FX (M2).
// Sprites can rotate (tracers, debris). Pure magenta (#ff00ff) pixels are recoloured to the team colour in
// the shader, so art only needs painting once (design bible section 18).

import { ART, ArtDef } from '../content';
import { HEX_H, HEX_W } from '../sim/hex';

export interface Sprite {
  name: string;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** Frame size in pixels. */
  w: number;
  h: number;
  frames: number;
}

export interface DrawOpts {
  frame?: number;
  /** Multiplier on the art's pixel size. */
  scale?: number;
  tint?: [number, number, number, number];
  team?: [number, number, number];
  /** Exact size in world pixels, overriding the art size and scale. */
  size?: [number, number];
  /** Radians, clockwise on screen. */
  rotation?: number;
  /** Draw in the additive glow layer (on top of everything else). */
  additive?: boolean;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

const FLOATS = 16; // x y w h | u0 v0 u1 v1 | r g b a | tr tg tb rot
const MAX_SPRITES = 40000;
const MAX_GLOW = 4000;
const ATLAS = 2048;

const VERT = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_rect;
layout(location=2) in vec4 a_uv;
layout(location=3) in vec4 a_tint;
layout(location=4) in vec4 a_team;
uniform vec2 u_cam;
uniform float u_zoom;
uniform vec2 u_view;
out vec2 v_uv;
out vec4 v_tint;
out vec3 v_team;
void main() {
  vec2 local = (a_corner - 0.5) * a_rect.zw;
  float c = cos(a_team.w);
  float s = sin(a_team.w);
  vec2 world = a_rect.xy + vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  vec2 screen = floor((world - u_cam) * u_zoom + 0.5);
  gl_Position = vec4(screen / (u_view * 0.5) * vec2(1.0, -1.0), 0.0, 1.0);
  v_uv = mix(a_uv.xy, a_uv.zw, a_corner);
  v_tint = a_tint;
  v_team = a_team.rgb;
}`;

const FRAG = `#version 300 es
precision mediump float;
uniform sampler2D u_tex;
in vec2 v_uv;
in vec4 v_tint;
in vec3 v_team;
out vec4 outColor;
void main() {
  vec4 c = texture(u_tex, v_uv);
  if (c.a < 0.01) discard;
  if (c.r > 0.9 && c.g < 0.1 && c.b > 0.9) c.rgb = v_team;
  outColor = vec4(c.rgb * v_tint.rgb, c.a * v_tint.a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
  return s;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private buffer: WebGLBuffer;
  private data = new Float32Array(MAX_SPRITES * FLOATS);
  private count = 0;
  private glow = new Float32Array(MAX_GLOW * FLOATS);
  private glowCount = 0;
  private sprites = new Map<string, Sprite>();
  private tex: WebGLTexture;
  private uCam: WebGLUniformLocation;
  private uZoom: WebGLUniformLocation;
  private uView: WebGLUniformLocation;
  /** CSS pixels. */
  width = 1;
  height = 1;
  dpr = 1;
  camera: Camera = { x: 0, y: 0, zoom: 1 };

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;

    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
    this.program = p;
    this.uCam = gl.getUniformLocation(p, 'u_cam')!;
    this.uZoom = gl.getUniformLocation(p, 'u_zoom')!;
    this.uView = gl.getUniformLocation(p, 'u_view')!;

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const stride = FLOATS * 4;
    const attrs: Array<[number, number, number]> = [
      [1, 4, 0],
      [2, 4, 4],
      [3, 4, 8],
      [4, 4, 12],
    ];
    for (const [loc, size, offset] of attrs) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4);
      gl.vertexAttribDivisor(loc, 1);
    }

    this.tex = gl.createTexture()!;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** Loads every art file in the manifest plus generated helper sprites into one atlas. */
  async load(baseUrl = 'art/'): Promise<string[]> {
    const missing: string[] = [];
    const images = await Promise.all(
      ART.filter((def) => !def.ui).map(async (def) => {
        try {
          return { def, img: await loadImage(baseUrl + def.file) as CanvasImageSource };
        } catch {
          missing.push(def.file);
          return { def, img: missingArt(def) as CanvasImageSource };
        }
      }),
    );
    const extra: Array<{ def: ArtDef; img: CanvasImageSource }> = [
      { def: { file: 'gen:hex-line', w: HEX_W, h: HEX_H }, img: hexShape(1, false) },
      { def: { file: 'gen:hex-ring', w: HEX_W, h: HEX_H }, img: hexShape(3, false) },
      { def: { file: 'gen:hex-fill', w: HEX_W, h: HEX_H }, img: hexShape(0, true) },
      { def: { file: 'gen:dot', w: 8, h: 8 }, img: dot(8) },
      { def: { file: 'gen:px', w: 4, h: 4 }, img: block(4) },
      { def: { file: 'gen:glow', w: 32, h: 32 }, img: softGlow(32) },
    ];
    this.buildAtlas([...images, ...extra]);
    return missing;
  }

  private buildAtlas(items: Array<{ def: ArtDef; img: CanvasImageSource }>) {
    const canvas = document.createElement('canvas');
    canvas.width = ATLAS;
    canvas.height = ATLAS;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    // Shelf packing, tallest first, 2px gutters.
    const sorted = [...items].sort((a, b) => b.def.h - a.def.h);
    let x = 0;
    let y = 0;
    let shelf = 0;
    for (const { def, img } of sorted) {
      if (x + def.w + 2 > ATLAS) {
        x = 0;
        y += shelf + 2;
        shelf = 0;
      }
      if (y + def.h > ATLAS) throw new Error('Texture atlas full');
      ctx.drawImage(img, x, y, def.w, def.h);
      const frames = def.frames ?? 1;
      this.sprites.set(def.file, {
        name: def.file,
        u0: x / ATLAS,
        v0: y / ATLAS,
        u1: (x + def.w) / ATLAS,
        v1: (y + def.h) / ATLAS,
        w: def.w / frames,
        h: def.h,
        frames,
      });
      x += def.w + 2;
      shelf = Math.max(shelf, def.h);
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
    const w = Math.round(this.width * this.dpr);
    const h = Math.round(this.height * this.dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  begin() {
    this.count = 0;
    this.glowCount = 0;
  }

  draw(name: string, x: number, y: number, opts: DrawOpts = {}) {
    const s = this.sprites.get(name);
    if (!s) return;
    const glow = !!opts.additive;
    if (glow ? this.glowCount >= MAX_GLOW : this.count >= MAX_SPRITES) return;
    const scale = opts.scale ?? 1;
    const frame = (opts.frame ?? 0) % s.frames;
    const fw = (s.u1 - s.u0) / s.frames;
    const tint = opts.tint ?? [1, 1, 1, 1];
    const team = opts.team ?? [1, 0, 1];
    const o = (glow ? this.glowCount : this.count) * FLOATS;
    const d = glow ? this.glow : this.data;
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = opts.size ? opts.size[0] : s.w * scale;
    d[o + 3] = opts.size ? opts.size[1] : s.h * scale;
    d[o + 4] = s.u0 + fw * frame;
    d[o + 5] = s.v0;
    d[o + 6] = s.u0 + fw * (frame + 1);
    d[o + 7] = s.v1;
    d[o + 8] = tint[0];
    d[o + 9] = tint[1];
    d[o + 10] = tint[2];
    d[o + 11] = tint[3];
    d[o + 12] = team[0];
    d[o + 13] = team[1];
    d[o + 14] = team[2];
    d[o + 15] = opts.rotation ?? 0;
    if (glow) this.glowCount++;
    else this.count++;
  }

  end(clear: [number, number, number]) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(clear[0], clear[1], clear[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform2f(this.uCam, this.camera.x, this.camera.y);
    gl.uniform1f(this.uZoom, this.camera.zoom * this.dpr);
    gl.uniform2f(this.uView, this.canvas.width, this.canvas.height);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * FLOATS);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
    if (this.glowCount) {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.glow, 0, this.glowCount * FLOATS);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.glowCount);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    const c = this.camera;
    return [c.x + (sx - this.width / 2) / c.zoom, c.y + (sy - this.height / 2) / c.zoom];
  }

  /** Visible world rectangle. */
  viewBounds(): { x0: number; y0: number; x1: number; y1: number } {
    const [x0, y0] = this.screenToWorld(0, 0);
    const [x1, y1] = this.screenToWorld(this.width, this.height);
    return { x0, y0, x1, y1 };
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}

/** Loud checkerboard so a missing file is obvious, never a crash. */
function missingArt(def: ArtDef): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = def.w;
  c.height = def.h;
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < def.h; y += 8)
    for (let x = 0; x < def.w; x += 8) {
      ctx.fillStyle = (x + y) % 16 ? '#000' : '#e0283c';
      ctx.fillRect(x, y, 8, 8);
    }
  return c;
}

function hexShape(lineWidth: number, fill: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = HEX_W;
  c.height = HEX_H;
  const ctx = c.getContext('2d')!;
  const w = HEX_W;
  const h = HEX_H;
  const inset = lineWidth / 2;
  ctx.beginPath();
  ctx.moveTo(w / 2, inset);
  ctx.lineTo(w - inset, h * 0.25);
  ctx.lineTo(w - inset, h * 0.75);
  ctx.lineTo(w / 2, h - inset);
  ctx.lineTo(inset, h * 0.75);
  ctx.lineTo(inset, h * 0.25);
  ctx.closePath();
  ctx.fillStyle = ctx.strokeStyle = '#fff';
  if (fill) ctx.fill();
  else {
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
  return c;
}

function block(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  return c;
}

/** '#rrggbb' -> [r, g, b] in 0..1, for team colours. */
export function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Soft radial falloff, for additive light. */
function softGlow(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

function dot(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
  ctx.fill();
  return c;
}
