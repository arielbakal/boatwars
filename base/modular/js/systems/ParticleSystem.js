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
            p.position.add(p.userData.vel);

            // Gravity toward nearest planet
            const result = SphericalUtils.findNearestPlanet(p.position, state.islands);
            if (result.planet) {
                const normal = SphericalUtils.getSurfaceNormal(p.position, result.planet);
                // Pull toward planet center (opposite of normal)
                const gravity = 0.002;
                p.userData.vel.x -= normal.x * gravity;
                p.userData.vel.y -= normal.y * gravity;
                p.userData.vel.z -= normal.z * gravity;
            }

            p.userData.life -= 0.03;
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
                d.position.add(d.userData.vel);

                // Gravity toward nearest planet
                const result = SphericalUtils.findNearestPlanet(d.position, state.islands);
                if (result.planet) {
                    const normal = SphericalUtils.getSurfaceNormal(d.position, result.planet);
                    d.userData.vel.x -= normal.x * 0.01;
                    d.userData.vel.y -= normal.y * 0.01;
                    d.userData.vel.z -= normal.z * 0.01;
                }

                if (d.userData.rotVel) {
                    d.rotation.x += d.userData.rotVel.x;
                    d.rotation.y += d.userData.rotVel.y;
                    d.rotation.z += d.userData.rotVel.z;
                }
                d.scale.multiplyScalar(0.98);
                if (d.scale.x < 0.01 || d.position.length() > 500) {
                    world.remove(d);
                    factory.disposeHierarchy(d);
                    state.debris.splice(i, 1);
                }
            }
        }
    }
}
