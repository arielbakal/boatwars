# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Island Survival — a multiplayer 3D browser game built with vanilla JS and Three.js (r128). No build step, no framework, no TypeScript. All client code is ES6 modules served directly.

## Commands

```bash
npm install              # install dependencies (ws, serve)
npm run dev              # start server: HTTP + WebSocket both on :3000
npm run serve            # static-only (no multiplayer): serves base/modular on :3000
```

No test runner or linter is configured.

## Architecture

### Entry Flow
`base/modular/index.html` → `js/main.js` → `installCorePatches()` → `new GameEngine()` → `installEnginePatches(game)` → `initGame()` → `animate()` loop

### Key Directories
- `server/index.js` — Node.js HTTP + WebSocket server (no rooms, no auth)
- `base/modular/` — All client code (served as static files)
- `base/modular/js/classes/` — Core engine classes
- `base/modular/js/systems/` — Game systems (chop, mine, boat, AI, particles, inventory, combat, breach)
- `base/modular/js/network/` — Multiplayer client (WebSocket, seeded RNG, message protocol)
- `base/modular/js/patches/` — Visual/gameplay layers that rewrite prototypes at load time

### Game Loop (`GameEngine.animate()`)
Each frame builds a `context` object (state, world, audio, factory, camera, playerController, etc.) and calls each system's `update(dt, context)` directly. `SystemManager` exists but systems are invoked manually in sequence.

### Entity Model
Entities are `THREE.Object3D` with typed `userData` properties (`type`, `hp`, `boundCenter`, `boundRadius`, `vel`, `exploding`, etc.). Created via `EntityFactory`.

### World Generation
`EntityFactory.generateWorldDNA()` creates randomized shapes, `generatePalette()` creates HSL color schemes. `createIslandAt()` builds multi-layer terrain with vertex displacement. Multiplayer uses `SeededRandom` (mulberry32 PRNG replacing `Math.random` during generation) so all clients produce identical worlds from a shared seed.

### Multiplayer Protocol
JSON over WebSocket. Message types: `welcome`, `player_join`, `player_leave`, `player_state`, `world_event`, `chat`, `entity_spawn`, `entity_remove`, `inventory_update`. Server sends world seed on connect; clients broadcast tree chops, rock mines, combat events, and inventory state.

### Combat System
`CombatSystem.js` handles melee attacks (cooldown-based, forward arc), creature aggro/contact damage, stat boosts (speed/attack/health essences dropped by creatures), death/respawn with invincibility timer, and HP bar UI. Combat constants are in `constants.js`. Three creature types drop typed essences: `conehead` → speed, `blobby` → attack, `blocky` → health.

### Breach System
`BreachSystem.js` is the projectile-combat pillar: a ranged weapon with aim/recoil, per-planet blight enemy counts and a world stability meter, world hearts, ragdolls and dew drops. `GameEngine` constructs it, calls `initialize(state.islands, ctx)` from `initGame`, passes it in the frame context, and calls `cleanup()` on reset. HUD lives in `#breach-hud`. It takes damage through `CombatSystem.damagePlayerFromBreach`.

### Player Rig
`ProceduralRig.js` exports `SegmentMesh` (used by `EntityFactory`) and the `ProceduralRig` class that solves the player's procedural IK. Because a patch layer swaps the rig for a subclass, consumers resolve it through `getProceduralRig()` / `setProceduralRig()` rather than importing the class directly.

### Patch Layers (`js/patches/`)
Each layer is an `install*(engine?)` function that rewrites prototypes on `EntityFactory`, `WorldManager`, `CatAI`, `CombatSystem`, `BoatSystem` and `InputHandler`. `patches/index.js` fixes the order: `installCorePatches()` runs the two prototype-level layers before the engine exists (world generation reads the material and factory paths they replace), then `installEnginePatches(game)` runs the engine-level layers.

Five layers are ported but dormant — they never executed in the single-file prototype because they were handed a `null` engine. `patches/flags.js` gates them, all `false` by default. See `ROADMAP.md`.

### State Management
`GameState` holds all mutable state (including combat: `hp`, `maxHp`, `attack`, `speedBoost`, `stunTimer`) and provides `reset()`. Passed by reference into every system via the context object.

## Dependencies
- **Runtime:** `ws` (WebSocket server)
- **Client (CDN):** Three.js r128, BeepBox 4.2.0, Web Audio API for synthesized SFX
- **Dev:** `serve` (static file server)

## Important Notes
- `config.js` contains a hardcoded Gemini API key — treat with care
- `LLMService.js` has a syntax error (`dsa` on line 20) and returns random fallbacks (LLM integration is disabled)
- `ecs/systems/` directory is empty — ECS migration was started but not completed
- Must be served over HTTP, not `file://`, due to ES6 module requirements
- The patch layers and `BreachSystem` call `Math.random()` directly, so they are outside the `SeededRandom` world-generation contract — clients will not agree on the dressing they produce
- `BreachSystem` state (enemy HP, kills, stability, world hearts) is not in the network protocol; each client fights its own enemies
