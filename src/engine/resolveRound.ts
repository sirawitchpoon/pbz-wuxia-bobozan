import { Action, Job } from '../models/enums';
import { Player } from '../models/Player';
import { Effect, EFFECT_ROOTED, EFFECT_ATTACK_BAN, EFFECT_CROSSBOW } from '../models/Effect';

export interface RoundLog {
  round: number;
  entries: string[];
  p1Dead: boolean;
  p2Dead: boolean;
}

/**
 * Deterministic round resolution. Processes one round after both players lock in.
 * Follows a strict 4-level priority pipeline.
 */
export function resolveRound(p1: Player, p2: Player, roundNumber: number): RoundLog {
  const log: string[] = [];

  const a1 = p1.action;
  const a2 = p2.action;

  const isIronMonk = (p: Player) => p.job === Job.IronMonk;
  const isSword = (p: Player) => p.job === Job.Swordsman;
  const isBlade = (p: Player) => p.job === Job.Bladesman;

  const defendingAgainstAttack = (defender: Player, defenderAction: Action | null): boolean => {
    // Phantom Flurry self-defend blocks incoming Attacks only.
    if (defenderAction === Action.Defend) return true;
    return isSword(defender) && defenderAction === Action.Ultimate; // Phantom Flurry
  };

  const attackDamage = (attacker: Player): number => {
    if (isBlade(attacker)) return 1 + attacker.bladeIntent;
    return 1;
  };

  const ultimateDamage = (attacker: Player): number => {
    if (isIronMonk(attacker)) return 2;
    if (isSword(attacker)) return 3;
    if (isBlade(attacker)) return 1 + attacker.bladeIntent;
    return 0;
  };

  const breakDamage = (_attacker: Player): number => 2;

  // Phase 0: reset-ish log for missing actions
  if (a1 === null) log.push(`⏰ ${p1.displayName} did not choose — no action this round.`);
  if (a2 === null) log.push(`⏰ ${p2.displayName} did not choose — no action this round.`);

  // Phase 3: Pre-resolution — Charge gain (+ Blade Intent gain)
  if (a1 === Action.Charge) {
    p1.energy += 1;
    if (isBlade(p1)) p1.bladeIntent = Math.min(3, p1.bladeIntent + 1);
    log.push(`🔵 ${p1.displayName} Charged (+1 Killing Intent)${isBlade(p1) ? `, +1 Blade Intent (now ${p1.bladeIntent})` : ''}.`);
  }
  if (a2 === Action.Charge) {
    p2.energy += 1;
    if (isBlade(p2)) p2.bladeIntent = Math.min(3, p2.bladeIntent + 1);
    log.push(`🔵 ${p2.displayName} Charged (+1 Killing Intent)${isBlade(p2) ? `, +1 Blade Intent (now ${p2.bladeIntent})` : ''}.`);
  }

  // Phase: Blade Defend reset happens before other effects resolve.
  if (isBlade(p1) && a1 === Action.Defend) {
    p1.bladeIntent = 0;
    log.push(`🗡️ ${p1.displayName} Defended — Blade Intent reset.`);
  }
  if (isBlade(p2) && a2 === Action.Defend) {
    p2.bladeIntent = 0;
    log.push(`🗡️ ${p2.displayName} Defended — Blade Intent reset.`);
  }

  // Resolve order: First Strike check (Sword + Keen Eye)
  const p1FirstStrike = isSword(p1) && p1.keenEyeActive && a1 === Action.Attack;
  const p2FirstStrike = isSword(p2) && p2.keenEyeActive && a2 === Action.Attack;

  // After a first-strike Attack resolves, that attacker’s action should not be applied again.
  let p1ActionSim: Action | null = a1;
  let p2ActionSim: Action | null = a2;

  const applyAttack = (attacker: Player, defender: Player, attackerDamage: number, defenderAction: Action | null, label: string): void => {
    if (defendingAgainstAttack(defender, defenderAction)) {
      log.push(`🛡️ ${defender.displayName} blocked the attack (${label}).`);
      defender.statDefendsSuccess++;
      return;
    }
    log.push(`⚔️ ${attacker.displayName} hit for ${attackerDamage} damage (${label}).`);
    defender.takeDamage(attackerDamage, attacker);
  };

  // If both have First Strike (should not happen with only one Sword), fall back to p1 then p2.
  if (p1FirstStrike) {
    p1.keenEyeActive = false; // consumed by Attack
    const dmg = 2; // Keen Eye empowered
    applyAttack(p1, p2, dmg, a2, 'Keen Eye First Strike');
    if (p2.isDead) {
      p1.tickEffects();
      p2.tickEffects();
      p1.resetRoundState();
      p2.resetRoundState();
      return { round: roundNumber, entries: log, p1Dead: p1.isDead, p2Dead: true };
    }
    p1ActionSim = null;
  } else if (p2FirstStrike) {
    p2.keenEyeActive = false;
    const dmg = 2;
    applyAttack(p2, p1, dmg, a1, 'Keen Eye First Strike');
    if (p1.isDead) {
      p1.tickEffects();
      p2.tickEffects();
      p1.resetRoundState();
      p2.resetRoundState();
      return { round: roundNumber, entries: log, p1Dead: true, p2Dead: p2.isDead };
    }
    p2ActionSim = null;
  }

  // Damage from both actions (simultaneous)
  const dealOutgoing = (source: Player, sourceAction: Action | null, target: Player, targetAction: Action | null): void => {
    if (!sourceAction || sourceAction === Action.Charge || sourceAction === Action.Defend || sourceAction === Action.SetTrap) return;

    if (sourceAction === Action.Attack) {
      const dmg = attackDamage(source);
      applyAttack(source, target, dmg, targetAction, 'Attack');
      return;
    }

    if (sourceAction === Action.Break) {
      const dmg = breakDamage(source);
      log.push(`💥 ${source.displayName} used Break for ${dmg} damage (ignores Defend).`);
      target.takeDamage(dmg, source);
      return;
    }

    if (sourceAction === Action.Ultimate) {
      const base = ultimateDamage(source);
      const halved = targetAction === Action.Defend ? Math.floor(base / 2) : base;
      log.push(`🟢 ${source.displayName} used Ultimate for ${halved} damage${targetAction === Action.Defend ? ' (halved by Defend)' : ''}.`);
      target.takeDamage(halved, source);
      return;
    }
  };

  dealOutgoing(p1, p1ActionSim, p2, p2ActionSim);
  dealOutgoing(p2, p2ActionSim, p1, p1ActionSim);

  // Clash: both Attack
  if (p1ActionSim === Action.Attack && p2ActionSim === Action.Attack) {
    p1.energy = Math.max(0, p1.energy - 1);
    p2.energy = Math.max(0, p2.energy - 1);
    log.push(`💥 Clash — both lose 1 Killing Intent.`);
  }

  // Special effects (step 7)
  // Spirit Drain: Iron Monk Defend vs Attack drains 1 from opponent
  if (isIronMonk(p1) && a1 === Action.Defend && a2 === Action.Attack) {
    p2.energy = Math.max(0, p2.energy - 1);
    log.push(`🛡️ Spirit Drain — ${p2.displayName} loses 1 Killing Intent.`);
  }
  if (isIronMonk(p2) && a2 === Action.Defend && a1 === Action.Attack) {
    p1.energy = Math.max(0, p1.energy - 1);
    log.push(`🛡️ Spirit Drain — ${p1.displayName} loses 1 Killing Intent.`);
  }

  // Keen Eye: Sword Defend vs Attack enables First Strike buff
  if (isSword(p1) && a1 === Action.Defend && a2 === Action.Attack) {
    p1.keenEyeActive = true;
    log.push(`👁️ Keen Eye — ${p1.displayName} is primed for the next Attack.`);
  }
  if (isSword(p2) && a2 === Action.Defend && a1 === Action.Attack) {
    p2.keenEyeActive = true;
    log.push(`👁️ Keen Eye — ${p2.displayName} is primed for the next Attack.`);
  }

  // Meridian Lock: Iron Monk Ultimate drains opponent Killing Intent to 0
  if (isIronMonk(p1) && a1 === Action.Ultimate) {
    p2.energy = 0;
    log.push(`🛡️ Meridian Lock — ${p2.displayName}'s Killing Intent is set to 0.`);
  }
  if (isIronMonk(p2) && a2 === Action.Ultimate) {
    p1.energy = 0;
    log.push(`🛡️ Meridian Lock — ${p1.displayName}'s Killing Intent is set to 0.`);
  }

  // Blade Intent consume/reset
  if (isBlade(p1) && (a1 === Action.Attack || a1 === Action.Ultimate || a1 === Action.Break)) {
    // Armor Rend/Attack/Deathblow all consume/reset Blade Intent to 0
    p1.bladeIntent = 0;
  }
  if (isBlade(p2) && (a2 === Action.Attack || a2 === Action.Ultimate || a2 === Action.Break)) {
    p2.bladeIntent = 0;
  }

  // Break penalties / future restrictions
  // Shatter Strike: Iron Monk Break disables Defend next round
  if (isIronMonk(p1) && a1 === Action.Break) p1.cannotDefendNextRoundRoundsLeft = 2;
  if (isIronMonk(p2) && a2 === Action.Break) p2.cannotDefendNextRoundRoundsLeft = 2;

  // Quake Palm penalty: Iron Monk Ultimate disables Defend next round (same debuff in V3 table)
  if (isIronMonk(p1) && a1 === Action.Ultimate) p1.cannotDefendNextRoundRoundsLeft = 2;
  if (isIronMonk(p2) && a2 === Action.Ultimate) p2.cannotDefendNextRoundRoundsLeft = 2;

  // Concealed Edge: Sword Break disables Charge next round if opponent wasn't Defending
  if (isSword(p1) && a1 === Action.Break && a2 !== Action.Defend) p1.cannotChargeNextRoundRoundsLeft = 2;
  if (isSword(p2) && a2 === Action.Break && a1 !== Action.Defend) p2.cannotChargeNextRoundRoundsLeft = 2;

  // HP check
  const p1Dead = p1.isDead;
  const p2Dead = p2.isDead;

  // Tick effects & cleanup state for the next round.
  p1.tickEffects();
  p2.tickEffects();
  p1.resetRoundState();
  p2.resetRoundState();

  return { round: roundNumber, entries: log, p1Dead, p2Dead };
}

// ── Level 1 helpers ─────────────────────────────────────────────────────

function preCheck(player: Player, opponent: Player, log: string[]): void {
  // Rooted effect: force Attack/Ultimate to Charge
  if (player.hasEffect(EFFECT_ROOTED)) {
    if (player.action === Action.Attack || player.action === Action.Ultimate) {
      log.push(`🌿 ${player.displayName} is Rooted — action forced to Charge.`);
      player.action = Action.Charge;
    }
    player.removeEffect(EFFECT_ROOTED);
  }

  // Attack ban: force Attack/Ultimate to Charge
  if (player.hasEffect(EFFECT_ATTACK_BAN)) {
    if (player.action === Action.Attack || player.action === Action.Ultimate) {
      log.push(`🚫 ${player.displayName} is Attack-banned — cannot attack.`);
      player.action = Action.Charge;
    }
  }

  // Engineer trap trigger
  if (opponent.trapActive && player.action !== Action.Defend) {
    log.push(`💥 ${player.displayName} triggered ${opponent.displayName}'s trap! Took 1 damage.`);
    player.takeDamage(1, opponent);
    opponent.trapActive = false;
  }

  // Bladesman Blood Fury passive (HP ≤ 2)
  if (player.job === Job.Bladesman && player.hp <= 2) {
    if (player.action === Action.Defend) {
      log.push(`🩸 ${player.displayName} Blood Fury — HP≤2, cannot Defend, forced to Charge.`);
      player.action = Action.Charge;
    }
    // Attack costs 0 energy (handled in resolveActions)
  }

  // Swordsman consecutive charge tracking
  if (player.job === Job.Swordsman) {
    if (player.action === Action.Charge) {
      player.consecutiveCharges++;
    } else {
      if (player.consecutiveCharges >= 2 && player.action === Action.Attack) {
        player.hasFirstStrike = true;
        log.push(`⚡ ${player.displayName} Sword Intent — gained First Strike!`);
      }
      player.consecutiveCharges = 0;
    }
  }

  // Engineer: set trap if requested and has parts
  if (player.wantsSetTrap && player.job === Job.Engineer && player.parts > 0 && !player.trapActive) {
    player.parts--;
    player.trapActive = true;
    log.push(`⚙️ ${player.displayName} spent 1 part and set a hidden trap.`);
  }
}

// ── Level 2 helpers ─────────────────────────────────────────────────────

function executeUltimate(player: Player, opponent: Player, log: string[]): void {
  const stats = player.job;
  player.statUltsUsed++;

  switch (player.job) {
    case Job.Swordsman:
      // This round: execute both attack AND defend
      player.swordsmanUlt = true;
      log.push(`⚔️ ${player.displayName} used Myriad Swords — attacking and defending this round.`);
      break;

    case Job.Bladesman:
      // Self-damage 1HP, gain 2 energy, piercing this round
      player.hp = Math.max(0, player.hp - 1);
      player.energy += 2;
      player.piercing = true;
      log.push(`🗡️ ${player.displayName} used Forsake All — took 1 HP, +2 energy, attack pierces.`);
      break;

    case Job.Assassin:
      player.assassinUlt = true;
      log.push(`🥷 ${player.displayName} used Flash Kill.`);
      break;

    case Job.IronMonk:
      player.ironMonkUlt = true;
      opponent.addEffect(new Effect(EFFECT_ROOTED, 1, Job.IronMonk));
      log.push(`🛡️ ${player.displayName} used Rooted Tree — draw this round; opponent can only Charge/Defend next.`);
      break;

    case Job.Engineer:
      // Immediate 1 damage + crossbow effect (2 rounds)
      opponent.takeDamage(1, player);
      opponent.addEffect(new Effect(EFFECT_CROSSBOW, 2, Job.Engineer));
      log.push(`⚙️ ${player.displayName} used Repeating Crossbow — 1 damage now, effect 2 rounds.`);
      break;
  }
}

// ── Level 3 helpers ─────────────────────────────────────────────────────

function resolveActions(p1: Player, p2: Player, log: string[]): void {
  // Process charges first
  processCharge(p1, log);
  processCharge(p2, log);

  const p1Attacking = p1.action === Action.Attack || p1.swordsmanUlt;
  const p2Attacking = p2.action === Action.Attack || p2.swordsmanUlt;
  const p1Defending = p1.action === Action.Defend || p1.swordsmanUlt;
  const p2Defending = p2.action === Action.Defend || p2.swordsmanUlt;

  // Assassin ult special resolution
  if (p1.assassinUlt) resolveAssassinUlt(p1, p2, log);
  if (p2.assassinUlt) resolveAssassinUlt(p2, p1, log);

  // Skip normal attack resolution for assassin ult players
  const p1NormalAttack = p1Attacking && !p1.assassinUlt;
  const p2NormalAttack = p2Attacking && !p2.assassinUlt;

  // First Strike priority
  if (p1.hasFirstStrike && p1NormalAttack && p2NormalAttack && !p2.hasFirstStrike) {
    applyAttack(p1, p2, p2Defending, log);
    if (!p2.isDead) applyAttack(p2, p1, p1Defending, log);
    return;
  }
  if (p2.hasFirstStrike && p2NormalAttack && p1NormalAttack && !p1.hasFirstStrike) {
    applyAttack(p2, p1, p1Defending, log);
    if (!p1.isDead) applyAttack(p1, p2, p2Defending, log);
    return;
  }

  // Mutual attack (clash)
  if (p1NormalAttack && p2NormalAttack && !p1Defending && !p2Defending) {
    log.push(`💥 Both attacked — clash! Each took 1 damage, energy reset to 0.`);
    p1.takeDamage(1, p2);
    p2.takeDamage(1, p1);
    p1.energy = 0;
    p2.energy = 0;
    return;
  }

  // Individual attacks
  if (p1NormalAttack) applyAttack(p1, p2, p2Defending, log);
  if (p2NormalAttack) applyAttack(p2, p1, p1Defending, log);
}

function processCharge(player: Player, log: string[]): void {
  if (player.action !== Action.Charge) return;

  player.energy = Math.min(9, player.energy + 1);
  log.push(`🔵 ${player.displayName} Charged (energy: ${player.energy})`);

  // Engineer passive: 50% chance to produce a part
  if (player.job === Job.Engineer) {
    if (Math.random() < 0.5) {
      player.parts++;
      log.push(`⚙️ ${player.displayName} Thousand Devices — +1 part (parts: ${player.parts})`);
    }
  }
}

function applyAttack(attacker: Player, target: Player, targetDefending: boolean, log: string[]): void {
  // Consume energy (Bladesman Blood Fury: free attack at HP ≤ 2)
  const freeAttack = attacker.job === Job.Bladesman && attacker.hp <= 2;
  if (!freeAttack && attacker.action === Action.Attack) {
    attacker.energy = Math.max(0, attacker.energy - 1);
  }

  if (targetDefending && !attacker.piercing) {
    log.push(`🛡️ ${target.displayName} blocked ${attacker.displayName}'s attack.`);
    target.statDefendsSuccess++;
    return;
  }

  if (attacker.piercing && targetDefending) {
    log.push(`🗡️ ${attacker.displayName}'s attack pierced! ${target.displayName} took 1 damage.`);
  } else {
    log.push(`⚔️ ${attacker.displayName} hit! ${target.displayName} took 1 damage.`);
  }
  target.takeDamage(1, attacker);
}

function resolveAssassinUlt(assassin: Player, target: Player, log: string[]): void {
  const targetDefending = target.action === Action.Defend || target.swordsmanUlt;

  if (targetDefending) {
    target.addEffect(new Effect(EFFECT_ATTACK_BAN, 1, Job.Assassin));
    log.push(`🥷 ${assassin.displayName} Flash Kill — ${target.displayName} defended; attack banned 1 round.`);
    target.statDefendsSuccess++;
  } else {
    target.takeDamage(1, assassin);
    log.push(`🥷 ${assassin.displayName} Flash Kill hit! ${target.displayName} took 1 damage.`);
  }
}

// ── Level 4 helpers ─────────────────────────────────────────────────────

function postCheck(player: Player, opponent: Player, log: string[]): void {
  const playerDefended = player.action === Action.Defend || player.swordsmanUlt;
  if (!playerDefended) return;

  // Assassin passive: +1 energy on successful defend
  if (player.job === Job.Assassin) {
    player.energy = Math.min(9, player.energy + 1);
    log.push(`🥷 ${player.displayName} Shadow Step — defended, +1 energy (energy: ${player.energy})`);
  }

  // Iron Monk passive: drain 1 opponent energy on successful defend
  if (player.job === Job.IronMonk && opponent.energy > 0) {
    opponent.energy = Math.max(0, opponent.energy - 1);
    log.push(`🛡️ ${player.displayName} Counter Shock — drained 1 opponent energy (opponent: ${opponent.energy})`);
  }
}

function crossbowCheck(target: Player, source: Player, log: string[]): void {
  const crossbow = target.getEffect(EFFECT_CROSSBOW);
  if (!crossbow) return;

  // If target did NOT attack this round, deal 1 damage
  const attacked = target.action === Action.Attack || target.assassinUlt;
  if (!attacked) {
    target.takeDamage(1, source);
    log.push(`⚙️ Crossbow triggered — ${target.displayName} did not attack, took 1 damage.`);
  }
}
