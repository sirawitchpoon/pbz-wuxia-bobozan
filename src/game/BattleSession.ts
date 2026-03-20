import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Message,
  TextChannel,
  ButtonInteraction,
  Client,
} from 'discord.js';
import { Job, Action, JOB_STATS, JOB_EMOJI, JOB_DISPLAY_EN } from '../models/enums';
import { Player } from '../models/Player';
import { BattleResult } from '../models/BattleResult';
import { resolveRound, RoundLog } from '../engine/resolveRound';
import * as SessionManager from './SessionManager';
import * as SettlementService from '../services/SettlementService';
import { formatHonorBreakdown } from '../services/HonorCalculator';
import { logger } from '../utils/logger';

const ROUND_TIMEOUT = parseInt(process.env.ROUND_TIMEOUT_SECONDS ?? '20', 10) * 1000;
const ROUND_TIMEOUT_BOTH_IDLE_MS =
  parseInt(process.env.ROUND_TIMEOUT_BOTH_IDLE_SECONDS ?? '60', 10) * 1000;

export class BattleSession {
  public readonly playerAId: string;
  public readonly playerBId: string;
  private playerAName: string;
  private playerBName: string;
  private readonly client: Client;

  private playerA: Player | null = null;
  private playerB: Player | null = null;

  private round: number = 0;
  // Layout:
  // - public channel: combat log
  // - private A/B channels: timeline + control embeds
  private timerMessage: Message | null = null;
  private logMessage: Message | null = null;
  private battleMessage: Message | null = null;
  // NOTE: `channel` is now used as the public channel for combat log.
  private channel: TextChannel | null = null;

  private privateChannelA: TextChannel | null = null;
  private privateChannelB: TextChannel | null = null;

  private timerMessageA: Message | null = null;
  private timerMessageB: Message | null = null;
  /** Per-player recap of the last resolved round (above battle controls). */
  private roundSummaryMessageA: Message | null = null;
  private roundSummaryMessageB: Message | null = null;
  private battleMessageA: Message | null = null;
  private battleMessageB: Message | null = null;

  // Sequential selection turn controller:
  // - null means "first click defines the acting player"
  // - otherwise only that user can select actions for the current turn
  private selectionTurnUserId: string | null = null;
  private roundTimer: NodeJS.Timeout | null = null;
  private roundTick: NodeJS.Timeout | null = null;
  private roundEndsAtMs: number | null = null;
  private roundTotalMs: number = ROUND_TIMEOUT;
  private roundIdleExtended: boolean = false;
  private settled: boolean = false;
  private lastRoundLog: RoundLog | null = null;
  private combatLogLines: string[] = [];

  /** Duel started time (ms) — set in `startBattle()`. */
  private battleStartedAtMs: number | null = null;

  /** Persisted duel card (dashboard / delete cleanup) */
  private duelCardId: string | null = null;
  private duelDisplayId: string | null = null;
  private duelGuildId: string | null = null;

  constructor(
    client: Client,
    playerAId: string,
    playerAName: string,
    playerBId: string,
    playerBName: string,
  ) {
    this.client = client;
    this.playerAId = playerAId;
    this.playerAName = playerAName;
    this.playerBId = playerBId;
    this.playerBName = playerBName;
  }

  attachChannels(publicChannel: TextChannel, privateAChannel: TextChannel, privateBChannel: TextChannel): void {
    this.channel = publicChannel;
    this.privateChannelA = privateAChannel;
    this.privateChannelB = privateBChannel;
    this.duelGuildId = publicChannel.guildId ?? this.duelGuildId;

    // Reset message refs for safety (in case a session object is reused).
    this.logMessage = null;
    this.timerMessage = null;
    this.battleMessage = null;
    this.timerMessageA = null;
    this.timerMessageB = null;
    this.roundSummaryMessageA = null;
    this.roundSummaryMessageB = null;
    this.battleMessageA = null;
    this.battleMessageB = null;
    this.selectionTurnUserId = null;
    this.battleStartedAtMs = null;
  }

  setDuelCardMeta(cardId: string, displayId: string, guildId: string): void {
    this.duelCardId = cardId;
    this.duelDisplayId = displayId;
    this.duelGuildId = guildId;
  }

  // ── Job Selection ───────────────────────────────────────────────────

  setJob(userId: string, job: Job): void {
    if (userId === this.playerAId) {
      this.playerA = new Player(this.playerAId, this.playerAName, job);
    } else if (userId === this.playerBId) {
      this.playerB = new Player(this.playerBId, this.playerBName, job);
    }
  }

  get bothJobsSelected(): boolean {
    return this.playerA !== null && this.playerB !== null;
  }

  getPlayerJob(userId: string): Job | null {
    if (userId === this.playerAId) return this.playerA?.job ?? null;
    if (userId === this.playerBId) return this.playerB?.job ?? null;
    return null;
  }

  // ── Battle Lifecycle ────────────────────────────────────────────────

  async startBattle(): Promise<void> {
    if (!this.playerA || !this.playerB) return;

    this.round = 1;
    this.roundIdleExtended = false;
    this.selectionTurnUserId = null;
    this.lastRoundLog = null;
    this.combatLogLines = [];
    this.battleStartedAtMs = Date.now();
    this.appendCombatLogLine(`⚔️ Duel started: **${this.playerAName}** vs **${this.playerBName}**`);
    this.appendCombatLogLine(`— Round 1 —`);

    if (!this.channel || !this.privateChannelA || !this.privateChannelB) {
      logger.error('BattleSession.startBattle called without attaching channels');
      return;
    }

    await this.ensureLayoutMessages();

    await Promise.all([
      this.updateTimerEmbed(false, false).catch(() => {}),
      this.updateLogEmbed().catch(() => {}),
      this.updateBattleEmbed(),
      this.updatePrivateRoundSummaries().catch(() => {}),
    ]);
    this.startRoundTimer();
  }

  async handleAction(interaction: ButtonInteraction, action: Action): Promise<void> {
    if (this.settled) return;

    const userId = interaction.user.id;
    const player = this.getPlayer(userId);
    if (!player || player.actionLocked) {
      await interaction.reply({ content: '❌ You already locked in your action.', ephemeral: true });
      return;
    }

    // Validate action
    const validation = this.validateAction(player, action);
    if (validation) {
      await interaction.reply({ content: validation, ephemeral: true });
      return;
    }

    // Acknowledge immediately so Discord doesn't show "interaction failed".
    interaction.deferUpdate().catch(() => {});

    player.action = action;
    player.actionLocked = true;

    await this.updateBattleEmbed();

    // If both locked in, resolve
    if (this.playerA!.actionLocked && this.playerB!.actionLocked) {
      this.clearRoundTimer();
      await this.resolveCurrentRound();
    }
  }

  async forfeit(userId: string): Promise<boolean> {
    if (this.settled) return false;

    const player = this.getPlayer(userId);
    if (!player) return false;

    player.hp = 0;
    this.settled = true;
    this.clearRoundTimer();

    const result = this.buildBattleResult(false, true);
    await this.settleMatch(result);
    return true;
  }

  getPublicChannelId(): string | null {
    return this.channel?.id ?? null;
  }

  /** Admin action: end the match immediately as a draw. */
  async adminEndAsDraw(): Promise<void> {
    if (this.settled || !this.playerA || !this.playerB) return;

    this.playerA.hp = 0;
    this.playerB.hp = 0;
    this.settled = true;
    this.clearRoundTimer();

    const result = this.buildBattleResult(false, false);
    await this.settleMatch(result);
  }

  // ── Round Resolution ────────────────────────────────────────────────

  private async resolveCurrentRound(): Promise<void> {
    if (!this.playerA || !this.playerB) return;

    const roundLog = resolveRound(this.playerA, this.playerB, this.round);
    this.lastRoundLog = roundLog;
    this.appendCombatLogLine(`📜 Round ${roundLog.round} — Combat log`);
    if (roundLog.entries.length > 0) {
      for (const e of roundLog.entries) this.appendCombatLogLine(e);
    } else {
      this.appendCombatLogLine('*(no events)*');
    }
    await this.updateLogEmbed().catch(() => {});
    await this.updatePrivateRoundSummaries().catch(() => {});

    if (roundLog.p1Dead || roundLog.p2Dead) {
      this.settled = true;
      const result = this.buildBattleResult(false, false);
      await this.settleMatch(result);
      return;
    }

    this.round++;
    this.roundIdleExtended = false;
    // Next round: allow both players to choose again; first valid click defines the acting player.
    this.selectionTurnUserId = null;
    this.appendCombatLogLine(`— Round ${this.round} —`);
    await Promise.all([
      this.updateLogEmbed().catch(() => {}),
      this.updateTimerEmbed(false, false).catch(() => {}),
      this.updateBattleEmbed(),
    ]);
    this.startRoundTimer();
  }

  private async settleMatch(result: BattleResult): Promise<void> {
    try {
      // Ensure match-ended line is included in the combatLog snapshot
      // that we pass to logger + match history.
      const isDraw = result.isDraw;
      const winnerName = isDraw ? null : (result.winnerId === result.playerAId ? this.playerAName : this.playerBName);
      const loserName = isDraw ? null : (result.winnerId === result.playerAId ? this.playerBName : this.playerAName);
      if (winnerName) {
        this.appendCombatLogLine(
          `🏁 Match ended — **${winnerName}** wins over **${loserName}** (${result.totalRounds} rounds).`,
        );
      } else if (isDraw) {
        this.appendCombatLogLine(`🏁 Match ended — Draw (${result.totalRounds} rounds).`);
      }
      // Update the snapshot stored in `result` so downstream logger sees full combat log.
      result.combatLogLines = [...this.combatLogLines];

      const settlement = await SettlementService.settle(result);
      const matchHistoryId = settlement.matchHistoryId ?? null;

      // Build final result embed (shown to both players in their private channels).
      if (this.playerA && this.playerB) {
        const isDraw = result.isDraw;
        const winnerName = isDraw ? null : (result.winnerId === result.playerAId ? this.playerAName : this.playerBName);
        const loserName = isDraw ? null : (result.winnerId === result.playerAId ? this.playerBName : this.playerAName);

        const finalColor = isDraw ? 0x95a5a6 : 0xf1c40f;
        const finalTitle = isDraw
          ? `⚔️ Draw — Round ${this.round}`
          : `🏆 ${winnerName} wins! — Round ${this.round}`;

        const pA = this.playerA;
        const pB = this.playerB;
        const jobA = JOB_DISPLAY_EN[pA.job].name;
        const jobB = JOB_DISPLAY_EN[pB.job].name;

        const finalDesc = isDraw
          ? `Both warriors were eliminated simultaneously.\n\n🟥 **${this.playerAName}** ${JOB_EMOJI[pA.job]} ${jobA}  ╳  🟦 **${this.playerBName}** ${JOB_EMOJI[pB.job]} ${jobB}`
          : `🟥 **${this.playerAName}** ${JOB_EMOJI[pA.job]} ${jobA}  ╳  🟦 **${this.playerBName}** ${JOB_EMOJI[pB.job]} ${jobB}\n\n> 🏆 **${winnerName}** defeated **${loserName}** in ${result.totalRounds} round${result.totalRounds !== 1 ? 's' : ''}`;

        const embed = new EmbedBuilder()
          .setTitle(finalTitle)
          .setDescription(finalDesc)
          .setColor(finalColor);

        // Final HP status
        embed.addFields(
          {
            name: `🟥 ${this.playerAName}`,
            value: this.renderPlayerStatus(pA, null),
            inline: true,
          },
          { name: '\u200b', value: '\u200b', inline: true },
          {
            name: `🟦 ${this.playerBName}`,
            value: this.renderPlayerStatus(pB, null),
            inline: true,
          },
        );

        // Honor fields
        const rA = settlement.ratingA;
        const rB = settlement.ratingB;

        embed.addFields(
          {
            name: `🏅 Honor — ${this.playerAName}`,
            value: formatHonorBreakdown(settlement.honorA).join('\n'),
            inline: true,
          },
          {
            name: `🏅 Honor — ${this.playerBName}`,
            value: formatHonorBreakdown(settlement.honorB).join('\n'),
            inline: true,
          },
        );

        // Rating fields (with rank change)
        const fmtRating = (r: typeof rA, name: string) => {
          const arrow = r.delta >= 0 ? '📈' : '📉';
          const sign = r.delta >= 0 ? '+' : '';
          const rankPart = r.rankChanged ? `\n🎖️ Rank → **${r.newRank}**` : '';
          return `${arrow} ${r.oldRating} → **${r.newRating}** (${sign}${r.delta})${rankPart}`;
        };

        embed.addFields(
          {
            name: `📊 Rating — ${this.playerAName}`,
            value: fmtRating(rA, this.playerAName),
            inline: true,
          },
          {
            name: `📊 Rating — ${this.playerBName}`,
            value: fmtRating(rB, this.playerBName),
            inline: true,
          },
        );

        embed.setFooter({ text: 'Match complete · Stats updated' });
        await Promise.all([
          this.battleMessageA?.edit({ embeds: [embed], components: [] }).catch(() => {}),
          this.battleMessageB?.edit({ embeds: [embed], components: [] }).catch(() => {}),
          // Refresh public log (and remove any public action buttons after settlement).
          this.logMessage?.edit({ embeds: [this.buildLogEmbed()], components: [] }).catch(() => {}),
        ]);
      }

      // Post to public match history channel (channel 3)
      const historyChannelId = process.env.SHADOW_DUEL_HISTORY_CHANNEL_ID;
      if (historyChannelId && this.playerA && this.playerB) {
        const historyChannel = await this.client.channels.fetch(historyChannelId).catch(() => null);
        if (historyChannel && historyChannel.isTextBased() && 'send' in historyChannel) {
          const pA = this.playerA;
          const pB = this.playerB;
          const jobA = JOB_DISPLAY_EN[pA.job].name;
          const jobB = JOB_DISPLAY_EN[pB.job].name;

          const winnerName = result.isDraw ? null : (result.winnerId === result.playerAId ? this.playerAName : this.playerBName);
          const loserName = result.isDraw ? null : (result.winnerId === result.playerAId ? this.playerBName : this.playerAName);

          const reasonEmoji = result.isDraw ? '🟡' : result.endedByForfeit ? '🏳️' : result.endedByTimeout ? '⏳' : '⚔️';
          const endedReasonText = result.isDraw
            ? 'Draw'
            : result.endedByForfeit
              ? 'Forfeit'
              : result.endedByTimeout
                ? 'Timeout'
                : 'Elimination';

          const historyEmbed = new EmbedBuilder()
            .setTitle(`⚔️ Shadow Duel ${this.duelDisplayId ? `#${this.duelDisplayId}` : ''}`.trim())
            .setDescription(
              [
                `🟥 **${this.playerAName}** ${JOB_EMOJI[pA.job]} ${jobA}  ╳  🟦 **${this.playerBName}** ${JOB_EMOJI[pB.job]} ${jobB}`,
                '',
                result.isDraw
                  ? `Result: ${reasonEmoji} Draw — ${result.totalRounds} round${result.totalRounds !== 1 ? 's' : ''}`
                  : `Result: ${reasonEmoji} **${winnerName}** wins — ${result.totalRounds} round${result.totalRounds !== 1 ? 's' : ''} (${endedReasonText})`,
                result.battleDurationMs != null ? `⏱️ Duration: ~${Math.round(result.battleDurationMs / 1000)}s` : '',
              ].filter(Boolean).join('\n'),
            )
            .setColor(result.isDraw ? 0x95a5a6 : 0xf1c40f)
            .setTimestamp();

          const components =
            matchHistoryId
              ? [
                  new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder()
                      .setCustomId(`bobozan_view_combat_log:${matchHistoryId}`)
                      .setLabel('📜 View Combat Log')
                      .setStyle(ButtonStyle.Secondary),
                  ),
                ]
              : [];

          await (historyChannel as TextChannel).send({ embeds: [historyEmbed], components }).catch(() => {});
        }
      }

      // Refresh leaderboard message in channel 4
      const { UserInteractionService } = await import('../services/UserInteractionService');
      await UserInteractionService.updateLeaderboardInChannel(this.client).catch(() => {});
    } catch (err) {
      logger.error('Settlement failed:', err);
    } finally {
      SessionManager.removeSession(this);
      // Mark phase as finished (best-effort).
      await this.updateTimerEmbed(false, true).catch(() => {});
      await this.postAdminDeletePrompt().catch(() => {});
    }
  }

  // ── Timeout ─────────────────────────────────────────────────────────

  private startRoundTimer(): void {
    // V3: 20s action decision. Timeout = automatic loss.
    // Double timeout (both didn't lock) => 60s grace, then Draw.
    this.roundIdleExtended = false;
    this.roundTotalMs = ROUND_TIMEOUT;
    this.roundEndsAtMs = Date.now() + this.roundTotalMs;
    this.startRoundTick();

    this.roundTimer = setTimeout(async () => {
      if (this.settled || !this.playerA || !this.playerB) return;

      const aLocked = this.playerA.actionLocked;
      const bLocked = this.playerB.actionLocked;

      // Double timeout => grace window then Draw.
      if (!aLocked && !bLocked) {
        this.roundIdleExtended = true;
        this.roundTotalMs = ROUND_TIMEOUT_BOTH_IDLE_MS;
        this.clearRoundTimer();
        this.roundEndsAtMs = Date.now() + this.roundTotalMs;
        this.startRoundTick();
        await this.updateTimerEmbed(true, false).catch(() => {});

        this.roundTimer = setTimeout(async () => {
          if (this.settled || !this.playerA || !this.playerB) return;
          this.playerA.hp = 0;
          this.playerB.hp = 0;
          this.settled = true;
          const result = this.buildBattleResult(true, false);
          await this.settleMatch(result);
        }, ROUND_TIMEOUT_BOTH_IDLE_MS);
        return;
      }

      // Single timeout => idle player loses immediately.
      this.settled = true;
      if (!aLocked) {
        this.playerA.hp = 0;
      } else if (!bLocked) {
        this.playerB.hp = 0;
      }
      this.clearRoundTimer();
      const result = this.buildBattleResult(true, false);
      await this.settleMatch(result);
    }, ROUND_TIMEOUT);
  }

  private clearRoundTimer(): void {
    if (this.roundTimer) {
      clearTimeout(this.roundTimer);
      this.roundTimer = null;
    }
    if (this.roundTick) {
      clearInterval(this.roundTick);
      this.roundTick = null;
    }
    this.roundEndsAtMs = null;
  }

  // ── Validation ──────────────────────────────────────────────────────

  private validateAction(player: Player, action: Action): string | null {
    // V3 debuffs (active in the next round only)
    if (action === Action.Defend && player.cannotDefendNextRoundRoundsLeft > 0) {
      return '❌ Defend is disabled for next round.';
    }
    if (action === Action.Charge && player.cannotChargeNextRoundRoundsLeft > 0) {
      return '❌ Charge is disabled for next round.';
    }

    // V3 killing intent costs
    const isV3Class = player.job === Job.IronMonk || player.job === Job.Swordsman || player.job === Job.Bladesman;
    if (!isV3Class) {
      return '❌ This duel uses only the 3 V3 classes.';
    }

    const cost = (() => {
      switch (action) {
        case Action.Attack:
          return 1;
        case Action.Break:
          return 2;
        case Action.Ultimate:
          return 3;
        default:
          return 0;
      }
    })();

    if (player.energy < cost) {
      if (cost > 0) {
        return `❌ Not enough Killing Intent. ${this.actionToLabel(action)} requires ${cost} (you have ${player.energy}).`;
      }
      return null;
    }

    // Deduct at lock-in time; resolver will treat remaining values as current state.
    if (cost > 0) player.energy -= cost;

    if (action === Action.SetTrap) {
      return '❌ Set Trap is not available in V3.';
    }

    return null;
  }

  // ── Embed Rendering ─────────────────────────────────────────────────

  private buildTimerEmbed(extraTime: boolean, finished: boolean): EmbedBuilder {
    const roundSec = Math.round(ROUND_TIMEOUT / 1000);
    const extraSec = Math.round(ROUND_TIMEOUT_BOTH_IDLE_MS / 1000);

    if (finished) {
      return new EmbedBuilder()
        .setTitle('⏱️ Phase: Finished')
        .setDescription('The duel has ended.')
        .setColor(0x95a5a6);
    }

    const title = this.round > 0 ? `⏳ Timeline — Round ${this.round}` : '⏳ Timeline';

    const totalMs = this.roundTotalMs || ROUND_TIMEOUT;
    const endsAt = this.roundEndsAtMs;
    const remainingMs = endsAt ? Math.max(0, endsAt - Date.now()) : totalMs;
    const remainingSec = Math.ceil(remainingMs / 1000);

    const BAR = 18;
    const filled = totalMs > 0 ? Math.round((remainingMs / totalMs) * BAR) : 0;
    const bar = '█'.repeat(Math.max(0, Math.min(BAR, filled))) + '░'.repeat(Math.max(0, BAR - filled));

    const lines: string[] = [];
    lines.push(`\`${bar}\`  **${remainingSec}s**`);
    lines.push(`• Per round: **${roundSec}s** per action decision`);
    lines.push(`• Double timeout → grace, then Draw (**${extraSec}s** grace)`);
    if (extraTime) lines.push(`• Grace window active.`);

    return new EmbedBuilder().setTitle(title).setDescription(lines.join('\n')).setColor(0x3498db);
  }

  private buildLogEmbed(): EmbedBuilder {
    if (this.combatLogLines.length === 0) {
      return new EmbedBuilder()
        .setTitle('📜 Combat log')
        .setDescription('No combat events yet.')
        .setColor(0x2c3e50);
    }

    const logText = this.combatLogLines.join('\n');

    return new EmbedBuilder()
      .setTitle(`📜 Combat log`)
      .setDescription(logText.substring(0, 4096))
      .setColor(0x2c3e50);
  }

  /** Recap embed for private channels: last resolved round (same lines as public log for that round). */
  private buildPrivateLastRoundSummaryEmbed(): EmbedBuilder {
    const embed = new EmbedBuilder().setColor(0x34495e);
    if (!this.lastRoundLog) {
      return embed
        .setTitle('📜 Last round')
        .setDescription(
          '_No round resolved yet._ After each resolve, a short recap appears here (same as the public combat log for that round).',
        );
    }
    const lines = this.lastRoundLog.entries;
    const body = lines.length > 0 ? lines.join('\n') : '*(no events)*';
    const clipped = body.length > 4096 ? `${body.slice(0, 4050)}\n…` : body;
    return embed
      .setTitle(`📜 Round ${this.lastRoundLog.round} — recap`)
      .setDescription(clipped);
  }

  private async updatePrivateRoundSummaries(): Promise<void> {
    const embed = this.buildPrivateLastRoundSummaryEmbed();
    await Promise.all([
      this.roundSummaryMessageA?.edit({ embeds: [embed] }).catch(() => {}),
      this.roundSummaryMessageB?.edit({ embeds: [embed] }).catch(() => {}),
    ]);
  }

  private buildPrivateControlEmbed(viewerId: string): EmbedBuilder {
    const pA = this.playerA;
    const pB = this.playerB;
    if (!pA || !pB) {
      return new EmbedBuilder()
        .setTitle(`⚔️ Round ${this.round}`)
        .setDescription('Initializing duel...')
        .setColor(0x5865f2);
    }

    const viewerPlayer = viewerId === this.playerAId ? pA : pB;
    const opponentPlayer = viewerId === this.playerAId ? pB : pA;
    const viewerLocked = viewerPlayer.actionLocked;
    const opponentLocked = opponentPlayer.actionLocked;

    // Dynamic color: critical HP → red, normal → battle blue
    let color = 0x5865f2;
    if ((pA?.hp ?? 99) <= 1 || (pB?.hp ?? 99) <= 1) color = 0xe74c3c;

    const embed = new EmbedBuilder()
      .setTitle(`⚔️ Round ${this.round}`)
      .setColor(color);

    const jobA = JOB_DISPLAY_EN[pA.job].name;
    const jobB = JOB_DISPLAY_EN[pB.job].name;

    if (this.settled) {
      embed.setDescription(
        `🏁 Duel settled. Check the public combat log for full details.\n` +
          `🟥 **${this.playerAName}** ${JOB_EMOJI[pA.job]} ${jobA}  ╳  🟦 **${this.playerBName}** ${JOB_EMOJI[pB.job]} ${jobB}`,
      );
    } else {
      let statusLine: string;
      if (!viewerLocked && !opponentLocked) {
        statusLine = '⚔️ Both choosing — your opponent’s action is hidden.';
      } else if (viewerLocked) {
        statusLine = `✅ You locked in: **${this.actionToLabel(viewerPlayer.action)}** · Waiting for opponent...`;
      } else {
        statusLine = '⏳ Waiting — opponent locked in. Your opponent’s action is hidden until resolve.';
      }

      embed.setDescription(
        `🟥 **${this.playerAName}** ${JOB_EMOJI[pA.job]} ${jobA}  ╳  🟦 **${this.playerBName}** ${JOB_EMOJI[pB.job]} ${jobB}\n\n> ${statusLine}`,
      );

      // Extra hint: what *you* chose (shown only in your channel)
      if (viewerLocked) {
        embed.addFields({
          name: 'Your selection',
          value: viewerPlayer.action
            ? `You locked in **${this.actionToLabel(viewerPlayer.action)}**.`
            : `You locked in with **no action** for this round.`,
          inline: false,
        });
      }
    }

    embed.addFields(
      {
        name: `🟥 ${this.playerAName}`,
        value: this.renderPlayerStatus(pA, viewerId),
        inline: true,
      },
      { name: '\u200b', value: '\u200b', inline: true }, // spacer
      {
        name: `🟦 ${this.playerBName}`,
        value: this.renderPlayerStatus(pB, viewerId),
        inline: true,
      },
    );

    if (!this.settled) {
      const timeoutSec = Math.round(ROUND_TIMEOUT / 1000);
      embed.setFooter({ text: `⏱️ ${timeoutSec}s per round · Simultaneous lock-in` });
    }

    return embed;
  }

  private actionToLabel(action: Action | null): string {
    if (action === null) return 'No action';
    switch (action) {
      case Action.Charge:
        return 'Charge';
      case Action.Attack:
        return 'Attack';
      case Action.Defend:
        return 'Defend';
      case Action.Break:
        return 'Break';
      case Action.Ultimate:
        return 'Ultimate';
      case Action.SetTrap:
        return 'Set Trap';
      default:
        return String(action);
    }
  }

  private getOpponentId(userId: string): string {
    return userId === this.playerAId ? this.playerBId : this.playerAId;
  }

  private buildPrivateControlComponents(viewerId: string): ActionRowBuilder<ButtonBuilder>[] {
    if (this.settled) return [];
    const viewer = this.getPlayer(viewerId);
    if (!viewer) return [];

    // V3: simultaneous action selection. Each player can lock in independently.
    const canChooseMain = !viewer.actionLocked;

    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    if (canChooseMain) {
      rows.push(this.buildActionButtons());
    }

    // Allow forfeit at any time (doesn't affect selection state).
    const secondaryButtons: ButtonBuilder[] = [
      new ButtonBuilder().setCustomId('bobozan_forfeit').setLabel('🏳️ Forfeit').setStyle(ButtonStyle.Danger),
    ];

    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(secondaryButtons));
    return rows;
  }

  private renderPlayerStatus(player: Player, viewerId: string | null): string {
    const BAR = 8;
    // HP bar: proportional blocks
    const hpFilled = player.maxHp > 0 ? Math.round((player.hp / player.maxHp) * BAR) : 0;
    const hpBar = '█'.repeat(hpFilled) + '░'.repeat(BAR - hpFilled);
    const hpIcon = player.hp === 0 ? '💀' : player.hp <= Math.ceil(player.maxHp / 3) ? '🩸' : '❤️';

    // Energy bar: always 9 slots
    const energyFilled = Math.min(player.energy, 9);
    const energyBar = '█'.repeat(energyFilled) + '░'.repeat(Math.max(0, 9 - energyFilled));

    const lines = [
      `${hpIcon} \`${hpBar}\` **${player.hp}/${player.maxHp}**`,
      `⚡ \`${energyBar}\` **${player.energy}** Killing Intent`,
    ];

    if (player.job === Job.Bladesman) {
      lines.push(`🗡️ Blade Intent: **${player.bladeIntent}/3**`);
    }

    if (player.job === Job.Swordsman) {
      lines.push(`👁️ Keen Eye: ${player.keenEyeActive ? '✅ Active' : '—'}`);
    }

    if (player.cannotDefendNextRoundRoundsLeft > 0) {
      lines.push('⛔ Cannot Defend next round');
    }
    if (player.cannotChargeNextRoundRoundsLeft > 0) {
      lines.push('⛔ Cannot Charge next round');
    }

    if (player.job === Job.Engineer) {
      const isSelf = viewerId === null || player.userId === viewerId;
      if (isSelf) {
        lines.push(
          `⚙️ Parts: **${player.parts}** · Trap: ${player.trapActive ? '✅' : player.wantsSetTrap ? '⏳' : '—'}`,
        );
      } else {
        // Hide engineer trap inventory/activation from opponent.
        lines.push(`⚙️ Trap: —`);
      }
    }

    const activeEffects = player.effects.map(e => `*${e.name}* (${e.duration}r)`).join(', ');
    if (activeEffects) lines.push(`🔮 ${activeEffects}`);

    return lines.join('\n');
  }

  private buildActionButtons(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('bobozan_charge')
        .setLabel('🔵 Charge')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('bobozan_attack')
        .setLabel('🔴 Attack')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('bobozan_defend')
        .setLabel('⚪ Defend')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('bobozan_break')
        .setLabel('🟠 Break')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('bobozan_ultimate')
        .setLabel('🟢 Ultimate')
        .setStyle(ButtonStyle.Success),
    );
  }

  private buildSecondaryButtons(): ActionRowBuilder<ButtonBuilder> {
    const buttons: ButtonBuilder[] = [];

    if (this.playerA?.job === Job.Engineer || this.playerB?.job === Job.Engineer) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId('bobozan_trap')
          .setLabel('⚙️ Set Trap')
          .setStyle(ButtonStyle.Secondary),
      );
    }

    buttons.push(
      new ButtonBuilder()
        .setCustomId('bobozan_forfeit')
        .setLabel('🏳️ Forfeit')
        .setStyle(ButtonStyle.Danger),
    );

    return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
  }

  private async updateBattleEmbed(): Promise<void> {
    if (!this.playerA || !this.playerB) return;
    if (!this.battleMessageA || !this.battleMessageB) return;

    const embedA = this.buildPrivateControlEmbed(this.playerAId);
    const compsA = this.buildPrivateControlComponents(this.playerAId);
    const embedB = this.buildPrivateControlEmbed(this.playerBId);
    const compsB = this.buildPrivateControlComponents(this.playerBId);

    await Promise.all([
      this.battleMessageA.edit({ embeds: [embedA], components: compsA }).catch(() => {}),
      this.battleMessageB.edit({ embeds: [embedB], components: compsB }).catch(() => {}),
    ]);
  }

  private async updateTimerEmbed(extraTime: boolean, finished: boolean): Promise<void> {
    const embed = this.buildTimerEmbed(extraTime, finished);
    await Promise.all([
      this.timerMessageA?.edit({ embeds: [embed] }).catch(() => {}),
      this.timerMessageB?.edit({ embeds: [embed] }).catch(() => {}),
    ]);
  }

  private async updateLogEmbed(): Promise<void> {
    if (!this.channel) return;
    const embed = this.buildLogEmbed();
    if (!this.logMessage) {
      this.logMessage = await this.channel.send({ embeds: [embed] }).catch(() => null);
      return;
    }
    await this.logMessage.edit({ embeds: [embed] }).catch(() => {});
  }

  // ── Battle Result Builder ───────────────────────────────────────────

  private buildBattleResult(timeout: boolean, forfeit: boolean): BattleResult {
    const pA = this.playerA!;
    const pB = this.playerB!;
    const endedAtMs = Date.now();
    const startedAtMs = this.battleStartedAtMs ?? undefined;
    const battleDurationMs = startedAtMs != null ? Math.max(0, endedAtMs - startedAtMs) : undefined;

    const bothDead = pA.isDead && pB.isDead;
    const isDraw = bothDead;

    let winnerId: string | null = null;
    let loserId: string | null = null;
    if (!isDraw) {
      if (pA.isDead) {
        winnerId = pB.userId;
        loserId = pA.userId;
      } else if (pB.isDead) {
        winnerId = pA.userId;
        loserId = pB.userId;
      }
    }

    return {
      winnerId,
      loserId,
      isDraw,
      playerAId: pA.userId,
      playerBId: pB.userId,
      playerAName: this.playerAName,
      playerBName: this.playerBName,
      playerAJob: pA.job,
      playerBJob: pB.job,
      playerAHpRemaining: pA.hp,
      playerBHpRemaining: pB.hp,
      playerAMaxHp: pA.maxHp,
      playerBMaxHp: pB.maxHp,
      playerADamageDealt: pA.statDamageDealt,
      playerBDamageDealt: pB.statDamageDealt,
      playerAUltsUsed: pA.statUltsUsed,
      playerBUltsUsed: pB.statUltsUsed,
      playerADefendsSuccess: pA.statDefendsSuccess,
      playerBDefendsSuccess: pB.statDefendsSuccess,
      totalRounds: this.round,
      endedByForfeit: forfeit,
      endedByTimeout: timeout,
      ...(this.duelCardId ? { duelCardId: this.duelCardId } : {}),
      ...(this.duelDisplayId ? { duelDisplayId: this.duelDisplayId } : {}),
      ...(this.duelGuildId ? { guildId: this.duelGuildId } : {}),
      combatLogLines: [...this.combatLogLines],
      battleStartedAtMs: startedAtMs,
      battleEndedAtMs: endedAtMs,
      battleDurationMs,
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  getPlayer(userId: string): Player | null {
    if (userId === this.playerAId) return this.playerA;
    if (userId === this.playerBId) return this.playerB;
    return null;
  }

  isParticipant(userId: string): boolean {
    return userId === this.playerAId || userId === this.playerBId;
  }

  /** Ensure the 3-layout messages exist across public/private channels. */
  private async ensureLayoutMessages(): Promise<void> {
    if (!this.channel || !this.privateChannelA || !this.privateChannelB) {
      throw new Error('BattleSession channels are not attached');
    }

    // Public: combat log
    if (!this.logMessage) {
      const publicButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`bobozan_admin_end_match:${this.channel.id}`)
          .setLabel('⏹️ End match (Admin)')
          .setStyle(ButtonStyle.Danger),
      );
      this.logMessage = await this.channel.send({
        embeds: [this.buildLogEmbed()],
        components: [publicButtons],
      });
    }

    // Private A: timeline + last-round recap + control
    if (!this.timerMessageA) {
      this.timerMessageA = await this.privateChannelA.send({
        embeds: [this.buildTimerEmbed(false, false)],
      });
    }
    if (!this.roundSummaryMessageA) {
      this.roundSummaryMessageA = await this.privateChannelA.send({
        embeds: [this.buildPrivateLastRoundSummaryEmbed()],
      });
    }
    if (!this.battleMessageA) {
      const embed = this.buildPrivateControlEmbed(this.playerAId);
      const components = this.buildPrivateControlComponents(this.playerAId);
      this.battleMessageA = await this.privateChannelA.send({ embeds: [embed], components });
    }

    // Private B: timeline + recap + control
    if (!this.timerMessageB) {
      this.timerMessageB = await this.privateChannelB.send({
        embeds: [this.buildTimerEmbed(false, false)],
      });
    }
    if (!this.roundSummaryMessageB) {
      this.roundSummaryMessageB = await this.privateChannelB.send({
        embeds: [this.buildPrivateLastRoundSummaryEmbed()],
      });
    }
    if (!this.battleMessageB) {
      const embed = this.buildPrivateControlEmbed(this.playerBId);
      const components = this.buildPrivateControlComponents(this.playerBId);
      this.battleMessageB = await this.privateChannelB.send({ embeds: [embed], components });
    }
  }

  private appendCombatLogLine(line: string): void {
    // Keep the whole-match log but cap to avoid embed overflow / memory blowup.
    this.combatLogLines.push(line);
    if (this.combatLogLines.length > 80) {
      this.combatLogLines.splice(0, this.combatLogLines.length - 80);
    }
  }

  private startRoundTick(): void {
    if (this.roundTick) clearInterval(this.roundTick);
    // Update timeline every 2s (avoids Discord rate-limit on channel message edits).
    this.roundTick = setInterval(() => {
      if (this.settled) return;
      this.updateTimerEmbed(this.roundIdleExtended, false).catch(() => {});
    }, 2000);
  }

  private async postAdminDeletePrompt(): Promise<void> {
    const ch = this.channel;
    if (!ch || !this.privateChannelA || !this.privateChannelB) return;

    const privateAId = this.privateChannelA.id;
    const privateBId = this.privateChannelB.id;
    const publicId = ch.id;

    const embed = new EmbedBuilder()
      .setTitle('🧹 Admin cleanup')
      .setDescription('Admins can delete ALL duel channels (public + both private) when you are done reviewing the result.')
      .setColor(0x95a5a6);

    const deleteId = this.duelCardId ?? `${publicId}:${privateAId}:${privateBId}`;
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`bobozan_delete_duel_channels:${deleteId}`)
        .setLabel('🗑️ Delete duel channels')
        .setStyle(ButtonStyle.Danger),
    );

    await ch.send({ embeds: [embed], components: [row] }).catch(() => {});
  }
}
