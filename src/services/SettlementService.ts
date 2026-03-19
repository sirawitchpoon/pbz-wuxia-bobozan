import { BattleResult } from '../models/BattleResult';
import { MatchHistory } from '../models/MatchHistory';
import { calculateHonor, HonorBreakdown, formatHonorBreakdown } from './HonorCalculator';
import * as LadderService from './LadderService';
import { RatingChange } from './LadderService';
import * as HonorApi from './HonorPointsApiClient';
import * as BotsLogger from './BotsLoggerClient';
import { logger } from '../utils/logger';
import { DuelCard } from '../models/DuelCard';

export interface SettlementResult {
  honorA: HonorBreakdown;
  honorB: HonorBreakdown;
  ratingA: RatingChange;
  ratingB: RatingChange;
  honorApiSuccessA: boolean;
  honorApiSuccessB: boolean;
}

/**
 * Orchestrates the full post-match settlement pipeline:
 * 1. Calculate honor (pure function)
 * 2. Calculate & persist Elo changes (MongoDB)
 * 3. Add honor via centralized API (honor-points-service)
 * 4. Log actions (discord-bots-logger)
 * 5. Save match history (MongoDB)
 */
export async function settle(result: BattleResult): Promise<SettlementResult> {
  // 1. Honor calculation (pure, no side effects)
  const [honorA, honorB] = calculateHonor(result);

  // 2. Ladder rating changes
  const profileA = await LadderService.getOrCreateProfile(result.playerAId, result.playerAName);
  const profileB = await LadderService.getOrCreateProfile(result.playerBId, result.playerBName);

  // Accumulate honor in ladder profiles
  profileA.honorTotal += honorA.total;
  profileB.honorTotal += honorB.total;
  await profileA.save();
  await profileB.save();

  const [ratingA, ratingB] = await LadderService.calculateRatingChanges(result, profileA, profileB);

  // 3. Honor Points API (centralized, prevents race conditions)
  // Set BOBOZAN_SKIP_HONOR_POINTS=true in .env to skip sending points during testing
  let honorApiSuccessA = false;
  let honorApiSuccessB = false;
  const skipHonorPoints = process.env.BOBOZAN_SKIP_HONOR_POINTS === 'true' || process.env.BOBOZAN_SKIP_HONOR_POINTS === '1';

  if (!skipHonorPoints && HonorApi.isHonorPointsApiEnabled()) {
    try {
      const resA = await HonorApi.add(result.playerAId, honorA.total, result.playerAName);
      honorApiSuccessA = resA.success;
      if (!resA.success) logger.error(`Honor API add failed for ${result.playerAId}:`, resA.error);
    } catch (err) {
      logger.error(`Honor API call failed for ${result.playerAId}:`, err);
    }

    try {
      const resB = await HonorApi.add(result.playerBId, honorB.total, result.playerBName);
      honorApiSuccessB = resB.success;
      if (!resB.success) logger.error(`Honor API add failed for ${result.playerBId}:`, resB.error);
    } catch (err) {
      logger.error(`Honor API call failed for ${result.playerBId}:`, err);
    }
  } else if (skipHonorPoints) {
    logger.info('BOBOZAN_SKIP_HONOR_POINTS is set — honor not sent to central system (test mode)');
  } else {
    logger.warn('Honor Points API not configured — points not added to central system');
  }

  // 4. Action logging (non-blocking, fire-and-forget)
  BotsLogger.logAction({
    botName: 'wuxia-bobozan',
    userId: result.playerAId,
    username: result.playerAName,
    action: 'bobozan_match',
    details: `${result.playerAJob} vs ${result.playerBJob}, ${result.totalRounds} rounds`,
    pointsChange: honorA.total,
  }).catch(() => {});
  BotsLogger.logAction({
    botName: 'wuxia-bobozan',
    userId: result.playerBId,
    username: result.playerBName,
    action: 'bobozan_match',
    details: `${result.playerBJob} vs ${result.playerAJob}, ${result.totalRounds} rounds`,
    pointsChange: honorB.total,
  }).catch(() => {});

  // 5. Match history + link duel card
  try {
    const doc = await MatchHistory.create({
      playerAId: result.playerAId,
      playerBId: result.playerBId,
      playerAName: result.playerAName,
      playerBName: result.playerBName,
      playerAJob: result.playerAJob,
      playerBJob: result.playerBJob,
      winnerId: result.winnerId,
      isDraw: result.isDraw,
      totalRounds: result.totalRounds,
      playerAHonorEarned: honorA.total,
      playerBHonorEarned: honorB.total,
      playerARatingChange: ratingA.delta,
      playerBRatingChange: ratingB.delta,
      endedByForfeit: result.endedByForfeit,
      endedByTimeout: result.endedByTimeout,
      ...(result.duelCardId ? { duelCardId: result.duelCardId } : {}),
      ...(result.duelDisplayId ? { duelDisplayId: result.duelDisplayId } : {}),
      ...(result.guildId ? { guildId: result.guildId } : {}),
    });
    if (result.duelCardId) {
      await DuelCard.updateOne(
        { _id: result.duelCardId },
        { $set: { status: 'completed', matchHistoryId: doc._id } },
      ).catch(() => {});
    }
  } catch (err) {
    logger.error('Failed to save match history:', err);
  }

  return { honorA, honorB, ratingA, ratingB, honorApiSuccessA, honorApiSuccessB };
}
