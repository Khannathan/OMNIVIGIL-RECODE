// In-game controller: input, the five-beat cycle flow, HUD and autosave.

import { structureDef, TERRAIN, unitDef, UNITS } from './content';
import { Renderer } from './render/renderer';
import { GameView } from './render/view';
import { saveGame } from './save/save';
import { queueOrder, resolveCycle, CycleReport, wakeLine } from './sim/cycle';
import { pixelToIndex, worldPixelHeight, worldPixelWidth } from './sim/hex';
import { findPath, enterCost } from './sim/path';
import { Beat, BEATS, energyBudget, GameEvent, GameState, isBrownout, visibleTiles } from './sim/state';
import { World } from './sim/worldgen';
import { escapeHtml, formatAmount } from './ui/format';

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 4;
const BEAT_LABEL: Record<Beat, string> = {
  sense: 'Sense',
  decide: 'Decide',
  resolve: 'Resolve',
  watch: 'Watch',
  reckon: 'Reckon',
};

export class Game {
  private view: GameView;
  private visible: Set<number>;
  private beat: Beat = 'decide';
  private selectedTile: number | null = null;
  private selectedUnit: number | null = null;
  private hoverTile: number | null = null;
  private showGrid = true;
  private moveMode = false;
  private menuOpen = false;
  private revealAll = false;
  private report: CycleReport | null = null;
  private queuedRoutes = new Map<number, number[]>();
  private keys = new Set<string>();
  private drag: { x: number; y: number; camX: number; camY: number; moved: boolean } | null = null;
  private raf = 0;
  private lastTime = 0;
  private toastTimer = 0;
  private coreMode: 'idle' | 'pulse' | 'glitch' = 'idle';
  private disposers: Array<() => void> = [];

  constructor(
    private r: Renderer,
    private ui: HTMLElement,
    private world: World,
    private state: GameState,
    private onExit: () => void,
    notice?: string,
  ) {
    this.view = new GameView(r, world);
    this.visible = visibleTiles(state, world);
    const home = state.structures[0]?.tile ?? world.start;
    this.view.focus(home);
    r.camera.zoom = 1.25;
    this.selectedTile = home;
    this.selectedUnit = state.units.find((u) => u.tile === home)?.id ?? null;
    this.bindInput();
    this.refresh();
    if (notice) this.toast(notice, 6000);
    else if (state.cycle === 1) this.toast(wakeLine(state.seed, world.name), 5000);
    saveGame(state, world.name);
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    for (const d of this.disposers) d();
    this.ui.innerHTML = '';
  }

  // ---------------------------------------------------------------- loop

  private frame = (ms: number) => {
    const now = ms / 1000;
    const dt = Math.min(0.05, now - (this.lastTime || now));
    this.lastTime = now;
    this.r.resize();

    // Keyboard pan.
    const speed = (900 / this.r.camera.zoom) * dt;
    const k = this.keys;
    if (k.has('w') || k.has('arrowup')) this.r.camera.y -= speed;
    if (k.has('s') || k.has('arrowdown')) this.r.camera.y += speed;
    if (k.has('a') || k.has('arrowleft')) this.r.camera.x -= speed;
    if (k.has('d') || k.has('arrowright')) this.r.camera.x += speed;
    this.clampCamera();

    if (this.beat === 'watch' && !this.view.isWatching(now)) this.enterReckon();

    this.view.render(
      this.state,
      this.visible,
      {
        showGrid: this.showGrid,
        selectedTile: this.selectedTile,
        selectedUnit: this.selectedUnit,
        hoverTile: this.hoverTile,
        queuedRoutes: this.queuedRoutes,
        revealAll: this.revealAll,
      },
      now,
    );
    this.raf = requestAnimationFrame(this.frame);
  };

  private clampCamera() {
    const c = this.r.camera;
    const lap = worldPixelWidth(this.world);
    c.x = ((c.x % lap) + lap) % lap;
    const h = worldPixelHeight(this.world);
    const half = this.r.height / 2 / c.zoom;
    const margin = 80;
    if (half * 2 > h + margin * 2) c.y = h / 2;
    else c.y = Math.max(half - margin, Math.min(h - half + margin, c.y));
  }

  // ---------------------------------------------------------------- cycle

  private endCycle() {
    if (this.beat !== 'decide' && this.beat !== 'sense') return;
    this.closeMenu();
    this.beat = 'resolve';
    const before = new Map(this.state.units.map((u) => [u.id, u.tile]));
    const report = resolveCycle(this.state, this.world);
    this.report = report;
    this.queuedRoutes.clear();
    this.moveMode = false;
    this.visible = visibleTiles(this.state, this.world);
    saveGame(this.state, this.world.name);

    this.beat = 'watch';
    this.coreMode = report.events.some((e) => e.kind === 'yield' && e.brownout) ? 'glitch' : 'pulse';
    this.view.playWatch(report.events, before, performance.now() / 1000);
    this.refresh();
  }

  private enterReckon() {
    this.view.skipWatch();
    this.beat = 'reckon';
    this.refresh();
  }

  private finishReckon() {
    this.beat = 'sense';
    this.coreMode = isBrownout(this.state) ? 'glitch' : 'idle';
    this.refresh();
    window.setTimeout(() => {
      if (this.beat === 'sense') {
        this.beat = 'decide';
        this.refresh();
      }
    }, 700);
  }

  // ---------------------------------------------------------------- orders

  private orderMove(tile: number) {
    const unit = this.state.units.find((u) => u.id === this.selectedUnit);
    if (!unit) return;
    if (!this.state.explored[tile]) return this.toast('That hex is unexplored. Scout it first.');
    const path = findPath(this.world, unitDef(unit.type), unit.tile, tile, this.state.explored);
    if (!path) return this.toast(`${unitDef(unit.type).name} can't reach that hex.`);
    if (!path.length) {
      this.queuedRoutes.delete(unit.id);
      this.state.orders = this.state.orders.filter((o) => !(o.kind === 'move' && o.unitId === unit.id));
      unit.route = [];
    } else {
      queueOrder(this.state, { kind: 'move', unitId: unit.id, to: tile });
      this.queuedRoutes.set(unit.id, path);
    }
    this.moveMode = false;
    this.refresh();
  }

  private orderBuild(structureId: number, unit: string) {
    queueOrder(this.state, { kind: 'build', structureId, unit });
    this.refresh();
  }

  private orderCancel(structureId: number) {
    const queued = this.state.orders.some((o) => o.kind === 'build' && o.structureId === structureId);
    if (queued) {
      this.state.orders = this.state.orders.filter((o) => !(o.kind === 'build' && o.structureId === structureId));
    } else {
      queueOrder(this.state, { kind: 'cancel-build', structureId });
    }
    this.refresh();
  }

  // ---------------------------------------------------------------- input

  private on<K extends keyof WindowEventMap>(target: Window, type: K, fn: (e: WindowEventMap[K]) => void): void;
  private on<K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void): void;
  private on(target: Window | HTMLElement, type: string, fn: (e: Event) => void) {
    target.addEventListener(type, fn);
    this.disposers.push(() => target.removeEventListener(type, fn));
  }

  private tileAt(e: MouseEvent): number {
    const rect = this.r.canvas.getBoundingClientRect();
    const [wx, wy] = this.r.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    return pixelToIndex(wx, wy, this.world);
  }

  private bindInput() {
    const canvas = this.r.canvas;
    this.on(canvas, 'contextmenu', (e) => {
      e.preventDefault();
      if (!this.canAct()) return;
      const t = this.tileAt(e);
      if (t >= 0 && this.selectedUnit !== null) this.orderMove(t);
    });
    this.on(canvas, 'pointerdown', (e) => {
      if (e.button !== 0) return;
      this.drag = { x: e.clientX, y: e.clientY, camX: this.r.camera.x, camY: this.r.camera.y, moved: false };
      canvas.setPointerCapture(e.pointerId);
    });
    this.on(canvas, 'pointermove', (e) => {
      if (this.drag) {
        const dx = e.clientX - this.drag.x;
        const dy = e.clientY - this.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 5) this.drag.moved = true;
        if (this.drag.moved) {
          this.r.camera.x = this.drag.camX - dx / this.r.camera.zoom;
          this.r.camera.y = this.drag.camY - dy / this.r.camera.zoom;
        }
      }
      const t = this.tileAt(e);
      if (t !== this.hoverTile) {
        this.hoverTile = t >= 0 ? t : null;
        this.renderInfo();
      }
    });
    this.on(canvas, 'pointerup', (e) => {
      const d = this.drag;
      this.drag = null;
      if (!d || d.moved || e.button !== 0) return;
      const t = this.tileAt(e);
      if (t < 0) return;
      if (this.moveMode && this.selectedUnit !== null && this.canAct()) return this.orderMove(t);
      this.select(t);
    });
    this.on(canvas, 'pointerleave', () => {
      this.hoverTile = null;
      this.renderInfo();
    });
    this.on(canvas, 'wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const [bx, by] = this.r.screenToWorld(sx, sy);
      const c = this.r.camera;
      c.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, c.zoom * Math.exp(-e.deltaY * 0.0015)));
      // Keep the point under the cursor fixed.
      const [ax, ay] = this.r.screenToWorld(sx, sy);
      c.x += bx - ax;
      c.y += by - ay;
    });

    this.on(window, 'keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const key = e.key.toLowerCase();
      this.keys.add(key);
      if (key === 'g') {
        this.showGrid = !this.showGrid;
        this.refresh();
      } else if (key === ' ') {
        e.preventDefault();
        if (this.beat === 'watch') this.enterReckon();
        else if (this.beat === 'reckon') this.finishReckon();
      } else if (key === 'enter') {
        if (this.beat === 'reckon') this.finishReckon();
        else this.endCycle();
      } else if (key === 'escape') {
        this.moveMode = false;
        this.menuOpen = false;
        this.selectedUnit = null;
        this.refresh();
      } else if (key === 'm' && this.selectedUnit !== null) {
        this.moveMode = !this.moveMode;
        this.refresh();
      } else if (key === '`' && import.meta.env.DEV) {
        // Dev only: see the whole map to judge worldgen.
        this.revealAll = !this.revealAll;
      } else if (key === 'h') {
        const home = this.state.structures[0];
        if (home) this.view.focus(home.tile);
      } else if (key === '+' || key === '=') {
        this.r.camera.zoom = Math.min(MAX_ZOOM, this.r.camera.zoom * 1.25);
      } else if (key === '-') {
        this.r.camera.zoom = Math.max(MIN_ZOOM, this.r.camera.zoom / 1.25);
      }
    });
    this.on(window, 'keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    this.on(window, 'blur', () => this.keys.clear());

    this.on(this.ui, 'click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!el || (el as HTMLButtonElement).disabled) return;
      const act = el.dataset.act!;
      const arg = el.dataset.arg ?? '';
      switch (act) {
        case 'end-cycle':
          return this.endCycle();
        case 'skip':
          return this.enterReckon();
        case 'reckon-ok':
          return this.finishReckon();
        case 'move':
          this.moveMode = !this.moveMode;
          return this.refresh();
        case 'build': {
          const [sid, unit] = arg.split(':');
          return this.orderBuild(Number(sid), unit);
        }
        case 'cancel':
          return this.orderCancel(Number(arg));
        case 'select-unit':
          this.selectedUnit = Number(arg);
          return this.refresh();
        case 'menu':
          this.menuOpen = !this.menuOpen;
          return this.refresh();
        case 'grid':
          this.showGrid = !this.showGrid;
          return this.refresh();
        case 'home': {
          const home = this.state.structures[0];
          if (home) this.view.focus(home.tile);
          return;
        }
        case 'save':
          saveGame(this.state, this.world.name);
          this.closeMenu();
          return this.toast(`Saved. Seed ${this.state.seed}, cycle ${this.state.cycle}.`);
        case 'exit':
          saveGame(this.state, this.world.name);
          return this.onExit();
      }
    });
  }

  private canAct() {
    return this.beat === 'decide' || this.beat === 'sense';
  }

  private select(tile: number) {
    const here = this.state.units.filter((u) => u.tile === tile).map((u) => u.id);
    if (this.selectedTile === tile && this.selectedUnit !== null && here.length > 1) {
      const i = here.indexOf(this.selectedUnit);
      this.selectedUnit = here[(i + 1) % here.length];
    } else {
      this.selectedUnit = here[0] ?? null;
    }
    this.selectedTile = tile;
    this.moveMode = false;
    this.refresh();
  }

  private closeMenu() {
    this.menuOpen = false;
  }

  // ---------------------------------------------------------------- HUD

  private toast(text: string, ms = 3500) {
    const el = this.ui.querySelector<HTMLElement>('.toast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('show'), ms);
  }

  private refresh() {
    if (!this.ui.querySelector('.hud')) {
      this.ui.innerHTML = `
        <div class="hud">
          <header class="topbar"></header>
          <aside class="panel select-panel"></aside>
          <aside class="panel info-panel"></aside>
          <section class="reckon"></section>
          <div class="watch-bar"></div>
          <div class="toast" role="status"></div>
          <footer class="hints">Drag or WASD to pan · Wheel to zoom · Click to select · Right-click to move · M move · G grid · H home · Enter end cycle · Space skip</footer>
        </div>`;
    }
    this.renderTop();
    this.renderSelection();
    this.renderInfo();
    this.renderReckon();
  }

  private renderTop() {
    const s = this.state;
    const e = energyBudget(s);
    const brown = e.allocated > e.total;
    const orders = s.orders.length;
    const beats = BEATS.map((b) => `<li class="${b === this.beat ? 'on' : ''}">${BEAT_LABEL[b]}</li>`).join('');
    this.ui.querySelector('.topbar')!.innerHTML = `
      <img class="core ${this.coreMode}" src="art/ui_core_${this.coreMode}.png" alt="" width="40" height="40" />
      <div class="brand"><b>OMNIVIGIL</b><span>${escapeHtml(this.world.name)} · ${escapeHtml(this.world.kind)}</span></div>
      <div class="cycle">Cycle <b>${s.cycle}</b></div>
      <ol class="beats" aria-label="Cycle beats">${beats}</ol>
      <div class="resources">
        <span class="res ${brown ? 'warn' : ''}" title="Energy is allocated, never spent. Over-allocate and you brown out: yields and builds run at half speed.">
          <img src="art/icon_energy.png" alt="Energy" width="20" height="20" /><b>${e.allocated}/${e.total}</b>${brown ? '<em>Brownout</em>' : ''}
        </span>
        <span class="res" title="Compute"><img src="art/icon_compute.png" alt="Compute" width="20" height="20" /><b>${formatAmount(s.resources.compute)}</b></span>
        <span class="res" title="Matter"><img src="art/icon_matter.png" alt="Matter" width="20" height="20" /><b>${formatAmount(s.resources.matter)}</b></span>
      </div>
      <button class="end" data-act="end-cycle" ${this.canAct() ? '' : 'disabled'}>
        End Cycle${orders ? ` <small>${orders} order${orders > 1 ? 's' : ''}</small>` : ''}
      </button>
      <div class="menu-wrap">
        <button class="ghost" data-act="menu" aria-label="Menu">☰</button>
        ${
          this.menuOpen
            ? `<div class="menu">
                <div class="seed">Seed <code>${escapeHtml(s.seed)}</code></div>
                <button data-act="grid">${this.showGrid ? 'Hide' : 'Show'} grid</button>
                <button data-act="home">Find my Node</button>
                <button data-act="save">Save now</button>
                <button data-act="exit">Save and exit</button>
              </div>`
            : ''
        }
      </div>`;
  }

  private renderSelection() {
    const el = this.ui.querySelector<HTMLElement>('.select-panel')!;
    const s = this.state;
    const tile = this.selectedTile;
    if (tile === null) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const parts: string[] = [];
    const node = s.structures.find((x) => x.tile === tile);
    const unitsHere = s.units.filter((u) => u.tile === tile);
    const unit = s.units.find((u) => u.id === this.selectedUnit);

    if (unit) {
      const def = unitDef(unit.type);
      const queued = this.queuedRoutes.get(unit.id);
      const route = queued ?? unit.route;
      const status = queued
        ? `Ordered to move ${route.length} hex${route.length === 1 ? '' : 'es'}`
        : unit.route.length
          ? `En route, ${unit.route.length} hex${unit.route.length === 1 ? '' : 'es'} to go`
          : 'Holding';
      parts.push(`
        <h2>${def.name}</h2>
        <dl class="stats">
          <div><dt>UPow</dt><dd>${def.upow}</dd></div>
          <div><dt>Speed</dt><dd>${def.speed}</dd></div>
          <div><dt>Sight</dt><dd>${def.sight}</dd></div>
          <div><dt>Energy</dt><dd>${def.energy}</dd></div>
        </dl>
        <p class="muted">${def.domain === 'air' ? 'Flies over any terrain.' : 'Moves on land.'} ${status}.</p>
        <button data-act="move" class="${this.moveMode ? 'active' : ''}" ${this.canAct() ? '' : 'disabled'}>
          ${this.moveMode ? 'Pick a destination…' : 'Move (M or right-click)'}
        </button>`);
    }
    if (unitsHere.length > 1 || (unitsHere.length && !unit)) {
      parts.push(
        `<div class="chips">${unitsHere
          .map(
            (u) =>
              `<button class="chip ${u.id === this.selectedUnit ? 'on' : ''}" data-act="select-unit" data-arg="${u.id}">${unitDef(u.type).name}</button>`,
          )
          .join('')}</div>`,
      );
    }
    if (node) {
      const def = structureDef(node.type);
      const pending = s.orders.find((o) => o.kind === 'build' && o.structureId === node.id);
      const cancelling = s.orders.some((o) => o.kind === 'cancel-build' && o.structureId === node.id);
      let prod: string;
      if (node.build) {
        const u = unitDef(node.build.unit);
        const pct = Math.min(100, (node.build.progress / u.buildCycles) * 100);
        prod = `<div class="build">Building <b>${u.name}</b>
            <div class="bar"><i style="width:${pct}%"></i></div>
            <small>${node.build.progress}/${u.buildCycles} cycles · uses ${def.buildEnergy} Energy</small>
            <button data-act="cancel" data-arg="${node.id}" ${this.canAct() ? '' : 'disabled'}>${cancelling ? 'Cancel queued' : 'Cancel (refund)'}</button></div>`;
      } else if (pending && pending.kind === 'build') {
        prod = `<div class="build">Queued: <b>${unitDef(pending.unit).name}</b> starts at End Cycle
            <button data-act="cancel" data-arg="${node.id}">Unqueue</button></div>`;
      } else {
        prod = `<div class="build-list">${UNITS.map((u) => {
          const afford = s.resources.matter >= u.cost.matter;
          return `<button data-act="build" data-arg="${node.id}:${u.id}" ${afford && this.canAct() ? '' : 'disabled'}>
              Build ${u.name} <small>${u.cost.matter} Matter · ${u.buildCycles} cycles</small></button>`;
        }).join('')}</div>`;
      }
      parts.push(`
        <h2>${def.name} <small>stage ${node.stage}</small></h2>
        <p class="muted">Your foothold. Works every hex within ${def.workRadius} and supplies ${def.energy} Energy.</p>
        ${prod}`);
    }
    if (!parts.length) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    el.innerHTML = parts.join('');
  }

  private renderInfo() {
    const el = this.ui.querySelector<HTMLElement>('.info-panel');
    if (!el) return;
    const t = this.hoverTile ?? this.selectedTile;
    if (t === null || t < 0) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    if (!this.state.explored[t]) {
      el.innerHTML = `<h3>Unexplored</h3><p class="muted">Send a unit to chart it.</p>`;
      return;
    }
    const terr = TERRAIN[this.world.terrain[t]];
    const land = enterCost(unitDef('sentinel-trooper'), this.world.terrain[t]);
    const seen = this.visible.has(t) ? '' : '<p class="muted">Last seen. Out of sight now.</p>';
    el.innerHTML = `
      <h3>${terr.name}</h3>
      <p><img src="art/icon_compute.png" alt="" width="16" height="16" /> ${terr.yields.compute}
         <img src="art/icon_matter.png" alt="" width="16" height="16" /> ${terr.yields.matter}
         <span class="muted">· ${land === null ? 'impassable on foot' : `move cost ${land}`}</span></p>
      ${seen}`;
  }

  private renderReckon() {
    const el = this.ui.querySelector<HTMLElement>('.reckon')!;
    const bar = this.ui.querySelector<HTMLElement>('.watch-bar')!;
    bar.innerHTML = this.beat === 'watch' ? `<button data-act="skip">Watching… Space to skip</button>` : '';
    if (this.beat !== 'reckon' || !this.report) {
      el.innerHTML = '';
      el.classList.remove('show');
      return;
    }
    const lines = this.report.events.map(describe).filter(Boolean);
    el.classList.add('show');
    el.innerHTML = `
      <h2>Reckon <small>cycle ${this.report.cycle}</small></h2>
      <p class="narration">“${escapeHtml(this.report.narration)}”</p>
      <ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>
      <button class="end" data-act="reckon-ok">Continue <small>Enter</small></button>`;
  }
}

function describe(e: GameEvent): string {
  switch (e.kind) {
    case 'yield':
      return `+${formatAmount(e.compute)} Compute, +${formatAmount(e.matter)} Matter${e.brownout ? ' <em class="warn">(brownout: half yields)</em>' : ''}`;
    case 'built':
      return `${unitDef(e.unit).name} online.`;
    case 'build-started':
      return `Started building ${unitDef(e.unit).name}.`;
    case 'build-blocked':
      return `Couldn't build ${unitDef(e.unit).name}: ${e.reason}.`;
    case 'discovered': {
      const extra = [e.ruins ? `${e.ruins} ruin${e.ruins > 1 ? 's' : ''}` : '', e.rifts ? `<em class="warn">${e.rifts} abyssal rift${e.rifts > 1 ? 's' : ''}</em>` : '']
        .filter(Boolean)
        .join(', ');
      return `Charted ${e.tiles} new hexes${extra ? `, including ${extra}` : ''}.`;
    }
    case 'order-rejected':
      return `Order failed: ${e.reason}.`;
    case 'moved':
      return '';
  }
}
