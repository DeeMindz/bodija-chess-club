const fs = require('fs');

let code = fs.readFileSync('lib/main.js', 'utf8');

// 1. Pass category from submitGame to showGameConfirmModal
code = code.replace(
    /showGameConfirmModal\(whitePlayer, blackPlayer, result, whiteChange, blackChange, whiteScore, blackScore\);/,
    `const categoryToSubmit = document.getElementById('gameCategory').value || 'rapid';\n    showGameConfirmModal(whitePlayer, blackPlayer, result, whiteChange, blackChange, whiteScore, blackScore, categoryToSubmit);`
);

// 2. Update showGameConfirmModal to store category
code = code.replace(
    /function showGameConfirmModal\(whitePlayer, blackPlayer, result, whiteChange, blackChange, whiteScore, blackScore\)\s*{/,
    `function showGameConfirmModal(whitePlayer, blackPlayer, result, whiteChange, blackChange, whiteScore, blackScore, category) {`
);
code = code.replace(
    /modal\.dataset\.blackScore = blackScore;/,
    `modal.dataset.blackScore = blackScore;\n    modal.dataset.category = category || 'rapid';`
);

// 3. Update confirmGameSubmit
code = code.replace(
    /const blackScore = parseFloat\(modal\.dataset\.blackScore\);/,
    `const blackScore = parseFloat(modal.dataset.blackScore);\n    const category = modal.dataset.category || 'rapid';`
);

// In confirmGameSubmit, it modifies players[whiteIdx].rating. It needs to modify the specific category rating.
code = code.replace(
    /players\[whiteIdx\]\.rating \+= whiteChange;/,
    `if(category === 'rapid') { players[whiteIdx].rapid_rating = (players[whiteIdx].rapid_rating || players[whiteIdx].bodija_rating || 1600) + whiteChange; players[whiteIdx].bodija_rating = players[whiteIdx].rapid_rating; }
        else if(category === 'blitz') players[whiteIdx].blitz_rating = (players[whiteIdx].blitz_rating || 1600) + whiteChange;
        else if(category === 'classical') players[whiteIdx].classical_rating = (players[whiteIdx].classical_rating || 1600) + whiteChange;
        players[whiteIdx].rating = getRatingForCategory(players[whiteIdx], window.activeLeaderboardCategory);`
);
code = code.replace(
    /players\[blackIdx\]\.rating \+= blackChange;/,
    `if(category === 'rapid') { players[blackIdx].rapid_rating = (players[blackIdx].rapid_rating || players[blackIdx].bodija_rating || 1600) + blackChange; players[blackIdx].bodija_rating = players[blackIdx].rapid_rating; }
        else if(category === 'blitz') players[blackIdx].blitz_rating = (players[blackIdx].blitz_rating || 1600) + blackChange;
        else if(category === 'classical') players[blackIdx].classical_rating = (players[blackIdx].classical_rating || 1600) + blackChange;
        players[blackIdx].rating = getRatingForCategory(players[blackIdx], window.activeLeaderboardCategory);`
);

// Update peak ratings
code = code.replace(
    /if \(players\[whiteIdx\]\.rating > players\[whiteIdx\]\.peakRating\) \{/,
    `
        let wRating = getRatingForCategory(players[whiteIdx], category);
        let wPeak = getPeakRatingForCategory(players[whiteIdx], category);
        if (wRating > wPeak) {
            if(category==='rapid') { players[whiteIdx].rapid_peak_rating = wRating; players[whiteIdx].peakRating = wRating; }
            if(category==='blitz') players[whiteIdx].blitz_peak_rating = wRating;
            if(category==='classical') players[whiteIdx].classical_peak_rating = wRating;
        }
        // block old peak updating
        if (false) {`
);

code = code.replace(
    /if \(players\[blackIdx\]\.rating > players\[blackIdx\]\.peakRating\) \{/,
    `
        let bRating = getRatingForCategory(players[blackIdx], category);
        let bPeak = getPeakRatingForCategory(players[blackIdx], category);
        if (bRating > bPeak) {
            if(category==='rapid') { players[blackIdx].rapid_peak_rating = bRating; players[blackIdx].peakRating = bRating; }
            if(category==='blitz') players[blackIdx].blitz_peak_rating = bRating;
            if(category==='classical') players[blackIdx].classical_peak_rating = bRating;
        }
        // block old peak updating
        if (false) {`
);


// In confirmGameSubmit, update api.insertGames to add category
code = code.replace(
    /black_player_name: updatedBlackPlayer\.name\n\s*}\]\);/,
    `black_player_name: updatedBlackPlayer.name,\n            category: category\n        }]);`
);


// Rewrite the api.updatePlayerStats payload completely in confirmGameSubmit
code = code.replace(
    /api\.updatePlayerStats\(updatedWhitePlayer\.id, \{[\s\S]*?\}\),/,
    `api.updatePlayerStats(updatedWhitePlayer.id, {
                bodija_rating: updatedWhitePlayer.bodija_rating || updatedWhitePlayer.rapid_rating || 1600,
                peak_rating: updatedWhitePlayer.peakRating || updatedWhitePlayer.rapid_peak_rating || 1600,
                rapid_rating: updatedWhitePlayer.rapid_rating || updatedWhitePlayer.bodija_rating || 1600,
                rapid_peak_rating: updatedWhitePlayer.rapid_peak_rating || updatedWhitePlayer.peakRating || 1600,
                blitz_rating: updatedWhitePlayer.blitz_rating || 1600,
                blitz_peak_rating: updatedWhitePlayer.blitz_peak_rating || 1600,
                classical_rating: updatedWhitePlayer.classical_rating || 1600,
                classical_peak_rating: updatedWhitePlayer.classical_peak_rating || 1600,
                games_played: updatedWhitePlayer.games,
                wins: updatedWhitePlayer.wins,
                draws: updatedWhitePlayer.draws,
                losses: updatedWhitePlayer.losses
            }),`
);

code = code.replace(
    /api\.updatePlayerStats\(updatedBlackPlayer\.id, \{[\s\S]*?\}\)\n\s*\]\);/,
    `api.updatePlayerStats(updatedBlackPlayer.id, {
                bodija_rating: updatedBlackPlayer.bodija_rating || updatedBlackPlayer.rapid_rating || 1600,
                peak_rating: updatedBlackPlayer.peakRating || updatedBlackPlayer.rapid_peak_rating || 1600,
                rapid_rating: updatedBlackPlayer.rapid_rating || updatedBlackPlayer.bodija_rating || 1600,
                rapid_peak_rating: updatedBlackPlayer.rapid_peak_rating || updatedBlackPlayer.peakRating || 1600,
                blitz_rating: updatedBlackPlayer.blitz_rating || 1600,
                blitz_peak_rating: updatedBlackPlayer.blitz_peak_rating || 1600,
                classical_rating: updatedBlackPlayer.classical_rating || 1600,
                classical_peak_rating: updatedBlackPlayer.classical_peak_rating || 1600,
                games_played: updatedBlackPlayer.games,
                wins: updatedBlackPlayer.wins,
                draws: updatedBlackPlayer.draws,
                losses: updatedBlackPlayer.losses
            })\n        ]);`
);


fs.writeFileSync('lib/main.js', code);
console.log('Confirmation flow patched');
