// =====================================================
// ENTITY FACTORY CLASS - Space World Version
// =====================================================

import {
    BOAT_BASE_HEALTH, BOAT_BASE_MAX_SPEED, BOAT_BASE_ACCELERATION,
    BOAT_BASE_TURN_SPEED, BOAT_BASE_DRAG, BOAT_BASE_BRAKE
} from '../constants.js';
import SphericalUtils from './SphericalUtils.js';

export default class EntityFactory {
    constructor(world, state) {
        this.world = world;
        this.state = state;
        this.O_Y = -1.4; // Legacy reference
    }

    getMat(color, flat = true) { return this.world.getMat(color, flat); }

    generatePalette(sphereColor) {
        let hue;
        if (!sphereColor) hue = Math.random();
        else {
            let base = sphereColor === 'red' ? 0.95 : sphereColor === 'blue' ? 0.6 : 0.1;
            hue = (base + (Math.random() - 0.5) * 0.3) % 1;
            if (hue < 0) hue += 1;
        }
        const baseDark = new THREE.Color().setHSL(hue, 0.2, 0.15);
        const soil = new THREE.Color().setHSL((hue + 0.05) % 1, 0.3, 0.25);
        const floraHue = (hue + 0.2 + Math.random() * 0.4) % 1;
        const flora = new THREE.Color().setHSL(floraHue, 0.5 + Math.random() * 0.4, 0.3 + Math.random() * 0.3);
        const groundTop = flora.clone().multiplyScalar(0.75);
        // Grass gets its own hue derived from flora (shifted warmer, slightly
        // different sat/light) so ground cover reads as a distinct material
        // from tree canopy instead of aliasing to the same color.
        const grassHue = (floraHue + 0.06 + Math.random() * 0.04) % 1;
        const tallGrass = new THREE.Color().setHSL(grassHue, 0.55 + Math.random() * 0.35, 0.32 + Math.random() * 0.28);
        const creatureHue = (floraHue + 0.5) % 1;
        const creature = new THREE.Color().setHSL(creatureHue, 0.8, 0.6);
        const accent = new THREE.Color().setHSL((creatureHue + 0.2) % 1, 0.9, 0.6);
        const background = new THREE.Color().setHSL((hue + 0.5) % 1, 0.3, 0.8);
        return { background, baseRock: baseDark, trunk: baseDark, soil, groundTop, flora, tallGrass, creature, accent };
    }

    generateWorldDNA() {
        const eyeRoll = Math.random();
        const eyeCount = eyeRoll < 0.1 ? 1 : eyeRoll < 0.2 ? 3 : 2;
        const creatureShapes = ['box', 'sphere', 'cone'];
        const shapeIndex = Math.floor(Math.random() * 3);
        const shape = creatureShapes[shapeIndex];
        const speciesType = shape === 'box' ? 'blocky' : shape === 'sphere' ? 'blobby' : 'conehead';
        const speciesStats = {
            blobby: { scaleMin: 0.7, scaleMax: 1.0, speed: 0.04, temperament: 1.0 },
            blocky: { scaleMin: 0.9, scaleMax: 1.4, speed: 0.03, temperament: 1.5 },
            conehead: { scaleMin: 1.2, scaleMax: 1.8, speed: 0.02, temperament: 0.5 }
        };
        const stats = speciesStats[speciesType];
        return {
            tree: { shape: ['cone', 'box', 'round', 'cylinder'][Math.floor(Math.random() * 4)], heightMod: 1.2 + Math.random() * 1.0, thickMod: 0.6 + Math.random() },
            bush: { shape: ['sphere', 'cone'][Math.floor(Math.random() * 2)], scaleY: 0.7 + Math.random() * 0.5 },
            rock: { shape: ['ico', 'box', 'dodec', 'slab'][Math.floor(Math.random() * 4)], stretch: 0.8 + Math.random() * 0.8 },
            creature: { shape: shape, speciesType: speciesType, eyes: eyeCount, scale: stats.scaleMin + Math.random() * (stats.scaleMax - stats.scaleMin), eyeScale: 1.0 + Math.random() * 0.6, moveSpeed: stats.speed, temperament: stats.temperament },
            grass: { height: 0.3 + Math.random() * 0.5 }
        };
    }

    createBubbleTexture(char, color) {
        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(32, 32, 24, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.font = '30px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(char, 32, 34);
        const tex = new THREE.CanvasTexture(canvas);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
        sprite.scale.set(0.6, 0.6, 1);
        sprite.position.y = 1.0;
        return sprite;
    }

    /**
     * Create a floating combat damage-number sprite (CanvasTexture text, same
     * pattern as createBubbleTexture above) at a world position. Free-standing —
     * added directly to the world, not parented to the entity that was hit, so it
     * keeps floating/fading on its own timeline even if that entity dies and is
     * removed a moment later. Owned and ticked by ParticleSystem (state.damageNumbers):
     * floats up and fades there, then gets removed and disposed (texture + material).
     */
    createDamageNumber(pos, value, colorHex = '#ffffff') {
        const canvas = document.createElement('canvas');
        canvas.width = 96; canvas.height = 48;
        const ctx = canvas.getContext('2d');
        ctx.font = 'bold 28px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.strokeText(String(value), 48, 24);
        ctx.fillStyle = colorHex;
        ctx.fillText(String(value), 48, 24);
        const tex = new THREE.CanvasTexture(canvas);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
        sprite.scale.set(0.8, 0.4, 1);
        sprite.position.copy(pos);
        sprite.position.x += (Math.random() - 0.5) * 0.3;
        sprite.position.z += (Math.random() - 0.5) * 0.3;
        sprite.userData = { life: 0, duration: 0.8, startY: sprite.position.y };
        this.world.add(sprite);
        return sprite;
    }

    disposeHierarchy(obj) {
        if (!obj) return;
        obj.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) Array.isArray(child.material) ? child.material.forEach(m => m.dispose()) : child.material.dispose();
        });
    }

    /**
     * Merge duplicate vertices in a non-indexed BufferGeometry into an indexed one.
     * Vertices within `tolerance` distance are treated as the same vertex.
     * This ensures adjacent triangles share edge vertices and stay connected.
     */
    mergeVertices(geometry, tolerance = 0.0001) {
        const pos = geometry.attributes.position;
        const map = {};          // hash → first-seen index
        const uniquePos = [];    // unique vertex positions [x,y,z,...]
        const indexMap = [];     // old index → new index
        const precisionFactor = Math.round(1 / tolerance);

        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const y = pos.getY(i);
            const z = pos.getZ(i);
            const key = `${Math.round(x * precisionFactor)}_${Math.round(y * precisionFactor)}_${Math.round(z * precisionFactor)}`;
            if (map[key] !== undefined) {
                indexMap.push(map[key]);
            } else {
                const newIdx = uniquePos.length / 3;
                map[key] = newIdx;
                uniquePos.push(x, y, z);
                indexMap.push(newIdx);
            }
        }

        const newPos = new Float32Array(uniquePos);
        const indices = new Uint32Array(indexMap);
        const newGeo = new THREE.BufferGeometry();
        newGeo.setAttribute('position', new THREE.BufferAttribute(newPos, 3));
        newGeo.setIndex(new THREE.BufferAttribute(indices, 1));
        newGeo.computeVertexNormals();
        return newGeo;
    }

    distortGeometry(geometry, intensity) {
        const posAttribute = geometry.attributes.position;
        for (let i = 0; i < posAttribute.count; i++) {
            const x = posAttribute.getX(i);
            const y = posAttribute.getY(i);
            const z = posAttribute.getZ(i);
            posAttribute.setX(i, x + (Math.random() - 0.5) * intensity);
            posAttribute.setY(i, y + (Math.random() - 0.5) * intensity);
            posAttribute.setZ(i, z + (Math.random() - 0.5) * intensity);
        }
        geometry.computeVertexNormals();
        return geometry;
    }

    /**
     * Distort geometry radially — push vertices in/out along their normal from center.
     * Merges duplicate vertices first so adjacent triangles stay connected.
     * Uses a simple noise-like pattern based on vertex angle for coherent bumps.
     */
    distortGeometryRadial(geometry, intensity, seed = 0) {
        // Merge duplicate vertices so shared edges move together
        const merged = this.mergeVertices(geometry);
        const posAttribute = merged.attributes.position;
        for (let i = 0; i < posAttribute.count; i++) {
            const x = posAttribute.getX(i);
            const y = posAttribute.getY(i);
            const z = posAttribute.getZ(i);
            const len = Math.sqrt(x * x + y * y + z * z);
            if (len < 0.001) continue;
            // Simple coherent noise: use sin/cos of angles for smooth bumps
            const theta = Math.atan2(z, x);
            const phi = Math.acos(Math.max(-1, Math.min(1, y / len)));
            const noise = Math.sin(theta * 5 + seed) * Math.cos(phi * 4 + seed * 0.7) * 0.5
                        + Math.sin(theta * 8 - seed * 1.3) * Math.sin(phi * 7 + seed * 0.3) * 0.3
                        + (Math.random() - 0.5) * 0.4;
            const offset = noise * intensity;
            const nx = x / len, ny = y / len, nz = z / len;
            posAttribute.setX(i, x + nx * offset);
            posAttribute.setY(i, y + ny * offset);
            posAttribute.setZ(i, z + nz * offset);
        }
        posAttribute.needsUpdate = true;
        merged.computeVertexNormals();
        return merged;
    }

    /**
     * Merge several transformed box geometries into a single non-indexed
     * BufferGeometry (position + normal only — no UVs needed, everything
     * here uses flat-color toon materials). r128 ships no
     * BufferGeometryUtils, so this is hand-rolled: each source box is
     * expanded to non-indexed (one vertex per triangle corner, so no index
     * offsetting is needed when concatenating), transformed via
     * BufferGeometry.applyMatrix4 (which also rotates normals through the
     * normal matrix — correct even with the rotations used for blade lean),
     * then the position/normal arrays are copied back-to-back into one
     * buffer. One merged geometry = one draw call for the whole clump.
     * @param {Array<{geometry: THREE.BufferGeometry, matrix: THREE.Matrix4}>} parts
     */
    mergeBoxGeometries(parts) {
        const expanded = parts.map(({ geometry, matrix }) => {
            const g = geometry.toNonIndexed();
            g.applyMatrix4(matrix);
            return g;
        });
        let vertCount = 0;
        for (const g of expanded) vertCount += g.attributes.position.count;
        const positions = new Float32Array(vertCount * 3);
        const normals = new Float32Array(vertCount * 3);
        let offset = 0;
        for (const g of expanded) {
            positions.set(g.attributes.position.array, offset * 3);
            normals.set(g.attributes.normal.array, offset * 3);
            offset += g.attributes.position.count;
            g.dispose();
        }
        const merged = new THREE.BufferGeometry();
        merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        return merged;
    }

    /**
     * Orient an entity on a planet surface so its local Y points outward.
     * @param {THREE.Object3D} obj - The object to orient
     * @param {THREE.Vector3} surfacePos - Position on the planet surface
     * @param {Object} planet - { center: THREE.Vector3, radius: number }
     * @param {number} heightOffset - Height above surface
     */
    orientOnPlanet(obj, surfacePos, planet, heightOffset = 0) {
        const normal = SphericalUtils.getSurfaceNormal(surfacePos, planet);
        const pos = planet.center.clone().add(normal.clone().multiplyScalar(planet.radius + heightOffset));
        obj.position.copy(pos);
        const q = SphericalUtils.getOrientationOnSurface(normal);
        obj.quaternion.copy(q);
    }

    // =====================================================
    // PLANET CREATION (replaces createIslandAt)
    // =====================================================

    /**
     * Create a spherical planet with layered terrain.
     * @param {Object} palette - Color palette
     * @param {number} cx - Center X
     * @param {number} cy - Center Y
     * @param {number} cz - Center Z
     * @param {number} radius - Planet radius
     * @param {boolean} hasAtmosphere - Whether to render atmosphere glow
     * @returns {{ group, groundMesh, center, radius }}
     */
    createPlanet(palette, cx, cy, cz, radius, hasAtmosphere = false) {
        const g = new THREE.Group();
        // Higher detail for smoother spheres: min 4, max 6
        const detail = Math.max(4, Math.min(6, Math.floor(radius / 4)));
        const seed = cx * 7 + cy * 13 + cz * 19 + radius; // deterministic per planet

        // Smooth-shaded materials for planet layers (not flat-shaded)
        const coreMat = new THREE.MeshToonMaterial({ color: palette.baseRock, flatShading: false });
        const soilMat = new THREE.MeshToonMaterial({ color: palette.soil, flatShading: false });
        const surfaceMat = new THREE.MeshToonMaterial({ color: palette.groundTop, flatShading: false });

        // Core rock layer
        const coreGeoRaw = new THREE.IcosahedronGeometry(radius * 0.95, detail);
        const coreGeo = this.distortGeometryRadial(coreGeoRaw, radius * 0.04, seed + 1);
        const core = new THREE.Mesh(coreGeo, coreMat);
        g.add(core);

        // Soil layer
        const soilGeoRaw = new THREE.IcosahedronGeometry(radius * 0.98, detail);
        const soilGeo = this.distortGeometryRadial(soilGeoRaw, radius * 0.03, seed + 2);
        const soil = new THREE.Mesh(soilGeo, soilMat);
        g.add(soil);

        // Surface (grass) layer - the main collision surface
        const surfaceGeoRaw = new THREE.IcosahedronGeometry(radius, detail);
        const surfaceGeo = this.distortGeometryRadial(surfaceGeoRaw, radius * 0.02, seed + 3);
        const surface = new THREE.Mesh(surfaceGeo, surfaceMat);
        surface.userData = { type: 'ground' };
        g.add(surface);

        // Atmosphere glow
        if (hasAtmosphere) {
            const atmosGeo = new THREE.IcosahedronGeometry(radius * 1.08, detail + 1);
            const atmosMat = new THREE.MeshBasicMaterial({
                color: palette.background.clone().lerp(new THREE.Color(0x4488ff), 0.5),
                transparent: true,
                opacity: 0.12,
                side: THREE.BackSide
            });
            const atmos = new THREE.Mesh(atmosGeo, atmosMat);
            g.add(atmos);
        }

        g.position.set(cx, cy, cz);

        return {
            group: g,
            groundMesh: surface,
            center: new THREE.Vector3(cx, cy, cz),
            radius: radius
        };
    }

    // Legacy wrapper
    createIslandAt(palette, centerX, centerZ, radius, hasWater = false) {
        return this.createPlanet(palette, centerX, 0, centerZ, radius, hasWater);
    }

    createIsland(palette) {
        return this.createPlanet(palette, 0, 0, 0, 7, true);
    }

    // =====================================================
    // ENTITY CREATION (adapted for spherical orientation)
    // =====================================================

    createStoneGolem(p, x, z) {
        const g = new THREE.Group();
        const stoneMat = this.getMat(0x78909c);
        const darkStoneMat = this.getMat(0x455a64);
        const eyeWhiteMat = this.getMat(0xffffff);
        const eyePupilMat = this.getMat(0x111111);

        const bodyGeo = new THREE.BoxGeometry(2.5, 3.2, 1.8);
        const body = new THREE.Mesh(bodyGeo, stoneMat);
        g.add(body);

        const noseGeo = new THREE.BoxGeometry(0.8, 1.4, 0.5);
        const nose = new THREE.Mesh(noseGeo, stoneMat);
        nose.position.set(0, 0.2, 1.0);
        g.add(nose);

        const mouthGeo = new THREE.BoxGeometry(1.6, 0.15, 0.2);
        const mouth = new THREE.Mesh(mouthGeo, darkStoneMat);
        mouth.position.set(0, -0.9, 0.9);
        g.add(mouth);

        const createEye = (xDir) => {
            const eyeGroup = new THREE.Group();
            const whiteGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.2, 8);
            whiteGeo.rotateX(Math.PI / 2);
            const white = new THREE.Mesh(whiteGeo, eyeWhiteMat);
            eyeGroup.add(white);
            const pupilGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.25, 6);
            pupilGeo.rotateX(Math.PI / 2);
            const pupil = new THREE.Mesh(pupilGeo, eyePupilMat);
            pupil.position.z = 0.05;
            eyeGroup.add(pupil);
            const browGeo = new THREE.BoxGeometry(0.9, 0.25, 0.4);
            const brow = new THREE.Mesh(browGeo, darkStoneMat);
            brow.position.set(0, 0.5, 0.1);
            brow.rotation.z = xDir * -0.4;
            eyeGroup.add(brow);
            eyeGroup.position.set(xDir * 0.9, 0.8, 0.9);
            return eyeGroup;
        };
        g.add(createEye(-1), createEye(1));

        const createArm = (xDir) => {
            const armGeo = new THREE.BoxGeometry(0.6, 2.2, 0.8);
            const arm = new THREE.Mesh(armGeo, stoneMat);
            arm.position.y = -0.5;
            const pivot = new THREE.Group();
            pivot.add(arm);
            pivot.position.set(xDir * 1.8, 0.5, 0);
            return pivot;
        };
        const lArm = createArm(-1);
        const rArm = createArm(1);
        g.add(lArm, rArm);

        const createLeg = (lx, lz) => {
            const legGeo = new THREE.BoxGeometry(0.6, 0.8, 0.6);
            const leg = new THREE.Mesh(legGeo, stoneMat);
            leg.position.set(lx, -2.0, lz);
            g.add(leg);
            return leg;
        };
        const legs = [createLeg(-0.8, 0.5), createLeg(0.8, 0.5), createLeg(-0.8, -0.5), createLeg(0.8, -0.5)];

        // Position will be set by orientOnPlanet in GameEngine
        g.position.set(x, 0, z);
        g.userData = {
            type: 'golem',
            radius: 2.5,
            lArm, rArm, legs,
            interactive: true,
            dialog: "need. soul. soul. in. big. green. roof.",
            heightOffset: 2.2
        };
        this.state.obstacles.push(g);
        return g;
    }

    createMountain(p, x, z, scale = 1.0) {
        const g = new THREE.Group();
        const stoneMat = this.getMat(p.baseRock.clone().lerp(new THREE.Color(0x888888), 0.5));

        const peakGeo = new THREE.ConeGeometry(10 * scale, 12 * scale, 6);
        const peak = new THREE.Mesh(peakGeo, stoneMat);
        peak.position.y = 5 * scale;
        g.add(peak);

        const capGeo = new THREE.ConeGeometry(4 * scale, 4 * scale, 6);
        const cap = new THREE.Mesh(capGeo, this.getMat(0xffffff));
        cap.position.y = 9 * scale;
        g.add(cap);

        for (let i = 0; i < 4; i++) {
            const s = (0.5 + Math.random() * 0.5) * scale;
            const subPeakGeo = new THREE.ConeGeometry(6 * s, 8 * s, 5);
            const subPeak = new THREE.Mesh(subPeakGeo, stoneMat);
            const ang = (i / 4) * Math.PI * 2;
            const dist = 6 * scale;
            subPeak.position.set(Math.cos(ang) * dist, 3 * s, Math.sin(ang) * dist);
            g.add(subPeak);
        }

        g.position.set(x, 0, z);
        g.userData = { type: 'mountain', radius: 8 * scale };
        this.state.obstacles.push(g);
        return g;
    }

    createGoldRock(p, x, z, scale = 1.0) {
        const g = new THREE.Group();
        const stoneMat = this.getMat(p.baseRock.clone().lerp(new THREE.Color(0x444444), 0.5));
        // Emissive glow (moderate intensity, matches the stat-boost crystal glow elsewhere)
        // so ore chunks read as "glowing gold" and are spottable from a distance instead
        // of blending into the rock — gold only spawns on Ancient Peaks and players had
        // no visual cue to notice it.
        const goldMat = new THREE.MeshToonMaterial({
            color: 0xffd700,
            flatShading: false,
            emissive: 0xffd700,
            emissiveIntensity: 0.6
        });

        const rockGeo = new THREE.DodecahedronGeometry(0.8 * scale, 0);
        const rock = new THREE.Mesh(rockGeo, stoneMat);
        g.add(rock);

        for (let i = 0; i < 5; i++) {
            const oreGeo = new THREE.BoxGeometry(0.2 * scale, 0.2 * scale, 0.2 * scale);
            const ore = new THREE.Mesh(oreGeo, goldMat);
            const phi = Math.random() * Math.PI * 2;
            const theta = Math.random() * Math.PI;
            const r = 0.7 * scale;
            ore.position.set(
                r * Math.sin(theta) * Math.cos(phi),
                r * Math.sin(theta) * Math.sin(phi),
                r * Math.cos(theta)
            );
            ore.rotation.set(Math.random(), Math.random(), Math.random());
            g.add(ore);
        }

        g.position.set(x, 0, z);
        // BONUS: match rock heightOffset fix from Phase 1 so gold rocks sit flush on surface
        g.userData = { type: 'gold_rock', radius: 0.8 * scale, color: p.baseRock, heightOffset: 0.35 + 0.2 * scale };
        this.state.obstacles.push(g);
        return g;
    }

    createTree(p, x, z, style = null) {
        const g = new THREE.Group();
        const dna = style || {
            color: p.flora.clone(), trunkColor: p.trunk.clone(), shape: this.state.worldDNA.tree.shape,
            height: 1.5 * this.state.worldDNA.tree.heightMod + Math.random() * 0.5, thickness: 0.2 * this.state.worldDNA.tree.thickMod
        };
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(dna.thickness * 0.7, dna.thickness, dna.height, 5), this.getMat(dna.trunkColor));
        trunk.position.y = dna.height / 2;
        g.add(trunk);

        // Layered canopy (2-3 volumes) instead of one lone primitive —
        // silhouette upgrade keyed off worldDNA.tree.shape. Each layer gets
        // a slight per-layer lightness jitter so the stack reads as depth
        // instead of one flat-colored blob. Bounded to 2-3 meshes/tree
        // (~51 trees total across all planets, so draw-call cost stays low).
        const layerColor = (i) => dna.color.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.08 - i * 0.02);
        if (dna.shape === 'cone') {
            // Stacked decreasing cones = pine silhouette
            const layerCount = 2 + Math.floor(Math.random() * 2); // 2-3
            let y = dna.height;
            for (let i = 0; i < layerCount; i++) {
                const shrink = 1 - i * 0.25;
                const coneH = 1.5 * shrink;
                const cone = new THREE.Mesh(new THREE.ConeGeometry(1.0 * shrink, coneH, 5), this.getMat(layerColor(i)));
                cone.position.y = y + coneH * 0.5;
                g.add(cone);
                y += coneH * 0.55; // overlap so the stack reads continuous
            }
        } else if (dna.shape === 'cylinder') {
            // Layered discs (pagoda-style stack)
            const layerCount = 2 + Math.floor(Math.random() * 2); // 2-3
            let y = dna.height;
            for (let i = 0; i < layerCount; i++) {
                const shrink = 1 - i * 0.2;
                const radius = 0.85 * shrink;
                const discH = 0.4;
                const disc = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.1, discH, 6), this.getMat(layerColor(i)));
                disc.position.y = y + discH * 0.5;
                g.add(disc);
                y += discH + 0.15; // small gap between discs
            }
        } else {
            // box / round (dodeca): offset overlapping volumes = clumped canopy
            const layerCount = 2 + Math.floor(Math.random() * 2); // 2-3
            for (let i = 0; i < layerCount; i++) {
                const layerScale = 1 - i * 0.2 + Math.random() * 0.1;
                const volGeo = dna.shape === 'box' ? new THREE.BoxGeometry(1.2, 1.2, 1.2) : new THREE.DodecahedronGeometry(0.9);
                const vol = new THREE.Mesh(volGeo, this.getMat(layerColor(i)));
                vol.scale.setScalar(layerScale);
                vol.position.set(
                    (Math.random() - 0.5) * 0.5,
                    dna.height + (Math.random() - 0.5) * 0.3,
                    (Math.random() - 0.5) * 0.5
                );
                g.add(vol);
            }
        }

        g.position.set(x, 0, z);
        g.rotation.y = Math.random() * Math.PI * 2;
        g.scale.set(0, 0, 0);
        g.userData = { type: 'tree', radius: 0.6, style: dna, color: dna.color, productionTimer: Math.random() * 20, health: 5, choppable: true, heightOffset: 0 };
        this.state.obstacles.push(g);
        return g;
    }

    createBush(p, x, z, style = null) {
        const g = new THREE.Group();
        const dna = style || { color: p.flora.clone(), shape: this.state.worldDNA.bush.shape, scaleY: this.state.worldDNA.bush.scaleY };
        let geo = dna.shape === 'flat' ? new THREE.BoxGeometry(0.8, 0.1, 0.8) :
            dna.shape === 'box' ? new THREE.BoxGeometry(0.6, 0.6, 0.6) :
                dna.shape === 'cone' ? new THREE.ConeGeometry(0.4, 0.7, 5) : new THREE.DodecahedronGeometry(0.4);
        const m = new THREE.Mesh(geo, this.getMat(dna.color));
        m.position.y = dna.shape === 'flat' ? 0.05 : 0.35 * dna.scaleY;
        if (dna.shape !== 'flat') m.scale.y = dna.scaleY;
        g.add(m);
        g.position.set(x, 0, z);
        g.rotation.y = Math.random() * Math.PI * 2;
        g.scale.set(0, 0, 0);
        g.userData = { type: 'bush', radius: 0.4, style: dna, color: dna.color, productionTimer: Math.random() * 20, heightOffset: 0 };
        return g;
    }

    createRock(p, x, z, style = null) {
        const g = new THREE.Group();
        const dna = style || { color: p.baseRock.clone(), shape: this.state.worldDNA.rock.shape };
        let geo = dna.shape === 'ico' ? new THREE.IcosahedronGeometry(0.35, 0) :
            dna.shape === 'box' ? new THREE.BoxGeometry(0.6, 0.5, 0.6) :
                dna.shape === 'slab' ? new THREE.BoxGeometry(0.7, 0.25, 0.5) : new THREE.DodecahedronGeometry(0.35);
        const m = new THREE.Mesh(geo, this.getMat(dna.color));
        if (dna.shape === 'slab') m.rotation.y = Math.random() * Math.PI;
        else m.rotation.set(Math.random(), Math.random(), Math.random());
        g.add(m);
        g.position.set(x, 0, z);
        g.scale.set(0, 0, 0);
        // heightOffset lifts the rock so its center-origin geometry sits on the surface.
        // Each shape's half-extent in local Y: ico/dodec radius=0.35, box half-height=0.25, slab half-height=0.15.
        const rockHeightOffset = dna.shape === 'box' ? 0.25 : dna.shape === 'slab' ? 0.15 : 0.35;
        g.userData = { type: 'rock', style: dna, color: dna.color, heightOffset: rockHeightOffset };
        return g;
    }

    createGrass(p, x, z, style = null) {
        const g = new THREE.Group();
        const h = (style ? style.height : this.state.worldDNA.grass.height);
        const dna = style || { color: p.tallGrass.clone(), height: h };

        // Clump of 3-5 blades (varied height/lean) merged into ONE
        // BufferGeometry via mergeBoxGeometries — still a single draw call,
        // same cost as the old lone blade, but reads as a tuft instead of a stick.
        const bladeCount = 3 + Math.floor(Math.random() * 3); // 3-5
        const parts = [];
        for (let i = 0; i < bladeCount; i++) {
            const bladeH = dna.height * (0.5 + Math.random() * 0.8); // 0.5x-1.3x base height
            const bladeGeo = new THREE.BoxGeometry(0.06, bladeH, 0.06);
            const spreadAngle = Math.random() * Math.PI * 2;
            const spreadDist = Math.random() * 0.12;
            const px = Math.cos(spreadAngle) * spreadDist;
            const pz = Math.sin(spreadAngle) * spreadDist;
            const leanAngle = Math.random() * 0.35; // tilt magnitude
            const leanDir = Math.random() * Math.PI * 2; // tilt direction
            const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(leanAngle, leanDir, 0, 'YXZ'));
            // base: lift the box so its bottom face sits at local y=0 (hinge point).
            // rot: tilt/spin about that hinge (order matters — rotate before moving).
            // trans: place the hinged blade at its offset within the clump footprint.
            const base = new THREE.Matrix4().makeTranslation(0, bladeH / 2, 0);
            const rot = new THREE.Matrix4().makeRotationFromQuaternion(quat);
            const trans = new THREE.Matrix4().makeTranslation(px, 0, pz);
            const matrix = new THREE.Matrix4().multiplyMatrices(trans, rot).multiply(base);
            parts.push({ geometry: bladeGeo, matrix });
        }
        const clumpGeo = this.mergeBoxGeometries(parts);
        parts.forEach(part => part.geometry.dispose());
        const m = new THREE.Mesh(clumpGeo, this.getMat(dna.color));
        g.add(m);
        g.position.set(x, 0, z);
        g.scale.set(0, 0, 0);
        g.userData = { type: 'grass', style: dna, color: dna.color, growTimer: Math.random() * 30, heightOffset: 0 };
        return g;
    }

    createFlower(p, x, z, style = null) {
        const g = new THREE.Group();
        const dna = style || { stemColor: p.flora.clone(), petalColor: p.background.clone().offsetHSL(0, 0, 0.1), centerColor: p.creature.clone(), height: 0.5 + Math.random() * 0.2 };
        const stem = new THREE.Mesh(new THREE.BoxGeometry(0.05, dna.height, 0.05), this.getMat(dna.stemColor));
        stem.position.y = dna.height / 2;
        const petals = new THREE.Mesh(new THREE.DodecahedronGeometry(0.15), this.getMat(dna.petalColor));
        petals.position.y = dna.height;
        const center = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), this.getMat(dna.centerColor));
        center.position.y = dna.height + 0.1;
        g.add(stem, petals, center);
        g.position.set(x, 0, z);
        g.scale.set(0, 0, 0);
        g.userData = { type: 'flower', style: dna, color: dna.petalColor, heightOffset: 0 };
        return g;
    }

    generateCreatureDNA(palette, speciesType = null) {
        const eyeRoll = Math.random();
        const eyeCount = eyeRoll < 0.1 ? 1 : eyeRoll < 0.2 ? 3 : 2;
        if (!speciesType) {
            speciesType = ['blobby', 'blocky', 'conehead'][Math.floor(Math.random() * 3)];
        }
        const speciesStats = {
            blobby: { shape: 'sphere', scaleMin: 0.7, scaleMax: 1.0, speed: 0.04, temperament: 1.0 },
            blocky: { shape: 'box', scaleMin: 0.9, scaleMax: 1.4, speed: 0.03, temperament: 1.5 },
            conehead: { shape: 'cone', scaleMin: 1.2, scaleMax: 1.8, speed: 0.02, temperament: 0.5 }
        };
        const stats = speciesStats[speciesType];
        const colorVar = Math.random() * 0.15;
        const baseColor = palette.creature.clone();
        baseColor.offsetHSL(colorVar, 0, 0);
        return {
            color: baseColor,
            bodyShape: stats.shape,
            speciesType: speciesType,
            eyeCount: eyeCount,
            scale: stats.scaleMin + Math.random() * (stats.scaleMax - stats.scaleMin),
            eyeScale: 1.0 + Math.random() * 0.6,
            moveSpeed: stats.speed,
            temperament: stats.temperament
        };
    }

    createCreature(p, x, z, style = null) {
        const g = new THREE.Group();
        const dna = style || {
            color: p.creature.clone(), bodyShape: this.state.worldDNA.creature.shape,
            speciesType: this.state.worldDNA.creature.speciesType,
            eyeCount: this.state.worldDNA.creature.eyes, scale: this.state.worldDNA.creature.scale,
            eyeScale: this.state.worldDNA.creature.eyeScale,
            moveSpeed: this.state.worldDNA.creature.moveSpeed,
            temperament: this.state.worldDNA.creature.temperament
        };
        const bodyShape = dna.bodyShape;
        const scale = dna.scale || 1.0;
        const moveSpeed = dna.moveSpeed || 0.03;
        let body;
        if (bodyShape === 'box') {
            body = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.3, 0.42), this.getMat(dna.color));
        } else if (bodyShape === 'cone') {
            body = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.35, 8), this.getMat(dna.color));
        } else {
            body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), this.getMat(dna.color));
        }
        body.position.y = 0.15;
        body.scale.set(scale, scale, scale);
        // Body + eyes share a local animation pivot so per-species locomotion FX
        // (squash-stretch, waddle, lean) move them together instead of desyncing
        // the eyes (siblings, not children of body) from the body they sit on —
        // see EntityAISystem._animateCreatureLocomotion.
        const animPivot = new THREE.Group();
        animPivot.add(body);
        g.add(animPivot);
        const baseEyeR = 0.045 * scale * (dna.eyeScale || 1.0);
        const eyeGeo = new THREE.SphereGeometry(baseEyeR, 4, 4);
        const pupGeo = new THREE.SphereGeometry(baseEyeR * 0.4, 4, 4);
        const eyeMat = this.getMat(0xffffff);
        const pupMat = this.getMat(0x000000);
        const addEye = (px, py, pz, ry) => {
            const e = new THREE.Group();
            const em = new THREE.Mesh(eyeGeo, eyeMat);
            const pm = new THREE.Mesh(pupGeo, pupMat);
            pm.position.z = baseEyeR * 0.7;
            e.add(em, pm);
            e.position.set(px * scale, py * scale, pz * scale);
            e.rotation.y = ry;
            e.userData = { isEye: true };
            return e;
        };
        if (bodyShape === 'box') {
            const sideX = 0.19, eyeY = 0.22, eyeZ = 0.15, rot = 0;
            if (dna.eyeCount === 1) animPivot.add(addEye(0, eyeY, 0.22, rot));
            else if (dna.eyeCount === 2) { animPivot.add(addEye(sideX, eyeY, eyeZ, rot)); animPivot.add(addEye(-sideX, eyeY, eyeZ, rot)); }
            else { animPivot.add(addEye(sideX, eyeY, eyeZ, rot)); animPivot.add(addEye(-sideX, eyeY, eyeZ, rot)); animPivot.add(addEye(0, eyeY + 0.08, 0.22, 0)); }
        } else if (bodyShape === 'cone') {
            const sideX = 0.12, eyeY = 0.28, eyeZ = 0.18, rot = 0;
            if (dna.eyeCount === 1) animPivot.add(addEye(0, eyeY, eyeZ, rot));
            else if (dna.eyeCount === 2) { animPivot.add(addEye(sideX, eyeY, eyeZ, rot)); animPivot.add(addEye(-sideX, eyeY, eyeZ, rot)); }
            else { animPivot.add(addEye(sideX, eyeY, eyeZ, rot)); animPivot.add(addEye(-sideX, eyeY, eyeZ, rot)); animPivot.add(addEye(0, eyeY + 0.06, 0.22, 0)); }
        } else {
            const isFrontEyes = Math.random() < 0.5;
            const eyeY = 0.22;
            if (isFrontEyes) {
                const eyeZ = 0.18;
                if (dna.eyeCount === 1) animPivot.add(addEye(0, eyeY, eyeZ, 0));
                else if (dna.eyeCount === 2) { animPivot.add(addEye(0.08, eyeY, eyeZ, 0.2)); animPivot.add(addEye(-0.08, eyeY, eyeZ, -0.2)); }
                else { animPivot.add(addEye(0, eyeY + 0.05, eyeZ, 0)); animPivot.add(addEye(0.1, eyeY - 0.02, eyeZ - 0.02, 0.25)); animPivot.add(addEye(-0.1, eyeY - 0.02, eyeZ - 0.02, -0.25)); }
            } else {
                const eyeX = 0.15, eyeZ = 0.12, rot = 0.3;
                if (dna.eyeCount === 1) animPivot.add(addEye(0, eyeY, 0.35, 0));
                else if (dna.eyeCount === 2) { animPivot.add(addEye(eyeX, eyeY, eyeZ, rot)); animPivot.add(addEye(-eyeX, eyeY, eyeZ, -rot)); }
                else { animPivot.add(addEye(eyeX, eyeY, eyeZ, rot)); animPivot.add(addEye(-eyeX, eyeY, eyeZ, -rot)); animPivot.add(addEye(0, eyeY + 0.1, 0.25, 0)); }
            }
        }
        g.position.set(x, 0, z);
        g.scale.set(0, 0, 0);
        const radius = 0.5 * scale;
        g.userData = {
            type: 'creature', speciesType: dna.speciesType, radius: radius, hunger: 0, age: 0, eatenCount: 0,
            moveSpeed: moveSpeed, hopOffset: Math.random() * 100,
            color: dna.color, bubble: null, style: dna, targetScale: scale, cooldown: 0,
            hp: 6, aggroTimer: 0, contactCooldown: 0,
            // A1: per-species temperament drives ambient aggro chance (static lookup, no RNG)
            temperament: dna.temperament !== undefined ? dna.temperament : 1.0,
            heightOffset: 0.3,
            // Body+eyes sub-pivot for per-species locomotion animation (see EntityAISystem)
            bodyMesh: body, animPivot: animPivot, _isMoving: false
        };
        return g;
    }

    createChief(p, x, z) {
        const g = new THREE.Group();
        const color = p.creature.clone().lerp(new THREE.Color(0xffd700), 0.5);
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 0.9, 8), this.getMat(color));
        body.position.y = 0.45;
        const crown = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.6, 6), this.getMat(new THREE.Color(0xffaa00)));
        crown.position.y = 1.1;
        const eyeGeo = new THREE.SphereGeometry(0.08, 4, 4);
        const eyeMat = this.getMat(0xffffff);
        const e1 = new THREE.Mesh(eyeGeo, eyeMat); e1.position.set(0.15, 0.7, 0.25);
        const e2 = new THREE.Mesh(eyeGeo, eyeMat); e2.position.set(-0.15, 0.7, 0.25);
        g.add(body, crown, e1, e2);
        g.position.set(x, 0, z);
        g.userData = { type: 'chief', name: 'Chief Ruru', loreFile: 'data/chief_lore.txt', canChat: true, radius: 0.6, moveSpeed: 0.045, color: color, fleeTimer: 0, heightOffset: 0.3 };
        return g;
    }

    createEgg(pos, color, dna) {
        const g = new THREE.Group();
        const eggMesh = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 8), this.getMat(color));
        eggMesh.scale.y = 1.3;
        g.add(eggMesh);
        g.position.copy(pos);
        g.scale.set(0, 0, 0);
        g.userData = { type: 'egg', color: color, parentDNA: dna, hatchTimer: 10.0, heightOffset: 0.3 };
        return g;
    }

    createParticle(pos, col, size = 1) {
        const spriteMat = new THREE.SpriteMaterial({ color: col, transparent: true, opacity: 1 });
        const p = new THREE.Sprite(spriteMat);
        p.scale.set(0.075 * size, 0.075 * size, 1);
        p.position.copy(pos);
        p.position.x += (Math.random() - 0.5) * 0.4;
        p.position.y += (Math.random() - 0.5) * 0.4;
        p.position.z += (Math.random() - 0.5) * 0.4;
        p.userData = {
            vel: new THREE.Vector3((Math.random() - .5), (Math.random() - .5), (Math.random() - .5)).normalize().multiplyScalar(0.05 * size),
            life: 1.0, maxLife: 1.0
        };
        this.world.add(p);
        this.state.particles.push(p);
    }

    createLog(palette, x, z) {
        const g = new THREE.Group();
        const logColor = (palette && palette.trunk) ? palette.trunk :
            (palette instanceof THREE.Color ? palette : new THREE.Color(0x8B4513));
        const trunkGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.8, 6);
        const trunk = new THREE.Mesh(trunkGeo, this.getMat(logColor));
        trunk.rotation.z = Math.PI / 2;
        trunk.position.y = 0.12;
        g.add(trunk);
        g.position.set(x, 0, z);
        g.scale.set(0, 0, 0);
        g.userData = { type: 'log', color: logColor, autoPickup: true, onLand: true, heightOffset: 0 };
        return g;
    }

    createChopParticles(pos, color, count = 6) {
        for (let i = 0; i < count; i++) {
            this.createParticle(pos.clone(), color, 0.6);
        }
    }

    createPickaxe(palette, x, z) {
        const g = new THREE.Group();
        const woodMaterial = new THREE.MeshStandardMaterial({ color: 0x5d4037, flatShading: true });
        const metalMaterial = new THREE.MeshStandardMaterial({ color: 0x555555, flatShading: true });

        const handleGeo = new THREE.CylinderGeometry(0.0125, 0.015, 0.5, 6);
        const handle = new THREE.Mesh(handleGeo, woodMaterial);
        g.add(handle);

        const headGeo = new THREE.BoxGeometry(0.35, 0.04, 0.04);
        const head = new THREE.Mesh(headGeo, metalMaterial);
        head.position.y = 0.2;
        const tipL = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.15, 4), metalMaterial);
        tipL.rotation.z = Math.PI / 2 + 0.3;
        tipL.position.x = -0.15;
        tipL.position.y = 0.16;
        const tipR = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.15, 4), metalMaterial);
        tipR.rotation.z = -Math.PI / 2 - 0.3;
        tipR.position.x = 0.15;
        tipR.position.y = 0.16;
        g.add(head, tipL, tipR);

        g.position.set(x, 0, z);
        g.rotation.z = Math.PI / 2 + (Math.random() - 0.5) * 0.5;
        g.rotation.y = Math.random() * Math.PI * 2;
        g.scale.set(1, 1, 1);
        g.userData = { type: 'pickaxe', color: null, heightOffset: 0.1 };
        return g;
    }

    createAxe(palette, x, z) {
        const g = new THREE.Group();
        const woodMaterial = new THREE.MeshStandardMaterial({ color: 0x5d4037, flatShading: true });
        const metalMaterial = new THREE.MeshStandardMaterial({ color: 0x78909c, flatShading: true });
        const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0xeeeeee, flatShading: true });

        const handleGeo = new THREE.CylinderGeometry(0.0125, 0.015, 0.5, 6);
        const handle = new THREE.Mesh(handleGeo, woodMaterial);
        g.add(handle);

        const headBaseGeo = new THREE.BoxGeometry(0.05, 0.075, 0.1);
        const headBase = new THREE.Mesh(headBaseGeo, metalMaterial);
        headBase.position.y = 0.2;
        headBase.castShadow = true;
        g.add(headBase);

        const bladeGeo = new THREE.BoxGeometry(0.0075, 0.15, 0.125);
        const blade = new THREE.Mesh(bladeGeo, metalMaterial);
        blade.position.set(0, 0.2, 0.0875);
        blade.rotation.x = Math.PI / 8;
        blade.castShadow = true;
        g.add(blade);

        const edgeGeo = new THREE.BoxGeometry(0.0025, 0.1625, 0.0125);
        const edge = new THREE.Mesh(edgeGeo, edgeMaterial);
        edge.position.set(0, 0.2, 0.15);
        edge.rotation.x = Math.PI / 8;
        g.add(edge);

        g.position.set(x, 0, z);
        g.rotation.z = Math.PI / 2 + (Math.random() - 0.5) * 0.5;
        g.rotation.y = Math.random() * Math.PI * 2;
        g.scale.set(0, 0, 0);
        g.userData = { type: 'axe', color: null, heightOffset: 0.1 };
        return g;
    }

    createStatBoost(x, z, boostData) {
        const g = new THREE.Group();
        const colorMap = { attack: 0xff4444, speed: 0x44ff44, health: 0xff88cc };
        const color = new THREE.Color(colorMap[boostData.stat] || 0xffffff);

        const crystalGeo = new THREE.OctahedronGeometry(0.15, 0);
        const crystalMat = new THREE.MeshStandardMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: 0.6,
            flatShading: true
        });
        const crystal = new THREE.Mesh(crystalGeo, crystalMat);
        crystal.position.y = 0.3;
        g.add(crystal);

        g.position.set(x, 0, z);
        g.scale.set(0, 0, 0);
        g.userData = {
            type: 'statBoost',
            stat: boostData.stat,
            amount: boostData.amount,
            color: color,
            crystal: crystal,
            heightOffset: 0
        };
        return g;
    }

    /**
     * Create a spaceship (replaces boat).
     */
    createSpaceship(x, y, z, color) {
        const g = new THREE.Group();
        const darkMetal = color.clone().multiplyScalar(0.6);
        const lightMetal = color.clone().lerp(new THREE.Color(0xddccee), 0.3);

        // Hull pivot: holds every visible ship mesh (and the deck the player stands
        // on). `g`'s own quaternion is pure physics/orientation (yaw/pitch/auto-level,
        // read directly by the chase/cockpit cameras) — BoatSystem banks this child
        // pivot's local rotation.z into turns instead, so the visual roll never
        // touches physics, camera math, or collision. See BoatSystem for the bank logic.
        const hullPivot = new THREE.Group();
        g.add(hullPivot);

        // Main hull (elongated)
        const hullGeo = new THREE.BoxGeometry(1.6, 0.6, 3.8);
        const hull = new THREE.Mesh(hullGeo, this.getMat(darkMetal));
        hullPivot.add(hull);

        // Upper hull
        const upperGeo = new THREE.BoxGeometry(1.2, 0.4, 2.8);
        const upper = new THREE.Mesh(upperGeo, this.getMat(color));
        upper.position.y = 0.4;
        hullPivot.add(upper);

        // Cockpit dome
        const cockpitGeo = new THREE.SphereGeometry(0.5, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
        const cockpitMat = new THREE.MeshPhongMaterial({ color: 0x4488ff, transparent: true, opacity: 0.5, flatShading: true });
        const cockpit = new THREE.Mesh(cockpitGeo, cockpitMat);
        cockpit.position.set(0, 0.5, -0.8);
        hullPivot.add(cockpit);

        // Wings
        [-1, 1].forEach(side => {
            const wingGeo = new THREE.BoxGeometry(1.8, 0.08, 1.2);
            const wing = new THREE.Mesh(wingGeo, this.getMat(darkMetal));
            wing.position.set(side * 1.5, 0, 0.2);
            wing.rotation.z = side * 0.1;
            hullPivot.add(wing);
        });

        // Engine nozzles
        [-0.5, 0.5].forEach(xOff => {
            const nozzleGeo = new THREE.CylinderGeometry(0.15, 0.2, 0.5, 6);
            const nozzle = new THREE.Mesh(nozzleGeo, this.getMat(0x333333));
            nozzle.rotation.x = Math.PI / 2;
            nozzle.position.set(xOff, -0.1, 2.1);
            hullPivot.add(nozzle);

            // Engine glow
            const glowMat = new THREE.MeshBasicMaterial({ color: 0x44aaff, transparent: true, opacity: 0.6 });
            const glowGeo = new THREE.SphereGeometry(0.12, 6, 4);
            const glow = new THREE.Mesh(glowGeo, glowMat);
            glow.position.set(xOff, -0.1, 2.35);
            glow.userData = { isEngineGlow: true };
            hullPivot.add(glow);
        });

        // Deck platform (for the player to stand on)
        const deckGeo = new THREE.BoxGeometry(1.2, 0.08, 2.0);
        const deck = new THREE.Mesh(deckGeo, this.getMat(lightMetal));
        deck.position.y = 0.65;
        hullPivot.add(deck);

        g.position.set(x, y, z);
        g.userData = {
            type: 'spaceship',
            color: color,
            radius: 2.5,
            hullPivot: hullPivot,
            stats: {
                health: BOAT_BASE_HEALTH,
                maxHealth: BOAT_BASE_HEALTH,
                currentSpeed: 0,
                maxSpeed: BOAT_BASE_MAX_SPEED * 2,
                acceleration: BOAT_BASE_ACCELERATION * 1.5,
                turnSpeed: BOAT_BASE_TURN_SPEED,
                drag: BOAT_BASE_DRAG,
                brake: BOAT_BASE_BRAKE * 1.5
            }
        };
        return g;
    }

    // Legacy boat creation (now creates spaceship)
    createBoat(x, z, color) {
        return this.createSpaceship(x, 0, z, color);
    }

    createCat(x, z) {
        const g = new THREE.Group();
        const orange = new THREE.Color(0xE8963E);
        const white = new THREE.Color(0xFAF0E6);
        const darkOrange = orange.clone().multiplyScalar(0.7);
        const pink = new THREE.Color(0xFFB6C1);
        const eyeGreen = new THREE.Color(0x6BA54A);

        const body = new THREE.Mesh(
            new THREE.BoxGeometry(0.45, 0.35, 0.7),
            this.getMat(orange)
        );
        body.position.y = 0.35;
        g.add(body);

        const belly = new THREE.Mesh(
            new THREE.BoxGeometry(0.35, 0.12, 0.55),
            this.getMat(white)
        );
        belly.position.set(0, 0.14, 0);
        body.add(belly);

        const head = new THREE.Mesh(
            new THREE.BoxGeometry(0.38, 0.32, 0.32),
            this.getMat(orange)
        );
        head.position.set(0, 0.48, -0.42);
        g.add(head);

        const muzzle = new THREE.Mesh(
            new THREE.BoxGeometry(0.26, 0.16, 0.1),
            this.getMat(white)
        );
        muzzle.position.set(0, -0.06, -0.14);
        head.add(muzzle);

        const nose = new THREE.Mesh(
            new THREE.BoxGeometry(0.06, 0.04, 0.04),
            this.getMat(pink)
        );
        nose.position.set(0, -0.01, -0.18);
        head.add(nose);

        const eyeGeo = new THREE.SphereGeometry(0.04, 6, 6);
        const pupGeo = new THREE.SphereGeometry(0.02, 4, 4);
        const eyeMat = this.getMat(eyeGreen);
        const pupMat = this.getMat(0x111111);

        [-1, 1].forEach(side => {
            const eye = new THREE.Mesh(eyeGeo, eyeMat);
            eye.position.set(side * 0.1, 0.04, -0.16);
            head.add(eye);
            const pupil = new THREE.Mesh(pupGeo, pupMat);
            pupil.position.set(side * 0.1, 0.04, -0.19);
            head.add(pupil);
        });

        [-1, 1].forEach(side => {
            const ear = new THREE.Mesh(
                new THREE.ConeGeometry(0.07, 0.16, 4),
                this.getMat(orange)
            );
            ear.position.set(side * 0.12, 0.2, -0.02);
            ear.rotation.z = side * 0.2;
            head.add(ear);
            const innerEar = new THREE.Mesh(
                new THREE.ConeGeometry(0.04, 0.1, 4),
                this.getMat(pink)
            );
            innerEar.position.set(0, 0.01, -0.01);
            ear.add(innerEar);
        });

        const legGeo = new THREE.BoxGeometry(0.1, 0.2, 0.1);
        const legMat = this.getMat(white);
        const legPositions = [
            { x: -0.14, z: -0.22 },
            { x: 0.14, z: -0.22 },
            { x: -0.14, z: 0.22 },
            { x: 0.14, z: 0.22 }
        ];
        const legs = [];
        legPositions.forEach(lp => {
            const leg = new THREE.Mesh(legGeo, legMat);
            leg.position.set(lp.x, 0.1, lp.z);
            g.add(leg);
            legs.push(leg);
        });

        const tailBase = new THREE.Mesh(
            new THREE.CylinderGeometry(0.03, 0.04, 0.4, 4),
            this.getMat(orange)
        );
        tailBase.position.set(0, 0.45, 0.4);
        tailBase.rotation.x = 0.6;
        g.add(tailBase);

        const tailTip = new THREE.Mesh(
            new THREE.CylinderGeometry(0.02, 0.03, 0.2, 4),
            this.getMat(white)
        );
        tailTip.position.set(0, 0.22, 0.02);
        tailTip.rotation.x = -0.4;
        tailBase.add(tailTip);

        const chest = new THREE.Mesh(
            new THREE.BoxGeometry(0.3, 0.25, 0.08),
            this.getMat(white)
        );
        chest.position.set(0, 0.02, -0.32);
        body.add(chest);

        g.position.set(x, 0, z);
        g.userData = {
            type: 'cat',
            radius: 0.4,
            legs: legs,
            tail: tailBase,
            moveSpeed: 0.06,
            hopOffset: Math.random() * 100,
            followDist: 1.8,
            idleTimer: 0,
            isIdle: false,
            heightOffset: 0
        };
        return g;
    }
}
