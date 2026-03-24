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
import {
  buildGuidebookCategoryNavComponents,
} from '../game/GuidebookView';

/**
 * Manages persistent messages:
 * - Channel 1 (Hub): Open Challenge + Target Challenge only
 * - Channel 4: Leaderboard (updated on match end)
 * - Channel 5: Ranks (static)
 * - Channel 6: Rules (static)
 * - Channel 7: Honor (static)
 * - Channel 8: My Stats button
 * - Channel 9: Guidebook (class details) with Prev/Next buttons
 * - Channel 9: Guidebook (class details) with per-class buttons (ephemeral on click)
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
    await this.setupGuidebookChannel();
    await this.setupHistoryChannel();
    await this.setupShadowDuelAdminChannel();
  }

  private async setupHub(): Promise<void> {
    const channelId = process.env.SHADOW_DUEL_HUB_CHANNEL;
    if (!channelId || !this.client) return;

    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !(channel instanceof TextChannel)) return;

    const messages = await channel.messages.fetch({ limit: 10 });
    const existing = messages.find(
      m =>
        m.author.id === this.client!.user?.id &&
        m.embeds.length > 0 &&
        (m.embeds[0].title?.includes('Hub') || m.embeds[0].title?.includes('Arena')),
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
      .setTitle('⚔️ Shadow Duel — Hub')
      .setDescription(
        'Turn-based psychological duel game.\nInspired by Chinese martial arts — real-time 1v1.\n\n' +
        '**How to start a duel:**\n' +
        '🟠 **Open Challenge** — Post a challenge; anyone can accept.\n' +
        '🔴 **Target Challenge** — Choose a specific opponent.\n\n' +
        'Use the Guidebook in-game to access class, combat, reward, rank, and rules details.',
      )
      .setColor(0xd4a574)
      .setFooter({ text: 'Shadow Duel · Turn-based 1v1 duel' });
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
        new ButtonBuilder()
          .setCustomId('bobozan_my_profile')
          .setLabel('📊 My Stats')
          .setStyle(ButtonStyle.Secondary),
      ),
    ];
  }

  private async setupLeaderboardChannel(): Promise<void> {
    const channelId = process.env.SHADOW_DUEL_LEADERBOARD_CHANNEL_ID;
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
      .setTitle('⚔️ Shadow Duel — Leaderboard')
      .setDescription(lines.join('\n'))
      .setColor(0xd4a574)
      .setFooter({ text: `${top.length} players` });
  }

  /** Call after a match ends to refresh the leaderboard message in channel 4. */
  static async updateLeaderboardInChannel(client: Client): Promise<void> {
    const channelId = process.env.SHADOW_DUEL_LEADERBOARD_CHANNEL_ID;
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
      .setTitle('⚔️ Shadow Duel — Leaderboard')
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
      .setTitle('⚔️ Shadow Duel — Rank Tiers')
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

    const { buildShadowDuelRulesEmbed } = await import('../game/buildShadowDuelRulesEmbed');
    const embed = buildShadowDuelRulesEmbed();

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
      .setTitle('🏅 Shadow Duel — Honor Points')
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
      .setDescription('Click the button below to see your Shadow Duel stats (only you will see the result).')
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

  private async setupGuidebookChannel(): Promise<void> {
    const channelId = process.env.SHADOW_DUEL_GUIDEBOOK_CHANNEL_ID;
    if (!channelId || !this.client) return;

    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !(channel instanceof TextChannel)) return;

    const embed = new EmbedBuilder()
      .setTitle('📖 Guidebook')
      .setDescription(
        'Select a category below. **How to play**, class details, combat details, rewards, ranks, and rules open as **ephemeral** messages (only you can see them).',
      )
      .setColor(0xd4a574)
      .setFooter({ text: 'Iron Monk / The Sword / The Blade · Break included' });

    // Persistent landing page: categories only.
    const components = buildGuidebookCategoryNavComponents();

    const messages = await channel.messages.fetch({ limit: 5 });
    const existing = messages.find(
      m => m.author.id === this.client!.user?.id && m.embeds.length > 0 && m.embeds[0].title?.includes('Guidebook'),
    );

    if (existing) {
      await existing.edit({ embeds: [embed], components }).catch(() => {});
      return;
    }

    await channel.send({ embeds: [embed], components }).catch(() => {});
  }

  private async setupHistoryChannel(): Promise<void> {
    const channelId = process.env.SHADOW_DUEL_HISTORY_CHANNEL_ID;
    if (!channelId || !this.client) return;

    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !(channel instanceof TextChannel)) return;

    const embed = new EmbedBuilder()
      .setTitle('🗂️ Combat Log History')
      .setDescription('Each Match end will include a `📜 View Combat Log` button. Click to view it as an ephemeral message (only you can see it) — the full data is preserved even if temp duel channels are deleted.')
      .setColor(0x2c3e50);

    const messages = await channel.messages.fetch({ limit: 5 });
    const existing = messages.find(m => m.author.id === this.client!.user?.id && m.embeds.length > 0 && m.embeds[0].title?.includes('Combat Log History'));
    if (existing) {
      await existing.edit({ embeds: [embed], components: [] }).catch(() => {});
      return;
    }

    await channel.send({ embeds: [embed], components: [] }).catch(() => {});
  }

  private async setupShadowDuelAdminChannel(): Promise<void> {
    const channelId = process.env.SHADOW_DUEL_ADMIN_CHANNEL_ID;
    if (!channelId || !this.client) return;

    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !(channel instanceof TextChannel)) return;

    const embed = new EmbedBuilder()
      .setTitle('🛡️ Shadow Duel Admin')
      .setDescription(
        'Admins can export Shadow Duel history, reset ALL Shadow Duel data (history + leaderboard), and cancel stuck challenges.\n\n' +
          'Buttons below are interactive (only admins/with Manage Channels will work).'
      )
      .setColor(0x95a5a6);

    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('bobozan_shadowduel_admin_export_history')
        .setLabel('📤 Export all history')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('bobozan_shadowduel_admin_reset_player')
        .setLabel('🧼 Reset ALL Shadow Duel data')
        .setStyle(ButtonStyle.Secondary),
    );

    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('bobozan_shadowduel_admin_cancel_duel')
        .setLabel('⛔ Cancel duel (by ID)')
        .setStyle(ButtonStyle.Danger),
    );

    const messages = await channel.messages.fetch({ limit: 5 });
    const existing = messages.find(
      (m) =>
        m.author.id === this.client!.user?.id &&
        m.embeds.length > 0 &&
        m.embeds[0].title?.includes('Shadow Duel Admin'),
    );

    if (existing) {
      await existing.edit({ embeds: [embed], components: [row1, row2] }).catch(() => {});
      return;
    }

    await channel.send({ embeds: [embed], components: [row1, row2] }).catch(() => {});
  }
}
