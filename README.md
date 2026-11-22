# OMNIVIGIL

A turn-based 4X browser game where you are an **Ascendant AI**. Every run is a new universe grown from one seed.

The design lives in [`docs/design-bible.md`](docs/design-bible.md), the single source of truth. Section 24 lists locked decisions.

## Status: M0 Foundations

- **Seed:** type one, roll one, or play the Daily Seed. Everything comes from it.
- **Homeworld hex map:** 72 x 44 pointy-top hexes, wraps east-west, ice caps at the poles. Seeded name (never Earth), 13 terrain types, ruins and abyssal rifts. Fog of war.
- **Cycle loop:** Sense, Decide, Resolve, Watch, Reckon. Orders go in a queue and resolve together at End Cycle. Units glide along their paths during Watch (Space skips). Reckon shows yields, discoveries and a line in your AI's voice.
- **Your Node:** works nearby hexes for Compute and Matter, supplies Energy (allocated, never spent; over-allocate and you brown out), and builds Observer Drones and Sentinel Troopers.
- **Saves:** local, one per seed, autosaved every cycle. A save stores only what changed; the map is regrown from the seed.
- **Placeholder art** under the final file names and sizes.

## Run it

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
  path.ts      A* pathfinding, movement rules
  cycle.ts     Order queue and cycle resolution
  bot.ts       Headless bot used by tests
src/content/   Game data as JSON: terrain, units, structures, names, narrator lines, art manifest
src/save/      Local saves
src/render/    WebGL2 sprite renderer and map view
src/ui/        HUD styles and number formatting
src/game.ts    In-game controller (input, beats, HUD)
src/main.ts    Title screen and boot
assets/art/    Art, by final file name. Served as art/<file>
assets/audio/  Audio (none yet)
scripts/gen-placeholders.mjs  Regenerates placeholder art
docs/          Design bible and art requests
```

## Art and audio

Art comes from ChatGPT and audio from Suno (design bible section 20). Requests in the section 20 format are in [`docs/ART_REQUESTS.md`](docs/ART_REQUESTS.md).

To replace a placeholder, drop the real PNG into `assets/art/` with the **same file name and size**. `src/content/art.json` lists every file. `npm run placeholders` only fills in missing files, so it never overwrites real art (pass `-- --force` to regenerate everything).
