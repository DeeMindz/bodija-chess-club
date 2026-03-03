# BCC - Bodija Chess Club Rating Management System

> Last updated: 2026-03-02

---

## Project Overview

BCC is a chess club rating management web application built with Vite and Supabase. It provides comprehensive player management, game tracking with Elo rating system, tournament management, and real-time leaderboards.

| Property | Value |
|----------|-------|
| **Project Name** | BCC (Bodija Chess Club) |
| **Framework** | Vite 7.3.1 |
| **Frontend** | Vanilla JavaScript + CSS |
| **Backend** | Supabase (PostgreSQL + Realtime) |
| **Build Command** | `npm run build` |
| **Output Directory** | `dist` |
| **Deployment** | Vercel |

---

## Features

### 1. Dashboard
- **Podium Display**: Top 3 players with avatars and ratings
- **Statistics Cards**: Total members, total games, active tournaments
- **Recent Games**: Last 5 games played with quick results
- **Quick Actions**: Navigation to all sections

### 2. Leaderboard
- Full player rankings sorted by rating
- **Columns**: Rank, Player, Form, Rating, W-D-L, Win%
- **Mobile-Optimized**: Hides Peak, Games, Status columns on small screens
- **Performance Indicators**: Visual form tracking
- **Sorting**: Click column headers to sort
- **Search**: Filter players by name

### 3. Players Management
- Player cards with full stats
- **Player Detail Modal**:
  - Current & Peak ratings
  - Win rate percentage
  - Games played (W-D-L breakdown)
  - Rating history chart
  - Head-to-head records vs other players
- **Status Badges**: Active (green), Inactive (grey), Dormant (purple)

### 4. Games Log
- Complete game history
- **Columns**: Date, White Player, Result, Black Player, Tournament
- **Filtering**: By tournament
- **Result Display**: 1-0 (White wins), 0-1 (Black wins), ½-½ (Draw)
- **Rating Deltas**: Shows rating changes for both players

### 5. Tournaments
- Create and manage tournaments
- **Tournament Formats**: Swiss, Round Robin, Knockout
- **Time Controls**: Classical, Rapid, Blitz, Bullet options
- **Status**: Draft, Active, Completed
- **Player Registration**: Select players to participate
- **Pairing Generation**: Automatic pairing based on format
- **Filtering**: By status and format

---

## Form Indicator Logic

The Form indicator shows player performance based on recent games and rating trends:

| Status | Condition | Icon | Color |
|--------|-----------|------|-------|
| **NEW** | Less than 5 games played | Blue badge | #2979FF |
| **HOT** 🔥 | 4.5+ form points OR 50+ rating gain | Fire emoji | Orange pulse |
| **UP** ↑ | 3+ form points OR 20+ rating gain | Up arrow | #00C853 |
| **DOWN** ↓ | Less than 2 form points OR -20+ rating loss | Down arrow | #FF5252 |
| **STABLE** → | Everything else | Horizontal line | #9E9E9E |

### Form Calculation:
- **Last 5 games** are analyzed
- Win = 1 point, Draw = 0.5 points, Loss = 0 points
- **Rating Trend**: Compares current rating to rating at last tournament

---

## Rating System (Elo)

### K-Factor:
- **K = 40**: Players with less than 15 games (rapidly changing ratings)
- **K = 20**: Players with 15+ games (stable players)

### Rating Calculation:
```
Expected Score = 1 / (1 + 10^((OpponentRating - MyRating) / 400))
Rating Change = K × (ActualScore - ExpectedScore)
```

---

## Supabase Database Schema

### Table: `players`
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
| created_at | timestamp | Creation timestamp |

### Table: `games`
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| game_date | date | Date game was played |
| white_player_id | uuid | FK to players (white pieces) |
| black_player_id | uuid | FK to players (black pieces) |
| white_player_name | text | Cached white player name |
| black_player_name | text | Cached black player name |
| result | text | 1-0, 0-1, or 0.5-0.5 |
| tournament | text | Tournament name (optional) |
| round_number | integer | Round in tournament |
| white_rating_change | integer | Rating change for white |
| black_rating_change | integer | Rating change for black |
| created_at | timestamp | Creation timestamp |

### Table: `tournaments`
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| name | text | Tournament name |
| date | date | Tournament date |
| format | text | swiss/roundrobin/knockout |
| time_control | text | Time control (e.g., "Rapid 25+0") |
| rounds | integer | Number of rounds |
| status | text | draft/active/completed |
| created_at | timestamp | Creation timestamp |

---

## Environment Variables

Configure these in Vercel dashboard or `.env` file:

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon key |

---

## Technical Implementation

### Data Mapping
The app uses mapping functions to handle Supabase's snake_case database columns:

- `mapPlayerFromDB()` - Converts player data to camelCase
- `mapGameFromDB()` - Converts game data to camelCase
- `mapTournamentFromDB()` - Converts tournament data to camelCase

### Real-time Subscriptions
- Players table is watched for changes
- Updates reflect immediately across all connected clients

### Responsive Design
- **Desktop**: Full feature set with all columns visible
- **Mobile**: Optimized columns, touch-friendly interactions
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

1. User opens "Add Game" modal
2. Selects White player, Black player, Result, Date, Tournament (optional)
3. System calculates rating changes using Elo formula
4. **Confirmation Popup** displays:
   - Players and result
   - Rating changes for both players
5. User confirms → Game saved to Supabase
6. Player stats updated in database
7. All views re-render with new data

---

## Notes

- The app uses ES Modules (`"type": "module"` in package.json)
- All data is stored in Supabase - no local storage fallback
- Games cannot be deleted once recorded (intentional design)
- UUIDs are used for all primary keys
- Player names are cached in games table for display speed
