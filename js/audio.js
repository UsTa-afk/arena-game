/* ==========================================================================
   audio.js
   Small sound manager.

   Why not just `new Audio().play()`?
   - Mobile browsers (especially iOS Safari / Android WebView) block sound
     until the user touches the screen, and cloning <audio> elements on
     every hit caused delays, stutter and silent sounds on phones.
   - The Web Audio API decodes each file once and can play it many times
     at the same moment with almost no latency.

   Fallback: when Web Audio is not available, or the files cannot be fetched
   (e.g. index.html opened directly from disk via file://), we fall back to
   cloning <audio> elements like the original version did.
   ========================================================================== */

const SOUND_FILES = {
    clash:           'assets/sounds/clash.mp3',                 // weapon-vs-weapon clash ONLY
    swordHit:        'assets/sounds/Sword_Hit.mp3',             // Sword direct hit on ball
    spearHit:        'assets/sounds/Spear_Hit.mp3',             // Spear (and melee Dagger) hit on ball
    axeHit:          'assets/sounds/Axe_Hit.mp3',               // Axe normal hit on ball
    axeCritHit:      'assets/sounds/Axe_Crit_Hit.mp3',          // Axe critical hit on ball
    hammerCharge:    'assets/sounds/Hammer_Charge.mp3',         // ~2.5s, Hammer charging (pausing phase)
    hammerHit:       'assets/sounds/Hammer_Hit.mp3',            // ~1.33s, Hammer spin landing a hit
    scytheHit:       'assets/sounds/Scythe_Hit.mp3',            // Scythe direct hit on ball
    daggerTransform: 'assets/sounds/Dagger_Transformation.mp3'  // Dagger thrown/recall blade hit & copy
};

const AudioManager = {
    context: null,   // Web Audio context (null if unsupported)
    buffers: {},     // decoded AudioBuffers by sound name
    fallback: {},    // <audio> elements used when Web Audio cannot be used

    /** Create the audio context and start loading every sound file. */
    init() {
        // HTML <audio> fallback is always prepared, it costs almost nothing
        for (const name in SOUND_FILES) {
            const el = new Audio(SOUND_FILES[name]);
            el.preload = 'auto';
            this.fallback[name] = el;
        }

        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        this.context = new AudioCtx();

        for (const name in SOUND_FILES) {
            this.loadBuffer(name, SOUND_FILES[name]);
        }
    },

    /** Fetch + decode one file. Failure is silent: play() will use the fallback. */
    loadBuffer(name, url) {
        fetch(url)
            .then(res => {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.arrayBuffer();
            })
            // Callback form of decodeAudioData for older Safari versions
            .then(data => new Promise((resolve, reject) =>
                this.context.decodeAudioData(data, resolve, reject)))
            .then(buffer => { this.buffers[name] = buffer; })
            .catch(() => { /* keep using the <audio> fallback for this sound */ });
    },

    /**
     * Must be called from inside a user gesture (tap / click / key press).
     * Mobile browsers start the audio context "suspended" until then.
     */
    unlock() {
        if (this.context && this.context.state === 'suspended') {
            this.context.resume().catch(() => {});
        }
    },

    /**
     * Play a sound by name. Several copies can overlap.
     * @param {string} name   key of SOUND_FILES
     * @param {number} volume 0..1
     */
    play(name, volume = 1) {
        const buffer = this.buffers[name];

        // Preferred path: Web Audio
        if (this.context && buffer && this.context.state === 'running') {
            const source = this.context.createBufferSource();
            const gain = this.context.createGain();
            source.buffer = buffer;
            gain.gain.value = volume;
            source.connect(gain);
            gain.connect(this.context.destination);
            source.start(0);
            return;
        }

        // Fallback path: clone the <audio> element so sounds can overlap
        const base = this.fallback[name];
        if (!base) return;
        const clone = base.cloneNode();
        clone.volume = volume;
        clone.play().catch(() => { /* blocked by autoplay policy, ignore */ });
    }
};

// Convenience wrappers used by the game code

/** Plays clash.mp3 — used strictly when two weapons collide with each other. */
function playClashSound() {
    AudioManager.play('clash', 0.65);
}

/**
 * Plays the weapon-specific impact sound when a weapon hits a ball.
 * @param {string}  weaponType  Active weapon ability type ('Sword', 'Spear', 'Axe', 'Hammer', 'Scythe', 'Dagger')
 * @param {boolean} isCrit      True when an Axe hit rolls a critical strike
 */
function playWeaponHitSound(weaponType, isCrit = false) {
    switch (weaponType) {
        case 'Sword':
            AudioManager.play('swordHit', 0.7);
            break;
        case 'Spear':
            AudioManager.play('spearHit', 0.7);
            break;
        case 'Axe':
            AudioManager.play(isCrit ? 'axeCritHit' : 'axeHit', isCrit ? 0.85 : 0.7);
            break;
        case 'Hammer':
            AudioManager.play('hammerHit', 0.75);
            break;
        case 'Scythe':
            AudioManager.play('scytheHit', 0.7);
            break;
        case 'Dagger':
        default:
            AudioManager.play('spearHit', 0.65);
            break;
    }
}

/** Plays Dagger_Transformation.mp3 when a thrown/recalling dagger hits the opponent and copies them. */
function playDaggerTransformSound() {
    AudioManager.play('daggerTransform', 0.8);
}

function playHammerSound(which) {
    AudioManager.play(which === 'charge' ? 'hammerCharge' : 'hammerHit', 0.7);
}

AudioManager.init();
