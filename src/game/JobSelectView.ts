import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  EmbedBuilder,
} from 'discord.js';
import { Job, JOB_STATS, JOB_EMOJI, JOB_DISPLAY_EN } from '../models/enums';

const DUEL_V3_JOBS: Job[] = [Job.IronMonk, Job.Swordsman, Job.Bladesman];

export function buildJobSelectEmbed(playerAName: string, playerBName: string): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('⚔️ Choose Your Martial Class')
    .setDescription(
      `🟥 **${playerAName}**  ╳  🟦 **${playerBName}**\n\n` +
      `> Select your class from the dropdown below.\n` +
      `> Your opponent **cannot see** your choice until the duel begins.`,
    )
    .setColor(0x5865f2)
    .setFooter({ text: '⏱️ 60s to choose · Class cannot be changed after selection' });

  for (const job of DUEL_V3_JOBS) {
    const stats = JOB_STATS[job];
    const display = JOB_DISPLAY_EN[job];
    const emoji = JOB_EMOJI[job];

    // Mini HP bar for class card (scale to 5 blocks)
    const hpBlocks = Math.round((stats.hp / 7) * 5);
    const hpBar = '█'.repeat(hpBlocks) + '░'.repeat(5 - hpBlocks);

    embed.addFields({
      name: `${emoji} ${display.name}`,
      value: [
        `❤️ \`${hpBar}\` **${stats.hp} HP**  ⚡ Start KI: **${stats.energy}**  · Ult cost: **${stats.ultCost}**`,
        `◆ **Passive:** ${display.passiveDesc}`,
        `◆ **Ultimate:** ${display.ultDesc}`,
      ].join('\n'),
      inline: false,
    });
  }

  return embed;
}

export function buildJobSelectMenu(): ActionRowBuilder<StringSelectMenuBuilder> {
  const options = DUEL_V3_JOBS.map(job => {
    const stats = JOB_STATS[job];
    const display = JOB_DISPLAY_EN[job];
    const emoji = JOB_EMOJI[job];
    return new StringSelectMenuOptionBuilder()
      .setLabel(`${display.name} — HP:${stats.hp} Killing Intent:${stats.energy}`)
      .setDescription(`Passive + Ultimate (${stats.ultCost} Killing Intent)`)
      .setValue(job)
      .setEmoji(emoji);
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId('bobozan_job_select')
    .setPlaceholder('Choose your class...')
    .addOptions(options);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}
