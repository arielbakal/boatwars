// =====================================================
// PLAYER CONTROLLER - weighted spherical movement, procedural IK and camera
// =====================================================

import {
    GRAVITY, JUMP_FORCE, PLAYER_RADIUS, PLAYER_SURFACE_HEIGHT, GRAVITY_REFERENCE_RADIUS,
    MAX_FALL_SPEED, CAMERA_FOV, CAMERA_FOV_FIRST_PERSON, CAMERA_DISTANCE, CAMERA_MAX_Y,
    PLAYER_SPEED_BOOST_CAP, PLAYER_FOV_KICK
} from '../constants.js';
import SphericalUtils from './SphericalUtils.js';
import { getProceduralRig } from './ProceduralRig.js';

const PLAYER_EPS = 1e-6;
const HELD_TOOL_TILT = Math.PI / 5;
const HELD_TOOL_HALF_HANDLE = 0.25;
const playerClamp = THREE.MathUtils.clamp;
const playerExpAlpha = (rate, dt) => 1 - Math.exp(-rate * dt);
export default class PlayerController {
    constructor(world, state) {
        this.world = world;
        this.state = state;
        this.playerGroup = null;
        this.modelPivot = null;
        this.rig = null;
        this.legL = null;
        this.legR = null;
        this.armL = null;
        this.armR = null;
        this.handAnchorL = null;
        this.handAnchorR = null;
        this.heldItem = null;
        this.chopAnimState = null;
        this.time = 0;
        this._isMoving = false;
        this._lookTarget = null;
        this._prevCamPlayerPos = null;
        this._surfaceNormal = new THREE.Vector3(0, 1, 0);
        this._groundNormal = new THREE.Vector3(0, 1, 0);
        this._surfaceForward = new THREE.Vector3(0, 0, 1);
        this._surfaceRight = new THREE.Vector3(1, 0, 0);
        this._currentPlanet = null;
        this._previousTangentVelocity = new THREE.Vector3();
        this.accelerationVector = new THREE.Vector3();
        this._jumpBuffer = 0;
        this._coyoteTimer = 0;
        this._spaceWasDown = false;
        this._runAmount = 0;
        this._landingKick = 0;
        this._cameraRecoil = 0;
        this._cameraDistance = CAMERA_DISTANCE;
        this.weaponRecoil = 0;
        this.breachCharge = 0;
        this._lastGrounded = false;
        this._tmp = new THREE.Vector3();
        this._tmp2 = new THREE.Vector3();
        this._tmp3 = new THREE.Vector3();
        this._cameraRaycaster = new THREE.Raycaster();
        this.audio = null;
        this.footprints = [];
        this._footprintGeometry = new THREE.CircleGeometry(0.17, 14);
        this._footprintBasis = new THREE.Matrix4();
    }

    createModel(palette) {
        this.playerGroup = new THREE.Group();
        this.playerGroup.name = 'Local planetary player';
        this.modelPivot = new THREE.Group();
        this.modelPivot.name = 'Procedural body root';
        this.playerGroup.add(this.modelPivot);

        const ProceduralRig = getProceduralRig();
        this.rig = new ProceduralRig(this, palette);
        this.legL = this.rig.leftFootMesh;
        this.legR = this.rig.rightFootMesh;
        this.armL = this.rig.armProxyL;
        this.armR = this.rig.armProxyR;
        this.handAnchorL = this.rig.handAnchorL;
        this.handAnchorR = this.rig.handAnchorR;
        this.torso = this.rig.chestMesh;
        this.head = this.rig.headMesh;
        this.eyeL = this.rig.eyeL;
        this.eyeR = this.rig.eyeR;
        this.world.add(this.playerGroup);
    }

    setBodyVisible(visible) {
        if (this.rig) this.rig.setVisible(visible);
    }

    holdItem(item) {
        if (!this.handAnchorR) return;
        if (this.heldItem && this.heldItem.parent === this.handAnchorR) this.handAnchorR.remove(this.heldItem);
        this.heldItem = item;
        if (!item) return;

        const isHandledTool = item.userData && (item.userData.type === 'axe' || item.userData.type === 'pickaxe');
        if (isHandledTool) {
            item.rotation.set(HELD_TOOL_TILT, 0, 0);
            const halfHandle = HELD_TOOL_HALF_HANDLE * (item.scale.y || 1);
            item.position.set(0, halfHandle * Math.cos(HELD_TOOL_TILT), halfHandle * Math.sin(HELD_TOOL_TILT));
        } else {
            item.rotation.set(0, 0, 0);
            item.position.set(0, 0, 0);
        }
        this.handAnchorR.add(item);
    }

    _updateSurfaceFrame(planets) {
        const result = SphericalUtils.findNearestPlanet(this.state.player.pos, planets);
        if (!result) return;
        this._currentPlanet = result.planet;
        const nextUp = SphericalUtils.getSurfaceNormal(this.state.player.pos, result.planet);
        this._surfaceNormal.lerp(nextUp, 0.72).normalize();

        let fwd = this._surfaceForward.clone().projectOnPlane(this._surfaceNormal);
        if (fwd.lengthSq() < 0.0001) fwd = SphericalUtils._getArbitraryTangent(this._surfaceNormal);
        else fwd.normalize();
        this._surfaceRight.crossVectors(this._surfaceNormal, fwd).normalize();
        this._surfaceForward.crossVectors(this._surfaceRight, this._surfaceNormal).normalize();
    }

    _terrainSurfaceAt(position, planet) {
        const radial = position.clone().sub(planet.center).normalize();
        const sample = SphericalUtils.sampleTerrainSurface(planet, radial, new THREE.Vector3(), new THREE.Vector3());
        return { radial, point: sample.point, normal: sample.normal, radius: sample.radius };
    }

    update(dt, islands) {
        if (!this.playerGroup || this.state.isDead) return;
        const state = this.state;
        const player = state.player;
        this.time += dt;
        const frameScale = playerClamp(dt * 60, 0.25, 2.2);
        this._updateSurfaceFrame(islands);
        if (!this._currentPlanet) return;
        const planet = this._currentPlanet;
        const up = this._surfaceNormal;
        const wasGrounded = !!player.onGround;
        this._lastGrounded = wasGrounded;

        const jumpPressed = state.inputs.space && !this._spaceWasDown;
        this._spaceWasDown = !!state.inputs.space;
        if (jumpPressed) this._jumpBuffer = 0.15;
        else this._jumpBuffer = Math.max(0, this._jumpBuffer - dt);
        if (wasGrounded) this._coyoteTimer = 0.13;
        else this._coyoteTimer = Math.max(0, this._coyoteTimer - dt);

        // Camera-relative tangent movement. The target velocity is approached rather
        // than assigned, giving the character weight without sacrificing response.
        const cameraForwardWorld = new THREE.Vector3();
        this.world.camera.getWorldDirection(cameraForwardWorld);
        let camFwd = cameraForwardWorld.clone().projectOnPlane(up);
        if (camFwd.lengthSq() < 0.001) camFwd.copy(this._surfaceForward);
        else camFwd.normalize();
        const camRight = new THREE.Vector3().crossVectors(camFwd, up).normalize();
        const moveDir = new THREE.Vector3();
        if (state.inputs.w) moveDir.add(camFwd);
        if (state.inputs.s) moveDir.sub(camFwd);
        if (state.inputs.a) moveDir.sub(camRight);
        if (state.inputs.d) moveDir.add(camRight);
        const hasInput = moveDir.lengthSq() > 0.01;
        if (hasInput) moveDir.normalize();

        this._runAmount = playerClamp(this._runAmount + (state.inputs.shift && hasInput ? 1 : -1) * dt * 5.5, 0, 1);
        const baseSpeed = player.speed + (player.speedBoost || 0);
        const targetSpeed = baseSpeed * THREE.MathUtils.lerp(1, 1.58, this._runAmount);
        const radialVelocity = up.clone().multiplyScalar(player.vel.dot(up));
        const tangentVelocity = player.vel.clone().sub(radialVelocity);
        const targetTangent = hasInput ? moveDir.clone().multiplyScalar(targetSpeed) : new THREE.Vector3();
        const response = player.stunTimer > 0 ? 4.2 : (hasInput ? 13.5 : 18.5);
        tangentVelocity.lerp(targetTangent, playerExpAlpha(response, dt));
        if (player.stunTimer > 0) player.stunTimer = Math.max(0, player.stunTimer - dt);
        player.vel.copy(tangentVelocity).add(radialVelocity);

        this._isMoving = hasInput && tangentVelocity.length() > baseSpeed * 0.08;
        if (hasInput && player.cameraMode !== 'first') {
            const localX = moveDir.dot(this._surfaceRight);
            const localZ = moveDir.dot(this._surfaceForward);
            const targetAngle = Math.atan2(localX, localZ);
            let delta = targetAngle - player.targetRotation;
            while (delta > Math.PI) delta -= Math.PI * 2;
            while (delta < -Math.PI) delta += Math.PI * 2;
            player.targetRotation += delta * playerExpAlpha(player.onGround ? 14 : 7, dt);
        }

        this.accelerationVector.copy(tangentVelocity).sub(this._previousTangentVelocity).divideScalar(Math.max(dt, 0.004));
        this._previousTangentVelocity.copy(tangentVelocity);

        // Frame-rate compensated radial gravity.
        const gravityStrength = GRAVITY * (planet.radius / GRAVITY_REFERENCE_RADIUS) * frameScale;
        player.vel.addScaledVector(up, -gravityStrength);
        const radialSpeed = player.vel.dot(up);
        if (radialSpeed < -MAX_FALL_SPEED) player.vel.addScaledVector(up, -MAX_FALL_SPEED - radialSpeed);

        const nextPos = player.pos.clone().addScaledVector(player.vel, frameScale);
        player.onGround = false;
        const terrain = this._terrainSurfaceAt(nextPos, planet);
        const distFromCenter = nextPos.distanceTo(planet.center);
        const minSurface = terrain.radius + PLAYER_SURFACE_HEIGHT;
        if (distFromCenter < planet.radius * 2.4 && distFromCenter < minSurface) {
            nextPos.copy(planet.center).addScaledVector(terrain.radial, minSurface);
            const vn = player.vel.dot(terrain.normal);
            if (vn < 0) player.vel.addScaledVector(terrain.normal, -vn);
            this._groundNormal.lerp(terrain.normal, 0.82).normalize();
            player.onGround = true;
        } else {
            this._groundNormal.lerp(up, playerExpAlpha(8, dt)).normalize();
        }

        // Respawn only when genuinely lost in deep space on foot.
        if (distFromCenter - planet.radius > 100) {
            const nearest = SphericalUtils.findNearestPlanet(nextPos, islands);
            const spawn = nearest?.planet || islands[0];
            const normal = nextPos.clone().sub(spawn.center).normalize();
            if (normal.lengthSq() < PLAYER_EPS) normal.set(0, 1, 0);
            const radius = SphericalUtils.sampleTerrainHeight(spawn, normal);
            nextPos.copy(spawn.center).addScaledVector(normal, radius + 1.2);
            player.vel.set(0, 0, 0);
        }
        player.pos.copy(nextPos);

        // Obstacle collision remains spherical/world-space but now damps the
        // incoming tangent velocity instead of allowing jitter against the collider.
        let groundHeightOverride = null;
        for (const obs of state.obstacles) {
            if (obs.userData.isMountain) {
                const dist3D = player.pos.distanceTo(obs.position);
                const maxR = obs.userData.mountRadius;
                if (dist3D < maxR) {
                    const surfNorm = SphericalUtils.getSurfaceNormal(obs.position, planet);
                    const obsSurface = planet.center.clone().addScaledVector(surfNorm, planet.radius);
                    const arcDist = player.pos.distanceTo(obsSurface);
                    if (arcDist < maxR) {
                        const h = obs.userData.mountHeight * (1 - arcDist / maxR);
                        groundHeightOverride = Math.max(groundHeightOverride || 0, planet.radius + h);
                    }
                }
                continue;
            }
            if (!obs.userData.radius) continue;
            const distance = player.pos.distanceTo(obs.position);
            const minDistance = PLAYER_RADIUS + obs.userData.radius;
            if (distance < minDistance && distance > PLAYER_EPS) {
                const push = player.pos.clone().sub(obs.position).normalize();
                player.pos.addScaledVector(push, minDistance - distance);
                const into = player.vel.dot(push);
                if (into < 0) player.vel.addScaledVector(push, -into * 0.86);
            }
        }

        if (groundHeightOverride !== null) {
            const normal = player.pos.clone().sub(planet.center).normalize();
            if (player.pos.distanceTo(planet.center) < groundHeightOverride + PLAYER_SURFACE_HEIGHT) {
                player.pos.copy(planet.center).addScaledVector(normal, groundHeightOverride + PLAYER_SURFACE_HEIGHT);
                const vn = player.vel.dot(normal);
                if (vn < 0) player.vel.addScaledVector(normal, -vn);
                this._groundNormal.lerp(normal, 0.8).normalize();
                player.onGround = true;
            }
        }

        // Buffered jump + coyote time. A held Space key cannot repeatedly jump.
        if (this._jumpBuffer > 0 && (player.onGround || this._coyoteTimer > 0)) {
            const jumpUp = SphericalUtils.getSurfaceNormal(player.pos, planet);
            const currentRadial = player.vel.dot(jumpUp);
            player.vel.addScaledVector(jumpUp, JUMP_FORCE - currentRadial);
            player.pos.addScaledVector(jumpUp, 0.025);
            player.onGround = false;
            this._jumpBuffer = 0;
            this._coyoteTimer = 0;
        }

        this.playerGroup.position.copy(player.pos);
        const trueNormal = SphericalUtils.getSurfaceNormal(player.pos, planet);
        const orientQ = SphericalUtils.getOrientationOnSurface(trueNormal, this._surfaceForward);
        this.playerGroup.quaternion.slerp(orientQ, playerExpAlpha(18, dt));
        // Lower-body yaw is solved inside ProceduralRig; keeping the body root at
        // identity lets planted world-space feet remain planted while turning.
        this.modelPivot.quaternion.slerp(new THREE.Quaternion(), playerExpAlpha(16, dt));

        this.weaponRecoil = THREE.MathUtils.lerp(this.weaponRecoil, 0, playerExpAlpha(12, dt));
        this._cameraRecoil = THREE.MathUtils.lerp(this._cameraRecoil, 0, playerExpAlpha(9, dt));
        this._landingKick = THREE.MathUtils.lerp(this._landingKick, 0, playerExpAlpha(10, dt));
        if (this.rig) this.rig.update(dt);
        this._updateFootprints(dt);

        // Invincibility reads as a material/body pulse but does not interrupt IK.
        if (state.invincibleTimer > 0) {
            this.modelPivot.visible = Math.sin(state.invincibleTimer * 20) > -0.25;
        } else {
            this.modelPivot.visible = true;
        }
    }

    setSeated(active) {
        this.rig?.setSeated?.(active);
    }

    addWeaponRecoil(amount = 1) {
        this.weaponRecoil = Math.max(this.weaponRecoil, amount);
        this._cameraRecoil = Math.max(this._cameraRecoil, 0.08 + amount * 0.055);
    }

    setBreachCharge(charge) {
        this.breachCharge = playerClamp(charge, 0, 1);
        this.state.breachCharge = this.breachCharge;
    }

    updateCamera(camera, dt = 0) {
        if (!this.playerGroup || !this._currentPlanet) return;
        const state = this.state;
        const player = state.player;
        const ca = player.cameraAngle;
        const up = this._surfaceNormal;
        const equipped = !!state.breachEquipped && !state.isOnBoat;
        const aiming = !!state.breachAiming && equipped;
        const charging = aiming;

        const boostRatio = (this._isMoving && !state.isDead && player.speedBoost > 0 && PLAYER_SPEED_BOOST_CAP > 0)
            ? Math.min(1, player.speedBoost / PLAYER_SPEED_BOOST_CAP) : 0;
        const baseFov = player.cameraMode === 'first'
            ? CAMERA_FOV_FIRST_PERSON
            : (charging ? 52 : equipped ? 58 : CAMERA_FOV);
        const sprintKick = PLAYER_FOV_KICK * boostRatio + this._runAmount * (this._isMoving ? 4.2 : 0);
        const targetFov = baseFov + sprintKick;
        const nextFov = THREE.MathUtils.lerp(camera.fov, targetFov, playerExpAlpha(9, dt || 1 / 60));
        if (Math.abs(nextFov - camera.fov) > 0.01) {
            camera.fov = nextFov;
            camera.updateProjectionMatrix();
        }

        if (player.cameraMode !== 'first') ca.y = playerClamp(ca.y, -0.28, CAMERA_MAX_Y);

        if (player.cameraMode === 'first') {
            this.setBodyVisible(false);
            const eyePos = player.pos.clone().addScaledVector(up, 1.43);
            camera.position.copy(eyePos);
            const lookFwd = this._cameraLookDirection(ca, up);
            camera.up.copy(up);
            camera.lookAt(eyePos.clone().add(lookFwd).addScaledVector(up, this._cameraRecoil));
            player.targetRotation = ca.x + Math.PI;
            this._applyCameraShake(camera);
            return;
        }

        this.setBodyVisible(true);
        const desiredDistance = charging ? 3.35 : equipped ? 4.55 : CAMERA_DISTANCE;
        this._cameraDistance = THREE.MathUtils.lerp(this._cameraDistance, desiredDistance, playerExpAlpha(10, dt || 1 / 60));
        const horiz = this._cameraDistance * Math.cos(ca.y);
        const vert = this._cameraDistance * Math.sin(ca.y) + (aiming ? 1.00 : 0.84);
        const orbitForward = this._surfaceForward.clone().multiplyScalar(Math.cos(ca.x))
            .addScaledVector(this._surfaceRight, Math.sin(ca.x)).normalize();
        const cameraRight = new THREE.Vector3().crossVectors(orbitForward, up).normalize();
        const shoulder = aiming ? 0.72 : (equipped ? 0.24 : 0);
        const offset = orbitForward.clone().multiplyScalar(horiz)
            .addScaledVector(up, vert - this._landingKick)
            .addScaledVector(cameraRight, shoulder);
        const desiredPos = player.pos.clone().add(offset);

        // Keep the camera above the displaced spherical terrain instead of letting
        // close shoulder views tunnel into hills or the far side of a small planet.
        const camNormal = desiredPos.clone().sub(this._currentPlanet.center).normalize();
        const camTerrain = SphericalUtils.sampleTerrainHeight(this._currentPlanet, camNormal);
        const camRadius = desiredPos.distanceTo(this._currentPlanet.center);
        if (camRadius < camTerrain + 0.28) desiredPos.copy(this._currentPlanet.center).addScaledVector(camNormal, camTerrain + 0.28);

        const aimDir = this._cameraLookDirection(ca, up);
        const lookTarget = player.pos.clone()
            .addScaledVector(up, aiming ? 0.93 : 0.78)
            .addScaledVector(aimDir, aiming ? 1.15 : (equipped ? 0.22 : 0))
            .addScaledVector(up, this._cameraRecoil);

        // Shoulder cameras need a true line-of-sight collision test. The radial
        // clamp above only prevents entering the planet; this ray also prevents
        // hills and ridges from sitting between the character and the camera.
        if (this._currentPlanet.groundMesh) {
            const cameraPath = desiredPos.clone().sub(lookTarget);
            const cameraPathLength = cameraPath.length();
            if (cameraPathLength > 0.15) {
                this._cameraRaycaster.set(lookTarget, cameraPath.normalize());
                this._cameraRaycaster.near = 0.12;
                this._cameraRaycaster.far = cameraPathLength;
                this._currentPlanet.groundMesh.updateWorldMatrix(true, false);
                const cameraHits = this._cameraRaycaster.intersectObject(this._currentPlanet.groundMesh, false);
                if (cameraHits.length && cameraHits[0].distance < cameraPathLength) {
                    const safeDistance = Math.max(0.55, cameraHits[0].distance - 0.24);
                    desiredPos.copy(lookTarget).addScaledVector(cameraPath, safeDistance);
                }
            }
        }
        if (!this._lookTarget) this._lookTarget = lookTarget.clone();

        const teleported = this._prevCamPlayerPos && player.pos.distanceToSquared(this._prevCamPlayerPos) > 25;
        if (!this._prevCamPlayerPos) this._prevCamPlayerPos = new THREE.Vector3();
        this._prevCamPlayerPos.copy(player.pos);
        if (teleported) {
            camera.position.copy(desiredPos);
            this._lookTarget.copy(lookTarget);
        } else {
            camera.position.lerp(desiredPos, playerExpAlpha(aiming ? 13 : 9, dt || 1 / 60));
            this._lookTarget.lerp(lookTarget, playerExpAlpha(aiming ? 18 : 12, dt || 1 / 60));
        }
        camera.up.copy(up);
        camera.lookAt(this._lookTarget);
        this._applyCameraShake(camera);
    }

    _cameraLookDirection(ca, up) {
        const horizontal = this._surfaceForward.clone().multiplyScalar(-Math.cos(ca.x))
            .addScaledVector(this._surfaceRight, -Math.sin(ca.x));
        return horizontal.multiplyScalar(Math.cos(ca.y)).addScaledVector(up, Math.sin(ca.y)).normalize();
    }

    _applyCameraShake(camera) {
        const shake = this.state.cameraShake;
        if (!shake) return;
        camera.position.x += (Math.random() - 0.5) * 2 * shake;
        camera.position.y += (Math.random() - 0.5) * 2 * shake;
        camera.position.z += (Math.random() - 0.5) * 2 * shake;
    }

    onProceduralFootstep(position, normal, speed01) {
        if (!this.world?.scene || speed01 < 0.08) return;
        if (this.footprints.length >= 26) {
            const oldest = this.footprints.shift();
            this.world.remove(oldest.mesh);
            oldest.mesh.material.dispose();
        }
        const material = new THREE.MeshBasicMaterial({
            color: 0x162019, transparent: true, opacity: 0.12 + speed01 * 0.12,
            depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2
        });
        const mesh = new THREE.Mesh(this._footprintGeometry, material);
        const forward = this.getForward().projectOnPlane(normal);
        if (forward.lengthSq() < PLAYER_EPS) forward.copy(SphericalUtils._getArbitraryTangent(normal));
        else forward.normalize();
        const right = new THREE.Vector3().crossVectors(forward, normal).normalize();
        this._footprintBasis.makeBasis(right, forward, normal);
        mesh.quaternion.setFromRotationMatrix(this._footprintBasis);
        mesh.position.copy(position).addScaledVector(normal, 0.008);
        mesh.scale.set(0.58, 1.18, 1);
        this.world.add(mesh);
        this.footprints.push({ mesh, age: 0, life: 4.8, startOpacity: material.opacity });
        if (this.state.addShake) this.state.addShake(0.0015 + speed01 * 0.0025);
        this.audio?.step?.(speed01);
    }

    _updateFootprints(dt) {
        for (let i = this.footprints.length - 1; i >= 0; i--) {
            const footprint = this.footprints[i];
            footprint.age += dt;
            footprint.mesh.material.opacity = footprint.startOpacity * Math.max(0, 1 - footprint.age / footprint.life);
            if (footprint.age >= footprint.life) {
                this.world.remove(footprint.mesh);
                footprint.mesh.material.dispose();
                this.footprints.splice(i, 1);
            }
        }
    }

    getSurfaceNormal() { return this._surfaceNormal.clone(); }
    getGroundNormal() { return this._groundNormal.clone(); }
    getCurrentPlanet() { return this._currentPlanet; }
    getPosition() { return this.state.player.pos; }

    getForward() {
        if (!this.playerGroup) return new THREE.Vector3(0, 0, 1);
        const yaw = this.state.player.targetRotation || 0;
        const local = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        return local.applyQuaternion(this.playerGroup.quaternion).normalize();
    }

    getWeaponWorldTransform(positionTarget = new THREE.Vector3(), directionTarget = new THREE.Vector3()) {
        if (this.rig) return this.rig.getWeaponWorldTransform(positionTarget, directionTarget);
        positionTarget.copy(this.state.player.pos).addScaledVector(this._surfaceNormal, 0.9);
        directionTarget.copy(this.getForward());
        return { position: positionTarget, direction: directionTarget };
    }

    getCanonicalRotation() {
        if (!this.playerGroup || !this._currentPlanet) return this.state.player.targetRotation || 0;
        const up = SphericalUtils.getSurfaceNormal(this.state.player.pos, this._currentPlanet);
        const t0 = SphericalUtils._getArbitraryTangent(up);
        const r0 = new THREE.Vector3().crossVectors(up, t0);
        const f = this.getForward();
        return Math.atan2(f.dot(r0), f.dot(t0));
    }

    remove() {
        for (const footprint of this.footprints) {
            this.world.remove(footprint.mesh);
            footprint.mesh.material.dispose();
        }
        this.footprints.length = 0;
        if (this.playerGroup) {
            this.world.remove(this.playerGroup);
            this.playerGroup = null;
            this.modelPivot = null;
            this.rig = null;
        }
    }
}

