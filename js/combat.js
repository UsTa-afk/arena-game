/* ==========================================================================
   combat.js
   Physics and combat rules:
     1. Ball vs ball      -> elastic collision (momentum is conserved)
     2. Weapon vs weapon  -> clash: both weapons reverse spin direction
     3. Weapon vs ball    -> damage + weapon-specific on-hit effects
     4. Thrown daggers    -> projectile flight, hit, stick to wall, pick-up

   Collision shapes:
     - Balls are circles.
     - Weapons are rotated rectangles (oriented bounding boxes).
     - Weapon vs ball   uses an OBB-vs-circle test.
     - Weapon vs weapon uses the Separating Axis Theorem (SAT).
   ========================================================================== */

/* --------------------------------------------------------------------------
   Math helpers
   -------------------------------------------------------------------------- */

/** Rotate a 2D vector (dx, dy) by `angle` radians. */
function rotate(dx, dy, angle) {
    return {
        x: dx * Math.cos(angle) - dy * Math.sin(angle),
        y: dx * Math.sin(angle) + dy * Math.cos(angle)
    };
}

/** World position of the center of a ball's orbiting weapon. */
function getWeaponCenter(b) {
    const orbitDist = b.radius + 5 + b.wLength / 2;
    return {
        x: b.x + Math.cos(b.angle) * orbitDist,
        y: b.y + Math.sin(b.angle) * orbitDist
    };
}

/* --------------------------------------------------------------------------
   1. Ball vs ball: 1D elastic collision along the line between centers
   -------------------------------------------------------------------------- */
function resolveCollision(ball1, ball2) {
    const xVelocityDiff = ball1.dx - ball2.dx;
    const yVelocityDiff = ball1.dy - ball2.dy;
    const xDist = ball2.x - ball1.x;
    const yDist = ball2.y - ball1.y;

    // Only resolve if the balls are moving towards each other.
    // This stops overlapping balls from "sticking" together.
    if (xVelocityDiff * xDist + yVelocityDiff * yDist >= 0) {
        // Rotate velocities so the collision becomes one-dimensional (along X)
        const angle = -Math.atan2(ball2.y - ball1.y, ball2.x - ball1.x);
        const m1 = ball1.mass;
        const m2 = ball2.mass;

        const u1 = rotate(ball1.dx, ball1.dy, angle);
        const u2 = rotate(ball2.dx, ball2.dy, angle);

        // Standard 1D elastic collision formula on the X component
        const v1 = { x: u1.x * (m1 - m2) / (m1 + m2) + u2.x * 2 * m2 / (m1 + m2), y: u1.y };
        const v2 = { x: u2.x * (m1 - m2) / (m1 + m2) + u1.x * 2 * m1 / (m1 + m2), y: u2.y };

        // Rotate back to world space
        const vFinal1 = rotate(v1.x, v1.y, -angle);
        const vFinal2 = rotate(v2.x, v2.y, -angle);

        ball1.dx = vFinal1.x;
        ball1.dy = vFinal1.y;
        ball2.dx = vFinal2.x;
        ball2.dy = vFinal2.y;
    }
}

/* --------------------------------------------------------------------------
   2. Weapon vs ball: rotated rectangle vs circle
   -------------------------------------------------------------------------- */
function checkWeaponHit(attacker, defender) {
    if (defender.iframes > 0) return false;

    const w = getWeaponCenter(attacker);

    // Move the defender into the weapon's local space,
    // where the weapon is an axis-aligned rectangle centered at (0, 0)
    const dx = defender.x - w.x;
    const dy = defender.y - w.y;
    const localX = dx * Math.cos(-attacker.angle) - dy * Math.sin(-attacker.angle);
    const localY = dx * Math.sin(-attacker.angle) + dy * Math.cos(-attacker.angle);

    const halfW = attacker.wLength / 2;
    const halfH = attacker.wWidth / 2;

    // Closest point on the rectangle to the circle center (clamp)
    const closestX = Math.max(-halfW, Math.min(halfW, localX));
    const closestY = Math.max(-halfH, Math.min(halfH, localY));

    const distX = localX - closestX;
    const distY = localY - closestY;

    // Hit if that closest point is inside the circle
    return (distX * distX) + (distY * distY) < (defender.radius * defender.radius);
}

/* --------------------------------------------------------------------------
   3. Weapon vs weapon: Separating Axis Theorem
   -------------------------------------------------------------------------- */

/** The 4 world-space corners of a ball's weapon rectangle. */
function getWeaponCorners(b) {
    const c = getWeaponCenter(b);
    const hw = b.wLength / 2;
    const hh = b.wWidth / 2;
    const cosA = Math.cos(b.angle);
    const sinA = Math.sin(b.angle);

    return [
        { x: c.x + hw * cosA - hh * sinA,       y: c.y + hw * sinA + hh * cosA },
        { x: c.x + hw * cosA - (-hh) * sinA,    y: c.y + hw * sinA + (-hh) * cosA },
        { x: c.x + (-hw) * cosA - (-hh) * sinA, y: c.y + (-hw) * sinA + (-hh) * cosA },
        { x: c.x + (-hw) * cosA - hh * sinA,    y: c.y + (-hw) * sinA + hh * cosA }
    ];
}

/**
 * SAT test for two convex polygons.
 * Project both polygons on the normal of every edge; if any projection
 * does not overlap, there is a gap (separating axis) and they don't touch.
 */
function doPolygonsIntersect(a, b) {
    const polygons = [a, b];
    for (let i = 0; i < polygons.length; i++) {
        const polygon = polygons[i];
        for (let i1 = 0; i1 < polygon.length; i1++) {
            const i2 = (i1 + 1) % polygon.length;
            const p1 = polygon[i1];
            const p2 = polygon[i2];
            const normal = { x: p2.y - p1.y, y: p1.x - p2.x };

            let minA = Infinity, maxA = -Infinity;
            for (let j = 0; j < a.length; j++) {
                const projected = normal.x * a[j].x + normal.y * a[j].y;
                if (projected < minA) minA = projected;
                if (projected > maxA) maxA = projected;
            }

            let minB = Infinity, maxB = -Infinity;
            for (let j = 0; j < b.length; j++) {
                const projected = normal.x * b[j].x + normal.y * b[j].y;
                if (projected < minB) minB = projected;
                if (projected > maxB) maxB = projected;
            }

            if (maxA < minB || maxB < minA) return false; // separating axis found
        }
    }
    return true;
}

function checkWeaponVsWeapon(b1, b2) {
    if (b1.weaponCooldown > 0 || b2.weaponCooldown > 0) return false;
    return doPolygonsIntersect(getWeaponCorners(b1), getWeaponCorners(b2));
}

/* --------------------------------------------------------------------------
   Rule helpers
   -------------------------------------------------------------------------- */

/** Which weapon rules apply right now (a transformed Dagger uses the copied ones). */
function abilityOf(b) {
    return b.transformTimer > 0 ? b.type : b.baseType;
}

/** Can this ball's weapon currently clash / deal damage? */
function hasUsableWeapon(b) {
    if (b.weaponDisabledTimer > 0) return false;
    if (b.weaponLockTimer > 0) return false;
    if (b.baseType === 'Dagger' && !b.hasWeapon) return false; // blade was thrown
    return true;
}

/* --------------------------------------------------------------------------
   Main collision pass (called once per tick)
   -------------------------------------------------------------------------- */
function checkCollisions() {
    // --- 1. Ball vs ball physical collisions ---
    for (let i = 0; i < balls.length; i++) {
        for (let j = i + 1; j < balls.length; j++) {
            const dx = balls[i].x - balls[j].x;
            const dy = balls[i].y - balls[j].y;
            const distance = Math.hypot(dx, dy);
            if (distance < balls[i].radius + balls[j].radius) {
                resolveCollision(balls[i], balls[j]);
            }
        }
    }

    // --- 2. Weapon vs weapon clashes ---
    for (let i = 0; i < balls.length; i++) {
        for (let j = i + 1; j < balls.length; j++) {
            const a = balls[i];
            const b = balls[j];
            if (!hasUsableWeapon(a) || !hasUsableWeapon(b)) continue;
            if (!checkWeaponVsWeapon(a, b)) continue;

            // Both weapons bounce back (reverse rotation) with a short cooldown
            a.spinSpeed *= -1;
            b.spinSpeed *= -1;
            a.weaponCooldown = 15;
            b.weaponCooldown = 15;

            playClashSound();
            triggerShake();

            // White sparks between the two blades
            const wA = getWeaponCenter(a);
            const wB = getWeaponCenter(b);
            spawnParticles((wA.x + wB.x) / 2, (wA.y + wB.y) / 2, '#ffffff');

            // Hammer fast-spin clash disables the opponent's weapon for 3s
            // (no Hammer_Hit sound: that's reserved for direct ball impacts)
            if (abilityOf(a) === 'Hammer' && a.hammerPhase === 'spinning') {
                b.weaponDisabledTimer = 180;
            }
            if (abilityOf(b) === 'Hammer' && b.hammerPhase === 'spinning') {
                a.weaponDisabledTimer = 180;
            }
        }
    }

    // --- 3. Weapon vs ball hits ---
    for (let i = 0; i < balls.length; i++) {
        for (let j = 0; j < balls.length; j++) {
            if (i === j) continue;
            const attacker = balls[i];
            const defender = balls[j];

            if (!hasUsableWeapon(attacker)) continue;
            const attAb = abilityOf(attacker);
            // Hammer only deals damage during its fast-spin phase
            if (attAb === 'Hammer' && attacker.hammerPhase !== 'spinning') continue;

            if (!checkWeaponHit(attacker, defender)) continue;

            let damageDealt = attacker.damage;
            let critFlag = false;

            // Axe: base damage is always 1, with a hidden crit that grows every hit
            if (attAb === 'Axe') {
                damageDealt = 1;
                if (Math.random() < attacker.critChance) {
                    damageDealt = attacker.critMult;
                    critFlag = true;
                }
                attacker.critChance += 0.01;
                attacker.critMult += 2;
                // Transformed dagger doubles the copied ability's damage (and crit)
                if (attacker.baseType === 'Dagger' && attacker.transformTimer > 0) {
                    damageDealt *= 2;
                }
                if (critFlag) {
                    spawnParticles(defender.x, defender.y, '#ff2020');
                    spawnParticles(defender.x, defender.y, '#ffd700');
                }
            }

            // 2x Damage orb buff doubles outgoing hit damage
            if (attacker.dmgBuffTimer > 0) {
                damageDealt *= 2;
            }

            defender.health -= damageDealt;
            defender.iframes = 30; // 0.5s invulnerability

            // Each weapon plays its own hit sound (Hammer's spin hit plays below once per spin)
            const isHammerSpinHit = attAb === 'Hammer' && attacker.hammerPhase === 'spinning';
            if (!isHammerSpinHit) playWeaponHitSound(attAb, critFlag);
            triggerShake();
            spawnParticles(defender.x, defender.y, defender.color);
            spawnFloatingText(defender.x, defender.y - defender.radius, damageDealt, critFlag);

            // ---- Weapon-specific on-hit effects ----

            // Sword: damage +1 per hit (stacks)
            if (attAb === 'Sword') {
                attacker.damage += 1;
            }

            // Spear: reach +5, damage +0.5
            if (attAb === 'Spear') {
                attacker.wLength += 5;
                attacker.damage += 0.5;
            }

            // Hammer (spinning direct hit): damage +2, opponent stunned & weapon locked 3s
            if (isHammerSpinHit) {
                attacker.damage += 2;
                defender.stunTimer = 180;
                defender.weaponLockTimer = 180;
                if (!attacker.hammerHitPlayed) {
                    playHammerSound('hit');
                    attacker.hammerHitPlayed = true; // only once per spin
                }
            }

            // Scythe: bleed (damage over 5s) + 1s slow, bleed DPS +0.1 per scythe hit
            if (attAb === 'Scythe') {
                defender.bleedTimer = 300;
                defender.bleedDmgPerFrame = attacker.bleedDPS / TICKS_PER_SECOND;
                defender.slowTimer = 60;
                defender.slowFactor = 0.5;
                attacker.bleedDPS += 0.1; // bleed ticks themselves do NOT stack this
            }
        }
    }
}

/* --------------------------------------------------------------------------
   4. Thrown dagger projectiles
   -------------------------------------------------------------------------- */
function updateDaggerProjectiles() {
    for (let i = daggerProjectiles.length - 1; i >= 0; i--) {
        const proj = daggerProjectiles[i];

        // Remove projectiles whose owner died
        if (!proj.owner || proj.owner.health <= 0) {
            daggerProjectiles.splice(i, 1);
            continue;
        }

        if (proj.stuck) {
            // Owner picks the blade back up by touching it
            const dist = Math.hypot(proj.x - proj.owner.x, proj.y - proj.owner.y);
            if (dist < proj.owner.radius + 15) {
                proj.owner.retrieveWeapon();
                daggerProjectiles.splice(i, 1);
                continue;
            }

            // If not picked up within 7s (420 ticks), launch straight toward the Dagger's
            // current position (not homing, so it can miss or hit the opponent on the way!)
            if (proj.stuckTimer > 0) {
                proj.stuckTimer--;
                if (proj.stuckTimer === 0) {
                    const recallAngle = Math.atan2(proj.owner.y - proj.y, proj.owner.x - proj.x);
                    const speed = 10;
                    proj.dx = Math.cos(recallAngle) * speed;
                    proj.dy = Math.sin(recallAngle) * speed;
                    proj.angle = recallAngle;
                    proj.stuck = false;
                    proj.recalling = true;
                }
            }
            continue;
        }

        // Flying (either initial throw or recall flight)
        proj.x += proj.dx;
        proj.y += proj.dy;

        // While recalling, the Dagger owner can catch the returning blade in mid-air
        if (proj.recalling) {
            const ownerDist = Math.hypot(proj.x - proj.owner.x, proj.y - proj.owner.y);
            if (ownerDist < proj.owner.radius + 15) {
                proj.owner.retrieveWeapon();
                daggerProjectiles.splice(i, 1);
                continue;
            }
        }

        // Did it hit any ball other than its owner? (Works both on throw and on recall!)
        let hit = null;
        for (const b of balls) {
            if (b === proj.owner) continue;
            if (b.iframes > 0) continue;
            if (Math.hypot(proj.x - b.x, proj.y - b.y) < b.radius) {
                hit = b;
                break;
            }
        }

        if (hit) {
            // Throw damage equals the opponent's own current damage (doubled if 2x DMG buff active)
            const throwDmg = hit.damage * (proj.owner.dmgBuffTimer > 0 ? 2 : 1);
            hit.health -= throwDmg;
            hit.iframes = 30;
            playDaggerTransformSound();
            triggerShake();
            spawnParticles(hit.x, hit.y, hit.color);
            spawnFloatingText(hit.x, hit.y - hit.radius, throwDmg, false);

            transformDagger(proj.owner, hit);

            daggerProjectiles.splice(i, 1);
            continue;
        }

        // Stick to the wall when moving into a boundary. Half the blade length is used
        // as margin so the whole blade stays visible inside the arena.
        const margin = proj.wLength / 2;
        const hitLeft   = proj.x <= margin && proj.dx < 0;
        const hitRight  = proj.x >= ARENA_WIDTH - margin && proj.dx > 0;
        const hitTop    = proj.y <= margin && proj.dy < 0;
        const hitBottom = proj.y >= ARENA_HEIGHT - margin && proj.dy > 0;
        if (hitLeft || hitRight || hitTop || hitBottom) {
            proj.x = Math.max(margin, Math.min(ARENA_WIDTH - margin, proj.x));
            proj.y = Math.max(margin, Math.min(ARENA_HEIGHT - margin, proj.y));
            proj.dx = 0;
            proj.dy = 0;
            proj.stuck = true;
            proj.recalling = false;
            proj.stuckTimer = 7 * TICKS_PER_SECOND; // 7s before auto-recall launch
        }
    }
}

/**
 * Dagger hit effect: for 8 seconds the Dagger becomes a black copy of the
 * opponent's weapon with double damage and double spin speed.
 */
function transformDagger(owner, target) {
    owner.type = target.type;
    owner.color = '#000000';
    owner.radius = target.radius;
    owner.mass = target.radius;
    owner.img = target.img;
    owner.wLength = target.wLength;
    owner.wWidth = target.wWidth;
    owner.damage = target.damage * 2;
    owner.spinSpeed = target.spinSpeed * 2;
    owner.transformTimer = 480; // 8s
    owner.hasWeapon = true;

    // Copy weapon-specific state so the copied ability fully works
    if (target.baseType === 'Axe') {
        owner.critChance = target.critChance;
        owner.critMult = target.critMult;
    } else if (target.baseType === 'Hammer') {
        owner.hammerPhase = 'moving';
        owner.hammerTimer = 195;
        owner.savedSpinSpeed = owner.spinSpeed;
        owner.savedDx = owner.dx;
        owner.savedDy = owner.dy;
    } else if (target.baseType === 'Scythe') {
        owner.bleedDPS = target.bleedDPS;
    }
}

function drawDaggerProjectiles() {
    daggerProjectiles.forEach(proj => {
        // Recall aim line: show during the last ~0.5s before the stuck blade launches
        // back toward the Dagger (mirrors the pre-throw aim line on Ball.draw)
        if (proj.stuck && proj.stuckTimer > 0 && proj.stuckTimer <= 30 && proj.owner) {
            ctx.save();
            ctx.strokeStyle = proj.color || '#10b981';
            ctx.globalAlpha = 0.55;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 6]);
            ctx.beginPath();
            ctx.moveTo(proj.x, proj.y);
            ctx.lineTo(proj.owner.x, proj.owner.y);
            ctx.stroke();
            ctx.restore();
        }

        ctx.save();
        ctx.translate(proj.x, proj.y);
        ctx.rotate(proj.angle);
        if (isImageReady(proj.img)) {
            drawWeaponSprite(proj.img, proj.wLength);
        } else {
            ctx.fillStyle = proj.color || '#888';
            ctx.fillRect(-proj.wLength / 2, -proj.wWidth / 2, proj.wLength, proj.wWidth);
        }
        ctx.restore();
    });
}

/* --------------------------------------------------------------------------
   5. Arena power-up orbs (2x Damage / 2x Speed)
   -------------------------------------------------------------------------- */

/** Spawn a random power-up orb away from the arena edges and active fighters. */
function spawnPowerUpOrb() {
    if (powerUps.length >= MAX_ACTIVE_POWERUPS) return;

    const kind = Math.random() < 0.5 ? 'damage' : 'speed';
    const margin = 65;
    let x = margin + Math.random() * (ARENA_WIDTH - margin * 2);
    let y = margin + Math.random() * (ARENA_HEIGHT - margin * 2);

    // Re-roll up to 15 times so the orb doesn't spawn directly on top of a fighter
    for (let attempt = 0; attempt < 15; attempt++) {
        const cx = margin + Math.random() * (ARENA_WIDTH - margin * 2);
        const cy = margin + Math.random() * (ARENA_HEIGHT - margin * 2);
        const farEnough = balls.every(b => Math.hypot(cx - b.x, cy - b.y) > b.radius + 65);
        if (farEnough) {
            x = cx;
            y = cy;
            break;
        }
    }

    const orb = new PowerUpOrb(x, y, kind);
    powerUps.push(orb);
    spawnParticles(x, y, orb.meta.color);
}

/** Check if any fighter touches a power-up orb and grant its buff. */
function updatePowerUps() {
    for (let i = powerUps.length - 1; i >= 0; i--) {
        const orb = powerUps[i];
        orb.update();

        for (const b of balls) {
            if (b.health <= 0) continue;
            if (Math.hypot(b.x - orb.x, b.y - orb.y) < b.radius + orb.radius) {
                if (orb.kind === 'damage') {
                    b.dmgBuffTimer = POWERUP_DURATION;
                } else {
                    b.speedBuffTimer = POWERUP_DURATION;
                }
                spawnParticles(orb.x, orb.y, orb.meta.color);
                spawnBannerText(b.x, b.y - b.radius - 10, orb.meta.label + '!', orb.meta.color);
                powerUps.splice(i, 1);
                break;
            }
        }
    }
}

function drawPowerUps() {
    powerUps.forEach(orb => orb.draw());
}

