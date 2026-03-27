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

export const EFFECT_ROOTED = 'Rooted';
export const EFFECT_ATTACK_BAN = 'Attack Ban';
export const EFFECT_CROSSBOW = 'Crossbow';
