// =====================================================
// PROCEDURAL RIG - planted feet, two-bone IK and kinetic aiming
// Local player only. The rig lives in PlayerController.playerGroup space,
// whose local +Y is always the active planet's surface normal.
// =====================================================

import SphericalUtils from './SphericalUtils.js';

const UP = new THREE.Vector3(0, 1, 0);
const EPS = 1e-6;
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
export const expAlpha = (rate, dt) => 1 - Math.exp(-rate * dt);
const smoothstep01 = t => t * t * (3 - 2 * t);

export const RIG = Object.freeze({
    stanceWidth: 0.31,
    upperLeg: 0.43,
    lowerLeg: 0.44,
    upperArm: 0.34,
    lowerArm: 0.35,
    pelvisHeight: 0.78,
    chestHeight: 1.22,
    walkStride: 0.54,
    runStride: 0.86,
    walkStepTime: 0.31,
    runStepTime: 0.20,
    walkLift: 0.17,
    runLift: 0.29,
    stepTrigger: 0.39,
    footHover: 0.045,
});

// ---------------------------------------------------------------------------
// LOCOMOTION MODEL
// ---------------------------------------------------------------------------
// The gait is a phase clock, not a set of triggers. Each leg owns a normalised
// phase offset half a cycle from the other, and the stance/swing split comes from
// a duty factor. Symmetry is then structural: a leg cannot be stranded mid-air,
// both legs cannot step together, and one leg cannot lock while the body slides —
// all of which a trigger-based stepper falls into as soon as speed changes.
//
// Cadence and stride follow the inverted-pendulum scaling that real legs obey.
// The Froude number (v^2 / gL) is the dimensionless speed of a walker, so step
// length grows as a power of it: creeping gives short unhurried steps, sprinting
// gives long fast ones, and the walk-to-run change in duty factor (double support
// giving way to a flight phase) falls out of the same number.

const GRAVITY_G = 9.0;           // gravity in rig units/s^2, for Froude scaling
const FROUDE_WALK = 0.50;        // below this the gait is unambiguously a walk
const FROUDE_RUN = 1.70;         // above this it is unambiguously a run
const DUTY_WALK = 0.64;          // stance fraction walking (legs overlap)
// Stance must stay above 0.5 so the two legs' stance windows overlap: this
// character's physics keeps it grounded while running, so a true flight phase
// would leave both feet off a floor they are actually standing on.
const DUTY_RUN = 0.52;
const STEP_LENGTH_K = 0.95;      // step length in leg lengths at Froude 1
const STEP_LENGTH_EXP = 0.42;    // Froude exponent for step growth
const MIN_STEP_RATE = 1.15;      // steps/s floor, so a crawl still cycles
const MAX_STEP_RATE = 5.4;       // steps/s ceiling, so a sprint never machine-guns
const MOVE_THRESHOLD = 0.30;     // below this the gait parks in a stance
const STANCE_TOLERANCE = 0.16;   // how far a parked foot may sit from its stance spot
const LEG_SAFETY = 0.965;        // never solve a leg at full extension
const STANCE_NARROW = 0.66;      // feet track nearer the centreline at speed
const STANCE_REACH_USE = 0.80;   // fraction of reach a planted foot may use

// Swing shaping.
const SWING_LIFT_WALK = 0.115;
const SWING_LIFT_RUN = 0.235;
const TOE_CLEARANCE = 0.05;      // guaranteed clearance over the ground mid-swing
const TOE_OFF_PITCH = 0.60;      // heel up through push-off
const HEEL_STRIKE_PITCH = 0.30;  // toe up just before touchdown
const FOOT_HALF_LENGTH = 0.195;  // half the foot mesh's 0.39 depth

// Body dynamics. These are the "delays and slowdowns": the pelvis, lean and arms
// are driven by springs so they carry momentum, lag behind the legs and settle,
// rather than snapping to a target every frame.
const COM_BOB = 0.032;           // vertical centre-of-mass oscillation
const COM_SWAY = 0.038;          // lateral shift toward the support leg
const PELVIS_YAW = 0.13;         // pelvis rotation across a stride
const PELVIS_ROLL = 0.075;       // frontal-plane drop toward the swing leg
const TORSO_COUNTER = 0.55;      // torso counter-rotation against the pelvis
const RUN_CROUCH = 0.09;         // pelvis lowers with speed, buying stride length
const LEAN_SPEED = 0.040;        // forward lean at full speed
const LEAN_ACCEL = 0.028;        // extra lean per unit forward acceleration
const LEAN_BANK = 0.085;         // roll into a turn per unit lateral acceleration
const HEAD_STABILISE = 0.6;      // how much the head cancels torso rotation
const RUN_SPEED_REF = 5.0;       // surface speed treated as a full sprint
const TELEPORT_STEP = 1.5;       // a jump this large is a respawn, not movement
const FALL_POSE_DELAY = 0.24;    // airborne longer than this is a fall, not a stride

// Critically damped spring. Secondary motion needs momentum: an exponential lerp
// has no velocity, so it can never lag behind and then catch up, which is exactly
// the overshoot-and-settle that makes weight read on screen.
class Spring {
    constructor(value = 0, stiffness = 90) {
        this.value = value;
        this.velocity = 0;
        this.stiffness = stiffness;
        this.damping = 2 * Math.sqrt(stiffness);
    }

    update(target, dt) {
        // Sub-stepped so a stiff spring stays stable when a frame runs long.
        let remaining = Math.min(dt, 0.1);
        while (remaining > 0) {
            const h = Math.min(1 / 120, remaining);
            const accel = -this.stiffness * (this.value - target) - this.damping * this.velocity;
            this.velocity += accel * h;
            this.value += this.velocity * h;
            remaining -= h;
        }
        return this.value;
    }

    reset(value) {
        this.value = value;
        this.velocity = 0;
    }
}

export class SegmentMesh {
    constructor(parent, material, radialSegments = 7) {
        this.mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, radialSegments), material);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        parent.add(this.mesh);
        this._up = new THREE.Vector3(0, 1, 0);
        this._dir = new THREE.Vector3();
    }

    set(a, b, radius) {
        this._dir.subVectors(b, a);
        const length = Math.max(this._dir.length(), EPS);
        this.mesh.position.copy(a).add(b).multiplyScalar(0.5);
        this.mesh.quaternion.setFromUnitVectors(this._up, this._dir.multiplyScalar(1 / length));
        this.mesh.scale.set(radius, length, radius);
    }
}
export default class ProceduralRig {
    constructor(controller, palette) {
        this.controller = controller;
        this.world = controller.world;
        this.root = controller.modelPivot;
        this.root.name = 'Planetary procedural rig';

        const bodyColor = palette?.creature?.clone?.() || new THREE.Color(0xd8d2bd);
        const limbColor = palette?.flora?.clone?.() || new THREE.Color(0x536b62);
        const accentColor = palette?.accent?.clone?.() || new THREE.Color(0xb9e98b);
        bodyColor.lerp(new THREE.Color(0xe5e0d0), 0.48);
        limbColor.lerp(new THREE.Color(0x24332e), 0.34);
        accentColor.lerp(new THREE.Color(0xcdf79d), 0.24);

        const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.7, metalness: 0.02 });
        const jointMat = new THREE.MeshStandardMaterial({ color: limbColor, roughness: 0.58, metalness: 0.08 });
        const accentMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.56, metalness: 0.03 });
        const darkMat = new THREE.MeshStandardMaterial({ color: 0x18201f, roughness: 0.48, metalness: 0.14 });

        this.materials = { bodyMat, jointMat, accentMat, darkMat };
        this.segments = {
            leftThigh: new SegmentMesh(this.root, bodyMat),
            leftShin: new SegmentMesh(this.root, jointMat),
            rightThigh: new SegmentMesh(this.root, bodyMat),
            rightShin: new SegmentMesh(this.root, jointMat),
            spine: new SegmentMesh(this.root, bodyMat, 8),
            neck: new SegmentMesh(this.root, jointMat, 7),
            leftUpperArm: new SegmentMesh(this.root, bodyMat),
            leftForearm: new SegmentMesh(this.root, jointMat),
            rightUpperArm: new SegmentMesh(this.root, bodyMat),
            rightForearm: new SegmentMesh(this.root, jointMat),
        };

        this.pelvisMesh = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.24, 0.29), bodyMat);
        this.chestMesh = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.39, 0.30), bodyMat);
        this.headMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.19, 1), accentMat);
        this.leftFootMesh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.085, 0.39), accentMat);
        this.rightFootMesh = this.leftFootMesh.clone();
        this.leftHandMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.085, 1), darkMat);
        this.rightHandMesh = this.leftHandMesh.clone();
        this.leftKnee = new THREE.Mesh(new THREE.SphereGeometry(0.105, 8, 6), jointMat);
        this.rightKnee = this.leftKnee.clone();
        this.leftElbow = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), jointMat);
        this.rightElbow = this.leftElbow.clone();

        for (const mesh of [
            this.pelvisMesh, this.chestMesh, this.headMesh,
            this.leftFootMesh, this.rightFootMesh,
            this.leftHandMesh, this.rightHandMesh,
            this.leftKnee, this.rightKnee, this.leftElbow, this.rightElbow,
        ]) {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.root.add(mesh);
        }

        // Small face markers preserve the readable character direction without
        // reverting to the old block-head aesthetic.
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0xf7fff2 });
        this.eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.035, 7, 5), eyeMat);
        this.eyeR = this.eyeL.clone();
        this.root.add(this.eyeL, this.eyeR);

        // Compatibility handles. Legacy systems test armL/armR existence, but the
        // visible limbs are solved here rather than rotated directly.
        this.armProxyL = new THREE.Group();
        this.armProxyR = new THREE.Group();
        this.root.add(this.armProxyL, this.armProxyR);

        this.handAnchorL = new THREE.Group();
        this.handAnchorR = new THREE.Group();
        this.root.add(this.handAnchorL, this.handAnchorR);

        this.feet = {
            left: this._createFoot(-1, 0),
            right: this._createFoot(1, 0.5),
        };
        // Gait clock. `strideClock` is one full stride per leg; the two legs read
        // it half a cycle apart, which is what makes the gait symmetric by
        // construction rather than by rescue logic.
        this.strideClock = 0;
        this.stepRate = MIN_STEP_RATE;
        this.stepLength = 0.2;
        this.dutyFactor = DUTY_WALK;
        this.runBlend = 0;
        this.gaitWeight = 0;
        this.surfaceVelocity = new THREE.Vector3();
        this.surfaceAcceleration = new THREE.Vector3();
        this.surfaceSpeed = 0;
        this.springs = {
            pelvisHeight: new Spring(RIG.pelvisHeight, 150),
            leanPitch: new Spring(0, 70),
            leanRoll: new Spring(0, 60),
            sway: new Spring(0, 110),
            gaitWeight: new Spring(0, 45),
        };
        this.pelvisYaw = 0;
        this.pelvisRoll = 0;
        this.lastStepped = 'right';
        this.swinging = null;
        this.initialized = false;
        this.wasGrounded = false;
        this.airTime = 0;
        this.gaitTime = 0;
        this.compression = 0;
        this.aimBlend = 0;
        this.aimDirectionLocal = new THREE.Vector3(0, 0, 1);
        this.aimDirectionTargetLocal = new THREE.Vector3(0, 0, 1);
        this.weaponDirectionLocal = new THREE.Vector3(0, 0, 1);
        this.weaponHandLocal = new THREE.Vector3();
        this.leftHandLocal = new THREE.Vector3();
        this.rightHandLocal = new THREE.Vector3();
        this.pelvisLocal = new THREE.Vector3(0, RIG.pelvisHeight, 0);
        this.chestLocal = new THREE.Vector3(0, RIG.chestHeight, 0);
        this.forwardLocal = new THREE.Vector3(0, 0, 1);
        this.rightLocal = new THREE.Vector3(1, 0, 0);
        this.torsoForwardLocal = new THREE.Vector3(0, 0, 1);
        this.torsoRightLocal = new THREE.Vector3(1, 0, 0);
        this.armLag = new THREE.Vector3();
        this.armLagVelocity = new THREE.Vector3();
        this.aimYawDelta = 0;
        this.aimPitch = 0;
        this.aimTime = 0;
        this.actionTime = 0;
        this.lastAction = false;
        this.visible = true;
        this._tmpA = new THREE.Vector3();
        this._tmpB = new THREE.Vector3();
        this._tmpC = new THREE.Vector3();
        this._invPlayerQuat = new THREE.Quaternion();
        this._handBasis = new THREE.Matrix4();
        this._handQuat = new THREE.Quaternion();
    }

    _createFoot(side, phaseOffset) {
        return {
            side,
            phaseOffset,
            phase: phaseOffset,
            stance: true,
            // Where the foot currently is, and the ground normal under it.
            worldPosition: new THREE.Vector3(),
            worldNormal: new THREE.Vector3(0, 1, 0),
            // Stance: the world point the foot is pinned to while the body passes.
            anchor: new THREE.Vector3(),
            anchorNormal: new THREE.Vector3(0, 1, 0),
            // Swing: where it left the ground and where it is predicted to land.
            liftoff: new THREE.Vector3(),
            liftoffNormal: new THREE.Vector3(0, 1, 0),
            target: new THREE.Vector3(),
            targetNormal: new THREE.Vector3(0, 1, 0),
            pitch: 0,
            // Kept for the systems that read a simple planted flag.
            planted: true,
            progress: 1,
        };
    }

    _surfaceSample(worldCandidate) {
        const planet = this.controller.getCurrentPlanet();
        if (!planet) {
            return { point: worldCandidate.clone(), normal: this.controller.getSurfaceNormal() };
        }
        const radial = worldCandidate.clone().sub(planet.center).normalize();
        const sample = SphericalUtils.sampleTerrainSurface(planet, radial, new THREE.Vector3(), new THREE.Vector3());
        return {
            point: sample.point.clone().addScaledVector(sample.normal, RIG.footHover),
            normal: sample.normal.clone(),
        };
    }

    // Surface velocity and acceleration in units per second, measured from actual
    // displacement. `player.vel` cannot be used: it is a per-frame value and the
    // controller advances the position by rather more than it each frame, so it
    // under-reports real motion by roughly half.
    _updateSurfaceVelocity(dt) {
        const pos = this.controller.state.player.pos;
        const normal = this.controller.getSurfaceNormal();
        if (!this._lastSurfacePos) {
            this._lastSurfacePos = pos.clone();
            return;
        }
        const delta = pos.clone().sub(this._lastSurfacePos);
        this._lastSurfacePos.copy(pos);
        if (delta.lengthSq() > TELEPORT_STEP * TELEPORT_STEP) {
            this.surfaceVelocity.set(0, 0, 0);
            this.surfaceAcceleration.set(0, 0, 0);
            this.surfaceSpeed = 0;
            return;
        }
        const instant = delta.projectOnPlane(normal).divideScalar(Math.max(dt, 1 / 240));
        const previous = this.surfaceVelocity.clone();
        this.surfaceVelocity.lerp(instant, expAlpha(16, dt));
        this.surfaceSpeed = this.surfaceVelocity.length();
        // Acceleration drives lean and bank, so it is smoothed harder than velocity;
        // raw frame-to-frame acceleration is far too noisy to pose a body from.
        const rawAccel = this.surfaceVelocity.clone().sub(previous).divideScalar(Math.max(dt, 1 / 240));
        this.surfaceAcceleration.lerp(rawAccel, expAlpha(7, dt));
    }

    // Unit vector along travel, falling back to facing when effectively stationary.
    _travelDirection(worldForward) {
        if (this.surfaceSpeed > 0.05) return this.surfaceVelocity.clone().divideScalar(this.surfaceSpeed);
        return worldForward.clone();
    }

    // How far the hip can reach horizontally at its current height. This shrinks as
    // the pelvis rises, which is why the crouch below matters for stride length.
    _horizontalReach() {
        const legMax = (RIG.upperLeg + RIG.lowerLeg) * LEG_SAFETY;
        const hipHeight = clamp(this.pelvisLocal.y, 0.30, legMax - 0.02);
        return Math.sqrt(Math.max(0.0025, legMax * legMax - hipHeight * hipHeight));
    }

    // Worst horizontal distance between a foot and the spot it would stand on if
    // the character were simply standing still here.
    _stanceError() {
        const playerPos = this.controller.state.player.pos;
        const worldUp = this.controller.getSurfaceNormal();
        const worldRight = this._localVectorToWorld(this.rightLocal, new THREE.Vector3()).normalize();
        let worst = 0;
        for (const foot of Object.values(this.feet)) {
            const neutral = playerPos.clone().addScaledVector(worldRight, foot.side * RIG.stanceWidth * 0.5);
            const offset = neutral.sub(foot.worldPosition).projectOnPlane(worldUp).length();
            worst = Math.max(worst, offset);
        }
        return worst;
    }

    // Derive cadence, step length and duty factor from speed, then advance the
    // stride clock. Everything downstream reads these instead of fixed constants.
    _updateGait(dt) {
        const legLength = RIG.upperLeg + RIG.lowerLeg;
        const speed = this.surfaceSpeed;
        const froude = (speed * speed) / (GRAVITY_G * legLength);
        this.runBlend = smoothstep01(clamp((froude - FROUDE_WALK) / (FROUDE_RUN - FROUDE_WALK), 0, 1));
        this.dutyFactor = lerp(DUTY_WALK, DUTY_RUN, this.runBlend);

        // Gait weight fades the whole cycle in and out, so starting and stopping
        // ease rather than snap. It is a spring, so it also overshoots slightly.
        //
        // Three things keep the clock alive, and all three matter: actual movement,
        // a foot standing somewhere it should not be, and a swing still in the air.
        // Without the second the character can be left standing on feet stranded
        // behind it with no way to recover, because a frozen clock never steps
        // again. Without the third, stopping can park a foot mid-swing.
        const stanceError = this._stanceError();
        const midSwing = !this.feet.left.stance || !this.feet.right.stance;
        const wantsToWalk = (speed > MOVE_THRESHOLD || stanceError > STANCE_TOLERANCE || midSwing) ? 1 : 0;
        this.gaitWeight = this.springs.gaitWeight.update(wantsToWalk, dt);

        const reach = this._horizontalReach();
        const natural = STEP_LENGTH_K * legLength * Math.pow(Math.max(froude, 1e-4), STEP_LENGTH_EXP);
        // The furthest the hip may sit from a planted foot is `duty * stepLength`, so
        // that — not the raw step length — is what reach has to bound.
        const maxStep = reach * STANCE_REACH_USE / Math.max(this.dutyFactor, 0.3);
        this.stepLength = clamp(natural, 0.10, maxStep);
        this.stepRate = clamp(speed / Math.max(this.stepLength, 1e-3), MIN_STEP_RATE, MAX_STEP_RATE);
        // Re-derive the length from the clamped rate so placement and clock agree;
        // if they disagree the foot slides against the ground during stance.
        // Respect reach even after re-deriving: if the body outruns what the legs can
        // straddle at maximum cadence, the stride caps and the shortfall shows as a
        // little slide, which is far better than planting a foot out of reach.
        if (speed > MOVE_THRESHOLD) this.stepLength = Math.min(speed / this.stepRate, maxStep);

        // Two steps per stride, so the clock runs at half the step rate.
        const strideRate = (this.stepRate * 0.5) * clamp(this.gaitWeight, 0, 1);
        this.strideClock = (this.strideClock + strideRate * dt) % 1;
        for (const foot of Object.values(this.feet)) {
            foot.phase = (this.strideClock + foot.phaseOffset) % 1;
        }
    }

    // Predicted touchdown for a swinging foot, refreshed every frame so that a
    // change of direction, a change of speed or a slope is picked up mid-swing.
    _touchdownTarget(foot, timeToLand, worldForward, worldRight) {
        const playerPos = this.controller.state.player.pos;
        const travel = this._travelDirection(worldForward);
        // Land half a step in front of where the body will be, so the foot spends
        // stance travelling from half a step ahead to half a step behind.
        // The body travels `2 * duty * stepLength` across one stance, so landing a
        // duty-share of a step in front puts the foot symmetrically ahead of and then
        // behind the hip. Half a step would be right only for a duty of exactly 0.5.
        const lead = this.dutyFactor * this.stepLength * this.gaitWeight;
        const ahead = this.surfaceSpeed * timeToLand + lead;
        const width = RIG.stanceWidth * 0.5 * lerp(1, STANCE_NARROW, this.runBlend);
        const candidate = playerPos.clone()
            .addScaledVector(travel, ahead)
            .addScaledVector(worldRight, foot.side * width);
        return this._surfaceSample(candidate);
    }

    // Sole pitch in radians, positive = toe down / heel up. Held flat, a foot reads
    // as dragged; rolling it heel-strike -> flat -> heel-off -> toe-off is most of
    // what separates a walk cycle from a slide.
    _footPitchTarget(foot) {
        const duty = this.dutyFactor;
        if (foot.stance) {
            const sp = clamp(foot.phase / Math.max(duty, EPS), 0, 1);
            // Toe up on contact, flat through midstance, heel climbing to toe-off.
            const strike = -HEEL_STRIKE_PITCH * (1 - smoothstep01(clamp(sp / 0.18, 0, 1)));
            const heelOff = TOE_OFF_PITCH * smoothstep01(clamp((sp - 0.55) / 0.45, 0, 1));
            return strike + heelOff;
        }
        const t = clamp((foot.phase - duty) / Math.max(1 - duty, EPS), 0, 1);
        // Carry the push-off through, then swing the toe up to meet the ground.
        const carry = TOE_OFF_PITCH * (1 - smoothstep01(clamp(t / 0.4, 0, 1)));
        const reachOut = HEEL_STRIKE_PITCH * smoothstep01(clamp((t - 0.45) / 0.55, 0, 1));
        return carry - reachOut;
    }

    // Tilt the sole's up-vector toward travel, which pitches the toe down; negative
    // brings the toe up.
    _pitchedFootNormal(normal, forward, pitch) {
        const lateral = new THREE.Vector3().crossVectors(normal, forward);
        if (lateral.lengthSq() < EPS) return normal;
        return normal.clone().applyAxisAngle(lateral.normalize(), pitch).normalize();
    }

    // Hard guarantee that a leg is never drawn longer than a leg. _solveTwoBone
    // clamps only the distance it uses to place the knee, so without this the shin
    // is drawn all the way out to an unreachable foot.
    _clampFootToReach(hip, foot) {
        const legMax = (RIG.upperLeg + RIG.lowerLeg) * LEG_SAFETY;
        const delta = foot.clone().sub(hip);
        const distance = delta.length();
        if (distance <= legMax || distance < EPS) return foot;
        return hip.clone().addScaledVector(delta.divideScalar(distance), legMax);
    }

    _worldVectorToLocal(vector, target = new THREE.Vector3()) {
        this.controller.playerGroup.getWorldQuaternion(this._invPlayerQuat).invert();
        return target.copy(vector).applyQuaternion(this._invPlayerQuat);
    }

    _worldPointToLocal(point, target = new THREE.Vector3()) {
        return this.controller.playerGroup.worldToLocal(target.copy(point));
    }

    _localVectorToWorld(vector, target = new THREE.Vector3()) {
        this.controller.playerGroup.getWorldQuaternion(this._invPlayerQuat);
        return target.copy(vector).applyQuaternion(this._invPlayerQuat);
    }

    initialize() {
        const playerPos = this.controller.state.player.pos;
        this._updateBasis();
        const worldForward = this._localVectorToWorld(this.forwardLocal, new THREE.Vector3()).normalize();
        const worldRight = this._localVectorToWorld(this.rightLocal, new THREE.Vector3()).normalize();
        for (const foot of Object.values(this.feet)) {
            const candidate = playerPos.clone()
                .addScaledVector(worldRight, foot.side * RIG.stanceWidth * 0.5)
                .addScaledVector(worldForward, 0.02);
            const hit = this._surfaceSample(candidate);
            foot.worldPosition.copy(hit.point);
            foot.anchor.copy(hit.point);
            foot.liftoff.copy(hit.point);
            foot.target.copy(hit.point);
            foot.worldNormal.copy(hit.normal);
            foot.anchorNormal.copy(hit.normal);
            foot.liftoffNormal.copy(hit.normal);
            foot.targetNormal.copy(hit.normal);
            foot.stance = true;
            foot.planted = true;
            foot.pitch = 0;
        }
        this.springs.pelvisHeight.reset(RIG.pelvisHeight);
        this.strideClock = 0;
        this.initialized = true;
        this.wasGrounded = this.controller.state.player.onGround;
    }

    setVisible(visible) {
        this.visible = visible;
        // Keep the right-hand anchor and held item available in first person.
        for (const child of this.root.children) {
            if (child === this.handAnchorR) continue;
            child.visible = visible;
        }
        this.handAnchorR.visible = true;
    }

    _updateBasis() {
        const yaw = this.controller.state.player.targetRotation || 0;
        this.forwardLocal.set(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
        this.rightLocal.set(Math.cos(yaw), 0, -Math.sin(yaw)).normalize();
    }

    update(dt) {
        if (!this.initialized) this.initialize();
        const state = this.controller.state;
        const player = state.player;
        const equipped = !!state.breachEquipped;
        const activelyAiming = !!state.breachAiming;
        this.aimTime += dt;
        this._updateBasis();
        this._updateSurfaceVelocity(dt);

        const cameraDirWorld = new THREE.Vector3();
        this.world.camera.getWorldDirection(cameraDirWorld);
        this._worldVectorToLocal(cameraDirWorld, this.aimDirectionTargetLocal).normalize();
        this.aimDirectionLocal.lerp(this.aimDirectionTargetLocal, expAlpha(activelyAiming ? 25 : 16, dt)).normalize();
        const aimTarget = activelyAiming ? 1 : (equipped ? 0.18 : 0);
        this.aimBlend = lerp(this.aimBlend, aimTarget, expAlpha(activelyAiming ? 17 : 9, dt));

        const flatAim = this.aimDirectionLocal.clone().setY(0);
        if (flatAim.lengthSq() < EPS) flatAim.copy(this.forwardLocal);
        else flatAim.normalize();
        const bodyYaw = Math.atan2(this.forwardLocal.x, this.forwardLocal.z);
        const aimYaw = Math.atan2(flatAim.x, flatAim.z);
        this.aimYawDelta = THREE.MathUtils.euclideanModulo(aimYaw - bodyYaw + Math.PI, Math.PI * 2) - Math.PI;
        this.aimPitch = Math.asin(clamp(this.aimDirectionLocal.y, -1, 1));
        // Aim twist plus the gait's own torso counter-rotation against the pelvis.
        const torsoTwist = clamp(this.aimYawDelta, -1.78, 1.78) * this.aimBlend * 0.46
            + (this.gaitTorsoYaw || 0);
        this.torsoForwardLocal.copy(this.forwardLocal).applyAxisAngle(UP, torsoTwist).normalize();
        this.torsoRightLocal.set(this.torsoForwardLocal.z, 0, -this.torsoForwardLocal.x).normalize();

        // speed01 is normalised against a real sprint, measured from displacement,
        // not from the per-frame `player.vel` which under-reports actual motion.
        const tangentVelocity = this.surfaceVelocity.clone();
        const speed01 = clamp(this.surfaceSpeed / RUN_SPEED_REF, 0, 1);
        const moving = this.surfaceSpeed > MOVE_THRESHOLD;
        // The gait clock now drives the cycle; gaitTime only feeds decorative motion.
        this.gaitTime += dt * lerp(4.0, 10.6, speed01);
        this.airTime = player.onGround ? 0 : this.airTime + dt;

        const accelWorld = this.controller.accelerationVector || new THREE.Vector3();
        const accelLocal = this._worldVectorToLocal(accelWorld, new THREE.Vector3());
        const forwardAccel = accelLocal.dot(this.forwardLocal);
        const sideAccel = accelLocal.dot(this.rightLocal);
        const lagTarget = this.forwardLocal.clone().multiplyScalar(clamp(-forwardAccel * 0.012, -0.12, 0.12))
            .addScaledVector(this.rightLocal, clamp(-sideAccel * 0.014, -0.14, 0.14));
        this.armLagVelocity.addScaledVector(lagTarget.clone().sub(this.armLag), 55 * dt);
        this.armLagVelocity.multiplyScalar(Math.exp(-10.5 * dt));
        this.armLag.addScaledVector(this.armLagVelocity, dt);

        // Gait parameters are derived before the feet are solved and regardless of
        // ground contact: a run is mostly airborne by definition (see DUTY_RUN), so
        // deriving them inside the grounded branch froze them mid-sprint.
        this._updateGait(dt);
        this._updateFeet(dt, tangentVelocity, speed01, moving);
        this._updateBody(dt, accelLocal, speed01);
        this._solveAndRender(dt, speed01, activelyAiming);
        this.compression *= Math.exp(-dt * 10.5);
        this.wasGrounded = player.onGround;
    }

    _updateFeet(dt, tangentVelocityWorld, speed01, moving) {
        const player = this.controller.state.player;
        const playerPos = player.pos;
        const worldForward = this._localVectorToWorld(this.forwardLocal, new THREE.Vector3()).normalize();
        const worldRight = this._localVectorToWorld(this.rightLocal, new THREE.Vector3()).normalize();
        const worldUp = this.controller.getGroundNormal?.() || this.controller.getSurfaceNormal();

        // A genuine fall gets a tuck pose. Brief airborne moments do NOT: at running
        // speeds the duty factor puts the body in the air for most of every step, and
        // treating that as falling replaces the run with a flail.
        if (!player.onGround && this.airTime > FALL_POSE_DELAY) {
            this.swinging = null;
            const radialVelocity = player.vel.dot(worldUp);
            const rising = Math.max(0, radialVelocity);
            for (const foot of Object.values(this.feet)) {
                const cycle = Math.sin(this.airTime * 7.4 + foot.side * 1.45);
                const target = playerPos.clone()
                    .addScaledVector(worldRight, foot.side * RIG.stanceWidth * 0.42)
                    .addScaledVector(worldForward, -0.10 + cycle * 0.075)
                    .addScaledVector(worldUp, 0.14 + rising * 0.18 + Math.abs(cycle) * 0.04);
                foot.worldPosition.lerp(target, expAlpha(14, dt));
                foot.worldNormal.lerp(worldUp, expAlpha(10, dt)).normalize();
                foot.anchor.copy(foot.worldPosition);
                foot.anchorNormal.copy(foot.worldNormal);
                foot.target.copy(foot.worldPosition);
                foot.stance = false;
                foot.planted = false;
                foot.pitch = lerp(foot.pitch, -0.12, expAlpha(8, dt));
            }
            return;
        }

        // Landing: re-anchor both feet under the body and absorb the impact, rather
        // than letting them catch up from wherever the fall pose left them.
        if (!this.wasGrounded && this.airTime > FALL_POSE_DELAY) {
            for (const foot of Object.values(this.feet)) {
                const hit = this._surfaceSample(
                    playerPos.clone().addScaledVector(worldRight, foot.side * RIG.stanceWidth * 0.5),
                );
                foot.worldPosition.copy(hit.point);
                foot.anchor.copy(hit.point);
                foot.liftoff.copy(hit.point);
                foot.target.copy(hit.point);
                foot.worldNormal.copy(hit.normal);
                foot.anchorNormal.copy(hit.normal);
                foot.liftoffNormal.copy(hit.normal);
                foot.targetNormal.copy(hit.normal);
                foot.stance = true;
                foot.planted = true;
            }
            this.compression = Math.max(this.compression, 0.13);
            this.controller._landingKick = Math.max(this.controller._landingKick || 0, 0.14);
        }

        const duty = this.dutyFactor;
        const swingLift = lerp(SWING_LIFT_WALK, SWING_LIFT_RUN, this.runBlend);

        for (const [name, foot] of Object.entries(this.feet)) {
            const inStance = foot.phase < duty;
            const wasStance = foot.stance;

            if (inStance && !wasStance) {
                // Touchdown. Commit the predicted target as the stance anchor: from
                // here the foot is pinned to the world and the body travels over it.
                foot.anchor.copy(foot.target);
                foot.anchorNormal.copy(foot.targetNormal);
                this.compression = Math.max(this.compression, lerp(0.028, 0.075, this.runBlend));
                this.controller.onProceduralFootstep?.(
                    foot.anchor.clone(), foot.anchorNormal.clone(), clamp(this.surfaceSpeed / RUN_SPEED_REF, 0, 1),
                );
                this.lastStepped = name;
            } else if (!inStance && wasStance) {
                // Toe-off. Remember where the foot left so the swing arc starts there.
                foot.liftoff.copy(foot.worldPosition);
                foot.liftoffNormal.copy(foot.worldNormal);
                this.swinging = name;
            }
            foot.stance = inStance;
            foot.planted = inStance;

            if (inStance && player.onGround) {
                foot.progress = 1;
                // Pinned. Re-sampling the anchor's ground height keeps the foot on the
                // surface if the terrain under it is not perfectly static.
                const ground = this._surfaceSample(foot.anchor);
                foot.anchor.copy(ground.point);
                foot.anchorNormal.copy(ground.normal);
                foot.worldPosition.copy(foot.anchor);
                foot.worldNormal.lerp(foot.anchorNormal, expAlpha(18, dt)).normalize();
            } else if (inStance) {
                // Stance phase with no ground beneath it: the flight part of a run.
                // The foot reaches for where it is about to land instead of dragging
                // an anchor the body has already left behind.
                foot.progress = 1;
                const aim = this._touchdownTarget(foot, 0, worldForward, worldRight);
                foot.target.lerp(aim.point, expAlpha(16, dt));
                foot.targetNormal.lerp(aim.normal, expAlpha(16, dt)).normalize();
                foot.anchor.copy(foot.target);
                foot.anchorNormal.copy(foot.targetNormal);
                foot.worldPosition.lerp(foot.target, expAlpha(16, dt));
                foot.worldNormal.lerp(foot.targetNormal, expAlpha(12, dt)).normalize();
            } else {
                const t = clamp((foot.phase - duty) / Math.max(1 - duty, EPS), 0, 1);
                foot.progress = t;
                const strideRate = Math.max(this.stepRate * 0.5, 1e-3);
                const aim = this._touchdownTarget(foot, (1 - foot.phase) / strideRate, worldForward, worldRight);
                // Converge hard near touchdown: a lagging target lands the foot short
                // of its lead, which biases the whole stance behind the hip.
                const converge = lerp(18, 40, smoothstep01(clamp((t - 0.5) / 0.5, 0, 1)));
                // Ease the target rather than snapping to it, so a direction change
                // bends the swing instead of teleporting the foot.
                foot.target.lerp(aim.point, expAlpha(converge, dt));
                foot.targetNormal.lerp(aim.normal, expAlpha(converge, dt)).normalize();

                // Horizontal travel eases out of toe-off and into touchdown; the
                // vertical profile peaks before mid-swing so the foot lifts sharply
                // and lands softly, which is what stops it looking like a pendulum.
                const ease = smoothstep01(t);
                foot.worldPosition.copy(foot.liftoff).lerp(foot.target, ease);
                const arc = Math.sin(Math.PI * Math.pow(t, 0.82)) * swingLift;
                foot.worldPosition.addScaledVector(worldUp, arc);

                // Terrain adaptation: never let the swing pass through a rise.
                const over = this._surfaceSample(foot.worldPosition);
                const above = foot.worldPosition.clone().sub(over.point).dot(over.normal);
                const clearance = TOE_CLEARANCE * Math.sin(Math.PI * t);
                if (above < clearance) {
                    foot.worldPosition.addScaledVector(over.normal, clearance - above);
                }
                foot.worldNormal.lerp(
                    foot.liftoffNormal.clone().lerp(foot.targetNormal, ease).normalize(),
                    expAlpha(14, dt),
                ).normalize();
            }

            foot.pitch = lerp(foot.pitch, this._footPitchTarget(foot) * this.gaitWeight, expAlpha(18, dt));
        }
    }

    _updateBody(dt, accelLocal, speed01) {
        const supportFoot = this.feet.left.stance
            ? (this.feet.right.stance
                ? (this.feet.left.phase > this.feet.right.phase ? this.feet.left : this.feet.right)
                : this.feet.left)
            : this.feet.right;
        const supportLocal = this._worldPointToLocal(supportFoot.worldPosition, new THREE.Vector3());
        const gait = clamp(this.gaitWeight, 0, 1);

        // Two oscillations per stride: the centre of mass rises over each midstance
        // and dips through the double-support hand-off. This is the single strongest
        // cue that a body has weight, and it must come from the gait clock, not a
        // free-running sine, or it drifts out of step with the feet.
        const bobPhase = Math.cos(4 * Math.PI * this.strideClock);
        const bob = -bobPhase * COM_BOB * gait;
        const crouch = clamp(this.surfaceSpeed / RUN_SPEED_REF, 0, 1) * RUN_CROUCH;

        // Stand off the supporting foot rather than the average of both, so uneven
        // ground lifts the body instead of sinking it half way into the slope.
        const standHeight = supportLocal.y + RIG.pelvisHeight - crouch + bob - this.compression;
        const pelvisY = this.springs.pelvisHeight.update(clamp(standHeight, 0.42, 0.86), dt);

        // Lateral shift toward the support leg, and the pelvic drop toward the
        // unsupported side that gives a walk its roll.
        // Toward the support foot: you shift your weight over the leg you are standing
        // on. The opposite sign lurches the body away from its own support each step.
        const swayTarget = supportFoot.side * COM_SWAY * gait;
        const sway = this.springs.sway.update(swayTarget, dt);
        this.pelvisRoll = -Math.sin(2 * Math.PI * this.strideClock) * PELVIS_ROLL * gait;
        this.pelvisYaw = Math.sin(2 * Math.PI * this.strideClock) * PELVIS_YAW * gait * lerp(0.5, 1, this.runBlend);

        const forwardAccel = this.surfaceAcceleration.dot(
            this._localVectorToWorld(this.forwardLocal, new THREE.Vector3()).normalize(),
        );
        const lateralAccel = this.surfaceAcceleration.dot(
            this._localVectorToWorld(this.rightLocal, new THREE.Vector3()).normalize(),
        );
        // Lean into speed and into acceleration, and bank into a turn. Springs mean
        // the body arrives late and settles, which is the lag that sells momentum.
        const leanTarget = clamp(this.surfaceSpeed / RUN_SPEED_REF, 0, 1) * LEAN_SPEED
            + clamp(forwardAccel * LEAN_ACCEL, -0.12, 0.14);
        const bankTarget = clamp(-lateralAccel * LEAN_BANK, -0.16, 0.16);
        const leanPitch = this.springs.leanPitch.update(leanTarget, dt);
        const leanRoll = this.springs.leanRoll.update(bankTarget, dt);
        this.leanPitch = leanPitch;
        this.leanRoll = leanRoll;

        this.pelvisLocal.set(0, pelvisY, 0)
            .addScaledVector(this.rightLocal, sway)
            .addScaledVector(this.forwardLocal, leanPitch * 0.12);

        // Torso counter-rotates against the pelvis, which is what stops a walk
        // looking like a shop mannequin sliding forward.
        this.gaitTorsoYaw = -this.pelvisYaw * TORSO_COUNTER;

        const aimSidePull = Math.sin(clamp(this.aimYawDelta, -1.55, 1.55)) * 0.095 * this.aimBlend;
        const aimLift = clamp(this.aimPitch, -0.95, 0.95) * 0.067 * this.aimBlend;
        const breathing = Math.sin(this.aimTime * 6.7) * 0.009 * this.aimBlend;
        // The chest also counter-bobs slightly: the spine absorbs some of the
        // pelvis oscillation instead of transmitting all of it to the head.
        const chestTarget = this.pelvisLocal.clone()
            .addScaledVector(UP, 0.47 + aimLift + breathing - bob * 0.35)
            .addScaledVector(this.forwardLocal, leanPitch * 0.55)
            .addScaledVector(this.rightLocal, leanRoll * 0.6)
            .addScaledVector(this.torsoRightLocal, aimSidePull)
            .addScaledVector(this.torsoForwardLocal, 0.028 * this.aimBlend);
        this.chestLocal.lerp(chestTarget, expAlpha(15, dt));
    }

    _solveTwoBone(a, b, bendGuide, upper, lower) {
        const toB = b.clone().sub(a);
        const distance = clamp(toB.length(), Math.abs(upper - lower) + 0.008, upper + lower - 0.01);
        const direction = toB.normalize();
        const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
        const height = Math.sqrt(Math.max(0, upper * upper - along * along));
        const bend = bendGuide.clone().projectOnPlane(direction);
        if (bend.lengthSq() < EPS) bend.copy(this.rightLocal).projectOnPlane(direction);
        bend.normalize();
        return a.clone().addScaledVector(direction, along).addScaledVector(bend, height);
    }

    _setOrientedBox(mesh, position, normal, forward, smoothing = 0.48) {
        const projectedForward = forward.clone().projectOnPlane(normal);
        if (projectedForward.lengthSq() < EPS) projectedForward.set(0, 0, 1);
        else projectedForward.normalize();
        const right = new THREE.Vector3().crossVectors(normal, projectedForward).normalize();
        const basis = new THREE.Matrix4().makeBasis(right, normal, projectedForward);
        const targetQ = new THREE.Quaternion().setFromRotationMatrix(basis);
        mesh.position.copy(position);
        mesh.quaternion.slerp(targetQ, smoothing);
    }

    _solveAndRender(dt, speed01, activelyAiming) {
        const leftFoot = this._worldPointToLocal(this.feet.left.worldPosition, new THREE.Vector3());
        const rightFoot = this._worldPointToLocal(this.feet.right.worldPosition, new THREE.Vector3());
        const leftFootNormal = this._worldVectorToLocal(this.feet.left.worldNormal, new THREE.Vector3()).normalize();
        const rightFootNormal = this._worldVectorToLocal(this.feet.right.worldNormal, new THREE.Vector3()).normalize();

        const pelvis = this.pelvisLocal;
        const chest = this.chestLocal;
        // The hip axis carries the pelvis's own rotation: yaw with the stride and
        // drop toward the unsupported side. Rotating the axis rather than the whole
        // body is what lets the legs inherit pelvic motion while the feet stay put.
        const hipAxis = this.rightLocal.clone()
            .applyAxisAngle(UP, this.pelvisYaw)
            .applyAxisAngle(this.forwardLocal, this.pelvisRoll)
            .normalize();
        const leftHip = pelvis.clone().addScaledVector(hipAxis, -0.145);
        const rightHip = pelvis.clone().addScaledVector(hipAxis, 0.145);

        // The gait solved each sole's pitch; lift the ankle with it so the roll
        // pivots about the toe (or the heel on touchdown) instead of the middle of
        // the foot, which would rotate the foot through the ground.
        const leftPitch = this.feet.left.pitch;
        const rightPitch = this.feet.right.pitch;
        const pivotLift = pitch => FOOT_HALF_LENGTH * Math.abs(Math.sin(pitch));
        leftFoot.addScaledVector(UP, pivotLift(leftPitch));
        rightFoot.addScaledVector(UP, pivotLift(rightPitch));

        // Solve and draw against reach-clamped feet so the shin can never stretch,
        // whatever the gait, frame rate or planet does. With the speed-aware
        // cadence below this clamp should only engage on landings and teleports.
        const leftAnkle = this._clampFootToReach(leftHip, leftFoot);
        const rightAnkle = this._clampFootToReach(rightHip, rightFoot);
        const leftKnee = this._solveTwoBone(leftHip, leftAnkle, this.forwardLocal.clone().addScaledVector(this.rightLocal, -0.12), RIG.upperLeg, RIG.lowerLeg);
        const rightKnee = this._solveTwoBone(rightHip, rightAnkle, this.forwardLocal.clone().addScaledVector(this.rightLocal, 0.12), RIG.upperLeg, RIG.lowerLeg);
        this.segments.leftThigh.set(leftHip, leftKnee, 0.09);
        this.segments.leftShin.set(leftKnee, leftAnkle, 0.073);
        this.segments.rightThigh.set(rightHip, rightKnee, 0.09);
        this.segments.rightShin.set(rightKnee, rightAnkle, 0.073);
        this.leftKnee.position.copy(leftKnee);
        this.rightKnee.position.copy(rightKnee);
        this._setOrientedBox(this.leftFootMesh, leftAnkle, this._pitchedFootNormal(leftFootNormal, this.forwardLocal, leftPitch), this.forwardLocal);
        this._setOrientedBox(this.rightFootMesh, rightAnkle, this._pitchedFootNormal(rightFootNormal, this.forwardLocal, rightPitch), this.forwardLocal);

        this._setOrientedBox(this.pelvisMesh, pelvis, UP, this.forwardLocal);
        this._setOrientedBox(this.chestMesh, chest, UP, this.torsoForwardLocal);
        this.segments.spine.set(pelvis.clone().addScaledVector(UP, 0.08), chest.clone().addScaledVector(UP, -0.08), 0.14);

        const neckBase = chest.clone().addScaledVector(UP, 0.22);
        const head = neckBase.clone().addScaledVector(UP, 0.22)
            .addScaledVector(this.torsoForwardLocal, 0.025)
            .addScaledVector(this.aimDirectionLocal, 0.045 * this.aimBlend);
        this.segments.neck.set(neckBase, head.clone().addScaledVector(UP, -0.12), 0.065);
        this.headMesh.position.copy(head);
        // Gaze stabilisation: the head cancels most of the torso's gait rotation, the
        // way a real walker keeps their eyes on the horizon while the shoulders swing.
        const headForward = this.torsoForwardLocal.clone()
            .applyAxisAngle(UP, -(this.gaitTorsoYaw || 0) * HEAD_STABILISE)
            .lerp(this.aimDirectionLocal, this.aimBlend * 0.72).normalize();
        this._setOrientedBox(this.headMesh, head, UP, headForward, 0.34);
        const eyeRight = new THREE.Vector3(headForward.z, 0, -headForward.x).normalize();
        const eyeUp = new THREE.Vector3().crossVectors(eyeRight, headForward).normalize();
        this.eyeL.position.copy(head).addScaledVector(eyeRight, -0.067).addScaledVector(eyeUp, 0.025).addScaledVector(headForward, 0.17);
        this.eyeR.position.copy(head).addScaledVector(eyeRight, 0.067).addScaledVector(eyeUp, 0.025).addScaledVector(headForward, 0.17);

        const shoulderL = chest.clone().addScaledVector(this.torsoRightLocal, -0.325).addScaledVector(UP, 0.075);
        const behindAmount = smoothstep01(clamp((Math.abs(this.aimYawDelta) - 1.15) / 1.45, 0, 1));
        const shoulderR = chest.clone()
            .addScaledVector(this.torsoRightLocal, 0.325 - behindAmount * 0.12)
            .addScaledVector(UP, 0.075 + clamp(this.aimPitch, -1.3, 1.3) * 0.035 * this.aimBlend)
            .addScaledVector(this.aimDirectionLocal, (0.04 + behindAmount * 0.035) * this.aimBlend);

        const leftFootDrive = leftFoot.clone().sub(pelvis).dot(this.forwardLocal);
        const rightFootDrive = rightFoot.clone().sub(pelvis).dot(this.forwardLocal);
        // Arm swing rides the gait clock, not a free-running sine, so it cannot drift
        // out of phase with the feet. Arms lead the opposite leg by half a cycle.
        const armPhase = 2 * Math.PI * this.strideClock;
        const gaitAmp = clamp(this.gaitWeight, 0, 1);
        const strideSwing = Math.sin(armPhase) * (0.06 + speed01 * 0.26) * gaitAmp;
        const verticalSwing = Math.cos(armPhase * 2) * speed01 * 0.026 * gaitAmp;
        const leftDrive = clamp(rightFootDrive * 0.68 + strideSwing, -0.40, 0.40) * (0.50 + speed01 * 0.58);
        const rightDrive = clamp(leftFootDrive * 0.68 - strideSwing, -0.40, 0.40) * (0.50 + speed01 * 0.58);
        const looseSide = Math.sin(armPhase * 0.5) * speed01 * 0.038 * gaitAmp;

        let idleLeftHand = shoulderL.clone()
            .addScaledVector(UP, -0.48 + verticalSwing)
            .addScaledVector(this.forwardLocal, leftDrive)
            .addScaledVector(this.rightLocal, -0.06 - looseSide)
            .add(this.armLag.clone().multiplyScalar(1.08));
        let idleRightHand = shoulderR.clone()
            .addScaledVector(UP, -0.47 - verticalSwing)
            .addScaledVector(this.forwardLocal, rightDrive)
            .addScaledVector(this.rightLocal, 0.06 + looseSide)
            .add(this.armLag.clone().multiplyScalar(0.92));

        const actionActive = !!this.controller.state.isAttacking || !!this.controller.chopAnimState?.isSwinging;
        if (actionActive && !this.lastAction) this.actionTime = 0;
        this.lastAction = actionActive;
        if (actionActive) this.actionTime += dt;
        const visualTimer = this.controller.state._attackVisualTimer || 0;
        const attackDuration = 0.42;
        let actionProgress = visualTimer > 0 ? clamp(visualTimer / attackDuration, 0, 1) : clamp(this.actionTime / 0.42, 0, 1);
        if (this.controller.chopAnimState?.isSwinging) actionProgress = clamp(1 - this.controller.chopAnimState.swingProgress, 0, 1);
        if (actionActive) {
            const wind = clamp(actionProgress / 0.35, 0, 1);
            const strike = clamp((actionProgress - 0.28) / 0.55, 0, 1);
            const recover = clamp((actionProgress - 0.80) / 0.20, 0, 1);
            const arc = Math.sin(strike * Math.PI);
            idleRightHand = shoulderR.clone()
                .addScaledVector(this.forwardLocal, lerp(-0.20, 0.52, strike) * (1 - recover))
                .addScaledVector(UP, lerp(0.39, -0.24, strike) + wind * 0.16)
                .addScaledVector(this.rightLocal, 0.10 + arc * 0.08);
            idleLeftHand = shoulderL.clone()
                .addScaledVector(this.forwardLocal, -0.16 + strike * 0.20)
                .addScaledVector(UP, -0.30 + arc * 0.12)
                .addScaledVector(this.rightLocal, -0.11);
        }

        const aimDir = this.aimDirectionLocal.clone().normalize();
        let aimRight = new THREE.Vector3().crossVectors(aimDir, UP);
        if (aimRight.lengthSq() < EPS) aimRight.copy(this.rightLocal);
        aimRight.normalize();
        const aimUp = new THREE.Vector3().crossVectors(aimRight, aimDir).normalize();
        const charge = clamp(this.controller.state.breachCharge || 0, 0, 1);
        const recoil = clamp(this.controller.weaponRecoil || 0, -1.25, 1.25);
        const extension = 0.58 + charge * 0.085 + behindAmount * 0.03;
        const kinetic = (0.055 - charge * 0.024) * this.aimBlend;
        const orbit = Math.sin(this.aimTime * 8.6 + this.aimYawDelta * 1.65);
        const counterOrbit = Math.cos(this.aimTime * 6.0 - this.aimPitch * 2.1);
        const recoilLoose = Math.abs(recoil) * Math.sin(this.aimTime * 23 + this.aimYawDelta);
        const aimedRightHand = shoulderR.clone()
            .addScaledVector(aimDir, extension - recoil * 0.17)
            .addScaledVector(aimRight, 0.025 + orbit * kinetic + recoilLoose * 0.058)
            .addScaledVector(aimUp, -0.018 + counterOrbit * kinetic * 0.72 + Math.abs(recoil) * 0.10)
            .add(this.armLag.clone().multiplyScalar(0.30 + speed01 * 0.18));
        const aimedLeftHand = aimedRightHand.clone()
            .addScaledVector(aimDir, 0.30)
            .addScaledVector(aimRight, -0.055)
            .addScaledVector(aimUp, 0.015 + Math.sin(this.aimTime * 7.3) * 0.012);

        const rightHand = idleRightHand.clone().lerp(aimedRightHand, this.aimBlend);
        const leftHand = idleLeftHand.clone().lerp(aimedLeftHand, this.aimBlend * 0.93);
        const rightElbowGuide = aimRight.clone().multiplyScalar(0.72).addScaledVector(aimUp, -0.42)
            .lerp(this.forwardLocal.clone().multiplyScalar(-0.35).addScaledVector(this.rightLocal, 0.42).addScaledVector(UP, -0.30), 1 - this.aimBlend);
        const leftElbowGuide = aimRight.clone().multiplyScalar(-0.58).addScaledVector(aimUp, -0.34)
            .lerp(this.forwardLocal.clone().multiplyScalar(-0.32).addScaledVector(this.rightLocal, -0.40).addScaledVector(UP, -0.28), 1 - this.aimBlend);
        const rightElbow = this._solveTwoBone(shoulderR, rightHand, rightElbowGuide, RIG.upperArm, RIG.lowerArm);
        const leftElbow = this._solveTwoBone(shoulderL, leftHand, leftElbowGuide, RIG.upperArm, RIG.lowerArm);

        this.segments.leftUpperArm.set(shoulderL, leftElbow, 0.066);
        this.segments.leftForearm.set(leftElbow, leftHand, 0.057);
        this.segments.rightUpperArm.set(shoulderR, rightElbow, 0.069);
        this.segments.rightForearm.set(rightElbow, rightHand, 0.059);
        this.leftElbow.position.copy(leftElbow);
        this.rightElbow.position.copy(rightElbow);
        this.leftHandMesh.position.copy(leftHand);
        this.rightHandMesh.position.copy(rightHand);
        this.leftHandLocal.copy(leftHand);
        this.rightHandLocal.copy(rightHand);
        this.weaponHandLocal.copy(rightHand);
        const restingDirection = rightHand.clone().sub(rightElbow).normalize();
        this.weaponDirectionLocal.copy(restingDirection).lerp(aimDir, this.aimBlend).normalize();

        this._updateHandAnchor(this.handAnchorR, rightHand, this.weaponDirectionLocal, aimUp);
        this._updateHandAnchor(this.handAnchorL, leftHand, leftHand.clone().sub(leftElbow).normalize(), aimUp);
    }

    _updateHandAnchor(anchor, position, forward, upHint) {
        let right = new THREE.Vector3().crossVectors(upHint || UP, forward);
        if (right.lengthSq() < EPS) right = new THREE.Vector3().crossVectors(UP, forward);
        if (right.lengthSq() < EPS) right.copy(this.rightLocal);
        right.normalize();
        const up = new THREE.Vector3().crossVectors(forward, right).normalize();
        this._handBasis.makeBasis(right, up, forward);
        this._handQuat.setFromRotationMatrix(this._handBasis);
        anchor.position.copy(position);
        anchor.quaternion.slerp(this._handQuat, 0.52);
    }


    setSeated(active) {
        if (!active) {
            this.initialized = false;
            this.root.position.y = 0;
            return;
        }
        this.root.position.y = -0.18;
        const pelvis = new THREE.Vector3(0, 0.62, -0.04);
        const chest = new THREE.Vector3(0, 1.04, 0.01);
        const leftHip = pelvis.clone().add(new THREE.Vector3(-0.145, 0, 0));
        const rightHip = pelvis.clone().add(new THREE.Vector3(0.145, 0, 0));
        const leftKnee = new THREE.Vector3(-0.16, 0.46, 0.34);
        const rightKnee = new THREE.Vector3(0.16, 0.46, 0.34);
        const leftFoot = new THREE.Vector3(-0.17, 0.28, 0.63);
        const rightFoot = new THREE.Vector3(0.17, 0.28, 0.63);
        this.segments.leftThigh.set(leftHip, leftKnee, 0.09);
        this.segments.leftShin.set(leftKnee, leftFoot, 0.073);
        this.segments.rightThigh.set(rightHip, rightKnee, 0.09);
        this.segments.rightShin.set(rightKnee, rightFoot, 0.073);
        this.leftKnee.position.copy(leftKnee); this.rightKnee.position.copy(rightKnee);
        this._setOrientedBox(this.leftFootMesh, leftFoot, UP, new THREE.Vector3(0, 0, 1));
        this._setOrientedBox(this.rightFootMesh, rightFoot, UP, new THREE.Vector3(0, 0, 1));
        this._setOrientedBox(this.pelvisMesh, pelvis, UP, new THREE.Vector3(0, 0, 1));
        this._setOrientedBox(this.chestMesh, chest, UP, new THREE.Vector3(0, 0, 1));
        this.segments.spine.set(pelvis.clone().addScaledVector(UP, 0.08), chest.clone().addScaledVector(UP, -0.08), 0.14);
        const head = new THREE.Vector3(0, 1.43, 0.05);
        this.headMesh.position.copy(head);
        this.segments.neck.set(new THREE.Vector3(0, 1.25, 0.03), new THREE.Vector3(0, 1.34, 0.04), 0.065);
        this.eyeL.position.set(-0.067, 1.455, 0.215); this.eyeR.position.set(0.067, 1.455, 0.215);
        const shoulderL = new THREE.Vector3(-0.325, 1.10, 0.02);
        const shoulderR = new THREE.Vector3(0.325, 1.10, 0.02);
        const elbowL = new THREE.Vector3(-0.31, 0.84, 0.25);
        const elbowR = new THREE.Vector3(0.31, 0.84, 0.25);
        const handL = new THREE.Vector3(-0.19, 0.78, 0.50);
        const handR = new THREE.Vector3(0.19, 0.78, 0.50);
        this.segments.leftUpperArm.set(shoulderL, elbowL, 0.066);
        this.segments.leftForearm.set(elbowL, handL, 0.057);
        this.segments.rightUpperArm.set(shoulderR, elbowR, 0.069);
        this.segments.rightForearm.set(elbowR, handR, 0.059);
        this.leftElbow.position.copy(elbowL); this.rightElbow.position.copy(elbowR);
        this.leftHandMesh.position.copy(handL); this.rightHandMesh.position.copy(handR);
        this._updateHandAnchor(this.handAnchorL, handL, handL.clone().sub(elbowL).normalize(), UP);
        this._updateHandAnchor(this.handAnchorR, handR, handR.clone().sub(elbowR).normalize(), UP);
    }

    getWeaponWorldTransform(positionTarget, directionTarget) {
        this.handAnchorR.getWorldPosition(positionTarget);
        directionTarget.copy(this.weaponDirectionLocal);
        this._localVectorToWorld(directionTarget, directionTarget).normalize();
        return { position: positionTarget, direction: directionTarget };
    }
}


// ---------------------------------------------------------------------
// Active rig registry
// ---------------------------------------------------------------------
// The quality patch layer replaces the rig class with a subclass that adds
// procedural cloth maps. In the single-file prototype it simply reassigned the
// `ProceduralRig` binding, which an ES module import cannot do. Consumers go
// through this registry so the swap stays visible to them, and so later layers
// patch the prototype of whichever class is currently active.

let ActiveProceduralRig = ProceduralRig;

export function getProceduralRig() {
    return ActiveProceduralRig;
}

export function setProceduralRig(rigClass) {
    ActiveProceduralRig = rigClass;
}
