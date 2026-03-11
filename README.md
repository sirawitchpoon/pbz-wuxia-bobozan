<p align="center">
  <strong>Wuxia BoboZan</strong>
</p>
<p align="center">
  <em>Turn-based 1v1 duel Discord bot for the Phantom Blade Zero community.</em>
</p>
<p align="center">
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?logo=node.js" alt="Node" /></a>
  <a href="https://discord.js.org"><img src="https://img.shields.io/badge/Discord.js-v14-5865F2?logo=discord" alt="Discord.js" /></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript" alt="TypeScript" /></a>
  <img src="https://img.shields.io/badge/license-ISC-green" alt="License" />
  <img src="https://img.shields.io/badge/Phantom%20Blade%20Zero-PBZ%20Ecosystem-8b0000" alt="PBZ" />
</p>

---

Button-based challenges, temporary duel channels, Honor Points integration. Inspired by Chinese martial arts — 5 classes, Elo-style ladder.

## 📋 Overview

| | |
|---|---|
| **Part of** | Phantom Blade Zero (PBZ) — Discord bot ecosystem |
| **Role** | In-server mini-game: challenge, class selection, battle, ladder |
| **Stack** | TypeScript, Discord.js v14, MongoDB |

---

## ✨ Features

- **8 fixed channels** — Hub, Challenge cards, Match history, Leaderboard, Ranks, Rules, Honor, My Stats.
- **Temp duel channels** — Visible only to the two players (and optional admin role); auto-deleted after match.
- **5 classes** — Swordsman, Bladesman, Assassin, Iron Monk, Engineer (passive + ultimate).
- **Ladder** — Stored in MongoDB; optional `HONOR_POINTS_API_*` for central economy.

---

## 🚀 Quick Start

```bash
cp .env.example .env   # DISCORD_*, all BOBOZAN_*_CHANNEL_ID, MONGO_URI
npm install && npm run build && npm run deploy
npm start
```

**Docker:** Uses honor-points-service network; `MONGO_URI` overridden to `mongodb://mongodb:27017/honorbot`.  
`docker compose up -d --build`

---

## ⚙️ Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID` | Yes | Discord app |
| `BOBOZAN_HUB_CHANNEL_ID` … `BOBOZAN_STATS_CHANNEL_ID` | Yes | All 8 channel IDs |
| `MONGO_URI` | Yes | Same DB as other PBZ bots in production |
| `HONOR_POINTS_API_URL`, `HONOR_POINTS_API_KEY` | No | Central Honor API |
| `BOBOZAN_ADMIN_ROLE_ID` | No | Role that can view temp duel channels |

---

## 📜 Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript |
| `npm start` | Run bot |
| `npm run dev` | Run with nodemon |
| `npm run reset-data` | Reset ladder and match history in MongoDB |
| `npm run purge-history-channel` | Clear bot messages in Match History channel |

---

## 📄 License

ISC · Part of the **Phantom Blade Zero** community ecosystem.
