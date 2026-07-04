// =====================================================
// GAME STATE CLASS
// =====================================================

export default class GameState {
    constructor() {
        this.reset();
    }

    reset() {
        this.phase = 'loading';
        this.palette = null;
        this.worldDNA = null;
        this.inventory = new Array(8).fill(null);
        this.selectedSlot = null;
        this.entities = [];
        this.foods = [];
        this.particles = [];
        this.debris = [];
        this.obstacles = [];

        this.musicStarted = false;

        // Player (third-person)
        this.player = {
            pos: new THREE.Vector3(0, 0, 0),
            vel: new THREE.Vector3(0, 0, 0),
            speed: 0.12,
            onGround: false,
            targetRotation: 0,
            cameraAngle: { x: 0, y: 0.3 }, // x = horizontal orbit, y = vertical orbit
            cameraMode: 'third', // 'third' or 'first'
            hp: 20,
            maxHp: 20,
            attack: 2,
            baseAttack: 2,
            speedBoost: 0,
            stunTimer: 0, // For knockback
        };

        // Combat
        this.attackCooldown = 0;
        this.isAttacking = false;
        this.invincibleTimer = 0;
        this.isDead = false;
        this.deathTimer = 0;
        this.statBoosts = [];
        this.inputs = { w: false, a: false, s: false, d: false, space: false, shift: false, pitchUp: false, pitchDown: false };
        this.sensitivity = 0.002;

        // Multi-island data (populated by GameEngine)
        this.islands = [];
        this.lastIslandName = null;

        // Resources
        this.resources = { logs: 0 };

        // Interaction
        this.interactionTarget = null;    // entity currently highlighted
        this.chopProgress = 0;            // hits on current tree (0-5)
        this.isChopping = false;          // holding click on tree
        this.chopTimer = 0;              // time since last chop hit

        this.isMining = false;            // holding click on rock
        this.mineProgress = 0;            // hits on current rock
        this.mineTimer = 0;

        // Discoverable crafting hint (shown once per session on first wood pickup)
        this.hasShownCraftHint = false;
        this.craftHintTimer = 0;

        this.lastInteractTime = 0;

        // Mouse
        this.mouseX = 0;
        this.mouseY = 0;

        // Ship navigation (3D spaceflight)
        this.isOnBoat = false;         // true while piloting ship
        this.activeBoat = null;        // ref to the ship Object3D
        this.boatSpeed = 0;            // scalar speed (magnitude of shipVelocity, for HUD)
        this.boatRotation = 0;         // legacy yaw — kept for compat but unused in 3D mode
        this.shipQuaternion = new THREE.Quaternion();  // full 3D orientation
        this.shipVelocity = new THREE.Vector3();       // 3D velocity (nose-aligned, dampened)
        this.shipNearestPlanet = null; // nearest planet ref while flying (auto-level + HUD)
        this.shipGrounded = false;     // true while resting/taxiing on a planet surface
        this.shipCameraMode = 'chase'; // 'chase' | 'cockpit'

        // Boarding animation
        this.isBoardingBoat = false;
        this.boardingPhase = 0;       // 0=walk-to, 1=hop-up, 2=settle
        this.boardingProgress = 0;    // 0..1 within each phase
        this.boardingStartPos = null; // player start position
        this.boardingTargetBoat = null;

        // Cat boarding animation
        this.catBoarding = false;
        this.catBoardingPhase = 0;    // 0=run-to, 1=hop-up, 2=settle
        this.catBoardingProgress = 0;
        this.catBoardingStartPos = null;
        this.catOnBoat = false;
        this.catBoardingQueued = false;
        this.catBoardingDelay = 0;

        // Camera shake (game feel) — magnitude decays toward 0 each frame
        // (ParticleSystem owns the decay; see addShake()/consumers in
        // PlayerController.updateCamera and BoatSystem._updateCamera).
        this.cameraShake = 0;

        // Floating combat damage numbers (world-space sprites; ticked/disposed by
        // ParticleSystem, spawned via EntityFactory.createDamageNumber).
        this.damageNumbers = [];
    }

    /** Add camera shake magnitude, clamped to a sane max so hits can't compound into chaos. */
    addShake(amount) {
        this.cameraShake = Math.min(0.5, (this.cameraShake || 0) + amount);
    }
}
