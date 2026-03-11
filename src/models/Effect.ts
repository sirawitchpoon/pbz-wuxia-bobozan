import { Job } from './enums';

export class Effect {
  constructor(
    public readonly name: string,
    public duration: number,
    public readonly sourceJob: Job,
    public readonly data: Record<string, unknown> = {},
  ) {}

  tick(): void {
    if (this.duration > 0) this.duration--;
  }

  get expired(): boolean {
    return this.duration <= 0;
  }

  clone(): Effect {
    return new Effect(this.name, this.duration, this.sourceJob, { ...this.data });
  }
}

export const EFFECT_ROOTED = '盘根';
export const EFFECT_ATTACK_BAN = '禁招';
export const EFFECT_CROSSBOW = '连弩';
