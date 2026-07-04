// =====================================================
// REMOTE PLAYER MANAGER - Renders other players in 3D
// =====================================================

import { smoothFactor } from '../classes/Easing.js';
import SphericalUtils from '../classes/SphericalUtils.js';
import { SHIP_MAX_SPEED } from '../constants.js';

// Reusable temp objects to reduce GC pressure in the per-frame update loop
// (mirrors the _tmpVec convention in BoatSystem.js).
const _tmpAvatarQuat = new THREE.Quaternion();
const _tmpAvatarAxis = new THREE.Vector3(0, 1, 0);
const _tmpShipDelta = new THREE.Vector3();
const _tmpShipForward = new THREE.Vector3(0, 0, -1);
const _tmpShipUp = new THREE.Vector3(0, 1, 0);

export default class RemotePlayerManager {
    constructor(world, factory) {
        this.world = world;
        this.factory = factory; // needed to build/dispose remote ship models (createSpaceship)
        this.players = new Map(); // id → { group, pivot, limbs, targetPos, targetRot, label }
    }

    /**
     * Assign distinct colors per player slot
     */
    _playerColors(id) {
        const COLORS = [
            { body: 0xe74c3c, limb: 0xc0392b },  // red
            { body: 0x3498db, limb: 0x2980b9 },  // blue
            { body: 0x2ecc71, limb: 0x27ae60 },  // green
            { body: 0xf39c12, limb: 0xe67e22 },  // orange
            { body: 0x9b59b6, limb: 0x8e44ad },  // purple
            { body: 0x1abc9c, limb: 0x16a085 },  // teal
            { body: 0xe91e63, limb: 0xc2185b },  // pink
            { body: 0x00bcd4, limb: 0x0097a7 },  // cyan
        ];
        return COLORS[(id - 1) % COLORS.length];
    }

    /**
     * Build a blocky character matching the local player style
     */
    _buildModel(id) {
        const colors = this._playerColors(id);
        const matBody = new THREE.MeshToonMaterial({ color: colors.body });
        const matLimb = new THREE.MeshToonMaterial({ color: colors.limb });
        const matEye = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const matPupil = new THREE.MeshBasicMaterial({ color: 0x000000 });

        const group = new THREE.Group();
        const pivot = new THREE.Group();
        pivot.scale.setScalar(0.6);
        group.add(pivot);

        // Torso
        const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.3), matBody);
        torso.position.y = 0.7;
        pivot.add(torso);

        // Head
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, 0.4), matLimb);
        head.position.y = 1.2;
        pivot.add(head);

        // Eyes
        const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.05), matEye);
        eyeL.position.set(0.12, 1.2, 0.2);
        const eyeR = eyeL.clone();
        eyeR.position.set(-0.12, 1.2, 0.2);
        const pupilGeo = new THREE.BoxGeometry(0.04, 0.04, 0.06);
        const pupilL = new THREE.Mesh(pupilGeo, matPupil);
        pupilL.position.z = 0.01;
        const pupilR = pupilL.clone();
        eyeL.add(pupilL);
        eyeR.add(pupilR);
        pivot.add(eyeL, eyeR);

        // Legs
        const legGeo = new THREE.BoxGeometry(0.15, 0.4, 0.15);
        legGeo.translate(0, -0.2, 0);
        const legL = new THREE.Mesh(legGeo, matLimb);
        legL.position.set(0.15, 0.4, 0);
        const legR = new THREE.Mesh(legGeo.clone(), matLimb);
        legR.position.set(-0.15, 0.4, 0);
        pivot.add(legL, legR);

        // Arms
        const armGeo = new THREE.BoxGeometry(0.12, 0.4, 0.12);
        armGeo.translate(0, -0.2, 0);
        const armL = new THREE.Mesh(armGeo, matLimb);
        armL.position.set(0.35, 0.9, 0);
        const armR = new THREE.Mesh(armGeo.clone(), matLimb);
        armR.position.set(-0.35, 0.9, 0);
        pivot.add(armL, armR);

        // Nametag (sprite)
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const c = canvas.getContext('2d');
        c.fillStyle = 'rgba(0,0,0,0.5)';
        c.fillRect(0, 0, 256, 64);
        c.fillStyle = '#ffffff';
        c.font = 'bold 28px sans-serif';
        c.textAlign = 'center';
        c.fillText(`Player ${id}`, 128, 42);
        const tex = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.position.y = 1.8;
        sprite.scale.set(1.5, 0.4, 1);
        group.add(sprite);

        // Held-item container (attached to right arm at hand position)
        const heldItemContainer = new THREE.Group();
        heldItemContainer.position.set(0, -0.4, 0);
        heldItemContainer.visible = false;
        armR.add(heldItemContainer);

        return { group, pivot, legL, legR, armL, armR, heldItemContainer, currentHeldType: null };
    }

    /**
     * Add a new remote player to the scene
     */
    addPlayer(id, data) {
        if (this.players.has(id)) return;

        const model = this._buildModel(id);
        const pos = data.position || { x: 0, y: 0, z: 0 };
        model.group.position.set(pos.x, pos.y, pos.z);

        this.world.add(model.group);

        this.players.set(id, {
            ...model,
            targetPos: new THREE.Vector3(pos.x, pos.y, pos.z),
            currentPos: new THREE.Vector3(pos.x, pos.y, pos.z),
            targetRot: data.rotation || 0,
            currentRot: data.rotation || 0,
            time: 0,
            isOnBoat: false,
            _wasOnBoat: false,
            ship: null,           // lazily-built remote-only ship model (see _updateRemoteShip)
            shipHeading: null,    // last observed movement direction, used as a quaternion proxy
            shipSpeedSmoothed: 0, // derived speed (position delta / dt) for the engine-glow pulse
            activeAction: null,
            inventory: data.inventory || null,
            selectedSlot: data.selectedSlot ?? null
        });

        // If existing player already had inventory, show held item
        if (data.inventory) {
            this._updateHeldItem(id);
        }

        console.log(`[Remote] Player ${id} added`);
    }

    /**
     * Remove a remote player from the scene
     */
    removePlayer(id) {
        const p = this.players.get(id);
        if (!p) return;
        this._removeRemoteShip(p);
        this.world.remove(p.group);
        this.players.delete(id);
        console.log(`[Remote] Player ${id} removed`);
    }

    /**
     * Update target position/rotation from network data
     */
    updatePlayer(id, data) {
        const p = this.players.get(id);
        if (!p) return;
        if (data.position) {
            p.targetPos.set(data.position.x, data.position.y, data.position.z);
        }
        if (data.rotation !== undefined) {
            p.targetRot = data.rotation;
        }
        p.isOnBoat = data.isOnBoat || false;
        p.activeAction = data.activeAction || null;
    }

    /**
     * Update a remote player's inventory data and held-item visual
     */
    updateInventory(id, data) {
        const p = this.players.get(id);
        if (!p) return;
        p.inventory = data.inventory || null;
        p.selectedSlot = data.selectedSlot ?? null;
        this._updateHeldItem(id);
    }

    /**
     * Update the held-item mesh based on the player's selected inventory slot
     */
    _updateHeldItem(id) {
        const p = this.players.get(id);
        if (!p || !p.heldItemContainer) return;

        const slot = p.selectedSlot;
        const inv = p.inventory;
        if (slot === null || slot === undefined || !inv || !inv[slot]) {
            p.heldItemContainer.visible = false;
            p.currentHeldType = null;
            return;
        }

        const item = inv[slot];
        const itemType = item.type;
        const color = typeof item.color === 'number' ? item.color : 0xffffff;

        // Only rebuild mesh if the item type changed
        if (p.currentHeldType !== itemType) {
            while (p.heldItemContainer.children.length) {
                p.heldItemContainer.remove(p.heldItemContainer.children[0]);
            }
            const model = this._buildHeldItemModel(itemType, color);
            p.heldItemContainer.add(model);
            p.currentHeldType = itemType;
        } else if (itemType !== 'axe' && itemType !== 'pickaxe') {
            // Same type, update color for non-tool items
            p.heldItemContainer.traverse(c => {
                if (c.material) c.material.color.setHex(color);
            });
        }

        p.heldItemContainer.visible = true;
    }

    /**
     * Build a held-item 3D model matching the EntityFactory designs
     */
    _buildHeldItemModel(type, color) {
        const g = new THREE.Group();
        switch (type) {
            case 'axe': {
                const woodMat = new THREE.MeshToonMaterial({ color: 0x5d4037 });
                const metalMat = new THREE.MeshToonMaterial({ color: 0x78909c });
                const edgeMat = new THREE.MeshToonMaterial({ color: 0xeeeeee });
                const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.015, 0.5, 6), woodMat);
                g.add(handle);
                const headBase = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.075, 0.1), metalMat);
                headBase.position.y = 0.2;
                g.add(headBase);
                const blade = new THREE.Mesh(new THREE.BoxGeometry(0.0075, 0.15, 0.125), metalMat);
                blade.position.set(0, 0.2, 0.0875);
                blade.rotation.x = Math.PI / 8;
                g.add(blade);
                const edge = new THREE.Mesh(new THREE.BoxGeometry(0.0025, 0.1625, 0.0125), edgeMat);
                edge.position.set(0, 0.2, 0.15);
                edge.rotation.x = Math.PI / 8;
                g.add(edge);
                g.rotation.set(Math.PI, Math.PI, -Math.PI / 4);
                break;
            }
            case 'pickaxe': {
                const woodMat = new THREE.MeshToonMaterial({ color: 0x5d4037 });
                const metalMat = new THREE.MeshToonMaterial({ color: 0x555555 });
                const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.015, 0.5, 6), woodMat);
                g.add(handle);
                const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.04, 0.04), metalMat);
                head.position.y = 0.2;
                g.add(head);
                const tipL = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.15, 4), metalMat);
                tipL.rotation.z = Math.PI / 2 + 0.3;
                tipL.position.set(-0.15, 0.16, 0);
                g.add(tipL);
                const tipR = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.15, 4), metalMat);
                tipR.rotation.z = -Math.PI / 2 - 0.3;
                tipR.position.set(0.15, 0.16, 0);
                g.add(tipR);
                g.rotation.set(Math.PI, Math.PI, -Math.PI / 4);
                break;
            }
            case 'wood': {
                const mat = new THREE.MeshToonMaterial({ color });
                g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 6), mat));
                g.rotation.set(0, 0, -Math.PI / 4);
                break;
            }
            case 'rock': {
                const mat = new THREE.MeshToonMaterial({ color });
                g.add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.1), mat));
                break;
            }
            case 'food': {
                const mat = new THREE.MeshToonMaterial({ color });
                g.add(new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), mat));
                break;
            }
            default: {
                const mat = new THREE.MeshToonMaterial({ color });
                g.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), mat));
                break;
            }
        }
        return g;
    }

    // ===========================================
    // REMOTE SHIP RENDERING (Strategy D unit 1)
    // ===========================================
    // The server's player_state relay (server/index.js) does NOT forward
    // shipPosition/shipQuaternion/shipSpeed — only position/rotation/isOnBoat/
    // activeAction reach other clients (see AUDIT.md + final report). This ship
    // is therefore an approximation built entirely from those four fields:
    //   - position: BoatSystem._positionPlayerOnShip sets the pilot's own
    //     position to boat.position + a small (~0.6 unit) seat offset every
    //     physics frame while piloting, so it doubles as a decent ship-anchor.
    //   - orientation: no quaternion is available at all, so it's inferred from
    //     observed movement heading, re-leveled against the nearest planet's
    //     surface normal when close to one (mirrors BoatSystem's own grounded
    //     vs. free-flight leveling split).
    //   - speed (for the engine-glow pulse): derived from the position delta
    //     instead of the never-relayed shipSpeed field.
    // A real fix needs server/index.js's player_state case to pass those three
    // fields through — out of scope here (client-files-only constraint).

    /** Build a fresh remote-only ship model, colored to match the pilot's avatar. */
    _buildRemoteShip(id) {
        const colors = this._playerColors(id);
        const ship = this.factory.createSpaceship(0, 0, 0, new THREE.Color(colors.body));
        // Cache engine-glow meshes once (mirrors BoatSystem._cacheEngineGlows) instead
        // of traversing the hierarchy every frame just to find them.
        const glows = [];
        ship.traverse(child => {
            if (child.userData && child.userData.isEngineGlow) glows.push(child);
        });
        ship.userData._engineGlowMeshes = glows;
        return ship;
    }

    /**
     * Position/orient the pilot's ship and pulse its engine glow. Visual only —
     * never added to state.entities/obstacles, so it can't be boarded, collided
     * with, or picked up by the boat-proximity scan (BoatSystem.updateProximity).
     */
    _updateRemoteShip(id, p, dt, islands) {
        if (!p.ship) {
            p.ship = this._buildRemoteShip(id);
            this.world.add(p.ship);
        }
        const ship = p.ship;

        ship.position.copy(p.currentPos);

        // Heading proxy: only updates while actually moving, so the ship keeps
        // facing its last known direction while stopped instead of snapping.
        _tmpShipDelta.copy(p.targetPos).sub(p.currentPos);
        if (_tmpShipDelta.lengthSq() > 0.0004) {
            p.shipHeading = (p.shipHeading || new THREE.Vector3()).copy(_tmpShipDelta).normalize();
        }
        const forward = p.shipHeading || _tmpShipForward;

        // Flush to the nearest planet's surface normal when close to one (mirrors
        // BoatSystem._levelToSurface); otherwise a stable world-up horizon (mirrors
        // BoatSystem._autoLevelRoll's free-flight case).
        _tmpShipUp.set(0, 1, 0);
        if (islands && islands.length) {
            const nearest = SphericalUtils.findNearestPlanet(ship.position, islands);
            if (nearest && nearest.planet && nearest.distance < nearest.planet.radius * 1.5) {
                _tmpShipUp.copy(ship.position).sub(nearest.planet.center).normalize();
            }
        }
        const targetQ = SphericalUtils.getOrientationOnSurface(_tmpShipUp, forward);
        ship.quaternion.slerp(targetQ, smoothFactor(0.12, dt));

        // Derived-speed engine glow (shipSpeed is never relayed — see NOTE above).
        const observedSpeed = _tmpShipDelta.length() / Math.max(dt, 0.0001);
        p.shipSpeedSmoothed = THREE.MathUtils.lerp(p.shipSpeedSmoothed || 0, observedSpeed, smoothFactor(0.2, dt));
        this._updateRemoteEngineGlow(ship, p.shipSpeedSmoothed);
    }

    _updateRemoteEngineGlow(ship, speedUnitsPerSecond) {
        const glows = ship.userData._engineGlowMeshes;
        if (!glows || !glows.length) return;
        // BoatSystem's ship speed is an un-dt-scaled per-frame delta (assumes 60fps);
        // *60 converts SHIP_MAX_SPEED to the same units/second basis as our derived speed.
        const referenceMax = SHIP_MAX_SPEED * 60;
        const ratio = THREE.MathUtils.clamp(speedUnitsPerSecond / referenceMax, 0, 1);
        const opacity = THREE.MathUtils.clamp(0.35 + ratio * 0.55, 0.2, 1.0);
        const scale = 1 + ratio * 0.25;
        for (const glow of glows) {
            if (glow.material) glow.material.opacity = opacity;
            glow.scale.setScalar(scale);
        }
    }

    /** Dispose and drop the remote ship model (disembark, player leave, cleanup). */
    _removeRemoteShip(p) {
        if (!p.ship) return;
        this.world.remove(p.ship);
        if (this.factory) this.factory.disposeHierarchy(p.ship);
        p.ship = null;
        p.shipHeading = null;
        p.shipSpeedSmoothed = 0;
    }

    /** Seated pilot pose — mirrors BoatSystem.setSeatedPose, adapted to remote field names. */
    _applySeatedPose(p) {
        if (p.legL) { p.legL.rotation.x = -Math.PI / 2; p.legL.position.y = 0.3; }
        if (p.legR) { p.legR.rotation.x = -Math.PI / 2; p.legR.position.y = 0.3; }
        if (p.armL) { p.armL.rotation.x = -0.4; p.armL.rotation.z = 0.25; }
        if (p.armR) { p.armR.rotation.x = -0.4; p.armR.rotation.z = -0.25; }
        if (p.pivot) p.pivot.position.y = -0.20;
    }

    /** Mirrors BoatSystem.resetSeatedPose — restores the on-foot rest pose on disembark. */
    _resetSeatedPose(p) {
        if (p.legL) { p.legL.rotation.x = 0; p.legL.position.y = 0.4; }
        if (p.legR) { p.legR.rotation.x = 0; p.legR.position.y = 0.4; }
        if (p.armL) p.armL.rotation.set(0, 0, 0);
        if (p.armR) p.armR.rotation.set(0, 0, 0);
        if (p.pivot) p.pivot.position.y = 0;
    }

    /**
     * Per-frame interpolation for smooth movement
     */
    update(dt, islands) {
        for (const [id, p] of this.players) {
            p.time += dt;

            // Smooth position interpolation
            p.currentPos.lerp(p.targetPos, smoothFactor(0.15, dt));
            p.group.position.copy(p.currentPos);

            // Smooth rotation
            const targetQ = _tmpAvatarQuat.setFromAxisAngle(_tmpAvatarAxis, p.targetRot);
            p.pivot.quaternion.slerp(targetQ, smoothFactor(0.15, dt));

            // Walk animation when moving
            const dx = p.targetPos.x - p.currentPos.x;
            const dz = p.targetPos.z - p.currentPos.z;
            const isMoving = (dx * dx + dz * dz) > 0.0001;

            // Ship render + seating (Strategy D unit 1)
            if (p.isOnBoat) {
                this._updateRemoteShip(id, p, dt, islands);
            } else if (p.ship) {
                this._removeRemoteShip(p);
            }
            if (p.isOnBoat) {
                this._applySeatedPose(p);
            } else if (p._wasOnBoat) {
                this._resetSeatedPose(p);
            }
            p._wasOnBoat = p.isOnBoat;

            if (p.isOnBoat) {
                // Seated — walk/chop/mine animation is suppressed entirely while piloting.
                continue;
            }

            if (isMoving) {
                const walkCycle = p.time * 10;
                p.legL.rotation.x = Math.sin(walkCycle) * 0.8;
                p.legR.rotation.x = Math.sin(walkCycle + Math.PI) * 0.8;
                p.armL.rotation.x = Math.sin(walkCycle + Math.PI) * 0.5;
                p.armR.rotation.x = Math.sin(walkCycle) * 0.5;
            } else {
                // Action animations
                if (p.activeAction === 'chop' || p.activeAction === 'mine') {
                    const swing = p.time * 8;
                    p.armR.rotation.x = Math.sin(swing) * 1.2;
                } else {
                    // Flat 0.1 decay toward 0 (`x *= 1 - k` == `x += (0 - x) * k`), dt-corrected
                    const lerp = smoothFactor(0.1, dt);
                    p.legL.rotation.x *= (1 - lerp);
                    p.legR.rotation.x *= (1 - lerp);
                    p.armL.rotation.x *= (1 - lerp);
                    p.armR.rotation.x *= (1 - lerp);
                }
            }
        }
    }

    /**
     * Remove all remote players
     */
    clear() {
        for (const [id] of this.players) {
            this.removePlayer(id);
        }
    }

    get count() {
        return this.players.size;
    }
}
