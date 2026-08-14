// =====================================================
// TERRARIUM QUALITY V8 - CORE
// =====================================================
// Procedural material and model quality pass: generated surface structure,
// silhouette-rich foliage, coherent terrain/stone/bark profiles, animated
// water and clouds. No external textures, models or runtime assets.

import EntityFactory from '../classes/EntityFactory.js';
import WorldManager from '../classes/WorldManager.js';
import { getProceduralRig, setProceduralRig } from '../classes/ProceduralRig.js';

export default function installTerrariumQualityV8Core() {
    'use strict';

    const PROFILE = Object.freeze({
        default: { scale: 1.8, strength: .10, fine: .035, speckle: .018, stripe: 0, stripeScale: 7, backlight: .05, wind: 0, saturation: 1.00 },
        terrain: { scale: .62, strength: .25, fine: .085, speckle: .035, stripe: .035, stripeScale: 5.0, backlight: 0, wind: 0, saturation: 1.03 },
        soil:    { scale: 1.05, strength: .30, fine: .11, speckle: .065, stripe: .10, stripeScale: 8.0, backlight: 0, wind: 0, saturation: .96 },
        stone:   { scale: 2.75, strength: .34, fine: .14, speckle: .10, stripe: .13, stripeScale: 10.0, backlight: 0, wind: 0, saturation: .88 },
        bark:    { scale: 4.8, strength: .31, fine: .12, speckle: .045, stripe: .28, stripeScale: 18.0, backlight: 0, wind: 0, saturation: .90 },
        foliage: { scale: 3.4, strength: .23, fine: .075, speckle: .022, stripe: .018, stripeScale: 8.0, backlight: .78, wind: .020, saturation: 1.08 },
        petal:   { scale: 4.2, strength: .18, fine: .055, speckle: .01, stripe: .028, stripeScale: 11.0, backlight: .92, wind: .014, saturation: 1.12 },
        creature:{ scale: 2.15, strength: .14, fine: .052, speckle: .018, stripe: .055, stripeScale: 9.0, backlight: .12, wind: 0, saturation: 1.06 }
    });

    function seedFromColor(color) {
        const c = color instanceof THREE.Color ? color : new THREE.Color(color || 0xffffff);
        return (c.r * 17.13 + c.g * 31.77 + c.b * 53.91 + Math.random() * 11.0) % 97.0;
    }

    function colorDistance(a, b) {
        if (!a || !b) return 999;
        const ca = a instanceof THREE.Color ? a : new THREE.Color(a);
        const cb = b instanceof THREE.Color ? b : new THREE.Color(b);
        const dr = ca.r - cb.r, dg = ca.g - cb.g, db = ca.b - cb.b;
        return Math.sqrt(dr * dr + dg * dg + db * db);
    }

    function setProfile(material, name, seedOverride) {
        if (!material || !material.userData?.terrariumQualityV8 || !material.uniforms) return material;
        const p = PROFILE[name] || PROFILE.default;
        const u = material.uniforms;
        u.uTexScale.value = p.scale;
        u.uTextureStrength.value = p.strength;
        u.uFineStrength.value = p.fine;
        u.uSpeckle.value = p.speckle;
        u.uStripeStrength.value = p.stripe;
        u.uStripeScale.value = p.stripeScale;
        u.uBacklight.value = p.backlight;
        u.uWind.value = p.wind;
        u.uSaturation.value = p.saturation;
        if (seedOverride !== undefined) u.uSeed.value = seedOverride;
        material.userData.qualityProfile = name;
        return material;
    }

    WorldManager.prototype.getMat = function terrariumProceduralMaterial(color, flat = true) {
        const base = color instanceof THREE.Color ? color.clone() : new THREE.Color(color);
        const deepInk = new THREE.Color(0x0c1020);
        const shadow = base.clone().offsetHSL(-.018, -.08, -.18).lerp(deepInk, .24);
        const mid = base.clone().offsetHSL(.006, .025, .045);
        const highlight = base.clone().offsetHSL(.018, .015, .16);
        const bounce = base.clone().offsetHSL(.11, .045, .065);
        const seed = seedFromColor(base);
        const p = PROFILE.default;

        const uniforms = THREE.UniformsUtils.merge([
            THREE.UniformsLib.fog,
            {
                uColor: { value: base },
                uShadow: { value: shadow },
                uMid: { value: mid },
                uHighlight: { value: highlight },
                uBounce: { value: bounce },
                uTime: { value: 0 },
                uSeed: { value: seed },
                uTexScale: { value: p.scale },
                uTextureStrength: { value: p.strength },
                uFineStrength: { value: p.fine },
                uSpeckle: { value: p.speckle },
                uStripeStrength: { value: p.stripe },
                uStripeScale: { value: p.stripeScale },
                uBacklight: { value: p.backlight },
                uWind: { value: p.wind },
                uSaturation: { value: p.saturation }
            }
        ]);

        const material = new THREE.ShaderMaterial({
            uniforms,
            fog: true,
            side: THREE.FrontSide,
            vertexShader: `
                #include <fog_pars_vertex>
                uniform float uTime;
                uniform float uSeed;
                uniform float uWind;
                varying vec3 vWorldNormal;
                varying vec3 vViewDir;
                varying vec3 vLocalPos;
                varying vec3 vWorldPos;
                void main() {
                    vec3 p = position;
                    if (uWind > 0.0001) {
                        float heightMask = smoothstep(-0.15, 1.25, p.y);
                        float gust = sin(uTime * 1.15 + uSeed * 2.7 + p.y * 3.2)
                                  + sin(uTime * 2.05 + uSeed * 0.7 + p.x * 5.1) * 0.36;
                        p.x += gust * uWind * heightMask;
                        p.z += cos(uTime * 1.4 + uSeed + p.y * 2.4) * uWind * .58 * heightMask;
                    }
                    vLocalPos = p;
                    vec4 worldPosition = modelMatrix * vec4(p, 1.0);
                    vWorldPos = worldPosition.xyz;
                    vWorldNormal = normalize(mat3(modelMatrix) * normal);
                    vViewDir = normalize(cameraPosition - worldPosition.xyz);
                    vec4 mvPosition = viewMatrix * worldPosition;
                    gl_Position = projectionMatrix * mvPosition;
                    #include <fog_vertex>
                }
            `,
            fragmentShader: `
                #include <fog_pars_fragment>
                uniform vec3 uColor;
                uniform vec3 uShadow;
                uniform vec3 uMid;
                uniform vec3 uHighlight;
                uniform vec3 uBounce;
                uniform float uSeed;
                uniform float uTexScale;
                uniform float uTextureStrength;
                uniform float uFineStrength;
                uniform float uSpeckle;
                uniform float uStripeStrength;
                uniform float uStripeScale;
                uniform float uBacklight;
                uniform float uSaturation;
                varying vec3 vWorldNormal;
                varying vec3 vViewDir;
                varying vec3 vLocalPos;
                varying vec3 vWorldPos;

                float hash31(vec3 p) {
                    p = fract(p * .1031);
                    p += dot(p, p.yzx + 33.33);
                    return fract((p.x + p.y) * p.z);
                }
                float noise3(vec3 p) {
                    vec3 i = floor(p), f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    float n000 = hash31(i + vec3(0,0,0));
                    float n100 = hash31(i + vec3(1,0,0));
                    float n010 = hash31(i + vec3(0,1,0));
                    float n110 = hash31(i + vec3(1,1,0));
                    float n001 = hash31(i + vec3(0,0,1));
                    float n101 = hash31(i + vec3(1,0,1));
                    float n011 = hash31(i + vec3(0,1,1));
                    float n111 = hash31(i + vec3(1,1,1));
                    float nx00 = mix(n000, n100, f.x);
                    float nx10 = mix(n010, n110, f.x);
                    float nx01 = mix(n001, n101, f.x);
                    float nx11 = mix(n011, n111, f.x);
                    float nxy0 = mix(nx00, nx10, f.y);
                    float nxy1 = mix(nx01, nx11, f.y);
                    return mix(nxy0, nxy1, f.z);
                }
                float fbm(vec3 p) {
                    float v = 0.0;
                    float a = .55;
                    mat3 r = mat3(.00,.80,.60, -.80,.36,-.48, -.60,-.48,.64);
                    for (int i = 0; i < 3; i++) {
                        v += noise3(p) * a;
                        p = r * p * 2.03 + 7.17;
                        a *= .48;
                    }
                    return v;
                }
                vec3 saturateColor(vec3 c, float sat) {
                    float l = dot(c, vec3(.2126,.7152,.0722));
                    return mix(vec3(l), c, sat);
                }
                void main() {
                    vec3 n = normalize(vWorldNormal);
                    vec3 keyDir = normalize(vec3(-.36, .86, .37));
                    vec3 fillDir = normalize(vec3(.70, .20, -.68));
                    float keyRaw = clamp(dot(n, keyDir) * .5 + .5, 0.0, 1.0);
                    float key = floor(keyRaw * 6.0) / 5.0;
                    float fill = max(dot(n, fillDir), 0.0);
                    vec3 painted = mix(uShadow, uColor, smoothstep(.05, .62, key));
                    painted = mix(painted, uMid, smoothstep(.50, .80, key) * .52);
                    painted = mix(painted, uHighlight, smoothstep(.78, 1.0, key) * .62);
                    painted = mix(painted, uBounce, fill * .065);

                    vec3 sampleP = vLocalPos * uTexScale + vec3(uSeed, uSeed * .37, -uSeed * .61);
                    float macro = fbm(sampleP * .22);
                    float grain = fbm(sampleP);
                    float fine = noise3(sampleP * 4.1 + 19.7);
                    float breakup = (macro - .48) * uTextureStrength + (grain - .50) * uTextureStrength * .72 + (fine - .5) * uFineStrength;
                    painted *= 1.0 + breakup;

                    float strata = .5 + .5 * sin(vLocalPos.y * uStripeScale + grain * 5.2 + uSeed);
                    float strataMask = smoothstep(.62, .92, strata) * uStripeStrength;
                    painted = mix(painted, uShadow, strataMask * .36);

                    float speck = smoothstep(.86, .98, fine + grain * .16) * uSpeckle;
                    painted = mix(painted, uShadow, speck * 1.8);

                    float back = pow(max(dot(-n, keyDir), 0.0), 2.0) * uBacklight;
                    painted += uHighlight * back * .16;
                    float rim = pow(1.0 - max(dot(n, normalize(vViewDir)), 0.0), 3.2);
                    painted += uHighlight * rim * (.018 + uBacklight * .018);

                    painted = saturateColor(max(painted, 0.0), uSaturation);
                    float dither = (hash31(vec3(floor(gl_FragCoord.xy), uSeed)) - .5) / 255.0;
                    painted += dither * 1.25;
                    gl_FragColor = vec4(painted, 1.0);
                    #include <fog_fragment>
                }
            `
        });
        material.color = material.uniforms.uColor.value;
        material.userData.terrariumQualityV8 = true;
        material.userData.baseShadow = material.uniforms.uShadow.value;
        material.userData.baseAccent = material.uniforms.uHighlight.value;
        material.userData.qualityProfile = 'default';
        if (!this.__qualityV8Materials) this.__qualityV8Materials = new Set();
        this.__qualityV8Materials.add(material);
        return material;
    };


    WorldManager.prototype.applyQualityProfile = function(material, name, seed) {
        return setProfile(material, name, seed);
    };

    const originalWorldRender = WorldManager.prototype.render;
    WorldManager.prototype.render = function qualityRenderV8() {
        const t = performance.now() * .001;
        if (this.__qualityV8Materials) {
            for (const material of this.__qualityV8Materials) {
                if (!material || material._disposed) { this.__qualityV8Materials.delete(material); continue; }
                if (material.uniforms?.uTime) material.uniforms.uTime.value = t;
            }
        }
        if (this.__qualityV8Animated) {
            for (const item of this.__qualityV8Animated) {
                if (!item?.object?.parent) continue;
                if (item.type === 'clouds') {
                    item.object.rotation.y = item.baseY + t * item.speed;
                    item.object.rotation.x = item.baseX + Math.sin(t * .07 + item.phase) * .025;
                    if (item.material?.uniforms?.uTime) item.material.uniforms.uTime.value = t;
                } else if (item.type === 'water' && item.material?.uniforms?.uTime) {
                    item.material.uniforms.uTime.value = t;
                }
            }
        }
        return originalWorldRender.call(this);
    };

    function applyProfileToGroup(group, profile, seed) {
        group?.traverse?.(obj => {
            if (!obj.material) return;
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach(mat => setProfile(mat, profile, seed));
        });
    }

    function findProfileByColors(group, map) {
        group?.traverse?.(obj => {
            if (!obj.material) return;
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (const mat of mats) {
                if (!mat?.color || !mat.userData?.terrariumQualityV8) continue;
                let best = null;
                let bestD = Infinity;
                for (const entry of map) {
                    const d = colorDistance(mat.color, entry.color);
                    if (d < bestD) { bestD = d; best = entry; }
                }
                if (best) setProfile(mat, best.profile, best.seed);
            }
        });
    }

    function buildLeafClusterGeometry(dna, treeMode = true) {
        const positions = [];
        const indices = [];
        const height = Math.max(.7, dna.height || 1.4);
        const archetype = dna.archetype || 'umbrella';
        const rings = treeMode ? (archetype === 'spire' ? 5 : 3) : 2;
        const perRing = treeMode ? (archetype === 'fan' ? 12 : archetype === 'spire' ? 7 : 9) : 7;
        const baseRadius = treeMode ? Math.max(.36, height * .31) : .34;
        let vert = 0;
        for (let ring = 0; ring < rings; ring++) {
            for (let i = 0; i < perRing; i++) {
                const a = (i / perRing) * Math.PI * 2 + ring * .63 + Math.random() * .18;
                const y = treeMode
                    ? height * (.70 + ring * (.20 / Math.max(1, rings - 1)))
                    : .12 + ring * .15;
                const radial = baseRadius * (.52 + ring * .22) * (.82 + Math.random() * .34);
                const base = new THREE.Vector3(Math.cos(a) * radial * .50, y, Math.sin(a) * radial * .50);
                const outward = new THREE.Vector3(Math.cos(a), archetype === 'spire' ? .62 : .18 + ring * .11, Math.sin(a)).normalize();
                if (archetype === 'fan') outward.y = .05 + Math.random() * .18;
                if (archetype === 'bulb') outward.y = .28 + Math.random() * .35;
                outward.normalize();
                const length = (treeMode ? height * (.19 + Math.random() * .12) : .24 + Math.random() * .14);
                const width = length * (.28 + Math.random() * .16);
                const tangent = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(width);
                const lift = new THREE.Vector3(0, length * (.08 + Math.random() * .07), 0);
                const mid = base.clone().addScaledVector(outward, length * .48).add(lift);
                const tip = base.clone().addScaledVector(outward, length).addScaledVector(lift, .35);
                const left = mid.clone().add(tangent);
                const right = mid.clone().sub(tangent);
                positions.push(
                    base.x, base.y, base.z,
                    left.x, left.y, left.z,
                    tip.x, tip.y, tip.z,
                    right.x, right.y, right.z
                );
                indices.push(vert, vert + 1, vert + 2, vert, vert + 2, vert + 3);
                vert += 4;
            }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setIndex(indices);
        geo.computeVertexNormals();
        return geo;
    }

    function addTreeQuality(factory, g, dna) {
        if (!g || g.userData?.qualityV8Foliage) return;
        g.userData.qualityV8Foliage = true;
        findProfileByColors(g, [
            { color: dna.trunkColor, profile: 'bark', seed: seedFromColor(dna.trunkColor) },
            { color: dna.color, profile: 'foliage', seed: seedFromColor(dna.color) },
            { color: dna.accentColor || dna.color, profile: 'petal', seed: seedFromColor(dna.accentColor || dna.color) }
        ]);

        const leafMat = factory.getMat(dna.color, false);
        setProfile(leafMat, 'foliage', seedFromColor(dna.color));
        leafMat.side = THREE.DoubleSide;
        const leafGeo = buildLeafClusterGeometry(dna, true);
        const leaves = new THREE.Mesh(leafGeo, leafMat);
        leaves.name = 'quality-v8 batched leaf canopy';
        leaves.castShadow = true;
        g.add(leaves);

        if (Math.random() < .38 && (dna.height || 1) > 1.4) {
            const vineMat = factory.getMat(dna.accentColor || dna.color, false);
            setProfile(vineMat, 'foliage', seedFromColor(dna.accentColor || dna.color));
            const h = dna.height || 1.5;
            const side = Math.random() < .5 ? -1 : 1;
            const curve = new THREE.CatmullRomCurve3([
                new THREE.Vector3(side * .12, h * .78, 0),
                new THREE.Vector3(side * .28, h * .58, .08),
                new THREE.Vector3(side * .18, h * .36, -.05),
                new THREE.Vector3(side * .30, h * .15, .04)
            ]);
            const vine = new THREE.Mesh(new THREE.TubeGeometry(curve, 10, .012, 4, false), vineMat);
            vine.name = 'quality-v8 vine';
            g.add(vine);
        }
    }

    function addBushQuality(factory, g, dna) {
        if (!g || g.userData?.qualityV8Foliage) return;
        g.userData.qualityV8Foliage = true;
        findProfileByColors(g, [
            { color: dna.color, profile: 'foliage', seed: seedFromColor(dna.color) },
            { color: dna.accentColor || dna.color, profile: 'petal', seed: seedFromColor(dna.accentColor || dna.color) }
        ]);
        const leafMat = factory.getMat(dna.color, false);
        setProfile(leafMat, 'foliage', seedFromColor(dna.color));
        leafMat.side = THREE.DoubleSide;
        const proxyDna = { height: .72, archetype: dna.archetype || 'fan' };
        const leaves = new THREE.Mesh(buildLeafClusterGeometry(proxyDna, false), leafMat);
        leaves.scale.set(1.08, .92 * (dna.scaleY || 1), 1.08);
        leaves.position.y = .04;
        g.add(leaves);
    }

    function waterMaterial(world, color, glow) {
        const base = color instanceof THREE.Color ? color.clone() : new THREE.Color(color);
        const bright = glow instanceof THREE.Color ? glow.clone() : new THREE.Color(glow || 0xbcecff);
        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: base },
                uBright: { value: bright },
                uTime: { value: 0 },
                uSeed: { value: Math.random() * 10 }
            },
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vPos;
                void main(){
                    vUv = uv;
                    vPos = position;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uColor;
                uniform vec3 uBright;
                uniform float uTime;
                uniform float uSeed;
                varying vec2 vUv;
                varying vec3 vPos;
                float h(vec2 p){ p=fract(p*vec2(123.34,345.45)); p+=dot(p,p+34.345); return fract(p.x*p.y); }
                float n(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
                void main(){
                    vec2 p = vUv * 7.0;
                    float a = n(p + vec2(uTime*.07, uTime*.035 + uSeed));
                    float b = n(p*2.1 + vec2(-uTime*.055, uTime*.08));
                    float ripples = .5 + .5*sin((vUv.x+vUv.y)*42.0 + a*7.0 - uTime*1.55);
                    float glint = smoothstep(.82, .98, ripples * .62 + b * .48);
                    float edge = smoothstep(.02,.22,vUv.x)*smoothstep(.98,.78,vUv.x)*smoothstep(.02,.22,vUv.y)*smoothstep(.98,.78,vUv.y);
                    vec3 c = mix(uColor*.78, uColor*1.08, a*.72+b*.20);
                    c = mix(c, uBright, glint*.32);
                    gl_FragColor = vec4(c, (.74 + glint*.08) * (.88 + edge*.12));
                }
            `
        });
        if (!world.__qualityV8Animated) world.__qualityV8Animated = new Set();
        return mat;
    }

    function cloudMaterial(color, density) {
        const c = color instanceof THREE.Color ? color.clone() : new THREE.Color(color || 0xdfefff);
        return new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: c },
                uTime: { value: 0 },
                uSeed: { value: Math.random() * 30 },
                uDensity: { value: density }
            },
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            vertexShader: `
                varying vec3 vSphere;
                varying vec3 vNormalW;
                varying vec3 vView;
                void main(){
                    vSphere=normalize(position);
                    vec4 wp=modelMatrix*vec4(position,1.0);
                    vNormalW=normalize(mat3(modelMatrix)*normal);
                    vView=normalize(cameraPosition-wp.xyz);
                    gl_Position=projectionMatrix*viewMatrix*wp;
                }
            `,
            fragmentShader: `
                uniform vec3 uColor;
                uniform float uTime;
                uniform float uSeed;
                uniform float uDensity;
                varying vec3 vSphere;
                varying vec3 vNormalW;
                varying vec3 vView;
                float h(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
                float n(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);float a=h(i),b=h(i+vec3(1,0,0)),c=h(i+vec3(0,1,0)),d=h(i+vec3(1,1,0)),e=h(i+vec3(0,0,1)),ff=h(i+vec3(1,0,1)),g=h(i+vec3(0,1,1)),hh=h(i+vec3(1,1,1));return mix(mix(mix(a,b,f.x),mix(c,d,f.x),f.y),mix(mix(e,ff,f.x),mix(g,hh,f.x),f.y),f.z);}
                void main(){
                    vec3 p=vSphere*4.2+vec3(uSeed+uTime*.018,uSeed*.3,-uTime*.012);
                    float q=n(p)*.64+n(p*2.3+9.1)*.28+n(p*5.1-3.4)*.08;
                    float alpha=smoothstep(.52-uDensity*.08,.72-uDensity*.05,q)*(.10+uDensity*.16);
                    float rim=pow(1.0-max(dot(normalize(vNormalW),normalize(vView)),0.0),2.0);
                    alpha*=.62+rim*.58;
                    vec3 col=mix(uColor*.78,uColor*1.08,q);
                    gl_FragColor=vec4(col,alpha);
                }
            `
        });
    }


    function addGroundCover(factory, result, palette, eco, radius) {
        const surface = result?.groundMesh;
        const posAttr = surface?.geometry?.attributes?.position;
        const normAttr = surface?.geometry?.attributes?.normal;
        if (!posAttr || !normAttr || posAttr.count < 8) return;

        const humidity = eco ? Math.max(0, Math.min(1, eco.humidity || 0)) : .48;
        const count = Math.min(320, Math.max(70, Math.round(70 + radius * (4.0 + humidity * 3.8))));
        const positions = [];
        const indices = [];
        const n = new THREE.Vector3(), p = new THREE.Vector3(), tangent = new THREE.Vector3(), bitangent = new THREE.Vector3();
        const upA = new THREE.Vector3(0, 1, 0), upB = new THREE.Vector3(1, 0, 0);
        let vert = 0;
        for (let i = 0; i < count; i++) {
            const vi = Math.floor(Math.random() * posAttr.count);
            p.fromBufferAttribute(posAttr, vi);
            n.fromBufferAttribute(normAttr, vi).normalize();
            tangent.crossVectors(n, Math.abs(n.y) < .88 ? upA : upB).normalize();
            bitangent.crossVectors(n, tangent).normalize();
            const spin = Math.random() * Math.PI * 2;
            const t = tangent.clone().multiplyScalar(Math.cos(spin)).addScaledVector(bitangent, Math.sin(spin)).normalize();
            const b = bitangent.clone().multiplyScalar(Math.cos(spin)).addScaledVector(tangent, -Math.sin(spin)).normalize();
            const h = (.10 + Math.random() * .24) * (.72 + humidity * .58);
            const w = h * (.10 + Math.random() * .08);
            const base = p.clone().addScaledVector(n, .018);
            const tip = base.clone().addScaledVector(n, h).addScaledVector(b, (Math.random() - .5) * h * .28);
            const left = base.clone().addScaledVector(t, w);
            const right = base.clone().addScaledVector(t, -w);
            positions.push(left.x,left.y,left.z, right.x,right.y,right.z, tip.x,tip.y,tip.z);
            indices.push(vert,vert+1,vert+2);
            vert += 3;
            if (humidity > .58 && i % 3 === 0) {
                const t2 = b;
                const tip2 = base.clone().addScaledVector(n, h * .82).addScaledVector(t, (Math.random()-.5)*h*.24);
                const left2 = base.clone().addScaledVector(t2, w*.82);
                const right2 = base.clone().addScaledVector(t2, -w*.82);
                positions.push(left2.x,left2.y,left2.z, right2.x,right2.y,right2.z, tip2.x,tip2.y,tip2.z);
                indices.push(vert,vert+1,vert+2);
                vert += 3;
            }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setIndex(indices);
        geo.computeVertexNormals();
        const mat = factory.getMat(palette.tallGrass || palette.flora, false);
        setProfile(mat, 'foliage', seedFromColor(palette.tallGrass || palette.flora));
        mat.side = THREE.DoubleSide;
        if (mat.uniforms?.uWind) mat.uniforms.uWind.value = .0035;
        if (mat.uniforms?.uTextureStrength) mat.uniforms.uTextureStrength.value *= .72;
        const cover = new THREE.Mesh(geo, mat);
        cover.name = 'quality-v8 merged micro ground cover';
        cover.castShadow = false;
        cover.receiveShadow = false;
        result.group.add(cover);
    }

    const originalPlanet = EntityFactory.prototype.createPlanet;
    EntityFactory.prototype.createPlanet = function qualityPlanetV8(palette, cx, cy, cz, radius, hasAtmosphere, eco) {
        const result = originalPlanet.call(this, palette, cx, cy, cz, radius, hasAtmosphere, eco);
        const children = result.group?.children || [];
        if (children[0]?.material) setProfile(children[0].material, 'stone', seedFromColor(palette.baseRock));
        if (children[1]?.material) setProfile(children[1].material, 'soil', seedFromColor(palette.soil));
        if (children[2]?.material) setProfile(children[2].material, 'terrain', seedFromColor(palette.groundTop));
        addGroundCover(this, result, palette, eco, radius);

        if (hasAtmosphere) {
            const humidity = eco ? Math.max(0, Math.min(1, eco.humidity || 0)) : .45;
            const cloudColor = (palette.skyGlow || palette.background || new THREE.Color(0xdceeff)).clone().lerp(new THREE.Color(0xffffff), .42);
            const clouds = new THREE.Mesh(
                new THREE.IcosahedronGeometry(radius * 1.018, 3),
                cloudMaterial(cloudColor, .32 + humidity * .55)
            );
            clouds.name = 'quality-v8 procedural cloud stratum';
            result.group.add(clouds);
            if (!this.world.__qualityV8Animated) this.world.__qualityV8Animated = new Set();
            this.world.__qualityV8Animated.add({
                type: 'clouds', object: clouds, material: clouds.material,
                speed: (.004 + Math.random() * .006) * (Math.random() < .5 ? -1 : 1),
                baseX: Math.random() * .4, baseY: Math.random() * Math.PI * 2, phase: Math.random() * 10
            });
        }
        return result;
    };

    const originalTree = EntityFactory.prototype.createTree;
    EntityFactory.prototype.createTree = function qualityTreeV8(p, x, z, style) {
        const g = originalTree.call(this, p, x, z, style);
        addTreeQuality(this, g, g.userData?.style || style || {});
        return g;
    };

    const originalBush = EntityFactory.prototype.createBush;
    EntityFactory.prototype.createBush = function qualityBushV8(p, x, z, style) {
        const g = originalBush.call(this, p, x, z, style);
        addBushQuality(this, g, g.userData?.style || style || {});
        return g;
    };

    const originalRock = EntityFactory.prototype.createRock;
    EntityFactory.prototype.createRock = function qualityRockV8(p, x, z, style) {
        const g = originalRock.call(this, p, x, z, style);
        applyProfileToGroup(g, 'stone', seedFromColor(g.userData?.color || p.baseRock));
        const m = g.children?.[0];
        if (m) {
            m.scale.multiply(new THREE.Vector3(.86 + Math.random() * .42, .72 + Math.random() * .50, .84 + Math.random() * .45));
            m.rotation.y += Math.random() * .7;
        }
        return g;
    };

    const originalGrass = EntityFactory.prototype.createGrass;
    EntityFactory.prototype.createGrass = function qualityGrassV8(p, x, z, style) {
        const g = originalGrass.call(this, p, x, z, style);
        applyProfileToGroup(g, 'foliage', seedFromColor(g.userData?.color || p.tallGrass));
        return g;
    };

    const originalFlower = EntityFactory.prototype.createFlower;
    EntityFactory.prototype.createFlower = function qualityFlowerV8(p, x, z, style) {
        const g = originalFlower.call(this, p, x, z, style);
        const dna = g.userData?.style || style || {};
        findProfileByColors(g, [
            { color: dna.stemColor || p.tallGrass, profile: 'foliage', seed: seedFromColor(dna.stemColor || p.tallGrass) },
            { color: dna.petalColor || p.floraAccent || p.accent, profile: 'petal', seed: seedFromColor(dna.petalColor || p.floraAccent || p.accent) },
            { color: dna.centerColor || p.accent, profile: 'petal', seed: seedFromColor(dna.centerColor || p.accent) }
        ]);
        g.rotation.z += (Math.random() - .5) * .08;
        return g;
    };


    function makeProceduralMap(kind, seed = 1) {
        const size = kind === 'panel' ? 128 : 96;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(size, size);
        let x = (Math.floor(seed * 1000003) ^ 0x9e3779b9) >>> 0;
        const rand = () => {
            x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
            return (x >>> 0) / 4294967295;
        };
        for (let y = 0; y < size; y++) {
            for (let xx = 0; xx < size; xx++) {
                const i = (y * size + xx) * 4;
                let v = 220;
                if (kind === 'fur') {
                    const strand = Math.sin((xx * .72 + y * .19) + Math.sin(y * .17) * 1.8) * 7;
                    v = 224 + strand + (rand() - .5) * 24;
                } else if (kind === 'cloth') {
                    const weave = ((xx % 5 === 0) ? -8 : 0) + ((y % 5 === 0) ? -7 : 0);
                    v = 226 + weave + (rand() - .5) * 15;
                } else if (kind === 'panel') {
                    const cell = ((xx % 32 < 2) || (y % 32 < 2)) ? -23 : 0;
                    v = 232 + cell + (rand() - .5) * 12;
                } else {
                    v = 226 + (rand() - .5) * 18;
                }
                v = Math.max(150, Math.min(250, v));
                img.data[i] = img.data[i+1] = img.data[i+2] = v;
                img.data[i+3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        if (kind === 'fur') {
            ctx.globalAlpha = .16;
            ctx.strokeStyle = '#5e5e5e';
            ctx.lineWidth = 2;
            for (let i = -size; i < size * 2; i += 18) {
                ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + size * .28, size); ctx.stroke();
            }
        } else if (kind === 'panel') {
            ctx.globalAlpha = .15;
            ctx.strokeStyle = '#5b5b5b';
            ctx.lineWidth = 1;
            for (let i = 0; i < 8; i++) {
                const y = Math.floor(rand() * size);
                ctx.beginPath(); ctx.moveTo(rand() * size * .35, y); ctx.lineTo(size * (.62 + rand() * .35), y + (rand()-.5)*4); ctx.stroke();
            }
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(kind === 'panel' ? 2.4 : 3.2, kind === 'panel' ? 4.1 : 3.2);
        tex.anisotropy = 2;
        tex.needsUpdate = true;
        return tex;
    }

    const originalCat = EntityFactory.prototype.createCat;
    EntityFactory.prototype.createCat = function qualityCatV8(x, z) {
        const g = originalCat.call(this, x, z);
        const furTex = makeProceduralMap('fur', 7.31);
        const seen = new Set();
        g.traverse(obj => {
            const mats = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
            mats.forEach(mat => {
                if (!mat?.isMeshStandardMaterial || seen.has(mat)) return;
                seen.add(mat);
                const c = mat.color;
                // Fur/cream/stripe materials are rough and non-emissive; eyes and nose stay clean.
                if ((mat.emissiveIntensity || 0) < .05 && c && c.r > .28) {
                    mat.map = furTex;
                    mat.bumpMap = furTex;
                    mat.bumpScale = .012;
                    mat.roughness = Math.max(.76, mat.roughness || .76);
                    mat.needsUpdate = true;
                }
            });
        });
        g.userData.qualityV8Texture = furTex;
        return g;
    };

    const OriginalProceduralRigV8 = getProceduralRig();
    if (OriginalProceduralRigV8) {
        setProceduralRig(class ProceduralRigQualityV8 extends OriginalProceduralRigV8 {
            constructor(controller, palette) {
                super(controller, palette);
                const cloth = makeProceduralMap('cloth', 12.77);
                const cloth2 = makeProceduralMap('cloth', 21.43);
                if (this.materials?.bodyMat) {
                    this.materials.bodyMat.map = cloth;
                    this.materials.bodyMat.bumpMap = cloth;
                    this.materials.bodyMat.bumpScale = .009;
                    this.materials.bodyMat.roughness = .76;
                    this.materials.bodyMat.needsUpdate = true;
                }
                if (this.materials?.jointMat) {
                    this.materials.jointMat.map = cloth2;
                    this.materials.jointMat.bumpMap = cloth2;
                    this.materials.jointMat.bumpScale = .006;
                    this.materials.jointMat.roughness = .69;
                    this.materials.jointMat.needsUpdate = true;
                }
                if (this.materials?.accentMat) {
                    this.materials.accentMat.map = cloth;
                    this.materials.accentMat.roughness = .62;
                    this.materials.accentMat.needsUpdate = true;
                }
                this.qualityV8Textures = [cloth, cloth2];
            }
        });
    }

    const originalCreature = EntityFactory.prototype.createCreature;
    EntityFactory.prototype.createCreature = function qualityCreatureV8(p, x, z, style) {
        const g = originalCreature.call(this, p, x, z, style);
        const dna = g.userData?.style || style || {};
        findProfileByColors(g, [
            { color: dna.color || p.creature, profile: 'creature', seed: seedFromColor(dna.color || p.creature) },
            { color: dna.accentColor || p.accent, profile: 'petal', seed: seedFromColor(dna.accentColor || p.accent) }
        ]);
        return g;
    };

    const originalPond = EntityFactory.prototype.createPond;
    EntityFactory.prototype.createPond = function qualityPondV8(p, x, z, scale) {
        const g = originalPond.call(this, p, x, z, scale);
        applyProfileToGroup(g, 'soil', seedFromColor(p.soil));
        const water = g.userData?.water;
        if (water) {
            if (water.material?.dispose) water.material.dispose();
            water.material = waterMaterial(this.world, p.water || new THREE.Color(0x38bce8), p.skyGlow || p.accent);
            if (!this.world.__qualityV8Animated) this.world.__qualityV8Animated = new Set();
            this.world.__qualityV8Animated.add({ type: 'water', object: water, material: water.material });
        }
        // Restore reeds/seed heads to foliage profiles after broad bank pass.
        g.children?.slice(3).forEach(child => applyProfileToGroup(child, 'foliage', seedFromColor(p.tallGrass || p.flora)));
        return g;
    };

    // Bring default pixelation down; surface detail now does the visual unification.
    const originalApplyPixelation = WorldManager.prototype.applyPixelation;
    WorldManager.prototype.applyPixelation = function qualityPixelationV8(amount = 0) {
        const adjusted = Math.max(0, Math.min(100, amount || 0));
        return originalApplyPixelation.call(this, adjusted);
    };

    console.info('[Terrarium Quality V8] Procedural materials, batched foliage, water and cloud systems installed.');
}
