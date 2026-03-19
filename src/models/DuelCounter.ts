import mongoose, { Document, Schema } from 'mongoose';

export interface IDuelCounter extends Document {
  guildId: string;
  seq: number;
}

const DuelCounterSchema = new Schema(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    seq: { type: Number, default: 0 },
  },
  { collection: 'bobozan_duel_counter' },
);

export const DuelCounter = mongoose.model<IDuelCounter>('DuelCounter', DuelCounterSchema);

/** Next duel display id per guild (001, 002, …). */
export async function nextDuelDisplayId(guildId: string): Promise<{ seq: number; displayId: string }> {
  const doc = await DuelCounter.findOneAndUpdate(
    { guildId },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  const seq = doc?.seq ?? 1;
  const displayId = seq < 1000 ? String(seq).padStart(3, '0') : String(seq);
  return { seq, displayId };
}
