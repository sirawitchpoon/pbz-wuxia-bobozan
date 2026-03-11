import {
  Client,
  TextChannel,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { logger } from '../utils/logger';
import * as LadderService from './LadderService';
import { getRankForRating } from '../models/LadderProfile';
import { RANK_TIERS } from '../models/LadderProfile';
import { setLeaderboardMessageId } from './ChannelMessageStore';

/**
 * Manages persistent messages:
 * - Channel 1 (Hub): Open Challenge + Target Challenge only
 * - Channel 4: Leaderboard (updated on match end)
 * - Channel 5: Ranks (static)
 * - Channel 6: Rules (static)
 * - Channel 7: Honor (static)
 * - Channel 8: My Stats button
 */
export class UserInteractionService {
  private client: Client | null = null;
  private refreshInterval: NodeJS.Timeout | null = null;

  start(client: Client): void {
    this.client = client;
    this.setupAllChannels().catch(err => logger.error('Channel setup failed:', err));
    this.refreshInterval = setInterval(() => {
      this.setupHub().catch(() => {});
    }, 3 * 60 * 1000);
  }

  stop(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  private async setupAllChannels(): Promise<void> {
    if (!this.client) return;
    await this.setupHub();
    await this.setupLeaderboardChannel();
    await this.setupRanksChannel();
    await this.setupRulesChannel();
    await this.setupHonorChannel();
    await this.setupStatsChannel();
  }

  private async setupHub(): Promise<void> {
    const channelId = process.env.BOBOZAN_HUB_CHANNEL_ID;
    if (!channelId || !this.client) return;

    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !(channel instanceof TextChannel)) return;

    const messages = await channel.messages.fetch({ limit: 10 });
    const existing = messages.find(
      m => m.author.id === this.client!.user?.id && m.embeds.length > 0 && m.embeds[0].title?.includes('Wuxia BoboZan'),
    );

    const embed = this.buildHubEmbed();
    const components = this.buildHubButtons();

    if (existing) {
      await existing.edit({ embeds: [embed], components }).catch(() => {});
      return;
    }
    await channel.send({ embeds: [embed], components });
  }

  private buildHubEmbed(): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('⚔️ Wuxia BoboZan — Arena')
      .setDescription(
        'Turn-based psychological duel game.\nInspired by Chinese martial arts — real-time 1v1.\n\n' +
        '**How to start a duel:**\n' +
        '🟠 **Open Challenge** — Post a challenge; anyone can accept.\n' +
        '🔴 **Target Challenge** — Choose a specific opponent.\n\n' +
        '**Info:**\n' +
        '📊 My Stats | 🏆 Leaderboard | 🎖️ Honor | ⚔️ Ranks | 📖 Rules',
      )
      .setColor(0xd4a574)
      .setFooter({ text: 'Wuxia BoboZan · Turn-based 1v1 duel' });
  }

  private buildHubButtons(): ActionRowBuilder<ButtonBuilder>[] {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('bobozan_open_challenge')
          .setLabel('⚔️ Open Challenge')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('bobozan_target_challenge')
          .setLabel('🎯 Target Challenge')
          .setStyle(ButtonStyle.Danger),
      ),
    ];
  }

  private async setupLeaderboardChannel(): Promise<void> {
    const channelId = process.env.BOBOZAN_LEADERBOARD_CHANNEL_ID;
    if (!channelId || !this.client) return;

    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !(channel instanceof TextChannel)) return;

    const messages = await channel.messages.fetch({ limit: 5 });
    const existing = messages.find(m => m.author.id === this.client!.user?.id);

    const embed = await this.buildLeaderboardEmbed();
    if (existing) {
      await existing.edit({ embeds: [embed] }).catch(() => {});
      setLeaderboardMessageId(existing.id);
      return;
    }
    const msg = await channel.send({ embeds: [embed] });
    setLeaderboardMessageId(msg.id);
  }

  private async buildLeaderboardEmbed(): Promise<EmbedBuilder> {
    const top = await LadderService.getLeaderboard(10);
    const medals = ['🥇', '🥈', '🥉'];
    const lines = top.length === 0
      ? ['No matches yet.']
      : top.map((p, i) => {
          const rank = getRankForRating(p.rating);
          const prefix = i < 3 ? medals[i] : `**${i + 1}.**`;
          const winrate = p.gamesPlayed > 0 ? ((p.wins / p.gamesPlayed) * 100).toFixed(0) : '0';
          return `${prefix} ${rank.icon} **${p.displayName}** — ${p.rating} pts | ${p.wins}W/${p.losses}L (${winrate}%)`;
        });

    return new EmbedBuilder()
      .setTitle('⚔️ Wuxia BoboZan — Leaderboard')
      .setDescription(lines.join('\n'))
      .setColor(0xd4a574)
      .setFooter({ text: `${top.length} players` });
  }

  /** Call after a match ends to refresh the leaderboard message in channel 4. */
  static async updateLeaderboardInChannel(client: Client): Promise<void> {
    const channelId = process.env.BOBOZAN_LEADERBOARD_CHANNEL_ID;
    const messageId = (await import('./ChannelMessageStore')).getLeaderboardMessageId();
    if (!channelId || !messageId) return;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !(channel instanceof TextChannel)) return;

    const msg = await channel.messages.fetch(messageId).catch(() => null);
    if (!msg) return;

    const top = await LadderService.getLeaderboard(10);
    const medals = ['🥇', '🥈', '🥉'];
    const lines = top.length === 0
      ? ['No matches yet.']
      : top.map((p, i) => {
          const rank = getRankForRating(p.rating);
          const prefix = i < 3 ? medals[i] : `**${i + 1}.**`;
          const winrate = p.gamesPlayed > 0 ? ((p.wins / p.gamesPlayed) * 100).toFixed(0) : '0';
          return `${prefix} ${rank.icon} **${p.displayName}** — ${p.rating} pts | ${p.wins}W/${p.losses}L (${winrate}%)`;
        });

    const embed = new EmbedBuilder()
      .setTitle('⚔️ Wuxia BoboZan — Leaderboard')
      .setDescription(lines.join('\n'))
      .setColor(0xd4a574)
      .setFooter({ text: `${top.length} players` });

    await msg.edit({ embeds: [embed] }).catch(() => {});
  }

  private async setupRanksChannel(): Promise<void> {
    const channelId = process.env.BOBOZAN_RANKS_CHANNEL_ID;
    if (!channelId || !this.client) return;

    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !(channel instanceof TextChannel)) return;

    const lines = RANK_TIERS.map(t => `${t.icon} **${t.titleEn}** — ${t.minRating}+ rating`);
    const embed = new EmbedBuilder()
      .setTitle('⚔️ Wuxia BoboZan — Rank Tiers')
      .setDescription(lines.join('\n'))
      .setColor(0xd4a574)
      .setFooter({ text: 'Default starting rating: 1200 (Martial Artist)' });

    const messages = await channel.messages.fetch({ limit: 3 });
    const existing = messages.find(m => m.author.id === this.client!.user?.id);
    if (existing) await existing.edit({ embeds: [embed] }).catch(() => {});
    else await channel.send({ embeds: [embed] });
  }

  private async setupRulesChannel(): Promise<void> {
    const channelId = process.env.BOBOZAN_RULES_CHANNEL_ID;
    if (!channelId || !this.client) return;

    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !(channel instanceof TextChannel)) return;

    const roundSec = process.env.ROUND_TIMEOUT_SECONDS || '30';
    const bothIdleSec = process.env.ROUND_TIMEOUT_BOTH_IDLE_SECONDS || '60';

    const embed = new EmbedBuilder()
      .setTitle('⚔️ Wuxia BoboZan — Rules')
      .setColor(0xd4a574)
      .setDescription('1v1 turn-based duel inspired by Chinese martial arts.')
      .addFields(
        { name: '🎮 Basics', value: 'Two players choose actions each round. Your opponent cannot see your choice. HP is class-based (3–7). HP 0 = loss; both 0 = draw.' },
        { name: '🔵 Charge', value: '+1 energy. Engineer: 50% chance +1 part.' },
        { name: '🔴 Attack', value: 'Costs 1 energy, 1 damage. Blocked if opponent Defends. Both attack = clash: 1 damage each, energy → 0.' },
        { name: '⚪ Defend', value: 'Blocks attack. May trigger class passives.' },
        { name: '🟢 Ultimate', value: 'Class-specific, costs energy.' },
        {
          name: '⏱️ Time',
          value: `${roundSec} seconds per round to choose. No choice = loss. If **both** players don\'t choose in time, you get ${bothIdleSec} extra seconds before the round is declared a draw.`,
        },
      );

    const messages = await channel.messages.fetch({ limit: 3 });
    const existing = messages.find(m => m.author.id === this.client!.user?.id);
    if (existing) await existing.edit({ embeds: [embed] }).catch(() => {});
    else await channel.send({ embeds: [embed] });
  }

  private async setupHonorChannel(): Promise<void> {
    const channelId = process.env.BOBOZAN_HONOR_CHANNEL_ID;
    if (!channelId || !this.client) return;

    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !(channel instanceof TextChannel)) return;

    const embed = new EmbedBuilder()
      .setTitle('🏅 Wuxia BoboZan — Honor Points')
      .setColor(0xd4a574)
      .setDescription('Honor is added to the central Honor Points system after each match.')
      .addFields({
        name: '📋 Scoring',
        value: [
          '**Base:** +10 | **Win:** +30 | **Draw:** +15 | **Loss:** +5',
          '**Damage:** +4 per hit | **Ultimate:** +5 per use | **Defend:** +3 per block',
          '**Perfect win:** +20 | **Comeback:** +15 | **Fast win:** +10 | **Long battle:** +8',
          '**Forfeit:** -10 | **Timeout:** -5',
        ].join('\n'),
      });

    const messages = await channel.messages.fetch({ limit: 3 });
    const existing = messages.find(m => m.author.id === this.client!.user?.id);
    if (existing) await existing.edit({ embeds: [embed] }).catch(() => {});
    else await channel.send({ embeds: [embed] });
  }

  private async setupStatsChannel(): Promise<void> {
    const channelId = process.env.BOBOZAN_STATS_CHANNEL_ID;
    if (!channelId || !this.client) return;

    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !(channel instanceof TextChannel)) return;

    const embed = new EmbedBuilder()
      .setTitle('📊 My Stats')
      .setDescription('Click the button below to see your Wuxia BoboZan stats (only you will see the result).')
      .setColor(0xd4a574);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('bobozan_my_profile')
        .setLabel('📊 My Stats')
        .setStyle(ButtonStyle.Secondary),
    );

    const messages = await channel.messages.fetch({ limit: 3 });
    const existing = messages.find(m => m.author.id === this.client!.user?.id && m.components.length > 0);
    if (existing) await existing.edit({ embeds: [embed], components: [row] }).catch(() => {});
    else await channel.send({ embeds: [embed], components: [row] });
  }
}
