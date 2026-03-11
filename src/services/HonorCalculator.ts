import { BattleResult } from '../models/BattleResult';

export interface HonorBreakdown {
  base: number;
  outcome: number;
  damage: number;
  ults: number;
  defends: number;
  style: number;
  efficiency: number;
  penalty: number;
  total: number;
}

/**
 * Pure function: same input always produces same output, no side effects.
 * Returns honor breakdowns for both players.
 */
export function calculateHonor(result: BattleResult): [HonorBreakdown, HonorBreakdown] {
  const a = calcForPlayer(result, 'a');
  const b = calcForPlayer(result, 'b');
  return [a, b];
}

function calcForPlayer(result: BattleResult, side: 'a' | 'b'): HonorBreakdown {
  const isA = side === 'a';
  const playerId = isA ? result.playerAId : result.playerBId;
  const damage = isA ? result.playerADamageDealt : result.playerBDamageDealt;
  const ults = isA ? result.playerAUltsUsed : result.playerBUltsUsed;
  const defends = isA ? result.playerADefendsSuccess : result.playerBDefendsSuccess;
  const hpRemaining = isA ? result.playerAHpRemaining : result.playerBHpRemaining;
  const maxHp = isA ? result.playerAMaxHp : result.playerBMaxHp;

  const isWinner = result.winnerId === playerId;
  const isLoser = result.loserId === playerId;
  const isDraw = result.isDraw;

  // Base
  const base = 10;

  // Outcome
  let outcome = 5; // lose
  if (isWinner) outcome = 30;
  else if (isDraw) outcome = 15;

  // Performance
  const damagePoints = damage * 4;
  const ultsPoints = ults * 5;
  const defendsPoints = defends * 3;

  // Style bonuses
  let style = 0;
  if (isWinner && hpRemaining >= maxHp) style += 20; // Perfect Win
  if (isWinner && hpRemaining === 1) style += 15; // Comeback
  if (isWinner && result.totalRounds <= 3) style += 10; // Fast Win
  if (result.totalRounds > 10) style += 8; // Long Battle (both)

  // Efficiency (winner only)
  let efficiency = 0;
  if (isWinner) {
    efficiency = Math.max(0, 10 - result.totalRounds) * 2;
  }

  // Penalty
  let penalty = 0;
  if (result.endedByForfeit && isLoser) penalty = -10;
  if (result.endedByTimeout && isLoser) penalty = -5;

  const total = Math.max(0, base + outcome + damagePoints + ultsPoints + defendsPoints + style + efficiency + penalty);

  return { base, outcome, damage: damagePoints, ults: ultsPoints, defends: defendsPoints, style, efficiency, penalty, total };
}

export function formatHonorBreakdown(b: HonorBreakdown): string[] {
  const lines: string[] = [];
  lines.push(`Base: +${b.base}`);
  lines.push(`Result: +${b.outcome}`);
  if (b.damage > 0) lines.push(`Damage: +${b.damage}`);
  if (b.ults > 0) lines.push(`Ults: +${b.ults}`);
  if (b.defends > 0) lines.push(`Defends: +${b.defends}`);
  if (b.style > 0) lines.push(`Style: +${b.style}`);
  if (b.efficiency > 0) lines.push(`Efficiency: +${b.efficiency}`);
  if (b.penalty < 0) lines.push(`Penalty: ${b.penalty}`);
  lines.push(`**Total: +${b.total}**`);
  return lines;
}
