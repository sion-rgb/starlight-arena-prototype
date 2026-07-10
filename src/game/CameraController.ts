import * as THREE from 'three';
import { CollisionSystem } from './CollisionSystem';
import { PlayerController } from './PlayerController';

export type CameraMode = 'ThirdPersonBack' | 'AimMode' | 'FrontCheck' | 'FirstPerson';

interface ControlDebugState {
  cameraMode?: CameraMode;
  isFrontCheck?: boolean;
  yaw?: number;
  pitch?: number;
  modelForwardOffset?: number;
  pointerLocked?: boolean;
  debugArrowsVisible?: boolean;
}

type DebugWindow = Window & {
  __STARLIGHT_CONTROL_DEBUG__?: ControlDebugState;
};

export class CameraController {
  private currentMode: CameraMode = 'ThirdPersonBack';
  private firstPersonEnabled = false;
  private initialized = false;
  private readonly lookTarget = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly desiredCameraPos = new THREE.Vector3();
  private readonly cameraForward = new THREE.Vector3();
  private readonly shootForward = new THREE.Vector3();
  private readonly debugOrigin = new THREE.Vector3();
  private readonly debugUp = new THREE.Vector3(0, 0.18, 0);
  private debugText?: HTMLDivElement;
  private playerForwardArrow?: THREE.ArrowHelper;
  private cameraForwardArrow?: THREE.ArrowHelper;
  private shootRayArrow?: THREE.ArrowHelper;
  private debugArrowsVisible = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly player: PlayerController,
    private readonly collision: CollisionSystem,
  ) {
    void this.collision;
    this.bindDebugKeys();
  }

  reset(): void {
    this.currentMode = 'ThirdPersonBack';
    this.firstPersonEnabled = false;
    this.initialized = false;
  }

  toggleFirstPerson(): void {
    this.firstPersonEnabled = !this.firstPersonEnabled;
  }

  update(deltaSeconds: number, aimHeld: boolean, frontHeld: boolean): void {
    this.currentMode = this.resolveMode(aimHeld, frontHeld);

    const { desiredCameraPos, lookTarget } = this.resolveCameraFrame(this.currentMode);
    const smoothing = this.initialized ? 1 - Math.exp(-12 * deltaSeconds) : 1;

    this.camera.position.lerp(desiredCameraPos, smoothing);

    if (this.currentMode === 'FrontCheck') {
      this.lookTarget.copy(lookTarget);
    } else {
      this.lookTarget
        .copy(this.camera.position)
        .addScaledVector(this.player.getAimDirection(this.cameraForward), 6);
    }

    this.camera.lookAt(this.lookTarget);
    this.initialized = true;
    this.updateDebugHelpers(frontHeld);
  }

  getMode(): CameraMode {
    return this.currentMode;
  }

  isFirstPersonActive(): boolean {
    return this.currentMode === 'FirstPerson';
  }

  private resolveMode(aimHeld: boolean, frontHeld: boolean): CameraMode {
    if (frontHeld) {
      return 'FrontCheck';
    }

    if (this.firstPersonEnabled) {
      return 'FirstPerson';
    }

    if (aimHeld) {
      return 'AimMode';
    }

    return 'ThirdPersonBack';
  }

  private resolveCameraFrame(mode: CameraMode): {
    desiredCameraPos: THREE.Vector3;
    lookTarget: THREE.Vector3;
  } {
    const forward = this.getPlayerForward(this.forward);
    const right = this.getPlayerRight(this.right);
    const target = this.target
      .copy(this.player.position)
      .add(new THREE.Vector3(0, 1.35, 0));

    if (mode === 'FrontCheck') {
      const desiredCameraPos = this.desiredCameraPos
        .copy(target)
        .add(forward.clone().multiplyScalar(2.2))
        .add(new THREE.Vector3(0, 0.25, 0));
      const lookTarget = this.lookTarget
        .copy(target)
        .sub(forward.clone().multiplyScalar(3));

      return { desiredCameraPos, lookTarget };
    }

    if (mode === 'FirstPerson') {
      const desiredCameraPos = this.desiredCameraPos.copy(this.player.getEyePosition());
      const lookTarget = this.lookTarget
        .copy(desiredCameraPos)
        .addScaledVector(this.player.getAimDirection(), 6);

      return { desiredCameraPos, lookTarget };
    }

    const distance = mode === 'AimMode' ? 1.85 : 3.0;
    const sideOffset = mode === 'AimMode' ? 0.42 : 0.65;
    const heightOffset = mode === 'AimMode' ? 0.28 : 0.35;
    const desiredCameraPos = this.desiredCameraPos
      .copy(target)
      .sub(forward.clone().multiplyScalar(distance))
      .add(right.clone().multiplyScalar(sideOffset))
      .add(new THREE.Vector3(0, heightOffset, 0));
    const lookTarget = this.lookTarget
      .copy(desiredCameraPos)
      .addScaledVector(this.player.getAimDirection(), 6);

    return { desiredCameraPos, lookTarget };
  }

  private getPlayerForward(target: THREE.Vector3): THREE.Vector3 {
    return target
      .set(Math.sin(this.player.yaw), 0, -Math.cos(this.player.yaw))
      .normalize();
  }

  private getPlayerRight(target: THREE.Vector3): THREE.Vector3 {
    return target
      .set(Math.cos(this.player.yaw), 0, Math.sin(this.player.yaw))
      .normalize();
  }

  private bindDebugKeys(): void {
    window.addEventListener('keydown', (event) => {
      if (event.code !== 'F3' || event.repeat) {
        return;
      }

      event.preventDefault();
      this.debugArrowsVisible = !this.debugArrowsVisible;
      this.setDebugArrowsVisible(this.debugArrowsVisible);
    });
  }

  private updateDebugHelpers(frontHeld: boolean): void {
    this.ensureDebugOverlay();
    this.ensureDebugArrows();

    const debugState = this.getDebugState();
    debugState.cameraMode = this.currentMode;
    debugState.isFrontCheck = frontHeld && this.currentMode === 'FrontCheck';
    debugState.yaw = this.player.yaw;
    debugState.pitch = this.player.pitch;
    debugState.pointerLocked = document.pointerLockElement !== null;
    debugState.debugArrowsVisible = this.debugArrowsVisible;

    if (this.debugText) {
      this.debugText.style.display = this.debugArrowsVisible ? 'block' : 'none';
      const offset = debugState.modelForwardOffset ?? Math.PI;
      this.debugText.textContent = [
        `cameraMode: ${this.currentMode}`,
        `isFrontCheck: ${debugState.isFrontCheck ? 'true' : 'false'}`,
        `yaw: ${this.player.yaw.toFixed(3)}`,
        `pitch: ${this.player.pitch.toFixed(3)}`,
        `modelForwardOffset: ${offset === 0 ? '0' : 'Math.PI'}`,
        `pointerLocked: ${debugState.pointerLocked ? 'true' : 'false'}`,
      ].join('\n');
    }

    if (!this.playerForwardArrow || !this.cameraForwardArrow || !this.shootRayArrow) {
      return;
    }

    const origin = this.debugOrigin.copy(this.target).add(this.debugUp);
    this.playerForwardArrow.position.copy(origin);
    this.playerForwardArrow.setDirection(this.getPlayerForward(this.forward));

    this.camera.getWorldDirection(this.cameraForward);
    this.cameraForwardArrow.position.copy(this.camera.position);
    this.cameraForwardArrow.setDirection(this.cameraForward);

    this.shootForward.copy(this.cameraForward);
    this.shootRayArrow.position.copy(origin).add(new THREE.Vector3(0, 0.12, 0));
    this.shootRayArrow.setDirection(this.shootForward);
    this.setDebugArrowsVisible(this.debugArrowsVisible);
  }

  private ensureDebugOverlay(): void {
    if (this.debugText) {
      return;
    }

    this.debugText = document.createElement('div');
    this.debugText.style.position = 'fixed';
    this.debugText.style.top = '12px';
    this.debugText.style.right = '12px';
    this.debugText.style.zIndex = '30';
    this.debugText.style.pointerEvents = 'none';
    this.debugText.style.whiteSpace = 'pre';
    this.debugText.style.font = '12px/1.45 monospace';
    this.debugText.style.color = '#062033';
    this.debugText.style.background = 'rgba(255, 255, 255, 0.72)';
    this.debugText.style.border = '1px solid rgba(0, 0, 0, 0.12)';
    this.debugText.style.borderRadius = '6px';
    this.debugText.style.padding = '8px 10px';
    this.debugText.style.display = 'none';
    document.body.append(this.debugText);
  }

  private ensureDebugArrows(): void {
    if (this.playerForwardArrow && this.cameraForwardArrow && this.shootRayArrow) {
      return;
    }

    const parent = this.camera.parent;

    if (!parent) {
      return;
    }

    this.playerForwardArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(), 1.35, 0xff3040);
    this.cameraForwardArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(), 1.0, 0x2c6cff);
    this.shootRayArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(), 1.55, 0x22c55e);
    parent.add(this.playerForwardArrow, this.cameraForwardArrow, this.shootRayArrow);
  }

  private setDebugArrowsVisible(visible: boolean): void {
    if (this.playerForwardArrow) {
      this.playerForwardArrow.visible = visible;
    }

    if (this.cameraForwardArrow) {
      this.cameraForwardArrow.visible = visible;
    }

    if (this.shootRayArrow) {
      this.shootRayArrow.visible = visible;
    }
  }

  private getDebugState(): ControlDebugState {
    const debugWindow = window as DebugWindow;
    debugWindow.__STARLIGHT_CONTROL_DEBUG__ ??= {};
    return debugWindow.__STARLIGHT_CONTROL_DEBUG__;
  }
}
