// =====================================================
// POCKET TERRARIUM VISUAL FEEL V7 - CORE
// =====================================================
// Flat colour families, poster shading and a crisp low-resolution image.
// Patches EntityFactory.generatePalette and WorldManager.getMat.

import EntityFactory from '../classes/EntityFactory.js';
import WorldManager from '../classes/WorldManager.js';

export default function installPocketTerrariumVisualCore() {
    'use strict';
    if (window.__pocketTerrariumVisualCoreV7) return;
    window.__pocketTerrariumVisualCoreV7 = true;

    const clamp01 = value => Math.max(0, Math.min(1, value));
    const wrapHue = hue => (hue % 1 + 1) % 1;
    const hsl = (h, s, l) => new THREE.Color().setHSL(wrapHue(h), clamp01(s), clamp01(l));
    const circularMix = (a, b, amount) => {
        const delta = ((b - a + 1.5) % 1) - 0.5;
        return wrapHue(a + delta * amount);
    };

    EntityFactory.prototype.generatePalette = function visualPalette(sphereColor, eco = null) {
        const themes = [
            { ground: .30, flora: .345, accent: .035, creature: .075, water: .55, void: .69 },
            { ground: .52, flora: .465, accent: .985, creature: .955, water: .58, void: .72 },
            { ground: .68, flora: .58,  accent: .285, creature: .245, water: .60, void: .76 },
            { ground: .105,flora: .155, accent: .545, creature: .59,  water: .56, void: .70 },
            { ground: .91, flora: .83,  accent: .46,  creature: .50,  water: .54, void: .73 },
            { ground: .40, flora: .32,  accent: .80,  creature: .84,  water: .57, void: .68 }
        ];
        const theme = themes[Math.floor(Math.random() * themes.length)];
        const temperature = eco ? clamp01(eco.temperature) : .52;
        const humidity = eco ? clamp01(eco.humidity) : .55;
        const lightLevel = eco ? Math.max(.55, Math.min(1.25, eco.lightLevel)) : 1;

        let groundHue;
        if (sphereColor) {
            const explicit = sphereColor === 'red' ? .985 : sphereColor === 'blue' ? .635 : .105;
            groundHue = wrapHue(explicit + (Math.random() - .5) * .035);
        } else {
            const climateHue = .69 * (1 - temperature);
            groundHue = circularMix(theme.ground, climateHue, .14);
            groundHue = wrapHue(groundHue + (Math.random() - .5) * .026);
        }

        const hueShift = ((groundHue - theme.ground + 1.5) % 1) - .5;
        const floraHue = wrapHue(theme.flora + hueShift * .72 + (Math.random() - .5) * .018);
        const accentHue = wrapHue(theme.accent + hueShift * .18);
        const creatureHue = wrapHue(theme.creature + hueShift * .18 + (Math.random() - .5) * .025);
        const brightness = Math.max(.76, Math.min(1.06, .82 + lightLevel * .18));
        const lifeSat = .56 + humidity * .18;
        const dryWash = (1 - humidity) * .08;

        const baseRock = hsl(groundHue + .015, .20 + humidity * .05, .145 * brightness);
        const soil = hsl(groundHue + .035, .31 + humidity * .07, .235 * brightness);
        const groundTop = hsl(floraHue - .018, lifeSat - .18 - dryWash, (.355 + humidity * .035) * brightness);
        const flora = hsl(floraHue, lifeSat - dryWash, (.47 + humidity * .045) * brightness);
        const floraAccent = hsl(floraHue + .035, lifeSat + .02, (.59 + humidity * .025) * brightness);
        const tallGrass = hsl(floraHue - .025, lifeSat - .04, (.515 + humidity * .03) * brightness);
        const creature = hsl(creatureHue, .67 + humidity * .08, (.59 + humidity * .02) * brightness);
        const accent = hsl(accentHue, .72, .66 * brightness);
        const background = hsl(wrapHue(groundHue + .48), .33, .68);
        const skyGlow = hsl(wrapHue(accentHue + .025), .52, .70);
        const water = hsl(theme.water + hueShift * .10, .58 + humidity * .07, .48 * brightness);
        const waterDeep = water.clone().offsetHSL(-.025, -.04, -.20);
        const shadow = hsl(theme.void + hueShift * .16, .31, .085);
        const sunlit = hsl(accentHue - .018, .38, .76);
        const trunk = soil.clone().lerp(baseRock, .50);
        return { background, baseRock, trunk, soil, groundTop, flora, floraAccent, tallGrass, creature, accent, skyGlow, water, waterDeep, shadow, sunlit };
    };

    WorldManager.prototype.getMat = function visualPosterMaterial(color, flat = true) {
        const base = color instanceof THREE.Color ? color.clone() : new THREE.Color(color);
        const deepInk = new THREE.Color(0x111229);
        const shadow = base.clone().offsetHSL(-.025, -.10, -.16).lerp(deepInk, .28);
        const mid = base.clone().offsetHSL(.005, .035, .035);
        const highlight = base.clone().offsetHSL(.025, .015, .17);
        const bounce = base.clone().offsetHSL(.115, .05, .07);
        const uniforms = THREE.UniformsUtils.merge([
            THREE.UniformsLib.fog,
            {
                uColor: { value: base },
                uShadow: { value: shadow },
                uMid: { value: mid },
                uHighlight: { value: highlight },
                uBounce: { value: bounce }
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
                uniform vec3 uMid;
                uniform vec3 uHighlight;
                uniform vec3 uBounce;
                varying vec3 vWorldNormal;
                varying vec3 vViewDir;
                float hash21(vec2 p) {
                    p = fract(p * vec2(123.34, 456.21));
                    p += dot(p, p + 45.32);
                    return fract(p.x * p.y);
                }
                void main() {
                    vec3 n = normalize(vWorldNormal);
                    vec3 keyDir = normalize(vec3(-0.38, 0.84, 0.38));
                    vec3 fillDir = normalize(vec3(0.72, 0.18, -0.67));
                    float key = clamp(dot(n, keyDir) * 0.5 + 0.5, 0.0, 1.0);
                    float fill = max(dot(n, fillDir), 0.0);
                    vec3 painted;
                    if (key < 0.30) painted = uShadow;
                    else if (key < 0.56) painted = mix(uShadow, uColor, 0.68);
                    else if (key < 0.80) painted = uMid;
                    else painted = uHighlight;
                    painted = mix(painted, uBounce, fill * 0.055);
                    float rim = pow(1.0 - max(dot(n, normalize(vViewDir)), 0.0), 3.4);
                    painted += uHighlight * rim * 0.025;
                    float dither = (hash21(floor(gl_FragCoord.xy)) - 0.5) / 255.0;
                    painted += dither * 2.4;
                    gl_FragColor = vec4(painted, 1.0);
                    #include <fog_fragment>
                }
            `
        });
        material.color = material.uniforms.uColor.value;
        material.userData.baseShadow = material.uniforms.uShadow.value;
        material.userData.baseAccent = material.uniforms.uHighlight.value;
        return material;
    };
}
