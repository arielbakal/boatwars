// =====================================================
// KINETIC GAMEPLAY V3.1
// =====================================================
// Weighted cat locomotion, stable foot planting, sword-vs-breach hits,
// deliberate ship steering and the crash-wreck repair progression.

import { SHIP_COLLISION_RADIUS } from '../constants.js';
import InputHandler from '../classes/InputHandler.js';
import { getProceduralRig } from '../classes/ProceduralRig.js';
import SphericalUtils from '../classes/SphericalUtils.js';
import BoatSystem from '../systems/BoatSystem.js';
import CatAI from '../systems/CatAI.js';
import CombatSystem from '../systems/CombatSystem.js';

export default function installKineticGameplayV31(engine) {
    'use strict';
    if (!engine || engine.__kineticGameplayV31Installed) return;
    engine.__kineticGameplayV31Installed = true;

    const CFG = Object.freeze({
        catFollowDistance: 1.55,
        catRescueDistance: 13,
        catRescueDelay: 0.9,
        swordRange: 2.7,
        swordArcCos: Math.cos(70 * Math.PI / 180),
        swordDamage: 30,
        mouseYaw: 0.00175,
        mousePitch: 0.00142,
        mouseLimit: 110,
        shipScanSeconds: 0.7,
        wreckSpawnDistance: 11.5,
        wreckInteractDistance: 5.0,
        coreInteractDistance: 1.9,
        wreckSmokeSeconds: 0.13,
        hullWood: 3,
        gearRock: 3
    });

    const clampV = (v, a, b) => Math.max(a, Math.min(b, v));
    const alpha = (rate, dt) => 1 - Math.exp(-rate * Math.max(0, dt || 0));

    const runtime = {
        mouseDX: 0,
        mouseDY: 0,
        lastMouseX: 0,
        lastMouseY: 0,
        lastFrame: performance.now(),
        scanTimer: 0,
        smokeTimer: 0,
        catTrack: new WeakMap(),
        decoratedShips: new Set(),
        wreck: null,
        wreckPlanet: null,
        salvageCore: null,
        crashPickaxe: null,
        crashPickaxeBeacon: null,
        debris: [],
        repairPanel: null,
        repairMessage: '',
        repairMessageUntil: 0,
        originalBoatPromptText: null,
        tmpA: new THREE.Vector3(),
        tmpB: new THREE.Vector3(),
        tmpC: new THREE.Vector3(),
        tmpD: new THREE.Vector3(),
        tmpE: new THREE.Vector3(),
        tmpQ: new THREE.Quaternion(),
        tmpQ2: new THREE.Quaternion(),
        up: new THREE.Vector3(0, 1, 0),
        right: new THREE.Vector3(1, 0, 0),
        forward: new THREE.Vector3(0, 0, -1),
        passengerFlip: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)
    };

    function scene() {
        return engine.world?.scene || engine.world?.world || engine.world || null;
    }

    function addWorld(object) {
        if (!object) return;
        if (engine.world?.add) engine.world.add(object);
        else scene()?.add?.(object);
    }

    function removeWorld(object) {
        if (!object) return;
        if (engine.world?.remove) engine.world.remove(object);
        else object.parent?.remove?.(object);
    }

    function nearestPlanet(position) {
        if (!position || !engine.state?.islands?.length || typeof SphericalUtils === 'undefined') return null;
        try { return SphericalUtils.findNearestPlanet(position, engine.state.islands); }
        catch (_) { return null; }
    }

    function terrainPoint(planet, direction, hover = 0.04) {
        const normal = direction.clone().normalize();
        let radius = planet.radius || 1;
        try { radius = SphericalUtils.sampleTerrainHeight(planet, normal); }
        catch (_) {}
        return planet.center.clone().addScaledVector(normal, radius + hover);
    }

    function tangentAt(normal, preferred) {
        const result = (preferred || runtime.forward).clone().projectOnPlane(normal);
        if (result.lengthSq() < 0.00001) {
            try { result.copy(SphericalUtils._getArbitraryTangent(normal)); }
            catch (_) { result.set(normal.z, 0, -normal.x); }
        }
        return result.normalize();
    }

    // ------------------------------------------------------------------
    // CAT INITIALIZATION + EXISTING FOUR-LEG PROCEDURAL RIG ENHANCEMENT
    // ------------------------------------------------------------------
    function placeCatBesidePlayer(cat, context, planet) {
        const { state, playerController } = context;
        if (!cat || !planet || !state?.player?.pos) return;
        const playerPos = state.player.pos;
        const normal = runtime.tmpA.copy(playerPos).sub(planet.center).normalize();
        let preferred = runtime.forward;
        try { if (playerController?.getForward) preferred = playerController.getForward(); }
        catch (_) {}
        const forward = tangentAt(normal, preferred);
        const right = runtime.tmpC.crossVectors(normal, forward).normalize();
        const candidate = runtime.tmpD.copy(playerPos)
            .addScaledVector(forward, -CFG.catFollowDistance)
            .addScaledVector(right, 0.52);
        const catNormal = candidate.sub(planet.center).normalize();
        cat.position.copy(terrainPoint(planet, catNormal, 0.055));
        try { cat.quaternion.copy(SphericalUtils.getOrientationOnSurface(catNormal, forward)); }
        catch (_) {}
        const data = cat.userData || (cat.userData = {});
        data.planet = planet;
        data.speed = 0;
        data.isIdle = false;
        data.idleTimer = 0;
        data._kineticInitialPlanetSync = true;
        if (Array.isArray(data.legs)) {
            for (const leg of data.legs) {
                if (leg.targetLocal && leg.footLocal) leg.targetLocal.copy(leg.footLocal);
            }
        }
    }

    function ensureCatInitialized(dt, context) {
        const { state, playerCat: cat } = context;
        if (!cat || !state || state.isResettingWorld || state.isOnBoat || state.isBoardingBoat || state.catOnBoat || state.catBoarding) return;
        if (!state.islands?.length || !state.player?.pos) return;
        const result = nearestPlanet(state.player.pos);
        const planet = result?.planet;
        if (!planet || (result.altitude !== undefined && result.altitude > 8)) return;
        let track = runtime.catTrack.get(cat);
        if (!track) {
            track = { synced: false, farTime: 0 };
            runtime.catTrack.set(cat, track);
        }
        const data = cat.userData || (cat.userData = {});
        const invalid = !Number.isFinite(cat.position.x + cat.position.y + cat.position.z);
        const distance = invalid ? Infinity : cat.position.distanceTo(state.player.pos);
        if (!track.synced || !data._kineticInitialPlanetSync || data.planet !== planet || invalid) {
            placeCatBesidePlayer(cat, context, planet);
            track.synced = true;
            track.farTime = 0;
            return;
        }
        track.farTime = distance > CFG.catRescueDistance ? track.farTime + dt : 0;
        if (track.farTime > CFG.catRescueDelay) {
            placeCatBesidePlayer(cat, context, planet);
            track.farTime = 0;
        }
    }

    function patchCatAI() {
        if (typeof CatAI === 'undefined' || !CatAI.prototype || CatAI.prototype.__kineticV3) return;
        CatAI.prototype.__kineticV3 = true;
        const originalUpdate = CatAI.prototype.update;
        if (typeof originalUpdate === 'function') {
            CatAI.prototype.update = function kineticV3CatUpdate(dt, context) {
                ensureCatInitialized(dt, context);
                return originalUpdate.call(this, dt, context);
            };
        }
        const originalAnimate = CatAI.prototype._animateRig;
        if (typeof originalAnimate === 'function') {
            CatAI.prototype._animateRig = function kineticV3CatRig(cat, dt, t, planet, options) {
                const data = cat?.userData || {};
                const maxSpeed = Math.max(0.001, data.runSpeed || data.moveSpeed || 0.09);
                const speed01 = clampV(Math.abs(data.speed || 0) / maxSpeed, 0, 1.2);
                const enhanced = Object.assign({}, options || {});
                if (!enhanced.airborne && !enhanced.onShip && speed01 > 0.04) {
                    enhanced.forcedMotion = Math.max(enhanced.forcedMotion || 0, 0.23 + speed01 * 0.8);
                }
                const result = originalAnimate.call(this, cat, dt, t, planet, enhanced);
                if (Array.isArray(data.legs)) {
                    const rate = 7.0 + speed01 * 5.4;
                    for (const leg of data.legs) {
                        const phase = (t || 0) * rate + (leg.phase || 0);
                        const lift = Math.max(0, Math.sin(phase));
                        if (leg.paw) {
                            leg.paw.rotation.x = THREE.MathUtils.lerp(leg.paw.rotation.x || 0, -0.13 + lift * 0.35, alpha(14, dt));
                            leg.paw.rotation.z = THREE.MathUtils.lerp(leg.paw.rotation.z || 0, (leg.side || 0) * (0.025 + lift * 0.025), alpha(12, dt));
                        }
                    }
                }
                return result;
            };
        }
    }

    // ------------------------------------------------------------------
    // STABLE SPHERICAL GAIT
    // Removes V2's per-frame emergency foot teleports. A badly extended foot
    // becomes the next swing foot instead of being snapped across the ground.
    // ------------------------------------------------------------------
    // The locomotion this layer used to override (planted-foot stepping and pelvis
    // placement) has been replaced by the phase-driven gait in ProceduralRig, which
    // models stance/swing, terrain adaptation and spring-driven body dynamics
    // directly. Overriding it here would shadow that with the older stepper.
    function patchProceduralRig() {
        const ProceduralRig = getProceduralRig();
        if (!ProceduralRig || !ProceduralRig.prototype) return;
        ProceduralRig.prototype.__kineticV3 = true;
    }

    // ------------------------------------------------------------------
    // SWORD / BREACH ENEMY BRIDGE
    // ------------------------------------------------------------------
    function selectedType(state) {
        if (state?.selectedSlot === null || state?.selectedSlot === undefined) return null;
        return state.inventory?.[state.selectedSlot]?.type || null;
    }

    function patchSwordCombat() {
        if (typeof CombatSystem === 'undefined' || !CombatSystem.prototype || CombatSystem.prototype.__kineticV3) return;
        CombatSystem.prototype.__kineticV3 = true;
        const originalTryAttack = CombatSystem.prototype.tryAttack;
        if (typeof originalTryAttack !== 'function') return;
        CombatSystem.prototype.tryAttack = function kineticV3SwordHitsBreach(ctx) {
            const result = originalTryAttack.call(this, ctx);
            if (!result || selectedType(ctx?.state) !== 'sword') return result;
            const breach = ctx.breachSystem || engine.breachSystem;
            const state = ctx.state;
            const controller = ctx.playerController || engine.playerController;
            if (!breach?.enemies?.length || !state?.player?.pos || state.isOnBoat) return result;
            const playerPlanet = controller?.getCurrentPlanet?.();
            const up = (controller?.getSurfaceNormal?.() || runtime.up).clone().normalize();
            const forward = (state._playerForward || controller?.getForward?.() || runtime.forward).clone().projectOnPlane(up);
            if (forward.lengthSq() < 0.00001) forward.copy(runtime.forward).projectOnPlane(up);
            forward.normalize();
            let best = null;
            let bestScore = Infinity;
            let bestPoint = null;
            let bestDirection = null;
            for (const enemy of breach.enemies) {
                if (!enemy?.alive || !enemy.group || (playerPlanet && enemy.planet !== playerPlanet)) continue;
                const enemyUp = SphericalUtils.getSurfaceNormal(enemy.group.position, enemy.planet);
                const point = enemy.group.position.clone().addScaledVector(enemyUp, 0.62);
                const diff = point.clone().sub(state.player.pos);
                const distance = diff.length();
                if (distance > CFG.swordRange || distance < 0.01) continue;
                const tangentDir = diff.clone().projectOnPlane(up);
                if (tangentDir.lengthSq() < 0.00001) continue;
                tangentDir.normalize();
                const facing = forward.dot(tangentDir);
                if (facing < CFG.swordArcCos) continue;
                const score = distance - facing * 0.55;
                if (score < bestScore) {
                    best = enemy;
                    bestScore = score;
                    bestPoint = point;
                    bestDirection = tangentDir;
                }
            }
            if (best) {
                const damage = Math.max(CFG.swordDamage, (state.player.attack || 2) + 18);
                breach.damageEnemy(best, damage, bestDirection, bestPoint, ctx);
                if (best.knockback?.addScaledVector) best.knockback.addScaledVector(bestDirection, 0.58);
            }
            return result;
        };
    }

    // ------------------------------------------------------------------
    // LARGE, UNAMBIGUOUSLY ALIGNED SHIP VISUAL
    // Physics forward, cockpit, nose and mouse aim all use local -Z.
    // ------------------------------------------------------------------
    function toon(color, emissive = 0x000000, emissiveIntensity = 0) {
        const base = new THREE.Color(color);
        if (emissiveIntensity > 0) base.lerp(new THREE.Color(emissive), Math.min(0.34, emissiveIntensity * 0.18));
        return new THREE.MeshBasicMaterial({ color: base, fog: true });
    }

    function glow(color, opacity = 0.88) {
        return new THREE.MeshBasicMaterial({
            color, transparent: true, opacity, depthWrite: false,
            blending: THREE.AdditiveBlending
        });
    }

    function addMesh(parent, geometry, material, position, rotation, scale) {
        const object = new THREE.Mesh(geometry, material);
        if (position) object.position.copy(position);
        if (rotation) object.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);
        if (scale) object.scale.copy(scale);
        object.castShadow = true;
        object.receiveShadow = true;
        parent.add(object);
        return object;
    }

    function makeGear(parent, x, z, material) {
        const pivot = new THREE.Group();
        pivot.position.set(x, -0.42, z);
        parent.add(pivot);
        addMesh(pivot, new THREE.CylinderGeometry(0.045, 0.055, 0.72, 5), material,
            new THREE.Vector3(0, -0.31, 0), new THREE.Euler(0, 0, x < 0 ? -0.12 : 0.12));
        addMesh(pivot, new THREE.BoxGeometry(0.25, 0.09, 0.42), material,
            new THREE.Vector3(0, -0.66, 0.04));
        return pivot;
    }

    function decorateShip(boat) {
        if (!boat || boat.userData?.kineticV3 || !boat.add) return;
        const type = boat.userData?.type;
        if (type && type !== 'spaceship' && type !== 'boat') return;
        const mount = boat.userData?.hullPivot || boat;
        for (const child of mount.children.slice()) child.visible = false;

        const root = new THREE.Group();
        root.name = 'Kinetic V3 aligned ship shell — nose is local -Z';
        mount.add(root);

        const hullMat = toon(0x385464);
        const darkMat = toon(0x111b24);
        const panelMat = toon(0x8199a1);
        const accentMat = toon(0xb8e878, 0x557f35, 0.75);
        const warningMat = toon(0xe7894f, 0x7a2d13, 0.35);
        const glassMat = new THREE.MeshBasicMaterial({
            color: 0x79d9ea, transparent: true, opacity: 0.66, depthWrite: false
        });
        const engineGlowL = glow(0x84efff);
        const engineGlowR = engineGlowL.clone();
        const noseGlow = glow(0xd7ff9b, 0.96);

        // 6.4-unit-long hull: substantially larger than the old craft.
        addMesh(root, new THREE.CylinderGeometry(0.78, 1.02, 4.45, 7), hullMat,
            new THREE.Vector3(0, 0.08, -0.05), new THREE.Euler(-Math.PI / 2, 0, 0), new THREE.Vector3(1, 1, 0.9));
        addMesh(root, new THREE.ConeGeometry(0.79, 1.55, 7), panelMat,
            new THREE.Vector3(0, 0.07, -2.94), new THREE.Euler(-Math.PI / 2, 0, 0));
        addMesh(root, new THREE.BoxGeometry(0.48, 0.30, 2.0), darkMat,
            new THREE.Vector3(0, 0.67, 0.48));
        const canopy = addMesh(root, new THREE.SphereGeometry(0.69, 10, 6), glassMat,
            new THREE.Vector3(0, 0.68, -1.12), null, new THREE.Vector3(0.92, 0.62, 1.32));

        // Strong nose marker makes the physical forward axis visually undeniable.
        const noseBeacon = addMesh(root, new THREE.OctahedronGeometry(0.16, 0), noseGlow,
            new THREE.Vector3(0, 0.08, -3.77));
        const noseRailL = addMesh(root, new THREE.BoxGeometry(0.10, 0.10, 1.1), accentMat,
            new THREE.Vector3(-0.42, 0.18, -2.78), new THREE.Euler(0, -0.09, 0));
        const noseRailR = addMesh(root, new THREE.BoxGeometry(0.10, 0.10, 1.1), accentMat,
            new THREE.Vector3(0.42, 0.18, -2.78), new THREE.Euler(0, 0.09, 0));

        // Open two-seat deck. Occupants are rotated 180° locally to face -Z.
        addMesh(root, new THREE.BoxGeometry(1.55, 0.12, 1.72), panelMat,
            new THREE.Vector3(0, 0.82, 0.42));
        addMesh(root, new THREE.BoxGeometry(0.10, 0.32, 1.68), accentMat,
            new THREE.Vector3(-0.82, 0.98, 0.42));
        addMesh(root, new THREE.BoxGeometry(0.10, 0.32, 1.68), accentMat,
            new THREE.Vector3(0.82, 0.98, 0.42));
        addMesh(root, new THREE.BoxGeometry(0.54, 0.42, 0.34), darkMat,
            new THREE.Vector3(-0.28, 1.00, 0.82));
        addMesh(root, new THREE.BoxGeometry(0.38, 0.30, 0.30), darkMat,
            new THREE.Vector3(0.45, 0.95, 0.72));

        const wingL = new THREE.Group();
        const wingR = new THREE.Group();
        wingL.position.set(-0.72, 0.02, 0.04);
        wingR.position.set(0.72, 0.02, 0.04);
        root.add(wingL, wingR);
        addMesh(wingL, new THREE.BoxGeometry(2.35, 0.13, 0.88), panelMat,
            new THREE.Vector3(-1.08, 0, 0.08), new THREE.Euler(0, -0.10, -0.025));
        addMesh(wingR, new THREE.BoxGeometry(2.35, 0.13, 0.88), panelMat,
            new THREE.Vector3(1.08, 0, 0.08), new THREE.Euler(0, 0.10, 0.025));
        addMesh(wingL, new THREE.BoxGeometry(1.24, 0.07, 0.28), accentMat, new THREE.Vector3(-1.12, 0.10, -0.10));
        addMesh(wingR, new THREE.BoxGeometry(1.24, 0.07, 0.28), accentMat, new THREE.Vector3(1.12, 0.10, -0.10));

        const podL = new THREE.Group();
        const podR = new THREE.Group();
        podL.position.set(-1.64, -0.17, 0.31);
        podR.position.set(1.64, -0.17, 0.31);
        wingL.add(podL);
        wingR.add(podR);
        for (const pod of [podL, podR]) {
            addMesh(pod, new THREE.CylinderGeometry(0.31, 0.39, 1.35, 8), darkMat,
                new THREE.Vector3(0, 0, 0.30), new THREE.Euler(-Math.PI / 2, 0, 0));
            addMesh(pod, new THREE.TorusGeometry(0.325, 0.065, 6, 12), accentMat,
                new THREE.Vector3(0, 0, 0.89));
        }
        const flameL = addMesh(podL, new THREE.ConeGeometry(0.29, 1.15, 8), engineGlowL,
            new THREE.Vector3(0, 0, 1.48), new THREE.Euler(Math.PI / 2, 0, 0));
        const flameR = addMesh(podR, new THREE.ConeGeometry(0.29, 1.15, 8), engineGlowR,
            new THREE.Vector3(0, 0, 1.48), new THREE.Euler(Math.PI / 2, 0, 0));

        const reactor = addMesh(root, new THREE.TorusGeometry(0.77, 0.09, 7, 22), accentMat,
            new THREE.Vector3(0, 0.10, 1.20));
        const tailFinL = new THREE.Group();
        const tailFinR = new THREE.Group();
        tailFinL.position.set(-0.48, 0.35, 1.54);
        tailFinR.position.set(0.48, 0.35, 1.54);
        root.add(tailFinL, tailFinR);
        addMesh(tailFinL, new THREE.BoxGeometry(0.11, 0.88, 0.68), panelMat, new THREE.Vector3(0, 0.35, 0));
        addMesh(tailFinR, new THREE.BoxGeometry(0.11, 0.88, 0.68), panelMat, new THREE.Vector3(0, 0.35, 0));

        const gearL = makeGear(root, -0.66, 0.46, darkMat);
        const gearR = makeGear(root, 0.66, 0.46, darkMat);
        const gearN = makeGear(root, 0, -1.58, darkMat);

        const damageL = addMesh(root, new THREE.BoxGeometry(0.34, 0.12, 0.90), warningMat,
            new THREE.Vector3(-0.85, 0.24, -0.72), new THREE.Euler(0.22, 0.14, 0.32));
        const damageR = addMesh(root, new THREE.BoxGeometry(0.26, 0.10, 0.70), warningMat,
            new THREE.Vector3(0.92, -0.18, 0.92), new THREE.Euler(-0.25, -0.12, -0.44));

        root.userData.parts = {
            time: Math.random() * 20,
            wingL, wingR, podL, podR, flameL, flameR, reactor,
            tailFinL, tailFinR, gearL, gearR, gearN, canopy,
            noseBeacon, noseRailL, noseRailR, damageL, damageR,
            glowMats: [engineGlowL, engineGlowR, noseGlow]
        };
        boat.userData.kineticV3 = root;
        boat.userData.radius = Math.max(boat.userData.radius || 0, 3.7);
        runtime.decoratedShips.add(boat);
        applyWreckStage(boat, true);
    }

    function applyWreckStage(boat, immediate = false) {
        const root = boat?.userData?.kineticV3;
        const parts = root?.userData?.parts;
        const wreck = boat?.userData?.wreck;
        if (!parts || !wreck) return;
        const stage = wreck.repaired ? 3 : wreck.stage || 0;
        const a = immediate ? 1 : 0.18;
        const lerpRot = (object, axis, target) => {
            object.rotation[axis] = THREE.MathUtils.lerp(object.rotation[axis], target, a);
        };
        lerpRot(parts.wingL, 'z', stage === 0 ? 0.72 : stage === 1 ? 0.34 : stage === 2 ? 0.12 : 0);
        lerpRot(parts.wingL, 'y', stage === 0 ? 0.28 : stage === 1 ? 0.16 : 0);
        lerpRot(parts.podR, 'x', stage < 2 ? 0.82 : stage === 2 ? 0.24 : 0);
        lerpRot(parts.podR, 'z', stage < 2 ? -0.46 : 0);
        lerpRot(parts.tailFinL, 'z', stage === 0 ? -0.58 : stage === 1 ? -0.28 : 0);
        lerpRot(parts.gearL, 'z', stage < 2 ? -1.12 : 0);
        lerpRot(parts.gearR, 'z', stage < 2 ? 0.92 : 0);
        lerpRot(parts.gearN, 'x', stage < 2 ? 1.18 : 0);
        parts.damageL.visible = stage < 1;
        parts.damageR.visible = stage < 2;
        parts.flameL.visible = false;
        parts.flameR.visible = false;
        parts.reactor.material.emissiveIntensity = stage >= 3 ? 0.75 : stage === 2 ? 0.28 : 0.05;
    }

    function animateShip(boat, dt) {
        const root = boat?.userData?.kineticV3;
        const parts = root?.userData?.parts;
        if (!parts) return;
        parts.time += dt;
        const wreck = boat.userData.wreck;
        if (wreck && !wreck.repaired) {
            applyWreckStage(boat);
            parts.reactor.rotation.z += dt * (0.12 + (wreck.stage || 0) * 0.16);
            parts.noseBeacon.scale.setScalar(0.65 + Math.sin(parts.time * 5.3) * 0.10);
            parts.noseBeacon.material.opacity = 0.34 + Math.sin(parts.time * 4.7) * 0.10;
            return;
        }

        const state = engine.state;
        const stats = boat.userData.stats || {};
        const maxSpeed = Math.max(0.001, stats.maxSpeed || 1);
        const speed01 = clampV(Math.abs(stats.currentSpeed || 0) / maxSpeed, 0, 1);
        const active = state?.isOnBoat && state.activeBoat === boat;
        const flight = active ? !state.shipGrounded : false;
        const thrust = active && state.inputs?.w ? 1 : speed01;
        const a = alpha(8.5, dt);
        const sweep = (flight ? 0.12 : 0.025) + speed01 * 0.28;
        parts.wingL.rotation.y = THREE.MathUtils.lerp(parts.wingL.rotation.y, sweep, a);
        parts.wingR.rotation.y = THREE.MathUtils.lerp(parts.wingR.rotation.y, -sweep, a);
        parts.wingL.rotation.z = THREE.MathUtils.lerp(parts.wingL.rotation.z, flight ? -0.06 : 0.015, a);
        parts.wingR.rotation.z = THREE.MathUtils.lerp(parts.wingR.rotation.z, flight ? 0.06 : -0.015, a);
        const yawGimbal = active ? clampV(-runtime.lastMouseX * 0.003, -0.20, 0.20) : 0;
        const pitchGimbal = active ? clampV(runtime.lastMouseY * 0.0025, -0.17, 0.17) : 0;
        for (const pod of [parts.podL, parts.podR]) {
            pod.rotation.y = THREE.MathUtils.lerp(pod.rotation.y, yawGimbal, alpha(10, dt));
            pod.rotation.x = THREE.MathUtils.lerp(pod.rotation.x, pitchGimbal, alpha(10, dt));
        }
        parts.reactor.rotation.z += dt * (0.65 + speed01 * 7.2);
        parts.tailFinL.rotation.z = THREE.MathUtils.lerp(parts.tailFinL.rotation.z, -0.08 - sweep * 0.3, a);
        parts.tailFinR.rotation.z = THREE.MathUtils.lerp(parts.tailFinR.rotation.z, 0.08 + sweep * 0.3, a);
        parts.canopy.position.y = 0.68 + Math.sin(parts.time * 2.1) * 0.012 + speed01 * 0.025;
        const flameLength = 0.35 + thrust * 1.25 + Math.sin(parts.time * 25) * 0.05 * thrust;
        for (const flame of [parts.flameL, parts.flameR]) {
            flame.visible = thrust > 0.02;
            flame.scale.set(0.78 + thrust * 0.28, flameLength, 0.78 + thrust * 0.28);
        }
        parts.noseBeacon.scale.setScalar(0.92 + Math.sin(parts.time * 4.5) * 0.08);
        parts.noseBeacon.material.opacity = 0.78 + Math.sin(parts.time * 5.1) * 0.12;
        const retract = flight ? 1.35 : 0;
        parts.gearL.rotation.z = THREE.MathUtils.lerp(parts.gearL.rotation.z, -retract, alpha(9, dt));
        parts.gearR.rotation.z = THREE.MathUtils.lerp(parts.gearR.rotation.z, retract, alpha(9, dt));
        parts.gearN.rotation.x = THREE.MathUtils.lerp(parts.gearN.rotation.x, retract, alpha(9, dt));
    }

    function scanShips() {
        const candidates = new Set();
        if (engine.state?.activeBoat) candidates.add(engine.state.activeBoat);
        if (Array.isArray(engine.state?.entities)) {
            for (const entity of engine.state.entities) {
                if (entity?.userData?.type === 'spaceship' || entity?.userData?.hullPivot) candidates.add(entity);
            }
        }
        scene()?.traverse?.(object => {
            if (object?.userData?.type === 'spaceship') candidates.add(object);
        });
        for (const boat of candidates) decorateShip(boat);
    }

    // ------------------------------------------------------------------
    // MOUSE-DIRECTED FLIGHT, PHYSICS AND VISUALS SHARE LOCAL -Z FORWARD
    // ------------------------------------------------------------------
    function chatFocused() {
        return document.activeElement?.id === 'mp-chat-input' || document.activeElement?.id === 'chat-input';
    }

    document.addEventListener('mousemove', event => {
        const state = engine.state;
        const locked = document.pointerLockElement;
        const canvas = engine.world?.renderer?.domElement;
        if (!state?.isOnBoat || chatFocused() || !locked || (canvas && locked !== canvas)) return;
        const deliberateThrust = !!(state.inputs?.w || state.inputs?.s);
        if (!deliberateThrust) return; // free-look: let InputHandler orbit the camera without rotating the ship
        runtime.mouseDX = clampV(runtime.mouseDX + (event.movementX || 0), -CFG.mouseLimit, CFG.mouseLimit);
        runtime.mouseDY = clampV(runtime.mouseDY + (event.movementY || 0), -CFG.mouseLimit, CFG.mouseLimit);
        event.stopImmediatePropagation();
    }, true);

    function applyMouseFlight(dt, state, boat) {
        if (!state?.shipQuaternion || !boat || boat.userData?.wreck && !boat.userData.wreck.repaired) return;
        if (!(state.inputs?.w || state.inputs?.s)) {
            runtime.mouseDX = 0;
            runtime.mouseDY = 0;
            runtime.lastMouseX *= Math.exp(-9 * dt);
            runtime.lastMouseY *= Math.exp(-9 * dt);
            return;
        }
        const dx = runtime.mouseDX;
        const dy = runtime.mouseDY;
        runtime.mouseDX = 0;
        runtime.mouseDY = 0;
        runtime.lastMouseX = THREE.MathUtils.lerp(runtime.lastMouseX, dx, alpha(14, dt));
        runtime.lastMouseY = THREE.MathUtils.lerp(runtime.lastMouseY, dy, alpha(14, dt));
        if (Math.abs(dx) + Math.abs(dy) < 0.01) {
            runtime.lastMouseX *= Math.exp(-7 * dt);
            runtime.lastMouseY *= Math.exp(-7 * dt);
            return;
        }
        const q = state.shipQuaternion;
        let referenceUp;
        if (state.shipNearestPlanet && state.shipGrounded) {
            referenceUp = runtime.tmpA.copy(boat.position).sub(state.shipNearestPlanet.center).normalize();
        } else {
            referenceUp = runtime.tmpA.copy(runtime.up).applyQuaternion(q).normalize();
        }
        const yaw = clampV(-dx * CFG.mouseYaw, -0.20, 0.20);
        runtime.tmpQ.setFromAxisAngle(referenceUp, yaw);
        q.premultiply(runtime.tmpQ).normalize();
        const right = runtime.tmpB.copy(runtime.right).applyQuaternion(q).normalize();
        const pitch = clampV(-dy * CFG.mousePitch, -0.17, 0.17);
        runtime.tmpQ2.setFromAxisAngle(right, pitch);
        q.premultiply(runtime.tmpQ2).normalize();
        const stats = boat.userData.stats;
        if (state.shipGrounded && state.inputs?.w && dy < -2 && stats) {
            const threshold = Math.max(0.05, (stats.maxSpeed || 1) * 0.13);
            if ((stats.currentSpeed || 0) > threshold) state.shipGrounded = false;
        }
    }

    function correctPassengerFacing(state, boat, playerCat) {
        const bank = boat?.userData?._bankAngle || 0;
        const bankQ = runtime.tmpQ.setFromAxisAngle(new THREE.Vector3(0, 0, 1), bank);
        if (playerCat && state.catOnBoat) {
            playerCat.quaternion.copy(state.shipQuaternion).multiply(bankQ).multiply(runtime.passengerFlip);
        }
    }

    function patchBoatSystem() {
        if (typeof BoatSystem === 'undefined' || !BoatSystem.prototype || BoatSystem.prototype.__kineticV3) return;
        BoatSystem.prototype.__kineticV3 = true;

        const originalPositionPlayer = BoatSystem.prototype._positionPlayerOnShip;
        if (typeof originalPositionPlayer === 'function') {
            BoatSystem.prototype._positionPlayerOnShip = function forwardFacingPilot(state, pc, boat) {
                const result = originalPositionPlayer.call(this, state, pc, boat);
                if (pc?.playerGroup) pc.playerGroup.quaternion.multiply(runtime.passengerFlip);
                return result;
            };
        }

        const originalPhysics = BoatSystem.prototype.updateBoatPhysics;
        if (typeof originalPhysics === 'function') {
            BoatSystem.prototype.updateBoatPhysics = function alignedMouseFlight(dt, context) {
                const boat = context?.state?.activeBoat;
                if (boat) {
                    decorateShip(boat);
                    applyMouseFlight(dt, context.state, boat);
                }
                const result = originalPhysics.call(this, dt, context);
                if (boat) {
                    correctPassengerFacing(context.state, boat, context.playerCat);
                    animateShip(boat, dt);
                }
                return result;
            };
        }

        const originalFinishBoarding = BoatSystem.prototype.finishBoarding;
        if (typeof originalFinishBoarding === 'function') {
            BoatSystem.prototype.finishBoarding = function rearCameraOnBoard(context) {
                const result = originalFinishBoarding.call(this, context);
                const cameraAngle = context?.state?.player?.cameraAngle;
                if (cameraAngle) { cameraAngle.x = 0; cameraAngle.y = 0.34; }
                runtime.mouseDX = runtime.mouseDY = 0;
                return result;
            };
        }

        const originalBoard = BoatSystem.prototype.boardBoat;
        if (typeof originalBoard === 'function') {
            BoatSystem.prototype.boardBoat = function blockBrokenWreck(boat, context) {
                if (boat?.userData?.wreck && !boat.userData.wreck.repaired) {
                    flashMessage('The craft cannot fly yet. Repair it with R.');
                    return false;
                }
                return originalBoard.call(this, boat, context);
            };
        }

        const originalRepairHint = BoatSystem.prototype._updateRepairHint;
        if (typeof originalRepairHint === 'function') {
            BoatSystem.prototype._updateRepairHint = function wreckAwareRepairHint(state, boat) {
                if (boat?.userData?.wreck && !boat.userData.wreck.repaired) {
                    const hint = document.getElementById('repair-hint');
                    if (hint) hint.style.display = 'none';
                    return;
                }
                return originalRepairHint.call(this, state, boat);
            };
        }

        const originalRepair = BoatSystem.prototype.repairShip;
        if (typeof originalRepair === 'function') {
            BoatSystem.prototype.repairShip = function noGoldRepairForWreck(context) {
                if (this._nearestBoat?.userData?.wreck && !this._nearestBoat.userData.wreck.repaired) return false;
                return originalRepair.call(this, context);
            };
        }

        const originalProximity = BoatSystem.prototype.updateProximity;
        if (typeof originalProximity === 'function') {
            BoatSystem.prototype.updateProximity = function wreckAwareProximity(context) {
                const result = originalProximity.call(this, context);
                const prompt = this.ui?.boatPrompt;
                if (prompt && runtime.originalBoatPromptText === null) runtime.originalBoatPromptText = prompt.textContent;
                if (this._nearestBoat?.userData?.wreck && !this._nearestBoat.userData.wreck.repaired) {
                    if (prompt) {
                        prompt.style.display = 'block';
                        prompt.textContent = 'WRECKED SHIP · PRESS R TO REPAIR';
                    }
                } else if (prompt && runtime.originalBoatPromptText !== null) {
                    prompt.textContent = runtime.originalBoatPromptText;
                }
                return result;
            };
        }
    }

    // ------------------------------------------------------------------
    // CRASHED SHIP PROGRESSION
    // 1) 3 wood reinforces the split hull.
    // 2) 3 rock rebuilds landing gear and engine mounts.
    // 3) Retrieve the ejected reactor core and reinstall it.
    // ------------------------------------------------------------------
    function countInventory(type) {
        return (engine.state?.inventory || []).reduce((sum, item) =>
            sum + (item && item.type === type ? (item.count || 1) : 0), 0);
    }

    function consumeInventory(type, amount) {
        if (countInventory(type) < amount) return false;
        let remaining = amount;
        for (let i = 0; i < engine.state.inventory.length && remaining > 0; i++) {
            const item = engine.state.inventory[i];
            if (!item || item.type !== type) continue;
            const count = item.count || 1;
            const used = Math.min(count, remaining);
            item.count = count - used;
            remaining -= used;
            if (item.count <= 0) engine.state.inventory[i] = null;
        }
        engine.updateInventory?.();
        engine.inventorySystem?.renderInventory?.();
        engine.inventorySystem?.onInventoryChanged?.();
        return true;
    }

    function makeRepairPanel() {
        if (runtime.repairPanel || !document.body) return;
        const panel = document.createElement('div');
        panel.id = 'kinetic-v3-repair-panel';
        panel.style.cssText = [
            'position:fixed','left:18px','bottom:18px','z-index:1200','width:min(360px,calc(100vw - 36px))',
            'padding:13px 14px','border:1px solid rgba(188,240,141,.35)','border-radius:13px',
            'background:rgba(8,15,18,.84)','backdrop-filter:blur(10px)','box-shadow:0 12px 34px rgba(0,0,0,.34)',
            'color:#e8f6df','font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace','pointer-events:none'
        ].join(';');
        document.body.appendChild(panel);
        runtime.repairPanel = panel;
    }

    function flashMessage(message, seconds = 2.4) {
        runtime.repairMessage = message;
        runtime.repairMessageUntil = performance.now() + seconds * 1000;
    }

    function repairDescription(wreck) {
        if (!wreck) return '';
        if (wreck.repaired) return '<b style="color:#cfff9e">SHIP ONLINE</b><br>E board · W recenters + thrust · release W to free-look.';
        if (wreck.stage === 0) {
            return `<b>WRECK · HULL</b> — ${countInventory('wood')}/${CFG.hullWood} wood<br>Bring wood and press R.`;
        }
        if (wreck.stage === 1) {
            const toolHelp = inventoryHas('pickaxe') ? 'Mine ordinary gray rocks.' : 'Recover the blue-beacon pickaxe.';
            return `<b>WRECK · FRAME</b> — ${countInventory('rock')}/${CFG.gearRock} rock<br>${toolHelp} Then press R.`;
        }
        return wreck.coreRecovered
            ? '<b>WRECK · CORE READY</b><br>Return and press R.'
            : '<b>WRECK · CORE MISSING</b><br>Follow the green beacon and press E.';
    }

    function updateRepairPanel() {
        makeRepairPanel();
        const boat = runtime.wreck;
        const wreck = boat?.userData?.wreck;
        if (!runtime.repairPanel || !boat || !wreck) {
            if (runtime.repairPanel) runtime.repairPanel.style.display = 'none';
            return;
        }
        runtime.repairPanel.style.display = wreck.repaired && performance.now() > (wreck.completedAt || 0) + 9000 ? 'none' : 'block';
        const dist = engine.state?.player?.pos ? engine.state.player.pos.distanceTo(boat.position) : Infinity;
        const message = performance.now() < runtime.repairMessageUntil
            ? `<div style="margin-top:7px;color:#ffd092">${runtime.repairMessage}</div>` : '';
        runtime.repairPanel.innerHTML = `${repairDescription(wreck)}<br><span style="opacity:.48">Wreck distance: ${Number.isFinite(dist) ? dist.toFixed(1) : '--'}m</span>${message}`;
    }

    function makeBeacon(position, normal, color) {
        const group = new THREE.Group();
        group.position.copy(position);
        group.quaternion.setFromUnitVectors(runtime.up, normal);
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.15, depthWrite: false, blending: THREE.AdditiveBlending });
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.38, 8.5, 7, 1, true), mat);
        beam.position.y = 4.25;
        group.add(beam);
        addWorld(group);
        return group;
    }

    function inventoryHas(type) {
        return countInventory(type) > 0;
    }

    function clearCrashPickaxeMarker(removeTool = false) {
        if (runtime.crashPickaxeBeacon) removeWorld(runtime.crashPickaxeBeacon);
        runtime.crashPickaxeBeacon = null;
        if (removeTool && runtime.crashPickaxe) {
            removeWorld(runtime.crashPickaxe);
            const idx = engine.state?.entities?.indexOf?.(runtime.crashPickaxe) ?? -1;
            if (idx >= 0) engine.state.entities.splice(idx, 1);
        }
        runtime.crashPickaxe = null;
    }

    function ensureCrashPickaxe(boat) {
        const state = engine.state;
        const wreck = boat?.userData?.wreck;
        if (!state || !wreck || wreck.repaired || !wreck.planet || !engine.factory?.createPickaxe) return;

        // Once recovered, the normal inventory/tool systems own it.
        if (inventoryHas('pickaxe')) {
            clearCrashPickaxeMarker(false);
            return;
        }

        const existing = state.entities?.find?.(entity => entity?.userData?.crashSitePickaxe && entity.parent);
        if (existing) {
            runtime.crashPickaxe = existing;
            if (!runtime.crashPickaxeBeacon) {
                const n = existing.position.clone().sub(wreck.planet.center).normalize();
                runtime.crashPickaxeBeacon = makeBeacon(existing.position, n, 0x75d7ff);
            }
            return;
        }

        const planet = wreck.planet;
        const normal = boat.position.clone().sub(planet.center).normalize();
        let forward = runtime.forward.clone().applyQuaternion(wreck.baseQuaternion || boat.quaternion).projectOnPlane(normal);
        if (forward.lengthSq() < 0.00001) forward = tangentAt(normal, runtime.forward);
        else forward.normalize();
        const right = new THREE.Vector3().crossVectors(normal, forward).normalize();

        let approximate;
        try { approximate = SphericalUtils.moveOnSurface(boat.position.clone(), right, 5.4, planet); }
        catch (_) { approximate = boat.position.clone().addScaledVector(right, 5.4); }
        const toolNormal = approximate.clone().sub(planet.center).normalize();
        const toolPos = terrainPoint(planet, toolNormal, 0.13);
        const toolForward = tangentAt(toolNormal, forward);

        const tool = engine.factory.createPickaxe(state.palette, 0, 0);
        tool.position.copy(toolPos);
        tool.scale.setScalar(1.65);
        try {
            const surfaceQ = SphericalUtils.getOrientationOnSurface(toolNormal, toolForward);
            const fallenQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.18, 0.35, Math.PI / 2));
            tool.quaternion.copy(surfaceQ).multiply(fallenQ);
        } catch (_) {}
        tool.userData = Object.assign(tool.userData || {}, {
            type: 'pickaxe',
            color: null,
            heightOffset: 0.1,
            planet,
            crashSitePickaxe: true
        });
        addWorld(tool);
        state.entities.push(tool);
        runtime.crashPickaxe = tool;
        runtime.crashPickaxeBeacon = makeBeacon(toolPos, toolNormal, 0x75d7ff);
        flashMessage('Emergency pickaxe detected beside the wreck. Follow the blue beacon and press E.', 6.0);
    }

    function maintainCrashPickaxe() {
        const wreck = runtime.wreck?.userData?.wreck;
        if (!wreck || wreck.repaired) {
            clearCrashPickaxeMarker(false);
            return;
        }
        if (inventoryHas('pickaxe')) {
            clearCrashPickaxeMarker(false);
            return;
        }
        if (runtime.crashPickaxe && !runtime.crashPickaxe.parent) {
            runtime.crashPickaxe = null;
            if (runtime.crashPickaxeBeacon) {
                removeWorld(runtime.crashPickaxeBeacon);
                runtime.crashPickaxeBeacon = null;
            }
        }
        ensureCrashPickaxe(runtime.wreck);
    }

    function makeSalvageCore(planet, origin, heading) {
        const normal = origin.clone().sub(planet.center).normalize();
        const right = new THREE.Vector3().crossVectors(normal, heading).normalize();
        let approximate;
        try { approximate = SphericalUtils.moveOnSurface(origin.clone(), right, 7.2, planet); }
        catch (_) { approximate = origin.clone().addScaledVector(right, 7.2); }
        const coreNormal = approximate.clone().sub(planet.center).normalize();
        const base = terrainPoint(planet, coreNormal, 0.34);
        const group = new THREE.Group();
        group.position.copy(base);
        group.quaternion.setFromUnitVectors(runtime.up, coreNormal);
        const coreMat = toon(0xa9ef72, 0x4d9f3c, 1.8);
        const ringMat = glow(0xcfff9b, 0.88);
        const core = addMesh(group, new THREE.DodecahedronGeometry(0.34, 0), coreMat, new THREE.Vector3(0, 0.20, 0));
        const ringA = addMesh(group, new THREE.TorusGeometry(0.52, 0.055, 6, 18), ringMat, new THREE.Vector3(0, 0.20, 0), new THREE.Euler(Math.PI / 2, 0, 0));
        const ringB = addMesh(group, new THREE.TorusGeometry(0.43, 0.045, 6, 18), ringMat, new THREE.Vector3(0, 0.20, 0), new THREE.Euler(0, Math.PI / 2, 0));
        group.userData = { type: 'shipReactorCore', planet, base: base.clone(), normal: coreNormal, core, ringA, ringB, time: Math.random() * 10 };
        addWorld(group);
        group.userData.beacon = makeBeacon(base, coreNormal, 0xaaff77);
        return group;
    }

    function scatterCrashDebris(planet, wreckPosition, heading) {
        const normal = wreckPosition.clone().sub(planet.center).normalize();
        const right = new THREE.Vector3().crossVectors(normal, heading).normalize();
        const debrisMat = toon(0x29333a);
        const warningMat = toon(0xd06e3f, 0x5d1f12, 0.25);
        runtime.debris = [];
        for (let i = 0; i < 6; i++) {
            const local = heading.clone().multiplyScalar((Math.random() - 0.35) * 4.8)
                .addScaledVector(right, (Math.random() - 0.5) * 6.4);
            const dir = wreckPosition.clone().add(local).sub(planet.center).normalize();
            const pos = terrainPoint(planet, dir, 0.12);
            const piece = new THREE.Mesh(
                i % 2 ? new THREE.BoxGeometry(0.42 + Math.random() * 0.55, 0.16, 0.34 + Math.random() * 0.55) : new THREE.CylinderGeometry(0.12, 0.20, 0.65, 6),
                i % 3 ? debrisMat : warningMat
            );
            piece.position.copy(pos);
            piece.quaternion.setFromUnitVectors(runtime.up, dir);
            piece.rotateX(Math.random() * Math.PI);
            piece.rotateY(Math.random() * Math.PI);
            addWorld(piece);
            runtime.debris.push(piece);
        }
    }

    function cleanCrashObjects() {
        if (runtime.salvageCore) {
            removeWorld(runtime.salvageCore.userData?.beacon);
            removeWorld(runtime.salvageCore);
        }
        runtime.salvageCore = null;
        clearCrashPickaxeMarker(true);
        for (const debris of runtime.debris) removeWorld(debris);
        runtime.debris = [];
    }

    function spawnStarterWreck() {
        const state = engine.state;
        if (state?.phase !== 'playing' || !state.player?.pos || !state.islands?.length || !engine.factory) return;

        const existing = state.entities?.find?.(entity => entity?.userData?.starterWreck);
        if (existing) {
            runtime.wreck = existing;
            runtime.wreckPlanet = existing.userData.wreck?.planet || nearestPlanet(existing.position)?.planet || null;
            decorateShip(existing);
            ensureCrashPickaxe(existing);
            return;
        }

        const result = nearestPlanet(state.player.pos);
        const planet = result?.planet;
        if (!planet) return;
        if (runtime.wreck && runtime.wreck.parent && runtime.wreckPlanet === planet) return;
        cleanCrashObjects();

        const playerNormal = state.player.pos.clone().sub(planet.center).normalize();
        let preferred = runtime.forward;
        try { preferred = engine.playerController?.getForward?.() || preferred; }
        catch (_) {}
        const baseHeading = tangentAt(playerNormal, preferred);
        const collisionRadius = typeof SHIP_COLLISION_RADIUS !== 'undefined' ? SHIP_COLLISION_RADIUS : 1.05;
        const obstacleTypes = new Set(['tree', 'rock', 'gold_rock', 'pond', 'axe', 'sword', 'pickaxe', 'chief', 'golem', 'mountain']);
        let best = null;
        for (const angle of [0, 0.62, -0.62, 1.18, -1.18, Math.PI]) {
            const direction = baseHeading.clone().applyAxisAngle(playerNormal, angle).normalize();
            let approximateCandidate;
            try { approximateCandidate = SphericalUtils.moveOnSurface(state.player.pos.clone(), direction, CFG.wreckSpawnDistance, planet); }
            catch (_) { approximateCandidate = state.player.pos.clone().addScaledVector(direction, CFG.wreckSpawnDistance); }
            const candidateNormal = approximateCandidate.clone().sub(planet.center).normalize();
            const candidatePosition = terrainPoint(planet, candidateNormal, collisionRadius * 0.72);
            let clearance = 99;
            for (const entity of state.entities || []) {
                if (!entity?.position || !obstacleTypes.has(entity.userData?.type)) continue;
                clearance = Math.min(clearance, candidatePosition.distanceTo(entity.position) - (entity.userData?.radius || 0.5));
            }
            if (!best || clearance > best.clearance) best = { direction, normal: candidateNormal, position: candidatePosition, clearance };
        }
        const heading = best.direction;
        const normal = best.normal;
        const position = best.position;
        const transportedHeading = tangentAt(normal, heading);
        let baseQ;
        try { baseQ = SphericalUtils.getOrientationOnSurface(normal, transportedHeading); }
        catch (_) { baseQ = new THREE.Quaternion().setFromUnitVectors(runtime.up, normal); }

        const boat = engine.factory.createSpaceship(position.x, position.y, position.z, new THREE.Color(0x496878));
        const crashLocal = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.14, 0.08, 0.43));
        boat.quaternion.copy(baseQ).multiply(crashLocal);
        boat.userData.starterWreck = true;
        boat.userData.wreck = {
            planet,
            stage: 0,
            coreRecovered: false,
            repaired: false,
            baseQuaternion: baseQ.clone(),
            completedAt: 0
        };
        if (boat.userData.stats) {
            boat.userData.stats.health = 1;
            boat.userData.stats.currentSpeed = 0;
        }
        addWorld(boat);
        state.entities.push(boat);
        runtime.wreck = boat;
        runtime.wreckPlanet = planet;
        decorateShip(boat);
        applyWreckStage(boat, true);
        runtime.salvageCore = makeSalvageCore(planet, position, transportedHeading);
        scatterCrashDebris(planet, position, transportedHeading);
        ensureCrashPickaxe(boat);
        boat.userData.wreck.beacon = makeBeacon(position, normal, 0xffa065);
        flashMessage('Your ship survived the crash, but it will not fly in this condition.', 5.0);
    }

    function wreckDistance() {
        if (!runtime.wreck || !engine.state?.player?.pos) return Infinity;
        return engine.state.player.pos.distanceTo(runtime.wreck.position);
    }

    function coreDistance() {
        if (!runtime.salvageCore || !engine.state?.player?.pos) return Infinity;
        return engine.state.player.pos.distanceTo(runtime.salvageCore.position);
    }

    function emitRepairBurst(color, count = 14) {
        const boat = runtime.wreck;
        if (!boat) return;
        for (let i = 0; i < count; i++) {
            try { engine.factory?.createParticle?.(boat.position.clone(), new THREE.Color(color), 1.2); }
            catch (_) {}
        }
    }

    function completeWreckRepair() {
        const boat = runtime.wreck;
        const wreck = boat?.userData?.wreck;
        if (!boat || !wreck) return;
        wreck.stage = 3;
        wreck.repaired = true;
        wreck.completedAt = performance.now();
        boat.quaternion.copy(wreck.baseQuaternion);
        if (boat.userData.stats) {
            boat.userData.stats.health = boat.userData.stats.maxHealth || 100;
            boat.userData.stats.currentSpeed = 0;
        }
        removeWorld(wreck.beacon);
        wreck.beacon = null;
        for (const debris of runtime.debris) removeWorld(debris);
        runtime.debris = [];
        applyWreckStage(boat, true);
        emitRepairBurst(0xb8ff82, 34);
        engine.audio?.boatBuild?.();
        flashMessage('Ship systems online. The nose marker, cockpit and thrust now all face the same direction.', 6.0);
    }

    function tryRepairWreck() {
        const boat = runtime.wreck;
        const wreck = boat?.userData?.wreck;
        if (!boat || !wreck || wreck.repaired || wreckDistance() > CFG.wreckInteractDistance) return false;
        if (wreck.stage === 0) {
            if (!consumeInventory('wood', CFG.hullWood)) {
                flashMessage(`Need ${CFG.hullWood} wood to reinforce the hull.`);
                return true;
            }
            wreck.stage = 1;
            applyWreckStage(boat);
            emitRepairBurst(0xc68b55);
            engine.audio?.pickup?.();
            flashMessage(inventoryHas('pickaxe') ? 'Hull braced. Mine 3 gray rocks with the pickaxe.' : 'Hull braced. Recover the blue-beacon emergency pickaxe, then mine 3 gray rocks.');
            return true;
        }
        if (wreck.stage === 1) {
            if (!consumeInventory('rock', CFG.gearRock)) {
                flashMessage(`Need ${CFG.gearRock} rock to rebuild the landing frame.`);
                return true;
            }
            wreck.stage = 2;
            applyWreckStage(boat);
            emitRepairBurst(0x9ca6a9);
            engine.audio?.pickup?.();
            flashMessage('Frame stabilized. Now recover the green reactor core.');
            return true;
        }
        if (!wreck.coreRecovered) {
            flashMessage('The reactor core is still outside the ship. Follow the green signal.');
            return true;
        }
        completeWreckRepair();
        return true;
    }

    function tryCollectCore() {
        const wreck = runtime.wreck?.userData?.wreck;
        const core = runtime.salvageCore;
        if (!wreck || wreck.repaired || wreck.coreRecovered || !core || coreDistance() > CFG.coreInteractDistance) return false;
        wreck.coreRecovered = true;
        const corePos = core.position.clone();
        removeWorld(core.userData?.beacon);
        removeWorld(core);
        runtime.salvageCore = null;
        for (let i = 0; i < 22; i++) {
            try { engine.factory?.createParticle?.(corePos.clone(), new THREE.Color(0xaaff74), 1.4); }
            catch (_) {}
        }
        engine.audio?.pickup?.();
        flashMessage('Reactor core recovered. Return to the ship and press R.');
        return true;
    }

    function updateCrashAnimation(dt) {
        const wreck = runtime.wreck;
        const data = wreck?.userData?.wreck;
        if (wreck && data && !data.repaired) {
            runtime.smokeTimer -= dt;
            if (runtime.smokeTimer <= 0) {
                runtime.smokeTimer = CFG.wreckSmokeSeconds;
                const normal = wreck.position.clone().sub(data.planet.center).normalize();
                const p = wreck.position.clone().addScaledVector(normal, 0.75)
                    .add(runtime.tmpA.set((Math.random() - 0.5) * 0.55, 0, (Math.random() - 0.5) * 0.55).applyQuaternion(wreck.quaternion));
                try { engine.factory?.createParticle?.(p, new THREE.Color(Math.random() > 0.25 ? 0x3d4748 : 0xff8a45), 0.8); }
                catch (_) {}
            }
        }
        const core = runtime.salvageCore;
        if (core?.userData) {
            const d = core.userData;
            d.time += dt;
            core.position.copy(d.base).addScaledVector(d.normal, Math.sin(d.time * 2.2) * 0.10);
            d.core.rotation.y += dt * 1.8;
            d.ringA.rotation.z += dt * 1.25;
            d.ringB.rotation.x -= dt * 0.95;
        }
    }

    function patchConstruction() {
        if (typeof InputHandler !== 'undefined' && InputHandler.prototype) {
            InputHandler.prototype.checkForBoat = function disableFourLogShip() {
                // Placed logs remain valid world objects, but no longer synthesize a spacecraft.
                return false;
            };
            InputHandler.prototype.updateBuildProgress = function wreckProgressInstead() {
                const progress = this.engine?.ui?.boatBuildProgress;
                if (progress) progress.style.display = 'none';
            };
        }
        const hint = engine.ui?.craftHint || document.getElementById('craft-hint');
        if (hint) {
            hint.textContent = 'Your ship crashed nearby. Gather materials and repair the wreck instead of building one from logs.';
            hint.style.display = 'none';
        }
        if (engine.state) {
            engine.state.hasShownCraftHint = true;
            engine.state.craftHintTimer = 0;
        }
        const objective = document.querySelector('#solar-intro .intro-objectives > div:nth-child(2) span');
        if (objective) objective.textContent = 'Find the crashed spacecraft, recover its emergency pickaxe, repair the hull and frame, reinstall the reactor core, then break orbit.';
    }

    document.addEventListener('keydown', event => {
        if (chatFocused() || event.repeat || engine.state?.phase !== 'playing') return;
        const key = event.key.toLowerCase();
        if (key === 'w' && engine.state?.isOnBoat) {
            const ca = engine.state.player?.cameraAngle;
            if (ca) { ca.x = 0; ca.y = 0.34; }
            runtime.mouseDX = runtime.mouseDY = 0;
        }
        if (key === 'e' && tryCollectCore()) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }
        if (key === 'e' && runtime.wreck?.userData?.wreck && !runtime.wreck.userData.wreck.repaired && wreckDistance() <= CFG.wreckInteractDistance) {
            flashMessage('This is a wreck, not a usable vehicle yet. Press R to repair it.');
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }
        if (key === 'r' && !engine.state?.isOnBoat && tryRepairWreck()) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }, true);

    function maintenanceFrame(now) {
        const dt = Math.min(0.05, Math.max(0, (now - runtime.lastFrame) / 1000));
        runtime.lastFrame = now;
        runtime.scanTimer -= dt;
        if (runtime.scanTimer <= 0) {
            runtime.scanTimer = CFG.shipScanSeconds;
            scanShips();
            spawnStarterWreck();
            maintainCrashPickaxe();
        }
        updateCrashAnimation(dt);
        updateRepairPanel();
        for (const boat of runtime.decoratedShips) {
            if (!boat?.parent) {
                runtime.decoratedShips.delete(boat);
                continue;
            }
            if (!(engine.state?.isOnBoat && engine.state.activeBoat === boat)) animateShip(boat, dt);
        }
        requestAnimationFrame(maintenanceFrame);
    }

    try { patchCatAI(); } catch (error) { console.warn('[Kinetic V3.1] Cat patch failed:', error); }
    try { patchProceduralRig(); } catch (error) { console.warn('[Kinetic V3.1] Gait patch failed:', error); }
    try { patchSwordCombat(); } catch (error) { console.warn('[Kinetic V3.1] Sword patch failed:', error); }
    try { patchBoatSystem(); } catch (error) { console.warn('[Kinetic V3.1] Ship patch failed:', error); }
    try { patchConstruction(); } catch (error) { console.warn('[Kinetic V3.1] Wreck progression patch failed:', error); }

    requestAnimationFrame(maintenanceFrame);
    console.info('[Artistic Unlit V4] Color-seeded ecology, richer terrain/fauna/flora, clear starter cache and deliberate ship steering installed.');
}
