// =====================================================
// BREACH SYSTEM - Terrarium combat/ecology across planets
// =====================================================

import SphericalUtils from '../classes/SphericalUtils.js';

const PROJECTILE_SPEED = 24;
const PROJECTILE_LIFE = 4.5;
const PROJECTILE_RADIUS = 0.18;
const ENEMY_HP = 100;
const SHOT_DAMAGE = 50;
const ENEMY_ATTACK_RANGE = 1.45;
const ENEMY_AGGRO_RANGE = 13;
const RAGDOLL_LIFE = 7.5;
export default class BreachSystem {
    constructor(ui) {
        this.ui = ui;
        this.world = null;
        this.state = null;
        this.playerController = null;
        this.factory = null;
        this.audio = null;
        this.planets = [];
        this.planetRecords = [];
        this.enemies = [];
        this.projectiles = [];
        this.ragdolls = [];
        this.dewDrops = [];
        this.cooldown = 0;
        this.aimHeld = 0;
        this.recoil = 0;
        this.recoilVelocity = 0;
        this.weapon = null;
        this.muzzle = null;
        this.muzzleTimer = 0;
        this.completed = false;
        this._tmp = new THREE.Vector3();
        this._tmp2 = new THREE.Vector3();
        this._raycaster = new THREE.Raycaster();
    }

    initialize(planets, ctx) {
        this.cleanup();
        this.world = ctx.world;
        this.state = ctx.state;
        this.playerController = ctx.playerController;
        this.factory = ctx.factory;
        this.audio = ctx.audio;
        this.planets = planets.slice();
        this.completed = false;
        this.state.breachEquipped = false;
        this.state.breachAiming = false;
        this.state.breachKills = 0;
        this.state.breachTotal = 0;
        this.createWeapon();

        const counts = [2, 3, 3, 4, 4];
        this.planets.forEach((planet, index) => {
            const record = {
                planet,
                index,
                name: (ctx.state.islands[index] && ctx.state.islands[index].name) || planet.name || `PLANET ${index + 1}`,
                total: counts[index] || 3,
                remaining: counts[index] || 3,
                stability: index === 0 ? 58 : Math.max(18, 46 - index * 6),
                heart: this.createWorldHeart(planet, index),
            };
            this.planetRecords.push(record);
            for (let i = 0; i < record.total; i++) this.spawnEnemy(record, i);
            this.state.breachTotal += record.total;
        });
        this.updateHud(true);
    }

    cleanup() {
        if (this.world) {
            if (this.weapon && this.weapon.parent) this.weapon.parent.remove(this.weapon);
            for (const enemy of this.enemies) {
                if (enemy.group && enemy.group.parent) this.world.remove(enemy.group);
            }
            for (const projectile of this.projectiles) {
                if (projectile.mesh && projectile.mesh.parent) this.world.remove(projectile.mesh);
                if (projectile.trail && projectile.trail.parent) this.world.remove(projectile.trail);
            }
            for (const ragdoll of this.ragdolls) {
                for (const part of ragdoll.parts) if (part.mesh.parent) this.world.remove(part.mesh);
            }
            for (const drop of this.dewDrops) if (drop.mesh.parent) this.world.remove(drop.mesh);
            for (const record of this.planetRecords) if (record.heart && record.heart.parent) this.world.remove(record.heart);
        }
        this.planets = [];
        this.planetRecords = [];
        this.enemies = [];
        this.projectiles = [];
        this.ragdolls = [];
        this.dewDrops = [];
        this.weapon = null;
        this.muzzle = null;
    }

    createWeapon() {
        if (!this.playerController || !this.playerController.handAnchorR) return;
        const weapon = new THREE.Group();
        weapon.name = 'Breach Lance';
        const shell = new THREE.MeshStandardMaterial({ color: 0x263236, roughness: 0.42, metalness: 0.38 });
        const bone = new THREE.MeshStandardMaterial({ color: 0xc2bda8, roughness: 0.78, metalness: 0.02 });
        const glow = new THREE.MeshStandardMaterial({ color: 0xb7ef83, emissive: 0x4d8f50, emissiveIntensity: 2.1, roughness: 0.24, metalness: 0.08 });

        const receiver = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.095, 0.58, 7), shell);
        receiver.rotation.x = Math.PI / 2;
        receiver.position.z = 0.28;
        const stock = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.13, 0.34), bone);
        stock.position.set(0, 0, -0.16);
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.28, 0.11), shell);
        grip.position.set(0, -0.17, 0.02);
        grip.rotation.x = -0.38;
        const chamber = new THREE.Mesh(new THREE.DodecahedronGeometry(0.11, 0), glow);
        chamber.position.z = 0.25;
        const railGeo = new THREE.CylinderGeometry(0.026, 0.035, 0.72, 7);
        for (const x of [-0.065, 0.065]) {
            const rail = new THREE.Mesh(railGeo, shell);
            rail.rotation.x = Math.PI / 2;
            rail.position.set(x, 0.035, 0.55);
            weapon.add(rail);
        }
        for (let i = 0; i < 3; i++) {
            const coil = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.014, 6, 18), i % 2 ? glow : bone);
            coil.rotation.x = Math.PI / 2;
            coil.position.z = 0.34 + i * 0.18;
            coil.userData.phase = i * 1.7;
            weapon.add(coil);
        }
        const muzzle = new THREE.Group();
        muzzle.position.z = 0.94;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.018, 6, 18), glow);
        ring.rotation.x = Math.PI / 2;
        const flash = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 1), new THREE.MeshBasicMaterial({ color: 0xe9ffc3, transparent: true, opacity: 0.95 }));
        flash.position.z = 0.05;
        muzzle.add(ring, flash);
        muzzle.visible = false;
        this.muzzle = muzzle;
        weapon.add(receiver, stock, grip, chamber, muzzle);
        weapon.scale.setScalar(1.28);
        // ProceduralRig's hand anchor uses +Z as weapon-forward. Keep the lance
        // in that basis so the barrel follows the solved wrist rather than a
        // legacy single-axis arm rotation.
        weapon.rotation.set(0, 0, 0);
        weapon.position.set(0, -0.025, -0.07);
        weapon.visible = false;
        this.playerController.handAnchorR.add(weapon);
        this.weapon = weapon;
    }

    createWorldHeart(planet, index) {
        const normal = new THREE.Vector3(0, 1, 0);
        normal.applyAxisAngle(new THREE.Vector3(0, 0, 1), 0.45 + index * 0.31);
        normal.applyAxisAngle(new THREE.Vector3(0, 1, 0), index * 1.2);
        const terrainRadius = SphericalUtils.sampleTerrainHeight(planet, normal);
        const group = new THREE.Group();
        const stoneMat = new THREE.MeshStandardMaterial({ color: 0x606a66, roughness: 0.94, metalness: 0.02, flatShading: true });
        const heartMat = new THREE.MeshStandardMaterial({ color: 0xaede82, emissive: 0x315d39, emissiveIntensity: 1.35, roughness: 0.28, metalness: 0.08 });
        for (let i = 0; i < 7; i++) {
            const a = i / 7 * Math.PI * 2;
            const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.18 + (i % 2) * 0.04, 0), stoneMat);
            stone.position.set(Math.cos(a) * 0.78, 0.13, Math.sin(a) * 0.78);
            stone.scale.y = 0.65;
            group.add(stone);
        }
        const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 1), heartMat);
        core.position.y = 0.55;
        core.userData.baseY = 0.55;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.018, 7, 32), new THREE.MeshBasicMaterial({ color: 0xdfffb1, transparent: true, opacity: 0.55 }));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.14;
        group.add(core, ring);
        group.userData.core = core;
        group.userData.ring = ring;
        group.userData.planet = planet;
        group.position.copy(planet.center).add(normal.multiplyScalar(terrainRadius + 0.05));
        group.quaternion.copy(SphericalUtils.getOrientationOnSurface(normal));
        this.world.add(group);
        return group;
    }

    spawnEnemy(record, index) {
        const planet = record.planet;
        const point = SphericalUtils.randomSurfacePoint(planet, Math.PI);
        const normal = SphericalUtils.getSurfaceNormal(point, planet);
        const terrainRadius = SphericalUtils.sampleTerrainHeight(planet, normal);
        const surface = planet.center.clone().add(normal.clone().multiplyScalar(terrainRadius + 0.03));
        const group = new THREE.Group();
        group.position.copy(surface);
        group.name = `Blight ${record.name} ${index + 1}`;

        const shellMat = new THREE.MeshStandardMaterial({ color: index % 2 ? 0x492d52 : 0x36253e, emissive: 0x160815, emissiveIntensity: 0.18, roughness: 0.72, metalness: 0.03, flatShading: true });
        const fleshMat = new THREE.MeshStandardMaterial({ color: index % 2 ? 0x8a5276 : 0x70465f, emissive: 0x210b1b, emissiveIntensity: 0.16, roughness: 0.78, metalness: 0.0, flatShading: true });
        const eyeMat = new THREE.MeshPhongMaterial({ color: 0xffd07a, emissive: 0xff4422, emissiveIntensity: 2.2 });
        const auraMat = new THREE.MeshBasicMaterial({ color: 0xc44f8b, transparent: true, opacity: 0.38, depthWrite: false });

        const body = new THREE.Mesh(new THREE.DodecahedronGeometry(0.43, 0), shellMat);
        body.position.y = 0.67;
        body.scale.set(0.78, 1.08, 0.72);
        const head = new THREE.Mesh(new THREE.DodecahedronGeometry(0.29, 0), fleshMat);
        head.position.set(0, 1.12, 0.03);
        const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.047, 7, 5), eyeMat);
        const eyeR = eyeL.clone();
        eyeL.position.set(-0.105, 0.03, 0.25);
        eyeR.position.set(0.105, 0.03, 0.25);
        head.add(eyeL, eyeR);
        const legGeo = new THREE.CylinderGeometry(0.065, 0.085, 0.54, 6);
        const legL = new THREE.Mesh(legGeo, fleshMat);
        const legR = legL.clone();
        legL.position.set(-0.17, 0.27, 0);
        legR.position.set(0.17, 0.27, 0);
        const footGeo = new THREE.BoxGeometry(0.15, 0.10, 0.27);
        const footL = new THREE.Mesh(footGeo, shellMat);
        const footR = footL.clone();
        footL.position.set(-0.17, 0.055, 0.075);
        footR.position.set(0.17, 0.055, 0.075);
        const armGeo = new THREE.CylinderGeometry(0.055, 0.07, 0.48, 6);
        const armL = new THREE.Mesh(armGeo, fleshMat);
        const armR = armL.clone();
        armL.position.set(-0.39, 0.73, 0.01);
        armR.position.set(0.39, 0.73, 0.01);
        armL.rotation.z = -0.22;
        armR.rotation.z = 0.22;
        const aura = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.03, 6, 22), auraMat);
        aura.rotation.x = Math.PI / 2;
        aura.position.y = 0.06;
        group.add(body, head, legL, legR, footL, footR, armL, armR, aura);
        group.quaternion.copy(SphericalUtils.getOrientationOnSurface(normal));
        this.world.add(group);

        const enemy = {
            group, body, head, legL, legR, footL, footR, armL, armR, aura,
            record, planet, hp: ENEMY_HP, alive: true,
            attackCooldown: Math.random() * 0.8,
            wanderTimer: 0,
            wanderDir: SphericalUtils._getArbitraryTangent(normal),
            phase: Math.random() * Math.PI * 2,
            speed: 1.15 + record.index * 0.12 + Math.random() * 0.25,
            knockback: new THREE.Vector3(),
            hitFlash: 0,
            attackPulse: 0,
            gaitBlend: 0,
        };
        group.traverse(o => { o.userData.blightEnemy = enemy; });
        this.enemies.push(enemy);
    }

    toggleRifle() {
        if (!this.state || this.state.isOnBoat || this.state.isDead) return false;
        this.state.breachEquipped = !this.state.breachEquipped;
        this.state.breachAiming = false;
        this.aimHeld = 0;
        this.playerController?.setBreachCharge?.(0);
        if (this.weapon) this.weapon.visible = this.state.breachEquipped;
        if (this.state.breachEquipped) {
            this.state.selectedSlot = null;
            this.playerController.holdItem(null);
            const hint = document.getElementById('axe-hint');
            if (hint) {
                hint.textContent = 'BREACH LANCE EQUIPPED · Hold LMB, release to fire';
                hint.style.display = 'block';
                setTimeout(() => { if (hint.textContent.startsWith('BREACH')) hint.style.display = 'none'; }, 2300);
            }
        }
        this.updateHud(true);
        return true;
    }

    beginAim() {
        if (!this.state || !this.state.breachEquipped || this.state.isOnBoat || this.state.isDead || this.completed) return false;
        this.state.breachAiming = true;
        this.aimHeld = 0;
        return true;
    }

    releaseAim(camera) {
        if (!this.state || !this.state.breachAiming) return false;
        this.state.breachAiming = false;
        this.fire(camera);
        this.aimHeld = 0;
        this.playerController?.setBreachCharge?.(0);
        return true;
    }

    cancelAim() {
        if (this.state) this.state.breachAiming = false;
        this.aimHeld = 0;
        this.playerController?.setBreachCharge?.(0);
    }

    fire(camera) {
        if (this.cooldown > 0 || !camera || !this.state.breachEquipped) return;
        this.cooldown = 0.22;
        const charge = THREE.MathUtils.clamp(this.aimHeld / 0.65, 0, 1);
        const direction = new THREE.Vector3();
        camera.getWorldDirection(direction).normalize();
        const origin = new THREE.Vector3();
        if (this.muzzle) {
            this.muzzle.updateWorldMatrix(true, false);
            this.muzzle.getWorldPosition(origin);
        } else {
            this.playerController.getWeaponWorldTransform(origin, new THREE.Vector3());
            origin.addScaledVector(direction, 0.8);
        }

        const material = new THREE.MeshPhongMaterial({
            color: 0xe9ffc4,
            emissive: 0x8ce05d,
            emissiveIntensity: 3.2,
            shininess: 100,
            transparent: true,
            opacity: 0.98,
        });
        const mesh = new THREE.Group();
        const radius = PROJECTILE_RADIUS * (0.9 + charge * 0.35);
        const core = new THREE.Mesh(new THREE.SphereGeometry(radius, 10, 8), material);
        const bolt = new THREE.Mesh(
            new THREE.CylinderGeometry(radius * 0.42, radius * 0.72, 0.48 + charge * 0.32, 8),
            material.clone()
        );
        bolt.rotation.x = Math.PI / 2;
        bolt.position.z = -0.18;
        const halo = new THREE.Mesh(
            new THREE.SphereGeometry(radius * 2.15, 9, 7),
            new THREE.MeshBasicMaterial({ color: 0xb8ff85, transparent: true, opacity: 0.19, depthWrite: false, blending: THREE.AdditiveBlending })
        );
        const light = new THREE.PointLight(0xbaff8d, 1.1 + charge * 0.8, 3.2 + charge * 2.0, 2);
        mesh.add(core, bolt, halo, light);
        mesh.position.copy(origin);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);

        const trailGeometry = new THREE.BufferGeometry();
        const trailPositions = new Float32Array(10 * 3);
        for (let i = 0; i < 10; i++) {
            trailPositions[i * 3] = origin.x;
            trailPositions[i * 3 + 1] = origin.y;
            trailPositions[i * 3 + 2] = origin.z;
        }
        trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
        const trail = new THREE.Line(
            trailGeometry,
            new THREE.LineBasicMaterial({ color: 0xcaff9d, transparent: true, opacity: 0.64, blending: THREE.AdditiveBlending, depthWrite: false })
        );
        this.world.add(mesh);
        this.world.add(trail);
        this.projectiles.push({
            mesh, trail, trailPositions,
            position: origin.clone(),
            previous: origin.clone(),
            velocity: direction.clone().multiplyScalar(PROJECTILE_SPEED * (0.82 + charge * 0.32)),
            age: 0,
            life: PROJECTILE_LIFE,
            damage: SHOT_DAMAGE * (0.9 + charge * 0.35),
            radius,
        });
        this.muzzleTimer = 0.09;
        if (this.muzzle) this.muzzle.visible = true;
        this.recoilVelocity += 6 + charge * 4;
        this.playerController.addWeaponRecoil(0.72 + charge * 0.55);
        this.state.addShake(0.05 + charge * 0.04);
        if (this.audio && this.audio.attack) this.audio.attack();
    }

    update(dt, ctx) {
        if (!this.state || !this.world || this.state.isResettingWorld) return;
        this.cooldown = Math.max(0, this.cooldown - dt);
        this.muzzleTimer = Math.max(0, this.muzzleTimer - dt);
        if (this.muzzle) this.muzzle.visible = this.muzzleTimer > 0;
        if (this.state.breachAiming) this.aimHeld += dt;

        this.recoilVelocity += (-this.recoil * 50 - this.recoilVelocity * 10) * dt;
        this.recoil += this.recoilVelocity * dt;
        this.updateWeapon(dt, ctx.camera);
        this.updateProjectiles(dt, ctx);
        this.updateEnemies(dt, ctx);
        this.updateRagdolls(dt);
        this.updateDew(dt, ctx);
        this.updateHearts(dt, ctx.t || 0);
        this.updateHud(false);
    }

    updateWeapon(dt, camera) {
        if (!this.weapon) return;
        if (this.state.isDead) this.cancelAim();
        this.weapon.visible = !!this.state.breachEquipped && !this.state.isOnBoat && !this.state.isDead;
        if (!this.weapon.visible) return;
        this.weapon.position.z = -0.07 - this.recoil * 0.022;
        this.weapon.position.y = -0.025 + Math.abs(this.recoil) * 0.018;
        const charge = THREE.MathUtils.clamp(this.aimHeld / 0.65, 0, 1);
        this.playerController.setBreachCharge(charge);
        this.playerController.weaponRecoil = this.recoil;
        const pulse = 1 + Math.sin(performance.now() * 0.006) * 0.035 + charge * 0.065;
        this.weapon.children.forEach(child => {
            if (child.geometry && child.geometry.type === 'TorusGeometry') child.scale.setScalar(pulse);
        });
    }

    updateProjectiles(dt, ctx) {
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p = this.projectiles[i];
            p.age += dt;
            p.previous.copy(p.position);
            p.position.addScaledVector(p.velocity, dt);
            p.mesh.position.copy(p.position);
            p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), p.velocity.clone().normalize());
            p.mesh.rotation.z += dt * 9;
            if (p.trail && p.trailPositions) {
                for (let k = 9; k > 0; k--) {
                    p.trailPositions[k * 3] = p.trailPositions[(k - 1) * 3];
                    p.trailPositions[k * 3 + 1] = p.trailPositions[(k - 1) * 3 + 1];
                    p.trailPositions[k * 3 + 2] = p.trailPositions[(k - 1) * 3 + 2];
                }
                p.trailPositions[0] = p.position.x;
                p.trailPositions[1] = p.position.y;
                p.trailPositions[2] = p.position.z;
                p.trail.geometry.attributes.position.needsUpdate = true;
                p.trail.material.opacity = Math.max(0, 0.64 * (1 - p.age / p.life));
            }

            let hitEnemy = null;
            let hitPoint = null;
            for (const enemy of this.enemies) {
                if (!enemy.alive) continue;
                const center = enemy.group.position.clone().addScaledVector(SphericalUtils.getSurfaceNormal(enemy.group.position, enemy.planet), 0.72);
                const segment = p.position.clone().sub(p.previous);
                const lenSq = segment.lengthSq();
                let q = p.previous;
                if (lenSq > 0.000001) {
                    const t = THREE.MathUtils.clamp(center.clone().sub(p.previous).dot(segment) / lenSq, 0, 1);
                    q = p.previous.clone().addScaledVector(segment, t);
                }
                if (q.distanceToSquared(center) < (0.58 + p.radius) * (0.58 + p.radius)) {
                    hitEnemy = enemy;
                    hitPoint = q.clone();
                    break;
                }
            }
            if (hitEnemy) {
                const dir = p.velocity.clone().normalize();
                this.damageEnemy(hitEnemy, p.damage, dir, hitPoint, ctx);
                this.removeProjectile(i);
                continue;
            }

            if (p.age > 0.08) {
                let hitPlanet = false;
                for (const planet of this.planets) {
                    const normal = p.position.clone().sub(planet.center).normalize();
                    const terrainRadius = SphericalUtils.sampleTerrainHeight(planet, normal);
                    if (p.position.distanceTo(planet.center) <= terrainRadius + p.radius * 0.45) {
                        hitPlanet = true;
                        if (this.factory) {
                            for (let k = 0; k < 5; k++) this.factory.createParticle(p.position.clone(), new THREE.Color(0xb9ef89), 0.7);
                        }
                        break;
                    }
                }
                if (hitPlanet) {
                    this.removeProjectile(i);
                    continue;
                }
            }

            if (p.age >= p.life) this.removeProjectile(i);
        }
    }

    removeProjectile(index) {
        const p = this.projectiles[index];
        if (p && p.mesh.parent) this.world.remove(p.mesh);
        if (p && p.trail && p.trail.parent) this.world.remove(p.trail);
        p?.trail?.geometry?.dispose?.();
        p?.trail?.material?.dispose?.();
        this.projectiles.splice(index, 1);
    }

    updateEnemies(dt, ctx) {
        const playerPlanet = this.playerController.getCurrentPlanet();
        const playerPos = this.state.player.pos;
        for (const enemy of this.enemies) {
            if (!enemy.alive) continue;
            const normal = SphericalUtils.getSurfaceNormal(enemy.group.position, enemy.planet);
            enemy.attackCooldown -= dt;
            enemy.wanderTimer -= dt;
            enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
            enemy.aura.rotation.z += dt * 0.65;
            enemy.aura.material.opacity = 0.28 + Math.sin((ctx.t || 0) * 3 + enemy.phase) * 0.1;

            let desired = enemy.wanderDir;
            let speed = enemy.speed * 0.3;
            const samePlanet = playerPlanet === enemy.planet && !this.state.isOnBoat;
            const distance = samePlanet ? enemy.group.position.distanceTo(playerPos) : Infinity;
            if (samePlanet && distance < ENEMY_AGGRO_RANGE) {
                desired = playerPos.clone().sub(enemy.group.position);
                speed = enemy.speed;
                if (distance < ENEMY_ATTACK_RANGE && enemy.attackCooldown <= 0) {
                    enemy.attackCooldown = 1.05 - Math.min(0.25, enemy.record.index * 0.04);
                    enemy.attackPulse = 1;
                    if (this.state.invincibleTimer <= 0 && ctx.engineCombatSystem) {
                        ctx.engineCombatSystem.damagePlayerFromBreach(2 + enemy.record.index, ctx, enemy.group.position);
                    } else if (this.state.invincibleTimer <= 0) {
                        this.state.player.hp = Math.max(0, this.state.player.hp - (2 + enemy.record.index));
                        this.state.invincibleTimer = 0.7;
                    }
                    this.state.addShake(0.12);
                }
            } else if (enemy.wanderTimer <= 0) {
                enemy.wanderTimer = 1.5 + Math.random() * 2.5;
                const tangent = SphericalUtils._getArbitraryTangent(normal);
                const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
                enemy.wanderDir = tangent.multiplyScalar(Math.random() - 0.5).addScaledVector(bitangent, Math.random() - 0.5).normalize();
                desired = enemy.wanderDir;
            }

            const move = desired.clone().sub(normal.clone().multiplyScalar(desired.dot(normal)));
            const moving = move.lengthSq() > 0.0001;
            if (moving) {
                move.normalize();
                const next = SphericalUtils.moveOnSurface(enemy.group.position, move, speed * dt, enemy.planet);
                const nextNormal = SphericalUtils.getSurfaceNormal(next, enemy.planet);
                const terrain = SphericalUtils.sampleTerrainSurface(enemy.planet, nextNormal, new THREE.Vector3(), new THREE.Vector3());
                enemy.group.position.copy(terrain.point).addScaledVector(terrain.normal, 0.03);
                const targetQ = SphericalUtils.getOrientationOnSurface(terrain.normal, move);
                enemy.group.quaternion.slerp(targetQ, 1 - Math.exp(-9 * dt));
            }

            // Kinetic creature motion: velocity-blended stride, asymmetric feet,
            // counter-swinging arms, breathing and a springy attack lunge. This is
            // intentionally procedural rather than a baked looping animation so it
            // remains coherent on every curved planetary surface.
            enemy.gaitBlend = THREE.MathUtils.lerp(enemy.gaitBlend, moving ? Math.min(1, speed / 1.5) : 0, 1 - Math.exp(-7 * dt));
            enemy.attackPulse = Math.max(0, enemy.attackPulse - dt * 3.8);
            const phase = (ctx.t || 0) * (6.5 + speed * 2.4) + enemy.phase;
            const gait = Math.sin(phase) * 0.62 * enemy.gaitBlend;
            const stepLiftL = Math.max(0, Math.sin(phase)) * 0.10 * enemy.gaitBlend;
            const stepLiftR = Math.max(0, -Math.sin(phase)) * 0.10 * enemy.gaitBlend;
            const breath = Math.sin((ctx.t || 0) * 2.4 + enemy.phase) * 0.018;
            const lunge = Math.sin(enemy.attackPulse * Math.PI) * 0.18;
            const squash = Math.sin(enemy.attackPulse * Math.PI) * 0.13;

            enemy.legL.rotation.x = gait;
            enemy.legR.rotation.x = -gait;
            enemy.legL.position.y = 0.27 + stepLiftL * 0.35;
            enemy.legR.position.y = 0.27 + stepLiftR * 0.35;
            enemy.footL.position.set(-0.17, 0.055 + stepLiftL, 0.075 + gait * 0.10);
            enemy.footR.position.set(0.17, 0.055 + stepLiftR, 0.075 - gait * 0.10);
            enemy.footL.rotation.x = -gait * 0.42;
            enemy.footR.rotation.x = gait * 0.42;
            enemy.armL.rotation.x = -gait * 0.82 - lunge * 1.6;
            enemy.armR.rotation.x = gait * 0.82 - lunge * 1.6;
            enemy.armL.rotation.z = -0.22 - enemy.gaitBlend * 0.09;
            enemy.armR.rotation.z = 0.22 + enemy.gaitBlend * 0.09;
            enemy.body.position.y = 0.67 + Math.abs(Math.sin(phase)) * 0.045 * enemy.gaitBlend + breath - squash * 0.08;
            enemy.body.position.z = lunge;
            enemy.body.rotation.z = Math.sin(phase * 0.5) * 0.08 * enemy.gaitBlend;
            enemy.body.rotation.x = -lunge * 0.65;
            enemy.head.position.y = 1.12 + breath * 0.55 - squash * 0.06;
            enemy.head.position.z = 0.03 + lunge * 1.18;
            enemy.head.rotation.y = Math.sin((ctx.t || 0) * 1.7 + enemy.phase) * 0.12 * (1 - enemy.gaitBlend);
            if (enemy.hitFlash > 0) enemy.body.scale.lerp(new THREE.Vector3(0.92, 1.24, 0.86), 1 - Math.exp(-18 * dt));
            else enemy.body.scale.lerp(new THREE.Vector3(0.78 + squash * 0.08, 1.08 - squash, 0.72 + squash * 0.12), 1 - Math.exp(-10 * dt));
            const flash = enemy.hitFlash > 0 ? 1.5 : 0.18;
            enemy.body.material.emissiveIntensity = THREE.MathUtils.lerp(enemy.body.material.emissiveIntensity, flash, 1 - Math.exp(-18 * dt));
        }
    }

    damageEnemy(enemy, damage, direction, point, ctx) {
        enemy.hp -= damage;
        enemy.hitFlash = 0.12;
        if (this.factory) {
            for (let i = 0; i < 10; i++) this.factory.createParticle(point.clone(), new THREE.Color(0xd8ff76), 1.2);
        }
        if (enemy.hp <= 0) this.killEnemy(enemy, direction, point, ctx);
        else if (this.audio && this.audio.hit) this.audio.hit();
    }

    killEnemy(enemy, direction, point, ctx) {
        if (!enemy.alive) return;
        enemy.alive = false;
        enemy.record.remaining = Math.max(0, enemy.record.remaining - 1);
        enemy.record.stability = Math.min(100, enemy.record.stability + 100 / enemy.record.total);
        this.state.breachKills++;
        this.createRagdoll(enemy, direction);
        if (this.factory) {
            for (let i = 0; i < 22; i++) this.factory.createParticle(point.clone(), new THREE.Color(0xc87cad), 1.8);
        }
        if (Math.random() < 0.55) this.createDewDrop(enemy.planet, enemy.group.position);
        if (this.audio && this.audio.purge) this.audio.purge();
        if (enemy.record.remaining === 0) {
            enemy.record.stability = 100;
            const core = enemy.record.heart.userData.core;
            if (core && core.material) core.material.emissiveIntensity = 3.2;
            this.showToast(`${enemy.record.name} RESTORED`);
        } else {
            this.showToast(`${enemy.record.name}: ${enemy.record.remaining} blight remain`);
        }
        if (this.state.breachKills >= this.state.breachTotal) {
            this.completed = true;
            this.showToast('THE SOLAR BREACH IS SEALED · ALL FIVE WORLDS RESTORED');
        }
        this.updateHud(true);
    }

    createRagdoll(enemy, direction) {
        enemy.group.updateMatrixWorld(true);
        const normal = SphericalUtils.getSurfaceNormal(enemy.group.position, enemy.planet);
        const pieces = [
            { mesh: enemy.body, radius: 0.27, mass: 1.0 },
            { mesh: enemy.head, radius: 0.23, mass: 0.7 },
            { mesh: enemy.legL, radius: 0.11, mass: 0.4 },
            { mesh: enemy.legR, radius: 0.11, mass: 0.4 },
            { mesh: enemy.footL, radius: 0.10, mass: 0.25 },
            { mesh: enemy.footR, radius: 0.10, mass: 0.25 },
            { mesh: enemy.armL, radius: 0.10, mass: 0.3 },
            { mesh: enemy.armR, radius: 0.10, mass: 0.3 },
        ];
        const parts = [];
        for (const spec of pieces) {
            const pos = spec.mesh.getWorldPosition(new THREE.Vector3());
            const quat = spec.mesh.getWorldQuaternion(new THREE.Quaternion());
            this.world.scene.attach(spec.mesh);
            spec.mesh.position.copy(pos);
            spec.mesh.quaternion.copy(quat);
            parts.push({
                mesh: spec.mesh,
                radius: spec.radius,
                velocity: direction.clone().multiplyScalar(3.8 + Math.random() * 2.4)
                    .addScaledVector(normal, 1.3 + Math.random() * 2.2)
                    .add(new THREE.Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2)),
                angular: new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9),
            });
        }
        if (enemy.aura.parent) enemy.aura.parent.remove(enemy.aura);
        if (enemy.group.parent) this.world.remove(enemy.group);
        this.ragdolls.push({ parts, planet: enemy.planet, age: 0 });
    }

    updateRagdolls(dt) {
        for (let i = this.ragdolls.length - 1; i >= 0; i--) {
            const rag = this.ragdolls[i];
            rag.age += dt;
            for (const part of rag.parts) {
                const toCenter = rag.planet.center.clone().sub(part.mesh.position);
                const normal = toCenter.clone().normalize().negate();
                const gravity = toCenter.normalize().multiplyScalar(7.0);
                part.velocity.addScaledVector(gravity, dt);
                part.velocity.multiplyScalar(Math.pow(0.992, dt * 60));
                part.mesh.position.addScaledVector(part.velocity, dt);
                part.mesh.rotateX(part.angular.x * dt);
                part.mesh.rotateY(part.angular.y * dt);
                part.mesh.rotateZ(part.angular.z * dt);
                part.angular.multiplyScalar(Math.pow(0.986, dt * 60));

                const radial = SphericalUtils.getSurfaceNormal(part.mesh.position, rag.planet);
                const surface = SphericalUtils.sampleTerrainSurface(rag.planet, radial, new THREE.Vector3(), new THREE.Vector3());
                const signedHeight = part.mesh.position.clone().sub(surface.point).dot(surface.normal);
                if (signedHeight < part.radius) {
                    part.mesh.position.addScaledVector(surface.normal, part.radius - signedHeight);
                    const vn = part.velocity.dot(surface.normal);
                    if (vn < 0) part.velocity.addScaledVector(surface.normal, -vn * 1.18);
                    const tangentVelocity = part.velocity.clone().projectOnPlane(surface.normal);
                    part.velocity.lerp(tangentVelocity.multiplyScalar(0.78), 0.32);
                    part.velocity.multiplyScalar(0.76);
                    part.angular.multiplyScalar(0.82);
                }
                const fade = THREE.MathUtils.clamp((RAGDOLL_LIFE - rag.age) / 1.2, 0, 1);
                if (rag.age > RAGDOLL_LIFE - 1.2) part.mesh.scale.multiplyScalar(0.985 + fade * 0.015);
            }
            if (rag.age >= RAGDOLL_LIFE) {
                for (const part of rag.parts) if (part.mesh.parent) this.world.remove(part.mesh);
                this.ragdolls.splice(i, 1);
            }
        }
    }

    createDewDrop(planet, position) {
        const normal = SphericalUtils.getSurfaceNormal(position, planet);
        const terrainRadius = SphericalUtils.sampleTerrainHeight(planet, normal);
        const mesh = new THREE.Group();
        const gem = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), new THREE.MeshPhongMaterial({ color: 0x8feeff, emissive: 0x2f8ca5, emissiveIntensity: 1.6 }));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.014, 6, 20), new THREE.MeshBasicMaterial({ color: 0xbff7ff, transparent: true, opacity: 0.55 }));
        ring.rotation.x = Math.PI / 2;
        mesh.add(gem, ring);
        mesh.position.copy(planet.center).add(normal.multiplyScalar(terrainRadius + 0.48));
        this.world.add(mesh);
        this.dewDrops.push({ mesh, planet, normal: normal.clone(), phase: Math.random() * Math.PI * 2, age: 0 });
    }

    updateDew(dt, ctx) {
        const playerPlanet = this.playerController.getCurrentPlanet();
        for (let i = this.dewDrops.length - 1; i >= 0; i--) {
            const drop = this.dewDrops[i];
            drop.age += dt;
            drop.mesh.rotation.y += dt * 1.6;
            const terrainRadius = SphericalUtils.sampleTerrainHeight(drop.planet, drop.normal);
            const bob = 0.48 + Math.sin(drop.age * 3 + drop.phase) * 0.08;
            drop.mesh.position.copy(drop.planet.center).add(drop.normal.clone().multiplyScalar(terrainRadius + bob));
            if (playerPlanet === drop.planet && drop.mesh.position.distanceTo(this.state.player.pos) < 1.35) {
                this.state.player.hp = Math.min(this.state.player.maxHp, this.state.player.hp + 5);
                if (this.audio && this.audio.pickup) this.audio.pickup();
                if (drop.mesh.parent) this.world.remove(drop.mesh);
                this.dewDrops.splice(i, 1);
            }
        }
    }

    updateHearts(dt, t) {
        for (const record of this.planetRecords) {
            const heart = record.heart;
            if (!heart) continue;
            const core = heart.userData.core;
            const ring = heart.userData.ring;
            if (core) {
                core.position.y = core.userData.baseY + Math.sin(t * 1.8 + record.index) * 0.08;
                core.rotation.y += dt * 0.7;
                if (core.material) core.material.emissiveIntensity = THREE.MathUtils.lerp(core.material.emissiveIntensity, record.remaining === 0 ? 3.0 : 0.8 + record.stability * 0.012, 1 - Math.exp(-4 * dt));
            }
            if (ring) {
                ring.rotation.z += dt * (record.remaining === 0 ? 1.3 : 0.45);
                ring.material.opacity = record.remaining === 0 ? 0.9 : 0.35 + record.stability * 0.003;
            }
        }
    }

    showToast(message) {
        const toast = document.getElementById('breach-toast');
        if (!toast) return;
        toast.textContent = message;
        toast.classList.add('visible');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => toast.classList.remove('visible'), 2600);
    }

    updateHud(force) {
        if (!this.ui || !this.state) return;
        const equipped = document.getElementById('breach-mode');
        const remaining = document.getElementById('breach-remaining');
        const planetName = document.getElementById('breach-planet');
        const stability = document.getElementById('breach-stability');
        const fill = document.getElementById('breach-stability-fill');
        const objective = document.getElementById('breach-objective');
        const crosshair = document.getElementById('breach-crosshair');
        if (equipped) equipped.textContent = this.state.breachEquipped ? (this.state.breachAiming ? 'CHARGING' : 'ARMED') : 'HOLSTERED';
        if (remaining) remaining.textContent = `${Math.max(0, this.state.breachTotal - this.state.breachKills)} / ${this.state.breachTotal}`;
        const current = this.planetRecords.find(r => r.planet === this.playerController.getCurrentPlanet());
        if (planetName) planetName.textContent = current ? current.name : 'DEEP SPACE';
        if (stability) stability.textContent = current ? `${Math.round(current.stability)}%` : '—';
        if (fill) fill.style.width = current ? `${current.stability}%` : '0%';
        if (objective) objective.textContent = this.completed ? 'ALL WORLDS RESTORED' : (current ? `${current.remaining} BLIGHT ON THIS WORLD` : 'NAVIGATE TO A PLANET');
        if (crosshair) {
            const visible = !!this.state.breachEquipped && !this.state.isOnBoat && document.pointerLockElement === this.world.renderer.domElement;
            crosshair.style.display = visible ? 'block' : 'none';
            crosshair.classList.toggle('charging', !!this.state.breachAiming);
        }
    }
}

