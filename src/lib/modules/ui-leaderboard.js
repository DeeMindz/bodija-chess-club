import { store } from './store.js';
// Assume global window tools exist for legacy crossover mapping.

export // ==================== LEADERBOARD ====================

// Build a compact inline medal stack for leaderboard/cards/detail header
function _buildMedalStack(playerId, size = 22, maxShow = 3, clickable = true) {
  const medals = store.medalsCache[playerId] || [];
  if (!medals.length) return '';
  const emoji = {
    1: '🥇',
    2: '🥈',
    3: '🥉'
  };
  const color = {
    1: '#FFD700',
    2: '#C0C0C0',
    3: '#CD7F32'
  };
  const label = {
    1: '1st',
    2: '2nd',
    3: '3rd'
  };
  const shown = medals.slice(0, maxShow);
  const extra = medals.length - shown.length;
  const click = clickable ? `onclick="event.stopPropagation();openMedalsModal('${playerId}')"` : '';
  const pxSize = size + 'px';
  const fontSize = Math.round(size * 0.55) + 'px';
  const badges = shown.map((m, i) => {
    const dateStr = m.date ? new Date(m.date).toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric'
    }) : '';
    const tip = label[m.position] + ' · ' + m.tournamentName + ' · ' + dateStr;
    return `<span title="${tip}" ${click} style="
            display:inline-flex;align-items:center;justify-content:center;
            width:${pxSize};height:${pxSize};border-radius:50%;
            background:radial-gradient(circle at 35% 35%,${color[m.position]}44,${color[m.position]}18);
            border:1.5px solid ${color[m.position]}77;
            font-size:${fontSize};cursor:${clickable ? 'pointer' : 'default'};
            box-shadow:0 1px 4px ${color[m.position]}44;
            margin-left:${i > 0 ? '-6px' : '0'};z-index:${maxShow - i};position:relative;
            transition:transform 0.15s,z-index 0s;flex-shrink:0;"
            onmouseenter="this.style.transform='scale(1.25)';this.style.zIndex=99"
            onmouseleave="this.style.transform='scale(1)';this.style.zIndex=${maxShow - i}"
        >${emoji[m.position]}</span>`;
  }).join('');
  const overflow = extra > 0 ? `<span ${click} title="View all medals" style="
        display:inline-flex;align-items:center;justify-content:center;
        width:${pxSize};height:${pxSize};border-radius:50%;
        background:var(--bg-tertiary);border:1.5px solid rgba(255,255,255,0.15);
        font-size:${Math.round(size * 0.38) + 'px'};font-weight:700;color:var(--text-secondary);
        cursor:pointer;margin-left:-6px;z-index:0;position:relative;flex-shrink:0;
        transition:background 0.15s,color 0.15s;"
        onmouseenter="this.style.background='var(--accent-gold)';this.style.color='#000'"
        onmouseleave="this.style.background='var(--bg-tertiary)';this.style.color='var(--text-secondary)'"
    >+${extra}</span>` : '';
  return `<span style="display:inline-flex;align-items:center;">${badges}${overflow}</span>`;
}

export function renderLeaderboard() {
  const tbody = document.getElementById('leaderboardBody');
  if (!store.players || store.players.length === 0) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 40px; color: var(--text-secondary);">No players found. Add players to the database to see them here.</td></tr>';
    return;
  }

  // Filter out guest players
  const nonGuestPlayers = store.players.filter(p => p && !p.isGuest);
  const sorted = [...nonGuestPlayers].sort((a, b) => getRatingForCategory(b, window.activeLeaderboardCategory) - getRatingForCategory(a, window.activeLeaderboardCategory));
  const searchTerm = document.getElementById('leaderboardSearch')?.value?.toLowerCase() || '';
  const filtered = sorted.filter(p => p && (searchTerm === '' || p.name && p.name.toLowerCase().includes(searchTerm)));
  if (tbody) tbody.innerHTML = filtered.map((player, idx) => {
    if (!player) return '';
    const cat = window.activeLeaderboardCategory;
    const title = getTitle(player.rapid_rating || player.bodija_rating || 1600);
    const catStats = getCategoryStats(player, cat);
    const perf = getPerformanceDataForCategory(player, cat);
    const displayGames = catStats.total > 0 ? catStats.total : player.games ?? 0;
    return `
            <div class="table-row fade-in" onclick="openPlayerDetail('${player?.id ?? ''}')" title="Tap for details">
                        <span class="rank-cell">${idx + 1}</span>
                        <div class="player-cell">
                            <span class="title-badge ${title.class}">${title.title}</span>
                            <span class="player-name">${player?.name ?? 'Unknown'}</span>
                            ${_buildMedalStack(player.id, 20, 3)}
                        </div>
                        <div class="perf-indicator">
                            ${perf.state === 'neutral' ? `<span class="perf-neutral">${perf.label}</span>` : `<span class="perf-icon ${perf.class}">${perf.icon}</span>`}
                        </div>
                        <span class="rating-cell">${getRatingForCategory(player, cat)}</span>
                        <span class="mobile-hide">${getPeakRatingForCategory(player, cat)}</span>
                        <span class="mobile-hide">${displayGames}</span>
                        <span>${catStats.wins}-${catStats.draws}-${catStats.losses}</span>
                        <span>${catStats.winRate}%</span>
                        <span class="status-badge mobile-hide ${player?.status ?? 'active'}">${player?.status ?? 'active'}</span>
            </div>
            `;
  }).join('');
}

// ==================== PLAYERS ====================

