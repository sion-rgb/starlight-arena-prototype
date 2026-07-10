import * as THREE from 'three';
import type { CameraMode } from './CameraController';
import {
  CharacterAnimationController,
  type CharacterAnimationSummary,
} from './CharacterAnimationController';
import { AvatarLoader, type LoadedAvatar } from './AvatarLoader';
import { PlayerController } from './PlayerController';

interface ControlDebugState {
  modelForwardOffset?: number;
  avatarYaw?: number;
}

type DebugWindow = Window & {
  __STARLIGHT_CONTROL_DEBUG__?: ControlDebugState;
};

export class CharacterController {
  private avatar: LoadedAvatar;
  private animation: CharacterAnimationController;
  // This VRM's authored forward axis is +Z, so it needs a half-turn to match player -Z forward.
  private modelForwardOffset = Math.PI;
  private readonly modelYawDirection = -1;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly loader = new AvatarLoader(),
  ) {
    this.avatar = this.loader.createPlaceholderAvatar();
    this.animation = new CharacterAnimationController(this.avatar);
    this.scene.add(this.avatar.root);
    this.bindDebugKeys();
    this.updateDebugState();
    void this.loadDefaultAvatar();
  }

  async loadDefaultAvatar(): Promise<void> {
    const avatar = await this.loader.loadAvatar();
    this.replaceAvatar(avatar);
  }

  update(
    player: PlayerController,
    mode: CameraMode,
    deltaSeconds: number,
    moveAmount: number,
    aimHeld = false,
    reloadActive = false,
    aimDirection = player.getAimDirection(),
  ): void {
    const avatarYaw = this.modelForwardOffset + player.yaw * this.modelYawDirection;
    this.avatar.root.visible = mode !== 'FirstPerson';
    this.avatar.root.position.copy(player.position);
    this.avatar.root.position.y += this.animation.getRootYOffset();
    this.avatar.root.rotation.y = avatarYaw;

    this.animation.update({
      deltaSeconds,
      moveAmount,
      aimHeld,
      reloadActive,
      aimDirection,
      visible: this.avatar.root.visible,
    });
    this.avatar.vrm?.update(deltaSeconds);
    // VRM updates only the skeleton, but reapplying yaw here guarantees that no pose can steer the avatar root.
    this.avatar.root.rotation.y = avatarYaw;
    this.avatar.root.position.y = player.position.y + this.animation.getRootYOffset();
    this.updateDebugState();
  }

  triggerShoot(): void {
    this.animation.triggerShoot();
  }

  getMuzzleWorldPosition(target = new THREE.Vector3()): THREE.Vector3 {
    this.avatar.rig.muzzle.updateWorldMatrix(true, false);
    return this.avatar.rig.muzzle.getWorldPosition(target);
  }

  isVisible(): boolean {
    return this.avatar.root.visible;
  }

  getAvatarKind(): string {
    return this.avatar.kind;
  }

  getAnimationSummary(): CharacterAnimationSummary {
    return this.animation.getSummary();
  }

  private replaceAvatar(avatar: LoadedAvatar): void {
    this.animation.dispose();
    this.scene.remove(this.avatar.root);
    this.avatar.dispose();
    this.avatar = avatar;
    this.animation = new CharacterAnimationController(this.avatar);
    this.scene.add(this.avatar.root);
  }

  private bindDebugKeys(): void {
    window.addEventListener('keydown', (event) => {
      if (event.code !== 'F2' || event.repeat) {
        return;
      }

      event.preventDefault();
      this.modelForwardOffset = this.modelForwardOffset === 0 ? Math.PI : 0;
      this.updateDebugState();
    });
  }

  private updateDebugState(): void {
    const debugWindow = window as DebugWindow;
    debugWindow.__STARLIGHT_CONTROL_DEBUG__ ??= {};
    debugWindow.__STARLIGHT_CONTROL_DEBUG__.modelForwardOffset = this.modelForwardOffset;
    debugWindow.__STARLIGHT_CONTROL_DEBUG__.avatarYaw = this.avatar.root.rotation.y;
  }
}
