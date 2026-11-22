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
