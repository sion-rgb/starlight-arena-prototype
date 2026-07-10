type BrowserWindowWithAudioPrefix = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

export class AudioSystem {
  private context?: AudioContext;

  async resume(): Promise<void> {
    const context = this.ensureContext();

    if (context.state === 'suspended') {
      await context.resume();
    }
  }

  playShot(): void {
    const context = this.ensureContext();
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(620, now);
    oscillator.frequency.exponentialRampToValueAtTime(160, now + 0.08);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.11);
  }

  playHit(): void {
    this.playTone(860, 0.07, 'triangle', 0.12, 0.04, 1280);
  }

  playEnemyDown(): void {
    this.playTone(480, 0.11, 'square', 0.1, 0, 760);
    this.playTone(920, 0.13, 'triangle', 0.08, 0.04, 520);
  }

  playDamage(): void {
    this.playTone(120, 0.15, 'sawtooth', 0.16, 0, 80);
  }

  playEmpty(): void {
    this.playTone(180, 0.05, 'square', 0.07);
  }

  playReload(): void {
    this.playTone(360, 0.06, 'triangle', 0.08);
    this.playTone(640, 0.08, 'triangle', 0.08, 0.08);
  }

  private ensureContext(): AudioContext {
    if (this.context) {
      return this.context;
    }

    const AudioContextConstructor =
      window.AudioContext ?? (window as BrowserWindowWithAudioPrefix).webkitAudioContext;

    if (!AudioContextConstructor) {
      throw new Error('Web Audio API is not available in this browser.');
    }

    this.context = new AudioContextConstructor();
    return this.context;
  }

  private playTone(
    frequency: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    delay = 0,
    endFrequency?: number,
  ): void {
    const context = this.ensureContext();
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);

    if (endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
    }

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }
}
