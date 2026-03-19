import mongoose, { Document, Schema, Types } from 'mongoose';

export type DuelChallengeType = 'open' | 'targeted';
export type DuelCardStatus =
  | 'open'
  | 'accepted'
  | 'in_match'
  | 'completed'
  | 'expired'
  | 'declined'
  | 'cancelled';

export interface IDuelCard extends Document {
  guildId: string;
  displaySeq: number;
  displayId: string;
  challengeType: DuelChallengeType;
  challengerId: string;
  targetUserId?: string;
  status: DuelCardStatus;
  challengeChannelId?: string;
  challengeMessageId?: string;
  categoryId?: string;
  publicChannelId?: string;
  privateChannelAId?: string;
  privateChannelBId?: string;
  acceptorId?: string;
  matchHistoryId?: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

const DuelCardSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    displaySeq: { type: Number, required: true },
    displayId: { type: String, required: true, index: true },
    challengeType: { type: String, enum: ['open', 'targeted'], required: true },
    challengerId: { type: String, required: true, index: true },
    targetUserId: { type: String, index: true },
    status: {
      type: String,
      enum: ['open', 'accepted', 'in_match', 'completed', 'expired', 'declined', 'cancelled'],
      default: 'open',
      index: true,
    },
    challengeChannelId: { type: String },
    challengeMessageId: { type: String },
    categoryId: { type: String },
    publicChannelId: { type: String },
    privateChannelAId: { type: String },
    privateChannelBId: { type: String },
    acceptorId: { type: String },
    matchHistoryId: { type: Schema.Types.ObjectId },
  },
  { timestamps: true, collection: 'bobozan_duel_cards' },
);

export const DuelCard = mongoose.model<IDuelCard>('DuelCard', DuelCardSchema);
