-- ==============================================================================
-- BCC Supabase Optimization Views
-- Please copy and paste this entire script into your Supabase SQL Editor and hit RUN.
-- ==============================================================================

-- 1. Tournament Participant Counts
-- Replaces the need to download every single row from tournament_players
CREATE OR REPLACE VIEW tournament_participant_counts AS
SELECT 
    tournament_id,
    COUNT(player_id) as participant_count
FROM tournament_players
GROUP BY tournament_id;

-- 2. Player Medals View
-- Replaces downloading the entire tournament history to the client.
-- This calculates 1st, 2nd, and 3rd place on the server side instantly.
CREATE OR REPLACE VIEW player_medals_view AS
WITH RankedPlayers AS (
    SELECT 
        tp.player_id,
        tp.points,
        tp.tournament_id,
        t.name AS tournament_name,
        t.date AS tournament_date,
        t.format AS tournament_format,
        ROW_NUMBER() OVER(PARTITION BY tp.tournament_id ORDER BY tp.points DESC) as position
    FROM tournament_players tp
    JOIN tournaments t ON tp.tournament_id = t.id
    WHERE t.status = 'Completed' AND tp.points IS NOT NULL
)
SELECT * 
FROM RankedPlayers 
WHERE position <= 3;

-- Make sure API users can read the generated views
GRANT SELECT ON tournament_participant_counts TO anon, authenticated;
GRANT SELECT ON player_medals_view TO anon, authenticated;

-- 3. Player Category WDL Stats
-- Prevents downloading thousands of games just to count W/D/L on the leaderboard
CREATE OR REPLACE VIEW player_category_stats_view AS
SELECT 
    player_id, 
    COALESCE(category, 'rapid') as category,
    SUM(CASE WHEN result = '1-0' AND is_white = true THEN 1
             WHEN result = '0-1' AND is_white = false THEN 1 ELSE 0 END) as wins,
    SUM(CASE WHEN result = '1/2-1/2' THEN 1 ELSE 0 END) as draws,
    SUM(CASE WHEN result = '0-1' AND is_white = true THEN 1
             WHEN result = '1-0' AND is_white = false THEN 1 ELSE 0 END) as losses,
    COUNT(*) as total
FROM (
    SELECT white_player_id as player_id, true as is_white, category, result FROM games
    UNION ALL
    SELECT black_player_id as player_id, false as is_white, category, result FROM games
) sub
GROUP BY player_id, COALESCE(category, 'rapid');

GRANT SELECT ON player_category_stats_view TO anon, authenticated;
