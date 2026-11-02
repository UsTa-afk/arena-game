/* ==========================================================================
   entities.js
   Everything that lives inside the arena:
     - Particle      : spark that flies out on hits
     - FloatingText  : "-5" damage numbers
     - Ball          : a fighter (ball + orbiting weapon + status effects)
   Draw methods render to the shared `ctx` (created in game.js).
   ========================================================================== */

/* --------------------------------------------------------------------------
   Shared drawing helper
   -------------------------------------------------------------------------- */

/**
 * Draw a weapon sprite centered on the current canvas origin, pointing
 * along the +X axis, scaled so that its long side equals `length`.
 * Works for both horizontal and vertical source images.
 */
function drawWeaponSprite(img, length) {
    const isVertical = img.naturalHeight > img.naturalWidth;
    let drawW, drawH;
    if (isVertical) {
        // Vertical artwork: rotate 90° so the blade points outwards
        ctx.rotate(Math.PI / 2);
        drawH = length;
        drawW = length * (img.naturalWidth / img.naturalHeight);
    } else {
        drawW = length;
        drawH = length * (img.naturalHeight / img.naturalWidth);
    }
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
}

/** True once an image is fully loaded and safe to draw. */
function isImageReady(img) {
    return img && img.complete && img.naturalWidth !== 0;
}

/* --------------------------------------------------------------------------
   Particle: small fading circle used for hit sparks
   -------------------------------------------------------------------------- */
class Particle {
    constructor(x, y, dx, dy, color) {
        this.x = x;
        this.y = y;
        this.radius = Math.random() * 4 + 1;
        this.dx = dx;
        this.dy = dy;
        this.color = color;
        this.alpha = 1; // fades to 0, then the particle is removed
    }

    draw() {
        ctx.save();
        ctx.globalAlpha = this.alpha;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.restore();
    }

    update() {
        this.x += this.dx;
        this.y += this.dy;
        this.alpha -= 0.04;
    }
}

/** Burst of 15 particles in random directions. */
function spawnParticles(x, y, color) {
    for (let k = 0; k < 15; k++) {
        const pDx = (Math.random() - 0.5) * 10;
        const pDy = (Math.random() - 0.5) * 10;
        particles.push(new Particle(x, y, pDx, pDy, color));
    }
}

/* --------------------------------------------------------------------------
   FloatingText: damage number that rises and fades out
   -------------------------------------------------------------------------- */
class FloatingText {
    constructor(x, y, text, color, big) {
        this.x = x + (Math.random() - 0.5) * 18; // small jitter so stacked hits don't overlap
        this.y = y;
        this.text = text;
        this.color = color;
        this.alpha = 1;
        this.dy = -2.2;
        this.life = 55;     // ticks remaining
        this.maxLife = 55;
        this.big = !!big;   // crits are drawn larger
    }

    update() {
        this.y += this.dy;
        this.dy *= 0.94; // ease out: rises fast, then slows down
        this.life--;
        this.alpha = Math.max(0, this.life / this.maxLife);
    }

    draw() {
        ctx.save();
        ctx.globalAlpha = this.alpha;
        const size = this.big ? 30 : 20;
        ctx.font = 'bold ' + size + 'px Orbitron, Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Black outline first so the number is readable on any background
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#000';
        ctx.strokeText(this.text, this.x, this.y);
        ctx.fillStyle = this.color;
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 12;
        ctx.fillText(this.text, this.x, this.y);
        ctx.restore();
    }
}

/** Show a damage number above a ball. Crits are gold and bigger. */
function spawnFloatingText(x, y, dmg, isCrit) {
    const text = '-' + Math.max(1, Math.round(dmg));
    const color = isCrit ? '#ffd700' : '#ff5555';
    floatingTexts.push(new FloatingText(x, y, text, color, isCrit));
}

/** Show a custom status/power-up text banner inside the arena. */
function spawnBannerText(x, y, text, color) {
    floatingTexts.push(new FloatingText(x, y, text, color, false));
}

/* --------------------------------------------------------------------------
   PowerUpOrb: mystery chest drop (grants 2x Damage or 2x Speed on pickup)
   -------------------------------------------------------------------------- */
class PowerUpOrb {
    constructor(x, y, kind) {
        this.x = x;
        this.y = y;
        this.kind = kind; // 'damage' or 'speed' (revealed when picked up)
        this.meta = POWERUP_TYPES[kind];
        this.radius = 24;
        this.pulse = Math.random() * Math.PI * 2;
    }

    update() {
        this.pulse += 0.08;
    }

    draw() {
        const scale = 1 + Math.sin(this.pulse) * 0.06;
        const size = this.radius * 2 * scale;

        ctx.save();
        ctx.translate(this.x, this.y);

        if (isImageReady(CHEST_IMAGE)) {
            // Subtle golden-green glow behind the mystery chest
            ctx.shadowColor = '#4ade80';
            ctx.shadowBlur = 14 + Math.sin(this.pulse) * 4;
            ctx.drawImage(CHEST_IMAGE, -size / 2, -size / 2, size, size);
        } else {
            // Fallback circle if chest.png is still loading
            ctx.fillStyle = '#15803d';
            ctx.beginPath();
            ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#4ade80';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        ctx.restore();
    }
}

/* --------------------------------------------------------------------------
   Ball: one fighter
   --------------------------------------------------------------------------
   Every Ball keeps two identities:
     baseType : the weapon the player picked (never changes)
     type     : the weapon it currently uses (a Dagger can temporarily
                copy the opponent's weapon, see combat.js)
   All timers are counted in ticks (60 ticks = 1 second).
   -------------------------------------------------------------------------- */
class Ball {
    constructor(x, y, radius, dx, dy, color, health, type, img) {
        // Movement / physics
        this.x = x;
        this.y = y;
        this.radius = radius;
        this.baseRadius = radius;
        this.dx = dx;
        this.dy = dy;
        this.mass = radius; // bigger ball = heavier in collisions

        // Identity
        this.color = color;
        this.baseColor = color;
        this.health = health;
        this.maxHealth = health;
        this.type = type;
        this.baseType = type;
        this.img = img;
        this.baseImg = img;

        // Orbiting weapon (a rectangle hitbox that rotates around the ball)
        this.angle = 0;
        this.spinSpeed = (Math.random() * 0.05) + 0.05; // radians per tick
        this.baseSpinSpeed = this.spinSpeed;
        this.wLength = radius * 2.5;
        this.baseWLength = this.wLength;
        this.wWidth = radius * 0.6;
        this.baseWWidth = this.wWidth;

        // Combat
        this.iframes = 0;        // invulnerability ticks after being hit
        this.damage = 1;
        this.baseDamage = 1;
        this.weaponCooldown = 0; // prevents the same clash from triggering every tick

        // Visual feedback state
        this.trail = [];                // recent positions for the motion trail
        this.delayedHealth = health;    // "ghost" health bar that lags behind real health

        // Status effects (all in ticks)
        this.slowTimer = 0;
        this.slowFactor = 1;
        this.stunTimer = 0;            // cannot move
        this.weaponLockTimer = 0;      // weapon stops rotating and cannot hit
        this.weaponDisabledTimer = 0;  // weapon cannot hit
        this.bleedTimer = 0;
        this.bleedDmgPerFrame = 0;

        // Power-up buff timers (all in ticks)
        this.dmgBuffTimer = 0;         // 2x damage while > 0
        this.speedBuffTimer = 0;       // 2x movement & spin speed while > 0

        // Weapon-specific state
        if (type === 'Axe') {
            this.critChance = 0.075;
            this.critMult = 5;
        }
        if (type === 'Hammer') {
            // Cycles every 4s: moving 3.25s -> pausing 0.5s -> spinning 0.25s
            this.hammerPhase = 'moving';
            this.hammerTimer = 195;
            this.savedSpinSpeed = this.spinSpeed;
            this.savedDx = dx;
            this.savedDy = dy;
        }
        if (type === 'Dagger') {
            // Smaller, lighter ball with a shorter blade that can be thrown
            this.radius = 25;
            this.baseRadius = 25;
            this.mass = 25;
            this.wLength = this.radius * 2.2;
            this.baseWLength = this.wLength;
            this.wWidth = this.radius * 0.5;
            this.baseWWidth = this.wWidth;
            this.hasWeapon = true;
            this.throwCooldown = 120; // first throw after 2s
            this.transformTimer = 0;  // > 0 while copying another weapon
        }
        if (type === 'Scythe') {
            this.bleedDPS = 0.1;
        }
    }

    /* ---------------------------------------------------------------- draw */
    draw() {
        // Motion trail: older positions are smaller and more transparent
        for (let i = 0; i < this.trail.length; i++) {
            const t = this.trail[i];
            const k = (i + 1) / this.trail.length;
            ctx.save();
            ctx.globalAlpha = 0.35 * k;
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(t.x, t.y, this.radius * (0.35 + 0.6 * k), 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        // Ball body with neon glow. Flashes white while invulnerable.
        ctx.save();
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 22;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        const flash = this.iframes > 0 && Math.floor(Date.now() / 100) % 2 === 0;
        ctx.fillStyle = flash ? '#fff' : this.color;
        ctx.fill();
        ctx.restore();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#000';
        ctx.stroke();
        ctx.closePath();

        // Status rings: red = bleeding, yellow = stunned, dashed purple = disarmed
        if (this.bleedTimer > 0) {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius + 3, 0, Math.PI * 2);
            ctx.strokeStyle = '#b91c1c';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        if (this.stunTimer > 0) {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius + 6, 0, Math.PI * 2);
            ctx.strokeStyle = '#facc15';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        if (this.weaponDisabledTimer > 0) {
            ctx.save();
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius + 9, 0, Math.PI * 2);
            ctx.strokeStyle = '#a855f7';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
        }
        // Power-up buff rings: fiery crimson = 2x DMG, electric cyan = 2x SPD
        if (this.dmgBuffTimer > 0) {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius + 5, 0, Math.PI * 2);
            ctx.strokeStyle = '#ff3b5c';
            ctx.lineWidth = 2.5;
            ctx.stroke();
        }
        if (this.speedBuffTimer > 0) {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius + 8, 0, Math.PI * 2);
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 2.5;
            ctx.stroke();
        }

        // Health number in the middle (white on the black transformed dagger)
        ctx.fillStyle = (this.baseType === 'Dagger' && this.transformTimer > 0) ? '#fff' : '#000';
        const fontSize = Math.floor(this.radius * 0.7);
        ctx.font = 'bold ' + fontSize + 'px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(Math.max(0, Math.floor(this.health)), this.x, this.y);

        // Dagger aim line: telegraphs the throw during the last 0.5s
        if (this.baseType === 'Dagger' && this.type === 'Dagger'
            && this.hasWeapon && this.throwCooldown > 0 && this.throwCooldown <= 30) {
            const opp = this.getOpponent();
            if (opp) {
                ctx.save();
                ctx.strokeStyle = this.color;
                ctx.globalAlpha = 0.55;
                ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 6]);
                ctx.beginPath();
                ctx.moveTo(this.x, this.y);
                ctx.lineTo(opp.x, opp.y);
                ctx.stroke();
                ctx.restore();
            }
        }

        // Dagger has no weapon attached while it is thrown
        if (this.baseType === 'Dagger' && this.type === 'Dagger' && !this.hasWeapon) return;

        // Orbiting weapon
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);
        const drawOffset = this.radius + 5; // small gap between ball and weapon

        if (isImageReady(this.img)) {
            ctx.translate(drawOffset + this.wLength / 2, 0);
            drawWeaponSprite(this.img, this.wLength);
        } else {
            // Placeholder rectangle until the sprite finishes loading
            ctx.fillStyle = '#333';
            ctx.fillRect(drawOffset, -this.wWidth / 2, this.wLength, this.wWidth);
            ctx.strokeStyle = '#000';
            ctx.strokeRect(drawOffset, -this.wWidth / 2, this.wLength, this.wWidth);
        }
        ctx.restore();
    }

    /* -------------------------------------------------------------- update */
    /** Advance this ball by one simulation tick. */
    update() {
        // Store position for the motion trail (last 8 ticks)
        this.trail.push({ x: this.x, y: this.y });
        if (this.trail.length > 8) this.trail.shift();

        // Ghost health bar slowly catches up with the real health
        if (this.delayedHealth > this.health) {
            this.delayedHealth = Math.max(this.health, this.delayedHealth - 0.4);
        } else {
            this.delayedHealth = this.health;
        }

        this.updateHammerCycle();

        // Stun stops movement completely, slow reduces it.
        // Arena speed ramp (every 10s) and 2x Speed orb buff increase it,
        // clamped so a ball never exceeds MAX_SAFE_SPEED per frame.
        let moveMult = arenaSpeedMult * (this.speedBuffTimer > 0 ? 1.75 : 1);
        if (this.stunTimer > 0) moveMult = 0;
        else if (this.slowTimer > 0) moveMult *= this.slowFactor;

        // Bounce off the arena walls
        if (this.x + this.radius > ARENA_WIDTH) {
            this.x = ARENA_WIDTH - this.radius;
            this.dx = -this.dx;
        } else if (this.x - this.radius < 0) {
            this.x = this.radius;
            this.dx = -this.dx;
        }
        if (this.y + this.radius > ARENA_HEIGHT) {
            this.y = ARENA_HEIGHT - this.radius;
            this.dy = -this.dy;
        } else if (this.y - this.radius < 0) {
            this.y = this.radius;
            this.dy = -this.dy;
        }

        // Enforce upper speed cap so high multipliers never break wall/ball collision
        let stepX = this.dx * moveMult;
        let stepY = this.dy * moveMult;
        const stepSpeed = Math.hypot(stepX, stepY);
        if (stepSpeed > MAX_SAFE_SPEED) {
            const scale = MAX_SAFE_SPEED / stepSpeed;
            stepX *= scale;
            stepY *= scale;
        }
        this.x += stepX;
        this.y += stepY;

        // A locked weapon stops rotating; 2x Speed orb also spins the weapon faster
        if (this.weaponLockTimer <= 0) {
            const spinMult = this.speedBuffTimer > 0 ? 1.6 : 1;
            this.angle += this.spinSpeed * spinMult;
        }

        // Tick down all timers
        if (this.iframes > 0) this.iframes--;
        if (this.weaponCooldown > 0) this.weaponCooldown--;
        if (this.dmgBuffTimer > 0) this.dmgBuffTimer--;
        if (this.speedBuffTimer > 0) this.speedBuffTimer--;
        if (this.slowTimer > 0) {
            this.slowTimer--;
            if (this.slowTimer === 0) this.slowFactor = 1;
        }
        if (this.stunTimer > 0) this.stunTimer--;
        if (this.weaponLockTimer > 0) this.weaponLockTimer--;
        if (this.weaponDisabledTimer > 0) this.weaponDisabledTimer--;

        // Bleed: damage over time
        if (this.bleedTimer > 0) {
            this.health -= this.bleedDmgPerFrame;
            this.bleedTimer--;
        }

        this.updateDaggerTransform();

        // Dagger throw cycle (only while truly a dagger, not transformed)
        if (this.baseType === 'Dagger' && this.type === 'Dagger' && this.transformTimer === 0 && this.hasWeapon) {
            if (this.throwCooldown > 0) {
                this.throwCooldown--;
                if (this.throwCooldown === 0) {
                    this.throwWeapon();
                }
            }
        }
    }

    /**
     * Hammer state machine: moving -> pausing (charge) -> spinning -> moving ...
     * Also runs while a Dagger has transformed into a Hammer.
     */
    updateHammerCycle() {
        const abilityType = this.transformTimer > 0 ? this.type : this.baseType;
        if (abilityType !== 'Hammer') return;

        this.hammerTimer--;
        if (this.hammerTimer > 0) return;

        if (this.hammerPhase === 'moving') {
            // Stop and charge for 2.5s while Hammer_Charge.mp3 plays
            this.hammerPhase = 'pausing';
            this.hammerTimer = 150;
            this.savedDx = this.dx;
            this.savedDy = this.dy;
            this.dx = 0;
            this.dy = 0;
            this.savedSpinSpeed = this.spinSpeed;
            this.spinSpeed = 0;
            playHammerSound('charge');
        } else if (this.hammerPhase === 'pausing') {
            // Fast spin: exactly one full rotation in 1.33s (80 ticks)
            this.hammerPhase = 'spinning';
            this.hammerTimer = 80;
            const sign = this.savedSpinSpeed >= 0 ? 1 : -1;
            this.spinSpeed = sign * (2 * Math.PI) / 80;
            this.hammerHitPlayed = false; // Hammer_Hit.mp3 only plays on actual contact
            // Hammer reach buff: weapon is twice as long and wide while spinning
            this.preSpinWLength = this.wLength;
            this.preSpinWWidth = this.wWidth;
            this.wLength = this.preSpinWLength * 2;
            this.wWidth = this.preSpinWWidth * 2;
        } else if (this.hammerPhase === 'spinning') {
            // Back to normal movement for 3.25s (whole cycle = 4s)
            this.hammerPhase = 'moving';
            this.hammerTimer = 195;
            this.spinSpeed = this.savedSpinSpeed;
            // Remove the reach buff
            this.wLength = this.preSpinWLength;
            this.wWidth = this.preSpinWWidth;
            if (this.savedDx === 0 && this.savedDy === 0) {
                // Was standing still before the charge: pick a random direction
                this.dx = Math.random() > 0.5 ? 2 : -2;
                this.dy = Math.random() > 0.5 ? 2 : -2;
            } else {
                this.dx = this.savedDx;
                this.dy = this.savedDy;
            }
        }
    }

    /** When a Dagger's copy of another weapon expires, restore the original Dagger. */
    updateDaggerTransform() {
        if (this.baseType !== 'Dagger' || this.transformTimer <= 0) return;

        this.transformTimer--;
        if (this.transformTimer !== 0) return;

        this.type = 'Dagger';
        this.color = this.baseColor;
        this.radius = this.baseRadius;
        this.mass = this.baseRadius;
        this.img = this.baseImg;
        this.wLength = this.baseWLength;
        this.wWidth = this.baseWWidth;
        this.damage = this.baseDamage;
        this.spinSpeed = this.baseSpinSpeed;
        this.throwCooldown = 180;
        // Clear copied ability state so old fields don't linger
        this.hammerPhase = undefined;
        this.hammerTimer = undefined;
        this.critChance = undefined;
        this.critMult = undefined;
        this.bleedDPS = undefined;
        // Resume movement if the copied hammer cycle had frozen us
        if (this.dx === 0 && this.dy === 0) {
            this.dx = Math.random() > 0.5 ? 4 : -4;
            this.dy = (Math.random() * 4) - 2;
        }
    }

    /* ------------------------------------------------------------- helpers */
    /** The first other ball that is still alive (null if none). */
    getOpponent() {
        for (const b of balls) {
            if (b !== this && b.health > 0) return b;
        }
        return null;
    }

    /** Dagger only: throw the blade straight at the opponent. */
    throwWeapon() {
        const opp = this.getOpponent();
        const aimAngle = opp
            ? Math.atan2(opp.y - this.y, opp.x - this.x)
            : this.angle;
        // Start the projectile where the orbiting blade would be
        const orbitDist = this.radius + 5 + this.wLength / 2;
        const speed = 10;
        daggerProjectiles.push({
            x: this.x + Math.cos(aimAngle) * orbitDist,
            y: this.y + Math.sin(aimAngle) * orbitDist,
            dx: Math.cos(aimAngle) * speed,
            dy: Math.sin(aimAngle) * speed,
            angle: aimAngle,
            owner: this,
            wLength: this.wLength,
            wWidth: this.wWidth,
            stuck: false,     // becomes true when it hits a wall
            stuckTimer: 0,    // 7s countdown while stuck before recalling toward owner
            recalling: false, // true while flying back toward the Dagger
            img: this.img,
            color: this.color
        });
        this.hasWeapon = false;
    }

    /** Dagger only: blade picked back up from the wall. */
    retrieveWeapon() {
        this.hasWeapon = true;
        this.throwCooldown = 180; // next throw in 3s
    }
}

