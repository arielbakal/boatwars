// =====================================================
// FRACTURE BIOSPHERE V11 OVERDRIVE (DORMANT)
// =====================================================
// Silhouettes, flora/fauna augmentation, planetary atmospheric structures,
// nebular canopy and live material deformation.
//
// This layer never executed in the single-file prototype: it was invoked as
// `(typeof game !== 'undefined' ? game : null)` from a script block that could
// not see the engine, so its `if (!engine) return;` guard always fired. It is
// ported verbatim and gated off in patches/flags.js. See ROADMAP.md.

export default function installFractureBiosphereV11(engine){
    'use strict';
    if (!engine || engine.__fractureBiosphereV11) return;
    engine.__fractureBiosphereV11 = true;
    if (typeof THREE === 'undefined') return;

    const world = engine.world;
    const scene = world && world.scene;
    const root = document.documentElement;
    if (!world || !scene) return;

    const patchedMaterials = [];
    const decoratedEntities = new WeakSet();
    const decoratedPlanets = new WeakSet();
    const decoratedMeshes = new WeakSet();
    const driftSystems = [];
    const pulseObjects = [];
    const overlayId = 'fracture-v11-overlay';

    const vA = new THREE.Vector3();
    const vB = new THREE.Vector3();
    const qA = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);

    const css = document.createElement('style');
    css.textContent = `
    :root {
        --fracture-v11-energy: 0;
        --fracture-v11-danger: 0;
        --fracture-v11-aim: 0;
    }
    #${overlayId} {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 43;
        mix-blend-mode: screen;
        opacity: .82;
        background:
            radial-gradient(circle at calc(50% + var(--fracture-v11-energy) * 11vw) calc(46% - var(--fracture-v11-danger) * 7vh), rgba(177,255,116,.12), transparent 24%),
            radial-gradient(circle at calc(12% + var(--fracture-v11-aim) * 8vw) calc(20% + var(--fracture-v11-energy) * 6vh), rgba(104,255,243,.10), transparent 18%),
            radial-gradient(circle at calc(84% - var(--fracture-v11-energy) * 7vw) calc(78% - var(--fracture-v11-aim) * 3vh), rgba(196,110,255,.10), transparent 20%),
            linear-gradient(120deg, rgba(255,255,255,.022), rgba(140,255,178,.015) 35%, rgba(164,109,255,.02) 72%, rgba(255,255,255,.018));
        filter: saturate(1.12) contrast(1.08) blur(calc(4px + var(--fracture-v11-energy) * 5px));
    }
    #${overlayId}::before,
    #${overlayId}::after {
        content: '';
        position: absolute;
        inset: 0;
    }
    #${overlayId}::before {
        opacity: .18;
        background: repeating-linear-gradient(
            128deg,
            rgba(255,255,255,.08) 0 1px,
            transparent 1px 8px,
            rgba(175,255,123,.08) 8px 9px,
            transparent 9px 16px
        );
        transform: scale(calc(1 + var(--fracture-v11-energy) * .08));
    }
    #${overlayId}::after {
        opacity: calc(.10 + var(--fracture-v11-danger) * .14);
        background:
            radial-gradient(circle at 50% 50%, transparent 42%, rgba(0,0,0,.0) 56%, rgba(0,0,0,.32) 100%),
            radial-gradient(circle at 50% 50%, rgba(255,255,255,.0) 0%, rgba(255,255,255,.07) 50%, rgba(0,0,0,0) 65%);
    }`;
    document.head.appendChild(css);

    let overlay = document.getElementById(overlayId);
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = overlayId;
        document.body.appendChild(overlay);
    }

    function clamp(x, a, b){ return Math.max(a, Math.min(b, x)); }
    function smooth(current, target, rate, dt){ return current + (target - current) * (1 - Math.exp(-rate * dt)); }
    function pick(c, fallback){ return c instanceof THREE.Color ? c.clone() : new THREE.Color(c || fallback || 0xb8ff83); }
    function ensureArray(value){ return Array.isArray(value) ? value : [value]; }

    function tagPulse(obj, baseY, phase, amp, speed){
        obj.userData._fracturePulse = { baseY: baseY || obj.position.y, phase: phase || 0, amp: amp || 0.05, speed: speed || 1.0 };
        pulseObjects.push(obj);
        return obj;
    }

    function tuneMaterial(mat, opts={}) {
        if (!mat || mat.userData?.fractureV11Patched) return mat;
        mat.userData = mat.userData || {};
        mat.userData.fractureV11Patched = true;
        if ('roughness' in mat) mat.roughness = opts.roughness ?? Math.max(0.16, Math.min(0.92, (mat.roughness ?? 0.7) * 0.72));
        if ('metalness' in mat) mat.metalness = opts.metalness ?? Math.max(0.0, Math.min(0.45, (mat.metalness ?? 0.0) * 0.65 + 0.08));
        if ('envMapIntensity' in mat) mat.envMapIntensity = Math.max(mat.envMapIntensity || 0, 0.55);
        if ('emissive' in mat) {
            const tint = pick(opts.tint || mat.color || 0xb4ff85, 0xb4ff85);
            mat.emissive.copy(tint).multiplyScalar(opts.emissiveStrength ?? 0.12);
            mat.emissiveIntensity = opts.emissiveIntensity ?? 0.75;
        }
        const tint = pick(opts.tint || mat.color || 0xb4ff85, 0xb4ff85);
        mat.onBeforeCompile = (shader) => {
            shader.uniforms.uTime = { value: 0 };
            shader.uniforms.uTint = { value: tint };
            shader.uniforms.uPulse = { value: opts.pulse ?? 0.75 };
            shader.uniforms.uRim = { value: opts.rim ?? 0.85 };
            shader.uniforms.uEdgeWarp = { value: opts.edgeWarp ?? 0.7 };
            shader.uniforms.uBands = { value: opts.bands ?? 4.0 };
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', `#include <common>\n varying vec3 vWorldPosF11;\n varying vec3 vNormalF11;\n varying float vNoiseF11;\n`)
                .replace('#include <begin_vertex>', `#include <begin_vertex>\n vec3 fractureDir = normalize(position + vec3(0.001));\n float fractureNoise = sin(position.y * 5.7 + position.x * 4.2 + position.z * 6.3 + uTime * 0.65) * 0.5 + 0.5;\n transformed += normal * (fractureNoise - 0.5) * 0.028 * uEdgeWarp;\n vNoiseF11 = fractureNoise;`)
                .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n vWorldPosF11 = worldPosition.xyz;\n vNormalF11 = normalize(mat3(modelMatrix) * objectNormal);`);
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', `#include <common>\n varying vec3 vWorldPosF11;\n varying vec3 vNormalF11;\n varying float vNoiseF11;\n uniform float uTime;\n uniform vec3 uTint;\n uniform float uPulse;\n uniform float uRim;\n uniform float uEdgeWarp;\n uniform float uBands;\n float hashF11(vec3 p){ return fract(sin(dot(p, vec3(17.13, 11.97, 73.21))) * 43758.5453); }`)
                .replace('#include <dithering_fragment>', `
                    vec3 viewDirF11 = normalize(cameraPosition - vWorldPosF11);
                    float rimF11 = pow(1.0 - max(dot(normalize(vNormalF11), viewDirF11), 0.0), 1.6 + uRim * 1.6);
                    float bandF11 = floor((gl_FragColor.r + gl_FragColor.g + gl_FragColor.b) * 0.333 * uBands) / max(uBands - 1.0, 1.0);
                    float flowF11 = sin(vWorldPosF11.y * 3.3 + vWorldPosF11.x * 1.7 + uTime * (0.55 + uPulse * 0.2) + vNoiseF11 * 4.0) * 0.5 + 0.5;
                    float gritF11 = hashF11(floor(vWorldPosF11 * 7.0) + floor(uTime * 6.0));
                    gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * (0.76 + bandF11 * 0.34), 0.72);
                    gl_FragColor.rgb += uTint * rimF11 * (0.18 + flowF11 * 0.24);
                    gl_FragColor.rgb += uTint * (gritF11 - 0.5) * 0.03;
                    gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb.bgr, rimF11 * 0.08 + vNoiseF11 * 0.04);
                    #include <dithering_fragment>`);
            mat.userData.fractureShader = shader;
            patchedMaterials.push(mat);
        };
        mat.needsUpdate = true;
        return mat;
    }

    function tuneMeshRecursive(obj, tint) {
        obj.traverse((child) => {
            if (!child.isMesh || decoratedMeshes.has(child)) return;
            decoratedMeshes.add(child);
            const mats = ensureArray(child.material);
            mats.forEach((m) => tuneMaterial(m, { tint: tint || m.color || 0xb4ff85 }));
            child.castShadow = true;
            child.receiveShadow = true;
        });
    }

    function makeGlowOrb(color, radius, opacity=0.55){
        const m = new THREE.Mesh(
            new THREE.IcosahedronGeometry(radius, 1),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
        );
        return m;
    }

    function makeFilament(color, length, radiusTop, radiusBottom) {
        const mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(radiusTop, radiusBottom, length, 5),
            tuneMaterial(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.28, metalness: 0.14 }), { tint: color, emissiveStrength: 0.18, rim: 1.2, pulse: 0.9 })
        );
        return mesh;
    }

    function decorateTree(group) {
        if (!group || group.userData?.fractureDecorated) return;
        const tint = pick(group.userData?.style?.accentColor || group.userData?.color || 0x93ffb7, 0x93ffb7);
        const halo = new THREE.Group();
        halo.position.y = 1.15;
        for (let i = 0; i < 6; i++) {
            const a = i / 6 * Math.PI * 2;
            const petal = new THREE.Mesh(
                new THREE.TetrahedronGeometry(0.18 + Math.random() * 0.06, 0),
                tuneMaterial(new THREE.MeshStandardMaterial({ color: tint, emissive: tint, emissiveIntensity: 0.6, roughness: 0.18, metalness: 0.08 }), { tint, pulse: 1.1, rim: 1.3, bands: 5.0 })
            );
            petal.position.set(Math.cos(a) * 0.48, 0.12 + Math.sin(a * 2.0) * 0.08, Math.sin(a) * 0.48);
            petal.rotation.set(Math.random() * 0.7, a, Math.random() * 0.7);
            halo.add(petal);
        }
        const orb = makeGlowOrb(tint, 0.22, 0.32);
        halo.add(orb);
        group.add(halo);
        tagPulse(halo, halo.position.y, Math.random() * Math.PI * 2, 0.06, 0.8 + Math.random() * 0.4);
        group.userData.fractureDecorated = true;
        tuneMeshRecursive(group, tint);
    }

    function decorateBush(group) {
        if (!group || group.userData?.fractureDecorated) return;
        const tint = pick(group.userData?.style?.accentColor || group.userData?.color || 0x7bffc9, 0x7bffc9);
        for (let i = 0; i < 8; i++) {
            const a = i / 8 * Math.PI * 2;
            const tendril = makeFilament(tint, 0.45 + Math.random() * 0.18, 0.012, 0.028);
            tendril.position.set(Math.cos(a) * 0.18, 0.16, Math.sin(a) * 0.18);
            tendril.rotation.z = Math.cos(a) * 0.55;
            tendril.rotation.x = Math.sin(a) * 0.38;
            group.add(tendril);
        }
        const core = makeGlowOrb(tint, 0.16, 0.28);
        core.position.y = 0.18;
        group.add(core);
        tagPulse(core, core.position.y, Math.random() * 6.28, 0.04, 1.2);
        group.userData.fractureDecorated = true;
        tuneMeshRecursive(group, tint);
    }

    function decorateRock(group) {
        if (!group || group.userData?.fractureDecorated) return;
        const base = pick(group.userData?.color || 0xaec1ff, 0xaec1ff);
        const tint = base.clone().lerp(new THREE.Color(0x99ffe9), 0.38);
        for (let i = 0; i < 5; i++) {
            const spike = new THREE.Mesh(
                new THREE.OctahedronGeometry(0.12 + Math.random() * 0.10, 0),
                tuneMaterial(new THREE.MeshStandardMaterial({ color: tint, emissive: tint, emissiveIntensity: 0.55, roughness: 0.14, metalness: 0.22 }), { tint, pulse: 0.95, rim: 1.4, edgeWarp: 1.1 })
            );
            spike.scale.y = 1.8 + Math.random() * 1.3;
            spike.position.set((Math.random() - 0.5) * 0.35, 0.14 + Math.random() * 0.22, (Math.random() - 0.5) * 0.35);
            spike.rotation.set(Math.random() * 1.6, Math.random() * Math.PI * 2, Math.random() * 1.6);
            group.add(spike);
            tagPulse(spike, spike.position.y, Math.random() * 6.28, 0.03, 0.9 + Math.random() * 0.6);
        }
        group.userData.fractureDecorated = true;
        tuneMeshRecursive(group, tint);
    }

    function decorateGrass(group) {
        if (!group || group.userData?.fractureDecorated) return;
        const tint = pick(group.userData?.color || 0xb6ff8b, 0xb6ff8b);
        for (let i = 0; i < 4; i++) {
            const a = i / 4 * Math.PI * 2;
            const blade = new THREE.Mesh(
                new THREE.PlaneGeometry(0.10, 0.48 + Math.random() * 0.18),
                new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false, fog: true })
            );
            blade.position.set(Math.cos(a) * 0.06, 0.28, Math.sin(a) * 0.06);
            blade.rotation.y = a;
            blade.rotation.z = 0.2 + Math.random() * 0.4;
            group.add(blade);
        }
        group.userData.fractureDecorated = true;
        tuneMeshRecursive(group, tint);
    }

    function decorateFlower(group) {
        if (!group || group.userData?.fractureDecorated) return;
        const tint = pick(group.userData?.style?.accentColor || group.userData?.color || 0xff8ef8, 0xff8ef8);
        const ring = new THREE.Group();
        ring.position.y = 0.38;
        for (let i = 0; i < 7; i++) {
            const a = i / 7 * Math.PI * 2;
            const shard = new THREE.Mesh(
                new THREE.TetrahedronGeometry(0.09 + Math.random() * 0.04, 0),
                tuneMaterial(new THREE.MeshStandardMaterial({ color: tint, emissive: tint, emissiveIntensity: 0.78, roughness: 0.12, metalness: 0.08 }), { tint, pulse: 1.3, rim: 1.5 })
            );
            shard.position.set(Math.cos(a) * 0.18, Math.sin(a * 2.0) * 0.02, Math.sin(a) * 0.18);
            shard.rotation.set(Math.random() * 1.2, a, Math.random() * 1.2);
            ring.add(shard);
        }
        const core = makeGlowOrb(tint, 0.09, 0.38);
        ring.add(core);
        group.add(ring);
        tagPulse(ring, ring.position.y, Math.random() * 6.28, 0.05, 1.4);
        group.userData.fractureDecorated = true;
        tuneMeshRecursive(group, tint);
    }

    function decorateCreature(group) {
        if (!group || group.userData?.fractureDecorated) return;
        const tint = pick(group.userData?.style?.accentColor || group.userData?.color || 0xffd682, 0xffd682);
        const crown = new THREE.Group();
        crown.position.y = 0.42 * (group.userData?.targetScale || 1);
        const n = 4 + Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) {
            const a = i / n * Math.PI * 2;
            const spine = new THREE.Mesh(
                new THREE.ConeGeometry(0.04, 0.18 + Math.random() * 0.10, 5),
                tuneMaterial(new THREE.MeshStandardMaterial({ color: tint, emissive: tint, emissiveIntensity: 0.62, roughness: 0.18, metalness: 0.06 }), { tint, pulse: 1.0, rim: 1.25 })
            );
            spine.position.set(Math.cos(a) * 0.14, 0.04 + Math.random() * 0.06, Math.sin(a) * 0.14);
            spine.rotation.z = Math.cos(a) * 0.4;
            spine.rotation.x = Math.sin(a) * 0.4;
            crown.add(spine);
        }
        const halo = new THREE.Mesh(
            new THREE.TorusGeometry(0.16, 0.012, 6, 32),
            new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false })
        );
        halo.rotation.x = Math.PI * 0.5;
        halo.position.y = 0.12;
        crown.add(halo);
        group.add(crown);
        tagPulse(crown, crown.position.y, Math.random() * 6.28, 0.03, 1.7);
        group.userData.fractureDecorated = true;
        tuneMeshRecursive(group, tint);
    }

    function decorateEntity(entity) {
        if (!entity || decoratedEntities.has(entity)) return;
        const type = entity.userData && entity.userData.type;
        if (!type) return;
        if (type === 'tree') decorateTree(entity);
        else if (type === 'bush') decorateBush(entity);
        else if (type === 'rock' || type === 'gold_rock') decorateRock(entity);
        else if (type === 'grass') decorateGrass(entity);
        else if (type === 'flower') decorateFlower(entity);
        else if (type === 'creature') decorateCreature(entity);
        else tuneMeshRecursive(entity, entity.userData?.color || 0xb4ff85);
        decoratedEntities.add(entity);
    }

    function makeAuroraRibbon(planet, color, heightFactor, phase) {
        const path = [];
        const radius = planet.radius * (1.08 + heightFactor * 0.05);
        for (let i = 0; i <= 22; i++) {
            const t = i / 22;
            const ang = t * Math.PI * 2;
            const y = Math.sin(ang * 2.0 + phase) * planet.radius * 0.08;
            path.push(new THREE.Vector3(Math.cos(ang) * radius, y, Math.sin(ang) * radius));
        }
        const curve = new THREE.CatmullRomCurve3(path, true);
        const geo = new THREE.TubeGeometry(curve, 96, planet.radius * 0.015, 6, true);
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        return mesh;
    }

    function buildParticleSwarm(count, colorA, colorB, radius) {
        const pos = new Float32Array(count * 3);
        const col = new Float32Array(count * 3);
        const velocity = [];
        const cA = pick(colorA, 0xc4ff87);
        const cB = pick(colorB, 0x83f8ff);
        for (let i = 0; i < count; i++) {
            const dir = new THREE.Vector3().randomDirection();
            const r = radius * (0.7 + Math.random() * 0.7);
            pos[i*3] = dir.x * r; pos[i*3+1] = dir.y * r; pos[i*3+2] = dir.z * r;
            const c = cA.clone().lerp(cB, Math.random());
            col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
            velocity.push({ axis: new THREE.Vector3().randomDirection(), speed: 0.08 + Math.random() * 0.24, base: new THREE.Vector3(pos[i*3], pos[i*3+1], pos[i*3+2]) });
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const mat = new THREE.PointsMaterial({ size: radius * 0.025, vertexColors: true, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
        const points = new THREE.Points(geo, mat);
        driftSystems.push({ points, velocity, radius });
        return points;
    }

    function decoratePlanet(planet) {
        if (!planet || decoratedPlanets.has(planet)) return;
        decoratedPlanets.add(planet);
        const group = planet.group;
        const palette = engine.state?.palette || {};
        const eco = planet.eco || {};
        const tintA = pick((palette.accent || 0xc4ff87), 0xc4ff87).lerp(new THREE.Color(0x82ffd4), eco.humidity || 0.25);
        const tintB = pick((palette.background || 0x8fa6ff), 0x8fa6ff).lerp(new THREE.Color(0xdb82ff), eco.toxicity || 0.15);

        tuneMeshRecursive(group, tintA);
        if (planet.groundMesh?.material) {
            tuneMaterial(planet.groundMesh.material, { tint: tintA, pulse: 0.7, rim: 1.0, edgeWarp: 1.0, bands: 5.0 });
        }

        const shell = new THREE.Mesh(
            new THREE.IcosahedronGeometry(planet.radius * 1.11, 3),
            new THREE.ShaderMaterial({
                uniforms: { uTime: { value: 0 }, uTintA: { value: tintA }, uTintB: { value: tintB }, uAlpha: { value: 0.28 } },
                vertexShader: `varying vec3 vN; varying vec3 vW; uniform float uTime; void main(){ vec3 p = position + normal * (sin(position.y*3.0 + position.x*4.0 + uTime*0.6)*0.18); vec4 w = modelMatrix * vec4(p,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
                fragmentShader: `uniform float uTime; uniform vec3 uTintA; uniform vec3 uTintB; uniform float uAlpha; varying vec3 vN; varying vec3 vW; void main(){ vec3 V = normalize(cameraPosition - vW); float rim = pow(1.0 - max(dot(normalize(vN), V), 0.0), 2.4); float n = sin(vW.x*0.14 + uTime*0.9) * sin(vW.y*0.16 - uTime*0.7) * sin(vW.z*0.13 + uTime*0.6); vec3 col = mix(uTintA, uTintB, n*0.5+0.5); gl_FragColor = vec4(col, rim * uAlpha * (0.5 + (n*0.5+0.5))); }`,
                transparent: true,
                side: THREE.BackSide,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                fog: false
            })
        );
        shell.userData.fractureShell = true;
        group.add(shell);
        pulseObjects.push(shell);

        const ribbons = new THREE.Group();
        ribbons.add(makeAuroraRibbon(planet, tintA, 0.2, Math.random() * Math.PI * 2));
        ribbons.add(makeAuroraRibbon(planet, tintB, 0.8, Math.random() * Math.PI * 2));
        group.add(ribbons);

        const shardGroup = new THREE.Group();
        const shardCount = 24;
        for (let i = 0; i < shardCount; i++) {
            const normal = new THREE.Vector3().randomDirection();
            const dist = planet.radius * (1.17 + Math.random() * 0.16);
            const spike = new THREE.Mesh(
                new THREE.TetrahedronGeometry(planet.radius * (0.05 + Math.random() * 0.03), 0),
                tuneMaterial(new THREE.MeshStandardMaterial({ color: tintA.clone().lerp(tintB, Math.random()), emissive: tintA, emissiveIntensity: 0.4, roughness: 0.22, metalness: 0.08 }), { tint: tintA, pulse: 0.8 + Math.random() * 0.4, rim: 1.35, edgeWarp: 1.25 })
            );
            spike.position.copy(normal).multiplyScalar(dist);
            spike.scale.set(1.0, 2.6 + Math.random() * 2.5, 1.0);
            qA.setFromUnitVectors(up, normal.clone().normalize());
            spike.quaternion.copy(qA);
            shardGroup.add(spike);
            tagPulse(spike, spike.position.y, Math.random() * 6.28, 0.07, 0.5 + Math.random());
        }
        group.add(shardGroup);

        const motes = buildParticleSwarm(90, tintA, tintB, planet.radius * 1.8);
        group.add(motes);
    }

    function wrapFactoryMethod(name, decorator) {
        if (!engine.factory || !engine.factory[name] || engine.factory[name].__fractureWrapped) return;
        const original = engine.factory[name].bind(engine.factory);
        const wrapped = function(...args) {
            const result = original(...args);
            try { decorator(result, args); } catch (e) { console.warn('[Fracture V11] decorate fail for', name, e); }
            return result;
        };
        wrapped.__fractureWrapped = true;
        engine.factory[name] = wrapped;
    }

    wrapFactoryMethod('createTree', decorateTree);
    wrapFactoryMethod('createBush', decorateBush);
    wrapFactoryMethod('createRock', decorateRock);
    wrapFactoryMethod('createGrass', decorateGrass);
    wrapFactoryMethod('createFlower', decorateFlower);
    wrapFactoryMethod('createCreature', decorateCreature);
    wrapFactoryMethod('createPlanet', (planet) => decoratePlanet(planet));

    function createSpaceCanopy() {
        const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(760, 28, 18),
            new THREE.ShaderMaterial({
                uniforms: { uTime: { value: 0 } },
                vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
                fragmentShader: `uniform float uTime; varying vec3 vP; float fb(vec3 p){ float f=0.0; float a=0.5; for(int i=0;i<4;i++){ f += a * sin(p.x)*sin(p.y)*sin(p.z); p = p*1.7 + vec3(2.1, -1.3, 1.7); a *= 0.5; } return f; } void main(){ vec3 d = normalize(vP); float n = fb(d * 5.0 + vec3(uTime*0.03, -uTime*0.02, uTime*0.01)); vec3 col = mix(vec3(0.01,0.02,0.05), vec3(0.13,0.22,0.34), smoothstep(-0.35,0.45,n)); col += vec3(0.12,0.28,0.18) * smoothstep(0.1,0.55,n); col += vec3(0.20,0.08,0.28) * smoothstep(0.22,0.75,n*n); gl_FragColor = vec4(col, 1.0); }`,
                side: THREE.BackSide,
                depthWrite: false,
                fog: false
            })
        );
        sphere.name = 'Fracture Canopy';
        scene.add(sphere);
        pulseObjects.push(sphere);
        return sphere;
    }

    const canopy = createSpaceCanopy();

    function reskinCurrentWorld() {
        if (engine.state?.entities) {
            for (const entity of engine.state.entities) decorateEntity(entity);
        }
        if (engine.state?.islands) {
            for (const island of engine.state.islands) decoratePlanet(island);
        }
        if (scene) tuneMeshRecursive(scene, engine.state?.palette?.accent || 0xb4ff85);
        if (world.stars?.material) {
            world.stars.material.size = 1.65;
            world.stars.material.opacity = 0.88;
            if (world.stars.material.color) world.stars.material.color.set(0xd8fff5);
        }
        scene.fog = new THREE.FogExp2(0x050813, 0.0062);
        if (scene.background?.set) scene.background.set(0x02040a);
    }
    reskinCurrentWorld();

    let last = performance.now();
    let energy = 0, danger = 0, aim = 0;
    function tick(now) {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;

        const state = engine.state || {};
        const player = state.player || {};
        const vel = player.vel || vA.set(0,0,0);
        const speed = vel.length ? vel.length() : Math.sqrt((vel.x||0)*(vel.x||0) + (vel.y||0)*(vel.y||0) + (vel.z||0)*(vel.z||0));
        const speedNorm = clamp(speed / 7.0, 0, 1);
        const dangerTarget = state.isDead ? 1 : clamp(((state.player?.hp != null ? (1 - state.player.hp / 20) : 0) * 0.75) + (state.breachAiming ? 0.12 : 0), 0, 1);
        const aimTarget = state.breachAiming ? 1 : 0;
        energy = smooth(energy, speedNorm + (state.isOnBoat ? 0.18 : 0), 4.8, dt);
        danger = smooth(danger, dangerTarget, 3.0, dt);
        aim = smooth(aim, aimTarget, 7.0, dt);
        root.style.setProperty('--fracture-v11-energy', energy.toFixed(3));
        root.style.setProperty('--fracture-v11-danger', danger.toFixed(3));
        root.style.setProperty('--fracture-v11-aim', aim.toFixed(3));

        for (const mat of patchedMaterials) {
            const shader = mat.userData && mat.userData.fractureShader;
            if (shader && shader.uniforms) shader.uniforms.uTime.value = now * 0.001;
        }
        for (const sys of driftSystems) {
            const attr = sys.points.geometry.getAttribute('position');
            for (let i = 0; i < sys.velocity.length; i++) {
                const p = sys.velocity[i];
                vA.copy(p.base).applyAxisAngle(p.axis, now * 0.001 * p.speed);
                const bob = Math.sin(now * 0.001 * (0.6 + p.speed) + i) * 0.18;
                attr.setXYZ(i, vA.x * (1 + bob * 0.02), vA.y * (1 + bob * 0.03), vA.z * (1 + bob * 0.02));
            }
            attr.needsUpdate = true;
            sys.points.rotation.y += dt * 0.05;
        }
        for (const obj of pulseObjects) {
            if (!obj || !obj.parent) continue;
            if (obj.material && obj.material.uniforms && obj.material.uniforms.uTime) obj.material.uniforms.uTime.value = now * 0.001;
            const p = obj.userData && obj.userData._fracturePulse;
            if (p && obj.position) {
                obj.position.y = p.baseY + Math.sin(now * 0.001 * p.speed + p.phase) * p.amp;
                obj.rotation.y += dt * 0.12;
            } else if (obj.material && obj.material.uniforms && obj.material.uniforms.uAlpha) {
                obj.rotation.y += dt * 0.08;
            }
        }

        if (canopy && canopy.material && canopy.material.uniforms) {
            canopy.material.uniforms.uTime.value = now * 0.001;
        }

        if ((Math.floor(now / 600) % 2) === 0) reskinCurrentWorld();
        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    console.info('[Fracture Biosphere V11 Overdrive] silhouettes, flora/fauna augmentation, planetary atmospheric structures, nebular canopy and live material deformation installed.');
}
