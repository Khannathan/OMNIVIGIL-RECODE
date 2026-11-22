# OMNIVIGIL

A turn-based 4X browser game where you are an **Ascendant AI**. Every run is a new universe grown from one seed.

The design lives in [`docs/design-bible.md`](docs/design-bible.md), the single source of truth. Section 24 lists locked decisions.

## Status: M3 Depth

Built on M0 Foundations, M1 Earthfall and M2 Feel.

- **Genesis Forge (lite):** before the run, pick an Origin, Architecture, Temperament and Doctrine (each with real effects), an epithet and a banner colour.
- **Four factions:** a Nation, a Corporation, a Cult and the world's Native Species, each with a capital, towns, armies, territory and an opinion of you. They go to war with you and with each other.
- **Five resources:** Compute (research), Matter (units), Influence (diplomacy), Symbiotic Essence (genes and symbiotes, dropped by kaiju and rifts) and Crypto (the black market, scrubbing Exposure, premium parts). Energy is allocated, never spent; over-allocate and you brown out.
- **Research:** 31 techs in 4 tiers (`src/content/techs.json`).
- **The Abyss:** kaiju rise from ocean rifts near settlements, wade ashore, ravage a settlement and sink back. Conventional units fight them at -60%. Break a rift's heart (with air units or amphibious TBUs) to seal it. The first rift holds the Abyss Mother, who retreats deeper each time she is beaten until every other rift is sealed.
- **Titan Forge (T):** design Titan Battle Units from 22 parts across six slots (head, core, two arms, back, legs). TBUs never suffer the kaiju penalty.
- **Genome Lab (B):** sequence 12 genes in four strands with Essence and fuse 8 symbiote strains into units. Hardened strains ignore the kaiju penalty.
- **Exposure:** loud acts raise it. Noticed at 25, Revealed at 50 (permanent), Hunted at 75, and at 100 the world unites in a Crusade against you. Scrub it with Crypto.
- **Four homeworld victories (Operations, O):** Dominion (hold every original capital), Assimilation (every surviving faction Devoted), Exodus (build the Ark in three stages) and Guardian (seal the rifts, then kill the Mother). You can play past each and win more than one.
- **Combat forecast:** right-click an enemy hex to see both sides' UPow, every modifier and the exact win chance before you commit.
- **Watch and Reckon:** each cycle plays back with tracers, explosions and hit-stop, then reward cards reveal the spoils.

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
| Titan Forge / Genome Lab / Operations | T / B / O |
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
  abyss.ts     Abyssians, rifts and the Abyss Mother
  titans.ts    Titan Forge helpers
  exposure.ts  Exposure levels and the Crusade
  victory.ts   The four homeworld victories
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
