export interface BattleResult {
  winnerId: string | null;
  loserId: string | null;
  isDraw: boolean;

  playerAId: string;
  playerBId: string;
  playerAName: string;
  playerBName: string;

  playerAJob: string;
  playerBJob: string;
  playerAHpRemaining: number;
  playerBHpRemaining: number;
  playerAMaxHp: number;
  playerBMaxHp: number;

  playerADamageDealt: number;
  playerBDamageDealt: number;
  playerAUltsUsed: number;
  playerBUltsUsed: number;
  playerADefendsSuccess: number;
  playerBDefendsSuccess: number;

  totalRounds: number;
  endedByForfeit: boolean;
  endedByTimeout: boolean;

  /** Mongo DuelCard _id for dashboards / match history linkage */
  duelCardId?: string;
  /** Human-readable duel id e.g. 001 */
  duelDisplayId?: string;
  guildId?: string;
}
