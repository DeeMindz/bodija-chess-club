import { store } from './store.js';

export function calculateWinRate(player) {
  const total = player.games || player.wins + player.draws + player.losses || 0;
  // Note: if total still 0, data may not have been synced yet — run recalcStats() from console
  if (total === 0) return 0;
  return Math.round((player.wins + player.draws * 0.5) / total * 100);
}

export function getPerformanceData(player) {
  // Need at least 3 games to show a trend
  if ((player.games || 0) < 3) return {
    state: 'neutral',
    label: '-',
    class: 'perf-neutral'
  };

  // Get this player's games from the global games array (sorted newest first)
  // games now includes white_player_id / black_player_id thanks to the updated query
  const playerGames = store.games.filter(g => g.white === player.id || g.black === player.id).sort((a, b) => new Date(b.date) - new Date(a.date));

  // Not enough game records loaded yet — fall back to neutral
  if (playerGames.length === 0) return {
    state: 'neutral',
    label: '-',
    class: 'perf-neutral'
  };

  // ── FORM: score across last 5 games (max 5 points) ───────────────────────
  const last5 = playerGames.slice(0, 5);
  let formScore = 0;
  last5.forEach(g => {
    const isWhite = g.white === player.id;
    if (g.result === '1/2-1/2') {
      formScore += 0.5;
    } else if (isWhite && g.result === '1-0' || !isWhite && g.result === '0-1') {
      formScore += 1;
    }
    // loss = 0
  });
  const formPct = formScore / last5.length; // 0.0 – 1.0

  // ── RATING TREND: compare current rating vs rating before the 5th-last game ──
  // Use whiteRatingBefore / blackRatingBefore stored on the game record
  let ratingDiff = 0;
  if (playerGames.length >= 2) {
    const newestGame = playerGames[0];
    const oldestInWindow = playerGames[Math.min(playerGames.length - 1, 4)];
    const currentRating = player.rating;
    const pastRating = (oldestInWindow.white === player.id ? oldestInWindow.whiteRatingBefore : oldestInWindow.blackRatingBefore) || player.rating;
    ratingDiff = currentRating - pastRating;
  }

  // ── DECISION: hot > up > stable > down ───────────────────────────────────
  if (formPct >= 0.8 || ratingDiff >= 50) {
    return {
      state: 'hot',
      icon: '&#x1F525;',
      class: 'perf-hot'
    };
  }
  if (formPct >= 0.6 || ratingDiff >= 15) {
    return {
      state: 'up',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>',
      class: 'perf-up'
    };
  }
  if (formPct <= 0.3 || ratingDiff <= -15) {
    return {
      state: 'down',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>',
      class: 'perf-down'
    };
  }
  return {
    state: 'stable',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
    class: 'perf-stable'
  };
}

// ==================== RATING CALCULATION ====================

export function calculateHeadToHead(playerId, cat = 'rapid') {
  const h2h = {};
  const catGames = store.games.filter(g => (g.category || 'rapid') === cat);
  catGames.forEach(game => {
    let opponentId = null;
    let result = null;
    if (game.white === playerId) {
      opponentId = game.black;
      if (game.result === '1-0') result = 'win';else if (game.result === '0-1') result = 'loss';else result = 'draw';
    } else if (game.black === playerId) {
      opponentId = game.white;
      if (game.result === '0-1') result = 'win';else if (game.result === '1-0') result = 'loss';else result = 'draw';
    }
    if (opponentId) {
      if (!h2h[opponentId]) {
        const opp = getPlayerById(opponentId);
        h2h[opponentId] = {
          name: opp?.name || 'Unknown',
          wins: 0,
          draws: 0,
          losses: 0
        };
      }
      h2h[opponentId][result === 'win' ? 'wins' : result === 'loss' ? 'losses' : 'draws']++;
    }
  });
  return Object.values(h2h).sort((a, b) => b.wins + b.draws * 0.5 - (a.wins + a.draws * 0.5));
}

