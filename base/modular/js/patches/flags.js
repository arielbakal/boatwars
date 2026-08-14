// =====================================================
// PATCH FLAGS
// =====================================================
// Five of the prototype's patch layers never executed. In the single-file
// build they were invoked from script blocks that could not see the engine
// (`const game` lived inside an IIFE), so each layer received `null` and
// returned at its own `if (!engine) return;` guard.
//
// The port keeps them verbatim but off by default, so the module build
// reproduces the prototype's observable behaviour exactly. Flip one flag at a
// time to revive a layer — none of this code has ever run, so expect breakage.

export const PATCH_FLAGS = {
    screenFeelV7: false,
    qualityRuntimeV8: false,
    biosphereFaunaV9: false,
    fractureBiosphereV10: false,
    fractureBiosphereV11: false,
};
