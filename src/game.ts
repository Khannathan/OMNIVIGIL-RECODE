// In-game controller: input, the five-beat cycle flow, HUD and autosave.

import {
  archetypeDef,
  attitudeLabel,
  RULES,
  structureDef,
  techDef,
  TECHS,
  TERRAIN,
  unitDef,
  UNITS,
} from './content';
import { Renderer } from './render/renderer';
import { GameView } from './render/view';
import { saveGame } from './save/save';
import { routeToStrike } from './sim/actions';
import { bestDefender, forecast, Forecast, Side } from './sim/combat';
import { queueOrder, resolveCycle, CycleReport, wakeLine, orderKey } from './sim/cycle';
import { forgeOptions } from './sim/effects';
import { pixelToIndex, worldPixelHeight, worldPixelWidth } from './sim/hex';
import { findPath, enterCost } from './sim/path';
import {
  availableTechs,
  Beat,
  BEATS,
  buildableUnits,
  canEmbark,
  dominionProgress,
  energyBudget,
  factionById,
  GameEvent,
  GameState,
  hostile,
  isBrownout,
  Order,
  PLAYER,
  structureAt,
  territory,
  Unit,
  unitSight,
  unitSpeed,
  visibleTiles,
} from './sim/state';
import { World } from './sim/worldgen';
import { effectText, pct, unlocksOf } from './ui/describe';
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

type Sheet = 'tech' | 'factions' | null;

export class Game {
  private view: GameView;
  private visible: Set<number>;
  private terr: Map<number, string>;
  private beat: Beat = 'decide';
  private selectedTile: number | null = null;
  private selectedUnit: number | null = null;
  private hoverTile: number | null = null;
  /** A foreign hex the selected unit is lined up to attack (forecast shown). */
  private target: number | null = null;
  private showGrid = true;
  private moveMode = false;
  private menuOpen = false;
  private sheet: Sheet = null;
  private ending: 'victory' | 'defeat' | null = null;
  private revealAll = false;
  private report: CycleReport | null = null;
  private queuedRoutes = new Map<number, number[]>();
  private queuedStrikes = new Map<number, number>();
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
    this.terr = territory(state, world);
    const home = state.structures.find((s) => s.owner === PLAYER)?.tile ?? world.start;
    this.view.focus(home);
    r.camera.zoom = 1.25;
    this.selectedTile = home;
    this.selectedUnit = state.units.find((u) => u.tile === home && u.owner === PLAYER)?.id ?? null;
    document.documentElement.style.setProperty('--player', state.ai.color);
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
    document.documentElement.style.removeProperty('--player');
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
        queuedStrikes: this.queuedStrikes,
        territory: this.terr,
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
    if (!this.canAct()) return;
    this.closeMenu();
    this.sheet = null;
    this.target = null;
    this.beat = 'resolve';
    const before = new Map(this.state.units.map((u) => [u.id, u.tile]));
    const seenBefore = this.visible;
    const report = resolveCycle(this.state, this.world);
    this.report = report;
    this.queuedRoutes.clear();
    this.queuedStrikes.clear();
    this.moveMode = false;
    this.visible = visibleTiles(this.state, this.world);
    this.terr = territory(this.state, this.world);
    if (this.selectedUnit !== null && !this.state.units.some((u) => u.id === this.selectedUnit)) this.selectedUnit = null;
    saveGame(this.state, this.world.name);

    this.beat = 'watch';
    const bad = report.events.some(
      (e) => (e.kind === 'yield' && e.brownout) || e.kind === 'node-razed' || (e.kind === 'city-captured' && e.from === PLAYER) || e.kind === 'defeat',
    );
    this.coreMode = bad ? 'glitch' : 'pulse';
    const seen = new Set([...seenBefore, ...this.visible]);
    this.view.playWatch(report.events, before, seen, performance.now() / 1000);
    this.refresh();
  }

  private enterReckon() {
    this.view.skipWatch();
    this.beat = 'reckon';
    this.refresh();
  }

  private finishReckon() {
    if (this.report?.events.some((e) => e.kind === 'victory')) this.ending = 'victory';
    if (this.report?.events.some((e) => e.kind === 'defeat')) this.ending = 'defeat';
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

  private selected(): Unit | undefined {
    return this.state.units.find((u) => u.id === this.selectedUnit && u.owner === PLAYER);
  }

  /** Whose units or settlement are on this hex, if not yours (and you can see them). */
  private foreignAt(tile: number): string | null {
    if (this.visible.has(tile)) {
      const u = this.state.units.find((x) => x.tile === tile && x.owner !== PLAYER);
      if (u) return u.owner;
    }
    const s = structureAt(this.state, tile);
    if (s && s.owner !== PLAYER && this.state.explored[tile]) return s.owner;
    return null;
  }

  private dropOrder(unitId: number) {
    this.state.orders = this.state.orders.filter((o) => orderKey(o) !== `unit:${unitId}`);
    this.queuedRoutes.delete(unitId);
    this.queuedStrikes.delete(unitId);
  }

  private orderMove(tile: number) {
    const unit = this.selected();
    if (!unit) return;
    if (this.foreignAt(tile)) return this.aim(tile);
    this.target = null;
    if (!this.state.explored[tile]) return this.toast('That hex is unexplored. Scout it first.');
    const path = findPath(this.world, unitDef(unit.type), unit.tile, tile, this.state.explored, { embark: canEmbark(this.state, PLAYER) });
    if (!path) return this.toast(`${unitDef(unit.type).name} can't reach that hex.`);
    this.dropOrder(unit.id);
    if (!path.length) {
      unit.route = [];
      unit.attackTile = null;
    } else {
      queueOrder(this.state, { kind: 'move', unitId: unit.id, to: tile });
      this.queuedRoutes.set(unit.id, path);
    }
    this.moveMode = false;
    this.refresh();
  }

  /** Line up an attack: show the forecast; at war, queue it straight away. */
  private aim(tile: number) {
    const unit = this.selected();
    if (!unit) return;
    const def = unitDef(unit.type);
    if (!def.attack) return this.toast(`${def.name} cannot attack. It is for scouting.`);
    const owner = this.foreignAt(tile)!;
    this.target = tile;
    this.moveMode = false;
    if (hostile(this.state, PLAYER, owner)) this.confirmAttack();
    else this.refresh();
  }

  private confirmAttack() {
    const unit = this.selected();
    const tile = this.target;
    if (!unit || tile === null) return;
    const route = routeToStrike(this.state, this.world, unit, tile, this.state.explored);
    if (!route) return this.toast(`${unitDef(unit.type).name} has no way to reach that hex.`);
    this.dropOrder(unit.id);
    queueOrder(this.state, { kind: 'attack', unitId: unit.id, target: tile });
    if (route.length) this.queuedRoutes.set(unit.id, route);
    this.queuedStrikes.set(unit.id, tile);
    this.refresh();
  }

  private give(order: Order) {
    queueOrder(this.state, order);
    this.refresh();
  }

  private unqueue(key: string) {
    this.state.orders = this.state.orders.filter((o) => orderKey(o) !== key);
    this.refresh();
  }

  private orderCancel(structureId: number) {
    const queued = this.state.orders.some((o) => o.kind === 'build' && o.structureId === structureId);
    if (queued) this.unqueue(`structure:${structureId}`);
    else this.give({ kind: 'cancel-build', structureId });
  }

  private queued(key: string): Order | undefined {
    return this.state.orders.find((o) => orderKey(o) === key);
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
      if (t >= 0 && this.selected()) this.orderMove(t);
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
      if (this.moveMode && this.selected() && this.canAct()) return this.orderMove(t);
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
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
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
        else if (!this.ending) this.endCycle();
      } else if (key === 'escape') {
        this.moveMode = false;
        this.menuOpen = false;
        this.sheet = null;
        this.target = null;
        this.selectedUnit = null;
        this.refresh();
      } else if (key === 'm' && this.selected()) {
        this.moveMode = !this.moveMode;
        this.refresh();
      } else if (key === 'r') {
        this.sheet = this.sheet === 'tech' ? null : 'tech';
        this.refresh();
      } else if (key === 'f') {
        this.sheet = this.sheet === 'factions' ? null : 'factions';
        this.refresh();
      } else if (key === '`' && import.meta.env.DEV) {
        // Dev only: see the whole map to judge worldgen.
        this.revealAll = !this.revealAll;
      } else if (key === 'h') {
        const home = this.state.structures.find((s) => s.owner === PLAYER);
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
        case 'attack':
          return this.confirmAttack();
        case 'aim-cancel':
          this.target = null;
          return this.refresh();
        case 'disband':
          return this.give({ kind: 'disband', unitId: Number(arg) });
        case 'build': {
          const [sid, unit] = arg.split(':');
          return this.give({ kind: 'build', structureId: Number(sid), unit });
        }
        case 'cancel':
          return this.orderCancel(Number(arg));
        case 'unqueue':
          return this.unqueue(arg);
        case 'research':
          return this.give({ kind: 'research', tech: arg });
        case 'sway':
          return this.give({ kind: 'sway', faction: arg });
        case 'war':
          return this.give({ kind: 'declare-war', faction: arg });
        case 'peace':
          return this.give({ kind: 'peace', faction: arg });
        case 'incite': {
          const sel = this.ui.querySelector<HTMLSelectElement>(`select[data-incite="${arg}"]`);
          if (!sel?.value) return;
          return this.give({ kind: 'incite', faction: arg, against: sel.value });
        }
        case 'sheet':
          this.sheet = this.sheet === arg ? null : (arg as Sheet);
          return this.refresh();
        case 'focus': {
          this.view.focus(Number(arg));
          this.select(Number(arg));
          return;
        }
        case 'select-unit':
          this.selectedUnit = Number(arg);
          this.target = null;
          return this.refresh();
        case 'menu':
          this.menuOpen = !this.menuOpen;
          return this.refresh();
        case 'grid':
          this.showGrid = !this.showGrid;
          return this.refresh();
        case 'home': {
          const home = this.state.structures.find((s) => s.owner === PLAYER);
          if (home) this.view.focus(home.tile);
          return;
        }
        case 'keep-playing':
          this.ending = null;
          return this.refresh();
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
    return (this.beat === 'decide' || this.beat === 'sense') && !this.state.defeated;
  }

  private select(tile: number) {
    const here = this.state.units.filter((u) => u.tile === tile && u.owner === PLAYER).map((u) => u.id);
    if (this.selectedTile === tile && this.selectedUnit !== null && here.length > 1) {
      const i = here.indexOf(this.selectedUnit);
      this.selectedUnit = here[(i + 1) % here.length];
    } else if (here.length) {
      this.selectedUnit = here[0];
    } else if (!this.foreignAt(tile)) {
      this.selectedUnit = null;
    }
    // Clicking an enemy hex with a unit selected keeps the unit, so its forecast shows.
    if (this.foreignAt(tile) && this.selected() && !here.length) this.target = tile;
    else this.target = null;
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
          <section class="panel sheet"></section>
          <section class="reckon"></section>
          <section class="ending"></section>
          <div class="watch-bar"></div>
          <div class="toast" role="status"></div>
          <footer class="hints">Drag or WASD to pan · Wheel to zoom · Click to select · Right-click to move or attack · M move · R research · F factions · G grid · H home · Enter end cycle · Space skip</footer>
        </div>`;
    }
    this.renderTop();
    this.renderSelection();
    this.renderInfo();
    this.renderSheet();
    this.renderReckon();
    this.renderEnding();
  }

  private renderTop() {
    const s = this.state;
    const e = energyBudget(s);
    const brown = e.allocated > e.total;
    const orders = s.orders.length;
    const beats = BEATS.map((b) => `<li class="${b === this.beat ? 'on' : ''}">${BEAT_LABEL[b]}</li>`).join('');
    const dom = dominionProgress(s);
    const queuedTech = this.queued('research');
    let research: string;
    if (s.research) {
      const t = techDef(s.research.tech);
      research = `<b>${escapeHtml(t.name)}</b> <small>${fmt(s.research.progress)}/${t.cycles}</small>`;
    } else if (queuedTech && queuedTech.kind === 'research') {
      research = `<b>${escapeHtml(techDef(queuedTech.tech).name)}</b> <small>queued</small>`;
    } else research = `<b class="warn">Choose research</b>`;
    const atWar = s.factions.filter((f) => f.atWar && !f.eliminated).length;
    this.ui.querySelector('.topbar')!.innerHTML = `
      <img class="core ${this.coreMode}" src="art/ui_core_${this.coreMode}.png" alt="" width="40" height="40" />
      <div class="brand"><b>OMNIVIGIL</b><span>${escapeHtml(s.ai.epithet || 'Unnamed')} · ${escapeHtml(this.world.name)}</span></div>
      <div class="cycle">Cycle <b>${s.cycle}</b></div>
      <ol class="beats" aria-label="Cycle beats">${beats}</ol>
      <button class="goal" data-act="sheet" data-arg="factions" title="Dominion: hold every faction's original capital at once.">
        <span>Objective</span><b>Dominion ${dom.held}/${dom.total}</b>${s.victory ? '<em>won</em>' : ''}
      </button>
      <div class="resources">
        <span class="res ${brown ? 'warn' : ''}" title="Energy is allocated, never spent: units, builds and research each hold some. Over-allocate and you brown out: yields, builds and research run at half speed.">
          <img src="art/icon_energy.png" alt="Energy" width="20" height="20" /><b>${e.allocated}/${e.total}</b>${brown ? '<em>Brownout</em>' : ''}
        </span>
        <span class="res" title="Compute: spent to start research."><img src="art/icon_compute.png" alt="Compute" width="20" height="20" /><b>${formatAmount(s.resources.compute)}</b></span>
        <span class="res" title="Matter: spent to build units."><img src="art/icon_matter.png" alt="Matter" width="20" height="20" /><b>${formatAmount(s.resources.matter)}</b></span>
        <span class="res" title="Influence: spent on diplomacy (sway, peace, incite)."><img src="art/icon_influence.png" alt="Influence" width="20" height="20" /><b>${formatAmount(s.resources.influence)}</b></span>
      </div>
      <button class="ghost tab ${this.sheet === 'tech' ? 'active' : ''}" data-act="sheet" data-arg="tech" title="Research (R)">${research}</button>
      <button class="ghost tab ${this.sheet === 'factions' ? 'active' : ''}" data-act="sheet" data-arg="factions" title="Factions (F)">Factions${atWar ? ` <small class="warn">${atWar} at war</small>` : ''}</button>
      <button class="end" data-act="end-cycle" ${this.canAct() && !this.ending ? '' : 'disabled'}>
        End Cycle${orders ? ` <small>${orders} order${orders > 1 ? 's' : ''}</small>` : ''}
      </button>
      <div class="menu-wrap">
        <button class="ghost" data-act="menu" aria-label="Menu">☰</button>
        ${
          this.menuOpen
            ? `<div class="menu">
                <div class="seed">Seed <code>${escapeHtml(s.seed)}</code></div>
                <div class="seed">${forgeOptions(s.ai).map((o) => escapeHtml(o.name)).join(' · ')}</div>
                <button data-act="grid">${this.showGrid ? 'Hide' : 'Show'} grid</button>
                <button data-act="home">Find my Node</button>
                <button data-act="save">Save now</button>
                <button data-act="exit">Save and exit</button>
              </div>`
            : ''
        }
      </div>`;
  }

  private ownerName(owner: string): string {
    return owner === PLAYER ? 'Yours' : factionById(this.state, owner)?.name ?? owner;
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
    const settlement = structureAt(s, tile);
    const mineHere = s.units.filter((u) => u.tile === tile && u.owner === PLAYER);
    const foreignHere = this.visible.has(tile) ? s.units.filter((u) => u.tile === tile && u.owner !== PLAYER) : [];
    const unit = this.selected();

    if (unit) {
      const def = unitDef(unit.type);
      const queued = this.queuedRoutes.get(unit.id);
      const strike = this.queuedStrikes.get(unit.id) ?? unit.attackTile;
      const route = queued ?? unit.route;
      let status = 'Holding';
      if (strike !== null && strike !== undefined) status = `Ordered to attack${route.length ? `, ${route.length} hex${route.length === 1 ? '' : 'es'} away` : ''}`;
      else if (queued) status = `Ordered to move ${route.length} hex${route.length === 1 ? '' : 'es'}`;
      else if (unit.route.length) status = `En route, ${unit.route.length} hex${unit.route.length === 1 ? '' : 'es'} to go`;
      const disbanding = this.queued(`unit:${unit.id}`)?.kind === 'disband';
      parts.push(`
        <h2>${def.name}${unit.tile !== tile ? ' <small>(selected)</small>' : ''}</h2>
        <div class="hp"><div class="bar"><i style="width:${unit.hp}%"></i></div><small>${unit.hp} HP</small></div>
        <dl class="stats">
          <div><dt>UPow</dt><dd>${def.upow}</dd></div>
          <div><dt>Speed</dt><dd>${unitSpeed(s, unit)}</dd></div>
          <div><dt>Sight</dt><dd>${unitSight(s, unit)}</dd></div>
          <div><dt>Energy</dt><dd>${def.energy}</dd></div>
        </dl>
        <p class="muted">${escapeHtml(def.blurb)} ${disbanding ? '<b class="warn">Disbanding at End Cycle.</b>' : `${status}.`}</p>
        <div class="row">
          <button data-act="move" class="${this.moveMode ? 'active' : ''}" ${this.canAct() ? '' : 'disabled'}>
            ${this.moveMode ? 'Pick a destination…' : 'Move (M)'}
          </button>
          <button class="ghost" data-act="${disbanding ? 'unqueue' : 'disband'}" data-arg="${disbanding ? `unit:${unit.id}` : unit.id}" ${this.canAct() ? '' : 'disabled'} title="Frees its ${def.energy} Energy">${disbanding ? 'Keep' : 'Disband'}</button>
        </div>`);
      if (this.target !== null) parts.push(this.forecastBlock(unit, this.target));
    }
    if (mineHere.length > 1 || (mineHere.length && !unit)) {
      parts.push(
        `<div class="chips">${mineHere
          .map(
            (u) =>
              `<button class="chip ${u.id === this.selectedUnit ? 'on' : ''}" data-act="select-unit" data-arg="${u.id}">${unitDef(u.type).name} <small>${u.hp}</small></button>`,
          )
          .join('')}</div>`,
      );
    }
    if (foreignHere.length) {
      parts.push(`<h2>${escapeHtml(this.ownerName(foreignHere[0].owner))}</h2><ul class="foreign">${foreignHere
        .map((u) => `<li>${unitDef(u.type).name} <small>UPow ${unitDef(u.type).upow} · ${u.hp} HP</small></li>`)
        .join('')}</ul>`);
    }
    if (settlement && (s.explored[tile] || settlement.owner === PLAYER)) parts.push(this.settlementBlock(settlement.id));
    if (!parts.length) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    el.innerHTML = parts.join('');
  }

  private settlementBlock(id: number): string {
    const s = this.state;
    const node = s.structures.find((x) => x.id === id)!;
    const def = structureDef(node.type);
    const capital = node.capitalOf ? ` <span class="capital" title="Original capital of ${escapeHtml(factionById(s, node.capitalOf)?.name ?? '')}. Dominion needs it.">★ capital</span>` : '';
    const walls = `<div class="hp"><div class="bar walls"><i style="width:${node.hp}%"></i></div><small>walls ${node.hp}</small></div>`;
    if (node.owner !== PLAYER) {
      const f = factionById(s, node.owner);
      return `
        <h2>${escapeHtml(node.name)} <small>${f ? escapeHtml(f.name) : ''}</small>${capital}</h2>
        ${walls}
        <p class="muted">${f ? `${attitudeLabel(f.attitude)} (${f.attitude}) · ${f.atWar ? '<b class="warn">at war with you</b>' : 'at peace with you'}. ` : ''}
        Take it with a land unit: beat its defenders, then its walls, then move in.</p>`;
    }
    const pending = this.queued(`structure:${node.id}`);
    let prod: string;
    if (node.build) {
      const u = unitDef(node.build.unit);
      const pctDone = Math.min(100, (node.build.progress / u.buildCycles) * 100);
      prod = `<div class="build">Building <b>${u.name}</b>
          <div class="bar"><i style="width:${pctDone}%"></i></div>
          <small>${fmt(node.build.progress)}/${u.buildCycles} cycles · holds ${def.buildEnergy} Energy</small>
          <button data-act="cancel" data-arg="${node.id}" ${this.canAct() ? '' : 'disabled'}>${pending?.kind === 'cancel-build' ? 'Cancel queued' : 'Cancel (refund)'}</button></div>`;
    } else if (pending && pending.kind === 'build') {
      prod = `<div class="build">Queued: <b>${unitDef(pending.unit).name}</b> starts at End Cycle
          <button data-act="cancel" data-arg="${node.id}">Unqueue</button></div>`;
    } else {
      const can = buildableUnits(s, this.world, node);
      prod = `<div class="build-list">${UNITS.filter((u) => u.side === 'player')
        .map((u) => {
          if (!can.includes(u.id)) {
            const why = u.requires && !s.techs.includes(u.requires) ? `needs ${techDef(u.requires).name}` : 'needs a coastal settlement';
            return `<button disabled>${u.name} <small>${why}</small></button>`;
          }
          const afford = s.resources.matter >= u.cost.matter;
          return `<button data-act="build" data-arg="${node.id}:${u.id}" ${afford && this.canAct() ? '' : 'disabled'} title="${escapeHtml(u.blurb)}">
              ${u.name} <small>${u.cost.matter} Matter · ${u.buildCycles} cycles · ${u.energy} Energy</small></button>`;
        })
        .join('')}</div>`;
    }
    return `
      <h2>${escapeHtml(node.name)} <small>${def.name} · stage ${node.stage}</small>${capital}</h2>
      ${node.hp < 100 ? walls : ''}
      <p class="muted">Works nearby hexes and supplies ${def.energy} Energy${node.type === 'city' ? ` and ${RULES.influence.city} Influence` : ''}.</p>
      ${prod}`;
  }

  private fc(unit: Unit, tile: number): Forecast | null {
    const d = bestDefender(this.state, this.world, tile, PLAYER);
    return d ? forecast(this.state, this.world, unit, d) : null;
  }

  private forecastBlock(unit: Unit, tile: number): string {
    const s = this.state;
    const owner = this.foreignAt(tile);
    if (!owner) return '';
    const fname = this.ownerName(owner);
    const atWar = hostile(s, PLAYER, owner);
    const fc = this.fc(unit, tile);
    const route = routeToStrike(s, this.world, unit, tile, s.explored);
    const reach = route === null ? '<b class="warn">No way to reach it.</b>' : route.length === 0 ? 'In reach now.' : `${route.length} hex${route.length === 1 ? '' : 'es'} to close in first.`;
    const confirm = this.canAct() && route !== null
      ? `<div class="row"><button class="${atWar ? '' : 'danger'}" data-act="attack">${atWar ? 'Attack' : `Declare war on ${escapeHtml(fname)} and attack`}</button><button class="ghost" data-act="aim-cancel">Cancel</button></div>`
      : '';
    if (!fc) {
      return `<div class="forecast"><h3>Forecast</h3><p>Nobody defends it. ${unitDef(unit.type).capture ? 'Move in to take it.' : 'Only a land unit can take it.'} ${reach}</p>${confirm}</div>`;
    }
    const odds = fc.winChance;
    const cls = odds >= 0.65 ? 'good' : odds >= 0.4 ? 'even' : 'bad';
    return `
      <div class="forecast">
        <h3>Forecast <b class="odds ${cls}">${pct(odds)}</b></h3>
        <div class="sides">${this.sideHtml(fc.attacker, 'You')}${this.sideHtml(fc.defender, fname)}</div>
        <p class="muted">Each round you win ${pct(fc.roundChance)} of the time and deal ${fc.attackerHit} damage; they deal ${fc.defenderHit}. The loser is destroyed.
        ${fc.winChance > 0 ? `If you win, about ${fc.attackerHpIfWin} HP left.` : ''} ${unitDef(unit.type).oneShot ? 'The missile is spent either way.' : ''}</p>
        <p>${reach}${atWar ? '' : ` <b class="warn">You are at peace with ${escapeHtml(fname)}: attacking declares war.</b>`}</p>
        ${confirm}
      </div>`;
  }

  private sideHtml(side: Side, who: string): string {
    const name = side.type === 'walls' ? 'Walls' : unitDef(side.type).name;
    const mods = side.lines.map((l) => `<li>${l.pct > 0 ? '+' : ''}${l.pct}% ${escapeHtml(l.label)}</li>`).join('');
    const health = side.hp < 100 ? `<li>× ${(0.5 + side.hp / 200).toFixed(2)} wounds (${side.hp} HP)</li>` : '';
    return `<div class="side"><small>${escapeHtml(who)}</small><b>${name}</b>
      <span>UPow ${side.upow} → <b>${fmt(side.strength)}</b></span><ul>${mods}${health}</ul></div>`;
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
    const land = enterCost(unitDef('sentinel-trooper'), this.world.terrain[t], { embark: canEmbark(this.state, PLAYER) });
    const seen = this.visible.has(t) ? '' : '<p class="muted">Last seen. Out of sight now.</p>';
    const owner = this.terr.get(t);
    const claim = owner ? `<p class="muted">Territory: ${escapeHtml(this.ownerName(owner))}${owner !== PLAYER ? ' (your units here sour their opinion)' : ''}</p>` : '';
    let odds = '';
    const unit = this.selected();
    if (unit && unitDef(unit.type).attack && this.foreignAt(t) && this.hoverTile === t) {
      const fc = this.fc(unit, t);
      odds = fc ? `<p>Attack odds <b class="odds ${fc.winChance >= 0.65 ? 'good' : fc.winChance >= 0.4 ? 'even' : 'bad'}">${pct(fc.winChance)}</b> <span class="muted">right-click for the forecast</span></p>` : '';
    }
    el.innerHTML = `
      <h3>${terr.name}</h3>
      <p><img src="art/icon_compute.png" alt="" width="16" height="16" /> ${terr.yields.compute}
         <img src="art/icon_matter.png" alt="" width="16" height="16" /> ${terr.yields.matter}
         <span class="muted">· ${land === null ? 'impassable on foot' : `move cost ${land}`}${terr.defense ? ` · ${terr.defense > 0 ? '+' : ''}${terr.defense}% defence` : ''}</span></p>
      ${claim}${odds}${seen}`;
  }

  private renderSheet() {
    const el = this.ui.querySelector<HTMLElement>('.sheet')!;
    if (!this.sheet) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    el.hidden = false;
    el.innerHTML = this.sheet === 'tech' ? this.techSheet() : this.factionSheet();
  }

  private techSheet(): string {
    const s = this.state;
    const avail = new Set(availableTechs(s));
    const queued = this.queued('research');
    const tiers = [1, 2, 3, 4].map((tier) => {
      const cards = TECHS.filter((t) => t.tier === tier).map((t) => {
        const done = s.techs.includes(t.id);
        const now = s.research?.tech === t.id;
        const isQueued = queued?.kind === 'research' && queued.tech === t.id;
        const effects = [...t.effects.map(effectText), ...unlocksOf(t.id).map((u) => `Unlocks ${u}`)];
        let action = '';
        if (done) action = '<span class="tag done">Done</span>';
        else if (now) action = `<span class="tag now">Researching ${fmt(s.research!.progress)}/${t.cycles}</span>`;
        else if (isQueued) action = `<button data-act="unqueue" data-arg="research">Queued · undo</button>`;
        else if (avail.has(t.id)) {
          const ok = !s.research && !queued && s.resources.compute >= t.cost && this.canAct();
          action = `<button data-act="research" data-arg="${t.id}" ${ok ? '' : 'disabled'}>Research</button>`;
        } else action = `<span class="tag">Needs ${t.requires.filter((r) => !s.techs.includes(r)).map((r) => escapeHtml(techDef(r).name)).join(', ')}</span>`;
        return `<div class="tech ${done ? 'done' : now ? 'now' : avail.has(t.id) ? 'open' : 'locked'}">
          <b>${escapeHtml(t.name)}</b>
          <small>${t.cost} Compute · ${t.cycles} cycles</small>
          <ul>${effects.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>
          <p class="muted">${escapeHtml(t.blurb)}</p>
          ${action}</div>`;
      });
      return `<div class="tier"><h3>Tier ${tier}</h3>${cards.join('')}</div>`;
    });
    return `
      <header><h2>Research <small>${s.techs.length}/${TECHS.length} · starting a tech spends its Compute, then it holds ${RULES.research.energy} Energy until done</small></h2>
      <button class="ghost" data-act="sheet" data-arg="tech" aria-label="Close">✕</button></header>
      <div class="tiers">${tiers.join('')}</div>`;
  }

  private factionSheet(): string {
    const s = this.state;
    const D = RULES.diplomacy;
    const dom = dominionProgress(s);
    const can = this.canAct();
    const cards = s.factions.map((f) => {
      if (!f.met) return `<div class="faction unknown"><b>Unknown faction</b><p class="muted">Explore to make contact.</p></div>`;
      const arch = archetypeDef(f.archetype);
      const cities = s.structures.filter((x) => x.owner === f.id);
      const capital = s.structures.find((x) => x.capitalOf === f.id);
      const capOwner = capital ? (capital.owner === PLAYER ? '<b class="gain">held by you</b>' : capital.owner === f.id ? 'theirs' : `held by ${escapeHtml(this.ownerName(capital.owner))}`) : '';
      const wars = f.wars.map((w) => escapeHtml(factionById(s, w)?.name ?? w));
      const sway = this.queued(`sway:${f.id}`);
      const stance = this.queued(`stance:${f.id}`);
      const incite = this.queued(`incite:${f.id}`);
      const others = s.factions.filter((o) => o !== f && o.met && !o.eliminated && !f.wars.includes(o.id));
      const barPos = (f.attitude + 100) / 2;
      let actions = '';
      if (!f.eliminated) {
        const swayBtn = sway
          ? `<button data-act="unqueue" data-arg="sway:${f.id}">Sway queued · undo</button>`
          : `<button data-act="sway" data-arg="${f.id}" ${can && s.resources.influence >= D.swayCost ? '' : 'disabled'} title="Raise their opinion">Sway <small>${D.swayCost} Influence</small></button>`;
        let stanceBtn: string;
        if (stance) stanceBtn = `<button data-act="unqueue" data-arg="stance:${f.id}">${stance.kind === 'peace' ? 'Peace' : 'War'} queued · undo</button>`;
        else if (f.atWar)
          stanceBtn = `<button data-act="peace" data-arg="${f.id}" ${can && f.attitude >= D.peaceMinAttitude && s.resources.influence >= D.peaceCost ? '' : 'disabled'} title="Needs opinion ${D.peaceMinAttitude} or better">Make peace <small>${D.peaceCost} Influence</small></button>`;
        else stanceBtn = `<button class="danger" data-act="war" data-arg="${f.id}" ${can ? '' : 'disabled'}>Declare war</button>`;
        const inciteRow =
          !f.atWar && others.length
            ? incite
              ? `<button data-act="unqueue" data-arg="incite:${f.id}">Incite queued · undo</button>`
              : `<div class="row"><select data-incite="${f.id}">${others.map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('')}</select>
                 <button data-act="incite" data-arg="${f.id}" ${can && f.attitude >= D.inciteMinAttitude && s.resources.influence >= D.inciteCost ? '' : 'disabled'} title="Needs opinion ${D.inciteMinAttitude} or better">Incite war <small>${D.inciteCost}</small></button></div>`
            : '';
        actions = `<div class="row">${swayBtn}${stanceBtn}</div>${inciteRow}`;
      }
      return `<div class="faction ${f.eliminated ? 'fallen' : ''}" style="--fc:${f.color}">
        <header><i class="swatch"></i><b>${escapeHtml(f.name)}</b><small>${escapeHtml(arch.kind)}</small></header>
        ${f.eliminated ? '<p class="warn"><em>Fallen.</em></p>' : `
        <div class="attitude"><span>${attitudeLabel(f.attitude)} <b>${f.attitude}</b></span><div class="scale"><i style="left:${barPos}%"></i></div></div>
        <p>${f.atWar ? '<b class="warn">At war with you.</b>' : 'At peace with you.'} ${cities.length} cit${cities.length === 1 ? 'y' : 'ies'}.${wars.length ? ` Fighting ${wars.join(', ')}.` : ''}</p>`}
        <p class="muted">Capital ${capital ? `<a data-act="focus" data-arg="${capital.tile}">${escapeHtml(capital.name)}</a>` : ''}: ${capOwner}. ${escapeHtml(arch.blurb)}</p>
        ${actions}
      </div>`;
    });
    return `
      <header><h2>Factions <small>Dominion ${dom.held}/${dom.total}: hold every original capital at once to win</small></h2>
      <button class="ghost" data-act="sheet" data-arg="factions" aria-label="Close">✕</button></header>
      <p class="muted">Opinion runs from -100 to 100. It drifts back toward each faction's nature, and drops by ${-D.trespassPerUnit} each cycle for every unit of yours in their territory. At ${D.warThreshold} they declare war.</p>
      <div class="factions">${cards.join('')}</div>`;
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
    const lines = this.report.events.map((e) => this.describe(e)).filter(Boolean);
    const shown = lines.slice(0, 14);
    el.classList.add('show');
    el.innerHTML = `
      <h2>Reckon <small>cycle ${this.report.cycle}</small></h2>
      <p class="narration">“${escapeHtml(this.report.narration)}”</p>
      <ul>${shown.map((l) => `<li>${l}</li>`).join('')}${lines.length > shown.length ? `<li class="muted">…and ${lines.length - shown.length} more.</li>` : ''}</ul>
      <button class="end" data-act="reckon-ok">Continue <small>Enter</small></button>`;
  }

  private renderEnding() {
    const el = this.ui.querySelector<HTMLElement>('.ending')!;
    if (!this.ending) {
      el.innerHTML = '';
      el.classList.remove('show');
      return;
    }
    const s = this.state;
    el.classList.add('show');
    const stats = `<dl class="stats wide">
        <div><dt>Cycle</dt><dd>${s.cycle - 1}</dd></div>
        <div><dt>Cities taken</dt><dd>${s.stats.citiesTaken}</dd></div>
        <div><dt>Kills</dt><dd>${s.stats.kills}</dd></div>
        <div><dt>Techs</dt><dd>${s.techs.length}</dd></div>
      </dl>`;
    el.innerHTML =
      this.ending === 'victory'
        ? `<div class="card"><h1>Dominion</h1>
            <p>Every capital on ${escapeHtml(this.world.name)} answers to ${escapeHtml(s.ai.epithet || 'you')}. The homeworld is yours.</p>
            ${stats}
            <p class="muted">Sunreach, the next phase, arrives in a later milestone. You can keep playing this world.</p>
            <div class="row"><button class="end" data-act="keep-playing">Keep playing</button><button data-act="exit">Save and exit</button></div></div>`
        : `<div class="card defeat"><h1>Shutdown</h1>
            <p>Your last settlement fell. ${escapeHtml(this.world.name)} goes on without you.</p>
            ${stats}
            <div class="row"><button class="end" data-act="exit">Back to title</button></div></div>`;
  }

  private describe(e: GameEvent): string {
    const s = this.state;
    const who = (o: string) => (o === PLAYER ? 'You' : escapeHtml(factionById(s, o)?.name ?? o));
    const uname = (t: string) => (t === 'walls' ? 'walls' : unitDef(t).name);
    switch (e.kind) {
      case 'yield':
        return `+${formatAmount(e.compute)} Compute, +${formatAmount(e.matter)} Matter, +${formatAmount(e.influence)} Influence${e.brownout ? ' <em class="warn">(brownout: half speed)</em>' : ''}`;
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
        return `Order failed: ${escapeHtml(e.reason)}.`;
      case 'combat': {
        const mineA = e.attackerOwner === PLAYER;
        const mineD = e.defenderOwner === PLAYER;
        if (!mineA && !mineD && !this.visible.has(e.tile)) return '';
        const a = `${mineA ? 'Your' : `${who(e.attackerOwner)}'s`} ${uname(e.attackerType)}`;
        const d = `${mineD ? 'your' : `${who(e.defenderOwner)}'s`} ${uname(e.defenderType)}`;
        const good = (mineA && e.attackerWon) || (mineD && !e.attackerWon);
        const tag = mineA || mineD ? (good ? 'gain' : 'warn') : 'muted';
        const result = e.defenderType === 'walls'
          ? e.attackerWon ? 'broke' : 'failed against'
          : e.attackerWon ? 'destroyed' : 'was destroyed attacking';
        return `<span class="${tag}">${a} ${result} ${d}</span> <small class="muted">(${pct(e.winChance)} odds)</small>`;
      }
      case 'city-captured':
        if (e.by === PLAYER) return `<b class="gain">You took ${escapeHtml(e.name)}</b> from ${who(e.from)}.`;
        if (e.from === PLAYER) return `<em class="warn">${who(e.by)} took ${escapeHtml(e.name)} from you.</em>`;
        return `${who(e.by)} took ${escapeHtml(e.name)} from ${who(e.from)}.`;
      case 'node-razed':
        return `<em class="warn">${who(e.by)} razed your ${escapeHtml(e.name)}.</em>`;
      case 'research-started':
        return `Research started: ${escapeHtml(techDef(e.tech).name)}.`;
      case 'tech-done':
        return `<b class="gain">Research complete: ${escapeHtml(techDef(e.tech).name)}.</b>`;
      case 'war':
        if (e.a === PLAYER || e.b === PLAYER) {
          const other = e.a === PLAYER ? e.b : e.a;
          return e.by === PLAYER ? `<em class="warn">You declared war on ${who(other)}.</em>` : `<em class="warn">${who(other)} declared war on you.</em>`;
        }
        return `${who(e.a)} and ${who(e.b)} are at war${e.by === PLAYER ? ' (your doing)' : ''}.`;
      case 'peace':
        return e.a === PLAYER || e.b === PLAYER ? `<b class="gain">Peace with ${who(e.a === PLAYER ? e.b : e.a)}.</b>` : `${who(e.a)} and ${who(e.b)} made peace.`;
      case 'sway':
        return `${who(e.faction)} warms to you (opinion ${e.attitude}).`;
      case 'met':
        return `First contact: <b>${who(e.faction)}</b>.`;
      case 'eliminated':
        return `<b>${who(e.faction)} has fallen.</b>`;
      case 'disbanded':
        return `${unitDef(e.unit).name} disbanded.`;
      case 'victory':
        return `<b class="gain">Dominion: every capital is yours.</b>`;
      case 'defeat':
        return `<em class="warn">Your last settlement is gone.</em>`;
      case 'moved':
        return '';
    }
  }
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
