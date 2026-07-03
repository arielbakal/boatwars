// =====================================================
// INVENTORY MANAGER - Slot management & UI rendering
// =====================================================

import {
    INVENTORY_SLOTS,
    NON_STACKABLE_TYPES,
    PICKUP_RANGE,
    CRAFT_HINT_DURATION
} from '../constants.js';

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
            const existingIdx = this.state.inventory.findIndex(item =>
                item && item.type === type && item.color.getHex() === color.getHex()
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
     * Auto-pickup system - collect nearby items (logs, axes, pickaxes).
     * Called each frame by the system manager.
     */
    update(dt, context) {
        const { state, world, audio, factory } = context;
        const playerPos = state.player.pos;

        if (state.isOnBoat || state.isBoardingBoat) return;

        for (let i = state.entities.length - 1; i >= 0; i--) {
            const e = state.entities[i];
            if (!e.userData.autoPickup) continue;
            const dist = e.position.distanceTo(playerPos);
            if (dist < PICKUP_RANGE && e.scale.x > 0.5) {
                if (e.userData.type === 'log') {
                    const added = this.addToInventory('wood', e.userData.color, null);
                    if (added) {
                        audio.pickup();
                        for (let j = 0; j < 8; j++) factory.createParticle(e.position.clone(), e.userData.color, 0.8);
                        world.remove(e);
                        state.entities.splice(i, 1);
                    }
                }
                if (e.userData.type === 'rock' || e.userData.type === 'gold') {
                    const added = this.addToInventory(e.userData.type, e.userData.color, null);
                    if (added) {
                        audio.pickup();
                        for (let j = 0; j < 8; j++) factory.createParticle(e.position.clone(), e.userData.color, 0.8);
                        world.remove(e);
                        state.entities.splice(i, 1);
                    }
                }
            }
        }

        this._updateWoodHUD(state);
        this._updateCraftHint(dt, state);
    }

    /** Wires the resource HUD (#log-count) to the live wood count in inventory. */
    _updateWoodHUD(state) {
        const woodItem = state.inventory.find(it => it && it.type === 'wood');
        if (this.ui.logCount) this.ui.logCount.textContent = woodItem ? (woodItem.count || 1) : 0;
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
