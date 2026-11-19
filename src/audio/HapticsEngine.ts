/**
 * Dynamic Haptic Feedback Engine for tactile immersion on mobile devices.
 * Uses navigator.vibrate with intelligent cooldown scheduling so layered
 * steering ticks, debris near-miss crackles, planetary gravity swells, and
 * solar perihelion shudders feel crisp and physical without jamming actuators.
 */

export class HapticsEngine {
  private enabled = true;
  private readonly supported: boolean;
  private lastPulseAt = 0;
  private lastHoldTickAt = 0;
  private lastGravityAt = 0;

  constructor() {
    this.supported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  }

  public isSupported(): boolean {
    return this.supported;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(next: boolean): void {
    this.enabled = next;
    if (!next && this.supported) {
      try {
        navigator.vibrate(0);
      } catch {
        // Ignore platform restrictions
      }
    }
  }

  private fire(pattern: number | number[], minGapMs = 60): void {
    if (!this.enabled || !this.supported) return;
    const now = performance.now();
    if (now - this.lastPulseAt < minGapMs) return;
    this.lastPulseAt = now;
    try {
      navigator.vibrate(pattern);
    } catch {
      // Ignore if browser blocks vibration prior to gesture
    }
  }

  public steeringEngage(): void {
    this.fire([14, 18, 8], 40);
    this.lastHoldTickAt = performance.now();
  }

  public steeringHoldTick(): void {
    if (!this.enabled || !this.supported) return;
    const now = performance.now();
    if (now - this.lastHoldTickAt >= 260) {
      this.lastHoldTickAt = now;
      this.fire(8, 120);
    }
  }

  public steeringRelease(): void {
    this.fire(6, 50);
  }

  public debrisNearMiss(intensity: number, isIce: boolean): void {
    const clamped = Math.max(0.2, Math.min(1, intensity));
    if (isIce) {
      // Crisp crystalline high-frequency micro-shatter pattern
      const t1 = Math.round(10 + clamped * 14);
      const t2 = Math.round(8 + clamped * 10);
      this.fire([t1, 16, t2, 14, 8], 130);
    } else {
      // Heavy silicate/basalt grazing thump
      const t1 = Math.round(18 + clamped * 26);
      const t2 = Math.round(12 + clamped * 16);
      this.fire([t1, 22, t2], 150);
    }
  }

  public collisionImpact(intensity: number, isIce: boolean): void {
    const clamped = Math.max(0.35, Math.min(1, intensity));
    if (isIce) {
      // Crisp multi-shard crystalline fracture burst
      const t1 = Math.round(24 + clamped * 18);
      this.fire([t1, 14, 16, 12, 12, 10, 8], 110);
    } else {
      // Heavy rock-on-rock impact crunch followed by chunk rattle
      const t1 = Math.round(36 + clamped * 26);
      const t2 = Math.round(18 + clamped * 14);
      this.fire([t1, 20, t2, 18, 10], 110);
    }
  }

  public gravityWellPulse(strength: number): void {
    if (!this.enabled || !this.supported || strength < 0.22) return;
    const now = performance.now();
    const interval = Math.max(420, 1100 - strength * 600);
    if (now - this.lastGravityAt >= interval) {
      this.lastGravityAt = now;
      const dur = Math.round(16 + strength * 28);
      this.fire([dur, 65, Math.round(dur * 0.6)], 220);
    }
  }

  public perihelionRumble(heat: number): void {
    if (!this.enabled || !this.supported || heat < 0.28) return;
    const now = performance.now();
    const interval = Math.max(240, 620 - heat * 320);
    if (now - this.lastGravityAt >= interval) {
      this.lastGravityAt = now;
      const dur = Math.round(14 + heat * 24);
      this.fire([dur, 28, Math.round(dur * 0.75)], 140);
    }
  }

  public stallShutdown(): void {
    this.fire([55, 38, 42, 46, 26], 100);
  }

  public rechargeComplete(): void {
    this.fire([16, 28, 24], 100);
  }
}
