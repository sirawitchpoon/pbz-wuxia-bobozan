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

const ROUND_TIMEOUT = parseInt(process.env.ROUND_TIMEOUT_SECONDS ?? '30', 10) * 1000;
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
  private battleMessage: Message | null = null;
  private channel: TextChannel | null = null;
  private roundTimer: NodeJS.Timeout | null = null;
  private roundIdleExtended: boolean = false;
  private settled: boolean = false;
  private lastRoundLog: RoundLog | null = null;

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

  async startBattle(channel: TextChannel): Promise<void> {
    if (!this.playerA || !this.playerB) return;

    this.channel = channel;
    this.round = 1;

    const embed = this.buildBattleEmbed();

    this.battleMessage = await channel.send({
      embeds: [embed],
      components: [this.buildActionButtons(), this.buildSecondaryButtons()],
    });
    this.roundIdleExtended = false;
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

    if (action === Action.SetTrap) {
      player.wantsSetTrap = true;
      await interaction.reply({
        content: `⚙️ Trap set. Now choose your action this round (Charge / Attack / Defend / Ultimate).`,
        ephemeral: true,
      });
      return;
    }

    player.action = action;
    player.actionLocked = true;

    const actionNames: Record<Action, string> = {
      [Action.Charge]: '🔵 Charge',
      [Action.Attack]: '🔴 Attack',
      [Action.Defend]: '⚪ Defend',
      [Action.Ultimate]: '🟢 Ultimate',
      [Action.SetTrap]: '⚙️ Set Trap',
    };

    await interaction.reply({
      content: `You chose **${actionNames[action]}**`,
      ephemeral: true,
    });

    // Update footer to show lock status
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

  // ── Round Resolution ────────────────────────────────────────────────

  private async resolveCurrentRound(): Promise<void> {
    if (!this.playerA || !this.playerB) return;

    const roundLog = resolveRound(this.playerA, this.playerB, this.round);
    this.lastRoundLog = roundLog;

    if (roundLog.p1Dead || roundLog.p2Dead) {
      this.settled = true;
      const result = this.buildBattleResult(false, false);
      await this.settleMatch(result);
      return;
    }

    this.round++;
    this.roundIdleExtended = false;
    // Visible message that round changed (not just embed edit)
    if (this.channel) {
      await this.channel
        .send({ content: `⚔️ **Round ${this.round}** — Choose your action!` })
        .catch(() => {});
    }
    await this.updateBattleEmbed();
    this.startRoundTimer();
  }

  private async settleMatch(result: BattleResult): Promise<void> {
    try {
      const settlement = await SettlementService.settle(result);

      // Build final result embed
      if (this.battleMessage && this.playerA && this.playerB) {
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
            value: this.renderPlayerStatus(pA),
            inline: true,
          },
          { name: '\u200b', value: '\u200b', inline: true },
          {
            name: `🟦 ${this.playerBName}`,
            value: this.renderPlayerStatus(pB),
            inline: true,
          },
        );

        // Last round log if available
        if (this.lastRoundLog) {
          const logText = this.lastRoundLog.entries.length > 0
            ? this.lastRoundLog.entries.join('\n')
            : '*(no events)*';
          embed.addFields({
            name: `📜 Round ${this.lastRoundLog.round} — Final Combat Log`,
            value: logText.substring(0, 1024),
            inline: false,
          });
        }

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

        await this.battleMessage.edit({ embeds: [embed], components: [] });
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
      this.scheduleTempChannelDeletion();
    }
  }

  // ── Timeout ─────────────────────────────────────────────────────────

  private startRoundTimer(): void {
    this.roundTimer = setTimeout(async () => {
      if (this.settled || !this.playerA || !this.playerB) return;

      const bothIdle = !this.playerA.actionLocked && !this.playerB.actionLocked;

      if (bothIdle && !this.roundIdleExtended) {
        // Give both players extra time before declaring draw
        this.roundIdleExtended = true;
        if (this.channel) {
          const extraSec = Math.round(ROUND_TIMEOUT_BOTH_IDLE_MS / 1000);
          await this.channel
            .send({
              content: `⏰ No one chose in time. You have **${extraSec}** more seconds for this round.`,
            })
            .catch(() => {});
        }
        this.roundTimer = setTimeout(async () => {
          if (this.settled || !this.playerA || !this.playerB) return;
          if (!this.playerA.actionLocked && !this.playerB.actionLocked) {
            this.playerA.hp = 0;
            this.playerB.hp = 0;
            this.settled = true;
            const result = this.buildBattleResult(true, false);
            await this.settleMatch(result);
          }
        }, ROUND_TIMEOUT_BOTH_IDLE_MS);
        return;
      }

      // Whoever hasn't locked in loses (or draw if both idle after extension)
      if (bothIdle) {
        this.playerA.hp = 0;
        this.playerB.hp = 0;
      } else if (!this.playerA.actionLocked) {
        this.playerA.hp = 0;
      } else {
        this.playerB.hp = 0;
      }

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
  }

  /** Delete temp duel channel after a short delay so players can read the result. */
  private scheduleTempChannelDeletion(): void {
    const ch = this.channel;
    if (!ch) return;
    const delayMs = parseInt(process.env.BOBOZAN_TEMP_CHANNEL_DELETE_DELAY_MS ?? '5000', 10) || 5000;
    setTimeout(() => {
      ch.delete().catch(() => {});
    }, delayMs);
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

  private buildBattleEmbed(): EmbedBuilder {
    const pA = this.playerA;
    const pB = this.playerB;
    const lockedA = pA?.actionLocked ?? false;
    const lockedB = pB?.actionLocked ?? false;

    // Dynamic color: critical HP → red, normal → battle blue
    let color = 0x5865f2;
    if ((pA?.hp ?? 99) <= 1 || (pB?.hp ?? 99) <= 1) color = 0xe74c3c;

    const embed = new EmbedBuilder()
      .setTitle(`⚔️ Round ${this.round}`)
      .setColor(color);

    if (pA && pB) {
      const jobA = JOB_DISPLAY_EN[pA.job].name;
      const jobB = JOB_DISPLAY_EN[pB.job].name;

      // Turn status indicator line
      let statusLine: string;
      if (!this.settled) {
        if (lockedA && !lockedB) {
          statusLine = `✅ **${this.playerAName}** ready  ·  ⏳ Waiting for **${this.playerBName}**...`;
        } else if (!lockedA && lockedB) {
          statusLine = `⏳ Waiting for **${this.playerAName}**...  ·  ✅ **${this.playerBName}** ready`;
        } else if (lockedA && lockedB) {
          statusLine = `✅ Both locked in — resolving round...`;
        } else {
          statusLine = `⚔️ Both choosing — actions are **hidden** from your opponent`;
        }
        embed.setDescription(
          `🟥 **${this.playerAName}** ${JOB_EMOJI[pA.job]} ${jobA}  ╳  🟦 **${this.playerBName}** ${JOB_EMOJI[pB.job]} ${jobB}\n\n> ${statusLine}`,
        );
      } else {
        embed.setDescription(
          `🟥 **${this.playerAName}** ${JOB_EMOJI[pA.job]} ${jobA}  ╳  🟦 **${this.playerBName}** ${JOB_EMOJI[pB.job]} ${jobB}`,
        );
      }

      embed.addFields(
        {
          name: `🟥 ${this.playerAName}`,
          value: this.renderPlayerStatus(pA),
          inline: true,
        },
        { name: '\u200b', value: '\u200b', inline: true }, // spacer
        {
          name: `🟦 ${this.playerBName}`,
          value: this.renderPlayerStatus(pB),
          inline: true,
        },
      );

      if (this.lastRoundLog) {
        const logText = this.lastRoundLog.entries.length > 0
          ? this.lastRoundLog.entries.join('\n')
          : '*(no events)*';
        embed.addFields({
          name: `📜 Round ${this.lastRoundLog.round} — Combat Log`,
          value: logText.substring(0, 1024),
          inline: false,
        });
      }

      if (!this.settled) {
        const timeoutSec = parseInt(process.env.ROUND_TIMEOUT_SECONDS ?? '30', 10);
        embed.setFooter({ text: `⏱️ ${timeoutSec}s per round  ·  Actions resolve simultaneously` });
      }
    }

    return embed;
  }

  private renderPlayerStatus(player: Player): string {
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
      lines.push(`⚙️ Parts: **${player.parts}** · Trap: ${player.trapActive ? '✅' : '—'}`);
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
    if (!this.battleMessage) return;

    const embed = this.buildBattleEmbed();
    const components: ActionRowBuilder<ButtonBuilder>[] = [];

    if (!this.settled) {
      components.push(this.buildActionButtons());
      components.push(this.buildSecondaryButtons());
    }

    await this.battleMessage.edit({ embeds: [embed], components }).catch(() => {});
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
}
