// =====================================================
// SPACESHIP SYSTEM - Arcade 3D flight with quaternion orientation
// Controls: W/S thrust, A/D yaw, Arrow Up/Down (or R/F) pitch
// Inertial dampeners: velocity follows the nose, no free-drift.
// Auto-leveled roll for a stable horizon. One consistent flight feel.
// Chase camera + cockpit view toggle
// =====================================================

import {
    SHIP_MAX_SPEED, SHIP_ACCELERATION, SHIP_BRAKE, SHIP_TURN_SPEED,
    SHIP_DRAG, SHIP_HEALTH,
    SHIP_REVERSE_FACTOR, SHIP_MIN_SPEED, SHIP_COLLISION_RADIUS, SHIP_PROXIMITY_RANGE,
    SHIP_DECK_Y_OFFSET, SHIP_PLAYER_Y_OFFSET,
    SHIP_PITCH_SPEED, SHIP_YAW_SPEED,
    SHIP_AUTO_LEVEL_SPEED,
    SHIP_GRAVITY_STRENGTH, SHIP_GRAVITY_RANGE,
    SHIP_TAKEOFF_SPEED, SHIP_TAKEOFF_ALTITUDE, SHIP_GROUND_REST_ALTITUDE,
    SHIP_COLLISION_DAMAGE_THRESHOLD, SHIP_COLLISION_DAMAGE_AT_FULL_SPEED,
    SHIP_DAMAGE_SPEED_HP_THRESHOLD, SHIP_DAMAGED_MIN_SPEED_MULT,
    SHIP_REPAIR_GOLD_COST, SHIP_REPAIR_HEAL_AMOUNT,
    BOARDING_WALK_SPEED, CAT_BOARDING_DELAY,
    CAMERA_DISTANCE_BOAT, CAMERA_FOV, SHIP_FOV_KICK, FOV_KICK_LERP,
    SHIP_BANK_MAX, SHIP_BANK_LERP
} from '../constants.js';
import SphericalUtils from '../classes/SphericalUtils.js';
import { smoothFactor } from '../classes/Easing.js';

// Reusable temp vectors to reduce GC pressure
const _tmpVec = new THREE.Vector3();
const _tmpVec2 = new THREE.Vector3();
const _tmpVec3 = new THREE.Vector3();
const _tmpVec4 = new THREE.Vector3();
const _tmpGravity = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();
const _tmpQuat2 = new THREE.Quaternion();
const _tmpBankAxis = new THREE.Vector3(0, 0, 1); // ship-local forward/roll axis, never mutated
const _tmpBankQuat = new THREE.Quaternion();

export default class BoatSystem {
    constructor(ui) {
        this.ui = ui;
        this.boatPromptVisible = false;
        this._nearestBoat = null;
    }

    get nearestBoat() { return this._nearestBoat; }

    // ===========================================
    // BOARDING / DISEMBARKING
    // ===========================================

    boardBoat(boat, context) {
        const { state, audio, playerCat, playerController } = context;
        state.isBoardingBoat = true;
        state.boardingPhase = 0;
        state.boardingProgress = 0;
        state.boardingStartPos = state.player.pos.clone();
        state.boardingTargetBoat = boat;
        state.player.vel.set(0, 0, 0);
        if (this.ui.boatPrompt) this.ui.boatPrompt.style.display = 'none';
        this.boatPromptVisible = false;
        const repairHint = document.getElementById('repair-hint');
        if (repairHint) repairHint.style.display = 'none';
        // Ship views (boarding walk-up, chase cam while flying) always show the full
        // body regardless of the player's on-foot first/third preference — the on-foot
        // updateCamera() that normally hides body parts for first person doesn't run
        // again until isOnBoat/isBoardingBoat both clear on disembark, so without this
        // a player who boards while in first person would stay bodiless throughout.
        const crosshair = document.getElementById('crosshair');
        if (crosshair) crosshair.style.display = 'none';
        if (playerController) playerController.setBodyVisible(true);
        // InventoryManager.update() (which ticks the craft hint's timer) early-returns
        // while isOnBoat/isBoardingBoat, so a visible hint would otherwise freeze on
        // screen for the whole flight instead of auto-hiding. Its timer resumes and
        // finishes normally once back on foot, so hiding it here is enough.
        const craftHint = document.getElementById('craft-hint');
        if (craftHint) craftHint.style.display = 'none';
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

        // Initialize 3D state from current ship mesh orientation
        state.shipQuaternion.copy(boat.quaternion);
        state.shipVelocity.set(0, 0, 0);
        // Root-cause fix: updateBoatPhysics only runs while isOnBoat, so drag never
        // gets a chance to settle stats.currentSpeed to 0 while the ship sits parked.
        // A ship that was disembarked mid-taxi (or right after a landing bounce, which
        // recoils currentSpeed via `*= -0.3`) keeps that stale nonzero speed frozen on
        // its userData indefinitely. The instant physics resumes here, that residual
        // speed is fed straight into shipVelocity again, so the "still" parked ship
        // suddenly lurches/slides for a moment — read by players as boarding jitter.
        // Zeroing it on every boarding guarantees the ship always resumes from a true
        // rest state, matching what the player just saw (a motionless, parked ship).
        if (boat.userData.stats) boat.userData.stats.currentSpeed = 0;
        state.shipCameraMode = 'chase';

        // The ship boards while resting on the surface — start grounded (taxi phase).
        // Cleared once it gains enough speed/altitude to lift off (airplane-style takeoff).
        const liftPlanet = SphericalUtils.findNearestPlanet(boat.position, state.islands);
        state.shipGrounded = !!(liftPlanet && liftPlanet.planet &&
            SphericalUtils.getAltitude(boat.position, liftPlanet.planet) < SHIP_COLLISION_RADIUS + SHIP_TAKEOFF_ALTITUDE);

        this.showBoatHUD(true);
        if (playerController.playerGroup) {
            playerController.playerGroup.visible = true;
            this.setSeatedPose(playerController);
        }
    }

    disembarkBoat(context) {
        const { state, audio, playerController, playerCat } = context;
        if (!state.activeBoat) return;
        const boatPos = state.activeBoat.position;

        // Find nearest planet
        const result = SphericalUtils.findNearestPlanet(boatPos, state.islands);
        if (result.planet && result.distance < result.planet.radius + 10) {
            const normal = SphericalUtils.getSurfaceNormal(boatPos, result.planet);
            const surfacePos = result.planet.center.clone().add(
                normal.multiplyScalar(result.planet.radius + 2)
            );
            state.player.pos.copy(surfacePos);
        } else {
            // Can't exit in deep space
            audio.pop();
            return;
        }

        state.isOnBoat = false;
        state.boatSpeed = 0;
        state.player.vel.set(0, 0, 0);
        state.shipVelocity.set(0, 0, 0);
        state.shipQuaternion.identity();
        state.shipCameraMode = 'chase';
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
                const tangent = SphericalUtils._getArbitraryTangent(catNormal);
                const catPos = result.planet.center.clone().add(
                    catNormal.clone().add(tangent.multiplyScalar(0.1))
                        .normalize().multiplyScalar(result.planet.radius + 0.3)
                );
                playerCat.position.copy(catPos);
                playerCat.userData.planet = result.planet;
            }
        }
    }

    // ===========================================
    // POSE
    // ===========================================

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

    // ===========================================
    // BOARDING ANIMATION
    // ===========================================

    updateBoardingAnimation(dt, context) {
        const { state, playerController: pc, camera } = context;
        if (!state.isBoardingBoat || !state.boardingTargetBoat) return;

        const boat = state.boardingTargetBoat;
        const player = state.player;

        // Linear lerp toward boat position
        state.boardingProgress += dt * BOARDING_WALK_SPEED;
        const t = Math.min(state.boardingProgress, 1);
        const ease = t * (2 - t); // ease-out

        player.pos.lerpVectors(state.boardingStartPos, boat.position, ease);
        if (pc.playerGroup) pc.playerGroup.position.copy(player.pos);

        if (t >= 1) {
            this.finishBoarding(context);
            // finishBoarding() just handed the camera off to updateBoatPhysics's
            // _updateCamera (ship chase cam). Returning here avoids also running the
            // on-foot boarding-camera lerp below in this same frame — two competing
            // camera.position.lerp() calls in one tick produced a one-frame snap
            // right at the boarding/flight handoff.
            return;
        }

        // Camera follows during boarding
        const ca = player.cameraAngle;
        const camDist = 6.0;
        const camOffset = new THREE.Vector3(
            camDist * Math.sin(ca.x) * Math.cos(ca.y),
            camDist * Math.sin(ca.y) + 1.0,
            camDist * Math.cos(ca.x) * Math.cos(ca.y)
        );
        const desiredPos = player.pos.clone().add(camOffset);
        camera.position.lerp(desiredPos, smoothFactor(0.08, dt));
        camera.lookAt(player.pos);
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

    // ===========================================
    // FLIGHT MODE DETECTION
    // ===========================================

    _updateNearestPlanet(state, boatPos) {
        const result = SphericalUtils.findNearestPlanet(boatPos, state.islands);
        state.shipNearestPlanet = (result && result.planet) ? result.planet : null;
    }

    // ===========================================
    // AUTO-LEVEL ROLL
    // ===========================================

    /**
     * Remove roll from orientation by slerping toward an upright quaternion.
     * In planet mode, "up" = surface normal.
     * In space mode, "up" = ship's current Y axis (no correction).
     * In transition, blend between them.
     *
     * NOT dt-corrected with smoothFactor(): this clamps the correction to a max
     * ANGLE per frame (`Math.min(angle, SHIP_AUTO_LEVEL_SPEED)`) — a turn-rate
     * limiter, not the `current += (target - current) * k` exponential-decay shape
     * smoothFactor() re-derives. Left as-is; a correct dt-scaling here would be a
     * linear one (`SHIP_AUTO_LEVEL_SPEED * dt * 60`), out of scope for this pass.
     */
    _autoLevelRoll(state) {
        const q = state.shipQuaternion;

        // Universal "up" — keeps a stable horizon everywhere (no mode switching)
        const desiredUp = _tmpVec3.set(0, 1, 0);

        const shipForward = _tmpVec.set(0, 0, -1).applyQuaternion(q).normalize();
        const shipUp = _tmpVec2.set(0, 1, 0).applyQuaternion(q).normalize();

        // Project desired up onto the plane perpendicular to ship forward
        const projUp = desiredUp
            .addScaledVector(shipForward, -desiredUp.dot(shipForward))
            .normalize();

        if (projUp.lengthSq() < 0.001) return; // nose pointing straight up/down — skip

        const dot = Math.max(-1, Math.min(1, shipUp.dot(projUp)));
        const angle = Math.acos(dot);
        if (angle < 0.001) return; // already level

        const sign = shipUp.clone().cross(projUp).dot(shipForward) > 0 ? 1 : -1;
        const correctionAngle = sign * Math.min(angle, SHIP_AUTO_LEVEL_SPEED);
        _tmpQuat.setFromAxisAngle(shipForward, correctionAngle);
        q.premultiply(_tmpQuat).normalize();
    }

    /**
     * Slerp the ship orientation toward "flush on the surface" while grounded:
     * Y-up aligns with the surface normal, heading (current forward) is preserved
     * by projecting it onto the tangent plane. Keeps the ship from pitching into
     * the ground or pointing nose-up during taxi.
     */
    _levelToSurface(state, boat, dt) {
        const planet = state.shipNearestPlanet;
        if (!planet) return;
        const q = state.shipQuaternion;

        const normal = _tmpVec.copy(boat.position).sub(planet.center).normalize();
        const forward = _tmpVec2.set(0, 0, -1).applyQuaternion(q).normalize();
        const target = SphericalUtils.getOrientationOnSurface(normal, forward);
        q.slerp(target, smoothFactor(SHIP_AUTO_LEVEL_SPEED, dt)).normalize();
    }

    // ===========================================
    // VISUAL BANKING (game feel only)
    // ===========================================

    /**
     * Roll the ship's hullPivot (see EntityFactory.createSpaceship) into turns while
     * flying, purely as a visual flourish — `boat.quaternion` and `state.shipQuaternion`
     * (physics/orientation, read by the cameras and collision math) are never touched.
     * Bank angle is cached on boat.userData._bankAngle so it eases smoothly both toward
     * and away from SHIP_BANK_MAX regardless of how long the turn/level lasts.
     */
    _updateBanking(state, boat, yawInput, dt) {
        const hullPivot = boat.userData.hullPivot;
        if (!hullPivot) return;

        const bankTarget = state.shipGrounded ? 0 : -yawInput * SHIP_BANK_MAX;
        const current = boat.userData._bankAngle || 0;
        const bankAngle = THREE.MathUtils.lerp(current, bankTarget, smoothFactor(SHIP_BANK_LERP, dt));
        boat.userData._bankAngle = bankAngle;
        hullPivot.rotation.z = bankAngle;
    }

    // ===========================================
    // DAMAGE / REPAIR
    // ===========================================

    /**
     * A3: below SHIP_DAMAGE_SPEED_HP_THRESHOLD, max speed degrades linearly down
     * to SHIP_DAMAGED_MIN_SPEED_MULT (60%) at 1 HP. Full speed above the threshold.
     */
    _getEffectiveMaxSpeed(stats) {
        if (stats.health >= SHIP_DAMAGE_SPEED_HP_THRESHOLD) return stats.maxSpeed;
        const t = Math.max(0, (stats.health - 1) / (SHIP_DAMAGE_SPEED_HP_THRESHOLD - 1));
        const speedMult = SHIP_DAMAGED_MIN_SPEED_MULT + (1 - SHIP_DAMAGED_MIN_SPEED_MULT) * t;
        return stats.maxSpeed * speedMult;
    }

    /**
     * Repair the nearest landed ship using 1 gold from inventory (client-local,
     * consistent with the rest of ship state — no network message). Returns true
     * if a repair happened so the caller can refresh the inventory UI/feedback.
     */
    repairShip(context) {
        const { state, audio, factory } = context;
        const boat = this._nearestBoat;
        if (!boat || !boat.userData.stats) return false;

        const stats = boat.userData.stats;
        const maxHealth = stats.maxHealth || SHIP_HEALTH;
        if (stats.health >= maxHealth) return false;

        const goldIdx = state.inventory.findIndex(it => it && it.type === 'gold');
        if (goldIdx === -1) return false;

        state.inventory[goldIdx].count -= SHIP_REPAIR_GOLD_COST;
        if (state.inventory[goldIdx].count <= 0) state.inventory[goldIdx] = null;

        stats.health = Math.min(maxHealth, stats.health + SHIP_REPAIR_HEAL_AMOUNT);
        audio.pickup();
        for (let i = 0; i < 10; i++) factory.createParticle(boat.position.clone(), new THREE.Color(0xffd700), 1.0);
        return true;
    }

    /**
     * Show "Press R to repair" while on foot near a damaged, landed ship the
     * player has gold for. Reuses the proximity detection from updateProximity.
     *
     * When the ship needs repair but the player has no gold, repurpose the same
     * hint element to point them at gold instead of showing a prompt they can't
     * act on. Gold ore only spawns on Ancient Peaks (constants.PLANETS[2]), but
     * planet names are never surfaced anywhere in the UI (no HUD/banner reads
     * PLANETS[].name or islands[].name) — a name the player has never seen would
     * be meaningless, so the hint describes the planet instead ("the giant
     * mountain planet", matching its mountain + golem landmark).
     */
    _updateRepairHint(state, boat) {
        const hint = document.getElementById('repair-hint');
        if (!hint) return;
        const stats = boat && boat.userData.stats;
        const isDamaged = !!(stats && stats.health < (stats.maxHealth || SHIP_HEALTH));
        if (!isDamaged) {
            hint.style.display = 'none';
            return;
        }
        const hasGold = state.inventory.some(it => it && it.type === 'gold' && it.count > 0);
        hint.textContent = hasGold
            ? 'Press R to repair ship (1 Gold = +25 HP)'
            : 'No gold — mine glowing ore on the giant mountain planet';
        hint.style.display = 'block';
    }

    // ===========================================
    // MAIN PHYSICS UPDATE
    // ===========================================

    updateBoatPhysics(dt, context) {
        const { state, audio, factory, playerController: pc, playerCat, camera } = context;
        const boat = state.activeBoat;
        if (!boat) return;

        // --- Ensure stats exist ---
        if (!boat.userData.stats) {
            boat.userData.stats = {
                currentSpeed: 0,
                maxSpeed: SHIP_MAX_SPEED,
                acceleration: SHIP_ACCELERATION,
                turnSpeed: SHIP_TURN_SPEED,
                brake: SHIP_BRAKE,
                drag: SHIP_DRAG,
                maxHealth: SHIP_HEALTH,
                health: SHIP_HEALTH
            };
        }
        const stats = boat.userData.stats;
        if (isNaN(stats.currentSpeed)) stats.currentSpeed = 0;
        if (isNaN(stats.maxSpeed) || stats.maxSpeed <= 0) stats.maxSpeed = SHIP_MAX_SPEED;

        // A3: damaged hulls fly slower — one clean modifier applied everywhere the
        // flight model reads max speed, instead of scattering health checks around.
        const effectiveMaxSpeed = this._getEffectiveMaxSpeed(stats);

        // --- Nearest planet (for auto-level reference + HUD altitude) ---
        this._updateNearestPlanet(state, boat.position);

        // --- Orientation: yaw + pitch via quaternion ---
        const q = state.shipQuaternion;

        // Yaw (A/D) — rotate around ship's local Y-axis at a constant rate
        const yawInput = state.inputs.a ? 1 : state.inputs.d ? -1 : 0;
        if (yawInput !== 0) {
            const yawDelta = yawInput * SHIP_YAW_SPEED;
            const shipUp = _tmpVec.set(0, 1, 0).applyQuaternion(q).normalize();
            _tmpQuat.setFromAxisAngle(shipUp, yawDelta);
            q.premultiply(_tmpQuat).normalize();
        }

        // Visual-only banking (game feel): roll the hull pivot into turns while
        // flying. This never touches `q` (physics/orientation, read directly by the
        // chase/cockpit cameras) or `boat.quaternion` (set from `q` below) — only the
        // hullPivot child's local rotation.z, eased both in and out.
        this._updateBanking(state, boat, yawInput, dt);

        // Pitch (Arrow Up/Down or R/F) — nose up / nose down
        const pitchInput = state.inputs.pitchUp ? 1 : state.inputs.pitchDown ? -1 : 0;

        if (pitchInput !== 0) {
            const shipRight = _tmpVec.set(1, 0, 0).applyQuaternion(q).normalize();
            _tmpQuat.setFromAxisAngle(shipRight, pitchInput * SHIP_PITCH_SPEED);
            q.premultiply(_tmpQuat).normalize();
        }

        // Leveling: while grounded keep the ship flush to the surface (Y-up = surface
        // normal, heading preserved); in free flight just keep a stable world horizon.
        if (state.shipGrounded && state.shipNearestPlanet) {
            this._levelToSurface(state, boat, dt);
        } else {
            // Not converted: _autoLevelRoll caps the correction by a max ANGLE per
            // frame (a turn-rate limiter), not an exponential decay toward a target —
            // smoothFactor() only re-derives exponential lerp/slerp factors, so it
            // doesn't apply to this pattern. See _autoLevelRoll for detail.
            this._autoLevelRoll(state);
        }

        // --- Thrust: W = forward accel, S = brake/reverse ---
        const shipForward = _tmpVec.set(0, 0, -1).applyQuaternion(q).normalize();

        if (state.inputs.w) {
            stats.currentSpeed = Math.min(
                stats.currentSpeed + stats.acceleration,
                effectiveMaxSpeed
            );
        } else if (state.inputs.s) {
            stats.currentSpeed = Math.max(
                stats.currentSpeed - stats.brake,
                -effectiveMaxSpeed * SHIP_REVERSE_FACTOR
            );
        } else {
            stats.currentSpeed *= stats.drag;
            if (Math.abs(stats.currentSpeed) < SHIP_MIN_SPEED) stats.currentSpeed = 0;
        }

        // Arcade dampeners: thrust velocity always follows the nose...
        state.shipVelocity.copy(shipForward).multiplyScalar(stats.currentSpeed);

        // --- Gravity + takeoff state machine (toward nearest planet) ---
        const planet = state.shipNearestPlanet;
        if (planet) {
            const restAltitude = SHIP_COLLISION_RADIUS;          // belly-rest altitude above surface
            const altitude = SphericalUtils.getAltitude(boat.position, planet);
            // Outward surface normal at the ship's current position
            const upNormal = _tmpVec2.copy(boat.position).sub(planet.center).normalize();

            // Takeoff / grounding decision (airplane-style):
            //  - Grounded -> free flight when forward speed exceeds takeoff threshold AND
            //    the pilot is pitching up, OR the ship is already well above the surface.
            //  - Free -> re-ground when it sinks back to contact altitude at low speed.
            if (state.shipGrounded) {
                const pitchingUp = state.inputs.pitchUp;
                const fastEnough = stats.currentSpeed > SHIP_TAKEOFF_SPEED;
                if ((fastEnough && pitchingUp) || altitude > restAltitude + SHIP_TAKEOFF_ALTITUDE) {
                    state.shipGrounded = false;
                }
            } else if (altitude < restAltitude + SHIP_GROUND_REST_ALTITUDE &&
                       stats.currentSpeed < SHIP_TAKEOFF_SPEED) {
                state.shipGrounded = true;
            }

            if (state.shipGrounded) {
                // TAXI: constrain motion to the surface tangent plane (no climbing).
                // Remove any along-normal component of the thrust velocity so the ship
                // slides flush across the surface instead of digging in or lifting off.
                const along = state.shipVelocity.dot(upNormal);
                state.shipVelocity.addScaledVector(upNormal, -along);
                // No gravity term while grounded — the surface holds the ship; this keeps
                // it perfectly stable at rest (no fight with the collision push-out).
            } else {
                // FREE FLIGHT: apply gravity toward the planet within range.
                const dist = boat.position.distanceTo(planet.center);
                if (dist < planet.radius * SHIP_GRAVITY_RANGE) {
                    // Inverse-square-ish falloff, normalized to full strength at the surface.
                    const ratio = planet.radius / Math.max(dist, planet.radius);
                    const g = SHIP_GRAVITY_STRENGTH * ratio * ratio;
                    // Pull toward planet center (-upNormal).
                    _tmpGravity.copy(upNormal).multiplyScalar(-g);
                    state.shipVelocity.add(_tmpGravity);
                }
            }
        }

        state.boatSpeed = stats.currentSpeed;

        // --- Position update ---
        const newPos = _tmpVec3.copy(boat.position).add(state.shipVelocity);

        // While grounded, re-snap to belly-rest altitude. Taxiing along a tangent on a
        // curved planet would otherwise slowly drift the ship outward; this pins it to
        // the surface so it rests/taxis flush with zero jitter against the collision loop.
        if (state.shipGrounded && planet) {
            const restNormal = _tmpVec4.copy(newPos).sub(planet.center).normalize();
            newPos.copy(planet.center).addScaledVector(restNormal, planet.radius + SHIP_COLLISION_RADIUS);
        }

        // Planet collision — push out and bleed off speed (gentle recoil)
        let blocked = false;
        for (const p of state.islands) {
            const dist = newPos.distanceTo(p.center);
            const minDist = p.radius + SHIP_COLLISION_RADIUS;
            if (dist < minDist) {
                const normal = _tmpVec4.copy(newPos).sub(p.center).normalize();
                boat.position.copy(p.center).addScaledVector(normal, minDist);
                // Only recoil/sfx/damage for a genuine impact, not a resting taxi contact.
                if (!state.shipGrounded && Math.abs(stats.currentSpeed) > 0.02) {
                    audio.pop();
                    // A3: impacts above SHIP_COLLISION_DAMAGE_THRESHOLD of max speed
                    // damage the hull, scaled so a full-speed head-on hit costs
                    // ~SHIP_COLLISION_DAMAGE_AT_FULL_SPEED HP. The ship is never destroyed.
                    const impactSpeed = Math.abs(stats.currentSpeed);
                    if (impactSpeed > stats.maxSpeed * SHIP_COLLISION_DAMAGE_THRESHOLD) {
                        const dmg = (impactSpeed / stats.maxSpeed) * SHIP_COLLISION_DAMAGE_AT_FULL_SPEED;
                        stats.health = Math.max(1, stats.health - dmg);
                    }
                    stats.currentSpeed *= -0.3; // small bounce back
                }
                state.shipVelocity.set(0, 0, 0);
                state.boatSpeed = stats.currentSpeed;
                blocked = true;
                break;
            }
        }

        if (!blocked) {
            boat.position.copy(newPos);
        }

        // Apply quaternion to mesh
        boat.quaternion.copy(q);

        // --- HUD ---
        const speedVal = document.getElementById('boat-speed-val');
        const healthVal = document.getElementById('boat-health-val');
        const altEl = document.getElementById('ship-altitude');
        if (speedVal) speedVal.textContent = (Math.abs(stats.currentSpeed) * 100).toFixed(1);
        if (healthVal) healthVal.textContent = Math.ceil(stats.health);
        if (altEl && state.shipNearestPlanet) {
            const alt = SphericalUtils.getAltitude(boat.position, state.shipNearestPlanet);
            altEl.textContent = alt.toFixed(1);
        }

        // --- Player on ship (local-space offset) ---
        this._positionPlayerOnShip(state, pc, boat);

        // --- Cat on ship ---
        if (playerCat && state.catOnBoat) {
            const catLocal = new THREE.Vector3(0.3, SHIP_DECK_Y_OFFSET + 0.3, 0.5);
            catLocal.applyQuaternion(q);
            playerCat.position.copy(boat.position).add(catLocal);
            playerCat.quaternion.copy(q);
        }

        // --- Camera ---
        this._updateCamera(state, boat, camera, pc, dt);

        // --- Thruster particles ---
        this._emitThrusterParticles(state, boat, factory, q);
    }

    // ===========================================
    // PLAYER POSITIONING ON SHIP
    // ===========================================

    _positionPlayerOnShip(state, pc, boat) {
        const q = state.shipQuaternion;

        // Player position: ship local (0, offset, 0) → world
        const playerLocal = _tmpVec.set(0, SHIP_PLAYER_Y_OFFSET + 0.5, 0);
        playerLocal.applyQuaternion(q);
        state.player.pos.copy(boat.position).add(playerLocal);

        if (pc.playerGroup) {
            pc.playerGroup.position.copy(state.player.pos);
            // Orient player group to match ship orientation. The player isn't parented
            // to the ship's mesh hierarchy (it's a separate world-space object), so the
            // hullPivot's visual bank roll (see _updateBanking) is composed in here too
            // — a seated player should lean with the hull they're strapped to, not sit
            // rigidly level while the ship rolls under them.
            const bankAngle = boat.userData._bankAngle || 0;
            _tmpBankQuat.setFromAxisAngle(_tmpBankAxis, bankAngle);
            pc.playerGroup.quaternion.copy(q).multiply(_tmpBankQuat);
        }
    }

    // ===========================================
    // CAMERA (CHASE + COCKPIT)
    // ===========================================

    _updateCamera(state, boat, camera, pc, dt) {
        const q = state.shipQuaternion;
        const ca = state.player.cameraAngle;

        // FOV speed kick — applies to both chase and cockpit views below, scaled by
        // current throttle against the (possibly damage-degraded) effective max speed.
        const stats = boat.userData.stats;
        if (stats) {
            const effMax = this._getEffectiveMaxSpeed(stats);
            const speedRatio = effMax > 0 ? Math.min(1, Math.abs(stats.currentSpeed) / effMax) : 0;
            const targetFov = CAMERA_FOV + SHIP_FOV_KICK * speedRatio;
            const newFov = THREE.MathUtils.lerp(camera.fov, targetFov, smoothFactor(FOV_KICK_LERP, dt));
            if (Math.abs(newFov - camera.fov) > 0.01) {
                camera.fov = newFov;
                camera.updateProjectionMatrix();
            }
        }

        if (state.shipCameraMode === 'cockpit') {
            // --- COCKPIT VIEW ---
            // Position inside cockpit dome (local 0, 0.5, -0.8)
            const cockpitLocal = new THREE.Vector3(0, 0.5, -0.8);
            cockpitLocal.applyQuaternion(q);
            const cockpitPos = boat.position.clone().add(cockpitLocal);

            // Look forward along ship direction
            const shipForward = _tmpVec.set(0, 0, -1).applyQuaternion(q).normalize();
            const lookTarget = cockpitPos.clone().addScaledVector(shipForward, 10);

            camera.position.lerp(cockpitPos, smoothFactor(0.15, dt));
            camera.lookAt(lookTarget);

            // Hide player model in cockpit
            if (pc.playerGroup) pc.playerGroup.visible = false;
        } else {
            // --- CHASE CAM ---
            if (pc.playerGroup) pc.playerGroup.visible = true;

            // Ship's back direction and up
            const shipBack = _tmpVec.set(0, 0, 1).applyQuaternion(q).normalize();
            const shipUp = _tmpVec2.set(0, 1, 0).applyQuaternion(q).normalize();

            const camDist = CAMERA_DISTANCE_BOAT || 8.0;

            // Mouse orbit offset
            const orbitH = ca.x;
            const orbitV = Math.max(0.1, Math.min(1.4, ca.y));
            ca.y = orbitV;

            // Orbit: rotate the "back" direction by horizontal angle around ship up
            const orbBack = shipBack.clone();
            _tmpQuat2.setFromAxisAngle(shipUp, orbitH);
            orbBack.applyQuaternion(_tmpQuat2);

            // Add vertical elevation
            const desiredPos = boat.position.clone()
                .addScaledVector(orbBack, camDist * Math.cos(orbitV))
                .addScaledVector(shipUp, camDist * Math.sin(orbitV) + 1.5);

            if (!isNaN(desiredPos.x) && !isNaN(desiredPos.y) && !isNaN(desiredPos.z)) {
                camera.position.lerp(desiredPos, smoothFactor(0.08, dt));
                camera.lookAt(boat.position);
            }
        }
    }

    // ===========================================
    // THRUSTER PARTICLES
    // ===========================================

    _emitThrusterParticles(state, boat, factory, q) {
        if (Math.abs(state.boatSpeed) < 0.02) return;

        // Emit rate scales with speed
        const emitChance = Math.min(0.6, 0.2 + Math.abs(state.boatSpeed) * 2);
        if (Math.random() > emitChance) return;

        // Engine nozzle positions (local space): ±0.5 X, z = 2.35
        const side = Math.random() > 0.5 ? 0.5 : -0.5;
        const nozzleLocal = new THREE.Vector3(side, 0, 2.35);
        nozzleLocal.applyQuaternion(q);
        const thrustPos = boat.position.clone().add(nozzleLocal);

        // Color: blue at cruise, brighter near max speed
        const speedRatio = Math.abs(state.boatSpeed) / SHIP_MAX_SPEED;
        const r = 0.27 + speedRatio * 0.73;
        const g = 0.53 + speedRatio * 0.47;
        const b = 1.0;
        const color = new THREE.Color(r, g, b);

        factory.createParticle(thrustPos, color, 0.7);
    }

    // ===========================================
    // PROXIMITY DETECTION (when walking)
    // ===========================================

    updateProximity(context) {
        const { state } = context;
        if (state.isOnBoat) return;

        let nearBoat = null;
        let nearBoatDist = Infinity;
        state.entities.forEach(e => {
            if (e.userData.type === 'boat' || e.userData.type === 'spaceship') {
                const d = state.player.pos.distanceTo(e.position);
                if (d < SHIP_PROXIMITY_RANGE && d < nearBoatDist) {
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
        this._updateRepairHint(state, nearBoat);
    }

    // ===========================================
    // MAIN UPDATE
    // ===========================================

    update(dt, context) {
        const { state } = context;

        if (state.isBoardingBoat) {
            this.updateBoardingAnimation(dt, context);
        }

        // Cat boarding delay
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
