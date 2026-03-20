import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { Job, JOB_EMOJI, JOB_STATS, JOB_DISPLAY_EN } from '../models/enums';

export type GuidebookJobKey = keyof typeof Job;

export const GUIDEBOOK_JOB_ORDER: Job[] = [
  Job.IronMonk,
  Job.Swordsman, // The Sword
  Job.Bladesman, // The Blade
];

const GUIDEBOOK_ASCII_ART: Record<Job, string> = {
  [Job.Swordsman]: `
  /\\
 /  \\
 |⚔️ |  剑影
 |__/ 
   \\\\`,
  [Job.Bladesman]: `
   /\\
  /  \\
 |🗡️ |  刀锋
 |__/ 
  /`,
  [Job.Assassin]: `
   ___
  / _ \\
 |🥷  |  影步
 |___/ 
   \\`,
  [Job.IronMonk]: `
  [===]
   |🛡️|
  /|   |\\
   |___|
  强稳心`,
  [Job.Engineer]: `
  _[]_
 (⚙️ )   机关
  /|\\
 /_|_\\
  零件阵`,
};

function jobValueToKey(job: Job): GuidebookJobKey {
  for (const [k, v] of Object.entries(Job)) {
    if (v === job) return k as GuidebookJobKey;
  }
  // Should never happen since job comes from GUIDEBOOK_JOB_ORDER.
  return 'Swordsman';
}

export function buildGuidebookEmbed(job: Job): EmbedBuilder {
  const stats = JOB_STATS[job];
  const display = JOB_DISPLAY_EN[job];
  const emoji = JOB_EMOJI[job];

  const breakText = (() => {
    // V3 Break: cost 2 Killing Intent, deals 2 damage, ignores Defend.
    // Then applies a class-specific next-round restriction.
    switch (job) {
      case Job.IronMonk:
        return 'Shatter Strike: After using Break, you cannot Defend next round.';
      case Job.Swordsman:
        return 'Concealed Edge: If your opponent was not Defending, you cannot Charge next round.';
      case Job.Bladesman:
        return 'Armor Rend: Break consumes all Blade Intent this round (stacks reset).';
      default:
        return 'Break: costs 2 Killing Intent, deals 2 damage, and ignores Defend.';
    }
  })();

  return new EmbedBuilder()
    .setTitle(`📖 Guidebook — ${display.name}`)
    .setColor(0xd4a574)
    .setDescription(
      [
        `${emoji} ${display.name}`,
        '',
        `❤️ ${stats.hp} HP  ·  ⚡ Start Killing Intent: ${stats.energy}  ·  🧨 Ult: ${stats.ultName} (cost ${stats.ultCost})`,
        '',
        `◆ **Passive:** ${display.passiveDesc}`,
        `◆ **Ultimate:** ${display.ultDesc}`,
        '',
        '💥 **Break (V3):**',
        `• Cost: 2 Killing Intent`,
        `• Effect: deal 2 damage and **ignore Defend**`,
        `• Class effect: ${breakText}`,
      ].join('\n'),
    )
    .setFooter({ text: 'Use the category buttons to switch sections.' });
}

export function buildGuidebookNavComponents(_currentJob?: Job): ActionRowBuilder<ButtonBuilder>[] {
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  const row = new ActionRowBuilder<ButtonBuilder>();
  // Class selection buttons (shown after category click).
  for (const job of GUIDEBOOK_JOB_ORDER) {
    const key = jobValueToKey(job);
    const display = JOB_DISPLAY_EN[job];
    const emoji = JOB_EMOJI[job];

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`bobozan_guidebook_show:${key}`)
        .setLabel(`${emoji} ${display.name}`)
        .setStyle(ButtonStyle.Secondary),
    );
  }

  components.push(row);
  return components;
}

export function buildGuidebookCategoryNavComponents(): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('bobozan_guidebook_category:classes')
      .setLabel('🧩 Classes')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('bobozan_guidebook_category:combat')
      .setLabel('⚔️ Combat')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('bobozan_guidebook_category:reward')
      .setLabel('🎁 Reward')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('bobozan_guidebook_category:ranks')
      .setLabel('🏷️ Ranks')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('bobozan_guidebook_category:rules')
      .setLabel('📜 Rules')
      .setStyle(ButtonStyle.Primary),
  );

  return [row];
}

export function buildGuidebookCombatNavComponents(): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('bobozan_guidebook_combat:charge').setLabel('Charge').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('bobozan_guidebook_combat:attack').setLabel('Attack').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('bobozan_guidebook_combat:defend').setLabel('Defend').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('bobozan_guidebook_combat:break').setLabel('Break').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('bobozan_guidebook_combat:ultimate').setLabel('Ultimate').setStyle(ButtonStyle.Secondary),
  );

  return [row];
}

export function buildGuidebookRulesNavComponents(): ActionRowBuilder<ButtonBuilder>[] {
  // Rules category: Basics / Time / Full Rules
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('bobozan_guidebook_rules:basics').setLabel('Basics').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('bobozan_guidebook_rules:time').setLabel('Time').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('bobozan_guidebook_rules:full').setLabel('Rules').setStyle(ButtonStyle.Primary),
  );

  return [row];
}

