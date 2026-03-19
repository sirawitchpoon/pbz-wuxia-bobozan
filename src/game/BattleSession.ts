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
    this.battleMessageA = null;
    this.battleMessageB = null;
    this.selectionTurnUserId = null;
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
    this.combatLogLines = [];
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

    // Sequential gating:
    // - First valid click defines the acting player for this round.
    // - The other player is blocked until the acting player locks a main action.
    if (this.selectionTurnUserId && this.selectionTurnUserId !== userId) {
      await interaction.reply({
        content: '⏳ Not your turn to lock in yet — wait for the other player.',
        ephemeral: true,
      });
      return;
    }

    // Validate action
    const validation = this.validateAction(player, action);
    if (validation) {
      await interaction.reply({ content: validation, ephemeral: true });
      return;
    }

    // After validation succeeds, the first click sets the acting player.
    if (this.selectionTurnUserId === null) {
      this.selectionTurnUserId = userId;
    }

    // Acknowledge immediately so Discord doesn't show "interaction failed".
    interaction.deferUpdate().catch(() => {});

    if (action === Action.SetTrap) {
      player.wantsSetTrap = true;
      await this.updateBattleEmbed();
      return;
    }

    player.action = action;
    player.actionLocked = true;

    // Switch selection turn to the opponent (only after a main action is locked).
    this.selectionTurnUserId = this.getOpponentId(userId);

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
      const settlement = await SettlementService.settle(result);

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
        // Also append a match-ended summary into the public combat log.
        if (winnerName) {
          this.appendCombatLogLine(`🏁 Match ended — **${winnerName}** wins over **${loserName}** (${result.totalRounds} rounds).`);
        } else if (isDraw) {
          this.appendCombatLogLine(`🏁 Match ended — Draw (${result.totalRounds} rounds).`);
        }

        await Promise.all([
          this.battleMessageA?.edit({ embeds: [embed], components: [] }).catch(() => {}),
          this.battleMessageB?.edit({ embeds: [embed], components: [] }).catch(() => {}),
          // Refresh public log (and remove any public action buttons after settlement).
          this.logMessage?.edit({ embeds: [this.buildLogEmbed()], components: [] }).catch(() => {}),
        ]);
      }

      // Post to public match history channel (channel 3)
      const historyChannelId = process.env.BOBOZAN_HISTORY_CHANNEL_ID;
      if (historyChannelId && this.playerA && this.playerB) {
        const historyChannel = await this.client.channels.fetch(historyChannelId).catch(() => null);
        if (historyChannel && historyChannel.isTextBased() && 'send' in historyChannel) {
          const winnerName = result.isDraw ? null : (result.winnerId === result.playerAId ? this.playerAName : this.playerBName);
          const summary = result.isDraw
            ? `**${this.playerAName}** vs **${this.playerBName}** — Draw (${result.totalRounds} rounds)`
            : `**${winnerName}** defeated **${result.winnerId === result.playerAId ? this.playerBName : this.playerAName}** in ${result.totalRounds} rounds`;
          const historyEmbed = new EmbedBuilder()
            .setTitle('⚔️ Match ended')
            .setDescription(summary)
            .setColor(0xd4a574)
            .setTimestamp();
          await (historyChannel as TextChannel).send({ embeds: [historyEmbed] }).catch(() => {});
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
    // Reset countdown range for this timer window.
    this.roundTotalMs = ROUND_TIMEOUT;
    this.roundEndsAtMs = Date.now() + this.roundTotalMs;
    this.startRoundTick();

    this.roundTimer = setTimeout(async () => {
      if (this.settled || !this.playerA || !this.playerB) return;

      // "Idle" means: neither main action locked nor trap prepared.
      // This prevents premature draw when players only set traps.
      const bothIdle =
        !this.playerA.actionLocked &&
        !this.playerA.wantsSetTrap &&
        !this.playerB.actionLocked &&
        !this.playerB.wantsSetTrap;

      if (bothIdle && !this.roundIdleExtended) {
        // Give both players extra time before declaring draw
        this.roundIdleExtended = true;
        this.roundTotalMs = ROUND_TIMEOUT_BOTH_IDLE_MS;
        this.roundEndsAtMs = Date.now() + this.roundTotalMs;
        this.startRoundTick();
        await this.updateTimerEmbed(true, false).catch(() => {});
        this.roundTimer = setTimeout(async () => {
          if (this.settled || !this.playerA || !this.playerB) return;
          const bothNoChoices =
            !this.playerA.actionLocked &&
            !this.playerA.wantsSetTrap &&
            !this.playerB.actionLocked &&
            !this.playerB.wantsSetTrap;

          if (bothNoChoices) {
            this.playerA.hp = 0;
            this.playerB.hp = 0;
            this.settled = true;
            const result = this.buildBattleResult(true, false);
            await this.settleMatch(result);
            return;
          }

          // Someone prepared a trap, but neither locked a main action yet:
          // resolve the round normally with action=null for those who didn't pick.
          if (!this.playerA.actionLocked) {
            this.playerA.actionLocked = true;
            this.playerA.action = null;
          }
          if (!this.playerB.actionLocked) {
            this.playerB.actionLocked = true;
            this.playerB.action = null;
          }
          this.clearRoundTimer();
          await this.resolveCurrentRound();
        }, ROUND_TIMEOUT_BOTH_IDLE_MS);
        return;
      }

      // Only one player idle: treat idle player as "no action" and resolve the round normally
      if (!bothIdle) {
        if (!this.playerA.actionLocked) {
          this.playerA.actionLocked = true;
          this.playerA.action = null;
        }
        if (!this.playerB.actionLocked) {
          this.playerB.actionLocked = true;
          this.playerB.action = null;
        }
        this.clearRoundTimer();
        await this.resolveCurrentRound();
        return;
      }

      // Both idle after extension: draw
      this.playerA.hp = 0;
      this.playerB.hp = 0;
      this.settled = true;
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
    if (action === Action.Attack && player.energy < 1) {
      if (!(player.job === Job.Bladesman && player.hp <= 2)) {
        return '❌ Not enough energy. Attack requires 1 energy.';
      }
    }

    if (action === Action.Ultimate) {
      const cost = JOB_STATS[player.job].ultCost;
      if (player.energy < cost) {
        return `❌ Not enough energy. Ultimate requires ${cost} (you have ${player.energy}).`;
      }
      player.energy -= cost;
    }

    if (action === Action.SetTrap) {
      if (player.job !== Job.Engineer) return '❌ Only Engineer can set traps.';
      if (player.parts <= 0) return '❌ No parts left.';
      if (player.trapActive) return '❌ A trap is already set.';
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
    lines.push(`• Per round: **${roundSec}s**`);
    lines.push(`• Both idle → extra window before draw (**${extraSec}s**)`);
    if (extraTime) lines.push(`• Extra window active now.`);

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
      if (this.selectionTurnUserId === null) {
        statusLine = '⚔️ Both choosing — the first lock-in defines the acting player. Opponent action is hidden until resolve.';
      } else if (viewerLocked) {
        statusLine = `✅ You locked in: **${this.actionToLabel(viewerPlayer.action)}** · Waiting for opponent lock-in...`;
      } else if (this.selectionTurnUserId === viewerId) {
        if (viewerPlayer.wantsSetTrap) {
          statusLine = '⚙️ Trap prepared — now choose your main action.';
        } else {
          statusLine = '🎮 Your turn — choose your action.';
        }
      } else {
        const actingName = this.selectionTurnUserId === this.playerAId ? this.playerAName : this.playerBName;
        const actingPlayer = this.selectionTurnUserId === this.playerAId ? pA : pB;
        if (opponentLocked) {
          statusLine = `⏳ Waiting — ${actingName} locked in: **${this.actionToLabel(actingPlayer.action)}**.`;
        } else if (actingPlayer.wantsSetTrap) {
          statusLine = `⏳ Waiting — ${actingName} prepared a trap.`;
        } else {
          statusLine = `⏳ Waiting — ${actingName} is choosing...`;
        }
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
      embed.setFooter({ text: `⏱️ ${timeoutSec}s per round · Sequential lock-in` });
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

    const isTurn = this.selectionTurnUserId === null || this.selectionTurnUserId === viewerId;
    const canChooseMain = isTurn && !viewer.actionLocked;

    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    if (canChooseMain) {
      rows.push(this.buildActionButtons());
    }

    const secondaryButtons: ButtonBuilder[] = [];
    const canSetTrap =
      isTurn &&
      !viewer.actionLocked &&
      viewer.job === Job.Engineer &&
      viewer.parts > 0 &&
      !viewer.trapActive &&
      !viewer.wantsSetTrap;

    if (canSetTrap) {
      secondaryButtons.push(
        new ButtonBuilder()
          .setCustomId('bobozan_trap')
          .setLabel('⚙️ Set Trap')
          .setStyle(ButtonStyle.Secondary),
      );
    }

    // Allow forfeit at any time (doesn't affect selection turn state).
    secondaryButtons.push(
      new ButtonBuilder().setCustomId('bobozan_forfeit').setLabel('🏳️ Forfeit').setStyle(ButtonStyle.Danger),
    );

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
      `⚡ \`${energyBar}\` **${player.energy}**`,
    ];

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
          .setCustomId(`bobozan_bug_report:${this.channel.id}`)
          .setLabel('🐞 Bug report')
          .setStyle(ButtonStyle.Secondary),
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

    // Private A: timeline + control
    if (!this.timerMessageA) {
      this.timerMessageA = await this.privateChannelA.send({
        embeds: [this.buildTimerEmbed(false, false)],
      });
    }
    if (!this.battleMessageA) {
      const embed = this.buildPrivateControlEmbed(this.playerAId);
      const components = this.buildPrivateControlComponents(this.playerAId);
      this.battleMessageA = await this.privateChannelA.send({ embeds: [embed], components });
    }

    // Private B: timeline + control
    if (!this.timerMessageB) {
      this.timerMessageB = await this.privateChannelB.send({
        embeds: [this.buildTimerEmbed(false, false)],
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
