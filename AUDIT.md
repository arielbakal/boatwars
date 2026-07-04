# Improvement Audit & Strategy

**Date:** 2026-07-03
**Branch audited:** `fix/space-gameplay-audit`
**Method:** four parallel read-only code audits — gameplay loop, animations/game feel, 3D content, graphics/rendering.

## Decision

Work order: **Hygiene pass → Strategy A (core loop) → B (game feel) / D (multiplayer visibility) → C (visual identity)**.

Rationale: the technical base is solid after the previous audit-fix cycle, but the game currently has **no risk, no goals, and no resource sinks**. Visual and feel improvements are high-leverage but pointless until the core loop gives players a reason to engage.

Hygiene + Strategy A are implemented on branch `feat/core-loop`.

## Status (2026-07-04)

All four strategies plus a comprehensive verification cycle are complete on `feat/core-loop`:

- **Hygiene + Strategy A** — done (aggro, tiers, gold economy, essence caps, crafting UX).
- **Playtest round 1 fixes** — ship jitter, Minecraft tool grip, gold glow/hint, inventory stacking, first-person polish (existing G-mode: crosshair, aim-synced combat, body hiding).
- **Strategy B** — done (shared easing + dt-correct smoothing across ~25 sites, FOV kick, aerial pose, speed-matched walk, per-species creature locomotion, ship banking, camera shake, engine glow, pickup magnetism, damage numbers).
- **Strategy C** — done (per-planet DNA, fresnel atmospheres on all planets, space fog, grass clumps, layered canopies, unique rock silhouettes, FBM terrain with flat detail cap, filmic tone mapping + sRGB, toon material unification).
- **Comprehensive verification** — 3 fresh-context domain judges + dual-client Playwright runtime probe. All confirmed findings fixed, including two majors: the multiplayer world seed was never consumed on connect (players were always in different worlds — now bit-identical, runtime-proven), and the inventory stack-by-type fix had landed in a dead duplicated method. Re-probe: determinism PASS, zero console errors.

- **Strategy D** — done (remote ships rendered + pilots seated, attack swings broadcast via attackSeq + eased remote tool swings, player chat with focus-gated input and overhead bubbles, ship construction + log placement synced). Plus: server player_state relay completed (it was silently dropping attackSeq/shipPosition/shipQuaternion/shipSpeed — remote melee swings had never worked), name-label disposal leak fixed, join/leave toasts verified pre-existing.
- **Final visual verification** — dual-client probe, 7/7 PASS, zero console errors: world sync, name labels, chat end-to-end (391ms latency), chat focus gating, attackSeq propagation through the restarted relay, smooth remote walk interpolation.

Remaining (accepted gaps): remote-synced log pickup not broadcast (can locally desync, consistent with the protocol's non-authoritative style); inventory-placed creatures skip tiers; egg-in-inventory drops tier fields; LLM chief is canned; no persistence. Remote ships in actual flight not yet human-verified (headless probe can't build/board a ship).

---

## Strategies

| # | Strategy | Scope | Impact | Effort |
|---|----------|-------|--------|--------|
| A | **Core loop** | Ambient creature aggro, discoverable crafting, gold as a real resource, ship health loop, per-planet difficulty tiers, essence caps | Turns the tech demo into a game | M |
| B | **Game feel** | Shared easing + dt-scaled smoothing, creature locomotion life, FOV kick, screen shake, ship banking, engine glow | Immediate perceived quality | S/M |
| C | **Visual identity** | Per-planet world DNA, atmospheres on all planets (fresnel), fog, tone mapping, grass clumps, layered tree canopies, per-rock distortion, material unification, planet detail cap + better noise | Each planet looks distinct | M |
| D | **Multiplayer visibility** | Render remote ships, broadcast attack swings, player chat UI, sync ship construction | Fixes what "looks broken" with 2+ players | S/M |

Hygiene pass (independent of strategy, done first): confirmed bugs listed below.

---

## Confirmed bugs (hygiene scope)

| Bug | Location | Severity |
|-----|----------|----------|
| GPU memory leak: `resetWorld()` removes planet groups but never disposes geometries/materials (`disposeHierarchy` exists and is unused here) | `GameEngine.js:209-211` | High (unbounded GPU growth per "NEW WORLD") |
| Particle/debris position + gravity integration not dt-scaled while life/rotation/scale decay is — travel distance is frame-rate dependent | `ParticleSystem.js:15,23-25,40,46-48` | Medium |
| Attack swing duration hardcoded `0.4` instead of `ATTACK_SWING_DURATION` — silently desyncs from `CombatSystem` if the constant is tuned | `PlayerController.js:352` | Low |
| Stale onboarding hint "Press F to pick up Axe" — actual key is E | `index.html:32-35` | Low (first-time UX) |

Other dead code noted (not blocking): `#log-count` HUD never updated (wired in Strategy A), `isEngineGlow` tag never read (Strategy B), `p.isOnBoat` sent but never consulted (Strategy D), `SPACE_FOG_COLOR` / `PLANETS[].hasAtmosphere` / `RENDER_SCALE` constants defined but bypassed (Strategy C), `state.inputs.shift` tracked but never read, chop/mine hit-shake uses `setTimeout` outside the dt loop.

---

## Findings — Gameplay

**Core loop today:** walk to tree/rock → 5 hits → pickup → …nothing. No win state, score, objective, or difficulty ramp anywhere in the client.

- Creatures **never initiate aggro** — the only place `aggroTimer` is set is when the player hits them (`CombatSystem.js:164`). Gathering carries zero risk; death is nearly impossible and costs 2s + full heal.
- Resource dead-ends: `rock` has no sink; `gold_rock` (planet 3 only) mines into a generic `'rock'` item (`MineSystem.js:58-67`) — the one rare resource has zero payoff.
- The only crafting — place 4 logs within radius 5 to auto-assemble a spaceship (`InputHandler.js:549-618`) — is invisible: nothing explains it, and the `#log-count` HUD is never written.
- Ship `stats.health` (100) is displayed but never decremented; planet collisions only bleed speed (`BoatSystem.js:421-439`). Flight carries zero risk.
- Essence stat boosts (attack/speed/maxHp) grow forever with no cap and no scaling threat to spend them against (`CombatSystem.js:369-409`).
- All 5 planets use the same `speciesStats` table and near-identical population loops — flying anywhere is a palette swap. Only planet 3 differs (mountain, golem, gold rocks).
- Multiplayer: server relays `chat` but no client UI sends it; ship construction is never broadcast; PvP damage exists but has no purpose.
- Chief NPC "quest" line has no completion logic; `LLMService.sendChat()` ignores the loaded lore and returns canned lines.

**Ranked opportunities:** 1) unprovoked wildlife aggro (S, transforms the loop), 2) discoverable crafting + HUD (S/M), 3) gold sink + ship health/repair loop (M), 4) per-planet difficulty/resource tiers (M), 5) player chat (S), 6) sync ship construction (M), 7) essence caps/gating (S), 8) real Chief dialogue or honest removal (S), 9) minimal persistence via localStorage (M/L).

---

## Findings — Animations & game feel

- **Remote ships are not rendered**: `shipPosition`/`shipQuaternion` are sent and stored (`NetworkManager.js:90-101,176-178`) but never read — a piloting player appears to fly through space with no ship, playing a walk animation (`isOnBoat` dead). Biggest "looks broken" multiplayer gap.
- Melee attacks are never broadcast (`sendPlayerState` only sends chop/mine); remote swings use a raw unclamped sine instead of the local eased swing.
- Creatures (blobby/blocky/conehead) are limbless single meshes — locomotion is position + sine bob; they read as sliding. The cat has the best rig in the game (per-leg walk cycle); the golem is second.
- **dt-scaling is inconsistent project-wide**: nearly all `.lerp()`/`.slerp()` calls (camera, remote interpolation, orientation, knockback) use flat per-frame fractions — feel differs between 30 and 144 fps. Particle position vs decay mismatch is a live bug (see hygiene).
- No screen shake anywhere. No FOV changes (constant 60) — no speed-sell for ship throttle or speed essence. `isEngineGlow` meshes tagged but never modulated.
- No jump/aerial pose (falls through to idle); walk cycle frequency not scaled by actual speed (speed-boosted players foot-slide).
- Ship never banks into turns (`_autoLevelRoll` zeroes roll continuously) — deliberate design choice, but reads as a spinning top; collisions produce no particles/shake/damage.
- No shared easing/tween utility; `easeInOutQuad` is local to `PlayerController.js`. No `AnimationMixer` (fine for this style).

**Ranked opportunities:** 1) sync remote ships + seated riders (S/M), 2) broadcast/render remote attack swings (S), 3) shared easing module + dt-scale all smoothing (M), 4) creature locomotion life pass — squash/stretch/hop per species (S/M), 5) FOV kick (S), 6) engine glow + collision feedback (S), 7) jump pose + speed-matched walk (S/M), 8) ship banking (M, needs design sign-off), 9) pickup magnetism (S), 10) damage numbers (S/M).

---

## Findings — 3D content

- **All 5 planets share one session-wide `worldDNA`** — same tree/bush/rock shape and creature species everywhere; planet distinctness is color-only. Rolling DNA per planet is the single highest-leverage visual change and is cheap.
- Grass is a single thin box per entity; trees are trunk + 1 leaf primitive; rocks are pristine primitive clones (rotation/scale only) even though `distortGeometryRadial` exists and is proven on planets.
- Player avatar (8 plain boxes) is markedly lower fidelity than the cat companion (~20 shaped primitives with a real gait) — and it's the most on-screen model in third-person.
- Atmosphere shell exists only on planet 1, forced 50% toward blue regardless of palette; `tallGrass` palette color is aliased to `flora` (one-line fix for variety).
- Space between planets is empty: no asteroids, stations, or POIs — just the starfield (which is generated **outside** the seeded window and differs per client; cosmetic only, but don't build shared landmarks on it).
- Planet detail formula `clamp(floor(radius/4), 4, 6)` gives planet 3 ~246K triangles (3 layers × ~82K) vs ~5K/layer elsewhere — cap detail flat and reinvest in 2-3 octave coherent noise instead of the current sin/cos + white-noise displacement.
- Render pipeline is 0.5-scale pixelated (deliberate retro look): silhouette- and color-level variety pays; sub-pixel mesh detail doesn't.

**Determinism constraint:** all shared world content must be generated inside the seeded `Math.random` override window (`GameEngine.js:263-645`) with a stable call order. Adding seeded calls is safe (all clients run the same code); moving generation async/parallel or reordering loops breaks cross-client parity.

**Ranked opportunities:** 1) grass clumps (S), 2) distinct grass hue (S), 3) per-planet DNA (S/M), 4) atmospheres everywhere, palette-tinted (S), 5) per-rock distortion via existing helper (S/M), 6) fix detail formula + real noise (M), 7) layered tree canopies (S/M), 8) player avatar to cat-tier fidelity (M), 9) instancing for non-interactive clutter (M/L), 10) landmark/POI variety per planet (M/L), 11) asteroid fields / space POIs (L).

---

## Findings — Graphics/rendering

- Renderer: no antialias (moot at 0.5 scale), no tone mapping, no sRGB output, no shadow maps (some `castShadow=true` flags are dead code). Background is a flat color; **no fog** (`SPACE_FOG_COLOR` defined, never used).
- Lighting: one global rig (ambient 0.4 + sun 1.0 + cool fill 0.3) identical for all 5 planets regardless of position; no per-planet sun direction, no point lights for engine/ore glow.
- Materials: `MeshToonMaterial` dominant (no gradientMap), with inconsistent outliers — `MeshStandardMaterial` on tools/crystals, `MeshPhongMaterial` on cockpit. No textures, no vertex colors (except starfield).
- No post-processing at all; r128 `examples/js` UMD builds could add bloom without a bundler (verify CDN availability first).
- ~290 entities ≈ **600-650 draw calls** (every entity is its own Group of individually created meshes/materials, `getMat` never caches); no instancing/LOD/merging.
- `RENDER_SCALE` and `PLANETS[].hasAtmosphere` constants are bypassed by hardcoded values in `GameEngine.js` — data drift risk.
- Three.js r128 upgrade is **not blocked** (no legacy Geometry API), but `outputEncoding`-era APIs rename at r152+; tag any encoding code added now.

**Ranked opportunities:** 1) fix reset dispose leak (S — in hygiene), 2) scene fog, tuned for navigation (S), 3) unify materials on Toon (S), 4) per-planet lighting (M), 5) fresnel atmosphere shader + all planets (M), 6) tone mapping + sRGB with palette re-tune (S code, M tuning), 7) instancing (L, touches gameplay raycasts), 8) dynamic per-planet shadow rig (L), 9) bloom via r128 examples (L), 10) fix constant drift (S).

---

## Strategy A — implementation scope (in progress)

- [x] **A1 Ambient aggro:** proximity + per-second chance roll in `EntityAISystem.updateCreature`; per-species temperament; scaled by planet tier.
- [x] **A2 Discoverable crafting:** wire `#log-count` HUD to wood count; correct hint copy; contextual prompt on first wood pickup explaining log placement → ship assembly.
- [x] **A3 Gold + ship loop:** `gold_rock` drops distinct `gold` item; planet collisions damage ship health (impact-speed scaled); repair ship with gold via interact key; degraded max speed when damaged.
- [x] **A4 Planet tiers:** per-planet creature HP/damage multipliers and aggro aggressiveness in `constants.PLANETS`, tuned by distance from start (planet 1 docile → planet 3 dangerous/rewarding).
- [x] **A5 Essence caps:** clamp attack/speed/maxHp growth at defined maxima in `CombatSystem`.

Multiplayer note: aggro, ship damage, and repair are client-local state — consistent with current architecture; syncing is Strategy D territory.
