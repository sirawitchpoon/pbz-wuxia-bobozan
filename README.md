<p align="center">
  <strong>Shadow Duel</strong>
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

Button-based challenges, **three-channel** temp duel (public hub + two private pick channels), ladder in MongoDB, optional **Honor Points API** for post-match rewards, optional **discord-bots-logger** for analytics. Terminology and UX use **Killing Intent** in copy.

## 📋 Overview

| | |
|---|---|
| **Part of** | Phantom Blade Zero (PBZ) — Discord bot ecosystem |
| **Role** | In-server mini-game: open/target challenge, weapon pick, battle, ladder |
| **Stack** | TypeScript, Discord.js v14, MongoDB |

---

## ✨ Features

- **Fixed channels (7 env targets)** — Hub (challenge buttons only), challenge cards, match history, admin tools, leaderboard, guidebook, plus a **forum** for bug reports (modal creates a thread; no temp-channel bug button).
- **Per-match channels** — One **public** thread/channel for spectators + combat summary, and **two private** channels (one per player) for job select and round picks; optional `BOBOZAN_ADMIN_ROLE_ID` so staff can view temp channels.
- **V3 weapons (duels)** — **The Shield**, **The Sword**, **The Blade** only (passive + ultimate). Guidebook may document legacy classes for reference.
- **Ladder** — Elo-style profiles and match history in MongoDB (`bobozan_*` collections). **Honor total** on the ladder profile is separate from the central Honor balance unless you sync via API.
- **Honor sync** — After settlement, optional `HONOR_POINTS_API_*` credits the central economy. Set `SHADOW_DUEL_SKIP_HONOR_POINTS=true` to disable API calls (testing).
- **Logging** — Optional `BOTS_LOGGER_*` → `discord-bots-logger` with `botId: wuxia-bobozan`, category `shadow_duel`.

---

## 🚀 Quick Start

```bash
cp .env.example .env   # DISCORD_*, SHADOW_DUEL_* channels, MONGO_URI, optional HONOR / LOGGER
npm install && npm run build && npm run deploy
npm start
```

**Docker:** Join the same Docker network as **honor-points-service** if using shared MongoDB/API; set `MONGO_URI` accordingly (e.g. `mongodb://mongodb:27017/honorbot`).

```bash
docker compose up -d --build
```

---

## ⚙️ Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID` | Yes | Discord app |
| `SHADOW_DUEL_HUB_CHANNEL_ID` | Yes | Hub embed + buttons (Open / Target / Practice). Alias: `SHADOW_DUEL_HUB_CHANNEL` |
| `SHADOW_DUEL_CHALLENGE_CHANNEL_ID` | Yes | Challenge card posts |
| `SHADOW_DUEL_HISTORY_CHANNEL_ID` | Yes | Public match history feed |
| `SHADOW_DUEL_ADMIN_CHANNEL_ID` | Yes | Admin: export, reset, cancel duel |
| `SHADOW_DUEL_LEADERBOARD_CHANNEL_ID` | Yes | Persistent leaderboard message |
| `SHADOW_DUEL_GUIDEBOOK_CHANNEL_ID` | Yes | Rules / weapons / flow (categories) |
| `SHADOW_DUEL_FORUMS_CHANNEL_ID` | Yes | Forum for bug-report threads from modal |
| `MONGO_URI` | Yes | Same `honorbot` DB as other PBZ bots in production |
| `HONOR_POINTS_API_URL`, `HONOR_POINTS_API_KEY` | No | Central Honor API (settlement rewards) |
| `SHADOW_DUEL_SKIP_HONOR_POINTS` | No | `true` / `1` = skip honor API on settlement |
| `BOTS_LOGGER_URL`, `BOTS_LOGGER_API_KEY` | No | Action log aggregator |
| `BOBOZAN_ADMIN_ROLE_ID` | No | Role that can view temp duel channels |

See **`.env.example`** for timeouts, channel prefix, and commented options.

---

## 📚 Documentation

| Location | Description |
|----------|-------------|
| **docs/FLOW.md** | Flow: channels, duel lifecycle, combat log privacy, logger |
| **docs/DASHBOARD.md** | MongoDB collections for **pbz-dashboard** Shadow Duel page |
| **reports/CHANGELOG.md** | Changelog |

---

## 📜 Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript |
| `npm start` | Run bot |
| `npm run dev` | Run with nodemon |
| `npm run reset-data` | Reset ladder and match history in MongoDB |
| `npm run purge-history-channel` | Clear bot messages in match history channel (`SHADOW_DUEL_HISTORY_CHANNEL_ID`) |

---

## 📄 License

ISC · Part of the **Phantom Blade Zero** community ecosystem.
