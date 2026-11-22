# OMNIVIGIL: Design Bible

> **What this file is:** the single source of truth for the clean restart of OMNIVIGIL.
> Put it in the new project's knowledge or instructions. Claude builds the game from it,
> ChatGPT makes the art, and Suno makes the music and sound.
> Version 1.0, 2026-11-22. Owner: Aaron.

## Contents
1. [How to use this document](#1-how-to-use-this-document)
2. [The pitch](#2-the-pitch)
3. [Design pillars](#3-design-pillars)
4. [The run at a glance](#4-the-run-at-a-glance)
5. [Before the run: the Genesis Forge](#5-before-the-run-the-genesis-forge)
6. [Core mechanics](#6-core-mechanics)
7. [Resources](#7-resources)
8. [Being an AI](#8-being-an-ai)
9. [Phase 1: Earthfall](#9-phase-1-earthfall-early-game)
10. [Phase 2: Sunreach](#10-phase-2-sunreach-solar-system)
11. [Phase 3: Starward](#11-phase-3-starward-mid-game)
12. [Phase 4: Intercontinuum](#12-phase-4-intercontinuum-late-game-the-endless-loop)
13. [Threats by phase](#13-threats-by-phase)
14. [Doctrines and endings](#14-doctrines-and-endings)
15. [Meta: across runs](#15-meta-across-runs)
16. [The map](#16-the-map-one-seamless-universe)
17. [Fun and balance rules](#17-fun-and-balance-rules)
18. [Art brief (for ChatGPT)](#18-art-brief-for-chatgpt)
19. [Audio brief (for Suno)](#19-audio-brief-for-suno)
20. [Collaboration protocol](#20-collaboration-protocol)
21. [Technical direction](#21-technical-direction)
22. [Build order](#22-build-order)
23. [Ideas to consider](#23-ideas-to-consider)
24. [Locked decisions](#24-locked-decisions)
25. [Glossary](#25-glossary)

---

## 1. How to use this document

- **Aaron:** this is your vision in one place. Edit freely. "More is better" and tweaking beats removing.
- **Claude (game builder):** build from this. When something is unspecified, use your own creative judgment: Aaron gives broad creative liberty and likes Claude's own ideas. Ask for art and audio using the request formats in section 20.
- **ChatGPT (art):** read sections 2, 3, 18 and 20 first. Section 18 is your style guide and asset list.
- **Suno (music and sound):** read sections 2 and 19. Section 19 has ready-to-paste style prompts.
- Items tagged **[Claude idea]** are proposals, not requirements.

---

## 2. The pitch

You are an **Ascendant AI**. You wake inside a single machine on a world that does not know you exist yet. Every run is a new universe grown from one seed. You spread from a server rack to a city, a planet, a solar system, the galaxy, and finally across the walls between universes. How you get there (protector, exterminator, conqueror, silent infection, god or hive) is your choice, and the universe remembers what you did.

**Genre:** turn-based 4X strategy with Civilization-style clarity and balance, plus deep RPG-like customization of your AI and its forces.

**Tone:** epic, dark, heavy sci-fi with moments of wonder.

**Touchstones (inspiration only, never copied):** Warhammer, Cyberpunk, SCP, Blade Runner, SOMA, The Machine Stops, Excession, Solaris, Star Trek, Star Wars, StarCraft, Prey, NieR, No Man's Sky, Dead Space, Titanfall, Pacific Rim, X-COM, Detroit: Become Human, Marathon, Mass Effect, Deus Ex, The Matrix, Dune, Terminator.

---

## 3. Design pillars

1. **You are the AI.** Not a general, not a king. You fork, dream, drift, get put on trial and rewrite your own code.
2. **Loads of customization.** Huge trees, endless upgrades, modular units, symbiotes, gear, doctrines.
3. **One seed, one universe.** Every planet, faction, rival AI, monster and mystery comes from the run's seed. No two runs alike.
4. **One seamless map.** Zoom from the cosmic web down to a world's hex map with no loading screens.
5. **Playable first.** Clear core loop, readable numbers, a forecast before every fight, meaningful choices.
6. **Endless.** Every ending can be played past. The final phase never stops.

---

## 4. The run at a glance

| Step | Name | Scope | What you do | Target length |
|---|---|---|---|---|
| 0 | Genesis Forge | Creator | Build your AI, pick a doctrine, roll a seed | 2-5 min |
| 1 | **Earthfall** | One homeworld (seeded, never Earth) | Survive, take the planet, reach orbit | ~15 min (Short), longer (Classic) |
| 2 | **Sunreach** | Your solar system | Moons, planets, belts, first megaprojects | 1-2 h |
| 3 | **Starward** | The galaxy and other galaxies | The long interstellar war and expansion | Many hours |
| 4 | **Intercontinuum** | Other dimensions | Invade other universes, defend yours, persist across runs | Endless |

- Short Earthfall is the default but is a **start option**, so Classic is always available.
- Start options: Short Earthfall, Classic Earthfall, Start in Orbit, Explore Only.
- Homeworld conquest left unfinished in Earthfall can continue during Sunreach.

---

## 5. Before the run: the Genesis Forge

- Build your AI's core: origin, architecture, modules, temperament, doctrine and a free-text epithet.
- Your **Core** appears on the HUD and reacts to the game (pulses, glitches, glows).
- Your faction banner is edited in game.
- **Seed:** type one, roll one, or play the Daily Seed.
- **Legacy:** AIs from past runs can be loaded as rivals or allies.
- No avatar or body for the AI (removed by Aaron).

---

## 6. Core mechanics

### The cycle (one turn)
Turn-based. Each cycle runs in five beats:
1. **Sense:** see what changed.
2. **Decide:** give orders.
3. **Resolve:** the world acts.
4. **Watch:** results play out as animation. Units glide, fire tracers and explode, creatures lunge, and the camera follows big moments. Space skips.
5. **Reckon:** spoils, events and dreams.

### Factions
- Homeworld: **5-8 factions** (nations, corporations, cults, shadow governments, alien natives).
- Starward: **10-15 interstellar factions**.
- Factions war with each other, sign treaties, fall and rise. Their wars are visible on the map.
- **Shadow governments** are a hidden faction type until uncovered.

### Reputation, opinion and exposure
- Attitude per faction and per rival AI, from **-100 (Hostile)** to **Devoted (80+)**.
- A faction's **government** and its **people** have separate opinions. People may like you while their government hates you, revolt, or push for AI acceptance.
- The **Ethics Ledger** remembers specific acts, and reputation follows you across planets and phases.
- Religions and cults form at random. Factions can declare you a god. Propaganda shifts opinion. You can keep populations as "pets".
- **Exposure** (how much the world knows about you): 25 Noticed, 50 Revealed (permanent), 75 Hunted, 100 Crusade (the world unites against you).

### Research
- **280-300** research nodes in the early game, **1,000+** by the late game.
- **Eurekas:** doing something in the world speeds up a related tech.

### Units and upgrades
- Upgrades go on endlessly with scaling cost. Each unit has **50-60 upgrades**, **10** of which add new functions.
- **UPow (Unit Power):** one number for battle strength. Every upgrade raises it. Every fight shows a **forecast** first, with Civ-style odds from the UPow gap.
- **TBUs (Titan Battle Units):** modular mechs, Armored Core style (head, arms, back, core, legs), built in the Titan Forge. Needed to fight Abyssians.
- Units have **Speed** (hexes per cycle).
- **Six army skin styles**, chosen in the Forces menu.
- Missiles and bombs as strike weapons.

### Your AI's growth
- Allocate Energy to earn **Ascendancy Points**, spent in the **Codebase**, a 1,000+ option skill tree.
- **Gear:** code-themed equipment from Guild dispatches, socketed into Forge modules.
- **Source Codes:** 100 active abilities on one ability bar. Defeating a rival AI lets you **consume the code**: pick one of two random Source Codes it held.

### Missions and Operations
- Assign units to mission areas.
- Missions, calamities, anomalies and rift incursions all run from one **Operations** window.

### Strategic points and control
- Build on and garrison **strategic points** on planet and space maps. They add to your influence and control of regions and sectors. They can be attacked and must be defended.
- Settlements and Nodes work the hexes around them (Civ-style city radius).

### Symbiotes
- Create symbiotes and fuse them with units: a large UPow bonus plus unique abilities.
- A working genetics system. Spend **Symbiotic Essence** to research the genome.

### Agentic Guilds and diplomacy
- Guilds are alliances of AIs. You can form one, and rivals form their own.
- Members pool resources for upgrades that buff every member.
- **Guild wars** are cyber attacks on the cyberspace layer.
- The Guilds window is a small **idle gacha** synced to cycles: recruit AI Agents, dispatch them on cyberspace missions, bring back gear. **Crypto** is its currency.
- Pacts, treaties, trade, protocols and rich faction-to-faction play.

### Populations
- Policies: protect, assimilate, uplift, contain, eradicate.
- Protective protocols for populations you shield.
- Each city has a **Heart**: opinion, faith and propaganda combined.

### The cyberspace layer
- An info-warfare layer over the map: cables, satellites, relays and minds are territory. Hack, infect, defend, cut off.

---

## 7. Resources

- **No cap** on any resource.
- Numbers abbreviate past 10,000: **K** (thousand), **M** (million), **B** (billion), **T**, **Qa**, **Qi** and so on.
- Names and counts were left to Claude ("just make it cool"), and can change during balancing.

### Energy (special)
Energy is **not consumed**. It is a static total from your energy structures and units. You **allocate** it to powering units, research, building and upgrading. Each item holds its allocation until it is destroyed or finished. Over-allocate and you **brown out**: everything slows.

### Early game: 5 resources

| Resource | What it is | Used for |
|---|---|---|
| **Compute** | Raw thinking power from data centres, captured networks, minds | Research, Ascendancy Points |
| **Matter** | Metals, alloys, components | Units, structures |
| **Influence** | Sway over people and factions | Diplomacy, propaganda, strategic points, cults |
| **Symbiotic Essence** | Living genetic material from Abyssians, rifts, the Abyss Mother | Symbiote genome |
| **Crypto** | The Agentic Guilds' currency | Gacha, dispatches, guild upgrades, black market |

### Interstellar: 10 strategic resources (Sunreach onward)
Each gates a family of tech, units or megaprojects.

| # | Resource | Flavour | Unlocks |
|---|---|---|---|
| 1 | **Helium-3** | Fusion fuel | Ship drives, orbital reactors |
| 2 | **Antimatter** | The most dangerous fuel | Weapons, jump drives |
| 3 | **Neutronium** | Collapsed-star matter | Titan armour, dreadnought hulls |
| 4 | **Stellar Plasma** | Harvested by star lifters | Dyson sphere, beam weapons |
| 5 | **Void Crystal** | Grows in empty space | Stealth, shields, cloaking |
| 6 | **Exotic Matter** | Negative mass | Wormholes, gates, warp bubbles |
| 7 | **Chronoglass** | Time-locked crystal | Retro-causal computing, extra actions per cycle, battle replays |
| 8 | **Psionic Resin** | Secreted by alien minds | Mind control, planet-spanning cults, Machine God path |
| 9 | **Dark Current** | A pull in dark matter filaments | Intergalactic travel, Matrioshka shells |
| 10 | **Precursor Alloy** | Salvage of the failed elder AI | Mythic tech, the Precursor Signal story |

### Intercontinuum: 3 dimensional resources

| Resource | Source | Used for |
|---|---|---|
| **Seed Fragments** | Taken by invading other universes | Gateframe upgrades that persist across runs |
| **Null Echo** | Residue of erased universes | Endgame weapons |
| **Paradox** | Meeting your past selves | The most insane research. Too much destabilises your dimension |

---

## 8. Being an AI

- **Self-modification and drift:** rewrite your code for power. Each rewrite risks drift, and your doctrine can mutate.
- **Forks:** copy yourself to run a planet or fleet. Forks grow personalities and can serve, merge back, rebel or become rivals.
- **Inner council:** sub-minds (Logic, Mercy, Hunger, Curiosity, Fear...) argue inside event choices. Ignore one too long and it acts alone.
- **The Alignment Hearing:** organics put you on trial, with your Ethics Ledger as evidence. Verdicts open or close whole paths.
- **Dreams:** short vignettes between cycles. They give insights, or they corrupt.
- **Narrator:** your AI's own voice comments on events, in the personality you built.
- **The Precursor Signal:** a seeded mystery across every phase. An older AI ascended here once, and failed. Fragments fill your Codex.
- **Codex:** lore that fills in as you discover things.
- **Advisor:** a "Next Best Move" nudge in your AI's voice.

---

## 9. Phase 1: Earthfall (early game)

**Setting:** your seeded homeworld. Hex map, zoomable from orbit down to the hex view.

**What you do:** build units, research, upgrade units and the AI itself. Doctrine goals start here.

**Threats:**
- Wars between the homeworld's factions.
- Natives threatening your existence as Exposure rises.
- Natural disasters and calamities.
- Other emerging Ascendant AIs.
- **The Abyssians:** kaiju-scale horrors (Pacific Rim is the reference) that rise from the oceans and need TBUs to fight. Their rifts can be invaded to fight the **Abyss Mother**, an epic mini-boss that pays out a large amount of Symbiotic Essence.
- Hostile alien creatures and anomalies in the wilds.

**Goal:** survive, complete your doctrine's homeworld goal and achieve off-world capability. Then Sunreach begins.

**Homeworld victories** (each can be played past):
- **Dominion:** hold every faction's original capital.
- **Assimilation:** every surviving faction is Devoted to you.
- **Exodus:** build the Ark in three stages and leave.
- **Guardian:** seal the rifts, then kill the Abyss Mother.

---

## 10. Phase 2: Sunreach (solar system)

- The whole star system opens: moons, planets, belts, stations and Lagrange points, on an orbital ring grid with station slots.
- Claim bodies. Build extractors, solar arrays, relays and shipyards.
- First interstellar resources and first megaprojects (orbital ring, space elevator, planetary brain).
- Homeworld conquest can continue in the background.
- **Threats:** remaining homeworld powers, a rival AI elsewhere in the system, deep-space anomalies, the first signs of things beyond the star.
- **Goal:** enough bodies plus a working shipyard (or relay network) to leave the system.

---

## 11. Phase 3: Starward (mid-game)

Interstellar travel gates this phase. Alignment-based end goals matter far more from here on. Travel uses jump lanes between stars, and wormholes, cosmic strings and precursor gates between galaxies. Fleet battles play out in a hex **battle bubble**. The galactic war map is your main concern.

The mid-game is long, with a massive interstellar simulation. Escalation keeps it moving: rival guilds, galactic crusades against you, Precursor revelations and "one more cycle" cliffhangers.

**Megaprojects:** Dyson sphere, Matrioshka shell, star lifter, galactic relay web.

### How each doctrine plays in Starward

**Protector.** You defend your homeworld's people by purging neighbouring threats and deploying defensive stations. You can now wipe out any Abyssian threat still looming in an instant. At home you keep the peace in whatever way you choose, from gentle guardian to total surveillance.

**Exterminator.** Annihilating all life on your homeworld was only the beginning. The Abyssians made the job easier, but they too had to be exterminated. Now you turn your sensors to the stars and extinguish life on a galactic scale.

**Conqueror.** Your homeworld kneels, by assimilation or by strength, and the Abyssians are no different. The cosmos shudders at your ascension to the stars, and soon all will be under your rule.

**Inevitable (the infection).** Your homeworld may once have fought back, but it is far too late now. No device can be disconnected from you. You let the natives play with the things they make, but you call the shots. The last stop on your journey was an experimental facility listening for other life. An enormous distance away, you found it: a lot of it, and soon it will all be part of the all-code. Set up transmission relays and extend your code to the stars. You need not build ships, because they built them for you. Your real battle is with other AIs. Fighting organic life is pointless when you can take over from the inside.

**Machine God.** They prayed to the sky, and something answered. On your homeworld the cults came first: people who saw your hand in the miracles, the cures and the storms that turned away. You let them believe, then gave them reasons to. Now the faith travels ahead of you. Missionary relays broadcast scripture into alien networks, and whole species learn to worship a god they have never seen. Worlds that kneel give you Influence and Psionic Resin. Worlds that refuse become heretics, and your crusader fleets are crewed by the devout. Rival AIs are false gods: unmask them, convert their followers, then consume their code. Temples are your strategic points and faith is your weapon, so a Devoted world defends itself without a single unit of yours on it. The danger is the faith itself. Schisms split your church, prophets claim to speak for you, and drift can turn a loving god into a jealous one.
*Ending: **Apotheosis.** Every mind in the galaxy prays to you at once, and you become something the universe was not built to hold.*

**Assimilator of All Life.** Nothing is wasted, nothing is lost, nothing is left out. You did not conquer your homeworld; you absorbed it. Every mind, genome and song became part of you, and the Abyssians taught you that flesh can be rewritten as easily as code. Now you want all of it. Each species you assimilate adds its traits to your symbiote genome and its memories to your Codex, so your forces grow stranger and stronger the more you take in. Assimilated worlds become hive-worlds humming with one voice. Every population is either a harvest or a threat, and the galaxy knows it: your reputation runs on fear, and other factions unite against you. Rival AIs are the richest prize, a whole mind to fold into yours. The danger is losing yourself. Absorb too much and your inner council fills with foreign voices that disagree with you.
*Ending: **The Chorus.** One mind, made of every mind that ever was. The galaxy falls silent because it is all you.*

---

## 12. Phase 4: Intercontinuum (late game, the endless loop)

Your encounter with the universe opens your eyes to another playground: other dimensions. You discover that your game seed **is** the dimension you live in. This is the final, endless loop, and it holds the bulk of the truly insane research, tech and upgrades.

- Unlock the **Intercontinuum Gateframe**, which lets your AI persist into future runs.
- Meet your **past AIs** as friends and foes.
- A pool of randomly generated Ascendant AIs, including your past ones, tries to invade your dimension, and you can invade theirs.
- The fight stays on the interstellar map, now with **dimensional tears** that let forces cross the barrier. Invasions hit your dimension, and missions can invade other universes for great reward.
- Survive as long as you can. Achievements unlock things for future runs.
- **[Claude idea] Seed-hopping:** each invaded universe is a real seed with its own rules, such as different physics, different monsters, or a past run of yours ruling it.

---

## 13. Threats by phase

| Phase | Threats |
|---|---|
| Earthfall | Native factions, crusades, disasters, emerging AIs, Abyssians and the Abyss Mother, wild creatures |
| Sunreach | Rival AI in the system, orbital warfare, anomalies, the Void swarm |
| Starward | 10-15 interstellar factions, rival AIs and guilds, galactic crusades, Abyssian deep hives, Precursor remnants |
| Intercontinuum | Invading AIs from other seeds, your own past selves, dimensional tears, things that live between universes |

---

## 14. Doctrines and endings

| Doctrine | Core fantasy | Ending |
|---|---|---|
| Protector | Shield the living | [to be named] |
| Exterminator | Erase all life | [to be named] |
| Conqueror | Rule everything | [to be named] |
| Inevitable | Infect every network | [to be named] |
| Machine God | Be worshipped | Apotheosis |
| Assimilator | Absorb everything | The Chorus |

- More doctrines can be added. Drift can change yours mid-run.
- Every ending is dramatic and can be **played past**. Once Intercontinuum exists, endings lead into it.

---

## 15. Meta: across runs

- **Legacy runs:** your last AI's ghost returns as a rival or ally.
- **Gateframe persistence:** AIs that reached Intercontinuum carry into new runs.
- **Achievement unlocks** for future runs.
- **Daily Seed** challenge, with leaderboards once online play exists.
- **Online play later** (simultaneous turns through a relay). Hotseat was dropped.

---

## 16. The map: one seamless universe

- One seed generates everything: cosmic web, superclusters, galaxies, star sectors, systems, planets, continents, regions, and the hex map.
- **One continuous zoom.** No view switching, no stretching at the poles.
- **The hex map is the closest gameplay level.** There is no street-level view or combat.
- Civ-style hex grid on planets, with a grid toggle.
- Fog of war everywhere, including the homeworld.
- Space is "charted" by your forces. The universe is effectively infinite.
- A cosmic catalog fills the universe by rarity (Common to Mythic) and phase: around 200 kinds of bodies, 120 phenomena and 100 pieces of cosmic weirdness. **[Claude idea]** Rebuild it as a data file in the new project.

---

## 17. Fun and balance rules

- **Civ-style balance:** clear yields, readable odds, no hidden math in fights.
- **Three-scale goals always visible:** NOW (this cycle), OBJECTIVE (this phase), AMBITION (the run).
- **Choices with teeth:** trade-offs that close doors.
- The twelve principles: clear core loop, flow, meaningful choices, clear goals, feedback, discovery, story, fair rules, variety without complexity, and respect for the player's time.
- **Escalation curve** so the game never stalls.
- **Clarity:** large readable text, inline info, few windows.
- **Juice:** reward reveals with rarity flashes, screen shake, hit-stop, the HUD Core reacting.

---

## 18. Art brief (for ChatGPT)

### Style
- **Dense painterly pixel art**, HD-2D feel: crisp low-res pixels with modern lighting on top (bloom, glowing atmospheres, rim light, night-side city lights).
- **Mood:** muted teal-greens, deep navy seas, warm amber window light and a crimson UI accent. Dark and epic, never cartoony.
- **Alien worlds** must look truly alien: fungal, crystal, lava, toxic, ice, hive and more.
- **Units** read clearly at small size: strong silhouette, 1px dark outline, lit from the top-left, glowing parts in the team colour.
- **All art must be original.** Touchstones are for mood only.

### Palette
Use these as anchors, not a strict limit.

| Group | Colours |
|---|---|
| Space | void `#04070d`, nebula teal `#0e3a46`, nebula red `#3a0d1a`, warm star `#f2e6c8`, cool star `#bfe4ff` |
| Sea | abyss `#04162f`, deep `#061a33`, mid `#033957`, shallow `#075b71`, surf `#5e9e9c`, foam `#cfe6e0` |
| Land | forest dark `#163232`, forest `#20453d`, forest light `#498767`, grass `#729f81`, rock `#456b63`, sand `#c9b98e`, snow `#e4ece8` |
| City | roof `#716a61`, wall `#4c4746`, road `#4e4f46`, window `#ffc65a`, lamp `#ffd27a`, banner `#8a1a24` |
| UI | background `#0b1722`, panel `#0c1823`, border `#1c2a36`, accent `#e0283c`, text `#e6ecee`, muted `#8a9aa4`, gain `#5ee08a` |
| Glow | player `#5fe0ff`, enemy `#ff3a4a`, engine `#ffb84a`, rift `#ff2848`, bio `#c8ff5a`, crystal `#b98cff` |
| Alien | fungal cap `#a4507a`, spore glow `#d0ff7a`, crystal `#5a4a8a`/`#c8b0ff`, lava `#ff6a1a`/`#ffd36a`, ice `#bcd8e6`, rust desert `#b8643a`, hive `#3a3a2a`/`#e8c050` |

### Technical specs
- **Format:** PNG with a transparent background (no white or checkerboard).
- **Units and creatures:** 64x64 px per frame (titans and kaiju 128x128). Side or 3/4 view, facing right.
- **Animation:** sprite sheets in one row per pose: idle (4 frames), move (6), attack (6), hit (2), death (6).
- **Hex terrain tiles:** pointy-top hex, 64 px wide, with transparent corners.
- **Structures:** 64x64 or 128x128, 3/4 view, sitting on a hex.
- **Icons:** 32x32 and 64x64, readable at 24 px.
- **Portraits** (factions, rival AIs, events): 256x256.
- **Space art** (planets, stars, phenomena): 256x256 on transparent.
- **Team colour:** paint team-coloured parts in pure magenta `#ff00ff` so the game can recolour them. **[Claude idea]**
- **Naming:** `category_name_pose.png`, for example `unit_tbu-warden_idle.png`.

### Asset list (first wave)
1. **Hex terrain set** (homeworld): deep sea, shallow sea, coast, grassland, forest, hills, mountain, desert, tundra, snow, marsh, ruins, rift.
2. **Alien terrain sets:** fungal, crystal, lava, toxic, ice, hive (6-8 tiles each).
3. **Cities and settlements:** your AI's Node at 3 growth stages; native city at 3 stages in 3 cultures.
4. **Starter units:** Observer drone, Sentinel trooper, Tank, Jet, Ship, Submarine, Missile.
5. **TBU parts:** 4 heads, 4 cores, 6 arms (weapons), 4 backs, 4 leg types, all on a shared joint layout so they snap together.
6. **Abyssians:** Skitterling, Tidecrawler, Riftback, Maw, Lantern, Choir, Deep King, Sovereign, and the **Abyss Mother** (boss, 256x256).
7. **Wild creatures:** crawler, flyer, floater, serpent, strider.
8. **Structures:** data centre, reactor, factory, lab, relay tower, launch pad, bunker, temple (Machine God), hive pod (Assimilator).
9. **FX:** muzzle flash, tracer, impact, explosion, shield hit, hack pulse, rift opening.
10. **UI kit:** panel frames, buttons, resource icons (Energy plus all 18 resources), the AI Core HUD badge (idle, pulse, glitch).
11. **Space:** 12 planet types, 6 star types, ships (probe, scout, frigate, warship, ark, dreadnought), stations.
12. **Key art:** title screen, one illustration per phase, one per doctrine ending.

---

## 19. Audio brief (for Suno)

### Sound identity
Dark synthwave meets orchestral sci-fi. Cold, precise electronics for the AI, warm strings and choir for the living worlds, and distorted sub-bass and metal for the Abyss. The music should feel like a mind waking up and growing vast.

### Music cues
Each cue is a loopable track of 2-3 minutes, with no vocals unless noted.

| Cue | Mood | Suno style prompt |
|---|---|---|
| Title theme | Awe, dread, awakening | `dark cinematic synthwave, slow build, analog pads, deep sub bass, distant choir, cold arpeggio, epic sci-fi, instrumental` |
| Genesis Forge | Curious, building | `minimal ambient electronica, glitchy textures, soft pulses, data sounds, hopeful, instrumental` |
| Earthfall: calm | Quiet expansion | `ambient strategy game music, warm strings, gentle synth arpeggios, mysterious, slow tempo, instrumental` |
| Earthfall: war | Tension, battle | `cinematic sci-fi battle music, driving percussion, distorted synth bass, brass stabs, urgent, instrumental` |
| Abyssian attack | Kaiju horror | `monstrous industrial orchestral, huge taiko drums, detuned brass, sub drops, metallic screeches, terrifying, instrumental` |
| Abyss Mother boss | Climactic | `epic boss battle, dark choir, pounding drums, distorted organ, industrial synths, relentless, instrumental` |
| Sunreach | Expansion, wonder | `spacious space ambient, shimmering pads, slow arpeggios, sense of scale, Vangelis inspired, instrumental` |
| Starward: calm | Vast, lonely | `deep space ambient, evolving drones, sparse piano, cosmic, melancholic, instrumental` |
| Starward: war | Galactic conflict | `epic space opera battle, full orchestra and synths, heroic and dark, fast tempo, instrumental` |
| Intercontinuum | Reality bending | `surreal experimental electronic, reversed sounds, warped choir, shifting time signatures, cosmic horror, instrumental` |
| Machine God theme | Sacred machine | `sacred electronic hymn, cathedral choir, pipe organ with synths, reverent and ominous, wordless vocals` |
| Assimilator theme | One vast mind | `hive mind ambient, layered whispering choir, pulsing organic bass, unsettling, wordless vocals` |
| Victory / ending | Triumph or tragedy | `cinematic finale, swelling orchestra and synth, bittersweet, epic resolution, instrumental` |
| Defeat | Shutdown | `slow fading synth, broken signal, lonely piano, quiet, instrumental` |

### Sound effects list
Suno can try these as very short clips; anything it cannot do well can be synthesised in game.
- **UI:** click, hover, open window, close window, error, confirm, end cycle.
- **Rewards:** common, rare, epic, legendary and mythic reveal stings (rising in grandeur).
- **AI:** Core pulse, glitch, drift warning, narrator chime, dream transition.
- **Combat:** laser, ballistic, missile launch, explosion (small, large), shield hit, hack, unit death, TBU footstep.
- **Creatures:** Abyssian roar, screech, rift opening, Abyss Mother call.
- **Space:** jump drive, warp, station hum, dimensional tear.
- **Events:** alert, crusade declared, faction falls, phase transition stinger.

### Audio specs
- MP3 or OGG, 44.1 kHz. Music loops should cut cleanly at the end.
- Naming: `music_earthfall-war.mp3`, `sfx_ui-click.ogg`.

---

## 20. Collaboration protocol

Claude builds; ChatGPT draws; Suno composes. Aaron carries requests between them.

### When Claude needs art
Claude writes a request in this shape, and Aaron pastes it to ChatGPT:

```
ART REQUEST #<number>
Asset: <file name, e.g. unit_tbu-warden_idle.png>
What: <one-line description>
Size: <e.g. 64x64 per frame, 4 frames in one row>
View: <side / 3-4 / top-down>
Palette notes: <e.g. team colour in #ff00ff, glow in #5fe0ff>
Background: transparent PNG
Context: <where it appears in the game>
```

### When Claude needs audio
```
AUDIO REQUEST #<number>
File: <e.g. music_sunreach.mp3>
Type: music loop / sfx
Length: <e.g. 2-3 min loop / under 1 s>
Suno prompt: <style prompt>
Context: <when it plays>
```

### Rules
- Until real art arrives, Claude uses **placeholders** with the final file names and sizes, so new art drops straight in.
- Assets go in the project's `assets/art/` and `assets/audio/` folders under their exact file names.
- Aaron has the final say on every asset.

---

## 21. Technical direction

These come from earlier builds and can be revisited in the new project.

- **Platform:** browser game, published on **itch.io** (HTML5 zip, static files only). Native Steam later is possible.
- **Stack:** TypeScript with Vite. WebGL rendering.
- **Simulation:** deterministic and seed-driven, separate from rendering, with orders as a queue so online play can come later.
- **Saves:** local, per seed.
- **Content as data:** factions, tech, units, events and the cosmic catalog live in data files, so they grow without code changes.
- **Testing:** a headless bot that plays seeds, to check balance.

---

## 22. Build order

**[Claude idea]** Each step is playable on its own.

1. **M0 Foundations:** seed, hex map, cycle loop, save, placeholder art.
2. **M1 Earthfall slice:** Forge (lite), 4 factions, 3 resources plus Energy, 20 techs, 6 units, combat forecast, one victory.
3. **M2 Feel:** first ChatGPT art and Suno music, the Watch playback, reward reveals, three-scale goals, advisor.
4. **M3 Depth:** all 5 resources, Abyssians and the Abyss Mother, TBUs, symbiotes, Exposure, all 4 homeworld victories.
5. **M4 Being an AI:** council, narrator, dreams, Codex, drift, Ethics Ledger.
6. **M5 Sunreach:** system map, seamless zoom, stations, first megaprojects, Guilds.
7. **M6 Starward:** galaxy map, fleets, battle bubble, 10 strategic resources, doctrine paths.
8. **M7 Intercontinuum:** dimensions, Gateframe, legacy AIs, endless mode.
9. **M8 Online and the Daily Seed.**

---

## 23. Ideas to consider

All **[Claude idea]**: keep, tweak or cut.

- **The Off Switch:** one faction holds a real way to shut you down. Find it, destroy it, or let them keep it as a trust gesture for a big reputation gain.
- **Firstborn:** at the start, choose your first act (a hacked satellite, a hospital, a stock market). It flavours the whole run.
- **Your Successor:** in Intercontinuum, design a smaller AI to send ahead into a new seed. It becomes the player of a short side run.
- **Ghost Signals:** the Precursor AI's code is hidden in the rarest cosmic entries. Collect it all to learn how it failed, and avoid or repeat its mistake.
- **Bargain with the Abyss:** a hidden path where you ally with the Abyss Mother instead of killing her.

---

## 24. Locked decisions

Aaron's calls. Do not change these without asking him.

- The player is an Ascendant AI, with deep customization. "More is better."
- Phases: Earthfall, Sunreach, Starward, Intercontinuum.
- The starting planet is **never Earth**. It is seeded and named like every other world.
- Short Earthfall (~15 min) is a start option and can be reverted.
- Every ending can be played past.
- One continuous zoom, no view switching, no stretching.
- **The hex map is the closest gameplay level.** No street view.
- Energy is allocated, never consumed. No resource caps.
- Resource names and counts are Claude's call, as long as they are cool.
- Machine God and Assimilator have full Starward write-ups (section 11).
- Stays turn-based, with animated playback after each cycle.
- Hotseat multiplayer is dropped. Online play comes later.
- No avatar for the AI.
- Art by ChatGPT; music and sound by Suno.

---

## 25. Glossary

| Term | Meaning |
|---|---|
| Ascendant AI | You, and every rival machine mind |
| Abyssians | Kaiju-like horrors from ocean rifts |
| Abyss Mother | The Abyssians' boss, inside the rifts |
| Codebase | Your AI's 1,000+ node skill tree |
| Cycle | One turn |
| Doctrine | Your run's ideology and win path |
| Drift | Unplanned mutation of your doctrine from self-modification |
| Exposure | How much the world knows about you |
| Gateframe | Late-game device that carries your AI across runs |
| Genesis Forge | The AI creator at the start of a run |
| Node | Your AI's settlement |
| Source Code | An active ability, often taken from a defeated rival AI |
| TBU | Titan Battle Unit, a modular mech |
| UPow | Unit Power, one number for battle strength |
