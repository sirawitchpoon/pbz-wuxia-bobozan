/**
 * Optional client for discord-bots-logger (action log aggregator).
 * Sends match results for analytics if configured.
 */

const loggerUrl = (process.env.BOTS_LOGGER_URL ?? '').replace(/\/$/, '');
const loggerApiKey = process.env.BOTS_LOGGER_API_KEY ?? '';

export function isBotsLoggerEnabled(): boolean {
  return Boolean(loggerUrl && loggerApiKey);
}

export async function logAction(payload: {
  botId: string;
  category: string;
  userId: string;
  action: string;
  username?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  if (!isBotsLoggerEnabled()) return;

  try {
    await fetch(`${loggerUrl}/api/logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': loggerApiKey,
      },
      body: JSON.stringify({
        botId: payload.botId,
        category: payload.category,
        action: payload.action,
        userId: payload.userId,
        username: payload.username,
        details: payload.details,
      }),
    });
  } catch {
    // Logging failures are non-critical — silently ignore
  }
}
