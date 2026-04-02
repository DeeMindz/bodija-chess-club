const fs = require('fs');
let code = fs.readFileSync('lib/main.js', 'utf8');

const debounceFunc = `
// ==================== OPTIMIZATIONS ====================
let _leaderboardTimeout = null;
window.debouncedRenderLeaderboard = function() {
    if (_leaderboardTimeout) clearTimeout(_leaderboardTimeout);
    _leaderboardTimeout = setTimeout(() => {
        if (typeof renderLeaderboard === 'function') renderLeaderboard();
    }, 250);
};

let _tournamentSearchTimeout = null;
window.debouncedFilterTournamentPlayers = function() {
    if (_tournamentSearchTimeout) clearTimeout(_tournamentSearchTimeout);
    _tournamentSearchTimeout = setTimeout(() => {
        if (typeof filterTournamentPlayers === 'function') filterTournamentPlayers();
    }, 250);
};
`;

if (!code.includes('debouncedRenderLeaderboard')) {
    code = code.replace(/let players = \[\];/, debounceFunc + 'let players = [];');
    fs.writeFileSync('lib/main.js', code);
    console.log('Appended debounce routines');
} else {
    console.log('Debounce already exists');
}
