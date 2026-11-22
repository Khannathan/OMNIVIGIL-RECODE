import './ui/style.css';
// Entry point: title screen (seed choice, continue) and the game.

import { Game } from './game';
import { Renderer } from './render/renderer';
import { deleteSave, listSaves, loadGame } from './save/save';
import { dailySeed, normalizeSeed, rollSeed } from './sim/rng';
import { newGame } from './sim/state';
import { generateWorld, World } from './sim/worldgen';
import { escapeHtml } from './ui/format';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

let renderer: Renderer;
let game: Game | null = null;

async function boot() {
  try {
    renderer = new Renderer(canvas);
  } catch (err) {
    ui.innerHTML = `<div class="title-screen"><div class="title-card"><h1>OMNIVIGIL</h1><p>${escapeHtml(String((err as Error).message))}</p></div></div>`;
    return;
  }
  const missing = await renderer.load();
  if (missing.length) console.warn('Missing art (using checkerboards):', missing);
  showTitle();
}

function showTitle() {
  game?.dispose();
  game = null;
  const saves = listSaves();
  ui.innerHTML = `
    <div class="title-screen">
      <div class="title-card">
        <h1>OMNIVIGIL</h1>
        <p class="tagline">You are an Ascendant AI. One seed, one universe.</p>
        <label class="field">Seed
          <div class="seed-row">
            <input id="seed" spellcheck="false" autocomplete="off" maxlength="48" value="${escapeHtml(rollSeed())}" />
            <button class="ghost" data-act="roll" title="Roll a new seed">Roll</button>
            <button class="ghost" data-act="daily" title="Everyone gets the same world today">Daily</button>
          </div>
        </label>
        <p class="preview" id="preview"></p>
        <label class="field">Start
          <select id="start">
            <option value="short" selected>Short Earthfall</option>
            <option value="classic" disabled>Classic Earthfall (coming)</option>
            <option value="orbit" disabled>Start in Orbit (coming)</option>
            <option value="explore" disabled>Explore Only (coming)</option>
          </select>
        </label>
        <button class="end wake" data-act="wake">Wake</button>
        ${
          saves.length
            ? `<h2>Continue</h2><ul class="saves">${saves
                .map(
                  (s) => `<li>
                    <button class="save" data-act="continue" data-arg="${escapeHtml(s.seed)}">
                      <b>${escapeHtml(s.worldName)}</b><span>Cycle ${s.cycle} · <code>${escapeHtml(s.seed)}</code></span>
                    </button>
                    <button class="ghost del" data-act="delete" data-arg="${escapeHtml(s.seed)}" aria-label="Delete save">✕</button>
                  </li>`,
                )
                .join('')}</ul>`
            : ''
        }
        <p class="foot">M0 Foundations · placeholder art</p>
      </div>
    </div>`;

  const input = ui.querySelector<HTMLInputElement>('#seed')!;
  const preview = ui.querySelector<HTMLElement>('#preview')!;
  let previewWorld: World | null = null;
  let timer = 0;
  const updatePreview = () => {
    const seed = normalizeSeed(input.value);
    if (!seed) {
      preview.textContent = 'Type a seed or roll one.';
      previewWorld = null;
      return;
    }
    previewWorld = generateWorld(seed);
    preview.innerHTML = `Homeworld: <b>${escapeHtml(previewWorld.name)}</b> · ${escapeHtml(previewWorld.kind)}`;
  };
  updatePreview();
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(updatePreview, 150);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') start();
  });

  const start = () => {
    const seed = normalizeSeed(input.value);
    if (!seed) return;
    const world = previewWorld?.seed === seed ? previewWorld : generateWorld(seed);
    // One save slot per seed: waking on a seed you already play continues it.
    const existing = loadSafe(seed);
    if (existing) {
      return play(world, existing, 'You already have a run on this seed, so it continues. Delete it on the title screen to start over.');
    }
    play(world, newGame(world));
  };

  ui.querySelector('.title-card')!.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el) return;
    const arg = el.dataset.arg ?? '';
    switch (el.dataset.act) {
      case 'roll':
        input.value = rollSeed();
        return updatePreview();
      case 'daily':
        input.value = dailySeed();
        return updatePreview();
      case 'wake':
        return start();
      case 'continue': {
        const state = loadSafe(arg);
        if (!state) return;
        const world = generateWorld(arg);
        const notice =
          world.checksum !== state.worldChecksum
            ? 'This save was made with an older map generator. The world may look different.'
            : undefined;
        return play(world, state, notice);
      }
      case 'delete':
        deleteSave(arg);
        return showTitle();
    }
  });
}

function loadSafe(seed: string) {
  try {
    return loadGame(seed);
  } catch (err) {
    console.warn(err);
    return null;
  }
}

function play(world: World, state: ReturnType<typeof newGame>, notice?: string) {
  ui.innerHTML = '';
  game = new Game(renderer, ui, world, state, showTitle, notice);
}

boot();
