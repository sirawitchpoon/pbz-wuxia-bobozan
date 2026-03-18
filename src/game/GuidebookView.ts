import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { Job, JOB_EMOJI, JOB_STATS, JOB_DISPLAY_EN } from '../models/enums';

export type GuidebookJobKey = keyof typeof Job;

export const GUIDEBOOK_JOB_ORDER: Job[] = [
  Job.Swordsman,
  Job.Bladesman,
  Job.Assassin,
  Job.IronMonk,
  Job.Engineer,
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

  const ascii = GUIDEBOOK_ASCII_ART[job].trimEnd();

  return new EmbedBuilder()
    .setTitle(`📖 Guidebook — ${display.name}`)
    .setColor(0xd4a574)
    .setDescription(
      [
        `${emoji} ${display.name}`,
        '',
        '```',
        ascii,
        '```',
        '',
        `❤️ ${stats.hp} HP  ·  ⚡ Start Energy: ${stats.energy}  ·  🧨 Ult: ${stats.ultName} (cost ${stats.ultCost})`,
        '',
        `◆ **Passive:** ${display.passiveDesc}`,
        `◆ **Ultimate:** ${display.ultDesc}`,
      ].join('\n'),
    )
    .setFooter({ text: `Use ◀️/▶️ to switch class · ${jobValueToKey(job)}` });
}

export function buildGuidebookNavComponents(currentJob: Job): ActionRowBuilder<ButtonBuilder>[] {
  const currentIdx = GUIDEBOOK_JOB_ORDER.findIndex(j => j === currentJob);
  const currentKey = jobValueToKey(currentJob);

  const prevJob = currentIdx > 0 ? GUIDEBOOK_JOB_ORDER[currentIdx - 1] : null;
  const nextJob = currentIdx < GUIDEBOOK_JOB_ORDER.length - 1 ? GUIDEBOOK_JOB_ORDER[currentIdx + 1] : null;

  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  const row = new ActionRowBuilder<ButtonBuilder>();

  if (prevJob) {
    const key = jobValueToKey(prevJob);
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`bobozan_guidebook_show:${key}`)
        .setLabel('◀️ Prev')
        .setStyle(ButtonStyle.Secondary),
    );
  } else {
    // Keep a consistent layout even on first page.
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`bobozan_guidebook_show:${currentKey}`)
        .setLabel('◀️ Prev')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
    );
  }

  if (nextJob) {
    const key = jobValueToKey(nextJob);
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`bobozan_guidebook_show:${key}`)
        .setLabel('Next ▶️')
        .setStyle(ButtonStyle.Primary),
    );
  } else {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`bobozan_guidebook_show:${currentKey}`)
        .setLabel('Next ▶️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true),
    );
  }

  components.push(row);
  return components;
}

