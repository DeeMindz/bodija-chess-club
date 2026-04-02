import { store } from './store.js';
// Assume global window tools exist for legacy crossover mapping.

export // ==================== GAMES LOG ====================

function renderGamesLog() {
  const container = document.getElementById('gamesLogBody');
  if (!store.games || store.games.length === 0) {
    if (container) container.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--text-secondary);">No games found. Add games to the database to see them here.</td></tr>';
    return;
  }
  const tournamentFilter = document.getElementById('tournamentFilter').value;
  let filtered = [...store.games].sort((a, b) => new Date(b.date) - new Date(a.date));
  if (tournamentFilter) {
    filtered = filtered.filter(g => g.tournament === tournamentFilter);
  }
  const tbody = document.getElementById('gamesBody');
  if (tbody) tbody.innerHTML = filtered.map((game, idx) => {
    // Use stored player names from the game record
    const whiteName = game.whiteName || 'Unknown';
    const blackName = game.blackName || 'Unknown';
    let resultClass = 'draw';
    if (game.result === '1-0') resultClass = 'white-win';
    if (game.result === '0-1') resultClass = 'black-win';
    const catLabel = game.category === 'blitz' ? '⚡ Blitz' : game.category === 'classical' ? '♟ Classical' : '🕐 Rapid';
    return `
            <div class="table-row fade-in" onclick = "openGameDetail('${game?.id ?? ''}')" style = "cursor: pointer;" >
                        <span class="mobile-hide">${idx + 1}</span>
                        <span>${game.date || ''}</span>
                        <span>${whiteName}</span>
                        <div style="display: flex; justify-content: center;">
                            <span class="result-badge ${resultClass}">${formatResult(game.result)}</span>
                        </div>
                        <span>${blackName}</span>
                        <span class="mobile-hide"><span style="font-size:11px; padding:2px 7px; border-radius:10px; font-weight:600; background: var(--bg-tertiary); color: var(--text-secondary);">${catLabel}</span></span>
                        <span class="single-line-text mobile-hide">${game.tournament || '-'}</span>
                        <span class="rating-change ${game.whiteChange >= 0 ? 'positive' : 'negative'} mobile-hide">${game.whiteChange >= 0 ? '+' : ''}${game.whiteChange}</span>
                        <span class="rating-change ${game.blackChange >= 0 ? 'positive' : 'negative'} mobile-hide">${game.blackChange >= 0 ? '+' : ''}${game.blackChange}</span>
            </div>
            `;
  }).join('');
}

// ==================== HEAD-TO-HEAD ANALYTICS ====================

export function closeGameDetailModal() {
  document.getElementById('gameDetailModal').classList.remove('active');
}

export function populatePlayerSelects() {
  const whiteSelect = document.getElementById('whitePlayer');
  const blackSelect = document.getElementById('blackPlayer');
  const options = store.players.map(p => `<option value = "${p.id}" > ${p.name} (${p.rating})</option > `).join('');
  if (whiteSelect) whiteSelect.innerHTML = `<option value = "" > Select White Player</option > ${options} `;
  if (blackSelect) blackSelect.innerHTML = `<option value = "" > Select Black Player</option > ${options} `;
}

export function closeAddGameModal() {
  document.getElementById('addGameModal').classList.remove('active');
}

