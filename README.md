# OMNIVIGIL

A turn-based 4X browser game where you are an **Ascendant AI**. Every run is a new universe grown from one seed.

The design lives in [`docs/design-bible.md`](docs/design-bible.md), the single source of truth. Section 24 lists locked decisions.

## Status: M1 Earthfall slice

Built on M0 Foundations (seed, wrapping hex homeworld with fog, the five-beat cycle, saves, placeholder art).

- **Genesis Forge (lite):** before the run, pick an Origin, Architecture, Temperament and Doctrine (each with real effects), an epithet and a banner colour.
- **Four factions:** a Nation, a Corporation, a Cult and the world's Native Species, each seeded with a name, a capital and 1-2 towns, armies, territory and an opinion of you (-100 Hostile to 80+ Devoted). Your units in their territory sour it; at -50 they declare war. They also go to war with each other.
- **Resources:** Compute (research), Matter (units), Influence (diplomacy: Sway, Make peace, Incite war), plus Energy, which is allocated, never spent (units, builds and research each hold some; over-allocate and you brown out).
- **Research:** 20 techs in 4 tiers (`src/content/techs.json`).
- **Six units:** Observer Drone, Sentinel Trooper, Bastion Tank, Tidewarden (sea), Shrike Jet and Lance Missile (one-shot). Natives field Militia, Armored Columns and Gunships.
- **Combat forecast:** right-click an enemy hex to see both sides' UPow, every modifier and the exact win chance before you commit. Settlements fight with their walls when nobody defends them.
- **Victory: Dominion.** Hold every faction's original capital at once. You can keep playing after you win. Lose every settlement and it is a shutdown.

## Play it

**https://khannathan.github.io/OMNIVIGIL-RECODE/** (every push to `main` redeploys it through GitHub Pages).

## Run it locally

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # sim, worldgen, saves, and a headless bot that plays seeds
npm run build      # static site in dist/
```

**itch.io:** run `npm run build`, zip the *contents* of `dist/` (so `index.html` is at the top of the zip) and upload it as an HTML game.

## Controls

| Action | Input |
|---|---|
| Pan | Drag, or WASD / arrow keys |
| Zoom | Mouse wheel, or + / - |
| Select | Click (click again to cycle units on a hex) |
| Move selected unit | Right-click a hex, or M then click |
| Attack | Right-click an enemy hex (shows the forecast; at peace it asks first) |
| Research / Factions | R / F |
| End cycle / continue | Enter |
| Skip the Watch playback | Space |
| Grid toggle | G |
| Jump to your Node | H |

## Layout

```
src/sim/       Deterministic simulation. No DOM, no rendering.
  rng.ts       Seeded RNG with named streams
  hex.ts       Pointy-top hex math with east-west wrap
  noise.ts     Seeded 3D noise (sampled on a cylinder for a seamless wrap)
  worldgen.ts  Homeworld generation
  state.ts     Game state, Energy, fog
  path.ts      A* pathfinding, movement rules (land, air, sea, embarking)
  effects.ts   Folds Forge choices and techs into one set of modifiers
  combat.ts    UPow, modifiers, the exact forecast, and the fight itself
  actions.ts   What a unit does in Resolve: move, strike, capture; war and peace
  factions.ts  Faction production, army AI, opinion and wars
  cycle.ts     Order queue and cycle resolution
  bot.ts       Headless bot used by tests
src/content/   Game data as JSON: terrain, units, structures, techs, factions, Forge options, rules (tuning), names, narrator lines, art manifest
src/save/      Local saves
src/render/    WebGL2 sprite renderer and map view
src/ui/        HUD styles, number formatting, effect descriptions
src/game.ts    In-game controller (input, beats, HUD)
src/main.ts    Title screen, Genesis Forge and boot
assets/art/    Art, by final file name. Served as art/<file>
assets/audio/  Audio (none yet)
scripts/gen-placeholders.mjs  Regenerates placeholder art
docs/          Design bible and art requests
```

## Art and audio

Art comes from ChatGPT and audio from Suno (design bible section 20). Requests in the section 20 format (art and audio) are in [`docs/ART_REQUESTS.md`](docs/ART_REQUESTS.md).

To replace a placeholder, drop the real PNG into `assets/art/` with the **same file name and size**. `src/content/art.json` lists every file. `npm run placeholders` only fills in missing files, so it never overwrites real art (pass `-- --force` to regenerate everything).

## Balancing

Tuning numbers live in `src/content/rules.json` (start resources, walls, diplomacy costs, faction production and aggression). Unit stats are in `units.json`, tech costs in `techs.json`.
