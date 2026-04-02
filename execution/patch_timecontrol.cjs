const fs = require('fs');
let code = fs.readFileSync('src/lib/main.js', 'utf8');

// ── Add custom time control toggle helpers ──
const marker = 'window.getCategoryFromTimeControl = getCategoryFromTimeControl;';
if (!code.includes('toggleCustomTimeControl')) {
    const helpers = `\n
// Custom time control helpers for tournament creation form
window.toggleCustomTimeControl = function(val) {
    const customInput = document.getElementById('customTimeControl');
    if (!customInput) return;
    if (val === 'custom') {
        customInput.style.display = 'block';
        customInput.focus();
    } else {
        customInput.style.display = 'none';
        customInput.value = '';
    }
};

window.syncCustomTimeControl = function(val) {
    // Keep custom input in sync — used when submitting the form
    // The form submit handler reads this value directly
};

// Get the effective time control from the form (handles custom input)
window.getEffectiveTimeControl = function() {
    const sel = document.getElementById('tournamentTimeControl');
    if (!sel) return '';
    if (sel.value === 'custom') {
        const custom = document.getElementById('customTimeControl')?.value?.trim();
        return custom || 'Custom';
    }
    return sel.value;
};
`;
    code = code.replace(marker, marker + helpers);
    fs.writeFileSync('src/lib/main.js', code);
    console.log('✅ Custom time control helpers added');
} else {
    console.log('ℹ️  Custom time control helpers already present');
}

// ── Now update the game rows in renderGames to show category badge ──
code = fs.readFileSync('src/lib/main.js', 'utf8');
const lines = code.split('\n');
let renderGamesStart = -1;
lines.forEach((l, i) => {
    if (l.includes('function renderGames') || l.includes('renderGamesBody') || l.includes('gamesBody')) {
        console.log(`Found at line ${i+1}: ${l.trim()}`);
    }
});

// Search for tournament_name display in games rendering
const catBadgeOld = /\$\{g\.tournament_name[^}]*\}\s*<\/span>\s*<\/div>/;
const gameTournamentIdx = code.indexOf('tournament_name');
if (gameTournamentIdx > 0) {
    console.log('Found tournament_name at char:', gameTournamentIdx);
    console.log(code.substring(gameTournamentIdx - 100, gameTournamentIdx + 200));
}
