// =====================================================
// PLAYER CONTROLLER - Spherical Planet Movement + Camera
// =====================================================

import {
    CAMERA_MIN_Y, CAMERA_MAX_Y, CAMERA_DISTANCE, CAMERA_LERP,
    GRAVITY, JUMP_FORCE, PLAYER_RADIUS, PLAYER_SURFACE_HEIGHT,
    GRAVITY_REFERENCE_RADIUS, MAX_FALL_SPEED, ON_GROUND_THRESHOLD,
    FRICTION_GROUND, FRICTION_STUN, ATTACK_SWING_DURATION
} from '../constants.js';
import SphericalUtils from './SphericalUtils.js';

// --- Animation helper ---
function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

// --- Held-tool grip (Minecraft-like) ---
// Axe/pickaxe handle geometry (EntityFactory.createAxe/createPickaxe) is a cylinder of
// height 0.5 centered on the group origin, running along local +Y, with the head/blade
// at the +Y tip. HELD_TOOL_TILT rotates that local Y axis toward local +Z (forward) by
// this many radians so the head sits up-and-forward from the grip; the same rotation
// carries local +Z (the axe blade's face) to (0, -sin, cos) — forward and angled slightly
// down, edge-first — because a rotation preserves the 90 deg between the two axes.
const HELD_TOOL_TILT = Math.PI / 5; // 36 deg forward from vertical (within the 30-45 deg range)
const HELD_TOOL_HALF_HANDLE = 0.25; // half of the 0.5-long handle cylinder

export default class PlayerController {
    constructor(world, state) {
        this.world = world;
        this.state = state;
        this.playerGroup = null;
        this.modelPivot = null;
        this.legL = null;
        this.legR = null;
        this.armL = null;
        this.armR = null;
        this.time = 0;
        this.chopAnimState = null;
        this._lookTarget = null; // C8: smoothed camera look target

        // Spherical world state
        this._surfaceNormal = new THREE.Vector3(0, 1, 0); // Current "up" direction
        this._surfaceForward = new THREE.Vector3(0, 0, 1); // Current tangent forward
        this._surfaceRight = new THREE.Vector3(1, 0, 0); // Current tangent right
        this._currentPlanet = null;
    }

    createModel(palette) {
        this.playerGroup = new THREE.Group();
        this.modelPivot = new THREE.Group();
        this.modelPivot.scale.setScalar(0.6);
        this.playerGroup.add(this.modelPivot);

        const matBody = this.world.getMat(palette.creature);
        const matLimb = this.world.getMat(palette.flora);
        const matEye = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const matPupil = new THREE.MeshBasicMaterial({ color: 0x000000 });

        const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.3), matBody);
        torso.position.y = 0.7;
        this.modelPivot.add(torso);

        const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, 0.4), matLimb);
        head.position.y = 1.2;
        this.modelPivot.add(head);

        const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.05), matEye);
        eyeL.position.set(0.12, 1.2, 0.2);
        const eyeR = eyeL.clone();
        eyeR.position.set(-0.12, 1.2, 0.2);
        const pupilGeo = new THREE.BoxGeometry(0.04, 0.04, 0.06);
        const pupilL = new THREE.Mesh(pupilGeo, matPupil);
        pupilL.position.z = 0.01;
        const pupilR = pupilL.clone();
        eyeL.add(pupilL);
        eyeR.add(pupilR);
        this.modelPivot.add(eyeL, eyeR);

        const legGeo = new THREE.BoxGeometry(0.15, 0.4, 0.15);
        legGeo.translate(0, -0.2, 0);
        this.legL = new THREE.Mesh(legGeo, matLimb);
        this.legL.position.set(0.15, 0.4, 0);
        this.legR = new THREE.Mesh(legGeo, matLimb);
        this.legR.position.set(-0.15, 0.4, 0);
        this.modelPivot.add(this.legL, this.legR);

        const armGeo = new THREE.BoxGeometry(0.12, 0.4, 0.12);
        armGeo.translate(0, -0.2, 0);
        this.armL = new THREE.Mesh(armGeo, matLimb);
        this.armL.position.set(0.35, 0.9, 0);
        this.armR = new THREE.Mesh(armGeo, matLimb);
        this.armR.position.set(-0.35, 0.9, 0);
        this.modelPivot.add(this.armL, this.armR);

        this.handAnchorL = new THREE.Group();
        this.handAnchorL.position.set(0, -0.4, 0);
        this.armL.add(this.handAnchorL);

        this.handAnchorR = new THREE.Group();
        this.handAnchorR.position.set(0, -0.4, 0);
        this.armR.add(this.handAnchorR);

        this.heldItem = null;
        this.world.add(this.playerGroup);
    }

    holdItem(item) {
        if (this.heldItem) {
            this.handAnchorR.remove(this.heldItem);
        }
        this.heldItem = item;
        if (item) {
            const isHandledTool = item.userData && (item.userData.type === 'axe' || item.userData.type === 'pickaxe');
            if (isHandledTool) {
                // Minecraft-like grip: gripped near the handle's LOWER end, head/blade at
                // the top, handle tilted forward from vertical, blade facing the player's
                // forward direction. A single rotation about the anchor's local X axis
                // does this (see HELD_TOOL_TILT comment above) — no yaw/roll needed since
                // the hand anchor's own axes already match the character's facing.
                item.rotation.set(HELD_TOOL_TILT, 0, 0);
                // Move the grip point (local -Y tip of the handle, scaled to match the
                // tool's held-size scale-up in InputHandler) to the anchor's origin, so
                // the hand holds the BASE of the handle instead of its midpoint.
                const halfHandle = HELD_TOOL_HALF_HANDLE * (item.scale.y || 1);
                item.position.set(
                    0,
                    halfHandle * Math.cos(HELD_TOOL_TILT),
                    halfHandle * Math.sin(HELD_TOOL_TILT)
                );
            } else {
                item.rotation.set(0, 0, 0);
                item.position.set(0, 0, 0);
            }
            this.handAnchorR.add(item);
        }
    }

    /**
     * Compute surface frame (normal, forward, right) for the nearest planet.
     */
    _updateSurfaceFrame(planets) {
        const player = this.state.player;
        const result = SphericalUtils.findNearestPlanet(player.pos, planets);
        if (!result) return;

        this._currentPlanet = result.planet;
        this._surfaceNormal = SphericalUtils.getSurfaceNormal(player.pos, result.planet);

        // Maintain a consistent forward by projecting the old forward onto the new tangent plane
        let fwd = this._surfaceForward.clone();
        fwd.sub(this._surfaceNormal.clone().multiplyScalar(fwd.dot(this._surfaceNormal)));
        if (fwd.lengthSq() < 0.0001) {
            fwd = SphericalUtils._getArbitraryTangent(this._surfaceNormal);
        } else {
            fwd.normalize();
        }
        this._surfaceForward = fwd;
        this._surfaceRight = new THREE.Vector3().crossVectors(this._surfaceNormal, this._surfaceForward).normalize();
        // Re-orthogonalize
        this._surfaceForward = new THREE.Vector3().crossVectors(this._surfaceRight, this._surfaceNormal).normalize();
    }

    update(dt, islands) {
        if (!this.playerGroup) return;
        if (this.state.isDead) return;
        const state = this.state;
        const player = state.player;
        this.time += dt;

        // Update surface frame based on nearest planet
        this._updateSurfaceFrame(islands);

        if (!this._currentPlanet) return;
        const planet = this._currentPlanet;
        const up = this._surfaceNormal;
        const altitude = SphericalUtils.getAltitude(player.pos, planet);

        // --- Camera-relative movement on the sphere surface ---
        const camera = this.world.camera;
        const ca = player.cameraAngle;

        // Compute camera forward/right projected onto the tangent plane
        const camWorldFwd = new THREE.Vector3();
        camera.getWorldDirection(camWorldFwd);
        // Project onto tangent plane
        let camFwd = camWorldFwd.clone().sub(up.clone().multiplyScalar(camWorldFwd.dot(up)));
        if (camFwd.lengthSq() < 0.001) {
            camFwd = this._surfaceForward.clone();
        } else {
            camFwd.normalize();
        }
        const camRight = new THREE.Vector3().crossVectors(up, camFwd).negate().normalize();

        // Build movement direction on tangent plane
        const moveDir = new THREE.Vector3(0, 0, 0);
        let isMoving = false;

        if (player.stunTimer > 0) {
            player.stunTimer -= dt;
            // Apply friction to velocity (in world space, tangential component)
            const velTangent = player.vel.clone().sub(up.clone().multiplyScalar(player.vel.dot(up)));
            velTangent.multiplyScalar(FRICTION_STUN);
            const velNormal = up.clone().multiplyScalar(player.vel.dot(up));
            player.vel.copy(velTangent.add(velNormal));
        } else {
            if (state.inputs.w) moveDir.add(camFwd);
            if (state.inputs.s) moveDir.sub(camFwd);
            if (state.inputs.a) moveDir.sub(camRight);
            if (state.inputs.d) moveDir.add(camRight);

            if (moveDir.lengthSq() > 0.01) {
                isMoving = true;
                moveDir.normalize();

                const effectiveSpeed = player.speed + (player.speedBoost || 0);
                // Set tangential velocity, preserve radial component
                const velNormalComp = up.clone().multiplyScalar(player.vel.dot(up));
                player.vel.copy(moveDir.multiplyScalar(effectiveSpeed).add(velNormalComp));

                // Compute target rotation relative to surface frame
                const localX = moveDir.dot(this._surfaceRight);
                const localZ = moveDir.dot(this._surfaceForward);
                const targetAngle = Math.atan2(localX, localZ);

                let angleDiff = targetAngle - player.targetRotation;
                while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                player.targetRotation += angleDiff * 0.2;
            } else {
                // Apply friction to tangential velocity
                const velNormal = up.clone().multiplyScalar(player.vel.dot(up));
                const velTangent = player.vel.clone().sub(velNormal);
                velTangent.multiplyScalar(FRICTION_GROUND);
                player.vel.copy(velTangent.add(velNormal));
            }
        }

        // Gravity: scale by planet radius (larger planet = stronger gravity)
        const gravityStrength = GRAVITY * (planet.radius / GRAVITY_REFERENCE_RADIUS);
        const gravityAccel = up.clone().multiplyScalar(-gravityStrength);
        player.vel.add(gravityAccel);

        // Terminal velocity cap (prevent infinite fall speed)
        const radialSpeed = player.vel.dot(up);
        if (radialSpeed < -MAX_FALL_SPEED) {
            player.vel.sub(up.clone().multiplyScalar(radialSpeed + MAX_FALL_SPEED));
        }

        // Apply velocity
        const nextPos = player.pos.clone().add(player.vel);

        // Ground collision: check distance from planet center
        const distFromCenter = nextPos.distanceTo(planet.center);
        const surfaceDist = distFromCenter - planet.radius;

        let onAnyIsland = false;

        // Check if within planet's gravity well (radius * 2)
        if (distFromCenter < planet.radius * 2) {
            // Ground collision
            if (surfaceDist < PLAYER_SURFACE_HEIGHT) {
                // Snap to surface
                const normal = nextPos.clone().sub(planet.center).normalize();
                nextPos.copy(planet.center).add(normal.multiplyScalar(planet.radius + PLAYER_SURFACE_HEIGHT));
                // Zero out velocity component toward planet center
                const velDotUp = player.vel.dot(up);
                if (velDotUp < 0) {
                    player.vel.sub(up.clone().multiplyScalar(velDotUp));
                }
                player.onGround = true;
                onAnyIsland = true;
            }
        }

        // Fallback: if too far from any planet, respawn on nearest planet
        if (!onAnyIsland && surfaceDist > 100) {
            const nearest = SphericalUtils.findNearestPlanet(nextPos, islands);
            const spawn = nearest ? nearest.planet : islands[0];
            const spawnNormal = nextPos.clone().sub(spawn.center).normalize();
            if (spawnNormal.lengthSq() < 0.001) spawnNormal.set(0, 1, 0);
            nextPos.copy(spawn.center).add(spawnNormal.multiplyScalar(spawn.radius + 3));
            player.vel.set(0, 0, 0);
            onAnyIsland = true;
        }

        player.pos.copy(nextPos);

        // --- Obstacle Collision ---
        let groundHeightOverride = null;

        for (const obs of state.obstacles) {
            if (obs.userData.isMountain) {
                const dist3D = player.pos.distanceTo(obs.position);
                const maxR = obs.userData.mountRadius;
                if (dist3D < maxR) {
                    const surfNorm = SphericalUtils.getSurfaceNormal(obs.position, planet);
                    const obsSurfacePos = planet.center.clone().add(surfNorm.clone().multiplyScalar(planet.radius));
                    // Distance along surface approximation
                    const arcDist = player.pos.distanceTo(obsSurfacePos);
                    if (arcDist < maxR) {
                        const h = obs.userData.mountHeight * (1 - arcDist / maxR);
                        const climbAlt = planet.radius + h;
                        const currentAlt = player.pos.distanceTo(planet.center);
                        if (currentAlt < climbAlt + 1.0) {
                            groundHeightOverride = climbAlt;
                        }
                    }
                }
                continue;
            }

            if (!obs.userData.radius) continue;
            const dist = player.pos.distanceTo(obs.position);
            const minDist = PLAYER_RADIUS + obs.userData.radius;
            if (dist < minDist && dist > 0.001) {
                const pushDir = player.pos.clone().sub(obs.position).normalize();
                const overlap = minDist - dist;
                player.pos.add(pushDir.multiplyScalar(overlap));
            }
        }

        // Apply mountain height override
        if (groundHeightOverride !== null) {
            const currentDist = player.pos.distanceTo(planet.center);
            if (currentDist < groundHeightOverride + 0.5) {
                const normal = player.pos.clone().sub(planet.center).normalize();
                player.pos.copy(planet.center).add(normal.multiplyScalar(groundHeightOverride));
                // Zero radial velocity
                const velDotUp2 = player.vel.dot(normal);
                if (velDotUp2 < 0) {
                    player.vel.sub(normal.clone().multiplyScalar(velDotUp2));
                }
                player.onGround = true;
                this.playerGroup.position.copy(player.pos);
            }
        }

        // Jump - along surface normal
        if (player.onGround && state.inputs.space) {
            player.vel.add(up.clone().multiplyScalar(JUMP_FORCE));
            player.onGround = false;
        }

        // Only lose onGround when actually falling with meaningful downward speed
        if (player.onGround && player.vel.dot(up) < -ON_GROUND_THRESHOLD) {
            player.onGround = false;
        }

        // --- Update mesh position ---
        this.playerGroup.position.copy(player.pos);

        // --- Orient player group: align Y-up with surface normal only ---
        // Use a stable surface frame reference (NOT targetRotation) to avoid double rotation
        const surfNormal = SphericalUtils.getSurfaceNormal(player.pos, planet);
        const orientQ = SphericalUtils.getOrientationOnSurface(surfNormal, this._surfaceForward);
        this.playerGroup.quaternion.slerp(orientQ, 0.15);

        // --- Model pivot rotation: facing direction within the playerGroup's local frame ---
        // targetRotation is the angle relative to _surfaceForward, which matches
        // the playerGroup's local Z axis, so a local Y rotation by targetRotation is correct.
        const targetQ = new THREE.Quaternion();
        targetQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), player.targetRotation);
        this.modelPivot.quaternion.slerp(targetQ, isMoving ? 0.2 : 0.1);

        // --- Invincibility flash ---
        if (state.invincibleTimer > 0 && this.modelPivot) {
            this.modelPivot.visible = Math.sin(state.invincibleTimer * 16) > 0;
        } else if (this.modelPivot && !this.modelPivot.visible && player.cameraMode !== 'first') {
            this.modelPivot.visible = true;
        }

        // --- Procedural animation ---
        if (state.isAttacking) {
            const swingT = (state._attackVisualTimer || 0) / ATTACK_SWING_DURATION;
            let armAngleR, armAngleL;
            // C5: ease-in/out on each phase for impact feel
            if (swingT < 0.4) {
                const t = easeInOutQuad(swingT / 0.4);
                armAngleR = -1.8 * t;
                armAngleL = -1.4 * t;
            } else if (swingT < 0.8) {
                const t = easeInOutQuad((swingT - 0.4) / 0.4);
                armAngleR = -1.8 + (1.8 + 1.2) * t;
                armAngleL = -1.4 + (1.4 + 0.8) * t;
            } else {
                const t = easeInOutQuad((swingT - 0.8) / 0.2);
                armAngleR = 1.2 * (1 - t);
                armAngleL = 0.8 * (1 - t);
            }
            this.armR.rotation.x = armAngleR;
            this.armL.rotation.x = armAngleL;
            this.legL.rotation.x = THREE.MathUtils.lerp(this.legL.rotation.x, 0, 0.15);
            this.legR.rotation.x = THREE.MathUtils.lerp(this.legR.rotation.x, 0, 0.15);
            // C5: subtle forward torso lurch timed with the strike (peak at swingT ~0.6)
            const lurcht = Math.max(0, Math.sin(swingT * Math.PI));
            this.modelPivot.position.z = lurcht * 0.08;
            this.modelPivot.position.y = THREE.MathUtils.lerp(this.modelPivot.position.y, 0, 0.1);
        } else if (this.chopAnimState) {
            const { isSwinging, swingProgress } = this.chopAnimState;
            if (isSwinging) {
                const t = 1.0 - swingProgress;
                // C5: ease in/out on chop swing too
                const swingAngle = -1.2 + easeInOutQuad(t) * 2.2;
                this.armR.rotation.x = swingAngle;
                // C5: subtle torso lurch at mid-swing
                this.modelPivot.position.z = easeInOutQuad(Math.min(t * 2, 1) * Math.max(0, 1 - (t - 0.5) * 2)) * 0.07;
            } else {
                this.armR.rotation.x = THREE.MathUtils.lerp(this.armR.rotation.x, -1.2, 0.15);
                this.modelPivot.position.z = THREE.MathUtils.lerp(this.modelPivot.position.z, 0, 0.15);
            }
            this.armL.rotation.x = THREE.MathUtils.lerp(this.armL.rotation.x, -0.3, 0.1);
            this.legL.rotation.x = THREE.MathUtils.lerp(this.legL.rotation.x, 0, 0.1);
            this.legR.rotation.x = THREE.MathUtils.lerp(this.legR.rotation.x, 0, 0.1);
            this.modelPivot.position.y = THREE.MathUtils.lerp(this.modelPivot.position.y, 0, 0.1);
        } else if (isMoving && player.onGround) {
            const walkCycle = this.time * 10;
            this.legL.rotation.x = Math.sin(walkCycle) * 0.8;
            this.legR.rotation.x = Math.sin(walkCycle + Math.PI) * 0.8;
            this.armL.rotation.x = Math.sin(walkCycle + Math.PI) * 0.5;
            this.armR.rotation.x = Math.sin(walkCycle) * 0.5;
            this.modelPivot.position.y = Math.abs(Math.sin(walkCycle * 2)) * 0.05;
            this.modelPivot.position.z = THREE.MathUtils.lerp(this.modelPivot.position.z, 0, 0.1);
        } else {
            const lerp = 0.1;
            this.legL.rotation.x = THREE.MathUtils.lerp(this.legL.rotation.x, 0, lerp);
            this.legR.rotation.x = THREE.MathUtils.lerp(this.legR.rotation.x, 0, lerp);
            this.armL.rotation.x = THREE.MathUtils.lerp(this.armL.rotation.x, 0, lerp);
            this.armR.rotation.x = THREE.MathUtils.lerp(this.armR.rotation.x, 0, lerp);
            this.modelPivot.position.y = THREE.MathUtils.lerp(this.modelPivot.position.y, 0, lerp);
            this.modelPivot.position.z = THREE.MathUtils.lerp(this.modelPivot.position.z, 0, lerp);
        }
    }

    updateCamera(camera) {
        if (!this.playerGroup) return;
        const player = this.state.player;
        const ca = player.cameraAngle;
        const up = this._surfaceNormal;

        // Clamp vertical angle
        if (player.cameraMode !== 'first') {
            ca.y = Math.max(CAMERA_MIN_Y, Math.min(CAMERA_MAX_Y, ca.y));
        }

        if (player.cameraMode === 'first') {
            if (this.modelPivot) this.modelPivot.visible = false;

            // First person: camera at player pos + up * eye height
            const eyePos = player.pos.clone().add(up.clone().multiplyScalar(1.0));
            camera.position.copy(eyePos);

            // Look direction relative to surface frame
            const lookFwd = this._surfaceForward.clone()
                .multiplyScalar(-Math.cos(ca.y) * Math.cos(ca.x))
                .add(this._surfaceRight.clone().multiplyScalar(-Math.cos(ca.y) * Math.sin(ca.x)))
                .add(up.clone().multiplyScalar(Math.sin(ca.y)));

            camera.lookAt(eyePos.clone().add(lookFwd));
            camera.up.copy(up);
            player.targetRotation = ca.x;
        } else {
            if (this.modelPivot) this.modelPivot.visible = true;

            // Third person camera orbiting in the surface frame
            const dist = CAMERA_DISTANCE;

            // ca.x = horizontal orbit angle, ca.y = elevation angle
            const horizDist = dist * Math.cos(ca.y);
            const vertDist = dist * Math.sin(ca.y) + 0.8;

            // Compute world offset using surface frame
            const offset = this._surfaceForward.clone().multiplyScalar(horizDist * Math.cos(ca.x))
                .add(this._surfaceRight.clone().multiplyScalar(horizDist * Math.sin(ca.x)))
                .add(up.clone().multiplyScalar(vertDist));

            const desiredPos = player.pos.clone().add(offset);
            const lookTarget = player.pos.clone().add(up.clone().multiplyScalar(0.5));
            if (!this._lookTarget) this._lookTarget = lookTarget.clone();

            // Detect a teleport (disembark, respawn, out-of-bounds snap): the player
            // jumps farther than any single on-foot frame ever could. Snap the camera
            // and look target instead of slowly lerping them across the world.
            const teleported = this._prevCamPlayerPos
                && player.pos.distanceToSquared(this._prevCamPlayerPos) > 25; // > 5 units
            if (!this._prevCamPlayerPos) this._prevCamPlayerPos = new THREE.Vector3();
            this._prevCamPlayerPos.copy(player.pos);

            if (teleported) {
                camera.position.copy(desiredPos);
                this._lookTarget.copy(lookTarget);
            } else {
                camera.position.lerp(desiredPos, CAMERA_LERP);
                // C8: Smooth the lookAt target to avoid jarring snaps when surface normal changes fast
                this._lookTarget.lerp(lookTarget, 0.2);
            }
            camera.lookAt(this._lookTarget);
            camera.up.copy(up);
        }
    }

    /** Get the current surface normal (up direction) */
    getSurfaceNormal() {
        return this._surfaceNormal.clone();
    }

    /** Get the current planet the player is on */
    getCurrentPlanet() {
        return this._currentPlanet;
    }

    getPosition() {
        return this.state.player.pos;
    }

    getForward() {
        if (!this.modelPivot) return new THREE.Vector3(0, 0, 1);
        const fwd = new THREE.Vector3(0, 0, 1);
        fwd.applyQuaternion(this.modelPivot.quaternion);
        // Transform by playerGroup orientation
        fwd.applyQuaternion(this.playerGroup.quaternion);
        return fwd;
    }

    remove() {
        if (this.playerGroup) {
            this.world.remove(this.playerGroup);
            this.playerGroup = null;
        }
    }
}
