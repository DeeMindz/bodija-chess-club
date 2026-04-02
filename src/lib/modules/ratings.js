import { store } from './store.js';

export function getRatingForCategory(player, cat) {
  if (!player) return 1600;
  if (cat === 'rapid') return player.rapid_rating || player.bodija_rating || 1600;
  if (cat === 'blitz') return player.blitz_rating || player.bodija_rating || 1600;
  if (cat === 'classical') return player.classical_rating || player.bodija_rating || 1600;
  return player.bodija_rating || 1600;
}

export function getPeakRatingForCategory(player, cat) {
  if (!player) return 1600;
  if (cat === 'rapid') return player.rapid_peak_rating || player.peak_rating || 1600;
  if (cat === 'blitz') return player.blitz_peak_rating || player.peak_rating || 1600;
  if (cat === 'classical') return player.classical_peak_rating || player.peak_rating || 1600;
  return player.peak_rating || 1600;
}

// Derive rating category from a time control string

export // Get category-specific WDL stats from the games array
function getCategoryStats(player, cat) {
  const catGames = (store.games || []).filter(g => {
    const isPlayer = g.white === player.id || g.black === player.id || g.white_player_id === player.id || g.black_player_id === player.id;
    if (!isPlayer) return false;
    return (g.category || 'rapid') === cat;
  });
  const wins = catGames.filter(g => {
    const isWhite = g.white === player.id || g.white_player_id === player.id;
    return isWhite && g.result === '1-0' || !isWhite && g.result === '0-1';
  }).length;
  const draws = catGames.filter(g => g.result === '1/2-1/2').length;
  const losses = catGames.filter(g => {
    const isWhite = g.white === player.id || g.white_player_id === player.id;
    return isWhite && g.result === '0-1' || !isWhite && g.result === '1-0';
  }).length;
  const total = wins + draws + losses;
  const winRate = total === 0 ? 0 : Math.round((wins + draws * 0.5) / total * 100);
  return {
    wins,
    draws,
    losses,
    total,
    winRate,
    catGames
  };
}

export // Form indicator using category-specific games (still global by default as per design)
function getPerformanceDataForCategory(player, cat) {
  const catGames = (store.games || []).filter(g => {
    const isPlayer = g.white === player.id || g.black === player.id || g.white_player_id === player.id || g.black_player_id === player.id;
    return isPlayer; // Form remains GLOBAL across all categories
  }).sort((a, b) => new Date(b.date) - new Date(a.date));
  if (catGames.length < 3) return {
    state: 'neutral',
    label: '-',
    class: 'perf-neutral'
  };
  const last5 = catGames.slice(0, 5);
  let formScore = 0;
  last5.forEach(g => {
    const isWhite = g.white === player.id || g.white_player_id === player.id;
    if (g.result === '1/2-1/2') formScore += 0.5;else if (isWhite && g.result === '1-0' || !isWhite && g.result === '0-1') formScore += 1;
  });
  const formPct = formScore / last5.length;
  if (formPct >= 0.6) return { state: 'hot', icon: '&#x1F525;', class: 'perf-hot' };
  if (formPct >= 0.4) return {
    state: 'stable',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
    class: 'perf-stable'
  };
  if (formPct >= 0.2) return {
    state: 'down',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>',
    class: 'perf-down'
  };
  return { state: 'cold', icon: '&#x1F976;', class: 'perf-cold' };
}

export // Calculate ELO rating change
function calculateElo(playerRating, opponentRating, result) {
  // result: 1 = win, 0.5 = draw, 0 = loss
  const expected = 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
  const K = 32;
  const change = Math.round(K * (result - expected));
  return {
    change,
    newRating: playerRating + change
  };
}

// Recalculate all ratings from scratch (after result entry or edit)

export function getTitle(rating) {
  if (rating >= 1900) return {
    title: 'BGM',
    class: 'bgm'
  };
  if (rating >= 1800) return {
    title: 'BM',
    class: 'bm'
  };
  if (rating >= 1700) return {
    title: 'BC',
    class: 'bc'
  };
  if (rating >= 1600) return {
    title: 'CP',
    class: 'cp'
  };
  return {
    title: 'RP',
    class: 'rp'
  };
}

