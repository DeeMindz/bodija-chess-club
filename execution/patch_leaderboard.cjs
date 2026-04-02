const fs = require('fs');

let code = fs.readFileSync('lib/main.js', 'utf8');

// 1. Inject helpers right after imports
if (!code.includes('activeLeaderboardCategory')) {
    const helpers = `
// ==================== MULTI-CATEGORY HELPERS ====================
window.activeLeaderboardCategory = 'rapid';

window.setLeaderboardCategory = function(cat) {
    window.activeLeaderboardCategory = cat;
    
    // Update active tab buttons
    document.querySelectorAll('.category-tab').forEach(tab => {
        if (tab.dataset.category === cat) tab.classList.add('active');
        else tab.classList.remove('active');
    });
    
    // Update podium select dropdown if different
    const podiumSelect = document.getElementById('podiumCategory');
    if (podiumSelect && podiumSelect.value !== cat) {
        podiumSelect.value = cat;
    }
    
    if (typeof renderLeaderboard === 'function') renderLeaderboard();
    if (typeof renderDashboard === 'function') renderDashboard();
};

function getRatingForCategory(player, cat) {
    if (!player) return 1600;
    if (cat === 'rapid') return player.rapid_rating || player.bodija_rating || 1600;
    if (cat === 'blitz') return player.blitz_rating || 1600;
    if (cat === 'classical') return player.classical_rating || 1600;
    return player.bodija_rating || 1600;
}

function getPeakRatingForCategory(player, cat) {
    if (!player) return 1600;
    if (cat === 'rapid') return player.rapid_peak_rating || player.peak_rating || 1600;
    if (cat === 'blitz') return player.blitz_peak_rating || 1600;
    if (cat === 'classical') return player.classical_peak_rating || 1600;
    return player.peak_rating || 1600;
}

// Ensure style is dynamic for active buttons
const style = document.createElement('style');
style.textContent = '.category-tab.active { background-color: var(--accent-gold) !important; color: #000 !important; border-color: var(--accent-gold) !important; }';
document.head.appendChild(style);

`;
    // Insert after imports (let's insert after first chunk of let definitions around line 20)
    code = code.replace(/let players = \[\];/, helpers + 'let players = [];');
}

// 2. Patch renderLeaderboard (we saw the exact source in extracted.txt)
code = code.replace(
    /const sorted = \[\.\.\.nonGuestPlayers\]\.sort\(\(a, b\) => \(b\?\.rating \?\? 0\) - \(a\?\.rating \?\? 0\)\);/g,
    `const sorted = [...nonGuestPlayers].sort((a, b) => getRatingForCategory(b, window.activeLeaderboardCategory) - getRatingForCategory(a, window.activeLeaderboardCategory));`
);

code = code.replace(
    /const title = getTitle\(player\?\.rating \?\? 1600\);/g,
    `const title = getTitle(getRatingForCategory(player, window.activeLeaderboardCategory));`
);

code = code.replace(
    /<span class="rating-cell">\$\{player\?\.rating \?\? 1600\}<\/span>\s*<span class="mobile-hide">\$\{player\?\.peakRating \?\? 1600\}<\/span>/g,
    `<span class="rating-cell">\$\{getRatingForCategory(player, window.activeLeaderboardCategory)\}</span>\n                        <span class="mobile-hide">\$\{getPeakRatingForCategory(player, window.activeLeaderboardCategory)\}</span>`
);

// 3. Patch renderDashboard (which renders podium) to sort correctly too. We don't have its exact code, but look for similar patterns
code = code.replace(
    /const sorted = \[\.\.\.nonGuestPlayers\]\.sort\(\(a, b\) => \(b\?\.rating \?\? 0\) - \(a\?\.rating \?\? 0\)\);/g, // if it exists elsewhere
    `const sorted = [...nonGuestPlayers].sort((a, b) => getRatingForCategory(b, window.activeLeaderboardCategory) - getRatingForCategory(a, window.activeLeaderboardCategory));`
);

// Let's replace instances of `player.bodija_rating` or `player.rating` in getTitle calls generically
code = code.replace(
    /player\?\.bodija_rating \?\? 1600/g,
    `getRatingForCategory(player, window.activeLeaderboardCategory)`
);

// For submitGame:
code = code.replace(
    /const whiteElo = calculateElo\(whitePlayer\.rating, blackPlayer\.rating, whiteScore\);/,
    `const cat = document.getElementById('gameCategory').value || 'rapid';\n    const whiteRatingBefore = getRatingForCategory(whitePlayer, cat);\n    const blackRatingBefore = getRatingForCategory(blackPlayer, cat);\n    const whiteElo = calculateElo(whiteRatingBefore, blackRatingBefore, whiteScore);`
);

code = code.replace(
    /const blackElo = calculateElo\(blackPlayer\.rating, whitePlayer\.rating, blackScore\);/,
    `const blackElo = calculateElo(blackRatingBefore, whiteRatingBefore, blackScore);`
);

code = code.replace(
    /const whiteExpected = 1 \/ \(1 \+ Math\.pow\(10, \(blackPlayer\.rating - whitePlayer\.rating\) \/ 400\)\);/,
    `const whiteExpected = 1 / (1 + Math.pow(10, (blackRatingBefore - whiteRatingBefore) / 400));`
);

code = code.replace(
    /const blackExpected = 1 \/ \(1 \+ Math\.pow\(10, \(whitePlayer\.rating - blackPlayer\.rating\) \/ 400\)\);/,
    `const blackExpected = 1 / (1 + Math.pow(10, (whiteRatingBefore - blackRatingBefore) / 400));`
);

// Replace the newGame creation to include category
code = code.replace(
    /tournament: tournament,/, // actually just `tournament,`
    `tournament,\n        category: document.getElementById('gameCategory').value || 'rapid',`
);

// Update confirmation string
code = code.replace(
    /White Rating: \$\{whitePlayer\.rating}/,
    `White Rating: \$\{whiteRatingBefore}`
);
code = code.replace(
    /whitePlayer\.rating \+ whiteChange/,
    `whiteRatingBefore + whiteChange`
);

code = code.replace(
    /Black Rating: \$\{blackPlayer\.rating}/,
    `Black Rating: \$\{blackRatingBefore}`
);
code = code.replace(
    /blackPlayer\.rating \+ blackChange/,
    `blackRatingBefore + blackChange`
);

fs.writeFileSync('lib/main.js', code);
console.log('Patch complete');
