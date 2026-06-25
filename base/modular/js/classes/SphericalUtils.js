// =====================================================
// SPHERICAL UTILS - Shared math for spherical planet worlds
// =====================================================

// Shared raycaster instance for terrain sampling — avoids per-call allocation.
// Lazily initialized on first use so THREE global is guaranteed to be ready.
let _terrainRaycaster = null;

export default class SphericalUtils {
    /**
     * Get the surface normal (up direction) at a position on a planet.
     * @param {THREE.Vector3} pos - World position
     * @param {Object} planet - { center: THREE.Vector3, radius: number }
     * @returns {THREE.Vector3} Normalized surface normal
     */
    static getSurfaceNormal(pos, planet) {
        return pos.clone().sub(planet.center).normalize();
    }

    /**
     * Snap a position to the surface of a planet at a given height above surface.
     * @param {THREE.Vector3} pos - Position to snap
     * @param {Object} planet - { center: THREE.Vector3, radius: number }
     * @param {number} height - Height above surface (default 0)
     * @returns {THREE.Vector3} Snapped position
     */
    static snapToSurface(pos, planet, height = 0) {
        const normal = SphericalUtils.getSurfaceNormal(pos, planet);
        return planet.center.clone().add(normal.multiplyScalar(planet.radius + height));
    }

    /**
     * Get the distance from a point to the surface of a planet.
     * Positive = above surface, negative = below.
     * @param {THREE.Vector3} pos
     * @param {Object} planet
     * @returns {number}
     */
    static getAltitude(pos, planet) {
        return pos.distanceTo(planet.center) - planet.radius;
    }

    /**
     * Find the nearest planet to a position.
     * @param {THREE.Vector3} pos
     * @param {Array} planets - Array of { center: THREE.Vector3, radius: number }
     * @returns {{ planet: Object, distance: number, altitude: number } | null}
     */
    static findNearestPlanet(pos, planets) {
        let nearest = null;
        let minAlt = Infinity;
        for (const planet of planets) {
            const dist = pos.distanceTo(planet.center);
            const alt = dist - planet.radius;
            if (alt < minAlt) {
                minAlt = alt;
                nearest = planet;
            }
        }
        if (!nearest) return null;
        return {
            planet: nearest,
            distance: pos.distanceTo(nearest.center),
            altitude: minAlt
        };
    }

    /**
     * Build a quaternion that orients an object so its local Y-up aligns with the surface normal.
     * @param {THREE.Vector3} surfaceNormal
     * @param {THREE.Vector3} [forwardHint] - Desired forward direction (will be projected onto tangent plane)
     * @returns {THREE.Quaternion}
     */
    static getOrientationOnSurface(surfaceNormal, forwardHint) {
        const up = surfaceNormal.clone().normalize();

        // Choose a forward direction that's tangent to the surface
        let forward;
        if (forwardHint) {
            // Project the hint onto the tangent plane
            forward = forwardHint.clone().sub(up.clone().multiplyScalar(forwardHint.dot(up)));
            if (forward.lengthSq() < 0.0001) {
                // Forward hint is parallel to up, pick arbitrary tangent
                forward = SphericalUtils._getArbitraryTangent(up);
            } else {
                forward.normalize();
            }
        } else {
            forward = SphericalUtils._getArbitraryTangent(up);
        }

        const right = new THREE.Vector3().crossVectors(up, forward).normalize();
        forward = new THREE.Vector3().crossVectors(right, up).normalize();

        // Build rotation matrix from axes
        const m = new THREE.Matrix4();
        m.makeBasis(right, up, forward);
        const q = new THREE.Quaternion();
        q.setFromRotationMatrix(m);
        return q;
    }

    /**
     * Get an arbitrary tangent vector perpendicular to the given normal.
     */
    static _getArbitraryTangent(normal) {
        const absX = Math.abs(normal.x);
        const absZ = Math.abs(normal.z);
        let tangent;
        if (absX < 0.9) {
            tangent = new THREE.Vector3(1, 0, 0);
        } else {
            tangent = new THREE.Vector3(0, 0, 1);
        }
        tangent.sub(normal.clone().multiplyScalar(tangent.dot(normal)));
        tangent.normalize();
        return tangent;
    }

    /**
     * Random point on the surface of a planet, within an angular cap.
     * @param {Object} planet - { center: THREE.Vector3, radius: number }
     * @param {number} maxAngle - Maximum angle from top (radians). Use Math.PI for full sphere.
     * @param {THREE.Vector3} [poleDir] - Direction of the "top" of the cap (default: +Y or arbitrary)
     * @returns {THREE.Vector3} World position on surface
     */
    static randomSurfacePoint(planet, maxAngle = Math.PI, poleDir = null) {
        // Random point on unit sphere using spherical coords
        const theta = Math.random() * Math.PI * 2;
        const cosAngle = 1 - Math.random() * (1 - Math.cos(maxAngle));
        const sinAngle = Math.sqrt(1 - cosAngle * cosAngle);

        const localPos = new THREE.Vector3(
            sinAngle * Math.cos(theta),
            cosAngle,
            sinAngle * Math.sin(theta)
        );

        // If a pole direction is given, rotate the point to align
        if (poleDir) {
            const up = new THREE.Vector3(0, 1, 0);
            const q = new THREE.Quaternion().setFromUnitVectors(up, poleDir.clone().normalize());
            localPos.applyQuaternion(q);
        }

        return planet.center.clone().add(localPos.multiplyScalar(planet.radius));
    }

    /**
     * Random surface point within a band of min/max distances from a reference point on the surface.
     * @param {Object} planet
     * @param {THREE.Vector3} refPoint - Reference point on surface
     * @param {number} minDist - Minimum arc distance
     * @param {number} maxDist - Maximum arc distance
     * @returns {THREE.Vector3}
     */
    static randomSurfacePointNear(planet, refPoint, minDist, maxDist) {
        const refNormal = SphericalUtils.getSurfaceNormal(refPoint, planet);
        // Convert distances to angles: arcLength = radius * angle
        const minAngle = minDist / planet.radius;
        const maxAngle = maxDist / planet.radius;

        // Random angle in band
        const angle = minAngle + Math.random() * (maxAngle - minAngle);
        // Random rotation around the reference normal
        const phi = Math.random() * Math.PI * 2;

        // Get tangent vectors
        const tangent1 = SphericalUtils._getArbitraryTangent(refNormal);
        const tangent2 = new THREE.Vector3().crossVectors(refNormal, tangent1).normalize();

        // Rotate ref normal by angle around a random axis in the tangent plane
        const rotAxis = tangent1.clone().multiplyScalar(Math.cos(phi))
            .add(tangent2.clone().multiplyScalar(Math.sin(phi)));

        const q = new THREE.Quaternion().setFromAxisAngle(rotAxis, angle);
        const newNormal = refNormal.clone().applyQuaternion(q);

        return planet.center.clone().add(newNormal.multiplyScalar(planet.radius));
    }

    /**
     * Move a position along the planet surface in a tangent direction.
     * @param {THREE.Vector3} pos - Current position (on or near surface)
     * @param {THREE.Vector3} direction - Desired movement direction (will be projected to tangent)
     * @param {number} distance - Distance to move
     * @param {Object} planet
     * @returns {THREE.Vector3} New position on surface
     */
    static moveOnSurface(pos, direction, distance, planet) {
        const normal = SphericalUtils.getSurfaceNormal(pos, planet);
        // Project direction onto tangent plane
        const tangent = direction.clone().sub(normal.clone().multiplyScalar(direction.dot(normal)));
        if (tangent.lengthSq() < 0.0001) return pos.clone();
        tangent.normalize();

        // Move in tangent direction and re-project to surface
        const newPos = pos.clone().add(tangent.multiplyScalar(distance));
        const altitude = SphericalUtils.getAltitude(pos, planet);
        return SphericalUtils.snapToSurface(newPos, planet, altitude);
    }

    /**
     * Check if a point is within an angular distance of a reference point on a planet.
     * @param {THREE.Vector3} pos
     * @param {THREE.Vector3} refPoint
     * @param {Object} planet
     * @param {number} maxDist - Maximum surface distance
     * @returns {boolean}
     */
    static isWithinSurfaceRange(pos, refPoint, planet, maxDist) {
        const n1 = SphericalUtils.getSurfaceNormal(pos, planet);
        const n2 = SphericalUtils.getSurfaceNormal(refPoint, planet);
        const angle = Math.acos(Math.min(1, Math.max(-1, n1.dot(n2))));
        return angle * planet.radius < maxDist;
    }

    /**
     * Sample the actual displaced terrain height at a given direction on a planet.
     *
     * Fires a ray from outside the planet inward along `dirNormalized` against the
     * planet's groundMesh (the surface/grass icosahedron whose vertices are displaced
     * by distortGeometryRadial). Returns the real distance from planet.center to the
     * intersection point, so callers can use it instead of the nominal planet.radius.
     *
     * Falls back to planet.radius when:
     *   - planet.groundMesh is missing or not yet in the scene
     *   - the ray misses the mesh (should never happen for a convex-ish sphere, but
     *     degenerate normals or invisible faces could cause a miss)
     *
     * IMPORTANT: groundMesh must have its world matrix up to date before calling.
     * Call planet.groundMesh.updateWorldMatrix(true, false) if in doubt.
     *
     * @param {Object} planet - { center: THREE.Vector3, radius: number, groundMesh: THREE.Mesh }
     * @param {THREE.Vector3} dirNormalized - Unit vector pointing from center outward toward surface
     * @returns {number} Distance from planet.center to the real terrain surface
     */
    static sampleTerrainHeight(planet, dirNormalized) {
        if (!planet.groundMesh) return planet.radius;

        // Lazy init: THREE is a CDN global, guaranteed present by first call time
        if (!_terrainRaycaster) _terrainRaycaster = new THREE.Raycaster();

        // Ensure the mesh world matrix is current. In r128, Raycaster.intersectObject
        // does NOT update matrices, and Mesh.raycast reads matrixWorld directly. At
        // generation time (right after world.add, before the first render) the planet
        // group's translation may not be baked in yet, so a stale identity matrix would
        // make the ray miss any off-origin planet. updateWorldMatrix(true,false) walks
        // up to the parent group so the planet offset is applied before we cast.
        planet.groundMesh.updateWorldMatrix(true, false);

        // Start the ray from well outside the planet (1.5× radius ensures we're above any bump)
        const rayOrigin = planet.center.clone().add(dirNormalized.clone().multiplyScalar(planet.radius * 1.5));
        // Aim inward toward planet center
        const rayDir = dirNormalized.clone().negate();

        _terrainRaycaster.set(rayOrigin, rayDir);
        // Only check the ground mesh, not the whole scene — cheaper and unambiguous
        const hits = _terrainRaycaster.intersectObject(planet.groundMesh, false);

        if (hits.length > 0) {
            // hits[0].point is the world-space intersection; measure from planet center
            return hits[0].point.distanceTo(planet.center);
        }

        // Fallback: nominal radius keeps nothing from disappearing
        return planet.radius;
    }
}
