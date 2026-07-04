// =====================================================
// PARTICLE SYSTEM - Particles & debris physics (space)
// =====================================================

import SphericalUtils from '../classes/SphericalUtils.js';
import { DEBRIS_MIN_Y } from '../constants.js';
import { easeOutQuad } from '../classes/Easing.js';

export default class ParticleSystem {
    /**
     * Remove + dispose a single damage-number sprite (texture + material, NOT the
     * shared quad geometry — see the comment in the expiry loop below). Shared by
     * that loop and GameEngine.resetWorld's full-clear so there's one disposal
     * code path instead of two copies that can drift apart.
     */
    static disposeDamageNumber(world, n) {
        world.remove(n);
        if (n.material.map) n.material.map.dispose();
        n.material.dispose();
    }

    /** Remove + dispose every live damage number — used by resetWorld() so a
     * reset doesn't leak sprite textures/materials for numbers still mid-flight. */
    clearDamageNumbers(world, state) {
        for (const n of state.damageNumbers) {
            ParticleSystem.disposeDamageNumber(world, n);
        }
        state.damageNumbers.length = 0;
    }

    update(dt, context) {
        const { state, world, factory } = context;

        // Camera shake decay — fast exponential decay toward 0, frame-rate independent.
        if (state.cameraShake > 0) {
            state.cameraShake *= Math.pow(0.001, dt);
            if (state.cameraShake < 0.001) state.cameraShake = 0;
        }

        // Particles
        for (let i = state.particles.length - 1; i >= 0; i--) {
            const p = state.particles[i];
            p.position.addScaledVector(p.userData.vel, dt * 60); // C6: dt-normalized position integration (tuned at 60 FPS)

            // Gravity toward nearest planet. findNearestPlanet returns bare null
            // while state.islands is empty (the 800ms world-reset window) — and
            // particles keep animating through that window by design.
            const result = SphericalUtils.findNearestPlanet(p.position, state.islands);
            if (result && result.planet) {
                const normal = SphericalUtils.getSurfaceNormal(p.position, result.planet);
                // Pull toward planet center (opposite of normal)
                const gravity = 0.002 * (dt * 60); // C6: dt-normalized gravity accumulation (tuned at 60 FPS)
                p.userData.vel.x -= normal.x * gravity;
                p.userData.vel.y -= normal.y * gravity;
                p.userData.vel.z -= normal.z * gravity;
            }

            p.userData.life -= 0.03 * (dt * 60); // C6: dt-normalized (tuned at 60 FPS)
            p.material.opacity = p.userData.life;
            if (p.userData.life <= 0) {
                world.remove(p);
                state.particles.splice(i, 1);
            }
        }

        // Debris
        for (let i = state.debris.length - 1; i >= 0; i--) {
            const d = state.debris[i];
            if (d.userData.vel) {
                d.position.addScaledVector(d.userData.vel, dt * 60); // C6: dt-normalized position integration (tuned at 60 FPS)

                // Gravity toward nearest planet (null while islands is empty — see above)
                const result = SphericalUtils.findNearestPlanet(d.position, state.islands);
                if (result && result.planet) {
                    const normal = SphericalUtils.getSurfaceNormal(d.position, result.planet);
                    const gravity = 0.01 * (dt * 60); // C6: dt-normalized gravity accumulation (tuned at 60 FPS)
                    d.userData.vel.x -= normal.x * gravity;
                    d.userData.vel.y -= normal.y * gravity;
                    d.userData.vel.z -= normal.z * gravity;
                }

                if (d.userData.rotVel) {
                    // C6: dt-normalize debris rotation (tuned at 60 FPS)
                    d.rotation.x += d.userData.rotVel.x * (dt * 60);
                    d.rotation.y += d.userData.rotVel.y * (dt * 60);
                    d.rotation.z += d.userData.rotVel.z * (dt * 60);
                }
                // C6: dt-normalize scale decay (tuned at 60 FPS)
                d.scale.multiplyScalar(Math.pow(0.98, dt * 60));
                if (d.scale.x < 0.01 || d.position.length() > 500) {
                    world.remove(d);
                    factory.disposeHierarchy(d);
                    state.debris.splice(i, 1);
                }
            }
        }

        // Floating combat damage numbers (spawned via EntityFactory.createDamageNumber):
        // rise + fade over their duration with easeOutQuad, then get removed and disposed.
        for (let i = state.damageNumbers.length - 1; i >= 0; i--) {
            const n = state.damageNumbers[i];
            n.userData.life += dt;
            const t = Math.min(1, n.userData.life / n.userData.duration);
            const eased = easeOutQuad(t);
            n.position.y = n.userData.startY + eased * 1.2;
            n.material.opacity = 1 - eased;
            if (t >= 1) {
                // Dispose the texture + material, but NOT n.geometry — THREE.Sprite
                // instances share one static quad geometry across the whole scene
                // (particles, speech bubbles, ...); disposing it here would break
                // every other sprite currently in the scene, not just this one.
                ParticleSystem.disposeDamageNumber(world, n);
                state.damageNumbers.splice(i, 1);
            }
        }
    }
}
