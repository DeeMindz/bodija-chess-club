-- 1. Add new rating fields to players table
ALTER TABLE players ADD COLUMN IF NOT EXISTS rapid_rating INTEGER DEFAULT 1600;
ALTER TABLE players ADD COLUMN IF NOT EXISTS rapid_peak_rating INTEGER DEFAULT 1600;
ALTER TABLE players ADD COLUMN IF NOT EXISTS blitz_rating INTEGER DEFAULT 1600;
ALTER TABLE players ADD COLUMN IF NOT EXISTS blitz_peak_rating INTEGER DEFAULT 1600;
ALTER TABLE players ADD COLUMN IF NOT EXISTS classical_rating INTEGER DEFAULT 1600;
ALTER TABLE players ADD COLUMN IF NOT EXISTS classical_peak_rating INTEGER DEFAULT 1600;

-- 2. Migrate existing bodija_rating to rapid_rating (blitz/classical stay 1600)
UPDATE players SET 
  rapid_rating = COALESCE(bodija_rating, 1600),
  rapid_peak_rating = COALESCE(peak_rating, bodija_rating, 1600);

-- 3. Add category field to games table so we know which format a game belongs to
ALTER TABLE games ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'rapid';

-- 4. Set existing games to rapid (since they were played in 10+5 Rapid)
UPDATE games SET category = 'rapid' WHERE category IS NULL;

-- Note: We are keeping the old `bodija_rating` column temporarily just in case. 
-- It is perfectly safe and ensures we don't break any running connections abruptly.
