import {
  Interaction,
  ButtonInteraction,
  ModalBuilder,
  ModalSubmitInteraction,
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
  TextInputBuilder,
  TextInputStyle,
  Guild,
} from 'discord.js';
import { Action, Job } from '../models/enums';
import * as SessionManager from '../game/SessionManager';
import { BattleSession } from '../game/BattleSession';
import { buildJobSelectEmbed, buildJobSelectMenu } from '../game/JobSelectView';
import { buildGuidebookEmbed, buildGuidebookNavComponents, GUIDEBOOK_JOB_ORDER } from '../game/GuidebookView';
import { LadderProfile, getRankForRating, RANK_TIERS } from '../models/LadderProfile';
import { MatchHistory } from '../models/MatchHistory';
import { DuelCard } from '../models/DuelCard';
import { nextDuelDisplayId } from '../models/DuelCounter';
import * as LadderService from '../services/LadderService';
import { logger } from '../utils/logger';
import { connectDB, isDBConnected } from '../utils/connectDB';
import { Types } from 'mongoose';

const CHALLENGE_EXPIRE_SECONDS = Math.max(60, parseInt(process.env.BOBOZAN_CHALLENGE_EXPIRE_SECONDS ?? '180', 10) || 180);
const CHALLENGE_EXPIRE_MS = CHALLENGE_EXPIRE_SECONDS * 1000;

function isDuelCardObjectId(s: string): boolean {
  return /^[a-f0-9]{24}$/i.test(s) && Types.ObjectId.isValid(s);
}

async function deleteDuelChannelShell(
  guild: Guild,
  opts: { categoryId?: string | null; publicId?: string | null; privateAId?: string | null; privateBId?: string | null },
): Promise<void> {
  for (const id of [opts.publicId, opts.privateAId, opts.privateBId]) {
    if (!id) continue;
    const ch = guild.channels.cache.get(id) || (await guild.channels.fetch(id).catch(() => null));
    await (ch as { delete?: () => Promise<unknown> })?.delete?.().catch(() => {});
  }
  if (opts.categoryId) {
    const cat = guild.channels.cache.get(opts.categoryId) || (await guild.channels.fetch(opts.categoryId).catch(() => null));
    await (cat as { delete?: () => Promise<unknown> })?.delete?.().catch(() => {});
  }
}

/** Unique per user (avoids duplicate channel names if display names match). */
function duelUsernameSlug(displayName: string, userId: string): string {
  const base = displayName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14) || 'p';
  const tail = userId.replace(/\D/g, '').slice(-4) || '0000';
  return `${base}${tail}`.slice(0, 20);
}

export const name = 'interactionCreate';

export async function execute(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isButton()) {
      await handleButton(interaction);
    } else if (interaction.isStringSelectMenu()) {
      await handleSelect(interaction);
    } else if (interaction.isUserSelectMenu()) {
      await handleUserSelect(interaction);
    } else if (interaction.isModalSubmit()) {
      await handleModalSubmit(interaction as ModalSubmitInteraction);
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

  // Guidebook (class details) navigation (single persistent embed message)
  if (id.startsWith('bobozan_guidebook_show:')) return handleGuidebookShow(interaction);

  // Challenge accept/decline
  if (id.startsWith('bobozan_accept_')) return handleAcceptChallenge(interaction);
  if (id.startsWith('bobozan_decline_')) return handleDeclineChallenge(interaction);

  // Public match controls (bug + admin end)
  if (id.startsWith('bobozan_bug_report:')) return handleBugReportButton(interaction);
  if (id.startsWith('bobozan_admin_end_match:')) return handleAdminEndMatchButton(interaction);

  // Battle action buttons
  if (id.startsWith('bobozan_charge') || id.startsWith('bobozan_attack') ||
      id.startsWith('bobozan_defend') || id.startsWith('bobozan_ultimate') ||
      id.startsWith('bobozan_trap')) {
    return handleBattleAction(interaction);
  }

  // Forfeit
  if (id === 'bobozan_forfeit') return handleForfeitButton(interaction);

  // Admin cleanup: delete duel channels
  if (id.startsWith('bobozan_delete_duel_channels:')) return handleDeleteTempChannel(interaction);
}

// ── Open Challenge ────────────────────────────────────────────────────

async function handleOpenChallenge(interaction: ButtonInteraction): Promise<void> {
  const user = interaction.user;

  if (SessionManager.hasActiveSession(user.id)) {
    await interaction.reply({ content: '❌ You are already in a match.', ephemeral: true });
    return;
  }

  await connectDB();
  if (!isDBConnected()) {
    await interaction.reply({
      content: '❌ **MONGO_URI** is required for Challenge Cards and duel IDs (e.g. 001).',
      ephemeral: true,
    });
    return;
  }

  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: '❌ Post challenges from inside a server only.', ephemeral: true });
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

  const { displayId, seq } = await nextDuelDisplayId(guildId);
  const card = await DuelCard.create({
    guildId,
    displaySeq: seq,
    displayId,
    challengeType: 'open',
    challengerId: user.id,
    status: 'open',
  });

  const embed = new EmbedBuilder()
    .setTitle(`⚔️ Open Challenge · #${displayId}`)
    .setDescription(
      `> **${user.displayName}** is looking for an opponent!\n\n` +
      `Any warrior may step forward and accept.\n` +
      `Press **Accept Challenge** to enter the arena.`,
    )
    .setColor(0xe67e22)
    .setFooter({
      text: `Challenge ID ${displayId} · ⏱️ ${CHALLENGE_EXPIRE_SECONDS}s · Open`,
    });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`bobozan_accept_${String(card._id)}`)
      .setLabel('⚔️ Accept Challenge')
      .setStyle(ButtonStyle.Success),
  );

  await interaction.reply({
    content: challengeChannelId ? `✅ Challenge **#${displayId}** posted in <#${challengeChannelId}>` : `✅ Challenge **#${displayId}** posted.`,
    ephemeral: true,
  });

  const challengeMsg = await targetChannel.send({ embeds: [embed], components: [row] });
  await DuelCard.updateOne(
    { _id: card._id },
    { $set: { challengeChannelId: targetChannel.id, challengeMessageId: challengeMsg.id } },
  );

  const cardId = String(card._id);
  setTimeout(async () => {
    try {
      const still = await DuelCard.findOneAndUpdate(
        { _id: card._id, status: 'open' },
        { $set: { status: 'expired' } },
        { new: true },
      );
      if (still && !SessionManager.hasActiveSession(user.id)) {
        await challengeMsg.edit({
          embeds: [
            new EmbedBuilder()
              .setTitle(`⚔️ Open Challenge · #${displayId}`)
              .setDescription(`> **${user.displayName}** — no one accepted in time.`)
              .setColor(0x888888)
              .setFooter({ text: `Challenge ID ${displayId} · Expired` }),
          ],
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

  await connectDB();
  if (!isDBConnected()) {
    await interaction.reply({
      content: '❌ **MONGO_URI** is required for Challenge Cards.',
      ephemeral: true,
    });
    return;
  }

  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: '❌ Use this from inside a server only.', ephemeral: true });
    return;
  }

  const challengeChannelId = process.env.BOBOZAN_CHALLENGE_CHANNEL_ID;
  const targetChannel = challengeChannelId
    ? await interaction.client.channels.fetch(challengeChannelId).catch(() => null)
    : interaction.channel;
  const channelToPost = targetChannel instanceof TextChannel ? targetChannel : (interaction.channel as TextChannel);

  if (!channelToPost) {
    await interaction.reply({ content: '❌ Channel not found.', ephemeral: true });
    return;
  }

  const { displayId, seq } = await nextDuelDisplayId(guildId);
  const card = await DuelCard.create({
    guildId,
    displaySeq: seq,
    displayId,
    challengeType: 'targeted',
    challengerId,
    targetUserId: opponent.id,
    status: 'open',
  });

  const embed = new EmbedBuilder()
    .setTitle(`🎯 Target Challenge · #${displayId}`)
    .setDescription(
      `> **${interaction.user.displayName}** has challenged **${opponent.displayName}**!\n\n` +
      `${opponent}, will you accept this duel?`,
    )
    .setColor(0xe74c3c)
    .setFooter({ text: `Challenge ID ${displayId} · ⏱️ ${CHALLENGE_EXPIRE_SECONDS}s` });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`bobozan_accept_${String(card._id)}`)
      .setLabel('✅ Accept')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`bobozan_decline_${String(card._id)}`)
      .setLabel('❌ Decline')
      .setStyle(ButtonStyle.Danger),
  );

  await interaction.update({ content: `✅ Challenge **#${displayId}** sent to ${opponent.displayName}.`, components: [] });
  const challengeMsg = await channelToPost.send({ content: `<@${opponent.id}>`, embeds: [embed], components: [row] });
  await DuelCard.updateOne(
    { _id: card._id },
    { $set: { challengeChannelId: channelToPost.id, challengeMessageId: challengeMsg.id } },
  );

  setTimeout(async () => {
    try {
      const still = await DuelCard.findOneAndUpdate(
        { _id: card._id, status: 'open' },
        { $set: { status: 'expired' } },
        { new: true },
      );
      if (still && !SessionManager.hasActiveSession(challengerId)) {
        await challengeMsg.edit({
          content: '',
          embeds: [
            new EmbedBuilder()
              .setTitle(`🎯 Target Challenge · #${displayId}`)
              .setDescription(`> Challenge expired.`)
              .setColor(0x888888)
              .setFooter({ text: `Challenge ID ${displayId} · Expired` }),
          ],
          components: [],
        });
      }
    } catch {}
  }, CHALLENGE_EXPIRE_MS);
}

// ── Accept / Decline ──────────────────────────────────────────────────

async function handleAcceptChallenge(interaction: ButtonInteraction): Promise<void> {
  const cardIdStr = interaction.customId.replace('bobozan_accept_', '');
  const acceptor = interaction.user;

  if (!isDuelCardObjectId(cardIdStr)) {
    await interaction.reply({
      content: '❌ This challenge is invalid or outdated — please post a new challenge.',
      ephemeral: true,
    });
    return;
  }

  await connectDB();
  if (!isDBConnected()) {
    await interaction.reply({ content: '❌ Database is unavailable.', ephemeral: true });
    return;
  }

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: '❌ Guild not found.', ephemeral: true });
    return;
  }

  const updated = await DuelCard.findOneAndUpdate(
    {
      _id: new Types.ObjectId(cardIdStr),
      status: 'open',
      guildId: guild.id,
      $or: [
        { challengeType: 'open', challengerId: { $ne: acceptor.id } },
        { challengeType: 'targeted', targetUserId: acceptor.id },
      ],
    },
    { $set: { acceptorId: acceptor.id, status: 'accepted' } },
    { new: true },
  );

  if (!updated) {
    const exists = await DuelCard.findById(cardIdStr).lean();
    if (!exists) {
      await interaction.reply({ content: '❌ Challenge card not found.', ephemeral: true });
    } else if (exists.status !== 'open') {
      await interaction.reply({ content: '❌ This challenge was already accepted, expired, or closed.', ephemeral: true });
    } else if (exists.challengeType === 'targeted' && exists.targetUserId !== acceptor.id) {
      await interaction.reply({ content: '❌ Only the challenged player can accept this duel.', ephemeral: true });
    } else {
      await interaction.reply({ content: '❌ You cannot accept your own challenge.', ephemeral: true });
    }
    return;
  }

  const challengerId = updated.challengerId;
  const displayId = updated.displayId;

  if (SessionManager.hasActiveSession(acceptor.id)) {
    await DuelCard.updateOne({ _id: updated._id }, { $set: { status: 'open' }, $unset: { acceptorId: 1 } });
    await interaction.reply({ content: '❌ You are already in a match.', ephemeral: true });
    return;
  }

  if (SessionManager.hasActiveSession(challengerId)) {
    await DuelCard.updateOne({ _id: updated._id }, { $set: { status: 'open' }, $unset: { acceptorId: 1 } });
    await interaction.reply({ content: '❌ The challenger is already in a match.', ephemeral: true });
    return;
  }

  const challenger = await interaction.client.users.fetch(challengerId).catch(() => null);
  if (!challenger) {
    await DuelCard.updateOne({ _id: updated._id }, { $set: { status: 'open' }, $unset: { acceptorId: 1 } });
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

  const adminRoleId = process.env.BOBOZAN_ADMIN_ROLE_ID;
  const prefix = (process.env.BOBOZAN_DUEL_CHANNEL_PREFIX || 'sd').toLowerCase().replace(/[^a-z0-9]/g, '') || 'sd';
  const slugA = duelUsernameSlug(challenger.displayName, challengerId);
  const slugB = duelUsernameSlug(acceptor.displayName, acceptor.id);
  const pubName = `${prefix}${displayId}-combat-log`.toLowerCase().slice(0, 100);
  const privAName = `${prefix}${displayId}-${slugA}`.toLowerCase().slice(0, 100);
  const privBName = `${prefix}${displayId}-${slugB}`.toLowerCase().slice(0, 100);

  const categoryBaseOverwrites: { id: string; allow?: bigint; deny?: bigint }[] = [
    { id: guild.id, deny: PermissionFlagsBits.ViewChannel },
    { id: challengerId, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ReadMessageHistory },
    { id: acceptor.id, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ReadMessageHistory },
  ];
  if (adminRoleId) {
    categoryBaseOverwrites.push({
      id: adminRoleId,
      allow:
        PermissionFlagsBits.ViewChannel |
        PermissionFlagsBits.SendMessages |
        PermissionFlagsBits.ReadMessageHistory |
        PermissionFlagsBits.ManageChannels,
    });
  }

  let category: { id: string };
  let publicChannel: TextChannel;
  let privateAChannel: TextChannel;
  let privateBChannel: TextChannel;

  try {
    category = await guild.channels.create({
      name: `Shadow Duel - ${displayId}`,
      type: ChannelType.GuildCategory,
      permissionOverwrites: categoryBaseOverwrites,
    });

    const pubOver = [
      { id: guild.id, deny: PermissionFlagsBits.ViewChannel },
      {
        id: challengerId,
        allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ReadMessageHistory,
      },
      {
        id: acceptor.id,
        allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ReadMessageHistory,
      },
      ...(adminRoleId
        ? [{ id: adminRoleId, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory }]
        : []),
    ];

    const privAOver = [
      { id: guild.id, deny: PermissionFlagsBits.ViewChannel },
      {
        id: challengerId,
        allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ReadMessageHistory,
      },
      { id: acceptor.id, deny: PermissionFlagsBits.ViewChannel },
      ...(adminRoleId
        ? [{ id: adminRoleId, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory }]
        : []),
    ];

    const privBOver = [
      { id: guild.id, deny: PermissionFlagsBits.ViewChannel },
      { id: challengerId, deny: PermissionFlagsBits.ViewChannel },
      {
        id: acceptor.id,
        allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ReadMessageHistory,
      },
      ...(adminRoleId
        ? [{ id: adminRoleId, allow: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory }]
        : []),
    ];

    publicChannel = (await guild.channels.create({
      name: pubName,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: pubOver,
    })) as TextChannel;

    privateAChannel = (await guild.channels.create({
      name: privAName,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: privAOver,
    })) as TextChannel;

    privateBChannel = (await guild.channels.create({
      name: privBName,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: privBOver,
    })) as TextChannel;
  } catch (err) {
    logger.error('Failed to create duel category/channels:', err);
    SessionManager.removeSession(session);
    await DuelCard.updateOne({ _id: updated._id }, { $set: { status: 'open' }, $unset: { acceptorId: 1 } });
    await interaction.reply({
      content: '❌ Failed to create duel channels — check bot permissions (Manage Channels).',
      ephemeral: true,
    });
    return;
  }

  await DuelCard.updateOne(
    { _id: updated._id },
    {
      $set: {
        status: 'in_match',
        categoryId: category.id,
        publicChannelId: publicChannel.id,
        privateChannelAId: privateAChannel.id,
        privateChannelBId: privateBChannel.id,
      },
    },
  );

  session.attachChannels(publicChannel, privateAChannel, privateBChannel);
  session.setDuelCardMeta(String(updated._id), displayId, guild.id);

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setTitle(`⚔️ Challenge Accepted · #${displayId}`)
        .setDescription(
          `🟥 **${challenger.displayName}**  ╳  🟦 **${acceptor.displayName}**\n\n` +
          `> Duel **#${displayId}** — Combat log: <#${publicChannel.id}>`,
        )
        .setColor(0x2ecc71)
        .setFooter({ text: `Shadow Duel #${displayId}` }),
    ],
    components: [],
  });

  await publicChannel.send({
    content:
      `${challenger} ${acceptor}\n\n` +
      `**Shadow Duel #${displayId}** — This channel is the **Combat Log** (round summary, bug report, and admin tools).\n\n` +
      `🎮 **Choose your class and actions only in your private room:**\n` +
      `• **${challenger.displayName}** → <#${privateAChannel.id}>\n` +
      `• **${acceptor.displayName}** → <#${privateBChannel.id}>\n\n` +
      `_Do not play from this channel — use your private room so your opponent cannot see your choices._`,
  });

  const selectEmbed = buildJobSelectEmbed(challenger.displayName, acceptor.displayName);
  const selectMenu = buildJobSelectMenu();
  await privateAChannel.send({
    content: `${challenger} — Choose your class below (only you can see this channel).`,
    embeds: [selectEmbed],
    components: [selectMenu],
  });
  await privateBChannel.send({
    content: `${acceptor} — Choose your class below (only you can see this channel).`,
    embeds: [selectEmbed],
    components: [selectMenu],
  });

  const cardOid = String(updated._id);
  setTimeout(async () => {
    if (!session.bothJobsSelected) {
      SessionManager.removeSession(session);
      await DuelCard.updateOne({ _id: updated._id }, { $set: { status: 'cancelled' } }).catch(() => {});
      try {
        await deleteDuelChannelShell(guild, {
          categoryId: category.id,
          publicId: publicChannel.id,
          privateAId: privateAChannel.id,
          privateBId: privateBChannel.id,
        });
      } catch {}
    }
  }, 60_000);
}

async function handleDeclineChallenge(interaction: ButtonInteraction): Promise<void> {
  const cardIdStr = interaction.customId.replace('bobozan_decline_', '');
  if (!isDuelCardObjectId(cardIdStr)) {
    await interaction.reply({ content: '❌ This challenge has expired.', ephemeral: true });
    return;
  }

  await connectDB();
  const card = await DuelCard.findById(cardIdStr).lean();
  if (!card || card.status !== 'open' || card.challengeType !== 'targeted') {
    await interaction.reply({
      content: '❌ You cannot decline this (not a targeted challenge or it is already closed).',
      ephemeral: true,
    });
    return;
  }
  if (card.targetUserId !== interaction.user.id) {
    await interaction.reply({ content: '❌ Only the challenged player can decline.', ephemeral: true });
    return;
  }

  await DuelCard.updateOne({ _id: card._id }, { $set: { status: 'declined' } });
  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setTitle(`❌ Challenge declined · #${card.displayId}`)
        .setDescription(`${interaction.user.displayName} declined the challenge.`)
        .setColor(0x888888),
    ],
    components: [],
  });
}

// ── Public Controls (Bug report / Admin end) ─────────────────────────

function isAdmin(interaction: ButtonInteraction): boolean {
  const adminRoleId = process.env.BOBOZAN_ADMIN_ROLE_ID;
  const member = interaction.member as any;

  const hasRole = Boolean(
    adminRoleId &&
      member &&
      member.roles?.cache &&
      typeof member.roles.cache.has === 'function' &&
      member.roles.cache.has(adminRoleId),
  );

  const hasManageChannels = interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) ?? false;
  return hasRole || hasManageChannels;
}

async function handleBugReportButton(interaction: ButtonInteraction): Promise<void> {
  const id = interaction.customId;
  const publicChannelId = id.split(':')[1];
  if (!publicChannelId) {
    await interaction.reply({ content: '❌ Invalid target.', ephemeral: true });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`bobozan_bug_modal:${publicChannelId}`)
    .setTitle('🐞 Shadow Duel Bug Report')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('bug_description')
          .setLabel('Describe the bug (what happened, expected vs actual)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true),
      ),
    );

  await interaction.showModal(modal);
}

async function handleAdminEndMatchButton(interaction: ButtonInteraction): Promise<void> {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '❌ Admins only.', ephemeral: true });
    return;
  }

  const id = interaction.customId;
  const publicChannelId = id.split(':')[1];
  if (!publicChannelId) {
    await interaction.reply({ content: '❌ Invalid target.', ephemeral: true });
    return;
  }

  const session = SessionManager.getSessionByPublicChannelId(publicChannelId);
  if (!session) {
    await interaction.reply({ content: '❌ Match not found (expired).', ephemeral: true });
    return;
  }

  await interaction.deferUpdate().catch(() => {});
  await session.adminEndAsDraw();
  await interaction.followUp({ content: '🏳️ Admin ended match as Draw.', ephemeral: true }).catch(() => {});
}

async function handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.customId.startsWith('bobozan_bug_modal:')) return;

  const publicChannelId = interaction.customId.split(':')[1];
  if (!publicChannelId) {
    await interaction.reply({ content: '❌ Invalid bug target.', ephemeral: true });
    return;
  }

  const bugText = interaction.fields.getTextInputValue('bug_description')?.trim();
  if (!bugText) {
    await interaction.reply({ content: '❌ Bug description is required.', ephemeral: true });
    return;
  }

  const forumId = process.env.SHADOW_DUEL_FORUMS_CHANNEL_ID;
  if (!forumId) {
    await interaction.reply({ content: '❌ Forums channel is not configured in env.', ephemeral: true });
    return;
  }

  if (!interaction.guild) {
    await interaction.reply({ content: '❌ Guild not found.', ephemeral: true });
    return;
  }

  const forumChannel = await interaction.guild.channels.fetch(forumId).catch(() => null);
  if (!forumChannel) {
    await interaction.reply({ content: '❌ Forums channel not found.', ephemeral: true });
    return;
  }

  try {
    const session = SessionManager.getSessionByPublicChannelId(publicChannelId);
    const reporter = interaction.user;

    const content =
      `**Bug report**\n\n` +
      `Reporter: ${reporter} (${reporter.username})\n` +
      `Duel public channel: <#${publicChannelId}>\n` +
      (session ? `Participants: duel is active.\n` : `Participants: session not found (maybe ended).\n`) +
      `\n---\n${bugText}`;

    const createdThread = await (forumChannel as any).threads.create({
      name: `ShadowDuel Bug — ${reporter.username}`,
      autoArchiveDuration: 1440,
      message: { content },
    });

    await interaction.reply({
      content: `✅ Bug submitted. Thread created: ${createdThread?.url ?? createdThread?.name ?? ''}`,
      ephemeral: true,
    });
  } catch (err) {
    await interaction.reply({ content: '❌ Failed to create forums thread. Check bot permissions.', ephemeral: true });
  }
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
    await interaction.deferUpdate().catch(async () => {
      await interaction.reply({ content: '🏳️ You forfeited.', ephemeral: true }).catch(() => {});
    });
  } else {
    await interaction.reply({ content: '❌ Cannot forfeit (match may have ended).', ephemeral: true });
  }
}

async function handleDeleteTempChannel(interaction: ButtonInteraction): Promise<void> {
  const raw = interaction.customId.replace('bobozan_delete_duel_channels:', '');
  let publicChannelId: string | null = null;
  let privateAChannelId: string | null = null;
  let privateBChannelId: string | null = null;
  let categoryId: string | null = null;

  if (isDuelCardObjectId(raw)) {
    await connectDB();
    const card = await DuelCard.findById(raw).lean();
    if (card) {
      publicChannelId = card.publicChannelId ?? null;
      privateAChannelId = card.privateChannelAId ?? null;
      privateBChannelId = card.privateChannelBId ?? null;
      categoryId = card.categoryId ?? null;
    }
  } else {
    const parts = raw.split(':');
    publicChannelId = parts[0] ?? null;
    privateAChannelId = parts[1] ?? null;
    privateBChannelId = parts[2] ?? null;
  }

  if (!publicChannelId || !privateAChannelId || !privateBChannelId) {
    await interaction.reply({ content: '❌ Invalid duel channel target.', ephemeral: true });
    return;
  }

  const adminRoleId = process.env.BOBOZAN_ADMIN_ROLE_ID;
  const member = interaction.member as any;
  const hasRole = Boolean(
    adminRoleId &&
      member &&
      member.roles?.cache &&
      typeof member.roles.cache.has === 'function' &&
      member.roles.cache.has(adminRoleId),
  );
  const hasManageChannels = interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) ?? false;

  if (!hasRole && !hasManageChannels) {
    await interaction.reply({ content: '❌ Admins only.', ephemeral: true });
    return;
  }

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: '❌ Guild not found.', ephemeral: true });
    return;
  }

  await interaction.reply({ content: '🗑️ Deleting duel channels...', ephemeral: true }).catch(() => {});

  await deleteDuelChannelShell(guild, {
    categoryId,
    publicId: publicChannelId,
    privateAId: privateAChannelId,
    privateBId: privateBChannelId,
  });
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
    .setTitle(`${rank.icon} ${target.displayName} — Shadow Duel`)
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
    .setTitle('⚔️ Shadow Duel — Leaderboard')
    .setDescription(lines.join('\n'))
    .setColor(0xd4a574)
    .setFooter({ text: `${top.length} players` });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleHonorButton(interaction: ButtonInteraction): Promise<void> {
  const profile = await LadderProfile.findOne({ userId: interaction.user.id });
  const total = profile?.honorTotal ?? 0;

  const embed = new EmbedBuilder()
    .setTitle('🏅 Shadow Duel — Honor Points')
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
    .setTitle('⚔️ Shadow Duel — Rank Tiers')
    .setDescription(lines.join('\n'))
    .setColor(0xd4a574)
    .setFooter({ text: 'Default starting rating: 1200 (Martial Artist)' });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleRulesButton(interaction: ButtonInteraction): Promise<void> {
  const roundSec = process.env.ROUND_TIMEOUT_SECONDS || '20';
  const bothIdleSec = process.env.ROUND_TIMEOUT_BOTH_IDLE_SECONDS || '60';

  const embed = new EmbedBuilder()
    .setTitle('⚔️ Shadow Duel — Rules')
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

async function handleGuidebookShow(interaction: ButtonInteraction): Promise<void> {
  const id = interaction.customId;
  const jobKey = id.split(':')[1] as keyof typeof Job | undefined;
  if (!jobKey) {
    await interaction.reply({ content: '❌ Invalid guidebook button.', ephemeral: true });
    return;
  }

  const job = (Job as any)[jobKey] as Job | undefined;
  if (!job || !GUIDEBOOK_JOB_ORDER.includes(job)) {
    await interaction.reply({ content: '❌ Invalid class.', ephemeral: true });
    return;
  }

  const embed = buildGuidebookEmbed(job);
  const components = buildGuidebookNavComponents(job);

  // Edit the same persistent embed message. Defer first to avoid interaction timeout.
  await interaction.deferUpdate().catch(() => {});
  await interaction.message.edit({ embeds: [embed], components }).catch(() => {});
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
    try {
      await interaction.message.edit({
        content: '⚔️ Both chose their class. Duel starting!',
        embeds: [],
        components: [],
      });
    } catch {}
    await session.startBattle();
  }
}

