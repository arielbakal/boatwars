// =====================================================
// TERRARIUM BIOSPHERE FAUNA V9 (DORMANT)
// =====================================================
// Legged procedural creatures, per-species locomotion, extra flora species
// and full-sphere scatter dressing.
//
// This layer never executed in the single-file prototype: it was invoked as
// `(typeof game !== 'undefined' ? game : null)` from a script block that could
// not see the engine, so its `if (!engine) return;` guard always fired. It is
// ported verbatim and gated off in patches/flags.js. See ROADMAP.md.

import {
    CREATURE_HUNGER_RATE, CREATURE_HUNGER_DEATH, CREATURE_BREED_EAT_THRESHOLD,
    CREATURE_BREED_AGE, CREATURE_HUNGER_WARN, CREATURE_WANDER_RADIUS, MAX_CREATURES
} from '../constants.js';
import EntityFactory from '../classes/EntityFactory.js';
import GameEngine from '../classes/GameEngine.js';
import SphericalUtils from '../classes/SphericalUtils.js';
import BreachSystem from '../systems/BreachSystem.js';
import EntityAISystem from '../systems/EntityAISystem.js';

export default function installBiosphereFaunaV9(engine) {
    'use strict';
    if (!engine || engine.__biosphereFaunaV9Installed) return;
    engine.__biosphereFaunaV9Installed = true;

    const JS = THREE.MathUtils;
    const alpha = (rate, dt) => 1 - Math.exp(-Math.max(0, dt || 0) * rate);
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const randItem = arr => arr[Math.floor(Math.random() * arr.length)];
    const randRange = (a, b) => a + Math.random() * (b - a);
    const colorClone = c => (c && c.isColor ? c.clone() : new THREE.Color(c || 0xffffff));

    function mat(factory, color, flat = true) {
        if (factory?.getMat) return factory.getMat(colorClone(color), flat);
        return new THREE.MeshBasicMaterial({ color: colorClone(color) });
    }

    function addEyes(head, factory, count, scale, species) {
        const eyeMat = mat(factory, 0xf6f7ff, true);
        const pupilMat = mat(factory, 0x111111, true);
        const eyeGeo = new THREE.SphereGeometry(0.045 * scale, 5, 4);
        const pupilGeo = new THREE.SphereGeometry(0.018 * scale, 5, 4);
        const eyeOffsets = count === 1
            ? [[0, 0.04, 0.18]]
            : count === 2
                ? [[-0.09, 0.04, 0.16], [0.09, 0.04, 0.16]]
                : [[-0.11, 0.02, 0.16], [0.11, 0.02, 0.16], [0, 0.11, 0.18]];
        for (const [x, y, z] of eyeOffsets) {
            const eyeRoot = new THREE.Group();
            const eyeball = new THREE.Mesh(eyeGeo, eyeMat);
            const pupil = new THREE.Mesh(pupilGeo, pupilMat);
            pupil.position.z = 0.032 * scale;
            eyeRoot.add(eyeball, pupil);
            eyeRoot.position.set(x * scale, y * scale, z * scale + (species === 'hopper' ? 0.02 : 0));
            head.add(eyeRoot);
        }
    }

    function buildLeg(factory, palette, spec) {
        const root = new THREE.Group();
        const hip = new THREE.Group();
        root.add(hip);
        const upperLen = spec.upperLen, lowerLen = spec.lowerLen;
        const bodyMat = mat(factory, palette.color, true);
        const accentMat = mat(factory, palette.accent, true);
        const footMat = mat(factory, palette.dark, true);

        const upper = new THREE.Mesh(new THREE.CylinderGeometry(spec.thick * 0.8, spec.thick, upperLen, 5), bodyMat);
        upper.position.y = -upperLen * 0.5;
        hip.add(upper);

        const knee = new THREE.Group();
        knee.position.y = -upperLen;
        hip.add(knee);

        const lower = new THREE.Mesh(new THREE.CylinderGeometry(spec.thick * 0.68, spec.thick * 0.82, lowerLen, 5), accentMat);
        lower.position.y = -lowerLen * 0.5;
        knee.add(lower);

        const ankle = new THREE.Group();
        ankle.position.y = -lowerLen;
        knee.add(ankle);

        const foot = new THREE.Mesh(new THREE.BoxGeometry(spec.footW, spec.footH, spec.footL), footMat);
        foot.position.set(0, -spec.footH * 0.35, spec.footL * 0.22);
        ankle.add(foot);

        root.userData = { hip, knee, ankle, foot };
        return root;
    }

    const originalCreateCreature = EntityFactory.prototype.createCreature;
    EntityFactory.prototype.createCreature = function biosphereFaunaCreateCreatureV9(p, x, z, style = null) {
        const dna = style || {
            color: p.creature.clone(),
            bodyShape: this.state.worldDNA.creature.shape,
            speciesType: this.state.worldDNA.creature.speciesType,
            eyeCount: this.state.worldDNA.creature.eyes,
            scale: this.state.worldDNA.creature.scale,
            eyeScale: this.state.worldDNA.creature.eyeScale,
            moveSpeed: this.state.worldDNA.creature.moveSpeed,
            temperament: this.state.worldDNA.creature.temperament,
            accentColor: (p.accent || p.floraAccent).clone(),
            trait: this.state.worldDNA.creature.trait || 'antennae',
            markings: this.state.worldDNA.creature.markings || 2,
            glow: false
        };

        const scale = dna.scale || 1;
        const mode = dna.speciesType === 'conehead' ? 'hopper' : (dna.speciesType === 'blocky' ? 'grazer' : 'stalker');
        const group = new THREE.Group();
        const rigRoot = new THREE.Group();
        group.add(rigRoot);
        group.position.set(x, 0, z);
        group.scale.set(0, 0, 0);

        const palette = {
            color: dna.color || p.creature,
            accent: dna.accentColor || p.accent || p.floraAccent,
            dark: colorClone(dna.color || p.creature).multiplyScalar(0.45)
        };
        const bodyMat = mat(this, palette.color, true);
        const accentMat = dna.glow
            ? new THREE.MeshBasicMaterial({ color: colorClone(palette.accent), transparent: true, opacity: 0.95 })
            : mat(this, palette.accent, true);
        const darkMat = mat(this, palette.dark, true);

        const torsoPivot = new THREE.Group();
        rigRoot.add(torsoPivot);
        const body = new THREE.Mesh(new THREE.DodecahedronGeometry(mode === 'hopper' ? 0.23 * scale : 0.27 * scale, 0), bodyMat);
        if (mode === 'grazer') body.scale.set(1.45, 0.95, 1.8);
        else if (mode === 'stalker') body.scale.set(1.18, 1.0, 1.65);
        else body.scale.set(1.0, 0.92, 1.2);
        body.position.y = mode === 'hopper' ? 0.54 * scale : 0.48 * scale;
        torsoPivot.add(body);

        const chest = new THREE.Mesh(new THREE.SphereGeometry(0.17 * scale, 8, 7), bodyMat);
        chest.scale.set(mode === 'grazer' ? 1.15 : 0.92, 0.95, 1.05);
        chest.position.set(0, body.position.y + 0.05 * scale, 0.16 * scale);
        torsoPivot.add(chest);

        const neck = new THREE.Group();
        neck.position.set(0, body.position.y + (mode === 'hopper' ? 0.12 : 0.18) * scale, 0.24 * scale);
        torsoPivot.add(neck);
        const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * scale, 0.08 * scale, mode === 'grazer' ? 0.24 * scale : 0.14 * scale, 5), bodyMat);
        neckMesh.rotation.x = Math.PI / 2.6;
        neckMesh.position.z = 0.06 * scale;
        neck.add(neckMesh);

        const head = new THREE.Group();
        head.position.set(0, mode === 'hopper' ? 0.04 * scale : 0.03 * scale, 0.18 * scale);
        neck.add(head);
        const headMesh = new THREE.Mesh(new THREE.DodecahedronGeometry(mode === 'grazer' ? 0.17 * scale : 0.15 * scale, 0), accentMat);
        headMesh.scale.set(mode === 'hopper' ? 0.95 : 1.1, mode === 'grazer' ? 0.95 : 1.0, mode === 'grazer' ? 1.35 : 1.05);
        head.add(headMesh);
        addEyes(head, this, dna.eyeCount || 2, (dna.eyeScale || 1.0) * scale, mode);

        const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * scale, 0.05 * scale, 0.18 * scale, 5), darkMat);
        snout.rotation.x = Math.PI / 2;
        snout.position.set(0, -0.01 * scale, 0.11 * scale);
        head.add(snout);

        const earCount = mode === 'stalker' ? 2 : (dna.trait === 'crest' ? 3 : 2);
        const appendages = [];
        for (let i = 0; i < earCount; i++) {
            const side = earCount === 2 ? (i === 0 ? -1 : 1) : (i - 1);
            const app = new THREE.Group();
            const fin = new THREE.Mesh(new THREE.ConeGeometry((dna.trait === 'ears' ? 0.045 : 0.035) * scale, (dna.trait === 'antennae' ? 0.24 : 0.18) * scale, 5), accentMat);
            fin.position.y = 0.08 * scale;
            app.add(fin);
            app.position.set(side * 0.10 * scale, 0.08 * scale + Math.abs(side) * 0.02 * scale, side === 0 ? 0.0 : -0.01 * scale);
            app.rotation.z = side * -0.25;
            head.add(app);
            appendages.push(app);
        }

        const tailRoot = new THREE.Group();
        tailRoot.position.set(0, body.position.y + 0.02 * scale, -0.24 * scale);
        torsoPivot.add(tailRoot);
        const tailSegments = [];
        let parent = tailRoot;
        const tailCount = mode === 'hopper' ? 2 : 4;
        for (let i = 0; i < tailCount; i++) {
            const seg = new THREE.Group();
            seg.position.z = i === 0 ? 0 : -0.1 * scale;
            const segMesh = new THREE.Mesh(new THREE.CylinderGeometry((0.055 - i * 0.008) * scale, (0.075 - i * 0.008) * scale, 0.14 * scale, 5), i === tailCount - 1 ? accentMat : bodyMat);
            segMesh.rotation.x = Math.PI / 2;
            segMesh.position.z = -0.06 * scale;
            seg.add(segMesh);
            parent.add(seg);
            parent = seg;
            tailSegments.push(seg);
        }
        const tailTip = new THREE.Mesh(new THREE.SphereGeometry(0.05 * scale, 6, 5), accentMat);
        tailTip.position.z = -0.10 * scale;
        parent.add(tailTip);

        const legSpecs = mode === 'hopper'
            ? [
                { x: -0.12, z: 0.10, side: -1, phase: 0.1, upperLen: 0.16 * scale, lowerLen: 0.16 * scale, thick: 0.045 * scale, footW: 0.10 * scale, footH: 0.04 * scale, footL: 0.16 * scale, front: true },
                { x: 0.12, z: 0.10, side: 1, phase: Math.PI + 0.1, upperLen: 0.16 * scale, lowerLen: 0.16 * scale, thick: 0.045 * scale, footW: 0.10 * scale, footH: 0.04 * scale, footL: 0.16 * scale, front: true },
                { x: -0.16, z: -0.12, side: -1, phase: Math.PI * 0.08, upperLen: 0.32 * scale, lowerLen: 0.28 * scale, thick: 0.06 * scale, footW: 0.13 * scale, footH: 0.05 * scale, footL: 0.20 * scale, rear: true },
                { x: 0.16, z: -0.12, side: 1, phase: Math.PI + Math.PI * 0.08, upperLen: 0.32 * scale, lowerLen: 0.28 * scale, thick: 0.06 * scale, footW: 0.13 * scale, footH: 0.05 * scale, footL: 0.20 * scale, rear: true }
            ]
            : [
                { x: -0.18, z: 0.20, side: -1, phase: 0.0, upperLen: 0.23 * scale, lowerLen: 0.19 * scale, thick: 0.05 * scale, footW: 0.11 * scale, footH: 0.04 * scale, footL: 0.16 * scale, front: true },
                { x: 0.18, z: 0.20, side: 1, phase: Math.PI, upperLen: 0.23 * scale, lowerLen: 0.19 * scale, thick: 0.05 * scale, footW: 0.11 * scale, footH: 0.04 * scale, footL: 0.16 * scale, front: true },
                { x: -0.18, z: -0.16, side: -1, phase: Math.PI, upperLen: 0.25 * scale, lowerLen: 0.22 * scale, thick: 0.055 * scale, footW: 0.12 * scale, footH: 0.04 * scale, footL: 0.18 * scale, rear: true },
                { x: 0.18, z: -0.16, side: 1, phase: 0.0, upperLen: 0.25 * scale, lowerLen: 0.22 * scale, thick: 0.055 * scale, footW: 0.12 * scale, footH: 0.04 * scale, footL: 0.18 * scale, rear: true }
            ];

        const legs = [];
        for (const spec of legSpecs) {
            const leg = buildLeg(this, palette, spec);
            leg.position.set(spec.x * scale, mode === 'hopper' && spec.rear ? 0.50 * scale : 0.46 * scale, spec.z * scale);
            torsoPivot.add(leg);
            const rec = Object.assign({ root: leg }, spec, leg.userData);
            legs.push(rec);
        }

        for (let i = 0; i < Math.min(4, dna.markings || 0); i++) {
            const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.06 * scale, 0.05 * scale, 0.20 * scale), accentMat);
            stripe.position.set((i % 2 ? 0.08 : -0.08) * scale, body.position.y + 0.06 * scale - i * 0.02 * scale, -0.05 * scale + i * 0.09 * scale);
            stripe.rotation.z = i % 2 ? 0.3 : -0.3;
            torsoPivot.add(stripe);
        }

        group.userData = {
            type: 'creature',
            speciesType: dna.speciesType || 'blobby',
            speciesMotion: mode,
            radius: mode === 'hopper' ? 0.58 * scale : 0.62 * scale,
            hunger: 0,
            age: 0,
            eatenCount: 0,
            moveSpeed: dna.moveSpeed || 0.03,
            hopOffset: Math.random() * 100,
            color: dna.color,
            bubble: null,
            style: dna,
            targetScale: scale,
            cooldown: 0,
            hp: 6,
            aggroTimer: 0,
            contactCooldown: 0,
            temperament: dna.temperament !== undefined ? dna.temperament : 1.0,
            heightOffset: mode === 'hopper' ? 0.42 : 0.36,
            bodyMesh: body,
            animPivot: torsoPivot,
            _isMoving: false,
            _moveBlend: 0,
            _lastVelocity: new THREE.Vector3(),
            kinematicRig: { mode, torsoPivot, body, chest, neck, head, headMesh, tailSegments, appendages, legs, neckMesh }
        };
        return group;
    };

    if (typeof EntityAISystem !== 'undefined' && EntityAISystem.prototype) {
        EntityAISystem.prototype._animateCreatureLocomotion = function biosphereCreatureAnimationV9(e, dt, t) {
            const rig = e.userData?.kinematicRig;
            if (!rig) return;
            const moving = !!e.userData._isMoving;
            const moveBlend = e.userData._moveBlend = JS.lerp(e.userData._moveBlend || 0, moving ? Math.max(0.28, e.userData._moveAmount || 0.7) : 0, alpha(8, dt));
            const phaseBase = (t || 0) * (rig.mode === 'hopper' ? 8.4 : 6.4) + (e.userData.hopOffset || 0);
            const breath = Math.sin((t || 0) * 2.4 + (e.userData.hopOffset || 0)) * 0.02;
            const bodyBob = Math.abs(Math.sin(phaseBase)) * 0.06 * moveBlend;
            const turnLean = clamp(e.userData._turnLean || 0, -1, 1) * 0.15 * moveBlend;
            rig.torsoPivot.position.y = JS.lerp(rig.torsoPivot.position.y, bodyBob + breath, alpha(9, dt));
            rig.torsoPivot.rotation.z = JS.lerp(rig.torsoPivot.rotation.z, turnLean, alpha(8, dt));
            rig.torsoPivot.rotation.x = JS.lerp(rig.torsoPivot.rotation.x, rig.mode === 'hopper' ? -0.08 * moveBlend : 0.05 * moveBlend, alpha(6, dt));

            if (rig.mode === 'hopper') {
                const compress = Math.max(0, Math.sin(phaseBase));
                rig.body.scale.y = JS.lerp(rig.body.scale.y, 0.92 + compress * 0.14 + (1 - moveBlend) * 0.08, alpha(10, dt));
                rig.body.scale.x = JS.lerp(rig.body.scale.x, 1.0 + (1 - rig.body.scale.y) * 0.24, alpha(10, dt));
                rig.body.scale.z = JS.lerp(rig.body.scale.z, 1.2 + (1 - rig.body.scale.y) * 0.18, alpha(10, dt));
            } else {
                rig.body.scale.y = JS.lerp(rig.body.scale.y, rig.mode === 'grazer' ? 0.95 : 1.0, alpha(10, dt));
                rig.body.scale.x = JS.lerp(rig.body.scale.x, rig.mode === 'grazer' ? 1.45 : 1.18, alpha(10, dt));
                rig.body.scale.z = JS.lerp(rig.body.scale.z, rig.mode === 'grazer' ? 1.8 : 1.65, alpha(10, dt));
            }

            const headAim = clamp(e.userData._lookYaw || 0, -1, 1) * 0.32;
            rig.neck.rotation.y = JS.lerp(rig.neck.rotation.y, headAim, alpha(6, dt));
            rig.neck.rotation.x = JS.lerp(rig.neck.rotation.x, (moving ? 0.12 : -0.05) + breath * 0.3, alpha(6, dt));
            rig.head.rotation.x = JS.lerp(rig.head.rotation.x, moving ? 0.06 : -0.04, alpha(6, dt));
            rig.head.rotation.z = JS.lerp(rig.head.rotation.z, Math.sin((t || 0) * 1.4 + (e.userData.hopOffset || 0)) * 0.04 * (1 - moveBlend), alpha(6, dt));

            for (let i = 0; i < rig.appendages.length; i++) {
                const app = rig.appendages[i];
                const local = Math.sin((t || 0) * 4.2 + i * 1.7 + (e.userData.hopOffset || 0)) * (0.08 + moveBlend * 0.06);
                app.rotation.x = JS.lerp(app.rotation.x, -0.06 + local, alpha(10, dt));
                app.rotation.z = JS.lerp(app.rotation.z, (i % 2 === 0 ? -0.25 : 0.25) + local * 0.5, alpha(10, dt));
            }

            for (let i = 0; i < rig.tailSegments.length; i++) {
                const seg = rig.tailSegments[i];
                const wag = Math.sin((t || 0) * (5.0 + moveBlend * 2.5) + i * 0.75 + (e.userData.hopOffset || 0)) * (0.16 - i * 0.022);
                seg.rotation.y = JS.lerp(seg.rotation.y, wag, alpha(8, dt));
                seg.rotation.x = JS.lerp(seg.rotation.x, -0.10 - bodyBob * 0.8, alpha(8, dt));
            }

            for (const leg of rig.legs) {
                const phase = phaseBase + leg.phase;
                const stride = Math.sin(phase);
                const lift = Math.max(0, Math.sin(phase));
                const back = Math.max(0, -Math.sin(phase));
                const hopBoost = rig.mode === 'hopper' && leg.rear ? 0.35 : 0;
                const hipBase = leg.front ? 0.12 : -0.08;
                leg.hip.rotation.x = JS.lerp(leg.hip.rotation.x, hipBase + stride * (0.55 + hopBoost) * moveBlend, alpha(11, dt));
                leg.knee.rotation.x = JS.lerp(leg.knee.rotation.x, (leg.rear ? 0.7 : 0.45) - lift * (0.55 + hopBoost) * moveBlend + back * 0.18, alpha(11, dt));
                leg.ankle.rotation.x = JS.lerp(leg.ankle.rotation.x, -0.38 + back * 0.35 * moveBlend, alpha(11, dt));
                leg.root.position.y = JS.lerp(leg.root.position.y, (rig.mode === 'hopper' && leg.rear ? 0.50 : 0.46) * e.userData.targetScale + lift * 0.04 * e.userData.targetScale * moveBlend, alpha(10, dt));
            }
        };

        EntityAISystem.prototype.updateCreature = function biosphereCreatureBehaviorV9(e, idx, dt, context) {
            const { state, world, audio, factory } = context;
            const planet = e.userData.planet;
            if (!planet) return;

            const behaviour = e.userData.behaviour || (e.userData.behaviour = {
                mode: 'wander',
                timer: 0,
                curiosity: Math.random(),
                fear: 0.4 + Math.random() * 0.5,
                grazeBias: Math.random(),
                targetPos: e.position.clone(),
                lookTimer: 0,
                wanderNormal: SphericalUtils.getSurfaceNormal(e.position, planet),
                idlePhase: Math.random() * Math.PI * 2
            });

            e.userData.age = (e.userData.age || 0) + dt;
            e.userData.hunger = (e.userData.hunger || 0) + dt * CREATURE_HUNGER_RATE;
            behaviour.timer -= dt;
            behaviour.lookTimer -= dt;

            const playerPos = state.player.pos;
            const distToPlayer = playerPos.distanceTo(e.position);
            const samePlanet = distToPlayer < planet.radius * 0.9 + 10;

            let nearestFood = null;
            let minFoodDist = Infinity;
            for (const f of state.foods) {
                const d = e.position.distanceTo(f.position);
                if (d < minFoodDist) { minFoodDist = d; nearestFood = f; }
            }

            if (e.userData.aggroTimer > 0) {
                behaviour.mode = 'chase';
                behaviour.timer = 0.3;
            } else if (behaviour.timer <= 0) {
                if (nearestFood && e.userData.hunger > CREATURE_HUNGER_WARN * 0.55 && minFoodDist < 7.5) {
                    behaviour.mode = 'feed';
                    behaviour.timer = 1.0 + Math.random() * 1.4;
                    behaviour.targetPos.copy(nearestFood.position);
                } else if (samePlanet && distToPlayer < 1.8) {
                    behaviour.mode = 'flee';
                    behaviour.timer = 1.3 + Math.random() * 1.4;
                    const away = e.position.clone().sub(playerPos).normalize();
                    behaviour.targetPos.copy(SphericalUtils.moveOnSurface(e.position, away, 2.4 + Math.random() * 1.1, planet));
                } else if (samePlanet && distToPlayer < 4.4 && behaviour.curiosity > 0.55 && e.userData.friendly) {
                    behaviour.mode = 'observe';
                    behaviour.timer = 1.2 + Math.random() * 1.2;
                    behaviour.targetPos.copy(playerPos);
                } else if (behaviour.grazeBias > 0.48 && Math.random() < 0.4) {
                    behaviour.mode = 'graze';
                    behaviour.timer = 1.3 + Math.random() * 1.8;
                    behaviour.wanderNormal.copy(SphericalUtils.randomSurfacePointNear(planet, e.position, 1.6, 3.8).sub(planet.center).normalize());
                    behaviour.targetPos.copy(planet.center).addScaledVector(behaviour.wanderNormal, SphericalUtils.sampleTerrainHeight(planet, behaviour.wanderNormal) + e.userData.heightOffset);
                } else {
                    behaviour.mode = 'wander';
                    behaviour.timer = 1.8 + Math.random() * 2.6;
                    const p = SphericalUtils.randomSurfacePointNear(planet, e.position, 1.8, 5.2);
                    behaviour.targetPos.copy(p);
                }
            }

            let desiredDir = null;
            let desiredSpeed = (e.userData.moveSpeed || 0.03) * 60 * dt;
            let shouldMove = false;

            if (behaviour.mode === 'chase') {
                // CombatSystem moves aggro fauna; we keep the procedural look/pose data alive.
                desiredDir = playerPos.clone().sub(e.position).normalize();
                desiredSpeed *= 1.75;
                shouldMove = false;
            } else if (behaviour.mode === 'observe') {
                desiredDir = playerPos.clone().sub(e.position).normalize();
                desiredSpeed *= 0.55;
                if (distToPlayer > 2.4) shouldMove = true;
            } else if (behaviour.mode === 'feed' && nearestFood) {
                desiredDir = nearestFood.position.clone().sub(e.position).normalize();
                desiredSpeed *= 0.95;
                shouldMove = minFoodDist > 0.48;
                if (minFoodDist <= 0.52) {
                    e.userData._isMoving = false;
                    audio.eat?.();
                    if (nearestFood.parent) world.remove(nearestFood);
                    const fi = state.foods.indexOf(nearestFood);
                    if (fi >= 0) state.foods.splice(fi, 1);
                    e.userData.hunger = 0;
                    e.userData.eatenCount = (e.userData.eatenCount || 0) + 1;
                    for (let j = 0; j < 3; j++) factory.createParticle(e.position.clone(), state.palette.accent, 0.5);
                    behaviour.timer = 0;
                }
            } else if (behaviour.mode === 'flee') {
                desiredDir = e.position.clone().sub(playerPos).normalize();
                desiredSpeed *= 1.4 + behaviour.fear * 0.45;
                shouldMove = true;
            } else if (behaviour.mode === 'graze' || behaviour.mode === 'wander') {
                desiredDir = behaviour.targetPos.clone().sub(e.position).normalize();
                desiredSpeed *= behaviour.mode === 'graze' ? 0.55 : 0.85;
                shouldMove = behaviour.targetPos.distanceTo(e.position) > (behaviour.mode === 'graze' ? 0.9 : 0.5);
            }

            // Herding / separation behaviour.
            if (desiredDir && shouldMove) {
                const cohesion = new THREE.Vector3();
                const separation = new THREE.Vector3();
                let neighbourCount = 0;
                for (const other of state.entities) {
                    if (other === e || other.userData?.type !== 'creature' || other.userData?.planet !== planet) continue;
                    const d = e.position.distanceTo(other.position);
                    if (d <= 0.001 || d > 3.8) continue;
                    neighbourCount++;
                    cohesion.add(other.position);
                    separation.add(e.position.clone().sub(other.position).multiplyScalar(1 / Math.max(0.15, d * d)));
                }
                if (neighbourCount > 0) {
                    cohesion.multiplyScalar(1 / neighbourCount).sub(e.position).normalize();
                    desiredDir.multiplyScalar(1.0).addScaledVector(cohesion, 0.18).addScaledVector(separation.normalize(), 0.30).normalize();
                }
            }

            if (desiredDir && shouldMove) {
                const next = SphericalUtils.moveOnSurface(e.position, desiredDir, desiredSpeed, planet);
                e.userData._lastVelocity.copy(next).sub(e.position);
                e.position.copy(next);
                e.userData._isMoving = true;
                e.userData._moveAmount = clamp(desiredSpeed / 0.08, 0, 1);
                const normal = SphericalUtils.getSurfaceNormal(e.position, planet);
                const q = SphericalUtils.getOrientationOnSurface(normal, desiredDir);
                const currentFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(e.quaternion);
                const cross = new THREE.Vector3().crossVectors(currentFwd, desiredDir);
                e.userData._turnLean = cross.dot(normal);
                e.userData._lookYaw = clamp(cross.dot(normal) * 2.0, -1, 1);
                e.quaternion.slerp(q, alpha(8, dt));
            } else {
                e.userData._lastVelocity.multiplyScalar(0.86);
                e.userData._isMoving = false;
                e.userData._moveAmount = 0;
                e.userData._turnLean = JS.lerp(e.userData._turnLean || 0, 0, alpha(5, dt));
                if (behaviour.lookTimer <= 0) {
                    behaviour.lookTimer = 1.1 + Math.random() * 1.9;
                    e.userData._lookYaw = randRange(-0.7, 0.7);
                }
            }

            // Planet bounds
            const bc = e.userData.boundCenter;
            const boundR = e.userData.boundRadius || CREATURE_WANDER_RADIUS;
            if (bc && e.position.distanceTo(bc) > boundR) {
                const dir = bc.clone().sub(e.position).normalize();
                e.position.copy(SphericalUtils.moveOnSurface(e.position, dir, 0.09 * 60 * dt, planet));
            }

            // Breeding / eggs
            const creatureCount = state.entities.filter(ent => ent.userData?.type === 'creature' || ent.userData?.type === 'egg').length;
            if (e.userData.eatenCount >= CREATURE_BREED_EAT_THRESHOLD && e.userData.age > CREATURE_BREED_AGE && creatureCount < MAX_CREATURES) {
                e.userData.eatenCount = 0;
                audio.layEgg?.();
                const egg = factory.createEgg(e.position.clone(), e.userData.color, e.userData.style);
                egg.userData.planet = planet;
                egg.userData.parentTierHpMult = e.userData.tierHpMult;
                egg.userData.parentContactDamage = e.userData.contactDamage;
                egg.userData.parentAggroMult = e.userData.aggroMult;
                egg.userData.parentFriendly = !!e.userData.friendly;
                state.entities.push(egg);
                world.add(egg);
            }

            // Hunger bubble / death
            if (e.userData.hunger > CREATURE_HUNGER_WARN) {
                if (!e.userData.bubble) {
                    e.userData.bubble = factory.createBubbleTexture('?', '#ff4444');
                    e.add(e.userData.bubble);
                    audio.hungry?.();
                }
            } else if (e.userData.bubble) {
                e.remove(e.userData.bubble);
                e.userData.bubble = null;
            }

            if (e.userData.hunger > CREATURE_HUNGER_DEATH) {
                audio.die?.();
                for (let j = 0; j < 16; j++) factory.createParticle(e.position.clone(), e.userData.color, 1.4);
                if (e.parent) world.remove(e);
                state.entities.splice(idx, 1);
                return;
            }

            const normal = SphericalUtils.getSurfaceNormal(e.position, planet);
            const idleForward = new THREE.Vector3(0, 0, 1).applyQuaternion(e.quaternion).projectOnPlane(normal).normalize();
            const idleQ = SphericalUtils.getOrientationOnSurface(normal, idleForward.lengthSq() > 0.001 ? idleForward : undefined);
            e.quaternion.slerp(idleQ, alpha(4, dt));
        };
    }

    function makeExtraFlora(kind, factory, palette, scale = 1) {
        const g = new THREE.Group();
        const flora = colorClone(palette.flora || 0x66bb66);
        const accent = colorClone(palette.accent || palette.floraAccent || 0xffcc66);
        const trunk = colorClone(palette.trunk || palette.baseRock || 0x6b5840);
        const glow = colorClone(palette.floraAccent || palette.accent || 0xccff99);
        const trunkMat = mat(factory, trunk, true);
        const floraMat = mat(factory, flora, true);
        const accentMat = mat(factory, accent, true);
        const glowMat = mat(factory, glow, true);

        if (kind === 'fern') {
            const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * scale, 0.04 * scale, 0.44 * scale, 5), trunkMat);
            stem.position.y = 0.22 * scale;
            g.add(stem);
            for (let side of [-1, 1]) {
                for (let i = 0; i < 5; i++) {
                    const leaf = new THREE.Mesh(new THREE.ConeGeometry((0.08 + i * 0.012) * scale, (0.18 + i * 0.028) * scale, 4), i % 2 ? floraMat : accentMat);
                    leaf.position.set(side * (0.08 + i * 0.028) * scale, (0.12 + i * 0.05) * scale, -i * 0.015 * scale);
                    leaf.rotation.z = side * (0.95 - i * 0.08);
                    leaf.rotation.x = side * 0.06;
                    g.add(leaf);
                }
            }
        } else if (kind === 'mushroom') {
            for (let i = 0; i < 3; i++) {
                const offsetX = (i - 1) * 0.11 * scale;
                const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025 * scale, 0.03 * scale, (0.16 + i * 0.03) * scale, 5), trunkMat);
                stem.position.set(offsetX, 0.08 * scale, i * 0.03 * scale);
                const cap = new THREE.Mesh(new THREE.SphereGeometry((0.09 + i * 0.015) * scale, 6, 5, 0, Math.PI * 2, 0, Math.PI / 2), i % 2 ? glowMat : accentMat);
                cap.scale.y = 0.65;
                cap.position.set(offsetX, stem.position.y + 0.10 * scale, i * 0.03 * scale);
                g.add(stem, cap);
            }
        } else if (kind === 'reed') {
            for (let i = 0; i < 5; i++) {
                const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018 * scale, 0.022 * scale, (0.42 + Math.random() * 0.18) * scale, 4), floraMat);
                stem.position.set((Math.random() - 0.5) * 0.18 * scale, stem.geometry.parameters.height * 0.5, (Math.random() - 0.5) * 0.18 * scale);
                stem.rotation.z = (Math.random() - 0.5) * 0.18;
                g.add(stem);
                const seed = new THREE.Mesh(new THREE.CylinderGeometry(0.02 * scale, 0.03 * scale, 0.10 * scale, 5), accentMat);
                seed.position.copy(stem.position).add(new THREE.Vector3(0, stem.geometry.parameters.height * 0.52, 0));
                g.add(seed);
            }
        } else if (kind === 'succulent') {
            const base = new THREE.Mesh(new THREE.DodecahedronGeometry(0.14 * scale, 0), trunkMat);
            base.scale.set(1.1, 0.55, 1.1);
            base.position.y = 0.06 * scale;
            g.add(base);
            for (let i = 0; i < 6; i++) {
                const a = i / 6 * Math.PI * 2;
                const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.06 * scale, 0.24 * scale, 5), i % 2 ? floraMat : glowMat);
                leaf.position.set(Math.cos(a) * 0.08 * scale, 0.12 * scale, Math.sin(a) * 0.08 * scale);
                leaf.rotation.z = Math.cos(a) * 0.5;
                leaf.rotation.x = -Math.sin(a) * 0.5;
                g.add(leaf);
            }
        } else if (kind === 'palm') {
            const trunkMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * scale, 0.09 * scale, 0.72 * scale, 6), trunkMat);
            trunkMesh.position.y = 0.36 * scale;
            trunkMesh.rotation.z = 0.12;
            g.add(trunkMesh);
            for (let i = 0; i < 7; i++) {
                const leaf = new THREE.Mesh(new THREE.ConeGeometry((0.10 + Math.random() * 0.04) * scale, (0.42 + Math.random() * 0.08) * scale, 4), i % 2 ? floraMat : accentMat);
                const a = i / 7 * Math.PI * 2;
                leaf.position.set(Math.cos(a) * 0.05 * scale, 0.74 * scale, Math.sin(a) * 0.05 * scale);
                leaf.rotation.z = Math.cos(a) * 1.1;
                leaf.rotation.x = Math.sin(a) * 1.1;
                g.add(leaf);
            }
        } else {
            const bulb = new THREE.Mesh(new THREE.DodecahedronGeometry(0.18 * scale, 0), glowMat);
            bulb.scale.set(1.0, 0.7, 1.0);
            bulb.position.y = 0.15 * scale;
            g.add(bulb);
            const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * scale, 0.04 * scale, 0.34 * scale, 5), trunkMat);
            stem.position.y = 0.16 * scale;
            g.add(stem);
            for (let i = 0; i < 4; i++) {
                const petal = new THREE.Mesh(new THREE.ConeGeometry(0.06 * scale, 0.18 * scale, 4), i % 2 ? accentMat : floraMat);
                petal.position.set(0, 0.28 * scale, 0);
                petal.rotation.y = i * Math.PI * 0.5;
                petal.rotation.z = 0.8;
                g.add(petal);
            }
        }
        g.userData = { type: 'floraExtra', heightOffset: 0.0, __v9ExtraFlora: true };
        return g;
    }

    function scatterExtras(engineRef) {
        if (!engineRef?.islandGroups?.length || !engineRef?.state?.islands?.length) return;
        const factory = engineRef.factory;
        const speciesTypes = ['blobby', 'blocky', 'conehead'];

        engineRef.islandGroups.forEach((planetObj, index) => {
            const island = engineRef.state.islands[index];
            const eco = island?.eco || {};
            const humidity = clamp(eco.humidity ?? 0.5, 0, 1);
            const temperature = clamp(eco.temperature ?? 0.5, 0, 1);
            const toxicity = clamp(eco.toxicity ?? 0.2, 0, 1);
            const palette = planetObj.palette || engineRef.state.palette;

            const biomeKinds = humidity > 0.72
                ? ['fern', 'reed', 'mushroom', 'palm', 'bloom']
                : humidity > 0.45
                    ? ['fern', 'palm', 'bloom', 'mushroom']
                    : temperature > 0.65
                        ? ['succulent', 'bloom', 'palm']
                        : ['succulent', 'fern', 'bloom'];

            const extraSmall = Math.round(10 + humidity * 18 + (index === 1 ? 10 : 0));
            const extraMid = Math.round(8 + humidity * 10 + (temperature > 0.6 ? 4 : 0));
            const extraGrass = Math.round(18 + humidity * 30 + Math.max(0, 1 - toxicity) * 8);
            const extraFauna = Math.round(index === 0 ? 3 : 2 + humidity * 3);

            for (let i = 0; i < extraSmall; i++) {
                const kind = randItem(biomeKinds);
                const decor = makeExtraFlora(kind, factory, palette, randRange(0.75, 1.3));
                engineRef.placeOnPlanet(decor, planetObj, SphericalUtils.randomSurfacePoint(planetObj, Math.PI));
                engineRef.state.entities.push(decor);
                engineRef.world.add(decor);
            }
            for (let i = 0; i < extraMid; i++) {
                const bush = factory.createBush(palette, 0, 0, engineRef._bushStyleFromDNA(engineRef.factory.generateWorldDNA(), palette));
                bush.scale.multiplyScalar(randRange(0.95, 1.35));
                engineRef.placeOnPlanet(bush, planetObj, SphericalUtils.randomSurfacePoint(planetObj, Math.PI));
                engineRef.state.entities.push(bush);
                engineRef.world.add(bush);
            }
            for (let i = 0; i < extraGrass; i++) {
                const grass = Math.random() < 0.35 ? factory.createFlower(palette, 0, 0) : factory.createGrass(palette, 0, 0, engineRef._grassStyleFromDNA(engineRef.factory.generateWorldDNA(), palette));
                grass.scale.multiplyScalar(randRange(0.8, 1.3));
                engineRef.placeOnPlanet(grass, planetObj, SphericalUtils.randomSurfacePoint(planetObj, Math.PI));
                engineRef.state.entities.push(grass);
                engineRef.world.add(grass);
            }
            // A few extra trees to break the sparse silhouette; stronger on planets 1-2.
            const extraTrees = Math.round((index <= 1 ? 4 : 2) + humidity * 4);
            for (let i = 0; i < extraTrees; i++) {
                const tree = factory.createTree(palette, 0, 0, engineRef._treeStyleFromDNA(engineRef.factory.generateWorldDNA(), palette));
                tree.scale.multiplyScalar(randRange(0.95, 1.4));
                engineRef.placeOnPlanet(tree, planetObj, SphericalUtils.randomSurfacePoint(planetObj, Math.PI));
                engineRef.state.entities.push(tree);
                engineRef.world.add(tree);
            }
            for (let i = 0; i < extraFauna; i++) {
                const creatureDNA = engineRef.factory.generateCreatureDNA(palette, speciesTypes[(i + index) % speciesTypes.length]);
                const c = engineRef.factory.createCreature(palette, 0, 0, creatureDNA);
                engineRef.placeOnPlanet(c, planetObj, SphericalUtils.randomSurfacePoint(planetObj, Math.PI));
                c.userData.boundCenter = planetObj.center.clone();
                c.userData.boundRadius = planetObj.radius * 0.88;
                c.userData.planet = planetObj;
                if (typeof engineRef._applyTier === 'function') engineRef._applyTier(c, index);
                if (index === 0) c.userData.friendly = true;
                engineRef.state.entities.push(c);
                engineRef.world.add(c);
            }
        });
    }

    const originalResetWorld = GameEngine.prototype.resetWorld;
    GameEngine.prototype.resetWorld = function biosphereResetWorldV9(...args) {
        const result = originalResetWorld.apply(this, args);
        try { scatterExtras(this); }
        catch (err) { console.warn('[Terrarium Biosphere V9] extra biome scatter failed', err); }
        return result;
    };

    BreachSystem.prototype.initialize = function biosphereBreachInitializeV9(planets, ctx) {
        this.cleanup();
        this.world = ctx.world;
        this.state = ctx.state;
        this.playerController = ctx.playerController;
        this.factory = ctx.factory;
        this.audio = ctx.audio;
        this.planets = planets.slice();
        this.completed = false;
        this.state.breachEquipped = false;
        this.state.breachAiming = false;
        this.state.breachKills = 0;
        this.state.breachTotal = 0;
        this.createWeapon();

        const counts = [0, 3, 3, 4, 4];
        this.planets.forEach((planet, index) => {
            const total = counts[index] || 0;
            const record = {
                planet,
                index,
                name: (ctx.state.islands[index] && ctx.state.islands[index].name) || planet.name || `PLANET ${index + 1}`,
                total,
                remaining: total,
                stability: index === 0 ? 100 : Math.max(18, 46 - index * 6),
                heart: index === 0 ? null : this.createWorldHeart(planet, index),
            };
            this.planetRecords.push(record);
            for (let i = 0; i < record.total; i++) this.spawnEnemy(record, i);
            this.state.breachTotal += record.total;
        });
        this.updateHud(true);
    };

    // Rebuild once so the current loaded world picks up the new biosphere and fauna rig.
    setTimeout(() => {
        try {
            if (engine?.resetWorld) engine.resetWorld();
            console.info('[Terrarium Biosphere V9] Dense flora, redesigned fauna and first-world enemy removal installed.');
        } catch (err) {
            console.warn('[Terrarium Biosphere V9] reset failed', err);
        }
    }, 40);
}
