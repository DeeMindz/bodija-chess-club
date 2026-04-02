import * as api from './api.js';
import { supabase, getSupabaseUrl } from './supabase.js';


// ==================== DATA STORE ====================

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
let players = [];
let games = [];
let medalsCache = {}; // { playerId -> medals[] } — populated on load, used for inline rendering
let _dataReady  = false; // set true after phase-3 (tournaments) fetch completes
let tournaments = [];
let currentSortColumn = 'rating';
let currentSortDirection = 'desc';
let playerDetailChart = null;

// Offline tournament state
let _localTournament = null;

// Fetch lock to prevent duplicate API calls
let _fetchingPlayerRequests = false;

// ==================== OFFLINE TOURNAMENT HELPERS ====================

// Save local tournament state to localStorage
function saveLocalTournament() {
    if (!window._localTournament) return;
    window._localTournament.lastUpdated = Date.now();
    localStorage.setItem('bcc_active_tournament', JSON.stringify(window._localTournament));
}

// Human-readable format name from any format string
function formatDisplayName(format) {
    const f = normalizeFormat(format);
    if (f === 'swiss') return 'Swiss System';
    if (f === 'roundrobin') return isDoubleRR(format) ? 'Round Robin (Double)' : 'Round Robin (Single)';
    if (f === 'knockout') return 'Knockout';
    return format || 'Unknown';
}

// Normalize all format string variations to a canonical value
function normalizeFormat(format) {
    if (!format) return 'swiss';
    const f = format.toLowerCase().replace(/[\s_-]/g, '');
    if (f.includes('swiss')) return 'swiss';
    if (f.includes('roundrobin') || f.includes('rr')) return 'roundrobin';
    if (f.includes('knockout') || f.includes('ko')) return 'knockout';
    return f;
}

// Check if format is double round robin
function isDoubleRR(format) {
    if (!format) return false;
    const f = format.toLowerCase();
    return f.includes('double') || f === 'roundrobin_double';
}

function showRecoveryBanner(local) {
    // Remove any existing banner
    const existing = document.getElementById('recoveryBanner');
    if (existing) existing.remove();

    const minutesAgo = Math.round((Date.now() - (local.lastUpdated || Date.now())) / 60000);
    const timeText = minutesAgo < 1 ? 'just now' : `${minutesAgo} min ago`;

    const banner = document.createElement('div');
    banner.id = 'recoveryBanner';
    banner.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);background:#1c2128;border:1.5px solid #F0A500;border-radius:12px;padding:14px 18px;z-index:99999;display:flex;align-items:center;gap:12px;box-shadow:0 8px 32px rgba(0,0,0,0.6);max-width:480px;width:calc(100% - 32px);flex-wrap:wrap;';
    banner.innerHTML = `
        <div style="flex:1;min-width:0;">
            <div style="color:#F0A500;font-weight:600;font-size:14px;">&#x1F504; Unfinished Tournament</div>
            <div style="color:#8b949e;font-size:12px;margin-top:2px;">${local.name} &middot; Round ${local.current_round} of ${local.total_rounds} &middot; Last saved ${timeText}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
            <button onclick="resumeLocalTournament()" style="background:#F0A500;color:#000;border:none;padding:8px 14px;border-radius:8px;font-weight:600;font-size:12px;cursor:pointer;white-space:nowrap;">Resume</button>
            <button onclick="discardLocalTournament()" style="background:transparent;color:#8b949e;border:1px solid #30363d;padding:8px 14px;border-radius:8px;font-size:12px;cursor:pointer;white-space:nowrap;">Discard</button>
            <button onclick="document.getElementById('recoveryBanner').remove()" title="Dismiss for this session"
                style="background:transparent;color:#8b949e;border:none;padding:4px 6px;border-radius:6px;font-size:18px;cursor:pointer;line-height:1;flex-shrink:0;">&times;</button>
        </div>
    `;
    document.body.appendChild(banner);
}

// Admin utility: recalculate all player stats from games table
// Run from browser console: recalcStats()
window.recalcStats = async function() {
    ...');
    try {
        // Use games table — covers tournament games AND casual game-log games
        const [allGames, allPlayers] = await Promise.all([
            api.fetchAllGameResults(),
            api.fetchAllPlayersForRecalc()
        ]);
        
        for (const player of allPlayers) {
            const myGames = allGames.filter(g => g.white_player_id === player.id || g.black_player_id === player.id);
            const wins = myGames.filter(g => (g.white_player_id === player.id && g.result === '1-0') || (g.black_player_id === player.id && g.result === '0-1')).length;
            const draws = myGames.filter(g => g.result === '1/2-1/2').length;
            const losses = myGames.filter(g => (g.white_player_id === player.id && g.result === '0-1') || (g.black_player_id === player.id && g.result === '1-0')).length;
            try {
                await api.updatePlayerStats(player.id, { bodija_rating: player.bodija_rating, peak_rating: player.peak_rating, games_played: myGames.length, wins, draws, losses });
                
            } catch(e) { console.warn('Failed for', player.name, e.message); }
        }
        
    } catch(e) { console.error('recalcStats failed:', e); }
};

window.resumeLocalTournament = function() {
    const local = window._localTournament;
    if (!local) return;
    document.getElementById('recoveryBanner')?.remove();

    // Restore flat pairings from rounds array
    if (local.rounds && local.rounds.length > 0) {
        local.pairings = local.rounds.flatMap(r => r.pairings);
    }

    currentTournament = local;
    currentTournamentTab = 'pairings';
    currentViewingRound = local.current_round || 1;

    // Navigate to tournaments section first
    showSection('tournaments');
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelector('.nav-item[data-section="tournaments"]')?.classList.add('active');

    // Open the detail modal
    const modal = document.getElementById('tournamentDetailModal');
    if (modal) modal.classList.add('active');
    renderTournamentDetail();
};

window.discardLocalTournament = async function() {
    if (!confirm('Discard this tournament? This cannot be undone.')) return;
    const local = window._localTournament;
    if (local?.id) {
        try { await api.deleteTournament(local.id); } catch(e) {}
    }
    localStorage.removeItem('bcc_active_tournament');
    window._localTournament = null;
    document.getElementById('recoveryBanner')?.remove();
    showToast('Tournament discarded', 'info');
};

// Check for local tournament on app load (crash recovery)
function checkForLocalTournament() {
    try {
        const saved = localStorage.getItem('bcc_active_tournament');
        if (!saved) return null;
        const local = JSON.parse(saved);
        // Don't restore if already synced or not active
        if (local.synced || local.status !== 'Active') {
            localStorage.removeItem('bcc_active_tournament');
            return null;
        }
        window._localTournament = local;
        return local;
    } catch (e) {
        localStorage.removeItem('bcc_active_tournament');
        return null;
    }
}

// Calculate ELO rating change
function calculateElo(playerRating, opponentRating, result) {
    // result: 1 = win, 0.5 = draw, 0 = loss
    const expected = 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
    const K = 32;
    const change = Math.round(K * (result - expected));
    return { change, newRating: playerRating + change };
}

// Recalculate all ratings from scratch (after result entry or edit)
function recalculateFromRound(localTournament) {
    if (!localTournament) return;

    // Reset all players to tournament starting state
    localTournament.players.forEach(p => {
        p.currentRating = p.ratingAtStart;
        p.points = 0;
        p.wins = 0;
        p.draws = 0;
        p.losses = 0;
        p.byes = 0;
        p.colorHistory = p.colorHistory || [];
        p.opponents = p.opponents || [];
    });

    // Replay all rounds sequentially
    for (const round of localTournament.rounds) {
        for (const pairing of round.pairings) {
            const white = localTournament.players.find(p => p.id === pairing.whitePlayerId);
            const black = localTournament.players.find(p => p.id === pairing.blackPlayerId);

            // Handle bye
            if (pairing.isBye) {
                if (white) {
                    pairing.whiteRatingBefore = white.currentRating;
                    pairing.whiteRatingAfter = white.currentRating;
                    pairing.whiteRatingChange = 0;
                    white.points += 1;
                    white.byes += 1;
                }
                continue;
            }

            if (!pairing.result || !white || !black) continue;

            // Snapshot ratings before game
            pairing.whiteRatingBefore = white.currentRating;
            pairing.blackRatingBefore = black.currentRating;

            // Track history
            white.colorHistory.push('white');
            black.colorHistory.push('black');
            white.opponents.push(black.id);
            black.opponents.push(white.id);

            // Calculate ELO
            const whiteScore = pairing.result === '1-0' ? 1
                : pairing.result === '1/2-1/2' ? 0.5 : 0;
            const blackScore = 1 - whiteScore;

            const whiteElo = calculateElo(white.currentRating, black.currentRating, whiteScore);
            const blackElo = calculateElo(black.currentRating, white.currentRating, blackScore);

            // Update pairing
            pairing.whiteRatingAfter = whiteElo.newRating;
            pairing.whiteRatingChange = whiteElo.change;
            pairing.blackRatingAfter = blackElo.newRating;
            pairing.blackRatingChange = blackElo.change;

            // Update players
            white.currentRating = whiteElo.newRating;
            black.currentRating = blackElo.newRating;
            white.peakRating = Math.max(white.peakRating || white.currentRating, white.currentRating);
            black.peakRating = Math.max(black.peakRating || black.currentRating, black.currentRating);

            if (pairing.result === '1-0') {
                white.points += 1; white.wins += 1; black.losses += 1;
            } else if (pairing.result === '0-1') {
                black.points += 1; black.wins += 1; white.losses += 1;
            } else {
                white.points += 0.5; black.points += 0.5;
                white.draws += 1; black.draws += 1;
            }
        }
    }

    // Recalculate buchholz
    localTournament.players.forEach(p => {
        p.buchholz = (p.opponents || []).reduce((sum, oppId) => {
            const opp = localTournament.players.find(x => x.id === oppId);
            return sum + (opp?.points || 0);
        }, 0);
    });

    saveLocalTournament();
}

// ==================== AUTH STATE ====================
let isAdmin = false;
let adminEmail = '';

// Check for existing session on load
async function checkAuthSession() {
    try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) {
            console.warn('Session check error:', error.message);
            return;
        }
        if (session) {
            isAdmin = true;
            adminEmail = session.user.email || '';
            // Load pending request count for returning admin
            loadPendingRequestCount();
        }
    } catch (e) {
        console.warn('Failed to check auth session:', e);
    }
    updateAdminUI();
}

// Listen for auth changes
function initAuthListener() {
    supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session) {
            isAdmin = true;
            adminEmail = session.user.email || '';
            loadPendingRequestCount();

        } else if (event === 'SIGNED_OUT') {
            isAdmin = false;
            adminEmail = '';

        }
        updateAdminUI();
    });
}

// Update UI based on auth state
function updateAdminUI() {

    // Toggle body class for CSS-based showing/hiding
    if (isAdmin) {
        document.body.classList.add('is-admin');
    } else {
        document.body.classList.remove('is-admin');
    }



    // Show/hide notification bell for admin (use class for all bells)
    const notificationBtns = document.querySelectorAll('.admin-bell');
    notificationBtns.forEach(btn => {
        btn.style.display = isAdmin ? 'flex' : 'none';
    });

    // Note: loadPendingRequestCount removed - only fetch when admin navigates to Players page

    // Update admin login/logout section in sidebar
    const adminLoginSection = document.getElementById('adminLoginSection');
    const adminLoginBtn = document.getElementById('adminLoginBtn');
    const adminLogoutBtn = document.getElementById('adminLogoutBtn');
    const adminEmailDisplay = document.getElementById('adminEmailDisplay');

    if (adminLoginSection && adminLoginBtn && adminLogoutBtn) {
        const repairBtn = document.getElementById('repairRatingsBtn');
        if (isAdmin) {
            adminLoginBtn.style.display = 'none';
            adminLogoutBtn.style.display = '';
            if (adminEmailDisplay) adminEmailDisplay.textContent = adminEmail;
            if (repairBtn) repairBtn.style.display = 'flex';
        } else {
            adminLoginBtn.style.display = '';
            adminLogoutBtn.style.display = 'none';
            if (adminEmailDisplay) adminEmailDisplay.textContent = '';
            if (repairBtn) repairBtn.style.display = 'none';
        }
    }
}

// Admin login function
async function adminLogin(email, password) {
    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) {
            return { success: false, error: error.message };
        }

        isAdmin = true;
        adminEmail = email;
        updateAdminUI();
        // Load pending request count after successful login
        loadPendingRequestCount();
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// Admin logout function
async function adminLogout() {
    try {
        const { error } = await supabase.auth.signOut();
        if (error) {
            console.warn('Logout error:', error.message);
        }
        isAdmin = false;
        adminEmail = '';
        updateAdminUI();
    } catch (e) {
        console.warn('Logout failed:', e);
    }
}

// Check RLS status (console warning)
async function checkRLSStatus() {
    try {
        // Try to get table info - this will fail if RLS is not properly configured
        const { data, error } = await supabase
            .from('players')
            .select('id')
            .limit(1);

        if (!error) {
            // Supabase connection successful
        }
    } catch (e) {
        console.warn('⚠️¸ï¸ Supabase connection issue. Ensure RLS is enabled on your Supabase dashboard.');
    }
}

// Make functions globally available

window.adminLogin = adminLogin;
window.adminLogout = adminLogout;
window.openAdminLoginModal = function () {

    const modal = document.getElementById('adminLoginModal');
    if (modal) modal.classList.add('active');
    // Reset form when opening
    resetAdminLoginForm();
};
window.closeAdminLoginModal = function () {

    const modal = document.getElementById('adminLoginModal');
    if (modal) modal.classList.remove('active');
};

// Reset admin login form to initial state
function resetAdminLoginForm() {
    const emailInput = document.getElementById('adminEmail');
    const otpSection = document.getElementById('otpSection');
    const passwordSection = document.getElementById('passwordSection');
    const sendOtpBtn = document.getElementById('sendOtpBtn');
    const otpInput = document.getElementById('adminOtp');
    const passwordInput = document.getElementById('adminPassword');
    const errorEl = document.getElementById('adminLoginError');

    if (emailInput) {
        emailInput.disabled = false;
        emailInput.value = '';
    }
    if (otpSection) otpSection.style.display = 'none';
    if (passwordSection) passwordSection.style.display = 'none';
    if (sendOtpBtn) {
        sendOtpBtn.style.display = 'block';
        sendOtpBtn.textContent = 'Send OTP Code';
        sendOtpBtn.disabled = false;
    }
    if (otpInput) otpInput.value = '';
    if (passwordInput) passwordInput.value = '';
    if (errorEl) errorEl.textContent = '';

    // Reset toggle buttons
    const otpToggle = document.getElementById('otpToggle');
    const passwordToggle = document.getElementById('passwordToggle');
    if (otpToggle) {
        otpToggle.classList.add('active');
        otpToggle.style.background = 'var(--bg-secondary)';
    }
    if (passwordToggle) {
        passwordToggle.classList.remove('active');
        passwordToggle.style.background = 'var(--bg-secondary)';
    }
}
window.resetAdminLoginForm = resetAdminLoginForm;

// Switch between login methods (OTP / Password)
window.switchLoginMethod = function (method) {
    const otpSection = document.getElementById('otpSection');
    const passwordSection = document.getElementById('passwordSection');
    const sendOtpBtn = document.getElementById('sendOtpBtn');
    const otpToggle = document.getElementById('otpToggle');
    const passwordToggle = document.getElementById('passwordToggle');
    const errorEl = document.getElementById('adminLoginError');

    if (errorEl) errorEl.textContent = '';

    if (method === 'otp') {
        if (otpSection) otpSection.style.display = 'none';
        if (passwordSection) passwordSection.style.display = 'none';
        if (sendOtpBtn) {
            sendOtpBtn.style.display = 'block';
            sendOtpBtn.textContent = 'Send OTP Code';
            sendOtpBtn.disabled = false;
        }
        if (otpToggle) {
            otpToggle.classList.add('active');
            otpToggle.style.borderColor = 'var(--accent-gold)';
        }
        if (passwordToggle) {
            passwordToggle.classList.remove('active');
            passwordToggle.style.borderColor = 'var(--border-color)';
        }
    } else {
        if (otpSection) otpSection.style.display = 'none';
        if (passwordSection) passwordSection.style.display = 'block';
        if (sendOtpBtn) sendOtpBtn.style.display = 'none';
        if (otpToggle) {
            otpToggle.classList.remove('active');
            otpToggle.style.borderColor = 'var(--border-color)';
        }
        if (passwordToggle) {
            passwordToggle.classList.add('active');
            passwordToggle.style.borderColor = 'var(--accent-gold)';
        }
    }
};
window.switchLoginMethod = switchLoginMethod;

// Send OTP code
window.sendOTP = async function (event) {
    if (event) event.preventDefault();

    const email = document.getElementById('adminEmail')?.value;
    const errorEl = document.getElementById('adminLoginError');
    const submitBtn = document.getElementById('sendOtpBtn');

    if (!email) {
        if (errorEl) errorEl.textContent = 'Please enter your email';
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending...';
    }

    try {
        // Get site URL for redirect
        const siteUrl = await import('./supabase.js').then(m => m.getSiteUrl());

        // Send OTP to email
        const { error } = await supabase.auth.signInWithOtp({
            email: email,
            options: {
                emailRedirectTo: siteUrl,
                shouldCreateUser: false
            }
        });

        if (error) {
            if (errorEl) errorEl.textContent = sanitizeError(error.message);
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Send OTP Code';
            }
            return;
        }

        // Show OTP input
        document.getElementById('adminEmail').disabled = true;
        document.getElementById('otpSection').style.display = 'block';
        document.getElementById('otpSection').querySelector('button[type="submit"]').textContent = 'Verify & Login';

        if (errorEl) errorEl.textContent = '✓ OTP sent to your email!';
        if (submitBtn) submitBtn.style.display = 'none';

    } catch (e) {
        if (errorEl) errorEl.textContent = 'Error: ' + sanitizeError(e.message);
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Send OTP Code';
        }
    }
};
window.sendOTP = sendOTP;

// Login with password
window.loginWithPassword = async function (event) {
    if (event) event.preventDefault();

    const email = document.getElementById('adminEmail')?.value;
    const password = document.getElementById('adminPassword')?.value;
    const errorEl = document.getElementById('adminLoginError');

    if (!email || !password) {
        if (errorEl) errorEl.textContent = 'Please enter email and password';
        return;
    }

    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) {
            if (errorEl) errorEl.textContent = sanitizeError(error.message);
            return;
        }

        // Login successful
        if (errorEl) errorEl.textContent = '? Login successful!';
        closeAdminLoginModal();

        // Check if user is admin
        await checkAdminStatus(data.user);

        // Load pending request count after successful login
        loadPendingRequestCount();

    } catch (e) {
        if (errorEl) errorEl.textContent = 'Error: ' + sanitizeError(e.message);
    }
};
window.loginWithPassword = loginWithPassword;

window.submitAdminLogin = async function (event) {

    event.preventDefault();
    // Default to OTP - actual handling is done by sendOTP or loginWithPassword
};

window.verifyOTPAndLogin = async function (event) {
    event.preventDefault();
    const email = document.getElementById('adminEmail')?.value;
    const token = document.getElementById('adminOtp')?.value;
    const errorEl = document.getElementById('adminLoginError');

    if (!token) {
        if (errorEl) errorEl.textContent = 'Please enter the OTP';
        return;
    }

    const submitBtn = event.target.querySelector('button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Verifying...';
    }

    try {
        const { data, error } = await supabase.auth.verifyOtp({
            email: email,
            token: token,
            type: 'email'
        });

        if (error) {
            if (errorEl) errorEl.textContent = sanitizeError(error.message);
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Verify & Login';
            }
            return;
        }

        // Login successful
        isAdmin = true;
        adminEmail = email;
        updateAdminUI();
        closeAdminLoginModal();

        // Reset form
        if (document.getElementById('adminEmail')) {
            document.getElementById('adminEmail').value = '';
            document.getElementById('adminEmail').disabled = false;
        }
        if (document.getElementById('adminOtp')) document.getElementById('adminOtp').value = '';
        if (document.getElementById('otpSection')) document.getElementById('otpSection').style.display = 'none';
        const emailSubmitBtn = document.querySelector('#adminLoginForm button[type="submit"]');
        if (emailSubmitBtn) {
            emailSubmitBtn.style.display = '';
            emailSubmitBtn.textContent = 'Send OTP';
        }
        if (errorEl) errorEl.textContent = '';

    } catch (e) {
        if (errorEl) errorEl.textContent = 'Error: ' + sanitizeError(e.message);
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Verify & Login';
        }
    }
};



// Player Request Functions
let playerPhotoData = null; // Store base64 image data

// Open device camera for photo capture
window.openCamera = function () {
    const input = document.getElementById('playerPhoto');
    if (input) {
        // Set capture to user-facing camera (front camera on mobile)
        input.setAttribute('capture', 'user');
        input.click();
        // Reset capture after click to allow gallery selection later
        setTimeout(() => input.removeAttribute('capture'), 100);
    }
};

window.previewPlayerPhoto = function (event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        playerPhotoData = e.target.result; // Store base64 data
        const preview = document.getElementById('playerPhotoPreview');
        if (preview) {
            if (preview) preview.innerHTML = `<img src="${e.target.result}" alt="Photo preview">`;
            preview.classList.add('has-image');
        }
    };
    reader.readAsDataURL(file);
};

window.openPlayerRequestModal = function () {

    const modal = document.getElementById('playerRequestModal');
    if (modal) modal.classList.add('active');
    // Reset photo
    playerPhotoData = null;
    const preview = document.getElementById('playerPhotoPreview');
    if (preview) {
        if (preview) preview.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                <circle cx="12" cy="13" r="4"></circle>
            </svg>
            <span>Tap to add photo</span>`;
        preview.classList.remove('has-image');
    }
};
window.closePlayerRequestModal = function () {
    const modal = document.getElementById('playerRequestModal');
    if (modal) modal.classList.remove('active');
    // Reset form
    const form = document.getElementById('playerRequestForm');
    if (form) form.reset();
    const successEl = document.getElementById('playerRequestSuccess');
    if (successEl) successEl.style.display = 'none';
    // Reset photo
    playerPhotoData = null;
};
window.submitPlayerRequest = async function (event) {
    event.preventDefault();
    const name = document.getElementById('playerRequestName')?.value;
    const email = document.getElementById('playerRequestEmail')?.value;
    const phone = document.getElementById('playerRequestPhone')?.value;
    const successEl = document.getElementById('playerRequestSuccess');
    const errorEl = document.getElementById('playerRequestError');
    const submitBtn = event.target.querySelector('button[type="submit"]');

    // Clear previous messages
    if (successEl) {
        successEl.style.display = 'none';
    }
    if (errorEl) {
        errorEl.style.display = 'none';
        errorEl.textContent = '';
    }

    // Validate name
    if (!name || name.trim() === '') {
        if (errorEl) {
            errorEl.textContent = 'Please enter your full name.';
            errorEl.style.display = 'block';
        }
        return;
    }

    // Validate email
    if (!email || email.trim() === '') {
        if (errorEl) {
            errorEl.textContent = 'Please enter your email address.';
            errorEl.style.display = 'block';
        }
        return;
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        if (errorEl) {
            errorEl.textContent = 'Please enter a valid email address.';
            errorEl.style.display = 'block';
        }
        return;
    }

    // Validate photo is uploaded
    if (!playerPhotoData) {
        if (errorEl) {
            errorEl.textContent = 'Please upload your photo to continue.';
            errorEl.style.display = 'block';
        }
        return;
    }

    // Check if a request with this email already exists
    try {
        const { data: existingRequests, error: checkError } = await supabase
            .from('player_requests')
            .select('id, email, status')
            .eq('email', email.toLowerCase())
            .in('status', ['pending', 'approved']);

        if (!checkError && existingRequests && existingRequests.length > 0) {
            if (errorEl) {
                errorEl.textContent = 'A request with this email already exists. Please check your email for status.';
                errorEl.style.display = 'block';
            }
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Submit Request';
            }
            return;
        }
    } catch (e) {
        // Table may not exist, continue with submission
    }

    // Show loading state
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';
    }

    // Clear any previous error
    if (errorEl) {
        errorEl.style.display = 'none';
    }

    try {
        // Try to save to Supabase if table exists
        // Include photo as base64 string
        const requestData = {
            name,
            email: email.toLowerCase(),
            phone,
            status: 'pending',
            created_at: new Date().toISOString()
        };

        // Upload photo to Storage if available, store URL (not base64)
        if (playerPhotoData) {
            try {
                // playerPhotoData is a base64 data-URL — convert to Blob for upload
                const res  = await fetch(playerPhotoData);
                const blob = await res.blob();
                // Use a temp ID for the path (email-based) since player ID not assigned yet
                const tempId = 'request_' + Date.now();
                const photoUrl = await api.uploadPlayerPhoto(tempId, blob);
                requestData.photo = photoUrl;
            } catch (photoErr) {
                console.warn('Could not upload request photo to Storage, storing as base64:', photoErr);
                requestData.photo = playerPhotoData; // graceful fallback
            }
        }

        await api.insertPlayerRequest(requestData);

        // Show success message
        if (successEl) {
            successEl.style.display = 'block';
        }

        // Reset button
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Request';
        }

        // Close modal after delay
        setTimeout(() => {
            closePlayerRequestModal();
        }, 2000);
    } catch (e) {
        console.error('[BCC] submitPlayerRequest failed:', e);
        if (errorEl) {
            errorEl.textContent = 'Could not submit your request. Please check your connection and try again.';
            errorEl.style.display = 'block';
        }
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Request';
        }
    }
}

// Admin Player Requests Functions
let pendingPlayerRequests = [];

window.openPlayerRequestsModal = async function () {
    const modal = document.getElementById('playerRequestsModal');
    if (modal) modal.classList.add('active');
    await loadPlayerRequests();
};

window.closePlayerRequestsModal = function () {
    const modal = document.getElementById('playerRequestsModal');
    if (modal) modal.classList.remove('active');
};

async function loadPlayerRequests() {
    // Fetch lock to prevent duplicate calls
    if (_fetchingPlayerRequests) {
        
        return;
    }
    _fetchingPlayerRequests = true;

    const container = document.getElementById('playerRequestsList');
    const bulkActions = document.getElementById('playerRequestsBulkActions');
    if (!container) {
        _fetchingPlayerRequests = false;
        return;
    }

    if (container) container.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-secondary);">Loading...</div>';

    try {
        // First, delete any rejected requests (auto-cleanup)
        try { await api.deleteRejectedPlayerRequests(); } catch(e) {}

        let data = [];
        try {
            data = await api.fetchPendingPlayerRequests();
        } catch(e) { data = []; }

        pendingPlayerRequests = data || [];

        // Update notification badge
        updateNotificationBadge(pendingPlayerRequests.length);

        if (pendingPlayerRequests.length === 0) {
            if (container) container.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-secondary);">No pending requests</div>';
            if (bulkActions) bulkActions.style.display = 'none';
            return;
        }

        // Show bulk actions if there are requests
        if (bulkActions) bulkActions.style.display = 'flex';

        if (container) container.innerHTML = pendingPlayerRequests.map(request => `
            <div class="player-request-card">
                <div class="player-request-checkbox">
                    <input type="checkbox" class="request-checkbox" data-id="${request.id}" data-name="${request.name.replace(/'/g, "\\'")}" data-email="${request.email}" data-phone="${request.phone || ''}" data-photo="${request.photo || ''}" onchange="updateBulkButtons()">
                </div>
                <div class="player-request-info">
                    ${request.photo ? `<img src="${request.photo}" alt="Photo" class="player-request-photo">` :
                `<div class="player-request-photo-placeholder"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></div>`}
                    <div class="player-request-details">
                        <div class="player-request-name">${request.name}</div>
                        <div class="player-request-contact">${request.email}${request.phone ? ' | ' + request.phone : ''}</div>
                    </div>
                </div>
                <div class="player-request-actions">
                    <button class="btn-approve" onclick="approvePlayerRequest('${request.id}', '${request.name.replace(/'/g, "\\'")}', '${request.email}', '${request.phone || ''}', '${request.photo || ''}')">
                        ✓ Approve
                    </button>
                    <button class="btn-reject" onclick="rejectPlayerRequest('${request.id}')">
                        ✗ Reject
                    </button>
                </div>
            </div>
        `).join('');
    } catch (e) {
        if (container) container.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-secondary);">Error loading requests</div>';
    } finally {
        _fetchingPlayerRequests = false;
    }
}

// Toggle select all checkboxes
window.toggleSelectAllRequests = function () {
    const selectAll = document.getElementById('selectAllRequests');
    const checkboxes = document.querySelectorAll('.request-checkbox');
    checkboxes.forEach(cb => cb.checked = selectAll.checked);
    updateBulkButtons();
};

// Update bulk action buttons based on selection
window.updateBulkButtons = function () {
    const checkboxes = document.querySelectorAll('.request-checkbox:checked');
    const bulkActions = document.getElementById('playerRequestsBulkActions');
    if (checkboxes.length > 0) {
        if (bulkActions) bulkActions.style.display = 'flex';
    }
};

// Bulk approve selected requests
window.bulkApproveRequests = async function () {
    const checkboxes = document.querySelectorAll('.request-checkbox:checked');
    if (checkboxes.length === 0) {
        showToast('Please select at least one request', 'warning');
        return;
    }

    const total = checkboxes.length;
    const approved = [];
    const errors = [];
    let done = 0;

    showLoadingModal(`Approving players... (0 / ${total})`);

    for (const cb of checkboxes) {
        const id = cb.dataset.id;
        const name = cb.dataset.name;
        const email = cb.dataset.email;
        const phone = cb.dataset.phone;
        const photo = cb.dataset.photo;

        try {
            // Check for existing player with same email
            const existingPlayer = await api.findPlayerByEmail(email).catch(() => null);

            if (existingPlayer) {
                await api.updatePlayerRequestStatus(id, 'duplicate');
                errors.push(`${name}: Already exists (${existingPlayer.name})`);
                continue;
            }

            // Get the next player_id number
            const existingPlayers = await api.getLastPlayerIdNumber().catch(() => []);
            let nextNum = 1;
            if (existingPlayers && existingPlayers.length > 0) {
                const lastPlayerId = existingPlayers[0].player_id;
                const match = lastPlayerId.match(/BCC(\d+)/);
                if (match) {
                    nextNum = parseInt(match[1], 10) + 1;
                }
            }
            const playerId = 'BCC' + String(nextNum).padStart(3, '0');

            // Add player to players table
            try {
                await api.createPlayer({ playerId, name, email, phone: phone || null, photo: photo || null, rating: 1600, peakRating: 1600, status: 'active', isGuest: false });
                await api.updatePlayerRequestStatus(id, 'approved');
                approved.push(`${name} (${playerId})`);
            } catch(insertErr) {
                errors.push(`${name}: ${sanitizeError(insertErr.message)}`);
            }
        } catch (e) {
            errors.push(`${name}: ${sanitizeError(e.message)}`);
        }
        done++;
        showLoadingModal(`Approving players... (${done} / ${total})`);
    }

    hideLoadingModal();

    if (approved.length > 0) {
        showToast(`${approved.length} player(s) approved: ${approved.join(', ')}`, 'success');
    }
    if (errors.length > 0) {
        showToast(`Errors: ${errors.join(', ')}`, 'error');
    }

    // Refresh the list
    await loadPlayerRequests();

    // Refresh players list
    const dbPlayers = await api.fetchPlayers();
    players = (dbPlayers || []).map(mapPlayerFromDB);
    renderPlayers();
    renderLeaderboard();
    renderDashboard();
};

// Bulk reject selected requests
window.bulkRejectRequests = async function () {
    const checkboxes = document.querySelectorAll('.request-checkbox:checked');
    if (checkboxes.length === 0) {
        showToast('Please select at least one request', 'warning');
        return;
    }

    const total = checkboxes.length;
    const rejected = [];
    let done = 0;

    showLoadingModal(`Rejecting requests... (0 / ${total})`);

    for (const cb of checkboxes) {
        const id = cb.dataset.id;
        const name = cb.dataset.name;

        try {
            await api.updatePlayerRequestStatus(id, 'rejected');
            rejected.push(name);
        } catch (e) {
            console.error('Error rejecting request:', e);
        }
        done++;
        showLoadingModal(`Rejecting requests... (${done} / ${total})`);
    }

    hideLoadingModal();

    if (rejected.length > 0) {
        showToast(`${rejected.length} request(s) rejected`, 'info');
    }

    // Refresh the list
    await loadPlayerRequests();
};

window.approvePlayerRequest = async function (id, name, email, phone, photo) {
    showLoadingModal(`Approving ${name}...`);
    try {
        // Check for existing player with same email
        const existingPlayer = await api.findPlayerByEmail(email).catch(() => null);
        if (existingPlayer) {
            await api.updatePlayerRequestStatus(id, 'duplicate');
            hideLoadingModal();
            showToast(`Player already exists: ${existingPlayer.name}`, 'error');
            return;
        }

        // Get next player ID — fetch all IDs, filter standard BCCxxx, find real max
        const allPlayerIds = await api.getAllPlayerIds().catch(() => []);
        let nextNum = 1;
        for (const row of allPlayerIds) {
            const match = row.player_id?.match(/^BCC(\d{1,6})$/); // only short BCCxxx IDs
            if (match) {
                const n = parseInt(match[1], 10);
                if (n >= nextNum) nextNum = n + 1;
            }
        }
        const playerId = 'BCC' + String(nextNum).padStart(3, '0');

        // Create player
        try {
            await api.createPlayer({ playerId, name, email, phone: phone || null, photo: photo || null, rating: 1600, peakRating: 1600, status: 'active', isGuest: false });
        } catch(createErr) {
            hideLoadingModal();
            console.error('Error adding player:', createErr);
            showToast('Error adding player: ' + sanitizeError(createErr.message), 'error');
            return;
        }

        await api.updatePlayerRequestStatus(id, 'approved');
        hideLoadingModal();
        showToast(`${name} has been added as ${playerId} with rating 1600!`, 'success');

        // Refresh requests list + player views
        await loadPlayerRequests();
        const dbPlayers = await api.fetchPlayers();
        players = (dbPlayers || []).map(mapPlayerFromDB);
        renderPlayers();
        renderLeaderboard();
        renderDashboard();

    } catch (e) {
        hideLoadingModal();
        console.error('Error approving request:', e);
        showToast('Error approving request: ' + sanitizeError(e.message), 'error');
    }
};

window.rejectPlayerRequest = async function (id) {
    showLoadingModal('Rejecting request...');
    try {
        await api.updatePlayerRequestStatus(id, 'rejected');
        hideLoadingModal();
        showToast('Request rejected', 'info');
        await loadPlayerRequests();
    } catch (e) {
        hideLoadingModal();
        console.error('Error rejecting request:', e);
        showToast('Error rejecting request', 'error');
    }
};

// Load pending request count for notification badge (only called manually, not on timer)
let _fetchingPendingCount = false;
async function loadPendingRequestCount() {
    // Fetch lock to prevent duplicate calls
    if (_fetchingPendingCount) {
        
        return;
    }
    _fetchingPendingCount = true;

    try {
        const { count, error } = await supabase
            .from('player_requests')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending');

        if (!error) {
            updateNotificationBadge(count || 0);
        }
    } catch (e) {
        // Ignore errors — badge simply stays as-is
    } finally {
        _fetchingPendingCount = false;
    }
}

// Update notification badge count
function updateNotificationBadge(count) {
    const badges = document.querySelectorAll('.notification-count');
    badges.forEach(badge => {
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : count;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    });
}

// Loading Modal Functions
let _loadingModalTimeout = null;
function showLoadingModal(message = 'Saving...') {
    let modal = document.getElementById('loadingModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'loadingModal';
        modal.className = 'loading-modal';
        modal.innerHTML = `
            <div class="loading-modal-content">
                <div class="loading-spinner"></div>
                <p id="loadingModalMessage">${message}</p>
            </div>
        `;
        document.body.appendChild(modal);
    }
    const messageEl = document.getElementById('loadingModalMessage');
    if (messageEl) messageEl.textContent = message;
    modal.style.display = 'flex';
    modal.onclick = e => e.stopPropagation();

    // Safety timeout — always hide after 30s no matter what
    if (_loadingModalTimeout) clearTimeout(_loadingModalTimeout);
    _loadingModalTimeout = setTimeout(() => {
        hideLoadingModal();
        console.warn('[BCC] Loading modal force-closed after timeout');
    }, 30000);
}

function hideLoadingModal() {
    if (_loadingModalTimeout) { clearTimeout(_loadingModalTimeout); _loadingModalTimeout = null; }
    const modal = document.getElementById('loadingModal');
    if (modal) modal.style.display = 'none';
}

// Silent refresh — refetches data and re-renders current page without any flash
async function silentRefresh() {
    try {
        const [playersRaw, gamesRaw, tournamentsRaw, tpCountMap] = await Promise.all([
            api.fetchPlayers(),
            api.fetchGames(),
            api.fetchTournaments(),
            api.fetchTournamentPlayerCounts()
        ]);

        players = playersRaw.map(mapPlayerFromDB).filter(p => p !== null);
        games = gamesRaw.map(mapGameFromDB).filter(g => g !== null);

        extendedTournaments.length = 0;
        tournamentsRaw.forEach(t => {
            const mapped = mapTournamentFromDB(t);
            if (mapped) {
                if (tpCountMap[mapped.id]) { mapped.players = new Array(tpCountMap[mapped.id]); mapped.playerCount = tpCountMap[mapped.id]; }
                extendedTournaments.push(mapped);
            }
        });

        // Refresh medals cache before re-rendering (non-blocking: if it fails, use old cache)
        try { medalsCache = await api.fetchAllPlayersMedals(); } catch(e) { console.warn('Medals cache refresh failed:', e); }
        try { renderDashboard(); } catch(e) {}
        try { renderLeaderboard(); } catch(e) {}
        try { renderPlayers(); } catch(e) {}
        try { renderGamesLog(); } catch(e) {}
        try { renderTournaments(); } catch(e) {}
        try { populateH2HSelects(); } catch(e) {}
    } catch(e) {
        console.error('Silent refresh failed:', e);
    }
}

// Refresh only tournaments list in memory without re-rendering current view
// Safe to call while a tournament detail modal is open
async function _refreshTournamentsListOnly() {
    try {
        const [tournamentsRaw, tpCountMap] = await Promise.all([
            api.fetchTournaments(),
            api.fetchTournamentPlayerCounts()
        ]);
        extendedTournaments.length = 0;
        tournamentsRaw.forEach(t => {
            const m = mapTournamentFromDB(t);
            if (m) {
                if (tpCountMap[m.id]) { m.players = new Array(tpCountMap[m.id]); m.playerCount = tpCountMap[m.id]; }
                extendedTournaments.push(m);
            }
        });
    } catch(e) { /* silent */ }
}

// Show toast notification
// ── Error sanitisation — strips internal service names from user-visible strings
function sanitizeError(msg) {
    if (!msg) return 'An unexpected error occurred.';
    return String(msg)
        // Service names
        .replace(/supabase/gi, 'the server')
        .replace(/vercel/gi,   'the server')
        .replace(/postgres/gi, 'the database')
        .replace(/postgresql/gi, 'the database')
        // URLs that might leak hostnames
        .replace(/https?:\/\/[^\s"')]+/gi, '[server]')
        // Supabase-style error codes / JWT noise
        .replace(/JWT\s+\w+/gi, 'session error')
        .replace(/PGRST\d+/gi, 'server error')
        // Trim any leftover square-bracket cruft
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function showToast(message, type = 'info') {
    // Remove existing toast if any
    const existingToast = document.querySelector('.custom-toast');
    if (existingToast) {
        existingToast.remove();
    }

    const toast = document.createElement('div');
    toast.className = `custom-toast toast-${type}`;

    const icons = {
        success: '✓',
        error: '✗',
        info: 'ℹ',
        warning: '⚠️¸'
    };

    if (toast) toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span class="toast-message">${message}</span>
    `;

    document.body.appendChild(toast);

    // Trigger animation
    setTimeout(() => {
        toast.classList.add('toast-show');
    }, 10);

    // Auto remove after 4 seconds
    setTimeout(() => {
        toast.classList.remove('toast-show');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 300);
    }, 4000);
}

// Make showToast globally available
window.showToast = showToast;

// ==================== DATA MAPPING (Supabase snake_case -> camelCase) ====================
// This function handles various possible column name formats from Supabase
function mapPlayerFromDB(dbPlayer) {
    if (!dbPlayer || typeof dbPlayer !== 'object') return null;

    // Handle various possible column name formats
    const name = dbPlayer.name || dbPlayer.player_name || dbPlayer.full_name || 'Unknown Player';
    const rating = dbPlayer.bodija_rating || dbPlayer.rating || dbPlayer.current_rating || 1600;
    const peakRating = dbPlayer.peak_rating || dbPlayer.peakRating || dbPlayer.peak_rating || rating;
    const wins = dbPlayer.wins || dbPlayer.win_count || 0;
    const draws = dbPlayer.draws || dbPlayer.draw_count || 0;
    const losses = dbPlayer.losses || dbPlayer.loss_count || 0;
    // Always use whichever is higher — DB counter can drift, computed sum is more reliable
    const gamesPlayed = Math.max(dbPlayer.games_played || 0, wins + draws + losses);

    return {
        id: dbPlayer.id,
        name: name,
        email: dbPlayer.email || null,
        phone: dbPlayer.phone || null,
        photo: dbPlayer.photo || null,
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
        date: dbGame.date || dbGame.created_at || new Date().toISOString().split('T')[0],
        white: dbGame.white_player_id,
        black: dbGame.black_player_id,
        whiteName: dbGame.white_player_name || 'Unknown',
        blackName: dbGame.black_player_name || 'Unknown',
        result: dbGame.result || '0-0',
        tournament: dbGame.tournament_name || dbGame.tournament || '',
        round: dbGame.round_number || dbGame.round || null,
        whiteChange: dbGame.white_rating_change || 0,
        blackChange: dbGame.black_rating_change || 0,
        whiteRatingBefore: dbGame.white_rating_before || null,
        blackRatingBefore: dbGame.black_rating_before || null
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
        total_rounds: dbTournament.total_rounds || 0,
        rounds: [],
        status: dbTournament.status || 'draft',
        current_round: dbTournament.current_round || 0,
        players: [],          // populated by countMap after fetch
        playerCount: 0,       // reliable count — set separately from countMap
        pairings: [],
        standings: [],
        results: []
    };
}

// ==================== INITIALIZATION ====================
window._splashStart = Date.now();

document.addEventListener('DOMContentLoaded', async () => {

    await checkAuthSession();
    initAuthListener();

    

    // Check for local tournament FIRST - restore it but don't skip data fetch
    const localTournament = checkForLocalTournament();
    if (localTournament) {
        
        window._localTournament = localTournament;
        currentTournament = localTournament;
        currentTournament.status = 'Active';
        currentTournamentTab = 'pairings';
        currentViewingRound = localTournament.current_round || 1;
        
        // Do NOT return here — continue to fetch all data normally
    }

    // Check Supabase configuration
    ');

    if (!supabase) {
        console.error('[BCC] FATAL: Supabase client is null. Please check:');
        console.error('[BCC] 1. Create .env file with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
        console.error('[BCC] 2. Restart dev server after adding .env');
        console.error('[BCC] 3. Check console for Supabase config error on load');
        document.body.innerHTML = '<div style="padding:50px;text-align:center;"><h1>⚠️¸ï¸ App Not Configured</h1><p>Supabase credentials missing. Check console for details.</p></div>';
        return;
    }

    

    // ── Phase 1: show skeletons IMMEDIATELY so user sees layout at once ─────
    showDashboardSkeleton();
    showLeaderboardSkeleton();
    showPlayersSkeleton();
    showTournamentsSkeleton();
    setupNavigation();

    // ── Phase 2: fetch dashboard data first (players + games) ─────────────
    try {
        
        const [playersRaw, gamesRaw] = await Promise.all([
            api.fetchPlayers(),
            api.fetchGames(),
        ]);
        players = playersRaw.map(mapPlayerFromDB).filter(p => p !== null);
        games   = gamesRaw.map(mapGameFromDB).filter(g => g !== null);
        

        // Render dashboard immediately with real data
        try { renderDashboard(); _fadeIn('podium'); _fadeIn('recentGames'); } catch(e) { console.error('renderDashboard failed:', e); }

    } catch (e) {
        console.error('[BCC] Fetch error:', e);
        document.body.innerHTML = '<div style="padding:50px;text-align:center;"><h1>⚠️ Error Loading Data</h1><p style="color:var(--text-secondary);font-size:14px;">Could not load app data. Please check your connection and try again.</p><button onclick="location.reload()" style="margin-top:16px;padding:10px 24px;background:var(--accent-gold);color:#000;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px;">Retry</button></div>';
        return;
    }

    // ── Phase 3: fetch tournaments + counts in background ─────────────────
    Promise.all([
        api.fetchTournaments(),
        api.fetchTournamentPlayerCounts(),
    ]).then(([tournamentsRaw, tpCountMap]) => {
        tournamentsRaw.forEach(t => {
            const mapped = mapTournamentFromDB(t);
            if (mapped) {
                if (tpCountMap[mapped.id]) { mapped.players = new Array(tpCountMap[mapped.id]); mapped.playerCount = tpCountMap[mapped.id]; }
                extendedTournaments.push(mapped);
            }
        });
        _dataReady = true;
        

        // Re-render stats with tournament counts, and all background sections
        try { renderStats(); } catch(e) {}
        try { renderLeaderboard(); _fadeIn('leaderboardBody'); } catch(e) { console.error('renderLeaderboard failed:', e); }
        try { renderPlayers(); _fadeIn('playersGrid'); } catch(e) { console.error('renderPlayers failed:', e); }
        try { renderGamesLog(); } catch(e) { console.error('renderGamesLog failed:', e); }
        try { populateH2HSelects(); } catch(e) { console.error('populateH2HSelects failed:', e); }
        try { renderTournaments(); _fadeIn('tournamentsGrid'); } catch(e) { console.error('renderTournaments failed:', e); }

        // Medals cache (non-blocking, triggers re-render of leaderboard/players when ready)
        api.fetchAllPlayersMedals()
            .then(m => { medalsCache = m; try { renderLeaderboard(); renderPlayers(); } catch(e) {} })
            .catch(e => console.warn('Medals initial load failed:', e));

    }).catch(e => {
        console.error('[BCC] Background fetch error:', e);
        _dataReady = true; // allow navigation even if tournaments failed
    });

    // Subscribe to realtime changes — keeps all viewers in sync without manual refresh
    api.subscribeToAllTables({
        onPlayers: (payload) => {
            api.fetchPlayers().then(fresh => {
                if (fresh && fresh.length) {
                    players = fresh.map(mapPlayerFromDB);
                    renderLeaderboard();
                    renderPlayers();
                }
            }).catch(e => console.warn('Realtime player refresh failed:', e));
        },
        onPairings: (payload) => {
            const tournamentId = payload?.new?.tournament_id || payload?.old?.tournament_id;
            if (!tournamentId) return;
            // Skip if this device is the admin running this tournament locally
            if (window._localTournament && !window._localTournament.synced) return;
            // Viewer: re-open tournament detail from DB to show updated pairings
            if (currentTournament && currentTournament.id === tournamentId) {
                openTournamentDetail(tournamentId, currentTournamentTab || 'pairings', currentViewingRound)
                    .catch(e => console.warn('Realtime pairing refresh failed:', e));
            }
        },
        onTournaments: (payload) => {
            // Skip if admin is running a local tournament
            if (window._localTournament && !window._localTournament.synced) return;
            // Skip if a tournament detail is currently being viewed
            if (currentTournament) return;
            api.fetchTournaments().then(fresh => {
                if (fresh) {
                    extendedTournaments.length = 0;
                    fresh.forEach(t => {
                        const mapped = mapTournamentFromDB(t);
                        if (mapped) extendedTournaments.push(mapped);
                    });
                    // Only render list if no tournament is being viewed
                    if (!currentTournament) renderTournaments();
                }
            }).catch(e => console.warn('Realtime tournament refresh failed:', e));
        }
    });

    // Set up search/filter listeners
    setupSearchFilters();

    // Set today's date in the form
    document.getElementById('gameDate').valueAsDate = new Date();

    // Initialize tournaments on load (including restoring saved sections/views)
    await initializeTournaments();

    // If we recovered a local tournament, show recovery banner now that data is loaded (admin only)
    if (window._localTournament && !window._localTournament.synced && isAdmin) {
        showRecoveryBanner(window._localTournament);
    }

    // Hide loading screen — respect minimum splash display time so animation plays fully
    _hideSplashScreen();
});

function _hideSplashScreen() {
    const loadingScreen = document.getElementById('loadingScreen');
    if (!loadingScreen || loadingScreen.style.display === 'none') return;
    const minShow = 3800; // ms — enough for the full letter animation sequence
    const elapsed = window._splashStart ? Date.now() - window._splashStart : minShow;
    const delay = Math.max(0, minShow - elapsed);
    setTimeout(() => {
        loadingScreen.style.transition = 'opacity 0.6s ease';
        loadingScreen.style.opacity = '0';
        setTimeout(() => { loadingScreen.style.display = 'none'; }, 650);
    }, delay);
}

// Safety fallback — hide after 8s no matter what
setTimeout(() => { _hideSplashScreen(); }, 8000);

// ==================== NAVIGATION ====================
function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');

    // Always start at dashboard (temporarily disabled session storage to troubleshoot)
    const savedSection = 'dashboard';

    // Show the section immediately (synchronous)
    showSection(savedSection);

    // Update active nav item based on saved section
    navItems.forEach(nav => {
        if (nav.dataset.section === savedSection) {
            nav.classList.add('active');
        } else {
            nav.classList.remove('active');
        }
    });

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const section = item.dataset.section;
            showSection(section);

            // Save to session storage (temporarily disabled)
            // sessionStorage.setItem('bcc_active_section', section);

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

    if (sectionId === 'tournaments') {
        const live = window._localTournament || (currentTournament?.status?.toLowerCase() === 'active' ? currentTournament : null);
        if (live) {
            currentTournament = live;
            currentTournamentTab = currentTournamentTab || 'pairings';
            renderTournamentDetail();
        } else {
            // Show skeleton immediately, then render real content
            if (!_dataReady) { showTournamentsSkeleton(); return; }
            renderTournaments();
            _fadeIn('tournamentsGrid');
        }
    } else if (sectionId === 'leaderboard') {
        if (!_dataReady) { showLeaderboardSkeleton(); return; }
        renderLeaderboard();
        _fadeIn('leaderboardBody');
    } else if (sectionId === 'players') {
        if (!_dataReady) { showPlayersSkeleton(); return; }
        renderPlayers();
        _fadeIn('playersGrid');
    }
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebarBackdrop').classList.toggle('active');
}

function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarBackdrop').classList.remove('active');
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
    const total = player.games || (player.wins + player.draws + player.losses) || 0;
    // Note: if total still 0, data may not have been synced yet — run recalcStats() from console
    if (total === 0) return 0;
    return Math.round(((player.wins + player.draws * 0.5) / total) * 100);
}

function getPerformanceData(player) {
    // Need at least 3 games to show a trend
    if ((player.games || 0) < 3) return { state: 'neutral', label: '-', class: 'perf-neutral' };

    // Get this player's games from the global games array (sorted newest first)
    // games now includes white_player_id / black_player_id thanks to the updated query
    const playerGames = games
        .filter(g => g.white === player.id || g.black === player.id)
        .sort((a, b) => new Date(b.date) - new Date(a.date));

    // Not enough game records loaded yet — fall back to neutral
    if (playerGames.length === 0) return { state: 'neutral', label: '-', class: 'perf-neutral' };

    // ── FORM: score across last 5 games (max 5 points) ───────────────────────
    const last5 = playerGames.slice(0, 5);
    let formScore = 0;
    last5.forEach(g => {
        const isWhite = g.white === player.id;
        if (g.result === '1/2-1/2') {
            formScore += 0.5;
        } else if ((isWhite && g.result === '1-0') || (!isWhite && g.result === '0-1')) {
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
        const pastRating = (oldestInWindow.white === player.id
            ? oldestInWindow.whiteRatingBefore
            : oldestInWindow.blackRatingBefore) || player.rating;
        ratingDiff = currentRating - pastRating;
    }

    // ── DECISION: hot > up > stable > down ───────────────────────────────────
    if (formPct >= 0.8 || ratingDiff >= 50) {
        return { state: 'hot', icon: '&#x1F525;', class: 'perf-hot' };
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
function calculateNewRating(playerRating, opponentRating, actualScore) {
    const expectedScore = 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
    const kFactor = playerRating < 1600 ? 40 : (games.filter(g => g.white === player.id || g.black === player.id).length < 15 ? 40 : 20);
    return Math.round(playerRating + kFactor * (actualScore - expectedScore));
}

// ==================== DASHBOARD ====================

// ==================== SKELETON SCREENS ====================

const SKELETON_PULSE_CSS = `
@keyframes skeletonPulse {
  0%,100% { opacity: 0.45; }
  50%      { opacity: 0.9; }
}
.skel {
  background: var(--bg-tertiary);
  border-radius: 6px;
  animation: skeletonPulse 1.6s ease-in-out infinite;
  display: inline-block;
}
`;

function _injectSkeletonCSS() {
    if (document.getElementById('skeletonCSS')) return;
    const s = document.createElement('style');
    s.id = 'skeletonCSS';
    s.textContent = SKELETON_PULSE_CSS;
    document.head.appendChild(s);
}

function showDashboardSkeleton() {
    _injectSkeletonCSS();
    // Podium
    const podium = document.getElementById('podium');
    if (podium) podium.innerHTML = [0,1,2].map(i => `
        <div class="podium-place ${['podium-2','podium-1','podium-3'][i]}" style="opacity:0.6;">
            <div class="skel" style="width:48px;height:48px;border-radius:50%;margin:0 auto 8px;"></div>
            <div class="skel" style="width:64px;height:12px;margin:0 auto 6px;"></div>
            <div class="skel" style="width:40px;height:10px;margin:0 auto;"></div>
            <div class="podium-bar" style="opacity:0.3;"></div>
        </div>`).join('');

    // Stats values
    ['totalMembers','totalGames','activeTournaments'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<span class="skel" style="width:32px;height:28px;display:inline-block;border-radius:4px;"></span>';
    });

    // Recent games
    const rg = document.getElementById('recentGames');
    if (rg) rg.innerHTML = [1,2,3,4,5].map(() => `
        <div class="game-item" style="opacity:0.7;">
            <span class="skel" style="width:38px;height:22px;border-radius:4px;"></span>
            <div class="game-players" style="flex:1;display:flex;gap:8px;align-items:center;">
                <span class="skel" style="width:72px;height:13px;"></span>
                <span style="color:var(--text-secondary);font-size:11px;">vs</span>
                <span class="skel" style="width:72px;height:13px;"></span>
            </div>
            <span class="skel" style="width:30px;height:13px;"></span>
            <span class="skel" style="width:36px;height:13px;"></span>
        </div>`).join('');
}

function showLeaderboardSkeleton() {
    _injectSkeletonCSS();
    const tbody = document.getElementById('leaderboardBody');
    if (!tbody) return;
    tbody.innerHTML = [1,2,3,4,5,6,7,8].map((_, i) => `
        <div class="table-row" style="opacity:${1 - i*0.09};">
            <span class="rank-cell"><span class="skel" style="width:18px;height:16px;"></span></span>
            <div class="player-cell" style="gap:8px;">
                <span class="skel" style="width:44px;height:14px;border-radius:10px;"></span>
                <span class="skel" style="width:${80 + Math.random()*40|0}px;height:15px;"></span>
            </div>
            <div></div>
            <span class="skel" style="width:36px;height:15px;"></span>
            <span class="skel mobile-hide" style="width:36px;height:15px;"></span>
            <span class="skel mobile-hide" style="width:24px;height:15px;"></span>
            <span class="skel" style="width:48px;height:15px;"></span>
            <span class="skel" style="width:32px;height:15px;"></span>
            <span class="skel mobile-hide" style="width:50px;height:14px;border-radius:10px;"></span>
        </div>`).join('');
}

function showPlayersSkeleton() {
    _injectSkeletonCSS();
    const grid = document.getElementById('playersGrid');
    if (!grid) return;
    grid.innerHTML = [1,2,3,4,5,6].map(() => `
        <div class="player-card" style="opacity:0.65;pointer-events:none;">
            <div class="player-card-header">
                <div class="player-card-avatar-container">
                    <div class="player-card-avatar skel" style="opacity:0.6;"></div>
                </div>
                <div class="player-card-info" style="gap:6px;display:flex;flex-direction:column;">
                    <div class="skel" style="width:90px;height:16px;"></div>
                    <div class="skel" style="width:52px;height:14px;border-radius:10px;"></div>
                    <div class="skel" style="width:70px;height:13px;border-radius:10px;"></div>
                </div>
            </div>
            <div class="player-card-stats">
                ${[1,2,3].map(() => `<div class="player-card-stat">
                    <div class="skel" style="width:28px;height:22px;margin:0 auto 4px;"></div>
                    <div class="skel" style="width:36px;height:11px;margin:0 auto;"></div>
                </div>`).join('')}
            </div>
            <div class="player-card-rating" style="display:flex;justify-content:space-between;align-items:center;">
                <span class="skel" style="width:90px;height:12px;"></span>
                <span class="skel" style="width:36px;height:18px;"></span>
            </div>
        </div>`).join('');
}

function showTournamentsSkeleton() {
    _injectSkeletonCSS();
    const grid = document.getElementById('tournamentsGrid');
    if (!grid) return;
    grid.innerHTML = [1,2,3].map(() => `
        <div class="tournament-card" style="opacity:0.65;pointer-events:none;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
                <div style="display:flex;flex-direction:column;gap:8px;flex:1;">
                    <div class="skel" style="width:140px;height:18px;"></div>
                    <div class="skel" style="width:90px;height:13px;"></div>
                </div>
                <div class="skel" style="width:60px;height:22px;border-radius:10px;"></div>
            </div>
            <div style="display:flex;gap:12px;">
                ${[1,2,3].map(() => `<div style="flex:1;text-align:center;">
                    <div class="skel" style="width:32px;height:20px;margin:0 auto 4px;"></div>
                    <div class="skel" style="width:50px;height:11px;margin:0 auto;"></div>
                </div>`).join('')}
            </div>
        </div>`).join('');
}

// Fade real content in after render
function _fadeIn(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.28s ease';
    requestAnimationFrame(() => {
        requestAnimationFrame(() => { el.style.opacity = '1'; });
    });
}


function renderDashboard() {
    renderPodium();
    renderStats();
    renderRecentGames();
}

function renderPodium() {
    const sorted = [...players].sort((a, b) => b.rating - a.rating).slice(0, 3);
    const podium = document.getElementById('podium');

    if (!podium) return;

    // Order: 2nd, 1st, 3rd
    const order = [1, 0, 2];
    const classes = ['podium-2', 'podium-1', 'podium-3'];
    const medalClasses = ['silver', 'gold', 'bronze'];

    if (podium) podium.innerHTML = order.map((idx, displayIdx) => {
        const player = sorted[idx];
        if (!player) return '';
        const avatarContent = player.photo
            ? `<img src="${player.photo}" alt="${player.name}" class="podium-avatar-img">`
            : `<div class="podium-avatar ${medalClasses[displayIdx]}">${getInitials(player.name)}</div>`;
        return `
            <div class="podium-place ${classes[displayIdx]}" >
                        <div class="podium-rank">${idx + 1}</div>
                        <div class="podium-avatar-container ${medalClasses[displayIdx]}">${avatarContent}</div>
                        <div class="podium-name">${player.name}</div>
                        <div class="podium-rating">${player.rating}</div>
                        <div class="podium-bar"></div>
                    </div >
            `;
    }).join('');
}

function renderStats() {
    const totalMembers = document.getElementById('totalMembers');
    if (totalMembers) totalMembers.textContent = players.length;
    const totalGames = document.getElementById('totalGames');
    if (totalGames) totalGames.textContent = games.length;
    const activeCount = extendedTournaments.filter(t => t.status === 'active' || t.status === 'Active').length;
    const activeTournaments = document.getElementById('activeTournaments');
    if (activeTournaments) activeTournaments.textContent = activeCount;

    // Render live tournament banner card inside stats-container
    _renderLiveTournamentBanner();
}

function _renderLiveTournamentBanner() {
    const banner = document.getElementById('liveTournamentBanner');
    if (!banner) return;

    const local = window._localTournament && !window._localTournament.synced ? window._localTournament : null;
    const dbActive = extendedTournaments.find(t => t.status?.toLowerCase() === 'active' && (!local || t.id !== local.id));
    const t = local || dbActive;

    if (!t) {
        banner.style.display = 'none';
        banner.innerHTML = '';
        return;
    }

    const progress = t.total_rounds > 0
        ? Math.round(((( t.current_round || 1) - 1) / t.total_rounds) * 100)
        : 0;
    const playerCount = t.players?.length || 0;

    // onclick — works on mobile too (no hover events needed)
    const clickFn = local
        ? `openFirstActiveTournament()`
        : `openTournamentDetail('${t.id}')`;

    banner.style.display = 'block';
    // Always use openFirstActiveTournament — it handles both local and DB active
    banner.innerHTML = `
        <div onclick="openFirstActiveTournament()"
             style="margin-top:12px;background:linear-gradient(135deg,rgba(240,165,0,0.12),rgba(240,165,0,0.04));
                    border:1.5px solid rgba(240,165,0,0.4);border-radius:12px;padding:14px 16px;
                    cursor:pointer;-webkit-tap-highlight-color:transparent;user-select:none;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                <div style="display:flex;align-items:center;gap:8px;">
                    <span style="width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block;
                                 animation:blink 1.2s infinite;flex-shrink:0;"></span>
                    <span style="color:var(--accent-gold);font-weight:700;font-size:12px;letter-spacing:0.5px;">LIVE</span>
                </div>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                     fill="none" stroke="var(--accent-gold)" stroke-width="2.5"
                     stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
            </div>
            <div style="font-weight:700;font-size:15px;color:var(--text-primary);margin-bottom:3px;">${t.name}</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-bottom:10px;">
                Round ${t.current_round || 1} of ${t.total_rounds || '?'} &nbsp;&middot;&nbsp; ${playerCount} players
            </div>
            <div style="background:var(--bg-tertiary);border-radius:4px;height:4px;overflow:hidden;">
                <div style="height:100%;width:${progress}%;background:var(--accent-gold);border-radius:4px;"></div>
            </div>
            <div style="font-size:11px;color:var(--text-secondary);margin-top:5px;text-align:right;">
                ${progress}% complete &nbsp;&middot;&nbsp; tap to view
            </div>
        </div>`;
}

function renderRecentGames() {
    const container = document.getElementById('recentGames');

    if (!container) return;

    if (!games || games.length === 0) {
        if (container) container.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-secondary);">No recent games. Add games to see them here.</div>';
        return;
    }

    const recentGames = [...games].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);

    if (container) container.innerHTML = recentGames.map(game => {
        // Use stored player names from the game record
        const whiteName = game.whiteName || 'Unknown';
        const blackName = game.blackName || 'Unknown';

        let resultClass = 'draw';
        let resultText = '1/2-1/2';
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
                            <span class="game-player">${whiteName}</span>
                            <span class="game-vs"> vs </span>
                            <span class="game-player">${blackName}</span>
                        </div>
                        <span class="game-rating-change ${ratingChange >= 0 ? 'positive' : 'negative'}">${ratingChange >= 0 ? '+' : ''}${ratingChange}</span>
                        <span class="game-date">${game.date?.slice(5) || ''}</span>
                    </div >
            `;
    }).join('');
}

// ==================== LEADERBOARD ====================

// Build a compact inline medal stack for leaderboard/cards/detail header
function _buildMedalStack(playerId, size = 22, maxShow = 3, clickable = true) {
    const medals = medalsCache[playerId] || [];
    if (!medals.length) return '';
    const emoji  = { 1: '🥇', 2: '🥈', 3: '🥉' };
    const color  = { 1: '#FFD700', 2: '#C0C0C0', 3: '#CD7F32' };
    const label  = { 1: '1st', 2: '2nd', 3: '3rd' };
    const shown  = medals.slice(0, maxShow);
    const extra  = medals.length - shown.length;
    const click  = clickable ? `onclick="event.stopPropagation();openMedalsModal('${playerId}')"` : '';
    const pxSize = size + 'px';
    const fontSize = Math.round(size * 0.55) + 'px';

    const badges = shown.map((m, i) => {
        const dateStr = m.date ? new Date(m.date).toLocaleDateString('en-US',{month:'short',year:'numeric'}) : '';
        const tip = label[m.position] + ' · ' + m.tournamentName + ' · ' + dateStr;
        return `<span title="${tip}" ${click} style="
            display:inline-flex;align-items:center;justify-content:center;
            width:${pxSize};height:${pxSize};border-radius:50%;
            background:radial-gradient(circle at 35% 35%,${color[m.position]}44,${color[m.position]}18);
            border:1.5px solid ${color[m.position]}77;
            font-size:${fontSize};cursor:${clickable?'pointer':'default'};
            box-shadow:0 1px 4px ${color[m.position]}44;
            margin-left:${i>0?'-6px':'0'};z-index:${maxShow-i};position:relative;
            transition:transform 0.15s,z-index 0s;flex-shrink:0;"
            onmouseenter="this.style.transform='scale(1.25)';this.style.zIndex=99"
            onmouseleave="this.style.transform='scale(1)';this.style.zIndex=${maxShow-i}"
        >${emoji[m.position]}</span>`;
    }).join('');

    const overflow = extra > 0 ? `<span ${click} title="View all medals" style="
        display:inline-flex;align-items:center;justify-content:center;
        width:${pxSize};height:${pxSize};border-radius:50%;
        background:var(--bg-tertiary);border:1.5px solid rgba(255,255,255,0.15);
        font-size:${Math.round(size*0.38)+'px'};font-weight:700;color:var(--text-secondary);
        cursor:pointer;margin-left:-6px;z-index:0;position:relative;flex-shrink:0;
        transition:background 0.15s,color 0.15s;"
        onmouseenter="this.style.background='var(--accent-gold)';this.style.color='#000'"
        onmouseleave="this.style.background='var(--bg-tertiary)';this.style.color='var(--text-secondary)'"
    >+${extra}</span>` : '';

    return `<span style="display:inline-flex;align-items:center;">${badges}${overflow}</span>`;
}

function renderLeaderboard() {
    const tbody = document.getElementById('leaderboardBody');

    if (!players || players.length === 0) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 40px; color: var(--text-secondary);">No players found. Add players to the database to see them here.</td></tr>';
        return;
    }

    // Filter out guest players
    const nonGuestPlayers = players.filter(p => p && !p.isGuest);
    const sorted = [...nonGuestPlayers].sort((a, b) => getRatingForCategory(b, window.activeLeaderboardCategory) - getRatingForCategory(a, window.activeLeaderboardCategory));
    const searchTerm = document.getElementById('leaderboardSearch')?.value?.toLowerCase() || '';
    const filtered = sorted.filter(p => p && (searchTerm === '' || (p.name && p.name.toLowerCase().includes(searchTerm))));

    if (tbody) tbody.innerHTML = filtered.map((player, idx) => {
        if (!player) return '';
        const title = getTitle(getRatingForCategory(player, window.activeLeaderboardCategory));
        const winRate = calculateWinRate(player);
        const perf = getPerformanceData(player);

        return `
            <div class="table-row fade-in" onclick="openPlayerDetail('${player?.id ?? ''}')" title="Tap for details">
                        <span class="rank-cell">${idx + 1}</span>
                        <div class="player-cell">
                            <span class="title-badge ${title.class}">${title.title}</span>
                            <span class="player-name">${player?.name ?? 'Unknown'}</span>
                            ${_buildMedalStack(player.id, 20, 3)}
                        </div>
                        <div class="perf-indicator">
                            ${perf.state === 'neutral'
                ? `<span class="perf-neutral">${perf.label}</span>`
                : `<span class="perf-icon ${perf.class}">${perf.icon}</span>`}
                        </div>
                        <span class="rating-cell">${getRatingForCategory(player, window.activeLeaderboardCategory)}</span>
                        <span class="mobile-hide">${getPeakRatingForCategory(player, window.activeLeaderboardCategory)}</span>
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
        if (grid) grid.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-secondary);">No players found. Add players to the database to see them here.</div>';
        return;
    }

    // Filter out guest players
    const nonGuestPlayers = players.filter(p => p && !p.isGuest);

    if (grid) grid.innerHTML = nonGuestPlayers.map(player => {
        if (!player) return '';
        const title = getTitle(getRatingForCategory(player, window.activeLeaderboardCategory));
        const winRate = calculateWinRate(player);
        const avatarContent = player.photo
            ? `<img src="${player.photo}" alt="${player.name}" class="player-card-avatar-img">`
            : `<div class="player-card-avatar">${getInitials(player?.name ?? 'Unknown')}</div>`;

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
                        <div class="player-card-rating">
                            <span class="player-card-rating-label">Current Rating</span>
                            <span class="player-card-rating-value">${player?.rating ?? 1600}</span>
                        </div>
                    </div >
            `;
    }).join('');
}

// ==================== ADMIN PHOTO EDIT ====================

// Admin: handle photo file selection → compress → upload → re-render
window.adminUpdatePlayerPhoto = async function(playerId, inputEl) {
    const file = inputEl.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showToast('Please select an image file', 'error');
        return;
    }

    showLoadingModal('Uploading photo...');

    try {
        // Compress to a small JPEG blob (not base64) before uploading to Storage
        const blob = await _compressImageToBlob(file, 400, 0.82);

        // Upload to Supabase Storage → get back a public URL
        const publicUrl = await api.uploadPlayerPhoto(playerId, blob);

        // Update local cache with the URL (tiny string, not a huge base64)
        const idx = players.findIndex(p => p.id === playerId);
        if (idx !== -1) players[idx].photo = publicUrl;

        hideLoadingModal();
        showToast('Profile photo updated!', 'success');

        // Re-render all surfaces that show this player
        openPlayerDetail(playerId);
        renderPlayers();
        renderLeaderboard();
        renderDashboard();

    } catch (e) {
        hideLoadingModal();
        console.error('Photo upload failed:', e);
        showToast('Could not save photo — check Storage bucket permissions.', 'error');
    }

    inputEl.value = ''; // reset so same file can be picked again
};

// Compress image File → Blob (JPEG), max maxSize px on longest side.
// Returns a Blob — NOT a base64 string — so it can be streamed to Storage.
function _compressImageToBlob(file, maxSize, quality) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let w = img.width, h = img.height;
                if (w > h) { if (w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; } }
                else        { if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize; } }
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                canvas.toBlob(blob => {
                    if (blob) resolve(blob);
                    else reject(new Error('Canvas toBlob failed'));
                }, 'image/jpeg', quality);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Legacy helper kept in case anything else calls it (returns base64 data-URL)
function _compressImage(file, maxSize, quality) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let w = img.width, h = img.height;
                if (w > h) { if (w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; } }
                else        { if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize; } }
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
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

    // Admin-editable avatar: wrap in a clickable overlay if admin
    const avatarInner = player.photo
        ? `<img src="${player.photo}" alt="${player.name}" class="player-detail-avatar-img" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid var(--accent-gold);">`
        : `<div class="player-detail-avatar">${getInitials(player.name)}</div>`;

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
                                ${perf.state === 'neutral'
            ? `<span class="perf-new">${perf.label}</span>`
            : `<span class="perf-icon ${perf.class}">${perf.icon}</span>`}
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
        } catch(e) {
            renderRatingChart([player.rating]);
        }
    }, 100);

    document.getElementById('playerDetailModal').classList.add('active');

}

async function _loadPlayerMedals(playerId) {
    const container = document.getElementById('playerMedalsList');
    if (!container) return;
    try {
        const medals = await api.fetchPlayerMedals(playerId);
        if (!medals || medals.length === 0) {
            container.innerHTML = '<span style="font-size:13px;color:var(--text-secondary);opacity:0.55;">No medals yet</span>';
            return;
        }

        const medalEmoji = { 1: '🥇', 2: '🥈', 3: '🥉' };
        const medalColor = { 1: '#FFD700', 2: '#C0C0C0', 3: '#CD7F32' };
        const medalLabel = { 1: '1st Place', 2: '2nd Place', 3: '3rd Place' };
        const SHOW = 4; // show first 4, stack rest

        const visible = medals.slice(0, SHOW);
        const hidden  = medals.slice(SHOW);

        const medalHtml = visible.map((m, i) => {
            const dateStr = m.date ? new Date(m.date).toLocaleDateString('en-US', { year:'numeric', month:'short' }) : '';
            const tooltip = `${medalLabel[m.position]} — ${m.tournamentName}\n${dateStr} · ${m.wins}W · ${m.ratingChange >= 0 ? '+' : ''}${m.ratingChange} rating`;
            return `<div class="medal-badge" title="${tooltip}" style="
                position:relative; display:inline-flex; align-items:center; justify-content:center;
                width:40px; height:40px; border-radius:50%;
                background:radial-gradient(circle at 35% 35%, ${medalColor[m.position]}33, ${medalColor[m.position]}11);
                border:2px solid ${medalColor[m.position]}66;
                cursor:pointer; font-size:20px;
                box-shadow:0 2px 8px ${medalColor[m.position]}33;
                transition:transform 0.15s, box-shadow 0.15s;
                margin-left:${i > 0 ? '-8px' : '0'};
                z-index:${SHOW - i};"
                onmouseenter="this.style.transform='scale(1.18)';this.style.zIndex=99;this.style.boxShadow='0 4px 16px ${medalColor[m.position]}66'"
                onmouseleave="this.style.transform='scale(1)';this.style.zIndex=${SHOW - i};this.style.boxShadow='0 2px 8px ${medalColor[m.position]}33'"
                onclick="openMedalsModal('${playerId}')">
                ${medalEmoji[m.position]}
            </div>`;
        }).join('');

        const overflowHtml = hidden.length > 0 ? `
            <div onclick="openMedalsModal('${playerId}')" style="
                display:inline-flex;align-items:center;justify-content:center;
                width:40px;height:40px;border-radius:50%;
                background:var(--bg-tertiary);border:2px solid var(--bg-tertiary);
                font-size:12px;font-weight:700;color:var(--text-secondary);
                cursor:pointer;margin-left:-8px;z-index:0;position:relative;
                transition:background 0.15s;"
                onmouseenter="this.style.background='var(--accent-gold)';this.style.color='#000'"
                onmouseleave="this.style.background='var(--bg-tertiary)';this.style.color='var(--text-secondary)'">
                +${hidden.length}
            </div>` : '';

        const viewAllHtml = `<button onclick="openMedalsModal('${playerId}')" style="
            background:none;border:none;color:var(--accent-gold);font-size:12px;
            cursor:pointer;margin-left:8px;opacity:0.8;padding:0;text-decoration:underline;">
            View all
        </button>`;

        container.innerHTML = `<div style="display:flex;align-items:center;">${medalHtml}${overflowHtml}</div>${viewAllHtml}`;

    } catch(e) {
        console.warn('Medals load failed:', e);
        const container2 = document.getElementById('playerMedalsList');
        if (container2) container2.innerHTML = '<span style="font-size:13px;color:var(--text-secondary);opacity:0.5;">Could not load medals</span>';
    }
}

// Store medals data for the modal
let _currentMedals = [];
let _currentMedalsPlayerId = null;

async function openMedalsModal(playerId) {
    const player = players.find(p => p.id === playerId);
    if (!player) return;

    // Reuse data if same player
    if (_currentMedalsPlayerId !== playerId) {
        _currentMedals = await api.fetchPlayerMedals(playerId).catch(() => []);
        _currentMedalsPlayerId = playerId;
    }

    const medalEmoji  = { 1: '🥇', 2: '🥈', 3: '🥉' };
    const medalColor  = { 1: '#FFD700', 2: '#C0C0C0', 3: '#CD7F32' };
    const medalLabel  = { 1: '1st Place — Champion', 2: '2nd Place — Runner-up', 3: '3rd Place' };
    const positionBg  = { 1: 'rgba(255,215,0,0.08)', 2: 'rgba(192,192,192,0.08)', 3: 'rgba(205,127,50,0.08)' };

    const rows = _currentMedals.map(m => {
        const dateStr = m.date ? new Date(m.date).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }) : '';
        const gain    = m.ratingChange >= 0 ? `+${m.ratingChange}` : `${m.ratingChange}`;
        return `
            <div style="display:flex;align-items:center;gap:14px;padding:14px 16px;
                        background:${positionBg[m.position]};border-radius:12px;
                        border:1px solid ${medalColor[m.position]}22;margin-bottom:8px;">
                <div style="font-size:32px;flex-shrink:0;filter:drop-shadow(0 2px 6px ${medalColor[m.position]}66);">
                    ${medalEmoji[m.position]}
                </div>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:700;font-size:14px;color:var(--text-primary);
                                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                        ${m.tournamentName}
                    </div>
                    <div style="font-size:12px;color:${medalColor[m.position]};font-weight:600;margin-top:2px;">
                        ${medalLabel[m.position]}
                    </div>
                    <div style="font-size:11px;color:var(--text-secondary);margin-top:3px;">
                        ${dateStr} &nbsp;·&nbsp; ${m.wins}W &nbsp;·&nbsp; ${gain} rating
                    </div>
                </div>
            </div>`;
    }).join('');

    const emptyHtml = _currentMedals.length === 0
        ? '<div style="text-align:center;padding:32px;color:var(--text-secondary);opacity:0.55;font-size:14px;">No medals yet</div>'
        : '';

    let modal = document.getElementById('medalsModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'medalsModal';
        modal.className = 'modal-overlay';
        modal.onclick = (e) => { if (e.target === modal) closeMedalsModal(); };
        document.body.appendChild(modal);
    }
    modal.innerHTML = `
        <div class="modal" style="max-width:500px;width:95%;max-height:80vh;overflow-y:auto;">
            <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;">
                <h2 class="modal-title" style="margin:0;">${player.name}'s Medals</h2>
                <button onclick="closeMedalsModal()" style="background:none;border:none;color:var(--text-secondary);cursor:pointer;padding:4px;display:flex;align-items:center;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            <div style="padding:4px 0 8px;">
                <div style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">
                    ${_currentMedals.length} medal${_currentMedals.length !== 1 ? 's' : ''} earned
                </div>
                ${rows}${emptyHtml}
            </div>
        </div>`;
    modal.classList.add('active');
}

function closeMedalsModal() {
    const modal = document.getElementById('medalsModal');
    if (modal) modal.classList.remove('active');
}

window.openMedalsModal  = openMedalsModal;
window.closeMedalsModal = closeMedalsModal;

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
                const opp = getPlayerById(opponentId);
                h2h[opponentId] = { name: opp?.name || 'Unknown', wins: 0, draws: 0, losses: 0 };
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

// ==================== FORMATTING HELPERS ====================
function formatResult(result) {
    if (result === '1/2-1/2') return '1/2-1/2';
    return result;
}

// Format a single score part (e.g., "1/2" -> "1/2")
function formatScorePart(score) {
    if (score === '1/2') return '1/2';
    return score;
}

function formatPoints(val) {
    const num = Number(val) || 0;
    const whole = Math.floor(num);
    const hasHalf = (num - whole) >= 0.4 && (num - whole) <= 0.6;
    if (hasHalf) return whole === 0 ? '½' : `${whole}½`;
    return String(whole);
}

// ==================== GAMES LOG ====================

function renderGamesLog() {
    const container = document.getElementById('gamesLogBody');

    if (!games || games.length === 0) {
        if (container) container.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--text-secondary);">No games found. Add games to the database to see them here.</td></tr>';
        return;
    }

    const tournamentFilter = document.getElementById('tournamentFilter').value;

    let filtered = [...games].sort((a, b) => new Date(b.date) - new Date(a.date));

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

        return `
            <div class="table-row fade-in" onclick = "openGameDetail('${game?.id ?? ''}')" style = "cursor: pointer;" >
                        <span class="mobile-hide">${idx + 1}</span>
                        <span>${game.date || ''}</span>
                        <span>${whiteName}</span>
                        <div style="display: flex; justify-content: center;">
                            <span class="result-badge ${resultClass}">${formatResult(game.result)}</span>
                        </div>
                        <span>${blackName}</span>
                        <span class="single-line-text mobile-hide">${game.tournament || '-'}</span>
                        <span class="rating-change ${game.whiteChange >= 0 ? 'positive' : 'negative'} mobile-hide">${game.whiteChange >= 0 ? '+' : ''}${game.whiteChange}</span>
                        <span class="rating-change ${game.blackChange >= 0 ? 'positive' : 'negative'} mobile-hide">${game.blackChange >= 0 ? '+' : ''}${game.blackChange}</span>
            </div>
            `;
    }).join('');
}

// ==================== HEAD-TO-HEAD ANALYTICS ====================
let h2hActiveFilter = 'all';

function populateH2HSelects() {
    const sel1 = document.getElementById('h2hPlayer1');
    const sel2 = document.getElementById('h2hPlayer2');
    if (!sel1 || !sel2) return;

    const sorted = [...players].sort((a, b) => a.name.localeCompare(b.name));
    const opts = sorted.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (sel1) sel1.innerHTML = '<option value="">Player 1</option>' + opts;
    if (sel2) sel2.innerHTML = '<option value="">Player 2</option>' + opts;
}

function classifyTimeControl(tcStr) {
    if (!tcStr) return 'rapid';
    const str = tcStr.toLowerCase().trim();
    if (str.includes('bullet') || str === '1+0' || str === '1+1' || str === '2+1' || str === '2+0') return 'bullet';
    if (str.includes('blitz') || str === '3+0' || str === '3+2' || str === '5+0' || str === '5+3' || str === '5+2') return 'blitz';
    if (str.includes('rapid') || str.includes('10') || str.includes('15') || str.includes('30') || str.includes('60')) return 'rapid';
    return 'rapid';
}

function getGameTimeControl(game) {
    // Try to get from tournament
    if (game.tournament) {
        const t = extendedTournaments.find(t => t.name === game.tournament || t.id === game.tournament_id);
        if (t && t.timeControl) return classifyTimeControl(t.timeControl);
    }
    return 'rapid'; // default
}

function openH2HModal() {
    const p1id = document.getElementById('h2hPlayer1').value;
    const p2id = document.getElementById('h2hPlayer2').value;
    const modal = document.getElementById('h2hModal');
    const container = document.getElementById('h2hContent');

    if (!p1id || !p2id) {
        // Open modal with a prompt to select both players
        const sorted = [...players].sort((a, b) => a.name.localeCompare(b.name));
        const opts = sorted.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
        if (container) container.innerHTML = `
            <div style="padding: 32px 20px; text-align: center;">
                <p style="color: var(--text-secondary); margin-bottom: 20px; font-size: 14px;">Select both players from the dropdowns above, then click Compare.</p>
                <div style="display: flex; gap: 10px; align-items: center; justify-content: center; flex-wrap: wrap;">
                    <select id="h2hPlayer1Inline" class="form-select" style="padding: 10px 12px; font-size: 14px; min-width: 140px;">
                        <option value="">Player 1</option>${opts}
                    </select>
                    <span style="color: var(--text-secondary); font-weight: 700;">vs</span>
                    <select id="h2hPlayer2Inline" class="form-select" style="padding: 10px 12px; font-size: 14px; min-width: 140px;">
                        <option value="">Player 2</option>${opts}
                    </select>
                    <button class="btn-primary" onclick="compareInline()" style="padding: 10px 20px;">Compare</button>
                </div>
            </div>`;
        modal.classList.add('active');
        return;
    }
    if (p1id === p2id) {
        showToast('Please select two different players', 'error');
        return;
    }

    h2hActiveFilter = 'all';
    renderH2HContent(p1id, p2id);
    modal.classList.add('active');
}

function closeH2HModal() {
    document.getElementById('h2hModal').classList.remove('active');
}

function openH2HModalMobile() {
    const container = document.getElementById('h2hContent');
    const sorted = [...players].sort((a, b) => a.name.localeCompare(b.name));
    const opts = sorted.map(p => `<option value="${p.id}">${p.name}</option>`).join('');

    if (container) container.innerHTML = `
        <div style="padding: 20px;">
            <p style="color: var(--text-secondary); font-size: 13px; margin-bottom: 16px;">Select two players to compare their head-to-head record.</p>
            <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 20px; flex-wrap: wrap;">
                <select id="h2hMobileP1" class="form-select" style="flex: 1; min-width: 120px; padding: 10px 12px; font-size: 14px;">
                    <option value="">Player 1</option>${opts}
                </select>
                <span style="color: var(--text-secondary); font-weight: 700; font-size: 12px;">vs</span>
                <select id="h2hMobileP2" class="form-select" style="flex: 1; min-width: 120px; padding: 10px 12px; font-size: 14px;">
                    <option value="">Player 2</option>${opts}
                </select>
            </div>
            <button class="btn-primary" onclick="compareFromMobile()" style="width: 100%; padding: 12px; font-size: 14px;">Compare</button>
        </div>
    `;
    document.getElementById('h2hModal').classList.add('active');
}

function compareInline() {
    const p1id = document.getElementById('h2hPlayer1Inline')?.value;
    const p2id = document.getElementById('h2hPlayer2Inline')?.value;
    if (!p1id || !p2id) { showToast('Select both players', 'error'); return; }
    if (p1id === p2id) { showToast('Select two different players', 'error'); return; }
    // Also sync the main selects so subsequent Compare clicks work
    const sel1 = document.getElementById('h2hPlayer1');
    const sel2 = document.getElementById('h2hPlayer2');
    if (sel1) sel1.value = p1id;
    if (sel2) sel2.value = p2id;
    h2hActiveFilter = 'all';
    renderH2HContent(p1id, p2id);
}

function compareFromMobile() {
    const p1id = document.getElementById('h2hMobileP1').value;
    const p2id = document.getElementById('h2hMobileP2').value;

    if (!p1id || !p2id) {
        showToast('Please select both players', 'error');
        return;
    }
    if (p1id === p2id) {
        showToast('Please select two different players', 'error');
        return;
    }

    h2hActiveFilter = 'all';
    renderH2HContent(p1id, p2id);
}

function switchH2HFilter(filter, p1id, p2id) {
    h2hActiveFilter = filter;
    renderH2HContent(p1id, p2id);
}

function renderH2HContent(p1id, p2id) {
    const container = document.getElementById('h2hContent');
    const p1 = getPlayerById(p1id);
    const p2 = getPlayerById(p2id);

    // Find all games between these two players
    let h2hGames = games.filter(g =>
        (g.white === p1id && g.black === p2id) ||
        (g.white === p2id && g.black === p1id)
    );

    // Classify each game
    h2hGames = h2hGames.map(g => ({
        ...g,
        tc: getGameTimeControl(g)
    }));

    // Count by category for tab badges
    const counts = { all: h2hGames.length, rapid: 0, blitz: 0, bullet: 0 };
    h2hGames.forEach(g => { if (counts[g.tc] !== undefined) counts[g.tc]++; });

    // Apply filter
    let filtered = h2hActiveFilter === 'all' ? h2hGames : h2hGames.filter(g => g.tc === h2hActiveFilter);

    // Calculate stats
    let p1Wins = 0, p2Wins = 0, draws = 0;
    filtered.forEach(g => {
        const p1IsWhite = g.white === p1id;
        if (g.result === '1-0') { p1IsWhite ? p1Wins++ : p2Wins++; }
        else if (g.result === '0-1') { p1IsWhite ? p2Wins++ : p1Wins++; }
        else { draws++; }
    });

    const total = p1Wins + p2Wins + draws;
    const p1Pct = total > 0 ? Math.round((p1Wins / total) * 100) : 0;
    const p2Pct = total > 0 ? Math.round((p2Wins / total) * 100) : 0;
    const drawPct = total > 0 ? 100 - p1Pct - p2Pct : 0;

    const filterLabels = [
        { key: 'all', label: 'All', icon: '♟' },
        { key: 'rapid', label: 'Rapid', icon: '⏱' },
        { key: 'blitz', label: 'Blitz', icon: '⚡' },
        { key: 'bullet', label: 'Bullet', icon: '●' }
    ];

    if (container) container.innerHTML = `
        <div style="padding: 20px;">
            <!-- Player Names Banner -->
            <div style="display: flex; justify-content: center; align-items: center; gap: 16px; margin-bottom: 20px;">
                <div style="text-align: center;">
                    <div style="font-size: 20px; font-weight: 700; color: var(--text-primary);">${p1.name}</div>
                    <div style="font-size: 12px; color: var(--text-secondary);">Rating: ${p1.rating}</div>
                </div>
                <div style="font-size: 16px; font-weight: 700; color: var(--accent-gold); padding: 6px 14px; background: rgba(255,215,0,0.1); border-radius: 8px;">VS</div>
                <div style="text-align: center;">
                    <div style="font-size: 20px; font-weight: 700; color: var(--text-primary);">${p2.name}</div>
                    <div style="font-size: 12px; color: var(--text-secondary);">Rating: ${p2.rating}</div>
                </div>
            </div>

            <!-- Time Control Tabs -->
            <div class="round-nav" style="margin-bottom: 20px; justify-content: center;">
                ${filterLabels.map(f => `
                    <div class="round-pill ${h2hActiveFilter === f.key ? 'active' : ''}" onclick="switchH2HFilter('${f.key}', '${p1id}', '${p2id}')" style="cursor: pointer;">
                        ${f.icon} ${f.label} <span style="opacity: 0.6; font-size: 11px; margin-left: 2px;">(${counts[f.key]})</span>
                    </div>
                `).join('')}
            </div>

            ${total === 0 ? `
                <div style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">
                    <p>No games found between these players${h2hActiveFilter !== 'all' ? ' in this time control' : ''}.</p>
                </div>
            ` : `
                <!-- Score Bar -->
                <div style="display: flex; border-radius: 8px; overflow: hidden; height: 32px; margin-bottom: 20px; font-size: 12px; font-weight: 600;">
                    ${p1Pct > 0 ? `<div style="width: ${p1Pct}%; background: var(--success); display: flex; align-items: center; justify-content: center; color: white; min-width: 30px;">${p1Wins}</div>` : ''}
                    ${drawPct > 0 ? `<div style="width: ${drawPct}%; background: var(--text-secondary); display: flex; align-items: center; justify-content: center; color: white; min-width: 30px;">${draws}</div>` : ''}
                    ${p2Pct > 0 ? `<div style="width: ${p2Pct}%; background: var(--danger); display: flex; align-items: center; justify-content: center; color: white; min-width: 30px;">${p2Wins}</div>` : ''}
                </div>

                <!-- Stats Cards -->
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px;">
                    <div style="background: var(--bg-tertiary); border-radius: 10px; padding: 16px; text-align: center; border: 1px solid var(--border-color);">
                        <div style="font-size: 28px; font-weight: 800; color: var(--success);">${p1Wins}</div>
                        <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">${p1.name} Wins</div>
                        <div style="font-size: 11px; color: var(--text-secondary); opacity: 0.7;">${p1Pct}%</div>
                    </div>
                    <div style="background: var(--bg-tertiary); border-radius: 10px; padding: 16px; text-align: center; border: 1px solid var(--border-color);">
                        <div style="font-size: 28px; font-weight: 800; color: var(--text-secondary);">${draws}</div>
                        <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">Draws</div>
                        <div style="font-size: 11px; color: var(--text-secondary); opacity: 0.7;">${drawPct}%</div>
                    </div>
                    <div style="background: var(--bg-tertiary); border-radius: 10px; padding: 16px; text-align: center; border: 1px solid var(--border-color);">
                        <div style="font-size: 28px; font-weight: 800; color: var(--danger);">${p2Wins}</div>
                        <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">${p2.name} Wins</div>
                        <div style="font-size: 11px; color: var(--text-secondary); opacity: 0.7;">${p2Pct}%</div>
                    </div>
                </div>

                <!-- Game History -->
                <h4 style="margin-bottom: 12px; color: var(--text-primary); font-size: 14px;">Game History</h4>
                <div style="max-height: 240px; overflow-y: auto; border-radius: 8px; border: 1px solid var(--border-color);">
                    ${filtered.sort((a, b) => new Date(b.date) - new Date(a.date)).map(g => {
        const p1IsWhite = g.white === p1id;
        const p1Color = p1IsWhite ? 'White' : 'Black';
        let outcomeClass = '';
        let outcomeText = '';
        if (g.result === '1-0') {
            outcomeClass = p1IsWhite ? 'color: var(--success)' : 'color: var(--danger)';
            outcomeText = p1IsWhite ? `${p1.name} won` : `${p2.name} won`;
        } else if (g.result === '0-1') {
            outcomeClass = !p1IsWhite ? 'color: var(--success)' : 'color: var(--danger)';
            outcomeText = !p1IsWhite ? `${p1.name} won` : `${p2.name} won`;
        } else {
            outcomeClass = 'color: var(--text-secondary)';
            outcomeText = 'Draw';
        }
        return `
                            <div style="display: grid; grid-template-columns: 80px 1fr 70px 1fr; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--border-color); font-size: 13px; gap: 8px;">
                                <span style="color: var(--text-secondary);">${g.date || '-'}</span>
                                <span style="font-weight: 500;">${formatResult(g.result)}</span>
                                <span style="font-size: 11px; color: var(--text-secondary);">${p1Color}</span>
                                <span style="${outcomeClass}; font-weight: 600; text-align: right;">${outcomeText}</span>
                            </div>
                        `;
    }).join('')}
                </div>
            `}
        </div>
    `;
}


function openGameDetail(gameId) {
    const game = games.find(g => g.id == gameId);
    if (!game) return;

    // Use stored player names from the game record
    const whiteName = game.whiteName || 'Unknown';
    const blackName = game.blackName || 'Unknown';
    const whitePlayer = getPlayerById(game.white);
    const blackPlayer = getPlayerById(game.black);
    const whiteRating = whitePlayer?.rating || (game.whiteRatingBefore || 'N/A');
    const blackRating = blackPlayer?.rating || (game.blackRatingBefore || 'N/A');

    const content = document.getElementById('gameDetailContent');

    if (content) content.innerHTML = `
            <div style = "padding: 20px 0;" >
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; background: var(--bg-tertiary); padding: 16px; border-radius: 12px; border: 1px solid var(--border-color);">
                        <div style="text-align: center; flex: 1;">
                            <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">WHITE</div>
                            <div style="font-weight: 700; color: var(--text-primary); font-size: 16px;">${whiteName}</div>
                            <div style="font-size: 14px; color: var(--accent-gold);">${whiteRating}</div>
                        </div>
                        <div style="font-size: 24px; font-weight: 800; color: var(--text-muted); padding: 0 20px;">VS</div>
                        <div style="text-align: center; flex: 1;">
                            <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">BLACK</div>
                            <div style="font-weight: 700; color: var(--text-primary); font-size: 16px;">${blackName}</div>
                            <div style="font-size: 14px; color: var(--accent-gold);">${blackRating}</div>
                        </div>
                    </div>

                    <div style="text-align: center; margin-bottom: 24px;">
                        <div style="font-size: 14px; color: var(--text-secondary); margin-bottom: 4px;">RESULT</div>
                        <div style="font-size: 32px; font-weight: 800; color: var(--accent-gold);">${formatResult(game.result)}</div>
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
                            <div style="font-size: 12px; color: var(--text-secondary);">White Rating</div>
                            <div style="font-size: 14px; color: ${game.whiteChange >= 0 ? 'var(--green)' : 'var(--danger)'}; font-weight: 600;">
                                ${game.whiteChange >= 0 ? '+' : ''}${game.whiteChange}
                            </div>
                        </div>
                        <div style="background: var(--bg-tertiary); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color);">
                            <div style="font-size: 12px; color: var(--text-secondary);">Black Rating</div>
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
    if (select) select.innerHTML = '<option value="">All Tournaments</option>' +
        tournaments.map(t => `<option value = "${t}" > ${t}</option > `).join('');
}

function populatePlayerSelects() {
    const whiteSelect = document.getElementById('whitePlayer');
    const blackSelect = document.getElementById('blackPlayer');
    const options = players.map(p => `<option value = "${p.id}" > ${p.name} (${p.rating})</option > `).join('');
    if (whiteSelect) whiteSelect.innerHTML = `<option value = "" > Select White Player</option > ${options} `;
    if (blackSelect) blackSelect.innerHTML = `<option value = "" > Select Black Player</option > ${options} `;
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

    const cat = document.getElementById('gameCategory').value || 'rapid';
    const whiteRatingBefore = getRatingForCategory(whitePlayer, cat);
    const blackRatingBefore = getRatingForCategory(blackPlayer, cat);
    const whiteElo = calculateElo(whiteRatingBefore, blackRatingBefore, whiteScore);
    const blackElo = calculateElo(blackRatingBefore, whiteRatingBefore, blackScore);
    const whiteChange = whiteElo.change;
    const blackChange = blackElo.change;

    const whiteExpected = 1 / (1 + Math.pow(10, (blackRatingBefore - whiteRatingBefore) / 400));
    const blackExpected = 1 / (1 + Math.pow(10, (whiteRatingBefore - blackRatingBefore) / 400));

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
    const confirmMsg = `Confirm Game Result:\n\n${whitePlayer.name} (White) vs ${blackPlayer.name} (Black)\n\nResult: ${resultText}\n\nWhite Rating: ${whiteRatingBefore} → ${whiteRatingBefore + whiteChange} (${whiteChange >= 0 ? '+' : ''}${whiteChange})\nBlack Rating: ${blackRatingBefore} → ${blackRatingBefore + blackChange} (${blackChange >= 0 ? '+' : ''}${blackChange})\n\nThis cannot be undone. Continue?`;

    // Close the add game form and show confirmation modal
    document.getElementById('addGameModal').classList.remove('active');
    const categoryToSubmit = document.getElementById('gameCategory').value || 'rapid';
    showGameConfirmModal(whitePlayer, blackPlayer, result, whiteChange, blackChange, whiteScore, blackScore, categoryToSubmit);
    return;
}

function showGameConfirmModal(whitePlayer, blackPlayer, result, whiteChange, blackChange, whiteScore, blackScore, category) {
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
        scoreDisplay = '½ : ½';
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
    modal.dataset.category = category || 'rapid';

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
    const category = modal.dataset.category || 'rapid';

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
        showLoadingModal('Saving game result...');

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

        if(category === 'rapid') { players[whiteIdx].rapid_rating = (players[whiteIdx].rapid_rating || players[whiteIdx].bodija_rating || 1600) + whiteChange; players[whiteIdx].bodija_rating = players[whiteIdx].rapid_rating; }
        else if(category === 'blitz') players[whiteIdx].blitz_rating = (players[whiteIdx].blitz_rating || 1600) + whiteChange;
        else if(category === 'classical') players[whiteIdx].classical_rating = (players[whiteIdx].classical_rating || 1600) + whiteChange;
        players[whiteIdx].rating = getRatingForCategory(players[whiteIdx], window.activeLeaderboardCategory);
        if(category === 'rapid') { players[blackIdx].rapid_rating = (players[blackIdx].rapid_rating || players[blackIdx].bodija_rating || 1600) + blackChange; players[blackIdx].bodija_rating = players[blackIdx].rapid_rating; }
        else if(category === 'blitz') players[blackIdx].blitz_rating = (players[blackIdx].blitz_rating || 1600) + blackChange;
        else if(category === 'classical') players[blackIdx].classical_rating = (players[blackIdx].classical_rating || 1600) + blackChange;
        players[blackIdx].rating = getRatingForCategory(players[blackIdx], window.activeLeaderboardCategory);
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
        
        let wRating = getRatingForCategory(players[whiteIdx], category);
        let wPeak = getPeakRatingForCategory(players[whiteIdx], category);
        if (wRating > wPeak) {
            if(category==='rapid') { players[whiteIdx].rapid_peak_rating = wRating; players[whiteIdx].peakRating = wRating; }
            if(category==='blitz') players[whiteIdx].blitz_peak_rating = wRating;
            if(category==='classical') players[whiteIdx].classical_peak_rating = wRating;
        }
        // block old peak updating
        if (false) {
            players[whiteIdx].peakRating = players[whiteIdx].rating;
        }
        
        let bRating = getRatingForCategory(players[blackIdx], category);
        let bPeak = getPeakRatingForCategory(players[blackIdx], category);
        if (bRating > bPeak) {
            if(category==='rapid') { players[blackIdx].rapid_peak_rating = bRating; players[blackIdx].peakRating = bRating; }
            if(category==='blitz') players[blackIdx].blitz_peak_rating = bRating;
            if(category==='classical') players[blackIdx].classical_peak_rating = bRating;
        }
        // block old peak updating
        if (false) {
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

        const [savedGame] = await api.insertGames([{
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
            black_player_name: updatedBlackPlayer.name,
            category: category
        }]);

        if (savedGame) newGame.id = savedGame.id;

        await Promise.all([
            api.updatePlayerStats(updatedWhitePlayer.id, {
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
            }),
            api.updatePlayerStats(updatedBlackPlayer.id, {
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
            })
        ]);

        modal.classList.remove('active');
        closeAddGameModal();
        showToast('Game result saved!', 'success');
        await silentRefresh();

    } catch (e) {
        console.error("Error saving game:", e);
        showToast("Error saving game. Please check console.", 'error');
    } finally {
        hideLoadingModal();
        if (btn) {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }
}

// ==================== TOURNAMENT MANAGER ====================
let currentTournament = null;
let selectedPlayers = [];
let currentTournamentTab = 'overview';
let currentViewingRound = null;

// ==================== VIEW PERSISTENCE ====================
const STORAGE_KEYS = {
    TOURNAMENT_ID: 'bcc_active_tournament_id',
    TAB: 'bcc_active_tab',
    ROUND: 'bcc_active_round'
};

function saveTournamentState() {
    if (currentTournament) {
        sessionStorage.setItem(STORAGE_KEYS.TOURNAMENT_ID, currentTournament.id);
        sessionStorage.setItem(STORAGE_KEYS.TAB, currentTournamentTab);
        sessionStorage.setItem(STORAGE_KEYS.ROUND, currentViewingRound);
    }
}

function clearTournamentState() {
    sessionStorage.removeItem(STORAGE_KEYS.TOURNAMENT_ID);
    sessionStorage.removeItem(STORAGE_KEYS.TAB);
    sessionStorage.removeItem(STORAGE_KEYS.ROUND);
}

async function loadTournamentState() {
    const savedId = sessionStorage.getItem(STORAGE_KEYS.TOURNAMENT_ID);
    if (savedId) {
        const savedTab = sessionStorage.getItem(STORAGE_KEYS.TAB);
        const savedRound = sessionStorage.getItem(STORAGE_KEYS.ROUND);

        // Clear it so it doesn't keep opening on every fresh load
        clearTournamentState();

        await openTournamentDetail(savedId, savedTab, savedRound);
    }
}

// Extended tournament data structure
const extendedTournaments = [];

// Initialize extended tournaments - now handled in DOMContentLoaded
async function initializeTournaments() {
    // Tournaments are loaded during initialization via api.fetchTournaments()
    // Restore previous view if needed (temporarily disabled)
    // await loadTournamentState();
}

function renderTournaments() {
    const grid = document.getElementById('tournamentsGrid');
    if (!grid) return;

    const formatFilter = document.getElementById('tournamentFormatFilter')?.value || '';
    let filtered = extendedTournaments;
    if (formatFilter) filtered = filtered.filter(t => t.format?.toLowerCase() === formatFilter.toLowerCase());

    const active    = filtered.filter(t => t.status?.toLowerCase() === 'active');
    const draft     = filtered.filter(t => t.status?.toLowerCase() === 'draft');
    const completed = filtered.filter(t => t.status?.toLowerCase() === 'completed');

    // Determine current tab (persist via data attr)
    const currentTab = grid.dataset.tab || (active.length ? 'active' : draft.length ? 'draft' : 'completed');

    const tabCounts = { active: active.length, draft: draft.length, completed: completed.length };
    const tabList = [
        { key: 'active',    label: 'Active',    dot: true  },
        { key: 'draft',     label: 'Draft',     dot: false },
        { key: 'completed', label: 'Completed', dot: false },
    ];

    const tabsHtml = tabList.map(t => `
        <button class="t-status-tab ${currentTab === t.key ? 'active' : ''}"
                onclick="switchStatusTab('${t.key}')"
                data-tab="${t.key}">
            ${t.dot ? `<span class="t-tab-dot" style="background:#22c55e;animation:blink 1.2s infinite;"></span>` : ''}
            ${t.label}
            ${tabCounts[t.key] > 0 ? `<span class="t-tab-count">${tabCounts[t.key]}</span>` : ''}
        </button>
    `).join('');

    // Patch local tournament player count — tpCountMap has no entry until sync
    const local = window._localTournament;
    if (local?.players?.length) {
        for (const t of active) {
            if (t.id === local.id) {
                t.playerCount = local.players.length;
                t.players = local.players;
            }
        }
    }

    const shown = currentTab === 'active' ? active : currentTab === 'draft' ? draft : completed;
    const cardsHtml = shown.length
        ? `<div class="tournaments-grid">${shown.map(renderTournamentCard).join('')}</div>`
        : `<div style="text-align:center;padding:60px 20px;color:var(--text-secondary);">
               <p>No ${currentTab} tournaments.</p>
           </div>`;

    grid.innerHTML = `
        <div class="section-container">
            <div class="t-status-tabs">${tabsHtml}</div>
            ${cardsHtml}
        </div>`;
    grid.dataset.tab = currentTab;
}

function switchStatusTab(tab) {
    const grid = document.getElementById('tournamentsGrid');
    if (grid) grid.dataset.tab = tab;
    renderTournaments();
}

function renderTournamentCard(tournament) {
    if (!tournament) return '';
    const status = (tournament.status || 'draft').toLowerCase();
    const playerCount = tournament.playerCount || (tournament.players ? tournament.players.length : 0);
    const _fmt = normalizeFormat(tournament.format);
    const formatLabel = _fmt === 'swiss' ? 'Swiss' : _fmt === 'roundrobin' ? 'Round Robin' : _fmt === 'knockout' ? 'Knockout' : (tournament.format || 'Unknown');
    const dateStr = new Date(tournament.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    const onclick = status === 'draft'
        ? `editTournament('${tournament?.id ?? ''}')`
        : `openTournamentDetail('${tournament?.id ?? ''}')`;

    // Status dot — only active tournament gets a blinking green dot
    const dotHtml = status === 'active'
        ? `<span class="t-card-dot" style="background:#22c55e;animation:blink 1.2s infinite;flex-shrink:0;margin-top:4px;"></span>`
        : '';

    // Admin actions
    const actionsHtml = status !== 'completed' ? `
        <div class="tournament-actions admin-only" onclick="event.stopPropagation()" style="margin-top:8px;">
            ${status === 'draft' ? `
            <button class="btn-action-sm edit" onclick="editTournament('${tournament?.id ?? ''}')">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                Edit
            </button>` : ''}
            <button id="tournament-btn-${tournament?.id ?? ''}" class="btn-action-sm delete" onclick="deleteTournament('${tournament?.id ?? ''}')">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                ${status === 'active' ? 'Terminate' : 'Delete'}
            </button>
        </div>` : '';

    return `
        <div class="tournament-card fade-in" onclick="${onclick}" style="cursor:pointer;position:relative;">
            <div class="t-card-row1">
                <div class="t-card-title-date">
                    <h3 class="tournament-name" style="margin:0;">${tournament.name}</h3>
                    <div class="tournament-date" style="margin-top:2px;">${dateStr}</div>
                </div>
                ${dotHtml}
            </div>
            <div class="t-card-divider"></div>
            <div class="t-card-row2">
                <div class="t-card-meta-left">
                    <span class="t-card-meta-item"><strong>${playerCount}</strong> Players</span>
                    <span class="t-card-meta-sep">·</span>
                    <span class="t-card-meta-item"><strong>${tournament.total_rounds || '?'}</strong> Rounds</span>
                </div>
                <div class="t-card-meta-right">
                    <span class="t-card-badge">${formatLabel}</span>
                    <span class="t-card-badge">${tournament.timeControl || '—'}</span>
                </div>
            </div>
            ${actionsHtml}
        </div>`;
}

// Modal functions
function openCreateTournamentModal() {
    document.getElementById('editTournamentId').value = '';
    document.getElementById('submitTournamentBtn').textContent = 'Select Players';
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
    pendingStartTournamentPlayers = selectedPlayers
        .map(id => {
            const p = players.find(player => player.id === id);
            if (!p) { console.warn('[BCC] Player not found for id:', id); return null; }
            return {
                id: p.id,
                name: p.name,
                rating: p.rating || p.bodija_rating || 1600,
                isGuest: p.isGuest || p.is_guest || false
            };
        })
        .filter(Boolean);

    // Gather form data for preview
    const name = currentTournament.name;
    const date = currentTournament.date;
    const timeControl = currentTournament.timeControl;
    const format = currentTournament.format;
    // Calculate expected rounds and games based on format
    const n = pendingStartTournamentPlayers.length;
    let expectedRounds = 0;
    let expectedGames = 0;

    const normFmt = normalizeFormat(format);
    const isDouble = currentTournament.isDoubleRoundRobin || isDoubleRR(format);
    if (normFmt === 'roundrobin') {
        const singleRounds = n % 2 === 0 ? n - 1 : n;
        expectedRounds = isDouble ? singleRounds * 2 : singleRounds;
        expectedGames = n * (n - 1) / 2 * (isDouble ? 2 : 1);
    } else if (normFmt === 'knockout') {
        expectedRounds = Math.ceil(Math.log2(n));
        expectedGames = n - 1;
    } else {
        // Swiss: prefer manually set value over log2 fallback
        const _swissRounds = currentTournament.total_rounds
            ?? currentTournament.totalRounds
            ?? currentTournament.rounds
            ?? null;
        expectedRounds = (_swissRounds && _swissRounds > 0)
            ? _swissRounds
            : Math.ceil(Math.log2(n));
        expectedGames = expectedRounds * Math.floor(n / 2);
    }

    // Format the display values
    const formatDisplay = format === 'swiss' ? 'Swiss System' : format === 'roundrobin' ? `Round Robin (${isDouble ? 'Double' : 'Single'})` : 'Knockout';

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
    if (roundsEl) roundsEl.textContent = `${expectedRounds} rounds, ~${expectedGames} games`;
    if (countEl) countEl.textContent = n;

    if (listEl) {
        if (listEl) listEl.innerHTML = pendingStartTournamentPlayers.map(p => `
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

        // 1. Create local state object first
        // Calculate correct total_rounds from format + player count (not from .rounds array)
        const _playerCount = pendingStartTournamentPlayers.length;
        const _format = currentTournament.format;
        const _isDoubleRR = currentTournament.isDoubleRoundRobin || isDoubleRR(_format);
        let _totalRounds = currentTournament.total_rounds || currentTournament.totalRounds || 0;
        // Always recalculate for round-robin and knockout — these are deterministic
        if (normalizeFormat(_format) === 'roundrobin') {
            const n = _playerCount;
            const singleRounds = n % 2 === 0 ? n - 1 : n;
            _totalRounds = _isDoubleRR ? singleRounds * 2 : singleRounds;
        } else if (normalizeFormat(_format) === 'knockout') {
            _totalRounds = Math.ceil(Math.log2(_playerCount));
        } else if (normalizeFormat(_format) === 'swiss') {
            // Swiss: use manually entered value — check all possible keys, fall back to ceil(log2(n))
            const manualRounds = currentTournament.total_rounds
                ?? currentTournament.totalRounds
                ?? currentTournament.rounds
                ?? null;
            _totalRounds = (manualRounds && manualRounds > 0)
                ? manualRounds
                : Math.ceil(Math.log2(_playerCount));
        }

        const localTournament = {
            id: null, // Will be set after Supabase insert
            name: currentTournament.name,
            format: currentTournament.format,
            time_control: currentTournament.timeControl || currentTournament.time_control,
            total_rounds: _totalRounds,
            current_round: 0,
            status: 'Active',
            date: currentTournament.date || new Date().toISOString().split('T')[0],
            synced: false,
            lastUpdated: Date.now(),
            players: pendingStartTournamentPlayers.map(p => ({
                id: p.id,
                name: p.name,
                ratingAtStart: p.rating,
                currentRating: p.rating,
                peakRating: p.peakRating || p.rating,
                globalWinsBefore: p.wins || 0,
                globalDrawsBefore: p.draws || 0,
                globalLossesBefore: p.losses || 0,
                globalGamesBefore: p.games || p.games_played || 0,
                points: 0,
                wins: 0,
                draws: 0,
                losses: 0,
                byes: 0,
                buchholz: 0,
                colorHistory: [],
                opponents: []
            })),
            rounds: []
        };

        // Save to window and localStorage
        window._localTournament = localTournament;
        localStorage.setItem('bcc_active_tournament', JSON.stringify(localTournament));

        // Use existing tournament ID (draft) — update it to Active instead of creating a duplicate
        const existingId = tournamentId;
        let saved;

        if (existingId) {
            const { data: updated, error: updateError } = await supabase
                .from('tournaments')
                .update({
                    status: 'Active',
                    current_round: 0,
                    total_rounds: localTournament.total_rounds
                })
                .eq('id', existingId)
                .select()
                .single();
            if (updateError) throw new Error(updateError.message);
            saved = updated;
        } else {
            const { data: inserted, error: insertError } = await supabase
                .from('tournaments')
                .insert({
                    name: localTournament.name,
                    format: localTournament.format,
                    time_control: localTournament.time_control,
                    total_rounds: localTournament.total_rounds,
                    current_round: 0,
                    status: 'Active',
                    date: localTournament.date
                })
                .select()
                .single();
            if (insertError) throw new Error(insertError.message);
            saved = inserted;
        }

        if (!saved) throw new Error('Failed to save tournament to database');

        // Upsert tournament players to reserve slots
        await api.upsertTournamentPlayers(localTournament.players.map(p => ({
            tournament_id: saved.id,
            player_id: p.id,
            points: 0, wins: 0, draws: 0, losses: 0, byes: 0,
            rating_at_start: p.ratingAtStart,
            rating_change: 0, buchholz: 0
        })));

        // Update local state
        window._localTournament = localTournament;
        localStorage.setItem('bcc_active_tournament', JSON.stringify(window._localTournament));

        // Now use local state for all tournament operations
        currentTournament = localTournament;
        currentTournament.id = saved.id;
        currentTournament.current_round = 1;

        // Generate round locally and save to localStorage
        generateRoundLocally();

        window._localTournament.id = saved.id;
        window._localTournament.current_round = 1;
        saveLocalTournament();

        // ── Push round 1 pairings to DB so viewers can see them immediately ──
        const round1Pairings = (window._localTournament.pairings || []).filter(p => p.round === 1);
        const round1PairingRows = round1Pairings.map(p => ({
            tournament_id: saved.id,
            white_player_id: p.white,
            black_player_id: p.isBye ? null : p.black,
            result: null,
            white_rating_before: p.whiteRatingBefore || window._localTournament.players.find(x => x.id === p.white)?.ratingAtStart || 1600,
            black_rating_before: p.isBye ? null : (p.blackRatingBefore || window._localTournament.players.find(x => x.id === p.black)?.ratingAtStart || 1600),
            white_rating_after: null, black_rating_after: null,
            white_rating_change: null, black_rating_change: null,
            is_bye: p.isBye || false
        }));
        const round1Standings = window._localTournament.players.map(p => ({
            tournament_id: saved.id, player_id: p.id,
            points: 0, wins: 0, draws: 0, losses: 0, byes: 0,
            rating_at_start: p.ratingAtStart || 1600, rating_change: 0, buchholz: 0
        }));
        hideLoadingModal();
        try {
            await api.syncRoundToDb(saved.id, 1, round1PairingRows, round1Standings);
            
        } catch (e) {
            console.error('[Start] Round 1 DB sync failed:', e?.message || e, e);
            showToast('Round 1 saved locally. Viewer sync failed — check console.', 'warning');
        }

        // UI Finalization - no reload, just open the tournament view directly
        closeTournamentStartPreviewModal();
        closePlayerSelectionModal();

        currentTournament = window._localTournament;
        currentTournamentTab = 'pairings';
        currentViewingRound = 1;

        // Open tournament detail directly
        const modal = document.getElementById('tournamentDetailModal');
        if (modal) modal.classList.add('active');
        renderTournamentDetail();
        showToast(`${localTournament.name} started! Round 1 pairings ready.`, 'success');

        // Update tournaments list in background without re-rendering current view
        _refreshTournamentsListOnly();

    } catch (e) {
        console.error("Tournament Start Flow Failed:", e);
        showToast(`Failed to start tournament: ${sanitizeError(e.message) || "Could not connect to server"}`, 'error');
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

    // Check format type
    const isSingleRR = format === 'roundrobin_single';
    const isDoubleRR = format === 'roundrobin_double';
    const isRoundRobin = isSingleRR || isDoubleRR;

    if (format === 'knockout') {
        roundsInput.value = '';
        roundsInput.placeholder = 'Auto';
        roundsInput.disabled = true;
    } else if (isRoundRobin) {
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

    // Check for double round robin
    const rrType = document.getElementById('roundRobinType')?.value || 'single';
    const isDoubleRoundRobin = format === 'roundrobin' && rrType === 'double';

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
                    rounds,
                    isDoubleRoundRobin
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
                    total_rounds: rounds,   // needed so confirmStartTournament reads it correctly
                    totalRounds: rounds,    // belt-and-suspenders alias
                    status: 'Draft',
                    current_round: 0,
                    players: [],
                    pairings: [],
                    standings: [],
                    results: [],
                    isDoubleRoundRobin: isDoubleRoundRobin
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
                } else {
                    // Database save failed, remove the local tournament
                    const idx = extendedTournaments.findIndex(t => t.id === newTournament.id);
                    if (idx > -1) {
                        extendedTournaments.splice(idx, 1);
                    }
                    showToast('Failed to save tournament to database', 'error');
                    return;
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
    document.getElementById('tournamentRounds').value = tournament.total_rounds || '';
    document.getElementById('submitTournamentBtn').textContent = 'Save Changes';

    updateRoundsInput();
    document.getElementById('createTournamentModal').classList.add('active');
}

async function deleteTournament(id) {
    const tournament = extendedTournaments.find(t => t.id === id);
    if (!tournament) return;

    if (tournament.status?.toLowerCase() === 'active') {
        showConfirmModal(
            'Terminate Tournament',
            'This tournament is currently ACTIVE. Terminating it will DELETE all games played in this tournament, RESET all players to their ratings before the tournament started, and DELETE the tournament record. Are you sure you want to proceed?',
            async () => {
                try {
                    showLoadingModal('Terminating tournament...');
                    await api.terminateTournament(id);

                    // Clear local tournament if it matches
                    if (window._localTournament?.id === id) {
                        window._localTournament = null;
                        localStorage.removeItem('bcc_active_tournament');
                    }

                    const idx = extendedTournaments.findIndex(t => t.id === id);
                    if (idx > -1) extendedTournaments.splice(idx, 1);

                    showToast('Tournament terminated and ratings reset', 'success');
                    await silentRefresh();
                } catch (error) {
                    console.error('Failed to terminate tournament:', error);
                    showToast('Failed to terminate tournament from database.', 'error');
                } finally {
                    hideLoadingModal();
                }
            }
        );
        return;
    }

    showConfirmModal(
        'Delete Tournament',
        'Are you sure you want to delete this tournament? This action cannot be undone.',
        async () => {
            try {
                showLoadingModal('Deleting tournament...');
                await api.deleteTournament(id);

                // Clear local tournament if it matches
                if (window._localTournament?.id === id) {
                    window._localTournament = null;
                    localStorage.removeItem('bcc_active_tournament');
                }

                const idx = extendedTournaments.findIndex(t => t.id === id);
                if (idx > -1) extendedTournaments.splice(idx, 1);

                showToast('Tournament deleted successfully', 'success');
                await silentRefresh();
            } catch (error) {
                console.error('Failed to delete tournament:', error);
                showToast('Failed to delete tournament from database.', 'error');
            } finally {
                hideLoadingModal();
            }
        }
    );
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

    if (content) content.innerHTML = `
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
        console.error("[BCC] Save standings failed:", e);
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
        showLoadingModal('Adding player...');
        const newPlayer = await api.createPlayer({
            name,
            rating,
            isGuest: true,
            status: 'Active'
        });

        if (newPlayer) {
            // Add to local players list immediately so showTournamentStartPreview can find them
            const guestEntry = {
                id: newPlayer.id,
                name: newPlayer.name,
                rating: newPlayer.bodija_rating || 1600,
                peakRating: newPlayer.bodija_rating || 1600,
                games: 0, wins: 0, draws: 0, losses: 0,
                isGuest: true
            };
            players.push(guestEntry);

            // Select the new player
            selectedPlayers.push(newPlayer.id);

            // Clear inputs and re-render
            document.getElementById('newPlayerName').value = '';
            document.getElementById('newPlayerRating').value = '';
            renderPlayerSelection();

            // Background refresh (non-blocking — guest already in local array)
            api.fetchPlayers()
                .then(fresh => {
                    players = fresh.map(mapPlayerFromDB).filter(p => p !== null);
                    renderPlayers();
                    renderLeaderboard();
                })
                .catch(e => console.warn('Player refresh after guest add failed:', e));
        }
    } catch (error) {
        console.error("Error adding guest player:", error);
        showToast("Failed to add guest player.", 'error');
    } finally {
        hideLoadingModal();
    }
}

async function startTournament() {
    if (!currentTournament) return;

    const minPlayers = currentTournament.format === 'knockout' ? 2 : 3;
    if (selectedPlayers.length < minPlayers) return;

    // Add selected players to tournament
    currentTournament.players = selectedPlayers
        .map(id => {
            const player = players.find(p => p.id === id);
            if (!player) { console.warn('[BCC] Player not found for id:', id); return null; }
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
        })
        .filter(Boolean);

    // Calculate rounds
    if (currentTournament.format === 'knockout') {
        currentTournament.rounds = Math.ceil(Math.log2(currentTournament.players.length));
    } else if (currentTournament.format === 'roundrobin') {
        const n = currentTournament.players.length;
        const isDouble = currentTournament.isDoubleRoundRobin;
        if (isDouble) {
            currentTournament.rounds = n % 2 === 0 ? (n - 1) * 2 : n * 2;
        } else {
            currentTournament.rounds = n % 2 === 0 ? n - 1 : n;
        }
    }

    // Generate pairings
    generatePairings();

    // Set status to active
    currentTournament.status = 'active';

    // Sync to DB
    try {
        await api.updateTournamentStatus(currentTournament.id, 'active', 1);
        await api.addTournamentPlayers(currentTournament.id, currentTournament.players);

        // Create Round 1 record first
        const round1 = await api.createRound({
            tournament_id: currentTournament.id,
            round_number: 1,
            status: 'Pending'
        });

        if (round1) {
            currentTournament.pairings = currentTournament.pairings.map(p => ({
                ...p,
                roundId: round1.id
            }));
            const dbPairings = await api.addRoundPairings(currentTournament.id, currentTournament.pairings);
            if (dbPairings && Array.isArray(dbPairings)) {
                // Sync back database IDs to local pairings
                currentTournament.pairings = dbPairings.map(dbp => {
                    const local = currentTournament.pairings.find(lp =>
                        lp.white === dbp.white_player_id && lp.black === dbp.black_player_id
                    );
                    return { ...local, id: dbp.id, roundId: dbp.round_id };
                });
            }
        } else {
            // Fallback for Round 1
            await api.addRoundPairings(currentTournament.id, currentTournament.pairings);
        }
    } catch (e) {
        console.warn("[BCC] Tournament DB sync failed, using local fallback:", e);
    }

    closePlayerSelectionModal();
    // Force a reload to fetch fully populated data with DB IDs
    currentTournamentTab = 'pairings';
    currentViewingRound = 1;
    saveTournamentState();
    setTimeout(() => window.location.reload(), 500);
}

// ==================== TOURNAMENT UTILITY FUNCTIONS ====================

// Calculate total rounds based on format and player count
function calculateTotalRounds(format, playerCount) {
    const n = playerCount;
    const f = normalizeFormat(format);
    const double = isDoubleRR(format);
    switch (f) {
        case 'roundrobin':
            if (double) return n % 2 === 0 ? (n - 1) * 2 : n * 2;
            return n % 2 === 0 ? n - 1 : n;
        case 'swiss':
            return Math.ceil(Math.log2(n));
        case 'knockout':
            return Math.ceil(Math.log2(n));
        default:
            return n - 1;
    }
}

// ==================== TOURNAMENT PAIRING SYSTEM ====================

// Color history tracking - stored in tournament object
// ==================== COLOR HISTORY ====================

function getColorHistory(tournament) {
    if (!tournament.colorHistory) tournament.colorHistory = {};
    return tournament.colorHistory;
}

// FIDE color assignment:
// 1. Never 3 same colors in a row (absolute)
// 2. Player with more blacks gets white (equalization)
// 3. Player who had black last gets white (alternation)
function assignColors(p1, p2, colorHistory) {
    const h1 = colorHistory[p1.id] || { whites: 0, blacks: 0, lastColor: null, streak: 0 };
    const h2 = colorHistory[p2.id] || { whites: 0, blacks: 0, lastColor: null, streak: 0 };

    // Absolute rule: never 3 in a row
    if (h1.lastColor === 'white' && h1.streak >= 2) return { white: p2, black: p1 };
    if (h2.lastColor === 'white' && h2.streak >= 2) return { white: p1, black: p2 };
    if (h1.lastColor === 'black' && h1.streak >= 2) return { white: p1, black: p2 };
    if (h2.lastColor === 'black' && h2.streak >= 2) return { white: p2, black: p1 };

    // Equalization: player with color deficit gets white
    const diff1 = h1.whites - h1.blacks;
    const diff2 = h2.whites - h2.blacks;
    if (diff1 < diff2) return { white: p1, black: p2 };
    if (diff2 < diff1) return { white: p2, black: p1 };

    // Alternation: player who had black last gets white
    if (h1.lastColor === 'black') return { white: p1, black: p2 };
    if (h2.lastColor === 'black') return { white: p2, black: p1 };

    return { white: p1, black: p2 };
}

function recordColors(tournament, whitePlayer, blackPlayer) {
    const ch = getColorHistory(tournament);
    const update = (id, color) => {
        if (!ch[id]) ch[id] = { whites: 0, blacks: 0, lastColor: null, streak: 0 };
        ch[id][color === 'white' ? 'whites' : 'blacks']++;
        ch[id].streak = ch[id].lastColor === color ? ch[id].streak + 1 : 1;
        ch[id].lastColor = color;
    };
    update(whitePlayer.id, 'white');
    update(blackPlayer.id, 'black');
    const key = [whitePlayer.id, blackPlayer.id].sort().join('|');
    if (!ch[key]) ch[key] = [];
    ch[key].push({ white: whitePlayer.id, black: blackPlayer.id });
}

function hasPlayed(p1id, p2id, colorHistory) {
    const key = [p1id, p2id].sort().join('|');
    return !!(colorHistory[key] && colorHistory[key].length > 0);
}

function generatePairings() {
    if (!currentTournament || !currentTournament.players || currentTournament.players.length === 0) return;
    const format = normalizeFormat(currentTournament.format);
    const players = [...currentTournament.players];
    let pairings = [];
    if (format === 'swiss') pairings = generateSwissPairings(players, currentTournament.current_round || 1);
    else if (format === 'roundrobin') pairings = generateRoundRobinPairings(players, currentTournament.current_round || 1);
    else if (format === 'knockout') pairings = generateKnockoutPairings(players, currentTournament.current_round || 1);
    currentTournament.pairings = pairings;
}

// Generate round locally — saves to localStorage, no Supabase call
function generateRoundLocally() {
    if (!currentTournament || !currentTournament.players || currentTournament.players.length === 0) return;

    const currentRound = currentTournament.current_round || 1;
    const format = normalizeFormat(currentTournament.format);

    // Ensure player.rating reflects current rating (updated after each round)
    const players = currentTournament.players.map(p => ({
        ...p,
        rating: p.currentRating || p.ratingAtStart || p.rating || 1600
    }));
    let rawPairings = [];

    if (format === 'swiss') rawPairings = generateSwissPairings(players, currentRound);
    else if (format === 'roundrobin') rawPairings = generateRoundRobinPairings(players, currentRound);
    else if (format === 'knockout') rawPairings = generateKnockoutPairings(players, currentRound);
    else console.warn('Unknown format:', currentTournament.format);

    const pairings = rawPairings.map(p => ({
        ...p,
        id: p.id || crypto.randomUUID(),
        round: currentRound,
        result: p.result || null
    }));

    if (!currentTournament.rounds) currentTournament.rounds = [];
    currentTournament.rounds = currentTournament.rounds.filter(r => r.roundNumber !== currentRound);
    currentTournament.rounds.push({ roundNumber: currentRound, pairings, status: 'Pending', createdAt: Date.now() });
    currentTournament.pairings = currentTournament.rounds.flatMap(r => r.pairings);

    if (window._localTournament) {
        window._localTournament.rounds = currentTournament.rounds;
        window._localTournament.pairings = currentTournament.pairings;
        saveLocalTournament();
    }

    
}

// ==================== ROUND ROBIN (FIDE BERGER TABLE) ====================

function generateRoundRobinPairings(players, round) {
    const n = players.length;
    if (n < 2) return [];

    const double = isDoubleRR(currentTournament.format) || currentTournament.isDoubleRoundRobin;
    const singleRounds = n % 2 === 0 ? n - 1 : n;
    const isSecondHalf = double && round > singleRounds;
    const actualRound = isSecondHalf ? round - singleRounds : round;

    const list = [...players];
    if (list.length % 2 !== 0) list.push({ id: 'BYE', name: 'BYE', rating: 0, currentRating: 0 });
    const N = list.length;

    const fixed = list[0];
    const rotating = list.slice(1);
    const rot = (actualRound - 1) % rotating.length;
    const rotated = [...rotating.slice(rot), ...rotating.slice(0, rot)];
    const table = [fixed, ...rotated];

    const pairings = [];
    const colorHistory = getColorHistory(currentTournament);

    for (let i = 0; i < N / 2; i++) {
        const top = table[i];
        const bottom = table[N - 1 - i];

        if (top.id === 'BYE' || bottom.id === 'BYE') {
            const real = top.id === 'BYE' ? bottom : top;
            pairings.push({
                round, white: real.id, whiteName: real.name,
                black: null, blackName: 'BYE', result: '1-0', isBye: true,
                whiteRatingBefore: real.currentRating || real.rating || 0,
                blackRatingBefore: null
            });
            continue;
        }

        let white, black;
        if (isSecondHalf) {
            // Swap colors from mirror round in first half
            const firstHalfPairings = currentTournament.pairings?.filter(p => p.round === actualRound) || [];
            const mirror = firstHalfPairings.find(p =>
                (p.white === top.id && p.black === bottom.id) ||
                (p.white === bottom.id && p.black === top.id)
            );
            if (mirror) {
                white = mirror.white === top.id ? bottom : top;
                black = mirror.white === top.id ? top : bottom;
            } else {
                const a = assignColors(top, bottom, colorHistory);
                white = a.white; black = a.black;
            }
        } else {
            // FIDE Berger: board 1 alternates by round, others are opposite
            const topH = colorHistory[top.id] || { streak: 0, lastColor: null };
            const botH = colorHistory[bottom.id] || { streak: 0, lastColor: null };
            const board1TopWhite = actualRound % 2 === 1;
            const thisTopWhite = i === 0 ? board1TopWhite : !board1TopWhite;
            // Override for 3-in-a-row
            let finalTopWhite = thisTopWhite;
            if (thisTopWhite && topH.lastColor === 'white' && topH.streak >= 2) finalTopWhite = false;
            if (!thisTopWhite && botH.lastColor === 'white' && botH.streak >= 2) finalTopWhite = true;
            white = finalTopWhite ? top : bottom;
            black = finalTopWhite ? bottom : top;
        }

        pairings.push({
            round, white: white.id, whiteName: white.name,
            black: black.id, blackName: black.name,
            result: null, isBye: false,
            whiteRatingBefore: white.currentRating || white.rating || 0,
            blackRatingBefore: black.currentRating || black.rating || 0
        });
        recordColors(currentTournament, white, black);
    }

    return pairings;
}

// ==================== SWISS (FIDE DUTCH SYSTEM) ====================

function generateSwissPairings(players, round) {
    const colorHistory = getColorHistory(currentTournament);
    const pairings = [];
    const paired = new Set();

    const sorted = [...players].sort((a, b) => {
        if ((b.points || 0) !== (a.points || 0)) return (b.points || 0) - (a.points || 0);
        return (b.currentRating || b.rating || 0) - (a.currentRating || a.rating || 0);
    });

    // Bye: lowest ranked player without a bye
    if (sorted.length % 2 !== 0) {
        let byePlayer = null;
        for (let i = sorted.length - 1; i >= 0; i--) {
            if (!sorted[i].byes || sorted[i].byes === 0) { byePlayer = sorted[i]; break; }
        }
        if (!byePlayer) byePlayer = sorted[sorted.length - 1];
        pairings.push({
            round, white: byePlayer.id, whiteName: byePlayer.name,
            black: null, blackName: 'BYE', result: '1-0', isBye: true,
            whiteRatingBefore: byePlayer.currentRating || byePlayer.rating || 0,
            blackRatingBefore: null
        });
        paired.add(byePlayer.id);
    }

    // Group by score
    const groups = {};
    for (const p of sorted) {
        if (paired.has(p.id)) continue;
        const s = String(p.points || 0);
        if (!groups[s]) groups[s] = [];
        groups[s].push(p);
    }

    const scoreKeys = Object.keys(groups).map(Number).sort((a, b) => b - a);
    const floaters = [];

    for (const score of scoreKeys) {
        const group = [...floaters, ...groups[String(score)]].filter(p => !paired.has(p.id));
        floaters.length = 0;

        const mid = Math.floor(group.length / 2);
        const top = group.slice(0, mid);
        const bottom = group.slice(mid);

        for (let ti = 0; ti < top.length; ti++) {
            const p1 = top[ti];
            if (paired.has(p1.id)) continue;
            let matched = false;

            // Try bottom half first (FIDE Dutch)
            for (let bi = 0; bi < bottom.length; bi++) {
                const p2 = bottom[bi];
                if (paired.has(p2.id)) continue;
                if (hasPlayed(p1.id, p2.id, colorHistory)) continue;
                const { white, black } = assignColors(p1, p2, colorHistory);
                pairings.push({ round, white: white.id, whiteName: white.name, black: black.id, blackName: black.name, result: null, isBye: false, whiteRatingBefore: white.currentRating || white.rating || 0, blackRatingBefore: black.currentRating || black.rating || 0 });
                paired.add(p1.id); paired.add(p2.id);
                recordColors(currentTournament, white, black);
                matched = true; break;
            }

            // Fallback: any unpaired player, no rematch
            if (!matched) {
                for (const p2 of sorted) {
                    if (p2.id === p1.id || paired.has(p2.id)) continue;
                    if (hasPlayed(p1.id, p2.id, colorHistory)) continue;
                    const { white, black } = assignColors(p1, p2, colorHistory);
                    pairings.push({ round, white: white.id, whiteName: white.name, black: black.id, blackName: black.name, result: null, isBye: false, whiteRatingBefore: white.currentRating || white.rating || 0, blackRatingBefore: black.currentRating || black.rating || 0 });
                    paired.add(p1.id); paired.add(p2.id);
                    recordColors(currentTournament, white, black);
                    matched = true; break;
                }
            }

            // Last resort: allow rematch
            if (!matched) {
                for (const p2 of sorted) {
                    if (p2.id === p1.id || paired.has(p2.id)) continue;
                    const { white, black } = assignColors(p1, p2, colorHistory);
                    pairings.push({ round, white: white.id, whiteName: white.name, black: black.id, blackName: black.name, result: null, isBye: false, whiteRatingBefore: white.currentRating || white.rating || 0, blackRatingBefore: black.currentRating || black.rating || 0 });
                    paired.add(p1.id); paired.add(p2.id);
                    recordColors(currentTournament, white, black);
                    matched = true; break;
                }
            }

            if (!matched) floaters.push(p1);
        }

        for (const p of bottom) { if (!paired.has(p.id)) floaters.push(p); }
    }

    return pairings;
}

// ==================== KNOCKOUT (FIDE SEEDING) ====================

function generateKnockoutPairings(players, round) {
    const colorHistory = getColorHistory(currentTournament);
    const pairings = [];

    if (round === 1) {
        const seeded = [...players].sort((a, b) =>
            (b.currentRating || b.rating || 0) - (a.currentRating || a.rating || 0)
        );
        const N = seeded.length;
        const top = seeded.slice(0, Math.ceil(N / 2));
        const bot = seeded.slice(Math.ceil(N / 2)).reverse();

        for (let i = 0; i < top.length; i++) {
            const p1 = top[i]; const p2 = bot[i];
            if (!p2) {
                pairings.push({ round, white: p1.id, whiteName: p1.name, black: null, blackName: 'BYE', result: '1-0', isBye: true, whiteRatingBefore: p1.currentRating || p1.rating || 0, blackRatingBefore: null });
                continue;
            }
            const { white, black } = assignColors(p1, p2, colorHistory);
            pairings.push({ round, white: white.id, whiteName: white.name, black: black.id, blackName: black.name, result: null, isBye: false, whiteRatingBefore: white.currentRating || white.rating || 0, blackRatingBefore: black.currentRating || black.rating || 0 });
            recordColors(currentTournament, white, black);
        }
    } else {
        const prevPairings = currentTournament.pairings?.filter(p => p.round === round - 1) || [];
        const winners = prevPairings.map(p => {
            if (p.isBye) return players.find(x => x.id === p.white);
            if (!p.result) return null;
            const wid = p.result === '1-0' ? p.white : p.result === '0-1' ? p.black : p.white;
            return players.find(x => x.id === wid);
        }).filter(Boolean);

        const N = winners.length;
        const top = winners.slice(0, Math.ceil(N / 2));
        const bot = winners.slice(Math.ceil(N / 2)).reverse();

        for (let i = 0; i < top.length; i++) {
            const p1 = top[i]; const p2 = bot[i];
            if (!p2) {
                pairings.push({ round, white: p1.id, whiteName: p1.name, black: null, blackName: 'BYE', result: '1-0', isBye: true, whiteRatingBefore: p1.currentRating || p1.rating || 0, blackRatingBefore: null });
                continue;
            }
            // Swap colors from previous round if they've met before
            const prevKey = [p1.id, p2.id].sort().join('|');
            const prevGames = colorHistory[prevKey] || [];
            let white, black;
            if (prevGames.length > 0) {
                const last = prevGames[prevGames.length - 1];
                white = last.white === p1.id ? p2 : p1;
                black = last.white === p1.id ? p1 : p2;
            } else {
                const a = assignColors(p1, p2, colorHistory); white = a.white; black = a.black;
            }
            pairings.push({ round, white: white.id, whiteName: white.name, black: black.id, blackName: black.name, result: null, isBye: false, whiteRatingBefore: white.currentRating || white.rating || 0, blackRatingBefore: black.currentRating || black.rating || 0 });
            recordColors(currentTournament, white, black);
        }
    }

    return pairings;
}



async function openTournamentDetail(tournamentId, forceTab = null, forceRound = null) {
    // If there is a live local tournament for this ID, use it directly — never overwrite with DB shell
    if (window._localTournament && window._localTournament.id === tournamentId) {
        currentTournament = window._localTournament;
        currentTournamentTab = forceTab || currentTournamentTab || 'pairings';
        currentViewingRound = forceRound !== null ? parseInt(forceRound) : (currentTournament.current_round || 1);
        renderTournamentDetail();
        return;
    }

    const base = extendedTournaments.find(t => t.id === tournamentId);
    if (!base) return;
    currentTournament = { ...base };

    const status = currentTournament.status?.toLowerCase();
    const isCompleted = status === 'completed';
    const isActive = status === 'active';

    if (isCompleted) {
        // ── COMPLETED: load everything from Supabase ──────────────────────────
        showLoadingModal('Loading tournament data...');
        try {
            const [tpPlayers, rawPairings] = await Promise.all([
                api.fetchTournamentStandings(tournamentId),
                api.fetchTournamentPairings(tournamentId)
            ]);

            if (tpPlayers && tpPlayers.length > 0) {
                currentTournament.players = tpPlayers;
            }

            if (rawPairings && rawPairings.length > 0) {
                // Resolve player names from the loaded standings
                currentTournament.pairings = rawPairings.map(p => {
                    const wp = currentTournament.players.find(x => x.id === p.white);
                    const bp = currentTournament.players.find(x => x.id === p.black);
                    return {
                        ...p,
                        whiteName: wp?.name || p.white,
                        blackName: p.isBye ? 'BYE' : (bp?.name || p.black),
                    };
                });
            }

            // Set total_rounds from actual data if not already set
            if (!currentTournament.total_rounds || currentTournament.total_rounds === 0) {
                const maxRound = Math.max(...(currentTournament.pairings || []).map(p => p.round), 0);
                currentTournament.total_rounds = maxRound;
            }
        } catch (e) {
            console.error('Failed to load completed tournament from DB:', e);
        } finally {
            hideLoadingModal();
        }

        currentTournamentTab = forceTab || 'overview';
        currentViewingRound = forceRound !== null ? parseInt(forceRound) : 1;

    } else if (isActive && window._localTournament && window._localTournament.id === tournamentId) {
        // ── ACTIVE LOCAL: use in-memory local state ───────────────────────────
        currentTournament = window._localTournament;
        currentTournamentTab = forceTab || 'pairings';
        currentViewingRound = forceRound !== null ? parseInt(forceRound) : (currentTournament.current_round || 1);

    } else if (isActive) {
        // ── ACTIVE (no local copy on this device) ────────────────────────────
        // Fetch whatever is available from DB.
        // NOTE: During an offline tournament, pairings are only synced to DB
        // per round (or at completion). tournament_players is always available
        // (written on tournament start). We show standings + any synced pairings.
        showLoadingModal('Loading live tournament...');
        try {
            const [tpPlayers, rawPairings] = await Promise.all([
                api.fetchTournamentStandings(tournamentId),
                api.fetchTournamentPairings(tournamentId)
            ]);

            if (tpPlayers && tpPlayers.length > 0) {
                currentTournament.players = tpPlayers;
            }

            if (rawPairings && rawPairings.length > 0) {
                // Resolve player names from tournament_players + global players array
                currentTournament.pairings = rawPairings.map(p => {
                    const wp = (currentTournament.players || []).find(x => x.id === p.white);
                    const bp = (currentTournament.players || []).find(x => x.id === p.black);
                    const wg = players.find(x => x.id === p.white);
                    const bg = players.find(x => x.id === p.black);
                    return {
                        ...p,
                        whiteName: wp?.name || wg?.name || p.white,
                        blackName: p.isBye ? 'BYE' : (bp?.name || bg?.name || p.black),
                    };
                });
                const maxRound = Math.max(...rawPairings.map(p => p.round || 0), 1);
                if (!currentTournament.current_round || currentTournament.current_round === 0) {
                    currentTournament.current_round = maxRound;
                }
            } else {
                currentTournament._pairingsNotYetSynced = true;
                currentTournament.pairings = [];
            }
        } catch (e) {
            console.error('Failed to load active tournament from DB:', e);
        } finally {
            hideLoadingModal();
        }

        // Default to standings tab since pairings may not be available yet
        const hasPairings = (currentTournament.pairings || []).length > 0;
        currentTournamentTab = forceTab || (hasPairings ? 'pairings' : 'standings');
        currentViewingRound = forceRound !== null ? parseInt(forceRound) : (currentTournament.current_round || 1);

    } else {
        // ── DRAFT or other: use extendedTournaments data ──────────────────────
        currentTournamentTab = forceTab || 'overview';
        currentViewingRound = forceRound !== null ? parseInt(forceRound) : 1;
    }

    renderTournamentDetail();
}

function switchViewingRound(round) {
    currentViewingRound = parseInt(round);
    renderTournamentDetail();
}

function renderTournamentDetail() {
    if (!currentTournament) return;
    const grid = document.getElementById('tournamentsGrid');
    const statusClass = currentTournament.status || 'draft';
    const statusLabel = statusClass.charAt(0).toUpperCase() + statusClass.slice(1);
    const roundsPlayed = currentTournament.pairings ? Math.max(...currentTournament.pairings.map(p => p.round || 0), 0) : 0;

    if (grid) grid.innerHTML = `
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
                                <span>&#x1F4C5; ${new Date(currentTournament.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                                <span>🎯 ${formatDisplayName(currentTournament.format)}</span>
                                <span>⏱ ${currentTournament.timeControl || currentTournament.time_control || '—'}</span>
                                <span>👥 ${currentTournament.players.length} Players</span>
                                <span class="tournament-status-badge ${statusClass}">${statusLabel}</span>
                            </div>
                        </div>
                        <div style="display: flex; gap: 10px;">
                            ${isAdmin && (currentTournament.status === 'active' || currentTournament.status === 'draft') && roundsPlayed === 0 ? `<button class="btn-primary" onclick="openPlayerSelection('${currentTournament?.id ?? ''}')">Select Players</button>` : ''}
                            ${isAdmin && currentTournament.status === 'active' && roundsPlayed > 0 ? `<button class="btn-secondary" onclick="closeTournament()">Close Tournament</button>` : ''}
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
    const isCompleted = currentTournament.status?.toLowerCase() === 'completed';
    const totalRoundsNum = currentTournament.total_rounds || currentTournament.totalRounds || 0;
    const roundsPlayed = isCompleted ? totalRoundsNum : Math.max(0, (currentTournament.current_round || 1) - 1);
    const totalGames = (currentTournament.pairings || []).filter(p => p.result && !p.isBye).length;

    return `
            <div class="tournament-summary" >
                    <h3 class="tournament-summary-title">Tournament Progress</h3>
                    <div class="tournament-summary-grid">
                        <div class="tournament-summary-item">
                            <div class="tournament-summary-label">Rounds Completed</div>
                            <div class="tournament-summary-value">${roundsPlayed} / ${totalRoundsNum || 'TBD'}</div>
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
                            <div class="tournament-summary-value" style="color: var(--accent-gold);">${[...currentTournament.players].sort((a, b) => b.points - a.points)[0]?.name || 'N/A'}</div>
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

    const winner        = sorted.length > 0 ? sorted[0] : null;
    const runnerUp      = sorted[1] || null;
    const secondRunnerUp = sorted[2] || null;
    const biggestGainer = [...sorted].sort((a, b) => (b.rating_change || 0) - (a.rating_change || 0))[0];

    const winnerName = winner?.name || 'Champion';
    const tournamentTitle = currentTournament.name || '';
    const tournamentDateStr = currentTournament.date ? new Date(currentTournament.date).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }) : '';

    return `
            <div class="tournament-complete-banner" style="
                margin-top: 28px;
                margin-bottom: 32px;
                background: linear-gradient(160deg, rgba(240,165,0,0.11) 0%, rgba(13,17,23,0) 65%);
                border: 1.5px solid rgba(240,165,0,0.28);
                border-radius: 20px;
                padding: 36px 28px 30px;
                text-align: center;
                position: relative;
                overflow: hidden;">

                <!-- top glow -->
                <div style="position:absolute;top:-60px;left:50%;transform:translateX(-50%);width:300px;height:180px;background:radial-gradient(ellipse,rgba(240,165,0,0.22) 0%,transparent 68%);pointer-events:none;"></div>

                <!-- Beautiful trophy SVG -->
                <div style="display:inline-block;margin-bottom:18px;
                    filter:drop-shadow(0 6px 14px rgba(240,165,0,0.4)) drop-shadow(0 0 50px rgba(240,165,0,0.2));
                    animation:trophyFloat 3.5s ease-in-out infinite;">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 220" width="160" height="176">
                    <defs>
                      <linearGradient id="cg" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%"   stop-color="#FFF0A0"/>
                        <stop offset="25%"  stop-color="#FFD040"/>
                        <stop offset="55%"  stop-color="#F0A500"/>
                        <stop offset="80%"  stop-color="#C07800"/>
                        <stop offset="100%" stop-color="#7A4A00"/>
                      </linearGradient>
                      <linearGradient id="hg" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%"   stop-color="#C07800"/>
                        <stop offset="40%"  stop-color="#F0A500"/>
                        <stop offset="100%" stop-color="#C07800"/>
                      </linearGradient>
                      <linearGradient id="bg" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%"   stop-color="#FFD040"/>
                        <stop offset="50%"  stop-color="#C07800"/>
                        <stop offset="100%" stop-color="#7A4A00"/>
                      </linearGradient>
                      <linearGradient id="sg" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%"   stop-color="#9A6000"/>
                        <stop offset="40%"  stop-color="#F0A500"/>
                        <stop offset="100%" stop-color="#9A6000"/>
                      </linearGradient>
                      <radialGradient id="is" cx="70%" cy="30%" r="65%">
                        <stop offset="0%"   stop-color="rgba(255,255,255,0.12)"/>
                        <stop offset="100%" stop-color="rgba(0,0,0,0.25)"/>
                      </radialGradient>
                      <linearGradient id="sh" x1="0%" y1="0%" x2="60%" y2="100%">
                        <stop offset="0%"   stop-color="rgba(255,255,255,0.45)"/>
                        <stop offset="40%"  stop-color="rgba(255,255,255,0.08)"/>
                        <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
                      </linearGradient>
                    </defs>
                    <!-- Base plates -->
                    <rect x="44" y="190" width="112" height="14" rx="5" fill="url(#bg)"/>
                    <rect x="44" y="190" width="112" height="3"  rx="2" fill="rgba(255,220,80,0.45)"/>
                    <rect x="54" y="178" width="92"  height="14" rx="4" fill="url(#bg)"/>
                    <rect x="54" y="178" width="92"  height="3"  rx="2" fill="rgba(255,220,80,0.4)"/>
                    <!-- Stem -->
                    <path d="M88 156 Q94 167 100 178 Q106 167 112 156 Q106 162 100 162 Q94 162 88 156 Z" fill="url(#sg)"/>
                    <path d="M96 156 Q97 163 98 172" stroke="rgba(255,240,120,0.4)" stroke-width="2.5" stroke-linecap="round" fill="none"/>
                    <!-- Cup body -->
                    <path d="M44 28 Q38 28 36 36 Q30 78 42 108 Q54 132 72 142 Q80 150 88 156 L112 156 Q120 150 128 142 Q146 132 158 108 Q170 78 164 36 Q162 28 156 28 Z" fill="url(#cg)"/>
                    <path d="M44 28 Q38 28 36 36 Q30 78 42 108 Q54 132 72 142 Q80 150 88 156 L112 156 Q120 150 128 142 Q146 132 158 108 Q170 78 164 36 Q162 28 156 28 Z" fill="url(#is)"/>
                    <!-- Sheen -->
                    <path d="M50 32 Q52 28 68 26 Q80 25 88 30 Q72 34 60 48 Q50 62 48 80 Q44 58 50 32 Z" fill="url(#sh)"/>
                    <!-- Rim -->
                    <ellipse cx="100" cy="28" rx="57" ry="10" fill="#FFE060" opacity="0.75"/>
                    <ellipse cx="100" cy="29" rx="50" ry="7"  fill="rgba(120,70,0,0.35)"/>
                    <!-- Handles -->
                    <path d="M36 36 Q14 40 12 62 Q10 84 28 94 Q36 98 44 94" fill="none" stroke="url(#hg)" stroke-width="10" stroke-linecap="round"/>
                    <path d="M36 36 Q16 42 14 62 Q12 80 28 90" fill="none" stroke="rgba(255,240,120,0.35)" stroke-width="3.5" stroke-linecap="round"/>
                    <path d="M164 36 Q186 40 188 62 Q190 84 172 94 Q164 98 156 94" fill="none" stroke="url(#hg)" stroke-width="10" stroke-linecap="round"/>
                    <path d="M164 36 Q184 42 186 62 Q188 80 172 90" fill="none" stroke="rgba(255,240,120,0.35)" stroke-width="3.5" stroke-linecap="round"/>
                    <!-- Engraving band -->
                    <path d="M44 90 Q100 96 156 90" stroke="rgba(200,140,0,0.5)" stroke-width="1.5" fill="none"/>
                    <path d="M48 96 Q100 102 152 96" stroke="rgba(200,140,0,0.4)" stroke-width="1" fill="none"/>
                    <!-- Star emblem -->
                    <path d="M100 54 L104 68 L119 68 L107 77 L111 91 L100 82 L89 91 L93 77 L81 68 L96 68 Z" fill="rgba(255,255,255,0.18)" stroke="rgba(255,230,80,0.3)" stroke-width="1"/>
                    <!-- Shine strokes -->
                    <path d="M62 38 Q60 60 62 82" stroke="rgba(255,255,255,0.22)" stroke-width="4"   stroke-linecap="round" fill="none"/>
                    <path d="M70 32 Q68 50 70 66" stroke="rgba(255,255,255,0.14)" stroke-width="2.5" stroke-linecap="round" fill="none"/>
                    <!-- Sparkles -->
                    <g style="animation:trophySpark 1.4s ease-in-out infinite">
                      <path d="M30,12 L31.8,17.4 L37.6,17.4 L33,21 L34.8,26.4 L30,22.5 L25.2,26.4 L27,21 L22.4,17.4 L28.2,17.4 Z" fill="#FFD700"/>
                    </g>
                    <g style="animation:trophySpark 1.7s ease-in-out infinite;animation-delay:0.5s">
                      <path d="M172,8 L173.5,12.6 L178.4,12.6 L174.5,15.6 L176,20 L172,17.3 L168,20 L169.5,15.6 L165.6,12.6 L170.5,12.6 Z" fill="#FFD700"/>
                    </g>
                    <g style="animation:trophySpark 1.1s ease-in-out infinite;animation-delay:0.3s">
                      <circle cx="14" cy="52" r="4" fill="#FFD700"/>
                    </g>
                    <g style="animation:trophySpark 1.9s ease-in-out infinite;animation-delay:0.8s">
                      <circle cx="186" cy="56" r="3.5" fill="#FFD700"/>
                    </g>
                    <g style="animation:trophySpark 1.3s ease-in-out infinite;animation-delay:0.2s">
                      <circle cx="42"  cy="20" r="2.5" fill="#FFD700" opacity="0.7"/>
                    </g>
                    <g style="animation:trophySpark 2s ease-in-out infinite;animation-delay:0.9s">
                      <circle cx="160" cy="18" r="2.5" fill="#FFD700" opacity="0.7"/>
                    </g>
                  </svg>
                </div>

                <style>
                  @keyframes trophyFloat {
                    0%,100%{transform:translateY(0px) rotate(-1deg)}
                    50%{transform:translateY(-8px) rotate(1deg)}
                  }
                  @keyframes trophySpark {
                    0%,100%{opacity:0.15;transform:scale(0.5)}
                    50%{opacity:1;transform:scale(1.2)}
                  }
                </style>

                <div style="font-size:11px;letter-spacing:2.5px;text-transform:uppercase;color:var(--text-secondary);font-weight:600;margin-bottom:6px;">Tournament Champion</div>
                <div style="font-size:26px;font-weight:900;color:var(--accent-gold);text-shadow:0 0 32px rgba(240,165,0,0.45);margin-bottom:8px;">${winnerName}</div>
                <div style="display:inline-block;background:rgba(240,165,0,0.1);border:1px solid rgba(240,165,0,0.3);color:var(--accent-gold);font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:4px 16px;border-radius:20px;margin-bottom:12px;">Champion</div>
                <div style="font-size:12px;color:var(--text-secondary);opacity:0.65;">${tournamentTitle} &nbsp;&middot;&nbsp; ${tournamentDateStr}</div>
            </div>

            <div class="tournament-summary" style="margin-top: 28px;">
                    <h3 class="tournament-summary-title">Final Summary</h3>
                    <div class="tournament-summary-grid final-summary-grid" style="grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));">
                        <div class="tournament-summary-item">
                            <div class="tournament-summary-label">🥇 Champion</div>
                            <div class="tournament-summary-value" style="color: #FFD700;">${winner?.name || 'N/A'}</div>
                        </div>
                        <div class="tournament-summary-item">
                            <div class="tournament-summary-label">🥈 Runner-up</div>
                            <div class="tournament-summary-value" style="color: #C0C0C0;">${runnerUp?.name || 'N/A'}</div>
                        </div>
                        ${secondRunnerUp ? `
                        <div class="tournament-summary-item">
                            <div class="tournament-summary-label">🥉 2nd Runner-up</div>
                            <div class="tournament-summary-value" style="color: #CD7F32;">${secondRunnerUp.name}</div>
                        </div>` : ''}
                        <div class="tournament-summary-item">
                            <div class="tournament-summary-label">Biggest Gain</div>
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
    const pairings = currentTournament.pairings || [];

    // Active tournament on another device — pairings not yet available in DB
    if (currentTournament._pairingsNotYetSynced && !isAdmin) {
        return `
            <div style="text-align:center;padding:48px 20px;">
                <div style="font-size:36px;margin-bottom:16px;">&#x1F4E1;</div>
                <div style="font-weight:600;font-size:16px;color:var(--text-primary);margin-bottom:8px;">Tournament In Progress</div>
                <div style="color:var(--text-secondary);font-size:13px;max-width:280px;margin:0 auto;line-height:1.6;">
                    Round pairings will appear here once each round is confirmed by the tournament admin.
                    Check the <strong>Standings</strong> tab to see player points.
                </div>
            </div>`;
    }

    const maxRound = Math.max(...pairings.map(p => p.round || 0), 0);
    const currentRound = currentTournament.current_round || 1;

    // Ensure currentViewingRound is valid
    if (!currentViewingRound || currentViewingRound > maxRound) {
        currentViewingRound = currentRound;
    }

    // Round Navigation Pills
    let navHtml = '<div class="round-nav">';
    for (let r = 1; r <= maxRound; r++) {
        const roundPairings = pairings.filter(p => p.round === r);
        const isCompleted = roundPairings.length > 0 && roundPairings.every(p => p.result !== null || p.isBye);
        const isActive = r === currentViewingRound;

        navHtml += `
            <div class="round-pill ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}" onclick="switchViewingRound(${r})">
                Round ${r} ${isCompleted ? '<span class="check-icon">✓</span>' : ''}
            </div>
        `;
    }
    navHtml += '</div>';

    // Filter pairings for the viewing round
    const viewingRoundPairings = pairings.filter(p => p.round === currentViewingRound);

    if (viewingRoundPairings.length === 0) {
        return navHtml + `<div style="text-align: center; padding: 40px; color: var(--text-secondary);">No pairings for this round.</div>`;
    }

    const isCurrentActiveRound = currentViewingRound === currentRound && currentTournament.status?.toLowerCase() === 'active';
    const resultsRemaining = viewingRoundPairings.filter(p => p.result === null && !p.isBye).length;

    let html = navHtml;

    html += `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
            <h3 style="margin: 0;">Round ${currentViewingRound} Pairings</h3>
            ${isCurrentActiveRound ? `
                <div style="font-size: 14px; color: ${resultsRemaining === 0 ? 'var(--success)' : 'var(--text-secondary)'};">
                    ${resultsRemaining === 0
                        ? '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><polyline points="20 6 9 17 4 12"></polyline></svg>All results entered'
                        : `${resultsRemaining} result${resultsRemaining === 1 ? '' : 's'} remaining`}
                </div>
            ` : ''}
        </div>
        <div class="pairings-list">
            ${viewingRoundPairings.map((pairing) => {
        const absIdx = pairings.indexOf(pairing);
        return renderPairingCard(pairing, absIdx);
    }).join('')}
        </div>
    `;

    if (isCurrentActiveRound && isAdmin) {
        html += `
            <div class="round-actions-sticky" style="margin-top: 24px; padding: 16px; background: var(--bg-secondary); border-radius: 8px; border: 1px solid var(--border-color); display: flex; justify-content: flex-end; gap: 12px; position: sticky; bottom: 20px; z-index: 100;">
                <button class="btn-primary" id="nextRoundBtn" onclick="generateNextRound()" ${resultsRemaining > 0 ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}>
                    ${currentViewingRound === (currentTournament.total_rounds || currentTournament.totalRounds) ? 'Finish Tournament' : 'Generate Next Round'}
                </button>
            </div>
        `;
    }

    return html;
}

function renderPairingCard(pairing, idx) {
    const isBye = pairing.isBye;
    const isCompleted = currentTournament.status === 'Completed';

    const resultOptions = `
            <option value="" ${pairing.result === null ? 'selected' : ''}>Select Result</option>
            <option value="1-0" ${pairing.result === '1-0' ? 'selected' : ''}>1-0 (White Wins)</option>
            <option value="1/2-1/2" ${pairing.result === '1/2-1/2' ? 'selected' : ''}>½-½ (Draw)</option>
            <option value="0-1" ${pairing.result === '0-1' ? 'selected' : ''}>0-1 (Black Wins)</option>
        `;

    return `
            <div class="pairing-card ${isBye ? 'bye-card' : ''}" style="display: grid; grid-template-columns: 1fr auto 1fr auto; align-items: center; gap: 16px; padding: 16px; background: var(--bg-secondary); border-radius: 8px; margin-bottom: 12px; border: 1px solid var(--border-color);">
                    <div class="pairing-player white" style="text-align: right;">
                        <h4 style="margin: 0; font-size: 16px;">${pairing.whiteName}</h4>
                        <div class="rating" style="font-size: 12px; color: var(--text-secondary);">Rating: ${pairing.whiteRatingBefore ?? '—'}</div>
                    </div>

                    <div class="pairing-vs" style="font-size: 12px; color: var(--text-muted); font-weight: 500;">VS</div>

                    <div class="pairing-player black" style="text-align: left;">
                        <h4 style="margin: 0; font-size: 16px;">${pairing.blackName}</h4>
                        <div class="rating" style="font-size: 12px; color: var(--text-secondary);">Rating: ${pairing.isBye ? '—' : (pairing.blackRatingBefore ?? '—')}</div>
                    </div>

                <div class="pairing-result">
                        ${isBye ? `
                            <span class="badge-bye" style="background: var(--bg-tertiary); padding: 4px 12px; border-radius: 4px; font-weight: 600; color: var(--accent-gold);">BYE</span>
                        ` : (isAdmin && pairing.round === currentTournament.current_round && currentTournament.status?.toLowerCase() === 'active' ? `
                            <select onchange="recordResult('${pairing.id || idx}', this.value)" 
                                    style="padding: 8px; background: var(--bg-tertiary); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 4px; width: 140px;">
                                ${resultOptions}
                            </select>
                        ` : `
                            <div class="result-badge ${pairing.result ? 'confirmed' : 'pending'}" 
                                 style="padding: 6px 12px; background: var(--bg-tertiary); border-radius: 4px; font-weight: 600; font-size: 14px; color: var(--accent-gold); min-width: 80px; text-align: center;">
                                ${formatResult(pairing.result) || 'Pending'}
                            </div>
                        `)}
                    </div>
            </div>
        `;
}

function recordResult(pairingId, result) {
    const local = window._localTournament || currentTournament;
    if (!local) return;

    // Find pairing in current round
    const pairing = local.pairings
        ? local.pairings.find(p => (p.id === pairingId || local.pairings.indexOf(p).toString() === pairingId))
        : null;

    if (!pairing) return;
    if (pairing.isBye) return;
    if (local.synced) return; // locked after sync

    pairing.result = result === '' ? null : result;

    // Sync the updated pairing back into the rounds array
    if (local.rounds) {
        const roundEntry = local.rounds.find(r => r.roundNumber === (local.current_round || 1));
        if (roundEntry) {
            const pi = roundEntry.pairings.findIndex(p => p.id === pairing.id);
            if (pi >= 0) roundEntry.pairings[pi] = pairing;
        }
    }

    // Save locally - no Supabase call
    if (window._localTournament) {
        saveLocalTournament();
    }

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
                        <span class="col-change">Rating</span>
                    </div>
                    <div class="standings-body">
                        ${sorted.map((player, idx) => `
                            <div class="standings-row">
                                <span class="col-rank" style="font-weight: 700; ${idx < 3 ? 'color: var(--accent-gold);' : ''}">${idx + 1}</span>
                                <span class="col-player" style="font-weight: 500;">${player.name}</span>
                                <span class="col-points" style="font-weight: 600; color: var(--accent-gold);">${formatPoints(player.points)}</span>
                                <span class="col-w">${player.wins || 0}</span>
                                <span class="col-d">${player.draws || 0}</span>
                                <span class="col-l">${player.losses || 0}</span>
                                <span class="col-buchholz">${formatPoints(player.buchholz)}</span>
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
                                <span class="bracket-score">${pairing.result ? formatScorePart(pairing.result.split('-')[0]) : ''}</span>
                            </div>
                            <div class="bracket-player ${blackWon && isFinal ? 'winner' : blackWon ? '' : (pairing.result === '1-0' ? 'eliminated' : '')}">
                                <span class="bracket-player-name">${pairing.blackName}</span>
                                <span class="bracket-score">${pairing.result ? formatScorePart(pairing.result.split('-')[1]) : ''}</span>
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
    // Always use the most up-to-date local state
    const live = window._localTournament || currentTournament;
    if (!live) return;
    // Keep currentTournament in sync
    currentTournament = live;
    const currentRound = live.current_round || 1;
    const currentRoundPairings = (live.pairings || []).filter(p => p.round === currentRound);
    showRoundConfirmModal(currentRoundPairings);
}

function showRoundConfirmModal(pairings) {
    const modal = document.getElementById('roundConfirmModal');
    const content = document.getElementById('roundConfirmList');
    const currentRound = currentTournament.current_round || 1;

    if (content) content.innerHTML = `
        <div style="margin-bottom: 20px;">
            <h3 style="color: var(--accent-gold); margin-bottom: 4px;">Confirm Round ${currentRound} Results</h3>
            <p style="color: var(--text-secondary); font-size: 14px;">Please verify these results before proceeding.</p>
        </div>

        <div class="confirm-results-list" style="margin-bottom: 24px; background: var(--bg-tertiary); border-radius: 8px; overflow: hidden; border: 1px solid var(--border-color);">
            ${pairings.map(p => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--border-color);">
                    <div style="display: flex; flex-direction: column;">
                        <span style="font-size: 14px; font-weight: 600;">${p.whiteName} vs ${p.blackName}</span>
                    </div>
                    <span style="font-weight: 700; color: var(--accent-gold); background: var(--bg-secondary); padding: 4px 12px; border-radius: 4px; border: 1px solid var(--border-color);">${formatResult(p.result) || 'BYE'}</span>
                </div>
            `).join('')}
        </div>
    `;

    const confirmBtn = document.getElementById('confirmRoundBtn');
    if (confirmBtn) {
        const _totalR = currentTournament.total_rounds || currentTournament.totalRounds || 0;
        confirmBtn.textContent = currentRound >= _totalR ? 'Finish Tournament' : `Confirm & Generate Round ${currentRound + 1}`;
    }

    modal.classList.add('active');
}

async function confirmRoundSubmit() {
    // Always use most up-to-date local state and keep both refs in sync
    const local = window._localTournament || currentTournament;
    if (!local) return;
    currentTournament = local;

    const currentRound = local.current_round || 1;
    const totalRounds = local.total_rounds || local.totalRounds || 0;
    const isLastRound = currentRound >= totalRounds;
    const currentRoundPairings = (local.pairings || []).filter(p => p.round === currentRound);

    // Guard: all non-bye pairings must have results
    const missing = currentRoundPairings.filter(p => !p.isBye && !p.result);
    if (missing.length > 0) {
        showToast(`${missing.length} result(s) still missing.`, 'error');
        return;
    }

    const btn = document.getElementById('confirmRoundBtn');
    const originalText = btn ? btn.textContent : 'Confirm';
    const modal = document.getElementById('roundConfirmModal');

    try {
        if (btn) { btn.disabled = true; btn.textContent = isLastRound ? 'Finishing...' : 'Confirming...'; }
        showLoadingModal(isLastRound ? 'Finishing tournament & syncing to database...' : 'Confirming round results...');

        // ── STEP 1: Stamp results onto the current round's pairings ─────────
        // We only write result metadata (rating snapshots) here.
        // Points/wins/draws/losses are NOT accumulated inline — instead we call
        // recalculateFromRound() below which replays all rounds from scratch.
        // This makes confirm idempotent: confirming the same round twice never
        // double-counts points, even if the page was refreshed mid-tournament.
        for (const pairing of currentRoundPairings) {
            if (pairing.isBye || !pairing.result) continue;

            const whiteP = local.players.find(p => p.id === pairing.white);
            const blackP = local.players.find(p => p.id === pairing.black);

            const rv = pairing.result === '1-0' ? 1 : pairing.result === '0-1' ? 0 : 0.5;
            const wRating = whiteP?.currentRating || pairing.whiteRatingBefore || 1600;
            const bRating = blackP?.currentRating || pairing.blackRatingBefore || 1600;

            // Snapshot ratings before this round if not already set
            if (!pairing.whiteRatingBefore) pairing.whiteRatingBefore = wRating;
            if (!pairing.blackRatingBefore) pairing.blackRatingBefore = bRating;

            const wElo = calculateElo(wRating, bRating, rv);
            const bElo = calculateElo(bRating, wRating, 1 - rv);

            pairing.whiteRatingAfter  = wRating + wElo.change;
            pairing.blackRatingAfter  = bRating + bElo.change;
            pairing.whiteRatingChange = wElo.change;
            pairing.blackRatingChange = bElo.change;
        }

        // Mark round as completed locally
        if (local.rounds) {
            const rd = local.rounds.find(r => r.roundNumber === currentRound);
            if (rd) rd.status = 'Completed';
        }

        // ── STEP 2: Recalculate ALL stats from scratch (idempotent) ──────────
        // recalculateFromRound() resets every player to zero then replays every
        // completed pairing in order. It also recomputes Buchholz and peak ratings.
        // This is the ONLY place stats are written — never inline accumulation.
        // Pairings array on local uses {white, black, result} format expected by
        // recalculateFromRound (which uses whitePlayerId/blackPlayerId). Bridge it:
        const _pairingsForRecalc = (local.pairings || []).map(p => ({
            ...p,
            whitePlayerId: p.white,
            blackPlayerId: p.black,
        }));
        const _localForRecalc = { ...local, rounds: (local.rounds || []).map(r => ({
            ...r,
            pairings: _pairingsForRecalc.filter(p => p.round === r.roundNumber),
        }))};
        // Rounds that have no round object yet (freshly added) — build a synthetic one
        const completedRoundNumbers = [...new Set(
            (local.pairings || []).filter(p => p.result || p.isBye).map(p => p.round)
        )];
        const syntheticRounds = completedRoundNumbers.map(rn => ({
            roundNumber: rn,
            status: 'Completed',
            pairings: _pairingsForRecalc.filter(p => p.round === rn),
        }));
        _localForRecalc.rounds = syntheticRounds;
        recalculateFromRound(_localForRecalc);

        // ── Copy recalculated stats back onto real local.players ─────────────
        for (const tp of _localForRecalc.players) {
            const real = local.players.find(p => p.id === tp.id);
            if (!real) continue;
            real.points        = tp.points;
            real.wins          = tp.wins;
            real.draws         = tp.draws;
            real.losses        = tp.losses;
            real.byes          = tp.byes;
            real.buchholz      = tp.buchholz;
            real.currentRating = tp.currentRating;
            real.peakRating    = tp.peakRating || real.peakRating;
        }

        // ── Write recalculated rating values back to local.pairings ──────────
        // recalculateFromRound updates _pairingsForRecalc in-place with correct
        // rating fields. Copy back so step 7 uses correct final ratings.
        for (const rp of _pairingsForRecalc) {
            const lp = (local.pairings || []).find(
                p => p.round === rp.round && p.white === rp.white && p.black === rp.black
            );
            if (!lp) continue;
            lp.whiteRatingBefore = rp.whiteRatingBefore;
            lp.whiteRatingAfter  = rp.whiteRatingAfter;
            lp.whiteRatingChange = rp.whiteRatingChange;
            lp.blackRatingBefore = rp.blackRatingBefore;
            lp.blackRatingAfter  = rp.blackRatingAfter;
            lp.blackRatingChange = rp.blackRatingChange;
        }

        if (isLastRound) {
            // ── LAST ROUND: Full Supabase sync ────────────────────────────────
            // Close ALL modals BEFORE sync starts so nothing shows during the 8 steps
            document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
            showLoadingModal('Finishing tournament & syncing to database...');

            local.status = 'Completed';
            local.synced = true;
            saveLocalTournament();
            await _syncTournamentToSupabase(local);

            // Clear local state immediately after successful sync
            localStorage.removeItem('bcc_active_tournament');
            window._localTournament = null;
            currentTournament = null;

            // Keep loading modal up through refresh to prevent blank flash
            showLoadingModal('Finalising — loading completed tournament...');

            // Refresh data from DB — ratings, standings, completed tournament
            try { await silentRefresh(); } catch(e) { console.warn('Post-finish refresh failed:', e); }

            // Navigate using showSection so renderTournaments() runs correctly
            // currentTournament is already null so showSection won't re-open the detail modal
            document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
            const tNav = document.querySelector('[data-section="tournaments"]');
            if (tNav) tNav.classList.add('active');
            showSection('tournaments');

            // Switch to completed tab, then reveal — no flash
            switchStatusTab('completed');
            hideLoadingModal();
            showToast('Tournament complete! All results synced to database.', 'success');
        } else {
            // ── MID TOURNAMENT: save locally + sync completed round to DB ────
            local.current_round = currentRound + 1;
            window._localTournament = local;
            currentTournament = local;
            saveLocalTournament();

            generateRoundLocally();

            currentTournament = window._localTournament;
            currentTournamentTab = 'pairings';
            currentViewingRound = currentRound + 1;
            hideLoadingModal();
            if (modal) modal.classList.remove('active');
            // Ensure tournament detail modal stays open (mobile closes it on any overlay tap)
            const detailModal = document.getElementById('tournamentDetailModal');
            if (detailModal) detailModal.classList.add('active');
            renderTournamentDetail();
            showToast(`Round ${currentRound} confirmed. Round ${currentRound + 1} pairings ready.`, 'success');

            // ── Sync completed round (with results) then next round pairings ──
            const tid = local.id;
            const completedPairings = currentRoundPairings.map(p => ({
                tournament_id: tid,
                white_player_id: p.white,
                black_player_id: p.isBye ? null : p.black,
                result: p.result || null,
                white_rating_before: p.whiteRatingBefore || 1600,
                black_rating_before: p.isBye ? null : (p.blackRatingBefore || 1600),
                white_rating_after: p.whiteRatingAfter || p.whiteRatingBefore || 1600,
                black_rating_after: p.isBye ? null : (p.blackRatingAfter || p.blackRatingBefore || 1600),
                white_rating_change: p.whiteRatingChange || 0,
                black_rating_change: p.isBye ? null : (p.blackRatingChange || 0),
                is_bye: p.isBye || false
            }));
            const liveStandings = (local.players || []).map(p => ({
                tournament_id: tid, player_id: p.id,
                points: p.points || 0, wins: p.wins || 0, draws: p.draws || 0,
                losses: p.losses || 0, byes: p.byes || 0,
                rating_at_start: p.ratingAtStart || p.currentRating || 1600,
                rating_change: (p.currentRating || p.ratingAtStart || 1600) - (p.ratingAtStart || 1600),
                buchholz: p.buchholz || 0
            }));
            api.syncRoundToDb(tid, currentRound, completedPairings, liveStandings)
                .then(() => {
                    // Also push next round pairings so viewers see upcoming matchups
                    const nextRound = currentRound + 1;
                    const nextRoundPairings = (window._localTournament?.pairings || []).filter(p => p.round === nextRound);
                    if (nextRoundPairings.length > 0) {
                        const nextRows = nextRoundPairings.map(p => ({
                            tournament_id: tid,
                            white_player_id: p.white,
                            black_player_id: p.isBye ? null : p.black,
                            result: null,
                            white_rating_before: window._localTournament?.players?.find(x => x.id === p.white)?.currentRating || 1600,
                            black_rating_before: p.isBye ? null : (window._localTournament?.players?.find(x => x.id === p.black)?.currentRating || 1600),
                            white_rating_after: null, black_rating_after: null,
                            white_rating_change: null, black_rating_change: null,
                            is_bye: p.isBye || false
                        }));
                        return api.syncRoundToDb(tid, nextRound, nextRows, liveStandings);
                    }
                })
                .catch(e => console.warn('[Sync] Background round sync failed:', e));
        }

    } catch (err) {
        console.error('confirmRoundSubmit error:', err);
        showToast('Error: ' + (err.message || err), 'error');
    } finally {
        hideLoadingModal();
        const freshBtn = document.getElementById('confirmRoundBtn');
        if (freshBtn) { freshBtn.disabled = false; freshBtn.textContent = originalText; }
    }
}

// ── Full tournament sync to Supabase (called only on Finish Tournament) ──────
// ── Full tournament sync to Supabase (called only on Finish Tournament) ──────
async function _syncTournamentToSupabase(local) {
    const tid = local.id;
    if (!tid) throw new Error('No tournament ID');

    // Safety net — always hide loading modal after 30s no matter what
    const _safetyTimer = setTimeout(() => {
        hideLoadingModal();
        console.warn('[Sync] Safety timeout triggered — modal force-closed');
    }, 30000);

    try {
    // ── STEP 1: Mark tournament Completed ───────────────────────────────────
    showLoadingModal('Step 1/8: Updating tournament status...');
    await api.updateTournament(tid, {
        status: 'Completed',
        current_round: local.total_rounds || local.totalRounds
    });

    // ── STEP 2: Insert rounds (idempotent — skip if already exist) ──────────
    showLoadingModal('Step 2/8: Saving rounds...');
    let savedRounds = await api.fetchRoundsForTournament(tid);
    if (savedRounds.length === 0) {
        const roundInserts = (local.rounds || []).map(r => ({
            tournament_id: tid,
            round_number: r.roundNumber,
            status: 'Completed'
        }));
        savedRounds = await api.insertRounds(roundInserts);
    } else {
        
    }
    const roundIdMap = {};
    savedRounds.forEach(r => { roundIdMap[r.round_number] = r.id; });

    // ── STEP 3: Upsert pairings with final results ───────────────────────────
    // Pairings may already exist from per-round syncs but with null results.
    // Always delete and re-insert with the authoritative local results.
    showLoadingModal('Step 3/8: Saving pairings...');
    await api.deleteAllPairingsForTournament(tid);
    const pairingInserts = (local.pairings || []).map(p => ({
        tournament_id: tid,
        round_id: roundIdMap[p.round] || null,
        white_player_id: p.white,
        black_player_id: p.isBye ? null : p.black,
        result: p.result,
        white_rating_before: p.whiteRatingBefore || 1600,
        black_rating_before: p.isBye ? null : (p.blackRatingBefore || 1600),
        white_rating_after: p.whiteRatingAfter || p.whiteRatingBefore || 1600,
        black_rating_after: p.isBye ? null : (p.blackRatingAfter || p.blackRatingBefore || 1600),
        white_rating_change: p.whiteRatingChange || 0,
        black_rating_change: p.isBye ? null : (p.blackRatingChange || 0),
        is_bye: p.isBye || false
    }));
    let savedPairings = [];
    if (pairingInserts.length > 0) {
        savedPairings = await api.insertPairings(pairingInserts);
    }

    // ── STEP 4: Insert games (upsert — always write final rating values) ───────
    showLoadingModal('Step 4/8: Saving game records...');
    // Always delete and re-insert games so final rating values are always correct.
    // (idempotent check was the root cause of ratings not updating on retry)
    await api.deleteGamesForTournament(tid).catch(() => {});
    let insertedGames = [];
    if (true) {
        const gameInserts = (local.pairings || []).filter(p => !p.isBye && p.result).map(p => ({
            tournament_id: tid,
            tournament_name: local.name,
            round_number: p.round,
            date: local.date || new Date().toISOString().split('T')[0],
            white_player_id: p.white,
            black_player_id: p.black,
            white_player_name: p.whiteName,
            black_player_name: p.blackName,
            result: p.result,
            white_rating_before: p.whiteRatingBefore || 1600,
            black_rating_before: p.blackRatingBefore || 1600,
            white_rating_after: p.whiteRatingAfter || p.whiteRatingBefore || 1600,
            black_rating_after: p.blackRatingAfter || p.blackRatingBefore || 1600,
            white_rating_change: p.whiteRatingChange || 0,
            black_rating_change: p.blackRatingChange || 0
        }));
        if (gameInserts.length > 0) {
            insertedGames = await api.insertGames(gameInserts);
        }
    } else {
        
    }

    // ── STEP 5: Insert rating_history ────────────────────────────────────────
    showLoadingModal('Step 5/8: Saving rating history...');
    const ratingHistoryRows = [];
    const now = new Date().toISOString();
    for (const p of (local.pairings || []).filter(x => !x.isBye && x.result)) {
        ratingHistoryRows.push({
            player_id: p.white,
            tournament_id: tid,
            rating_before: p.whiteRatingBefore || 1600,
            rating_after: p.whiteRatingAfter || p.whiteRatingBefore || 1600,
            change: p.whiteRatingChange || 0,
            result: p.result === '1-0' ? 'win' : p.result === '0-1' ? 'loss' : 'draw',
            opponent_name: p.blackName || 'Unknown',
            recorded_at: now
        });
        ratingHistoryRows.push({
            player_id: p.black,
            tournament_id: tid,
            rating_before: p.blackRatingBefore || 1600,
            rating_after: p.blackRatingAfter || p.blackRatingBefore || 1600,
            change: p.blackRatingChange || 0,
            result: p.result === '0-1' ? 'win' : p.result === '1-0' ? 'loss' : 'draw',
            opponent_name: p.whiteName || 'Unknown',
            recorded_at: now
        });
    }
    if (ratingHistoryRows.length > 0) {
        await api.insertRatingHistory(ratingHistoryRows);
    }

    // ── STEP 6: Upsert tournament_players (final standings) ──────────────────
    showLoadingModal('Step 6/8: Saving standings...');
    await api.upsertTournamentPlayers((local.players || []).map(p => ({
        tournament_id: tid,
        player_id: p.id,
        points: p.points || 0,
        wins: p.wins || 0,
        draws: p.draws || 0,
        losses: p.losses || 0,
        byes: p.byes || 0,
        rating_at_start: p.ratingAtStart || p.currentRating || 1600,
        rating_change: (p.currentRating || p.ratingAtStart || 1600) - (p.ratingAtStart || 1600),
        buchholz: p.buchholz || 0
    })));

    // ── STEP 7: Update global player stats from games table (all games, all time) ──
    // games table = tournament games (inserted in step 4) + casual game-log games.
    // This is the only place that has the complete picture — do NOT use pairings here
    // or casual games will be wiped every time a tournament is finished.
    showLoadingModal('Step 7/8: Updating player ratings...');
    const playerIds = local.players.map(p => p.id);
    const allGames = await api.fetchGameResultsForPlayers(playerIds);
    for (const p of local.players) {
        const newRating = p.currentRating || p.ratingAtStart || 1600;
        const myGames = allGames.filter(g => g.white_player_id === p.id || g.black_player_id === p.id);
        const globalWins = myGames.filter(g =>
            (g.white_player_id === p.id && g.result === '1-0') ||
            (g.black_player_id === p.id && g.result === '0-1')).length;
        const globalDraws = myGames.filter(g => g.result === '1/2-1/2').length;
        const globalLosses = myGames.filter(g =>
            (g.white_player_id === p.id && g.result === '0-1') ||
            (g.black_player_id === p.id && g.result === '1-0')).length;
        const globalPlayer = players.find(x => x.id === p.id);
        const peakRating = Math.max(newRating, globalPlayer?.peakRating || 0, p.ratingAtStart || 1600);
        try {
            await api.updatePlayerStats(p.id, {
                bodija_rating: newRating, peak_rating: peakRating,
                wins: globalWins, draws: globalDraws, losses: globalLosses,
                games_played: myGames.length
            });
        } catch(e) { console.warn('[Sync] Player update failed for', p.name, e.message); }
    }

    // ── STEP 8: Head-to-head (non-blocking — failure here must not block finish) ──
    showLoadingModal('Step 8/8: Saving head-to-head records...');
    try {
    const h2hMap = {};
    for (const p of (local.pairings || []).filter(x => !x.isBye && x.result)) {
        const [p1id, p2id] = [p.white, p.black].sort();
        const key = p1id + '|' + p2id;
        const p1IsWhite = p.white === p1id;
        if (!h2hMap[key]) h2hMap[key] = { player1_id: p1id, player2_id: p2id, player1_wins: 0, player2_wins: 0, draws: 0, updated_at: new Date().toISOString() };
        if (p.result === '1/2-1/2') h2hMap[key].draws++;
        else if (p.result === (p1IsWhite ? '1-0' : '0-1')) h2hMap[key].player1_wins++;
        else h2hMap[key].player2_wins++;
    }
    const h2hEntries = Object.values(h2hMap);
    if (h2hEntries.length > 0) {
        const h2hPlayerIds = [...new Set(h2hEntries.flatMap(e => [e.player1_id, e.player2_id]))];
        const existingH2H = await api.fetchH2HForPlayers(h2hPlayerIds);
        const toInsert = [];
        const toUpdate = [];
        for (const entry of h2hEntries) {
            const existing = existingH2H.find(r => r.player1_id === entry.player1_id && r.player2_id === entry.player2_id);
            if (existing) {
                toUpdate.push({ player1_id: entry.player1_id, player2_id: entry.player2_id,
                    player1_wins: (existing.player1_wins || 0) + entry.player1_wins,
                    player2_wins: (existing.player2_wins || 0) + entry.player2_wins,
                    draws: (existing.draws || 0) + entry.draws,
                    updated_at: new Date().toISOString() });
            } else { toInsert.push(entry); }
        }
        if (toInsert.length > 0) await api.insertH2HRows(toInsert);
        if (toUpdate.length > 0) {
            await Promise.all(toUpdate.map(u => api.updateH2HRow(u.player1_id, u.player2_id, {
                player1_wins: u.player1_wins, player2_wins: u.player2_wins,
                draws: u.draws
            })));
        }
    }
    } catch(h2hErr) { console.warn('[Sync] H2H step failed (non-critical):', h2hErr.message); }

    // ── SUCCESS: hide loading modal ─────────────────────────────────────────
    clearTimeout(_safetyTimer);
    hideLoadingModal();

    } catch(err) {
        clearTimeout(_safetyTimer);
        hideLoadingModal();
        throw err; // re-throw so caller's catch handles it
    }
}

function closeRoundConfirm() {
    const modal = document.getElementById('roundConfirmModal');
    if (modal) modal.classList.remove('active');
}

// ==================== CONFIRM MODAL ====================
function showConfirmModal(title, message, onConfirm) {
    const modal = document.getElementById('confirmModal');
    const titleEl = document.getElementById('confirmModalTitle');
    const messageEl = document.getElementById('confirmModalMessage');
    const submitBtn = document.getElementById('confirmModalSubmitBtn');

    if (!modal || !titleEl || !messageEl || !submitBtn) return;

    titleEl.textContent = title;
    messageEl.textContent = message;

    // Remove old listeners by replacing the element
    const newSubmitBtn = submitBtn.cloneNode(true);
    submitBtn.parentNode.replaceChild(newSubmitBtn, submitBtn);

    newSubmitBtn.onclick = async () => {
        closeConfirmModal();
        if (onConfirm) await onConfirm();
    };

    modal.classList.add('active');
}

function closeConfirmModal() {
    const modal = document.getElementById('confirmModal');
    if (modal) modal.classList.remove('active');
}
window.closeConfirmModal = closeConfirmModal;

async function closeTournament() {
    if (!currentTournament) return;

    showConfirmModal(
        'End Tournament Early',
        'Are you sure you want to end this tournament early? Final standings will be locked and the winner will be declared based on current points.',
        async () => {
            try {
                showLoadingModal('Closing tournament...');
                await api.updateTournamentStatus(currentTournament.id, 'Completed');

                // Clear local tournament state
                if (window._localTournament?.id === currentTournament.id) {
                    window._localTournament = null;
                    localStorage.removeItem('bcc_active_tournament');
                }

                document.getElementById('recoveryBanner')?.remove();
                currentTournament = null;

                showToast('Tournament closed successfully', 'success');
                await silentRefresh();

                // Close the detail modal
                const modal = document.getElementById('tournamentDetailModal');
                if (modal) modal.classList.remove('active');
            } catch (error) {
                console.error('Error closing tournament:', error);
                showToast('Failed to close tournament', 'error');
            } finally {
                hideLoadingModal();
            }
        }
    );
}

function closeTournamentDetail() {
    // Keep currentTournament alive if there's an active local tournament
    // (so navigating back to the list and clicking it again restores correctly)
    if (!window._localTournament) {
        currentTournament = null;
    }
    currentTournamentTab = 'overview';
    renderTournaments();
}

// ==================== SEARCH FILTERS ====================
function setupSearchFilters() {
    document.getElementById('leaderboardSearch').addEventListener('input', renderLeaderboard);
    document.getElementById('tournamentFilter').addEventListener('change', renderGamesLog);

    // Tournament page filters (only format filter now)
    const formatFilter = document.getElementById('tournamentFormatFilter');
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
function openFirstActiveTournament() {
    const local = window._localTournament && !window._localTournament.synced ? window._localTournament : null;
    const dbActive = extendedTournaments.find(t => t.status?.toLowerCase() === 'active');
    const target = local || dbActive;
    if (!target) return;

    // Navigate to tournaments section so the modal has proper context
    showSection('tournaments');
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelector('.nav-item[data-section="tournaments"]')?.classList.add('active');

    const modal = document.getElementById('tournamentDetailModal');
    if (modal) modal.classList.add('active');

    if (local && target === local) {
        currentTournament = local;
        currentTournamentTab = 'pairings';
        currentViewingRound = local.current_round || 1;
        renderTournamentDetail();
    } else {
        openTournamentDetail(target.id, 'pairings');
    }
}

window.renderStats = renderStats;
window.openFirstActiveTournament = openFirstActiveTournament;
window._renderLiveTournamentBanner = _renderLiveTournamentBanner;
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
window.toggleGameSearch = function () { };
window.populatePlayerSelects = populatePlayerSelects;
window.openAddGameModal = openAddGameModal;
window.closeAddGameModal = closeAddGameModal;
window.submitGame = submitGame;
window.cancelGameConfirm = cancelGameConfirm;
window.confirmGameSubmit = confirmGameSubmit;
window.initializeTournaments = initializeTournaments;
window.renderTournaments = renderTournaments;

// Export function to manually refresh tournaments from database
window.refreshTournaments = async function () {
    try {
        const fresh = await api.fetchTournaments();
        if (fresh) {
            extendedTournaments.length = 0;
            fresh.forEach(t => {
                const mapped = mapTournamentFromDB(t);
                if (mapped) extendedTournaments.push(mapped);
            });
            renderTournaments();
            showToast('Tournaments refreshed', 'success');
        }
    } catch (e) {
        console.error('Failed to refresh tournaments:', e);
        showToast('Failed to refresh tournaments', 'error');
    }
};
window.renderTournamentCard = renderTournamentCard;
window.openCreateTournamentModal = openCreateTournamentModal;
window.closeCreateTournamentModal = closeCreateTournamentModal;
window.showTournamentStartPreview = showTournamentStartPreview;
window.closeTournamentStartPreviewModal = closeTournamentStartPreviewModal;
window.confirmStartTournament = confirmStartTournament;
window.confirmCreateTournament = function () { /* deprecated */ };
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
window.generateRoundLocally = generateRoundLocally;
window.generateSwissPairings = generateSwissPairings;
window.generateRoundRobinPairings = generateRoundRobinPairings;
window.generateKnockoutPairings = generateKnockoutPairings;
window.openTournamentDetail = openTournamentDetail;
window.renderTournamentDetail = renderTournamentDetail;
window.switchTournamentTab = switchTournamentTab;
window.switchStatusTab = switchStatusTab;
window.switchViewingRound = switchViewingRound;
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
window.formatPoints = formatPoints;
window.openH2HModal = openH2HModal;
window.closeH2HModal = closeH2HModal;
window.switchH2HFilter = switchH2HFilter;
window.populateH2HSelects = populateH2HSelects;
window.openH2HModalMobile = openH2HModalMobile;
window.compareFromMobile = compareFromMobile;
window.compareInline = compareInline;







// ═══════════════════════════════════════════════════════════════════════════
// PWA INSTALL — handles Android/Chrome prompt + iOS manual instructions
// ═══════════════════════════════════════════════════════════════════════════

let _pwaInstallPrompt = null;

function _isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function _isInStandaloneMode() {
    return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
}

function _isAndroidChrome() {
    return /android/i.test(navigator.userAgent) && /chrome/i.test(navigator.userAgent);
}

// Intercept the browser's native install prompt so we can fire it on demand
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // stop auto banner
    _pwaInstallPrompt = e;
    _showInstallBtn();
});

// Hide button once app is successfully installed
window.addEventListener('appinstalled', () => {
    _pwaInstallPrompt = null;
    _hideInstallBtn();
    showToast('BCC installed! Find it on your home screen.', 'success');
});

function _showInstallBtn() {
    const btn = document.getElementById('pwaInstallBtn');
    if (btn) btn.style.display = 'flex';
}

function _hideInstallBtn() {
    const btn = document.getElementById('pwaInstallBtn');
    if (btn) btn.style.display = 'none';
    const tooltip = document.getElementById('pwaIosTooltip');
    if (tooltip) tooltip.style.display = 'none';
}

// Called when user clicks the Install App button
window.triggerPwaInstall = async function() {
    if (_isInStandaloneMode()) {
        // Already installed — should never reach here but just in case
        _hideInstallBtn();
        return;
    }

    if (_pwaInstallPrompt) {
        // Android/Chrome — fire the saved native prompt
        _pwaInstallPrompt.prompt();
        const { outcome } = await _pwaInstallPrompt.userChoice;
        if (outcome === 'accepted') {
            _pwaInstallPrompt = null;
            _hideInstallBtn();
        }
        return;
    }

    if (_isIos()) {
        // iOS — show manual instructions tooltip
        const tooltip = document.getElementById('pwaIosTooltip');
        if (tooltip) {
            tooltip.style.display = tooltip.style.display === 'none' ? 'block' : 'none';
        }
        return;
    }

    // Fallback for other browsers
    showToast('Open this site in Chrome or Safari to install the app.', 'info');
};

// On load — decide what to show
(function initPwaInstallUI() {
    // Already running as installed app — hide everything
    if (_isInStandaloneMode()) {
        _hideInstallBtn();
        return;
    }

    // iOS Safari — show the button (it toggles the tooltip)
    if (_isIos()) {
        _showInstallBtn();
        return;
    }

    // Android/Chrome — button shown only when beforeinstallprompt fires (above)
    // Nothing to do here — button stays hidden until the event fires
})();


// ═══════════════════════════════════════════════════════════════════════════
// REPAIR PLAYER RATINGS — replays all games chronologically, recalculates
// ELO from scratch, then updates the players table. Admin-only, one-time use.
// ═══════════════════════════════════════════════════════════════════════════
window.repairPlayerRatings = async function() {
    if (!confirm('Recalculate all player ratings from game history?\n\nThis will replay every game in chronological order and update all ratings. Run this once after a tournament sync issue.')) return;

    showLoadingModal('Recalculating ratings from game history...');
    try {
        // Fetch all games ordered by date + round
        const { data: allGames, error: gErr } = await supabase
            .from('games')
            .select('id, white_player_id, black_player_id, result, date, round_number, created_at')
            .order('date', { ascending: true })
            .order('round_number', { ascending: true })
            .order('created_at', { ascending: true });
        if (gErr) throw gErr;

        // Fetch all players
        const dbPlayers = await api.fetchPlayers();
        if (!dbPlayers?.length) throw new Error('No players found');

        // Build rating map — start everyone at their DB rating or 1600
        const ratingMap = {};
        const peakMap = {};
        const statsMap = {}; // wins/draws/losses per player
        for (const p of dbPlayers) {
            ratingMap[p.player_id] = 1600; // reset to base
            peakMap[p.player_id] = 1600;
            statsMap[p.player_id] = { wins: 0, draws: 0, losses: 0, games: 0 };
        }

        // Replay every game in order
        const gameUpdates = [];
        for (const g of (allGames || [])) {
            const wId = g.white_player_id;
            const bId = g.black_player_id;
            if (!wId || !bId || !g.result) continue;

            const wBefore = ratingMap[wId] || 1600;
            const bBefore = ratingMap[bId] || 1600;

            const whiteScore = g.result === '1-0' ? 1 : g.result === '1/2-1/2' ? 0.5 : 0;
            const wElo = calculateElo(wBefore, bBefore, whiteScore);
            const bElo = calculateElo(bBefore, wBefore, 1 - whiteScore);

            ratingMap[wId] = wElo.newRating;
            ratingMap[bId] = bElo.newRating;
            peakMap[wId] = Math.max(peakMap[wId] || 0, wElo.newRating);
            peakMap[bId] = Math.max(peakMap[bId] || 0, bElo.newRating);

            if (statsMap[wId]) {
                statsMap[wId].games++;
                if (g.result === '1-0') statsMap[wId].wins++;
                else if (g.result === '1/2-1/2') statsMap[wId].draws++;
                else statsMap[wId].losses++;
            }
            if (statsMap[bId]) {
                statsMap[bId].games++;
                if (g.result === '0-1') statsMap[bId].wins++;
                else if (g.result === '1/2-1/2') statsMap[bId].draws++;
                else statsMap[bId].losses++;
            }

            gameUpdates.push({
                id: g.id,
                white_rating_before: wBefore,
                white_rating_after: wElo.newRating,
                white_rating_change: wElo.change,
                black_rating_before: bBefore,
                black_rating_after: bElo.newRating,
                black_rating_change: bElo.change,
            });
        }

        // Update each game row with correct rating values
        showLoadingModal(`Updating ${gameUpdates.length} game records...`);
        for (const upd of gameUpdates) {
            const { id, ...fields } = upd;
            await supabase.from('games').update(fields).eq('id', id);
        }

        // Update each player with final rating
        showLoadingModal('Updating player ratings...');
        for (const p of dbPlayers) {
            const pid = p.player_id;
            const finalRating = ratingMap[pid] || 1600;
            const finalPeak = Math.max(peakMap[pid] || 0, finalRating);
            const s = statsMap[pid] || { wins: 0, draws: 0, losses: 0, games: 0 };
            await api.updatePlayerStats(p.id, {
                bodija_rating: finalRating,
                peak_rating: finalPeak,
                wins: s.wins,
                draws: s.draws,
                losses: s.losses,
                games_played: s.games,
            });
        }

        // Refresh app data
        await silentRefresh();
        renderLeaderboard();
        renderDashboard();
        renderPlayers();

        hideLoadingModal();
        showToast('Ratings recalculated successfully!', 'success');

    } catch(e) {
        hideLoadingModal();
        console.error('[Repair] Error:', e);
        showToast('Repair failed: ' + sanitizeError(e.message), 'error');
    }
};
