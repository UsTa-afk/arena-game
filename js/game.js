/* ==========================================================================
   game.js
   Game state, the main animation loop, rendering and the HUD.
   ========================================================================== */

/* --------------------------------------------------------------------------
   Canvas & state
   -------------------------------------------------------------------------- */
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let balls = [];              // fighters still alive
let particles = [];          // hit sparks
let daggerProjectiles = [];  // thrown dagger blades
let floatingTexts = [];      // damage numbers
let powerUps = [];           // active arena buff orbs (2x DMG / 2x SPD)
let p1Ball = null;           // references kept even after a ball dies (for the HUD)
let p2Ball = null;

let matchTicks = 0;          // elapsed frames since the fight started
let arenaSpeedMult = 1;      // global speed multiplier (ramps up every 10s up to MAX_SPEED_RAMP)

let isPaused = false;        // toggled with Ctrl + Shift (debug)
let gameStarted = false;     // guards against starting the fight twice

/* --------------------------------------------------------------------------
   Responsive canvas
   -------------------------------------------------------------------------- */

/**
 * Scale the canvas on screen (via CSS width/height) to the biggest square
 * that fits in #arenaWrapper, while keeping the internal drawing buffer at
 * 600x600 so shadowBlur and 2D rendering stay fast on every device.
 */
function fitCanvas() {
    const wrapper = document.getElementById('arenaWrapper');
    if (!wrapper || wrapper.clientWidth === 0) return; // game screen not visible yet

    const border = 4;  // 2px neon border on each side
    const margin = 12; // breathing room for the glow
    const size = Math.max(100, Math.floor(
        Math.min(wrapper.clientWidth, wrapper.clientHeight, ARENA_WIDTH) - margin - border
    ));

    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
}

/* --------------------------------------------------------------------------
   Setup
   -------------------------------------------------------------------------- */

/** Spawn a fighter on its side of the arena, moving towards the center. */
function createBall(type, playerNum) {
    const stats = WEAPON_STATS[type];
    const x = (playerNum === 1) ? ARENA_WIDTH * 0.25 : ARENA_WIDTH * 0.75;
    const y = ARENA_HEIGHT / 2;
    const dx = (playerNum === 1) ? stats.speed : -stats.speed;
    const dy = (Math.random() * 4) - 2; // small random vertical angle

    const newBall = new Ball(x, y, stats.radius, dx, dy, stats.color, stats.hp, type, WEAPON_IMAGES[type]);
    balls.push(newBall);

    if (playerNum === 1) p1Ball = newBall;
    if (playerNum === 2) p2Ball = newBall;
}

/** Switch from the menu to the arena and start the loop. */
function startGame() {
    if (gameStarted) return; // e.g. pressing Enter again mid-fight
    if (!player1Choice || !player2Choice) return;
    gameStarted = true;

    document.getElementById('menu').style.display = 'none';
    document.getElementById('gameUI').style.display = 'flex';

    document.getElementById('p1Label').textContent = 'P1 - ' + player1Choice.toUpperCase();
    document.getElementById('p2Label').textContent = 'P2 - ' + player2Choice.toUpperCase();

    // Called from the START tap / Enter key, so audio is allowed from here on
    AudioManager.unlock();

    createBall(player1Choice, 1);
    createBall(player2Choice, 2);

    fitCanvas();
    animate();
}

/** Restart by reloading the page (simplest way to reset every piece of state). */
function restartGame() {
    location.reload();
}

/* --------------------------------------------------------------------------
   Effects
   -------------------------------------------------------------------------- */

/** Short CSS shake on the canvas element. */
function triggerShake() {
    canvas.classList.remove('shake');
    void canvas.offsetWidth; // force reflow so the animation can restart
    canvas.classList.add('shake');
}

/* --------------------------------------------------------------------------
   Main animation loop
   -------------------------------------------------------------------------- */
function animate() {
    requestAnimationFrame(animate);

    if (isPaused) return;

    updateHud();
    ctx.clearRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

    // Update & draw hit particles
    particles.forEach(particle => {
        particle.draw();
        particle.update();
    });
    particles = particles.filter(particle => particle.alpha > 0);

    // Update & draw floating damage numbers
    floatingTexts.forEach(ft => {
        ft.draw();
        ft.update();
    });
    floatingTexts = floatingTexts.filter(ft => ft.life > 0);

    // Check if the match has ended (1 or 0 balls left)
    if (balls.length <= 1) {
        balls.forEach(ball => {
            ball.dx = 0;
            ball.dy = 0;
            ball.trail = []; // clear motion trail once the fight is over
            ball.draw();
        });
        drawGameOver();
        return;
    }

    // --- Match pacing: speed ramp every 10s + power-up orb every 8s ---
    matchTicks++;
    if (matchTicks % SPEED_RAMP_INTERVAL === 0 && arenaSpeedMult < MAX_SPEED_RAMP) {
        arenaSpeedMult = Math.min(MAX_SPEED_RAMP, +(arenaSpeedMult + SPEED_RAMP_STEP).toFixed(2));
        spawnBannerText(ARENA_WIDTH / 2, 55, `SPEED UP! ×${arenaSpeedMult}`, '#facc15');
    }
    if (matchTicks % POWERUP_SPAWN_INTERVAL === 0) {
        spawnPowerUpOrb();
    }

    // Draw & update arena power-up orbs
    drawPowerUps();
    updatePowerUps();

    // Update & draw active fighters
    balls.forEach(ball => {
        ball.draw();
        ball.update();
    });

    // Update & draw thrown dagger projectiles
    drawDaggerProjectiles();
    updateDaggerProjectiles();

    // Handle collisions and remove defeated fighters
    checkCollisions();
    balls = balls.filter(ball => ball.health > 0);
}

function drawGameOver() {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 50px Orbitron';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (balls.length === 1) {
        const winner = balls[0];
        ctx.fillText(winner.baseType.toUpperCase() + ' WINS!', ARENA_WIDTH / 2, ARENA_HEIGHT / 2 - 40);
        ctx.fillStyle = winner.color;
        ctx.font = 'bold 30px Orbitron';
        ctx.fillText(Math.floor(winner.health) + ' HP LEFT', ARENA_WIDTH / 2, ARENA_HEIGHT / 2 + 30);
    } else {
        ctx.fillText('DOUBLE KO!', ARENA_WIDTH / 2, ARENA_HEIGHT / 2);
    }
}

/* --------------------------------------------------------------------------
   HUD (health bars, status icons, live stats)
   -------------------------------------------------------------------------- */

// Look up HUD elements once instead of every frame
const hud = {
    p1: {
        health:  document.getElementById('p1HealthBar'),
        delayed: document.getElementById('p1DelayedBar'),
        info:    document.getElementById('p1Info'),
        status:  document.getElementById('p1Status')
    },
    p2: {
        health:  document.getElementById('p2HealthBar'),
        delayed: document.getElementById('p2DelayedBar'),
        info:    document.getElementById('p2Info'),
        status:  document.getElementById('p2Status')
    }
};

/** Only touch the DOM when the text actually changed (cheaper on phones). */
function setText(el, value) {
    if (el.textContent !== value) el.textContent = value;
}

function updatePlayerHud(ball, els) {
    if (!ball) return;
    if (ball.health <= 0) ball.delayedHealth = 0;
    const pct = Math.max(0, (ball.health / ball.maxHealth) * 100);
    const delayedPct = Math.max(0, (ball.delayedHealth / ball.maxHealth) * 100);
    els.health.style.width = pct + '%';
    els.delayed.style.width = delayedPct + '%';
    setText(els.info, formatInfo(ball));
    setText(els.status, getStatusIcons(ball));
}

function updateHud() {
    updatePlayerHud(p1Ball, hud.p1);
    updatePlayerHud(p2Ball, hud.p2);
}

/** Emoji icons for active status effects and power-up buffs. */
function getStatusIcons(b) {
    if (!b) return '';
    let s = '';
    if (b.dmgBuffTimer > 0) s += '🔥';
    if (b.speedBuffTimer > 0) s += '💨';
    if (b.stunTimer > 0) s += '⚡';
    if (b.bleedTimer > 0) s += '🩸';
    if (b.weaponDisabledTimer > 0) s += '⊘';
    if (b.slowTimer > 0 && b.stunTimer <= 0) s += '🐌';
    return s;
}

/** Show integers without decimals, everything else with one decimal. */
function fmtNum(n) {
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** One-line live stat summary under each health bar (depends on weapon). */
function formatInfo(b) {
    if (!b) return '';
    const dmg = fmtNum(b.damage);
    if (b.baseType === 'Axe' && b.type === 'Axe') {
        const ch = (b.critChance * 100).toFixed(1);
        return `DMG 1 • CRIT ${ch}% ×${b.critMult}`;
    }
    if (b.baseType === 'Spear' && b.type === 'Spear') {
        return `DMG ${dmg} • REACH ${Math.round(b.wLength)}`;
    }
    if (b.baseType === 'Scythe' && b.type === 'Scythe') {
        return `DMG ${dmg} • BLEED ${fmtNum(b.bleedDPS)}/s`;
    }
    if (b.baseType === 'Hammer' && b.type === 'Hammer') {
        const phaseShort = b.hammerPhase === 'spinning' ? 'SPIN'
                         : b.hammerPhase === 'pausing' ? 'CHARGE' : 'MOVE';
        return `DMG ${dmg} • ${phaseShort}`;
    }
    if (b.baseType === 'Dagger') {
        if (b.type !== 'Dagger') {
            return `${b.type.toUpperCase()} DMG ${dmg} (${(b.transformTimer / 60).toFixed(1)}s)`;
        }
        if (!b.hasWeapon) {
            const proj = daggerProjectiles.find(p => p.owner === b);
            if (proj && proj.stuck && proj.stuckTimer > 0) {
                return `DMG ${dmg} • RECALL ${(proj.stuckTimer / 60).toFixed(1)}s`;
            }
            return `DMG ${dmg} • WEAPON OUT`;
        }
        return `DMG ${dmg} • THROW ${(b.throwCooldown / 60).toFixed(1)}s`;
    }
    if (b.baseType === 'Sword' && b.type === 'Sword') {
        const rps = (Math.abs(b.spinSpeed) * 60 / (2 * Math.PI)).toFixed(1);
        return `DMG ${dmg} • SPIN ${rps}/s`;
    }
    return `DMG ${dmg}`;
}

