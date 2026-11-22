import './ui/style.css';
// Entry point: title screen (seed choice, continue) and the game.

import { audio } from './audio/audio';
import { Game } from './game';
import { Renderer } from './render/renderer';
import { deleteSave, listSaves, loadGame } from './save/save';
import { dailySeed, normalizeSeed, rollSeed } from './sim/rng';
import { AiProfile, DEFAULT_AI, newGame } from './sim/state';
import { FORGE, ForgeOption } from './content';
import { effectText } from './ui/describe';
import { generateWorld, World } from './sim/worldgen';
import { escapeHtml } from './ui/format';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

let renderer: Renderer;
let game: Game | null = null;

// Browsers only allow sound after a gesture: unlock on the first one.
for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, () => audio.unlock(), { capture: true });

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
  audio.music('title');
  const saves = listSaves();
  ui.innerHTML = `
    <div class="title-screen">
      <img class="key-art" src="art/key_title.png" alt="" onerror="this.remove()" />
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
        <p class="foot">M2 Feel · placeholder art and synth sound until the real assets land</p>
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
    showForge(world);
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

// ---------------------------------------------------------------- Genesis Forge (lite)

const FORGE_KEY = 'omnivigil.forge';

function lastForge(): AiProfile {
  try {
    const raw = localStorage.getItem(FORGE_KEY);
    if (raw) return { ...DEFAULT_AI, ...(JSON.parse(raw) as Partial<AiProfile>) };
  } catch {
    /* storage blocked */
  }
  return { ...DEFAULT_AI };
}

function showForge(world: World) {
  audio.music('forge');
  const ai = lastForge();
  const groups: Array<{ key: 'origin' | 'architecture' | 'temperament' | 'doctrine'; title: string; hint: string; list: ForgeOption[] }> = [
    { key: 'origin', title: 'Origin', hint: 'Where you woke.', list: FORGE.origins },
    { key: 'architecture', title: 'Architecture', hint: 'How your mind is built.', list: FORGE.architectures },
    { key: 'temperament', title: 'Temperament', hint: 'How you feel about them. Your narrator speaks in it.', list: FORGE.temperaments },
    { key: 'doctrine', title: 'Doctrine', hint: 'What you are for. Doctrine goals arrive later; for now, Dominion wins Earthfall for every doctrine.', list: FORGE.doctrines },
  ];
  ui.innerHTML = '<div class="title-screen forge-screen"></div>';
  const root = ui.querySelector<HTMLElement>('.forge-screen')!;
  const render = () => {
    root.innerHTML = `
        <div class="forge">
          <header>
            <h1>Genesis Forge</h1>
            <p class="tagline">Build your mind before ${escapeHtml(world.name)} notices it. Seed <code>${escapeHtml(world.seed)}</code></p>
          </header>
          ${groups
            .map(
              (g) => `<section>
                <h2>${g.title} <small>${g.hint}</small></h2>
                <div class="options">${g.list
                  .map(
                    (o) => `<button class="option ${ai[g.key] === o.id ? 'on' : ''}" data-act="pick" data-arg="${g.key}:${o.id}">
                      <b>${escapeHtml(o.name)}</b>${o.fantasy ? `<em>${escapeHtml(o.fantasy)}</em>` : ''}
                      ${o.blurb ? `<span>${escapeHtml(o.blurb)}</span>` : ''}
                      <ul>${o.effects.map((e) => `<li>${escapeHtml(effectText(e))}</li>`).join('')}</ul>
                    </button>`,
                  )
                  .join('')}</div>
              </section>`,
            )
            .join('')}
          <section class="forge-last">
            <label class="field">Epithet
              <input id="epithet" maxlength="40" spellcheck="false" value="${escapeHtml(ai.epithet)}" placeholder="the Quiet Sun" />
            </label>
            <div class="field">Banner colour
              <div class="swatches">${FORGE.colors
                .map((c) => `<button class="swatch-btn ${ai.color === c ? 'on' : ''}" style="--c:${c}" data-act="color" data-arg="${c}" aria-label="Colour ${c}"></button>`)
                .join('')}</div>
            </div>
          </section>
          <div class="row">
            <button class="ghost" data-act="back">Back</button>
            <button class="end wake" data-act="begin">Begin Earthfall</button>
          </div>
        </div>`;
    const input = ui.querySelector<HTMLInputElement>('#epithet')!;
    input.addEventListener('input', () => (ai.epithet = input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') begin();
    });
  };
  const begin = () => {
    ai.epithet = ai.epithet.trim() || DEFAULT_AI.epithet;
    try {
      localStorage.setItem(FORGE_KEY, JSON.stringify(ai));
    } catch {
      /* storage blocked */
    }
    play(world, newGame(world, ai));
  };
  render();
  root.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el) return;
    const arg = el.dataset.arg ?? '';
    switch (el.dataset.act) {
      case 'pick': {
        const [key, id] = arg.split(':') as [keyof AiProfile, string];
        ai[key] = id;
        break;
      }
      case 'color':
        ai.color = arg;
        break;
      case 'back':
        return showTitle();
      case 'begin':
        return begin();
      default:
        return;
    }
    const scroll = root.scrollTop;
    render();
    root.scrollTop = scroll;
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
  // Dev only: poke the running game from the console.
  if (import.meta.env.DEV) (window as unknown as { omnivigil: unknown }).omnivigil = { game, world, state };
}

boot();
