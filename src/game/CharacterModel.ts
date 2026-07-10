import * as THREE from 'three';
import type { CameraMode } from './CameraController';
import { PlayerController } from './PlayerController';

export class CharacterModel {
  private readonly root = new THREE.Group();
  private readonly upperBody = new THREE.Group();
  private readonly leftArm = new THREE.Group();
  private readonly rightArm = new THREE.Group();
  private readonly leftLeg = new THREE.Group();
  private readonly rightLeg = new THREE.Group();
  private readonly weapon = new THREE.Group();
  private readonly muzzle = new THREE.Object3D();
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.root.name = 'Original anime warrior placeholder';
    this.root.add(this.upperBody, this.leftLeg, this.rightLeg);
    scene.add(this.root);
    this.createModel();
  }

  update(player: PlayerController, mode: CameraMode, deltaSeconds: number, moveAmount: number): void {
    this.time += deltaSeconds;
    this.root.visible = mode !== 'FirstPerson';
    this.root.position.copy(player.position);
    this.root.rotation.y = player.yaw;

    const runSwing = Math.sin(this.time * 10) * moveAmount;
    const idleBob = moveAmount < 0.05 ? Math.sin(this.time * 2.2) * 0.018 : 0;
    this.upperBody.position.y = idleBob;
    this.leftArm.rotation.x = runSwing * 0.34 - 0.08;
    this.rightArm.rotation.x = -runSwing * 0.18 - player.pitch * 0.45 - 0.12;
    this.leftLeg.rotation.x = -runSwing * 0.32;
    this.rightLeg.rotation.x = runSwing * 0.32;
    this.weapon.rotation.x = -player.pitch * 0.25;
  }

  getMuzzleWorldPosition(target = new THREE.Vector3()): THREE.Vector3 {
    this.muzzle.updateWorldMatrix(true, false);
    return this.muzzle.getWorldPosition(target);
  }

  private createModel(): void {
    const suitMaterial = new THREE.MeshStandardMaterial({
      color: 0xf7f8ff,
      roughness: 0.38,
      metalness: 0.16,
      emissive: 0x151d3d,
      emissiveIntensity: 0.12,
    });
    const accentMaterial = new THREE.MeshStandardMaterial({
      color: 0x6fefff,
      roughness: 0.2,
      metalness: 0.1,
      emissive: 0x18c7ff,
      emissiveIntensity: 0.48,
    });
    const armorPinkMaterial = new THREE.MeshStandardMaterial({
      color: 0xff8fd4,
      roughness: 0.32,
      metalness: 0.08,
      emissive: 0x4a1234,
      emissiveIntensity: 0.12,
    });
    const skinMaterial = new THREE.MeshStandardMaterial({
      color: 0xffd5c7,
      roughness: 0.55,
      metalness: 0,
    });
    const hairMaterial = new THREE.MeshStandardMaterial({
      color: 0x79d9ff,
      roughness: 0.48,
      metalness: 0.02,
      emissive: 0x123a5a,
      emissiveIntensity: 0.08,
    });
    const darkMaterial = new THREE.MeshStandardMaterial({
      color: 0x1f315f,
      roughness: 0.36,
      metalness: 0.18,
    });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.62, 0.28), suitMaterial);
    const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.31), armorPinkMaterial);
    const waist = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.16, 0.24), accentMaterial);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.12, 14), skinMaterial);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 24, 16), skinMaterial);
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.205, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.54), hairMaterial);
    const backHair = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.5, 18), hairMaterial);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.045, 0.026), darkMaterial);

    torso.position.set(0, 1.02, 0);
    chestPlate.position.set(0, 1.18, -0.02);
    waist.position.set(0, 0.69, 0);
    neck.position.set(0, 1.39, 0);
    head.position.set(0, 1.58, -0.01);
    hairCap.position.set(0, 1.64, -0.015);
    backHair.position.set(0, 1.38, 0.11);
    backHair.rotation.x = -0.22;
    visor.position.set(0, 1.58, -0.18);

    this.upperBody.add(torso, chestPlate, waist, neck, head, hairCap, backHair, visor);
    this.createArm(this.leftArm, -0.34, suitMaterial, skinMaterial, false);
    this.createArm(this.rightArm, 0.34, suitMaterial, skinMaterial, true);
    this.createLeg(this.leftLeg, -0.13, suitMaterial, darkMaterial);
    this.createLeg(this.rightLeg, 0.13, suitMaterial, darkMaterial);
    this.upperBody.add(this.leftArm, this.rightArm);
    this.markShadows(this.root);
  }

  private createArm(
    armGroup: THREE.Group,
    x: number,
    suitMaterial: THREE.Material,
    skinMaterial: THREE.Material,
    hasWeapon: boolean,
  ): void {
    armGroup.position.set(x, 1.25, 0);
    const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.38, 12), suitMaterial);
    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.056, 0.34, 12), suitMaterial);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.065, 14, 8), skinMaterial);

    upperArm.position.y = -0.18;
    forearm.position.set(0, -0.5, -0.02);
    forearm.rotation.x = -0.24;
    hand.position.set(0, -0.68, -0.08);
    armGroup.add(upperArm, forearm, hand);

    if (hasWeapon) {
      this.weapon.position.set(0.02, -0.68, -0.24);
      this.createCharacterWeapon();
      armGroup.add(this.weapon);
    }
  }

  private createLeg(
    legGroup: THREE.Group,
    x: number,
    suitMaterial: THREE.Material,
    bootMaterial: THREE.Material,
  ): void {
    legGroup.position.set(x, 0.88, 0);
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 0.45, 12), suitMaterial);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.42, 12), suitMaterial);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.28), bootMaterial);

    thigh.position.y = -0.23;
    shin.position.y = -0.62;
    boot.position.set(0, -0.83, -0.04);
    legGroup.add(thigh, shin, boot);
  }

  private createCharacterWeapon(): void {
    const weaponMaterial = new THREE.MeshStandardMaterial({
      color: 0xf6f8ff,
      roughness: 0.28,
      metalness: 0.24,
      emissive: 0x111a3f,
      emissiveIntensity: 0.16,
    });
    const glowMaterial = new THREE.MeshStandardMaterial({
      color: 0x77f7ff,
      roughness: 0.16,
      metalness: 0.1,
      emissive: 0x22dfff,
      emissiveIntensity: 0.76,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.44), weaponMaterial);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.032, 0.36, 14), glowMaterial);

    body.position.set(0, 0, -0.16);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -0.46);
    this.muzzle.position.set(0, 0.02, -0.68);
    this.weapon.add(body, barrel, this.muzzle);
  }

  private markShadows(object: THREE.Object3D): void {
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }
}
