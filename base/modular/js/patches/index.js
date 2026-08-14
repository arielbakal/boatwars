// =====================================================
// PATCH LAYERS - install order
// =====================================================
// The visual/quality core layers rewrite prototypes on EntityFactory and
// WorldManager, so they must run before the engine is constructed and the
// world is generated. The remaining layers take the live engine instance.

import { PATCH_FLAGS } from './flags.js';

import installPocketTerrariumVisualCore from './visual-core-v7.js';
import installTerrariumQualityV8Core from './quality-core-v8.js';

import installKineticGameplayV31 from './kinetic-gameplay-v31.js';
import installPocketTerrariumScreenFeel from './screen-feel-v7.js';
import installTerrariumQualityV8Runtime from './quality-runtime-v8.js';
import installBiosphereFaunaV9 from './biosphere-fauna-v9.js';
import installFractureBiosphereV10 from './fracture-biosphere-v10.js';
import installFractureBiosphereV11 from './fracture-biosphere-v11.js';

// Prototype-level patches. Must run before `new GameEngine()`.
export function installCorePatches() {
    installPocketTerrariumVisualCore();
    installTerrariumQualityV8Core();
}

// Engine-level patches. Must run after `new GameEngine()`.
export function installEnginePatches(engine) {
    installKineticGameplayV31(engine);

    const dormant = [
        ['screenFeelV7', installPocketTerrariumScreenFeel],
        ['qualityRuntimeV8', installTerrariumQualityV8Runtime],
        ['biosphereFaunaV9', installBiosphereFaunaV9],
        ['fractureBiosphereV10', installFractureBiosphereV10],
        ['fractureBiosphereV11', installFractureBiosphereV11],
    ];

    for (const [flag, install] of dormant) {
        if (!PATCH_FLAGS[flag]) continue;
        try {
            install(engine);
        } catch (error) {
            console.warn(`[patches] ${flag} failed:`, error);
        }
    }
}
