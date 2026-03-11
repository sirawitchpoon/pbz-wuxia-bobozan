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
  botName: string;
  userId: string;
  username: string;
  action: string;
  details?: string;
  pointsChange?: number;
}): Promise<void> {
  if (!isBotsLoggerEnabled()) return;

  try {
    await fetch(`${loggerUrl}/api/logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': loggerApiKey,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // Logging failures are non-critical — silently ignore
  }
}
