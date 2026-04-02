const fs = require('fs');

let code = fs.readFileSync('src/lib/main.js', 'utf8');
let html = fs.readFileSync('index.html', 'utf8');

// ── PATCH 1: Add getCategoryFromTimeControl helper after existing helpers ──
const helperMarker = 'function getPeakRatingForCategory(player, cat) {';
const helperIdx = code.indexOf(helperMarker);
if (helperIdx === -1) { console.error('❌ Could not find getPeakRatingForCategory'); process.exit(1); }
const helperEnd = code.indexOf('\n}', helperIdx) + 2;

const categoryHelper = `

// Derive rating category from a time control string
function getCategoryFromTimeControl(tc) {
    if (!tc) return 'rapid';
    const t = tc.toLowerCase();
    if (t.includes('classical')) return 'classical';
    if (t.includes('blitz')) return 'blitz';
    // Rapid covers any rapid label
    return 'rapid';
}
window.getCategoryFromTimeControl = getCategoryFromTimeControl;

// Get category-specific WDL stats from the games array
function getCategoryStats(player, cat) {
    const catGames = (games || []).filter(g => {
        const isPlayer = (g.white === player.id || g.black === player.id ||
                          g.white_player_id === player.id || g.black_player_id === player.id);
        if (!isPlayer) return false;
        return (g.category || 'rapid') === cat;
    });
    const wins = catGames.filter(g => {
        const isWhite = (g.white === player.id || g.white_player_id === player.id);
        return (isWhite && g.result === '1-0') || (!isWhite && g.result === '0-1');
    }).length;
    const draws = catGames.filter(g => g.result === '1/2-1/2').length;
    const losses = catGames.filter(g => {
        const isWhite = (g.white === player.id || g.white_player_id === player.id);
        return (isWhite && g.result === '0-1') || (!isWhite && g.result === '1-0');
    }).length;
    const total = wins + draws + losses;
    const winRate = total === 0 ? 0 : Math.round(((wins + draws * 0.5) / total) * 100);
    return { wins, draws, losses, total, winRate, catGames };
}
window.getCategoryStats = getCategoryStats;

// Form indicator using category-specific games (still global by default as per design)
function getPerformanceDataForCategory(player, cat) {
    const catGames = (games || []).filter(g => {
        const isPlayer = (g.white === player.id || g.black === player.id ||
                          g.white_player_id === player.id || g.black_player_id === player.id);
        return isPlayer;  // Form remains GLOBAL across all categories
    }).sort((a, b) => new Date(b.date) - new Date(a.date));

    if (catGames.length < 3) return { state: 'neutral', label: '-', class: 'perf-neutral' };

    const last5 = catGames.slice(0, 5);
    let formScore = 0;
    last5.forEach(g => {
        const isWhite = (g.white === player.id || g.white_player_id === player.id);
        if (g.result === '1/2-1/2') formScore += 0.5;
        else if ((isWhite && g.result === '1-0') || (!isWhite && g.result === '0-1')) formScore += 1;
    });
    const formPct = formScore / last5.length;

    if (formPct >= 0.8) return { state: 'hot', icon: '&#x1F525;', class: 'perf-hot' };
    if (formPct >= 0.6) return {
        state: 'up',
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>',
        class: 'perf-up'
    };
    if (formPct >= 0.4) return { state: 'stable', icon: '=', class: 'perf-stable' };
    if (formPct >= 0.2) return {
        state: 'down',
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>',
        class: 'perf-down'
    };
    return { state: 'cold', icon: '&#x1F976;', class: 'perf-cold' };
}
window.getPerformanceDataForCategory = getPerformanceDataForCategory;
`;

code = code.slice(0, helperEnd) + categoryHelper + code.slice(helperEnd);
console.log('✅ PATCH 1: Category helpers added');

// ── PATCH 2: Update renderLeaderboard to use category-specific WDL/stats ──
// Find the renderLeaderboard function body and replace the stats section
const oldStatsBlock = /const title = getTitle\(getRatingForCategory\(player, window\.activeLeaderboardCategory\)\);\r?\n\s+const winRate = calculateWinRate\(player\);\r?\n\s+const perf = getPerformanceData\(player\);/;
const newStatsBlock = `const cat = window.activeLeaderboardCategory;
        const title = getTitle(getRatingForCategory(player, cat));
        const catStats = getCategoryStats(player, cat);
        const perf = getPerformanceDataForCategory(player, cat);
        const displayGames = catStats.total > 0 ? catStats.total : (player?.games ?? 0);`;

if (oldStatsBlock.test(code)) {
    code = code.replace(oldStatsBlock, newStatsBlock);
    console.log('✅ PATCH 2a: Stats block updated');
} else {
    console.error('❌ PATCH 2a: Stats block not found');
    process.exit(1);
}

// Replace the row template cells for WDL
const oldWDLBlock = /\<span class=\"rating-cell\"\>\$\{getRatingForCategory\(player, window\.activeLeaderboardCategory\)\}\<\/span\>[\r\n\s]+\<span class=\"mobile-hide\"\>\$\{getPeakRatingForCategory\(player, window\.activeLeaderboardCategory\)\}\<\/span\>[\r\n\s]+\<span class=\"mobile-hide\"\>\$\{player\?\.games \?\? 0\}\<\/span\>[\r\n\s]+\<span\>\$\{player\?\.wins \?\? 0\}-\$\{player\?\.draws \?\? 0\}-\$\{player\?\.losses \?\? 0\}\<\/span\>[\r\n\s]+\<span\>\$\{winRate\}%\<\/span\>/;
const newWDLBlock = `<span class="rating-cell">\${getRatingForCategory(player, cat)}</span>
                        <span class="mobile-hide">\${getPeakRatingForCategory(player, cat)}</span>
                        <span class="mobile-hide">\${displayGames}</span>
                        <span>\${catStats.wins}-\${catStats.draws}-\${catStats.losses}</span>
                        <span>\${catStats.winRate}%</span>`;

if (oldWDLBlock.test(code)) {
    code = code.replace(oldWDLBlock, newWDLBlock);
    console.log('✅ PATCH 2b: WDL cells updated');
} else {
    console.error('❌ PATCH 2b: WDL cells not found');
    process.exit(1);
}


// ── PATCH 3: Expose getCategoryFromTimeControl globally (already done via window) ──
console.log('✅ PATCH 3: getCategoryFromTimeControl globally exposed');

// ── PATCH 4: Remove repairRatingsBtn reference in updateAdminUI ──
const repairShow = `            if (repairBtn) repairBtn.style.display = 'flex';`;
const repairHide = `            if (repairBtn) repairBtn.style.display = 'none';`;
if (code.includes(repairShow)) {
    code = code.replace(`        const repairBtn = document.getElementById('repairRatingsBtn');\n        if (isAdmin) {\n            adminLoginBtn.style.display = 'none';\n            adminLogoutBtn.style.display = '';\n            if (adminEmailDisplay) adminEmailDisplay.textContent = adminEmail;\n            if (repairBtn) repairBtn.style.display = 'flex';`,
    `        if (isAdmin) {\n            adminLoginBtn.style.display = 'none';\n            adminLogoutBtn.style.display = '';\n            if (adminEmailDisplay) adminEmailDisplay.textContent = adminEmail;`);
    code = code.replace(`            if (repairBtn) repairBtn.style.display = 'none';`, '');
    console.log('✅ PATCH 4: repairRatingsBtn references removed from JS');
} else {
    console.warn('⚠️  PATCH 4: repairBtn references not found (may already be removed)');
}

// Write updated files
fs.writeFileSync('src/lib/main.js', code);
console.log('✅ main.js written');

// ── HTML PATCH 1: Remove Recalculate Ratings button from sidebar ──
const recalcBtn = `            <!-- Admin-only: repair player ratings from game history -->
            <button id="repairRatingsBtn" onclick="repairPlayerRatings()" style="display:none; margin: 4px 16px 0; padding: 9px 16px; background: var(--bg-tertiary); color: var(--text-secondary); border: 1px solid var(--border-color); border-radius: 10px; font-weight: 600; font-size: 12px; cursor: pointer; align-items: center; gap: 8px; width: calc(100% - 32px);">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                Recalculate Ratings
            </button>`;

if (html.includes(recalcBtn)) {
    html = html.replace(recalcBtn, '');
    console.log('✅ HTML PATCH 1: Recalculate Ratings button removed');
} else {
    console.warn('⚠️  HTML PATCH 1: recalcBtn not found (may have changed)');
}

// ── HTML PATCH 2: Replace Time Control select with grouped + Custom option ──
const oldTimeCtrl = `                        <select class="form-select" id="tournamentTimeControl">
                            <option value="Classical (90+30)">Classical (90+30)</option>
                            <option value="Rapid (25+0)">Rapid (25+0)</option>
                            <option value="Rapid (15+10)">Rapid (15+10)</option>
                            <option value="Rapid (10+5)">Rapid (10+5)</option>
                            <option value="Rapid (10+0)">Rapid (10+0)</option>
                            <option value="Blitz (5+3)">Blitz (5+3)</option>
                            <option value="Blitz (5+0)">Blitz (5+0)</option>
                            <option value="Blitz (3+2)">Blitz (3+2)</option>
                            <option value="Bullet (1+0)">Bullet (1+0)</option>
                        </select>`;

const newTimeCtrl = `                        <select class="form-select" id="tournamentTimeControl" onchange="toggleCustomTimeControl(this.value)">
                            <optgroup label="⚡ Blitz">
                                <option value="Blitz (5+3)">Blitz (5+3)</option>
                                <option value="Blitz (5+0)">Blitz (5+0)</option>
                                <option value="Blitz (3+2)">Blitz (3+2)</option>
                            </optgroup>
                            <optgroup label="🕐 Rapid">
                                <option value="Rapid (25+0)">Rapid (25+0)</option>
                                <option value="Rapid (15+10)">Rapid (15+10)</option>
                                <option value="Rapid (10+5)" selected>Rapid (10+5)</option>
                                <option value="Rapid (10+0)">Rapid (10+0)</option>
                            </optgroup>
                            <optgroup label="♟️ Classical">
                                <option value="Classical (90+30)">Classical (90+30)</option>
                                <option value="Classical (60+0)">Classical (60+0)</option>
                            </optgroup>
                            <option value="custom">✏️ Custom...</option>
                        </select>
                        <input type="text" class="form-input" id="customTimeControl" placeholder="e.g. Rapid (20+5)" style="display:none; margin-top: 8px;" oninput="syncCustomTimeControl(this.value)">`;

if (html.includes(oldTimeCtrl)) {
    html = html.replace(oldTimeCtrl, newTimeCtrl);
    console.log('✅ HTML PATCH 2: Time control select updated with groups + Custom');
} else {
    console.error('❌ HTML PATCH 2: Old time control dropdown not found');
    process.exit(1);
}

// ── HTML PATCH 3: Add Category column header to Games log table ──
const oldGamesHeader = `                        <div class="table-header-item mobile-hide">Tournament</div>`;
const newGamesHeader = `                        <div class="table-header-item mobile-hide">Category</div>
                        <div class="table-header-item mobile-hide">Tournament</div>`;

if (html.includes(oldGamesHeader)) {
    html = html.replace(oldGamesHeader, newGamesHeader);
    console.log('✅ HTML PATCH 3: Category column added to Games log table header');
} else {
    console.warn('⚠️  HTML PATCH 3: Games table header not found');
}

fs.writeFileSync('index.html', html);
console.log('✅ index.html written');

console.log('\n🎉 All patches applied successfully!');
