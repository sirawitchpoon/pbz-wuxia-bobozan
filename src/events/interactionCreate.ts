import {
  Interaction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  TextChannel,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  UserSelectMenuInteraction,
  ChannelType,
  PermissionFlagsBits,
} from 'discord.js';
import { Action, Job } from '../models/enums';
import * as SessionManager from '../game/SessionManager';
import { BattleSession } from '../game/BattleSession';
import { buildJobSelectEmbed, buildJobSelectMenu } from '../game/JobSelectView';
import { LadderProfile, getRankForRating, RANK_TIERS } from '../models/LadderProfile';
import { MatchHistory } from '../models/MatchHistory';
import * as LadderService from '../services/LadderService';
import { logger } from '../utils/logger';

const CHALLENGE_EXPIRE_SECONDS = Math.max(60, parseInt(process.env.BOBOZAN_CHALLENGE_EXPIRE_SECONDS ?? '180', 10) || 180);
const CHALLENGE_EXPIRE_MS = CHALLENGE_EXPIRE_SECONDS * 1000;

export const name = 'interactionCreate';

export async function execute(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isButton()) {
      await handleButton(interaction);
    } else if (interaction.isStringSelectMenu()) {
      await handleSelect(interaction);
    } else if (interaction.isUserSelectMenu()) {
      await handleUserSelect(interaction);
    }
  } catch (err) {
    logger.error('Interaction handler error:', err);
    try {
      if (interaction.isRepliable()) {
        const fn = interaction.deferred || interaction.replied
          ? interaction.followUp.bind(interaction)
          : interaction.reply.bind(interaction);
        await fn({ content: '❌ Something went wrong. Please try again.', ephemeral: true });
      }
    } catch {}
  }
}

// ── Hub Buttons ───────────────────────────────────────────────────────

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const id = interaction.customId;

  // Hub: open challenge
  if (id === 'bobozan_open_challenge') {
    return handleOpenChallenge(interaction);
  }

  // Hub: target challenge (opens user select)
  if (id === 'bobozan_target_challenge') {
    return handleTargetChallenge(interaction);
  }

  // Hub: info buttons (ephemeral)
  if (id === 'bobozan_my_profile') return handleProfileButton(interaction);
  if (id === 'bobozan_leaderboard') return handleLeaderboardButton(interaction);
  if (id === 'bobozan_honor_info') return handleHonorButton(interaction);
  if (id === 'bobozan_rank_tiers') return handleRanksButton(interaction);
  if (id === 'bobozan_rules') return handleRulesButton(interaction);

  // Challenge accept/decline
  if (id.startsWith('bobozan_accept_')) return handleAcceptChallenge(interaction);
  if (id.startsWith('bobozan_decline_')) return handleDeclineChallenge(interaction);

  // Battle action buttons
  if (id.startsWith('bobozan_charge') || id.startsWith('bobozan_attack') ||
      id.startsWith('bobozan_defend') || id.startsWith('bobozan_ultimate') ||
      id.startsWith('bobozan_trap')) {
    return handleBattleAction(interaction);
  }

  // Forfeit
  if (id === 'bobozan_forfeit') return handleForfeitButton(interaction);
}

// ── Open Challenge ────────────────────────────────────────────────────

async function handleOpenChallenge(interaction: ButtonInteraction): Promise<void> {
  const user = interaction.user;

  if (SessionManager.hasActiveSession(user.id)) {
    await interaction.reply({ content: '❌ You are already in a match.', ephemeral: true });
    return;
  }

  const challengeChannelId = process.env.BOBOZAN_CHALLENGE_CHANNEL_ID;
  const channel = challengeChannelId
    ? await interaction.client.channels.fetch(challengeChannelId).catch(() => null)
    : interaction.channel;

  const targetChannel = channel instanceof TextChannel ? channel : (interaction.channel as TextChannel);
  if (!targetChannel) {
    await interaction.reply({ content: '❌ Channel not found.', ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('⚔️ Open Challenge')
    .setDescription(
      `> **${user.displayName}** is looking for an opponent!\n\n` +
      `Any warrior may step forward and accept.\n` +
      `Press **Accept Challenge** to enter the arena.`,
    )
    .setColor(0xe67e22)
    .setFooter({ text: `⏱️ Expires in ${CHALLENGE_EXPIRE_SECONDS}s · Open to anyone` });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`bobozan_accept_${user.id}`)
      .setLabel('⚔️ Accept Challenge')
      .setStyle(ButtonStyle.Success),
  );

  await interaction.reply({
    content: challengeChannelId ? `✅ Challenge posted in <#${challengeChannelId}>` : '✅ Challenge posted.',
    ephemeral: true,
  });

  const challengeMsg = await targetChannel.send({ embeds: [embed], components: [row] });

  setTimeout(async () => {
    try {
      if (!SessionManager.hasActiveSession(user.id)) {
        await challengeMsg.edit({
          embeds: [embed.setFooter({ text: '⏰ Timeout — no one accepted' }).setColor(0x888888)],
          components: [],
        });
      }
    } catch {}
  }, CHALLENGE_EXPIRE_MS);
}

// ── Target Challenge ──────────────────────────────────────────────────

async function handleTargetChallenge(interaction: ButtonInteraction): Promise<void> {
  const user = interaction.user;

  if (SessionManager.hasActiveSession(user.id)) {
    await interaction.reply({ content: '❌ You are already in a match.', ephemeral: true });
    return;
  }

  const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(`bobozan_target_select_${user.id}`)
      .setPlaceholder('Select opponent...')
      .setMinValues(1)
      .setMaxValues(1),
  );

  await interaction.reply({
    content: '🎯 Select the opponent you want to challenge:',
    components: [row],
    ephemeral: true,
  });
}

async function handleUserSelect(interaction: UserSelectMenuInteraction): Promise<void> {
  if (!interaction.customId.startsWith('bobozan_target_select_')) return;

  const challengerId = interaction.customId.replace('bobozan_target_select_', '');
  if (interaction.user.id !== challengerId) {
    await interaction.reply({ content: '❌ This is not for you.', ephemeral: true });
    return;
  }

  const opponent = interaction.users.first();
  if (!opponent) {
    await interaction.reply({ content: '❌ No player selected.', ephemeral: true });
    return;
  }

  if (opponent.bot) {
    await interaction.reply({ content: '❌ You cannot challenge a bot.', ephemeral: true });
    return;
  }

  if (opponent.id === challengerId) {
    await interaction.reply({ content: '❌ You cannot challenge yourself.', ephemeral: true });
    return;
  }

  if (SessionManager.hasActiveSession(opponent.id)) {
    await interaction.reply({ content: '❌ That player is already in a match.', ephemeral: true });
    return;
  }

  // Post challenge card to channel 2 (challenge channel)
  const challengeChannelId = process.env.BOBOZAN_CHALLENGE_CHANNEL_ID;
  const targetChannel = challengeChannelId
    ? await interaction.client.channels.fetch(challengeChannelId).catch(() => null)
    : interaction.channel;
  const channelToPost = targetChannel instanceof TextChannel ? targetChannel : (interaction.channel as TextChannel);

  if (!channelToPost) {
    await interaction.reply({ content: '❌ Channel not found.', ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('🎯 Target Challenge')
    .setDescription(
      `> **${interaction.user.displayName}** has challenged **${opponent.displayName}**!\n\n` +
      `${opponent}, will you accept this duel?`,
    )
    .setColor(0xe74c3c)
    .setFooter({ text: `⏱️ Expires in ${CHALLENGE_EXPIRE_SECONDS}s · Targeted challenge` });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`bobozan_accept_${challengerId}`)
      .setLabel('✅ Accept')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`bobozan_decline_${challengerId}`)
      .setLabel('❌ Decline')
      .setStyle(ButtonStyle.Danger),
  );

  await interaction.update({ content: `✅ Challenge sent to ${opponent.displayName}.`, components: [] });
  const challengeMsg = await channelToPost.send({ content: `<@${opponent.id}>`, embeds: [embed], components: [row] });

  setTimeout(async () => {
    try {
      if (!SessionManager.hasActiveSession(challengerId)) {
        await challengeMsg.edit({
          content: '',
          embeds: [embed.setFooter({ text: '⏰ Timeout — challenge expired' }).setColor(0x888888)],
          components: [],
        });
      }
    } catch {}
  }, CHALLENGE_EXPIRE_MS);
}

// ── Accept / Decline ──────────────────────────────────────────────────

async function handleAcceptChallenge(interaction: ButtonInteraction): Promise<void> {
  const challengerId = interaction.customId.replace('bobozan_accept_', '');
  const acceptor = interaction.user;

  if (acceptor.id === challengerId) {
    await interaction.reply({ content: '❌ You cannot accept your own challenge.', ephemeral: true });
    return;
  }

  if (SessionManager.hasActiveSession(acceptor.id)) {
    await interaction.reply({ content: '❌ You are already in a match.', ephemeral: true });
    return;
  }

  if (SessionManager.hasActiveSession(challengerId)) {
    await interaction.reply({ content: '❌ The challenger is already in a match.', ephemeral: true });
    return;
  }

  const challenger = await interaction.client.users.fetch(challengerId).catch(() => null);
  if (!challenger) {
    await interaction.reply({ content: '❌ Challenger not found.', ephemeral: true });
    return;
  }

  const session = new BattleSession(
    interaction.client,
    challengerId,
    challenger.displayName,
    acceptor.id,
    acceptor.displayName,
  );
  SessionManager.registerSession(session);

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: '❌ Guild not found.', ephemeral: true });
    return;
  }

  // Create temp channel: visible only to the two players and admins
  const safeName = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 10) || 'player';
  const channelName = `duel-${safeName(challenger.displayName)}-vs-${safeName(acceptor.displayName)}`;
  const adminRoleId = process.env.BOBOZAN_ADMIN_ROLE_ID;

  const permissionOverwrites: { id: string; allow?: bigint; deny?: bigint }[] = [
    { id: guild.id, deny: PermissionFlagsBits.ViewChannel },
    { id: challengerId, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ReadMessageHistory },
    { id: acceptor.id, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ReadMessageHistory },
  ];
  if (adminRoleId) {
    permissionOverwrites.push({ id: adminRoleId, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory });
  }

  const tempChannel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    permissionOverwrites,
  });

  // Update challenge message to point to temp channel
  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setTitle('⚔️ Challenge Accepted!')
        .setDescription(
          `🟥 **${challenger.displayName}**  ╳  🟦 **${acceptor.displayName}**\n\n` +
          `> The duel has begun in ${tempChannel}`,
        )
        .setColor(0x2ecc71)
        .setFooter({ text: 'Wuxia BoboZan · May the best warrior win' }),
    ],
    components: [],
  });

  // Send job selection in the temp channel (battle will run here)
  const selectEmbed = buildJobSelectEmbed(challenger.displayName, acceptor.displayName);
  const selectMenu = buildJobSelectMenu();
  await tempChannel.send({ content: `${challenger} ${acceptor} — Choose your class below.`, embeds: [selectEmbed], components: [selectMenu] });

  setTimeout(async () => {
    if (!session.bothJobsSelected) {
      SessionManager.removeSession(session);
      try {
        await tempChannel.send({
          embeds: [
            new EmbedBuilder()
              .setTitle('⏰ Class selection timeout')
              .setDescription('Match cancelled.')
              .setColor(0x888888),
          ],
        });
      } catch {}
    }
  }, 60_000);
}

async function handleDeclineChallenge(interaction: ButtonInteraction): Promise<void> {
  const challengerId = interaction.customId.replace('bobozan_decline_', '');

  // Only the challenged person or the challenger can decline
  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setTitle('❌ Challenge declined')
        .setDescription(`${interaction.user.displayName} declined the challenge.`)
        .setColor(0x888888),
    ],
    components: [],
  });
}

// ── Battle Actions ────────────────────────────────────────────────────

async function handleBattleAction(interaction: ButtonInteraction): Promise<void> {
  const session = SessionManager.getSession(interaction.user.id);
  if (!session) {
    await interaction.reply({ content: '❌ You are not in a match.', ephemeral: true });
    return;
  }

  if (!session.isParticipant(interaction.user.id)) {
    await interaction.reply({ content: '❌ You are not a player in this match.', ephemeral: true });
    return;
  }

  const actionMap: Record<string, Action> = {
    bobozan_charge: Action.Charge,
    bobozan_attack: Action.Attack,
    bobozan_defend: Action.Defend,
    bobozan_ultimate: Action.Ultimate,
    bobozan_trap: Action.SetTrap,
  };

  const action = actionMap[interaction.customId];
  if (action !== undefined) {
    await session.handleAction(interaction, action);
  }
}

// ── Forfeit ───────────────────────────────────────────────────────────

async function handleForfeitButton(interaction: ButtonInteraction): Promise<void> {
  const session = SessionManager.getSession(interaction.user.id);
  if (!session) {
    await interaction.reply({ content: '❌ You are not in a match.', ephemeral: true });
    return;
  }

  const success = await session.forfeit(interaction.user.id);
  if (success) {
    await interaction.reply({ content: '🏳️ You forfeited.', ephemeral: true });
  } else {
    await interaction.reply({ content: '❌ Cannot forfeit (match may have ended).', ephemeral: true });
  }
}

// ── Info Buttons (Ephemeral) ──────────────────────────────────────────

async function handleProfileButton(interaction: ButtonInteraction): Promise<void> {
  const target = interaction.user;
  const profile = await LadderProfile.findOne({ userId: target.id });

  if (!profile) {
    await interaction.reply({ content: `You have no stats yet. Start a duel to create your profile!`, ephemeral: true });
    return;
  }

  const rank = getRankForRating(profile.rating);
  const winrate = profile.gamesPlayed > 0
    ? ((profile.wins / profile.gamesPlayed) * 100).toFixed(1)
    : '0.0';

  const streakText = profile.currentStreak > 0
    ? `🔥 ${profile.currentStreak} win streak`
    : profile.currentStreak < 0
      ? `❄️ ${Math.abs(profile.currentStreak)} loss streak`
      : '—';

  const recentMatches = await MatchHistory.find({
    $or: [{ playerAId: target.id }, { playerBId: target.id }],
  }).sort({ createdAt: -1 }).limit(5).lean();

  const { getJobDisplayNameEn } = await import('../models/enums');
  const recentLines = recentMatches.map(m => {
    const isA = m.playerAId === target.id;
    const myJob = isA ? m.playerAJob : m.playerBJob;
    const oppName = isA ? m.playerBName : m.playerAName;
    const oppJob = isA ? m.playerBJob : m.playerAJob;
    const result = m.isDraw ? 'D' : m.winnerId === target.id ? 'W' : 'L';
    const icon = m.isDraw ? '🟡' : m.winnerId === target.id ? '🟢' : '🔴';
    return `${icon} ${result} | ${getJobDisplayNameEn(myJob)} vs ${getJobDisplayNameEn(oppJob)} (${oppName}) — ${m.totalRounds}r`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`${rank.icon} ${target.displayName} — Wuxia BoboZan`)
    .setColor(0xd4a574)
    .addFields(
      { name: 'Rank', value: `${rank.icon} ${rank.titleEn}`, inline: true },
      { name: 'Rating', value: `${profile.rating} (peak: ${profile.peakRating})`, inline: true },
      { name: 'Streak', value: streakText, inline: true },
      { name: 'Games', value: `${profile.gamesPlayed}`, inline: true },
      { name: 'W/L/D', value: `${profile.wins}/${profile.losses}/${profile.draws}`, inline: true },
      { name: 'Win rate', value: `${winrate}%`, inline: true },
      { name: 'Honor total', value: `${profile.honorTotal}`, inline: true },
    );

  if (recentLines.length > 0) {
    embed.addFields({ name: 'Recent matches', value: recentLines.join('\n'), inline: false });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleLeaderboardButton(interaction: ButtonInteraction): Promise<void> {
  const top = await LadderService.getLeaderboard(10);

  if (top.length === 0) {
    await interaction.reply({ content: 'No leaderboard data yet.', ephemeral: true });
    return;
  }

  const medals = ['🥇', '🥈', '🥉'];
  const lines = top.map((p, i) => {
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

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleHonorButton(interaction: ButtonInteraction): Promise<void> {
  const profile = await LadderProfile.findOne({ userId: interaction.user.id });
  const total = profile?.honorTotal ?? 0;

  const embed = new EmbedBuilder()
    .setTitle('🏅 Wuxia BoboZan — Honor Points')
    .setColor(0xd4a574)
    .setDescription(`**Your total Honor: ${total}**\n\nHonor is added to the central Honor Points system after each match.`)
    .addFields({
      name: '📋 Scoring',
      value: [
        '**Base:** +10 (participation)',
        '**Win:** +30 | **Draw:** +15 | **Loss:** +5',
        '**Damage:** +4 per hit',
        '**Ultimate:** +5 per use',
        '**Defend:** +3 per successful block',
        '**Perfect win:** +20 (full HP)',
        '**Comeback:** +15 (1 HP left)',
        '**Fast win:** +10 (≤3 rounds)',
        '**Long battle:** +8 (>10 rounds, both)',
        '**Forfeit:** -10 | **Timeout:** -5',
      ].join('\n'),
      inline: false,
    });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleRanksButton(interaction: ButtonInteraction): Promise<void> {
  const lines = RANK_TIERS.map(t => `${t.icon} **${t.titleEn}** — ${t.minRating}+ rating`);

  const embed = new EmbedBuilder()
    .setTitle('⚔️ Wuxia BoboZan — Rank Tiers')
    .setDescription(lines.join('\n'))
    .setColor(0xd4a574)
    .setFooter({ text: 'Default starting rating: 1200 (Martial Artist)' });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleRulesButton(interaction: ButtonInteraction): Promise<void> {
  const roundSec = process.env.ROUND_TIMEOUT_SECONDS || '30';
  const bothIdleSec = process.env.ROUND_TIMEOUT_BOTH_IDLE_SECONDS || '60';

  const embed = new EmbedBuilder()
    .setTitle('⚔️ Wuxia BoboZan — Rules')
    .setColor(0xd4a574)
    .setDescription('1v1 turn-based duel inspired by Chinese martial arts.')
    .addFields(
      {
        name: '🎮 Basics',
        value: [
          '• Two players choose actions at the same time each round.',
          '• Your opponent **cannot see** your choice.',
          '• HP is class-based (3–7). HP 0 = loss. Both 0 = draw.',
        ].join('\n'),
      },
      {
        name: '🔵 Charge',
        value: '+1 energy. Engineer: 50% chance +1 part.',
      },
      {
        name: '🔴 Attack',
        value: 'Costs 1 energy, 1 damage. Blocked if opponent Defends. Both attack = clash: 1 damage each, energy → 0.',
      },
      {
        name: '⚪ Defend',
        value: 'Blocks attack. May trigger class passives.',
      },
      {
        name: '🟢 Ultimate',
        value: 'Class-specific, costs energy. See class descriptions.',
      },
      {
        name: '⏱️ Time',
        value: `${roundSec}s per round. No choice = loss. If **both** don't choose in time, ${bothIdleSec}s extra before draw.`,
      },
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// ── Job Selection (Select Menu) ───────────────────────────────────────

async function handleSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (interaction.customId !== 'bobozan_job_select') return;

  const session = SessionManager.getSession(interaction.user.id);
  if (!session) {
    await interaction.reply({ content: '❌ Match expired.', ephemeral: true });
    return;
  }

  if (!session.isParticipant(interaction.user.id)) {
    await interaction.reply({ content: '❌ You are not a player in this match.', ephemeral: true });
    return;
  }

  const selectedJob = interaction.values[0] as Job;
  if (!Object.values(Job).includes(selectedJob)) {
    await interaction.reply({ content: '❌ Invalid class.', ephemeral: true });
    return;
  }

  const existingJob = session.getPlayerJob(interaction.user.id);
  if (existingJob) {
    const { JOB_DISPLAY_EN } = await import('../models/enums');
    const existingName = JOB_DISPLAY_EN[existingJob].name;
    await interaction.reply({ content: `You already chose **${existingName}**.`, ephemeral: true });
    return;
  }

  session.setJob(interaction.user.id, selectedJob);
  const { JOB_DISPLAY_EN } = await import('../models/enums');
  const jobName = JOB_DISPLAY_EN[selectedJob].name;
  await interaction.reply({
    content: `✅ You chose **${jobName}**\nWaiting for opponent...`,
    ephemeral: true,
  });

  if (session.bothJobsSelected) {
    const channel = interaction.channel as TextChannel;
    try {
      await interaction.message.edit({
        content: '⚔️ Both chose their class. Duel starting!',
        embeds: [],
        components: [],
      });
    } catch {}
    await session.startBattle(channel);
  }
}

