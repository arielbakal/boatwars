// =====================================================
// INVENTORY MANAGER - Slot management & UI rendering
// =====================================================

import {
    INVENTORY_SLOTS,
    NON_STACKABLE_TYPES,
    STACKS_BY_TYPE,
    PICKUP_RANGE,
    CRAFT_HINT_DURATION
} from '../constants.js';
import { smoothFactor } from '../classes/Easing.js';

export default class InventoryManager {
    constructor(state, audio, ui) {
        this.state = state;
        this.audio = audio;
        this.ui = ui;
        this.onInventoryChanged = null; // callback() - fired when inventory changes
    }

    addToInventory(type, color, style, age = 0) {
        const isStackable = NON_STACKABLE_TYPES.indexOf(type) === -1;
        if (isStackable) {
            // Mirrors GameEngine.addToInventory's stacksByType branch exactly (via the
            // shared STACKS_BY_TYPE constant) — this path is the auto-pickup magnetism
            // route (_collectAutoPickup below), which used to stack strictly by exact
            // color and silently fragmented wood/rock/gold across inventory slots.
            const stacksByType = STACKS_BY_TYPE.indexOf(type) !== -1;
            const existingIdx = this.state.inventory.findIndex(item =>
                item && item.type === type && (stacksByType || item.color.getHex() === color.getHex())
            );
            if (existingIdx !== -1) {
                this.state.inventory[existingIdx].count = (this.state.inventory[existingIdx].count || 1) + 1;
                this.renderInventory();
                this.onInventoryChanged?.();
                return true;
            }
        }
        const emptyIdx = this.state.inventory.findIndex(item => item === null);
        if (emptyIdx !== -1) {
            this.state.inventory[emptyIdx] = { type, color, style, age, count: 1 };
            this.renderInventory();
            this.onInventoryChanged?.();
            return true;
        }
        return false;
    }

    /** Returns the type string of the currently selected inventory item, or null */
    getSelectedType() {
        const slot = this.state.selectedSlot;
        if (slot === null) return null;
        const item = this.state.inventory[slot];
        return item ? item.type : null;
    }

    renderInventory() {
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
    }

    /**
     * Auto-pickup system - collect nearby items (logs, rocks, gold, ...).
     * Called each frame by the system manager.
     *
     * Pickup magnetism: entering PICKUP_RANGE no longer instantly collects an item —
     * it's marked magnetized and glides toward the player's chest each frame
     * (smoothFactor-eased), collecting via the existing per-type path once close
     * enough. If the inventory has no room for the item, it's left resting instead
     * of magnetizing (re-checked next frame) so a full inventory can't suck in an
     * item it then can't collect.
     */
    update(dt, context) {
        const { state, world, audio, factory, playerController } = context;
        const playerPos = state.player.pos;

        if (state.isOnBoat || state.isBoardingBoat) return;

        const up = (playerController && playerController.getSurfaceNormal)
            ? playerController.getSurfaceNormal()
            : new THREE.Vector3(0, 1, 0);

        for (let i = state.entities.length - 1; i >= 0; i--) {
            const e = state.entities[i];
            if (!e.userData.autoPickup) continue;

            if (e.userData._magnetized) {
                const target = playerPos.clone().addScaledVector(up, 0.5); // player's chest
                e.position.lerp(target, smoothFactor(0.25, dt));
                if (e.position.distanceTo(target) < 0.6) {
                    this._collectAutoPickup(e, i, context);
                }
                continue;
            }

            const dist = e.position.distanceTo(playerPos);
            if (dist < PICKUP_RANGE && e.scale.x > 0.5) {
                const pickupType = e.userData.type === 'log' ? 'wood' : e.userData.type;
                if (this._canPickup(pickupType, e.userData.color)) {
                    e.userData._magnetized = true;
                }
                // else: no room — leave it resting, re-evaluated next frame
            }
        }

        this._updateWoodHUD(state);
        this._updateCraftHint(dt, state);
    }

    /** Mirrors addToInventory's feasibility check without mutating state. */
    _canPickup(type, color) {
        const isStackable = NON_STACKABLE_TYPES.indexOf(type) === -1;
        if (isStackable) {
            // Must agree with addToInventory above (and GameEngine.addToInventory) on
            // whether this type stacks across colors — otherwise an item could be
            // magnetized here as "pickupable" and then fail to actually stack once it
            // reaches addToInventory, or vice versa.
            const stacksByType = STACKS_BY_TYPE.indexOf(type) !== -1;
            const existingIdx = this.state.inventory.findIndex(item =>
                item && item.type === type && (stacksByType || item.color.getHex() === color.getHex())
            );
            if (existingIdx !== -1) return true;
        }
        return this.state.inventory.some(item => item === null);
    }

    /** Collects a magnetized item that has reached the player's chest. */
    _collectAutoPickup(e, idx, context) {
        const { state, world, audio, factory } = context;
        if (e.userData.type === 'log') {
            const added = this.addToInventory('wood', e.userData.color, null);
            if (added) {
                audio.pickup();
                for (let j = 0; j < 8; j++) factory.createParticle(e.position.clone(), e.userData.color, 0.8);
                world.remove(e);
                state.entities.splice(idx, 1);
            }
        } else if (e.userData.type === 'rock' || e.userData.type === 'gold') {
            const added = this.addToInventory(e.userData.type, e.userData.color, null);
            if (added) {
                audio.pickup();
                for (let j = 0; j < 8; j++) factory.createParticle(e.position.clone(), e.userData.color, 0.8);
                world.remove(e);
                state.entities.splice(idx, 1);
            }
        } else {
            // Unrecognized autoPickup type with no collect path — un-magnetize so it
            // doesn't chase the player forever without ever being collected.
            e.userData._magnetized = false;
        }
    }

    /**
     * Wires the resource HUD (#log-count) to the live wood count in inventory.
     * Sums across ALL wood stacks (not just the first found) — stacksByType keeps
     * new pickups merging into a single stack, but a save/session that already had
     * multiple wood stacks from before that fix (different colors, never merged)
     * would otherwise silently undercount.
     */
    _updateWoodHUD(state) {
        const totalWood = state.inventory.reduce(
            (sum, it) => (it && it.type === 'wood') ? sum + (it.count || 1) : sum,
            0
        );
        if (this.ui.logCount) this.ui.logCount.textContent = totalWood;
    }

    /**
     * Shows a one-time, dt-driven hint explaining spaceship assembly the first
     * time the player picks up wood. Auto-hides after CRAFT_HINT_DURATION seconds.
     */
    _updateCraftHint(dt, state) {
        const hintEl = this.ui.craftHint;
        if (!state.hasShownCraftHint) {
            const hasWood = state.inventory.some(it => it && it.type === 'wood');
            if (hasWood) {
                state.hasShownCraftHint = true;
                state.craftHintTimer = CRAFT_HINT_DURATION;
            }
        }
        if (state.craftHintTimer > 0) {
            state.craftHintTimer -= dt;
            if (state.craftHintTimer <= 0) {
                state.craftHintTimer = 0;
                if (hintEl) hintEl.style.display = 'none';
            } else if (hintEl) {
                hintEl.style.display = 'block';
            }
        }
    }
}
