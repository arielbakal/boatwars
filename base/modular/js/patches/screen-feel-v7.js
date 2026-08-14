// =====================================================
// POCKET TERRARIUM SCREEN FEEL V7 (DORMANT)
// =====================================================
// Drives the kinetic CSS custom properties from live game state.
//
// This layer never executed in the single-file prototype: it was invoked as
// `(typeof game !== 'undefined' ? game : null)` from a script block that could
// not see the engine, so its `if (!engine) return;` guard always fired. It is
// ported verbatim and gated off in patches/flags.js. See ROADMAP.md.

export default function installPocketTerrariumScreenFeel(engine) {
    'use strict';
    if (!engine || engine.__pocketTerrariumScreenFeelV7) return;
    engine.__pocketTerrariumScreenFeelV7 = true;

    const root = document.documentElement;
    const canvas = engine.world && engine.world.renderer ? engine.world.renderer.domElement : document.querySelector('canvas');
    if (canvas) canvas.classList.add('game-canvas');
    if (engine.world && engine.world.stars && engine.world.stars.material) {
        engine.world.stars.material.size = 1.18;
        engine.world.stars.material.opacity = .68;
        engine.world.stars.material.needsUpdate = true;
    }

    const toRgb = color => {
        const c = color instanceof THREE.Color ? color : new THREE.Color(color || 0xc8ff8f);
        return `${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}`;
    };
    const toHex = color => `#${(color instanceof THREE.Color ? color : new THREE.Color(color || 0xc8ff8f)).getHexString()}`;
    const clamp = value => Math.max(0, Math.min(1, value));
    const smooth = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

    let last = performance.now();
    let visualSpeed = 0;
    let visualImpact = 0;
    let visualDanger = 0;
    let visualAim = 0;
    let lastPalette = null;
    let lastHp = engine.state?.player?.hp || 20;
    let lastShake = 0;

    function updatePalette() {
        const palette = engine.state && engine.state.palette;
        if (!palette || palette === lastPalette) return;
        lastPalette = palette;
        const accent = palette.accent || palette.floraAccent || palette.flora;
        const flora = palette.flora || accent;
        root.style.setProperty('--world-accent', toHex(accent));
        root.style.setProperty('--world-accent-rgb', toRgb(accent));
        root.style.setProperty('--world-flora', toHex(flora));
    }

    function frame(now) {
        const dt = Math.min(.05, Math.max(.001, (now - last) / 1000));
        last = now;
        const state = engine.state;
        let speedTarget = 0;
        if (state && state.isOnBoat && state.activeBoat && state.activeBoat.userData?.stats) {
            const stats = state.activeBoat.userData.stats;
            speedTarget = clamp(Math.abs(stats.currentSpeed || 0) / Math.max(.001, stats.maxSpeed || 1));
        } else if (state && state.player && state.player.vel) {
            const expected = Math.max(.04, (state.player.speed || .12) + (state.player.speedBoost || 0));
            speedTarget = clamp(state.player.vel.length() / (expected * 1.32));
        }

        const hp = state?.player?.hp ?? lastHp;
        const maxHp = Math.max(1, state?.player?.maxHp || 20);
        const dangerTarget = clamp(1 - hp / maxHp);
        const shake = clamp((state?.cameraShake || 0) * 2.5);
        if (hp < lastHp || shake > lastShake + .06) visualImpact = Math.max(visualImpact, .86);
        lastHp = hp;
        lastShake = shake;

        const crosshair = document.getElementById('breach-crosshair');
        const aimVisible = crosshair && getComputedStyle(crosshair).display !== 'none';
        const aimTarget = aimVisible ? (crosshair.classList.contains('charging') ? 1 : .55) : 0;

        visualSpeed = smooth(visualSpeed, speedTarget, 6.5, dt);
        visualDanger = smooth(visualDanger, dangerTarget, 4.2, dt);
        visualAim = smooth(visualAim, aimTarget, 8.5, dt);
        visualImpact = Math.max(0, visualImpact - dt * 2.55);

        const finalImpact = Math.max(visualImpact, shake * .45);
        root.style.setProperty('--kinetic-speed', visualSpeed.toFixed(3));
        root.style.setProperty('--kinetic-danger', visualDanger.toFixed(3));
        root.style.setProperty('--kinetic-aim', visualAim.toFixed(3));
        root.style.setProperty('--kinetic-impact', finalImpact.toFixed(3));
        root.style.setProperty('--kinetic-saturate', (1.08 + visualSpeed * .12).toFixed(3));
        root.style.setProperty('--kinetic-contrast', (1.045 + visualSpeed * .045).toFixed(3));
        root.style.setProperty('--kinetic-brightness', (1.025 + finalImpact * .035).toFixed(3));
        root.style.setProperty('--kinetic-speed-opacity', (visualSpeed * visualSpeed * .24).toFixed(3));
        root.style.setProperty('--kinetic-speed-scale', (1.04 + visualSpeed * .05).toFixed(3));
        root.style.setProperty('--kinetic-danger-opacity', (visualDanger * .62 + finalImpact * .18).toFixed(3));
        root.style.setProperty('--kinetic-aim-glow', `${(3 + visualAim * 5).toFixed(2)}px`);
        updatePalette();
        requestAnimationFrame(frame);
    }

    updatePalette();
    requestAnimationFrame(frame);
    console.info('[Visual Feel V7] Reference-driven palette, poster shading, raster finish and kinetic screen feedback installed.');
}
