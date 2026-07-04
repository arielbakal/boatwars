// =====================================================
// GAME ENGINE - SPACE WORLD WITH SPHERICAL PLANETS
// =====================================================

import AudioManager from './AudioManager.js';
import GameState from './GameState.js';
import WorldManager from './WorldManager.js';
import EntityFactory from './EntityFactory.js';
import InputHandler from './InputHandler.js';
import PlayerController from './PlayerController.js';
import ChatManager from './ChatManager.js';
import SphericalUtils from './SphericalUtils.js';

import SystemManager from '../systems/SystemManager.js';
import BoatSystem from '../systems/BoatSystem.js';
import ChopSystem from '../systems/ChopSystem.js';
import MineSystem from '../systems/MineSystem.js';
import InventoryManager from '../systems/InventoryManager.js';
import EntityAISystem from '../systems/EntityAISystem.js';
import CatAI from '../systems/CatAI.js';
import ParticleSystem from '../systems/ParticleSystem.js';
import CombatSystem from '../systems/CombatSystem.js';

import NetworkManager from '../network/NetworkManager.js';
import RemotePlayerManager from '../network/RemotePlayerManager.js';
import SeededRandom from '../network/SeededRandom.js';

import { PLANETS, TIER_MODIFIERS, CREATURE_CONTACT_DAMAGE, CAMERA_FOV, RENDER_SCALE, STACKS_BY_TYPE, SHIP_LOG_CLUSTER_RADIUS } from '../constants.js';

export default class GameEngine {
    constructor() {
        this.audio = new AudioManager();
        this.state = new GameState();
        this.world = new WorldManager(RENDER_SCALE);
        this.factory = new EntityFactory(this.world, this.state);
        this.playerController = new PlayerController(this.world, this.state);
        this.spheres = [];
        this.islandGroups = [];
        this.groundPlanes = [];
        this.waterMesh = null;
        this.logs = [];
        this.clouds = [];
        this.boatPromptVisible = false;
        this.ui = {};
        this.setupUI();

        this.systems = new SystemManager();
        this.boatSystem = new BoatSystem(this.ui);
        this.chopSystem = new ChopSystem(this.ui);
        this.mineSystem = new MineSystem(this.ui);
        this.inventorySystem = new InventoryManager(this.state, this.audio, this.ui);
        this.entityAISystem = new EntityAISystem();
        this.catAI = new CatAI();
        this.particleSystem = new ParticleSystem();
        this.combatSystem = new CombatSystem(this.ui);

        this.systems.register('boat', this.boatSystem);
        this.systems.register('chop', this.chopSystem);
        this.systems.register('mine', this.mineSystem);
        this.systems.register('inventory', this.inventorySystem);
        this.systems.register('entityAI', this.entityAISystem);
        this.systems.register('catAI', this.catAI);
        this.systems.register('particles', this.particleSystem);
        this.systems.register('combat', this.combatSystem);

        this.network = new NetworkManager();
        this.remotePlayers = new RemotePlayerManager(this.world, this.factory);
        this._setupNetworkCallbacks();
        this._setupChatUI();
        this._lastSelectedSlot = null;

        this.inventorySystem.onInventoryChanged = () => {
            this._broadcastInventory();
        };

        this.chatManager = new ChatManager(this);
        this.input = new InputHandler(this);
        this.setupButtons();
        this.initGame(null);
        this.animate = this.animate.bind(this);
        this.animate(0);
        window.onresize = () => this.world.resize();
    }

    setupUI() {
        this.ui.essenceScreen = document.getElementById('essence-screen');
        this.ui.invContainer = document.getElementById('inventory-container');
        this.ui.invGrid = document.getElementById('inventory-grid');
        this.ui.resetBtn = document.getElementById('reset-btn');
        this.ui.flash = document.getElementById('white-flash');
        this.ui.resourceHud = document.getElementById('resource-hud');
        this.ui.logCount = document.getElementById('log-count');
        this.ui.craftHint = document.getElementById('craft-hint');
        this.ui.volSlider = document.getElementById('vol-slider');
        this.ui.volIcon = document.getElementById('vol-icon');
        this.ui.settingsBtn = document.getElementById('settings-btn');
        this.ui.settingsPopup = document.getElementById('settings-popup');
        this.ui.chopIndicator = document.getElementById('chop-indicator');
        this.ui.chopFill = document.getElementById('chop-fill');
        this.ui.boatPrompt = document.getElementById('boat-prompt');
        this.ui.boatBuildProgress = document.getElementById('boat-build-progress');
        this.ui.islandIndicator = document.getElementById('island-indicator');
        this.ui.hpBar = document.getElementById('hp-bar');
        this.ui.hpFill = document.getElementById('hp-fill');
        this.ui.hpText = document.getElementById('hp-text');
        this.ui.deathScreen = document.getElementById('death-screen');
        for (let i = 0; i < 8; i++) {
            const div = document.createElement('div');
            div.className = 'slot';
            div.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.state.selectedSlot === i) { this.state.selectedSlot = null; this.audio.select(); }
                else if (this.state.inventory[i]) { this.state.selectedSlot = i; this.audio.select(); }
                this.updateInventory();
            });
            this.ui.invGrid.appendChild(div);
        }
    }

    setupButtons() {
        this.ui.resetBtn.addEventListener('click', () => this.resetWorld());
        const mpBtn = document.getElementById('mp-connect-btn');
        const mpUrl = document.getElementById('mp-url');
        if (mpBtn && mpUrl) {
            mpBtn.addEventListener('click', () => {
                if (this.network.connected) {
                    this.disconnectMultiplayer();
                } else {
                    this.connectMultiplayer(mpUrl.value.trim());
                }
            });
        }
    }

    addToInventory(type, color, style, age = 0) {
        const isStackable = ['creature', 'egg'].indexOf(type) === -1;
        if (isStackable) {
            // Base resources stack by type alone — per-planet palette colors would
            // otherwise split them into one slot per planet and exhaust the inventory.
            // STACKS_BY_TYPE is shared with InventoryManager's addToInventory/_canPickup
            // (the auto-pickup magnetism path) so both pickup routes always agree.
            const stacksByType = STACKS_BY_TYPE.indexOf(type) !== -1;
            const existingIdx = this.state.inventory.findIndex(item =>
                item && item.type === type && (stacksByType || item.color.getHex() === color.getHex())
            );
            if (existingIdx !== -1) {
                this.state.inventory[existingIdx].count = (this.state.inventory[existingIdx].count || 1) + 1;
                this.updateInventory();
                this._broadcastInventory();
                return true;
            }
        }
        const emptyIdx = this.state.inventory.findIndex(item => item === null);
        if (emptyIdx !== -1) {
            this.state.inventory[emptyIdx] = { type, color, style, age, count: 1 };
            this.updateInventory();
            this._broadcastInventory();
            return true;
        }
        return false;
    }

    updateInventory() {
        const slots = document.querySelectorAll('.slot');
        slots.forEach((el, i) => {
            el.innerHTML = '';
            el.classList.toggle('active', this.state.selectedSlot === i);
            const it = this.state.inventory[i];
            if (it) {
                const d = document.createElement('div');
                d.style.color = '#' + it.color.getHexString();
                d.className = `icon-${it.type}`;
                if (['creature', 'rock', 'gold', 'grass', 'flower', 'egg'].includes(it.type)) d.style.background = d.style.color;
                if (it.type === 'bush') d.style.borderBottomColor = d.style.color;
                if (it.type === 'wood' || it.type === 'log') d.style.background = d.style.color;
                if (it.type === 'axe' || it.type === 'pickaxe') d.style.background = d.style.color;
                el.appendChild(d);
                if (it.count > 1) {
                    const countEl = document.createElement('span');
                    countEl.innerText = it.count;
                    countEl.style.cssText = 'position:absolute;bottom:2px;right:2px;color:#fff;font-size:10px;text-shadow:1px 1px 0 #000;pointer-events:none;';
                    el.appendChild(countEl);
                }
            }
        });
        this._broadcastInventory();
    }

    resetWorld() {
        if (this.state.phase !== 'playing') return;
        // Guard against a second rapid click stacking two initGame() timeouts —
        // also doubles as the source of truth animate() checks below.
        if (this.state.isResettingWorld) return;
        this.state.isResettingWorld = true;
        this.audio.explode();
        this.ui.flash.style.opacity = 1;
        setTimeout(() => this.ui.flash.style.opacity = 0, 500);
        for (let i = 0; i < 60; i++) {
            this.factory.createParticle(new THREE.Vector3(0, 0, 0), new THREE.Color(0xffffff), 4);
            this.factory.createParticle(new THREE.Vector3(0, 0, 0), this.state.palette.flora, 3);
        }
        this.state.entities.forEach(e => {
            e.userData.exploding = true;
            e.userData.vel = e.position.clone().normalize().multiplyScalar(0.2 + Math.random() * 0.3);
            e.userData.rotVel = new THREE.Vector3(Math.random(), Math.random(), Math.random());
            this.state.debris.push(e);
        });
        this.state.foods.forEach(f => {
            f.userData.exploding = true;
            f.userData.vel = f.position.clone().normalize().multiplyScalar(0.2 + Math.random() * 0.3);
            f.userData.rotVel = new THREE.Vector3(Math.random(), Math.random(), Math.random());
            this.state.debris.push(f);
        });
        this.state.statBoosts.forEach(b => {
            b.userData.exploding = true;
            b.userData.vel = b.position.clone().normalize().multiplyScalar(0.2 + Math.random() * 0.3);
            b.userData.rotVel = new THREE.Vector3(Math.random(), Math.random(), Math.random());
            this.state.debris.push(b);
        });
        this.state.statBoosts = [];
        this.state.entities = []; this.state.obstacles = []; this.state.foods = [];
        this.islandGroups.forEach(ig => {
            this.world.remove(ig.group);
            this.factory.disposeHierarchy(ig.group);
        });
        this.islandGroups = [];
        this.groundPlanes = [];
        this.state.islands = [];
        this.logs = [];
        this.state.isOnBoat = false;
        this.state.activeBoat = null;
        // A reset (including one triggered by a multiplayer 'welcome' regen) can
        // land mid-boarding-walk; boardingTargetBoat would otherwise keep pointing
        // at a boat object that's about to be wiped, and updateBoardingAnimation
        // would keep lerping the player toward it forever with no way to reach it.
        this.state.isBoardingBoat = false;
        this.state.boardingTargetBoat = null;
        // Clicks landing inside the reset window could otherwise leave chop/mine
        // state armed against an entity from the wiped world.
        this.state.isChopping = false;
        this.state.isMining = false;
        this.state.chopTimer = 0;
        this.state.mineTimer = 0;
        this.state.interactionTarget = null;
        // Reset hygiene: a shake mid-decay or damage numbers still mid-flight would
        // otherwise carry over into the new world — the latter would also leak
        // their sprite textures/materials since nothing else ever disposes them.
        this.state.cameraShake = 0;
        this.particleSystem.clearDamageNumbers(this.world, this.state);
        this.playerController.remove();
        this.audio.fadeOut();
        setTimeout(() => {
            try {
                this.initGame(null);
            } finally {
                // initGame's tail clears this flag on success; the finally covers a
                // mid-generation throw, which would otherwise leave it stuck true and
                // freeze every player-model system in animate() permanently.
                this.state.isResettingWorld = false;
            }
        }, 800);
    }

    /**
     * Place an entity on a planet surface with correct position and orientation.
     *
     * Uses SphericalUtils.sampleTerrainHeight to fire a ray against the planet's
     * groundMesh and find the actual displaced surface height, so objects land on
     * real terrain instead of the nominal sphere radius. Falls back to planet.radius
     * automatically when groundMesh is unavailable or the ray misses.
     *
     * Ordering guarantee: this is only called after createPlanet() + world.add(planet.group),
     * so the groundMesh is already in the scene and its world matrix is valid.
     *
     * @param {THREE.Object3D} entity - Entity to place
     * @param {Object} planet - { center: THREE.Vector3, radius: number, groundMesh?: THREE.Mesh }
     * @param {THREE.Vector3} surfacePoint - Desired position on (nominal) surface
     */
    placeOnPlanet(entity, planet, surfacePoint) {
        const normal = SphericalUtils.getSurfaceNormal(surfacePoint, planet);
        const heightOffset = entity.userData.heightOffset || 0;

        // Sample the real displaced terrain height along this surface normal.
        // groundMesh world matrix must be current; world.add() above guarantees this
        // when called during initGame (Three.js updates matrices on the next render,
        // but Raycaster.intersectObject triggers a matrix update internally for meshes
        // already parented to the scene — safe at placement time).
        const terrainRadius = SphericalUtils.sampleTerrainHeight(planet, normal);

        const pos = planet.center.clone().add(normal.clone().multiplyScalar(terrainRadius + heightOffset));
        entity.position.copy(pos);

        // Orient so local Y-up aligns with surface normal
        const q = SphericalUtils.getOrientationOnSurface(normal);
        entity.quaternion.copy(q);

        // Store planet reference for AI/physics
        entity.userData.planet = planet;
    }

    initGame(sphereColor) {
        let seededOverride = null;
        if (this.network && this.network.worldSeed !== null) {
            seededOverride = new SeededRandom(this.network.worldSeed).override();
        }

        this.state.phase = 'playing';
        this.state.palette = this.factory.generatePalette(sphereColor);
        // C1: state.worldDNA stays a session-wide roll for non-planet consumers only
        // (currently: AudioManager.startMusic's procedural seed). Each planet below
        // rolls its OWN fresh DNA (planetDNA1..5) right after its islands.push() so
        // tree/bush/rock/grass/creature-fallback shapes differ per planet instead of
        // sharing this one. Placed items and egg-hatch babies are unaffected — they
        // always carry an explicit style/parentDNA object captured at pickup/lay
        // time (InputHandler.createEntityFromItem, EntityAISystem's hatch logic),
        // never falling back to worldDNA.
        this.state.worldDNA = this.factory.generateWorldDNA();
        // Space background stays dark
        this.ui.invContainer.style.display = 'flex';

        // Helper: random surface point near a planet center
        const rndSurface = (planet, minDist = 1.0, maxDist = null) => {
            if (!maxDist) maxDist = planet.radius * 0.8;
            const centerSurface = planet.center.clone().add(new THREE.Vector3(0, planet.radius, 0));
            return SphericalUtils.randomSurfacePointNear(planet, centerSurface, minDist, maxDist);
        };

        // --- Planet 1: Starting Planet ---
        const planet1 = this.factory.createPlanet(this.state.palette, 0, 0, 0, 15, PLANETS[0].hasAtmosphere);
        this.world.add(planet1.group);
        this.islandGroups.push(planet1);
        this.groundPlanes.push(planet1.groundMesh);
        this.state.islands.push({
            center: planet1.center.clone(),
            radius: planet1.radius,
            groundMesh: planet1.groundMesh, // Real displaced surface mesh for terrain sampling
            floorY: 0, // Legacy, not used in spherical mode
            name: "STARTING PLANET"
        });

        // C1: fresh world DNA for planet 1's flora/fauna shapes
        const planetDNA1 = this.factory.generateWorldDNA();

        // Trees on planet 1
        for (let i = 0; i < 14; i++) {
            const pos = rndSurface(planet1, 2.0, 12.0);
            const tree = this.factory.createTree(this.state.palette, 0, 0, this._treeStyleFromDNA(planetDNA1, this.state.palette));
            this.placeOnPlanet(tree, planet1, pos);
            this.state.entities.push(tree);
            this.world.add(tree);
        }
        // Bushes
        for (let i = 0; i < 7; i++) {
            const pos = rndSurface(planet1, 1.5, 12.0);
            const e = this.factory.createBush(this.state.palette, 0, 0, this._bushStyleFromDNA(planetDNA1, this.state.palette));
            this.placeOnPlanet(e, planet1, pos);
            this.state.entities.push(e); this.world.add(e);
        }
        // Rocks
        for (let i = 0; i < 5; i++) {
            const pos = rndSurface(planet1, 1.5, 12.0);
            const e = this.factory.createRock(this.state.palette, 0, 0, this._rockStyleFromDNA(planetDNA1, this.state.palette));
            this.placeOnPlanet(e, planet1, pos);
            this.state.entities.push(e); this.world.add(e);
        }
        // Grass
        for (let i = 0; i < 30; i++) {
            const pos = rndSurface(planet1, 0.5, 13.0);
            const e = this.factory.createGrass(this.state.palette, 0, 0, this._grassStyleFromDNA(planetDNA1, this.state.palette));
            this.placeOnPlanet(e, planet1, pos);
            this.state.entities.push(e); this.world.add(e);
        }
        // Flowers
        for (let i = 0; i < 8; i++) {
            const pos = rndSurface(planet1, 1.0, 12.0);
            const e = this.factory.createFlower(this.state.palette, 0, 0);
            this.placeOnPlanet(e, planet1, pos);
            this.state.entities.push(e); this.world.add(e);
        }
        // Creatures on planet 1
        const speciesTypes = ['blobby', 'blocky', 'conehead'];
        for (let i = 0; i < 3; i++) {
            const pos = rndSurface(planet1, 2.0, 9.0);
            const creatureDNA = this.factory.generateCreatureDNA(this.state.palette, speciesTypes[i]);
            const c = this.factory.createCreature(this.state.palette, 0, 0, creatureDNA);
            this.placeOnPlanet(c, planet1, pos);
            c.userData.boundCenter = planet1.center.clone();
            c.userData.boundRadius = planet1.radius * 0.85;
            c.userData.planet = planet1;
            this._applyTier(c, 0); // constants.PLANETS[0] STARTING PLANET
            this.state.entities.push(c); this.world.add(c);
        }
        // Chief
        const chiefPos = rndSurface(planet1, 3.0, 8.0);
        const chief = this.factory.createChief(this.state.palette, 0, 0);
        this.placeOnPlanet(chief, planet1, chiefPos);
        this.state.entities.push(chief); this.world.add(chief);
        // Axe
        const axePos = rndSurface(planet1, 2.0, 12.0);
        const axe = this.factory.createAxe(this.state.palette, 0, 0);
        this.placeOnPlanet(axe, planet1, axePos);
        this.state.entities.push(axe); this.world.add(axe);

        // --- Planet 2: Flora World ---
        const palette2 = this.factory.generatePalette(null);
        const planet2 = this.factory.createPlanet(palette2, 100, 30, 0, 18, PLANETS[1].hasAtmosphere);
        this.world.add(planet2.group);
        this.islandGroups.push(planet2);
        this.groundPlanes.push(planet2.groundMesh);
        this.state.islands.push({
            center: planet2.center.clone(),
            radius: planet2.radius,
            groundMesh: planet2.groundMesh,
            floorY: 0,
            name: "FLORA WORLD"
        });
        // C1: fresh world DNA for planet 2's flora/fauna shapes
        const planetDNA2 = this.factory.generateWorldDNA();

        for (let i = 0; i < 18; i++) {
            const pos = rndSurface(planet2, 2.0, 14.0);
            const e = this.factory.createTree(palette2, 0, 0, this._treeStyleFromDNA(planetDNA2, palette2));
            this.placeOnPlanet(e, planet2, pos);
            this.state.entities.push(e); this.world.add(e);
        }
        for (let i = 0; i < 12; i++) {
            const pos = rndSurface(planet2, 1.5, 14.0);
            const e = this.factory.createBush(palette2, 0, 0, this._bushStyleFromDNA(planetDNA2, palette2));
            this.placeOnPlanet(e, planet2, pos);
            this.state.entities.push(e); this.world.add(e);
        }
        for (let i = 0; i < 4; i++) {
            const pos = rndSurface(planet2, 1.5, 14.0);
            const e = this.factory.createRock(palette2, 0, 0, this._rockStyleFromDNA(planetDNA2, palette2));
            this.placeOnPlanet(e, planet2, pos);
            this.state.entities.push(e); this.world.add(e);
        }
        for (let i = 0; i < 20; i++) {
            const pos = rndSurface(planet2, 0.5, 15.0);
            const e = this.factory.createGrass(palette2, 0, 0, this._grassStyleFromDNA(planetDNA2, palette2));
            this.placeOnPlanet(e, planet2, pos);
            this.state.entities.push(e); this.world.add(e);
        }
        for (let i = 0; i < 6; i++) {
            const pos = rndSurface(planet2, 1.0, 14.0);
            const e = this.factory.createFlower(palette2, 0, 0);
            this.placeOnPlanet(e, planet2, pos);
            this.state.entities.push(e); this.world.add(e);
        }
        // Pickaxe on planet 2
        const pickPos = rndSurface(planet2, 2.0, 13.0);
        const pickaxe = this.factory.createPickaxe(palette2, 0, 0);
        this.placeOnPlanet(pickaxe, planet2, pickPos);
        this.state.entities.push(pickaxe); this.world.add(pickaxe);
        // Creatures on planet 2
        for (let i = 0; i < 3; i++) {
            const pos = rndSurface(planet2, 2.0, 12.0);
            const creatureDNA = this.factory.generateCreatureDNA(palette2, speciesTypes[i]);
            const c = this.factory.createCreature(palette2, 0, 0, creatureDNA);
            this.placeOnPlanet(c, planet2, pos);
            c.userData.boundCenter = planet2.center.clone();
            c.userData.boundRadius = planet2.radius * 0.85;
            c.userData.planet = planet2;
            this._applyTier(c, 1); // constants.PLANETS[1] FLORA WORLD
            this.state.entities.push(c); this.world.add(c);
        }

        // --- Planet 3: Ancient Peaks ---
        const palette3 = this.factory.generatePalette('blue');
        const planet3 = this.factory.createPlanet(palette3, 0, -20, 140, 30, PLANETS[2].hasAtmosphere);
        this.world.add(planet3.group);
        this.islandGroups.push(planet3);
        this.groundPlanes.push(planet3.groundMesh);
        this.state.islands.push({
            center: planet3.center.clone(),
            radius: planet3.radius,
            groundMesh: planet3.groundMesh,
            floorY: 0,
            name: "ANCIENT PEAKS"
        });
        // C1: fresh world DNA for planet 3's flora/fauna shapes
        const planetDNA3 = this.factory.generateWorldDNA();
        // Mountain on planet 3
        const mountainPos = planet3.center.clone().add(new THREE.Vector3(0, planet3.radius, 0));
        const mountain = this.factory.createMountain(palette3, 0, 0, 1.5);
        this.placeOnPlanet(mountain, planet3, mountainPos);
        this.world.add(mountain);
        this.state.entities.push(mountain);
        mountain.userData.isMountain = true;
        mountain.userData.mountRadius = 15.0;
        mountain.userData.mountHeight = 18.0;
        // Golem
        const golemPos = rndSurface(planet3, 10.0, 20.0);
        const golem = this.factory.createStoneGolem(palette3, 0, 0);
        this.placeOnPlanet(golem, planet3, golemPos);
        this.world.add(golem); this.state.entities.push(golem);
        // Big rocks on planet 3 edges
        for (let i = 0; i < 8; i++) {
            const pos = rndSurface(planet3, 18.0, 26.0);
            const rock = this.factory.createRock(palette3, 0, 0, this._rockStyleFromDNA(planetDNA3, palette3));
            this.placeOnPlanet(rock, planet3, pos);
            rock.scale.set(3, 3, 3);
            this.state.entities.push(rock); this.world.add(rock);
            this.state.obstacles.push(rock);
        }
        // Gold rocks on planet 3
        for (let i = 0; i < 12; i++) {
            const pos = rndSurface(planet3, 22.0, 27.0);
            const scale = (2.5 + Math.random() * 1.5) * 0.2;
            const goldRock = this.factory.createGoldRock(palette3, 0, 0, scale);
            this.placeOnPlanet(goldRock, planet3, pos);
            this.state.entities.push(goldRock); this.world.add(goldRock);
        }
        // Vegetation on planet 3
        for (let i = 0; i < 10; i++) {
            const pos = rndSurface(planet3, 17.0, 26.0);
            const e = this.factory.createTree(palette3, 0, 0, this._treeStyleFromDNA(planetDNA3, palette3));
            this.placeOnPlanet(e, planet3, pos);
            this.state.entities.push(e); this.world.add(e);
        }
        for (let i = 0; i < 40; i++) {
            const pos = rndSurface(planet3, 17.0, 27.0);
            const e = this.factory.createGrass(palette3, 0, 0, this._grassStyleFromDNA(planetDNA3, palette3));
            this.placeOnPlanet(e, planet3, pos);
            this.state.entities.push(e); this.world.add(e);
        }
        for (let i = 0; i < 12; i++) {
            const pos = rndSurface(planet3, 17.0, 22.0);
            const e = this.factory.createFlower(palette3, 0, 0);
            this.placeOnPlanet(e, planet3, pos);
            this.state.entities.push(e); this.world.add(e);
        }
        // Creatures on planet 3
        for (let i = 0; i < 3; i++) {
            const pos = rndSurface(planet3, 17.0, 24.0);
            const creatureDNA = this.factory.generateCreatureDNA(palette3, speciesTypes[i]);
            const c = this.factory.createCreature(palette3, 0, 0, creatureDNA);
            this.placeOnPlanet(c, planet3, pos);
            c.userData.boundCenter = planet3.center.clone();
            c.userData.boundRadius = planet3.radius * 0.85;
            c.userData.planet = planet3;
            this._applyTier(c, 2); // constants.PLANETS[2] ANCIENT PEAKS
            this.state.entities.push(c); this.world.add(c);
        }
        for (let i = 0; i < 2; i++) {
            const pos = rndSurface(planet3, 17.0, 24.0);
            const c = this.factory.createCreature(palette3, 0, 0, this._creatureStyleFromDNA(planetDNA3, palette3));
            this.placeOnPlanet(c, planet3, pos);
            c.userData.boundCenter = planet3.center.clone();
            c.userData.boundRadius = planet3.radius * 0.85;
            c.userData.planet = planet3;
            this._applyTier(c, 2); // constants.PLANETS[2] ANCIENT PEAKS
            this.state.entities.push(c); this.world.add(c);
        }

        // --- Planet 4: Rocky Outpost ---
        const palette4 = this.factory.generatePalette(null);
        const planet4 = this.factory.createPlanet(palette4, -110, 40, -60, 14, PLANETS[3].hasAtmosphere);
        this.world.add(planet4.group);
        this.islandGroups.push(planet4);
        this.groundPlanes.push(planet4.groundMesh);
        this.state.islands.push({
            center: planet4.center.clone(),
            radius: planet4.radius,
            groundMesh: planet4.groundMesh,
            floorY: 0,
            name: "ROCKY OUTPOST"
        });
        // C1: fresh world DNA for planet 4's flora/fauna shapes
        const planetDNA4 = this.factory.generateWorldDNA();

        for (let i = 0; i < 4; i++) {
            const pos = rndSurface(planet4, 2.0, 10.0);
            const e = this.factory.createTree(palette4, 0, 0, this._treeStyleFromDNA(planetDNA4, palette4));
            this.placeOnPlanet(e, planet4, pos);
            this.state.entities.push(e); this.world.add(e);
        }
        for (let i = 0; i < 3; i++) {
            const pos = rndSurface(planet4, 1.5, 10.0);
            const e = this.factory.createBush(palette4, 0, 0, this._bushStyleFromDNA(planetDNA4, palette4));
            this.placeOnPlanet(e, planet4, pos);
            this.state.entities.push(e); this.world.add(e);
        }
        for (let i = 0; i < 3; i++) {
            const pos = rndSurface(planet4, 1.5, 10.0);
            const e = this.factory.createRock(palette4, 0, 0, this._rockStyleFromDNA(planetDNA4, palette4));
            this.placeOnPlanet(e, planet4, pos);
            this.state.entities.push(e); this.world.add(e);
        }
        for (let i = 0; i < 12; i++) {
            const pos = rndSurface(planet4, 0.5, 11.0);
            const e = this.factory.createGrass(palette4, 0, 0, this._grassStyleFromDNA(planetDNA4, palette4));
            this.placeOnPlanet(e, planet4, pos);
            this.state.entities.push(e); this.world.add(e);
        }
        for (let i = 0; i < 4; i++) {
            const pos = rndSurface(planet4, 1.0, 10.0);
            const e = this.factory.createFlower(palette4, 0, 0);
            this.placeOnPlanet(e, planet4, pos);
            this.state.entities.push(e); this.world.add(e);
        }
        for (let i = 0; i < 3; i++) {
            const pos = rndSurface(planet4, 2.0, 8.0);
            const creatureDNA = this.factory.generateCreatureDNA(palette4, speciesTypes[i]);
            const c = this.factory.createCreature(palette4, 0, 0, creatureDNA);
            this.placeOnPlanet(c, planet4, pos);
            c.userData.boundCenter = planet4.center.clone();
            c.userData.boundRadius = planet4.radius * 0.85;
            c.userData.planet = planet4;
            this._applyTier(c, 3); // constants.PLANETS[3] ROCKY OUTPOST
            this.state.entities.push(c); this.world.add(c);
        }

        // --- Planet 5: Distant World ---
        const palette5 = this.factory.generatePalette(null);
        const planet5 = this.factory.createPlanet(palette5, 60, -50, -120, 16, PLANETS[4].hasAtmosphere);
        this.world.add(planet5.group);
        this.islandGroups.push(planet5);
        this.groundPlanes.push(planet5.groundMesh);
        this.state.islands.push({
            center: planet5.center.clone(),
            radius: planet5.radius,
            groundMesh: planet5.groundMesh,
            floorY: 0,
            name: "DISTANT WORLD"
        });
        // C1: fresh world DNA for planet 5's flora/fauna shapes
        const planetDNA5 = this.factory.generateWorldDNA();

        for (let i = 0; i < 5; i++) {
            const pos = rndSurface(planet5, 2.0, 12.0);
            const e = this.factory.createTree(palette5, 0, 0, this._treeStyleFromDNA(planetDNA5, palette5));
            this.placeOnPlanet(e, planet5, pos);
            this.state.entities.push(e); this.world.add(e);
        }
        for (let i = 0; i < 4; i++) {
            const pos = rndSurface(planet5, 1.5, 12.0);
            const e = this.factory.createBush(palette5, 0, 0, this._bushStyleFromDNA(planetDNA5, palette5));
            this.placeOnPlanet(e, planet5, pos);
            this.state.entities.push(e); this.world.add(e);
        }
        for (let i = 0; i < 4; i++) {
            const pos = rndSurface(planet5, 1.5, 12.0);
            const e = this.factory.createRock(palette5, 0, 0, this._rockStyleFromDNA(planetDNA5, palette5));
            this.placeOnPlanet(e, planet5, pos);
            this.state.entities.push(e); this.world.add(e);
        }
        for (let i = 0; i < 18; i++) {
            const pos = rndSurface(planet5, 0.5, 13.0);
            const e = this.factory.createGrass(palette5, 0, 0, this._grassStyleFromDNA(planetDNA5, palette5));
            this.placeOnPlanet(e, planet5, pos);
            this.state.entities.push(e); this.world.add(e);
        }
        for (let i = 0; i < 5; i++) {
            const pos = rndSurface(planet5, 1.0, 12.0);
            const e = this.factory.createFlower(palette5, 0, 0);
            this.placeOnPlanet(e, planet5, pos);
            this.state.entities.push(e); this.world.add(e);
        }
        for (let i = 0; i < 3; i++) {
            const pos = rndSurface(planet5, 2.0, 10.0);
            const creatureDNA = this.factory.generateCreatureDNA(palette5, speciesTypes[i]);
            const c = this.factory.createCreature(palette5, 0, 0, creatureDNA);
            this.placeOnPlanet(c, planet5, pos);
            c.userData.boundCenter = planet5.center.clone();
            c.userData.boundRadius = planet5.radius * 0.85;
            c.userData.planet = planet5;
            this._applyTier(c, 4); // constants.PLANETS[4] DISTANT WORLD
            this.state.entities.push(c); this.world.add(c);
        }

        // --- Spawn player on planet 1 surface (top) ---
        const spawnNormal = new THREE.Vector3(0, 1, 0);
        const spawnPos = planet1.center.clone().add(spawnNormal.multiplyScalar(planet1.radius + 2));
        this.state.player.pos.copy(spawnPos);
        this.state.player.vel.set(0, 0, 0);
        this.state.player.onGround = false;
        this.state.player.cameraAngle = { x: 0, y: 0.3 };
        this.state.resources.logs = 0;

        // Reset combat state
        this.state.player.hp = 20;
        this.state.player.maxHp = 20;
        this.state.player.attack = 2;
        this.state.player.baseAttack = 2;
        this.state.player.speedBoost = 0;
        this.state.attackCooldown = 0;
        this.state.isAttacking = false;
        this.state.invincibleTimer = 0;
        this.state.isDead = false;
        this.state.deathTimer = 0;

        this.playerController.createModel(this.state.palette);

        // Spawn cat on planet 1 surface near player
        const catSurfacePos = SphericalUtils.randomSurfacePointNear(planet1, spawnPos, 1.0, 3.0);
        this.playerCat = this.factory.createCat(0, 0);
        this.playerCat.scale.set(0.15, 0.15, 0.15);
        this.placeOnPlanet(this.playerCat, planet1, catSurfacePos);
        this.state.entities.push(this.playerCat);
        this.world.add(this.playerCat);

        // Camera initial position
        const camPos = spawnPos.clone().add(new THREE.Vector3(0, 3, 6));
        this.world.camera.position.copy(camPos);
        this.world.camera.fov = CAMERA_FOV; // reset any residual FOV kick from a previous world
        this.world.camera.updateProjectionMatrix();

        if (!this.state.musicStarted) {
            this.audio.startMusic(this.state.worldDNA, this.ui.volSlider, this.ui.volIcon, this.ui.settingsBtn, this.ui.settingsPopup, this.audio);
            this.state.musicStarted = true;
        }

        if (seededOverride) seededOverride.restore();

        // Rebuild complete — safe again for animate() to touch the player model.
        this.state.isResettingWorld = false;
    }

    boardBoat(boat) {
        const ctx = { state: this.state, audio: this.audio, playerCat: this.playerCat, playerController: this.playerController };
        this.boatSystem.boardBoat(boat, ctx);
    }

    finishBoarding() {
        const ctx = { state: this.state, playerController: this.playerController };
        this.boatSystem.finishBoarding(ctx);
    }

    disembarkBoat() {
        const ctx = {
            state: this.state, audio: this.audio, playerController: this.playerController,
            playerCat: this.playerCat, factory: this.factory
        };
        this.boatSystem.disembarkBoat(ctx);
    }

    get _nearestBoat() {
        return this.boatSystem ? this.boatSystem.nearestBoat : null;
    }

    /**
     * A4: apply a planet's difficulty tier to a freshly spawned creature. planetIndex
     * matches the entry in constants.PLANETS (order: Starting, Flora, Ancient Peaks,
     * Rocky Outpost, Distant World). Multipliers are static — deterministic, no RNG.
     */
    _applyTier(creature, planetIndex) {
        const tier = PLANETS[planetIndex].tier;
        const mod = TIER_MODIFIERS[tier];
        creature.userData.hp *= mod.hp;
        creature.userData.contactDamage = CREATURE_CONTACT_DAMAGE * mod.dmg;
        creature.userData.aggroMult = mod.aggro;
        // Keep the hp multiplier itself (not just the scaled hp) so offspring can
        // re-derive their own tier-scaled hp from their own base hp at hatch time —
        // using the parent's current (possibly damaged) hp would pass the damage along.
        creature.userData.tierHpMult = mod.hp;
    }

    // =====================================================
    // C1: PER-PLANET WORLD DNA STYLE HELPERS
    // =====================================================
    // Each planet in initGame rolls its own worldDNA (planetDNA1..5) so tree/
    // bush/rock/grass shape differs per planet instead of sharing one session-
    // wide DNA. These build the exact "style" object shape each createX()
    // expects when style is passed explicitly — mirrors the fallback branches
    // in EntityFactory that read state.worldDNA when style is null, just fed
    // from a per-planet DNA object instead. Color is freshly cloned per call
    // so every instance owns its own THREE.Color (matches prior fallback
    // behavior, avoids aliasing across entities).
    _treeStyleFromDNA(dna, p) {
        return {
            color: p.flora.clone(), trunkColor: p.trunk.clone(), shape: dna.tree.shape,
            height: 1.5 * dna.tree.heightMod + Math.random() * 0.5, thickness: 0.2 * dna.tree.thickMod
        };
    }
    _bushStyleFromDNA(dna, p) {
        return { color: p.flora.clone(), shape: dna.bush.shape, scaleY: dna.bush.scaleY };
    }
    _rockStyleFromDNA(dna, p) {
        return { color: p.baseRock.clone(), shape: dna.rock.shape };
    }
    _grassStyleFromDNA(dna, p) {
        return { color: p.tallGrass.clone(), height: dna.grass.height };
    }
    _creatureStyleFromDNA(dna, p) {
        return {
            color: p.creature.clone(), bodyShape: dna.creature.shape, speciesType: dna.creature.speciesType,
            eyeCount: dna.creature.eyes, scale: dna.creature.scale, eyeScale: dna.creature.eyeScale,
            moveSpeed: dna.creature.moveSpeed, temperament: dna.creature.temperament
        };
    }

    repairShip() {
        const ctx = { state: this.state, audio: this.audio, factory: this.factory };
        const repaired = this.boatSystem.repairShip(ctx);
        if (repaired) this.updateInventory();
        return repaired;
    }

    updateIslandIndicator() {
        const state = this.state;
        const playerPos = state.isOnBoat ? state.activeBoat.position : state.player.pos;
        let currentIsland = null;

        for (const island of state.islands) {
            const dist = playerPos.distanceTo(island.center);
            if (dist < island.radius + 5) {
                currentIsland = island;
                break;
            }
        }

        if (currentIsland) {
            if (state.lastIslandName !== currentIsland.name) {
                state.lastIslandName = currentIsland.name;
                if (this.ui.islandIndicator) {
                    this.ui.islandIndicator.textContent = currentIsland.name;
                    this.ui.islandIndicator.style.display = 'block';
                    if (this.islandIndicatorTimeout) clearTimeout(this.islandIndicatorTimeout);
                    this.islandIndicatorTimeout = setTimeout(() => {
                        this.ui.islandIndicator.style.display = 'none';
                    }, 4000);
                }
            }
        } else {
            state.lastIslandName = null;
        }
    }

    // =====================================================
    // MULTIPLAYER
    // =====================================================

    _setupNetworkCallbacks() {
        this.network.onWelcome = (data) => {
            // welcome carries { id, seed } — NetworkManager assigns both to
            // this.network.playerId/worldSeed BEFORE invoking this callback, so
            // both are already valid to read here.
            const status = document.getElementById('mp-status');
            if (status) status.textContent = `Player #${data.id}`;
            this._showMultiplayerToast('Joined shared world');
            // Regenerate using the EXACT same path the "Reset World" button already
            // uses while connected: resetWorld() tears down the current world, then
            // initGame() (after its 800ms fx delay) reads this.network.worldSeed and
            // overrides Math.random via SeededRandom for the whole rebuild, producing
            // a bit-identical world across every client that shares this seed. Do not
            // build a second/parallel regen path — resetWorld() also clears
            // isOnBoat/isBoardingBoat/isDead-adjacent state, so a welcome that lands
            // mid-boarding-walk or mid-death-screen still ends in a consistent state.
            this.resetWorld();
        };
        this.network.onPlayerJoin = (id, data) => {
            this.remotePlayers.addPlayer(id, data);
            this._showMultiplayerToast(`Player ${id} joined`);
        };
        this.network.onPlayerLeave = (id) => {
            this.remotePlayers.removePlayer(id);
            this._showMultiplayerToast(`Player ${id} left`);
        };
        this.network.onPlayerUpdate = (id, data) => {
            this.remotePlayers.updatePlayer(id, data);
        };
        this.network.onWorldEvent = (event) => {
            this._handleRemoteWorldEvent(event);
        };
        this.network.onInventoryUpdate = (id, data) => {
            this.remotePlayers.updateInventory(id, data);
        };
        this.network.onChat = (id, text) => {
            this._handleRemoteChat(id, text);
        };
    }

    async connectMultiplayer(url) {
        if (this.network.connected) return;
        try {
            await this.network.connect(url);
            // network.connect() resolves on the WebSocket's onopen, which fires
            // BEFORE the server's 'welcome' message (id + seed) arrives over
            // onmessage — reading this.network.playerId here was always null.
            // The player-id status label and the world regen both happen in
            // onWelcome (_setupNetworkCallbacks) once the real id/seed land.
            const btn = document.getElementById('mp-connect-btn');
            if (btn) { btn.textContent = 'DISCONNECT'; btn.classList.add('connected'); }
            if (this.ui.mpChat) this.ui.mpChat.style.display = 'flex';
        } catch (err) {
            console.error('[Multiplayer] Connection failed:', err);
            this._showMultiplayerToast('Connection failed!');
        }
    }

    disconnectMultiplayer() {
        this.network.disconnect();
        this.remotePlayers.clear();
        const btn = document.getElementById('mp-connect-btn');
        if (btn) { btn.textContent = 'CONNECT'; btn.classList.remove('connected'); }
        const status = document.getElementById('mp-status');
        if (status) status.textContent = 'Offline';
        this._showMultiplayerToast('Disconnected');
        if (this.ui.mpChat) this.ui.mpChat.style.display = 'none';
        if (this.ui.mpChatInput) this.ui.mpChatInput.blur();
    }

    /**
     * Wire the multiplayer chat log + input (near #mp-panel). Only visible while
     * network.connected (toggled in connectMultiplayer/disconnectMultiplayer above).
     *
     * Scheme: Enter opens the input (when connected, not already typing, and no
     * other text field/dialog has focus) or click it directly; Enter inside it
     * sends and blurs; Escape blurs without sending. Documented in the input's
     * own placeholder text.
     *
     * Focus gating: InputHandler.setupKeyboard() early-returns on every game
     * keydown/keyup while document.activeElement is this input (see
     * InputHandler._isChatFocused), so typing here never moves the player or
     * triggers game binds.
     */
    _setupChatUI() {
        const chatWrap = document.getElementById('mp-chat');
        const log = document.getElementById('mp-chat-log');
        const input = document.getElementById('mp-chat-input');
        if (!chatWrap || !log || !input) return;

        this.ui.mpChat = chatWrap;
        this.ui.mpChatLog = log;
        this.ui.mpChatInput = input;

        const MAX_LOG_LINES = 8;
        this._appendChatLine = (id, text) => {
            const line = document.createElement('div');
            line.className = 'mp-chat-line';
            line.textContent = `Player ${id}: ${text}`;
            log.appendChild(line);
            while (log.children.length > MAX_LOG_LINES) log.removeChild(log.firstChild);
            log.scrollTop = log.scrollHeight;
        };

        const send = () => {
            const text = input.value.trim().slice(0, 200);
            if (text) this.network.sendChat(text);
            input.value = '';
            input.blur();
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); send(); } else if (e.key === 'Escape') { input.blur(); }
        });

        // Pointer lock and a focused text field don't mix well — drop it so the
        // cursor/keyboard are usable, mirroring what happens when the NPC chat
        // dialog or a dialog-box opens.
        input.addEventListener('focus', () => {
            if (document.pointerLockElement) document.exitPointerLock();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            if (!this.network.connected) return;
            if (this.state.phase !== 'playing') return;
            if (this.chatManager && this.chatManager.isOpen) return;
            const dialog = document.getElementById('dialog-box');
            if (dialog && dialog.style.display === 'flex') return;
            const active = document.activeElement;
            // Already focused here (this keydown will be handled by the listener
            // above instead) or focused on some other text field (mp-url, the NPC
            // chat input, etc.) — don't steal focus in either case.
            if (active && (active === input || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
            input.focus();
        });
    }

    /**
     * Handle an incoming chat message (server relays 'chat' to EVERY client,
     * including the sender — unlike world_event — so this is the single source
     * of truth for both remote and our own echoed messages; sendChat() never
     * appends optimistically).
     */
    _handleRemoteChat(id, text) {
        if (!text) return;
        const safeText = String(text).slice(0, 200);
        if (this._appendChatLine) this._appendChatLine(id, safeText);
        if (id !== this.network.playerId) {
            this.remotePlayers.showChatBubble(id, safeText);
        }
    }

    _showMultiplayerToast(msg) {
        let toast = document.getElementById('mp-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'mp-toast';
            toast.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:#0f0;padding:8px 20px;border-radius:4px;font-family:monospace;font-size:13px;z-index:9999;transition:opacity 0.5s;pointer-events:none;';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.style.opacity = '1';
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
    }

    _handleRemoteWorldEvent(event) {
        switch (event.action) {
            case 'tree_chopped': {
                const idx = this.state.entities.findIndex(e =>
                    e.userData.type === 'tree' &&
                    Math.abs(e.position.x - event.x) < 2 &&
                    Math.abs(e.position.z - event.z) < 2
                );
                if (idx !== -1) {
                    const tree = this.state.entities[idx];
                    this.world.scene.remove(tree);
                    this.state.entities.splice(idx, 1);
                    const oi = this.state.obstacles.indexOf(tree);
                    if (oi !== -1) this.state.obstacles.splice(oi, 1);
                }
                break;
            }
            case 'rock_mined': {
                const idx = this.state.entities.findIndex(e =>
                    (e.userData.type === 'rock' || e.userData.type === 'gold_rock') &&
                    Math.abs(e.position.x - event.x) < 2 &&
                    Math.abs(e.position.z - event.z) < 2
                );
                if (idx !== -1) {
                    const rock = this.state.entities[idx];
                    this.world.scene.remove(rock);
                    this.state.entities.splice(idx, 1);
                    const oi = this.state.obstacles.indexOf(rock);
                    if (oi !== -1) this.state.obstacles.splice(oi, 1);
                }
                break;
            }
            case 'player_attack': {
                if (event.targetId === this.network.playerId) {
                    const ctx = { state: this.state, audio: this.audio, playerController: this.playerController };
                    const sourcePos = event.x !== undefined ? { x: event.x, y: 0, z: event.z } : null;
                    this.combatSystem._damagePlayer(event.damage || 2, ctx, sourcePos);
                }
                break;
            }
            case 'log_placed': {
                // Visual sync only: NOT pushed into this.logs, which drives THIS
                // client's own checkForBoat() clustering — counting a remote
                // player's logs toward a local build could let two clients each
                // independently detect the same cluster and broadcast their own
                // ship_built for it.
                const pos = new THREE.Vector3(event.x, event.y || 0, event.z);
                const color = new THREE.Color(event.colorHex !== undefined ? event.colorHex : 0x8B4513);
                const log = this.factory.createLog(color, 0, 0);
                log.position.copy(pos);
                const result = SphericalUtils.findNearestPlanet(pos, this.state.islands);
                if (result && result.planet) {
                    const normal = SphericalUtils.getSurfaceNormal(pos, result.planet);
                    log.quaternion.copy(SphericalUtils.getOrientationOnSurface(normal));
                    log.userData.planet = result.planet;
                }
                this.world.add(log);
                this.state.entities.push(log);
                break;
            }
            case 'ship_built': {
                const pos = new THREE.Vector3(event.x, event.y || 0, event.z);
                // Drop any of THIS client's own log entities (including ones synced
                // via 'log_placed' above) that the other player's build just consumed
                // — mirrors the tree_chopped/rock_mined position-scan pattern.
                for (let i = this.state.entities.length - 1; i >= 0; i--) {
                    const e = this.state.entities[i];
                    if (e.userData.type === 'log' && e.position.distanceTo(pos) < SHIP_LOG_CLUSTER_RADIUS) {
                        this.world.scene.remove(e);
                        this.state.entities.splice(i, 1);
                        const li = this.logs.indexOf(e);
                        if (li > -1) this.logs.splice(li, 1);
                    }
                }
                const color = new THREE.Color(event.colorHex !== undefined ? event.colorHex : 0xffffff);
                const boat = this.factory.createSpaceship(pos.x, pos.y, pos.z, color);
                if (event.qx !== undefined) {
                    boat.quaternion.set(event.qx, event.qy, event.qz, event.qw);
                }
                this.world.add(boat);
                // Registered exactly like a locally-built ship (state.entities) so
                // other players — including this client — can walk up and board it.
                this.state.entities.push(boat);
                this.audio.boatBuild();
                break;
            }
        }
    }

    broadcastWorldEvent(action, x, z, extra) {
        this.network.sendWorldEvent({ action, x, z, ...extra });
    }

    _broadcastInventory() {
        this.network.sendInventoryUpdate(this.state.inventory, this.state.selectedSlot);
    }

    animate(t) {
        requestAnimationFrame(this.animate);
        t *= 0.001;
        const state = this.state;
        const camera = this.world.camera;

        if (!this._lastTime) this._lastTime = t;
        const dt = Math.min(t - this._lastTime, 0.05);
        this._lastTime = t;

        if (state.phase === 'playing') {
            // No water animation in space
            // No cloud animation in space

            // Build shared context for all systems
            const ctx = {
                state,
                world: this.world,
                audio: this.audio,
                factory: this.factory,
                camera,
                playerController: this.playerController,
                playerCat: this.playerCat,
                remotePlayers: this.remotePlayers,
                t,
                broadcastWorldEvent: (action, x, z, extra) => this.broadcastWorldEvent(action, x, z, extra)
            };

            // Skip every system below that touches the player model while
            // resetWorld() has torn it down and initGame() hasn't rebuilt it yet.
            // resetWorld() nulls playerController.playerGroup but leaves other
            // cached refs (e.g. modelPivot) stale-truthy, so a couple of call
            // sites that check modelPivot but then dereference playerGroup
            // unconditionally (getForward() below, ChopSystem's swing-facing
            // slerp) throw during this ~800ms gap. Particles/network/remote
            // players are left running outside this guard so reset debris/FX
            // keep animating and multiplayer state keeps flowing.
            if (!state.isResettingWorld) {
                // Boat/spaceship system
                this.boatSystem.update(dt, ctx);

                // Player movement & interaction
                if (state.isOnBoat) {
                    // Boat system handles everything
                } else if (!state.isBoardingBoat) {
                    this.playerController.update(dt, state.islands);
                    this.playerController.updateCamera(camera, dt);
                    this.input.updateInteraction();
                    this.chopSystem.update(dt, ctx);
                    this.mineSystem.update(dt, ctx);
                    this.inventorySystem.update(dt, ctx);
                }

                // Update player forward direction for combat targeting.
                // First person: read the camera's exact look direction (full 3D, pitch
                // included) instead of the animated model's facing — the model's yaw is
                // smoothed (slerp) toward the camera each frame, which is fine visually
                // but adds a frame or two of lag that makes quick flick-shots whiff. The
                // crosshair should always hit what it's actually centered on right now.
                if (state.player.cameraMode === 'first' && !state.isOnBoat) {
                    const aimForward = new THREE.Vector3();
                    camera.getWorldDirection(aimForward);
                    state._playerForward = aimForward;
                } else {
                    state._playerForward = this.playerController.getForward();
                }

                // Combat
                this.combatSystem.update(dt, ctx);
                this.updateIslandIndicator();

                // Entity AI
                this.entityAISystem.update(dt, ctx);

                // Cat AI
                this.catAI.update(dt, ctx);
            }

            // Particles & debris — kept outside the guard above so the reset's own
            // explosion FX (spawned into state.debris just before this window opens)
            // keeps animating through the gap instead of freezing.
            this.particleSystem.update(dt, ctx);

            // Multiplayer
            this.network.sendPlayerState(state);
            this.remotePlayers.update(dt, state.islands);

            if (this._lastSelectedSlot !== state.selectedSlot) {
                this._lastSelectedSlot = state.selectedSlot;
                this._broadcastInventory();
            }
        }
        this.world.render();
    }
}
