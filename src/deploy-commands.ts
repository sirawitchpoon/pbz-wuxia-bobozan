import dotenv from 'dotenv';
import { REST, Routes } from 'discord.js';

dotenv.config();

const token = process.env.DISCORD_TOKEN!;
const clientId = process.env.CLIENT_ID!;
const guildId = process.env.GUILD_ID!;

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    // Button-based bot — clear any leftover slash commands
    console.log('[BoboZan] Clearing guild slash commands (bot is button-based)...');
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] });
    console.log('[BoboZan] Clearing global slash commands...');
    await rest.put(Routes.applicationCommands(clientId), { body: [] });
    console.log('[BoboZan] Done — all slash commands cleared.');
  } catch (error) {
    console.error('[BoboZan] Failed:', error);
  }
})();
