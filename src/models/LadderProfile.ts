import mongoose, { Document, Schema } from 'mongoose';

export interface ILadderProfile extends Document {
  userId: string;
  displayName: string;
  rating: number;
  peakRating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  /** Positive = win streak, negative = loss streak, reset on draw */
  currentStreak: number;
  /** Cumulative honor earned from BoboZan matches */
  honorTotal: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const LadderProfileSchema = new Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    displayName: { type: String, default: '' },
    rating: { type: Number, default: 1200 },
    peakRating: { type: Number, default: 1200 },
    gamesPlayed: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    currentStreak: { type: Number, default: 0 },
    honorTotal: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'bobozan_ladder_profiles' },
);

export const LadderProfile = mongoose.model<ILadderProfile>('LadderProfile', LadderProfileSchema);

export interface RankTier {
  minRating: number;
  title: string;
  titleEn: string;
  icon: string;
}

export const RANK_TIERS: RankTier[] = [
  { minRating: 2400, title: '武圣', titleEn: 'Martial Saint', icon: '🐉' },
  { minRating: 2100, title: '武尊', titleEn: 'Martial Sovereign', icon: '🔥' },
  { minRating: 1800, title: '武王', titleEn: 'Martial King', icon: '⚔️' },
  { minRating: 1500, title: '武师', titleEn: 'Martial Master', icon: '🗡️' },
  { minRating: 1200, title: '武者', titleEn: 'Martial Artist', icon: '🥋' },
  { minRating: 900, title: '武徒', titleEn: 'Martial Apprentice', icon: '👊' },
  { minRating: 600, title: '武童', titleEn: 'Martial Novice', icon: '🌱' },
  { minRating: 0, title: '无名小卒', titleEn: 'Nameless', icon: '💤' },
];

export function getRankForRating(rating: number): RankTier {
  return RANK_TIERS.find(t => rating >= t.minRating) ?? RANK_TIERS[RANK_TIERS.length - 1];
}
