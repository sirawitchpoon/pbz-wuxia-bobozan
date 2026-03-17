# Wuxia BoboZan — Dashboard & data sources

This document describes the data produced by Wuxia BoboZan so that a dashboard (e.g. PBZ Analytics) can display ladder, match history, or links to the bot.

---

## MongoDB (same DB as other PBZ bots)

The bot uses database **`honorbot`** and two collections:

### 1. `bobozan_ladder_profiles`

One document per Discord user who has played at least one match.

| Field          | Type   | Description                    |
|----------------|--------|--------------------------------|
| `userId`       | string | Discord user ID                |
| `displayName`  | string | Display name at last update    |
| `rating`       | number | Current Elo-style rating       |
| `peakRating`   | number | Highest rating reached         |
| `gamesPlayed`  | number | Total matches                  |
| `wins`         | number | Wins                           |
| `losses`       | number | Losses                         |
| `draws`        | number | Draws                          |
| `currentStreak`| number | Positive = win streak, etc.    |
| `honorTotal`   | number | Cumulative honor from matches |
| `createdAt`    | Date   | First profile creation         |
| `updatedAt`    | Date   | Last update                    |

**Leaderboard:** Sort by `rating` descending; take top N. Display name, rating, W/L/D, win rate (e.g. `(wins/gamesPlayed*100)%`).

### 2. `bobozan_match_history`

One document per completed match.

| Field                | Type    | Description                    |
|----------------------|---------|--------------------------------|
| `playerAId`          | string  | Discord user ID                |
| `playerBId`          | string  | Discord user ID                |
| `playerAName`        | string  | Display name                   |
| `playerBName`        | string  | Display name                   |
| `playerAJob`         | string  | Class (e.g. Swordsman)         |
| `playerBJob`         | string  | Class                          |
| `winnerId`           | string? | Winner user ID or null if draw |
| `isDraw`             | boolean | True if draw                   |
| `totalRounds`        | number  | Rounds played                  |
| `playerAHonorEarned` | number  | Honor earned this match        |
| `playerBHonorEarned` | number  | Honor earned this match        |
| `playerARatingChange`| number  | Rating delta                   |
| `playerBRatingChange`| number  | Rating delta                   |
| `endedByForfeit`     | boolean | True if someone forfeited      |
| `endedByTimeout`     | boolean | True if ended by timeout/draw  |
| `createdAt`          | Date    | Match end time                 |

**Match history feed:** Query by `createdAt` descending; show “A vs B — winner / draw”, rounds, date.

---

## Honor Points

Honor earned in BoboZan is sent to the **Honor Points API** (`HONOR_POINTS_API_*`). The central Honor total is stored in that service, not in BoboZan’s collections. `bobozan_ladder_profiles.honorTotal` is a **local** sum for BoboZan matches only.

---

## Discord channels (reference)

- No API from the bot to list channels or messages. The bot posts/edits in fixed channels by ID (env: `BOBOZAN_*_CHANNEL_ID`).
- For “live” leaderboard or match feed, use MongoDB as above; the bot updates the Leaderboard and Match History **channel messages** after each match.

---

## Suggested dashboard integration

1. **Leaderboard:** Query `bobozan_ladder_profiles`, sort by `rating` desc, show top 10–20 with name, rating, W/L/D, win rate.
2. **Recent matches:** Query `bobozan_match_history` by `createdAt` desc, show last N with player names, winner/draw, rounds, date.
3. **Link:** Add a nav item “Wuxia BoboZan” that links to this data or to the bot’s invite/support server.
