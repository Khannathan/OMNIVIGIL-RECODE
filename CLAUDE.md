# OMNIVIGIL: notes for Claude

- Source of truth: `docs/design-bible.md`. Section 24 = locked decisions; ask Aaron before changing any. Build order is section 22 (M0..M8).
- Aaron gives broad creative liberty. Mark proposals that go beyond the bible as **[Claude idea]**.
- Art is made by ChatGPT, audio by Suno. When you need an asset, add a request to `docs/ART_REQUESTS.md` (or an AUDIO REQUEST) in the section 20 format, add the file to `src/content/art.json`, and add a placeholder maker in `scripts/gen-placeholders.mjs`.

## Architecture rules
- `src/sim/` must stay deterministic and DOM-free. All randomness comes from `Rng` streams derived from the seed (`Rng.stream(seed, name)`); never use `Math.random` or `Date` in the sim. Add a new stream name for a new system rather than drawing from an existing one.
- Player input becomes `Order`s queued with `queueOrder`; only `resolveCycle` changes the world. This keeps the door open for online play (M8).
- Game state is plain data (see `GameState`) so it serialises and hashes. The world map is not saved; it is regrown from the seed. Bump `WORLDGEN_VERSION` when worldgen output changes and `STATE_VERSION` when the save shape changes.
- Content lives in `src/content/*.json`. Prefer data over code.
- The homeworld is never Earth (`isForbiddenWorldName`).

## Checks
- `npm test` (vitest): includes a bot that plays several seeds and checks determinism and save/load equivalence.
- `npm run build` runs `tsc` then Vite.
- Dev-only key: backquote reveals the whole map.
