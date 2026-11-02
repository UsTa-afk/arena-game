/* ==========================================================================
   config.js
   Game-wide constants: arena size, timing and per-weapon base stats.
   Every other script reads from here, so balancing the game only needs
   changes in this file.
   ========================================================================== */

// Logical arena size in "game units". All physics uses these numbers.
// The canvas is scaled on screen (see fitCanvas in game.js), so the game
// behaves the same on a 4K monitor and on a small phone.
const ARENA_WIDTH = 600;
const ARENA_HEIGHT = 600;

// Reference tick rate used to convert per-second values (e.g. Scythe bleed DPS)
// into per-frame values.
const TICKS_PER_SECOND = 60;

// --- Match pacing: gradual speed ramp + arena power-up orbs ---
// Every 10 seconds, global movement speed increases by 15% up to 1.6x max,
// and an absolute speed ceiling prevents physics tunneling.
const SPEED_RAMP_INTERVAL = 10 * TICKS_PER_SECOND; // 10s
const SPEED_RAMP_STEP = 0.15;                      // +15% per step
const MAX_SPEED_RAMP = 1.6;                        // 1.6x cap
const MAX_SAFE_SPEED = 12.5;                       // hard cap in game units/frame

// Power-up orbs spawn inside the arena to break stalemates
const POWERUP_SPAWN_INTERVAL = 8 * TICKS_PER_SECOND; // every 8s
const POWERUP_DURATION = 5 * TICKS_PER_SECOND;       // buff lasts 5s
const MAX_ACTIVE_POWERUPS = 1;

const POWERUP_TYPES = {
    damage: { label: '2X DMG', icon: '🔥', color: '#ff3b5c' },
    speed:  { label: '2X SPD', icon: '⚡', color: '#38bdf8' }
};

// Base stats for each weapon. Keys must match "data-weapon" in index.html.
//   color  : ball color (also used for particles and trails)
//   hp     : starting health
//   radius : ball radius in game units
//   speed  : starting horizontal speed (game units per tick)
//   src    : weapon sprite drawn orbiting the ball
const WEAPON_STATS = {
    'Sword':  { color: '#fce883', hp: 100, radius: 35, speed: 4.0, src: 'assets/images/sword.png' },
    'Spear':  { color: '#5dd1b2', hp: 100, radius: 35, speed: 6.0, src: 'assets/images/spear.png' },
    'Axe':    { color: '#e67e22', hp: 100, radius: 35, speed: 2.5, src: 'assets/images/axe.png' },
    'Hammer': { color: '#a855f7', hp: 100, radius: 35, speed: 2.0, src: 'assets/images/hammer.png' },
    'Dagger': { color: '#10b981', hp: 100, radius: 30, speed: 7.0, src: 'assets/images/dagger.png' },
    'Scythe': { color: '#e11d48', hp: 100, radius: 35, speed: 3.5, src: 'assets/images/scythe.png' }
};

// Preload the mystery power-up chest sprite
const CHEST_IMAGE = new Image();
CHEST_IMAGE.src = 'assets/images/chest.png';

// Preload every weapon sprite once at startup and share the Image objects.
// Previously each ball created its own Image when the fight started, so on
// slow mobile connections the first frames showed grey placeholder boxes.
const WEAPON_IMAGES = {};
for (const type in WEAPON_STATS) {
    const img = new Image();
    img.src = WEAPON_STATS[type].src;
    WEAPON_IMAGES[type] = img;
}

