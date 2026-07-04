// =====================================================
// ENTITY AI SYSTEM - Adapted for spherical planets
// =====================================================

import {
    CREATURE_HUNGER_RATE, CREATURE_HUNGER_WARN, CREATURE_HUNGER_DEATH,
    CREATURE_BREED_EAT_THRESHOLD, CREATURE_BREED_AGE, CREATURE_WANDER_RADIUS,
    FOOD_PRODUCTION_TIME, EGG_HATCH_TIME, MAX_CREATURES, MAX_FOODS,
    AGGRO_RANGE, AGGRO_BASE_CHANCE, CREATURE_AGGRO_DURATION
} from '../constants.js';
import SphericalUtils from '../classes/SphericalUtils.js';
import { smoothFactor } from '../classes/Easing.js';

export default class EntityAISystem {
    update(dt, context) {
        const { state, world, audio, factory, t } = context;

        for (let i = state.entities.length - 1; i >= 0; i--) {
            const e = state.entities[i];

            // Skip AI/animation for entities that are dying (CombatSystem owns their
            // shrink-and-remove). Prevents re-targeting, re-scaling, and double removal.
            if (e.userData._dying) continue;

            // Pop-in scale
            if (e.scale.x < 0.99) e.scale.lerp(new THREE.Vector3(1, 1, 1), smoothFactor(0.05, dt));

            // --- Golem Animation ---
            if (e.userData.type === 'golem') {
                const time = t * 2;
                // Bob in local Y (surface normal direction)
                const planet = e.userData.planet;
                if (planet) {
                    const normal = SphericalUtils.getSurfaceNormal(e.position, planet);
                    // Use cached terrain radius; refresh when entity moves more than 0.5 units
                    const cachedPos = e.userData._terrainCachePos;
                    if (!cachedPos || cachedPos.distanceToSquared(e.position) > 0.25) {
                        e.userData._terrainRadius = SphericalUtils.sampleTerrainHeight(planet, normal);
                        e.userData._terrainCachePos = e.position.clone();
                    }
                    const terrainRadius = e.userData._terrainRadius || planet.radius;
                    const basePos = planet.center.clone().add(normal.clone().multiplyScalar(terrainRadius + (e.userData.heightOffset || 2.2)));
                    e.position.copy(basePos).add(normal.clone().multiplyScalar(Math.sin(time) * 0.1));
                }
                // C9: arms 180° out of phase (was sin/cos = 90° shimmy)
                if (e.userData.lArm) e.userData.lArm.rotation.x = Math.sin(time) * 0.15;
                if (e.userData.rArm) e.userData.rArm.rotation.x = -Math.sin(time) * 0.15;
                if (e.userData.legs) {
                    e.userData.legs.forEach((leg, idx) => {
                        leg.scale.y = 1 + Math.sin(time + idx) * 0.05;
                    });
                }
                if (state.player.pos.distanceTo(e.position) < 15) {
                    // C9: slerp head toward player instead of instant lookAt
                    const targetPos = state.player.pos.clone();
                    const tmpObj = new THREE.Object3D();
                    tmpObj.position.copy(e.position);
                    tmpObj.lookAt(targetPos);
                    e.quaternion.slerp(tmpObj.quaternion, smoothFactor(0.05, dt));
                }
            }

            // --- Creature / Chief bob on sphere surface ---
            if (e.userData.type === 'creature' || e.userData.type === 'chief') {
                const planet = e.userData.planet;
                if (planet) {
                    const normal = SphericalUtils.getSurfaceNormal(e.position, planet);
                    // Use cached terrain radius; refresh when entity moves more than 0.5 units
                    const cachedPos = e.userData._terrainCachePos;
                    if (!cachedPos || cachedPos.distanceToSquared(e.position) > 0.25) {
                        e.userData._terrainRadius = SphericalUtils.sampleTerrainHeight(planet, normal);
                        e.userData._terrainCachePos = e.position.clone();
                    }
                    const terrainRadius = e.userData._terrainRadius || planet.radius;
                    const heightOffset = (e.userData.heightOffset || 0.3) + Math.sin(t * 4 + (e.userData.hopOffset || 0)) * 0.03;
                    const basePos = planet.center.clone().add(normal.clone().multiplyScalar(terrainRadius + heightOffset));
                    e.position.copy(basePos);
                }
            }

            // --- Food production (trees & bushes) ---
            if (e.userData.type === 'tree' || e.userData.type === 'bush') {
                e.userData.productionTimer = (e.userData.productionTimer || 0) + dt;
                if (e.userData.productionTimer > FOOD_PRODUCTION_TIME && state.foods.length < MAX_FOODS) {
                    e.userData.productionTimer = 0;
                    const planet = e.userData.planet;
                    if (planet) {
                        const foodPos = SphericalUtils.randomSurfacePointNear(planet, e.position, 0.3, 1.2);
                        const normal = SphericalUtils.getSurfaceNormal(foodPos, planet);
                        const foodWorldPos = planet.center.clone().add(normal.clone().multiplyScalar(planet.radius + 0.15));
                        const food = new THREE.Mesh(
                            new THREE.IcosahedronGeometry(0.15),
                            world.getMat(state.palette.accent)
                        );
                        food.position.copy(foodWorldPos);
                        food.scale.set(0, 0, 0);
                        food.userData.planet = planet;
                        world.add(food);
                        state.foods.push(food);
                    }
                }
            }

            // --- Creature AI ---
            if (e.userData.type === 'creature' && !e.userData.held) {
                this.updateCreature(e, i, dt, context);
            }

            // --- Egg hatching ---
            if (e.userData.type === 'egg') {
                this.updateEgg(e, i, dt, context);
            }
        }

        // --- Food animation ---
        state.foods.forEach(f => {
            if (f.scale.x < 0.99) f.scale.lerp(new THREE.Vector3(1, 1, 1), smoothFactor(0.05, dt));
            const planet = f.userData.planet;
            if (planet) {
                const normal = SphericalUtils.getSurfaceNormal(f.position, planet);
                const bobHeight = 0.15 + Math.sin(t * 3 + f.position.x) * 0.05;
                const basePos = planet.center.clone().add(normal.clone().multiplyScalar(planet.radius + bobHeight));
                f.position.copy(basePos);
            }
            f.rotation.y += 0.02 * (dt * 60); // C6: dt-normalized (tuned at 60 FPS)
        });
    }

    updateCreature(e, idx, dt, context) {
        const { state, world, audio, factory } = context;
        const planet = e.userData.planet;

        e.userData.age = (e.userData.age || 0) + dt;
        e.userData.hunger = (e.userData.hunger || 0) + dt * CREATURE_HUNGER_RATE;

        // A1: ambient aggro — creatures can turn hostile unprovoked when the player
        // lingers nearby, reusing the same aggroTimer that _damageEntity sets on hit.
        // AGGRO_RANGE (6) is tiny next to the gap between any two planets, so the
        // distance check alone keeps this planet-local without an explicit planet match.
        if ((!e.userData.aggroTimer || e.userData.aggroTimer <= 0) && !state.isDead && state.invincibleTimer <= 0) {
            const distToPlayer = e.position.distanceTo(state.player.pos);
            if (distToPlayer < AGGRO_RANGE) {
                const temperament = e.userData.temperament !== undefined ? e.userData.temperament : 1.0;
                const tierAggroMult = e.userData.aggroMult !== undefined ? e.userData.aggroMult : 1.0;
                if (Math.random() < AGGRO_BASE_CHANCE * temperament * tierAggroMult * dt) {
                    e.userData.aggroTimer = CREATURE_AGGRO_DURATION;
                }
            }
        }

        if (!e.userData.aggroTimer || e.userData.aggroTimer <= 0) {
            let nearestFood = null, minDist = Infinity;
            state.foods.forEach(f => {
                const d = e.position.distanceTo(f.position);
                if (d < minDist) { minDist = d; nearestFood = f; }
            });

            if (nearestFood && minDist < 0.5) {
                audio.eat();
                world.remove(nearestFood);
                state.foods.splice(state.foods.indexOf(nearestFood), 1);
                e.userData.hunger = 0;
                e.userData.eatenCount = (e.userData.eatenCount || 0) + 1;
                for (let j = 0; j < 3; j++) factory.createParticle(e.position.clone(), state.palette.accent, 0.5);

                const creatureCount = state.entities.filter(ent => ent.userData.type === 'creature' || ent.userData.type === 'egg').length;
                if (e.userData.eatenCount >= CREATURE_BREED_EAT_THRESHOLD && e.userData.age > CREATURE_BREED_AGE && creatureCount < MAX_CREATURES) {
                    e.userData.eatenCount = 0;
                    audio.layEgg();
                    const egg = factory.createEgg(e.position.clone(), e.userData.color, e.userData.style);
                    egg.userData.planet = planet;
                    // Inherit the parent's planet-tier stats (stamped by GameEngine._applyTier
                    // at world-gen spawn) so hatchlings match the difficulty of their planet
                    // instead of resetting to the factory's default (untiered) baseline.
                    egg.userData.parentTierHpMult = e.userData.tierHpMult;
                    egg.userData.parentContactDamage = e.userData.contactDamage;
                    egg.userData.parentAggroMult = e.userData.aggroMult;
                    state.entities.push(egg);
                    world.add(egg);
                }
            } else if (nearestFood && minDist < 3) {
                // Move toward food on sphere surface
                if (planet) {
                    const dir = nearestFood.position.clone().sub(e.position).normalize();
                    const newPos = SphericalUtils.moveOnSurface(e.position, dir, e.userData.moveSpeed, planet);
                    e.position.copy(newPos);
                    // Orient to face food
                    const normal = SphericalUtils.getSurfaceNormal(e.position, planet);
                    const q = SphericalUtils.getOrientationOnSurface(normal, dir);
                    e.quaternion.slerp(q, smoothFactor(0.1, dt));
                }
            } else {
                // Wander on sphere surface
                e.userData.cooldown = (e.userData.cooldown || 0) - dt;
                if (e.userData.cooldown <= 0) {
                    e.userData.cooldown = 1 + Math.random() * 2;
                    e.userData.wanderDir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
                }
                if (e.userData.wanderDir && planet) {
                    const newPos = SphericalUtils.moveOnSurface(e.position, e.userData.wanderDir, e.userData.moveSpeed * 0.5, planet);
                    e.position.copy(newPos);
                }
            }
        }

        // Bound to planet region
        if (planet) {
            const bc = e.userData.boundCenter;
            const boundR = e.userData.boundRadius || CREATURE_WANDER_RADIUS;
            if (bc) {
                const dist = e.position.distanceTo(bc);
                if (dist > boundR) {
                    // Push back toward bound center
                    const dir = bc.clone().sub(e.position).normalize();
                    const newPos = SphericalUtils.moveOnSurface(e.position, dir, 0.1, planet);
                    e.position.copy(newPos);
                }
            }

            // Re-orient on surface
            const normal = SphericalUtils.getSurfaceNormal(e.position, planet);
            const q = SphericalUtils.getOrientationOnSurface(normal);
            e.quaternion.slerp(q, smoothFactor(0.05, dt));
        }

        // Hungry warning
        if (e.userData.hunger > CREATURE_HUNGER_WARN) {
            if (!e.userData.bubble) {
                e.userData.bubble = factory.createBubbleTexture('?', '#ff4444');
                e.add(e.userData.bubble);
                audio.hungry();
            }
        } else if (e.userData.bubble) {
            e.remove(e.userData.bubble);
            e.userData.bubble = null;
        }

        // Death by starvation
        if (e.userData.hunger > CREATURE_HUNGER_DEATH) {
            audio.die();
            for (let j = 0; j < 20; j++) factory.createParticle(e.position.clone(), e.userData.color, 1.5);
            world.remove(e);
            state.entities.splice(idx, 1);
            if (state.obstacles.includes(e)) state.obstacles.splice(state.obstacles.indexOf(e), 1);
        }
    }

    updateEgg(e, idx, dt, context) {
        const { state, world, audio, factory, t } = context;

        e.userData.hatchTimer = (e.userData.hatchTimer || EGG_HATCH_TIME) - dt;
        // C4: Wobble grows stronger as egg approaches hatching (hatchTimer → 0).
        const hatchProgress = 1 - Math.max(0, e.userData.hatchTimer / EGG_HATCH_TIME);
        const wobble = Math.sin(t * 5 + (e.userData.wobblePhase || 0)) * 0.1 * hatchProgress;

        // Keep the egg group oriented flush to the planet surface (Y-up = surface normal),
        // like every other surface entity. The group's quaternion holds that orientation.
        const planet = e.userData.planet;
        if (planet) {
            const normal = SphericalUtils.getSurfaceNormal(e.position, planet);
            e.quaternion.copy(SphericalUtils.getOrientationOnSurface(normal));
        }
        // Apply the wobble to the egg MESH (child), not the group. Writing e.rotation here
        // would recompute e.quaternion from Euler and clobber the surface orientation above
        // (rotation and quaternion both feed the same matrix; last write wins). Rocking the
        // child keeps the surface-aligned group frame intact.
        const eggMesh = e.children[0];
        if (eggMesh) eggMesh.rotation.x = wobble; // side-to-side rock in the surface-aligned frame

        if (e.userData.hatchTimer <= 0) {
            audio.pop();
            for (let j = 0; j < 10; j++) factory.createParticle(e.position.clone(), e.userData.color, 1);
            const baby = factory.createCreature(state.palette, 0, 0, e.userData.parentDNA);
            baby.position.copy(e.position);
            baby.quaternion.copy(e.quaternion);
            baby.scale.set(0.5, 0.5, 0.5);
            baby.userData.targetScale = 0.7 + Math.random() * 0.3;
            baby.userData.planet = e.userData.planet;
            // Inherit the parent's planet-tier stats (mirrors GameEngine._applyTier) —
            // without this, hatchlings reset to createCreature's default hp/damage/aggro
            // regardless of which planet they hatch on.
            if (e.userData.parentTierHpMult !== undefined) {
                baby.userData.hp *= e.userData.parentTierHpMult;
                // Re-stamp the multiplier so the baby's own future eggs inherit it too.
                baby.userData.tierHpMult = e.userData.parentTierHpMult;
            }
            if (e.userData.parentContactDamage !== undefined) baby.userData.contactDamage = e.userData.parentContactDamage;
            if (e.userData.parentAggroMult !== undefined) baby.userData.aggroMult = e.userData.parentAggroMult;
            if (e.userData.planet) {
                baby.userData.boundCenter = e.userData.planet.center.clone();
                baby.userData.boundRadius = e.userData.planet.radius * 0.85;
            }
            state.entities.push(baby);
            world.add(baby);
            world.remove(e);
            state.entities.splice(idx, 1);
        }
    }
}
