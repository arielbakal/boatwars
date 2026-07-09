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
