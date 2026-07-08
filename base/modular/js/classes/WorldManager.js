// =====================================================
// WORLD MANAGER - Space Environment
// =====================================================

import { STAR_COUNT, STAR_SPREAD, SPACE_FOG_COLOR } from '../constants.js';

export default class WorldManager {
    constructor(renderScale) {
        this.renderScale = renderScale;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 2000);
        this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
        this.renderer.setSize(window.innerWidth * renderScale, window.innerHeight * renderScale, false);
        this.renderer.domElement.style.imageRendering = 'pixelated';
        // r128 API — filmic tone mapping + sRGB output for correct color response
        // against the hand-rolled HSL palettes (shifts global brightness/saturation
        // slightly; acceptable). NOTE: r152+ renames `outputEncoding` (THREE.sRGBEncoding)
        // to `outputColorSpace` (THREE.SRGBColorSpace) — update both lines together
        // on any future Three.js upgrade past r151.
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
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
    }

    setupLighting() {
        // Ambient - dimmer for space
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambientLight);

        // Distant sun (directional)
        const sunLight = new THREE.DirectionalLight(0xffffee, 1.0);
        sunLight.position.set(200, 100, 50);
        this.scene.add(sunLight);

        // Secondary fill light from opposite side
        const fillLight = new THREE.DirectionalLight(0x4466aa, 0.3);
        fillLight.position.set(-100, -50, -80);
        this.scene.add(fillLight);
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

    add(obj) { this.scene.add(obj); }
    remove(obj) { this.scene.remove(obj); }
    render() { this.renderer.render(this.scene, this.camera); }

    resize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth * this.renderScale, window.innerHeight * this.renderScale, false);
    }

    getMat(color, flat = true) {
        // r128's MeshToonMaterial has no flatShading property — passing it was
        // always a silent no-op (logs a console warning on every material
        // creation). `flat` is kept as a parameter for call-site compatibility
        // but intentionally unused now.
        return new THREE.MeshToonMaterial({ color: color });
    }
}
