// =====================================================
// EASING - Shared tween/interpolation helpers
// =====================================================

/**
 * Quadratic ease-in: starts slow, accelerates.
 * @param {number} t - normalized progress [0, 1]
 */
export function easeInQuad(t) {
    return t * t;
}

/**
 * Quadratic ease-out: starts fast, decelerates.
 * @param {number} t - normalized progress [0, 1]
 */
export function easeOutQuad(t) {
    return t * (2 - t);
}

/**
 * Quadratic ease-in-out: slow start, fast middle, slow end.
 * @param {number} t - normalized progress [0, 1]
 */
export function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * Convert a flat per-frame lerp/slerp factor `k` (tuned by eye at 60fps) into a
 * frame-rate-independent factor for the current frame's dt.
 *
 * A flat factor applied every frame (`x += (target - x) * k`, or `x.lerp(target, k)`)
 * is really an exponential decay whose convergence speed depends on how often it's
 * applied — at 30fps it converges half as fast per second as at 60fps, and twice as
 * fast at 120fps. `smoothFactor` reproduces the SAME per-second convergence rate at
 * any frame rate by scaling the exponent by how many 60fps-frames worth of time `dt`
 * represents:
 *
 *   smoothFactor(k, dt) = 1 - (1 - k) ** (dt * 60)
 *
 * At exactly dt = 1/60 this returns exactly `k`, so behavior at a steady 60fps is
 * unchanged — this is a drop-in replacement for any flat factor tuned at 60fps.
 *
 * @param {number} k - flat per-frame factor as tuned at 60fps, in (0, 1]
 * @param {number} dt - this frame's delta time in seconds
 * @returns {number} dt-corrected factor to pass to lerp()/slerp()
 */
export function smoothFactor(k, dt) {
    return 1 - Math.pow(1 - k, dt * 60);
}
