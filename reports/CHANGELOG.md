# Wuxia BoboZan — Changelog

Summary of notable changes. All dates approximate.

---

## Recent (2026-03)

### Channel layout & flow

- **8 fixed channels:** Hub (Open + Target Challenge only), Challenge cards, Match history, Leaderboard, Ranks, Rules, Honor, My Stats.
- **Temp duel channel:** Created when a challenge is accepted (`#duel-{A}-vs-{B}`). Visible only to the two players and optional `BOBOZAN_ADMIN_ROLE_ID`. Entire duel (class select + battle) runs there. Channel is **deleted automatically** after the match (delay: `BOBOZAN_TEMP_CHANNEL_DELETE_DELAY_MS`, default 5s).
- **Challenge cards** are posted in Channel 2 only. Challenge expiry: `BOBOZAN_CHALLENGE_EXPIRE_SECONDS` (default 180s).

### Temp channel UI (3 embeds)

- In the temp duel channel, the battle is shown with **3 fixed embeds** (all updates by **edit**, no extra messages):
  1. **Top — Timer / Phase:** Round number, time limit per round, and (when both idle) extra window before draw.
  2. **Middle — Battle log:** What happened this round (e.g. who Charged, who hit, who blocked).
  3. **Bottom — Status + actions:** HP/energy bars, turn status, and action buttons (Charge, Attack, Defend, Ultimate, Set Trap, Forfeit).
- Errors (e.g. non-Engineer pressing Set Trap) remain **ephemeral** (only the user who clicked sees them; Dismiss available).

### Round timeout behavior

- **One player does not choose in time:** That player is treated as having **no action** for the round. The round is resolved normally (e.g. the other player’s Attack hits). The match does **not** end; it continues until someone reaches 0 HP from damage (or forfeit).
- **Both players do not choose in time:** An **extra time window** is given (`ROUND_TIMEOUT_BOTH_IDLE_SECONDS`, default 60s). If still no choice after that, the round is declared a **Draw** (both eliminated).

### Scripts & reset

- **`npm run reset-data`** — Deletes all documents in `bobozan_ladder_profiles` and `bobozan_match_history` (MongoDB). Does **not** modify Honor Points in the central system. Use the same `MONGO_URI` as the bot (e.g. from host: `127.0.0.1:27019` if MongoDB is published on 27019).
- **`npm run purge-history-channel`** — Deletes all messages from the bot in the Match History channel (Discord only).
- After reset, restart the bot so the Leaderboard channel message updates to “No matches yet.”

### Configuration (env)

- `ROUND_TIMEOUT_SECONDS` — Seconds per round to choose an action (default 30).
- `ROUND_TIMEOUT_BOTH_IDLE_SECONDS` — Extra seconds when both players idle before declaring draw (default 60).
- `BOBOZAN_CHALLENGE_EXPIRE_SECONDS` — Challenge card expiry (default 180).
- `BOBOZAN_TEMP_CHANNEL_DELETE_DELAY_MS` — Delay before deleting temp channel after match end (default 5000).
- `BOBOZAN_ADMIN_ROLE_ID` — Optional role that can see temp duel channels.

### Rules & docs

- Rules channel and ephemeral Rules button show **configurable** round time and both-idle extra time (from env).
- **README.md** and **docs/FLOW.md** updated for 8 channels, temp channel, 3-embed layout, timeout rules, and scripts.

---

## Earlier

- Button-based UI (no slash commands). English UI for global servers.
- Integration with Honor Points API and Bots Logger. Optional test mode: `BOBOZAN_SKIP_HONOR_POINTS=true`.
- 5 classes: Swordsman, Bladesman, Assassin, Iron Monk, Engineer (passive + ultimate). Elo-style ladder and match history in MongoDB.
