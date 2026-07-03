// =====================================================
// PARTICLE SYSTEM - Particles & debris physics (space)
// =====================================================

import SphericalUtils from '../classes/SphericalUtils.js';
import { DEBRIS_MIN_Y } from '../constants.js';

export default class ParticleSystem {
    update(dt, context) {
        const { state, world, factory } = context;

        // Particles
        for (let i = state.particles.length - 1; i >= 0; i--) {
            const p = state.particles[i];
            p.position.addScaledVector(p.userData.vel, dt * 60); // C6: dt-normalized position integration (tuned at 60 FPS)

            // Gravity toward nearest planet
            const result = SphericalUtils.findNearestPlanet(p.position, state.islands);
            if (result.planet) {
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

                // Gravity toward nearest planet
                const result = SphericalUtils.findNearestPlanet(d.position, state.islands);
                if (result.planet) {
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
    }
}
