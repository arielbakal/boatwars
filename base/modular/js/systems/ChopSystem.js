// =====================================================
// CHOP SYSTEM - Tree chopping mechanics (spherical)
// =====================================================

import { CHOP_HITS, HIT_INTERVAL, CHOP_MAX_RANGE } from '../constants.js';
import SphericalUtils from '../classes/SphericalUtils.js';

export default class ChopSystem {
    constructor(ui) {
        this.ui = ui;
        this.swingTimer = 0;     // counts down from swing duration
        this.swingDuration = 0.15; // how long one swing takes (seconds)
        this.isSwinging = false;
    }

    update(dt, context) {
        const { state, world, audio, factory, broadcastWorldEvent, playerController } = context;

        // Update swing timer
        if (this.isSwinging) {
            this.swingTimer -= dt;
            if (this.swingTimer <= 0) {
                this.isSwinging = false;
            }
        }

        if (!state.isChopping || !state.interactionTarget) {
            if (this.ui.chopIndicator) this.ui.chopIndicator.style.display = 'none';
            // Reset arm animation state
            if (playerController) playerController.chopAnimState = null;
            return;
        }

        const tree = state.interactionTarget;
        const chopDist = tree.position.distanceTo(state.player.pos);
        if (chopDist > CHOP_MAX_RANGE) {
            state.isChopping = false;
            state.chopProgress = 0;
            if (this.ui.chopIndicator) this.ui.chopIndicator.style.display = 'none';
            return;
        }

        state.chopTimer += dt;

        if (this.ui.chopIndicator) {
            this.ui.chopIndicator.style.display = 'block';
            if (this.ui.chopFill) {
                this.ui.chopFill.style.width = ((state.chopProgress / CHOP_HITS) * 100) + '%';
            }
        }

        // Make the player face the tree while chopping
        if (playerController && playerController.modelPivot) {
            const faceDir = tree.position.clone().sub(state.player.pos).normalize();
            const planet = playerController.getCurrentPlanet ? playerController.getCurrentPlanet() : null;
            if (planet) {
                const normal = SphericalUtils.getSurfaceNormal(state.player.pos, planet);
                const q = SphericalUtils.getOrientationOnSurface(normal, faceDir);
                playerController.playerGroup.quaternion.slerp(q, 0.2);
            }
        }

        // Send arm animation state to PlayerController
        if (playerController) {
            playerController.chopAnimState = {
                isSwinging: this.isSwinging,
                swingProgress: this.isSwinging ? (this.swingTimer / this.swingDuration) : 0
            };
        }

        if (state.chopTimer >= HIT_INTERVAL) {
            state.chopTimer = 0;
            state.chopProgress++;
            audio.chop();

            // Trigger swing animation
            this.isSwinging = true;
            this.swingTimer = this.swingDuration;

            // Tree shake (along arbitrary tangent direction)
            const planet = tree.userData.planet;
            if (planet) {
                const normal = SphericalUtils.getSurfaceNormal(tree.position, planet);
                const tangent = SphericalUtils._getArbitraryTangent(normal);
                const origPos = tree.position.clone();
                tree.position.add(tangent.multiplyScalar((Math.random() - 0.5) * 0.15));
                setTimeout(() => { if (tree.parent) tree.position.copy(origPos); }, 100);
            }

            factory.createChopParticles(tree.position.clone(), state.palette.trunk);

            if (state.chopProgress >= CHOP_HITS) {
                audio.treeFall();
                for (let i = 0; i < 15; i++) {
                    factory.createParticle(tree.position.clone(), state.palette.flora, 1.5);
                }

                // Spawn log at tree position on planet surface
                const treePlanet = tree.userData.planet;
                const treePos = tree.position.clone();

                world.remove(tree);
                const idx = state.entities.indexOf(tree);
                if (idx > -1) state.entities.splice(idx, 1);
                if (state.obstacles.includes(tree)) state.obstacles.splice(state.obstacles.indexOf(tree), 1);

                // Broadcast to other players
                if (broadcastWorldEvent) broadcastWorldEvent('tree_chopped', treePos.x, treePos.z);

                const log = factory.createLog(state.palette, 0, 0);
                if (treePlanet) {
                    const logSurfacePos = SphericalUtils.randomSurfacePointNear(treePlanet, treePos, 0.2, 0.8);
                    const normal = SphericalUtils.getSurfaceNormal(logSurfacePos, treePlanet);
                    // Sample real terrain height so the log lands on the displaced surface
                    const terrainRadius = SphericalUtils.sampleTerrainHeight(treePlanet, normal);
                    const logHeightOffset = log.userData.heightOffset || 0;
                    const logWorldPos = treePlanet.center.clone().add(normal.multiplyScalar(terrainRadius + logHeightOffset));
                    log.position.copy(logWorldPos);
                    const q = SphericalUtils.getOrientationOnSurface(normal);
                    log.quaternion.copy(q);
                    log.userData.planet = treePlanet;
                } else {
                    log.position.copy(treePos);
                }
                world.add(log);
                state.entities.push(log);

                state.isChopping = false;
                state.chopProgress = 0;
                state.interactionTarget = null;
                if (this.ui.chopIndicator) this.ui.chopIndicator.style.display = 'none';
            }
        }
    }
}
