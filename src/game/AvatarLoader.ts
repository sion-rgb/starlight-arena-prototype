import * as THREE from 'three';
import { VRMLoaderPlugin, type VRM } from '@pixiv/three-vrm';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type AvatarKind = 'vrm' | 'glb' | 'placeholder';

export interface AvatarAnimationRig {
  upperBody?: THREE.Object3D;
  leftArm?: THREE.Object3D;
  rightArm?: THREE.Object3D;
  leftLeg?: THREE.Object3D;
  rightLeg?: THREE.Object3D;
  weapon?: THREE.Object3D;
  muzzle: THREE.Object3D;
}

export interface LoadedAvatar {
  kind: AvatarKind;
  root: THREE.Group;
  clips: THREE.AnimationClip[];
  rig: AvatarAnimationRig;
  vrm?: VRM;
  dispose: () => void;
}

const DEFAULT_AVATAR_URLS = [
  '/avatars/avatar.vrm',
  '/avatars/avatar.glb',
  '/models/avatar.vrm',
  '/models/avatar.glb',
];

export class AvatarLoader {
  private readonly vrmLoader = new GLTFLoader();
  private readonly gltfLoader = new GLTFLoader();

  constructor() {
    this.vrmLoader.register((parser) => new VRMLoaderPlugin(parser));
  }

  async loadAvatar(urls = DEFAULT_AVATAR_URLS): Promise<LoadedAvatar> {
    for (const url of urls) {
      try {
        if (url.toLowerCase().endsWith('.vrm')) {
          return await this.loadVrm(url);
        }

        if (url.toLowerCase().endsWith('.glb') || url.toLowerCase().endsWith('.gltf')) {
          return await this.loadGlb(url);
        }
      } catch {
        // Try the next candidate, then fall back to the generated placeholder.
      }
    }

    return this.createPlaceholderAvatar();
  }

  createPlaceholderAvatar(): LoadedAvatar {
    const root = new THREE.Group();
    const upperBody = new THREE.Group();
    const leftArm = new THREE.Group();
    const rightArm = new THREE.Group();
    const leftLeg = new THREE.Group();
    const rightLeg = new THREE.Group();
    const weapon = new THREE.Group();
    const muzzle = new THREE.Object3D();

    root.name = 'Generated placeholder avatar';
    root.add(upperBody, leftLeg, rightLeg);
    this.buildPlaceholderBody({
      root,
      upperBody,
      leftArm,
      rightArm,
      leftLeg,
      rightLeg,
      weapon,
      muzzle,
    });
    this.markShadows(root);

    return {
      kind: 'placeholder',
      root,
      clips: [],
      rig: {
        upperBody,
        leftArm,
        rightArm,
        leftLeg,
        rightLeg,
        weapon,
        muzzle,
      },
      dispose: () => this.disposeObject(root),
    };
  }

  private async loadVrm(url: string): Promise<LoadedAvatar> {
    const gltf = await this.vrmLoader.loadAsync(url);
    const vrm = gltf.userData.vrm as VRM | undefined;

    if (!vrm) {
      throw new Error(`VRM data was not found in ${url}.`);
    }

    const { root, rig } = await this.wrapExternalAvatar(vrm.scene, 'VRM avatar');
    return {
      kind: 'vrm',
      root,
      clips: gltf.animations,
      rig,
      vrm,
      dispose: () => this.disposeObject(root),
    };
  }

  private async loadGlb(url: string): Promise<LoadedAvatar> {
    const gltf: GLTF = await this.gltfLoader.loadAsync(url);
    const { root, rig } = await this.wrapExternalAvatar(gltf.scene, 'GLB avatar');

    return {
      kind: 'glb',
      root,
      clips: gltf.animations,
      rig,
      dispose: () => this.disposeObject(root),
    };
  }

  private async wrapExternalAvatar(
    object: THREE.Object3D,
    name: string,
  ): Promise<{ root: THREE.Group; rig: AvatarAnimationRig }> {
    const root = new THREE.Group();
    const weapon = new THREE.Group();
    const muzzle = new THREE.Object3D();

    root.name = name;
    root.add(object);
    this.normalizeChildToAvatarScale(object);
    const importedWeapon = await this.addImportedWeapon(weapon, muzzle);

    if (!importedWeapon) {
      this.addSimpleWeapon(weapon, muzzle);
    }

    weapon.scale.setScalar(0.72);
    weapon.position.set(0.32, 1.12, -0.34);
    root.add(weapon);
    this.markShadows(root);

    return {
      root,
      rig: {
        weapon,
        muzzle,
      },
    };
  }

  private async addImportedWeapon(weapon: THREE.Group, muzzle: THREE.Object3D): Promise<boolean> {
    try {
      const gltf = await this.gltfLoader.loadAsync('/assets/kenney-blaster/blaster-l.glb');
      const model = gltf.scene;
      const initialBounds = new THREE.Box3().setFromObject(model);
      const initialSize = initialBounds.getSize(new THREE.Vector3());
      const longestAxis = Math.max(initialSize.x, initialSize.y, initialSize.z);

      if (longestAxis <= 0.0001) {
        return false;
      }

      model.scale.setScalar(0.9 / longestAxis);
      model.rotation.y = 0;
      model.updateWorldMatrix(true, true);

      const bounds = new THREE.Box3().setFromObject(model);
      model.position.sub(bounds.getCenter(new THREE.Vector3()));
      muzzle.position.set(0, 0, -0.48);
      weapon.add(model, muzzle);
      this.markShadows(model);
      return true;
    } catch {
      return false;
    }
  }

  private normalizeChildToAvatarScale(object: THREE.Object3D): void {
    object.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());

    if (size.y <= 0.001) {
      return;
    }

    const scale = 1.68 / size.y;
    object.scale.multiplyScalar(scale);
    object.updateWorldMatrix(true, true);

    const scaledBox = new THREE.Box3().setFromObject(object);
    const center = scaledBox.getCenter(new THREE.Vector3());
    object.position.x -= center.x;
    object.position.z -= center.z;
    object.position.y -= scaledBox.min.y;
  }

  private buildPlaceholderBody(rig: Required<Pick<AvatarAnimationRig, 'muzzle'>> & {
    root: THREE.Group;
    upperBody: THREE.Group;
    leftArm: THREE.Group;
    rightArm: THREE.Group;
    leftLeg: THREE.Group;
    rightLeg: THREE.Group;
    weapon: THREE.Group;
  }): void {
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
    const hairCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.205, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.54),
      hairMaterial,
    );
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

    rig.upperBody.add(torso, chestPlate, waist, neck, head, hairCap, backHair, visor);
    this.createPlaceholderArm(rig.leftArm, -0.34, suitMaterial, skinMaterial);
    this.createPlaceholderArm(rig.rightArm, 0.34, suitMaterial, skinMaterial);
    this.createPlaceholderLeg(rig.leftLeg, -0.13, suitMaterial, darkMaterial);
    this.createPlaceholderLeg(rig.rightLeg, 0.13, suitMaterial, darkMaterial);
    this.addSimpleWeapon(rig.weapon, rig.muzzle);
    rig.weapon.position.set(0.02, -0.68, -0.24);
    rig.rightArm.add(rig.weapon);
    rig.upperBody.add(rig.leftArm, rig.rightArm);
  }

  private createPlaceholderArm(
    armGroup: THREE.Group,
    x: number,
    suitMaterial: THREE.Material,
    skinMaterial: THREE.Material,
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
  }

  private createPlaceholderLeg(
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

  private addSimpleWeapon(weapon: THREE.Object3D, muzzle: THREE.Object3D): void {
    weapon.name = 'weaponRoot';
    muzzle.name = 'muzzle';

    const casingMaterial = new THREE.MeshStandardMaterial({
      color: 0xe9efff,
      roughness: 0.26,
      metalness: 0.42,
      emissive: 0x101d42,
      emissiveIntensity: 0.18,
    });
    const darkMaterial = new THREE.MeshStandardMaterial({
      color: 0x17234a,
      roughness: 0.32,
      metalness: 0.34,
      emissive: 0x091126,
      emissiveIntensity: 0.12,
    });
    const glowMaterial = new THREE.MeshStandardMaterial({
      color: 0x77f7ff,
      roughness: 0.14,
      metalness: 0.2,
      emissive: 0x19ddff,
      emissiveIntensity: 1.05,
    });
    const trimMaterial = new THREE.MeshStandardMaterial({
      color: 0xff85ca,
      roughness: 0.2,
      metalness: 0.18,
      emissive: 0xff3ca7,
      emissiveIntensity: 0.5,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.5), casingMaterial);
    const upperShroud = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.34), darkMaterial);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.038, 0.46, 16), glowMaterial);
    const muzzleRing = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.008, 8, 20), trimMaterial);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.23, 0.15), darkMaterial);
    const energyCell = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.12, 0.18), glowMaterial);
    const leftRail = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.06, 0.3), trimMaterial);
    const rightRail = leftRail.clone();
    const rearStock = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.18), darkMaterial);
    const sightBase = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.05, 0.1), casingMaterial);
    const sightLens = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 8), glowMaterial);

    body.position.set(0, 0, -0.16);
    upperShroud.position.set(0, 0.105, -0.26);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.015, -0.58);
    muzzleRing.rotation.x = Math.PI / 2;
    muzzleRing.position.set(0, 0.015, -0.82);
    grip.position.set(0, -0.17, -0.06);
    grip.rotation.x = -0.2;
    energyCell.position.set(0, -0.015, 0.08);
    leftRail.position.set(-0.1, 0.02, -0.27);
    rightRail.position.x = 0.1;
    rearStock.position.set(0, -0.025, 0.22);
    sightBase.position.set(0, 0.145, -0.15);
    sightLens.position.set(0, 0.19, -0.16);
    muzzle.position.set(0, 0.015, -0.86);
    weapon.add(
      body,
      upperShroud,
      barrel,
      muzzleRing,
      grip,
      energyCell,
      leftRail,
      rightRail,
      rearStock,
      sightBase,
      sightLens,
      muzzle,
    );
  }

  private markShadows(object: THREE.Object3D): void {
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }

  private disposeObject(object: THREE.Object3D): void {
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) {
        return;
      }

      child.geometry.dispose();
      const material = child.material;

      if (Array.isArray(material)) {
        for (const entry of material) {
          entry.dispose();
        }
      } else {
        material.dispose();
      }
    });
  }
}
