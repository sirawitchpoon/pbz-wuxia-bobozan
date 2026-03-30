/**
 * Hub channel ID — supports both naming styles for .env compatibility.
 * Prefer SHADOW_DUEL_HUB_CHANNEL_ID (matches other SHADOW_DUEL_*_CHANNEL_ID keys).
 */
export function getShadowDuelHubChannelId(): string {
  return (process.env.SHADOW_DUEL_HUB_CHANNEL_ID ?? process.env.SHADOW_DUEL_HUB_CHANNEL ?? '').trim();
}
