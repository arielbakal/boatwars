# Solar System Roadmap

Design vision captured during the 2026-07-08 live playtest session. Target: implement in the next session(s).

**Status: IMPLEMENTED** (commits e73d184..7fa9e03). All 5 steps shipped: spiral
ring layout around the sun at origin, tier remap, per-planet eco parameter
blocks, signature features (ponds / heat aura + embers / dim light), and
ring-exclusive fire/frost crystals that drop stat essences. Verified with a
two-client headless probe: identical seeded worlds, zero console errors.
Known follow-up: a mined crystal's essence only spawns on the miner's client
(mirrors pre-existing creature-essence behavior) — design decision pending on
whether essences should replicate to all clients.

## Vision

Turn the world from "5 random planets in a vacuum" into a **solar system**:

1. **The sun is the center.** Already implemented as a deadly proximity hazard (`SUN_POSITION`, graded heat damage in `CombatSystem._updateSunHazard`). It becomes the anchor the system is arranged around.
2. **Spiral progression outward.** Planets are ordered by distance from the sun. Difficulty and identity follow that distance:
   - Inner planets: fiery, toxic, hostile — hardest survival, best rewards.
   - Middle ring: temperate starting/flora worlds — the tutorial zone lives here.
   - Outer planets: colder and darker the further out — late-game exploration.
   - Progression = traveling the spiral outward (or inward, if inner = endgame; decide when laying out the ring order).
3. **Per-planet ecosystems.** Each planet gets interactions between its elements that make it unique, e.g.:
   - A humid planet: more clouds, denser flora, ponds, rain-fed growth.
   - A near-sun planet: fiery and toxic — heat aura, scorched palette, hazards instead of flora.
   - A far planet: dim light, sparse dark flora, slow creatures.
4. **Ponds / water features** as part of the organic look (mentioned alongside grass/rocks/flowers/bushes/trees).

## What already exists to build on

| Piece | Where | Notes |
|---|---|---|
| Sun + heat damage | `EntityFactory.createSun`, `CombatSystem._updateSunHazard`, `constants.js` SUN_* | RNG-free, fixed position |
| 5 planets, fixed positions | `GameEngine.initGame` (`createPlanet` calls) | Repositioning them around the sun is a coordinates-only change |
| Difficulty tiers | `constants.PLANETS[].tier` + `TIER_MODIFIERS`, `GameEngine._applyTier` | Re-map tier ↔ distance from sun |
| Per-planet DNA + palettes | `generateWorldDNA()` per planet, `generatePalette(hue)` | Ecosystem identity can drive the palette hue instead of random/fixed |
| Full-sphere organic dressing | `clusterPoints`/`rndAnywhere` helpers in `initGame` | Density/species per planet can become ecosystem parameters |
| Friendly fauna flag | `userData.friendly` (starting planet) | Temperament can scale with ring distance |
| Atmosphere shells + fade | `_trackAtmosphere`, fresnel shader | Humid planet = thicker/cloudier shell; toxic = tinted |
| Terrain sampling | `SphericalUtils.sampleTerrainHeight` | Everything placed on real displaced terrain — safe to vary relief per planet |

## Implementation sketch (next session)

Ordered so each step is shippable on its own:

1. **Lay out the system.** Move `SUN_POSITION` to the origin (or keep it and move planets); place the 5 planets on a spiral/rings at increasing distance from the sun. Update `constants.PLANETS` with `ringIndex`/`sunDistance`. Pure coordinate change — verify boat travel times still feel right.
2. **Map difficulty to the spiral.** Reorder `tier` by distance; starting planet sits in the temperate ring, not closest to the sun.
3. **Ecosystem parameter block per planet.** Extend each `PLANETS` entry with e.g. `{ humidity, temperature, toxicity, lightLevel }` derived from ring distance. Feed those into:
   - palette generation (hue/saturation bias),
   - dressing densities and species mix (`clusterPoints` counts),
   - atmosphere shell color/opacity,
   - creature temperament/tier.
4. **One signature feature per ecosystem** (cheap versions first):
   - Humid: ponds (flat blue discs snapped to terrain + a few extra bushes around them).
   - Fiery: heat aura near the surface (reuse the sun's graded-damage pattern with tiny values), ember particles, scorched palette.
   - Cold/dark: dimmer hemisphere light, sparse pale flora, slower creatures.
5. **Progression hooks.** Gate or incentivize the spiral: better resources outward/inward (gold already only on Ancient Peaks — generalize "each ring has an exclusive resource").

## Constraints to respect

- **Multiplayer determinism:** world gen runs under `SeededRandom`. Same-code clients stay in sync regardless of RNG draw counts; mixed-version clients desync. Any world-gen change = "everyone refreshes together".
- **Client-files-only preference:** the dev server stays live during playtests; avoid `server/index.js` changes (a restart rerolls the shared seed).
- **Keep it stylized, not realistic.** Cheap tricks (palette, density, particles, shells) over new tech. If a feature isn't easy, it stays an idea — explicitly requested by the user.
- **Findability:** chief/tools/golem stay near spawn poles (`rndSurface`); only dressing scatters planet-wide.

---

# Fracture Biosphere v11 Port

Stage 1 of porting `terrarium-breach-fracture-biosphere-v11.html` into the
modular tree. **Status: DONE (pure port).** Behaviour reproduces the prototype;
no determinism or networking work was attempted, by design, so any bug found
here is provably pre-existing.

## What landed

- New modules: `js/systems/BreachSystem.js`, `js/classes/ProceduralRig.js`.
- 12 modified modules; `RENDER_SCALE` 0.5 → 0.92.
- `js/patches/` — the prototype's 8 install layers, plus `flags.js` and `index.js`.
- `index.html` gained the breach/intro/grade markup; `css/style.css` absorbed the
  prototype's three style blocks.

## Dormant patch layers

Five layers never ran in the prototype. Its `const game` lived inside an IIFE, so
the later script blocks resolved `typeof game !== 'undefined' ? game : null` to
`null` and every layer returned at its own `if (!engine) return;` guard. Verified
by probing the original file: only `[Terrarium Quality V8]` and
`[Artistic Unlit V4]` ever log.

Gated `false` in `js/patches/flags.js`:

| Flag | Layer | What it should add |
|---|---|---|
| `screenFeelV7` | `screen-feel-v7.js` | drives the kinetic CSS custom properties |
| `qualityRuntimeV8` | `quality-runtime-v8.js` | procedural hull panels, ship upgrade dressing |
| `biosphereFaunaV9` | `biosphere-fauna-v9.js` | legged creatures, extra flora, sphere-wide scatter |
| `fractureBiosphereV10` | `fracture-biosphere-v10.js` | recursive organisms, fractal sky, GPU field pass |
| `fractureBiosphereV11` | `fracture-biosphere-v11.js` | silhouettes, planet atmospherics, nebular canopy |

Note the v10/v11 **stylesheets** were always live, which is why those versions
looked different despite their JS never running. Flipping a flag runs code that
has never executed once — expect breakage, and do them one at a time.

## Deviations from the pure port

Stage 1 was meant to reproduce v11 exactly. Two changes go beyond that, both
requested during playtesting, so the "any bug here is provably pre-existing"
claim no longer holds for these areas:

1. **Intro screen removed.** `#solar-intro` and its handler are gone; pointer lock
   is acquired by clicking the canvas, which `InputHandler` already did.
2. **Locomotion rewritten** (see below), which also changed `PLAYER_SPEED`.

The webfont `@import` for Press Start 2P was also restored — v11 dropped it while
still naming the family in ~10 rules, so it silently fell back to Courier.

## Locomotion rewrite

The ported rig stretched the player's legs 2-4x their length while walking. The
cause was threefold: the shin was drawn to the raw foot position with no reach
constraint, the stride constants were authored for a far slower character, and
`player.vel` (a per-frame value that under-reports real motion by ~2x) was being
used as a velocity. Incremental fixes did not converge, so `ProceduralRig` now
models the gait properly:

- **Phase clock, not triggers.** One `strideClock`; each leg reads it half a cycle
  apart, stance/swing split by a duty factor. Symmetry is structural, so the
  degenerate states a trigger-based stepper falls into (a leg stranded mid-air, one
  leg locked while the body slides) cannot occur.
- **Froude scaling.** `v^2/(g*legLength)` drives step length, cadence and the
  walk-to-run duty change, so gait changes with speed instead of being tiered.
- **Springs** for pelvis height, lean, bank and sway — an exponential lerp has no
  velocity, so it cannot lag and settle.
- **Body dynamics:** centre-of-mass bob, sway over the support leg, pelvis yaw and
  roll applied through the hip axis, torso counter-rotation, gaze stabilisation,
  lean into acceleration and bank into turns.
- **Terrain adaptation:** swing targets re-sampled onto the surface every frame and
  clamped against rises; pelvis rides the support foot, not the average.

The patch layer's `_updateFeet` / `_updateBody` overrides were deleted, since they
shadowed all of the above with the older stepper.

**`PLAYER_SPEED` 0.12 -> 0.06, and `GameState` now reads it** (it previously
hardcoded its own 0.12, leaving the constant unused). At 0.12 the character crossed
3-5 body lengths per second against legs 0.87 long; the maximum stride the legs can
cover is about 4.2 u/s, so even walking outran them and no gait could avoid sliding.
This halves movement speed and is the one change here with real gameplay impact.

## Stage 2 backlog

1. **Determinism.** The patch layers call `Math.random()` ~87 times and
   `BreachSystem` 11 times, outside the `SeededRandom` contract. Clients will not
   agree on dressing. Route generation randomness through the seeded PRNG.
2. **Breach replication.** Enemy HP, kills, stability and world hearts are absent
   from `MessageProtocol`; each client fights private enemies. Decide what
   replicates (this generalizes the pending essence-replication question above).
3. **Fold the layers in.** Move each prototype override into the module it
   patches and collapse the double `WorldManager.getMat` override (v7 then v8
   both replace it; only v8's survives). Then `js/patches/` can go away.
4. **Rig registry.** `getProceduralRig()`/`setProceduralRig()` exists only because
   the prototype reassigned a class binding. Once the quality layer is folded into
   `ProceduralRig.js`, delete the registry.
