// =====================================================
// ENTITY FACTORY CLASS - Space World Version
// =====================================================

import {
    BOAT_BASE_HEALTH, BOAT_BASE_MAX_SPEED, BOAT_BASE_ACCELERATION, BOAT_BASE_TURN_SPEED,
    BOAT_BASE_DRAG, BOAT_BASE_BRAKE
} from '../constants.js';
import SphericalUtils from './SphericalUtils.js';
import { SegmentMesh } from './ProceduralRig.js';

export default class EntityFactory {
    constructor(world, state) {
        this.world = world;
        this.state = state;
        this.O_Y = -1.4; // Legacy reference
    }

    getMat(color, flat = true) { return this.world.getMat(color, flat); }

    /**
     * Palette hue precedence: explicit sphereColor string > eco temperature >
     * fully random. Every branch draws exactly one Math.random() so the seeded
     * RNG consumes the same number of rolls whichever path runs.
     *
     * eco (optional, constants.PLANETS[].eco) biases the whole scheme:
     * temperature maps to base hue (hot ~0.0 scorched red, cold ~0.68 blue),
     * humidity scales flora/grass saturation (dry worlds read washed-out),
     * lightLevel scales terrain/flora lightness (outer worlds read darker).
     */
    generatePalette(sphereColor, eco = null) {
        // More disciplined art-direction: each family anchors the whole world on a
        // restrained base hue, then introduces only one controlled contrast note.
        const themes = [
            { h: 0.31, flora: 0.03, soil: -0.02, accent: 0.97, creature: 0.08, water: 0.56, sat: 0.52, mood: 0.00 }, // moss, stone, terracotta
            { h: 0.55, flora: -0.05, soil: 0.04, accent: 0.11, creature: 0.12, water: 0.58, sat: 0.48, mood: -0.02 }, // teal slate, warm ochre
            { h: 0.67, flora: -0.12, soil: -0.03, accent: 0.39, creature: 0.36, water: 0.60, sat: 0.44, mood: -0.04 }, // alpine blue, pine green
            { h: 0.06, flora: 0.08, soil: 0.01, accent: 0.53, creature: 0.58, water: 0.54, sat: 0.50, mood: 0.02 }, // clay, muted aqua
            { h: 0.79, flora: 0.10, soil: -0.06, accent: 0.18, creature: 0.15, water: 0.62, sat: 0.42, mood: -0.03 }, // dusk violet, brass
            { h: 0.43, flora: 0.00, soil: -0.05, accent: 0.88, creature: 0.90, water: 0.57, sat: 0.46, mood: 0.01 }  // sage, rose sandstone
        ];
        const theme = themes[Math.floor(Math.random() * themes.length)];
        const temperature = eco ? eco.temperature : 0.5;
        const humidity = eco ? eco.humidity : 0.55;
        const lightLevel = eco ? eco.lightLevel : 1.0;
        let hue;
        if (sphereColor) {
            const explicit = sphereColor === 'red' ? 0.985 : sphereColor === 'blue' ? 0.63 : 0.10;
            hue = (explicit + (Math.random() - 0.5) * 0.045 + 1) % 1;
        } else {
            const climateHue = 0.68 * (1 - temperature);
            const delta = ((climateHue - theme.h + 1.5) % 1) - 0.5;
            hue = (theme.h + delta * 0.18 + (Math.random() - 0.5) * 0.03 + 1) % 1;
        }
        const clamp01 = (v) => Math.max(0, Math.min(1, v));
        const hsl = (h, sat, light) => new THREE.Color().setHSL((h + 1) % 1, clamp01(sat), Math.min(0.78, Math.max(0.06, light)));
        const brightness = clamp01(0.70 + lightLevel * 0.22);
        const sat = theme.sat + humidity * 0.10;
        const floraHue = (hue + theme.flora + (Math.random() - 0.5) * 0.025 + 1) % 1;
        const soilHue = (hue + theme.soil + 1) % 1;
        const accentHue = (theme.accent + (hue - theme.h) * 0.12 + 1) % 1;
        const creatureHue = (accentHue + theme.creature * 0.08 + (Math.random() - 0.5) * 0.03 + 1) % 1;

        const baseRock = hsl(hue, 0.17 + humidity * 0.06, (0.16 + theme.mood) * brightness);
        const soil = hsl(soilHue, 0.24 + humidity * 0.08, (0.26 + theme.mood) * brightness);
        const groundTop = hsl(floraHue - 0.018, sat * 0.62, (0.33 + humidity * 0.05 + theme.mood) * brightness);
        const flora = hsl(floraHue, sat * 0.88, (0.41 + humidity * 0.06 + theme.mood) * brightness);
        const floraAccent = hsl(floraHue + 0.035, sat * 0.76, (0.53 + humidity * 0.04 + theme.mood) * brightness);
        const tallGrass = hsl(floraHue - 0.022, sat * 0.82, (0.46 + humidity * 0.05 + theme.mood) * brightness);
        const creature = hsl(creatureHue, 0.42 + humidity * 0.07, (0.53 + theme.mood) * brightness);
        const accent = hsl(accentHue, 0.52, (0.61 + theme.mood * 0.5) * brightness);
        const background = hsl(hue + 0.44, 0.22, 0.56 + theme.mood * 0.4);
        const skyGlow = hsl(hue + 0.22, 0.34, 0.60 + theme.mood * 0.35);
        const water = hsl(theme.water + (hue - theme.h) * 0.08, 0.46 + humidity * 0.06, (0.44 + theme.mood * 0.2) * brightness);
        const waterDeep = water.clone().offsetHSL(-0.02, -0.02, -0.18);
        const shadow = hsl(hue + 0.48, 0.22, 0.10);
        const sunlit = hsl(accentHue - 0.02, 0.28, 0.70);
        const trunk = soil.clone().lerp(baseRock, 0.45);
        return { background, baseRock, trunk, soil, groundTop, flora, floraAccent, tallGrass, creature, accent, skyGlow, water, waterDeep, shadow, sunlit };
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
        const treeArchetypes = ['umbrella', 'bulb', 'spire', 'coral', 'fan', 'spiral'];
        const bushArchetypes = ['coral', 'succulent', 'pod', 'fan', 'anemone'];
        const grassVariants = ['meadow', 'fern', 'reed', 'ribbon', 'spore'];
        const flowerFamilies = ['star', 'orb', 'cup', 'pinwheel', 'cluster'];
        return {
            tree: {
                shape: ['cone', 'box', 'round', 'cylinder'][Math.floor(Math.random() * 4)],
                archetype: treeArchetypes[Math.floor(Math.random() * treeArchetypes.length)],
                heightMod: 1.15 + Math.random() * 0.95,
                thickMod: 0.55 + Math.random() * 0.85,
                canopyLayers: 2 + Math.floor(Math.random() * 3),
                twist: (Math.random() - 0.5) * 0.55
            },
            bush: {
                shape: ['sphere', 'cone', 'round'][Math.floor(Math.random() * 3)],
                archetype: bushArchetypes[Math.floor(Math.random() * bushArchetypes.length)],
                scaleY: 0.7 + Math.random() * 0.5,
                lobes: 3 + Math.floor(Math.random() * 4),
                berries: Math.random() > 0.45
            },
            rock: { shape: ['ico', 'box', 'dodec', 'slab'][Math.floor(Math.random() * 4)], stretch: 0.8 + Math.random() * 0.8 },
            creature: { shape: shape, speciesType: speciesType, eyes: eyeCount, scale: stats.scaleMin + Math.random() * (stats.scaleMax - stats.scaleMin), eyeScale: 1.0 + Math.random() * 0.6, moveSpeed: stats.speed, temperament: stats.temperament, trait: ['antennae', 'shell', 'ears', 'crest', 'tail'][Math.floor(Math.random() * 5)], markings: 1 + Math.floor(Math.random() * 4) },
            grass: { height: 0.3 + Math.random() * 0.5, variant: grassVariants[Math.floor(Math.random() * grassVariants.length)] },
            flower: { family: flowerFamilies[Math.floor(Math.random() * flowerFamilies.length)] }
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
        // Indexed geometries (Cone, Box, Sphere...) must be expanded first:
        // the loop below reads vertices as a triangle soup, so feeding it an
        // indexed geometry would rebuild the index from dedup order and draw
        // garbage triangles.
        if (geometry.index !== null) geometry = geometry.toNonIndexed();
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
     * Deterministic 3D hash -> value in [-1, 1]. Classic GLSL-style sin/fract
     * hash, pure function of its inputs (no Math.random()) so results only
     * depend on (x, y, z) — used as the corner-sample source for
     * _valueNoise3 below.
     */
    _hash3(x, y, z) {
        const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123;
        return 2.0 * (s - Math.floor(s)) - 1.0;
    }

    /**
     * Single-octave 3D value noise: trilinear interpolation (with a
     * smoothstep-eased blend, not a raw lerp) between the 8 hashed lattice
     * corners surrounding (x, y, z). Continuous and coherent — neighboring
     * samples produce similar values, unlike raw hash noise.
     */
    _valueNoise3(x, y, z) {
        const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
        const xf = x - xi, yf = y - yi, zf = z - zi;
        const u = xf * xf * (3 - 2 * xf);
        const v = yf * yf * (3 - 2 * yf);
        const w = zf * zf * (3 - 2 * zf);
        const lerp = (a, b, t) => a + t * (b - a);
        const n000 = this._hash3(xi, yi, zi);
        const n100 = this._hash3(xi + 1, yi, zi);
        const n010 = this._hash3(xi, yi + 1, zi);
        const n110 = this._hash3(xi + 1, yi + 1, zi);
        const n001 = this._hash3(xi, yi, zi + 1);
        const n101 = this._hash3(xi + 1, yi, zi + 1);
        const n011 = this._hash3(xi, yi + 1, zi + 1);
        const n111 = this._hash3(xi + 1, yi + 1, zi + 1);
        const nx00 = lerp(n000, n100, u);
        const nx10 = lerp(n010, n110, u);
        const nx01 = lerp(n001, n101, u);
        const nx11 = lerp(n011, n111, u);
        const nxy0 = lerp(nx00, nx10, v);
        const nxy1 = lerp(nx01, nx11, v);
        return lerp(nxy0, nxy1, w);
    }

    /**
     * Multi-octave (fbm) terrain displacement — used ONLY by createPlanet's
     * layers (core/soil/surface). Distinct from distortGeometryRadial, which
     * rocks/mountains/gold ore still depend on and which is NOT touched here.
     *
     * Displaces each vertex along its own radial direction by a sum of 3
     * halving-amplitude/increasing-frequency value-noise octaves sampled from
     * (normalized vertex direction * frequency + planetSeed). Pure function of
     * (geometry, planetSeed, amplitude) — no Math.random() anywhere in this
     * method — so every client renders byte-identical terrain from the same
     * seed, and per-vertex evaluation order doesn't matter (each vertex only
     * reads its own direction). `planetSeed` is the one seeded Math.random()
     * roll createPlanet takes per planet (see caller).
     *
     * `amplitude` is the octave-1 amplitude; octaves 2 and 3 contribute half
     * and a quarter of that on top (max combined offset ~= amplitude * 1.75),
     * so callers should pass a smaller base amplitude than the old single-
     * octave `distortGeometryRadial` intensity to land in the same height range
     * while gaining coherent macro-features (basins/ridges) from the lower
     * octaves instead of high-frequency noise alone.
     */
    distortGeometryFBM(geometry, planetSeed, amplitude) {
        const merged = this.mergeVertices(geometry);
        const posAttribute = merged.attributes.position;
        const octaves = [
            { freq: 1.10, amp: amplitude },
            { freq: 2.25, amp: amplitude * 0.52 },
            { freq: 4.80, amp: amplitude * 0.24 },
            { freq: 9.60, amp: amplitude * 0.11 }
        ];
        for (let i = 0; i < posAttribute.count; i++) {
            const x = posAttribute.getX(i);
            const y = posAttribute.getY(i);
            const z = posAttribute.getZ(i);
            const len = Math.sqrt(x * x + y * y + z * z);
            if (len < 0.001) continue;
            const nx = x / len, ny = y / len, nz = z / len;
            let noise = 0;
            for (const oct of octaves) {
                noise += this._valueNoise3(
                    nx * oct.freq + planetSeed,
                    ny * oct.freq + planetSeed * 1.31,
                    nz * oct.freq + planetSeed * 0.73
                ) * oct.amp;
            }
            // A small ridged component makes shallow knuckles and hummocks visible
            // between the broad hills without turning the terrain into spikes.
            const ridgeSample = this._valueNoise3(
                nx * 6.7 + planetSeed * 0.41,
                ny * 6.7 + planetSeed * 0.89,
                nz * 6.7 + planetSeed * 1.17
            );
            const ridge = (0.5 - Math.abs(ridgeSample)) * amplitude * 0.34;
            const micro = this._valueNoise3(
                nx * 14.5 + planetSeed * 1.7,
                ny * 14.5 + planetSeed * 0.3,
                nz * 14.5 + planetSeed * 2.1
            ) * amplitude * 0.075;
            const displacement = noise + ridge + micro;
            posAttribute.setX(i, x + nx * displacement);
            posAttribute.setY(i, y + ny * displacement);
            posAttribute.setZ(i, z + nz * displacement);
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
    createPlanet(palette, cx, cy, cz, radius, hasAtmosphere = false, eco = null) {
        const g = new THREE.Group();
        // C4: flat detail cap for every planet. The old radius-scaled formula
        // (up to 6) put planet 3 (r=30) at ~246K tris across its 3 layers; at
        // 0.5 render scale + pixelation that vertex density is imperceptible,
        // so cap everyone at 4 (~5K tris/layer) and spend the budget on FBM
        // noise (below) instead of raw mesh resolution.
        const detail = 4;
        const seed = cx * 7 + cy * 13 + cz * 19 + radius; // deterministic per planet (position/size only)
        // C4: one seeded Math.random() roll per planet, feeding distortGeometryFBM
        // below so terrain varies planet-to-planet independent of position/radius.
        // Unconditional + fixed call order (exactly one roll per createPlanet call,
        // same code path every time) — safe under the shared seeded RNG.
        const planetSeed = Math.random() * 1000;

        // Smooth-shaded materials for planet layers. r128's MeshToonMaterial has no
        // flatShading property (was always a silent no-op / console warning) —
        // smoothing here actually comes from the geometry never calling
        // computeVertexNormals() with flat winding, not from this option.
        const coreMat = this.getMat(palette.baseRock, true);
        const soilMat = this.getMat(palette.soil, true);
        const surfaceMat = this.getMat(palette.groundTop, false);

        // Core/soil/surface layers use distortGeometryFBM (coherent multi-octave
        // noise) instead of distortGeometryRadial — amplitudes chosen so the
        // combined 3-octave height range (~1.75x the base amplitude below)
        // lands at or under the old single-octave intensities (0.04/0.03/0.02
        // x radius) while gaining macro basins/ridges instead of pure high-
        // frequency bumps.

        // Core rock layer
        const coreGeoRaw = new THREE.IcosahedronGeometry(radius * 0.95, detail);
        const coreGeo = this.distortGeometryFBM(coreGeoRaw, planetSeed + 1, radius * 0.019);
        const core = new THREE.Mesh(coreGeo, coreMat);
        core.receiveShadow = true;
        g.add(core);

        // Soil layer
        const soilGeoRaw = new THREE.IcosahedronGeometry(radius * 0.98, detail);
        const soilGeo = this.distortGeometryFBM(soilGeoRaw, planetSeed + 2, radius * 0.016);
        const soil = new THREE.Mesh(soilGeo, soilMat);
        soil.receiveShadow = true;
        g.add(soil);

        // Surface (grass) layer - the main collision surface
        const surfaceGeoRaw = new THREE.IcosahedronGeometry(radius, detail);
        // 0.016 (was 0.011): slightly stronger relief so planets read as rolling
        // terrain instead of near-perfect spheres. Safe for gameplay — player,
        // creature, and prop placement all sample the real displaced mesh via
        // SphericalUtils.sampleTerrainHeight, not the nominal radius.
        const relief = radius * (0.021 + (eco ? eco.humidity * 0.004 + eco.toxicity * 0.003 : 0.002));
        const surfaceGeo = this.distortGeometryFBM(surfaceGeoRaw, planetSeed + 3, relief);
        const surface = new THREE.Mesh(surfaceGeo, surfaceMat);
        surface.receiveShadow = true;
        surface.userData = { type: 'ground' };
        g.add(surface);

        // Atmosphere glow — fresnel rim shader instead of a flat-opacity shell.
        // BackSide sphere slightly larger than the surface wraps the planet's
        // silhouette; only the far hemisphere's back faces render (near-side
        // front faces are culled), and the fragment shader boosts opacity at
        // grazing view angles so the glow reads as a thin halo hugging the
        // edge rather than a uniform haze dome. Additive blending + no depth
        // write means it never occludes anything and layers naturally over
        // stars/other planets. Color/intensity are tinted per palette and
        // vary slightly per planet via a deterministic hash of `seed` (no
        // extra Math.random() calls — keeps this independent of RNG order).
        // ShaderMaterial doesn't react to scene fog by default, which is what
        // we want for a glow shell (see WorldManager's space fog).
        // Populated below when hasAtmosphere — surfaced on the return value so
        // the caller (GameEngine) can track {mesh, shellRadius} per planet and
        // fade uFade by camera distance each frame (see animate()). Kept null
        // otherwise so callers can cheaply skip planets with no atmosphere.
        let atmosphereInfo = null;

        if (hasAtmosphere) {
            const atmosScale = 1.06 + Math.abs(Math.sin(seed * 0.5)) * 0.04; // 1.06-1.10x radius
            // The fresnel rim glow below is entirely per-fragment (rim = f(vNormal,
            // vViewDir), both interpolated) — it doesn't read per-vertex noise or
            // displacement, so it doesn't need the terrain-grade tessellation the
            // other layers use. detail 2 = 320 tris vs. the old detail+1 (5) = 20,480
            // tris — same smooth rim at this render scale, ~1/64th the geometry.
            const atmosGeo = new THREE.IcosahedronGeometry(radius * atmosScale, 2);
            const atmosColor = palette.background.clone().lerp(palette.accent, 0.35);
            // Tightened from the original 0.9-1.3: from inside the BackSide shell
            // (standing on the surface) the far wall fills the whole sky, so even
            // a "moderate" intensity read as a flat white veil before uFade existed.
            // uFade now hides that case entirely, but the from-space rim itself was
            // also a bit hot — trimmed the ceiling so the glow stays a rim accent,
            // not a wash, once fully faded in.
            let atmosIntensity = 0.7 + Math.abs(Math.sin(seed * 1.7)) * 0.3; // 0.7-1.0
            // Ecosystem identity on the shell (static eco data, no RNG): toxic
            // worlds get a sickly green haze, cold worlds shift toward pale ice
            // blue, humid worlds read denser. Ceiling 1.1 keeps the humid boost
            // from re-introducing the flat-veil wash trimmed above.
            if (eco) {
                if (eco.toxicity > 0) atmosColor.lerp(new THREE.Color(0x7dff5a), eco.toxicity * 0.6);
                else atmosColor.lerp(new THREE.Color(0xa8d8ff), (1 - eco.temperature) * 0.35);
                atmosIntensity = Math.min(1.1, atmosIntensity * (0.8 + 0.4 * eco.humidity));
            }
            const atmosMat = new THREE.ShaderMaterial({
                uniforms: {
                    color: { value: atmosColor },
                    intensity: { value: atmosIntensity },
                    // Distance-based fade so the shell is invisible from inside
                    // (standing on the surface) and full-strength from space —
                    // see GameEngine.animate(), which drives this per frame.
                    uFade: { value: 1.0 }
                },
                vertexShader: `
                    varying vec3 vNormal;
                    varying vec3 vViewDir;
                    void main() {
                        vNormal = normalize(normalMatrix * normal);
                        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                        vViewDir = normalize(-mvPosition.xyz);
                        gl_Position = projectionMatrix * mvPosition;
                    }
                `,
                fragmentShader: `
                    uniform vec3 color;
                    uniform float intensity;
                    uniform float uFade;
                    varying vec3 vNormal;
                    varying vec3 vViewDir;
                    void main() {
                        // Tightened from pow(rim, 2.5): a steeper falloff keeps the glow
                        // hugging the silhouette edge instead of reading as a hot dome
                        // once uFade is at full strength in deep space.
                        float rim = 1.0 - max(dot(normalize(vNormal), normalize(vViewDir)), 0.0);
                        float glow = pow(rim, 3.5) * intensity * uFade;
                        gl_FragColor = vec4(color, glow);
                    }
                `,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                side: THREE.BackSide
            });
            const atmos = new THREE.Mesh(atmosGeo, atmosMat);
            g.add(atmos);
            atmosphereInfo = { mesh: atmos, shellRadius: radius * atmosScale };
        }

        // A low-cost palette light gives metallic tools, ship panels and water
        // sparkles a local colored stage glow; unlit terrain and organisms ignore it.
        const planetGlow = new THREE.PointLight(palette.skyGlow || palette.accent, 0.42 * (eco ? eco.lightLevel : 1), radius * 3.4, 2.0);
        planetGlow.position.set(radius * 0.35, radius * 1.15, radius * 0.30);
        g.add(planetGlow);

        g.position.set(cx, cy, cz);

        return {
            group: g,
            groundMesh: surface,
            center: new THREE.Vector3(cx, cy, cz),
            radius: radius,
            atmosphere: atmosphereInfo
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

        // Light distortion on the main peak and sub-peaks so mountains stop
        // being pristine cone clones — kept subtle (small factor) since these
        // are large silhouettes seen from a distance. Snow cap left pristine.
        const peakGeo = this.distortGeometryRadial(new THREE.ConeGeometry(10 * scale, 12 * scale, 6), scale * 0.5, Math.random() * 1000);
        const peak = new THREE.Mesh(peakGeo, stoneMat);
        peak.position.y = 5 * scale;
        g.add(peak);

        const capGeo = new THREE.ConeGeometry(4 * scale, 4 * scale, 6);
        const cap = new THREE.Mesh(capGeo, this.getMat(0xffffff));
        cap.position.y = 9 * scale;
        g.add(cap);

        for (let i = 0; i < 4; i++) {
            const s = (0.5 + Math.random() * 0.5) * scale;
            const subPeakGeo = this.distortGeometryRadial(new THREE.ConeGeometry(6 * s, 8 * s, 5), s * 0.4, Math.random() * 1000);
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
        const goldMat = new THREE.MeshStandardMaterial({
            color: 0xffd700, emissive: 0x8a5900, emissiveIntensity: 0.65,
            roughness: 0.34, metalness: 0.72
        });

        // Distort the stone body only — same subtle-lumpiness factor as
        // regular ico/dodec rocks. Ore chunks stay pristine boxes so their
        // emissive glow silhouette reads clearly against the rough rock.
        const rockGeo = this.distortGeometryRadial(
            new THREE.DodecahedronGeometry(0.8 * scale, 0),
            0.8 * scale * (0.12 + Math.random() * 0.06),
            Math.random() * 1000
        );
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

    /**
     * Ring-exclusive crystal formation (kind: 'fire_crystal' | 'frost_crystal').
     * Same recipe as the gold rock — dark distorted base with emissive growths
     * spottable from a distance — but the growths are crystal spikes and
     * mining pays out a stat essence (see constants.CRYSTAL_ESSENCE_MAP)
     * instead of ore.
     */
    createCrystal(p, x, z, kind, scale = 1.0) {
        const g = new THREE.Group();
        const stoneMat = this.getMat(p.baseRock.clone().lerp(new THREE.Color(0x333333), 0.5));
        const tint = kind === 'fire_crystal' ? 0xff5522 : 0x7de8ff;
        const crystalMat = new THREE.MeshStandardMaterial({ color: tint, emissive: tint, emissiveIntensity: 0.9, roughness: 0.24, metalness: 0.12 });

        const baseGeo = this.distortGeometryRadial(
            new THREE.DodecahedronGeometry(0.7 * scale, 0),
            0.7 * scale * (0.12 + Math.random() * 0.06),
            Math.random() * 1000
        );
        g.add(new THREE.Mesh(baseGeo, stoneMat));

        for (let i = 0; i < 4; i++) {
            const h = (0.7 + Math.random() * 0.6) * scale;
            const spike = new THREE.Mesh(new THREE.ConeGeometry(0.16 * scale, h, 5), crystalMat);
            const ang = Math.random() * Math.PI * 2;
            const lean = 0.25 + Math.random() * 0.5;
            spike.position.set(Math.cos(ang) * 0.35 * scale, 0.3 * scale + h * 0.3, Math.sin(ang) * 0.35 * scale);
            spike.rotation.set(Math.sin(ang) * lean, 0, -Math.cos(ang) * lean);
            g.add(spike);
        }

        g.position.set(x, 0, z);
        g.userData = { type: kind, radius: 0.7 * scale, color: p.baseRock, heightOffset: 0.3 + 0.15 * scale };
        this.state.obstacles.push(g);
        return g;
    }

    /**
     * Ember shard: a small pair of self-lit tetrahedra for scorched worlds.
     * MeshBasicMaterial ignores scene lighting, so shards glow against the
     * dark rock — the cheap static stand-in for drifting ember particles.
     */
    createEmberShard(scale = 1.0) {
        const g = new THREE.Group();
        const shard = new THREE.Mesh(
            new THREE.TetrahedronGeometry(0.3 * scale, 0),
            new THREE.MeshBasicMaterial({ color: 0xff5522 })
        );
        shard.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        g.add(shard);
        const core = new THREE.Mesh(
            new THREE.TetrahedronGeometry(0.16 * scale, 0),
            new THREE.MeshBasicMaterial({ color: 0xffcc55 })
        );
        core.position.set(0.18 * scale, 0.08 * scale, -0.08 * scale);
        core.rotation.set(Math.random() * Math.PI, 0, Math.random() * Math.PI);
        g.add(core);
        g.userData = { type: 'ember', radius: 0.3 * scale, heightOffset: 0.12 * scale };
        return g;
    }

    /**
     * Stylized pond: two stacked discs — a dark shore ring under a lighter,
     * slightly transparent water disc — that hug the local terrain via
     * placeOnPlanet's height sampling. Water is a fixed stylized blue rather
     * than a palette color so humid worlds read as "has water" at a glance.
     * Flat discs on bumpy FBM terrain intersect the ground here and there;
     * that reads as water meeting its banks, which is the point. RNG-free —
     * size variety comes from the caller's scale roll.
     */
    createPond(p, x, z, scale = 1.0) {
        const g = new THREE.Group();
        const makeBlob = (radius, segments, wobble) => {
            const shape = new THREE.Shape();
            for (let i = 0; i < segments; i++) {
                const a = (i / segments) * Math.PI * 2;
                const r = radius * (1 + Math.sin(a * 3 + scale) * wobble + Math.sin(a * 5 - scale * 0.7) * wobble * 0.45);
                const px = Math.cos(a) * r;
                const py = Math.sin(a) * r;
                if (i === 0) shape.moveTo(px, py); else shape.lineTo(px, py);
            }
            shape.closePath();
            return new THREE.ShapeGeometry(shape);
        };

        const bankGeo = makeBlob(1.38 * scale, 26, 0.09);
        const bank = new THREE.Mesh(bankGeo, this.getMat(p.soil.clone().lerp(p.waterDeep || new THREE.Color(0x163c5d), 0.34), false));
        bank.rotation.x = -Math.PI / 2;
        bank.position.y = 0.025;
        g.add(bank);

        const waterColor = (p.water || new THREE.Color(0x38bce8)).clone();
        const waterGeo = makeBlob(1.14 * scale, 26, 0.075);
        const water = new THREE.Mesh(waterGeo, new THREE.MeshBasicMaterial({
            color: waterColor, transparent: true, opacity: 0.78, depthWrite: false
        }));
        water.rotation.x = -Math.PI / 2;
        water.position.y = 0.075;
        g.add(water);

        const shimmer = new THREE.Mesh(
            new THREE.CircleGeometry(0.58 * scale, 20),
            new THREE.MeshBasicMaterial({
                color: p.skyGlow || p.accent, transparent: true, opacity: 0.18,
                depthWrite: false, blending: THREE.AdditiveBlending
            })
        );
        shimmer.rotation.x = -Math.PI / 2;
        shimmer.scale.set(1.35, 0.58, 1);
        shimmer.position.set(-0.20 * scale, 0.086, -0.12 * scale);
        g.add(shimmer);

        // Reeds make ponds read as ecological features instead of flat decals.
        const reedMat = this.getMat(p.tallGrass || p.flora, true);
        const seedMat = this.getMat(p.floraAccent || p.accent, true);
        for (let i = 0; i < 7; i++) {
            const a = (i / 7) * Math.PI * 2 + scale * 0.4;
            const r = 1.12 * scale * (0.94 + (i % 2) * 0.08);
            const h = 0.38 + (i % 3) * 0.12;
            const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.025, h, 5), reedMat);
            stem.position.set(Math.cos(a) * r, h * 0.5, Math.sin(a) * r);
            stem.rotation.z = Math.sin(a) * 0.10;
            g.add(stem);
            if (i % 2 === 0) {
                const seed = new THREE.Mesh(new THREE.SphereGeometry(0.055, 5, 4), seedMat);
                seed.position.set(Math.cos(a) * r, h + 0.04, Math.sin(a) * r);
                seed.scale.y = 1.6;
                g.add(seed);
            }
        }
        g.position.set(x, 0, z);
        g.userData = { type: 'pond', radius: 1.42 * scale, heightOffset: 0.035, water, shimmer, phase: Math.random() * Math.PI * 2 };
        return g;
    }

    createTree(p, x, z, style = null) {
        const g = new THREE.Group();
        const treeChoices = ['umbrella', 'bulb', 'spire', 'coral', 'fan', 'spiral'];
        const dna = style || {
            color: p.flora.clone(), accentColor: (p.floraAccent || p.accent).clone(), trunkColor: p.trunk.clone(), shape: this.state.worldDNA.tree.shape,
            archetype: this.state.worldDNA.tree.archetype || treeChoices[Math.floor(Math.random() * treeChoices.length)],
            height: 1.45 * this.state.worldDNA.tree.heightMod + Math.random() * 0.55, thickness: 0.18 * this.state.worldDNA.tree.thickMod,
            canopyLayers: this.state.worldDNA.tree.canopyLayers || 3, twist: this.state.worldDNA.tree.twist || 0
        };
        if (!dna.archetype) dna.archetype = treeChoices[Math.floor(Math.random() * treeChoices.length)];

        const trunkMat = this.getMat(dna.trunkColor);
        const foliageMat = this.getMat(dna.color);
        const accentMat = this.getMat((dna.accentColor || dna.color).clone());
        const height = dna.height;
        const thickness = dna.thickness;
        const organicCurve = (dna.twist || 0) + (Math.random() - 0.5) * 0.28;

        let tip = new THREE.Vector3(0, height, 0);
        let current = new THREE.Vector3(0, 0, 0);
        const segs = 4 + Math.floor(Math.random() * 3);
        for (let i = 0; i < segs; i++) {
            const t0 = i / segs;
            const t1 = (i + 1) / segs;
            const y0 = height * t0;
            const y1 = height * t1;
            const lateral0 = Math.sin(t0 * 1.8 + organicCurve * 2.6) * thickness * 0.95;
            const lateral1 = Math.sin(t1 * 1.8 + organicCurve * 2.6) * thickness * 0.95;
            const z0 = Math.cos(t0 * 1.4 + organicCurve * 1.7) * thickness * 0.55;
            const z1 = Math.cos(t1 * 1.4 + organicCurve * 1.7) * thickness * 0.55;
            const p0 = new THREE.Vector3(lateral0, y0, z0);
            const p1 = new THREE.Vector3(lateral1, y1, z1);
            const dir = p1.clone().sub(p0);
            const len = dir.length();
            const mid = p0.clone().add(p1).multiplyScalar(0.5);
            const radiusTop = thickness * (0.88 - t1 * 0.45);
            const radiusBottom = thickness * (1.0 - t0 * 0.32);
            const seg = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, len, 6), trunkMat);
            seg.position.copy(mid);
            seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
            g.add(seg);
            current.copy(p1);
            if (i > 0 && i < segs - 1 && Math.random() < 0.45) {
                const bLen = height * (0.16 + Math.random() * 0.10);
                const a = organicCurve + i * 1.6 + Math.random() * 1.2;
                const branch = new THREE.Mesh(new THREE.CylinderGeometry(thickness * 0.16, thickness * 0.23, bLen, 5), trunkMat);
                branch.position.copy(p1.clone().add(new THREE.Vector3(Math.cos(a) * thickness * 0.22, bLen * 0.22, Math.sin(a) * thickness * 0.22)));
                const branchDir = new THREE.Vector3(Math.cos(a) * 0.75, 0.65, Math.sin(a) * 0.75).normalize();
                branch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), branchDir);
                g.add(branch);
                const tipOrb = new THREE.Mesh(new THREE.SphereGeometry(thickness * 0.22, 5, 4), accentMat);
                tipOrb.position.copy(branch.position).add(branchDir.clone().multiplyScalar(bLen * 0.56));
                g.add(tipOrb);
            }
        }
        tip.copy(current);

        for (let i = 0; i < 3; i++) {
            const a = i / 3 * Math.PI * 2 + organicCurve;
            const root = new THREE.Mesh(new THREE.CylinderGeometry(thickness * 0.15, thickness * 0.28, thickness * 2.4, 5), trunkMat);
            root.position.set(Math.cos(a) * thickness * 0.7, thickness * 0.25, Math.sin(a) * thickness * 0.7);
            root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.cos(a) * 0.88, 0.28, Math.sin(a) * 0.88).normalize());
            g.add(root);
        }

        const archetype = dna.archetype;
        if (archetype === 'umbrella') {
            const canopy = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.15, 0.22, 8), foliageMat);
            canopy.position.copy(tip.clone().add(new THREE.Vector3(0, 0.18, 0)));
            canopy.scale.set(0.9 + Math.random() * 0.6, 1, 0.9 + Math.random() * 0.6);
            g.add(canopy);
            const crown = new THREE.Mesh(new THREE.SphereGeometry(0.42, 7, 6), accentMat);
            crown.position.copy(canopy.position).add(new THREE.Vector3(0, 0.18, 0));
            crown.scale.y = 0.55;
            g.add(crown);
            const fringeCount = 5 + Math.floor(Math.random() * 3);
            for (let i = 0; i < fringeCount; i++) {
                const a = i / fringeCount * Math.PI * 2;
                const frond = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.42 + Math.random() * 0.22, 0.07), accentMat);
                frond.position.copy(canopy.position).add(new THREE.Vector3(Math.cos(a) * canopy.scale.x * 0.55, -0.06, Math.sin(a) * canopy.scale.z * 0.55));
                frond.rotation.z = Math.cos(a) * 0.35;
                frond.rotation.x = Math.sin(a) * 0.22;
                g.add(frond);
            }
        } else if (archetype === 'bulb') {
            const bulbCount = 3 + Math.floor(Math.random() * 3);
            for (let i = 0; i < bulbCount; i++) {
                const a = i / bulbCount * Math.PI * 2 + Math.random() * 0.4;
                const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.38 + Math.random() * 0.12, 7, 6), i % 2 ? accentMat : foliageMat);
                bulb.position.copy(tip).add(new THREE.Vector3(Math.cos(a) * 0.28, 0.18 + (Math.random() - 0.5) * 0.18, Math.sin(a) * 0.28));
                bulb.scale.set(1.0, 0.9 + Math.random() * 0.5, 1.0);
                g.add(bulb);
            }
            const crown = new THREE.Mesh(new THREE.SphereGeometry(0.32, 6, 5), foliageMat);
            crown.position.copy(tip).add(new THREE.Vector3(0, 0.42, 0));
            crown.scale.y = 1.3;
            g.add(crown);
        } else if (archetype === 'spire') {
            const capColorMat = Math.random() > 0.5 ? accentMat : foliageMat;
            let y = 0.05;
            const tiers = 3 + Math.floor(Math.random() * 3);
            for (let i = 0; i < tiers; i++) {
                const r = 0.58 - i * 0.10;
                const cap = new THREE.Mesh(new THREE.ConeGeometry(r, 0.55, 7), i === tiers - 1 ? accentMat : foliageMat);
                cap.position.copy(tip).add(new THREE.Vector3(0, y, 0));
                cap.scale.y = 0.8 + Math.random() * 0.35;
                g.add(cap);
                y += 0.38;
            }
            const seed = new THREE.Mesh(new THREE.SphereGeometry(0.14, 5, 4), capColorMat);
            seed.position.copy(tip).add(new THREE.Vector3(0, y + 0.12, 0));
            g.add(seed);
        } else if (archetype === 'coral') {
            const armCount = 4 + Math.floor(Math.random() * 3);
            for (let i = 0; i < armCount; i++) {
                const a = i / armCount * Math.PI * 2 + Math.random() * 0.35;
                const armLen = 0.7 + Math.random() * 0.35;
                const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.16, armLen, 5), foliageMat);
                const dir = new THREE.Vector3(Math.cos(a) * 0.85, 0.45 + Math.random() * 0.25, Math.sin(a) * 0.85).normalize();
                arm.position.copy(tip).add(dir.clone().multiplyScalar(armLen * 0.42));
                arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
                g.add(arm);
                const blossom = new THREE.Mesh(new THREE.SphereGeometry(0.16 + Math.random() * 0.08, 6, 5), i % 2 ? accentMat : foliageMat);
                blossom.position.copy(tip).add(dir.clone().multiplyScalar(armLen * 0.84));
                blossom.scale.set(1.1, 0.7, 1.1);
                g.add(blossom);
            }
            const hub = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 5), accentMat);
            hub.position.copy(tip).add(new THREE.Vector3(0, 0.12, 0));
            g.add(hub);
        } else if (archetype === 'fan') {
            const leafCount = 6 + Math.floor(Math.random() * 3);
            for (let i = 0; i < leafCount; i++) {
                const a = i / leafCount * Math.PI * 2;
                const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.78 + Math.random() * 0.22, 0.42), i % 3 === 0 ? accentMat : foliageMat);
                leaf.position.copy(tip).add(new THREE.Vector3(Math.cos(a) * 0.14, 0.18, Math.sin(a) * 0.14));
                leaf.rotation.y = -a;
                leaf.rotation.z = 0.68 + Math.random() * 0.18;
                leaf.rotation.x = (Math.random() - 0.5) * 0.18;
                g.add(leaf);
            }
            const pod = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 5), accentMat);
            pod.position.copy(tip).add(new THREE.Vector3(0, 0.12, 0));
            g.add(pod);
        } else if (archetype === 'spiral') {
            const coils = 5 + Math.floor(Math.random() * 3);
            for (let i = 0; i < coils; i++) {
                const t = i / Math.max(1, coils - 1);
                const a = t * Math.PI * 2.6 + organicCurve * 2.0;
                const pod = new THREE.Mesh(new THREE.SphereGeometry(0.16 + (1 - t) * 0.07, 6, 5), i % 2 ? accentMat : foliageMat);
                pod.position.copy(tip).add(new THREE.Vector3(Math.cos(a) * (0.26 + t * 0.12), 0.10 + t * 0.62, Math.sin(a) * (0.26 + t * 0.12)));
                pod.scale.y = 0.75 + Math.random() * 0.45;
                g.add(pod);
            }
            const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.10, 0.75, 5), trunkMat);
            mast.position.copy(tip).add(new THREE.Vector3(0, 0.38, 0));
            g.add(mast);
        }

        g.position.set(x, 0, z);
        g.rotation.y = Math.random() * Math.PI * 2;
        g.scale.set(0, 0, 0);
        g.userData = { type: 'tree', radius: 0.68, style: dna, color: dna.color, productionTimer: Math.random() * 20, health: 5, choppable: true, heightOffset: 0 };
        this.state.obstacles.push(g);
        return g;
    }

    createBush(p, x, z, style = null) {
        const g = new THREE.Group();
        const bushChoices = ['coral', 'succulent', 'pod', 'fan', 'anemone'];
        const dna = style || {
            color: p.flora.clone(), accentColor: (p.floraAccent || p.accent).clone(),
            shape: this.state.worldDNA.bush.shape, archetype: this.state.worldDNA.bush.archetype || bushChoices[Math.floor(Math.random() * bushChoices.length)],
            scaleY: this.state.worldDNA.bush.scaleY, lobes: this.state.worldDNA.bush.lobes || 4, berries: this.state.worldDNA.bush.berries
        };
        if (!dna.archetype) dna.archetype = bushChoices[Math.floor(Math.random() * bushChoices.length)];
        const mainMat = this.getMat(dna.color);
        const accentMat = this.getMat((dna.accentColor || dna.color).clone());
        const scaleY = dna.scaleY || 1;

        if (dna.archetype === 'coral') {
            const arms = 5 + Math.floor(Math.random() * 3);
            for (let i = 0; i < arms; i++) {
                const a = i / arms * Math.PI * 2 + Math.random() * 0.3;
                const h = 0.45 + Math.random() * 0.25;
                const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.10, h, 5), i % 2 ? accentMat : mainMat);
                const dir = new THREE.Vector3(Math.cos(a) * 0.65, 0.9, Math.sin(a) * 0.65).normalize();
                arm.position.copy(dir.clone().multiplyScalar(h * 0.22));
                arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
                g.add(arm);
                const cap = new THREE.Mesh(new THREE.SphereGeometry(0.10 + Math.random() * 0.05, 5, 4), accentMat);
                cap.position.copy(dir.clone().multiplyScalar(h * 0.46));
                cap.scale.set(1.2, 0.7, 1.2);
                g.add(cap);
            }
        } else if (dna.archetype === 'succulent') {
            const leaves = 7 + Math.floor(Math.random() * 3);
            for (let i = 0; i < leaves; i++) {
                const a = i / leaves * Math.PI * 2;
                const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.16 + Math.random() * 0.05, 6, 5), i % 3 === 0 ? accentMat : mainMat);
                leaf.position.set(Math.cos(a) * 0.20, 0.12 + (i % 2) * 0.04, Math.sin(a) * 0.20);
                leaf.scale.set(0.8, 1.6, 0.55);
                leaf.rotation.z = 0.65;
                leaf.rotation.y = -a;
                g.add(leaf);
            }
            const core = new THREE.Mesh(new THREE.SphereGeometry(0.12, 5, 4), accentMat);
            core.position.y = 0.10;
            core.scale.y = 0.65;
            g.add(core);
        } else if (dna.archetype === 'pod') {
            const stems = 4 + Math.floor(Math.random() * 3);
            for (let i = 0; i < stems; i++) {
                const a = i / stems * Math.PI * 2 + Math.random() * 0.2;
                const h = 0.38 + Math.random() * 0.28;
                const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.038, h, 5), mainMat);
                stem.position.set(Math.cos(a) * 0.10, h * 0.5, Math.sin(a) * 0.10);
                stem.rotation.z = Math.cos(a) * 0.20;
                stem.rotation.x = Math.sin(a) * 0.18;
                g.add(stem);
                const pod = new THREE.Mesh(new THREE.SphereGeometry(0.11 + Math.random() * 0.04, 5, 4), i % 2 ? accentMat : mainMat);
                pod.position.set(Math.cos(a) * 0.16, h, Math.sin(a) * 0.16);
                pod.scale.y = 1.45;
                g.add(pod);
            }
        } else if (dna.archetype === 'fan') {
            const leaves = 5 + Math.floor(Math.random() * 3);
            for (let i = 0; i < leaves; i++) {
                const a = (-0.7 + i / Math.max(1, leaves - 1) * 1.4) + (Math.random() - 0.5) * 0.1;
                const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.58 + Math.random() * 0.16, 0.22), i % 2 ? accentMat : mainMat);
                leaf.position.set(Math.sin(a) * 0.18, 0.28, Math.cos(a) * 0.06);
                leaf.rotation.z = a;
                leaf.rotation.x = -0.28;
                g.add(leaf);
            }
            const base = new THREE.Mesh(new THREE.SphereGeometry(0.10, 5, 4), mainMat);
            base.position.y = 0.08;
            g.add(base);
        } else if (dna.archetype === 'anemone') {
            const tendrils = 8 + Math.floor(Math.random() * 4);
            for (let i = 0; i < tendrils; i++) {
                const a = i / tendrils * Math.PI * 2;
                const h = 0.32 + Math.random() * 0.14;
                const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, 0.05), i % 4 === 0 ? accentMat : mainMat);
                blade.position.set(Math.cos(a) * 0.16, h * 0.5, Math.sin(a) * 0.16);
                blade.rotation.z = Math.cos(a) * 0.35;
                blade.rotation.x = Math.sin(a) * 0.25;
                g.add(blade);
            }
            const nucleus = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 5), accentMat);
            nucleus.position.y = 0.10;
            nucleus.scale.y = 0.75;
            g.add(nucleus);
        }

        if (dna.berries && Math.random() > 0.35) {
            const pods = 3 + Math.floor(Math.random() * 3);
            for (let i = 0; i < pods; i++) {
                const a = i / pods * Math.PI * 2 + Math.random() * 0.4;
                const berry = new THREE.Mesh(new THREE.OctahedronGeometry(0.045 + Math.random() * 0.02, 0), accentMat);
                berry.position.set(Math.cos(a) * 0.28, 0.18 + Math.random() * 0.20, Math.sin(a) * 0.28);
                g.add(berry);
            }
        }

        g.scale.y = scaleY;
        g.position.set(x, 0, z);
        g.rotation.y = Math.random() * Math.PI * 2;
        g.scale.x = 0; g.scale.z = 0; g.scale.y = 0;
        g.userData = { type: 'bush', radius: 0.56, style: dna, color: dna.color, productionTimer: Math.random() * 20, heightOffset: 0 };
        return g;
    }

    createRock(p, x, z, style = null) {
        const g = new THREE.Group();
        const dna = style || { color: p.baseRock.clone(), shape: this.state.worldDNA.rock.shape };
        let geo = dna.shape === 'ico' ? new THREE.IcosahedronGeometry(0.35, 0) :
            dna.shape === 'box' ? new THREE.BoxGeometry(0.6, 0.5, 0.6) :
                dna.shape === 'slab' ? new THREE.BoxGeometry(0.7, 0.25, 0.5) : new THREE.DodecahedronGeometry(0.35);
        // Distort into a unique per-instance silhouette instead of a pristine
        // primitive clone. Box gets a lower factor — its flat faces read as
        // "broken" faster than the convex ico/dodec/slab shapes under the
        // same displacement, so it stays subtle lumpiness instead of a blob.
        const rockUnitSize = dna.shape === 'box' ? 0.55 : dna.shape === 'slab' ? 0.6 : 0.35;
        const rockDistortFactor = dna.shape === 'box' ? 0.06 + Math.random() * 0.03 : 0.12 + Math.random() * 0.06;
        geo = this.distortGeometryRadial(geo, rockUnitSize * rockDistortFactor, Math.random() * 1000);
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
        const variants = ['meadow', 'fern', 'reed', 'ribbon', 'spore'];
        const dna = style || { color: p.tallGrass.clone(), accentColor: (p.floraAccent || p.accent).clone(), height: h, variant: this.state.worldDNA.grass.variant || variants[Math.floor(Math.random() * variants.length)] };
        if (!dna.variant) dna.variant = variants[Math.floor(Math.random() * variants.length)];
        const parts = [];
        const addBlade = (w, bladeH, d, px, pz, rx, ry, rz) => {
            const geo = new THREE.BoxGeometry(w, bladeH, d);
            const base = new THREE.Matrix4().makeTranslation(0, bladeH / 2, 0);
            const rot = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0));
            const trans = new THREE.Matrix4().makeTranslation(px || 0, 0, pz || 0);
            parts.push({ geometry: geo, matrix: new THREE.Matrix4().multiplyMatrices(trans, rot).multiply(base) });
        };

        if (dna.variant === 'fern') {
            addBlade(0.04, dna.height * 1.05, 0.04, 0, 0, 0, 0, 0);
            for (let i = 0; i < 8; i++) {
                const yRatio = (i + 1) / 9;
                const leafLen = dna.height * (0.50 - yRatio * 0.20);
                const side = i % 2 ? 1 : -1;
                const geo = new THREE.BoxGeometry(leafLen, 0.04, 0.08);
                const rot = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0, side > 0 ? 0.20 : -0.20, side * (0.24 + yRatio * 0.18)));
                const trans = new THREE.Matrix4().makeTranslation(side * leafLen * 0.42, dna.height * yRatio, 0);
                parts.push({ geometry: geo, matrix: new THREE.Matrix4().multiplyMatrices(trans, rot) });
            }
        } else if (dna.variant === 'reed') {
            for (let i = 0; i < 3; i++) {
                const a = i * Math.PI * 2 / 3;
                addBlade(0.045, dna.height * (1.05 + i * 0.16), 0.045, Math.cos(a) * 0.10, Math.sin(a) * 0.10, Math.sin(a) * 0.08, 0, Math.cos(a) * 0.08);
            }
        } else if (dna.variant === 'ribbon') {
            const ribbonCount = 4 + Math.floor(Math.random() * 3);
            for (let i = 0; i < ribbonCount; i++) {
                const a = i / ribbonCount * Math.PI * 2 + Math.random() * 0.5;
                addBlade(0.06, dna.height * (0.95 + Math.random() * 0.55), 0.03, Math.cos(a) * 0.08, Math.sin(a) * 0.08, Math.sin(a) * 0.28, a, Math.cos(a) * 0.55);
            }
        } else if (dna.variant === 'spore') {
            const stemCount = 4 + Math.floor(Math.random() * 2);
            for (let i = 0; i < stemCount; i++) {
                const a = i / stemCount * Math.PI * 2 + Math.random() * 0.25;
                addBlade(0.035, dna.height * (0.55 + Math.random() * 0.35), 0.035, Math.cos(a) * 0.10, Math.sin(a) * 0.10, 0.10, 0, Math.cos(a) * 0.12);
            }
        } else {
            const bladeCount = 5 + Math.floor(Math.random() * 4);
            for (let i = 0; i < bladeCount; i++) {
                const bladeH = dna.height * (0.65 + Math.random() * 0.75);
                const a = Math.random() * Math.PI * 2;
                const r = Math.random() * 0.14;
                addBlade(0.048 + Math.random() * 0.015, bladeH, 0.04, Math.cos(a) * r, Math.sin(a) * r, Math.sin(a) * 0.26, a, Math.cos(a) * 0.22);
            }
        }

        const clumpGeo = this.mergeBoxGeometries(parts);
        parts.forEach(part => part.geometry.dispose());
        const m = new THREE.Mesh(clumpGeo, this.getMat(dna.color));
        g.add(m);
        if (dna.variant === 'reed' || dna.variant === 'spore') {
            const headMat = this.getMat(dna.accentColor || p.accent, true);
            const headCount = dna.variant === 'reed' ? 3 : 4;
            for (let i = 0; i < headCount; i++) {
                const a = i * Math.PI * 2 / headCount;
                const head = new THREE.Mesh(new THREE.SphereGeometry(dna.variant === 'spore' ? 0.06 : 0.05, 5, 4), headMat);
                head.scale.y = dna.variant === 'spore' ? 1.1 : 1.8;
                const y = dna.variant === 'spore' ? dna.height * (0.70 + (i % 2) * 0.14) : dna.height * (1.04 + i * 0.16);
                head.position.set(Math.cos(a) * 0.10, y, Math.sin(a) * 0.10);
                g.add(head);
            }
        }
        g.position.set(x, 0, z);
        g.scale.set(0, 0, 0);
        g.userData = { type: 'grass', style: dna, color: dna.color, growTimer: Math.random() * 30, heightOffset: 0 };
        return g;
    }

    createFlower(p, x, z, style = null) {
        const g = new THREE.Group();
        const families = ['star', 'orb', 'cup', 'pinwheel', 'cluster'];
        const dna = style || {
            stemColor: p.tallGrass.clone(),
            petalColor: (p.floraAccent || p.background).clone().offsetHSL((Math.random() - 0.5) * 0.05, 0.04, 0.04),
            centerColor: p.accent.clone(),
            height: 0.34 + Math.random() * 0.34,
            petals: 4 + Math.floor(Math.random() * 4),
            family: families[Math.floor(Math.random() * families.length)]
        };
        if (!dna.family) dna.family = families[Math.floor(Math.random() * families.length)];
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.024, dna.height, 5), this.getMat(dna.stemColor));
        stem.position.y = dna.height / 2;
        g.add(stem);
        const bloom = new THREE.Group();
        bloom.position.y = dna.height;
        const petalMat = this.getMat(dna.petalColor, true);
        const centerMat = this.getMat(dna.centerColor, true);
        const petalCount = dna.petals || 6;

        if (dna.family === 'star') {
            for (let i = 0; i < petalCount; i++) {
                const a = i / petalCount * Math.PI * 2;
                const petal = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.05), petalMat);
                petal.position.set(Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12);
                petal.rotation.y = -a;
                petal.rotation.z = 0.55;
                bloom.add(petal);
            }
            const center = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), centerMat);
            bloom.add(center);
        } else if (dna.family === 'orb') {
            const orb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 7, 6), petalMat);
            orb.scale.y = 1.15;
            bloom.add(orb);
            const ringCount = 5 + Math.floor(Math.random() * 2);
            for (let i = 0; i < ringCount; i++) {
                const a = i / ringCount * Math.PI * 2;
                const seed = new THREE.Mesh(new THREE.SphereGeometry(0.035, 5, 4), centerMat);
                seed.position.set(Math.cos(a) * 0.10, 0.02, Math.sin(a) * 0.10);
                bloom.add(seed);
            }
        } else if (dna.family === 'cup') {
            for (let i = 0; i < petalCount; i++) {
                const a = i / petalCount * Math.PI * 2;
                const petal = new THREE.Mesh(new THREE.SphereGeometry(0.09, 5, 4), petalMat);
                petal.scale.set(0.75, 1.25, 0.55);
                petal.position.set(Math.cos(a) * 0.09, 0.03, Math.sin(a) * 0.09);
                petal.rotation.y = -a;
                petal.rotation.z = 0.28;
                bloom.add(petal);
            }
            const center = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 4), centerMat);
            center.position.y = 0.05;
            bloom.add(center);
        } else if (dna.family === 'pinwheel') {
            for (let i = 0; i < petalCount; i++) {
                const a = i / petalCount * Math.PI * 2;
                const petal = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.05), i % 2 ? centerMat : petalMat);
                petal.position.set(Math.cos(a) * 0.11, 0.01, Math.sin(a) * 0.11);
                petal.rotation.y = -a;
                petal.rotation.z = 0.72;
                bloom.add(petal);
            }
            const center = new THREE.Mesh(new THREE.OctahedronGeometry(0.05, 0), centerMat);
            bloom.add(center);
        } else if (dna.family === 'cluster') {
            const count = 4 + Math.floor(Math.random() * 4);
            for (let i = 0; i < count; i++) {
                const bud = new THREE.Mesh(new THREE.SphereGeometry(0.06, 5, 4), i % 3 === 0 ? centerMat : petalMat);
                bud.position.set((Math.random() - 0.5) * 0.16, Math.random() * 0.08, (Math.random() - 0.5) * 0.16);
                bud.scale.y = 1.0 + Math.random() * 0.7;
                bloom.add(bud);
            }
        }

        bloom.rotation.y = Math.random() * Math.PI;
        g.add(bloom);
        g.position.set(x, 0, z);
        g.rotation.y = Math.random() * Math.PI * 2;
        g.scale.set(0, 0, 0);
        g.userData = { type: 'flower', style: dna, color: dna.petalColor, heightOffset: 0, bloom };
        return g;
    }

    generateCreatureDNA(palette, speciesType = null) {
        const eyeRoll = Math.random();
        const eyeCount = eyeRoll < 0.12 ? 1 : eyeRoll < 0.25 ? 3 : 2;
        if (!speciesType) speciesType = ['blobby', 'blocky', 'conehead'][Math.floor(Math.random() * 3)];
        const speciesStats = {
            blobby: { shape: 'sphere', scaleMin: 0.72, scaleMax: 1.12, speed: 0.042, temperament: 0.85, traits: ['antennae', 'shell', 'wings'] },
            blocky: { shape: 'box', scaleMin: 0.92, scaleMax: 1.45, speed: 0.031, temperament: 1.45, traits: ['horns', 'plates', 'tail'] },
            conehead: { shape: 'cone', scaleMin: 1.05, scaleMax: 1.62, speed: 0.036, temperament: 0.58, traits: ['ears', 'crest', 'tail'] }
        };
        const stats = speciesStats[speciesType];
        const baseColor = palette.creature.clone().offsetHSL((Math.random() - 0.5) * 0.14, 0, (Math.random() - 0.5) * 0.08);
        const accentColor = (palette.accent || palette.floraAccent).clone().offsetHSL((Math.random() - 0.5) * 0.08, 0, 0.04);
        return {
            color: baseColor,
            accentColor,
            bodyShape: stats.shape,
            speciesType,
            eyeCount,
            scale: stats.scaleMin + Math.random() * (stats.scaleMax - stats.scaleMin),
            eyeScale: 0.92 + Math.random() * 0.78,
            moveSpeed: stats.speed * (0.88 + Math.random() * 0.26),
            temperament: stats.temperament,
            trait: stats.traits[Math.floor(Math.random() * stats.traits.length)],
            markings: 1 + Math.floor(Math.random() * 4),
            glow: Math.random() > 0.72
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
            temperament: this.state.worldDNA.creature.temperament,
            accentColor: (p.accent || p.floraAccent).clone(),
            trait: this.state.worldDNA.creature.trait || 'antennae',
            markings: this.state.worldDNA.creature.markings || 2,
            glow: false
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
        const accentColor = dna.accentColor ? dna.accentColor.clone() : (p.accent || p.floraAccent).clone();
        const detailMat = dna.glow
            ? new THREE.MeshBasicMaterial({ color: accentColor, transparent: true, opacity: 0.96 })
            : this.getMat(accentColor, true);
        const darkDetailMat = this.getMat(dna.color.clone().multiplyScalar(0.48), true);

        // Small planted feet keep the organisms from reading as floating primitives.
        const footCount = bodyShape === 'cone' ? 3 : 4;
        for (let i = 0; i < footCount; i++) {
            const a = (i / footCount) * Math.PI * 2 + Math.PI * 0.25;
            const foot = new THREE.Mesh(new THREE.SphereGeometry(0.055 * scale, 5, 4), darkDetailMat);
            foot.scale.set(1.35, 0.55, 1.65);
            foot.position.set(Math.cos(a) * 0.15 * scale, 0.015 * scale, Math.sin(a) * 0.15 * scale);
            animPivot.add(foot);
        }

        const trait = dna.trait || 'antennae';
        if (trait === 'antennae') {
            for (const side of [-1, 1]) {
                const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.014 * scale, 0.022 * scale, 0.30 * scale, 5), detailMat);
                stalk.position.set(side * 0.10 * scale, 0.39 * scale, 0.02 * scale);
                stalk.rotation.z = side * -0.30;
                animPivot.add(stalk);
                const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.045 * scale, 0), detailMat);
                tip.position.set(side * 0.145 * scale, 0.53 * scale, 0.02 * scale);
                animPivot.add(tip);
            }
        } else if (trait === 'shell' || trait === 'plates') {
            const count = trait === 'shell' ? 1 : 3;
            for (let i = 0; i < count; i++) {
                const plate = new THREE.Mesh(new THREE.DodecahedronGeometry((trait === 'shell' ? 0.18 : 0.10) * scale, 0), detailMat);
                plate.scale.set(1.0, trait === 'shell' ? 0.72 : 0.48, trait === 'shell' ? 1.22 : 0.65);
                plate.position.set(0, (0.24 + i * 0.08) * scale, (-0.13 + i * 0.02) * scale);
                animPivot.add(plate);
            }
        } else if (trait === 'wings') {
            for (const side of [-1, 1]) {
                const wing = new THREE.Mesh(new THREE.TetrahedronGeometry(0.16 * scale, 0), detailMat);
                wing.scale.set(1.25, 0.22, 0.88);
                wing.position.set(side * 0.22 * scale, 0.23 * scale, -0.04 * scale);
                wing.rotation.z = side * -0.34;
                animPivot.add(wing);
            }
        } else if (trait === 'horns' || trait === 'ears' || trait === 'crest') {
            const count = trait === 'crest' ? 3 : 2;
            for (let i = 0; i < count; i++) {
                const side = count === 2 ? (i ? 1 : -1) : (i - 1);
                const spike = new THREE.Mesh(new THREE.ConeGeometry(0.055 * scale, (trait === 'ears' ? 0.22 : 0.18) * scale, 5), detailMat);
                spike.position.set(side * 0.12 * scale, (0.38 + (trait === 'crest' ? Math.abs(side) * -0.03 : 0)) * scale, (trait === 'crest' ? -0.01 : 0.02) * scale);
                spike.rotation.z = side * (trait === 'ears' ? -0.35 : -0.18);
                animPivot.add(spike);
            }
        } else if (trait === 'tail') {
            for (let i = 0; i < 3; i++) {
                const tail = new THREE.Mesh(new THREE.SphereGeometry((0.065 - i * 0.012) * scale, 5, 4), detailMat);
                tail.scale.set(0.85, 0.75, 1.35);
                tail.position.set((i - 1) * 0.025 * scale, (0.16 + i * 0.035) * scale, (-0.24 - i * 0.10) * scale);
                animPivot.add(tail);
            }
        }

        // Contrasting markings create species identity at gameplay distance.
        for (let i = 0; i < Math.min(4, dna.markings || 0); i++) {
            const mark = new THREE.Mesh(new THREE.OctahedronGeometry(0.035 * scale, 0), detailMat);
            const a = (i / Math.max(1, dna.markings)) * Math.PI * 1.6 - Math.PI * 0.3;
            mark.position.set(Math.sin(a) * 0.17 * scale, (0.17 + (i % 2) * 0.07) * scale, 0.19 * scale);
            animPivot.add(mark);
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
        const woodMaterial = this.getMat(0x5d4037);
        const metalMaterial = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.34, metalness: 0.62 });

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
        const woodMaterial = this.getMat(0x5d4037);
        const metalMaterial = new THREE.MeshStandardMaterial({ color: 0x78909c, roughness: 0.34, metalness: 0.62 });
        const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.18, metalness: 0.84 });

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

    /**
     * Deadly sun — pure visual here; the proximity heat damage lives in
     * CombatSystem._updateSunHazard. Deliberately RNG-free so creating it
     * inside the seeded initGame doesn't shift world-generation draws.
     * MeshBasicMaterial (self-lit) + fog:false keep it readable from any
     * distance as a landmark.
     */
    createSun(x, y, z, radius) {
        const g = new THREE.Group();

        const core = new THREE.Mesh(
            new THREE.IcosahedronGeometry(radius, 2),
            new THREE.MeshBasicMaterial({ color: 0xffdd33, fog: false })
        );
        g.add(core);

        const innerGlow = new THREE.Mesh(
            new THREE.IcosahedronGeometry(radius * 1.15, 2),
            new THREE.MeshBasicMaterial({
                color: 0xff8800, transparent: true, opacity: 0.3,
                blending: THREE.AdditiveBlending, depthWrite: false, fog: false
            })
        );
        g.add(innerGlow);

        const outerGlow = new THREE.Mesh(
            new THREE.IcosahedronGeometry(radius * 1.4, 2),
            new THREE.MeshBasicMaterial({
                color: 0xff4400, transparent: true, opacity: 0.12,
                blending: THREE.AdditiveBlending, depthWrite: false, fog: false
            })
        );
        g.add(outerGlow);

        g.position.set(x, y, z);
        g.userData = { type: 'sun', radius };
        return g;
    }

    createSword(palette, x, z) {
        const g = new THREE.Group();
        const woodMaterial = this.getMat(0x5d4037);
        const guardMaterial = this.getMat(0x8d6e63);
        const bladeMaterial = this.getMat(0xcfd8dc);
        const edgeMaterial = this.getMat(0xeeeeee);

        const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.018, 0.14, 6), woodMaterial);
        g.add(grip);

        const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), guardMaterial);
        pommel.position.y = -0.08;
        g.add(pommel);

        const guard = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.025, 0.035), guardMaterial);
        guard.position.y = 0.08;
        g.add(guard);

        const edge = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.3, 0.006), edgeMaterial);
        edge.position.y = 0.25;
        g.add(edge);

        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.32, 0.012), bladeMaterial);
        blade.position.y = 0.25;
        g.add(blade);

        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.06, 4), bladeMaterial);
        tip.position.y = 0.44;
        tip.rotation.y = Math.PI / 4;
        g.add(tip);

        g.position.set(x, 0, z);
        g.rotation.z = Math.PI / 2 + (Math.random() - 0.5) * 0.5;
        g.rotation.y = Math.random() * Math.PI * 2;
        g.scale.set(0, 0, 0);
        g.userData = { type: 'sword', color: null, heightOffset: 0.1 };
        return g;
    }

    createStatBoost(x, z, boostData) {
        const g = new THREE.Group();
        const colorMap = { attack: 0xff4444, speed: 0x44ff44, health: 0xff88cc };
        const color = new THREE.Color(colorMap[boostData.stat] || 0xffffff);

        const crystalGeo = new THREE.OctahedronGeometry(0.15, 0);
        const crystalMat = new THREE.MeshStandardMaterial({
            color: color, emissive: color, emissiveIntensity: 0.8,
            roughness: 0.22, metalness: 0.1
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
        const cockpitMat = new THREE.MeshPhysicalMaterial({ color: 0x4488ff, emissive: 0x102a55, emissiveIntensity: 0.25, roughness: 0.08, metalness: 0.05, transparent: true, opacity: 0.48, clearcoat: 1, clearcoatRoughness: 0.08 });
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
        g.name = 'Procedural companion cat';

        // Cat-forward is local +Z, matching SphericalUtils.getOrientationOnSurface().
        // The old model put the head on -Z, so it visually ran backward.
        const orange = new THREE.Color(0xD98236);
        const cream = new THREE.Color(0xF4E7D0);
        const darkOrange = new THREE.Color(0x8F4A24);
        const pink = new THREE.Color(0xEFA7A8);
        const eyeGreen = new THREE.Color(0xA9D26A);

        const furMat = new THREE.MeshStandardMaterial({ color: orange, roughness: 0.88, metalness: 0.0 });
        const creamMat = new THREE.MeshStandardMaterial({ color: cream, roughness: 0.92, metalness: 0.0 });
        const stripeMat = new THREE.MeshStandardMaterial({ color: darkOrange, roughness: 0.9, metalness: 0.0 });
        const pinkMat = new THREE.MeshStandardMaterial({ color: pink, roughness: 0.8, metalness: 0.0 });
        const eyeMat = new THREE.MeshStandardMaterial({ color: eyeGreen, emissive: 0x20370f, emissiveIntensity: 0.22, roughness: 0.36 });
        const pupilMat = new THREE.MeshBasicMaterial({ color: 0x10120f });
        const whiskerMat = new THREE.MeshBasicMaterial({ color: 0xf9f2e6 });

        const bodyRoot = new THREE.Group();
        bodyRoot.position.y = 0.02;
        g.add(bodyRoot);

        const hips = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8), furMat);
        hips.scale.set(0.88, 0.82, 1.18);
        hips.position.set(0, 0.43, -0.18);
        bodyRoot.add(hips);

        const chest = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 8), furMat);
        chest.scale.set(0.9, 1.02, 1.06);
        chest.position.set(0, 0.47, 0.17);
        bodyRoot.add(chest);

        const belly = new THREE.Mesh(new THREE.SphereGeometry(0.20, 10, 7), creamMat);
        belly.scale.set(0.82, 0.48, 1.28);
        belly.position.set(0, 0.29, 0.01);
        bodyRoot.add(belly);

        const spine = new SegmentMesh(bodyRoot, furMat, 8);
        spine.set(new THREE.Vector3(0, 0.43, -0.18), new THREE.Vector3(0, 0.47, 0.17), 0.19);

        const neck = new SegmentMesh(bodyRoot, furMat, 8);
        const neckBase = new THREE.Vector3(0, 0.51, 0.28);
        const neckTop = new THREE.Vector3(0, 0.63, 0.39);
        neck.set(neckBase, neckTop, 0.13);

        const headPivot = new THREE.Group();
        headPivot.position.copy(neckTop);
        bodyRoot.add(headPivot);

        const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 9), furMat);
        head.scale.set(0.94, 0.9, 0.9);
        head.position.z = 0.055;
        headPivot.add(head);

        const muzzleL = new THREE.Mesh(new THREE.SphereGeometry(0.085, 9, 7), creamMat);
        const muzzleR = muzzleL.clone();
        muzzleL.scale.set(1.0, 0.72, 0.78);
        muzzleR.scale.copy(muzzleL.scale);
        muzzleL.position.set(-0.065, -0.045, 0.205);
        muzzleR.position.set(0.065, -0.045, 0.205);
        headPivot.add(muzzleL, muzzleR);

        const chin = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), creamMat);
        chin.scale.set(1.15, 0.55, 0.8);
        chin.position.set(0, -0.115, 0.16);
        headPivot.add(chin);

        const nose = new THREE.Mesh(new THREE.SphereGeometry(0.035, 7, 5), pinkMat);
        nose.scale.set(1.15, 0.72, 0.72);
        nose.position.set(0, -0.025, 0.267);
        headPivot.add(nose);

        const eyeGeo = new THREE.SphereGeometry(0.047, 9, 7);
        const pupilGeo = new THREE.SphereGeometry(0.018, 7, 5);
        const eyes = [];
        const pupils = [];
        [-1, 1].forEach(side => {
            const eye = new THREE.Mesh(eyeGeo, eyeMat);
            eye.scale.set(1, 1.16, 0.55);
            eye.position.set(side * 0.082, 0.055, 0.205);
            headPivot.add(eye);
            eyes.push(eye);

            const pupil = new THREE.Mesh(pupilGeo, pupilMat);
            pupil.scale.set(0.58, 1.25, 0.46);
            pupil.position.set(side * 0.082, 0.055, 0.236);
            headPivot.add(pupil);
            pupils.push(pupil);
        });

        const ears = [];
        [-1, 1].forEach(side => {
            const earPivot = new THREE.Group();
            earPivot.position.set(side * 0.13, 0.155, 0.015);
            earPivot.rotation.z = -side * 0.08;
            headPivot.add(earPivot);

            const ear = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 5), furMat);
            ear.position.y = 0.08;
            ear.rotation.x = -0.05;
            earPivot.add(ear);

            const inner = new THREE.Mesh(new THREE.ConeGeometry(0.052, 0.145, 5), pinkMat);
            inner.position.set(0, 0.075, 0.016);
            inner.scale.z = 0.64;
            earPivot.add(inner);
            ears.push(earPivot);
        });

        // Forehead and cheek markings add readable feline structure without textures.
        for (let i = -1; i <= 1; i++) {
            const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.105, 0.012), stripeMat);
            stripe.position.set(i * 0.055, 0.145 - Math.abs(i) * 0.012, 0.205);
            stripe.rotation.z = i * -0.18;
            headPivot.add(stripe);
        }
        [-1, 1].forEach(side => {
            for (let i = 0; i < 2; i++) {
                const cheekStripe = new SegmentMesh(headPivot, stripeMat, 4);
                cheekStripe.set(
                    new THREE.Vector3(side * (0.145 + i * 0.01), -0.005 - i * 0.045, 0.16),
                    new THREE.Vector3(side * (0.205 + i * 0.012), -0.015 - i * 0.055, 0.125),
                    0.012
                );
            }
        });

        // Whiskers are short tapered-looking rods, three per cheek.
        [-1, 1].forEach(side => {
            for (let i = 0; i < 3; i++) {
                const whisker = new SegmentMesh(headPivot, whiskerMat, 4);
                const y = -0.035 - i * 0.035;
                whisker.set(
                    new THREE.Vector3(side * 0.075, y, 0.245),
                    new THREE.Vector3(side * (0.30 + i * 0.025), y + (1 - i) * 0.012, 0.27 - i * 0.018),
                    0.006
                );
            }
        });

        const legSpecs = [
            { name: 'frontLeft',  side: -1, front: true,  hip: new THREE.Vector3(-0.18, 0.46,  0.22), phase: 0 },
            { name: 'frontRight', side:  1, front: true,  hip: new THREE.Vector3( 0.18, 0.46,  0.22), phase: Math.PI },
            { name: 'hindLeft',   side: -1, front: false, hip: new THREE.Vector3(-0.18, 0.43, -0.22), phase: Math.PI },
            { name: 'hindRight',  side:  1, front: false, hip: new THREE.Vector3( 0.18, 0.43, -0.22), phase: 0 },
        ];

        const legs = legSpecs.map(spec => {
            const upper = new SegmentMesh(bodyRoot, furMat, 7);
            const lower = new SegmentMesh(bodyRoot, creamMat, 7);
            const joint = new THREE.Mesh(new THREE.SphereGeometry(0.052, 7, 5), furMat);
            const paw = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), creamMat);
            paw.scale.set(1.05, 0.48, 1.45);
            bodyRoot.add(joint, paw);
            return {
                ...spec,
                upper,
                lower,
                joint,
                paw,
                upperLength: spec.front ? 0.235 : 0.255,
                lowerLength: spec.front ? 0.225 : 0.245,
                footLocal: new THREE.Vector3(spec.hip.x, 0.055, spec.hip.z + (spec.front ? 0.06 : -0.04)),
                targetLocal: new THREE.Vector3(),
            };
        });

        const tailSegments = [];
        for (let i = 0; i < 6; i++) {
            tailSegments.push(new SegmentMesh(bodyRoot, i === 5 ? creamMat : furMat, 7));
        }

        for (const object of g.children) object.castShadow = true;
        g.traverse(object => {
            if (object.isMesh) {
                object.castShadow = true;
                object.receiveShadow = true;
            }
        });

        g.position.set(x, 0, z);
        g.userData = {
            type: 'cat',
            radius: 0.38,
            moveSpeed: 3.0,
            runSpeed: 5.4,
            followDist: 1.65,
            catchupDist: 5.2,
            heightOffset: 0.018,
            bodyRoot,
            hips,
            chest,
            belly,
            spine,
            neck,
            headPivot,
            head,
            eyes,
            pupils,
            ears,
            legs,
            // Kept for compatibility with any external cat tooling.
            tail: tailSegments[0].mesh,
            tailSegments,
            velocity: new THREE.Vector3(),
            forwardWorld: new THREE.Vector3(0, 0, 1),
            lastPosition: new THREE.Vector3(x, 0, z),
            speed: 0,
            gaitPhase: Math.random() * Math.PI * 2,
            turnLean: 0,
            bodySpring: 0,
            bodySpringVelocity: 0,
            idleTimer: 0,
            wanderTimer: 1.5 + Math.random() * 2.5,
            wanderAngle: Math.random() * Math.PI * 2,
            blinkTimer: 1.2 + Math.random() * 3.0,
            blinkAmount: 0,
            earTwitchTimer: 1.0 + Math.random() * 2.0,
            earTwitch: 0,
            hopOffset: Math.random() * 100,
            isIdle: false,
            isSitting: false,
            rigReady: true,
        };
        return g;
    }
}

