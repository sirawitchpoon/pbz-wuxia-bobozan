/**
 * One-off: deduct honor points from a user (e.g. refund test points).
 * Uses Honor Points API — same as the bot. Requires HONOR_POINTS_API_URL and HONOR_POINTS_API_KEY in .env.
 *
 * Run from project root: npx ts-node scripts/deduct-honor.ts
 */

import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { getBalance, deduct, isHonorPointsApiEnabled } from '../src/services/HonorPointsApiClient';

const USER_ID = '314323353429213185';
const AMOUNT = 86;

async function main() {
  if (!isHonorPointsApiEnabled()) {
    console.error('❌ HONOR_POINTS_API_URL and HONOR_POINTS_API_KEY must be set in .env');
    process.exit(1);
  }

  const before = await getBalance(USER_ID);
  console.log(`Current balance for ${USER_ID}: ${before} points`);

  const result = await deduct(USER_ID, AMOUNT);
  if (!result.success) {
    console.error('❌ Deduct failed:', result.error);
    if (result.error?.toLowerCase().includes('insufficient')) {
      console.error('   User has fewer than', AMOUNT, 'points. Cannot deduct.');
    }
    process.exit(1);
  }

  console.log(`Deducted ${AMOUNT} points. New balance: ${result.newBalance ?? '?'}`);
  console.log('✅ Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
