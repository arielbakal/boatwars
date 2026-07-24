// =====================================================
// INPUT HANDLER - Controls adapted for spherical planets
// =====================================================

import SphericalUtils from './SphericalUtils.js';
import { SHIP_COLLISION_RADIUS, MINABLE_ROCK_TYPES } from '../constants.js';

export default class InputHandler {
    constructor(engine) {
        this.engine = engine;
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.setupKeyboard();
        this.setupMouse();
        this.setupTouch();
    }

    /** Returns the item type of the currently selected inventory slot, or null */
    getSelectedType() {
        const state = this.engine.state;
        if (state.selectedSlot === null) return null;
        const item = state.inventory[state.selectedSlot];
        return item ? item.type : null;
    }

    /**
     * True while keyboard input belongs to the UI instead of the game: typing in
     * the multiplayer chat input or the join-name field, or whenever the join
     * overlay is up (it blocks the mouse via z-index, but keydowns would still
     * reach the world behind it — e.g. after clicking JOIN moves focus off the
     * name field). Gates every game keybind below (w/a/s/d/space/shift, ship
     * pitch, inventory digits, escape, g, c, e, r).
     */
    _isChatFocused() {
        const overlay = document.getElementById('join-overlay');
        if (overlay && !overlay.classList.contains('hidden')) return true;
        if (!document.activeElement) return false;
        const id = document.activeElement.id;
        return id === 'mp-chat-input' || id === 'join-name';
    }

    setupKeyboard() {
        const state = this.engine.state;
        const sfx = this.engine.audio;
        document.addEventListener('keydown', (e) => {
            if (this._isChatFocused()) return;
            const k = e.key.toLowerCase();
            if (k === 'w') state.inputs.w = true;
            if (k === 'a') state.inputs.a = true;
            if (k === 's') state.inputs.s = true;
            if (k === 'd') state.inputs.d = true;
            if (k === ' ') state.inputs.space = true;
            if (k === 'shift') state.inputs.shift = true;
            // Ship pitch — nose up/down (Arrow keys or R/F). Only while on a boat: R
            // doubles as the on-foot repair key, so setting pitchUp unconditionally
            // would leave it stuck true if the player boards mid-hold (before keyup).
            if ((k === 'arrowup' || k === 'r') && state.isOnBoat) { state.inputs.pitchUp = true; e.preventDefault(); }
            if ((k === 'arrowdown' || k === 'f') && state.isOnBoat) { state.inputs.pitchDown = true; e.preventDefault(); }
            // Inventory slots
            const idx = parseInt(k) - 1;
            if (idx >= 0 && idx < 8) {
                if (state.selectedSlot === idx) { state.selectedSlot = null; sfx.select(); }
                else if (state.inventory[idx]) { state.selectedSlot = idx; sfx.select(); }
                this.engine.updateInventory();
                this._updateHeldToolVisual();
            }
            // ESC to exit pointer lock (browser handles this, we just update UI in pointerlockchange)
            if (k === 'escape') {
                if (document.pointerLockElement) document.exitPointerLock();
                const d = document.getElementById('dialog-box');
                if (d && d.style.display === 'flex') {
                    d.style.display = 'none';
                    return; // Don't process other inputs if closing dialog
                }
            }
            // G to toggle camera mode (First/Third person)
            if (k === 'g' && state.phase === 'playing') {
                state.player.cameraMode = state.player.cameraMode === 'third' ? 'first' : 'third';
                sfx.select();
                // If switching to first person, reset vertical angle for better view
                if (state.player.cameraMode === 'first') state.player.cameraAngle.y = 0.0;
            }
            // C to toggle ship camera mode (chase / cockpit)
            if (k === 'c' && state.phase === 'playing' && state.isOnBoat) {
                state.shipCameraMode = state.shipCameraMode === 'chase' ? 'cockpit' : 'chase';
                sfx.select();
            }
            // E to pick up nearby tool OR board/exit boat
            if (k === 'e' && state.phase === 'playing' && !state.isBoardingBoat) {
                if (this._nearestTool) {
                    this._pickupNearestTool();
                } else if (state.isOnBoat) {
                    this.engine.disembarkBoat();
                } else if (this.engine._nearestBoat) {
                    this.engine.boardBoat(this.engine._nearestBoat);
                }
            }
            // R to repair a nearby landed ship with gold (on foot only — while
            // flying, R/ArrowUp already means ship pitch-up, handled above).
            // Guard against OS key auto-repeat so holding R doesn't cascade-drain gold.
            if (k === 'r' && state.phase === 'playing' && !state.isOnBoat && !state.isBoardingBoat && !e.repeat) {
                this.engine.repairShip();
            }
        });
        document.addEventListener('keyup', (e) => {
            if (this._isChatFocused()) return;
            const k = e.key.toLowerCase();
            if (k === 'w') state.inputs.w = false;
            if (k === 'a') state.inputs.a = false;
            if (k === 's') state.inputs.s = false;
            if (k === 'd') state.inputs.d = false;
            if (k === ' ') state.inputs.space = false;
            if (k === 'shift') state.inputs.shift = false;
            if (k === 'arrowup' || k === 'r') state.inputs.pitchUp = false;
            if (k === 'arrowdown' || k === 'f') state.inputs.pitchDown = false;
        });
    }

    /**
     * Update the visual tool held in the player's hand based on selected inventory slot.
     * Shows axe/pickaxe model when its slot is selected, hides otherwise.
     */
    _updateHeldToolVisual() {
        const state = this.engine.state;
        const type = this.getSelectedType();
        const pc = this.engine.playerController;

        if (!type) {
            // Nothing selected — clear held item
            if (this._heldToolType) {
                pc.holdItem(null);
                this._heldToolType = null;
            }
            return;
        }

        // Don't rebuild if same type already held
        if (this._heldToolType === type) return;

        let item = null;

        if (type === 'axe' || type === 'pickaxe' || type === 'sword') {
            if (type === 'axe') {
                item = this.engine.factory.createAxe(state.palette, 0, 0);
            } else if (type === 'sword') {
                item = this.engine.factory.createSword(state.palette, 0, 0);
            } else {
                item = this.engine.factory.createPickaxe(state.palette, 0, 0);
            }
            this.engine.world.remove(item);
            // C2: Scale up the held tool so it reads at a believable hand-held size.
            // The factory creates world-scale props (small); 1.8x makes the axe legible in hand.
            // C3: The item is held in handAnchorR (on armR at -0.35 X). With the model facing +Z,
            // -X is the character's RIGHT hand (correct — armR = character's right arm).
            // Convention is correct; no geometry change needed.
            const heldScale = (type === 'axe') ? 1.8 : 1.5;
            item.scale.setScalar(heldScale);
            item.position.set(0, 0, 0);
            item.rotation.set(0, 0, 0);
        } else {
            // Build a simple held-item mesh for non-tool items
            const invItem = state.inventory[state.selectedSlot];
            if (!invItem) return;
            const color = invItem.color || new THREE.Color(0xffffff);
            const mat = new THREE.MeshToonMaterial({ color });
            item = new THREE.Group();

            switch (type) {
                case 'wood':
                case 'log': {
                    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 6), mat);
                    item.add(mesh);
                    break;
                }
                case 'rock': {
                    const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.1), mat);
                    item.add(mesh);
                    break;
                }
                case 'food': {
                    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), mat);
                    item.add(mesh);
                    break;
                }
                default: {
                    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), mat);
                    item.add(mesh);
                    break;
                }
            }
        }

        pc.holdItem(item);
        this._heldToolType = type;
    }

    /**
     * Pick up the nearest tool (axe/pickaxe) from the ground into inventory.
     * Called when E key is pressed and _nearestTool is set.
     */
    _pickupNearestTool() {
        const tool = this._nearestTool;
        if (!tool) return;

        const state = this.engine.state;
        const world = this.engine.world;
        const sfx = this.engine.audio;
        const factory = this.engine.factory;

        const success = this.engine.addToInventory(tool.userData.type, tool.userData.color || new THREE.Color(0x5d4037), null);
        if (success) {
            sfx.pickup();
            // Particles
            for (let i = 0; i < 15; i++) factory.createParticle(tool.position.clone(), tool.userData.color || new THREE.Color(0x5d4037), 1.0);
            // Remove from world
            const idx = state.entities.indexOf(tool);
            if (idx > -1) state.entities.splice(idx, 1);
            world.remove(tool);
            // Auto-select the tool slot
            const toolSlot = state.inventory.findIndex(item => item && item.type === tool.userData.type);
            if (toolSlot !== -1) {
                state.selectedSlot = toolSlot;
                this.engine.updateInventory();
                this._updateHeldToolVisual();
            }
            this._nearestTool = null;
        } else {
            sfx.pop();
            // Surface the failure — a silent pop reads as a broken key.
            this._inventoryFullUntil = performance.now() + 1500;
        }
    }

    setupMouse() {
        const renderer = this.engine.world.renderer;
        const state = this.engine.state;
        const cursor = document.getElementById('custom-cursor');

        // Request pointer lock on click
        renderer.domElement.addEventListener('click', () => {
            if (state.phase === 'playing' && !document.pointerLockElement) {
                // Don't lock if clicking on UI/Dialog
                const d = document.getElementById('dialog-box');
                if (d && d.style.display === 'flex') return;

                renderer.domElement.requestPointerLock();
            }
        });

        // Camera control via mouse movement when locked
        document.addEventListener('mousemove', (e) => {
            if (state.phase !== 'playing') return;
            state.mouseX = e.clientX;
            state.mouseY = e.clientY;

            // Camera orbit / look
            if (document.pointerLockElement === renderer.domElement) {
                state.player.cameraAngle.x -= e.movementX * state.sensitivity;
                if (state.player.cameraMode === 'first') {
                    // FPS: mouse up (negative movementY) = look up (decrease ca.y)
                    state.player.cameraAngle.y -= e.movementY * state.sensitivity;
                    state.player.cameraAngle.y = Math.max(-1.5, Math.min(1.5, state.player.cameraAngle.y));
                } else {
                    // TPS: mouse up = orbit higher
                    state.player.cameraAngle.y += e.movementY * state.sensitivity;
                    state.player.cameraAngle.y = Math.max(-0.3, Math.min(1.5, state.player.cameraAngle.y));
                }
            } else {
                // Update custom cursor position
                if (cursor) {
                    cursor.style.left = e.clientX + 'px';
                    cursor.style.top = e.clientY + 'px';
                }
            }
        });

        // Scroll — cycle inventory
        window.addEventListener('wheel', (e) => {
            if (state.phase !== 'playing') return;
            if (e.deltaY > 0) state.selectedSlot = (state.selectedSlot === null ? 0 : (state.selectedSlot + 1) % 8);
            else state.selectedSlot = (state.selectedSlot === null ? 7 : (state.selectedSlot + 7) % 8);
            if (!state.inventory[state.selectedSlot]) {
                for (let i = 0; i < 8; i++) { if (state.inventory[i]) { state.selectedSlot = i; break; } }
            }
            this.engine.audio.select();
            this.engine.updateInventory();
            this._updateHeldToolVisual();
        });

        // --- Pointer lock change handler ---
        document.addEventListener('pointerlockchange', () => {
            if (document.pointerLockElement === renderer.domElement) {
                cursor.style.display = 'none';
            } else {
                cursor.style.display = 'block';
                cursor.style.left = state.mouseX + 'px';
                cursor.style.top = state.mouseY + 'px';
            }
        });

        // Left click: start chopping/mining or interaction
        renderer.domElement.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (state.phase !== 'playing') return;
            if (!document.pointerLockElement) return;
            if (state.isOnBoat) return;
            if (state.isDead) return;
            // The scripted boarding walk drives player.pos itself (BoatSystem.
            // updateBoardingAnimation) — updateInteraction() also doesn't run during
            // it, so interactionTarget/chop/mine state is stale and tryAttack would
            // read a crosshair that isn't actually pointed anywhere meaningful
            // (invisible, misaimed attacks reported during the walk).
            if (state.isBoardingBoat) return;

            const selectedType = this.getSelectedType();

            // Start chopping if interactionTarget is a choppable tree AND axe slot selected
            if (state.interactionTarget && state.interactionTarget.userData.choppable && selectedType === 'axe') {
                state.isChopping = true;
                state.chopTimer = 0;
                return;
            }

            // Mining — pickaxe must be selected
            if (selectedType === 'pickaxe' && state.interactionTarget) {
                const type = state.interactionTarget.userData.type;
                if (MINABLE_ROCK_TYPES.includes(type)) {
                    state.isMining = true;
                    state.mineTimer = 0;
                    return;
                }
            }

            // Try melee attack on nearby creatures/players (always attempt before interaction)
            if (this.engine.combatSystem) {
                const ctx = {
                    state,
                    audio: this.engine.audio,
                    factory: this.engine.factory,
                    world: this.engine.world,
                    remotePlayers: this.engine.remotePlayers,
                    broadcastWorldEvent: (action, x, z, extra) => this.engine.broadcastWorldEvent(action, x, z, extra)
                };
                // Always try attack first — if it hits, skip interaction
                if (this.engine.combatSystem.tryAttack(ctx)) return;
            }

            // Otherwise, interact/pickup
            this.handleInteraction();
        });

        renderer.domElement.addEventListener('mouseup', (e) => {
            if (e.button !== 0) return;
            state.isChopping = false;
            state.isMining = false;
        });
    }

    handleInteraction() {
        const state = this.engine.state;
        const world = this.engine.world;
        const factory = this.engine.factory;
        const sfx = this.engine.audio;

        // Set up raycaster from camera center
        this.raycaster.setFromCamera(new THREE.Vector2(0, 0), world.camera);

        const playerPos = state.player.pos;

        // If holding a placeable item in inventory, try to place it
        if (state.selectedSlot !== null && state.inventory[state.selectedSlot]) {
            const selectedType = this.getSelectedType();
            // Don't place tools — they are "used" not "placed"
            if (selectedType !== 'axe' && selectedType !== 'pickaxe' && selectedType !== 'sword') {
                this.handlePlace();
                return;
            }
        }

        // Otherwise, try to pick up nearby items
        this.handlePickup();
    }

    handlePlace() {
        const state = this.engine.state;
        const world = this.engine.world;
        const factory = this.engine.factory;
        const sfx = this.engine.audio;
        const it = state.inventory[state.selectedSlot];
        if (!it) return;

        // Check ground planes (planet surfaces) for placement
        const allHits = [];
        this.engine.groundPlanes.forEach(gp => {
            const hits = this.raycaster.intersectObject(gp);
            hits.forEach(h => allHits.push(h));
        });
        allHits.sort((a, b) => a.distance - b.distance);

        if (allHits.length && allHits[0].distance < 12) {
            sfx.place();
            const p = allHits[0].point;
            const ent = this.createEntityFromItem(it, p);
            if (ent) {
                for (let i = 0; i < 8; i++) factory.createParticle(p, it.color);
                it.count = (it.count || 1) - 1;
                if (it.count <= 0) { state.inventory[state.selectedSlot] = null; state.selectedSlot = null; }
                this.engine.updateInventory();
                this._updateHeldToolVisual();
            }
        }
    }

    handlePickup() {
        const state = this.engine.state;
        const world = this.engine.world;
        const factory = this.engine.factory;
        const sfx = this.engine.audio;

        // Check foods
        const foodHits = this.raycaster.intersectObjects(state.foods, true);
        if (foodHits.length && foodHits[0].distance < 8) {
            const f = foodHits[0].object;
            sfx.pickup();
            const color = f.material.color;
            const success = this.engine.addToInventory('food', color, null, 0);
            if (success) {
                const center = f.position.clone();
                for (let i = 0; i < 15; i++) factory.createParticle(center, color, 1.0);
                world.remove(f);
                const idx = state.foods.indexOf(f);
                if (idx > -1) state.foods.splice(idx, 1);
            } else sfx.pop();
            return;
        }

        // Check entities
        const hits = this.raycaster.intersectObjects(state.entities, true);
        if (hits.length && hits[0].distance < 8) {
            let root = hits[0].object;
            while (root.parent && root.parent !== world.scene) root = root.parent;

            if (root.userData.type === 'chief') {
                document.exitPointerLock();
                // Close old dialog if open
                const d = document.getElementById('dialog-box');
                if (d) d.style.display = 'none';

                // Open Chat
                this.engine.chatManager.openChat(root);
                sfx.sing();
                return;
            }

            if (root.userData.type === 'golem') {
                document.exitPointerLock();
                const d = document.getElementById('dialog-box');
                if (d) {
                    d.style.display = 'flex';
                    document.getElementById('dialog-text').innerHTML = "STONE GOLEM:<br>" + (root.userData.dialog || "...");
                }
                sfx.sing(); // reuse sing or pick another sound
                return;
            }

            if (root.userData.type === 'boat' || root.userData.type === 'spaceship') {
                // Spaceships are boarded with E key, not picked up
                return;
            }

            // Axe / Pickaxe / Sword — pick up into inventory
            if (root.userData.type === 'axe' || root.userData.type === 'pickaxe' || root.userData.type === 'sword') {
                const dist = state.player.pos.distanceTo(root.position);
                if (dist < 4) {
                    const success = this.engine.addToInventory(root.userData.type, root.userData.color || new THREE.Color(0x5d4037), null);
                    if (success) {
                        sfx.pickup();
                        const idx = state.entities.indexOf(root);
                        if (idx > -1) state.entities.splice(idx, 1);
                        world.remove(root);
                        // Auto-select the tool slot we just picked up
                        const toolSlot = state.inventory.findIndex(item => item && item.type === root.userData.type);
                        if (toolSlot !== -1) {
                            state.selectedSlot = toolSlot;
                            this.engine.updateInventory();
                            this._updateHeldToolVisual();
                        }
                    } else {
                        sfx.pop();
                    }
                }
                return;
            }

            // Don't pick up creatures — they are attackable, not collectible
            if (root.userData.type === 'creature') return;
            // The sun is scenery/hazard, not an item (no color either — storing
            // it would crash the inventory renderer on color.getHexString)
            if (root.userData.type === 'sun') return;

            if (root.userData.type && root.userData.type !== 'tree') {
                sfx.pickup();
                let styleData = root.userData.style;
                if (root.userData.type === 'egg') styleData = root.userData.parentDNA;
                const pickupType = root.userData.type;
                const invType = pickupType === 'log' ? 'wood' : pickupType;
                const success = this.engine.addToInventory(invType, root.userData.color, styleData, root.userData.age);
                if (success) {
                    const center = root.position.clone();
                    center.y += 0.5;
                    for (let i = 0; i < 25; i++) factory.createParticle(center, root.userData.color, 1.5);
                    world.remove(root);
                    const idx = state.entities.indexOf(root);
                    if (idx > -1) state.entities.splice(idx, 1);
                    if (state.obstacles.includes(root)) state.obstacles.splice(state.obstacles.indexOf(root), 1);
                    // Remove from logs array if it's a log
                    if (pickupType === 'log') {
                        const logIdx = this.engine.logs.indexOf(root);
                        if (logIdx > -1) this.engine.logs.splice(logIdx, 1);
                        this.updateBuildProgress();
                    }
                } else sfx.pop();
            }
        }
    }

    createEntityFromItem(it, p) {
        const state = this.engine.state;
        const world = this.engine.world;
        const factory = this.engine.factory;
        let ent = null;

        // Find nearest planet to placement point for orientation
        const result = SphericalUtils.findNearestPlanet(p, state.islands);
        const planet = result ? result.planet : null;

        if (it.type === 'tree') ent = factory.createTree(state.palette, 0, 0, it.style);
        if (it.type === 'bush') ent = factory.createBush(state.palette, 0, 0, it.style);
        if (it.type === 'rock') ent = factory.createRock(state.palette, 0, 0, it.style);
        if (it.type === 'grass') ent = factory.createGrass(state.palette, 0, 0, it.style);
        if (it.type === 'flower') ent = factory.createFlower(state.palette, 0, 0, it.style);
        if (it.type === 'wood' || it.type === 'log') {
            ent = factory.createLog(it.color, 0, 0);
            // Deliberately placed logs must not magnetize back into the
            // inventory (createLog stamps autoPickup for tree drops) — the
            // place/re-pickup loop made the hotbar count bounce +1 forever and
            // made ship-log clusters impossible to lay down near the player.
            // Misplaced logs can still be collected by clicking them.
            ent.userData.autoPickup = false;
            this.engine.logs.push(ent);
        }
        if (it.type === 'creature') {
            ent = factory.createCreature(state.palette, 0, 0, it.style);
            if (it.age) ent.userData.age = it.age;
        }
        if (it.type === 'egg') {
            ent = factory.createEgg(p, it.color, it.style);
        }
        if (it.type === 'food') {
            ent = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15), factory.getMat(it.color));
            ent.position.copy(p);
            ent.scale.set(0, 0, 0);
            if (planet) ent.userData.planet = planet;
            world.add(ent);
            state.foods.push(ent);
            return ent;
        }

        if (ent) {
            // Orient on planet surface
            if (planet) {
                const normal = SphericalUtils.getSurfaceNormal(p, planet);
                const heightOffset = ent.userData.heightOffset || 0;
                const surfPos = planet.center.clone().add(normal.clone().multiplyScalar(planet.radius + heightOffset));
                ent.position.copy(surfPos);
                const q = SphericalUtils.getOrientationOnSurface(normal);
                ent.quaternion.copy(q);
                ent.userData.planet = planet;
            } else {
                ent.position.copy(p);
            }
            world.add(ent);
            state.entities.push(ent);

            // Check for spaceship building after placing logs
            if (it.type === 'wood' || it.type === 'log') {
                // Log placement itself was never broadcast (only tree/rock REMOVAL and,
                // as of this unit, ship_built are) — mirror the tree_chopped/rock_mined
                // world_event pattern so other clients can actually see this log too.
                this.engine.broadcastWorldEvent('log_placed', ent.position.x, ent.position.z, {
                    y: ent.position.y,
                    colorHex: (ent.userData.color || it.color || new THREE.Color(0x8B4513)).getHex()
                });
                this.checkForBoat();
                this.updateBuildProgress();
            }
        }
        return ent;
    }

    checkForBoat() {
        const logs = this.engine.logs;
        if (logs.length < 4) return;

        const world = this.engine.world;
        const factory = this.engine.factory;
        const sfx = this.engine.audio;
        const state = this.engine.state;

        const boatRadius = 5;
        const visited = new Set();

        for (let i = 0; i < logs.length; i++) {
            if (visited.has(i)) continue;
            const cluster = [i];
            visited.add(i);

            for (let j = i + 1; j < logs.length; j++) {
                if (visited.has(j)) continue;
                const dist = logs[i].position.distanceTo(logs[j].position);
                if (dist < boatRadius) {
                    cluster.push(j);
                    visited.add(j);
                }
            }

            if (cluster.length >= 4) {
                let center = new THREE.Vector3();
                let boatColor = logs[cluster[0]].userData.color;
                cluster.forEach(idx => {
                    center.add(logs[idx].position);
                    world.remove(logs[idx]);
                    const entIdx = state.entities.indexOf(logs[idx]);
                    if (entIdx > -1) state.entities.splice(entIdx, 1);
                });
                center.divideScalar(cluster.length);

                // Create spaceship resting on the planet surface, oriented flush to it
                const result = SphericalUtils.findNearestPlanet(center, state.islands);
                let spawnPos = center.clone();
                let surfaceNormal = null;
                if (result && result.planet) {
                    surfaceNormal = SphericalUtils.getSurfaceNormal(center, result.planet);
                    // Rest the belly on the surface (radius + collision radius), not a magic offset
                    spawnPos = result.planet.center.clone().add(
                        surfaceNormal.clone().multiplyScalar(result.planet.radius + SHIP_COLLISION_RADIUS)
                    );
                }

                const boat = factory.createSpaceship(spawnPos.x, spawnPos.y, spawnPos.z, boatColor);
                // Orient the ship flush to the surface (Y-up = surface normal) so it
                // doesn't stand upright in world space regardless of the planet face.
                if (surfaceNormal) {
                    boat.quaternion.copy(SphericalUtils.getOrientationOnSurface(surfaceNormal));
                }
                world.add(boat);
                state.entities.push(boat);
                sfx.boatBuild();

                // Sync the build to other clients: they spawn the identical ship
                // (same color + orientation) and drop any of their own copies of the
                // logs it consumed. world_event already excludes the sender server-side
                // (server/index.js's broadcast(ws, ...) for 'world_event'), so there's
                // no self-echo to guard against here.
                this.engine.broadcastWorldEvent('ship_built', spawnPos.x, spawnPos.z, {
                    y: spawnPos.y,
                    colorHex: boatColor.getHex(),
                    qx: boat.quaternion.x, qy: boat.quaternion.y, qz: boat.quaternion.z, qw: boat.quaternion.w
                });
                for (let k = 0; k < 30; k++) {
                    factory.createParticle(spawnPos.clone(), boatColor, 2.0);
                }

                // Clean up logs array
                const clusterSet = new Set(cluster);
                this.engine.logs = this.engine.logs.filter((_, idx) => !clusterSet.has(idx));
                this.updateBuildProgress();
                return;
            }
        }
    }

    updateBuildProgress() {
        const logCount = this.engine.logs.length;
        const progress = this.engine.ui.boatBuildProgress;
        if (progress) {
            if (logCount > 0 && logCount < 4) {
                progress.style.display = 'block';
                progress.textContent = `🪵 LOGS: ${logCount}/4`;
            } else {
                progress.style.display = 'none';
            }
        }
    }

    /**
     * Show the center-screen aim reticle only in first person while actually
     * mouselooking (pointer locked). Not on the ship — boarding/boarding disembark
     * hides it explicitly (BoatSystem.boardBoat) since this runs only on foot.
     * Gated on pointer lock so it never doubles up with #custom-cursor, which is
     * only visible when NOT locked.
     */
    _updateCrosshair(state) {
        const crosshair = document.getElementById('crosshair');
        if (!crosshair) return;
        const isLocked = document.pointerLockElement === this.engine.world.renderer.domElement;
        const show = isLocked && state.player.cameraMode === 'first';
        crosshair.style.display = show ? 'block' : 'none';
    }

    // Called each frame by GameEngine to check interaction targets
    updateInteraction() {
        const state = this.engine.state;
        if (state.phase !== 'playing') return;
        if (state.isOnBoat) return;

        this._updateCrosshair(state);

        const playerPos = state.player.pos;
        const interactRange = 3.0;
        const selectedType = this.getSelectedType();

        // Find nearest interactable entity based on selected tool
        let nearest = null;
        let nearestDist = Infinity;
        for (const e of state.entities) {
            // Choppable trees (when axe selected)
            if (e.userData.choppable && selectedType === 'axe') {
                const dist = e.position.distanceTo(playerPos);
                if (dist < interactRange && dist < nearestDist) {
                    nearestDist = dist;
                    nearest = e;
                }
            }
            // Minable rocks (when pickaxe selected)
            if (MINABLE_ROCK_TYPES.includes(e.userData.type) && selectedType === 'pickaxe') {
                // Only highlight large-scale rocks (obstacle rocks), not small
                // drops (which reuse type 'rock'); gold/crystals never spawn as drops
                if (state.obstacles.includes(e) || e.userData.type !== 'rock') {
                    const dist = e.position.distanceTo(playerPos);
                    if (dist < interactRange && dist < nearestDist) {
                        nearestDist = dist;
                        nearest = e;
                    }
                }
            }
        }

        // Clear highlight on old target
        if (state.interactionTarget && state.interactionTarget !== nearest) {
            this.setHighlight(state.interactionTarget, false);
            if (state.interactionTarget !== nearest) {
                state.chopProgress = 0;
            }
        }

        // Set new target
        state.interactionTarget = nearest;
        if (nearest) {
            this.setHighlight(nearest, true);
        }

        // Find nearest tool on the ground for E-key pickup
        this._nearestTool = null;
        let nearestToolDist = 4.0; // pickup range
        for (const e of state.entities) {
            if (e.userData.type !== 'axe' && e.userData.type !== 'pickaxe' && e.userData.type !== 'sword') continue;
            const dist = playerPos.distanceTo(e.position);
            if (dist < nearestToolDist) {
                nearestToolDist = dist;
                this._nearestTool = e;
            }
        }

        // Show/hide tool hint
        const axeHint = document.getElementById('axe-hint');
        if (axeHint) {
            if (this._inventoryFullUntil && performance.now() < this._inventoryFullUntil) {
                axeHint.style.display = 'block';
                axeHint.textContent = 'Inventory full!';
            } else if (this._nearestTool) {
                axeHint.style.display = 'block';
                axeHint.textContent = `Press E to pick up ${this._nearestTool.userData.type}`;
            } else if (selectedType === 'axe' && nearest) {
                axeHint.style.display = 'block';
                axeHint.textContent = 'Click to chop tree';
            } else if (selectedType === 'pickaxe' && nearest) {
                axeHint.style.display = 'block';
                axeHint.textContent = 'Click to mine';
            } else {
                axeHint.style.display = 'none';
            }
        }
    }

    /**
     * Toggle the highlight glow on an interactable entity. Saves each
     * material's original emissive hex the first time it's highlighted and
     * restores it on unhighlight — a flat 0x000000 reset would otherwise
     * permanently kill a legitimately emissive material, e.g. gold ore's
     * 0xffd700 glow, the first time it's highlighted and released.
     *
     * The cache lives on MATERIAL.userData, not child.userData: gold rocks
     * and ring crystals share one emissive material across several meshes,
     * and a per-child cache made every child after the first save the
     * already-stomped highlight color as its "original", leaving the glow
     * stuck grey after one highlight. Material-level storage also keeps the
     * saved base visible to CombatSystem._flashEntity's fallback chain.
     */
    setHighlight(entity, on) {
        entity.traverse(child => {
            if (child.material && child.material.emissive) {
                const mat = child.material;
                if (on) {
                    if (mat.userData._origEmissive === undefined) {
                        // If a combat flash is live on this material, its saved base is
                        // the truth — the live hex is the flash color, and saving that
                        // would restore the flash tint permanently on unhighlight.
                        mat.userData._origEmissive = child.userData._flashOrig !== undefined
                            ? child.userData._flashOrig
                            : mat.emissive.getHex();
                    }
                    mat.emissive.setHex(0x222222);
                } else if (mat.userData._origEmissive !== undefined) {
                    mat.emissive.setHex(mat.userData._origEmissive);
                    delete mat.userData._origEmissive;
                }
            }
        });
    }

    setupTouch() {
        const state = this.engine.state;
        const sfx = this.engine.audio;
        const reticle = document.getElementById('touch-reticle');
        let touchStartPos = { x: 0, y: 0 };
        let touchStartTime = 0;
        let isTouchActive = false;

        window.addEventListener('touchstart', (e) => {
            if (state.phase !== 'playing') return;
            const touch = e.touches[0];
            touchStartPos = { x: touch.clientX, y: touch.clientY };
            touchStartTime = performance.now();
            isTouchActive = true;

            // Show reticle
            if (reticle) {
                reticle.style.left = touch.clientX + 'px';
                reticle.style.top = touch.clientY + 'px';
                reticle.style.display = 'block';
            }
        });

        window.addEventListener('touchmove', (e) => {
            if (!isTouchActive || state.phase !== 'playing') return;
            const touch = e.touches[0];
            const dx = touch.clientX - touchStartPos.x;
            const dy = touch.clientY - touchStartPos.y;

            // Rotate camera
            state.player.cameraAngle.x -= dx * 0.005;
            state.player.cameraAngle.y += dy * 0.005;
            state.player.cameraAngle.y = Math.max(0.1, Math.min(Math.PI / 2 - 0.1, state.player.cameraAngle.y));

            touchStartPos = { x: touch.clientX, y: touch.clientY };

            if (reticle) {
                reticle.style.left = touch.clientX + 'px';
                reticle.style.top = touch.clientY + 'px';
            }
        });

        window.addEventListener('touchend', (e) => {
            if (!isTouchActive) return;
            isTouchActive = false;
            const dt = performance.now() - touchStartTime;

            if (reticle) reticle.style.display = 'none';

            // Short tap = interact
            if (dt < 250) {
                const selectedType = this.getSelectedType();
                if (state.interactionTarget && state.interactionTarget.userData.choppable && selectedType === 'axe') {
                    state.isChopping = true;
                    state.chopTimer = 0;
                    setTimeout(() => { state.isChopping = false; }, 500);
                }
            }
        });
    }
}
