// =====================================================
// CONSTANTS - CENTRALIZED GAME CONFIGURATION
// =====================================================

// Physics
export const GRAVITY = 0.015;
export const JUMP_FORCE = 0.2;
export const PLAYER_SPEED = 0.12;
export const PLAYER_RADIUS = 0.4;
export const PLAYER_SURFACE_HEIGHT = 0.05;  // ground snap height above surface
export const GRAVITY_REFERENCE_RADIUS = 15; // planet radius at which gravity = GRAVITY
export const MAX_FALL_SPEED = 0.8;          // terminal velocity
export const ON_GROUND_THRESHOLD = 0.005;   // vel threshold before onGround goes false
export const FRICTION_GROUND = 0.8;         // tangential friction when not moving
export const FRICTION_STUN = 0.9;           // tangential friction during stun

// Camera
export const CAMERA_FOV = 60;
export const CAMERA_DISTANCE = 5.0;
export const CAMERA_DISTANCE_BOAT = 8.0;
export const CAMERA_LERP = 0.1;
export const CAMERA_MIN_Y = 0.1;
export const CAMERA_MAX_Y = 1.4;

// Rendering
export const RENDER_SCALE = 0.5;
export const GROUND_LEVEL = -1.4; // O_Y (legacy, unused in spherical mode)

// Interaction
export const CHOP_HITS = 5;
export const MINE_HITS = 5;
export const HIT_INTERVAL = 0.4;       // seconds between hits
export const INTERACT_RANGE = 3.0;     // highlight distance
export const CHOP_MAX_RANGE = 3.5;     // max distance to continue chopping
export const PICKUP_RANGE = 1.5;       // auto-pickup distance
export const TOOL_PICKUP_RANGE = 4.0;  // manual tool pickup range
export const RAYCAST_RANGE = 8.0;      // click interaction distance
export const PLACE_RANGE = 12.0;       // placement distance
export const WATER_PLACE_RANGE = 15.0; // log placement on water distance

// Spaceship (replaces Boat)
export const SHIP_MAX_SPEED = 0.25;
export const SHIP_ACCELERATION = 0.005;
export const SHIP_BRAKE = 0.006;
export const SHIP_REVERSE_FACTOR = 0.3;
export const SHIP_DRAG = 0.985;
export const SHIP_MIN_SPEED = 0.001;
export const SHIP_COLLISION_RADIUS = 3.0;
export const SHIP_PROXIMITY_RANGE = 6.0;
export const SHIP_LOG_CLUSTER_SIZE = 4;
export const SHIP_LOG_CLUSTER_RADIUS = 5.0;
export const SHIP_DECK_Y_OFFSET = 0.0;
export const SHIP_PLAYER_Y_OFFSET = 0.1;
export const SHIP_PITCH_SPEED = 0.02;
export const SHIP_YAW_SPEED = 0.02;
export const SHIP_HEALTH = 100;
export const SHIP_TURN_SPEED = 0.02;

// Spaceship collision damage
export const SHIP_COLLISION_DAMAGE_THRESHOLD = 0.3;   // fraction of max speed above which impacts damage the ship
export const SHIP_COLLISION_DAMAGE_AT_FULL_SPEED = 30; // HP lost on a full-speed head-on hit
export const SHIP_DAMAGE_SPEED_HP_THRESHOLD = 50;      // below this health, max speed starts degrading
export const SHIP_DAMAGED_MIN_SPEED_MULT = 0.6;        // effective max speed fraction at 1 HP

// Spaceship repair
export const SHIP_REPAIR_GOLD_COST = 1;    // gold consumed per repair
export const SHIP_REPAIR_HEAL_AMOUNT = 25; // HP restored per repair

// Spaceship gravity
export const SHIP_GRAVITY_STRENGTH = 0.002;    // gravity acceleration at the surface (added each frame)
export const SHIP_GRAVITY_RANGE = 4.0;         // gravity acts within this multiple of planet radius
export const SHIP_AUTO_LEVEL_SPEED = 0.03;     // roll auto-correction rate

// Spaceship visual banking (game feel only — does not affect the physics quaternion)
export const SHIP_BANK_MAX = 0.35;      // max visual roll angle (radians) while turning
export const SHIP_BANK_LERP = 0.1;      // 60fps-tuned smoothing rate; used via smoothFactor(SHIP_BANK_LERP, dt)

// Spaceship takeoff / taxi (airplane-style grounded phase)
export const SHIP_TAKEOFF_SPEED = 0.12;        // forward speed required to lift off the surface
export const SHIP_TAKEOFF_ALTITUDE = 1.5;      // altitude above belly-rest at which flight frees up
export const SHIP_GROUND_REST_ALTITUDE = 0.05; // altitude tolerance treated as "in contact" with surface

// Legacy aliases for BoatSystem compatibility (map to SHIP_*)
export const BOAT_BASE_HEALTH = SHIP_HEALTH;
export const BOAT_BASE_MAX_SPEED = SHIP_MAX_SPEED;
export const BOAT_BASE_ACCELERATION = SHIP_ACCELERATION;
export const BOAT_BASE_TURN_SPEED = SHIP_TURN_SPEED;
export const BOAT_BASE_DRAG = SHIP_DRAG;
export const BOAT_BASE_BRAKE = SHIP_BRAKE;
export const BOAT_REVERSE_FACTOR = SHIP_REVERSE_FACTOR;
export const BOAT_MIN_SPEED = SHIP_MIN_SPEED;
export const BOAT_COLLISION_RADIUS = SHIP_COLLISION_RADIUS;
export const BOAT_PROXIMITY_RANGE = SHIP_PROXIMITY_RANGE;
export const BOAT_DECK_Y_OFFSET = SHIP_DECK_Y_OFFSET;
export const BOAT_PLAYER_Y_OFFSET = SHIP_PLAYER_Y_OFFSET;

// Boarding animation
export const BOARDING_WALK_SPEED = 2.5;
export const BOARDING_HOP_SPEED = 2.8;
export const BOARDING_SETTLE_SPEED = 3.0;
export const BOARDING_HOP_HEIGHT = 1.2;
export const BOARDING_SIDE_DIST = 2.0;
export const CAT_BOARDING_DELAY = 1.0;

// Creature AI
export const CREATURE_HUNGER_RATE = 0.1;
export const CREATURE_HUNGER_WARNING = 15;
export const CREATURE_HUNGER_DEATH = 30;
export const CREATURE_FOOD_SEEK_RANGE = 3.0;
export const CREATURE_FOOD_EAT_RANGE = 0.5;
export const CREATURE_WANDER_SPEED_FACTOR = 0.5;
export const CREATURE_WANDER_COOLDOWN_MIN = 1.0;
export const CREATURE_WANDER_COOLDOWN_MAX = 3.0;
export const CREATURE_BREED_EAT_THRESHOLD = 3;
export const CREATURE_BREED_AGE = 8;
export const EGG_HATCH_TIME = 10.0;
export const CREATURE_HUNGER_WARN = 15;
export const CREATURE_WANDER_RADIUS = 8;
export const MAX_CREATURES = 15;          // population cap to prevent exponential growth

// Food production
export const FOOD_PRODUCTION_TIME = 25; // seconds
export const MAX_FOODS = 30;            // population cap to prevent food overload

// Inventory
export const INVENTORY_SLOTS = 8;
export const NON_STACKABLE_TYPES = ['creature', 'egg', 'axe', 'pickaxe'];

// Particles
export const PARTICLE_GRAVITY = 0.002;
export const PARTICLE_FADE_RATE = 0.03;
export const DEBRIS_GRAVITY = 0.01;
export const DEBRIS_SHRINK_RATE = 0.98;
export const DEBRIS_MIN_SCALE = 0.01;
export const DEBRIS_MIN_Y = -200;  // Increased for space (no ocean floor)

// Mining drops
export const MINE_DROP_COUNT = 3;

// Planet definitions (replaces ISLANDS)
// Each planet is a sphere in 3D space with a radius
export const PLANETS = [
    { name: "STARTING PLANET", x: 0, y: 0, z: 0, radius: 15, hasAtmosphere: true, palette: null, tier: 0 },
    { name: "FLORA WORLD", x: 100, y: 30, z: 0, radius: 18, hasAtmosphere: true, palette: null, tier: 1 },
    { name: "ANCIENT PEAKS", x: 0, y: -20, z: 140, radius: 30, hasAtmosphere: true, palette: 'blue', tier: 3 },
    { name: "ROCKY OUTPOST", x: -110, y: 40, z: -60, radius: 14, hasAtmosphere: true, palette: null, tier: 2 },
    { name: "DISTANT WORLD", x: 60, y: -50, z: -120, radius: 16, hasAtmosphere: true, palette: null, tier: 2 }
];

// Per-tier creature difficulty multipliers (index = PLANETS[].tier). Deterministic —
// static lookup applied at spawn time, no RNG involved.
export const TIER_MODIFIERS = [
    { hp: 1, dmg: 1, aggro: 0.5 },
    { hp: 1.3, dmg: 1.25, aggro: 1 },
    { hp: 1.6, dmg: 1.5, aggro: 1.5 },
    { hp: 2, dmg: 2, aggro: 2 }
];

// Legacy island definitions (kept for reference)
export const ISLANDS = PLANETS;

// Mouse/Controls
export const SENSITIVITY = 0.002;
export const ROTATION_SLERP = 0.15;

// Scale animation
export const SCALE_LERP = 0.05;

// Player combat
export const PLAYER_MAX_HP = 20;
export const PLAYER_BASE_ATTACK = 2;
export const ATTACK_COOLDOWN = 0.4;
export const ATTACK_RANGE = 2.0;
export const ATTACK_ARC = Math.PI * 0.6;

// Creature combat
export const CREATURE_HP = 6;
export const CREATURE_CONTACT_DAMAGE = 2;
export const CREATURE_CONTACT_COOLDOWN = 1.0;
export const CREATURE_AGGRO_DURATION = 5.0;
export const AGGRO_RANGE = 6;             // proximity radius (world units) for ambient aggro rolls
export const AGGRO_BASE_CHANCE = 0.25;    // probability per second at temperament 1.0

// Death / respawn
export const RESPAWN_INVINCIBILITY = 3.0;

// Stat boosts
export const STAT_BOOST_PICKUP_RANGE = 2.0;
export const STAT_BOOST_BOB_SPEED = 3.0;
export const STAT_BOOST_BOB_HEIGHT = 0.3;
export const STAT_BOOST_SPIN_SPEED = 2.0;

// Essence stat caps (multiples of base stats — clamped on application, still
// consumes the pickup once capped so there's no new UI needed)
export const ESSENCE_ATTACK_CAP_MULT = 4;      // attack cap = 4x base attack
export const ESSENCE_SPEED_BOOST_CAP_MULT = 0.6; // speedBoost cap = +60% of base speed
export const ESSENCE_MAX_HP_CAP_MULT = 3;      // maxHp cap = 3x base maxHp
// Derived absolute cap for player.speedBoost — the same formula CombatSystem uses
// to clamp the stat, centralized so other systems (FOV kick) read the exact cap
// instead of recomputing it and risking drift from the multiplier above.
export const PLAYER_SPEED_BOOST_CAP = PLAYER_SPEED * ESSENCE_SPEED_BOOST_CAP_MULT;

// Essence drops from creatures
export const CREATURE_ESSENCE_MAP = {
    conehead: { stat: 'speed', amount: 0.01 },
    blobby:   { stat: 'attack', amount: 1 },
    blocky:   { stat: 'health', amount: 3 }
};
export const ATTACK_SWING_DURATION = 0.4;

// Discoverable crafting hint
export const CRAFT_HINT_DURATION = 6.0; // seconds the first-wood-pickup hint stays visible

// Space environment
export const STAR_COUNT = 2000;
export const STAR_SPREAD = 800;
export const SPACE_FOG_COLOR = 0x020208;

// FOV speed kick (game feel) — camera.fov interpolates toward CAMERA_FOV + kick,
// scaled by how fast the player currently is relative to their own max.
export const SHIP_FOV_KICK = 15;    // max extra FOV at full ship throttle
export const PLAYER_FOV_KICK = 8;   // max extra FOV on foot at the speed-essence cap
export const FOV_KICK_LERP = 0.08;  // 60fps-tuned smoothing rate; used via smoothFactor(FOV_KICK_LERP, dt)
