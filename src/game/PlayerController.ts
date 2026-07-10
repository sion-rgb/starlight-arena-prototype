import * as THREE from 'three';
import { CollisionSystem } from './CollisionSystem';
import { InputController } from './InputController';

export class PlayerController {
  readonly maxHealth = 100;
  readonly eyeHeight = 1.65;
  readonly chestHeight = 1.35;
  readonly radius = 0.44;
  readonly position = new THREE.Vector3(0, 0, 12);
  health = this.maxHealth;
  yaw = 0;
  pitch = 0;
  private readonly moveSpeed = 6.3;
  private readonly lookSensitivity = 0.0025;

  constructor(
    private readonly input: InputController,
    private readonly collision: CollisionSystem,
  ) {
    this.reset();
  }

  reset(): void {
    this.health = this.maxHealth;
    this.yaw = 0;
    this.pitch = 0;
    this.position.set(0, 0, 12);
  }

  update(deltaSeconds: number): void {
    this.updateLook();
    this.updateMovement(deltaSeconds);
  }

  takeDamage(amount: number): boolean {
    if (this.health <= 0) {
      return true;
    }

    this.health = Math.max(0, this.health - amount);
    return this.health <= 0;
  }

  getForwardDirection(target = new THREE.Vector3()): THREE.Vector3 {
    return target
      .set(Math.sin(this.yaw), 0, -Math.cos(this.yaw))
      .normalize();
  }

  getRightDirection(target = new THREE.Vector3()): THREE.Vector3 {
    return target
      .set(Math.cos(this.yaw), 0, Math.sin(this.yaw))
      .normalize();
  }

  getAimDirection(target = new THREE.Vector3()): THREE.Vector3 {
    const pitchCos = Math.cos(this.pitch);
    return target
      .set(
        Math.sin(this.yaw) * pitchCos,
        Math.sin(this.pitch),
        -Math.cos(this.yaw) * pitchCos,
      )
      .normalize();
  }

  getChestPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.position).add(new THREE.Vector3(0, this.chestHeight, 0));
  }

  getEyePosition(target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.position).add(new THREE.Vector3(0, this.eyeHeight, 0));
  }

  private updateLook(): void {
    const lookDelta = this.input.consumeLookDelta();

    if (this.input.isFrontHeld()) {
      return;
    }

    this.yaw += lookDelta.x * this.lookSensitivity;
    this.pitch -= lookDelta.y * this.lookSensitivity;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch,
      THREE.MathUtils.degToRad(-75),
      THREE.MathUtils.degToRad(75),
    );
  }

  private updateMovement(deltaSeconds: number): void {
    const axis = this.input.getMoveAxis();

    if (axis.x === 0 && axis.y === 0) {
      return;
    }

    const forward = this.getForwardDirection();
    const right = this.getRightDirection();
    const move = new THREE.Vector3()
      .addScaledVector(forward, axis.y)
      .addScaledVector(right, axis.x);

    if (move.lengthSq() > 1) {
      move.normalize();
    }

    move.multiplyScalar(this.moveSpeed * deltaSeconds);
    const nextPosition = this.collision.moveWithCollisions(this.position, move, this.radius);
    nextPosition.y = 0;
    this.position.copy(nextPosition);
  }
}
