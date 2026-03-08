import { supabase, isSupabaseConfigured, getSupabaseUrl } from './supabase.js'

// Helper for direct REST API calls
async function restCall(endpoint, options = {}) {
    const url = getSupabaseUrl() + endpoint;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const headers = {
        'apikey': anonKey,
        'Authorization': 'Bearer ' + anonKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
        ...options.headers
    };
    const resp = await fetch(url, { ...options, headers });
    if (!resp.ok) throw new Error(resp.statusText);

    // Check if response has content before parsing as JSON
    const text = await resp.text();
    if (!text) return [];
    return JSON.parse(text);
}

export async function fetchPlayers() {
    if (!isSupabaseConfigured || !supabase) {
        return []
    }
    try {
        // Always filter out guests from leaderboard
        const { data, error } = await supabase.from('players').select('id, player_id, name, bodija_rating, peak_rating, games_played, wins, draws, losses, status, is_guest, photo').eq('is_guest', false).order('bodija_rating', { ascending: false })
        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('Error fetching players:', error);
        return [];
    }
}

export async function fetchTournaments() {
    if (!isSupabaseConfigured || !supabase) {
        return []
    }
    try {
        const { data, error } = await supabase
            .from('tournaments')
            .select(`
                id, name, format, time_control, total_rounds, current_round, status, date,
                tournament_players(id)
            `)
            .order('date', { ascending: false })
        if (error) throw error
        return data || []
    } catch (error) {
        console.error(error)
        return []
    }
}

export async function fetchTournamentById(id) {
    try {
        const { data, error } = await supabase
            .from('tournaments')
            .select(`
                id, name, format, time_control, total_rounds, current_round, status, date,
                tournament_players(id, player_id, points, wins, draws, losses, buchholz, rating_at_start, rating_change)
            `)
            .eq('id', id)
            .single()
        if (error) throw error
        return data
    } catch (error) {
        console.error('Error fetching tournament by ID:', error)
        return null
    }
}

export async function fetchGames(limit = null) {
    if (!isSupabaseConfigured || !supabase) {
        console.warn('Supabase not configured')
        return []
    }
    try {
        let query = supabase.from('games').select('id, date, white_player_id, black_player_id, white_player_name, black_player_name, result, white_rating_change, black_rating_change, tournament_name, round_number, created_at').order('created_at', { ascending: false })
        if (limit) {
            query = query.limit(limit)
        }
        const { data, error } = await query
        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('Error fetching games:', error);
        return [];
    }
}

// Fetch only recent games for dashboard (limited to 10)
export async function fetchRecentGames() {
    return fetchGames(10);
}

export async function createPlayer(player) {
    try {
        // Map local format to database format - player_id and name are REQUIRED
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
            is_guest: player.isGuest || player.is_guest || false
        };

        // Check for existing player with same email
        if (dbPlayer.email) {
            const { data: existingPlayer } = await supabase
                .from('players')
                .select('id, name')
                .eq('email', dbPlayer.email)
                .single();

            if (existingPlayer) {
                throw new Error(`Player already exists: ${existingPlayer.name}`);
            }
        }

        const { data, error } = await supabase.from('players').insert([dbPlayer]).select()
        if (error) {
            console.error('Error creating player:', error);
            throw error;
        }
        return data[0]
    } catch (error) {
        console.error(error)
        return null
    }
}

export async function saveGameResult(gameData) {
    try {
        // Use direct REST API
        const data = await restCall('/rest/v1/games', {
            method: 'POST',
            body: JSON.stringify([gameData])
        });
        return data[0];
    } catch (error) {
        console.error('Error saving game:', error.message || error);
        return null
    }
}

export async function updatePlayerStats(player) {
    try {
        const data = await restCall('/rest/v1/players?id=eq.' + player.id, {
            method: 'PATCH',
            body: JSON.stringify({
                bodija_rating: player.rating,
                peak_rating: player.peakRating,
                games_played: player.games,
                wins: player.wins,
                draws: player.draws,
                losses: player.losses
            })
        });
        return data[0];
    } catch (error) {
        console.error(error)
        return null
    }
}

export async function createTournament(tournament) {
    try {
        // Map local format to database format - name, format, total_rounds, date are REQUIRED
        const dbTournament = {
            name: tournament.name,
            format: tournament.format,
            time_control: tournament.timeControl || tournament.time_control || '60+0',
            total_rounds: tournament.rounds || tournament.total_rounds || 5,
            current_round: tournament.currentRound || tournament.current_round || 0,
            status: tournament.status || 'Draft',
            date: tournament.date || new Date().toISOString().split('T')[0]
        };
        const { data, error } = await supabase.from('tournaments').insert([dbTournament]).select()
        if (error) {
            console.error('Error creating tournament:', error);
            throw error;
        }
        return data[0]
    } catch (error) {
        console.error(error)
        return null
    }
}

export async function updateTournamentStatus(id, status, currentRound = null) {
    try {
        const updateData = { status };
        if (currentRound !== null) {
            updateData.current_round = currentRound;
        }
        const { data, error } = await supabase.from('tournaments').update(updateData).eq('id', id).select()
        if (error) throw error
        return data[0]
    } catch (error) {
        console.error(error)
        return null
    }
}

export async function updateTournament(id, data) {
    try {
        const { data: updated, error } = await supabase.from('tournaments').update(data).eq('id', id).select()
        if (error) throw error
        return updated[0]
    } catch (error) {
        console.error('Error updating tournament:', error)
        throw error
    }
}

export async function addTournamentPlayers(tournamentId, playersData) {
    try {
        // Map local player structure to DB structure - rating_at_start is REQUIRED
        const rows = playersData.map(p => ({
            tournament_id: tournamentId,
            player_id: p.id,
            points: p.points || 0,
            wins: p.wins || 0,
            draws: p.draws || 0,
            losses: p.losses || 0,
            byes: p.byes || 0,
            rating_at_start: p.rating || 1600,
            rating_change: p.rating_change || 0,
            buchholz: p.buchholz || 0
        }))
        const { error } = await supabase.from('tournament_players').upsert(rows, { onConflict: 'tournament_id,player_id' })
        if (error) throw error
        return true
    } catch (error) {
        console.error(error)
        return false
    }
}

// Rating History functions
export async function addRatingHistory(entry) {
    try {
        const dbEntry = {
            player_id: entry.player_id,
            game_id: entry.game_id || null,
            tournament_id: entry.tournament_id || null,
            rating_before: entry.rating_before,
            rating_after: entry.rating_after,
            change: entry.change,
            result: entry.result,
            opponent_id: entry.opponent_id || null,
            opponent_name: entry.opponent_name || 'Unknown'
        };
        const { error } = await supabase.from('rating_history').insert([dbEntry])
        if (error) {
            console.error('Error adding rating history:', error);
            throw error;
        }
        return true;
    } catch (error) {
        console.error('addRatingHistory error:', error);
        return false;
    }
}

export async function fetchPlayerRatingHistory(playerId) {
    try {
        const { data, error } = await supabase.from('rating_history')
            .select('id, player_id, rating, recorded_at, tournament_id')
            .eq('player_id', playerId)
            .order('recorded_at', { ascending: false });
        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('Error fetching rating history:', error);
        return [];
    }
}

// Head to Head functions
export async function updateHeadToHead(player1Id, player2Id, result) {
    try {
        // Always store with the alphabetically lower UUID as player1_id
        const p1id = player1Id < player2Id ? player1Id : player2Id;
        const p2id = player1Id < player2Id ? player2Id : player1Id;

        // Check if record exists using maybeSingle to avoid errors
        const { data: existing } = await supabase.from('head_to_head')
            .select('id, player1_id, player2_id, player1_wins, player2_wins, draws')
            .eq('player1_id', p1id)
            .eq('player2_id', p2id)
            .maybeSingle();

        if (existing) {
            // Update existing record
            const updates = {};
            // Map result: '1-0' = player1 win, '0-1' = player2 win, '1/2-1/2' = draw
            if (result === '1-0') {
                // player1 is white, so player1 wins
                if (p1id === player1Id) updates.player1_wins = (existing.player1_wins || 0) + 1;
                else updates.player2_wins = (existing.player2_wins || 0) + 1;
            } else if (result === '0-1') {
                if (p1id === player1Id) updates.player2_wins = (existing.player2_wins || 0) + 1;
                else updates.player1_wins = (existing.player1_wins || 0) + 1;
            } else {
                updates.draws = (existing.draws || 0) + 1;
            }
            updates.total_games = ((existing.player1_wins || 0) + (existing.player2_wins || 0) + (existing.draws || 0)) + 1;

            const { error } = await supabase.from('head_to_head').update(updates).eq('id', existing.id);
            if (error) throw error;
        } else {
            // Create new record
            const newRecord = {
                player1_id: p1id,
                player2_id: p2id,
                player1_wins: (p1id === player1Id && result === '1-0') ? 1 : ((p1id !== player1Id && result === '0-1') ? 1 : 0),
                player2_wins: (p2id === player1Id && result === '1-0') ? 1 : ((p2id !== player1Id && result === '0-1') ? 1 : 0),
                draws: result === '1/2-1/2' ? 1 : 0,
                total_games: 1
            };
            const { error } = await supabase.from('head_to_head').insert([newRecord]);
            if (error) throw error;
        }
        return true;
    } catch (error) {
        console.error('updateHeadToHead error:', error);
        return false;
    }
}

export async function addRoundPairings(tournamentId, pairingsData) {
    try {
        // Use 'pairings' table - many fields are NOT NULL
        const rows = pairingsData.map(p => ({
            tournament_id: tournamentId,
            round_id: p.roundId || p.round_id || null,
            white_player_id: p.white || p.whiteId || null,
            black_player_id: p.black || p.blackId || null,
            result: p.result || null,
            white_rating_before: p.whiteRatingBefore || p.white_rating_before || 1600,
            black_rating_before: p.blackRatingBefore || p.black_rating_before || 1600,
            white_rating_after: p.whiteRatingAfter || p.white_rating_after || p.whiteRatingBefore || 1600,
            black_rating_after: p.blackRatingAfter || p.black_rating_after || p.blackRatingBefore || 1600,
            white_rating_change: p.whiteChange || p.white_rating_change || 0,
            black_rating_change: p.blackChange || p.black_rating_change || 0,
            is_bye: p.isBye || p.is_bye || false
        }));
        const { data, error } = await supabase.from('pairings').insert(rows).select()
        if (error) {
            console.error('Error adding pairings:', error);
            throw error;
        }
        return data;
    } catch (error) {
        console.error('addRoundPairings error:', error);
        return false;
    }
}

export function subscribeToPlayers(callback) {
    return supabase.channel('players-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, payload => {
            callback(payload)
        })
        .subscribe()
}

export function subscribeToPairings(callback) {
    return supabase.channel('pairings-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pairings' }, payload => {
            callback(payload)
        })
        .subscribe()
}

export function subscribeToTournaments(callback) {
    return supabase.channel('tournaments-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments' }, payload => {
            callback(payload)
        })
        .subscribe()
}

// Combined single subscription for all tables - more efficient than multiple subscriptions
export function subscribeToAllTables(callbacks) {
    return supabase.channel('all-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, payload => {
            callbacks.onPlayers?.(payload)
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments' }, payload => {
            callbacks.onTournaments?.(payload)
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pairings' }, payload => {
            callbacks.onPairings?.(payload)
        })
        .subscribe()
}

export async function updatePairingResult(id, data) {
    try {
        const { error } = await supabase.from('pairings').update(data).eq('id', id);
        if (error) throw error;
        return true;
    } catch (error) {
        console.error('Error updating pairing:', error);
        return false;
    }
}

export async function fetchTournamentPairings(tournamentId) {
    try {
        const { data, error } = await supabase
            .from('pairings')
            .select(`
                id, tournament_id, round_id, white_player_id, black_player_id, result, white_rating_before, black_rating_before, is_bye, created_at,
                rounds!pairings_round_id_fkey(round_number),
                white_player:players!pairings_white_player_id_fkey(name, bodija_rating),
                black_player:players!pairings_black_player_id_fkey(name, bodija_rating)
            `)
            .eq('tournament_id', tournamentId)
            .order('round_id', { ascending: true })
            .order('created_at', { ascending: true });

        if (error) throw error;

        // Map database format back to local format used by the app
        return (data || []).map(p => ({
            id: p.id,
            roundId: p.round_id,
            white: p.white_player_id,
            black: p.black_player_id,
            whiteName: p.white_player?.name || 'Unknown',
            blackName: p.black_player?.name || (p.is_bye ? 'BYE' : 'Unknown'),
            result: p.result,
            whiteRatingBefore: p.white_rating_before,
            blackRatingBefore: p.black_rating_before,
            isBye: p.is_bye,
            round: p.rounds?.round_number || 1
        }));
    } catch (error) {
        console.error('Error fetching pairings:', error);
        return [];
    }
}

export async function deleteTournament(id) {
    try {
        // Delete related records first if needed, but Supabase CASCADE should handle it
        const { error } = await supabase.from('tournaments').delete().eq('id', id);
        if (error) throw error;
        return true;
    } catch (error) {
        console.error('Error deleting tournament:', error);
        throw error;
    }
}

export async function terminateTournament(tournamentId) {
    try {
        // 1. Fetch all games for this tournament to identify players and rating changes
        const { data: tournamentGames, error: gamesError } = await supabase
            .from('games')
            .select('id, white_player_id, black_player_id, result, white_rating_change, black_rating_change')
            .eq('tournament_id', tournamentId);

        if (gamesError) throw gamesError;

        if (tournamentGames && tournamentGames.length > 0) {
            // 2. Group rating changes by player
            const playerAdjustments = {};
            tournamentGames.forEach(game => {
                // White player
                if (!playerAdjustments[game.white_player_id]) playerAdjustments[game.white_player_id] = { rating: 0, games: 0, wins: 0, draws: 0, losses: 0 };
                playerAdjustments[game.white_player_id].rating -= (game.white_rating_change || 0);
                playerAdjustments[game.white_player_id].games += 1;
                if (game.result === '1-0') playerAdjustments[game.white_player_id].wins += 1;
                else if (game.result === '0-1') playerAdjustments[game.white_player_id].losses += 1;
                else playerAdjustments[game.white_player_id].draws += 1;

                // Black player
                if (!playerAdjustments[game.black_player_id]) playerAdjustments[game.black_player_id] = { rating: 0, games: 0, wins: 0, draws: 0, losses: 0 };
                playerAdjustments[game.black_player_id].rating -= (game.black_rating_change || 0);
                playerAdjustments[game.black_player_id].games += 1;
                if (game.result === '0-1') playerAdjustments[game.black_player_id].wins += 1;
                else if (game.result === '1-0') playerAdjustments[game.black_player_id].losses += 1;
                else playerAdjustments[game.black_player_id].draws += 1;
            });

            // 3. Update each player's stats in the database
            for (const playerId in playerAdjustments) {
                const adj = playerAdjustments[playerId];

                // Get current stats
                const { data: player, error: pError } = await supabase
                    .from('players')
                    .select('id, bodija_rating, games_played, wins, draws, losses')
                    .eq('id', playerId)
                    .single();

                if (pError) continue;

                await supabase.from('players').update({
                    bodija_rating: (player.bodija_rating || 1600) + adj.rating,
                    games_played: Math.max(0, (player.games_played || 0) - adj.games),
                    wins: Math.max(0, (player.wins || 0) - adj.wins),
                    draws: Math.max(0, (player.draws || 0) - adj.draws),
                    losses: Math.max(0, (player.losses || 0) - adj.losses)
                }).eq('id', playerId);
            }
        }

        // 4. Delete all related records manually to avoid foreign key conflicts
        // Order: games -> ratings -> pairings -> rounds -> tournament_players -> tournament

        // A. Delete Games
        await supabase.from('games').delete().eq('tournament_id', tournamentId);

        // B. Delete Pairings
        await supabase.from('pairings').delete().eq('tournament_id', tournamentId);

        // C. Delete Rounds
        await supabase.from('rounds').delete().eq('tournament_id', tournamentId);

        // D. Delete Tournament Players
        await supabase.from('tournament_players').delete().eq('tournament_id', tournamentId);

        // E. Delete the tournament
        const { error: deleteError } = await supabase
            .from('tournaments')
            .delete()
            .eq('id', tournamentId);

        if (deleteError) throw deleteError;

        return true;
    } catch (error) {
        console.error('Error terminating tournament:', error);
        throw error;
    }
}

export async function fetchTournamentStandings(tournamentId) {
    try {
        const { data, error } = await supabase
            .from('tournament_players')
            .select(`
                id, tournament_id, player_id, points, wins, draws, losses, buchholz, rating_at_start, rating_change,
                players!inner(name)
            `)
            .eq('tournament_id', tournamentId)
            .order('points', { ascending: false })
            .order('buchholz', { ascending: false });

        if (error) throw error;

        // Flatten the joined data
        return data.map(tp => ({
            ...tp,
            id: tp.player_id, // Map player_id to id for compatibility
            name: tp.players?.name || tp.name || 'Unknown'
        }));
    } catch (error) {
        console.error('Error fetching tournament standings:', error);
        return [];
    }
}

export async function createRound(round) {
    try {
        const { data, error } = await supabase.from('rounds').insert([round]).select();
        if (error) throw error;
        return data[0];
    } catch (error) {
        console.error('Error creating round:', error);
        return null;
    }
}

export async function updateRoundStatus(id, status) {
    try {
        const { data, error } = await supabase.from('rounds').update({ status }).eq('id', id).select();
        if (error) throw error;
        return data[0];
    } catch (error) {
        console.error('Error updating round status:', error);
        return null;
    }
}
