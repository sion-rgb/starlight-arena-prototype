import type { Axis2 } from './MobileControls';
import { MobileControls } from './MobileControls';

const MOVEMENT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
const CONTROL_KEYS = new Set([
  ...MOVEMENT_KEYS,
  'ShiftLeft',
  'ShiftRight',
  'KeyV',
  'KeyC',
  'KeyR',
  'F2',
  'F3',
]);

export class InputController {
  private readonly pressedKeys = new Set<string>();
  private readonly mouseDelta: Axis2 = { x: 0, y: 0 };
  private readonly lockSurface: HTMLElement;
  private firingHeld = false;
  private fireQueued = false;
  private aimingHeld = false;
  private cameraToggleQueued = false;
  private reloadQueued = false;
  private pointerLocked = false;
  private mouseLookActive = false;
  private lastMouseX: number | null = null;
  private lastMouseY: number | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly mobileControls: MobileControls,
  ) {
    this.lockSurface = this.canvas.parentElement ?? this.canvas;
    this.canvas.tabIndex = 0;
    this.bindKeyboard();
    this.bindMouse();
  }

  getMoveAxis(): Axis2 {
    const mobileAxis = this.mobileControls.getMoveAxis();
    let x = mobileAxis.x;
    let y = mobileAxis.y;

    if (this.pressedKeys.has('KeyW')) {
      y += 1;
    }

    if (this.pressedKeys.has('KeyS')) {
      y -= 1;
    }

    if (this.pressedKeys.has('KeyA')) {
      x -= 1;
    }

    if (this.pressedKeys.has('KeyD')) {
      x += 1;
    }

    const length = Math.hypot(x, y);

    if (length > 1) {
      x /= length;
      y /= length;
    }

    return { x, y };
  }

  getMoveMagnitude(): number {
    const axis = this.getMoveAxis();
    return Math.min(1, Math.hypot(axis.x, axis.y));
  }

  consumeLookDelta(): Axis2 {
    const mobileDelta = this.mobileControls.consumeLookDelta();
    const delta = {
      x: this.mouseDelta.x + mobileDelta.x,
      y: this.mouseDelta.y + mobileDelta.y,
    };

    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
    return delta;
  }

  consumeFiringIntent(): boolean {
    const queued = this.fireQueued || this.mobileControls.consumeFireQueued();
    this.fireQueued = false;
    return queued || this.firingHeld || this.mobileControls.isFiring();
  }

  consumeCameraToggle(): boolean {
    const queued = this.cameraToggleQueued;
    this.cameraToggleQueued = false;
    return queued;
  }

  consumeReloadIntent(): boolean {
    const queued = this.reloadQueued;
    this.reloadQueued = false;
    return queued;
  }

  isAimHeld(): boolean {
    return this.aimingHeld || this.pressedKeys.has('ShiftLeft') || this.pressedKeys.has('ShiftRight');
  }

  isFrontHeld(): boolean {
    return this.pressedKeys.has('KeyV') || this.mobileControls.isFrontHeld();
  }

  requestPointerLock(): void {
    if (document.pointerLockElement !== this.canvas) {
      try {
        this.canvas.focus({ preventScroll: true });
        const request = this.canvas.requestPointerLock() as Promise<void> | void;
        void request?.catch(() => undefined);
      } catch {
        // Browser surfaces can reject pointer lock outside a direct click.
      }
    }
  }

  isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  reset(): void {
    this.pressedKeys.clear();
    this.firingHeld = false;
    this.fireQueued = false;
    this.aimingHeld = false;
    this.cameraToggleQueued = false;
    this.reloadQueued = false;
    this.pointerLocked = document.pointerLockElement === this.canvas;
    this.mouseLookActive = false;
    this.lastMouseX = null;
    this.lastMouseY = null;
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
    this.mobileControls.reset();
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Escape') {
        this.mouseLookActive = false;
        this.lastMouseX = null;
        this.lastMouseY = null;
      }

      if (!CONTROL_KEYS.has(event.code)) {
        return;
      }

      event.preventDefault();
      this.pressedKeys.add(event.code);

      if (!event.repeat && event.code === 'KeyC') {
        this.cameraToggleQueued = true;
      }

      if (!event.repeat && event.code === 'KeyR') {
        this.reloadQueued = true;
      }
    });

    window.addEventListener('keyup', (event) => {
      if (CONTROL_KEYS.has(event.code)) {
        event.preventDefault();
        this.pressedKeys.delete(event.code);
      }
    });

    window.addEventListener('blur', () => {
      this.releaseHeldControls();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.releaseHeldControls();
        this.mobileControls.reset();
        return;
      }

      this.releaseHeldControls();
      this.mobileControls.refresh();
    });
  }

  private bindMouse(): void {
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;

      if (this.pointerLocked) {
        this.mouseLookActive = false;
        this.lastMouseX = null;
        this.lastMouseY = null;
      } else {
        this.mouseDelta.x = 0;
        this.mouseDelta.y = 0;
        this.mouseLookActive = false;
        this.lastMouseX = null;
        this.lastMouseY = null;
        this.pressedKeys.delete('KeyV');
        this.pressedKeys.delete('ShiftLeft');
        this.pressedKeys.delete('ShiftRight');
      }
    });

    document.addEventListener('pointerlockerror', () => {
      this.pointerLocked = false;
      this.mouseDelta.x = 0;
      this.mouseDelta.y = 0;
      this.mouseLookActive = true;
      this.lastMouseX = null;
      this.lastMouseY = null;
    });

    this.lockSurface.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'mouse' || (event.button !== 0 && event.button !== 2)) {
        return;
      }

      const target = event.target;

      if (target instanceof HTMLElement && target.closest('button')) {
        return;
      }

      this.requestPointerLock();
      this.activateFallbackMouseLook(event.clientX, event.clientY);
    });

    this.canvas.addEventListener('mousedown', (event) => {
      if (event.button !== 0 && event.button !== 2) {
        return;
      }

      event.preventDefault();
      this.requestPointerLock();
      this.activateFallbackMouseLook(event.clientX, event.clientY);

      if (event.button === 0) {
        this.firingHeld = true;
        this.fireQueued = true;
      }

      if (event.button === 2) {
        this.aimingHeld = true;
      }
    });

    this.canvas.addEventListener('click', (event) => {
      if (event.button === 0) {
        this.requestPointerLock();
        this.mouseLookActive = true;
      }
    });

    window.addEventListener('mouseup', (event) => {
      if (event.button === 0) {
        this.firingHeld = false;
      }

      if (event.button === 2) {
        this.aimingHeld = false;
      }
    });

    document.addEventListener('mousemove', (event) => {
      if (this.pointerLocked && document.pointerLockElement === this.canvas) {
        this.mouseDelta.x += event.movementX;
        this.mouseDelta.y += event.movementY;
        return;
      }

      if (!this.mouseLookActive) {
        return;
      }

      const deltaX =
        event.movementX !== 0 || this.lastMouseX === null ? event.movementX : event.clientX - this.lastMouseX;
      const deltaY =
        event.movementY !== 0 || this.lastMouseY === null ? event.movementY : event.clientY - this.lastMouseY;

      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;

      this.mouseDelta.x += deltaX;
      this.mouseDelta.y += deltaY;
    });
  }

  private activateFallbackMouseLook(clientX: number, clientY: number): void {
    this.mouseLookActive = true;
    this.lastMouseX = clientX;
    this.lastMouseY = clientY;
  }

  private releaseHeldControls(): void {
    this.pressedKeys.clear();
    this.firingHeld = false;
    this.aimingHeld = false;
    this.mouseLookActive = false;
    this.lastMouseX = null;
    this.lastMouseY = null;
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
  }
}
