import { store } from './store.js';
// Assume global window tools exist for legacy crossover mapping.

export // ==================== PLAYERS ====================
function renderPlayers() {
  const grid = document.getElementById('playersGrid');
  if (!store.players || store.players.length === 0) {
    if (grid) grid.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-secondary);">No players found. Add players to the database to see them here.</div>';
    return;
  }

  // Filter out guest players
  const nonGuestPlayers = store.players.filter(p => p && !p.isGuest);
  if (grid) grid.innerHTML = nonGuestPlayers.map(player => {
    if (!player) return '';
    const title = getTitle(player.rapid_rating || player.bodija_rating || 1600);
    const winRate = calculateWinRate(player);
    const avatarContent = player.photo ? `<img src="${player.photo}" alt="${player.name}" class="player-card-avatar-img">` : `<div class="player-card-avatar">${getInitials(player?.name ?? 'Unknown')}</div>`;
    return `
            <div class="player-card fade-in" onclick = "openPlayerDetail('${player?.id ?? ''}')" >
                        <div class="player-card-header">
                            <div class="player-card-avatar-container">${avatarContent}</div>
                            <div class="player-card-info">
                                <h3>${player?.name ?? 'Unknown'}</h3>
                                <span class="player-card-status ${player?.status ?? 'active'}">${player?.status ?? 'Active'}</span>
                                <span class="title-badge ${title.class}">${title.title}</span>
                                ${_buildMedalStack(player.id, 22, 4) ? `<div style="margin-top:5px;">${_buildMedalStack(player.id, 22, 4)}</div>` : ''}
                            </div>
                        </div>
                        <div class="player-card-stats">
                            <div class="player-card-stat">
                                <div class="player-card-stat-value">${player?.wins ?? 0}</div>
                                <div class="player-card-stat-label">Wins</div>
                            </div>
                            <div class="player-card-stat">
                                <div class="player-card-stat-value">${player?.draws ?? 0}</div>
                                <div class="player-card-stat-label">Draws</div>
                            </div>
                            <div class="player-card-stat">
                                <div class="player-card-stat-value">${player?.losses ?? 0}</div>
                                <div class="player-card-stat-label">Losses</div>
                            </div>
                        </div>
            </div>
        `;
  }).join('');
}

// ==================== ADMIN PHOTO EDIT ====================

// Admin: handle photo file selection → compress → upload → re-render

export // Compress image File → Blob (JPEG), max maxSize px on longest side.
// Returns a Blob — NOT a base64 string — so it can be streamed to Storage.

// Legacy helper kept in case anything else calls it (returns base64 data-URL)

function openPlayerDetail(playerId) {
  const player = getPlayerById(playerId);
  if (!player) return;
  const title = getTitle(player.rating);
  const winRate = calculateWinRate(player);
  const perf = getPerformanceData(player);

  // Calculate head-to-head records
  const h2h = calculateHeadToHead(playerId);
  const content = document.getElementById('playerDetailContent');

  // Admin-editable avatar: wrap in a clickable overlay if admin
  const avatarInner = player.photo ? `<img src="${player.photo}" alt="${player.name}" class="player-detail-avatar-img" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid var(--accent-gold);">` : `<div class="player-detail-avatar">${getInitials(player.name)}</div>`;
  const avatarContent = isAdmin ? `
        <div style="position:relative;width:80px;height:80px;cursor:pointer;flex-shrink:0;"
             onclick="document.getElementById('adminPhotoInput_${player.id}').click()"
             title="Click to change photo">
            ${avatarInner}
            <!-- Edit overlay -->
            <div style="position:absolute;inset:0;border-radius:50%;background:rgba(0,0,0,0.52);
                        display:flex;flex-direction:column;align-items:center;justify-content:center;
                        opacity:0;transition:opacity 0.18s;pointer-events:none;"
                 class="avatar-edit-overlay">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
                     fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                    <circle cx="12" cy="13" r="4"/>
                </svg>
                <span style="color:#fff;font-size:9px;font-weight:600;margin-top:3px;letter-spacing:.5px;">EDIT</span>
            </div>
            <input type="file" id="adminPhotoInput_${player.id}" accept="image/*"
                   style="display:none;" onchange="adminUpdatePlayerPhoto('${player.id}', this)">
        </div>
        <style>
          [onclick*="adminPhotoInput"]:hover .avatar-edit-overlay { opacity: 1 !important; }
        </style>` : `<div style="width:80px;height:80px;flex-shrink:0;">${avatarInner}</div>`;
  if (content) content.innerHTML = `
            <div class="player-detail-header" >
                    <div style="flex-shrink:0;">${avatarContent}</div>
                    <div class="player-detail-info">
                        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 4px;">
                            <h2 style="margin: 0;">${player.name}</h2>
                            <span class="player-card-status ${player.status}">${player.status}</span>
                            <div class="perf-indicator" style="transform: scale(1.2);">
                                ${perf.state === 'neutral' ? `<span class="perf-new">${perf.label}</span>` : `<span class="perf-icon ${perf.class}">${perf.icon}</span>`}
                            </div>
                        </div>
                        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                            <span class="title-badge ${title.class}">${title.title}</span>
                            ${_buildMedalStack(player.id, 26, 5)}
                        </div>
                    </div>
                </div >
                <div class="player-detail-stats">
                    <div class="player-detail-stat">
                        <div class="player-detail-stat-value">${player.rating}</div>
                        <div class="player-detail-stat-label">Current Rating</div>
                    </div>
                    <div class="player-detail-stat">
                        <div class="player-detail-stat-value">${player.peakRating}</div>
                        <div class="player-detail-stat-label">Peak Rating</div>
                    </div>
                    <div class="player-detail-stat">
                        <div class="player-detail-stat-value">${winRate}%</div>
                        <div class="player-detail-stat-label">Win Rate</div>
                    </div>
                    <div class="player-detail-stat">
                        <div class="player-detail-stat-value">${player.games}</div>
                        <div class="player-detail-stat-label">Games</div>
                    </div>
                </div>
                <div class="player-detail-stats" style="grid-template-columns: repeat(3, 1fr);">
                    <div class="player-detail-stat">
                        <div class="player-detail-stat-value" style="color: var(--green)">${player.wins}</div>
                        <div class="player-detail-stat-label">Wins</div>
                    </div>
                    <div class="player-detail-stat">
                        <div class="player-detail-stat-value" style="color: var(--amber)">${player.draws}</div>
                        <div class="player-detail-stat-label">Draws</div>
                    </div>
                    <div class="player-detail-stat">
                        <div class="player-detail-stat-value" style="color: var(--danger)">${player.losses}</div>
                        <div class="player-detail-stat-label">Losses</div>
                    </div>
                </div>
                <div class="chart-container">
                    <h4 class="chart-title">Rating History</h4>
                    <canvas id="ratingChart" height="150"></canvas>
                </div>
                <div class="h2h-section">
                    <h4>Head-to-Head Record</h4>
                    <div class="h2h-list">
                        ${h2h.map(opponent => `
                            <div class="h2h-item">
                                <span class="h2h-name">${opponent.name}</span>
                                <span class="h2h-record">
                                    <span class="h2h-wins">${opponent.wins}W</span> - 
                                    <span class="h2h-draws">${opponent.draws}D</span> - 
                                    <span class="h2h-losses">${opponent.losses}L</span>
                                </span>
                            </div>
                        `).join('')}
                    </div>
                </div>


        `;

  // Render chart
  // Fetch rating history from DB for the chart
  setTimeout(async () => {
    try {
      const history = await api.fetchPlayerRatingHistory(player.id);
      if (history && history.length > 0) {
        // Build rating series: start with ratingAtStart, then each rating_after
        const series = [history[0].rating_before, ...history.map(h => h.rating_after)];
        renderRatingChart(series);
      } else {
        renderRatingChart([player.rating]);
      }
    } catch (e) {
      renderRatingChart([player.rating]);
    }
  }, 100);
  document.getElementById('playerDetailModal').classList.add('active');
}

