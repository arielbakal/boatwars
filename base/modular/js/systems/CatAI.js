// =====================================================
// CAT AI - Follow player on spherical planets
// =====================================================

import SphericalUtils from '../classes/SphericalUtils.js';

export default class CatAI {
    update(dt, context) {
        const { state, factory, t, playerCat: cat } = context;
        if (!cat) return;

        const catData = cat.userData;
        const playerPos = state.player.pos;
        const dist = playerPos.distanceTo(cat.position);

        // Find which planet the cat is on
        let catPlanet = cat.userData.planet;
        if (!catPlanet && state.islands.length > 0) {
            const result = SphericalUtils.findNearestPlanet(cat.position, state.islands);
            catPlanet = result.planet;
            cat.userData.planet = catPlanet;
        }
        if (!catPlanet) return;

        // Check if player is on the same planet
        const playerResult = SphericalUtils.findNearestPlanet(playerPos, state.islands);
        const playerOnCatPlanet = playerResult.planet === catPlanet && playerResult.altitude < 5;

        // On boat / boarding → handled by BoatSystem
        if (state.catOnBoat || state.catBoarding) {
            return;
        }

        // Running to boat during boarding delay
        if (state.catBoardingQueued) {
            const boat = state.boardingTargetBoat || state.activeBoat;
            if (boat) {
                const bDist = cat.position.distanceTo(boat.position);
                if (bDist > 1.5) {
                    const dir = boat.position.clone().sub(cat.position).normalize();
                    const newPos = SphericalUtils.moveOnSurface(cat.position, dir, catData.moveSpeed * 2.0, catPlanet);
                    cat.position.copy(newPos);
                    // Orient toward boat
                    const normal = SphericalUtils.getSurfaceNormal(cat.position, catPlanet);
                    const q = SphericalUtils.getOrientationOnSurface(normal, dir);
                    cat.quaternion.slerp(q, 0.2);
                    this.animateLegs(catData, t, 10, 0.06);
                }
            }
            return;
        }

        // Player on boat or different planet → idle look
        if (state.isOnBoat || !playerOnCatPlanet) {
            catData.isIdle = true;
            if (dist > 0.3) {
                const dir = playerPos.clone().sub(cat.position).normalize();
                const normal = SphericalUtils.getSurfaceNormal(cat.position, catPlanet);
                const q = SphericalUtils.getOrientationOnSurface(normal, dir);
                cat.quaternion.slerp(q, 0.05);
            }
            this.resetLegs(catData);
        } else if (dist > catData.followDist) {
            // Follow player
            catData.isIdle = false;
            const speed = dist > 5 ? catData.moveSpeed * 2.5 : catData.moveSpeed;
            const dir = playerPos.clone().sub(cat.position).normalize();
            const newPos = SphericalUtils.moveOnSurface(cat.position, dir, speed, catPlanet);
            cat.position.copy(newPos);
            const normal = SphericalUtils.getSurfaceNormal(cat.position, catPlanet);
            const q = SphericalUtils.getOrientationOnSurface(normal, dir);
            cat.quaternion.slerp(q, 0.15);
            this.animateLegs(catData, t, 8, 0.05);
        } else {
            // Idle near player
            catData.isIdle = true;
            if (dist > 0.3) {
                const dir = playerPos.clone().sub(cat.position).normalize();
                const normal = SphericalUtils.getSurfaceNormal(cat.position, catPlanet);
                const q = SphericalUtils.getOrientationOnSurface(normal, dir);
                cat.quaternion.slerp(q, 0.05);
            }
            this.resetLegs(catData);
        }

        // Tail sway
        if (catData.tail) {
            catData.tail.rotation.z = Math.sin(t * 2.5) * 0.3;
            catData.tail.rotation.x = 0.6 + Math.sin(t * 1.5) * 0.15;
        }

        // Snap to surface with bob
        const normal = SphericalUtils.getSurfaceNormal(cat.position, catPlanet);
        const heightOffset = (catData.heightOffset || 0.3) + Math.sin(t * 3 + (catData.hopOffset || 0)) * 0.015;
        const basePos = catPlanet.center.clone().add(normal.clone().multiplyScalar(catPlanet.radius + heightOffset));
        cat.position.copy(basePos);

        // Re-orient on surface
        const q = SphericalUtils.getOrientationOnSurface(normal);
        cat.quaternion.slerp(q, 0.05);

        // Clamp to planet region
        const bc = cat.userData.boundCenter;
        const maxR = cat.userData.boundRadius || catPlanet.radius * 0.8;
        if (bc) {
            const d = cat.position.distanceTo(bc);
            if (d > maxR) {
                const dir = bc.clone().sub(cat.position).normalize();
                const newPos = SphericalUtils.moveOnSurface(cat.position, dir, 0.1, catPlanet);
                cat.position.copy(newPos);
            }
        }
    }

    animateLegs(catData, t, freq, amp) {
        if (!catData.legs) return;
        const c = t * freq;
        // C9: add rotation swing (fore/aft) so legs read as walking, not just bouncing
        const swingAmp = amp * 1.5;
        catData.legs[0].position.y = 0.1 + Math.sin(c) * amp;
        catData.legs[0].rotation.x = Math.sin(c) * swingAmp;
        catData.legs[1].position.y = 0.1 + Math.sin(c + Math.PI) * amp;
        catData.legs[1].rotation.x = Math.sin(c + Math.PI) * swingAmp;
        catData.legs[2].position.y = 0.1 + Math.sin(c + Math.PI) * amp;
        catData.legs[2].rotation.x = Math.sin(c + Math.PI) * swingAmp;
        catData.legs[3].position.y = 0.1 + Math.sin(c) * amp;
        catData.legs[3].rotation.x = Math.sin(c) * swingAmp;
    }

    resetLegs(catData) {
        if (!catData.legs) return;
        catData.legs.forEach(leg => {
            leg.position.y += (0.1 - leg.position.y) * 0.1;
            // C9: relax the walk swing too, or legs freeze tilted when the cat stops
            leg.rotation.x += (0 - leg.rotation.x) * 0.1;
        });
    }
}
