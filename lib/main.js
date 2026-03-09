import * as api from './api.js';
import { supabase, getSupabaseUrl } from './supabase.js';


// ==================== DATA STORE ====================
let players = [];
let games = [];
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
    banner.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1c2128;border:1px solid #F0A500;border-radius:12px;padding:16px 24px;z-index:9000;display:flex;align-items:center;gap:16px;box-shadow:0 8px 32px rgba(0,0,0,0.5);max-width:480px;width:90%;';
    banner.innerHTML = `
        <div style="flex:1;">
            <div style="color:#F0A500;font-weight:600;font-size:14px;">🔄 Unfinished Tournament</div>
            <div style="color:#8b949e;font-size:12px;margin-top:2px;">${local.name} · Round ${local.current_round} of ${local.total_rounds} · Last saved ${timeText}</div>
        </div>
        <button onclick="resumeLocalTournament()" style="background:#F0A500;color:#000;border:none;padding:8px 14px;border-radius:8px;font-weight:600;font-size:12px;cursor:pointer;white-space:nowrap;">Resume</button>
        <button onclick="discardLocalTournament()" style="background:transparent;color:#8b949e;border:1px solid #30363d;padding:8px 14px;border-radius:8px;font-size:12px;cursor:pointer;white-space:nowrap;">Discard</button>
    `;
    document.body.appendChild(banner);
}

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
        try { await supabase.from('tournaments').delete().eq('id', local.id); } catch(e) {}
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
        if (isAdmin) {
            adminLoginBtn.style.display = 'none';
            adminLogoutBtn.style.display = '';
            if (adminEmailDisplay) adminEmailDisplay.textContent = adminEmail;
        } else {
            adminLoginBtn.style.display = '';
            adminLogoutBtn.style.display = 'none';
            if (adminEmailDisplay) adminEmailDisplay.textContent = '';
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
            if (errorEl) errorEl.textContent = error.message;
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
        if (errorEl) errorEl.textContent = 'Error: ' + e.message;
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
            if (errorEl) errorEl.textContent = error.message;
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
        if (errorEl) errorEl.textContent = 'Error: ' + e.message;
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
            if (errorEl) errorEl.textContent = error.message;
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
        if (errorEl) errorEl.textContent = 'Error: ' + e.message;
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

        // Add photo if available
        if (playerPhotoData) {
            requestData.photo = playerPhotoData;
        }

        const { error } = await supabase.from('player_requests').insert([requestData]);

        if (error) {
            // Silently handle - table may not exist in demo mode
        }

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
        // Silently handle errors
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
        console.log('[BCC] loadPlayerRequests: already fetching, skipping');
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
        // First, delete any rejected requests (auto-cleanup) - only if status column exists
        try {
            await supabase.from('player_requests').delete().eq('status', 'rejected');
        } catch (e) {
            // Ignore if status column doesn't exist
        }

        // Try to fetch with status filter, fall back to fetching all
        let data = [];
        let hasStatusColumn = true;

        try {
            const { data: result, error } = await supabase
                .from('player_requests')
                .select('id, name, email, phone, photo, status, created_at')
                .eq('status', 'pending')
                .order('created_at', { ascending: false });

            if (error) {
                hasStatusColumn = false;
            } else {
                data = result || [];
            }
        } catch (e) {
            hasStatusColumn = false;
        }

        // If status column doesn't exist, fetch all and filter locally
        if (!hasStatusColumn) {
            try {
                const { data: result, error } = await supabase
                    .from('player_requests')
                    .select('id, name, email, phone, photo, status, created_at')
                    .order('created_at', { ascending: false });
                data = (result || []).filter(r => r.status === 'pending' || !r.status);
            } catch (e) {

            }
        }

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

    const approved = [];
    const errors = [];

    for (const cb of checkboxes) {
        const id = cb.dataset.id;
        const name = cb.dataset.name;
        const email = cb.dataset.email;
        const phone = cb.dataset.phone;
        const photo = cb.dataset.photo;

        try {
            // Check for existing player with same email
            const { data: existingPlayer } = await supabase
                .from('players')
                .select('id, name')
                .eq('email', email)
                .single();

            if (existingPlayer) {
                // Update request status to duplicate
                await supabase.from('player_requests').update({ status: 'duplicate' }).eq('id', id);
                errors.push(`${name}: Already exists (${existingPlayer.name})`);
                continue;
            }

            // Get the next player_id number
            const { data: existingPlayers, error: countError } = await supabase
                .from('players')
                .select('player_id')
                .order('created_at', { ascending: false })
                .limit(1);

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
            const { error } = await supabase.from('players').insert([{
                player_id: playerId,
                name: name,
                email: email,
                phone: phone || null,
                photo: photo || null,
                bodija_rating: 1600,
                peak_rating: 1600,
                games_played: 0,
                wins: 0,
                draws: 0,
                losses: 0,
                status: 'active',
                is_guest: false
            }]);

            if (error) {
                errors.push(`${name}: ${error.message}`);
            } else {
                // Update request status
                await supabase.from('player_requests').update({ status: 'approved' }).eq('id', id);
                approved.push(`${name} (${playerId})`);
            }
        } catch (e) {
            errors.push(`${name}: ${e.message}`);
        }
    }

    if (approved.length > 0) {
        showToast(`${approved.length} player(s) approved: ${approved.join(', ')}`, 'success');
    }
    if (errors.length > 0) {
        showToast(`Errors: ${errors.join(', ')}`, 'error');
    }

    // Refresh the list
    await loadPlayerRequests();

    // Refresh players list
    if (typeof fetchPlayers === 'function') {
        const dbPlayers = await api.fetchPlayers();
        players = (dbPlayers || []).map(mapPlayerFromDB);
        renderPlayers();
        renderLeaderboard();
    }
};

// Bulk reject selected requests
window.bulkRejectRequests = async function () {
    const checkboxes = document.querySelectorAll('.request-checkbox:checked');
    if (checkboxes.length === 0) {
        showToast('Please select at least one request', 'warning');
        return;
    }

    const rejected = [];

    for (const cb of checkboxes) {
        const id = cb.dataset.id;
        const name = cb.dataset.name;

        try {
            await supabase.from('player_requests').update({ status: 'rejected' }).eq('id', id);
            rejected.push(name);
        } catch (e) {
            console.error('Error rejecting request:', e);
        }
    }

    if (rejected.length > 0) {
        showToast(`${rejected.length} request(s) rejected`, 'info');
    }

    // Refresh the list
    await loadPlayerRequests();
};

window.approvePlayerRequest = async function (id, name, email, phone, photo) {
    try {
        // Check for existing player with same email
        const { data: existingPlayer } = await supabase
            .from('players')
            .select('id, name')
            .eq('email', email)
            .single();

        if (existingPlayer) {
            // Update request status to duplicate
            await supabase.from('player_requests').update({ status: 'duplicate' }).eq('id', id);
            showToast(`Player already exists: ${existingPlayer.name}`, 'error');
            return;
        }

        // Get the next player_id number
        const { data: existingPlayers, error: countError } = await supabase
            .from('players')
            .select('player_id')
            .order('created_at', { ascending: false })
            .limit(1);

        let nextNum = 1;
        if (existingPlayers && existingPlayers.length > 0) {
            const lastPlayerId = existingPlayers[0].player_id;
            const match = lastPlayerId.match(/BCC(\d+)/);
            if (match) {
                nextNum = parseInt(match[1], 10) + 1;
            }
        }
        const playerId = 'BCC' + String(nextNum).padStart(3, '0');

        // Add player to players table with default rating of 1600
        const { error } = await supabase.from('players').insert([{
            player_id: playerId,
            name: name,
            email: email,
            phone: phone || null,
            photo: photo || null,
            bodija_rating: 1600,
            peak_rating: 1600,
            games_played: 0,
            wins: 0,
            draws: 0,
            losses: 0,
            status: 'active',
            is_guest: false
        }]);

        if (error) {
            console.error('Error adding player:', error);
            showToast('Error adding player: ' + error.message, 'error');
            return;
        }

        // Update request status to approved
        await supabase.from('player_requests').update({ status: 'approved' }).eq('id', id);

        showToast(`${name} has been added as ${playerId} with rating 1600!`, 'success');

        // Refresh the list
        await loadPlayerRequests();

        // Refresh players list
        if (typeof fetchPlayers === 'function') {
            const dbPlayers = await api.fetchPlayers();
            players = (dbPlayers || []).map(mapPlayerFromDB);
            renderPlayers();
            renderLeaderboard();
        }
    } catch (e) {
        console.error('Error approving request:', e);
        alert('Error approving request');
    }
};

window.rejectPlayerRequest = async function (id) {
    try {
        await supabase.from('player_requests').update({ status: 'rejected' }).eq('id', id);
        showToast('Request rejected', 'info');
        await loadPlayerRequests();
    } catch (e) {
        console.error('Error rejecting request:', e);
        showToast('Error rejecting request', 'error');
    }
};

// Load pending request count for notification badge (only called manually, not on timer)
let _fetchingPendingCount = false;
async function loadPendingRequestCount() {
    // Fetch lock to prevent duplicate calls
    if (_fetchingPendingCount) {
        console.log('[BCC] loadPendingRequestCount: already fetching, skipping');
        return;
    }
    _fetchingPendingCount = true;

    try {
        const { data, error } = await supabase
            .from('player_requests')
            .select('id', { count: 'exact' })
            .eq('status', 'pending');

        if (!error && data) {
            updateNotificationBadge(data.length);
        }
    } catch (e) {
        // Ignore errors
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
let loadingModalCount = 0;

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
    loadingModalCount++;
    modal.style.display = 'flex';
    // Prevent any clicks from passing through
    modal.onclick = e => e.stopPropagation();
}

function hideLoadingModal() {
    loadingModalCount--;
    if (loadingModalCount <= 0) {
        loadingModalCount = 0;
        const modal = document.getElementById('loadingModal');
        if (modal) modal.style.display = 'none';
    }
}

// Silent refresh — refetches data and re-renders current page without any flash
async function silentRefresh() {
    try {
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        const headers = { 'apikey': anonKey, 'Authorization': 'Bearer ' + anonKey };
        const base = getSupabaseUrl() + '/rest/v1/';

        const [playersResp, gamesResp, tournamentsResp] = await Promise.all([
            fetch(base + 'players?select=id,name,bodija_rating,peak_rating,wins,draws,losses,games_played,status,is_guest,photo&is_guest=eq.false&limit=100', { headers }),
            fetch(base + 'games?select=id,date,white_player_name,black_player_name,result,white_rating_change,black_rating_change,white_rating_before,black_rating_before,tournament_name,round_number,created_at&order=created_at.desc&limit=10', { headers }),
            fetch(base + 'tournaments?select=id,name,format,time_control,total_rounds,current_round,status,date', { headers })
        ]);

        const [playersJson, gamesJson, tournamentsJson] = await Promise.all([
            playersResp.json(),
            gamesResp.json(),
            tournamentsResp.json()
        ]);

        players = (playersJson || []).map(mapPlayerFromDB).filter(p => p !== null);
        games = (gamesJson || []).map(mapGameFromDB).filter(g => g !== null);

        extendedTournaments.length = 0;
        (tournamentsJson || []).forEach(t => {
            const mapped = mapTournamentFromDB(t);
            if (mapped) extendedTournaments.push(mapped);
        });

        // Re-render all sections silently
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
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        const headers = { 'apikey': anonKey, 'Authorization': 'Bearer ' + anonKey };
        const base = getSupabaseUrl() + '/rest/v1/';
        const resp = await fetch(base + 'tournaments?select=id,name,format,time_control,total_rounds,current_round,status,date', { headers });
        const json = await resp.json();
        extendedTournaments.length = 0;
        (json || []).forEach(t => { const m = mapTournamentFromDB(t); if (m) extendedTournaments.push(m); });
    } catch(e) { /* silent */ }
}

// Show toast notification
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
    const gamesPlayed = dbPlayer.games_played ?? 0;
    const wins = dbPlayer.wins || dbPlayer.win_count || 0;
    const draws = dbPlayer.draws || dbPlayer.draw_count || 0;
    const losses = dbPlayer.losses || dbPlayer.loss_count || 0;

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
        rounds: dbTournament.total_rounds || dbTournament.rounds || 5,
        status: dbTournament.status || 'draft',
        current_round: dbTournament.current_round || 1,
        players: dbTournament.tournament_players || [],
        pairings: [],
        standings: [],
        results: []
    };
}

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', async () => {

    await checkAuthSession();
    initAuthListener();

    console.log('[BCC] App initializing...');

    // Check for local tournament FIRST - restore it but don't skip data fetch
    const localTournament = checkForLocalTournament();
    if (localTournament) {
        console.log('[BCC] Recovered local tournament:', localTournament.name);
        window._localTournament = localTournament;
        currentTournament = localTournament;
        currentTournament.status = 'Active';
        currentTournamentTab = 'pairings';
        currentViewingRound = localTournament.current_round || 1;
        console.log('[BCC] Tournament recovered - will show after data loads');
        // Do NOT return here — continue to fetch all data normally
    }

    // Check Supabase configuration
    console.log('[BCC] Supabase client:', supabase ? 'initialized' : 'NOT INITIALIZED (check credentials)');

    if (!supabase) {
        console.error('[BCC] FATAL: Supabase client is null. Please check:');
        console.error('[BCC] 1. Create .env file with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
        console.error('[BCC] 2. Restart dev server after adding .env');
        console.error('[BCC] 3. Check console for Supabase config error on load');
        document.body.innerHTML = '<div style="padding:50px;text-align:center;"><h1>⚠️¸ï¸ App Not Configured</h1><p>Supabase credentials missing. Check console for details.</p></div>';
        return;
    }

    console.log('[BCC] Fetching data from database...');

    // Fetch all data in parallel
    let playersResult, gamesResult, tournamentsResult;
    try {
        console.log('[BCC] Fetching all data in parallel...');

        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        const headers = { 'apikey': anonKey, 'Authorization': 'Bearer ' + anonKey };
        const base = getSupabaseUrl() + '/rest/v1/';

        const [playersResp, gamesResp, tournamentsResp] = await Promise.all([
            fetch(base + 'players?select=id,name,bodija_rating,peak_rating,wins,draws,losses,games_played,status,is_guest,photo&is_guest=eq.false&limit=100', { headers }),
            fetch(base + 'games?select=id,date,white_player_name,black_player_name,result,white_rating_change,black_rating_change,white_rating_before,black_rating_before,tournament_name,round_number,created_at&order=created_at.desc&limit=10', { headers }),
            fetch(base + 'tournaments?select=id,name,format,time_control,total_rounds,current_round,status,date', { headers })
        ]);

        const [playersJson, gamesJson, tournamentsJson] = await Promise.all([
            playersResp.json(),
            gamesResp.json(),
            tournamentsResp.json()
        ]);

        playersResult = { data: playersJson, error: playersResp.ok ? null : new Error(playersResp.statusText) };
        gamesResult = { data: gamesJson, error: gamesResp.ok ? null : new Error(gamesResp.statusText) };
        tournamentsResult = { data: tournamentsJson, error: tournamentsResp.ok ? null : new Error(tournamentsResp.statusText) };

        console.log('[BCC] Players:', playersResult.data?.length || 0);
        console.log('[BCC] Games:', gamesResult.data?.length || 0);
        console.log('[BCC] Tournaments:', tournamentsResult.data?.length || 0);
    } catch (e) {
        console.error('[BCC] Fetch error:', e);
        console.error('[BCC] Stack:', e.stack);
        document.body.innerHTML = '<div style="padding:50px;text-align:center;"><h1>⚠️ Error Loading Data</h1><p style="color:red;">' + e.message + '</p><p>Check console for details. Your Supabase project may be paused (free tier pauses after inactivity).</p><button onclick="location.reload()">Retry</button></div>';
        return;
    }

    // Log fetch results
    console.log('[BCC] Players fetch:', playersResult.error ? 'ERROR: ' + playersResult.error.message : 'success, count: ' + (playersResult.data?.length || 0));

    players = (playersResult.data || []).map(mapPlayerFromDB).filter(p => p !== null);
    games = (gamesResult.data || []).map(mapGameFromDB).filter(g => g !== null);
    console.log('[BCC] Data loaded - players:', players.length, 'games:', games.length);

    // Initialize extended tournaments
    const dbTournaments = tournamentsResult.data || [];
    if (dbTournaments) {
        dbTournaments.forEach(t => {
            const mapped = mapTournamentFromDB(t);
            if (mapped) extendedTournaments.push(mapped);
        });
    }

    // Set up navigation
    setupNavigation();

    // Render all sections
    try { renderDashboard(); } catch (e) { console.error('renderDashboard failed:', e) }
    try { renderLeaderboard(); } catch (e) { console.error('renderLeaderboard failed:', e) }
    try { renderPlayers(); } catch (e) { console.error('renderPlayers failed:', e) }
    try { renderGamesLog(); } catch (e) { console.error('renderGamesLog failed:', e) }
    try { populateH2HSelects(); } catch (e) { console.error('populateH2HSelects failed:', e) }
    try { renderTournaments(); } catch (e) { console.error('renderTournaments failed:', e) }

    /* // Subscribe to realtime changes using single combined subscription
        api.subscribeToAllTables({
            onPlayers: (payload) => {
                // console.log('Realtime player update:', payload);
                api.fetchPlayers().then(fresh => {
                    if (fresh && fresh.length) {
                        players = fresh.map(mapPlayerFromDB);
                        renderLeaderboard();
                        renderPlayers();
                        showToast('Leaderboard updated via Realtime', 'success');
                    }
                });
            },
            onPairings: (payload) => {
                // console.log('Realtime pairings update:', payload);
                showToast('Tournament pairings updated', 'success');
            },
            onTournaments: (payload) => {
                // Realtime update received
                api.fetchTournaments().then(fresh => {
                    if (fresh && fresh.length !== extendedTournaments.length) {
                        // Rebuild extendedTournaments from fresh data
                        extendedTournaments.length = 0;
                        fresh.forEach(t => {
                            const mapped = mapTournamentFromDB(t);
                            if (mapped) extendedTournaments.push(mapped);
                        });
                        renderTournaments();
                        showToast('Tournaments updated via Realtime', 'success');
                    }
                });
            }
        });
    }*/

    // Set up search/filter listeners
    setupSearchFilters();

    // Set today's date in the form
    document.getElementById('gameDate').valueAsDate = new Date();

    // Initialize tournaments on load (including restoring saved sections/views)
    await initializeTournaments();

    // If we recovered a local tournament, show recovery banner now that data is loaded
    if (window._localTournament && !window._localTournament.synced) {
        showRecoveryBanner(window._localTournament);
    }
});

// Always hide loading screen after a timeout (fallback)
setTimeout(() => {
    const loadingScreen = document.getElementById('loadingScreen');
    if (loadingScreen && loadingScreen.style.display !== 'none') {
        loadingScreen.style.opacity = '0';
        setTimeout(() => {
            loadingScreen.style.display = 'none';
        }, 300);
    }
}, 5000);

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

    // Re-render tournaments when navigating to tournaments section (using cached data)
    if (sectionId === 'tournaments') {
        renderTournaments();
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
    if (player.games === 0) return 0;
    return Math.round(((player.wins + player.draws * 0.5) / player.games) * 100);
}

function getPerformanceData(player) {
    if (player.games < 5) return { state: 'neutral', label: '-', class: 'perf-neutral' };

    // Form: Last 5 games
    const playerGames = games.filter(g => g.white === player.id || g.black === player.id)
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 5);

    let formPoints = 0;
    playerGames.forEach(g => {
        if (g.result === '1/2-1/2') formPoints += 0.5;
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
            icon: '🔥',
            class: 'perf-hot'
        };
    }

    if (formPoints >= 3 || ratingDiff >= 20) {
        return {
            state: 'up',
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>`,
            class: 'perf-up'
        };
    } else if (formPoints < 2 || ratingDiff <= -20) {
        return {
            state: 'down',
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`,
            class: 'perf-down'
        };
    } else {
        return {
            state: 'stable',
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>`,
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
function renderLeaderboard() {
    const tbody = document.getElementById('leaderboardBody');

    if (!players || players.length === 0) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 40px; color: var(--text-secondary);">No players found. Add players to the database to see them here.</td></tr>';
        return;
    }

    // Filter out guest players
    const nonGuestPlayers = players.filter(p => p && !p.isGuest);
    const sorted = [...nonGuestPlayers].sort((a, b) => (b?.rating ?? 0) - (a?.rating ?? 0));
    const searchTerm = document.getElementById('leaderboardSearch')?.value?.toLowerCase() || '';
    const filtered = sorted.filter(p => p && (searchTerm === '' || (p.name && p.name.toLowerCase().includes(searchTerm))));

    if (tbody) tbody.innerHTML = filtered.map((player, idx) => {
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
                            ${perf.state === 'neutral'
                ? `<span class="perf-neutral">${perf.label}</span>`
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
        if (grid) grid.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-secondary);">No players found. Add players to the database to see them here.</div>';
        return;
    }

    // Filter out guest players
    const nonGuestPlayers = players.filter(p => p && !p.isGuest);

    if (grid) grid.innerHTML = nonGuestPlayers.map(player => {
        if (!player) return '';
        const title = getTitle(player?.rating ?? 1600);
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
    const avatarContent = player.photo
        ? `<img src="${player.photo}" alt="${player.name}" class="player-detail-avatar-img">`
        : `<div class="player-detail-avatar">${getInitials(player.name)}</div>`;

    if (content) content.innerHTML = `
            <div class="player-detail-header" >
                    <div class="player-detail-avatar-container">${avatarContent}</div>
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

    if (!p1id || !p2id) {
        showToast('Please select both players to compare', 'error');
        return;
    }
    if (p1id === p2id) {
        showToast('Please select two different players', 'error');
        return;
    }

    h2hActiveFilter = 'all';
    renderH2HContent(p1id, p2id);
    document.getElementById('h2hModal').classList.add('active');
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
        { key: 'all', label: 'All', icon: 'All' },
        { key: 'rapid', label: 'Rapid', icon: '⚡' },
        { key: 'blitz', label: 'Blitz', icon: '⚡' },
        { key: 'bullet', label: 'Bullet', icon: '↓¨' }
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

    const whiteElo = calculateElo(whitePlayer.rating, blackPlayer.rating, whiteScore);
    const blackElo = calculateElo(blackPlayer.rating, whitePlayer.rating, blackScore);
    const whiteChange = whiteElo.change;
    const blackChange = blackElo.change;

    const whiteExpected = 1 / (1 + Math.pow(10, (blackPlayer.rating - whitePlayer.rating) / 400));
    const blackExpected = 1 / (1 + Math.pow(10, (whitePlayer.rating - blackPlayer.rating) / 400));

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
    const confirmMsg = `Confirm Game Result:\n\n${whitePlayer.name} (White) vs ${blackPlayer.name} (Black)\n\nResult: ${resultText}\n\nWhite Rating: ${whitePlayer.rating} → ${whitePlayer.rating + whiteChange} (${whiteChange >= 0 ? '+' : ''}${whiteChange})\nBlack Rating: ${blackPlayer.rating} → ${blackPlayer.rating + blackChange} (${blackChange >= 0 ? '+' : ''}${blackChange})\n\nThis cannot be undone. Continue?`;

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
    if (!grid) {
        console.warn('Tournaments grid element not found');
        return;
    }

    // Ensure extendedTournaments is properly populated
    if (!extendedTournaments || extendedTournaments.length === 0) {
        // Show empty state but still show the header and create button
        if (grid) grid.innerHTML = '';
    }

    // Get filter values (only format filter now)
    const formatFilter = document.getElementById('tournamentFormatFilter')?.value || '';

    // Filter tournaments based on format only
    let filteredTournaments = extendedTournaments;

    if (formatFilter) {
        filteredTournaments = filteredTournaments.filter(t =>
            t.format?.toLowerCase() === formatFilter.toLowerCase()
        );
    }

    // Clear the grid first effectively
    if (grid) grid.innerHTML = '';
    grid.className = 'page-content'; // Restore padding and remove tournaments-grid if present

    let html = '';

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
        // Show all tournaments in a single grid
        html += `<div class="tournaments-grid" > ${filteredTournaments.map(renderTournamentCard).join('')}</div > `;
    }

    if (grid) grid.innerHTML = `<div class="section-container" > ${html}</div > `;
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
                            <div class="tournament-actions admin-only" onclick="event.stopPropagation()">
                                ${tournament.status?.toLowerCase() === 'draft' ? `
                                <button class="btn-action-sm edit" onclick="editTournament('${tournament?.id ?? ''}')">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                    Edit
                                </button>
                                ` : ''}
                                <button id="tournament-btn-${tournament?.id ?? ''}" class="btn-action-sm delete" onclick="deleteTournament('${tournament?.id ?? ''}')">
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
    const isDouble = currentTournament.isDoubleRoundRobin;

    // Calculate expected rounds and games based on format
    const n = pendingStartTournamentPlayers.length;
    let expectedRounds = 0;
    let expectedGames = 0;

    if (format === 'roundrobin') {
        if (isDouble) {
            expectedRounds = n % 2 === 0 ? (n - 1) * 2 : n * 2;
            expectedGames = n * (n - 1); // Each player plays each other twice
        } else {
            expectedRounds = n % 2 === 0 ? n - 1 : n;
            expectedGames = n % 2 === 0 ? (n / 2) * (n - 1) : ((n - 1) / 2) * n; // Total games per round * rounds
        }
    } else if (format === 'knockout') {
        expectedRounds = Math.ceil(Math.log2(n));
        expectedGames = n - 1; // All but one player lose
    } else if (format === 'swiss') {
        expectedRounds = currentTournament.rounds || 5;
        expectedGames = expectedRounds * Math.floor(n / 2); // Approximate
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
        const localTournament = {
            id: null, // Will be set after Supabase insert
            name: currentTournament.name,
            format: currentTournament.format,
            time_control: currentTournament.timeControl,
            total_rounds: currentTournament.rounds || currentTournament.totalRounds || 0,
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
                globalGamesBefore: p.games_played || 0,
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
        await supabase.from('tournament_players').upsert(
            localTournament.players.map(p => ({
                tournament_id: saved.id,
                player_id: p.id,
                points: 0,
                wins: 0,
                draws: 0,
                losses: 0,
                byes: 0,
                rating_at_start: p.ratingAtStart,
                rating_change: 0,
                buchholz: 0
            })),
            { onConflict: 'tournament_id,player_id' }
        );

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
        console.log('Tournament started - only 1 Supabase call made:', window._localTournament);

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
    document.getElementById('tournamentRounds').value = tournament.rounds;
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
        showLoadingModal('Adding player...');
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

            // Refresh players list
            players = (await api.fetchPlayers()).map(mapPlayerFromDB).filter(p => p !== null);
            renderPlayers();
            renderLeaderboard();
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
        console.warn("Supabase startTournament failed, using local fallback", e);
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

    console.log('Generated round locally:', { round: currentRound, pairingCount: pairings.length, format });
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

    // Default to pairings tab for active tournaments, but respect forceTab
    if (forceTab) {
        currentTournamentTab = forceTab;
    } else if (currentTournament.status?.toLowerCase() === 'active') {
        currentTournamentTab = 'pairings';
    } else {
        currentTournamentTab = 'overview';
    }

    // Set initial viewing round, respecting forceRound
    if (forceRound !== null) {
        currentViewingRound = parseInt(forceRound);
    } else {
        currentViewingRound = currentTournament.current_round || 1;
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
                                <span>🔥… ${new Date(currentTournament.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                                <span>🎯 ${formatDisplayName(currentTournament.format)}</span>
                                <span>⏱ ${currentTournament.timeControl || currentTournament.time_control || '—'}</span>
                                <span>👥 ${currentTournament.players.length} Players</span>
                                <span class="tournament-status-badge ${statusClass}">${statusLabel}</span>
                            </div>
                        </div>
                        <div style="display: flex; gap: 10px;">
                            ${(currentTournament.status === 'active' || currentTournament.status === 'draft') && roundsPlayed === 0 ? `<button class="btn-primary" onclick="openPlayerSelection('${currentTournament?.id ?? ''}')">Select Players</button>` : ''}
                            ${currentTournament.status?.toLowerCase() === 'active' && roundsPlayed < (currentTournament.total_rounds || currentTournament.totalRounds || 99) ? `<button class="btn-primary" onclick="generateNextRound()">Next Round</button>` : ''}
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
                            <div class="tournament-summary-value" style="color: var(--accent-gold);">ðŸ† ${[...currentTournament.players].sort((a, b) => b.points - a.points)[0]?.name || 'N/A'}</div>
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
    const pairings = currentTournament.pairings || [];
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
                    ${resultsRemaining === 0 ? '✓ All results entered' : `🔥 ${resultsRemaining} results remaining`}
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

    if (isCurrentActiveRound) {
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
                        ` : (pairing.round === currentTournament.current_round && currentTournament.status?.toLowerCase() === 'active' ? `
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

        // ── STEP 1: Process results locally ──────────────────────────────────
        for (const pairing of currentRoundPairings) {
            const whiteP = local.players.find(p => p.id === pairing.white);
            const blackP = local.players.find(p => p.id === pairing.black);

            if (pairing.isBye) {
                if (whiteP) { whiteP.points = (whiteP.points || 0) + 1; whiteP.wins = (whiteP.wins || 0) + 1; whiteP.byes = (whiteP.byes || 0) + 1; }
                continue;
            }

            if (!pairing.result) continue;

            const rv = pairing.result === '1-0' ? 1 : pairing.result === '0-1' ? 0 : 0.5;
            const wRating = whiteP?.currentRating || pairing.whiteRatingBefore || 1600;
            const bRating = blackP?.currentRating || pairing.blackRatingBefore || 1600;

            const wElo = calculateElo(wRating, bRating, rv);
            const bElo = calculateElo(bRating, wRating, 1 - rv);

            pairing.whiteRatingBefore = wRating;
            pairing.blackRatingBefore = bRating;
            pairing.whiteRatingAfter = wRating + wElo.change;
            pairing.blackRatingAfter = bRating + bElo.change;
            pairing.whiteRatingChange = wElo.change;
            pairing.blackRatingChange = bElo.change;

            // Update local tournament player stats
            if (whiteP) {
                whiteP.currentRating = pairing.whiteRatingAfter;
                whiteP.points = (whiteP.points || 0) + rv;
                if (pairing.result === '1-0') whiteP.wins = (whiteP.wins || 0) + 1;
                else if (pairing.result === '0-1') whiteP.losses = (whiteP.losses || 0) + 1;
                else whiteP.draws = (whiteP.draws || 0) + 1;
            }
            if (blackP) {
                blackP.currentRating = pairing.blackRatingAfter;
                blackP.points = (blackP.points || 0) + (1 - rv);
                if (pairing.result === '0-1') blackP.wins = (blackP.wins || 0) + 1;
                else if (pairing.result === '1-0') blackP.losses = (blackP.losses || 0) + 1;
                else blackP.draws = (blackP.draws || 0) + 1;
            }
        }

        // ── STEP 2: Buchholz update ───────────────────────────────────────────
        for (const tp of local.players) {
            const opponentIds = (local.pairings || [])
                .filter(p => p.result && (p.white === tp.id || p.black === tp.id) && !p.isBye)
                .map(p => p.white === tp.id ? p.black : p.white);
            tp.buchholz = opponentIds.reduce((sum, oppId) => {
                const opp = local.players.find(p => p.id === oppId);
                return sum + (opp?.points || 0);
            }, 0);
        }

        // Mark round as completed locally
        if (local.rounds) {
            const rd = local.rounds.find(r => r.roundNumber === currentRound);
            if (rd) rd.status = 'Completed';
        }

        if (isLastRound) {
            // ── LAST ROUND: Full Supabase sync ────────────────────────────────
            local.status = 'Completed';
            local.synced = true;
            saveLocalTournament();
            await _syncTournamentToSupabase(local);
            localStorage.removeItem('bcc_active_tournament');
            window._localTournament = null;
            currentTournament = null;
            if (modal) modal.classList.remove('active');
            hideLoadingModal();
            showToast('Tournament complete! All results synced.', 'success');
            await silentRefresh();
            // Navigate back to tournaments list
            document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
            const tSection = document.getElementById('tournamentsSection');
            const tNav = document.querySelector('[data-section="tournaments"]');
            if (tSection) tSection.classList.add('active');
            if (tNav) tNav.classList.add('active');
        } else {
            // ── MID TOURNAMENT: local only, generate next round ───────────────
            local.current_round = currentRound + 1;
            // Keep both references in sync
            window._localTournament = local;
            currentTournament = local;
            saveLocalTournament();

            generateRoundLocally();

            // generateRoundLocally updates window._localTournament, keep currentTournament in sync
            currentTournament = window._localTournament;

            currentTournamentTab = 'pairings';
            currentViewingRound = currentRound + 1;
            if (modal) modal.classList.remove('active');
            renderTournamentDetail();
            showToast(`Round ${currentRound} confirmed. Round ${currentRound + 1} pairings ready.`, 'success');
        }

    } catch (err) {
        console.error('confirmRoundSubmit error:', err);
        showToast('Error processing round: ' + (err.message || err), 'error');
    } finally {
        hideLoadingModal();
        // Always re-enable button (DOM may have been re-rendered, so re-query)
        const freshBtn = document.getElementById('confirmRoundBtn');
        if (freshBtn) { freshBtn.disabled = false; freshBtn.textContent = originalText; }
    }
}

// ── Full tournament sync to Supabase (called only on Finish Tournament) ──────
async function _syncTournamentToSupabase(local) {
    const tid = local.id;
    if (!tid) throw new Error('No tournament ID');

    showLoadingModal('Step 1/7: Updating tournament status...');

    // 1. Mark tournament Completed
    const { error: te } = await supabase.from('tournaments')
        .update({ status: 'Completed', current_round: local.total_rounds || local.totalRounds })
        .eq('id', tid);
    if (te) throw new Error('Tournament update: ' + te.message);

    showLoadingModal('Step 2/7: Saving rounds...');

    // 2. Insert rounds
    const roundInserts = (local.rounds || []).map(r => ({
        tournament_id: tid,
        round_number: r.roundNumber,
        status: 'Completed'
    }));
    // Use upsert in case rounds were partially saved from a previous attempt
    const { data: savedRounds, error: re } = await supabase
        .from('rounds').upsert(roundInserts, { onConflict: 'tournament_id,round_number' }).select();
    if (re) throw new Error('Rounds insert: ' + re.message);

    // Map roundNumber → DB id
    const roundIdMap = {};
    (savedRounds || []).forEach(r => { roundIdMap[r.round_number] = r.id; });

    showLoadingModal('Step 3/7: Saving pairings...');

    // 3. Insert pairings
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
    // Check if pairings already exist for this tournament (retry scenario)
    const { data: existingPairings } = await supabase
        .from('pairings').select('id').eq('tournament_id', tid).limit(1);
    let savedPairings = [];
    if (!existingPairings || existingPairings.length === 0) {
        const { data: sp, error: pe } = await supabase.from('pairings').insert(pairingInserts).select();
        if (pe) throw new Error('Pairings insert: ' + pe.message);
        savedPairings = sp || [];
    } else {
        // Already inserted, just fetch them
        const { data: sp } = await supabase.from('pairings').select('id,round_id,white_player_id,black_player_id').eq('tournament_id', tid);
        savedPairings = sp || [];
        console.log('Pairings already exist, skipping insert');
    }

    showLoadingModal('Step 4/7: Saving game records...');

    // 4. Insert games (non-bye only)
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
        // Check if games already exist for this tournament
        const { data: existingGames } = await supabase
            .from('games').select('id').eq('tournament_id', tid).limit(1);
        if (!existingGames || existingGames.length === 0) {
            const { error: ge } = await supabase.from('games').insert(gameInserts);
            if (ge) throw new Error('Games insert: ' + ge.message);
        } else {
            console.log('Games already exist, skipping insert');
        }
    }

    showLoadingModal('Step 5/7: Saving standings...');

    // 5. Upsert tournament_players
    const tpUpserts = (local.players || []).map(p => ({
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
    }));
    const { error: tpe } = await supabase.from('tournament_players').upsert(tpUpserts, { onConflict: 'tournament_id,player_id' });
    if (tpe) throw new Error('Tournament players: ' + tpe.message);

    showLoadingModal('Step 6/7: Updating player ratings...');

    // 6. Update global player stats
    for (const p of local.players) {
        const newRating = p.currentRating || p.ratingAtStart || 1600;
        const globalWins = (p.globalWinsBefore || 0) + (p.wins || 0);
        const globalDraws = (p.globalDrawsBefore || 0) + (p.draws || 0);
        const globalLosses = (p.globalLossesBefore || 0) + (p.losses || 0);
        const globalGames = (p.globalGamesBefore || 0) + (p.wins || 0) + (p.draws || 0) + (p.losses || 0);

        const globalPlayer = players.find(x => x.id === p.id);
        const peakRating = Math.max(newRating, globalPlayer?.peakRating || 0, p.ratingAtStart || 1600);

        const { error: upe } = await supabase.from('players').update({
            bodija_rating: newRating,
            peak_rating: peakRating,
            wins: globalWins,
            draws: globalDraws,
            losses: globalLosses,
            games_played: globalGames
        }).eq('id', p.id);
        if (upe) console.warn('Player update failed for', p.name, upe.message);
    }

    showLoadingModal('Step 7/7: Saving head-to-head records...');

    // 7. Upsert head_to_head
    for (const p of (local.pairings || []).filter(x => !x.isBye && x.result)) {
        const [p1id, p2id] = [p.white, p.black].sort();
        // p1id is the sorted-first player. Check if they were white or black to determine win
        const p1IsWhite = p.white === p1id;
        const p1wins = p.result === (p1IsWhite ? '1-0' : '0-1') ? 1 : 0;
        const p2wins = p.result === (p1IsWhite ? '0-1' : '1-0') ? 1 : 0;
        const draws = p.result === '1/2-1/2' ? 1 : 0;
        const { data: existing } = await supabase.from('head_to_head')
            .select('*').eq('player1_id', p1id).eq('player2_id', p2id).maybeSingle();
        if (existing) {
            await supabase.from('head_to_head').update({
                player1_wins: (existing.player1_wins || 0) + p1wins,
                player2_wins: (existing.player2_wins || 0) + p2wins,
                draws: (existing.draws || 0) + draws,
                total_games: (existing.total_games || 0) + 1
            }).eq('player1_id', p1id).eq('player2_id', p2id);
        } else {
            await supabase.from('head_to_head').insert({
                player1_id: p1id, player2_id: p2id,
                player1_wins: p1wins, player2_wins: p2wins,
                draws, total_games: 1
            });
        }
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

function closeTournamentDetail() { currentTournament = null; currentTournamentTab = 'overview'; renderTournaments(); }

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






