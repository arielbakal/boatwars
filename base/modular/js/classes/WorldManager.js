// =====================================================
// WORLD MANAGER - Space Environment
// =====================================================

import { STAR_COUNT, STAR_SPREAD, SPACE_FOG_COLOR } from '../constants.js';

export default class WorldManager {
    constructor(renderScale) {
        this.renderScale = renderScale;
        this.pixelation = 8;
        this._pixelMinScale = 0.58;
        this._effectiveScale = renderScale;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.08, 2000);
        this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
        this.renderer.setPixelRatio(1);
        this.renderer.setSize(window.innerWidth * renderScale, window.innerHeight * renderScale, false);
        this.renderer.domElement.style.imageRendering = 'pixelated';
        // The world now uses artist-directed unlit shaders. Shadows remain enabled
        // only for the few metallic/special-effect meshes that still opt into them.
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.physicallyCorrectLights = false;
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.renderer.outputEncoding = THREE.sRGBEncoding;
        document.body.appendChild(this.renderer.domElement);
        // Matches SPACE_FOG_COLOR below (the comment on scene.fog already claimed
        // this) so fogged-out geometry actually blends into the sky as intended,
        // and the two can't drift apart again.
        this.scene.background = new THREE.Color(SPACE_FOG_COLOR);
        // Navigation-safe space fog: far (700) comfortably exceeds the farthest
        // planet's edge (~318 units from the sun at origin, Distant World on
        // ring 4) plus travel margin, so it only ever fades far-away emptiness,
        // never a planet you're approaching.
        // SPACE_FOG_COLOR matches scene.background above so fogged-out geometry
        // blends into the sky instead of showing a seam. Stars sit at
        // STAR_SPREAD (800-1000) — well past `far` — so they'd be fully fogged
        // out if they respected this; createStarfield() opts the star material
        // out via `fog: false` to keep the sky visible.
        this.scene.fog = new THREE.Fog(SPACE_FOG_COLOR, 150, 700);
        this.setupLighting();
        this.createStarfield();
        this.applyPixelation(this.pixelation);
    }

    applyPixelation(amount = 0) {
        const clamped = Math.max(0, Math.min(100, amount || 0));
        this.pixelation = clamped;
        const lerp = clamped / 100;
        this._effectiveScale = this.renderScale * (1 - lerp * (1 - this._pixelMinScale));
        this.renderer.setPixelRatio(1);
        this.renderer.setSize(window.innerWidth * this._effectiveScale, window.innerHeight * this._effectiveScale, false);
        const pixelStyle = clamped > 0 ? 'pixelated' : 'auto';
        this.renderer.domElement.style.imageRendering = pixelStyle;
        this.renderer.domElement.style.setProperty('image-rendering', pixelStyle);
    }

    setupLighting() {
        // Special meshes (ship glass, crystals, tools) still receive a soft,
        // deliberately colored stage light. Terrain, flora and fauna use the
        // custom unlit shader in getMat() and never depend on these lights.
        this.ambientLight = new THREE.HemisphereLight(0xb9d8ff, 0x2b183d, 0.48);
        this.ambientBaseIntensity = 0.48;
        this.scene.add(this.ambientLight);

        this.sunTarget = new THREE.Object3D();
        this.scene.add(this.sunTarget);
        this.sunLight = new THREE.DirectionalLight(0xffd8a6, 1.25);
        this.sunBaseIntensity = 1.25;
        this.sunLight.target = this.sunTarget;
        this.sunLight.position.set(0, 120, 0);
        this.sunLight.castShadow = true;
        this.sunLight.shadow.mapSize.set(1024, 1024);
        this.sunLight.shadow.camera.near = 0.5;
        this.sunLight.shadow.camera.far = 260;
        this.sunLight.shadow.camera.left = -26;
        this.sunLight.shadow.camera.right = 26;
        this.sunLight.shadow.camera.top = 26;
        this.sunLight.shadow.camera.bottom = -26;
        this.sunLight.shadow.bias = -0.0002;
        this.sunLight.shadow.normalBias = 0.025;
        this.scene.add(this.sunLight);

        const violetFill = new THREE.DirectionalLight(0x8d7dff, 0.38);
        violetFill.position.set(-90, -35, -75);
        this.scene.add(violetFill);

        const cyanFill = new THREE.DirectionalLight(0x68e5ff, 0.24);
        cyanFill.position.set(70, 30, 90);
        this.scene.add(cyanFill);
    }

    createStarfield() {
        const starGeo = new THREE.BufferGeometry();
        const positions = new Float32Array(STAR_COUNT * 3);
        const colors = new Float32Array(STAR_COUNT * 3);

        for (let i = 0; i < STAR_COUNT; i++) {
            const i3 = i * 3;
            // Random point on a large sphere shell
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const r = STAR_SPREAD + Math.random() * 200;
            positions[i3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            positions[i3 + 2] = r * Math.cos(phi);

            // Slightly varied star colors (white/blue/yellow)
            const colorRoll = Math.random();
            if (colorRoll < 0.7) {
                // White
                colors[i3] = 0.9 + Math.random() * 0.1;
                colors[i3 + 1] = 0.9 + Math.random() * 0.1;
                colors[i3 + 2] = 0.9 + Math.random() * 0.1;
            } else if (colorRoll < 0.85) {
                // Blue-white
                colors[i3] = 0.6 + Math.random() * 0.2;
                colors[i3 + 1] = 0.7 + Math.random() * 0.2;
                colors[i3 + 2] = 1.0;
            } else {
                // Warm yellow
                colors[i3] = 1.0;
                colors[i3 + 1] = 0.9 + Math.random() * 0.1;
                colors[i3 + 2] = 0.5 + Math.random() * 0.3;
            }
        }

        starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const starMat = new THREE.PointsMaterial({
            size: 1.5,
            vertexColors: true,
            transparent: true,
            opacity: 0.8,
            sizeAttenuation: true,
            fog: false // stars sit past the fog's `far` distance — opt out so the sky stays visible
        });

        this.stars = new THREE.Points(starGeo, starMat);
        this.scene.add(this.stars);
    }


    updateLocalSun(anchor) {
        if (!anchor || !this.sunLight || !this.sunTarget) return;
        const target = anchor instanceof THREE.Vector3 ? anchor : anchor.position;
        if (!target) return;
        const towardSun = target.clone().multiplyScalar(-1);
        if (towardSun.lengthSq() < 0.0001) towardSun.set(0, 1, 0);
        else towardSun.normalize();
        this.sunTarget.position.copy(target);
        this.sunLight.position.copy(target).addScaledVector(towardSun, 135);
        this.sunTarget.updateMatrixWorld();
        this.sunLight.updateMatrixWorld();
    }

    add(obj) { this.scene.add(obj); }
    remove(obj) { this.scene.remove(obj); }
    render() {
        if (this.stars) {
            const now = performance.now() * 0.001;
            this.stars.rotation.y = now * 0.0025;
            this.stars.material.opacity = 0.72 + Math.sin(now * 0.55) * 0.08;
        }
        this.renderer.render(this.scene, this.camera);
    }

    resize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.applyPixelation(this.pixelation);
    }

    getMat(color, flat = true) {
        // Artist-directed unlit material: it ignores every THREE light and instead
        // uses two fixed color ramps plus a subtle rim. This keeps the world bright,
        // readable and consistent while still allowing terrain bumps and silhouettes
        // to carry an intentional painted-light look.
        const base = color instanceof THREE.Color ? color.clone() : new THREE.Color(color);
        const shadow = base.clone().multiplyScalar(0.48).lerp(new THREE.Color(0x15162c), 0.34);
        const accent = base.clone().offsetHSL(0.08, 0.08, 0.18);
        const uniforms = THREE.UniformsUtils.merge([
            THREE.UniformsLib.fog,
            {
                uColor: { value: base },
                uShadow: { value: shadow },
                uAccent: { value: accent }
            }
        ]);
        const material = new THREE.ShaderMaterial({
            uniforms,
            fog: true,
            flatShading: !!flat,
            vertexShader: `
                #include <fog_pars_vertex>
                varying vec3 vWorldNormal;
                varying vec3 vViewDir;
                void main() {
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
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
                uniform vec3 uAccent;
                varying vec3 vWorldNormal;
                varying vec3 vViewDir;
                void main() {
                    vec3 n = normalize(vWorldNormal);
                    vec3 warmDir = normalize(vec3(-0.34, 0.88, 0.33));
                    vec3 coolDir = normalize(vec3(0.58, 0.22, -0.78));
                    float warm = clamp(dot(n, warmDir) * 0.5 + 0.5, 0.0, 1.0);
                    float cool = max(dot(n, coolDir), 0.0);
                    float band = floor(warm * 5.0) / 4.0;
                    float level = 0.18 + band * 0.72;
                    vec3 painted = mix(uShadow, uColor, level);
                    painted = mix(painted, uAccent, pow(cool, 2.4) * 0.08);
                    float rim = pow(1.0 - max(dot(n, normalize(vViewDir)), 0.0), 2.8);
                    painted += uAccent * rim * 0.045;
                    gl_FragColor = vec4(painted, 1.0);
                    #include <fog_fragment>
                }
            `
        });
        // Keep the same public surface as THREE's built-in materials. Several
        // inventory and pickup paths read or mutate material.color directly;
        // aliasing it to the shader uniform makes those operations update the
        // rendered color instead of failing on the custom unlit material.
        material.color = material.uniforms.uColor.value;
        material.userData.baseShadow = material.uniforms.uShadow.value;
        material.userData.baseAccent = material.uniforms.uAccent.value;
        return material;
    }
}

