// =====================================================
// MINE SYSTEM - Rock/Gold mining mechanics (spherical)
// =====================================================

import { MINE_HITS, HIT_INTERVAL, CHOP_MAX_RANGE, MINE_DROP_COUNT } from '../constants.js';
import SphericalUtils from '../classes/SphericalUtils.js';

export default class MineSystem {
    constructor(ui) {
        this.ui = ui;
    }

    update(dt, context) {
        const { state, world, audio, factory, broadcastWorldEvent } = context;

        if (!state.isMining || !state.interactionTarget) return;

        const rock = state.interactionTarget;
        const mineDist = rock.position.distanceTo(state.player.pos);
        if (mineDist > CHOP_MAX_RANGE) {
            state.isMining = false;
            state.mineProgress = 0;
            return;
        }

        state.mineTimer += dt;

        // Reuse chop indicator for mining
        if (this.ui.chopIndicator) {
            this.ui.chopIndicator.style.display = 'block';
            if (this.ui.chopFill) {
                this.ui.chopFill.style.width = ((state.mineProgress / MINE_HITS) * 100) + '%';
                this.ui.chopFill.style.background = '#aaaaaa'; // Grey for stone
            }
        }

        if (state.mineTimer >= HIT_INTERVAL) {
            state.mineTimer = 0;
            state.mineProgress++;
            audio.chop();

            // Rock shake (along tangent direction)
            const planet = rock.userData.planet;
            if (planet) {
                const normal = SphericalUtils.getSurfaceNormal(rock.position, planet);
                const tangent = SphericalUtils._getArbitraryTangent(normal);
                const origPos = rock.position.clone();
                rock.position.add(tangent.multiplyScalar((Math.random() - 0.5) * 0.15));
                setTimeout(() => { if (rock.parent) rock.position.copy(origPos); }, 100);
            }

            factory.createChopParticles(rock.position.clone(), rock.userData.color || new THREE.Color(0x888888));

            if (state.mineProgress >= MINE_HITS) {
                audio.treeFall();

                // Spawn resource drops
                const dropColor = rock.userData.type === 'gold_rock'
                    ? new THREE.Color(0xffd700)
                    : (rock.userData.color || new THREE.Color(0x888888));

                const dropType = rock.userData.type === 'gold_rock' ? 'gold' : 'rock';

                for (let i = 0; i < MINE_DROP_COUNT; i++) {
                    const drop = new THREE.Mesh(
                        new THREE.DodecahedronGeometry(0.15),
                        world.getMat(dropColor)
                    );
                    drop.userData = { type: dropType, color: dropColor, autoPickup: true };

                    // Place drops on planet surface near the mined rock
                    const rockPlanet = rock.userData.planet;
                    if (rockPlanet) {
                        const dropPos = SphericalUtils.randomSurfacePointNear(rockPlanet, rock.position, 0.2, 0.8);
                        const normal = SphericalUtils.getSurfaceNormal(dropPos, rockPlanet);
                        // Sample real terrain height so drops land on the displaced surface
                        const terrainRadius = SphericalUtils.sampleTerrainHeight(rockPlanet, normal);
                        drop.position.copy(rockPlanet.center.clone().add(normal.multiplyScalar(terrainRadius + 0.15)));
                        drop.userData.planet = rockPlanet;
                    } else {
                        drop.position.copy(rock.position);
                    }
                    world.add(drop);
                    state.entities.push(drop);
                }

                // Remove rock
                world.remove(rock);
                const idx = state.entities.indexOf(rock);
                if (idx > -1) state.entities.splice(idx, 1);
                if (state.obstacles.includes(rock)) state.obstacles.splice(state.obstacles.indexOf(rock), 1);

                // Broadcast to other players
                if (broadcastWorldEvent) broadcastWorldEvent('rock_mined', rock.position.x, rock.position.z);

                state.isMining = false;
                state.mineProgress = 0;
                state.interactionTarget = null;
                if (this.ui.chopIndicator) this.ui.chopIndicator.style.display = 'none';
                if (this.ui.chopFill) this.ui.chopFill.style.background = '#ff8800'; // Reset color
            }
        }
    }
}
