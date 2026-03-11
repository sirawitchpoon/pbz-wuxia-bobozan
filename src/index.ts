import dotenv from 'dotenv';
import { Client, GatewayIntentBits } from 'discord.js';
import { connectDB } from './utils/connectDB';
import { UserInteractionService } from './services/UserInteractionService';
import * as interactionCreateEvent from './events/interactionCreate';
import { logger } from './utils/logger';

dotenv.config();

logger.info('Starting...');

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const userInteractionService = new UserInteractionService();

client.once('ready', async () => {
  logger.info(`Logged in as ${client.user?.tag}`);
  logger.info(`Active in ${client.guilds.cache.size} guild(s)`);

  logger.info('Setting up Hub channel buttons...');
  userInteractionService.start(client);

  await new Promise(resolve => setTimeout(resolve, 2000));
  logger.info('Ready!');
});

process.on('SIGINT', () => {
  logger.info('Shutting down...');
  userInteractionService.stop();
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Shutting down...');
  userInteractionService.stop();
  client.destroy();
  process.exit(0);
});

client.on(interactionCreateEvent.name, interactionCreateEvent.execute);

connectDB().catch((error) => {
  logger.error('Failed to connect to MongoDB:', error);
});

client.login(process.env.DISCORD_TOKEN).catch((error) => {
  logger.error('Failed to login:', error);
  process.exit(1);
});
