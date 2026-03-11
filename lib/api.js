import { supabase, isSupabaseConfigured, getSupabaseUrl } from './supabase.js';

// ─────────────────────────────────────────────────────────────────────────────
// HELPER
// ─────────────────────────────────────────────────────────────────────────────

function guard() {
    if (!isSupabaseConfigured || !supabase) throw new Error('Supabase not configured');
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYERS
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchPlayers() {
    guard();
    const { data, error } = await supabase
        .from('players')
        .select('id, player_id, name, bodija_rating, peak_rating, games_played, wins, draws, losses, status, is_guest, photo, email, phone')
        .eq('is_guest', false)
        .order('bodija_rating', { ascending: false });
    if (error) throw error;
    return data || [];
}

export async function fetchAllPlayersForRecalc() {
    guard();
    const { data, error } = await supabase
        .from('players')
        .select('id, name, bodija_rating, peak_rating');
    if (error) throw error;
    return data || [];
}

export async function fetchPlayerById(id) {
    guard();
    const { data, error } = await supabase
        .from('players')
        .select('id, player_id, name, bodija_rating, peak_rating, games_played, wins, draws, losses, status, is_guest, photo, email, phone')
        .eq('id', id)
        .single();
    if (error) throw error;
    return data;
}

export async function createPlayer(player) {
    guard();
    const dbPlayer = {
        player_id: player.playerId || player.player_id || 'BCC' + Date.now(),
        name: player.name,
        bodija_rating: player.rating || player.bodija_rating || 1600,
        peak_rating: player.peakRating || player.peak_rating || player.rating || 1600,
        games_played: player.games || player.games_played || 0,
        wins: player.wins || 0,
        draws: player.draws || 0,
        losses: player.losses || 0,
        status: player.status || 'Active',
        is_guest: player.isGuest || player.is_guest || false,
        email: player.email || null,
        phone: player.phone || null,
        photo: player.photo || null,
    };
    const { data, error } = await supabase.from('players').insert([dbPlayer]).select();
    if (error) throw error;
    return data[0];
}

export async function updatePlayerStats(id, stats) {
    guard();
    const { error } = await supabase.from('players').update({
        bodija_rating: stats.bodija_rating,
        peak_rating: stats.peak_rating,
        games_played: stats.games_played,
        wins: stats.wins,
        draws: stats.draws,
        losses: stats.losses,
    }).eq('id', id);
    if (error) throw error;
}

export async function findPlayerByEmail(email) {
    guard();
    const { data, error } = await supabase
        .from('players')
        .select('id, name')
        .eq('email', email)
        .maybeSingle();
    if (error) throw error;
    return data;
}

export async function getLastPlayerIdNumber() {
    guard();
    const { data, error } = await supabase
        .from('players')
        .select('player_id')
        .order('created_at', { ascending: false })
        .limit(1);
    if (error) throw error;
    return data || [];
}

// Fetch all player_ids so approve can find the real max standard BCCxxx number
export async function getAllPlayerIds() {
    guard();
    const { data, error } = await supabase
        .from('players')
        .select('player_id');
    if (error) throw error;
    return data || [];
}

// ─────────────────────────────────────────────────────────────────────────────
// GAMES
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchGames(limit = 2000) {
    guard();
    let query = supabase
        .from('games')
        .select('id, date, white_player_id, black_player_id, white_player_name, black_player_name, result, white_rating_change, black_rating_change, white_rating_before, black_rating_before, tournament_name, round_number, created_at')
        .order('created_at', { ascending: false });
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
}

export async function fetchGameResultsForPlayers(playerIds) {
    guard();
    // Fetch all game results for a set of player IDs (used by recalcStats and sync step 6)
    const { data, error } = await supabase
        .from('games')
        .select('white_player_id, black_player_id, result')
        .or(playerIds.map(id => `white_player_id.eq.${id},black_player_id.eq.${id}`).join(','));
    if (error) throw error;
    return data || [];
}

export async function fetchAllGameResults() {
    guard();
    const { data, error } = await supabase
        .from('games')
        .select('white_player_id, black_player_id, result');
    if (error) throw error;
    return data || [];
}

// Fetch all non-bye pairings with results — the true source of truth for lifetime stats.
// Covers all tournaments including those synced before the games table was populated.
export async function fetchAllPairingResults() {
    guard();
    const { data, error } = await supabase
        .from('pairings')
        .select('white_player_id, black_player_id, result, is_bye')
        .eq('is_bye', false)
        .not('result', 'is', null);
    if (error) throw error;
    return data || [];
}

export async function fetchPairingResultsForPlayers(playerIds) {
    guard();
    const { data, error } = await supabase
        .from('pairings')
        .select('white_player_id, black_player_id, result, is_bye')
        .eq('is_bye', false)
        .not('result', 'is', null)
        .or(playerIds.map(id => `white_player_id.eq.${id},black_player_id.eq.${id}`).join(','));
    if (error) throw error;
    return data || [];
}

export async function insertGames(gameRows) {
    guard();
    if (!gameRows || gameRows.length === 0) return [];
    const { data, error } = await supabase.from('games').insert(gameRows).select();
    if (error) throw error;
    return data || [];
}

export async function checkGamesExistForTournament(tournamentId) {
    guard();
    const { data, error } = await supabase
        .from('games')
        .select('id')
        .eq('tournament_id', tournamentId)
        .limit(1);
    if (error) throw error;
    return (data || []).length > 0;
}

export async function deleteGamesForTournament(tournamentId) {
    guard();
    const { error } = await supabase
        .from('games')
        .delete()
        .eq('tournament_id', tournamentId);
    if (error) throw error;
}

// ─────────────────────────────────────────────────────────────────────────────
// TOURNAMENTS
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchTournaments() {
    guard();
    const { data, error } = await supabase
        .from('tournaments')
        .select('id, name, format, time_control, total_rounds, current_round, status, date')
        .order('date', { ascending: false });
    if (error) throw error;
    return data || [];
}

export async function fetchTournamentPlayerCounts() {
    guard();
    const { data, error } = await supabase
        .from('tournament_players')
        .select('tournament_id, player_id');
    if (error) throw error;
    // Return a map of tournamentId → count
    const countMap = {};
    (data || []).forEach(row => {
        if (row.tournament_id) countMap[row.tournament_id] = (countMap[row.tournament_id] || 0) + 1;
    });
    return countMap;
}

export async function fetchTournamentById(id) {
    guard();
    const { data, error } = await supabase
        .from('tournaments')
        .select('id, name, format, time_control, total_rounds, current_round, status, date')
        .eq('id', id)
        .single();
    if (error) throw error;
    return data;
}

export async function createTournament(tournament) {
    guard();
    const dbTournament = {
        name: tournament.name,
        format: tournament.format,
        time_control: tournament.timeControl || tournament.time_control || '60+0',
        total_rounds: tournament.total_rounds || tournament.rounds || 5,
        current_round: tournament.current_round || tournament.currentRound || 0,
        status: tournament.status || 'Draft',
        date: tournament.date || new Date().toISOString().split('T')[0],
    };
    const { data, error } = await supabase.from('tournaments').insert([dbTournament]).select().single();
    if (error) throw error;
    return data;
}

export async function updateTournament(id, fields) {
    guard();
    const { data, error } = await supabase.from('tournaments').update(fields).eq('id', id).select().single();
    if (error) throw error;
    return data;
}

export async function deleteTournament(id) {
    guard();
    const { error } = await supabase.from('tournaments').delete().eq('id', id);
    if (error) throw error;
}

// ─────────────────────────────────────────────────────────────────────────────
// TOURNAMENT PLAYERS
// ─────────────────────────────────────────────────────────────────────────────

export async function upsertTournamentPlayers(rows) {
    guard();
    const { error } = await supabase
        .from('tournament_players')
        .upsert(rows, { onConflict: 'tournament_id,player_id' });
    if (error) throw error;
}

export async function fetchTournamentStandings(tournamentId) {
    guard();
    const { data, error } = await supabase
        .from('tournament_players')
        .select('player_id, points, wins, draws, losses, byes, rating_at_start, rating_change, buchholz, players(name)')
        .eq('tournament_id', tournamentId)
        .order('points', { ascending: false });
    if (error) throw error;
    return (data || []).map(tp => ({
        id: tp.player_id,
        name: tp.players?.name || tp.player_id,
        points: tp.points || 0,
        wins: tp.wins || 0,
        draws: tp.draws || 0,
        losses: tp.losses || 0,
        byes: tp.byes || 0,
        ratingAtStart: tp.rating_at_start || 1600,
        currentRating: (tp.rating_at_start || 1600) + (tp.rating_change || 0),
        rating_change: tp.rating_change || 0,
        buchholz: tp.buchholz || 0,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUNDS
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchRoundsForTournament(tournamentId) {
    guard();
    const { data, error } = await supabase
        .from('rounds')
        .select('id, round_number')
        .eq('tournament_id', tournamentId);
    if (error) throw error;
    return data || [];
}

export async function insertRounds(roundRows) {
    guard();
    const { data, error } = await supabase.from('rounds').insert(roundRows).select();
    if (error) throw error;
    return data || [];
}

// ─────────────────────────────────────────────────────────────────────────────
// PAIRINGS
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchTournamentPairings(tournamentId) {
    guard();
    const { data, error } = await supabase
        .from('pairings')
        .select('id, round_id, white_player_id, black_player_id, result, white_rating_before, black_rating_before, white_rating_after, black_rating_after, white_rating_change, black_rating_change, is_bye, rounds(round_number)')
        .eq('tournament_id', tournamentId)
        .order('round_id', { ascending: true });
    if (error) throw error;
    return (data || []).map(p => ({
        id: p.id,
        round: p.rounds?.round_number || 1,
        white: p.white_player_id,
        black: p.black_player_id,
        whiteName: null, // resolved by caller using players array
        blackName: p.is_bye ? 'BYE' : null,
        result: p.result,
        isBye: p.is_bye || false,
        whiteRatingBefore: p.white_rating_before,
        blackRatingBefore: p.black_rating_before,
        whiteRatingAfter: p.white_rating_after,
        blackRatingAfter: p.black_rating_after,
        whiteRatingChange: p.white_rating_change,
        blackRatingChange: p.black_rating_change,
    }));
}

export async function checkPairingsExistForTournament(tournamentId) {
    guard();
    const { data, error } = await supabase
        .from('pairings')
        .select('id')
        .eq('tournament_id', tournamentId)
        .limit(1);
    if (error) throw error;
    return (data || []).length > 0;
}

// Delete all pairings for a tournament — used before final re-insert with authoritative results
export async function deleteAllPairingsForTournament(tournamentId) {
    guard();
    const { error } = await supabase
        .from('pairings')
        .delete()
        .eq('tournament_id', tournamentId);
    if (error) throw error;
}

export async function insertPairings(pairingRows) {
    guard();
    const { data, error } = await supabase.from('pairings').insert(pairingRows).select();
    if (error) throw error;
    return data || [];
}

// Sync a single round to Supabase so all viewers can see live pairings & standings.
// Called on tournament start (round 1) and after each round is confirmed.
// Idempotent — safe to call multiple times for the same round.
export async function syncRoundToDb(tournamentId, roundNumber, pairingRows, standingsRows) {
    guard();
    console.log(`[syncRoundToDb] Starting sync — tournament: ${tournamentId}, round: ${roundNumber}, pairings: ${pairingRows?.length}`);

    // ── Step 1: Get or create the round row ──────────────────────────────────
    let roundId = null;
    const { data: existingRounds, error: fetchRoundErr } = await supabase
        .from('rounds')
        .select('id')
        .eq('tournament_id', tournamentId)
        .eq('round_number', roundNumber)
        .limit(1);

    if (fetchRoundErr) {
        console.error('[syncRoundToDb] Failed to fetch existing round:', fetchRoundErr);
        throw fetchRoundErr;
    }

    if (existingRounds && existingRounds.length > 0) {
        roundId = existingRounds[0].id;
        console.log(`[syncRoundToDb] Round row already exists, id: ${roundId}`);
    } else {
        const { data: newRound, error: roundErr } = await supabase
            .from('rounds')
            .insert({ tournament_id: tournamentId, round_number: roundNumber, status: 'Completed' })
            .select()
            .single();
        if (roundErr) {
            console.error('[syncRoundToDb] Failed to insert round row:', roundErr);
            throw roundErr;
        }
        roundId = newRound.id;
        console.log(`[syncRoundToDb] Round row inserted, id: ${roundId}`);
    }

    // ── Step 2: Delete existing pairings for this round then insert fresh ────
    if (pairingRows && pairingRows.length > 0) {
        const { error: delErr } = await supabase
            .from('pairings')
            .delete()
            .eq('tournament_id', tournamentId)
            .eq('round_id', roundId);
        if (delErr) console.warn('[syncRoundToDb] Delete pairings warning (may be empty):', delErr);

        const rows = pairingRows.map(p => ({ ...p, round_id: roundId }));
        console.log('[syncRoundToDb] Inserting pairings:', rows);
        const { error: pairErr } = await supabase.from('pairings').insert(rows);
        if (pairErr) {
            console.error('[syncRoundToDb] Failed to insert pairings:', pairErr);
            throw pairErr;
        }
        console.log(`[syncRoundToDb] Inserted ${rows.length} pairings`);
    }

    // ── Step 3: Upsert standings so viewers see live points ──────────────────
    if (standingsRows && standingsRows.length > 0) {
        const { error: tpErr } = await supabase
            .from('tournament_players')
            .upsert(standingsRows, { onConflict: 'tournament_id,player_id' });
        if (tpErr) {
            console.error('[syncRoundToDb] Failed to upsert standings:', tpErr);
            throw tpErr;
        }
    }

    // ── Step 4: Update tournament current_round ───────────────────────────────
    const { error: updErr } = await supabase
        .from('tournaments')
        .update({ current_round: roundNumber })
        .eq('id', tournamentId);
    if (updErr) {
        console.error('[syncRoundToDb] Failed to update current_round:', updErr);
        throw updErr;
    }

    console.log(`[syncRoundToDb] Done — round ${roundNumber} synced successfully`);
}

// ─────────────────────────────────────────────────────────────────────────────
// RATING HISTORY
// ─────────────────────────────────────────────────────────────────────────────

export async function insertRatingHistory(rows) {
    guard();
    if (!rows || rows.length === 0) return;
    // Check idempotency: skip if entries for this tournament already exist
    const tournamentId = rows[0]?.tournament_id;
    if (tournamentId) {
        const { data: existing } = await supabase
            .from('rating_history')
            .select('id')
            .eq('tournament_id', tournamentId)
            .limit(1);
        if (existing && existing.length > 0) {
            console.log('[API] Rating history already exists for tournament, skipping');
            return;
        }
    }
    const { error } = await supabase.from('rating_history').insert(rows);
    if (error) throw error;
}

export async function fetchPlayerRatingHistory(playerId) {
    guard();
    const { data, error } = await supabase
        .from('rating_history')
        .select('id, rating_before, rating_after, change, result, opponent_name, tournament_id, recorded_at')
        .eq('player_id', playerId)
        .order('recorded_at', { ascending: true });
    if (error) throw error;
    return data || [];
}

// ─────────────────────────────────────────────────────────────────────────────
// HEAD TO HEAD
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchH2HForPlayers(playerIds) {
    guard();
    const { data, error } = await supabase
        .from('head_to_head')
        .select('*')
        .in('player1_id', playerIds)
        .in('player2_id', playerIds);
    if (error) throw error;
    return data || [];
}

export async function insertH2HRows(rows) {
    guard();
    if (!rows || rows.length === 0) return;
    const { error } = await supabase.from('head_to_head').insert(rows);
    if (error) throw error;
}

export async function updateH2HRow(player1Id, player2Id, fields) {
    guard();
    const { error } = await supabase
        .from('head_to_head')
        .update(fields)
        .eq('player1_id', player1Id)
        .eq('player2_id', player2Id);
    if (error) throw error;
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER REQUESTS
// ─────────────────────────────────────────────────────────────────────────────

export async function insertPlayerRequest(requestData) {
    guard();
    const { error } = await supabase.from('player_requests').insert([requestData]);
    if (error) throw error;
}

export async function fetchPendingPlayerRequests() {
    guard();
    const { data, error } = await supabase
        .from('player_requests')
        .select('id, name, email, phone, photo, status, created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

export async function updatePlayerRequestStatus(id, status) {
    guard();
    const { error } = await supabase
        .from('player_requests')
        .update({ status })
        .eq('id', id);
    if (error) throw error;
}

export async function deleteRejectedPlayerRequests() {
    guard();
    const { error } = await supabase
        .from('player_requests')
        .delete()
        .eq('status', 'rejected');
    if (error) throw error;
}

// ─────────────────────────────────────────────────────────────────────────────
// TERMINATE TOURNAMENT (admin — reverses all effects)
// ─────────────────────────────────────────────────────────────────────────────

export async function terminateTournament(tournamentId) {
    guard();
    // 1. Fetch all games to reverse rating changes
    const { data: tournamentGames, error: gamesError } = await supabase
        .from('games')
        .select('id, white_player_id, black_player_id, result, white_rating_change, black_rating_change')
        .eq('tournament_id', tournamentId);
    if (gamesError) throw gamesError;

    if (tournamentGames && tournamentGames.length > 0) {
        const playerAdj = {};
        tournamentGames.forEach(g => {
            [
                { id: g.white_player_id, ratingDelta: -(g.white_rating_change || 0), result: g.result === '1-0' ? 'win' : g.result === '0-1' ? 'loss' : 'draw', isWhite: true },
                { id: g.black_player_id, ratingDelta: -(g.black_rating_change || 0), result: g.result === '0-1' ? 'win' : g.result === '1-0' ? 'loss' : 'draw', isWhite: false },
            ].forEach(({ id, ratingDelta, result }) => {
                if (!playerAdj[id]) playerAdj[id] = { rating: 0, games: 0, wins: 0, draws: 0, losses: 0 };
                playerAdj[id].rating += ratingDelta;
                playerAdj[id].games += 1;
                playerAdj[id][result === 'win' ? 'wins' : result === 'loss' ? 'losses' : 'draws'] += 1;
            });
        });

        for (const [playerId, adj] of Object.entries(playerAdj)) {
            const { data: player } = await supabase
                .from('players')
                .select('bodija_rating, games_played, wins, draws, losses')
                .eq('id', playerId)
                .single();
            if (!player) continue;
            await supabase.from('players').update({
                bodija_rating: (player.bodija_rating || 1600) + adj.rating,
                games_played: Math.max(0, (player.games_played || 0) - adj.games),
                wins: Math.max(0, (player.wins || 0) - adj.wins),
                draws: Math.max(0, (player.draws || 0) - adj.draws),
                losses: Math.max(0, (player.losses || 0) - adj.losses),
            }).eq('id', playerId);
        }
    }

    // 2. Delete related records in correct order
    await supabase.from('rating_history').delete().eq('tournament_id', tournamentId);
    await supabase.from('games').delete().eq('tournament_id', tournamentId);
    await supabase.from('pairings').delete().eq('tournament_id', tournamentId);
    await supabase.from('rounds').delete().eq('tournament_id', tournamentId);
    await supabase.from('tournament_players').delete().eq('tournament_id', tournamentId);
    const { error: deleteError } = await supabase.from('tournaments').delete().eq('id', tournamentId);
    if (deleteError) throw deleteError;
}

// ─────────────────────────────────────────────────────────────────────────────
// REALTIME SUBSCRIPTIONS
// ─────────────────────────────────────────────────────────────────────────────

export function subscribeToAllTables(callbacks) {
    return supabase.channel('all-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, payload => {
            callbacks.onPlayers?.(payload);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments' }, payload => {
            callbacks.onTournaments?.(payload);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pairings' }, payload => {
            callbacks.onPairings?.(payload);
        })
        .subscribe();
}


// ─────────────────────────────────────────────────────────────────────────────
// PHOTO STORAGE  (Supabase Storage bucket: "player-photos")
// ─────────────────────────────────────────────────────────────────────────────

// Upload a photo Blob/File to Storage and save the public URL in the DB.
// Returns the public URL.
export async function uploadPlayerPhoto(playerId, blob) {
    guard();
    const ext  = blob.type === 'image/png' ? 'png' : 'jpg';
    const path = `${playerId}/${Date.now()}.${ext}`;

    // Upload (upsert so re-uploads overwrite)
    const { error: upErr } = await supabase.storage
        .from('player-photos')
        .upload(path, blob, { upsert: true, contentType: blob.type });
    if (upErr) throw upErr;

    // Get permanent public URL
    const { data } = supabase.storage
        .from('player-photos')
        .getPublicUrl(path);
    const publicUrl = data.publicUrl;

    // Save URL (not base64) in the players table
    const { error: dbErr } = await supabase
        .from('players')
        .update({ photo: publicUrl })
        .eq('id', playerId);
    if (dbErr) throw dbErr;

    return publicUrl;
}

// Update photo column with an arbitrary URL (used by migration helper)
export async function updatePlayerPhotoUrl(id, url) {
    guard();
    const { error } = await supabase
        .from('players')
        .update({ photo: url })
        .eq('id', id);
    if (error) throw error;
}

// Legacy alias kept so nothing else breaks if referenced elsewhere
export async function updatePlayerPhoto(id, photoBase64) {
    // If it looks like a URL already, just update the column
    if (photoBase64 && (photoBase64.startsWith('http') || photoBase64.startsWith('/'))) {
        return updatePlayerPhotoUrl(id, photoBase64);
    }
    // Otherwise fall back to storing the raw value (deprecated path)
    guard();
    const { error } = await supabase
        .from('players')
        .update({ photo: photoBase64 })
        .eq('id', id);
    if (error) throw error;
}

// Migrate ALL existing base64 photos in the players table to Storage.
// Call once from the browser console: await api.migratePhotosToStorage()
export async function migratePhotosToStorage() {
    guard();
    const { data: allPlayers, error } = await supabase
        .from('players')
        .select('id, name, photo')
        .not('photo', 'is', null);
    if (error) throw error;

    const results = { migrated: [], skipped: [], failed: [] };

    for (const p of allPlayers) {
        if (!p.photo) { results.skipped.push(p.name + ' (no photo)'); continue; }
        // Already a URL — skip
        if (p.photo.startsWith('http') || p.photo.startsWith('/')) {
            results.skipped.push(p.name + ' (already URL)');
            continue;
        }
        try {
            // Convert base64 data-URL to Blob
            const res  = await fetch(p.photo);
            const blob = await res.blob();
            const url  = await uploadPlayerPhoto(p.id, blob);
            results.migrated.push(`${p.name} → ${url}`);
        } catch (e) {
            results.failed.push(`${p.name}: ${e.message}`);
        }
    }

    console.table(results);
    return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// MEDALS / ACHIEVEMENTS
// ─────────────────────────────────────────────────────────────────────────────

// Fetch medals for a single player (1st/2nd/3rd in completed tournaments)
export async function fetchPlayerMedals(playerId) {
    const allMedals = await fetchAllPlayersMedals();
    return allMedals[playerId] || [];
}

// Bulk fetch: returns a map of { playerId -> medals[] } for ALL players at once.
// Used to populate the cache on startup — single query instead of N+1.
export async function fetchAllPlayersMedals() {
    guard();
    // Fetch all tournament_players rows for completed tournaments, with tournament info
    const { data, error } = await supabase
        .from('tournament_players')
        .select('player_id, points, wins, rating_change, tournament_id, tournaments(id, name, date, format, status)')
        .not('tournaments', 'is', null);
    if (error) throw error;

    // Group rows by tournament_id to compute positions
    const byTournament = {};
    for (const row of (data || [])) {
        const t = row.tournaments;
        if (!t || t.status !== 'Completed') continue;
        if (!byTournament[t.id]) byTournament[t.id] = { tournament: t, rows: [] };
        byTournament[t.id].rows.push(row);
    }

    // Build medals map
    const medalsMap = {};
    for (const { tournament: t, rows } of Object.values(byTournament)) {
        // Sort by points desc to get standings
        const sorted = [...rows].sort((a, b) => (b.points || 0) - (a.points || 0));
        sorted.forEach((row, idx) => {
            const position = idx + 1;
            if (position > 3) return;
            if (!medalsMap[row.player_id]) medalsMap[row.player_id] = [];
            medalsMap[row.player_id].push({
                tournamentId: t.id,
                tournamentName: t.name,
                date: t.date,
                format: t.format,
                position,
                points: row.points || 0,
                wins: row.wins || 0,
                ratingChange: row.rating_change || 0,
            });
        });
    }

    // Sort each player's medals by date desc
    for (const id of Object.keys(medalsMap)) {
        medalsMap[id].sort((a, b) => new Date(b.date) - new Date(a.date));
    }
    return medalsMap;
}
