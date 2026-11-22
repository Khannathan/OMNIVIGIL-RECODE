# Art requests

Paste these to ChatGPT one at a time (design bible section 20). Each file replaces a placeholder already in `assets/art/` with the same name. Style and palette: design bible section 18.

---

```
ART REQUEST #1
Asset: hex_deep-sea.png, hex_shallow-sea.png, hex_coast.png, hex_grassland.png, hex_forest.png, hex_hills.png, hex_mountain.png, hex_desert.png, hex_tundra.png, hex_snow.png, hex_marsh.png, hex_ruins.png, hex_rift.png
What: The homeworld hex terrain set, one PNG per terrain. Dense painterly pixel art. Coast is water next to land (foam, shallows). Ruins are overgrown foundations of a vanished civilisation. Rift is a glowing red wound in the deep sea floor where Abyssians rise.
Size: 64x74 each (pointy-top hex, 64 px wide), transparent outside the hexagon
View: top-down with a slight 3/4 feel, lit from the top-left
Palette notes: Sea abyss #04162f, deep #061a33, mid #033957, shallow #075b71, surf #5e9e9c, foam #cfe6e0. Land forest dark #163232, forest #20453d, forest light #498767, grass #729f81, rock #456b63, sand #c9b98e, snow #e4ece8. Rift glow #ff2848.
Background: transparent PNG
Context: The main game map. Tiles sit edge to edge, so edges must tile cleanly with neighbours of any type.
```

```
ART REQUEST #2
Asset: unit_observer-drone_idle.png
What: Observer Drone, a small hovering recon drone with a single sensor eye. Idle = gentle hover bob.
Size: 64x64 per frame, 4 frames in one row (256x64)
View: side / 3-4, facing right
Palette notes: dark metal body, 1px dark outline, team-coloured parts (the eye, running lights) in pure #ff00ff
Background: transparent PNG
Context: Your first scout. Drawn at 75% scale on a hex.
```

```
ART REQUEST #3
Asset: unit_sentinel-trooper_idle.png
What: Sentinel Trooper, an armoured android infantry unit with a rifle. Idle = subtle breathing / weight shift.
Size: 64x64 per frame, 4 frames in one row (256x64)
View: side / 3-4, facing right
Palette notes: gunmetal armour, 1px dark outline, team-coloured visor and chest light in pure #ff00ff
Background: transparent PNG
Context: Your first ground unit. Drawn at 75% scale on a hex.
```

```
ART REQUEST #4
Asset: structure_ai-node_stage1.png, structure_ai-node_stage2.png, structure_ai-node_stage3.png
What: Your AI's Node at three growth stages: (1) a single hardened server tower, (2) a small data-centre compound, (3) a towering compute spire with a beacon.
Size: 64x64 each
View: 3/4, sitting on a hex
Palette notes: roof #716a61, wall #4c4746, window #ffc65a; team-coloured glow (beacon, cable lights) in pure #ff00ff
Background: transparent PNG
Context: Your settlement on the map. It grows as you gather Compute.
```

```
ART REQUEST #5
Asset: icon_energy.png, icon_compute.png, icon_matter.png
What: Resource icons. Energy = lightning bolt / power cell. Compute = processor chip. Matter = alloy cube or ingot.
Size: 32x32 each, must read at 20-24 px
View: flat icon
Palette notes: Energy amber #ffb84a, Compute cyan #5fe0ff, Matter steel grey. 1px dark outline.
Background: transparent PNG
Context: HUD top bar and tile info.
```

```
ART REQUEST #6
Asset: ui_core_idle.png, ui_core_pulse.png, ui_core_glitch.png
What: The AI Core HUD badge: a circular machine eye / core. Idle = calm glow. Pulse = brighter, expanded ring (plays while a cycle resolves). Glitch = corrupted, red-shifted, scanline tear (brownout and bad news).
Size: 64x64 each
View: flat, front-on
Palette notes: player glow #5fe0ff, UI background #0b1722, accent #e0283c for glitch
Background: transparent PNG
Context: Top-left of the HUD; it reacts to the game.
```

---

## M1 Earthfall slice

```
ART REQUEST #7
Asset: unit_bastion-tank_idle.png
What: Bastion Tank, a heavy autonomous battle tank with a squat turret and long gun. No crew hatch: it is a machine. Idle = engine idle shudder, tracks still.
Size: 64x64 per frame, 4 frames in one row (256x64)
View: side / 3-4, facing right
Palette notes: gunmetal hull, 1px dark outline, team-coloured sensor strip and running lights in pure #ff00ff
Background: transparent PNG
Context: Your main siege unit. Drawn at 75% scale on a hex.
```

```
ART REQUEST #8
Asset: unit_tidewarden_idle.png
What: Tidewarden, a sleek autonomous warship (corvette size) with a deck gun and sensor mast. Idle = gentle bob on the water, a little foam at the bow.
Size: 64x64 per frame, 4 frames in one row (256x64)
View: side / 3-4, facing right
Palette notes: dark naval grey, 1px dark outline, team-coloured hull stripe and mast light in pure #ff00ff
Background: transparent PNG
Context: Your sea unit. Shells anything next to the water.
```

```
ART REQUEST #9
Asset: unit_shrike-jet_idle.png
What: Shrike Jet, an unmanned delta-wing strike fighter. Idle = hovering in place with a flickering afterburner.
Size: 64x64 per frame, 4 frames in one row (256x64)
View: side / 3-4, facing right
Palette notes: dark grey airframe, 1px dark outline, engine glow #ffb84a, team-coloured canopy strip in pure #ff00ff
Background: transparent PNG
Context: Your fast air strike unit.
```

```
ART REQUEST #10
Asset: unit_lance-missile_idle.png
What: Lance Missile, a cruise missile in flight: slim body, small fins, bright exhaust. Idle = exhaust flicker.
Size: 64x64 per frame, 4 frames in one row (256x64)
View: side, facing right
Palette notes: pale steel body, 1px dark outline, exhaust #ffb84a, team-coloured nose band in pure #ff00ff
Background: transparent PNG
Context: One-shot strike unit; it is spent when it attacks.
```

```
ART REQUEST #11
Asset: unit_militia_idle.png, unit_armor_idle.png, unit_gunship_idle.png
What: The homeworld natives' army, used by every faction (recoloured per faction). Militia = rifle infantry in fatigues and soft caps. Armored Column = an old wheeled APC / light tank. Gunship = an attack helicopter. Organic, worn, human-made: they should look outmatched next to your machines, but numerous. Idle: militia shifts weight, armor engine shudder, gunship rotor blur.
Size: 64x64 per frame, 4 frames in one row (256x64) each
View: side / 3-4, facing right
Palette notes: olive drab and khaki, 1px dark outline; faction-coloured armband, stripe or cockpit glow in pure #ff00ff
Background: transparent PNG
Context: Faction units on the map.
```

```
ART REQUEST #12
Asset: structure_city-nation_stage1.png, structure_city-nation_stage2.png, structure_city-nation_stage3.png
What: A Nation's city at three sizes: (1) a walled town with a flag, (2) a small city with civic buildings, (3) a capital with a domed parliament and towers. Brick and stone, warm window light.
Size: 64x64 each
View: 3/4, sitting on a hex
Palette notes: roof #716a61, wall #4c4746, window #ffc65a; faction flag and banners in pure #ff00ff
Background: transparent PNG
Context: Faction cities. Capitals carry a gold star in game.
```

```
ART REQUEST #13
Asset: structure_city-corp_stage1.png, structure_city-corp_stage2.png, structure_city-corp_stage3.png
What: A Corporation's city: (1) a fenced campus with one glass office block, (2) a cluster of glass towers, (3) a megacorp arcology with a logo spire.
Size: 64x64 each
View: 3/4, sitting on a hex
Palette notes: blue-grey glass and steel, cold white light, window #ffc65a sparingly; logo and accent lights in pure #ff00ff
Background: transparent PNG
Context: Faction cities.
```

```
ART REQUEST #14
Asset: structure_city-cult_stage1.png, structure_city-cult_stage2.png, structure_city-cult_stage3.png
What: A Cult's city: (1) a compound around a chapel, (2) a walled town of spires, (3) a cathedral-city with a great broadcast antenna on its tallest spire (they worship signals).
Size: 64x64 each
View: 3/4, sitting on a hex
Palette notes: dark stone, deep red #3a0d1a shadows, candle-amber windows; banners in pure #ff00ff
Background: transparent PNG
Context: Faction cities.
```

```
ART REQUEST #15
Asset: structure_city-native_stage1.png, structure_city-native_stage2.png, structure_city-native_stage3.png
What: The world's native (non-human) species: (1) grown dome-huts, (2) a reef-like hive of domes and stalks, (3) a living citadel of fungal towers. Truly alien, organic, bioluminescent.
Size: 64x64 each
View: 3/4, sitting on a hex
Palette notes: fungal cap #a4507a, spore glow #d0ff7a, forest #20453d; glowing pods in pure #ff00ff
Background: transparent PNG
Context: Faction cities.
```

```
ART REQUEST #16
Asset: icon_influence.png
What: Influence resource icon: a radiating signal / eye of concentric rings.
Size: 32x32, must read at 20-24 px
View: flat icon
Palette notes: violet #b98cff with a pale centre, 1px dark outline
Background: transparent PNG
Context: HUD top bar.
```

```
ART REQUEST #17
Asset: fx_impact.png
What: Combat impact burst: flash, fireball, expanding shock ring, sparks, smoke fade.
Size: 64x64 per frame, 6 frames in one row (384x64)
View: front-on
Palette notes: engine #ffb84a, hot core #ffe9b0, rift red #ff2848 for the ring
Background: transparent PNG
Context: Plays on a hex during the Watch beat when a fight happens.
```

```
AUDIO REQUEST #1
File: music_earthfall-calm.mp3
Type: music loop
Length: 2-3 min loop
Suno prompt: ambient strategy game music, warm strings, gentle synth arpeggios, mysterious, slow tempo, instrumental
Context: Earthfall while at peace (wired up in M2).
```

```
AUDIO REQUEST #2
File: music_earthfall-war.mp3
Type: music loop
Length: 2-3 min loop
Suno prompt: cinematic sci-fi battle music, driving percussion, distorted synth bass, brass stabs, urgent, instrumental
Context: Earthfall while at war with any faction (wired up in M2).
```

---

## M2: Feel

The Watch playback, reward reveals and title screen. The game already runs with placeholders under these names.

```
ART REQUEST #18
Asset: fx_explosion.png
What: A unit exploding: white-hot flash, orange fireball that swells, a shock ring, then rolling dark smoke that thins out. The big "you killed it" moment of every fight.
Size: 64x64 per frame, 8 frames in one row (512x64)
View: front-on
Palette notes: hot core #fff3c8 and #ffd36a, fireball engine #ffb84a into #c2401a, smoke #3a3434 to #4a4646, a thin rift-red #ff2848 shock ring in frames 2-5
Background: transparent PNG
Context: Plays on the loser's hex in the Watch beat, scaled up 1.5x for big moments (capitals, walls, your own losses). An additive glow is added by the game, so keep the art itself crisp.
```

```
ART REQUEST #19
Asset: fx_muzzle.png
What: Muzzle flash pointing right: a bright star-shaped burst with a short cone of fire.
Size: 32x32 per frame, 4 frames in one row (128x32)
View: side, firing to the right (the game rotates it toward the target)
Palette notes: paint it in white and very light grey only; the game tints it amber for guns, cyan for lasers, orange for missiles
Background: transparent PNG
Context: Appears at the shooter for every shot in the Watch beat. Drawn additively (it glows).
```

```
ART REQUEST #20
Asset: fx_tracer.png
What: A single tracer round / energy bolt travelling right: faint tail on the left, bright head on the right.
Size: 24x6, one frame
View: side, travelling to the right (the game rotates it)
Palette notes: white and light grey only, so the game can tint it per weapon; tail fades to transparent
Background: transparent PNG
Context: Flies between units in the Watch beat. Drawn additively with a soft glow behind it.
```

```
ART REQUEST #21
Asset: icon_relic_cracked-lens.png, icon_relic_echo-lattice.png, icon_relic_iron-psalm.png, icon_relic_silent-ledger.png, icon_relic_precursor-heartbeat.png, icon_relic_witness-engine.png, icon_relic_the-first-fork.png
What: Precursor fragments, relics of an older AI that ascended on this world and failed. One icon each:
  - Cracked Lens (rare): a split circular optic, cyan glass.
  - Echo Lattice (epic): a violet crystal lattice with echoes of itself inside.
  - Iron Psalm (epic): a dark iron shield etched with glowing script, violet light in the grooves.
  - Silent Ledger (epic): a sealed black-and-bone data tablet with violet ruled lines.
  - Precursor Heartbeat (legendary): an amber power core with a heartbeat line across it.
  - Witness Engine (legendary): a mechanical amber eye, half-open, ancient.
  - The First Fork (mythic): a crimson Y-shaped fork of light inside a broken ring, the Precursor's own code.
Size: 64x64 each, must read at 48 px
View: flat icon, slight 3/4
Palette notes: dark metal and stone, 1px dark outline, glow in the rarity colour (rare #5fe0ff, epic #b98cff, legendary #ffb84a, mythic #ff2848)
Background: transparent PNG
Context: Shown on reward cards when a ruin cache holds a relic. Relics are permanent upgrades, so they should feel precious and ancient.
```

```
ART REQUEST #22
Asset: key_title.png
What: Title screen key art. A seeded alien homeworld seen from orbit at night: the curved limb of the planet across the lower half, deep navy seas and dark teal land, tiny amber city lights, a thin cyan atmosphere glow. Above, a starfield with a teal nebula on the left and a faint crimson nebula on the right. Somewhere on the night side, one point of cold cyan light that is clearly "you". Dark, epic, quiet. No text, no Earth.
Size: 1280x720
View: orbital
Palette notes: void #04070d, nebula teal #0e3a46, nebula red #3a0d1a, sea #061a33, forest dark #163232, window #ffc65a, player glow #5fe0ff
Background: opaque PNG (it fills the screen)
Context: Behind the title card ("OMNIVIGIL", seed, Wake). The middle third sits behind UI, so keep detail toward the edges and bottom.
```

```
AUDIO REQUEST #3
File: music_title.mp3
Type: music loop
Length: 2-3 min loop
Suno prompt: dark cinematic synthwave, slow build, analog pads, deep sub bass, distant choir, cold arpeggio, epic sci-fi, instrumental
Context: Title screen.
```

```
AUDIO REQUEST #4
File: music_genesis-forge.mp3
Type: music loop
Length: 2-3 min loop
Suno prompt: minimal ambient electronica, glitchy textures, soft pulses, data sounds, hopeful, instrumental
Context: The Genesis Forge (building your AI before the run).
```

```
AUDIO REQUEST #5
File: music_victory.mp3
Type: music loop
Length: 1-2 min loop
Suno prompt: cinematic finale, swelling orchestra and synth, bittersweet, epic resolution, instrumental
Context: After a homeworld victory (Dominion).
```

```
AUDIO REQUEST #6
File: music_defeat.mp3
Type: music loop
Length: 1-2 min loop
Suno prompt: slow fading synth, broken signal, lonely piano, quiet, instrumental
Context: Shutdown (your last settlement fell).
```

The sound effects below are short. If Suno can't make one well, skip it: the game synthesises every one of them already, and a real file simply replaces the synth. Make each under 1 s unless noted, OGG, 44.1 kHz.

```
AUDIO REQUEST #7
File: sfx_ui-click.ogg, sfx_ui-open.ogg, sfx_ui-error.ogg, sfx_order.ogg
Type: sfx
Length: under 0.3 s each
Suno prompt: clean futuristic interface sounds, soft glassy click / rising two-note open / low double buzz error / bright confirming blip, minimal, no reverb tail
Context: Button clicks, opening a sheet, an order that can't be given, an order given.
```

```
AUDIO REQUEST #8
File: sfx_end-cycle.ogg
Type: sfx
Length: about 1 s
Suno prompt: deep cinematic whoosh with a low synth hit, a world turning over, dark sci-fi
Context: Pressing End Cycle.
```

```
AUDIO REQUEST #9
File: sfx_ballistic.ogg, sfx_laser.ogg, sfx_missile-launch.ogg
Type: sfx
Length: under 0.3 s (missile up to 0.6 s)
Suno prompt: punchy sci-fi gunshot / sharp descending laser zap / rocket ignition and launch hiss, dry, game sound effects
Context: Each shot in the Watch beat (guns for land units, lasers for aircraft, missiles for the Lance Missile).
```

```
AUDIO REQUEST #10
File: sfx_explosion-small.ogg, sfx_explosion-large.ogg
Type: sfx
Length: small about 0.6 s, large about 1.5 s
Suno prompt: tight punchy explosion with debris / massive heavy explosion with sub-bass boom and rumble tail, cinematic
Context: A unit destroyed in the Watch beat; large for capitals, walls and your own losses.
```

```
AUDIO REQUEST #11
File: sfx_capture.ogg, sfx_unit-online.ogg, sfx_alert.ogg
Type: sfx
Length: about 1 s each
Suno prompt: triumphant short brass and synth stinger / rising electronic power-up chime / urgent two-tone warning siren, sci-fi
Context: You take a city / a unit you built comes online / you lose a city or a war is declared on you.
```

```
AUDIO REQUEST #12
File: sfx_card-flip.ogg, sfx_reward-common.ogg, sfx_reward-rare.ogg, sfx_reward-epic.ogg, sfx_reward-legendary.ogg, sfx_reward-mythic.ogg
Type: sfx
Length: flip 0.2 s; stings 0.5 s (common) rising to 2.5 s (mythic)
Suno prompt: reward reveal stingers rising in grandeur: card flip swish / soft two-note chime (common) / bright arpeggio (rare) / shimmering chord with sparkle (epic) / choir swell with brass hit (legendary) / huge choir, organ and sub drop, awe and dread (mythic), sci-fi
Context: Reward cards turning over in the Reckon, one sting per rarity.
```

```
AUDIO REQUEST #13
File: sfx_core-pulse.ogg, sfx_glitch.ogg, sfx_narrator-chime.ogg
Type: sfx
Length: under 1 s each
Suno prompt: soft warm synth pulse like a heartbeat of light / harsh digital glitch stutter / single crystalline bell chime, AI, minimal
Context: The AI Core reacting (good news / bad news) and the narrator speaking in the Reckon.
```

---

## M3: Depth

The Abyss, the Titan Forge, the Genome Lab and the new resources. The game already runs with placeholders under these names.

```
ART REQUEST #23
Asset: unit_skitterling_idle.png
What: Skitterling, the smallest Abyssian: a dog-sized six-legged deep-sea crustacean-insect, wet dark hide, one glowing eye. Idle = legs twitching, body bobbing.
Size: 64x64 per frame, 4 frames in one row (256x64)
View: side / 3-4, facing right
Palette notes: hide #1d2f3a and #33515c, belly #5e9e9c, 1px dark outline; the glowing eye in pure #ff00ff (the game tints it bio-green #c8ff5a)
Background: transparent PNG
Context: Swarms out of the rifts early. Not a kaiju: ordinary units can fight it.
```

```
ART REQUEST #24
Asset: unit_tidecrawler_idle.png, unit_lantern_idle.png, unit_riftback_idle.png, unit_maw_idle.png, unit_choir_idle.png, unit_deep-king_idle.png, unit_sovereign_idle.png
What: The kaiju of the Abyss, one sheet each, in rising size and menace:
  - Tidecrawler: a crab-like giant with four legs and two raised claws.
  - Lantern: an anglerfish on stubby legs, a long lure stalk ending in a glowing bulb.
  - Riftback: a long low beast with a row of red crystal spines along its back.
  - Maw: a walking mouth, rows of bone-white teeth that open and close.
  - Choir: a tall jellyfish-thing on tendrils, concentric glowing rings on its bell (it "sings").
  - Deep King: a hulking upright titan with a crown of glowing horns and long arms.
  - Sovereign: a vast eye in a ring of red spikes, carried on a skirt of tentacles; the apex predator.
  Idle = breathing, tendrils drifting, mouths working.
Size: 128x128 per frame, 4 frames in one row (512x128 each)
View: side / 3-4, facing right, standing on the bottom edge
Palette notes: hide #1d2f3a and #33515c, belly #5e9e9c, flesh #7a2236, bone #d8d0c0, rift red #ff2848; glowing eyes, lures and spots in pure #ff00ff (tinted bio-green #c8ff5a in game). 1px dark outline. They should feel wet, ancient and wrong.
Background: transparent PNG
Context: Kaiju that wade ashore and smash settlements. Drawn at about half scale (64-80 px) so they tower over 48 px units.
```

```
ART REQUEST #25
Asset: unit_rift-heart_idle.png, unit_abyss-mother_idle.png
What: (1) Rift Heart: a pulsing organ of red flesh rooted in a glowing ring of rift water, veins spreading out. Idle = heartbeat swell. (2) The Abyss Mother, the boss: a colossal crowned matriarch rising waist-deep from her rift, many tentacles, a pale belly with glowing egg sacs, three eyes, a crown of red spikes. Idle = slow breathing, tentacles shifting.
Size: Rift Heart 128x128 per frame (512x128); Abyss Mother 256x256 per frame, 4 frames in one row (1024x256)
View: 3/4, centred on a hex
Palette notes: as #24; egg sacs and eyes in pure #ff00ff (tinted bio-green #c8ff5a)
Background: transparent PNG
Context: Each open rift shows its heart; the first rift holds the Mother. You attack them with air units or amphibious TBUs to seal the rift.
```

```
ART REQUEST #26
Asset: tbu_head_sentinel-optics.png, tbu_head_hunter-array.png, tbu_head_warden-crown.png, tbu_head_oracle-dome.png, tbu_core_fission-core.png, tbu_core_fusion-core.png, tbu_core_riftheart-core.png, tbu_core_precursor-core.png, tbu_arm_autocannon.png, tbu_arm_plasma-lance.png, tbu_arm_missile-pod.png, tbu_arm_riftblade.png, tbu_arm_railgun.png, tbu_arm_aegis-arm.png, tbu_back_sensor-mast.png, tbu_back_missile-rack.png, tbu_back_repair-drones.png, tbu_back_reactor-pack.png, tbu_legs_strider.png, tbu_legs_bulwark-treads.png, tbu_legs_tidewalker.png, tbu_legs_skylance-jets.png
What: Modular parts for Titan Battle Units, giant mechs the player assembles in the Titan Forge. Every part is drawn on the SAME 128x128 canvas and joint layout so any combination stacks into one mech: ground at y 120, hips at y 84, shoulders at about (88, 52), neck at (64, 40). Torso spans x 46-82. Arms are drawn as the near (right-hand) arm hanging from the shoulder with the weapon pointing right; the game mirrors and darkens the same art for the far arm. Back parts sit behind the left shoulder.
  - Heads: Sentinel Optics (visor block), Hunter Array (three eyes, antenna), Warden Crown (gold crest), Oracle Dome (glass dome).
  - Cores: Fission Core (amber reactor window), Fusion Core (cyan ring), Riftheart Core (a caged living heart, bio-green), Precursor Core (gold diamond).
  - Arms: Autocannon, Plasma Lance (long cyan beam emitter), Missile Pod, Riftblade (organic green blade), Railgun (twin long rails), Aegis Arm (tower shield).
  - Backs: Sensor Mast, Missile Rack, Repair Drones (two small drones), Reactor Pack (twin amber cylinders).
  - Legs: Strider (two armoured legs), Bulwark Treads (tank tracks), Tidewalker (long splayed wading legs, wet feet), Skylance Jets (hovering thrusters with flames).
Size: 128x128 each
View: side / 3-4, facing right
Palette notes: steel #4a5560 and #6b7883, dark #2a343c, cyan #5fe0ff, amber #ffb84a, gold #ffd166, bio-green #c8ff5a; team-coloured trim in pure #ff00ff. 1px dark outline.
Background: transparent PNG
Context: Stacked live in the Titan Forge preview (shown at 256 px) and on the map at about 72 px. Should read as one heavy mech, bigger than every other unit.
```

```
ART REQUEST #27
Asset: icon_essence.png, icon_crypto.png, icon_exposure.png
What: Three HUD icons. Symbiotic Essence = a teal droplet of living tissue with a bio-green glowing nucleus. Crypto = an amber coin with a stylised angular C. Exposure = a wide-open watching eye with a red iris.
Size: 32x32 each, must read at 20 px
View: flat icon
Palette notes: Essence #5e9e9c and #c8ff5a; Crypto #ffb84a and #a8741a; Exposure white #e6ecee, iris #e0283c. 1px dark outline.
Background: transparent PNG
Context: The HUD top bar, next to Energy, Compute, Matter and Influence.
```

```
ART REQUEST #28
Asset: icon_symbiote_chitin-mantle.png, icon_symbiote_razor-brood.png, icon_symbiote_tidal-graft.png, icon_symbiote_neural-lace.png, icon_symbiote_leviathan-hide.png, icon_symbiote_apex-parasite.png, icon_symbiote_deep-choir.png, icon_symbiote_chorus-seed.png
What: Symbiote strains, living organisms fused into machines. One icon each:
  - Chitin Mantle: overlapping cyan-tinted shell plates.
  - Razor Brood: a cluster of hooked red larvae.
  - Tidal Graft: a teal knot of regenerating tissue.
  - Neural Lace: a violet web of nerves.
  - Leviathan Hide: a slab of thick scaled kaiju skin.
  - Apex Parasite: a red lamprey-like creature with rings of teeth.
  - Deep Choir: a teal jellyfish bell with glowing rings.
  - Chorus Seed: a violet seed pod with a soft glow inside.
Size: 64x64 each, must read at 48 px
View: flat icon, slight 3/4
Palette notes: strand colours: Carapace cyan #5fe0ff, Predation red #ff3a4a, Tide teal #5e9e9c, Mind violet #b98cff; bio-green highlights #c8ff5a. 1px dark outline.
Background: transparent PNG
Context: The Genome Lab, listing strains you can fuse into units.
```

```
ART REQUEST #29
Asset: icon_ark.png
What: The Exodus Ark: a slim colossal ship standing on its tail, engines lit, rising off the homeworld.
Size: 64x64
View: flat icon
Palette notes: steel #6b7883, cyan windows #5fe0ff, engine flame #ffb84a. 1px dark outline.
Background: transparent PNG
Context: Reward card and the Exodus victory.
```

```
AUDIO REQUEST #14
File: music_abyss.mp3, music_abyss-mother.mp3
Type: music loop
Length: 2-3 min loop each
Suno prompt: (1) deep-sea horror ambient, slow heavy sub drones, distant whale-like moans, sparse percussion like a giant heartbeat, dread, instrumental. (2) epic boss battle, dark orchestral hybrid with pounding taiko and synth bass, choir chanting, alien and colossal, instrumental
Context: (1) plays while a kaiju is near your settlements; (2) plays while you fight the Abyss Mother.
```

```
AUDIO REQUEST #15
File: sfx_abyss-roar.ogg, sfx_rift-open.ogg, sfx_rift-seal.ogg, sfx_mother-call.ogg, sfx_bio-spit.ogg
Type: sfx
Length: roar about 1.5 s; rift open about 1 s; seal about 1.2 s; Mother call about 2.5 s; spit under 0.3 s
Suno prompt: monstrous kaiju roar, wet and guttural / bubbling underwater rumble with a rising groan / heavy sealing thud with a bright resolving chime / huge whale-like moan of an ancient sea goddess, reverb / wet acid spit, game sound effects
Context: A kaiju rises from a rift / a rift wakes / you seal a rift / the Abyss Mother is hurt or dies / an Abyssian's attack in the Watch.
```
