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
  Ultimate = 'ultimate',
  /** Engineer-only: set trap (does NOT consume the round action) */
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
    hp: 5,
    energy: 0,
    ultCost: 2,
    ultName: '万剑归宗',
    passiveName: '剑意',
    passiveDesc: '连续聚气2次后，下一次出招获得先手优先权',
    ultDesc: '本回合同时执行攻击与防御',
  },
  [Job.Bladesman]: {
    hp: 6,
    energy: 0,
    ultCost: 1,
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
    hp: 7,
    energy: 0,
    ultCost: 1,
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
    name: 'Swordsman',
    passiveDesc: 'After 2 consecutive Charges, next Attack gains First Strike priority.',
    ultDesc: 'This round: execute both Attack AND Defend.',
  },
  [Job.Bladesman]: {
    name: 'Bladesman',
    passiveDesc: 'When HP ≤ 2, Attack costs 0 energy but Defend is disabled.',
    ultDesc: 'Take 1 HP self-damage, gain 2 energy; this round\'s attack pierces defense.',
  },
  [Job.Assassin]: {
    name: 'Assassin',
    passiveDesc: 'Each successful Defend grants +1 bonus energy.',
    ultDesc: 'If opponent defends → they are banned from attacking next round. If not → guaranteed 1 damage.',
  },
  [Job.IronMonk]: {
    name: 'Iron Monk',
    passiveDesc: 'Each successful Defend drains 1 energy from the opponent.',
    ultDesc: 'Force a draw this round. Next round, opponent can only Charge or Defend.',
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
