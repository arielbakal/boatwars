// =====================================================
// BOAT/SPACESHIP SYSTEM - Adapted for spherical planets
// =====================================================

import {
    BOAT_BASE_MAX_SPEED, BOAT_BASE_ACCELERATION, BOAT_BASE_BRAKE, BOAT_BASE_TURN_SPEED,
    BOAT_BASE_DRAG, BOAT_BASE_HEALTH,
    BOAT_REVERSE_FACTOR, BOAT_MIN_SPEED, BOAT_COLLISION_RADIUS, BOAT_PROXIMITY_RANGE,
    BOAT_DECK_Y_OFFSET, BOAT_PLAYER_Y_OFFSET,
    BOARDING_WALK_SPEED, BOARDING_HOP_SPEED, BOARDING_SETTLE_SPEED,
    BOARDING_HOP_HEIGHT, BOARDING_SIDE_DIST, CAT_BOARDING_DELAY
} from '../constants.js';
import SphericalUtils from '../classes/SphericalUtils.js';

export default class BoatSystem {
    constructor(ui) {
        this.ui = ui;
        this.boatPromptVisible = false;
        this._nearestBoat = null;
    }

    get nearestBoat() { return this._nearestBoat; }

    boardBoat(boat, context) {
        const { state, audio, playerCat } = context;
        state.isBoardingBoat = true;
        state.boardingPhase = 0;
        state.boardingProgress = 0;
        state.boardingStartPos = state.player.pos.clone();
        state.boardingTargetBoat = boat;
        state.player.vel.set(0, 0, 0);
        if (this.ui.boatPrompt) this.ui.boatPrompt.style.display = 'none';
        this.boatPromptVisible = false;
        audio.sail();

        if (playerCat) {
            state.catOnBoat = false;
            state.catBoardingDelay = CAT_BOARDING_DELAY;
            state.catBoardingQueued = true;
            state.catBoardingStartPos = playerCat.position.clone();
        }
    }

    finishBoarding(context) {
        const { state, playerController } = context;
        const boat = state.boardingTargetBoat;
        state.isBoardingBoat = false;
        state.boardingTargetBoat = null;
        state.isOnBoat = true;
        state.activeBoat = boat;
        state.boatSpeed = 0;
        state.boatRotation = 0;
        this.showBoatHUD(true);
        if (playerController.playerGroup) {
            playerController.playerGroup.visible = true;
            this.setSeatedPose(playerController);
        }
    }

    disembarkBoat(context) {
        const { state, audio, playerController, playerCat, factory } = context;
        if (!state.activeBoat) return;
        const boatPos = state.activeBoat.position;

        // Find nearest planet
        const result = SphericalUtils.findNearestPlanet(boatPos, state.islands);
        if (result.planet && result.distance < result.planet.radius + 10) {
            const normal = SphericalUtils.getSurfaceNormal(boatPos, result.planet);
            const surfacePos = result.planet.center.clone().add(normal.multiplyScalar(result.planet.radius + 2));
            state.player.pos.copy(surfacePos);
        } else {
            audio.pop();
            return;
        }

        state.isOnBoat = false;
        state.boatSpeed = 0;
        state.player.vel.set(0, 0, 0);
        audio.pickup();
        this.showBoatHUD(false);
        if (playerController.playerGroup) {
            playerController.playerGroup.visible = true;
            this.resetSeatedPose(playerController);
        }

        if (playerCat) {
            state.catOnBoat = false;
            state.catBoarding = false;
            state.catBoardingQueued = false;
            if (result.planet) {
                const catNormal = SphericalUtils.getSurfaceNormal(boatPos, result.planet);
                // Offset slightly from player
                const tangent = SphericalUtils._getArbitraryTangent(catNormal);
                const catPos = result.planet.center.clone().add(
                    catNormal.clone().add(tangent.multiplyScalar(0.1)).normalize().multiplyScalar(result.planet.radius + 0.3)
                );
                playerCat.position.copy(catPos);
                playerCat.userData.planet = result.planet;
            }
        }
    }

    setSeatedPose(pc) {
        if (!pc.modelPivot) return;
        if (pc.legL) { pc.legL.rotation.x = -Math.PI / 2; pc.legL.position.y = 0.3; }
        if (pc.legR) { pc.legR.rotation.x = -Math.PI / 2; pc.legR.position.y = 0.3; }
        if (pc.armL) { pc.armL.rotation.x = -0.4; pc.armL.rotation.z = 0.25; }
        if (pc.armR) { pc.armR.rotation.x = -0.4; pc.armR.rotation.z = -0.25; }
        pc.modelPivot.position.y = -0.20;
    }

    resetSeatedPose(pc) {
        if (!pc.modelPivot) return;
        if (pc.legL) { pc.legL.rotation.x = 0; pc.legL.position.y = 0.4; }
        if (pc.legR) { pc.legR.rotation.x = 0; pc.legR.position.y = 0.4; }
        if (pc.armL) { pc.armL.rotation.set(0, 0, 0); }
        if (pc.armR) { pc.armR.rotation.set(0, 0, 0); }
        pc.modelPivot.position.y = 0;
    }

    showBoatHUD(show) {
        const hint = document.getElementById('boat-nav-hint');
        if (hint) hint.style.display = show ? 'block' : 'none';
        const statsPan = document.getElementById('boat-stats');
        if (statsPan) statsPan.style.display = show ? 'block' : 'none';
    }

    updateBoardingAnimation(dt, context) {
        const { state, playerController: pc } = context;
        if (!state.isBoardingBoat || !state.boardingTargetBoat) return;

        const boat = state.boardingTargetBoat;
        const player = state.player;

        // Simplified boarding: lerp directly to boat position
        state.boardingProgress += dt * BOARDING_WALK_SPEED;
        const t = Math.min(state.boardingProgress, 1);
        const ease = t * (2 - t);

        player.pos.lerpVectors(state.boardingStartPos, boat.position, ease);

        if (pc.playerGroup) pc.playerGroup.position.copy(player.pos);

        if (t >= 1) {
            this.finishBoarding(context);
        }

        // Camera follows (3D space)
        const ca = player.cameraAngle;
        const camDist = 6.0;
        const camOffset = new THREE.Vector3(
            camDist * Math.sin(ca.x) * Math.cos(ca.y),
            camDist * Math.sin(ca.y) + 1.0,
            camDist * Math.cos(ca.x) * Math.cos(ca.y)
        );
        const desiredPos = player.pos.clone().add(camOffset);
        context.camera.position.lerp(desiredPos, 0.08);
        context.camera.lookAt(player.pos);
    }

    updateCatBoardingAnimation(dt, context) {
        const { state, playerCat: cat } = context;
        if (!cat || !state.catBoarding) return;
        const boat = state.boardingTargetBoat || state.activeBoat;
        if (!boat) return;

        state.catBoardingProgress = (state.catBoardingProgress || 0) + dt * BOARDING_WALK_SPEED;
        const t = Math.min(state.catBoardingProgress, 1);

        cat.position.lerpVectors(state.catBoardingStartPos || cat.position, boat.position, t);

        if (t >= 1) {
            state.catBoarding = false;
            state.catOnBoat = true;
        }
    }

    updateBoatPhysics(dt, context) {
        const { state, audio, factory, playerController: pc, playerCat, camera } = context;
        const boat = state.activeBoat;
        if (!boat) return;

        const defaults = {
            currentSpeed: state.boatSpeed || 0,
            maxSpeed: BOAT_BASE_MAX_SPEED,
            acceleration: BOAT_BASE_ACCELERATION,
            turnSpeed: BOAT_BASE_TURN_SPEED,
            brake: BOAT_BASE_BRAKE,
            drag: BOAT_BASE_DRAG,
            maxHealth: BOAT_BASE_HEALTH,
            health: BOAT_BASE_HEALTH
        };

        if (!boat.userData.stats) {
            boat.userData.stats = { ...defaults };
        } else {
            for (const key in defaults) {
                if (boat.userData.stats[key] === undefined) {
                    boat.userData.stats[key] = defaults[key];
                }
            }
        }
        const stats = boat.userData.stats;

        if (isNaN(stats.currentSpeed)) stats.currentSpeed = 0;
        if (isNaN(stats.maxSpeed) || stats.maxSpeed <= 0) stats.maxSpeed = BOAT_BASE_MAX_SPEED;

        state.boatSpeed = stats.currentSpeed;

        // 3D spaceship flight
        const speedRatio = Math.min(Math.abs(stats.currentSpeed) / stats.maxSpeed, 1);
        const turnRate = stats.turnSpeed * (0.3 + speedRatio * 0.7);

        if (state.inputs.a) state.boatRotation = (state.boatRotation || 0) + turnRate;
        if (state.inputs.d) state.boatRotation = (state.boatRotation || 0) - turnRate;

        if (state.inputs.w) {
            stats.currentSpeed = Math.min(stats.currentSpeed + stats.acceleration, stats.maxSpeed);
        } else if (state.inputs.s) {
            stats.currentSpeed = Math.max(stats.currentSpeed - stats.brake, -stats.maxSpeed * BOAT_REVERSE_FACTOR);
        } else {
            stats.currentSpeed *= stats.drag;
            if (Math.abs(stats.currentSpeed) < BOAT_MIN_SPEED) stats.currentSpeed = 0;
        }

        state.boatSpeed = stats.currentSpeed;

        // Update UI
        const speedVal = document.getElementById('boat-speed-val');
        const healthVal = document.getElementById('boat-health-val');
        if (speedVal) speedVal.textContent = (Math.abs(stats.currentSpeed) * 100).toFixed(1);
        if (healthVal) healthVal.textContent = Math.ceil(stats.health);

        // Move in 3D space
        const forward = new THREE.Vector3(-Math.sin(state.boatRotation || 0), 0, -Math.cos(state.boatRotation || 0));
        const newPos = boat.position.clone().add(forward.multiplyScalar(state.boatSpeed));

        // Planet collision
        let blocked = false;
        for (const planet of state.islands) {
            const dist = newPos.distanceTo(planet.center);
            const minDist = planet.radius + BOAT_COLLISION_RADIUS;
            if (dist < minDist) {
                const normal = newPos.clone().sub(planet.center).normalize();
                boat.position.copy(planet.center.clone().add(normal.multiplyScalar(minDist)));
                if (Math.abs(state.boatSpeed) > 0.02) audio.pop();
                state.boatSpeed *= -0.15;
                stats.currentSpeed = state.boatSpeed;
                blocked = true;
                break;
            }
        }

        if (!blocked) {
            boat.position.copy(newPos);
        }
        boat.rotation.y = state.boatRotation || 0;

        // Player on boat (in 3D space, offset upward from boat)
        const boatUp = new THREE.Vector3(0, 1, 0); // Boat uses world Y-up in space
        state.player.pos.copy(boat.position).add(boatUp.clone().multiplyScalar(0.6));

        if (pc.playerGroup) {
            pc.playerGroup.position.copy(boat.position);
            pc.playerGroup.position.add(boatUp.clone().multiplyScalar(BOAT_PLAYER_Y_OFFSET));
        }

        // Cat on boat
        if (playerCat && state.catOnBoat) {
            playerCat.position.copy(boat.position);
            playerCat.position.add(boatUp.clone().multiplyScalar(BOAT_DECK_Y_OFFSET));
        }

        // Camera (3D space)
        const ca = state.player.cameraAngle;
        ca.y = Math.max(0.1, Math.min(1.4, ca.y));
        const camDist = 8.0;
        const camOffset = new THREE.Vector3(
            camDist * Math.sin(ca.x) * Math.cos(ca.y),
            camDist * Math.sin(ca.y) + 1.5,
            camDist * Math.cos(ca.x) * Math.cos(ca.y)
        );
        const desiredPos = boat.position.clone().add(camOffset);

        if (!isNaN(desiredPos.x) && !isNaN(desiredPos.y) && !isNaN(desiredPos.z)) {
            camera.position.lerp(desiredPos, 0.08);
            camera.lookAt(boat.position);
        }

        // Thruster particles instead of wake
        if (Math.abs(state.boatSpeed) > 0.02 && Math.random() < 0.3) {
            const thrustPos = boat.position.clone().sub(forward.clone().multiplyScalar(2.5));
            factory.createParticle(thrustPos, new THREE.Color(0x4488ff), 0.7);
        }
    }

    updateProximity(context) {
        const { state } = context;
        if (state.isOnBoat) return;

        let nearBoat = null;
        let nearBoatDist = Infinity;
        state.entities.forEach(e => {
            if (e.userData.type === 'boat' || e.userData.type === 'spaceship') {
                const d = state.player.pos.distanceTo(e.position);
                if (d < BOAT_PROXIMITY_RANGE && d < nearBoatDist) {
                    nearBoat = e;
                    nearBoatDist = d;
                }
            }
        });

        if (nearBoat && !this.boatPromptVisible) {
            if (this.ui.boatPrompt) this.ui.boatPrompt.style.display = 'block';
            this.boatPromptVisible = true;
        } else if (!nearBoat && this.boatPromptVisible) {
            if (this.ui.boatPrompt) this.ui.boatPrompt.style.display = 'none';
            this.boatPromptVisible = false;
        }
        this._nearestBoat = nearBoat;
    }

    update(dt, context) {
        const { state } = context;

        if (state.isBoardingBoat) {
            this.updateBoardingAnimation(dt, context);
        }

        if (state.catBoardingQueued) {
            state.catBoardingDelay -= dt;
            if (state.catBoardingDelay <= 0) {
                state.catBoardingQueued = false;
                state.catBoarding = true;
                state.catBoardingPhase = 0;
                state.catBoardingProgress = 0;
            }
        }

        if (state.catBoarding) {
            this.updateCatBoardingAnimation(dt, context);
        }

        if (state.isOnBoat) {
            this.updateBoatPhysics(dt, context);
        }

        if (!state.isOnBoat && !state.isBoardingBoat) {
            this.updateProximity(context);
        }
    }
}
