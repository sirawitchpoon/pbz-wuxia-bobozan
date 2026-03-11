/**
 * Stores the leaderboard message ID so we can edit it when a match ends.
 * Set when UserInteractionService posts the leaderboard message.
 */
let leaderboardMessageId: string | null = null;

export function setLeaderboardMessageId(id: string): void {
  leaderboardMessageId = id;
}

export function getLeaderboardMessageId(): string | null {
  return leaderboardMessageId;
}
