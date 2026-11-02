/* ==========================================================================
   ui.js
   Menu logic (weapon selection) and all input handling:
   touch / mouse for buttons and cards, keyboard shortcuts on desktop.
   This file runs last and wires everything up.
   ========================================================================== */

let player1Choice = null;
let player2Choice = null;

// Touch devices have no Enter key, so the hint text is different there
const isTouchDevice = window.matchMedia('(hover: none), (pointer: coarse)').matches;

/* --------------------------------------------------------------------------
   Weapon selection
   -------------------------------------------------------------------------- */

/** First pick goes to Player 1, second (different) pick goes to Player 2. */
function selectWeapon(type) {
    const status = document.getElementById('statusText');

    if (!player1Choice) {
        player1Choice = type;
        highlightCard(type, 'p1-selected');
        status.textContent = 'Player 2: Choose your fighter';
        status.style.color = '#ff7b00';
    } else if (!player2Choice && player1Choice !== type) {
        player2Choice = type;
        highlightCard(type, 'p2-selected');
        status.textContent = isTouchDevice
            ? 'Ready! Tap START FIGHT'
            : 'Ready! Press ENTER to Fight (or ESC to Reset)';
        status.style.color = '#22c55e';
        // Enable the START button. This line was missing before, which is why
        // the game could only be started with the Enter key (impossible on mobile).
        document.getElementById('startBtn').classList.add('ready');
    }
}

/**
 * Highlight the card of the given weapon.
 * Uses the data-weapon attribute; the old version searched the card text for
 * "Sword" while the card says "SWORD", so the highlight never appeared.
 */
function highlightCard(type, cssClass) {
    const card = document.querySelector(`.weapon-card[data-weapon="${type}"]`);
    if (card) card.classList.add(cssClass);
}

function resetSelection() {
    if (gameStarted) return; // only meaningful on the menu screen
    player1Choice = null;
    player2Choice = null;
    document.querySelectorAll('.weapon-card').forEach(card => {
        card.classList.remove('p1-selected', 'p2-selected');
    });
    const status = document.getElementById('statusText');
    status.textContent = 'Player 1: Choose your fighter';
    status.style.color = '#00f3ff';
    document.getElementById('startBtn').classList.remove('ready');
}

/* --------------------------------------------------------------------------
   Event wiring
   -------------------------------------------------------------------------- */

// Weapon cards
document.querySelectorAll('.weapon-card').forEach(card => {
    card.addEventListener('click', () => selectWeapon(card.dataset.weapon));
});

// Menu + game buttons
document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('resetMenuBtn').addEventListener('click', resetSelection);
document.getElementById('restartBtn').addEventListener('click', restartGame);

// Keyboard shortcuts (desktop)
window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey) {
        isPaused = !isPaused; // debug pause
    }
    if (e.key === 'Enter') {
        startGame();
    }
    if (e.key === 'Escape') {
        resetSelection();
    }
});

// Mobile browsers only allow sound after a user gesture.
// Resume the audio context on the first (and every) interaction; it's cheap.
['pointerdown', 'touchend', 'keydown'].forEach(evt => {
    window.addEventListener(evt, () => AudioManager.unlock(), { passive: true });
});

// Keep the arena fitted to the screen (rotation, browser bars, window resize)
window.addEventListener('resize', fitCanvas);
window.addEventListener('orientationchange', () => setTimeout(fitCanvas, 200));
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitCanvas);
}

