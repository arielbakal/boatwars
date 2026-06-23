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

// Spaceship gravity & flight modes
export const SHIP_GRAVITY_STRENGTH = 0.002;    // gravity pull at reference distance
export const SHIP_GRAVITY_RANGE = 4.0;         // max range as multiplier of planet radius
export const SHIP_PLANET_MODE_RADIUS = 2.5;    // proximity multiplier: inside = planet mode
export const SHIP_SPACE_MODE_RADIUS = 4.0;     // outside = full space mode
export const SHIP_AUTO_LEVEL_SPEED = 0.03;     // roll auto-correction rate
export const SHIP_MAX_PLANET_PITCH = Math.PI / 4; // max pitch in planet mode (45°)

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
    { name: "STARTING PLANET", x: 0, y: 0, z: 0, radius: 15, hasAtmosphere: true, palette: null },
    { name: "FLORA WORLD", x: 100, y: 30, z: 0, radius: 18, hasAtmosphere: false, palette: null },
    { name: "ANCIENT PEAKS", x: 0, y: -20, z: 140, radius: 30, hasAtmosphere: false, palette: 'blue' },
    { name: "ROCKY OUTPOST", x: -110, y: 40, z: -60, radius: 14, hasAtmosphere: false, palette: null },
    { name: "DISTANT WORLD", x: 60, y: -50, z: -120, radius: 16, hasAtmosphere: false, palette: null }
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

// Death / respawn
export const RESPAWN_INVINCIBILITY = 3.0;

// Stat boosts
export const STAT_BOOST_PICKUP_RANGE = 2.0;
export const STAT_BOOST_BOB_SPEED = 3.0;
export const STAT_BOOST_BOB_HEIGHT = 0.3;
export const STAT_BOOST_SPIN_SPEED = 2.0;

// Essence drops from creatures
export const CREATURE_ESSENCE_MAP = {
    conehead: { stat: 'speed', amount: 0.01 },
    blobby:   { stat: 'attack', amount: 1 },
    blocky:   { stat: 'health', amount: 3 }
};
export const ATTACK_SWING_DURATION = 0.4;

// Space environment
export const STAR_COUNT = 2000;
export const STAR_SPREAD = 800;
export const SPACE_FOG_COLOR = 0x020208;
