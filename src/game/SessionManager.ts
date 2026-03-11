import { BattleSession } from './BattleSession';

/** In-memory registry of active duels. Key = any participating userId. */
const activeSessions = new Map<string, BattleSession>();

export function getSession(userId: string): BattleSession | undefined {
  return activeSessions.get(userId);
}

export function hasActiveSession(userId: string): boolean {
  return activeSessions.has(userId);
}

export function registerSession(session: BattleSession): void {
  activeSessions.set(session.playerAId, session);
  activeSessions.set(session.playerBId, session);
}

export function removeSession(session: BattleSession): void {
  activeSessions.delete(session.playerAId);
  activeSessions.delete(session.playerBId);
}

export function getActiveCount(): number {
  // Each session registers 2 keys
  return activeSessions.size / 2;
}
