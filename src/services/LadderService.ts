import { BattleResult } from '../models/BattleResult';
import { LadderProfile, ILadderProfile, getRankForRating } from '../models/LadderProfile';

export interface RatingChange {
  oldRating: number;
  newRating: number;
  delta: number;
  oldRank: string;
  newRank: string;
  rankChanged: boolean;
}

export async function getOrCreateProfile(userId: string, displayName: string): Promise<ILadderProfile> {
  let profile = await LadderProfile.findOne({ userId });
  if (!profile) {
    profile = await LadderProfile.create({ userId, displayName });
  } else if (profile.displayName !== displayName) {
    profile.displayName = displayName;
    await profile.save();
  }
  return profile;
}

export async function getLeaderboard(limit: number = 10) {
  return LadderProfile.find().sort({ rating: -1 }).limit(limit).lean();
}

/**
 * Calculate Elo rating changes and persist to MongoDB.
 * Returns rating change info for both players.
 */
export async function calculateRatingChanges(
  result: BattleResult,
  profileA: ILadderProfile,
  profileB: ILadderProfile,
): Promise<[RatingChange, RatingChange]> {
  const rA = profileA.rating;
  const rB = profileB.rating;

  // Expected scores
  const eA = 1 / (1 + Math.pow(10, (rB - rA) / 400));
  const eB = 1 - eA;

  // Actual scores
  let sA: number, sB: number;
  if (result.isDraw) {
    sA = 0.5;
    sB = 0.5;
  } else if (result.winnerId === result.playerAId) {
    sA = 1.0;
    sB = 0.0;
  } else {
    sA = 0.0;
    sB = 1.0;
  }

  // Dynamic K-factor
  const kA = getKFactor(profileA);
  const kB = getKFactor(profileB);

  let deltaA = Math.round(kA * (sA - eA));
  let deltaB = Math.round(kB * (sB - eB));

  // Forfeit/timeout penalty: extra -5 for loser
  if (result.endedByForfeit || result.endedByTimeout) {
    if (result.loserId === result.playerAId) deltaA -= 5;
    if (result.loserId === result.playerBId) deltaB -= 5;
  }

  const oldRankA = getRankForRating(rA);
  const oldRankB = getRankForRating(rB);

  // Apply changes
  profileA.rating = Math.max(0, rA + deltaA);
  profileA.peakRating = Math.max(profileA.peakRating, profileA.rating);
  profileA.gamesPlayed++;
  profileB.rating = Math.max(0, rB + deltaB);
  profileB.peakRating = Math.max(profileB.peakRating, profileB.rating);
  profileB.gamesPlayed++;

  if (result.isDraw) {
    profileA.draws++;
    profileB.draws++;
    profileA.currentStreak = 0;
    profileB.currentStreak = 0;
  } else if (result.winnerId === result.playerAId) {
    profileA.wins++;
    profileB.losses++;
    profileA.currentStreak = profileA.currentStreak > 0 ? profileA.currentStreak + 1 : 1;
    profileB.currentStreak = profileB.currentStreak < 0 ? profileB.currentStreak - 1 : -1;
  } else {
    profileB.wins++;
    profileA.losses++;
    profileB.currentStreak = profileB.currentStreak > 0 ? profileB.currentStreak + 1 : 1;
    profileA.currentStreak = profileA.currentStreak < 0 ? profileA.currentStreak - 1 : -1;
  }

  const newRankA = getRankForRating(profileA.rating);
  const newRankB = getRankForRating(profileB.rating);

  await profileA.save();
  await profileB.save();

  return [
    {
      oldRating: rA,
      newRating: profileA.rating,
      delta: deltaA,
      oldRank: `${oldRankA.icon} ${oldRankA.titleEn}`,
      newRank: `${newRankA.icon} ${newRankA.titleEn}`,
      rankChanged: oldRankA.title !== newRankA.title,
    },
    {
      oldRating: rB,
      newRating: profileB.rating,
      delta: deltaB,
      oldRank: `${oldRankB.icon} ${oldRankB.titleEn}`,
      newRank: `${newRankB.icon} ${newRankB.titleEn}`,
      rankChanged: oldRankB.title !== newRankB.title,
    },
  ];
}

function getKFactor(profile: ILadderProfile): number {
  // Placement phase: first 10 games
  let k = profile.gamesPlayed < 10 ? 48 : 32;

  // Streak bonus: +4 per consecutive win/loss beyond 1, cap +20
  const absStreak = Math.abs(profile.currentStreak);
  if (absStreak > 1) {
    k += Math.min(20, (absStreak - 1) * 4);
  }

  return k;
}
