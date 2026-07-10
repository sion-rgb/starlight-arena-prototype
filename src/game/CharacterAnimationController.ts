import * as THREE from 'three';
import { type VRMPose, VRMHumanBoneName } from '@pixiv/three-vrm';
import type { AvatarAnimationRig, LoadedAvatar } from './AvatarLoader';

export type CharacterAnimationState = 'idle' | 'run' | 'aim' | 'shoot' | 'reload';

export interface CharacterAnimationUpdate {
  deltaSeconds: number;
  moveAmount: number;
  aimHeld: boolean;
  reloadActive: boolean;
  aimDirection: THREE.Vector3;
  visible: boolean;
}

export interface CharacterAnimationSummary {
  clipCount: number;
  clipNames: string[];
  activeState: CharacterAnimationState;
  proceduralActive: boolean;
  mappedClips: Partial<Record<CharacterAnimationState, string>>;
  weaponAttachment: string;
}

interface AnimatedNode {
  node: THREE.Object3D;
  restPosition: THREE.Vector3;
  restQuaternion: THREE.Quaternion;
}

interface ProceduralRig {
  upperBody?: AnimatedNode;
  hips?: AnimatedNode;
  spine?: AnimatedNode;
  chest?: AnimatedNode;
  neck?: AnimatedNode;
  head?: AnimatedNode;
  leftUpperArm?: AnimatedNode;
  leftLowerArm?: AnimatedNode;
  leftHand?: AnimatedNode;
  rightUpperArm?: AnimatedNode;
  rightLowerArm?: AnimatedNode;
  rightHand?: AnimatedNode;
  leftUpperLeg?: AnimatedNode;
  leftLowerLeg?: AnimatedNode;
  rightUpperLeg?: AnimatedNode;
  rightLowerLeg?: AnimatedNode;
  weaponParent?: THREE.Object3D;
  weapon?: AnimatedNode;
  armRestMode: 'already-lowered' | 't-pose';
}

const SHOOT_DURATION = 0.12;
const NEGATIVE_Z = new THREE.Vector3(0, 0, -1);

const CLIP_MATCHERS: Record<CharacterAnimationState, RegExp[]> = {
  idle: [/idle/i, /stand/i, /wait/i, /breath/i],
  run: [/walk/i, /run/i, /jog/i, /move/i],
  aim: [/aim/i, /hold/i, /rifle/i, /gun/i],
  shoot: [/shoot/i, /fire/i, /attack/i],
  reload: [/reload/i],
};

export class CharacterAnimationController {
  private readonly mixer?: THREE.AnimationMixer;
  private readonly actions: Partial<Record<CharacterAnimationState, THREE.AnimationAction>> = {};
  private readonly mappedClips: Partial<Record<CharacterAnimationState, string>> = {};
  private readonly proceduralRig: ProceduralRig;
  private readonly tempQuaternion = new THREE.Quaternion();
  private readonly parentWorldQuaternion = new THREE.Quaternion();
  private readonly weaponTargetQuaternion = new THREE.Quaternion();
  private readonly weaponLocalQuaternion = new THREE.Quaternion();
  private readonly normalizedAimDirection = new THREE.Vector3();
  private activeAction?: THREE.AnimationAction;
  private activeState: CharacterAnimationState = 'idle';
  private time = 0;
  private shootTimer = 0;
  private rootYOffset = 0;
  private movementBlend = 0;
  private proceduralActive = true;
  private weaponAttachment = 'none';

  constructor(private readonly avatar: LoadedAvatar) {
    this.proceduralRig = this.createProceduralRig(avatar);
    this.weaponAttachment = this.attachWeaponRoot();
    this.proceduralRig.weapon = this.captureNode(avatar.rig.weapon);

    if (avatar.clips.length > 0) {
      this.mixer = new THREE.AnimationMixer(avatar.root);
      this.configureClipActions(avatar.clips);
    }
  }

  update(update: CharacterAnimationUpdate): void {
    this.time += update.deltaSeconds;
    this.shootTimer = Math.max(0, this.shootTimer - update.deltaSeconds);
    const targetMovement = update.moveAmount > 0.025 ? THREE.MathUtils.clamp(update.moveAmount, 0, 1) : 0;
    this.movementBlend = THREE.MathUtils.damp(
      this.movementBlend,
      targetMovement,
      14,
      update.deltaSeconds,
    );

    const state = this.resolveState(update.moveAmount, update.aimHeld, update.reloadActive);
    const exactClipAvailable = this.updateClipAnimation(state, update.deltaSeconds);

    this.activeState = state;
    this.proceduralActive = !exactClipAvailable;
    this.rootYOffset = this.calculateRootYOffset();

    if (!update.visible) {
      return;
    }

    if (this.proceduralActive) {
      this.applyProceduralAnimation(state, update);
    } else {
      this.updateWeaponAim(update.aimDirection, state === 'aim' || state === 'shoot' ? 1 : 0, this.getShootWeight());
    }
  }

  triggerShoot(): void {
    this.shootTimer = SHOOT_DURATION;

    const shootAction = this.actions.shoot;

    if (shootAction) {
      this.playAction(shootAction, 'shoot', 0.03, true);
    }
  }

  getRootYOffset(): number {
    return this.rootYOffset;
  }

  getSummary(): CharacterAnimationSummary {
    return {
      clipCount: this.avatar.clips.length,
      clipNames: this.avatar.clips.map((clip) => clip.name || '(unnamed clip)'),
      activeState: this.activeState,
      proceduralActive: this.proceduralActive,
      mappedClips: { ...this.mappedClips },
      weaponAttachment: this.weaponAttachment,
    };
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    this.avatar.vrm?.humanoid.resetNormalizedPose();
  }

  private configureClipActions(clips: THREE.AnimationClip[]): void {
    for (const state of Object.keys(CLIP_MATCHERS) as CharacterAnimationState[]) {
      const clip = this.findClipForState(clips, state);

      if (!clip) {
        continue;
      }

      const action = this.mixer!.clipAction(clip);
      action.enabled = true;
      action.setEffectiveWeight(1);

      if (state === 'shoot') {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = false;
      } else {
        action.setLoop(THREE.LoopRepeat, Infinity);
      }

      this.actions[state] = action;
      this.mappedClips[state] = clip.name || '(unnamed clip)';
    }

    const firstClip = clips[0];

    if (!this.actions.idle && firstClip) {
      const action = this.mixer!.clipAction(firstClip);
      action.enabled = true;
      action.setLoop(THREE.LoopRepeat, Infinity);
      this.actions.idle = action;
      this.mappedClips.idle = firstClip.name || '(unnamed clip)';
    }
  }

  private findClipForState(
    clips: THREE.AnimationClip[],
    state: CharacterAnimationState,
  ): THREE.AnimationClip | undefined {
    return clips.find((clip) => CLIP_MATCHERS[state].some((matcher) => matcher.test(clip.name)));
  }

  private updateClipAnimation(state: CharacterAnimationState, deltaSeconds: number): boolean {
    if (!this.mixer) {
      return false;
    }

    const exactAction = this.actions[state];
    const fallbackAction = exactAction ?? this.actions.idle;

    if (fallbackAction) {
      this.playAction(fallbackAction, exactAction ? state : 'idle', 0.12);
    }

    this.mixer.update(deltaSeconds);
    return Boolean(exactAction);
  }

  private playAction(
    action: THREE.AnimationAction,
    state: CharacterAnimationState,
    fadeDuration: number,
    restart = false,
  ): void {
    if (this.activeAction === action && !restart) {
      return;
    }

    const previous = this.activeAction;
    this.activeAction = action;

    if (restart) {
      action.reset();
    }

    action.enabled = true;
    action.setEffectiveWeight(1);
    action.play();

    if (previous && previous !== action) {
      previous.crossFadeTo(action, fadeDuration, false);
    } else {
      action.fadeIn(fadeDuration);
    }

    this.activeState = state;
  }

  private resolveState(
    moveAmount: number,
    aimHeld: boolean,
    reloadActive: boolean,
  ): CharacterAnimationState {
    if (this.shootTimer > 0) {
      return 'shoot';
    }

    if (reloadActive) {
      return 'reload';
    }

    if (aimHeld) {
      return 'aim';
    }

    return moveAmount > 0.06 ? 'run' : 'idle';
  }

  private calculateRootYOffset(): number {
    const runBob = (1 - Math.cos(this.time * 16.8)) * 0.008 * this.movementBlend;
    const idleBreath = Math.sin(this.time * 2.1) * 0.006 * (1 - this.movementBlend);
    return runBob + idleBreath;
  }

  private applyProceduralAnimation(
    state: CharacterAnimationState,
    update: CharacterAnimationUpdate,
  ): void {
    const moving = state === 'run' || this.movementBlend > 0.02;
    const aiming = state === 'aim' || state === 'shoot';
    const reloading = state === 'reload';
    const aimWeight = aiming ? 1 : reloading ? 0.35 : 0;
    const shootWeight = this.getShootWeight();
    const moveAmount = moving ? this.movementBlend : 0;
    const breath = Math.sin(this.time * 2.1);
    const stride = Math.sin(this.time * 8.4) * moveAmount;

    if (this.avatar.vrm) {
      this.applyVrmPose(breath, stride, aimWeight, shootWeight, reloading);
    } else {
      this.applyObjectRigPose(breath, stride, aimWeight, shootWeight, reloading);
    }

    this.updateWeaponAim(update.aimDirection, aimWeight, shootWeight);
  }

  private applyVrmPose(
    breath: number,
    stride: number,
    aimWeight: number,
    shootWeight: number,
    reloadActive: boolean,
  ): void {
    const idleDrop = 1.3;
    const aimDrop = 1.08;
    const rightArmDrop = THREE.MathUtils.lerp(idleDrop, aimDrop, aimWeight);
    const leftArmDrop = idleDrop;
    const rightAimForward = aimWeight * 0.1;
    const recoil = shootWeight * 0.11;
    const reloadTuck = reloadActive ? 0.2 : 0;
    const armSwing = stride * 0.24;
    const legSwing = stride * 0.34;
    const pose: VRMPose = {
      [VRMHumanBoneName.Hips]: {
        position: [0, breath * 0.004, 0],
        rotation: this.quatTuple(0, 0, stride * 0.026),
      },
      [VRMHumanBoneName.Spine]: {
        rotation: this.quatTuple(breath * 0.008 - aimWeight * 0.035, 0, -stride * 0.018),
      },
      [VRMHumanBoneName.Chest]: {
        rotation: this.quatTuple(breath * 0.008 - aimWeight * 0.045, 0, stride * 0.022),
      },
      [VRMHumanBoneName.LeftUpperArm]: {
        rotation: this.quatTuple(armSwing + reloadTuck, 0, -leftArmDrop),
      },
      [VRMHumanBoneName.LeftLowerArm]: {
        rotation: this.quatTuple(-aimWeight * 0.12 - reloadTuck, 0, -0.1 - aimWeight * 0.1),
      },
      [VRMHumanBoneName.RightUpperArm]: {
        rotation: this.quatTuple(-armSwing - rightAimForward + recoil, aimWeight * 0.04, rightArmDrop),
      },
      [VRMHumanBoneName.RightLowerArm]: {
        rotation: this.quatTuple(-aimWeight * 0.16 + recoil, 0, 0.12 + aimWeight * 0.12),
      },
      [VRMHumanBoneName.LeftUpperLeg]: {
        rotation: this.quatTuple(-legSwing, 0, 0),
      },
      [VRMHumanBoneName.LeftLowerLeg]: {
        rotation: this.quatTuple(Math.max(0, legSwing) * 0.56, 0, 0),
      },
      [VRMHumanBoneName.RightUpperLeg]: {
        rotation: this.quatTuple(legSwing, 0, 0),
      },
      [VRMHumanBoneName.RightLowerLeg]: {
        rotation: this.quatTuple(Math.max(0, -legSwing) * 0.56, 0, 0),
      },
    };

    this.avatar.vrm!.humanoid.setNormalizedPose(pose);
  }

  private applyObjectRigPose(
    breath: number,
    stride: number,
    aimWeight: number,
    shootWeight: number,
    reloadActive: boolean,
  ): void {
    const rig = this.proceduralRig;
    const armSwing = stride * 0.26;
    const legSwing = stride * 0.36;
    const idleDrop = rig.armRestMode === 't-pose' ? 1.3 : 0;
    const rightArmDrop = THREE.MathUtils.lerp(idleDrop, rig.armRestMode === 't-pose' ? 1.08 : 0, aimWeight);
    const leftArmDrop = idleDrop;
    const rightAimForward = aimWeight * 0.1;
    const recoil = shootWeight * 0.1;
    const reloadTuck = reloadActive ? 0.2 : 0;

    this.applyNodePose(rig.hips, new THREE.Vector3(0, breath * 0.004, 0), 0, 0, stride * 0.026);
    this.applyNodePose(
      rig.upperBody ?? rig.chest,
      new THREE.Vector3(0, breath * 0.008, 0),
      breath * 0.008 - aimWeight * 0.035,
      0,
      -stride * 0.018,
    );
    this.applyNodePose(rig.leftUpperArm, undefined, armSwing + reloadTuck, 0, -leftArmDrop);
    this.applyNodePose(rig.leftLowerArm, undefined, -aimWeight * 0.12 - reloadTuck, 0, -aimWeight * 0.1);
    this.applyNodePose(rig.rightUpperArm, undefined, -armSwing - rightAimForward + recoil, aimWeight * 0.04, rightArmDrop);
    this.applyNodePose(rig.rightLowerArm, undefined, -aimWeight * 0.16 + recoil, 0, aimWeight * 0.12);
    this.applyNodePose(rig.leftUpperLeg, undefined, -legSwing, 0, 0);
    this.applyNodePose(rig.leftLowerLeg, undefined, Math.max(0, legSwing) * 0.56, 0, 0);
    this.applyNodePose(rig.rightUpperLeg, undefined, legSwing, 0, 0);
    this.applyNodePose(rig.rightLowerLeg, undefined, Math.max(0, -legSwing) * 0.56, 0, 0);
  }

  private updateWeaponAim(
    aimDirection: THREE.Vector3,
    aimWeight: number,
    shootWeight: number,
  ): void {
    const weapon = this.proceduralRig.weapon;

    if (!weapon || !weapon.node.parent || aimDirection.lengthSq() < 0.001) {
      return;
    }

    const targetWorldQuaternion = this.weaponTargetQuaternion.setFromUnitVectors(
      NEGATIVE_Z,
      this.normalizedAimDirection.copy(aimDirection).normalize(),
    );
    weapon.node.parent.getWorldQuaternion(this.parentWorldQuaternion);
    this.weaponLocalQuaternion
      .copy(this.parentWorldQuaternion)
      .invert()
      .multiply(targetWorldQuaternion);

    weapon.node.position.copy(weapon.restPosition);
    weapon.node.position.z += shootWeight * 0.055;

    const blend = aimWeight > 0.5
      ? 1
      : THREE.MathUtils.clamp(aimWeight * 0.72 + shootWeight * 0.28, 0, 1);
    weapon.node.quaternion.copy(weapon.restQuaternion);
    weapon.node.quaternion.slerp(this.weaponLocalQuaternion, blend);
  }

  private applyNodePose(
    entry: AnimatedNode | undefined,
    positionOffset: THREE.Vector3 | undefined,
    x: number,
    y: number,
    z: number,
  ): void {
    if (!entry) {
      return;
    }

    entry.node.position.copy(entry.restPosition);

    if (positionOffset) {
      entry.node.position.add(positionOffset);
    }

    entry.node.quaternion
      .copy(entry.restQuaternion)
      .multiply(this.tempQuaternion.setFromEuler(new THREE.Euler(x, y, z, 'XYZ')));
  }

  private getShootWeight(): number {
    if (this.shootTimer <= 0) {
      return 0;
    }

    const normalized = this.shootTimer / SHOOT_DURATION;
    return Math.sin(normalized * Math.PI);
  }

  private createProceduralRig(avatar: LoadedAvatar): ProceduralRig {
    if (avatar.kind === 'placeholder') {
      return this.createPlaceholderRig(avatar.rig);
    }

    if (avatar.vrm) {
      return this.createVrmRig(avatar);
    }

    return this.discoverObjectRig(avatar);
  }

  private createPlaceholderRig(rig: AvatarAnimationRig): ProceduralRig {
    return {
      upperBody: this.captureNode(rig.upperBody),
      leftUpperArm: this.captureNode(rig.leftArm),
      rightUpperArm: this.captureNode(rig.rightArm),
      leftUpperLeg: this.captureNode(rig.leftLeg),
      rightUpperLeg: this.captureNode(rig.rightLeg),
      weaponParent: rig.rightArm,
      armRestMode: 'already-lowered',
    };
  }

  private createVrmRig(avatar: LoadedAvatar): ProceduralRig {
    const humanoid = avatar.vrm!.humanoid;

    return {
      hips: this.captureNode(humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips)),
      spine: this.captureNode(humanoid.getNormalizedBoneNode(VRMHumanBoneName.Spine)),
      chest: this.captureNode(
        humanoid.getNormalizedBoneNode(VRMHumanBoneName.Chest) ??
          humanoid.getNormalizedBoneNode(VRMHumanBoneName.UpperChest),
      ),
      neck: this.captureNode(humanoid.getNormalizedBoneNode(VRMHumanBoneName.Neck)),
      head: this.captureNode(humanoid.getNormalizedBoneNode(VRMHumanBoneName.Head)),
      leftUpperArm: this.captureNode(humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm)),
      leftLowerArm: this.captureNode(humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftLowerArm)),
      leftHand: this.captureNode(humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftHand)),
      rightUpperArm: this.captureNode(humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm)),
      rightLowerArm: this.captureNode(humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightLowerArm)),
      rightHand: this.captureNode(humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightHand)),
      leftUpperLeg: this.captureNode(humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperLeg)),
      leftLowerLeg: this.captureNode(humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftLowerLeg)),
      rightUpperLeg: this.captureNode(humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightUpperLeg)),
      rightLowerLeg: this.captureNode(humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightLowerLeg)),
      weaponParent: humanoid.getRawBoneNode(VRMHumanBoneName.RightHand) ?? undefined,
      armRestMode: 't-pose',
    };
  }

  private discoverObjectRig(avatar: LoadedAvatar): ProceduralRig {
    const rightHand = this.findNamedNode(avatar.root, ['righthand', 'hand_r', 'rhand']);

    return {
      hips: this.captureNode(this.findNamedNode(avatar.root, ['hips', 'pelvis'])),
      spine: this.captureNode(this.findNamedNode(avatar.root, ['spine', 'spine1', 'spine_01'])),
      chest: this.captureNode(this.findNamedNode(avatar.root, ['chest', 'upperchest', 'spine2', 'spine_02'])),
      neck: this.captureNode(this.findNamedNode(avatar.root, ['neck'])),
      head: this.captureNode(this.findNamedNode(avatar.root, ['head'])),
      leftUpperArm: this.captureNode(this.findNamedNode(avatar.root, ['leftupperarm', 'leftarm', 'lupperarm', 'upperarm_l'])),
      leftLowerArm: this.captureNode(this.findNamedNode(avatar.root, ['leftlowerarm', 'leftforearm', 'llowerarm', 'forearm_l'])),
      leftHand: this.captureNode(this.findNamedNode(avatar.root, ['lefthand', 'hand_l', 'lhand'])),
      rightUpperArm: this.captureNode(this.findNamedNode(avatar.root, ['rightupperarm', 'rightarm', 'rupperarm', 'upperarm_r'])),
      rightLowerArm: this.captureNode(this.findNamedNode(avatar.root, ['rightlowerarm', 'rightforearm', 'rlowerarm', 'forearm_r'])),
      rightHand: this.captureNode(rightHand),
      leftUpperLeg: this.captureNode(this.findNamedNode(avatar.root, ['leftupperleg', 'leftupleg', 'leftthigh', 'thigh_l'])),
      leftLowerLeg: this.captureNode(this.findNamedNode(avatar.root, ['leftlowerleg', 'leftleg', 'leftshin', 'shin_l'])),
      rightUpperLeg: this.captureNode(this.findNamedNode(avatar.root, ['rightupperleg', 'rightupleg', 'rightthigh', 'thigh_r'])),
      rightLowerLeg: this.captureNode(this.findNamedNode(avatar.root, ['rightlowerleg', 'rightleg', 'rightshin', 'shin_r'])),
      weaponParent: rightHand,
      armRestMode: 't-pose',
    };
  }

  private attachWeaponRoot(): string {
    const weapon = this.avatar.rig.weapon;

    if (!weapon) {
      return 'none';
    }

    if (this.avatar.kind === 'placeholder') {
      return 'placeholderRightArm';
    }

    const rightHand = this.proceduralRig.weaponParent ?? this.proceduralRig.rightHand?.node;

    if (rightHand) {
      rightHand.attach(weapon);
      weapon.position.set(0.02, -0.02, -0.08);
      weapon.rotation.set(0, 0, 0);
      return this.avatar.kind === 'vrm' ? 'vrm.rawRightHand' : 'rightHand';
    }

    const fallbackParent = this.proceduralRig.chest?.node ?? this.proceduralRig.spine?.node ?? this.avatar.root;
    fallbackParent.attach(weapon);
    weapon.position.set(0.24, -0.08, -0.32);
    weapon.rotation.set(0, 0, 0);
    return fallbackParent === this.avatar.root ? 'avatarRootChestFallback' : 'chestFallback';
  }

  private captureNode(node: THREE.Object3D | undefined | null): AnimatedNode | undefined {
    if (!node) {
      return undefined;
    }

    return {
      node,
      restPosition: node.position.clone(),
      restQuaternion: node.quaternion.clone(),
    };
  }

  private findNamedNode(root: THREE.Object3D, candidates: string[]): THREE.Object3D | undefined {
    const normalizedCandidates = candidates.map((candidate) => this.normalizeName(candidate));
    let exact: THREE.Object3D | undefined;
    let partial: THREE.Object3D | undefined;

    root.traverse((child) => {
      if (exact) {
        return;
      }

      const normalized = this.normalizeName(child.name);

      if (normalizedCandidates.includes(normalized)) {
        exact = child;
        return;
      }

      if (!partial && normalizedCandidates.some((candidate) => normalized.includes(candidate))) {
        partial = child;
      }
    });

    return exact ?? partial;
  }

  private normalizeName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private quatTuple(x: number, y: number, z: number): [number, number, number, number] {
    this.tempQuaternion.setFromEuler(new THREE.Euler(x, y, z, 'XYZ'));
    return [this.tempQuaternion.x, this.tempQuaternion.y, this.tempQuaternion.z, this.tempQuaternion.w];
  }
}
