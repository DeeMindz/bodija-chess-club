import * as api from './api.js';

// ==================== DATA STORE ====================
let players = [];
let games = [];
let tournaments = [];
let currentSortColumn = 'rating';
let currentSortDirection = 'desc';
let playerDetailChart = null;

// ==================== DATA MAPPING (Supabase snake_case -> camelCase) ====================
// This function handles various possible column name formats from Supabase
function mapPlayerFromDB(dbPlayer) {
    if (!dbPlayer || typeof dbPlayer !== 'object') return null;

    // Handle various possible column name formats
    const name = dbPlayer.name || dbPlayer.player_name || dbPlayer.full_name || 'Unknown Player';
    const rating = dbPlayer.bodija_rating || dbPlayer.rating || dbPlayer.current_rating || 1600;
    const peakRating = dbPlayer.peak_rating || dbPlayer.peakRating || dbPlayer.peak_rating || rating;
    const gamesPlayed = dbPlayer.games_played ?? 0;
    const wins = dbPlayer.wins || dbPlayer.win_count || 0;
    const draws = dbPlayer.draws || dbPlayer.draw_count || 0;
    const losses = dbPlayer.losses || dbPlayer.loss_count || 0;

    return {
        id: dbPlayer.id,
        name: name,
        rating: rating,
        peakRating: peakRating,
        games: gamesPlayed,
        wins: wins,
        draws: draws,
        losses: losses,
        status: dbPlayer.status?.toLowerCase() || 'active',
        isGuest: dbPlayer.is_guest || false,
        ratingHistory: dbPlayer.rating_history || dbPlayer.ratingHistory || [rating]
    };
}

function mapGameFromDB(dbGame) {
    if (!dbGame || typeof dbGame !== 'object') return null;

    return {
        id: dbGame.id || 0,
        date: dbGame.game_date || dbGame.date || dbGame.created_at || new Date().toISOString().split('T')[0],
        white: dbGame.white_player_id,
        black: dbGame.black_player_id,
        whiteName: dbGame.white_player_name || 'Unknown',
        blackName: dbGame.black_player_name || 'Unknown',
        result: dbGame.result || '0-0',
        tournament: dbGame.tournament_name || dbGame.tournament || '',
        round: dbGame.round_number || dbGame.round || null,
        whiteChange: dbGame.white_rating_change || 0,
        blackChange: dbGame.black_rating_change || 0
    };
}

function mapTournamentFromDB(dbTournament) {
    if (!dbTournament || typeof dbTournament !== 'object') return null;

    return {
        id: dbTournament.id || 0,
        name: dbTournament.name || dbTournament.tournament_name || 'Untitled Tournament',
        date: dbTournament.tournament_date || dbTournament.date || dbTournament.created_at || new Date().toISOString().split('T')[0],
        format: dbTournament.format || 'swiss',
        timeControl: dbTournament.time_control || dbTournament.timeControl || 'Rapid',
        rounds: dbTournament.rounds || 5,
        status: dbTournament.status || 'draft',
        players: [],
        pairings: [],
        standings: [],
        results: []
    };
}

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', async () => {
    // Fetch from Supabase with error handling
    let dbPlayers = [];
    let dbGames = [];
    let dbTournaments = [];

    try {
        const playersResult = await api.fetchPlayers();
        dbPlayers = playersResult || [];
    } catch (e) {
        console.warn('Failed to fetch players:', e);
    }

    try {
        const gamesResult = await api.fetchGames();
        dbGames = gamesResult || [];
    } catch (e) {
        console.warn('Failed to fetch games:', e);
    }

    try {
        const tournamentsResult = await api.fetchTournaments();
        dbTournaments = tournamentsResult || [];
    } catch (e) {
        console.warn('Failed to fetch tournaments:', e);
    }

    // Subscribe to realtime changes
    try {
        api.subscribeToPlayers((payload) => {
            console.log('Realtime player update:', payload);
            api.fetchPlayers().then(fresh => {
                if (fresh && fresh.length) {
                    players = fresh.map(mapPlayerFromDB);
                    renderLeaderboard();
                    renderPlayers();
                    showToast('Leaderboard updated via Realtime', 'success');
                }
            });
        });

        api.subscribeToPairings((payload) => {
            console.log('Realtime pairings update:', payload);
            showToast('Tournament pairings updated', 'success');
        });
    } catch (e) {
        console.warn("Realtime error", e);
    }

    // Initialize data with mapping from Supabase (no fallbacks to sample data)
    // Filter out any null values from mapping
    players = dbPlayers ? dbPlayers.map(mapPlayerFromDB).filter(p => p !== null) : [];
    games = dbGames ? dbGames.map(mapGameFromDB).filter(g => g !== null) : [];

    // Initialize extended tournaments
    if (dbTournaments) {
        dbTournaments.forEach(t => {
            const mapped = mapTournamentFromDB(t);
            if (mapped) extendedTournaments.push(mapped);
        });
    }

    // Set up navigation
    setupNavigation();

    // Render all sections
    renderDashboard();
    renderLeaderboard();
    renderPlayers();
    renderGamesLog();
    renderTournaments();

    // Set up search/filter listeners
    setupSearchFilters();

    // Set today's date in the form
    document.getElementById('gameDate').valueAsDate = new Date();
});

// ==================== NAVIGATION ====================
function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const section = item.dataset.section;
            showSection(section);

            // Update active state
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            // Close mobile sidebar and backdrop
            closeSidebar();
        });
    });
}

function showSection(sectionId) {
    const sections = document.querySelectorAll('.section');
    sections.forEach(section => section.classList.remove('active'));
    document.getElementById(sectionId).classList.add('active');
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebarBackdrop').classList.toggle('active');
}

function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarBackdrop').classList.remove('active');
}

// ==================== UTILITY FUNCTIONS ====================
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.cssText = `
        position: fixed; bottom: 20px; right: 20px; z-index: 10000;
        padding: 12px 24px; border-radius: 8px; font-weight: 500;
        color: #fff; background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#f59e0b'};
        box-shadow: 0 4px 12px rgba(0,0,0,0.15); font-family: 'Outfit', sans-serif;
        animation: slideIn 0.3s ease-out;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    if (!document.getElementById('toastStyles')) {
        const style = document.createElement('style');
        style.id = 'toastStyles';
        style.textContent = `
            @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
            @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; transform: translateY(10px); } }
        `;
        document.head.appendChild(style);
    }

    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease-out forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function getPlayerById(id) {
    return players.find(p => p.id === id);
}

function getInitials(name) {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
}

function getTitle(rating) {
    if (rating >= 1900) return { title: 'BGM', class: 'bgm' };
    if (rating >= 1800) return { title: 'BM', class: 'bm' };
    if (rating >= 1700) return { title: 'BC', class: 'bc' };
    if (rating >= 1600) return { title: 'CP', class: 'cp' };
    return { title: 'RP', class: 'rp' };
}

function calculateWinRate(player) {
    if (player.games === 0) return 0;
    return Math.round(((player.wins + player.draws * 0.5) / player.games) * 100);
}

function getPerformanceData(player) {
    if (player.games < 5) return { state: 'new', label: 'NEW', class: 'perf-new' };

    // Form: Last 5 games
    const playerGames = games.filter(g => g.white === player.id || g.black === player.id)
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 5);

    let formPoints = 0;
    playerGames.forEach(g => {
        if (g.result === '0.5-0.5') formPoints += 0.5;
        else if ((g.white === player.id && g.result === '1-0') || (g.black === player.id && g.result === '0-1')) {
            formPoints += 1;
        }
    });

    // Rating Trend
    const tournamentGames = games.filter(g => (g.white === player.id || g.black === player.id) && g.tournament)
        .sort((a, b) => new Date(b.date) - new Date(a.date));

    let oldRating = player.ratingHistory[0];
    if (tournamentGames.length > 0) {
        const lastTournamentDate = new Date(tournamentGames[0].date);
        const gamesSinceThen = games.filter(g => (g.white === player.id || g.black === player.id) && new Date(g.date) >= lastTournamentDate).length;
        const index = Math.max(0, player.ratingHistory.length - 1 - gamesSinceThen);
        oldRating = player.ratingHistory[index];
    }

    const ratingDiff = player.rating - oldRating;

    // Hot: extremely well or rapidly increasing (4+ form points OR 50+ rating gain)
    if (formPoints >= 4.5 || ratingDiff >= 50) {
        return {
            state: 'hot',
            icon: `🔥`,
            class: 'perf-hot'
        };
    }

    if (formPoints >= 3 || ratingDiff >= 20) {
        return {
            state: 'up',
            icon: `<svg viewBox = "0 0 24 24" fill = "none" stroke = "currentColor" stroke - linecap="round" stroke - linejoin="round" > <polyline points="18 15 12 9 6 15"></polyline></svg > `,
            class: 'perf-up'
        };
    } else if (formPoints < 2 || ratingDiff <= -20) {
        return {
            state: 'down',
            icon: `<svg viewBox = "0 0 24 24" fill = "none" stroke = "currentColor" stroke - linecap="round" stroke - linejoin="round" > <polyline points="6 9 12 15 18 9"></polyline></svg > `,
            class: 'perf-down'
        };
    } else {
        return {
            state: 'stable',
            icon: `<svg viewBox = "0 0 24 24" fill = "none" stroke = "currentColor" stroke - linecap="round" stroke - linejoin="round" > <line x1="5" y1="12" x2="19" y2="12"></polyline></svg > `,
            class: 'perf-stable'
        };
    }
}

// ==================== RATING CALCULATION ====================
function calculateNewRating(playerRating, opponentRating, actualScore) {
    const expectedScore = 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
    const kFactor = playerRating < 1600 ? 40 : (games.filter(g => g.white === player.id || g.black === player.id).length < 15 ? 40 : 20);
    return Math.round(playerRating + kFactor * (actualScore - expectedScore));
}

// ==================== DASHBOARD ====================
function renderDashboard() {
    renderPodium();
    renderStats();
    renderRecentGames();
}

function renderPodium() {
    const sorted = [...players].sort((a, b) => b.rating - a.rating).slice(0, 3);
    const podium = document.getElementById('podium');

    // Order: 2nd, 1st, 3rd
    const order = [1, 0, 2];
    const classes = ['podium-2', 'podium-1', 'podium-3'];
    const medalClasses = ['silver', 'gold', 'bronze'];

    podium.innerHTML = order.map((idx, displayIdx) => {
        const player = sorted[idx];
        if (!player) return '';
        return `
            <div class="podium-place ${classes[displayIdx]}" >
                        <div class="podium-rank">${idx + 1}</div>
                        <div class="podium-avatar ${medalClasses[displayIdx]}">${getInitials(player.name)}</div>
                        <div class="podium-name">${player.name}</div>
                        <div class="podium-rating">${player.rating}</div>
                        <div class="podium-bar"></div>
                    </div >
            `;
    }).join('');
}

function renderStats() {
    document.getElementById('totalMembers').textContent = players.length;
    document.getElementById('totalGames').textContent = games.length;
    const activeCount = extendedTournaments.filter(t => t.status === 'active' || t.status === 'Active').length;
    document.getElementById('activeTournaments').textContent = activeCount;
}

function renderRecentGames() {
    const container = document.getElementById('recentGames');

    if (!games || games.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-secondary);">No recent games. Add games to see them here.</div>';
        return;
    }

    const recentGames = [...games].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);

    container.innerHTML = recentGames.map(game => {
        const whitePlayer = getPlayerById(game.white);
        const blackPlayer = getPlayerById(game.black);

        let resultClass = 'draw';
        let resultText = '0.5-0.5';
        let ratingChange = game.whiteChange;

        if (game.result === '1-0') {
            resultClass = 'win';
            resultText = '1-0';
        } else if (game.result === '0-1') {
            resultClass = 'loss';
            resultText = '0-1';
        }

        return `
            <div class="game-item fade-in" >
                        <span class="game-result ${resultClass}">${resultText}</span>
                        <div class="game-players">
                            <span class="game-player">${whitePlayer.name}</span>
                            <span class="game-vs"> vs </span>
                            <span class="game-player">${blackPlayer.name}</span>
                        </div>
                        <span class="game-rating-change ${ratingChange >= 0 ? 'positive' : 'negative'}">${ratingChange >= 0 ? '+' : ''}${ratingChange}</span>
                        <span class="game-date">${game.date.slice(5)}</span>
                    </div >
            `;
    }).join('');
}

// ==================== LEADERBOARD ====================
function renderLeaderboard() {
    const tbody = document.getElementById('leaderboardBody');

    if (!players || players.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 40px; color: var(--text-secondary);">No players found. Add players to the database to see them here.</td></tr>';
        return;
    }

    // Filter out guest players
    const nonGuestPlayers = players.filter(p => p && !p.isGuest);
    const sorted = [...nonGuestPlayers].sort((a, b) => (b?.rating ?? 0) - (a?.rating ?? 0));
    const searchTerm = document.getElementById('leaderboardSearch')?.value?.toLowerCase() || '';
    const filtered = sorted.filter(p => p && (searchTerm === '' || (p.name && p.name.toLowerCase().includes(searchTerm))));

    tbody.innerHTML = filtered.map((player, idx) => {
        if (!player) return '';
        const title = getTitle(player?.rating ?? 1600);
        const winRate = calculateWinRate(player);
        const perf = getPerformanceData(player);

        return `
            <div class="table-row fade-in" onclick="openPlayerDetail('${player?.id ?? ''}')" title="Tap for details">
                        <span class="rank-cell">${idx + 1}</span>
                        <div class="player-cell">
                            <span class="title-badge ${title.class}">${title.title}</span>
                            <span class="player-name">${player?.name ?? 'Unknown'}</span>
                        </div>
                        <div class="perf-indicator">
                            ${perf.state === 'new'
                ? `<span class="perf-new">${perf.label}</span>`
                : `<span class="perf-icon ${perf.class}">${perf.icon}</span>`}
                        </div>
                        <span class="rating-cell">${player?.rating ?? 1600}</span>
                        <span class="mobile-hide">${player?.peakRating ?? 1600}</span>
                        <span class="mobile-hide">${player?.games ?? 0}</span>
                        <span>${player?.wins ?? 0}-${player?.draws ?? 0}-${player?.losses ?? 0}</span>
                        <span>${winRate}%</span>
                        <span class="status-badge mobile-hide ${player?.status ?? 'active'}">${player?.status ?? 'active'}</span>
            </div>
            `;
    }).join('');
}

// ==================== PLAYERS ====================
function renderPlayers() {
    const grid = document.getElementById('playersGrid');

    if (!players || players.length === 0) {
        grid.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-secondary);">No players found. Add players to the database to see them here.</div>';
        return;
    }

    // Filter out guest players
    const nonGuestPlayers = players.filter(p => p && !p.isGuest);

    grid.innerHTML = nonGuestPlayers.map(player => {
        if (!player) return '';
        const title = getTitle(player?.rating ?? 1600);
        const winRate = calculateWinRate(player);

        return `
            <div class="player-card fade-in" onclick = "openPlayerDetail('${player?.id ?? ''}')" >
                        <div class="player-card-header">
                            <div class="player-card-avatar">${getInitials(player?.name ?? 'Unknown')}</div>
                            <div class="player-card-info">
                                <h3>${player?.name ?? 'Unknown'}</h3>
                                <span class="player-card-status ${player?.status ?? 'active'}">${player?.status ?? 'Active'}</span>
                                <span class="title-badge ${title.class}">${title.title}</span>
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
                        <div class="player-card-rating">
                            <span class="player-card-rating-label">Current Rating</span>
                            <span class="player-card-rating-value">${player?.rating ?? 1600}</span>
                        </div>
                    </div >
            `;
    }).join('');
}

function openPlayerDetail(playerId) {
    const player = getPlayerById(playerId);
    if (!player) return;

    const title = getTitle(player.rating);
    const winRate = calculateWinRate(player);
    const perf = getPerformanceData(player);

    // Calculate head-to-head records
    const h2h = calculateHeadToHead(playerId);

    const content = document.getElementById('playerDetailContent');
    content.innerHTML = `
            <div class="player-detail-header" >
                    <div class="player-detail-avatar">${getInitials(player.name)}</div>
                    <div class="player-detail-info">
                        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 4px;">
                            <h2 style="margin: 0;">${player.name}</h2>
                            <span class="player-card-status ${player.status}">${player.status}</span>
                            <div class="perf-indicator" style="transform: scale(1.2);">
                                ${perf.state === 'new'
            ? `<span class="perf-new">${perf.label}</span>`
            : `<span class="perf-icon ${perf.class}">${perf.icon}</span>`}
                            </div>
                        </div>
                        <span class="title-badge ${title.class}">${title.title}</span>
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
    setTimeout(() => renderRatingChart(player.ratingHistory), 100);

    document.getElementById('playerDetailModal').classList.add('active');
}

function calculateHeadToHead(playerId) {
    const h2h = {};

    games.forEach(game => {
        let opponentId = null;
        let result = null;

        if (game.white === playerId) {
            opponentId = game.black;
            if (game.result === '1-0') result = 'win';
            else if (game.result === '0-1') result = 'loss';
            else result = 'draw';
        } else if (game.black === playerId) {
            opponentId = game.white;
            if (game.result === '0-1') result = 'win';
            else if (game.result === '1-0') result = 'loss';
            else result = 'draw';
        }

        if (opponentId) {
            if (!h2h[opponentId]) {
                h2h[opponentId] = { name: getPlayerById(opponentId).name, wins: 0, draws: 0, losses: 0 };
            }
            h2h[opponentId][result === 'win' ? 'wins' : result === 'loss' ? 'losses' : 'draws']++;
        }
    });

    return Object.values(h2h).sort((a, b) => (b.wins + b.draws * 0.5) - (a.wins + a.draws * 0.5));
}

function renderRatingChart(history) {
    const ctx = document.getElementById('ratingChart');
    if (!ctx) return;

    if (playerDetailChart) {
        playerDetailChart.destroy();
    }

    playerDetailChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: history.map((_, i) => `Game ${i + 1} `),
            datasets: [{
                label: 'Rating',
                data: history,
                borderColor: '#F0A500',
                backgroundColor: 'rgba(240, 165, 0, 0.1)',
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#F0A500',
                pointBorderColor: '#0D1117',
                pointBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(48, 54, 61, 0.5)' },
                    ticks: { color: '#8B949E' }
                },
                y: {
                    grid: { color: 'rgba(48, 54, 61, 0.5)' },
                    ticks: { color: '#8B949E' }
                }
            }
        }
    });
}

function closePlayerDetailModal() {
    document.getElementById('playerDetailModal').classList.remove('active');
}

// ==================== GAMES LOG ====================
function formatResult(result) {
    if (result === '0.5-0.5') return '0.5-0.5';
    return result;
}

function renderGamesLog() {
    const container = document.getElementById('gamesLogBody');

    if (!games || games.length === 0) {
        container.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--text-secondary);">No games found. Add games to the database to see them here.</td></tr>';
        return;
    }

    const tournamentFilter = document.getElementById('tournamentFilter').value;

    let filtered = [...games].sort((a, b) => new Date(b.date) - new Date(a.date));

    if (tournamentFilter) {
        filtered = filtered.filter(g => g.tournament === tournamentFilter);
    }

    const tbody = document.getElementById('gamesBody');
    tbody.innerHTML = filtered.map((game, idx) => {
        const whitePlayer = getPlayerById(game.white);
        const blackPlayer = getPlayerById(game.black);

        let resultClass = 'draw';
        if (game.result === '1-0') resultClass = 'white-win';
        if (game.result === '0-1') resultClass = 'black-win';

        return `
            <div class="table-row fade-in" onclick = "openGameDetail('${game?.id ?? ''}')" style = "cursor: pointer;" >
                        <span class="mobile-hide">${idx + 1}</span>
                        <span>${game.date}</span>
                        <span>${whitePlayer.name}</span>
                        <div style="display: flex; justify-content: center;">
                            <span class="result-badge ${resultClass}">${formatResult(game.result)}</span>
                        </div>
                        <span>${blackPlayer.name}</span>
                        <span class="single-line-text mobile-hide">${game.tournament || '-'}</span>
                        <span class="rating-change ${game.whiteChange >= 0 ? 'positive' : 'negative'} mobile-hide">${game.whiteChange >= 0 ? '+' : ''}${game.whiteChange}</span>
                        <span class="rating-change ${game.blackChange >= 0 ? 'positive' : 'negative'} mobile-hide">${game.blackChange >= 0 ? '+' : ''}${game.blackChange}</span>
            </div>
            `;
    }).join('');
}

function openGameDetail(gameId) {
    const game = games.find(g => g.id == gameId);
    if (!game) return;

    const whitePlayer = getPlayerById(game.white);
    const blackPlayer = getPlayerById(game.black);
    const content = document.getElementById('gameDetailContent');

    content.innerHTML = `
            <div style = "padding: 20px 0;" >
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; background: var(--bg-tertiary); padding: 16px; border-radius: 12px; border: 1px solid var(--border-color);">
                        <div style="text-align: center; flex: 1;">
                            <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">WHITE</div>
                            <div style="font-weight: 700; color: var(--text-primary); font-size: 16px;">${whitePlayer.name}</div>
                            <div style="font-size: 14px; color: var(--accent-gold);">${whitePlayer.rating}</div>
                        </div>
                        <div style="font-size: 24px; font-weight: 800; color: var(--text-muted); padding: 0 20px;">VS</div>
                        <div style="text-align: center; flex: 1;">
                            <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">BLACK</div>
                            <div style="font-weight: 700; color: var(--text-primary); font-size: 16px;">${blackPlayer.name}</div>
                            <div style="font-size: 14px; color: var(--accent-gold);">${blackPlayer.rating}</div>
                        </div>
                    </div>

                    <div style="text-align: center; margin-bottom: 24px;">
                        <div style="font-size: 14px; color: var(--text-secondary); margin-bottom: 4px;">RESULT</div>
                        <div style="font-size: 32px; font-weight: 800; color: var(--accent-gold);">${game.result}</div>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                        <div style="background: var(--bg-tertiary); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color);">
                            <div style="font-size: 12px; color: var(--text-secondary);">Date</div>
                            <div style="font-size: 14px; color: var(--text-primary);">${game.date}</div>
                        </div>
                        <div style="background: var(--bg-tertiary); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color);">
                            <div style="font-size: 12px; color: var(--text-secondary);">Tournament</div>
                            <div style="font-size: 14px; color: var(--text-primary);">${game.tournament || 'Casual Match'}</div>
                        </div>
                        <div style="background: var(--bg-tertiary); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color);">
                            <div style="font-size: 12px; color: var(--text-secondary);">White Î”</div>
                            <div style="font-size: 14px; color: ${game.whiteChange >= 0 ? 'var(--green)' : 'var(--danger)'}; font-weight: 600;">
                                ${game.whiteChange >= 0 ? '+' : ''}${game.whiteChange}
                            </div>
                        </div>
                        <div style="background: var(--bg-tertiary); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color);">
                            <div style="font-size: 12px; color: var(--text-secondary);">Black Î”</div>
                            <div style="font-size: 14px; color: ${game.blackChange >= 0 ? 'var(--green)' : 'var(--danger)'}; font-weight: 600;">
                                ${game.blackChange >= 0 ? '+' : ''}${game.blackChange}
                            </div>
                        </div>
                    </div>
                </div >
            `;

    document.getElementById('gameDetailModal').classList.add('active');
}

function closeGameDetailModal() {
    document.getElementById('gameDetailModal').classList.remove('active');
}

function populateTournamentFilter() {
    const select = document.getElementById('tournamentFilter');
    const tournaments = [...new Set(games.map(g => g.tournament).filter(t => t))];
    select.innerHTML = '<option value="">All Tournaments</option>' +
        tournaments.map(t => `<option value = "${t}" > ${t}</option > `).join('');
}

function populatePlayerSelects() {
    const whiteSelect = document.getElementById('whitePlayer');
    const blackSelect = document.getElementById('blackPlayer');
    const options = players.map(p => `<option value = "${p.id}" > ${p.name} (${p.rating})</option > `).join('');
    whiteSelect.innerHTML = `<option value = "" > Select White Player</option > ${options} `;
    blackSelect.innerHTML = `<option value = "" > Select Black Player</option > ${options} `;
}

function openAddGameModal() {
    populatePlayerSelects();
    populateTournamentFilter();
    document.getElementById('addGameModal').classList.add('active');
}

function closeAddGameModal() {
    document.getElementById('addGameModal').classList.remove('active');
}

async function submitGame(event) {
    event.preventDefault();

    const whiteId = document.getElementById('whitePlayer').value;
    const blackId = document.getElementById('blackPlayer').value;
    const result = document.getElementById('gameResult').value;
    const date = document.getElementById('gameDate').value;
    const tournament = document.getElementById('gameTournament').value;

    if (!whiteId || !blackId) {
        alert('Please select both players!');
        return;
    }

    if (whiteId === blackId) {
        alert('White and Black players must be different!');
        return;
    }

    const whitePlayer = getPlayerById(whiteId);
    const blackPlayer = getPlayerById(blackId);

    // Calculate rating changes
    let whiteScore, blackScore;
    if (result === '1-0') {
        whiteScore = 1;
        blackScore = 0;
    } else if (result === '0-1') {
        whiteScore = 0;
        blackScore = 1;
    } else {
        whiteScore = 0.5;
        blackScore = 0.5;
    }

    const whiteK = whitePlayer.games < 15 ? 40 : 20;
    const blackK = blackPlayer.games < 15 ? 40 : 20;

    const whiteExpected = 1 / (1 + Math.pow(10, (blackPlayer.rating - whitePlayer.rating) / 400));
    const blackExpected = 1 / (1 + Math.pow(10, (whitePlayer.rating - blackPlayer.rating) / 400));

    const whiteChange = Math.round(whiteK * (whiteScore - whiteExpected));
    const blackChange = Math.round(blackK * (blackScore - blackExpected));

    // Create new game
    const newGame = {
        id: games.length + 1,
        date,
        white: whiteId,
        black: blackId,
        result,
        tournament,
        round: null,
        whiteChange,
        blackChange
    };

    // Confirmation popup
    const resultText = result === '1-0' ? 'White Wins' : result === '0-1' ? 'Black Wins' : 'Draw';
    const confirmMsg = `Confirm Game Result:\n\n${whitePlayer.name} (White) vs ${blackPlayer.name} (Black)\n\nResult: ${resultText}\n\nWhite Rating: ${whitePlayer.rating} â†’ ${whitePlayer.rating + whiteChange} (${whiteChange >= 0 ? '+' : ''}${whiteChange})\nBlack Rating: ${blackPlayer.rating} â†’ ${blackPlayer.rating + blackChange} (${blackChange >= 0 ? '+' : ''}${blackChange})\n\nThis cannot be undone. Continue?`;

    // Close the add game form and show confirmation modal
    document.getElementById('addGameModal').classList.remove('active');
    showGameConfirmModal(whitePlayer, blackPlayer, result, whiteChange, blackChange, whiteScore, blackScore);
    return;
}

function showGameConfirmModal(whitePlayer, blackPlayer, result, whiteChange, blackChange, whiteScore, blackScore) {
    const modal = document.getElementById('gameConfirmModal');
    const whiteNameEl = document.getElementById('confirmWhiteName');
    const blackNameEl = document.getElementById('confirmBlackName');
    const resultScoreEl = document.getElementById('confirmResult');
    const resultOutcomeEl = document.getElementById('confirmOutcome');

    // Format result score
    let scoreDisplay, outcomeText;
    if (result === '1-0') {
        scoreDisplay = '1 : 0';
        outcomeText = 'White Wins';
    } else if (result === '0-1') {
        scoreDisplay = '0 : 1';
        outcomeText = 'Black Wins';
    } else {
        scoreDisplay = '0.5 : 0.5';
        outcomeText = 'Draw';
    }

    whiteNameEl.textContent = whitePlayer.name + ' (White)';
    blackNameEl.textContent = blackPlayer.name + ' (Black)';
    resultScoreEl.textContent = scoreDisplay;
    resultOutcomeEl.textContent = outcomeText;

    // Add color classes based on result
    whiteNameEl.className = 'player-name';
    blackNameEl.className = 'player-name';
    if (result === '1-0') {
        whiteNameEl.classList.add('white-name');
    } else if (result === '0-1') {
        blackNameEl.classList.add('black-name');
    }

    // Store game data for confirmation
    modal.dataset.whiteId = whitePlayer.id;
    modal.dataset.blackId = blackPlayer.id;
    modal.dataset.result = result;
    modal.dataset.whiteChange = whiteChange;
    modal.dataset.blackChange = blackChange;
    modal.dataset.whiteScore = whiteScore;
    modal.dataset.blackScore = blackScore;

    modal.classList.add('active');
}

function cancelGameConfirm() {
    document.getElementById('gameConfirmModal').classList.remove('active');
    document.getElementById('addGameModal').classList.add('active');
}

async function confirmGameSubmit() {
    const modal = document.getElementById('gameConfirmModal');
    const whiteId = modal.dataset.whiteId;
    const blackId = modal.dataset.blackId;
    const result = modal.dataset.result;
    const whiteChange = parseInt(modal.dataset.whiteChange);
    const blackChange = parseInt(modal.dataset.blackChange);
    const whiteScore = parseFloat(modal.dataset.whiteScore);
    const blackScore = parseFloat(modal.dataset.blackScore);

    const btn = document.getElementById('confirmGameSubmitBtn');
    const originalText = btn ? btn.textContent : 'Confirm';

    // Get form values
    const date = document.getElementById('gameDate').value;
    const tournament = document.getElementById('gameTournament').value;

    try {
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Saving...';
        }

        // Create game object for local state
        const newGame = {
            id: games.length + 1,
            date,
            white: whiteId,
            black: blackId,
            result,
            tournament,
            round: null,
            whiteChange,
            blackChange
        };

        // Update players
        const whiteIdx = players.findIndex(p => p.id === whiteId);
        const blackIdx = players.findIndex(p => p.id === blackId);

        players[whiteIdx].rating += whiteChange;
        players[blackIdx].rating += blackChange;
        players[whiteIdx].games++;
        players[blackIdx].games++;

        if (result === '1-0') {
            players[whiteIdx].wins++;
            players[blackIdx].losses++;
        } else if (result === '0-1') {
            players[whiteIdx].losses++;
            players[blackIdx].wins++;
        } else {
            players[whiteIdx].draws++;
            players[blackIdx].draws++;
        }

        // Update peak ratings
        if (players[whiteIdx].rating > players[whiteIdx].peakRating) {
            players[whiteIdx].peakRating = players[whiteIdx].rating;
        }
        if (players[blackIdx].rating > players[blackIdx].peakRating) {
            players[blackIdx].peakRating = players[blackIdx].rating;
        }

        // Add rating to history
        players[whiteIdx].ratingHistory.push(players[whiteIdx].rating);
        players[blackIdx].ratingHistory.push(players[blackIdx].rating);

        // Add game to log
        games.push(newGame);

        // Sync with database
        const updatedWhitePlayer = players[whiteIdx];
        const updatedBlackPlayer = players[blackIdx];

        const savedGame = await api.saveGameResult({
            date: newGame.date,
            white_player_id: whiteId,
            black_player_id: blackId,
            result: newGame.result,
            tournament_name: newGame.tournament || 'Casual',
            round_number: 0,
            white_rating_before: updatedWhitePlayer.rating - newGame.whiteChange,
            black_rating_before: updatedBlackPlayer.rating - newGame.blackChange,
            white_rating_after: updatedWhitePlayer.rating,
            black_rating_after: updatedBlackPlayer.rating,
            white_rating_change: newGame.whiteChange,
            black_rating_change: newGame.blackChange,
            white_player_name: updatedWhitePlayer.name,
            black_player_name: updatedBlackPlayer.name
        });

        if (savedGame) {
            newGame.id = savedGame.id;
        }

        // Update player ratings in DB
        await Promise.all([
            api.updatePlayerStats(updatedWhitePlayer),
            api.updatePlayerStats(updatedBlackPlayer)
        ]);

    } catch (e) {
        console.error("Error saving game:", e);
        showToast("Error saving game. Please check console.", 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }

    modal.classList.remove('active');
    closeAddGameModal();
    renderDashboard();
    renderLeaderboard();
    renderPlayers();
    renderGamesLog();

    // Show success with animation
    const whiteChangeEl = document.querySelector(`[data-player="${whiteId}"]`);
    if (whiteChangeEl) {
        whiteChangeEl.classList.add('rating-animate');
        setTimeout(() => whiteChangeEl.classList.remove('rating-animate'), 300);
    }
}

// ==================== TOURNAMENT MANAGER ====================
let currentTournament = null;
let selectedPlayers = [];
let currentTournamentTab = 'overview';

// Extended tournament data structure
const extendedTournaments = [];

// Initialize extended tournaments - now handled in DOMContentLoaded
function initializeTournaments() {
    // Tournaments are loaded during initialization via api.fetchTournaments()
    // No action needed here - data is populated in the main initialization
}

function renderTournaments() {
    const grid = document.getElementById('tournamentsGrid');

    // Ensure extendedTournaments is properly populated
    if (!extendedTournaments || extendedTournaments.length === 0) {
        // Show empty state but still show the header and create button
        grid.innerHTML = '';
    }

    // Get filter values
    const statusFilter = document.getElementById('tournamentStatusFilter')?.value || '';
    const formatFilter = document.getElementById('tournamentFormatFilter')?.value || '';

    // Filter tournaments based on selected filters
    let filteredTournaments = extendedTournaments;

    if (statusFilter) {
        filteredTournaments = filteredTournaments.filter(t =>
            t.status?.toLowerCase() === statusFilter.toLowerCase()
        );
    }

    if (formatFilter) {
        filteredTournaments = filteredTournaments.filter(t =>
            t.format?.toLowerCase() === formatFilter.toLowerCase()
        );
    }

    const active = filteredTournaments.filter(t => t.status?.toLowerCase() === 'active');
    const completed = filteredTournaments.filter(t => t.status?.toLowerCase() === 'completed');
    const draft = filteredTournaments.filter(t => t.status?.toLowerCase() === 'draft');

    // Clear the grid first effectively
    grid.innerHTML = '';
    grid.className = 'page-content'; // Restore padding and remove tournaments-grid if present

    let html = '';

    // Header Section
    html += `
            <div class="tournament-header-actions" style = "margin-bottom: 30px;" >
                    <h2 style="font-size: 20px; font-weight: 600;">Manage Tournaments</h2>
                    <button class="btn-primary" onclick="openCreateTournamentModal()">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 5v14m-7-7h14"></path>
                </svg>
                New Tournament
            </button>
                </div >
            `;

    if (extendedTournaments.length === 0) {
        html += `
            <div style = "text-align: center; padding: 60px 20px; color: var(--text-secondary);" >
                        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 16px; opacity: 0.5;">
                            <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path>
                            <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path>
                            <path d="M4 22h16"></path>
                            <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"></path>
                            <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"></path>
                            <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"></path>
                        </svg>
                        <p>No tournaments yet. Create your first tournament!</p>
                    </div >
            `;
    } else {
        if (draft.length > 0) {
            html += `<h3 style = "margin: 30px 0 15px; color: var(--grey); font-size: 18px;" > Upcoming (Drafts)</h3 > `;
            html += `<div class="tournaments-grid" > ${draft.map(renderTournamentCard).join('')}</div > `;
        }

        if (active.length > 0) {
            html += `<h3 style = "margin: 30px 0 15px; color: var(--success); font-size: 18px;" > Ongoing (Active)</h3 > `;
            html += `<div class="tournaments-grid" > ${active.map(renderTournamentCard).join('')}</div > `;
        }

        if (completed.length > 0) {
            html += `<h3 style = "margin: 30px 0 15px; color: var(--blue); font-size: 18px;" > Completed</h3 > `;
            html += `<div class="tournaments-grid" > ${completed.map(renderTournamentCard).join('')}</div > `;
        }
    }

    grid.innerHTML = `<div class="section-container" > ${html}</div > `;
}

function renderTournamentCard(tournament) {
    if (!tournament) return '';
    const statusClass = tournament.status || 'draft';
    const statusLabel = statusClass.charAt(0).toUpperCase() + statusClass.slice(1);
    const playerCount = tournament.players ? tournament.players.length : 0;
    const roundsPlayed = tournament.pairings ? Math.max(...tournament.pairings.map(p => p.round || 0), 0) : 0;

    let progress = '';
    if (tournament.status === 'active') {
        progress = `<div class="tournament-stat" ><span class="tournament-stat-value">${roundsPlayed}/${tournament.rounds}</span><span class="tournament-stat-label">Rounds</span></div > `;
    } else if (tournament.status === 'completed') {
        const sortedPlayers = (tournament.players || []).sort((a, b) => b.points - a.points);
        const winner = sortedPlayers[0] || null;
        progress = winner ? `<div class="tournament-stat"><span class="tournament-stat-value" style="color: var(--accent-gold);">🏆 ${winner.name.split(' ')[0]}</span><span class="tournament-stat-label">Winner</span></div>` : '';
    }

    return `
            <div class="tournament-card fade-in" onclick = "${(tournament.status || 'draft').toLowerCase() === 'draft' ? `editTournament('${tournament?.id ?? ''}')` : `openTournamentDetail('${tournament?.id ?? ''}')`}" style = "cursor: pointer;" >
                    <div class="tournament-header">
                        <div style="display: flex; justify-content: space-between; align-items: start;">
                            <h3 class="tournament-name">${tournament.name}</h3>
                            <span class="tournament-status-badge ${statusClass}">${statusLabel}</span>
                        </div>
                        <div class="tournament-date">${new Date(tournament.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
                    </div>
                    <div class="tournament-stats">
                        <div class="tournament-stat">
                            <span class="tournament-stat-value">${playerCount}</span>
                            <span class="tournament-stat-label">Players</span>
                        </div>
                        <div class="tournament-stat">
                            <span class="tournament-stat-value">${tournament.rounds}</span>
                            <span class="tournament-stat-label">Rounds</span>
                        </div>
                        ${progress}
                    </div>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: space-between; align-items: center;">
                        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                            <span style="padding: 4px 8px; background: var(--bg-tertiary); border-radius: 4px; font-size: 12px;">${tournament.format === 'swiss' ? 'Swiss' : tournament.format === 'roundrobin' ? 'Round Robin' : 'Knockout'}</span>
                            <span style="padding: 4px 8px; background: var(--bg-tertiary); border-radius: 4px; font-size: 12px;">${tournament.timeControl}</span>
                        </div>
                        ${tournament.status?.toLowerCase() !== 'completed' ? `
                            <div class="tournament-actions" onclick="event.stopPropagation()">
                                ${roundsPlayed === 0 ? `
                                <button class="btn-action-sm edit" onclick="editTournament('${tournament?.id ?? ''}')">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                    Edit
                                </button>
                                ` : ''}
                                <button class="btn-action-sm delete" onclick="deleteTournament('${tournament?.id ?? ''}')">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                    ${tournament.status?.toLowerCase() === 'active' ? 'Terminate' : 'Delete'}
                                </button>
                            </div>
                        ` : ''}
                    </div>
                </div >
            `;
}

// Modal functions
function openCreateTournamentModal() {
    document.getElementById('editTournamentId').value = '';
    document.getElementById('tournamentSubmitBtn').textContent = 'Select Players';
    document.getElementById('tournamentDate').valueAsDate = new Date();
    document.getElementById('createTournamentModal').classList.add('active');
}

function closeCreateTournamentModal() {
    document.getElementById('createTournamentModal').classList.remove('active');
    document.getElementById('createTournamentForm').reset();
    document.getElementById('editTournamentId').value = '';
}

// Store players for start tournament preview
let pendingStartTournamentPlayers = [];

function showTournamentStartPreview() {
    if (!currentTournament) return;

    // Auto-save selected players to pending list
    pendingStartTournamentPlayers = selectedPlayers.map(id => {
        const p = players.find(player => player.id === id);
        return {
            id: p.id,
            name: p.name,
            rating: p.rating || p.bodija_rating,
            isGuest: p.isGuest || p.is_guest
        };
    });

    // Gather form data for preview
    const name = currentTournament.name;
    const date = currentTournament.date;
    const timeControl = currentTournament.timeControl;
    const format = currentTournament.format;
    const rounds = currentTournament.rounds;

    // Format the display values
    const formatDisplay = format === 'swiss' ? 'Swiss System' : format === 'roundrobin' ? 'Round Robin' : 'Knockout';

    // Update preview modal content
    const nameEl = document.getElementById('startPreviewTournamentName');
    const dateEl = document.getElementById('startPreviewTournamentDate');
    const tcEl = document.getElementById('startPreviewTournamentTimeControl');
    const formatEl = document.getElementById('startPreviewTournamentFormat');
    const roundsEl = document.getElementById('startPreviewTournamentRounds');
    const countEl = document.getElementById('startPreviewPlayerCount');
    const listEl = document.getElementById('startPreviewPlayersList');

    if (nameEl) nameEl.textContent = name;
    if (dateEl) dateEl.textContent = new Date(date).toLocaleDateString();
    if (tcEl) tcEl.textContent = timeControl;
    if (formatEl) formatEl.textContent = formatDisplay;
    if (roundsEl) roundsEl.textContent = rounds || 'Auto';
    if (countEl) countEl.textContent = pendingStartTournamentPlayers.length;

    if (listEl) {
        listEl.innerHTML = pendingStartTournamentPlayers.map(p => `
            <div style="padding: 6px 10px; background: var(--bg-tertiary); border-radius: 4px; font-size: 13px; display: flex; justify-content: space-between; align-items: center;">
                <span>${p.name}</span>
                <div style="display: flex; align-items: center; gap: 6px;">
                    ${p.isGuest ? '<span style="font-size: 10px; padding: 2px 4px; background: var(--grey); color: white; border-radius: 3px;">GUEST</span>' : ''}
                    <span style="color: var(--text-secondary); font-size: 11px;">${p.rating}</span>
                </div>
            </div>
        `).join('');
    }

    // Close player selection modal and show preview modal
    document.getElementById('playerSelectionModal').classList.remove('active');
    document.getElementById('tournamentStartPreviewModal').classList.add('active');
}

function closeTournamentStartPreviewModal(goBack = false) {
    document.getElementById('tournamentStartPreviewModal').classList.remove('active');
    if (goBack) {
        // Reopen player selection modal
        document.getElementById('playerSelectionModal').classList.add('active');
    } else {
        pendingStartTournamentPlayers = [];
    }
}

async function confirmStartTournament() {
    if (!currentTournament || pendingStartTournamentPlayers.length === 0) return;

    const tournamentId = currentTournament.id;
    const btn = document.getElementById('confirmStartTournamentBtn');
    const originalText = btn ? btn.textContent : 'Confirm & Start';

    try {
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Starting...';
        }
        // 1. Fetch fresh tournament data to ensure it still exists and is in correct state
        const freshTournament = await api.fetchTournamentById(tournamentId);
        if (!freshTournament) {
            throw new Error("Tournament not found in database.");
        }

        // Add selected players to tournament local structure
        currentTournament.players = pendingStartTournamentPlayers.map(p => {
            return {
                id: p.id,
                name: p.name,
                rating: p.rating,
                points: 0,
                wins: 0,
                draws: 0,
                losses: 0,
                byes: 0,
                rating_at_start: p.rating,
                rating_change: 0,
                buchholz: 0
            };
        });

        // Calculate rounds
        if (currentTournament.format === 'knockout') {
            currentTournament.rounds = Math.ceil(Math.log2(currentTournament.players.length));
        } else if (currentTournament.format === 'roundrobin') {
            currentTournament.rounds = currentTournament.players.length - 1;
        }

        // Set status to active locally
        currentTournament.status = 'Active';
        currentTournament.current_round = 1;

        // Generate pairings for Round 1 locally
        generatePairings();

        // 2. Sync to DB - Order matters for referential integrity

        // A. Update tournament status and current round
        await api.updateTournamentStatus(tournamentId, 'Active', 1);

        // B. Add players to tournament_players table (using upsert)
        await api.addTournamentPlayers(tournamentId, currentTournament.players);

        // C. Create Round 1 in rounds table
        const roundData = await api.createRound({
            tournament_id: tournamentId,
            round_number: 1,
            status: 'Pending'
        });

        if (!roundData) {
            throw new Error("Failed to create Round 1 record.");
        }

        // D. Add pairings to pairings table
        const pairingsWithRoundId = currentTournament.pairings.map(p => ({
            ...p,
            round_id: roundData.id,
            tournament_id: tournamentId
        }));
        await api.addRoundPairings(tournamentId, pairingsWithRoundId);

        // 3. UI Finalization
        closeTournamentStartPreviewModal();
        closePlayerSelectionModal();

        // Navigate to pairings tab
        currentTournamentTab = 'pairings';
        renderTournamentDetail();
        showToast('Tournament started successfully!', 'success');

    } catch (e) {
        console.error("Tournament Start Flow Failed:", e);
        showToast(`Failed to start tournament: ${e.message || "Database error"}`, 'error');
        // Do NOT reload or nullify if possible, or handle gracefully
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }
}

function updateRoundsInput() {
    const format = document.getElementById('tournamentFormat').value;
    const roundsInput = document.getElementById('tournamentRounds');
    if (format === 'knockout') {
        roundsInput.value = '';
        roundsInput.placeholder = 'Auto';
        roundsInput.disabled = true;
    } else if (format === 'roundrobin') {
        roundsInput.value = '';
        roundsInput.placeholder = 'Auto';
        roundsInput.disabled = true;
    } else {
        roundsInput.value = 5;
        roundsInput.disabled = false;
        roundsInput.placeholder = '';
    }
}

async function submitTournament(e) {
    e.preventDefault();
    const editId = document.getElementById('editTournamentId').value;
    const name = document.getElementById('tournamentName').value;
    const date = document.getElementById('tournamentDate').value;
    const format = document.getElementById('tournamentFormat').value;
    const timeControl = document.getElementById('tournamentTimeControl').value;
    let rounds = parseInt(document.getElementById('tournamentRounds').value) || 5;

    const btn = document.getElementById('submitTournamentBtn');
    const originalText = btn ? btn.textContent : (editId ? 'Save' : 'Create');

    try {
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Saving...';
        }

        // Calculate rounds for round robin and knockout
        if (format === 'roundrobin' || format === 'knockout') {
            rounds = 0; // Calculated during player selection
        }

        if (editId) {
            // Update existing
            const idx = extendedTournaments.findIndex(t => t.id == editId);
            if (idx > -1) {
                extendedTournaments[idx] = {
                    ...extendedTournaments[idx],
                    name,
                    date,
                    format,
                    timeControl,
                    rounds
                };

                await api.updateTournament(editId, {
                    name,
                    date,
                    format,
                    time_control: timeControl,
                    total_rounds: rounds
                });
            }
            // Open player selection for edited tournaments too
            setTimeout(() => openPlayerSelection(editId), 300);
        } else {
            // Check if we already have a draft tournament with these details to avoid duplicates
            const existingDraft = extendedTournaments.find(t =>
                t.status?.toLowerCase() === 'draft' &&
                t.name === name &&
                t.date === date
            );

            if (existingDraft) {
                setTimeout(() => openPlayerSelection(existingDraft.id), 300);
            } else {
                // Create new tournament as draft
                const newTournament = {
                    id: Date.now(),
                    name,
                    date,
                    format,
                    timeControl,
                    rounds,
                    status: 'Draft',
                    current_round: 0,
                    players: [],
                    pairings: [],
                    standings: [],
                    results: []
                };
                extendedTournaments.unshift(newTournament);

                const dbTourney = await api.createTournament({
                    name,
                    date,
                    format,
                    timeControl,
                    rounds,
                    status: 'Draft',
                    current_round: 0
                });

                if (dbTourney) {
                    newTournament.id = dbTourney.id; // Sync local ID with DB
                }

                // Open player selection only for new tournaments
                setTimeout(() => openPlayerSelection(newTournament.id), 300);
            }
        }
    } catch (error) {
        console.error("Tournament submission error:", error);
        showToast("Failed to save tournament. Check console.", 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }

    closeCreateTournamentModal();
    renderTournaments();
}

function editTournament(id) {
    const tournament = extendedTournaments.find(t => t.id === id);
    if (!tournament) return;

    if (tournament.status?.toLowerCase() === 'draft') {
        openPlayerSelection(id);
        return;
    }

    document.getElementById('editTournamentId').value = tournament.id;
    document.getElementById('tournamentName').value = tournament.name;
    document.getElementById('tournamentDate').value = tournament.date;
    document.getElementById('tournamentFormat').value = tournament.format;
    document.getElementById('tournamentTimeControl').value = tournament.timeControl;
    document.getElementById('tournamentRounds').value = tournament.rounds;
    document.getElementById('tournamentSubmitBtn').textContent = 'Save Changes';

    updateRoundsInput();
    document.getElementById('createTournamentModal').classList.add('active');
}

async function deleteTournament(id) {
    const tournament = extendedTournaments.find(t => t.id === id);
    if (!tournament) return;

    if (tournament.status?.toLowerCase() === 'active') {
        if (confirm('This tournament is currently ACTIVE. Terminating it will DELETE all games played in this tournament, RESET all players to their ratings before the tournament started, and DELETE the tournament record. Are you sure you want to proceed?')) {
            try {
                await api.terminateTournament(id);
                const idx = extendedTournaments.findIndex(t => t.id === id);
                if (idx > -1) {
                    extendedTournaments.splice(idx, 1);
                    renderTournaments();
                }
                showToast('Tournament terminated and ratings reset', 'success');
                window.location.reload(); // Reload to refresh all player ratings in UI
            } catch (error) {
                console.error("Failed to terminate tournament:", error);
                alert("Failed to terminate tournament from database.");
            }
        }
        return;
    }

    if (confirm('Are you sure you want to delete this tournament?')) {
        try {
            await api.deleteTournament(id);
            const idx = extendedTournaments.findIndex(t => t.id === id);
            if (idx > -1) {
                extendedTournaments.splice(idx, 1);
                renderTournaments();
            }
        } catch (error) {
            console.error("Failed to delete tournament:", error);
            alert("Failed to delete tournament from database.");
        }
    }
}

function openPlayerSelection(tournamentId) {
    currentTournament = extendedTournaments.find(t => t.id === tournamentId);
    if (!currentTournament) {
        console.error("Tournament not found:", tournamentId);
        return;
    }
    selectedPlayers = currentTournament.players ? currentTournament.players.map(p => p.id) : [];
    renderPlayerSelection();
    document.getElementById('playerSelectionModal').classList.add('active');
}

function closePlayerSelectionModal() {
    document.getElementById('playerSelectionModal').classList.remove('active');
    // currentTournament = null; // Removed to preserve context for re-rendering detail view
    selectedPlayers = [];
}

function goBackToTournamentDetails() {
    if (!currentTournament) return;
    const tid = currentTournament.id;
    closePlayerSelectionModal();
    editTournament(tid);
}

function renderPlayerSelection() {
    const content = document.getElementById('playerSelectionContent');
    const minPlayers = currentTournament.format === 'knockout' ? 2 : 3;

    content.innerHTML = `
            <div style = "margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-start;" >
                    <div>
                        <h3 style="margin-bottom: 4px;">${currentTournament.name}</h3>
                        <p style="color: var(--text-secondary); font-size: 14px;">Select at least ${minPlayers} players to start the tournament</p>
                    </div>
                    <button class="btn-secondary" onclick="goBackToTournamentDetails()" style="padding: 6px 12px; font-size: 13px;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px; vertical-align: middle;"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                        Edit Details
                    </button>
                </div >

            <div class="inline-add-player">
                <input type="text" id="newPlayerName" placeholder="New player name">
                    <input type="number" id="newPlayerRating" placeholder="Rating (optional)" style="max-width: 120px;">
                        <button class="btn-secondary" onclick="addNewPlayer()">Add & Select</button>
                    </div>

                    <div class="search-box">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                        <input type="text" id="playerSearch" placeholder="Search players..." oninput="renderPlayerSelection()">
                    </div>

                    <div class="player-selection-grid" id="playerSelectionGrid">
                        ${renderPlayerCards()}
                    </div>

                    <div class="selection-summary">
                        <span class="selection-count"><span id="selectedCount">${selectedPlayers.length}</span> players selected</span>
                        <div style="display: flex; gap: 12px;">
                            <button class="btn-secondary" id="saveTournamentPlayersBtn" onclick="saveTournamentPlayers()">Save Changes</button>
                            <button class="btn-primary" id="startTournamentBtn" onclick="showTournamentStartPreview()" ${selectedPlayers.length < minPlayers ? 'disabled' : ''}>
                                Start Tournament
                            </button>
                        </div>
                    </div>
        `;
}

async function saveTournamentPlayers(silent = false) {
    if (!currentTournament) return;

    const btn = document.getElementById('saveTournamentPlayersBtn');
    const originalText = btn ? btn.textContent : 'Save Changes';

    // Sync to DB
    try {
        if (btn && !silent) {
            btn.disabled = true;
            btn.textContent = 'Saving...';
        }
        const playersToSave = selectedPlayers.map(id => {
            const p = players.find(player => player.id === id);
            return {
                id: p.id,
                name: p.name,
                rating: p.rating || p.bodija_rating,
                points: 0,
                wins: 0,
                draws: 0,
                losses: 0,
                byes: 0,
                buchholz: 0
            };
        });

        await api.addTournamentPlayers(currentTournament.id, playersToSave);

        // Update local state
        currentTournament.players = playersToSave;

        if (!silent) {
            showToast('Tournament players saved successfully!', 'success');
            closePlayerSelectionModal();
            renderTournaments();
        }
    } catch (e) {
        console.error("Supabase saveTournamentPlayers failed:", e);
        if (!silent) showToast("Failed to save players to database.", 'error');
        throw e;
    } finally {
        if (btn && !silent) {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }
}

function renderPlayerCards() {
    const search = document.getElementById('playerSearch')?.value?.toLowerCase() || '';
    const filteredPlayers = players.filter(p => p.name.toLowerCase().includes(search));

    return filteredPlayers.map(player => `
            <div class="player-select-card ${selectedPlayers.includes(player.id) ? 'selected' : ''}" onclick = "togglePlayer('${player?.id ?? ''}')" >
                <input type="checkbox" ${selectedPlayers.includes(player.id) ? 'checked' : ''} onclick="event.stopPropagation(); togglePlayer('${player?.id ?? ''}')">
                    <div class="player-select-info">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <div class="player-select-name">${player.name}</div>
                            ${player.isGuest || player.is_guest ? '<span class="badge-guest" style="background: var(--purple); color: white; font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 600;">GUEST</span>' : ''}
                        </div>
                        <div class="player-select-rating">Rating: ${player.rating || player.bodija_rating}</div>
                    </div>
                </div>
        `).join('');
}

function togglePlayer(playerId) {
    const idx = selectedPlayers.indexOf(playerId);
    if (idx > -1) {
        selectedPlayers.splice(idx, 1);
    } else {
        selectedPlayers.push(playerId);
    }
    renderPlayerSelection();
}

async function addNewPlayer() {
    const name = document.getElementById('newPlayerName').value.trim();
    const rating = parseInt(document.getElementById('newPlayerRating').value) || 1600;

    if (!name) return;

    try {
        const newPlayer = await api.createPlayer({
            name,
            rating,
            isGuest: true,
            status: 'Active'
        });

        if (newPlayer) {
            // Add to local players list
            players.push({
                id: newPlayer.id,
                name: newPlayer.name,
                rating: newPlayer.bodija_rating,
                isGuest: true
            });

            // Select the new player
            selectedPlayers.push(newPlayer.id);

            // Clear inputs and re-render
            document.getElementById('newPlayerName').value = '';
            document.getElementById('newPlayerRating').value = '';
            renderPlayerSelection();
        }
    } catch (error) {
        console.error("Error adding guest player:", error);
        alert("Failed to add guest player.");
    }
}

async function startTournament() {
    if (!currentTournament) return;

    const minPlayers = currentTournament.format === 'knockout' ? 2 : 3;
    if (selectedPlayers.length < minPlayers) return;

    // Add selected players to tournament
    currentTournament.players = selectedPlayers.map(id => {
        const player = players.find(p => p.id === id);
        return {
            id: player.id,
            name: player.name,
            rating: player.rating,
            points: 0,
            wins: 0,
            draws: 0,
            losses: 0,
            buchholz: 0,
            opponents: []
        };
    });

    // Calculate rounds
    if (currentTournament.format === 'knockout') {
        currentTournament.rounds = Math.ceil(Math.log2(currentTournament.players.length));
    } else if (currentTournament.format === 'roundrobin') {
        currentTournament.rounds = currentTournament.players.length - 1;
    }

    // Generate pairings
    generatePairings();

    // Set status to active
    currentTournament.status = 'active';

    // Sync to DB
    try {
        await api.updateTournamentStatus(currentTournament.id, 'active');
        await api.addTournamentPlayers(currentTournament.id, currentTournament.players);
        await api.addRoundPairings(currentTournament.id, currentTournament.pairings);
    } catch (e) {
        console.warn("Supabase startTournament failed, using local fallback");
    }

    closePlayerSelectionModal();
    renderTournaments();
    openTournamentDetail(currentTournament.id);
}

function generatePairings() {
    if (!currentTournament || !currentTournament.players || currentTournament.players.length === 0) return;

    const format = currentTournament.format?.toLowerCase();
    const players = [...currentTournament.players];
    let pairings = [];

    if (format === 'swiss') {
        pairings = generateSwissPairings(players, currentTournament.current_round || 1);
    } else if (format === 'roundrobin') {
        pairings = generateRoundRobinPairings(players, currentTournament.current_round || 1);
    } else if (format === 'knockout') {
        pairings = generateKnockoutPairings(players, currentTournament.current_round || 1);
    }

    currentTournament.pairings = pairings;
}

function generateSwissPairings(players, round) {
    // Sort players by points (primary) and rating (secondary)
    players.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        return b.rating - a.rating;
    });

    const pairings = [];
    const paired = new Set();

    // Handle Bye for odd number of players
    if (players.length % 2 !== 0) {
        // Lowest ranked player who hasn't had a bye yet gets the bye
        const byePlayer = players[players.length - 1];
        pairings.push({
            white: byePlayer.id,
            whiteName: byePlayer.name,
            black: null,
            blackName: 'BYE',
            result: '1-0',
            isBye: true,
            whiteRatingBefore: byePlayer.rating,
            blackRatingBefore: 0,
            round: round
        });
        paired.add(byePlayer.id);
    }

    for (let i = 0; i < players.length; i++) {
        const p1 = players[i];
        if (paired.has(p1.id)) continue;

        // Find best match for p1
        let p2 = null;
        for (let j = i + 1; j < players.length; j++) {
            const potentialP2 = players[j];
            if (!paired.has(potentialP2.id)) {
                p2 = potentialP2;
                break;
            }
        }

        if (p2) {
            pairings.push({
                white: p1.id,
                whiteName: p1.name,
                black: p2.id,
                blackName: p2.name,
                result: null,
                isBye: false,
                whiteRatingBefore: p1.rating,
                blackRatingBefore: p2.rating,
                round: round
            });
            paired.add(p1.id);
            paired.add(p2.id);
        }
    }

    return pairings;
}

function generateRoundRobinPairings(players, round) {
    const n = players.length;
    if (n < 2) return [];

    const playersList = [...players];
    if (n % 2 !== 0) {
        playersList.push({ id: null, name: 'BYE', rating: 0 });
    }

    const numPlayers = playersList.length;
    const numRounds = numPlayers - 1;
    const pairings = [];

    for (let r = 0; r < numRounds; r++) {
        for (let i = 0; i < numPlayers / 2; i++) {
            const p1 = playersList[i];
            const p2 = playersList[numPlayers - 1 - i];

            if (p1.id && p2.id) {
                const white = (r + i) % 2 === 0 ? p1 : p2;
                const black = (r + i) % 2 === 0 ? p2 : p1;
                pairings.push({
                    round: r + 1,
                    white: white.id,
                    whiteName: white.name,
                    black: black.id,
                    blackName: black.name,
                    result: null,
                    isBye: false,
                    whiteRatingBefore: white.rating,
                    blackRatingBefore: black.rating
                });
            } else if (p1.id || p2.id) {
                const player = p1.id ? p1 : p2;
                pairings.push({
                    round: r + 1,
                    white: player.id,
                    whiteName: player.name,
                    black: null,
                    blackName: 'BYE',
                    result: '1-0',
                    isBye: true,
                    whiteRatingBefore: player.rating,
                    blackRatingBefore: 0
                });
            }
        }
        // Rotate playersList except the first one
        playersList.splice(1, 0, playersList.pop());
    }

    return pairings;
}

function generateKnockoutPairings(players, round) {
    // Sort by rating for initial seeding
    if (round === 1) {
        players.sort((a, b) => b.rating - a.rating);
    }

    const pairings = [];
    for (let i = 0; i < players.length; i += 2) {
        const p1 = players[i];
        const p2 = players[i + 1];

        if (p2) {
            pairings.push({
                round: round,
                white: p1.id,
                whiteName: p1.name,
                black: p2.id,
                blackName: p2.name,
                result: null,
                isBye: false,
                whiteRatingBefore: p1.rating,
                blackRatingBefore: p2.rating
            });
        } else {
            pairings.push({
                round: round,
                white: p1.id,
                whiteName: p1.name,
                black: null,
                blackName: 'BYE',
                result: '1-0',
                isBye: true,
                whiteRatingBefore: p1.rating,
                blackRatingBefore: 0
            });
        }
    }
    return pairings;
}

// Remove the broken code block
const dummyVar = true;


async function openTournamentDetail(tournamentId) {
    currentTournament = extendedTournaments.find(t => t.id === tournamentId);
    if (!currentTournament) return;

    // Fetch fresh standings and pairings from DB
    try {
        const [dbStandings, dbPairings] = await Promise.all([
            api.fetchTournamentStandings(tournamentId),
            api.fetchTournamentPairings(tournamentId)
        ]);

        if (dbStandings && dbStandings.length > 0) {
            currentTournament.players = dbStandings;
        }
        if (dbPairings && dbPairings.length > 0) {
            currentTournament.pairings = dbPairings;
        }
    } catch (e) {
        console.warn("Failed to fetch fresh tournament data from DB, using local data", e);
    }

    renderTournamentDetail();
}

function renderTournamentDetail() {
    if (!currentTournament) return;
    const grid = document.getElementById('tournamentsGrid');
    const statusClass = currentTournament.status || 'draft';
    const statusLabel = statusClass.charAt(0).toUpperCase() + statusClass.slice(1);
    const roundsPlayed = currentTournament.pairings ? Math.max(...currentTournament.pairings.map(p => p.round || 0), 0) : 0;

    grid.innerHTML = `
            <div class="tournament-detail-view active" >
                    <button class="back-button" onclick="closeTournamentDetail()">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="19" y1="12" x2="5" y2="12"></line>
                            <polyline points="12 19 5 12 12 5"></polyline>
                        </svg>
                        Back to Tournaments
                    </button>

                    <div class="tournament-detail-header">
                        <div>
                            <h1 class="tournament-detail-title">${currentTournament.name}</h1>
                            <div class="tournament-detail-meta">
                                <span>📅 ${new Date(currentTournament.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                                <span>🎯 ${currentTournament.format === 'swiss' ? 'Swiss System' : currentTournament.format === 'roundrobin' ? 'Round Robin' : 'Knockout'}</span>
                                <span>🕒 ${currentTournament.timeControl}</span>
                                <span>👥 ${currentTournament.players.length} Players</span>
                                <span class="tournament-status-badge ${statusClass}">${statusLabel}</span>
                            </div>
                        </div>
                        <div style="display: flex; gap: 10px;">
                            ${(currentTournament.status === 'active' || currentTournament.status === 'draft') && roundsPlayed === 0 ? `<button class="btn-primary" onclick="openPlayerSelection('${currentTournament?.id ?? ''}')">Select Players</button>` : ''}
                            ${currentTournament.status === 'active' && roundsPlayed < currentTournament.rounds ? `<button class="btn-primary" onclick="generateNextRound()">Next Round</button>` : ''}
                            ${currentTournament.status === 'active' && roundsPlayed > 0 ? `<button class="btn-secondary" onclick="closeTournament()">Close Tournament</button>` : ''}
                        </div>
                    </div>

                    <div class="tournament-tabs">
                        <button class="tournament-tab ${currentTournamentTab === 'overview' ? 'active' : ''}" onclick="switchTournamentTab('overview')">Overview</button>
                        <button class="tournament-tab ${currentTournamentTab === 'pairings' ? 'active' : ''}" onclick="switchTournamentTab('pairings')">Pairings</button>
                        <button class="tournament-tab ${currentTournamentTab === 'standings' ? 'active' : ''}" onclick="switchTournamentTab('standings')">Standings</button>
                        ${currentTournament.format === 'knockout' ? `<button class="tournament-tab ${currentTournamentTab === 'bracket' ? 'active' : ''}" onclick="switchTournamentTab('bracket')">Bracket</button>` : ''}
                    </div>

                    ${renderTournamentTab()}
                </div >
            `;
}

function switchTournamentTab(tab) {
    currentTournamentTab = tab;
    renderTournamentDetail();
}

function renderTournamentTab() {
    switch (currentTournamentTab) {
        case 'overview': return renderTournamentOverview();
        case 'pairings': return renderTournamentPairings();
        case 'standings': return renderTournamentStandings();
        case 'bracket': return renderTournamentBracket();
        default: return renderTournamentOverview();
    }
}

function renderTournamentOverview() {
    const roundsPlayed = currentTournament.current_round || 0;
    const totalGames = currentTournament.pairings.filter(p => p.result).length;

    return `
            <div class="tournament-summary" >
                    <h3 class="tournament-summary-title">Tournament Progress</h3>
                    <div class="tournament-summary-grid">
                        <div class="tournament-summary-item">
                            <div class="tournament-summary-label">Rounds Completed</div>
                            <div class="tournament-summary-value">${roundsPlayed} / ${currentTournament.rounds || 'TBD'}</div>
                        </div>
                        <div class="tournament-summary-item">
                            <div class="tournament-summary-label">Games Played</div>
                            <div class="tournament-summary-value">${totalGames}</div>
                        </div>
                        <div class="tournament-summary-item">
                            <div class="tournament-summary-label">Players</div>
                            <div class="tournament-summary-value">${currentTournament.players.length}</div>
                        </div>
                        ${currentTournament.status?.toLowerCase() === 'completed' ? `
                        <div class="tournament-summary-item">
                            <div class="tournament-summary-label">Winner</div>
                            <div class="tournament-summary-value" style="color: var(--accent-gold);">🏆 ${[...currentTournament.players].sort((a, b) => b.points - a.points)[0]?.name || 'N/A'}</div>
                        </div>
                        ` : ''}
                    </div>
                </div >

            ${currentTournament.status?.toLowerCase() === 'completed' ? renderTournamentFinalSummary() : ''}
        `;
}

function renderTournamentFinalSummary() {
    const sorted = (currentTournament.players || []).length > 0 ? [...currentTournament.players].sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        return (b.buchholz || 0) - (a.buchholz || 0);
    }) : [];

    const winner = sorted.length > 0 ? sorted[0] : null;
    const runnerUp = sorted[1];
    const biggestGainer = [...sorted].sort((a, b) => (b.rating_change || 0) - (a.rating_change || 0))[0];

    return `
            <div class="tournament-complete-banner" style="background: linear-gradient(135deg, var(--accent-gold), #B8860B); padding: 30px; border-radius: 12px; text-align: center; margin-bottom: 30px; color: white;">
                <h2 style="font-size: 28px; margin-bottom: 8px;">Tournament Complete! 🏆</h2>
                <p style="opacity: 0.9;">Congratulations to <strong>${winner?.name || "N/A"}</strong> for winning the tournament!</p>
            </div>

            <div class="tournament-summary" style = "margin-top: 20px;" >
                    <h3 class="tournament-summary-title">Final Summary</h3>
                    <div class="tournament-summary-grid">
                        <div class="tournament-summary-item">
                            <div class="tournament-summary-label">Winner</div>
                            <div class="tournament-summary-value" style="color: var(--accent-gold);">${winner?.name || 'N/A'}</div>
                        </div>
                        <div class="tournament-summary-item">
                            <div class="tournament-summary-label">Runner-up</div>
                            <div class="tournament-summary-value">${runnerUp?.name || 'N/A'}</div>
                        </div>
                        <div class="tournament-summary-item">
                            <div class="tournament-summary-label">Biggest Rating Gain</div>
                            <div class="tournament-summary-value" style="color: var(--success);">+${biggestGainer?.rating_change || 0}</div>
                        </div>
                        <div class="tournament-summary-item">
                            <div class="tournament-summary-label">Total Games</div>
                            <div class="tournament-summary-value">${currentTournament.pairings.filter(p => p.result).length}</div>
                        </div>
                    </div>
                </div >
            `;
}

function renderTournamentPairings() {
    const maxRound = Math.max(...currentTournament.pairings.map(p => p.round || 0), 0);
    const currentRound = currentTournament.current_round || 1;
    let html = '';

    for (let round = 1; round <= maxRound; round++) {
        const roundPairings = currentTournament.pairings.filter(p => p.round === round);
        if (roundPairings.length === 0) continue;

        const isCurrentRound = round === currentRound;
        const allResultsEntered = roundPairings.every(p => p.result !== null || p.isBye);
        const resultsRemaining = roundPairings.filter(p => p.result === null && !p.isBye).length;

        html += `
            <div style="display: flex; justify-content: space-between; align-items: center; margin: 20px 0 15px;">
                <h3 style="margin: 0;">Round ${round}</h3>
                ${isCurrentRound && currentTournament.status === 'Active' ? `
                    <div style="font-size: 14px; color: ${resultsRemaining === 0 ? 'var(--success)' : 'var(--text-secondary)'};">
                        ${resultsRemaining === 0 ? '✅ All results entered' : `â³ ${resultsRemaining} results remaining`}
                    </div>
                ` : ''}
            </div>
            <div class="pairings-list">
                ${roundPairings.map((pairing, idx) => renderPairingCard(pairing, idx, round)).join('')}
            </div>
        `;

        if (isCurrentRound && currentTournament.status === 'Active') {
            html += `
                <div class="round-actions-sticky" style="margin-top: 24px; padding: 16px; background: var(--bg-secondary); border-radius: 8px; border: 1px solid var(--border-color); display: flex; justify-content: flex-end; gap: 12px; position: sticky; bottom: 20px; z-index: 100;">
                    <button class="btn-primary" id="nextRoundBtn" onclick="generateNextRound()" ${resultsRemaining > 0 ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}>
                        ${round === currentTournament.rounds ? 'Complete Tournament' : 'Generate Next Round'}
                    </button>
                </div>
            `;
        }
    }

    if (!html) {
        html = `<div style = "text-align: center; padding: 40px; color: var(--text-secondary);" > No pairings generated yet.</div > `;
    }

    return html;
}

function renderPairingCard(pairing, idx, round) {
    const isBye = pairing.isBye;
    const isCurrentRound = round === currentTournament.current_round;
    const isCompleted = currentTournament.status === 'Completed';

    const resultOptions = `
            <option value="" ${pairing.result === null ? 'selected' : ''}>Select Result</option>
            <option value="1-0" ${pairing.result === '1-0' ? 'selected' : ''}>1-0 (White Wins)</option>
            <option value="0.5-0.5" ${pairing.result === '0.5-0.5' ? 'selected' : ''}>0.5-0.5 (Draw)</option>
            <option value="0-1" ${pairing.result === '0-1' ? 'selected' : ''}>0-1 (Black Wins)</option>
        `;

    return `
            <div class="pairing-card ${isBye ? 'bye-card' : ''}" style="display: grid; grid-template-columns: 1fr auto 1fr auto; align-items: center; gap: 16px; padding: 16px; background: var(--bg-secondary); border-radius: 8px; margin-bottom: 12px; border: 1px solid var(--border-color);">
                    <div class="pairing-player white" style="text-align: right;">
                        <div style="font-weight: 600;">${pairing.whiteName}</div>
                        <div style="font-size: 12px; color: var(--text-secondary);">Rating: ${pairing.whiteRatingBefore}</div>
                    </div>
                    <div class="pairing-vs" style="color: var(--text-muted); font-weight: 600;">VS</div>
                    <div class="pairing-player black">
                        <div style="font-weight: 600;">${pairing.blackName}</div>
                        <div style="font-size: 12px; color: var(--text-secondary);">Rating: ${pairing.blackRatingBefore}</div>
                    </div>
                    <div class="pairing-result">
                        ${isBye ? `
                            <span class="badge-bye" style="background: var(--bg-tertiary); padding: 4px 12px; border-radius: 4px; font-weight: 600; color: var(--accent-gold);">BYE</span>
                        ` : `
                            <select onchange="recordResult('${pairing.id || idx}', this.value)" 
                                    ${!isCurrentRound || isCompleted ? 'disabled' : ''}
                                    style="padding: 8px; background: var(--bg-tertiary); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 4px; width: 140px;">
                                ${resultOptions}
                            </select>
                        `}
                    </div>
                </div >
            `;
}

function recordResult(pairingId, result) {
    const pairing = currentTournament.pairings.find(p => (p.id === pairingId || currentTournament.pairings.indexOf(p).toString() === pairingId));
    if (!pairing) return;

    pairing.result = result === "" ? null : result;

    // Re-render to update counter and button state
    renderTournamentDetail();
}

function advanceKnockoutWinner(pairingIndex, result) {
    const pairing = currentTournament.pairings[pairingIndex];
    const winnerId = result === '1-0' ? pairing.white : (result === '0-1' ? pairing.black : null);
    if (!winnerId) return;

    const round = pairing.round;
    const totalRounds = Math.ceil(Math.log2(currentTournament.players.length));
    const matchesInRound = Math.pow(2, totalRounds - round);
    const nextMatchIndex = matchesInRound + Math.floor(pairingIndex % matchesInRound);

    if (nextMatchIndex < currentTournament.pairings.length) {
        const nextPairing = currentTournament.pairings[nextMatchIndex];
        const winner = currentTournament.standings.find(p => p.id === winnerId);

        if (pairingIndex % (matchesInRound * 2) < matchesInRound) {
            nextPairing.white = winnerId;
            nextPairing.whiteName = winner?.name || 'TBD';
        } else {
            nextPairing.black = winnerId;
            nextPairing.blackName = winner?.name || 'TBD';
        }
    }
}

function renderTournamentStandings() {
    if (!currentTournament || !currentTournament.players) return '<div>No players in tournament</div>';

    // Sort standings: Points DESC, then Buchholz DESC
    const sorted = (currentTournament.players || []).length > 0 ? [...currentTournament.players].sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        return (b.buchholz || 0) - (a.buchholz || 0);
    }) : [];

    return `
            <div class="standings-container">
                <div class="standings-table">
                    <div class="standings-header">
                        <span class="col-rank">#</span>
                        <span class="col-player">Player</span>
                        <span class="col-points">Points</span>
                        <span class="col-w">W</span>
                        <span class="col-d">D</span>
                        <span class="col-l">L</span>
                        <span class="col-buchholz">Tie Break</span>
                        <span class="col-change">Rating ±</span>
                    </div>
                    <div class="standings-body">
                        ${sorted.map((player, idx) => `
                            <div class="standings-row">
                                <span class="col-rank" style="font-weight: 700; ${idx < 3 ? 'color: var(--accent-gold);' : ''}">${idx + 1}</span>
                                <span class="col-player" style="font-weight: 500;">${player.name}</span>
                                <span class="col-points" style="font-weight: 600; color: var(--accent-gold);">${(player.points || 0).toFixed(1)}</span>
                                <span class="col-w">${player.wins || 0}</span>
                                <span class="col-d">${player.draws || 0}</span>
                                <span class="col-l">${player.losses || 0}</span>
                                <span class="col-buchholz">${(player.buchholz || 0).toFixed(1)}</span>
                                <span class="col-change rating-change ${(player.rating_change || 0) >= 0 ? 'positive' : 'negative'}" style="color: ${(player.rating_change || 0) > 0 ? 'var(--success)' : (player.rating_change || 0) < 0 ? 'var(--danger)' : 'inherit'}">
                                    ${player.rating_change ? (player.rating_change > 0 ? '+' : '') + player.rating_change : '0'}
                                </span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
            `;
}

function renderTournamentBracket() {
    if (currentTournament.format !== 'knockout') return '<div>Not available for this format</div>';

    const totalRounds = Math.ceil(Math.log2(currentTournament.players.length));
    let html = '<div class="bracket-view">';

    for (let r = 1; r <= totalRounds; r++) {
        const matchesInRound = currentTournament.pairings.filter(p => p.round === r);

        html += `<div class="bracket-round" > `;
        html += `<div class="bracket-round-title" > ${r === totalRounds ? 'Final' : r === totalRounds - 1 ? 'Semi-Finals' : r === totalRounds - 2 ? 'Quarter-Finals' : 'Round ' + r}</div > `;

        matchesInRound.forEach((pairing, idx) => {
            const whiteWon = pairing.result === '1-0';
            const blackWon = pairing.result === '0-1';
            const isFinal = r === totalRounds;

            html += `
            <div class="bracket-match" >
                            <div class="bracket-player ${whiteWon && isFinal ? 'winner' : whiteWon ? '' : (pairing.result === '0-1' ? 'eliminated' : '')}">
                                <span class="bracket-player-name">${pairing.whiteName}</span>
                                <span class="bracket-score">${pairing.result ? (pairing.result.split('-')[0]) : ''}</span>
                            </div>
                            <div class="bracket-player ${blackWon && isFinal ? 'winner' : blackWon ? '' : (pairing.result === '1-0' ? 'eliminated' : '')}">
                                <span class="bracket-player-name">${pairing.blackName}</span>
                                <span class="bracket-score">${pairing.result ? (pairing.result.split('-')[1]) : ''}</span>
                            </div>
                        </div >
            `;
        });

        html += `</div > `;
    }

    html += '</div>';
    return html;
}

function generateNextRound() {
    const currentRound = currentTournament.current_round || 1;
    const currentRoundPairings = currentTournament.pairings.filter(p => p.round === currentRound);

    // Show confirmation modal with all results
    showRoundConfirmModal(currentRoundPairings);
}

function showRoundConfirmModal(pairings) {
    const modal = document.getElementById('roundConfirmModal');
    const content = document.getElementById('roundConfirmContent');
    const currentRound = currentTournament.current_round || 1;

    // Sort players by points for standings preview
    const topPlayers = [...currentTournament.players]
        .sort((a, b) => b.points - a.points)
        .slice(0, 3);

    content.innerHTML = `
        <div style="margin-bottom: 20px;">
            <h3 style="color: var(--accent-gold); margin-bottom: 4px;">Round ${currentRound} Complete</h3>
            <p style="color: var(--text-secondary); font-size: 14px;">Review results before generating the next round.</p>
        </div>

        <div class="confirm-results-list" style="margin-bottom: 24px; background: var(--bg-tertiary); border-radius: 8px; overflow: hidden;">
            ${pairings.map(p => `
                <div style="display: flex; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid var(--border-color);">
                    <span style="font-size: 14px;">${p.whiteName} vs ${p.blackName}</span>
                    <span style="font-weight: 700; color: var(--accent-gold);">${p.result || 'BYE'}</span>
                </div>
            `).join('')}
        </div>

        <div class="standings-preview" style="margin-bottom: 24px;">
            <p style="font-size: 14px; color: var(--text-secondary); margin-bottom: 12px;">Current Top 3:</p>
            <div style="display: flex; flex-direction: column; gap: 8px;">
                ${topPlayers.map((p, i) => `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: var(--bg-secondary); border-radius: 6px; border-left: 3px solid ${i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : '#cd7f32'};">
                        <span style="font-weight: 500;">${p.name}</span>
                        <span style="font-weight: 700;">${p.points.toFixed(1)} pts</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    const confirmBtn = document.getElementById('confirmRoundBtn');
    if (confirmBtn) {
        confirmBtn.textContent = currentRound === currentTournament.rounds ? 'Confirm & Complete Tournament' : `Confirm & Generate Round ${currentRound + 1}`;
    }

    modal.classList.add('active');
}

async function confirmRoundSubmit() {
    const currentRound = currentTournament.current_round || 1;
    const currentRoundPairings = currentTournament.pairings.filter(p => p.round === currentRound);

    try {
        // 1. Process each pairing
        for (const pairing of currentRoundPairings) {
            if (pairing.isBye) {
                // Update player points for bye
                const player = currentTournament.players.find(p => p.id === pairing.white);
                if (player) {
                    player.points += 1;
                    player.wins = (player.wins || 0) + 1;
                }
                continue;
            }

            // Calculate Elo
            const whitePlayer = players.find(p => p.id === pairing.white);
            const blackPlayer = players.find(p => p.id === pairing.black);
            const whiteTourneyPlayer = currentTournament.players.find(p => p.id === pairing.white);
            const blackTourneyPlayer = currentTournament.players.find(p => p.id === pairing.black);

            const resultValue = pairing.result === '1-0' ? 1 : (pairing.result === '0-1' ? 0 : 0.5);

            const whiteExpected = 1 / (1 + Math.pow(10, (pairing.blackRatingBefore - pairing.whiteRatingBefore) / 400));
            const blackExpected = 1 / (1 + Math.pow(10, (pairing.whiteRatingBefore - pairing.blackRatingBefore) / 400));

            const kWhite = (whitePlayer?.games || 0) < 15 ? 40 : 20;
            const kBlack = (blackPlayer?.games || 0) < 15 ? 40 : 20;

            const whiteChange = Math.round(kWhite * (resultValue - whiteExpected));
            const blackChange = Math.round(kBlack * ((1 - resultValue) - blackExpected));

            pairing.whiteRatingChange = whiteChange;
            pairing.blackRatingChange = blackChange;
            pairing.whiteRatingAfter = pairing.whiteRatingBefore + whiteChange;
            pairing.blackRatingAfter = pairing.blackRatingBefore + blackChange;

            // Update Pairing in DB
            await api.updatePairingResult(pairing.id, {
                result: pairing.result,
                white_rating_after: pairing.whiteRatingAfter,
                black_rating_after: pairing.blackRatingAfter,
                white_rating_change: whiteChange,
                black_rating_change: blackChange
            });

            // Create Game record
            await api.saveGameResult({
                tournament_id: currentTournament.id,
                pairing_id: pairing.id,
                tournament_name: currentTournament.name,
                round_number: currentRound,
                date: currentTournament.date,
                white_player_id: pairing.white,
                black_player_id: pairing.black,
                white_player_name: pairing.whiteName,
                black_player_name: pairing.blackName,
                result: pairing.result,
                white_rating_before: pairing.whiteRatingBefore,
                black_rating_before: pairing.blackRatingBefore,
                white_rating_after: pairing.whiteRatingAfter,
                black_rating_after: pairing.blackRatingAfter,
                white_rating_change: whiteChange,
                black_rating_change: blackChange
            });

            // Update Players in DB
            if (whitePlayer) {
                whitePlayer.rating = pairing.whiteRatingAfter;
                whitePlayer.games = (whitePlayer.games || 0) + 1;
                if (pairing.result === '1-0') whitePlayer.wins++;
                else if (pairing.result === '0-1') whitePlayer.losses++;
                else whitePlayer.draws++;
                await api.updatePlayerStats(whitePlayer);
            }
            if (blackPlayer) {
                blackPlayer.rating = pairing.blackRatingAfter;
                blackPlayer.games = (blackPlayer.games || 0) + 1;
                if (pairing.result === '0-1') blackPlayer.wins++;
                else if (pairing.result === '1-0') blackPlayer.losses++;
                else blackPlayer.draws++;
                await api.updatePlayerStats(blackPlayer);
            }

            // Update Tournament Players
            if (whiteTourneyPlayer) {
                whiteTourneyPlayer.points += resultValue;
                whiteTourneyPlayer.rating_change = (whiteTourneyPlayer.rating_change || 0) + whiteChange;
                if (pairing.result === '1-0') whiteTourneyPlayer.wins++;
                else if (pairing.result === '0-1') whiteTourneyPlayer.losses++;
                else whiteTourneyPlayer.draws++;
            }
            if (blackTourneyPlayer) {
                blackTourneyPlayer.points += (1 - resultValue);
                blackTourneyPlayer.rating_change = (blackTourneyPlayer.rating_change || 0) + blackChange;
                if (pairing.result === '0-1') blackTourneyPlayer.wins++;
                else if (pairing.result === '1-0') blackTourneyPlayer.losses++;
                else blackTourneyPlayer.draws++;
            }

            // Update H2H
            await api.updateHeadToHead(pairing.white, pairing.black, pairing.result);
        }

        // 2. Update Buchholz for all players
        for (const tp of currentTournament.players) {
            // Sum of points of all opponents played so far
            const opponents = currentTournament.pairings
                .filter(p => p.result && (p.white === tp.id || p.black === tp.id) && !p.isBye)
                .map(p => p.white === tp.id ? p.black : p.white);

            tp.buchholz = opponents.reduce((sum, oppId) => {
                const opp = currentTournament.players.find(p => p.id === oppId);
                return sum + (opp?.points || 0);
            }, 0);
        }

        // Sync tournament_players to DB
        await api.addTournamentPlayers(currentTournament.id, currentTournament.players);

        // 3. Handle Next Round or Completion
        if (currentRound === currentTournament.rounds) {
            await api.updateTournamentStatus(currentTournament.id, 'Completed');
        } else {
            const nextRoundNum = currentRound + 1;
            await api.updateTournamentStatus(currentTournament.id, 'Active', nextRoundNum);

            // Create Next Round
            const nextRoundData = await api.createRound({
                tournament_id: currentTournament.id,
                round_number: nextRoundNum,
                status: 'Pending'
            });

            if (nextRoundData) {
                // Generate and save next pairings
                const nextPairings = generateSwissPairings(currentTournament.players, nextRoundNum);
                const pairingsWithIds = nextPairings.map(p => ({
                    ...p,
                    round_id: nextRoundData.id,
                    tournament_id: currentTournament.id
                }));
                await api.addRoundPairings(currentTournament.id, pairingsWithIds);
            }
        }

        // 4. Finalize
        await api.updateRoundStatus(currentRound, 'Completed'); // Need to find round ID

        window.location.reload();
    } catch (error) {
        console.error("Error confirming round:", error);
        alert("Failed to sync data to database.");
    }
}

function closeRoundConfirm() {
    const modal = document.getElementById('roundConfirmModal');
    if (modal) modal.classList.remove('active');
}

async function closeTournament() {
    if (!currentTournament) return;
    if (!confirm('Are you sure you want to end this tournament early?')) return;

    try {
        await api.updateTournamentStatus(currentTournament.id, 'Completed');
        showToast('Tournament closed successfully', 'success');
        window.location.reload();
    } catch (error) {
        console.error("Error closing tournament:", error);
        showToast('Failed to close tournament', 'error');
    }
}

function closeTournamentDetail() { currentTournament = null; currentTournamentTab = 'overview'; renderTournaments(); }

// Initialize tournaments on load
initializeTournaments();

// ==================== SEARCH FILTERS ====================
function setupSearchFilters() {
    document.getElementById('leaderboardSearch').addEventListener('input', renderLeaderboard);
    document.getElementById('tournamentFilter').addEventListener('change', renderGamesLog);

    // Tournament page filters
    const statusFilter = document.getElementById('tournamentStatusFilter');
    const formatFilter = document.getElementById('tournamentFormatFilter');

    if (statusFilter) {
        statusFilter.addEventListener('change', renderTournaments);
    }
    if (formatFilter) {
        formatFilter.addEventListener('change', renderTournaments);
    }
}

// Make functions available globally for HTML onclick attributes
window.setupNavigation = setupNavigation;
window.showSection = showSection;
window.toggleSidebar = toggleSidebar;
window.closeSidebar = closeSidebar;
window.getPlayerById = getPlayerById;
window.getInitials = getInitials;
window.getTitle = getTitle;
window.calculateWinRate = calculateWinRate;
window.getPerformanceData = getPerformanceData;
window.calculateNewRating = calculateNewRating;
window.renderDashboard = renderDashboard;
window.renderPodium = renderPodium;
window.renderStats = renderStats;
window.renderRecentGames = renderRecentGames;
window.renderLeaderboard = renderLeaderboard;
window.renderPlayers = renderPlayers;
window.openPlayerDetail = openPlayerDetail;
window.calculateHeadToHead = calculateHeadToHead;
window.renderRatingChart = renderRatingChart;
window.closePlayerDetailModal = closePlayerDetailModal;
window.formatResult = formatResult;
window.renderGamesLog = renderGamesLog;
window.openGameDetail = openGameDetail;
window.closeGameDetailModal = closeGameDetailModal;
window.populateTournamentFilter = populateTournamentFilter;
window.toggleGameSearch = function () { console.log('Search toggle removed'); };
window.populatePlayerSelects = populatePlayerSelects;
window.openAddGameModal = openAddGameModal;
window.closeAddGameModal = closeAddGameModal;
window.submitGame = submitGame;
window.cancelGameConfirm = cancelGameConfirm;
window.confirmGameSubmit = confirmGameSubmit;
window.initializeTournaments = initializeTournaments;
window.renderTournaments = renderTournaments;
window.renderTournamentCard = renderTournamentCard;
window.openCreateTournamentModal = openCreateTournamentModal;
window.closeCreateTournamentModal = closeCreateTournamentModal;
window.showTournamentStartPreview = showTournamentStartPreview;
window.closeTournamentStartPreviewModal = closeTournamentStartPreviewModal;
window.confirmStartTournament = confirmStartTournament;
window.confirmCreateTournament = function () { console.warn('confirmCreateTournament is deprecated, use submitTournament'); };
window.updateRoundsInput = updateRoundsInput;
window.submitTournament = submitTournament;
window.editTournament = editTournament;
window.deleteTournament = deleteTournament;
window.openPlayerSelection = openPlayerSelection;
window.closePlayerSelectionModal = closePlayerSelectionModal;
window.renderPlayerSelection = renderPlayerSelection;
window.renderPlayerCards = renderPlayerCards;
window.togglePlayer = togglePlayer;
window.addNewPlayer = addNewPlayer;
window.startTournament = startTournament;
window.generatePairings = generatePairings;
window.generateSwissPairings = generateSwissPairings;
window.generateRoundRobinPairings = generateRoundRobinPairings;
window.generateKnockoutPairings = generateKnockoutPairings;
window.openTournamentDetail = openTournamentDetail;
window.renderTournamentDetail = renderTournamentDetail;
window.switchTournamentTab = switchTournamentTab;
window.renderTournamentTab = renderTournamentTab;
window.renderTournamentOverview = renderTournamentOverview;
window.renderTournamentFinalSummary = renderTournamentFinalSummary;
window.renderTournamentPairings = renderTournamentPairings;
window.renderPairingCard = renderPairingCard;
window.recordResult = recordResult;
window.advanceKnockoutWinner = advanceKnockoutWinner;
window.renderTournamentStandings = renderTournamentStandings;
window.renderTournamentBracket = renderTournamentBracket;
window.generateNextRound = generateNextRound;
window.closeRoundConfirm = closeRoundConfirm;
window.confirmRoundSubmit = confirmRoundSubmit;
window.closeTournament = closeTournament;
window.closeTournamentDetail = closeTournamentDetail;
window.goBackToTournamentDetails = goBackToTournamentDetails;
window.setupSearchFilters = setupSearchFilters;
window.saveTournamentPlayers = saveTournamentPlayers;
