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
