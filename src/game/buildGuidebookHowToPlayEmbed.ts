import { EmbedBuilder } from 'discord.js';

function channelMention(id: string | undefined): string {
  const v = id?.trim();
  if (!v || !/^\d{17,19}$/.test(v)) {
    return '*#channel-not-configured*';
  }
  return `<#${v}>`;
}

/**
 * Ephemeral "How to play" guide for Shadow Duel. Channel mentions come from the same env keys as the bot.
 */
export function buildGuidebookHowToPlayEmbed(): EmbedBuilder {
  const hub = channelMention(process.env.SHADOW_DUEL_HUB_CHANNEL);
  const challenge = channelMention(process.env.SHADOW_DUEL_CHALLENGE_CHANNEL_ID);
  const history = channelMention(process.env.SHADOW_DUEL_HISTORY_CHANNEL_ID);
  const guidebook = channelMention(process.env.SHADOW_DUEL_GUIDEBOOK_CHANNEL_ID);
  const leaderboard = channelMention(process.env.SHADOW_DUEL_LEADERBOARD_CHANNEL_ID);
  const forums = channelMention(process.env.SHADOW_DUEL_FORUMS_CHANNEL_ID);

  const description = [
    '**🕹️ QUICK START GUIDE**',
    `**Initiate:** Go to ${hub} and click **Open Challenge** or **Target Challenge**.`,
    `**Accept:** Pending matches appear in ${challenge}. Once accepted, the bot creates **temporary duel channels** (public recap + private pick channels).`,
    '**Fight:** Choose your moves carefully! The battle is **turn-based**, round-by-round.',
    `**Win:** Results are posted publicly in ${history}.`,
    '',
    '**🛡️ CLASSES & COMBAT**',
    `Choose your path in the Guidebook (${guidebook}): **🧘 Iron Monk** · **⚔️ The Sword** · **🗡️ The Blade**`,
    '**Key resource:** Manage your **Killing Intent** (⚡) to unleash powerful moves.',
    '**Break:** Costs **2** Killing Intent, deals **2** damage, and **ignores Defend**.',
    '',
    '**💎 HONOR POINTS & REWARDS**',
    'Participating in duels can earn **Honor Points** when the server has the Honor API enabled.',
    '**Victories** grant the highest rewards. **Draws** and **losses** can still contribute to your progress.',
    `Check your standing on the leaderboard in ${leaderboard}.`,
    '',
    '**🛠️ SUPPORT & BUGS**',
    `If you run into issues or have suggestions: post in ${forums}.`,
    '',
    '**💡 Tip:** Use the **category buttons** on the main Guidebook message for **ephemeral** help on specific mechanics.',
  ].join('\n');

  return new EmbedBuilder()
    .setTitle('📖 Shadow Duel — How to play')
    .setDescription(description)
    .setColor(0xd4a574);
}
