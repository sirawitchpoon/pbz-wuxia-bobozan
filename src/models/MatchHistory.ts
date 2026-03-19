import mongoose, { Document, Schema } from 'mongoose';

export interface IMatchHistory extends Document {
  playerAId: string;
  playerBId: string;
  playerAName: string;
  playerBName: string;
  playerAJob: string;
  playerBJob: string;
  winnerId: string | null;
  isDraw: boolean;
  totalRounds: number;
  playerAHonorEarned: number;
  playerBHonorEarned: number;
  playerARatingChange: number;
  playerBRatingChange: number;
  endedByForfeit: boolean;
  endedByTimeout: boolean;
  duelCardId?: string;
  duelDisplayId?: string;
  guildId?: string;
  createdAt?: Date;
}

const MatchHistorySchema = new Schema(
  {
    playerAId: { type: String, required: true, index: true },
    playerBId: { type: String, required: true, index: true },
    playerAName: { type: String, required: true },
    playerBName: { type: String, required: true },
    playerAJob: { type: String, required: true },
    playerBJob: { type: String, required: true },
    winnerId: { type: String, default: null },
    isDraw: { type: Boolean, default: false },
    totalRounds: { type: Number, required: true },
    playerAHonorEarned: { type: Number, default: 0 },
    playerBHonorEarned: { type: Number, default: 0 },
    playerARatingChange: { type: Number, default: 0 },
    playerBRatingChange: { type: Number, default: 0 },
    endedByForfeit: { type: Boolean, default: false },
    endedByTimeout: { type: Boolean, default: false },
    duelCardId: { type: String, index: true },
    duelDisplayId: { type: String, index: true },
    guildId: { type: String, index: true },
  },
  { timestamps: true, collection: 'bobozan_match_history' },
);

export const MatchHistory = mongoose.model<IMatchHistory>('MatchHistory', MatchHistorySchema);
