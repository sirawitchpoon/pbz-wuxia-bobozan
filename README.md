# Wuxia BoboZan

> **Turn-based 1v1 duel Discord bot for the Phantom Blade Zero community.**  
> Button-based challenges, temporary duel channels, Honor Points integration.

---

## Overview

| | |
|---|---|
| **Part of** | Phantom Blade Zero (PBZ) — Discord bot ecosystem |
| **Role** | In-server mini-game: challenge, class selection, battle, ladder |
| **Stack** | TypeScript, Discord.js v14, MongoDB |

Inspired by Chinese martial arts. **Open Challenge** or **Target Challenge** from Hub; challenge cards in a dedicated channel; on accept, a **private temporary channel** is created for the two players. Class selection and battle run there; channel is deleted after the match. Elo-style ladder and optional sync to central Honor Points API.

---

## Features

- **8 fixed channels** — Hub, Challenge cards, Match history, Leaderboard, Ranks, Rules, Honor, My Stats.
- **Temp duel channels** — Visible only to the two players (and optional admin role); auto-deleted after match.
- **5 classes** — Swordsman, Bladesman, Assassin, Iron Monk, Engineer (passive + ultimate).
- **Ladder** — Stored in MongoDB; optional `HONOR_POINTS_API_*` for central economy.

---

## Quick Start

```bash
cp .env.example .env   # DISCORD_*, all BOBOZAN_*_CHANNEL_ID, MONGO_URI
npm install && npm run build && npm run deploy
npm start
```

**Docker:** Uses honor-points-service network; `MONGO_URI` overridden to `mongodb://mongodb:27017/honorbot`.  
`docker compose up -d --build`

---

## Environment (main)

| Variable | Required | Description |
|----------|----------|--------------|
| `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID` | Yes | Discord app |
| `BOBOZAN_HUB_CHANNEL_ID` … `BOBOZAN_STATS_CHANNEL_ID` | Yes | All 8 channel IDs |
| `MONGO_URI` | Yes | Same DB as other PBZ bots in production |
| `HONOR_POINTS_API_URL`, `HONOR_POINTS_API_KEY` | No | Central Honor API |
| `BOBOZAN_ADMIN_ROLE_ID` | No | Role that can view temp duel channels |

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript |
| `npm start` | Run bot |
| `npm run dev` | Run with nodemon |
| `npm run reset-data` | Reset ladder and match history in MongoDB |
| `npm run purge-history-channel` | Clear bot messages in Match History channel |

---

## License

ISC
