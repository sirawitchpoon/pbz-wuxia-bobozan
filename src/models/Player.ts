import { Job, Action, JOB_STATS } from './enums';
import { Effect } from './Effect';

export class Player {
  public readonly userId: string;
  public readonly displayName: string;
  public readonly job: Job;

  public hp: number;
  public readonly maxHp: number;
  public energy: number;

  /** Swordsman: consecutive Charge count for Sword Intent */
  public consecutiveCharges: number = 0;
  /** Set when Sword Intent triggers — consumed by resolver */
  public hasFirstStrike: boolean = false;

  /** Engineer: parts inventory for trap setting */
  public parts: number = 0;
  /** Engineer: hidden trap deployed (invisible to opponent) */
  public trapActive: boolean = false;

  public effects: Effect[] = [];

  public action: Action | null = null;
  public actionLocked: boolean = false;

  /** Whether this player also wants to set a trap this round (Engineer only) */
  public wantsSetTrap: boolean = false;

  // --- Flags set during resolution (reset each round) ---
  public ironMonkUlt: boolean = false;
  public swordsmanUlt: boolean = false;
  public piercing: boolean = false;
  public assassinUlt: boolean = false;

  // --- Lifetime stats (accumulated across rounds, consumed by honor calc) ---
  public statDamageDealt: number = 0;
  public statUltsUsed: number = 0;
  public statDefendsSuccess: number = 0;

  constructor(userId: string, displayName: string, job: Job) {
    this.userId = userId;
    this.displayName = displayName;
    this.job = job;

    const stats = JOB_STATS[job];
    this.hp = stats.hp;
    this.maxHp = stats.hp;
    this.energy = stats.energy;
  }

  hasEffect(name: string): boolean {
    return this.effects.some(e => e.name === name);
  }

  getEffect(name: string): Effect | undefined {
    return this.effects.find(e => e.name === name);
  }

  addEffect(effect: Effect): void {
    const existing = this.getEffect(effect.name);
    if (existing) {
      existing.duration = Math.max(existing.duration, effect.duration);
    } else {
      this.effects.push(effect);
    }
  }

  removeEffect(name: string): void {
    this.effects = this.effects.filter(e => e.name !== name);
  }

  tickEffects(): void {
    for (const e of this.effects) e.tick();
    this.effects = this.effects.filter(e => !e.expired);
  }

  resetRoundState(): void {
    this.action = null;
    this.actionLocked = false;
    this.wantsSetTrap = false;
    this.ironMonkUlt = false;
    this.swordsmanUlt = false;
    this.piercing = false;
    this.assassinUlt = false;
  }

  get isDead(): boolean {
    return this.hp <= 0;
  }

  takeDamage(amount: number, source: Player): void {
    this.hp = Math.max(0, this.hp - amount);
    source.statDamageDealt += amount;
  }
}
