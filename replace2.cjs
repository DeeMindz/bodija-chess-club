const fs = require('fs');
let c = fs.readFileSync('lib/main.js', 'utf8');

// Find the section we want to replace
const search = `    try {
        console.log('[BCC] Fetching players...');
        console.log('[BCC] Supabase URL:', getSupabaseUrl());
        
        // Test direct fetch first
        const testUrl = getSupabaseUrl() + '/rest/v1/players?select=id&limit=1';
        console.log('[BCC] Testing direct fetch to:', testUrl);
        
        try {
            const testResp = await fetch(testUrl, {
                headers: { 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY }
            });
            console.log('[BCC] Direct fetch status:', testResp.status, testResp.statusText);
        } catch (e) {
            console.error('[BCC] Direct fetch failed:', e.message);
        }
        
        playersResult = await Promise.race([
            supabase.from('players').select('id, name, bodija_rating, peak_rating, wins, draws, losses, games_played, status, is_guest, photo'),
            new Promise((_, r) => setTimeout(() => r(new Error('Players timeout - try refreshing (Ctrl+Shift+R)')), 30000))
        ]);
        console.log('[BCC] Players: ' + (playersResult.data?.length || 0));
        
        console.log('[BCC] Fetching games...');
        gamesResult = await Promise.race([
            supabase.from('games').select('id, date, white_player_name, black_player_name, result, white_rating_change, black_rating_change, tournament_name, round_number, created_at').order('created_at', { ascending: false }).limit(10),
            new Promise((_, r) => setTimeout(() => r(new Error('Games timeout - try refreshing (Ctrl+Shift+R)')), 30000))
        ]);
        console.log('[BCC] Games: ' + (gamesResult.data?.length || 0));
        
        console.log('[BCC] Fetching tournaments...');
        tournamentsResult = await Promise.race([
            supabase.from('tournaments').select('id, name, format, time_control, total_rounds, current_round, status, date'),
            new Promise((_, r) => setTimeout(() => r(new Error('Tournaments timeout - try refreshing (Ctrl+Shift+R)')), 30000))
        ]);
        console.log('[BCC] Tournaments: ' + (tournamentsResult.data?.length || 0));
    }`;

const replace = `    try {
        console.log('[BCC] Fetching players...');
        
        // Use direct REST API instead of Supabase client
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        const headers = { 'apikey': anonKey, 'Authorization': 'Bearer ' + anonKey };
        
        // Fetch players
        const playersResp = await fetch(getSupabaseUrl() + '/rest/v1/players?select=id,name,bodija_rating,peak_rating,wins,draws,losses,games_played,status,is_guest,photo&limit=100', { headers });
        playersResult = { data: await playersResp.json(), error: playersResp.ok ? null : new Error(playersResp.statusText) };
        console.log('[BCC] Players: ' + (playersResult.data?.length || 0));

        // Fetch games
        console.log('[BCC] Fetching games...');
        const gamesResp = await fetch(getSupabaseUrl() + '/rest/v1/games?select=id,date,white_player_name,black_player_name,result,white_rating_change,black_rating_change,tournament_name,round_number,created_at&order=created_at.desc&limit=10', { headers });
        gamesResult = { data: await gamesResp.json(), error: gamesResp.ok ? null : new Error(gamesResp.statusText) };
        console.log('[BCC] Games: ' + (gamesResult.data?.length || 0));

        // Fetch tournaments
        console.log('[BCC] Fetching tournaments...');
        const tournamentsResp = await fetch(getSupabaseUrl() + '/rest/v1/tournaments?select=id,name,format,time_control,total_rounds,current_round,status,date', { headers });
        tournamentsResult = { data: await tournamentsResp.json(), error: tournamentsResp.ok ? null : new Error(tournamentsResp.statusText) };
        console.log('[BCC] Tournaments: ' + (tournamentsResult.data?.length || 0));
    }`;

if (c.includes(search)) {
    c = c.replace(search, replace);
    fs.writeFileSync('lib/main.js', c);
    console.log('SUCCESS - replaced');
} else {
    console.log('FAILED - search not found');
    const idx = c.indexOf('Fetching players');
    console.log('Slice:', JSON.stringify(c.slice(idx, idx + 100)));
}
