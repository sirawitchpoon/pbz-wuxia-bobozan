export enum Job {
  Swordsman = '剑客',
  Bladesman = '刀客',
  Assassin = '刺客',
  IronMonk = '硬气功',
  Engineer = '机关士',
}

export enum Action {
  Charge = 'charge',
  Attack = 'attack',
  Defend = 'defend',
  /** V3: Break (cost 2 Killing Intent, deals 2 dmg ignoring Defend). */
  Break = 'break',
  Ultimate = 'ultimate',
  /** Legacy: Engineer-only trap (unused in V3). */
  SetTrap = 'set_trap',
}

export interface JobStats {
  hp: number;
  energy: number;
  ultCost: number;
  ultName: string;
  passiveName: string;
  passiveDesc: string;
  ultDesc: string;
}

export const JOB_STATS: Record<Job, JobStats> = {
  [Job.Swordsman]: {
    hp: 5, // V3 The Sword
    energy: 0,
    ultCost: 3,
    ultName: 'Phantom Flurry',
    passiveName: 'Keen Eye',
    passiveDesc: 'After a successful Defend vs Attack, your next Attack gains First Strike and deals 2 damage.',
    ultDesc: 'Deal 3 damage and self-Defend this round (blocks incoming Attacks only).',
  },
  [Job.Bladesman]: {
    hp: 6, // V3 The Blade
    energy: 0,
    ultCost: 3,
    ultName: 'Deathblow',
    passiveName: 'Blade Intent',
    passiveDesc: 'Charge builds Blade Intent (0-3). Defend or Armor Rend resets stacks to 0.',
    ultDesc: 'Consume all Blade Intent and deal (1 + stacks) damage (halved by Defend, rounded down).',
  },
  [Job.Assassin]: {
    hp: 3,
    energy: 1,
    ultCost: 2,
    ultName: 'Shadow Strike',
    passiveName: 'Shadow Step',
    passiveDesc: 'Each successful Defend grants +1 Killing Intent.',
    ultDesc: 'If opponent Defends: they cannot Attack next round. Otherwise: guaranteed 1 damage.',
  },
  [Job.IronMonk]: {
    hp: 6, // V3 Iron Monk
    energy: 0,
    ultCost: 3,
    ultName: 'Meridian Lock',
    passiveName: 'Spirit Drain',
    passiveDesc: 'When The Shield successfully Defends an Attack, drain 1 Killing Intent from the opponent.',
    ultDesc: 'Deal 2 damage (halved by Defend to 1), then set opponent Killing Intent to 0.',
  },
  [Job.Engineer]: {
    hp: 4,
    energy: 0,
    ultCost: 2,
    ultName: 'Crossbow Volley',
    passiveName: 'Thousand Devices',
    passiveDesc: 'Each Charge has a 50% chance to gain 1 Part; Parts can set hidden Traps.',
    ultDesc: 'Deal 1 immediate damage. For 2 rounds, if opponent does not Attack, deal +1 extra damage each round.',
  },
};

export const JOB_EMOJI: Record<Job, string> = {
  [Job.Swordsman]: '⚔️',
  [Job.Bladesman]: '🗡️',
  [Job.Assassin]: '🥷',
  [Job.IronMonk]: '🛡️',
  [Job.Engineer]: '⚙️',
};

/** English display names and descriptions for global servers */
export const JOB_DISPLAY_EN: Record<Job, { name: string; passiveDesc: string; ultDesc: string }> = {
  [Job.Swordsman]: {
    name: 'The Sword',
    passiveDesc:
      'Keen Eye: After a successful Defend vs Attack, your next Attack gains First Strike and deals 2 damage instead of 1.',
    ultDesc:
      'Phantom Flurry: Deal 3 damage and gain self-Defend this round (blocks incoming Attacks only). If halved by Defend: 1 damage.',
  },
  [Job.Bladesman]: {
    name: 'The Blade',
    passiveDesc:
      'Blade Intent (0–3): Gain +1 stack on Charge (plus Killing Intent). Defend or Armor Rend resets stacks to 0. Attack/Deathblow consumes all stacks to boost damage.',
    ultDesc:
      'Deathblow: Consumes all Blade Intent and deals (1 + stacks) damage. If halved by Defend, rounded down.',
  },
  [Job.Assassin]: {
    name: 'Assassin',
    passiveDesc: 'Each successful Defend grants +1 Killing Intent.',
    ultDesc: 'If opponent defends → they are banned from attacking next round. If not → guaranteed 1 damage.',
  },
  [Job.IronMonk]: {
    name: 'The Shield',
    passiveDesc:
      'Spirit Drain: When The Shield successfully Defends an Attack, drain 1 Killing Intent from the opponent.',
    ultDesc:
      'Meridian Lock: Deal 2 damage (halved by Defend → 1). After damage, set opponent Killing Intent to 0.',
  },
  [Job.Engineer]: {
    name: 'Engineer',
    passiveDesc: 'Each Charge has 50% chance to produce a Part. Parts can be spent to set hidden Traps.',
    ultDesc: 'Deal 1 damage immediately. For 2 rounds, if opponent does not attack, deal 1 extra damage per round.',
  },
};

export function getJobDisplayNameEn(jobValue: string): string {
  for (const k of Object.keys(Job) as (keyof typeof Job)[]) {
    if (Job[k] === jobValue) return JOB_DISPLAY_EN[Job[k]].name;
  }
  return jobValue;
}
