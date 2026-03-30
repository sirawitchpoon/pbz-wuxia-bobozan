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
  if (!session.practiceMode) {
    activeSessions.set(session.playerBId, session);
  }
}

export function removeSession(session: BattleSession): void {
  activeSessions.delete(session.playerAId);
  if (!session.practiceMode) {
    activeSessions.delete(session.playerBId);
  }
}

export function getActiveCount(): number {
  return new Set(activeSessions.values()).size;
}

export function getSessionByPublicChannelId(publicChannelId: string): BattleSession | undefined {
  const uniqueSessions = new Set(activeSessions.values());
  for (const s of uniqueSessions) {
    if (s.getPublicChannelId() === publicChannelId) return s;
  }
  return undefined;
}
