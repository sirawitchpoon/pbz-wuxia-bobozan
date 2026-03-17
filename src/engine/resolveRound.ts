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

  // No action (e.g. timeout): treat as did nothing this round
  if (p1.action === null) {
    log.push(`⏰ ${p1.displayName} did not choose in time — no action this round.`);
  }
  if (p2.action === null) {
    log.push(`⏰ ${p2.displayName} did not choose in time — no action this round.`);
  }

  // ── Level 1: Pre-Check ──────────────────────────────────────────────
  preCheck(p1, p2, log);
  preCheck(p2, p1, log);

  // ── Level 2: Buffs / Ultimates ──────────────────────────────────────
  if (p1.action === Action.Ultimate) executeUltimate(p1, p2, log);
  if (p2.action === Action.Ultimate) executeUltimate(p2, p1, log);

  // Iron Monk ult: skip all Level 3 damage
  const skipDamage = p1.ironMonkUlt || p2.ironMonkUlt;

  // ── Level 3: Actions ────────────────────────────────────────────────
  if (!skipDamage) {
    resolveActions(p1, p2, log);
  } else {
    log.push('🛡️ Iron Monk ult — forced draw this round.');
  }

  // ── Level 4: Post-Check ─────────────────────────────────────────────
  postCheck(p1, p2, log);
  postCheck(p2, p1, log);

  // Crossbow delayed damage
  crossbowCheck(p1, p2, log);
  crossbowCheck(p2, p1, log);

  // Death check
  const p1Dead = p1.isDead;
  const p2Dead = p2.isDead;

  // Tick effects & reset
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
