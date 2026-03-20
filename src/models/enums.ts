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
    ultName: '万剑归宗',
    passiveName: '剑意',
    passiveDesc: '连续聚气2次后，下一次出招获得先手优先权',
    ultDesc: '本回合同时执行攻击与防御',
  },
  [Job.Bladesman]: {
    hp: 6, // V3 The Blade
    energy: 0,
    ultCost: 3,
    ultName: '弃守狂刀',
    passiveName: '嗜血',
    passiveDesc: 'HP≤2时，出招不耗气，但无法防御',
    ultDesc: '自伤1HP，获得2气，本回合攻击无视防御',
  },
  [Job.Assassin]: {
    hp: 3,
    energy: 1,
    ultCost: 2,
    ultName: '闪杀',
    passiveName: '影步',
    passiveDesc: '每次成功防御额外获得+1气',
    ultDesc: '对手防御→禁招1回合；对手未防御→必中1伤害',
  },
  [Job.IronMonk]: {
    hp: 6, // V3 Iron Monk
    energy: 0,
    ultCost: 3,
    ultName: '盘根不动',
    passiveName: '震劲',
    passiveDesc: '成功防御时消耗对手1气',
    ultDesc: '本回合强制平局，下回合对手只能聚气或防御',
  },
  [Job.Engineer]: {
    hp: 4,
    energy: 0,
    ultCost: 2,
    ultName: '连弩',
    passiveName: '千机',
    passiveDesc: '每次聚气有50%几率获得1零件，可消耗零件设置隐藏陷阱',
    ultDesc: '立即造成1伤害，接下来2回合若对手未出招则每回合额外1伤害',
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
    name: 'Iron Monk',
    passiveDesc:
      'Spirit Drain: When Iron Monk successfully Defends an Attack, drain 1 Killing Intent from the opponent.',
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
