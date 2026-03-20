/**
 * One-off script: delete all messages from the bot in #bobozan-match-history.
 * Use after reset-competition-data.ts to clear the visible match history in Discord.
 *
 * Run from project root: npx ts-node scripts/purge-match-history-channel.ts
 * Requires: DISCORD_TOKEN, SHADOW_DUEL_HISTORY_CHANNEL_ID in .env
 */

import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { Client, GatewayIntentBits, TextChannel } from 'discord.js';

async function main() {
  const token = process.env.DISCORD_TOKEN;
  const channelId = process.env.SHADOW_DUEL_HISTORY_CHANNEL_ID;

  if (!token || !channelId) {
    console.error('❌ Set DISCORD_TOKEN and SHADOW_DUEL_HISTORY_CHANNEL_ID in .env');
    process.exit(1);
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  await client.login(token);

  await new Promise<void>((resolve, reject) => {
    client.once('ready', () => resolve());
    client.once('error', reject);
  });

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !(channel instanceof TextChannel)) {
    console.error('❌ Channel not found or not a text channel.');
    client.destroy();
    process.exit(1);
  }

  let deleted = 0;
  let lastId: string | undefined;

  while (true) {
    const options: { limit: 100; before?: string } = { limit: 100 };
    if (lastId) options.before = lastId;

    const messages = await channel.messages.fetch(options);
    const fromBot = messages.filter(m => m.author.id === client.user!.id);

    for (const [, msg] of fromBot) {
      await msg.delete().catch(() => {});
      deleted++;
    }

    if (messages.size < 100) break;
    lastId = messages.last()?.id;
  }

  console.log(`Deleted ${deleted} message(s) from #bobozan-match-history.`);
  client.destroy();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
