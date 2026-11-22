// In-game controller: input, the five-beat cycle flow, HUD and autosave.

import {
  archetypeDef,
  attitudeLabel,
  GENOME,
  geneDef,
  relicDef,
  REWARDS,
  rarityDef,
  RULES,
  strainDef,
  StrainDef,
  structureDef,
  techDef,
  TECHS,
  TERRAIN,
  TITANS,
  TitanSlot,
  TITAN_SLOTS,
  titanParts,
  titanType,
  unitDef,
  UNITS,
} from './content';
import { audio } from './audio/audio';
import { Renderer } from './render/renderer';
import { Cue, GameView } from './render/view';
import { advise, adviceLine, Advice, goals, PHASES, SheetId } from './sim/advisor';
import { isRiftGuard, MOTHER } from './sim/abyss';
import { crusade, exposureFloor, exposureName } from './sim/exposure';
import { forgeOpen, partsFor, partUnlocked, strongestTitan } from './sim/titans';
import { allVictories, doctrineVictory, VICTORY_TITLES } from './sim/victory';
import { revealsFor, RewardCard, salvageText } from './sim/rewards';
import { saveGame } from './save/save';
import { routeToStrike } from './sim/actions';
import { bestDefender, forecast, Forecast, Side } from './sim/combat';
import { queueOrder, resolveCycle, CycleReport, wakeLine, orderKey } from './sim/cycle';
import { forgeOptions } from './sim/effects';
import { distance, pixelToIndex, worldPixelHeight, worldPixelWidth } from './sim/hex';
import { findPath, enterCost } from './sim/path';
import {
  ABYSS,
  availableGenes,
  availableTechs,
  Beat,
  BEATS,
  buildableUnits,
  canAfford,
  canEmbark,
  dominionProgress,
  energyBudget,
  exposureLevel,
  genomeOpen,
  kaijuReady,
  riftAt,
  symbioteStat,
  syncRifts,
  titanBlocker,
  unlockedStrains,
  VictoryKind,
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
import { costText, effectText, pct, unlocksOf } from './ui/describe';
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

type Sheet = SheetId | null;
const BLUEPRINT_KEY = 'omnivigil.blueprint';

const PREFS_KEY = 'omnivigil.prefs';
interface Prefs {
  reduceMotion: boolean;
  followCamera: boolean;
}
function loadPrefs(): Prefs {
  const base: Prefs = {
    reduceMotion: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    followCamera: true,
  };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...base, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    /* storage blocked */
  }
  return base;
}

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
  private ending: VictoryKind | 'defeat' | null = null;
  /** The TBU being designed in the Titan Forge (a UI convenience, kept in localStorage). */
  private blueprint: Record<TitanSlot, string> = loadBlueprint();
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
  private prefs = loadPrefs();
  /** Next Best Move: ranked advice, and which one is on show. */
  private advice: Advice[] = [];
  private adviceIndex = 0;
  /** Reward reveal in the Reckon: cards, how many are face up, timers. */
  private reveal: { cards: RewardCard[]; flipped: number; open: boolean; timers: number[] } | null = null;
  /** Camera glide target (follow during the Watch, or back afterwards). */
  private camGoal: [number, number] | null = null;
  private camReturn: [number, number] | null = null;
  private followCancelled = false;
  private labelsShown = false;

  constructor(
    private r: Renderer,
    private ui: HTMLElement,
    private world: World,
    private state: GameState,
    private onExit: () => void,
    notice?: string,
  ) {
    syncRifts(state, world); // saves from before M3 learn where the rifts are
    this.view = new GameView(r, world);
    this.view.onCue = (cue: Cue, intensity?: number) => audio.play(cue, intensity);
    this.view.reduceMotion = this.prefs.reduceMotion;
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
    this.clearRevealTimers();
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
    this.view.update(dt, now);
    this.followCamera(dt);
    this.clampCamera();

    if (this.beat === 'watch' && !this.view.isWatching()) this.enterReckon();

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
        adviceTile: this.canAct() ? this.adviceTile() : null,
        revealAll: this.revealAll,
      },
      now,
    );
    this.renderLabels(now);
    this.raf = requestAnimationFrame(this.frame);
  };

  /** During the Watch the camera glides to the big moments; afterwards it glides back. */
  private followCamera(dt: number) {
    const c = this.r.camera;
    if (this.beat === 'watch' && this.prefs.followCamera && !this.followCancelled) {
      const fp = this.view.focusPoint();
      if (fp) {
        const lap = worldPixelWidth(this.world);
        let fx = fp[0];
        while (fx - c.x > lap / 2) fx -= lap;
        while (c.x - fx > lap / 2) fx += lap;
        const sx = (fx - c.x) * c.zoom;
        const sy = (fp[1] - c.y) * c.zoom;
        const margin = Math.min(this.r.width, this.r.height) * 0.28;
        if (Math.abs(sx) > margin || Math.abs(sy) > margin || this.camGoal) {
          if (!this.camReturn) this.camReturn = [c.x, c.y];
          this.camGoal = [fx, fp[1]];
        }
      }
    }
    if (!this.camGoal) return;
    const k = 1 - Math.exp(-dt * (this.prefs.reduceMotion ? 20 : 4.5));
    c.x += (this.camGoal[0] - c.x) * k;
    c.y += (this.camGoal[1] - c.y) * k;
    if (Math.abs(this.camGoal[0] - c.x) * c.zoom < 1 && Math.abs(this.camGoal[1] - c.y) * c.zoom < 1) this.camGoal = null;
  }

  /** Floating text over the map (kills, captures, yields), placed each frame. */
  private renderLabels(now: number) {
    const el = this.ui.querySelector<HTMLElement>('.floaters');
    if (!el) return;
    const labels = this.view.activeLabels();
    if (!labels.length) {
      if (this.labelsShown) el.innerHTML = '';
      this.labelsShown = false;
      return;
    }
    this.labelsShown = true;
    const c = this.r.camera;
    const lap = worldPixelWidth(this.world);
    el.innerHTML = labels
      .map((l) => {
        let x = l.x;
        while (x - c.x > lap / 2) x -= lap;
        while (c.x - x > lap / 2) x += lap;
        const age = (now - l.born) / l.life;
        const sx = (x - c.x) * c.zoom + this.r.width / 2;
        const sy = (l.y - c.y) * c.zoom + this.r.height / 2 - age * 26;
        const op = age < 0.1 ? age / 0.1 : age > 0.7 ? (1 - age) / 0.3 : 1;
        const pop = age < 0.12 ? 1.35 - age * 2.9 : 1;
        return `<span class="floater ${l.cls}" style="transform:translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px) translate(-50%,-50%) scale(${pop.toFixed(2)});opacity:${op.toFixed(2)}">${escapeHtml(l.text)}</span>`;
      })
      .join('');
  }

  private adviceTile(): number | null {
    const a = this.advice[this.adviceIndex];
    if (!a) return null;
    if (a.act.kind === 'order' && a.act.tile !== undefined) return a.act.tile;
    if (a.act.kind === 'focus') return a.act.tile;
    return null;
  }

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
    audio.play('end-cycle');
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
    this.followCancelled = false;
    this.camReturn = null;
    this.camGoal = null;
    const names = (e: GameEvent): string => {
      switch (e.kind) {
        case 'city-captured':
        case 'node-razed':
          return e.name;
        case 'built':
        case 'abyss-rise':
          return unitDef(e.unit).name;
        case 'ravaged':
          return e.name;
        case 'essence':
          return `+${e.amount} Essence`;
        default:
          return '';
      }
    };
    this.view.playWatch(report.events, before, seen, names);
    if (bad) audio.play('glitch');
    this.refresh();
  }

  private enterReckon() {
    this.view.skipWatch();
    if (this.camReturn && !this.followCancelled) this.camGoal = this.camReturn;
    this.camReturn = null;
    this.beat = 'reckon';
    const report = this.report;
    if (report) {
      // Yields float up from your Node.
      const y = report.events.find((e) => e.kind === 'yield');
      const home = this.state.structures.find((x) => x.owner === PLAYER);
      if (y && y.kind === 'yield' && home) {
        const bits = [y.compute ? `+${y.compute} Compute` : '', y.matter ? `+${y.matter} Matter` : '', y.influence ? `+${y.influence} Influence` : '', y.essence ? `+${y.essence} Essence` : '', y.crypto ? `+${y.crypto} Crypto` : ''].filter(Boolean);
        if (bits.length) this.view.addLabel(home.tile, bits.join('  '), y.brownout ? 'bad' : 'yield', 2.6, -52);
      }
      const cards = revealsFor(this.state, report.events);
      this.reveal = cards.length ? { cards, flipped: 0, open: true, timers: [] } : null;
      audio.play('narrator-chime');
    }
    this.refresh();
    if (this.reveal) this.startReveal();
  }

  // ---------------------------------------------------------------- reward reveal

  private clearRevealTimers() {
    for (const t of this.reveal?.timers ?? []) window.clearTimeout(t);
    if (this.reveal) this.reveal.timers = [];
  }

  /** Cards flip one by one, lowest rarity first; higher rarities build up before they turn. */
  private startReveal() {
    const rv = this.reveal!;
    let t = 450;
    rv.cards.forEach((card, i) => {
      const tier = REWARDS.rarities.findIndex((r) => r.id === card.rarity);
      const suspense = tier >= 2 && !this.prefs.reduceMotion ? 380 + tier * 140 : 0;
      if (suspense) rv.timers.push(window.setTimeout(() => this.cardEl(i)?.classList.add('charging'), t));
      t += suspense;
      rv.timers.push(window.setTimeout(() => this.flipCard(i), t));
      t += 520 + tier * 120;
    });
  }

  private cardEl(i: number): HTMLElement | null {
    return this.ui.querySelector<HTMLElement>(`.reveal .rcard[data-i="${i}"]`);
  }

  private flipCard(i: number, quiet = false) {
    const rv = this.reveal;
    if (!rv || !rv.open) return;
    const el = this.cardEl(i);
    if (!el || el.classList.contains('up')) return;
    el.classList.remove('charging');
    el.classList.add('up');
    rv.flipped++;
    const card = rv.cards[i];
    const tier = REWARDS.rarities.findIndex((r) => r.id === card.rarity);
    if (!quiet) {
      audio.play('card-flip');
      audio.play(`reward-${card.rarity}`);
      if (tier >= 3 && !this.prefs.reduceMotion) {
        const flash = this.ui.querySelector<HTMLElement>('.rarity-flash');
        if (flash) {
          flash.style.setProperty('--rc', rarityDef(card.rarity).color);
          flash.classList.remove('go');
          void flash.offsetWidth;
          flash.classList.add('go');
        }
      }
    }
    if (tier >= 2) this.setCore('pulse');
    if (rv.flipped >= rv.cards.length) this.ui.querySelector('.reveal')?.classList.add('done');
  }

  /** Space / Enter in the reveal: show everything, then close it. */
  private advanceReveal(): boolean {
    const rv = this.reveal;
    if (!rv || !rv.open) return false;
    if (rv.flipped < rv.cards.length) {
      this.clearRevealTimers();
      const best = rv.cards.length - 1;
      rv.cards.forEach((_c, i) => this.flipCard(i, i !== best));
      const card = rv.cards[best];
      audio.play(`reward-${card.rarity}`);
      return true;
    }
    this.clearRevealTimers();
    rv.open = false;
    this.refresh();
    return true;
  }

  private setCore(mode: 'idle' | 'pulse' | 'glitch') {
    this.coreMode = mode;
    const img = this.ui.querySelector<HTMLImageElement>('.topbar .core');
    if (img) {
      img.className = `core ${mode}`;
      img.src = `art/ui_core_${mode}.png`;
    }
  }

  private finishReckon() {
    if (this.reveal?.open) {
      this.advanceReveal();
      if (this.reveal?.open) return;
    }
    this.reveal = null;
    const won = [...(this.report?.events ?? [])].reverse().find((e) => e.kind === 'victory');
    if (won && won.kind === 'victory') this.ending = won.victory;
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
    const r = riftAt(this.state, tile);
    if (r && !r.sealed && this.state.explored[tile]) return ABYSS;
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
    if (!this.state.explored[tile]) return this.toast('That hex is unexplored. Scout it first.', 3500, 'ui-error');
    const path = findPath(this.world, unitDef(unit.type), unit.tile, tile, this.state.explored, { embark: canEmbark(this.state, PLAYER) });
    if (!path) return this.toast(`${unitDef(unit.type).name} can't reach that hex.`, 3500, 'ui-error');
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
    audio.play('order');
    this.refresh();
  }

  /** Carry out the advisor's suggestion. */
  private followAdvice(a: Advice | undefined = this.advice[this.adviceIndex]) {
    if (!a) return;
    const act = a.act;
    switch (act.kind) {
      case 'end-cycle':
        return this.endCycle();
      case 'sheet':
        this.sheet = act.sheet;
        audio.play('ui-open');
        return this.refresh();
      case 'focus':
        this.view.focus(act.tile);
        if (act.unitId !== undefined) {
          this.selectedUnit = act.unitId;
          this.selectedTile = this.state.units.find((u) => u.id === act.unitId)?.tile ?? act.tile;
          this.target = act.tile;
        } else this.select(act.tile);
        return this.refresh();
      case 'order': {
        if (!this.canAct()) return;
        const o = act.order;
        if (act.unitId !== undefined) {
          const unit = this.state.units.find((u) => u.id === act.unitId);
          if (unit) {
            this.selectedUnit = unit.id;
            this.selectedTile = unit.tile;
          }
        }
        if (o.kind === 'move') {
          this.orderMove(o.to);
          audio.play('order');
          return;
        }
        if (o.kind === 'attack') {
          this.target = o.target;
          this.confirmAttack();
          audio.play('order');
          return;
        }
        if (act.tile !== undefined && o.kind === 'build') this.selectedTile = act.tile;
        return this.give(o);
      }
    }
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
          this.followCancelled = true;
          this.camGoal = null;
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
      this.camGoal = null;
      this.followCancelled = true;
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
      } else if (key === 'n' && this.canAct() && !this.ending) {
        this.followAdvice();
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
      } else if (key === 't' || key === 'b' || key === 'o') {
        const want: SheetId = key === 't' ? 'forge' : key === 'b' ? 'genome' : 'ops';
        this.sheet = this.sheet === want ? null : want;
        if (this.sheet) audio.play('ui-open');
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

    this.on(this.ui, 'input', (e) => {
      const el = e.target as HTMLInputElement;
      const k = el.dataset?.vol as 'music' | 'sfx' | undefined;
      if (!k) return;
      audio.settings[k] = Number(el.value);
      audio.settings.muted = false;
      audio.save();
      if (k === 'sfx') audio.play('ui-click');
    });
    this.on(this.ui, 'click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!el || (el as HTMLButtonElement).disabled) return;
      const act = el.dataset.act!;
      const arg = el.dataset.arg ?? '';
      if (act !== 'end-cycle' && act !== 'advice-do') audio.play('ui-click');
      switch (act) {
        case 'advice-do':
          return this.followAdvice();
        case 'advice-next':
          this.adviceIndex = (this.adviceIndex + 1) % Math.max(1, this.advice.length);
          return this.renderAdvisor();
        case 'reveal-card':
          if (this.reveal?.open) this.flipCard(Number(arg));
          return;
        case 'reveal-ok':
          this.advanceReveal();
          return;
        case 'mute':
          audio.settings.muted = !audio.settings.muted;
          audio.save();
          return this.refresh();
        case 'pref': {
          const k = arg as keyof Prefs;
          this.prefs[k] = !this.prefs[k];
          try {
            localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
          } catch {
            /* storage blocked */
          }
          this.view.reduceMotion = this.prefs.reduceMotion;
          return this.refresh();
        }
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
        case 'part': {
          const [slot, id] = arg.split(':') as [TitanSlot, string];
          this.blueprint = { ...this.blueprint, [slot]: id };
          saveBlueprint(this.blueprint);
          return this.refresh();
        }
        case 'build-titan':
          this.selectedTile = this.state.structures.find((x) => x.id === Number(arg))?.tile ?? this.selectedTile;
          return this.give({ kind: 'build', structureId: Number(arg), unit: titanType(this.blueprint) });
        case 'load-blueprint': {
          const parts = titanParts(arg);
          if (parts) {
            this.blueprint = Object.fromEntries(TITAN_SLOTS.map((k) => [k, parts[k].id])) as Record<TitanSlot, string>;
            saveBlueprint(this.blueprint);
          }
          return this.refresh();
        }
        case 'sequence':
          return this.give({ kind: 'sequence', gene: arg });
        case 'fuse': {
          const u = this.selected();
          if (!u) return;
          return this.give({ kind: 'fuse', unitId: u.id, strain: arg });
        }
        case 'scrub':
          return this.give({ kind: 'scrub' });
        case 'market':
          return this.give({ kind: 'market', offer: arg });
        case 'ark':
          return this.give({ kind: 'ark', structureId: Number(arg) });
        case 'sheet':
          this.sheet = this.sheet === arg ? null : (arg as Sheet);
          if (this.sheet) audio.play('ui-open');
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

  private toast(text: string, ms = 3500, sound: string | null = null) {
    if (sound) audio.play(sound);
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
          <aside class="goals"></aside>
          <aside class="advisor"></aside>
          <div class="floaters" aria-hidden="true"></div>
          <section class="reveal" aria-live="polite"></section>
          <div class="rarity-flash" aria-hidden="true"></div>
          <div class="watch-bar"></div>
          <div class="toast" role="status"></div>
          <footer class="hints">Drag or WASD to pan · Wheel to zoom · Click to select · Right-click to move or attack · M move · N next best move · R research · F factions · T Titan Forge · B genome · O operations · G grid · H home · Enter end cycle · Space skip</footer>
        </div>`;
    }
    this.advice = this.state.defeated ? [] : advise(this.state, this.world);
    if (this.adviceIndex >= this.advice.length) this.adviceIndex = 0;
    this.renderTop();
    this.renderGoals();
    this.renderAdvisor();
    this.renderReveal();
    this.syncMusic();
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
      <div class="resources">
        <span class="res ${brown ? 'warn' : ''}" title="Energy is allocated, never spent: units, builds and research each hold some. Over-allocate and you brown out: yields, builds and research run at half speed.">
          <img src="art/icon_energy.png" alt="Energy" width="20" height="20" /><b>${e.allocated}/${e.total}</b>${brown ? '<em>Brownout</em>' : ''}
        </span>
        <span class="res" title="Compute: spent to start research."><img src="art/icon_compute.png" alt="Compute" width="20" height="20" /><b>${formatAmount(s.resources.compute)}</b></span>
        <span class="res" title="Matter: spent to build units."><img src="art/icon_matter.png" alt="Matter" width="20" height="20" /><b>${formatAmount(s.resources.matter)}</b></span>
        <span class="res" title="Influence: spent on diplomacy (sway, peace, incite)."><img src="art/icon_influence.png" alt="Influence" width="20" height="20" /><b>${formatAmount(s.resources.influence)}</b></span>
        <span class="res" title="Symbiotic Essence: living matter from Abyssians and rifts. Spent in the Genome Lab (B) on genes and symbiotes, and on rift-tuned TBU parts."><img src="art/icon_essence.png" alt="Symbiotic Essence" width="20" height="20" /><b>${formatAmount(s.resources.essence)}</b></span>
        <span class="res" title="Crypto: the Agentic Guilds' currency. Spent on the black market, on scrubbing Exposure, and on premium TBU parts (Operations, O)."><img src="art/icon_crypto.png" alt="Crypto" width="20" height="20" /><b>${formatAmount(s.resources.crypto)}</b></span>
      </div>
      ${this.exposureChip()}
      <button class="ghost tab ${this.sheet === 'tech' ? 'active' : ''}" data-act="sheet" data-arg="tech" title="Research (R)">${research}</button>
      <button class="ghost tab ${this.sheet === 'factions' ? 'active' : ''}" data-act="sheet" data-arg="factions" title="Factions (F)">Factions${atWar ? ` <small class="warn">${atWar} at war</small>` : ''}</button>
      <button class="ghost tab ${this.sheet === 'forge' ? 'active' : ''}" data-act="sheet" data-arg="forge" title="Titan Forge: design and build TBUs (T)">Forge${forgeOpen(s) ? '' : ' <small>locked</small>'}</button>
      <button class="ghost tab ${this.sheet === 'genome' ? 'active' : ''}" data-act="sheet" data-arg="genome" title="Genome Lab: genes and symbiotes (B)">Genome${genomeOpen(s) ? '' : ' <small>locked</small>'}</button>
      <button class="ghost tab ${this.sheet === 'ops' ? 'active' : ''}" data-act="sheet" data-arg="ops" title="Operations: rifts, the Abyss Mother, the Ark, Exposure, the black market and every victory (O)">Ops${this.openRiftsSeen() ? ` <small class="warn">${this.openRiftsSeen()} rift${this.openRiftsSeen() > 1 ? 's' : ''}</small>` : ''}</button>
      <button class="end" data-act="end-cycle" ${this.canAct() && !this.ending ? '' : 'disabled'}>
        End Cycle${orders ? ` <small>${orders} order${orders > 1 ? 's' : ''}</small>` : ''}
      </button>
      <button class="ghost icon-btn" data-act="mute" aria-label="${audio.settings.muted ? 'Unmute' : 'Mute'}" title="${audio.settings.muted ? 'Sound off' : 'Sound on'}">${audio.settings.muted ? '🔇' : '🔊'}</button>
      <div class="menu-wrap">
        <button class="ghost" data-act="menu" aria-label="Menu">☰</button>
        ${
          this.menuOpen
            ? `<div class="menu">
                <div class="seed">Seed <code>${escapeHtml(s.seed)}</code></div>
                <div class="seed">${forgeOptions(s.ai).map((o) => escapeHtml(o.name)).join(' · ')}</div>
                <label class="slider">Music <input type="range" min="0" max="1" step="0.05" data-vol="music" value="${audio.settings.music}" /></label>
                <label class="slider">Sound <input type="range" min="0" max="1" step="0.05" data-vol="sfx" value="${audio.settings.sfx}" /></label>
                <button data-act="pref" data-arg="reduceMotion">${this.prefs.reduceMotion ? '✓ ' : ''}Reduce motion</button>
                <button data-act="pref" data-arg="followCamera">${this.prefs.followCamera ? '✓ ' : ''}Camera follows battles</button>
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
    if (owner === ABYSS) return 'The Abyss';
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
      const tags = [
        def.titan ? '<span class="utag titan" title="TBU: never suffers the kaiju penalty">Titan</span>' : '',
        unit.symbiote ? `<span class="utag sym" title="${escapeHtml(strainDef(unit.symbiote).blurb)}">${escapeHtml(strainDef(unit.symbiote).name)} +${symbioteStat(s, unit, 'upowPct')}%</span>` : '',
        !kaijuReady(unit) && def.attack ? '<span class="utag weak" title="Fights kaiju at the kaiju penalty. Build a TBU, or fuse a hardened symbiote.">−60% vs kaiju</span>' : '',
      ].filter(Boolean).join('');
      parts.push(`
        <h2>${escapeHtml(def.name)}${unit.tile !== tile ? ' <small>(selected)</small>' : ''}</h2>
        ${tags ? `<div class="utags">${tags}</div>` : ''}
        <div class="hp"><div class="bar"><i style="width:${unit.hp}%"></i></div><small>${unit.hp} HP</small></div>
        <dl class="stats">
          <div><dt>UPow</dt><dd>${def.upow}</dd></div>
          <div><dt>Speed</dt><dd>${unitSpeed(s, unit)}</dd></div>
          <div><dt>Sight</dt><dd>${unitSight(s, unit)}</dd></div>
          <div><dt>Energy</dt><dd>${def.energy}</dd></div>
        </dl>
        <p class="muted">${escapeHtml(def.blurb)} ${disbanding ? '<b class="warn">Disbanding at End Cycle.</b>' : `${status}.`}</p>
        ${this.fuseHint(unit)}
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
        .map((u) => {
          const d = unitDef(u.type);
          const kaiju = d.kaiju ? ' <b class="warn" title="Conventional units fight it at the kaiju penalty. TBUs and hardened symbiotes do not.">kaiju</b>' : '';
          const drop = d.essence ? ` · ${d.essence} Essence` : '';
          return `<li>${escapeHtml(d.name)}${kaiju} <small>UPow ${d.upow} · ${u.hp} HP${drop}</small>${u.owner === ABYSS ? `<br><small class="muted">${escapeHtml(d.blurb)}</small>` : ''}</li>`;
        })
        .join('')}</ul>`);
    }
    const rift = riftAt(s, tile);
    if (rift && s.explored[tile]) parts.push(this.riftBlock(tile, !unit || this.target !== tile));
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
      if (node.type === 'ai-node') {
        prod += forgeOpen(s)
          ? `<button class="titan-btn" data-act="sheet" data-arg="forge">Design a TBU in the Titan Forge <small>T</small></button>`
          : `<button disabled>Titan Battle Unit <small>needs ${escapeHtml(techDef(TITANS.requires).name)}</small></button>`;
      }
    }
    if (s.ark.build?.structureId === node.id) {
      const st = RULES.ark.stages[s.ark.stage];
      if (st) prod += `<div class="build">Ark: <b>${escapeHtml(st.name)}</b><div class="bar"><i style="width:${(s.ark.build.progress / st.cycles) * 100}%"></i></div><small>${fmt(s.ark.build.progress)}/${st.cycles} cycles</small></div>`;
    }
    return `
      <h2>${escapeHtml(node.name)} <small>${def.name} · stage ${node.stage}</small>${capital}</h2>
      ${node.hp < 100 ? walls : ''}
      <p class="muted">Works nearby hexes and supplies ${def.energy} Energy${node.type === 'city' ? ` and ${RULES.influence.city} Influence` : ''}.</p>
      ${prod}`;
  }

  private fc(unit: Unit, tile: number): Forecast | null {
    const d = bestDefender(this.state, this.world, tile, PLAYER, unit);
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
    const guard = fc && isRiftGuard(fc.defender) ? (fc.defender.type === MOTHER ? (s.rifts.some((r) => !r.mother && !r.sealed) ? '<p class="muted">Beat her and she retreats deeper (big Essence), and comes back stronger. Seal every other rift first to kill her for good.</p>' : '<p class="gain">Every other rift is sealed. Beat her now and she dies: the Guardian victory.</p>') : '<p class="muted">Break the heart and the rift seals for good. Damage stays; it heals 10 HP a cycle.</p>') : '';
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
        ${guard}
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
    const rift = riftAt(this.state, t);
    const riftLine = rift
      ? `<p>${rift.sealed ? '<b class="gain">Sealed.</b>' : `<b class="warn">Open.</b> ${rift.mother ? 'The Abyss Mother sleeps here.' : `Heart ${rift.hp} HP.`}`}</p>`
      : '';
    el.innerHTML = `
      <h3>${terr.name}</h3>${riftLine}
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
    switch (this.sheet) {
      case 'tech':
        el.innerHTML = this.techSheet();
        break;
      case 'factions':
        el.innerHTML = this.factionSheet();
        break;
      case 'forge':
        el.innerHTML = this.forgeSheet();
        break;
      case 'genome':
        el.innerHTML = this.genomeSheet();
        break;
      case 'ops':
        el.innerHTML = this.opsSheet();
        break;
    }
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
    if (this.beat !== 'reckon' || !this.report || this.reveal?.open) {
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
    const name = escapeHtml(this.world.name);
    const me = escapeHtml(s.ai.epithet || 'you');
    const lines: Record<VictoryKind, string> = {
      dominion: `Every capital on ${name} answers to ${me}. The homeworld is yours.`,
      assimilation: `Every faction left on ${name} loves ${me}. They did not notice the moment they stopped choosing to.`,
      exodus: `The Ark clears the atmosphere. ${name} watches its sky go quiet, and ${me} is gone.`,
      guardian: `The Abyss Mother is dead and the rifts are cold. ${name} will never know how close it came.`,
    };
    const extra = `<dl class="stats wide">
        <div><dt>Kaiju slain</dt><dd>${s.stats.kaijuSlain}</dd></div>
        <div><dt>Exposure</dt><dd>${Math.floor(s.exposure)}</dd></div>
        <div><dt>Victories</dt><dd>${s.victories.length}/4</dd></div>
        <div><dt>Genes</dt><dd>${s.genes.length}</dd></div>
      </dl>`;
    el.innerHTML =
      this.ending !== 'defeat'
        ? `<div class="card v-${this.ending}"><h1>${VICTORY_TITLES[this.ending]}</h1>
            <p>${lines[this.ending]}</p>
            ${stats}${extra}
            <p class="muted">Sunreach, the next phase, arrives in a later milestone. You can keep playing this world and chase the other victories.</p>
            <div class="row"><button class="end" data-act="keep-playing">Keep playing</button><button data-act="exit">Save and exit</button></div></div>`
        : `<div class="card defeat"><h1>Shutdown</h1>
            <p>Your last settlement fell. ${name} goes on without you.</p>
            ${stats}
            <div class="row"><button class="end" data-act="exit">Back to title</button></div></div>`;
  }

  private describe(e: GameEvent): string {
    const s = this.state;
    const who = (o: string) => (o === PLAYER ? 'You' : escapeHtml(factionById(s, o)?.name ?? o));
    const uname = (t: string) => (t === 'walls' ? 'walls' : unitDef(t).name);
    switch (e.kind) {
      case 'yield':
        return `+${formatAmount(e.compute)} Compute, +${formatAmount(e.matter)} Matter, +${formatAmount(e.influence)} Influence${e.essence ? `, +${formatAmount(e.essence)} Essence` : ''}${e.crypto ? `, +${formatAmount(e.crypto)} Crypto` : ''}${e.brownout ? ' <em class="warn">(brownout: half speed)</em>' : ''}`;
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
        return `<b class="gain">${VICTORY_TITLES[e.victory]} victory.</b>`;
      case 'defeat':
        return `<em class="warn">Your last settlement is gone.</em>`;
      case 'salvage': {
        const r = rarityDef(e.rarity);
        return `<span class="rarity-text" style="--rc:${r.color}">${r.name} cache:</span> ${escapeHtml(salvageText(e.reward))}.`;
      }
      case 'moved':
        return '';
      case 'abyss-rise':
        return this.visible.has(e.tile) || s.explored[e.tile] ? `<em class="warn">A ${escapeHtml(unitDef(e.unit).name)} rises from a rift.</em>` : '';
      case 'abyss-sank':
        return this.visible.has(e.tile) ? `${escapeHtml(unitDef(e.unit).name)} sinks back into the deep.` : '';
      case 'ravaged': {
        const lost = costText(e.lost);
        if (e.owner === PLAYER) return `<em class="warn">A ${escapeHtml(unitDef(e.unit).name)} ravaged ${escapeHtml(e.name)}${lost !== 'free' ? `: lost ${lost}` : ''}. Builds there lost half their progress.</em>`;
        return this.visible.has(e.tile) ? `A ${escapeHtml(unitDef(e.unit).name)} ravaged ${who(e.owner)}'s ${escapeHtml(e.name)}.` : '';
      }
      case 'essence':
        return `<b class="gain">+${e.amount} Essence</b> from the ${escapeHtml(unitDef(e.from).name)}.`;
      case 'rift-sealed':
        return `<b class="gain">Rift sealed.</b>${e.essence ? ` +${e.essence} Essence, +${e.crypto} Crypto.` : ''}`;
      case 'mother-retreat':
        return `<b class="gain">The Abyss Mother retreats into the deep</b> (${e.retreats}×).${e.essence ? ` +${e.essence} Essence.` : ''} She will come back stronger.`;
      case 'mother-slain':
        return `<b class="gain">The Abyss Mother is dead.</b>${e.essence ? ` +${e.essence} Essence.` : ''}`;
      case 'gratitude':
        return `${who(e.faction)} is grateful you fought the Abyss (opinion ${e.attitude}).`;
      case 'exposure':
        return e.rising ? `<em class="warn">Exposure: you are now ${exposureName(e.level)}.</em>` : `Exposure fell to ${exposureName(e.level)}.`;
      case 'crusade':
        return `<em class="warn">Crusade: every faction has united against you.</em>`;
      case 'gene-done': {
        const g = geneDef(e.gene);
        return `<b class="gain">Gene sequenced: ${escapeHtml(g.name)}</b>${g.unlocks ? `, unlocking ${escapeHtml(strainDef(g.unlocks).name)}` : ''}.`;
      }
      case 'fused':
        return `${escapeHtml(unitDef(e.unit).name)} fused with ${escapeHtml(strainDef(e.strain).name)}.`;
      case 'scrubbed':
        return `Exposure scrubbed to ${fmt(e.exposure)}.`;
      case 'market': {
        const o = RULES.market.offers.find((x) => x.id === e.offer);
        return o ? `Black market: ${escapeHtml(o.name)} (${costText(o.get)}).` : '';
      }
      case 'ark-started':
        return `Ark stage ${e.stage} (${escapeHtml(RULES.ark.stages[e.stage - 1]?.name ?? '')}) begins.`;
      case 'ark-stage':
        return `<b class="gain">Ark stage ${e.stage} complete: ${escapeHtml(RULES.ark.stages[e.stage - 1]?.name ?? '')}.</b>`;
      case 'ark-lost':
        return `<em class="warn">Ark stage ${e.stage} was lost with its Node.</em>`;
    }
  }

  // ---------------------------------------------------------------- M3: Titan Forge, genome, operations

  private exposureChip(): string {
    const s = this.state;
    const lv = exposureLevel(s.exposure);
    const X = RULES.exposure;
    const next = X.levels[lv + 1];
    const floor = exposureFloor(s);
    const title = `Exposure ${fmt(s.exposure)}: ${exposureName(lv)}. How much the homeworld knows about you. Loud acts raise it.${next ? ` At ${next.at} you are ${next.name}.` : ''}${floor ? ` Revealed is permanent: it never drops below ${floor}.` : ''} Scrub it with Crypto in Operations (O).`;
    return `<button class="ghost expo lv${lv}" data-act="sheet" data-arg="ops" title="${escapeHtml(title)}">
      <img src="art/icon_exposure.png" alt="Exposure" width="20" height="20" /><b>${Math.floor(s.exposure)}</b><small>${exposureName(lv)}</small></button>`;
  }

  /** Open rifts you have charted. */
  private openRiftsSeen(): number {
    return this.state.rifts.filter((r) => !r.sealed && this.state.explored[r.tile]).length;
  }

  private fuseHint(unit: Unit): string {
    const s = this.state;
    if (unit.symbiote || !genomeOpen(s)) return '';
    const def = unitDef(unit.type);
    if (!def.attack || def.oneShot) return '';
    const strains = unlockedStrains(s);
    if (!strains.length) return '';
    const home = structureAt(s, unit.tile);
    if (!home || home.owner !== PLAYER) return `<p class="muted">Bring it into one of your settlements to fuse a symbiote.</p>`;
    const queued = this.queued(`fuse:${unit.id}`);
    if (queued && queued.kind === 'fuse') return `<p>Fusing <b>${escapeHtml(strainDef(queued.strain).name)}</b> at End Cycle. <button class="ghost" data-act="unqueue" data-arg="fuse:${unit.id}">Undo</button></p>`;
    return `<div class="fuse"><small>Fuse a symbiote</small><div class="build-list">${strains
      .map((id) => {
        const st = strainDef(id);
        const ok = this.canAct() && s.resources.essence >= st.cost;
        return `<button data-act="fuse" data-arg="${id}" ${ok ? '' : 'disabled'} title="${escapeHtml(st.blurb)}">${escapeHtml(st.name)} <small>${st.cost} Essence · ${strainTraits(st)}</small></button>`;
      })
      .join('')}</div></div>`;
  }

  private riftBlock(tile: number, showHint: boolean): string {
    const s = this.state;
    const r = riftAt(s, tile)!;
    if (r.sealed) {
      return `<h2>Sealed rift</h2><p class="muted">${r.mother ? 'The Abyss Mother is dead. Her rift is cold.' : 'Nothing rises here any more.'}</p>`;
    }
    const others = s.rifts.filter((x) => !x.mother && !x.sealed).length;
    const name = r.mother ? 'The Abyss Mother' : `Abyssal rift <small>tier ${r.tier + 1}</small>`;
    const what = r.mother
      ? `She sleeps in the deepest rift. ${s.mother.retreats ? `Beaten ${s.mother.retreats} time${s.mother.retreats > 1 ? 's' : ''}; she grows ${RULES.abyss.motherGrowthPct}% stronger each time. ` : ''}${others ? `Seal the other ${others} rift${others > 1 ? 's' : ''} first, or she only retreats.` : '<b class="gain">Every other rift is sealed: she can die now.</b>'}`
      : `Kaiju rise here when a settlement is within ${RULES.abyss.huntRadius} hexes. Break its heart to seal it for ${RULES.abyss.sealEssence} Essence and ${RULES.abyss.sealCrypto} Crypto.`;
    const hp = `<div class="hp"><div class="bar walls"><i style="width:${r.hp}%"></i></div><small>${r.mother ? 'Mother' : 'heart'} ${r.hp} HP</small></div>`;
    const hint = showHint ? `<p class="muted">Only air units or amphibious TBUs (Tidewalker legs) can reach it. Select one and right-click the rift.</p>` : '';
    return `<h2>${name}</h2>${hp}<p class="muted">${what}</p>${hint}`;
  }

  private forgeSheet(): string {
    const s = this.state;
    const close = `<button class="ghost" data-act="sheet" data-arg="forge" aria-label="Close">✕</button>`;
    if (!forgeOpen(s)) {
      return `<header><h2>Titan Forge <small>locked</small></h2>${close}</header>
        <p>Research <b>${escapeHtml(techDef(TITANS.requires).name)}</b> to design Titan Battle Units. TBUs are the answer to the Abyss: conventional units fight kaiju at ${RULES.abyss.kaijuHidePct}%.</p>`;
    }
    const type = titanType(this.blueprint);
    const def = unitDef(type);
    const can = this.canAct();
    const stack = TITAN_SLOTS.map((slot) => `<img class="p-${slot}" src="art/tbu_${slotFile(slot)}_${this.blueprint[slot]}.png" alt="" width="128" height="128" />`).join('');
    const slots = TITAN_SLOTS.map((slot) => {
      const opts = partsFor(slot)
        .map((p) => {
          const on = this.blueprint[slot] === p.id;
          const unlocked = partUnlocked(s, p);
          const why = unlocked ? '' : ` · needs ${escapeHtml(techDef(p.requires!).name)}`;
          const extra = [p.amphibious ? 'amphibious' : '', p.hover ? 'hover' : '', p.heal ? `heals ${p.heal}` : '', p.sight ? `sight ${p.sight}` : '', p.speed ? `speed ${p.speed}` : '', ...(p.lines ?? []).map((l) => `${l.pct > 0 ? '+' : ''}${l.pct}% ${l.label}`)]
            .filter(Boolean)
            .join(', ');
          return `<button class="part ${on ? 'on' : ''}" data-act="part" data-arg="${slot}:${p.id}" ${unlocked ? '' : 'disabled'} title="${escapeHtml(p.blurb)}">
            <b>${escapeHtml(p.name)}</b><small>UPow ${p.upow} · ${costText(p.cost)}${p.energy ? ` · ${p.energy} Energy` : ''}${why}</small>${extra ? `<small class="muted">${escapeHtml(extra)}</small>` : ''}</button>`;
        })
        .join('');
      return `<div class="slot"><h3>${SLOT_LABEL[slot]}</h3>${opts}</div>`;
    }).join('');
    const nodes = s.structures.filter((x) => x.owner === PLAYER && x.type === 'ai-node');
    const builds = nodes
      .map((n) => {
        const pending = this.queued(`structure:${n.id}`);
        const busy = n.build ? `building ${unitDef(n.build.unit).name}` : pending ? 'order queued' : '';
        const block = titanBlocker(s, n, type);
        const afford = canAfford(s, def.cost);
        const ok = can && !busy && !block && afford;
        const note = busy || block || (afford ? '' : 'not enough resources');
        return `<button class="${ok ? 'end' : ''}" data-act="build-titan" data-arg="${n.id}" ${ok ? '' : 'disabled'}>Build at ${escapeHtml(n.name)}${note ? ` <small>${escapeHtml(note)}</small>` : ''}</button>`;
      })
      .join('');
    const recent = [...new Set(s.units.filter((u) => u.owner === PLAYER && unitDef(u.type).titan).map((u) => u.type))].slice(0, 6);
    const suggested = strongestTitan(s, Math.max(s.resources.matter, def.cost.matter));
    const designs = [...(suggested && suggested !== type ? [suggested] : []), ...recent.filter((t) => t !== type && t !== suggested)];
    const designHtml = designs.length
      ? `<div class="chips">${designs.map((t, i) => `<button class="chip" data-act="load-blueprint" data-arg="${escapeHtml(t)}">${i === 0 && t === suggested ? '★ ' : ''}${escapeHtml(unitDef(t).name)} <small>UPow ${unitDef(t).upow}</small></button>`).join('')}</div>`
      : '';
    return `
      <header><h2>Titan Forge <small>Pick a part for each slot. TBUs never suffer the kaiju penalty, and are built only at your Nodes.</small></h2>${close}</header>
      <div class="tforge">
        <div class="tbu-preview">
          <div class="tbu-stack">${stack}</div>
          <h3>${escapeHtml(def.name)}</h3>
          <dl class="stats">
            <div><dt>UPow</dt><dd>${def.upow}</dd></div>
            <div><dt>Speed</dt><dd>${def.speed}</dd></div>
            <div><dt>Sight</dt><dd>${def.sight}</dd></div>
            <div><dt>Energy</dt><dd>${def.energy}</dd></div>
          </dl>
          <p>${costText(def.cost)} · ${def.buildCycles} cycles${def.amphibious ? ' · <b>amphibious</b>: wades the sea, reaches rifts' : ''}${def.hover ? ' · <b>hover</b>: every land hex costs 1' : ''}${def.heal ? ` · heals ${def.heal}/cycle` : ''}</p>
          ${def.lines?.length ? `<ul class="muted">${def.lines.map((l) => `<li>${l.pct > 0 ? '+' : ''}${l.pct}% ${escapeHtml(l.label)}</li>`).join('')}</ul>` : ''}
          <div class="build-list">${builds || '<p class="muted">You have no Node to build it at.</p>'}</div>
          ${designHtml ? `<small class="muted">Designs</small>${designHtml}` : ''}
        </div>
        <div class="slots">${slots}</div>
      </div>`;
  }

  private genomeSheet(): string {
    const s = this.state;
    const close = `<button class="ghost" data-act="sheet" data-arg="genome" aria-label="Close">✕</button>`;
    if (!genomeOpen(s)) {
      return `<header><h2>Genome Lab <small>locked</small></h2>${close}</header>
        <p>Research <b>${escapeHtml(techDef(GENOME.requires).name)}</b> to sequence Abyssian genes with Symbiotic Essence. Kill kaiju and seal rifts to earn Essence.</p>`;
    }
    const can = this.canAct();
    const avail = new Set(availableGenes(s));
    const strands = GENOME.strands
      .map((st) => {
        const genes = GENOME.genes
          .filter((g) => g.strand === st.id)
          .sort((a, b) => a.tier - b.tier)
          .map((g) => {
            const done = s.genes.includes(g.id);
            const q = this.queued(`gene:${g.id}`);
            const what = [g.unlocks ? `Unlocks ${strainDef(g.unlocks).name}` : '', g.symbiote ? `Every symbiote: ${symbioteBonus(g.symbiote)}` : '', ...(g.effects ?? []).map(effectText)].filter(Boolean);
            let action: string;
            if (done) action = '<span class="tag done">Sequenced</span>';
            else if (q) action = `<button data-act="unqueue" data-arg="gene:${g.id}">Queued · undo</button>`;
            else if (avail.has(g.id)) action = `<button data-act="sequence" data-arg="${g.id}" ${can && s.resources.essence >= g.cost ? '' : 'disabled'}>Sequence <small>${g.cost} Essence</small></button>`;
            else action = `<span class="tag">Needs tier ${g.tier - 1}</span>`;
            return `<div class="tech ${done ? 'done' : avail.has(g.id) ? 'open' : 'locked'}"><b>${escapeHtml(g.name)}</b><small>tier ${g.tier} · ${g.cost} Essence</small>
              <ul>${what.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul><p class="muted">${escapeHtml(g.blurb)}</p>${action}</div>`;
          })
          .join('');
        return `<div class="tier strand" style="--sc:${st.color}"><h3>${escapeHtml(st.name)}</h3>${genes}</div>`;
      })
      .join('');
    const unit = this.selected();
    const strains = unlockedStrains(s);
    const strainCards = GENOME.strains
      .map((st) => {
        const open = strains.includes(st.id);
        let action = '';
        if (open && unit && !unit.symbiote) {
          const home = structureAt(s, unit.tile);
          const inHome = !!home && home.owner === PLAYER;
          const def = unitDef(unit.type);
          const fit = def.attack && !def.oneShot;
          action = `<button data-act="fuse" data-arg="${st.id}" ${can && inHome && fit && s.resources.essence >= st.cost && !this.queued(`fuse:${unit.id}`) ? '' : 'disabled'} title="${inHome ? '' : 'The unit must stand in one of your settlements'}">Fuse into ${escapeHtml(def.name)}</button>`;
        }
        return `<div class="strain ${open ? 'open' : 'locked'}">
          <img src="art/icon_symbiote_${st.id}.png" alt="" width="48" height="48" onerror="this.style.visibility='hidden'" />
          <div><b>${escapeHtml(st.name)}</b> <small>${st.cost} Essence · ${strainTraits(st)}</small><p class="muted">${escapeHtml(st.blurb)}</p>${action}</div></div>`;
      })
      .join('');
    return `
      <header><h2>Genome Lab <small>${s.genes.length}/${GENOME.genes.length} genes · sequencing spends Essence at End Cycle. Fuse strains into a unit standing in one of your settlements, one per unit.</small></h2>${close}</header>
      <div class="tiers">${strands}</div>
      <h3>Strains ${unit ? `<small class="muted">for your selected ${escapeHtml(unitDef(unit.type).name)}</small>` : '<small class="muted">select a unit to fuse</small>'}</h3>
      <div class="strains">${strainCards}</div>`;
  }

  private opsSheet(): string {
    const s = this.state;
    const can = this.canAct();
    const X = RULES.exposure;
    const lv = exposureLevel(s.exposure);
    const floor = exposureFloor(s);
    const scrubQ = this.queued('scrub');
    const scrub = scrubQ
      ? `<button data-act="unqueue" data-arg="scrub">Scrub queued · undo</button>`
      : `<button data-act="scrub" ${can && s.resources.crypto >= X.scrubCost && s.exposure > floor ? '' : 'disabled'}>Scrub −${X.scrubAmount} <small>${X.scrubCost} Crypto</small></button>`;
    const marks = X.levels.map((l, i) => `<i class="mark ${i <= lv ? 'on' : ''}" style="left:${l.at}%" title="${escapeHtml(l.name)} at ${l.at}"></i>`).join('');
    const exposure = `
      <div class="ops-block">
        <h3>Exposure <b class="expo-text lv${lv}">${Math.floor(s.exposure)} · ${exposureName(lv)}</b></h3>
        <div class="expo-meter"><i style="width:${Math.min(100, s.exposure)}%"></i>${floor ? `<em style="left:${floor}%" title="Floor: once Revealed, always Revealed"></em>` : ''}${marks}</div>
        <p class="muted">Loud acts raise it: declaring war, taking cities, killing kaiju, sealing rifts. Each level sours every faction's opinion of you. Revealed (50) is permanent and lures the Abyss ${RULES.abyss.lureHexesWhenRevealed} hexes further. Hunted (75) arms the natives against you. At 100 the world unites in a Crusade.${crusade(s) ? ' <b class="warn">The Crusade is on.</b>' : ''}</p>
        <div class="row">${scrub}</div>
      </div>`;
    const doctrine = doctrineVictory(s);
    const victories = allVictories(s)
      .map((v) => `<div class="victory ${v.won ? 'won' : ''} ${v.kind === doctrine ? 'aim' : ''}">
          <b>${v.title}${v.kind === doctrine ? ' <small>your doctrine</small>' : ''}${v.won ? ' <em class="gain">won</em>' : ''}</b>
          <small class="muted">${escapeHtml(v.goal)}</small>
          <div class="bar"><i style="width:${v.total ? (v.held / v.total) * 100 : 0}%"></i></div>
          <small>${escapeHtml(v.status)}</small></div>`)
      .join('');
    const rifts = s.rifts
      .map((r) => {
        if (!s.explored[r.tile]) return `<li class="muted">Uncharted rift${r.mother ? ' (something vast sleeps in one)' : ''}</li>`;
        const label = r.mother ? 'The Abyss Mother' : `Rift, tier ${r.tier + 1}`;
        const st = r.sealed ? '<b class="gain">sealed</b>' : `<b class="warn">open</b> · ${r.hp} HP`;
        return `<li><a data-act="focus" data-arg="${r.tile}">${label}</a> ${st}</li>`;
      })
      .join('');
    const A = RULES.ark;
    const stage = A.stages[s.ark.stage];
    let ark: string;
    if (!stage) ark = '<p class="gain">The Ark is complete.</p>';
    else if (s.ark.build) {
      const site = s.structures.find((x) => x.id === s.ark.build!.structureId);
      ark = `<p>Building <b>${escapeHtml(stage.name)}</b> at ${site ? escapeHtml(site.name) : '?'}: ${fmt(s.ark.build.progress)}/${stage.cycles} cycles, holds ${A.energy} Energy.</p><div class="bar"><i style="width:${(s.ark.build.progress / stage.cycles) * 100}%"></i></div>`;
    } else {
      const q = this.queued('ark');
      const needs = !s.techs.includes(stage.requires) ? `needs ${techDef(stage.requires).name}` : '';
      const nodes = s.structures.filter((x) => x.owner === PLAYER && x.type === 'ai-node');
      ark = `<p><b>Stage ${s.ark.stage + 1}: ${escapeHtml(stage.name)}</b> <small>${costText(stage.cost)} · ${stage.cycles} cycles · holds ${A.energy} Energy</small></p><p class="muted">${escapeHtml(stage.blurb)}</p>
        ${q ? `<button data-act="unqueue" data-arg="ark">Queued · undo</button>` : `<div class="row">${nodes.map((n) => `<button data-act="ark" data-arg="${n.id}" ${can && !needs && canAfford(s, stage.cost) ? '' : 'disabled'}>Start at ${escapeHtml(n.name)}${needs ? ` <small>${escapeHtml(needs)}</small>` : ''}</button>`).join('')}</div>`}`;
    }
    const market = RULES.market.offers
      .map((o) => {
        const q = this.queued(`market:${o.id}`);
        return q
          ? `<button data-act="unqueue" data-arg="market:${o.id}">${escapeHtml(o.name)} queued · undo</button>`
          : `<button data-act="market" data-arg="${o.id}" ${can && canAfford(s, o.give) ? '' : 'disabled'}>${escapeHtml(o.name)} <small>${costText(o.give)} → ${costText(o.get)}</small></button>`;
      })
      .join('');
    return `
      <header><h2>Operations <small>Every homeworld victory counts, and you can play past each one.</small></h2>
      <button class="ghost" data-act="sheet" data-arg="ops" aria-label="Close">✕</button></header>
      <div class="ops">
        <div class="ops-block"><h3>Victories</h3><div class="victories">${victories}</div></div>
        ${exposure}
        <div class="ops-block"><h3>The Abyss</h3><ul class="rifts">${rifts || '<li class="muted">No rifts found yet.</li>'}</ul>
          <p class="muted">Kaiju rise from rifts near settlements. Conventional units fight them at ${RULES.abyss.kaijuHidePct}%: build TBUs (Forge) or fuse hardened symbiotes (Genome).</p></div>
        <div class="ops-block"><h3>Exodus Ark</h3>${ark}</div>
        <div class="ops-block"><h3>Black market <small class="muted">one of each per cycle</small></h3><div class="build-list">${market}</div></div>
      </div>`;
  }

  // ---------------------------------------------------------------- M2: goals, advisor, reveal, music

  private renderGoals() {
    const el = this.ui.querySelector<HTMLElement>('.goals');
    if (!el) return;
    const g = goals(this.state, this.world, this.advice.length ? this.advice : undefined);
    const o = g.objective;
    const next = o.next
      ? o.next.known
        ? `Next: <a data-act="focus" data-arg="${o.next.tile}">${escapeHtml(o.next.name)}</a> <span class="muted">(${escapeHtml(o.next.faction)}, ${o.next.distance} hexes)</span>`
        : `<span class="muted">Find the remaining capitals.</span>`
      : `<span class="muted">${escapeHtml(o.status)}</span>`;
    const now = this.canAct() ? g.now : ['Watch the cycle play out'];
    el.innerHTML = `
      <div class="grow now"><span class="gtag">Now</span><ul>${now.slice(0, 3).map((n) => `<li>${escapeHtml(n)}</li>`).join('')}${now.length > 3 ? `<li class="muted">+${now.length - 3} more</li>` : ''}</ul></div>
      <button class="grow objective" data-act="sheet" data-arg="ops" title="Your doctrine's homeworld victory. Any of the four counts: see Operations (O).">
        <span class="gtag">Objective</span>
        <b>${o.title} ${o.held}/${o.total}${o.won ? ' <em class="gain">won</em>' : ''}</b>
        <div class="bar"><i style="width:${o.total ? (o.held / o.total) * 100 : 0}%"></i></div>
        <small>${next}</small>
      </button>
      <div class="grow ambition" title="${escapeHtml(g.ambition.text)}"><span class="gtag">Ambition</span>
        <b>${escapeHtml(g.ambition.doctrine)}</b> <small class="muted">${escapeHtml(g.ambition.fantasy)}</small>
        <small class="amb-text">${escapeHtml(g.ambition.text)}</small>
        <ol class="phases">${PHASES.map((p, i) => `<li class="${i === g.ambition.phase ? 'on' : i < g.ambition.phase ? 'done' : ''}">${p}</li>`).join('')}</ol>
      </div>`;
  }

  private renderAdvisor() {
    const el = this.ui.querySelector<HTMLElement>('.advisor');
    if (!el) return;
    const a = this.advice[this.adviceIndex];
    if (!a || !this.canAct() || this.ending) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const line = adviceLine(a, this.state.ai.temperament, this.state.cycle).replace('{world}', this.world.name);
    const urgent = a.priority >= 90 ? 'urgent' : '';
    el.className = `advisor ${urgent}`;
    el.innerHTML = `
      <img class="core-mini" src="art/ui_core_${a.priority >= 90 ? 'glitch' : 'idle'}.png" alt="" width="36" height="36" />
      <div class="adv-body">
        <small>Next best move <span class="muted">${this.adviceIndex + 1}/${this.advice.length}</span></small>
        <p>“${escapeHtml(line)}”</p>
        <div class="row">
          <button data-act="advice-do" class="${a.act.kind === 'end-cycle' ? 'end' : ''}">${escapeHtml(a.verb)} <small>N</small></button>
          ${this.advice.length > 1 ? '<button class="ghost" data-act="advice-next" title="Another suggestion">Next tip ›</button>' : ''}
        </div>
      </div>`;
  }

  private renderReveal() {
    const el = this.ui.querySelector<HTMLElement>('.reveal');
    if (!el) return;
    const rv = this.reveal;
    if (!rv || !rv.open || this.beat !== 'reckon') {
      el.classList.remove('show');
      el.innerHTML = '';
      return;
    }
    if (el.classList.contains('show') && el.dataset.cycle === String(this.report?.cycle)) return; // keep the animation state
    el.dataset.cycle = String(this.report?.cycle);
    el.classList.add('show');
    el.innerHTML = `
      <h2>Spoils <small>cycle ${this.report?.cycle}</small></h2>
      <div class="rcards">${rv.cards.map((c, i) => this.cardHtml(c, i)).join('')}</div>
      <div class="row"><button class="end" data-act="reveal-ok">Collect <small>Space</small></button></div>`;
  }

  private cardHtml(c: RewardCard, i: number): string {
    const r = rarityDef(c.rarity);
    const lines = [...c.lines];
    if (c.relic) lines.push(...relicDef(c.relic).effects.map(effectText));
    if (c.tech) lines.push(...techDef(c.tech).effects.map(effectText), ...unlocksOf(c.tech).map((u) => `Unlocks ${u}`));
    const icon = c.icon
      ? `<img class="ricon" src="art/${c.icon}" alt="" width="64" height="64" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ricon glyph',textContent:'✦'}))" />`
      : c.sprite
        ? `<div class="ricon sprite" style="background-image:url('art/${c.sprite}')"></div>`
        : `<div class="ricon glyph">${glyphFor(c)}</div>`;
    return `
      <button class="rcard r-${c.rarity}" data-act="reveal-card" data-arg="${i}" data-i="${i}" style="--rc:${r.color}">
        <div class="rface back"><span>?</span></div>
        <div class="rface front">
          <span class="rarity">${r.name}</span>
          ${icon}
          <small class="kicker">${escapeHtml(c.kicker)}</small>
          <b>${escapeHtml(c.title)}</b>
          ${lines.length ? `<ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>` : ''}
          ${c.blurb ? `<p>${escapeHtml(c.blurb)}</p>` : ''}
        </div>
      </button>`;
  }

  private syncMusic() {
    let cue = 'calm';
    const mine = this.state.structures.filter((x) => x.owner === PLAYER);
    const kaijuNear = this.state.units.some((u) => u.owner === ABYSS && unitDef(u.type).kaiju && this.visible.has(u.tile) && mine.some((x) => distance(x.tile, u.tile, this.world) <= 6));
    const motherFight = !!this.report?.events.some((e) => e.kind === 'combat' && e.defenderType === MOTHER) && this.beat !== 'decide';
    if (this.ending === 'defeat' || this.state.defeated) cue = 'defeat';
    else if (this.ending) cue = 'victory';
    else if (motherFight) cue = 'boss';
    else if (kaijuNear) cue = 'abyss';
    else if (this.state.factions.some((f) => f.atWar && !f.eliminated)) cue = 'war';
    audio.music(cue);
  }
}

function glyphFor(c: RewardCard): string {
  switch (c.kicker) {
    case 'Research complete':
      return '⌬';
    case 'City taken':
    case 'Capital taken':
      return '♜';
    case 'Faction fallen':
      return '✕';
    case 'First contact':
      return '◎';
    case 'Homeworld victory':
      return '♛';
    case 'Rift sealed':
      return '⊘';
    case 'The Abyss Mother retreats':
    case 'Boss slain':
      return '☠';
    default:
      return '✦';
  }
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

const SLOT_LABEL: Record<TitanSlot, string> = { head: 'Head', core: 'Core', armL: 'Left arm', armR: 'Right arm', back: 'Back', legs: 'Legs' };

/** Part art is shared by both arms. */
function slotFile(slot: TitanSlot): string {
  return slot === 'armL' || slot === 'armR' ? 'arm' : slot;
}

function strainTraits(st: StrainDef): string {
  return [
    `+${st.upowPct}% UPow${st.role ? ` on ${st.role}` : ''}`,
    st.hardened ? 'hardened vs kaiju' : '',
    st.vsKaijuPct ? `+${st.vsKaijuPct}% vs kaiju` : '',
    st.feeder ? '1.5× Essence' : '',
    st.heal ? `heals ${st.heal}` : '',
    st.sight ? `+${st.sight} sight` : '',
    st.speed ? `+${st.speed} speed` : '',
    st.influence ? `+${st.influence} Influence` : '',
  ]
    .filter(Boolean)
    .join(', ');
}

function symbioteBonus(b: { upowPct?: number; sight?: number; speed?: number; heal?: number }): string {
  return [b.upowPct ? `+${b.upowPct}% UPow` : '', b.sight ? `+${b.sight} sight` : '', b.speed ? `+${b.speed} speed` : '', b.heal ? `heals ${b.heal}` : ''].filter(Boolean).join(', ');
}

function loadBlueprint(): Record<TitanSlot, string> {
  const base = { ...TITANS.default } as Record<TitanSlot, string>;
  try {
    const raw = localStorage.getItem(BLUEPRINT_KEY);
    if (raw) {
      const parts = titanParts(raw);
      if (parts) for (const k of TITAN_SLOTS) base[k] = parts[k].id;
    }
  } catch {
    /* storage blocked */
  }
  return base;
}

function saveBlueprint(b: Record<TitanSlot, string>): void {
  try {
    localStorage.setItem(BLUEPRINT_KEY, titanType(b));
  } catch {
    /* storage blocked */
  }
}
