/**
 * One-off script: reset all Wuxia BoboZan competition data (ladder profiles + match history).
 * Use after testing to clear test matches and start fresh.
 *
 * ⚠️ Use the SAME MongoDB as the bot. If the bot runs in Docker with honor-points-service,
 *    MongoDB is often exposed on the host as localhost:27017. Run:
 *    MONGO_URI=mongodb://localhost:27017/honorbot npx ts-node scripts/reset-competition-data.ts
 *
 * Run from project root: npx ts-node scripts/reset-competition-data.ts
 * Or with env: MONGO_URI=mongodb://... npx ts-node scripts/reset-competition-data.ts
 */

import path from 'path';
import dotenv from 'dotenv';

// Load .env from project root (parent of scripts/)
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import mongoose from 'mongoose';
import { LadderProfile } from '../src/models/LadderProfile';
import { MatchHistory } from '../src/models/MatchHistory';

async function main() {
  const mongoURI = process.env.MONGO_URI;
  if (!mongoURI) {
    console.error('❌ MONGO_URI not set. Set it in .env or pass MONGO_URI=...');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoURI);
  console.log('Connected.');

  const ladderResult = await LadderProfile.deleteMany({});
  const historyResult = await MatchHistory.deleteMany({});

  console.log(`Deleted ${ladderResult.deletedCount} ladder profile(s).`);
  console.log(`Deleted ${historyResult.deletedCount} match history record(s).`);
  console.log('✅ Competition data reset complete.');
  console.log('');
  console.log('Next: Restart the bot so the Leaderboard channel updates to "No matches yet."');
  console.log('      To clear Match History messages in Discord, run: npx ts-node scripts/purge-match-history-channel.ts');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
