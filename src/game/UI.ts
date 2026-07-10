export interface HudState {
  health: number;
  maxHealth: number;
  score: number;
  ammo: number;
  maxAmmo: number;
  reloading: boolean;
  enemyCount: number;
}

export class UI {
  private readonly root = document.createElement('div');
  private readonly scoreValue: HTMLElement;
  private readonly ammoValue: HTMLElement;
  private readonly healthFill: HTMLElement;
  private readonly healthValue: HTMLElement;
  private readonly enemyValue: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly overlayTitle: HTMLElement;
  private readonly overlaySubtitle: HTMLElement;
  private readonly startButton: HTMLButtonElement;
  private readonly restartButton: HTMLButtonElement;
  private startHandler: (() => void) | null = null;
  private restartHandler: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.root.className = 'ui-layer';
    this.root.innerHTML = `
      <div class="crosshair" aria-hidden="true">
        <span></span><span></span><span></span><span></span>
      </div>

      <div class="hud-panel">
        <div class="pilot-avatar" aria-hidden="true">
          <div class="avatar-hair"></div>
          <div class="avatar-face">
            <span class="avatar-eye left"></span>
            <span class="avatar-eye right"></span>
          </div>
        </div>
        <div class="hud-stack">
          <div class="hud-row"><span>HP</span><strong data-ui="health-value">100</strong></div>
          <div class="health-track"><span data-ui="health-fill"></span></div>
          <div class="hud-row"><span>SCORE</span><strong data-ui="score">0</strong></div>
          <div class="hud-row"><span>AMMO</span><strong data-ui="ammo">24/24</strong></div>
          <div class="hud-row"><span>TARGET</span><strong data-ui="enemy-count">0</strong></div>
        </div>
      </div>

      <button class="restart-button" type="button">重新開始</button>

      <div class="game-overlay">
        <div class="overlay-art" aria-hidden="true"></div>
        <div class="overlay-panel">
          <h1 data-ui="overlay-title">Starlight Arena</h1>
          <p data-ui="overlay-subtitle">明亮訓練基地已準備完成</p>
          <button class="primary-button" type="button" data-ui="start-button">開始訓練</button>
        </div>
      </div>
    `;

    container.append(this.root);

    this.scoreValue = this.getElement('[data-ui="score"]');
    this.ammoValue = this.getElement('[data-ui="ammo"]');
    this.healthFill = this.getElement('[data-ui="health-fill"]');
    this.healthValue = this.getElement('[data-ui="health-value"]');
    this.enemyValue = this.getElement('[data-ui="enemy-count"]');
    this.overlay = this.getElement('.game-overlay');
    this.overlayTitle = this.getElement('[data-ui="overlay-title"]');
    this.overlaySubtitle = this.getElement('[data-ui="overlay-subtitle"]');
    this.startButton = this.getElement<HTMLButtonElement>('[data-ui="start-button"]');
    this.restartButton = this.getElement<HTMLButtonElement>('.restart-button');

    this.startButton.addEventListener('click', () => this.startHandler?.());
    this.restartButton.addEventListener('click', () => this.restartHandler?.());
  }

  bindStart(handler: () => void): void {
    this.startHandler = handler;
  }

  bindRestart(handler: () => void): void {
    this.restartHandler = handler;
  }

  showMenu(): void {
    this.overlay.classList.remove('hidden');
    this.setOverlayOutcome(null);
    this.overlayTitle.textContent = 'Starlight Arena';
    this.overlaySubtitle.textContent = '明亮訓練基地已準備完成';
    this.startButton.textContent = '開始訓練';
  }

  showPlaying(): void {
    this.setOverlayOutcome(null);
    this.overlay.classList.add('hidden');
  }

  showGameOver(score: number): void {
    this.overlay.classList.remove('hidden');
    this.setOverlayOutcome('defeat');
    this.overlayTitle.textContent = '訓練失敗';
    this.overlaySubtitle.textContent = `SCORE ${score}`;
    this.startButton.textContent = '再次開始';
  }

  showVictory(score: number): void {
    this.overlay.classList.remove('hidden');
    this.setOverlayOutcome('victory');
    this.overlayTitle.textContent = '訓練完成';
    this.overlaySubtitle.textContent = `SCORE ${score}`;
    this.startButton.textContent = '再來一局';
  }

  setAimMode(active: boolean): void {
    this.root.classList.toggle('aiming', active);
  }

  update(state: HudState): void {
    const healthPercent = Math.max(0, Math.min(1, state.health / state.maxHealth));

    this.healthFill.style.width = `${healthPercent * 100}%`;
    this.healthValue.textContent = Math.ceil(state.health).toString();
    this.scoreValue.textContent = state.score.toString();
    this.ammoValue.textContent = state.reloading ? 'LOAD' : `${state.ammo}/${state.maxAmmo}`;
    this.enemyValue.textContent = state.enemyCount.toString();
  }

  private getElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);

    if (!element) {
      throw new Error(`UI element was not found: ${selector}`);
    }

    return element;
  }

  private setOverlayOutcome(outcome: 'victory' | 'defeat' | null): void {
    this.overlay.classList.toggle('victory', outcome === 'victory');
    this.overlay.classList.toggle('defeat', outcome === 'defeat');
  }
}
