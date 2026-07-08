// =====================================================
// COMBAT SYSTEM - Player attack, creature aggro/contact,
//                 death/respawn, stat boosts (spherical)
// =====================================================

import {
    PLAYER_BASE_ATTACK, PLAYER_MAX_HP,
    ATTACK_COOLDOWN, ATTACK_RANGE, ATTACK_ARC,
    CREATURE_CONTACT_DAMAGE, CREATURE_CONTACT_COOLDOWN, CREATURE_AGGRO_DURATION,
    RESPAWN_INVINCIBILITY, PLAYER_RADIUS,
    STAT_BOOST_PICKUP_RANGE, STAT_BOOST_BOB_SPEED, STAT_BOOST_BOB_HEIGHT, STAT_BOOST_SPIN_SPEED,
    CREATURE_ESSENCE_MAP, ATTACK_SWING_DURATION,
    ESSENCE_ATTACK_CAP_MULT, ESSENCE_MAX_HP_CAP_MULT, PLAYER_SPEED_BOOST_CAP,
    SWORD_ATTACK_BONUS
} from '../constants.js';
import SphericalUtils from '../classes/SphericalUtils.js';
import { smoothFactor } from '../classes/Easing.js';
import ParticleSystem from './ParticleSystem.js';

export default class CombatSystem {
    constructor(ui) {
        this.ui = ui;
        this._flashTimers = [];
    }

    update(dt, ctx) {
        const { state } = ctx;

        if (state.attackCooldown > 0) state.attackCooldown -= dt;

        if (state.invincibleTimer > 0) state.invincibleTimer -= dt;

        if (state.isAttacking) {
            state._attackVisualTimer = (state._attackVisualTimer || 0) + dt;
            if (state._attackVisualTimer > ATTACK_SWING_DURATION) {
                state.isAttacking = false;
                state._attackVisualTimer = 0;
            }
        }

        this._updateFlashTimers(dt);
        this._updateDyingEntities(dt, ctx); // C9: process scale-down deaths
        this._updateKnockback(dt, ctx);     // C7: lerp-based knockback

        if (state.isDead) {
            this._updateDeathRespawn(dt, state);
            this._updateUI(state);
            return;
        }

        this._updateCreatureAggro(dt, state, ctx);
        this._updateCreatureContact(dt, ctx);
        this._updateStatBoosts(dt, state, ctx.world, ctx.audio, ctx.factory, ctx.t);
        this._updateUI(state);
    }

    tryAttack(ctx) {
        const { state, audio, remotePlayers, broadcastWorldEvent, factory } = ctx;
        if (state.isDead) return false;
        if (state.attackCooldown > 0) return false;

        state.attackCooldown = ATTACK_COOLDOWN;
        state.isAttacking = true;
        state._attackVisualTimer = 0;
        // Bump the network-facing swing counter so remote clients can trigger their
        // own copy of this swing on the next player_state packet (see NetworkManager
        // .sendPlayerState / RemotePlayerManager.updatePlayer).
        state.attackSeq = (state.attackSeq || 0) + 1;

        audio.chop();

        // Sword grants a flat bonus while selected — it stacks with (not
        // replaces) attack-essence boosts already folded into player.attack.
        const held = state.selectedSlot !== null ? state.inventory[state.selectedSlot] : null;
        const swordBonus = held && held.type === 'sword' ? SWORD_ATTACK_BONUS : 0;
        const damage = (state.player.attack || PLAYER_BASE_ATTACK) + swordBonus;

        const targets = this._findAttackTargets(state);
        for (const entity of targets) {
            this._damageEntity(entity, damage, ctx);
        }

        if (remotePlayers) {
            const hitPlayers = this._findRemotePlayerTargets(state, remotePlayers);
            for (const { id, playerData } of hitPlayers) {
                this._flashEntity(playerData.pivot, 0xff0000, 0.2);
                for (let i = 0; i < 6; i++) {
                    factory.createParticle(playerData.group.position.clone(), new THREE.Color(0xff4444), 0.8);
                }
                // 3D knockback
                const dir = playerData.group.position.clone().sub(state.player.pos).normalize();
                playerData.group.position.add(dir.clone().multiplyScalar(0.8));
                playerData.targetPos.add(dir.clone().multiplyScalar(0.8));
                if (broadcastWorldEvent) {
                    broadcastWorldEvent('player_attack', state.player.pos.x, state.player.pos.z, {
                        targetId: id,
                        damage: damage
                    });
                }
            }
        }

        return true;
    }

    _findAttackTargets(state) {
        const targets = [];
        const playerPos = state.player.pos;

        // Get player forward direction from playerController if available
        const playerForward = state._playerForward || new THREE.Vector3(0, 0, -1);

        for (const e of state.entities) {
            if (e.userData.type !== 'creature') continue;
            if (e.userData._dying) continue; // already dying — don't re-target the corpse
            if (e.userData.hp === undefined || e.userData.hp <= 0) continue;

            const diff = e.position.clone().sub(playerPos);
            const dist = diff.length();

            if (dist > ATTACK_RANGE) continue;

            // Check if within forward arc (dot product in 3D)
            if (dist > 0.01) {
                const ndir = diff.normalize();
                const dot = playerForward.dot(ndir);
                if (dot < Math.cos(ATTACK_ARC / 2)) continue;
            }

            targets.push(e);
        }

        return targets;
    }

    _findRemotePlayerTargets(state, remotePlayers) {
        const hits = [];
        const playerPos = state.player.pos;
        const playerForward = state._playerForward || new THREE.Vector3(0, 0, -1);

        for (const [id, p] of remotePlayers.players) {
            const diff = p.group.position.clone().sub(playerPos);
            const dist = diff.length();

            if (dist > ATTACK_RANGE) continue;

            if (dist > 0.01) {
                const ndir = diff.normalize();
                const dot = playerForward.dot(ndir);
                if (dot < Math.cos(ATTACK_ARC / 2)) continue;
            }

            hits.push({ id, playerData: p });
        }

        return hits;
    }

    _damageEntity(entity, damage, ctx) {
        const { state, world, factory, audio } = ctx;

        entity.userData.hp -= damage;

        this._spawnDamageNumber(entity.position.clone().add(new THREE.Vector3(0, 0.4, 0)), damage, '#ffee66', ctx);

        this._flashEntity(entity, 0xff0000, 0.2);

        // C7: Lerp-based knockback — store target, interpolate over ~4 frames
        const dir = entity.position.clone().sub(state.player.pos).normalize();
        const planet = entity.userData.planet;
        if (planet) {
            entity.userData._knockTarget = SphericalUtils.moveOnSurface(entity.position, dir, 0.8, planet);
        } else {
            entity.userData._knockTarget = entity.position.clone().add(dir.multiplyScalar(0.8));
        }
        entity.userData._knockTimer = 0.07; // ~4 frames at 60fps

        entity.userData.aggroTimer = CREATURE_AGGRO_DURATION;

        for (let i = 0; i < 6; i++) {
            factory.createParticle(entity.position.clone(), entity.userData.color || new THREE.Color(0xff0000), 0.8);
        }

        if (entity.userData.hp <= 0) {
            audio.die();
            state.addShake(0.08); // subtle punch on a creature/golem kill
            for (let i = 0; i < 20; i++) {
                factory.createParticle(entity.position.clone(), entity.userData.color || new THREE.Color(0xff0000), 1.5);
            }

            const essenceData = CREATURE_ESSENCE_MAP[entity.userData.speciesType];
            if (essenceData) {
                const boost = factory.createStatBoost(entity.position.x, entity.position.z, essenceData);
                boost.userData.planet = entity.userData.planet;
                // Snap boost to planet surface
                if (entity.userData.planet) {
                    const normal = SphericalUtils.getSurfaceNormal(entity.position, entity.userData.planet);
                    const surfPos = entity.userData.planet.center.clone().add(normal.multiplyScalar(entity.userData.planet.radius + 0.5));
                    boost.position.copy(surfPos);
                }
                world.add(boost);
                state.statBoosts.push(boost);
            }

            // C9: Brief scale-down before removal for visual death feel
            entity.userData._dying = true;
            entity.userData._dyingTimer = 0.15; // seconds to shrink
            entity.userData._dyingBaseScale = entity.scale.x; // capture current scale
        }
    }

    /**
     * Spawn a floating damage-number sprite (EntityFactory.createDamageNumber) and
     * cap concurrent numbers at 20 by dropping the oldest — this fires on every hit,
     * so an uncapped list would grow unbounded during a sustained fight.
     */
    _spawnDamageNumber(pos, value, colorHex, ctx) {
        const { state, world, factory } = ctx;
        const num = factory.createDamageNumber(pos, Math.round(value), colorHex);
        state.damageNumbers.push(num);
        if (state.damageNumbers.length > 20) {
            const oldest = state.damageNumbers.shift();
            ParticleSystem.disposeDamageNumber(world, oldest);
        }
    }

    _flashEntity(entity, color, duration) {
        const originalEmissives = [];
        entity.traverse(child => {
            if (child.material && child.material.emissive) {
                // Restore target must be the material's TRUE base emissive: prefer an
                // in-flight flash's saved base, then the highlight system's saved base
                // (InputHandler.setHighlight), then the live value. Capturing the live
                // hex blindly would bake an active highlight/flash tint into the
                // restore and leave the entity stuck tinted after both effects end.
                const trueOrig = child.userData._flashOrig !== undefined ? child.userData._flashOrig
                    : child.userData._origEmissive !== undefined ? child.userData._origEmissive
                    : child.material.emissive.getHex();
                child.userData._flashOrig = trueOrig;
                originalEmissives.push({ child, mat: child.material, orig: trueOrig });
                child.material.emissive.setHex(color);
            }
        });
        this._flashTimers.push({ originals: originalEmissives, timer: duration });
    }

    _updateFlashTimers(dt) {
        for (let i = this._flashTimers.length - 1; i >= 0; i--) {
            this._flashTimers[i].timer -= dt;
            if (this._flashTimers[i].timer <= 0) {
                for (const { child, mat, orig } of this._flashTimers[i].originals) {
                    mat.emissive.setHex(orig);
                    delete child.userData._flashOrig;
                }
                this._flashTimers.splice(i, 1);
            }
        }
    }

    // C7: Advance knockback lerp each frame
    _updateKnockback(dt, ctx) {
        const { state } = ctx;
        for (const e of state.entities) {
            if (!e.userData._knockTarget || !e.userData._knockTimer) continue;
            e.userData._knockTimer -= dt;
            // Lerp toward knock target; ~0.4 per frame at 60fps ≈ 4-frame travel.
            // _knockTimer forces an exact snap to the target when it expires (below),
            // so dt-correcting this factor only makes the approach curve itself
            // consistent across frame rates — the travel still always finishes on time.
            e.position.lerp(e.userData._knockTarget, smoothFactor(0.4, dt));
            if (e.userData._knockTimer <= 0) {
                e.position.copy(e.userData._knockTarget);
                e.userData._knockTarget = null;
                e.userData._knockTimer = 0;
            }
        }
    }

    // C9: Shrink dying entities to 0 over a short timer then remove them
    _updateDyingEntities(dt, ctx) {
        const { state, world } = ctx;
        for (let i = state.entities.length - 1; i >= 0; i--) {
            const e = state.entities[i];
            if (!e.userData._dying) continue;
            e.userData._dyingTimer -= dt;
            const progress = 1 - Math.max(0, e.userData._dyingTimer / 0.15);
            const s = Math.max(0, 1 - progress);
            e.scale.setScalar(s * (e.userData._dyingBaseScale || 1));
            if (e.userData._dyingTimer <= 0) {
                world.remove(e);
                state.entities.splice(i, 1);
                if (state.obstacles.includes(e)) state.obstacles.splice(state.obstacles.indexOf(e), 1);
            }
        }
    }

    _damagePlayer(amount, ctx, sourcePos = null) {
        const { state, audio, playerController } = ctx;
        if (state.invincibleTimer > 0) return;
        if (state.isDead) return;

        state.player.hp -= amount;
        audio.hurt();
        state.addShake(0.15);
        this._spawnDamageNumber(sourcePos || state.player.pos, amount, '#ff4444', ctx);

        // Knockback along surface
        if (sourcePos) {
            state.player.stunTimer = 0.4;
            const dir = state.player.pos.clone().sub(sourcePos).normalize();
            const knockSpeed = 0.4;
            state.player.vel.copy(dir.multiplyScalar(knockSpeed));
            // Add upward component along surface normal
            const planet = playerController.getCurrentPlanet ? playerController.getCurrentPlanet() : null;
            if (planet) {
                const normal = SphericalUtils.getSurfaceNormal(state.player.pos, planet);
                state.player.vel.add(normal.multiplyScalar(0.15));
            }
            state.player.onGround = false;
        }

        if (playerController && playerController.modelPivot) {
            this._flashEntity(playerController.modelPivot, 0xff0000, 0.2);
        }

        if (this.ui.flash) {
            this.ui.flash.style.background = 'rgba(255, 0, 0, 0.4)';
            this.ui.flash.style.opacity = 1;
            setTimeout(() => {
                this.ui.flash.style.opacity = 0;
                setTimeout(() => { this.ui.flash.style.background = '#fff'; }, 300);
            }, 150);
        }

        if (state.player.hp <= 0) {
            state.player.hp = 0;
            state.isDead = true;
            state.deathTimer = 2.0;
            audio.die();
        }
    }

    _updateCreatureContact(dt, ctx) {
        const { state } = ctx;
        const playerPos = state.player.pos;

        for (const e of state.entities) {
            if (e.userData.type !== 'creature') continue;
            if (e.userData._dying) continue; // shrinking corpse — no contact damage
            if (e.userData.aggroTimer <= 0) continue;

            e.userData.contactCooldown = (e.userData.contactCooldown || 0) - dt;
            if (e.userData.contactCooldown > 0) continue;

            // 3D distance check
            const dist = e.position.distanceTo(playerPos);
            const contactDist = PLAYER_RADIUS + (e.userData.radius || 0.5);

            if (dist < contactDist) {
                e.userData.contactCooldown = CREATURE_CONTACT_COOLDOWN;
                // A4: creatures spawned via GameEngine._applyTier stamp a tier-scaled
                // contactDamage; fall back to the base constant if it's unset.
                this._damagePlayer(e.userData.contactDamage || CREATURE_CONTACT_DAMAGE, ctx, e.position);
            }
        }
    }

    _updateCreatureAggro(dt, state, ctx) {
        const playerPos = state.player.pos;

        for (const e of state.entities) {
            if (e.userData.type !== 'creature') continue;
            if (e.userData._dying) continue; // shrinking corpse — stop chasing
            if (e.userData.aggroTimer <= 0) continue;

            e.userData.aggroTimer -= dt;

            // Chase player on sphere surface
            const dist = e.position.distanceTo(playerPos);
            if (dist > 0.5) {
                const dir = playerPos.clone().sub(e.position).normalize();
                const speed = (e.userData.moveSpeed || 0.03) * 2;
                const planet = e.userData.planet;
                if (planet) {
                    const newPos = SphericalUtils.moveOnSurface(e.position, dir, speed, planet);
                    e.position.copy(newPos);
                    // Orient toward player on surface
                    const normal = SphericalUtils.getSurfaceNormal(e.position, planet);
                    const q = SphericalUtils.getOrientationOnSurface(normal, dir);
                    e.quaternion.slerp(q, smoothFactor(0.15, dt));
                } else {
                    e.position.add(dir.multiplyScalar(speed));
                }
                e.userData._isMoving = true;
            } else {
                e.userData._isMoving = false;
            }
        }
    }

    _updateDeathRespawn(dt, state) {
        state.deathTimer -= dt;
        if (state.deathTimer <= 0) {
            state.isDead = false;
            state.player.hp = state.player.maxHp;
            state.invincibleTimer = RESPAWN_INVINCIBILITY;
            // Respawn on nearest planet surface
            if (state.islands.length > 0) {
                const result = SphericalUtils.findNearestPlanet(state.player.pos, state.islands);
                const spawn = result ? result.planet : state.islands[0];
                const normal = SphericalUtils.getSurfaceNormal(state.player.pos, spawn);
                const surfacePos = spawn.center.clone().add(normal.multiplyScalar(spawn.radius + 2));
                state.player.pos.copy(surfacePos);
                state.player.vel.set(0, 0, 0);
            }
        }
    }

    _updateStatBoosts(dt, state, world, audio, factory, t) {
        const playerPos = state.player.pos;

        for (let i = state.statBoosts.length - 1; i >= 0; i--) {
            const boost = state.statBoosts[i];

            if (boost.scale.x < 0.99) {
                boost.scale.lerp(new THREE.Vector3(1, 1, 1), smoothFactor(0.05, dt));
            }

            const crystal = boost.userData.crystal;
            if (crystal) {
                crystal.position.y = 0.3 + Math.sin(t * STAT_BOOST_BOB_SPEED) * STAT_BOOST_BOB_HEIGHT;
                crystal.rotation.y += STAT_BOOST_SPIN_SPEED * dt;
            }

            // 3D proximity pickup
            const dist = boost.position.distanceTo(playerPos);

            if (dist < STAT_BOOST_PICKUP_RANGE) {
                const stat = boost.userData.stat;
                const amount = boost.userData.amount;
                // A5: clamp growth at defined caps. The crystal is still consumed
                // and the pickup FX still plays below — capped stats just stop growing.
                if (stat === 'attack') {
                    const cap = PLAYER_BASE_ATTACK * ESSENCE_ATTACK_CAP_MULT;
                    state.player.attack = Math.min(state.player.attack + amount, cap);
                } else if (stat === 'speed') {
                    // PLAYER_SPEED_BOOST_CAP centralizes the old PLAYER_SPEED *
                    // ESSENCE_SPEED_BOOST_CAP_MULT formula so the FOV kick
                    // (PlayerController) reads the exact same cap.
                    state.player.speedBoost = Math.min(state.player.speedBoost + amount, PLAYER_SPEED_BOOST_CAP);
                } else if (stat === 'health') {
                    const cap = PLAYER_MAX_HP * ESSENCE_MAX_HP_CAP_MULT;
                    state.player.maxHp = Math.min(state.player.maxHp + amount, cap);
                    state.player.hp = Math.min(state.player.hp + amount, state.player.maxHp);
                }

                for (let j = 0; j < 15; j++) {
                    factory.createParticle(boost.position.clone(), boost.userData.color, 1.2);
                }
                audio.pickup();

                world.remove(boost);
                state.statBoosts.splice(i, 1);
            }
        }
    }

    _updateUI(state) {
        const hpFill = this.ui.hpFill;
        const hpText = this.ui.hpText;
        const hpBar = this.ui.hpBar;
        const deathScreen = this.ui.deathScreen;

        if (hpFill) {
            const pct = (state.player.hp / state.player.maxHp) * 100;
            hpFill.style.width = pct + '%';
            if (pct > 50) hpFill.style.background = '#44ff44';
            else if (pct > 25) hpFill.style.background = '#ffcc00';
            else hpFill.style.background = '#ff4444';
        }
        if (hpText) {
            hpText.textContent = state.player.hp + ' / ' + state.player.maxHp;
        }

        if (hpBar) {
            if (state.invincibleTimer > 0) {
                hpBar.style.opacity = Math.sin(state.invincibleTimer * 16) > 0 ? '1' : '0.3';
            } else {
                hpBar.style.opacity = '1';
            }
        }

        if (deathScreen) {
            deathScreen.style.display = state.isDead ? 'flex' : 'none';
        }
    }
}
