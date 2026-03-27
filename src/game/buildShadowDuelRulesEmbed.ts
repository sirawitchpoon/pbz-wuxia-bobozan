import { EmbedBuilder } from 'discord.js';

/** Shared rules embed for hub channel + Rules button (keep in sync). */
export function buildShadowDuelRulesEmbed(): EmbedBuilder {
  const roundSec = process.env.ROUND_TIMEOUT_SECONDS || '20';
  const bothIdleSec = process.env.ROUND_TIMEOUT_BOTH_IDLE_SECONDS || '60';

  return new EmbedBuilder()
    .setTitle('⚔️ Shadow Duel — Rules')
    .setColor(0xd4a574)
    .setDescription('1v1 simultaneous-turn duel inspired by Chinese martial arts.')
    .addFields(
      {
        name: '🎮 Basics',
        value: [
          '• Both players pick an action **at the same time** each round; your opponent **cannot see** your choice.',
          '• Weapons: **The Shield**, **The Sword**, **The Blade** — HP and passives differ.',
          '• **Killing Intent** is your action resource (shown as ⚡). HP **0** = loss; both **0** = draw.',
        ].join('\n'),
      },
      {
        name: '🔵 Charge',
        value: '+1 **Killing Intent**. **The Blade** also gains +1 **Blade Intent** (stacks 0–3).',
      },
      {
        name: '🔴 Attack',
        value:
          'Costs **1 Killing Intent**. Base **1** damage (**Blade**: +Blade Intent). Blocked if opponent **Defends** (or Sword **Ultimate** self-defend). **Both Attack** → clash: **1** damage each; each loses **1** more Killing Intent.',
      },
      {
        name: '⚪ Defend',
        value: 'Blocks **Attack**. **Ultimates** are **halved** (rounded down), not fully blocked. Does **not** stop **Break**.',
      },
      {
        name: '💥 Break',
        value: [
          'Costs **2 Killing Intent**, deals **2** damage, **ignores Defend**.',
          '• **The Shield — Shatter Strike:** you cannot **Defend** next round.',
          '• **The Sword — Concealed Edge:** if the opponent was **not** Defending, you cannot **Charge** next round.',
          '• **The Blade — Armor Rend:** consumes **Blade Intent** (same round reset as Attack/Ult).',
        ].join('\n'),
      },
      {
        name: '🟢 Ultimate',
        value:
          '**3 Killing Intent**, weapon-specific (see Guidebook). **The Shield — Meridian Lock** also sets opponent Killing Intent to **0** after damage.',
      },
      {
        name: '⏱️ Time',
        value: `${roundSec}s per round. No choice = **loss**. If **both** are idle, ${bothIdleSec}s extra grace, then **draw**.`,
      },
    );
}

export type ShadowDuelRulesSection =
  | 'basics'
  | 'charge'
  | 'attack'
  | 'defend'
  | 'break'
  | 'ultimate'
  | 'time'
  | 'full';

export function buildShadowDuelRulesSectionEmbed(section: ShadowDuelRulesSection | string): EmbedBuilder {
  const roundSec = process.env.ROUND_TIMEOUT_SECONDS || '20';
  const bothIdleSec = process.env.ROUND_TIMEOUT_BOTH_IDLE_SECONDS || '60';

  // Be defensive: customId parsing / old component versions could pass unexpected casing.
  const normalized = String(section).toLowerCase();

  if (normalized === 'full') return buildShadowDuelRulesEmbed();

  const base = new EmbedBuilder().setColor(0xd4a574).setDescription('—');

  switch (normalized) {
    case 'basics':
      return base
        .setTitle('🎮 Basics')
        .setDescription([
          '• Both players pick an action **at the same time** each round; your opponent **cannot see** your choice.',
          '• Weapons: **The Shield**, **The Sword**, **The Blade** — HP and passives differ.',
          '• **Killing Intent** (⚡) is your action resource. HP **0** = loss; both **0** = draw.',
        ].join('\n'));

    case 'charge':
      return base
        .setTitle('🔵 Charge')
        .setDescription([
          '+1 **Killing Intent**.',
          '**The Blade** also gains +1 **Blade Intent** (stacks 0–3).',
        ].join('\n'));

    case 'attack':
      return base
        .setTitle('🔴 Attack')
        .setDescription([
          'Costs **1 Killing Intent** and deals **1** damage.',
          '**The Blade** deals (**1 + Blade Intent**) damage.',
          'Blocked if the opponent **Defends** (or Sword **Ultimate** self-defend).',
          '**Both Attack** → clash: each takes **1** damage and each loses **1** more Killing Intent.',
        ].join('\n'));

    case 'defend':
      return base
        .setTitle('⚪ Defend')
        .setDescription([
          'Blocks **Attack**.',
          'Ultimates are **halved** (rounded down), not fully blocked.',
          'Does **not** stop **Break** (Break still ignores Defend).',
          'May trigger weapon passives.',
        ].join('\n'));

    case 'ultimate':
      return base
        .setTitle('🟢 Ultimate')
        .setDescription([
          '**3 Killing Intent**, weapon-specific (see Guidebook).',
          '',
          'The Shield — Meridian Lock: deal **2** damage (halved by Defend → 1). After damage, set opponent Killing Intent to **0**.',
          'The Sword — Phantom Flurry: deal **3** damage (halved by Defend → 1). The Sword also **self-defends this round** (blocks incoming Attacks only).',
          'The Blade — Deathblow: deal **(1 + Blade Intent)** damage (halved by Defend → rounded down).',
        ].join('\n'));

    case 'break':
      return base
        .setTitle('💥 Break')
        .setDescription([
          'Costs **2 Killing Intent**, deals **2** damage, and **ignores Defend**.',
          '',
          'The Shield — Shatter Strike: you cannot **Defend** next round.',
          'The Sword — Concealed Edge: if the opponent was **not Defending**, you cannot **Charge** next round.',
          'The Blade — Armor Rend: **consumes all Blade Intent** this round (stacks reset).',
        ].join('\n'));

    case 'time':
      return base
        .setTitle('⏱️ Time')
        .setDescription([
          `${roundSec}s per round to choose. No choice = **loss**.`,
          `If **both** don’t choose in time, you get ${bothIdleSec}s extra grace, then **draw**.`,
        ].join('\n'));

    default:
      return base
        .setTitle('⚔️ Shadow Duel — Rules')
        .setDescription(`Invalid rules section: \`${normalized}\``);
  }
}
