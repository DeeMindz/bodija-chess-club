# BCC - Bodija Chess Club Rating Management System

> Last updated: 2026-03-08

---

## Project Overview

BCC is a chess club rating management web application built with Vite and Supabase. It provides comprehensive player management, game tracking with Elo rating system, tournament management (with offline capability), and real-time leaderboards.

| Property | Value |
|----------|-------|
| **Project Name** | BCC (Bodija Chess Club) |
| **Framework** | Vite 7.3.1 |
| **Frontend** | Vanilla JavaScript + CSS |
| **Backend** | Supabase (PostgreSQL + Realtime) |
| **Build Command** | `npm run build` |
| **Output Directory** | `dist` |
| **Deployment** | Netlify |

---

## Project File Structure

```
BCC/
├── index.html          # Main HTML entry point
├── style.css           # All styles
├── lib/
│   ├── main.js        # Main application logic (UI, tournament flow, rendering)
│   ├── api.js         # Supabase API calls and database operations
│   └── supabase.js    # Supabase client configuration
├── images/             # Static images (logos)
├── package.json       # Node dependencies
├── vite.config.js     # Vite configuration
└── netlify.toml       # Netlify deployment config
```

---

## Key Files Explained

### 1. lib/main.js (~197KB)
Main application logic including:
- **UI Rendering**: Dashboard, Leaderboard, Players, Games, Tournaments
- **Tournament Flow**: Create, Start, Pairings, Results, Complete
- **Offline Support**: Local storage for tournament state
- **Event Handlers**: All button clicks, form submissions
- **Helper Functions**: ELO calculation, pairing generation

Key functions:
- `confirmStartTournament()` - Starts tournament with local + minimal Supabase sync
- `generatePairings()` - Creates pairings based on format (Swiss/RR/Knockout)
- `recordResult()` - Records game result
- `confirmRoundSubmit()` - Confirms round results and updates standings
- `saveLocalTournament()` - Saves tournament state to localStorage
- `checkForLocalTournament()` - Recovers unsaved tournament on page load

### 2. lib/api.js (~23KB)
All database operations:
- `fetchPlayers()` - Get all players
- `fetchGames()` - Get game history
- `fetchTournaments()` - Get tournaments
- `saveGameResult()` - Save new game
- `updatePlayerStats()` - Update player ratings
- `createTournament()` - Create new tournament
- `updatePairingResult()` - Update pairing with result
- `restCall()` - Generic REST API helper (used for Supabase)

### 3. lib/supabase.js (~1.7KB)
Supabase client setup:
- Creates Supabase client
- Provides `getSupabaseUrl()` helper
- Exports `isSupabaseConfigured` flag

---

## Features

### 1. Dashboard
- Podium Display: Top 3 players with avatars and ratings
- Statistics Cards: Total members, total games, active tournaments
- Recent Games: Last 5 games played with quick results
- Quick Actions: Navigation to all sections

### 2. Leaderboard
- Full player rankings sorted by rating
- Columns: Rank, Player, Form, Rating, W-D-L, Win%
- Mobile-Optimized: Hides Peak, Games, Status columns on small screens
- Performance Indicators: Visual form tracking
- Sorting: Click column headers to sort
- Search: Filter players by name

### 3. Players Management
- Player cards with full stats
- Player Detail Modal:
  - Current and Peak ratings
  - Win rate percentage
  - Games played (W-D-L breakdown)
  - Rating history chart
  - Head-to-head records vs other players
- Status Badges: Active (green), Inactive (grey), Dormant (purple)

### 4. Games Log
- Complete game history
- Columns: Date, White Player, Result, Black Player, Tournament
- Filtering: By tournament
- Result Display: 1-0 (White wins), 0-1 (Black wins), 1/2-1/2 (Draw)
- Rating Deltas: Shows rating changes for both players

### 5. Tournaments
- Create and manage tournaments
- Tournament Formats: Swiss, Round Robin, Knockout
- Time Controls: Classical, Rapid, Blitz, Bullet options
- Status: Draft, Active, Completed
- Player Registration: Select players to participate
- Pairing Generation: Automatic pairing based on format
- Offline Mode: Tournaments work without internet

---

## Tournament Flow (Current Implementation)

### 1. Create Tournament
1. Admin clicks Create Tournament
2. Fills in: Name, Format, Time Control, Rounds, Date
3. Tournament saved to Supabase as Draft status

### 2. Select Players
1. Admin clicks Select Players on draft tournament
2. Modal shows available players with ratings
3. Admin selects players to add
4. Players stored locally (not yet in DB)

### 3. Start Tournament (Key Change!)
When admin clicks Confirm and Start:
1. Local State Created:
   ```javascript
   window._localTournament = {
     id: null,
     name: tournament.name,
     format: tournament.format,
     time_control: tournament.time_control,
     total_rounds: tournament.total_rounds,
     current_round: 0,
     status: 'Active',
     synced: false,
     players: [{ id, name, ratingAtStart, currentRating, points, wins, draws, losses, ... }],
     rounds: []
   }
   ```
2. Saved to localStorage: Key = 'bcc_active_tournament'
3. Supabase Calls (ONLY 2):
   - Insert into tournaments table - gets ID
   - Upsert into tournament_players - reserves player slots
4. NO rounds inserted - all generated locally

### 4. During Tournament
- Pairings generated locally
- Results entered via dropdown - stored in currentTournament.pairings
- Ratings calculated locally using ELO
- State saved to localStorage after each change

### 5. Complete Tournament
- Final standings calculated locally
- All game results saved to Supabase games table
- Player stats updated in Supabase

---

## Offline Tournament Support

### How It Works

1. On Start: Tournament state saved to localStorage
2. During Play: All changes saved locally plus to Supabase
3. On Refresh: checkForLocalTournament() recovers state

### Key Functions

| Function | Purpose |
|----------|---------|
| saveLocalTournament() | Saves _localTournament to localStorage |
| checkForLocalTournament() | On page load, recovers unsaved tournament |
| recalculateFromRound() | Resets all ratings and replays from round 1 |

### Local Storage Key
```
bcc_active_tournament
```

### Crash Recovery
If browser crashes during active tournament:
1. On next load, app calls checkForLocalTournament()
2. If valid unsaved tournament found - restores it
3. Tournament continues from where it left off

---

## Supabase Database Schema

### Table: players
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| name | text | Player's full name |
| bodija_rating | integer | Current rating (default: 1600) |
| peak_rating | integer | Highest rating achieved |
| games_played | integer | Total games count |
| wins | integer | Total wins |
| draws | integer | Total draws |
| losses | integer | Total losses |
| status | text | active/inactive/dormant |
| rating_history | jsonb | Array of historical ratings |
| is_guest | boolean | Guest player flag |
| photo | text | Photo URL |
| created_at | timestamp | Creation timestamp |

### Table: games
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| date | date | Date game was played |
| white_player_id | uuid | FK to players (white pieces) |
| black_player_id | uuid | FK to players (black pieces) |
| white_player_name | text | Cached white player name |
| black_player_name | text | Cached black player name |
| result | text | 1-0, 0-1, or 1/2-1/2 |
| tournament_name | text | Tournament name (optional) |
| round_number | integer | Round in tournament |
| white_rating_before | integer | White's rating before game |
| black_rating_before | integer | Black's rating before game |
| white_rating_after | integer | White's rating after game |
| black_rating_after | integer | Black's rating after game |
| white_rating_change | integer | Rating change for white |
| black_rating_change | integer | Rating change for black |
| created_at | timestamp | Creation timestamp |

### Table: tournaments
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| name | text | Tournament name |
| date | date | Tournament date |
| format | text | swiss/roundrobin/knockout |
| time_control | text | Time control (e.g., Blitz 3+2) |
| total_rounds | integer | Number of rounds |
| current_round | integer | Current round number |
| status | text | draft/active/completed |
| created_at | timestamp | Creation timestamp |

### Table: tournament_players
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| tournament_id | uuid | FK to tournaments |
| player_id | uuid | FK to players |
| points | integer | Tournament points |
| wins | integer | Tournament wins |
| draws | integer | Tournament draws |
| losses | integer | Tournament losses |
| byes | integer | Tournament byes |
| rating_at_start | integer | Rating when tournament started |
| rating_change | integer | Total rating change |
| buchholz | integer | Buchholz score |

### Table: rounds
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| tournament_id | uuid | FK to tournaments |
| round_number | integer | Round number |
| status | text | pending/completed |

### Table: pairings
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| tournament_id | uuid | FK to tournaments |
| round_id | uuid | FK to rounds |
| white_player_id | uuid | FK to players |
| black_player_id | uuid | FK to players |
| result | text | 1-0, 0-1, 1/2-1/2 |
| white_rating_before | integer | White's rating before |
| black_rating_before | integer | Black's rating before |
| white_rating_after | integer | White's rating after |
| black_rating_after | integer | Black's rating after |

---

## Form Indicator Logic

The Form indicator shows player performance based on recent games and rating trends:

| Status | Condition | Icon | Color |
|--------|-----------|------|-------|
| NEW | Less than 5 games played | Blue badge | #2979FF |
| HOT | 4.5+ form points OR 50+ rating gain | Fire emoji | Orange pulse |
| UP | 3+ form points OR 20+ rating gain | Up arrow | #00C853 |
| DOWN | Less than 2 form points OR -20+ rating loss | Down arrow | #FF5252 |
| STABLE | Everything else | Horizontal line | #9E9E9E |

### Form Calculation:
- Last 5 games are analyzed
- Win = 1 point, Draw = 0.5 points, Loss = 0 points
- Rating Trend: Compares current rating to rating at last tournament

---

## Rating System (Elo)

### K-Factor:
- K = 40: Players with less than 15 games (rapidly changing ratings)
- K = 20: Players with 15+ games (stable players)

### Rating Calculation:
```
Expected Score = 1 / (1 + 10^((OpponentRating - MyRating) / 400))
Rating Change = K x (ActualScore - ExpectedScore)
```

---

## Environment Variables

Configure these in Netlify dashboard or .env file:

| Variable | Description |
|----------|-------------|
| VITE_SUPABASE_URL | Your Supabase project URL |
| VITE_SUPABASE_ANON_KEY | Your Supabase anon key |

---

## Technical Implementation

### Data Mapping
The app uses mapping functions to handle Supabase's snake_case database columns:

- mapPlayerFromDB() - Converts player data to camelCase
- mapGameFromDB() - Converts game data to camelCase
- mapTournamentFromDB() - Converts tournament data to camelCase

### Real-time Subscriptions
- Players table is watched for changes
- Updates reflect immediately across all connected clients

### Responsive Design
- Desktop: Full feature set with all columns visible
- Mobile: Optimized columns, touch-friendly interactions
- Breakpoints: 480px, 768px, 1024px, 1200px

### CSS Custom Properties
The app uses CSS variables for consistent theming:
```css
--bg-primary: #0D1117
--bg-secondary: #161B22
--accent-gold: #F0A500
--text-primary: #F0F6FC
--success: #238636
--danger: #DA3633
```

---

## Game Submission Flow

1. User opens Add Game modal
2. Selects White player, Black player, Result, Date, Tournament (optional)
3. System calculates rating changes using Elo formula
4. Confirmation Popup displays:
   - Players and result
   - Rating changes for both players
5. User confirms - Game saved to Supabase
6. Player stats updated in database
7. All views re-render with new data

---

## Current Status (March 2026)

### Working Features:
- Player management (CRUD)
- Game logging with ELO
- Tournament creation (Swiss, Round Robin, Knockout)
- Tournament pairing generation
- Result entry and standings
- Leaderboard with form indicators
- Offline tournament support (localStorage)
- Crash recovery for active tournaments

### Known Limitations:
- checkForLocalTournament() not yet called on app initialization
- Result entry still makes Supabase calls (should be local-only)
- Round generation needs to store to local state

---

## Notes

- The app uses ES Modules (type: module in package.json)
- Games cannot be deleted once recorded (intentional design)
- UUIDs are used for all primary keys
- Player names are cached in games table for display speed
- Tournament uses hybrid approach: local state + minimal Supabase sync
