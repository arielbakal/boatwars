// =====================================================
// CAT AI - Follow player on spherical planets
// =====================================================

import { smoothFactor } from '../classes/Easing.js';
import SphericalUtils from '../classes/SphericalUtils.js';
import { expAlpha } from '../classes/ProceduralRig.js';

export default class CatAI {
    constructor() {
        this._surfacePoint = new THREE.Vector3();
        this._surfaceNormal = new THREE.Vector3();
        this._desiredDir = new THREE.Vector3();
        this._targetPoint = new THREE.Vector3();
        this._playerForward = new THREE.Vector3();
        this._playerRight = new THREE.Vector3();
        this._tmpA = new THREE.Vector3();
        this._tmpB = new THREE.Vector3();
        this._tmpC = new THREE.Vector3();
        this._tmpD = new THREE.Vector3();
        this._invCatQuat = new THREE.Quaternion();
    }

    update(dt, context) {
        const { state, t, playerCat: cat, playerController } = context;
        if (!cat || !cat.userData?.rigReady) return;

        const data = cat.userData;

        // BoatSystem owns the cat's world transform in these states, but the feline
        // rig should keep breathing, balancing and moving instead of freezing rigidly.
        if (state.catOnBoat) {
            data.speed += (0 - data.speed) * smoothFactor(0.16, dt);
            this._animateRig(cat, dt, t, null, { onShip: true, forcedMotion: 0 });
            return;
        }
        if (state.catBoarding) {
            data.speed += (data.runSpeed - data.speed) * smoothFactor(0.18, dt);
            this._animateRig(cat, dt, t, data.planet || null, { airborne: true, forcedMotion: 0.85 });
            return;
        }

        let planet = data.planet;
        if (!planet && state.islands.length) {
            const nearest = SphericalUtils.findNearestPlanet(cat.position, state.islands);
            planet = nearest?.planet || null;
            data.planet = planet;
        }
        if (!planet) return;

        const playerPos = state.player.pos;
        const playerResult = SphericalUtils.findNearestPlanet(playerPos, state.islands);
        const samePlanet = playerResult?.planet === planet && playerResult.altitude < 6;

        // During the boarding delay, run toward the actual boarding target rather
        // than toward the ship's center through the planet.
        let target = null;
        let targetSpeed = 0;
        let mode = 'idle';
        if (state.catBoardingQueued) {
            const boat = state.boardingTargetBoat || state.activeBoat;
            if (boat) {
                target = boat.position;
                targetSpeed = data.runSpeed;
                mode = 'run';
            }
        } else if (!state.isOnBoat && samePlanet) {
            const radialUp = SphericalUtils.getSurfaceNormal(playerPos, planet);
            this._playerForward.copy(playerController?.getForward?.() || data.forwardWorld)
                .projectOnPlane(radialUp)
                .normalize();
            if (this._playerForward.lengthSq() < 1e-5) this._playerForward.copy(SphericalUtils._getArbitraryTangent(radialUp));
            this._playerRight.crossVectors(radialUp, this._playerForward).normalize();

            // Follow a shoulder-side point behind the player, avoiding the old
            // behavior where the cat constantly collided with the player's feet.
            this._targetPoint.copy(playerPos)
                .addScaledVector(this._playerForward, -1.18)
                .addScaledVector(this._playerRight, 0.56);
            const targetRadial = this._targetPoint.clone().sub(planet.center).normalize();
            const targetSurface = SphericalUtils.sampleTerrainSurface(planet, targetRadial, this._tmpA, this._tmpB);
            this._targetPoint.copy(targetSurface.point).addScaledVector(targetSurface.normal, data.heightOffset);

            const targetDist = cat.position.distanceTo(this._targetPoint);
            const playerDist = cat.position.distanceTo(playerPos);

            // Fail-safe reposition only after genuinely losing the companion. It is
            // hidden behind the player and never used as normal locomotion.
            if (playerDist > 24) {
                cat.position.copy(this._targetPoint);
                data.velocity.set(0, 0, 0);
                data.lastPosition.copy(cat.position);
            }

            if (targetDist > data.catchupDist) {
                target = this._targetPoint;
                targetSpeed = data.runSpeed;
                mode = 'run';
            } else if (targetDist > data.followDist) {
                target = this._targetPoint;
                targetSpeed = THREE.MathUtils.lerp(data.moveSpeed, data.runSpeed, THREE.MathUtils.clamp((targetDist - data.followDist) / 3.4, 0, 1));
                mode = targetSpeed > data.moveSpeed * 1.35 ? 'run' : 'walk';
            } else {
                data.wanderTimer -= dt;
                if (data.wanderTimer <= 0) {
                    data.wanderTimer = 1.8 + Math.random() * 3.6;
                    data.wanderAngle += (Math.random() - 0.5) * 1.9;
                }

                // Small, infrequent local repositioning keeps it alive without
                // turning the companion into a nervous orbiting drone.
                const shouldWander = data.wanderTimer < 0.65 && playerDist > 0.85;
                if (shouldWander) {
                    const tangent = SphericalUtils._getArbitraryTangent(radialUp);
                    const bitangent = new THREE.Vector3().crossVectors(radialUp, tangent).normalize();
                    const wanderDir = tangent.multiplyScalar(Math.cos(data.wanderAngle))
                        .add(bitangent.multiplyScalar(Math.sin(data.wanderAngle)));
                    target = cat.position.clone().addScaledVector(wanderDir, 0.65);
                    targetSpeed = data.moveSpeed * 0.42;
                    mode = 'walk';
                }
            }
        }

        const radial = SphericalUtils.getSurfaceNormal(cat.position, planet);
        const terrain = SphericalUtils.sampleTerrainSurface(planet, radial, this._surfacePoint, this._surfaceNormal);
        const up = terrain.normal;

        if (target) {
            this._desiredDir.copy(target).sub(cat.position).projectOnPlane(up);
            if (this._desiredDir.lengthSq() > 1e-5) this._desiredDir.normalize();
            else targetSpeed = 0;
        }

        const accel = targetSpeed > data.speed ? 7.5 : 10.5;
        data.speed += (targetSpeed - data.speed) * expAlpha(accel, dt);
        if (data.speed < 0.025) data.speed = 0;

        if (data.speed > 0 && this._desiredDir.lengthSq() > 1e-5) {
            const stepDistance = data.speed * dt;
            const candidate = cat.position.clone().addScaledVector(this._desiredDir, stepDistance);
            const candidateRadial = candidate.sub(planet.center).normalize();
            const nextTerrain = SphericalUtils.sampleTerrainSurface(planet, candidateRadial, this._tmpA, this._tmpB);

            const oldForward = data.forwardWorld.clone();
            cat.position.copy(nextTerrain.point).addScaledVector(nextTerrain.normal, data.heightOffset);
            data.forwardWorld.lerp(this._desiredDir, expAlpha(10, dt)).projectOnPlane(nextTerrain.normal).normalize();
            if (data.forwardWorld.lengthSq() < 1e-5) data.forwardWorld.copy(this._desiredDir);

            const targetQ = SphericalUtils.getOrientationOnSurface(nextTerrain.normal, data.forwardWorld);
            cat.quaternion.slerp(targetQ, expAlpha(mode === 'run' ? 14 : 10, dt));

            const turnCross = new THREE.Vector3().crossVectors(oldForward, data.forwardWorld);
            const signedTurn = THREE.MathUtils.clamp(turnCross.dot(nextTerrain.normal) * 5.5, -1, 1);
            data.turnLean += (signedTurn - data.turnLean) * expAlpha(9, dt);
        } else {
            // Stay locked to the real displaced terrain rather than nominal radius.
            cat.position.copy(terrain.point).addScaledVector(terrain.normal, data.heightOffset);
            data.turnLean += (0 - data.turnLean) * expAlpha(5, dt);

            // Look toward the player while resting, but don't spin the entire body
            // every frame. Head tracking below handles most of the attention.
            if (samePlanet && cat.position.distanceTo(playerPos) > 0.5) {
                const lookDir = playerPos.clone().sub(cat.position).projectOnPlane(terrain.normal).normalize();
                if (lookDir.lengthSq() > 1e-5) data.forwardWorld.lerp(lookDir, expAlpha(1.6, dt)).normalize();
            }
            const targetQ = SphericalUtils.getOrientationOnSurface(terrain.normal, data.forwardWorld);
            cat.quaternion.slerp(targetQ, expAlpha(4.0, dt));
        }

        data.isIdle = data.speed < 0.12;
        data.idleTimer = data.isIdle ? data.idleTimer + dt : 0;
        data.isSitting = data.idleTimer > 4.5 && !state.catBoardingQueued;

        this._animateRig(cat, dt, t, planet, {
            mode,
            lookTarget: samePlanet ? playerPos : null,
            forcedMotion: data.runSpeed > 0 ? data.speed / data.runSpeed : 0,
        });
        data.lastPosition.copy(cat.position);
    }

    _animateRig(cat, dt, t, planet, options = {}) {
        const data = cat.userData;
        const motion = THREE.MathUtils.clamp(options.forcedMotion ?? (data.speed / data.runSpeed), 0, 1);
        const walking = motion > 0.035;
        const running = motion > 0.58;
        const sitting = data.isSitting && !options.onShip && !options.airborne;

        const gaitRate = THREE.MathUtils.lerp(5.2, 10.5, motion);
        if (walking) data.gaitPhase += dt * gaitRate;

        const bob = walking ? Math.sin(data.gaitPhase * 2) * THREE.MathUtils.lerp(0.012, 0.035, motion) : Math.sin(t * 1.7 + data.hopOffset) * 0.007;
        const breathe = Math.sin(t * 2.05 + data.hopOffset) * 0.008;
        const sitBlendTarget = sitting ? 1 : 0;
        data._sitBlend = THREE.MathUtils.lerp(data._sitBlend || 0, sitBlendTarget, expAlpha(6.5, dt));
        const sitBlend = data._sitBlend;

        // Springy torso follows acceleration and landing/ship motion without using
        // physics bodies that could destabilize the rest of the game.
        const springTarget = walking ? -motion * 0.025 : 0;
        data.bodySpringVelocity += (springTarget - data.bodySpring) * 38 * dt;
        data.bodySpringVelocity *= Math.exp(-8 * dt);
        data.bodySpring += data.bodySpringVelocity * dt;

        data.bodyRoot.position.y = 0.02 + bob + breathe - sitBlend * 0.11;
        data.bodyRoot.rotation.x = THREE.MathUtils.lerp(data.bodyRoot.rotation.x, data.bodySpring + (running ? -0.055 : 0) + sitBlend * 0.16, expAlpha(8, dt));
        data.bodyRoot.rotation.z = THREE.MathUtils.lerp(data.bodyRoot.rotation.z, -data.turnLean * 0.12, expAlpha(9, dt));
        data.hips.position.y = 0.43 - sitBlend * 0.13;
        data.hips.rotation.x = Math.sin(data.gaitPhase * 2 + Math.PI) * 0.045 * motion + sitBlend * -0.18;
        data.chest.position.y = 0.47 + Math.sin(data.gaitPhase * 2) * 0.022 * motion;
        data.chest.rotation.z = -data.turnLean * 0.09;
        data.belly.scale.y = 0.48 + breathe * 0.9;

        data.spine.set(data.hips.position, data.chest.position, 0.19);
        const neckBase = new THREE.Vector3(0, data.chest.position.y + 0.04, 0.28);
        const neckTop = new THREE.Vector3(0, data.chest.position.y + 0.16 - sitBlend * 0.025, 0.39);
        data.neck.set(neckBase, neckTop, 0.13);
        data.headPivot.position.lerp(neckTop, expAlpha(9, dt));

        cat.updateMatrixWorld(true);
        const invWorld = cat.matrixWorld.clone().invert();

        for (const leg of data.legs) {
            const phase = data.gaitPhase + leg.phase;
            const liftWave = Math.max(0, Math.sin(phase));
            const strideWave = Math.cos(phase);
            const stride = THREE.MathUtils.lerp(0.055, running ? 0.25 : 0.16, motion);
            const lift = THREE.MathUtils.lerp(0.018, running ? 0.145 : 0.085, motion) * liftWave;

            leg.targetLocal.set(
                leg.hip.x,
                0.048 + lift,
                leg.hip.z + strideWave * stride + (leg.front ? 0.035 : -0.025)
            );

            if (sitting && !leg.front) {
                leg.targetLocal.set(leg.hip.x * 1.14, 0.055, leg.hip.z - 0.12);
            } else if (sitting && leg.front) {
                leg.targetLocal.set(leg.hip.x * 0.95, 0.048, leg.hip.z + 0.11);
            }

            // Sample each paw against the actual displaced planet terrain. When the
            // cat is aboard or hopping, preserve the procedural local target.
            if (planet && !options.onShip && !options.airborne) {
                const worldCandidate = leg.targetLocal.clone().applyMatrix4(cat.matrixWorld);
                const pawRadial = worldCandidate.sub(planet.center).normalize();
                const sampled = SphericalUtils.sampleTerrainSurface(planet, pawRadial, this._tmpA, this._tmpB);
                const sampledWorld = sampled.point.clone().addScaledVector(sampled.normal, 0.022 + lift);
                leg.footLocal.copy(sampledWorld.applyMatrix4(invWorld));
            } else {
                leg.footLocal.lerp(leg.targetLocal, expAlpha(16, dt));
            }

            const solved = this._solveTwoBone(
                leg.hip,
                leg.footLocal,
                leg.upperLength,
                leg.lowerLength,
                leg.front ? -1 : 1,
                leg.side
            );
            leg.upper.set(leg.hip, solved.joint, leg.front ? 0.055 : 0.064);
            leg.lower.set(solved.joint, solved.foot, leg.front ? 0.047 : 0.052);
            leg.joint.position.copy(solved.joint);
            leg.paw.position.copy(solved.foot);
            leg.paw.rotation.x = THREE.MathUtils.lerp(leg.paw.rotation.x, -strideWave * 0.16 * motion, expAlpha(12, dt));
            leg.paw.rotation.z = leg.side * 0.035;
        }

        this._animateTail(data, dt, t, motion, sitting, options.onShip);
        this._animateHead(data, dt, t, cat, options.lookTarget, motion);
    }

    _solveTwoBone(hip, footTarget, upperLength, lowerLength, bendForward, side) {
        const toFoot = this._tmpA.copy(footTarget).sub(hip);
        const distance = THREE.MathUtils.clamp(toFoot.length(), 0.045, upperLength + lowerLength - 0.004);
        const direction = toFoot.normalize();

        const along = (upperLength * upperLength - lowerLength * lowerLength + distance * distance) / (2 * distance);
        const height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));

        const pole = this._tmpB.set(side * 0.12, -0.05, bendForward);
        const planeNormal = this._tmpC.crossVectors(direction, pole);
        if (planeNormal.lengthSq() < 1e-6) planeNormal.set(1, 0, 0);
        planeNormal.normalize();
        const bend = this._tmpD.crossVectors(planeNormal, direction).normalize();

        const joint = hip.clone().addScaledVector(direction, along).addScaledVector(bend, height);
        const foot = hip.clone().addScaledVector(direction, distance);
        return { joint, foot };
    }

    _animateTail(data, dt, t, motion, sitting, onShip) {
        const points = [new THREE.Vector3(0, 0.48 - (sitting ? 0.11 : 0), -0.38)];
        let previous = points[0];
        const energy = THREE.MathUtils.lerp(0.38, 0.92, motion);
        for (let i = 0; i < data.tailSegments.length; i++) {
            const u = (i + 1) / data.tailSegments.length;
            const side = Math.sin(t * (2.0 + motion * 3.0) - i * 0.62 + data.hopOffset) * (0.055 + u * 0.055) * energy;
            const lift = 0.035 + Math.sin(t * 1.3 - i * 0.35) * 0.018;
            const curl = sitting ? Math.sin(u * Math.PI) * 0.11 : 0;
            const shipBalance = onShip ? Math.sin(t * 3.1 - i * 0.35) * 0.035 : 0;
            const next = previous.clone().add(new THREE.Vector3(side + curl, lift + shipBalance, -0.12 + u * 0.012));
            data.tailSegments[i].set(previous, next, THREE.MathUtils.lerp(0.046, 0.024, u));
            previous = next;
        }
    }

    _animateHead(data, dt, t, cat, lookTarget, motion) {
        let targetYaw = 0;
        let targetPitch = 0;
        if (lookTarget) {
            const localTarget = lookTarget.clone();
            data.bodyRoot.worldToLocal(localTarget);
            const relative = localTarget.sub(data.headPivot.position);
            targetYaw = THREE.MathUtils.clamp(Math.atan2(relative.x, relative.z), -0.78, 0.78);
            const flat = Math.max(0.001, Math.hypot(relative.x, relative.z));
            targetPitch = THREE.MathUtils.clamp(-Math.atan2(relative.y, flat), -0.32, 0.34);
        }
        data.headPivot.rotation.y = THREE.MathUtils.lerp(data.headPivot.rotation.y, targetYaw, expAlpha(5.5, dt));
        data.headPivot.rotation.x = THREE.MathUtils.lerp(data.headPivot.rotation.x, targetPitch + Math.sin(data.gaitPhase * 2) * 0.025 * motion, expAlpha(6.5, dt));
        data.headPivot.rotation.z = THREE.MathUtils.lerp(data.headPivot.rotation.z, data.turnLean * 0.06, expAlpha(7, dt));

        data.blinkTimer -= dt;
        if (data.blinkTimer <= 0) {
            data.blinkTimer = 2.0 + Math.random() * 4.2;
            data._blinkPhase = 0.16;
        }
        data._blinkPhase = Math.max(0, (data._blinkPhase || 0) - dt);
        const blink = data._blinkPhase > 0 ? Math.sin((data._blinkPhase / 0.16) * Math.PI) : 0;
        const eyeScaleY = Math.max(0.08, 1 - blink * 0.95);
        for (const eye of data.eyes) eye.scale.y = 1.16 * eyeScaleY;
        for (const pupil of data.pupils) pupil.scale.y = 1.25 * eyeScaleY;

        data.earTwitchTimer -= dt;
        if (data.earTwitchTimer <= 0) {
            data.earTwitchTimer = 1.2 + Math.random() * 3.2;
            data.earTwitch = (Math.random() - 0.5) * 0.55;
        }
        data.earTwitch += (0 - data.earTwitch) * expAlpha(9, dt);
        data.ears[0].rotation.x = THREE.MathUtils.lerp(data.ears[0].rotation.x, data.earTwitch, expAlpha(12, dt));
        data.ears[1].rotation.x = THREE.MathUtils.lerp(data.ears[1].rotation.x, -data.earTwitch * 0.55, expAlpha(12, dt));
    }
}

