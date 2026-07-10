import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AudioSystem } from './AudioSystem';
import { EnemyManager } from './EnemyManager';
import { publicAsset } from './publicAsset';

interface TimedLine {
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  life: number;
  maxLife: number;
}

interface TimedImpact {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  life: number;
  maxLife: number;
}

interface TimedLightning {
  group: THREE.Group;
  materials: Array<THREE.LineBasicMaterial | THREE.MeshBasicMaterial>;
  flash?: THREE.PointLight;
  life: number;
  maxLife: number;
}

export interface ShootResult {
  fired: boolean;
  hitEnemy: boolean;
  defeated: boolean;
}

export class WeaponSystem {
  readonly maxAmmo = 24;
  ammo = this.maxAmmo;
  reloading = false;
  private readonly raycaster = new THREE.Raycaster();
  private readonly tracers: TimedLine[] = [];
  private readonly impacts: TimedImpact[] = [];
  private readonly lightningBolts: TimedLightning[] = [];
  private readonly viewModel = new THREE.Group();
  private readonly generatedWeapon = new THREE.Group();
  private readonly modelLoader = new GLTFLoader();
  private readonly muzzleFlash = new THREE.PointLight(0x7af7ff, 0, 3.2, 2);
  private cooldown = 0;
  private reloadTimer = 0;
  private recoil = 0;
  private clock = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly audio: AudioSystem,
  ) {
    this.raycaster.far = 44;
    this.createViewModel();
    void this.loadWeaponModel();
  }

  reset(): void {
    this.ammo = this.maxAmmo;
    this.reloading = false;
    this.cooldown = 0;
    this.reloadTimer = 0;
    this.recoil = 0;

    for (const tracer of this.tracers) {
      this.scene.remove(tracer.line);
      tracer.line.geometry.dispose();
      tracer.line.material.dispose();
    }

    for (const impact of this.impacts) {
      this.scene.remove(impact.mesh);
      impact.mesh.geometry.dispose();
      impact.mesh.material.dispose();
    }

    for (const bolt of this.lightningBolts) {
      this.disposeLightning(bolt);
    }

    this.tracers.length = 0;
    this.impacts.length = 0;
    this.lightningBolts.length = 0;
  }

  setFirstPersonVisible(visible: boolean): void {
    this.viewModel.visible = visible;
  }

  reload(): void {
    if (this.ammo >= this.maxAmmo || this.reloading) {
      return;
    }

    this.startReload();
  }

  update(deltaSeconds: number, moveAmount: number): void {
    this.clock += deltaSeconds;
    this.cooldown = Math.max(0, this.cooldown - deltaSeconds);
    this.recoil = Math.max(0, this.recoil - deltaSeconds * 7.5);

    if (this.reloadTimer > 0) {
      this.reloadTimer -= deltaSeconds;

      if (this.reloadTimer <= 0) {
        this.reloadTimer = 0;
        this.reloading = false;
        this.ammo = this.maxAmmo;
        this.audio.playReload();
      }
    }

    this.updateViewModel(moveAmount);
    this.updateTimedEffects(deltaSeconds);
  }

  tryShoot(
    enemyManager: EnemyManager,
    worldObjects: THREE.Object3D[],
    muzzleOverride?: THREE.Vector3,
  ): ShootResult {
    if (this.cooldown > 0 || this.reloading) {
      return { fired: false, hitEnemy: false, defeated: false };
    }

    if (this.ammo <= 0) {
      this.startReload();
      this.audio.playEmpty();
      return { fired: false, hitEnemy: false, defeated: false };
    }

    this.cooldown = 0.13;
    this.ammo -= 1;
    this.recoil = 1;
    this.audio.playShot();

    const rayOrigin = new THREE.Vector3();
    const rayDirection = new THREE.Vector3();
    this.camera.getWorldPosition(rayOrigin);
    this.camera.getWorldDirection(rayDirection);
    this.raycaster.set(rayOrigin, rayDirection);
    const muzzle = this.resolveVisualMuzzle(muzzleOverride, rayOrigin);

    const intersects = this.raycaster.intersectObjects(
      [...enemyManager.getTargetObjects(), ...worldObjects],
      true,
    );
    const nearest = intersects[0];
    const endPoint = nearest
      ? nearest.point.clone()
      : rayOrigin.clone().addScaledVector(rayDirection, this.raycaster.far);
    let hitEnemy = false;
    let defeated = false;

    if (nearest) {
      const enemyId = this.findEnemyId(nearest.object);

      if (enemyId !== null) {
        const result = enemyManager.damageEnemy(enemyId, 24);
        hitEnemy = result.hit;
        defeated = result.defeated;

        if (defeated) {
          this.audio.playEnemyDown();
        } else if (hitEnemy) {
          this.audio.playHit();
        }
      }
    }

    this.spawnLightning(muzzle, endPoint, hitEnemy);
    this.spawnTracer(muzzle, endPoint);
    this.spawnImpact(endPoint, hitEnemy);

    if (this.ammo <= 0) {
      this.startReload();
    }

    return { fired: true, hitEnemy, defeated };
  }

  private startReload(): void {
    if (this.reloading) {
      return;
    }

    this.reloading = true;
    this.reloadTimer = 1.15;
  }

  private createViewModel(): void {
    const weaponMaterial = new THREE.MeshStandardMaterial({
      color: 0xf7f8ff,
      metalness: 0.38,
      roughness: 0.24,
      emissive: 0x182046,
      emissiveIntensity: 0.2,
    });
    const darkMaterial = new THREE.MeshStandardMaterial({
      color: 0x17234c,
      metalness: 0.32,
      roughness: 0.3,
      emissive: 0x070e24,
      emissiveIntensity: 0.14,
    });
    const accentMaterial = new THREE.MeshStandardMaterial({
      color: 0x72f2ff,
      emissive: 0x18c7ff,
      emissiveIntensity: 1.05,
      metalness: 0.2,
      roughness: 0.14,
    });
    const trimMaterial = new THREE.MeshStandardMaterial({
      color: 0xff8dce,
      emissive: 0xff45ae,
      emissiveIntensity: 0.55,
      roughness: 0.2,
      metalness: 0.16,
    });
    const gloveMaterial = new THREE.MeshStandardMaterial({
      color: 0xffb8d8,
      roughness: 0.42,
      emissive: 0x481631,
      emissiveIntensity: 0.1,
    });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.62), weaponMaterial);
    const upperShroud = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.075, 0.44), darkMaterial);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.058, 0.58, 18), accentMaterial);
    const muzzleRing = new THREE.Mesh(new THREE.TorusGeometry(0.072, 0.012, 8, 22), trimMaterial);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.28, 0.16), darkMaterial);
    const energyCell = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.13, 0.2), accentMaterial);
    const leftRail = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.08, 0.38), trimMaterial);
    const rightRail = leftRail.clone();
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.14), weaponMaterial);
    const sightLens = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 8), accentMaterial);
    const leftHand = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 10), gloveMaterial);
    const rightHand = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 10), gloveMaterial);

    body.position.set(0.34, -0.28, -0.62);
    upperShroud.position.set(0.34, -0.16, -0.7);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0.34, -0.25, -1.05);
    muzzleRing.rotation.x = Math.PI / 2;
    muzzleRing.position.set(0.34, -0.25, -1.34);
    grip.position.set(0.28, -0.47, -0.53);
    grip.rotation.x = -0.22;
    energyCell.position.set(0.34, -0.32, -0.32);
    leftRail.position.set(0.14, -0.25, -0.8);
    rightRail.position.x = 0.54;
    sight.position.set(0.34, -0.08, -0.64);
    sightLens.position.set(0.34, -0.035, -0.67);
    leftHand.position.set(0.12, -0.42, -0.74);
    rightHand.position.set(0.43, -0.45, -0.5);
    this.muzzleFlash.position.set(0.34, -0.25, -1.38);

    this.generatedWeapon.add(
      body,
      upperShroud,
      barrel,
      muzzleRing,
      grip,
      energyCell,
      leftRail,
      rightRail,
      sight,
      sightLens,
    );
    this.viewModel.add(
      this.generatedWeapon,
      leftHand,
      rightHand,
      this.muzzleFlash,
    );
    this.camera.add(this.viewModel);
  }

  private async loadWeaponModel(): Promise<void> {
    try {
      const gltf = await this.modelLoader.loadAsync(publicAsset('assets/kenney-blaster/blaster-l.glb'));
      const model = gltf.scene;
      const targetCenter = new THREE.Vector3(0.34, -0.3, -0.88);
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      const longestAxis = Math.max(size.x, size.y, size.z);

      if (longestAxis <= 0.0001) {
        return;
      }

      model.scale.setScalar(0.98 / longestAxis);
      model.rotation.y = 0;
      model.updateWorldMatrix(true, true);

      const normalizedBounds = new THREE.Box3().setFromObject(model);
      const normalizedCenter = normalizedBounds.getCenter(new THREE.Vector3());
      model.position.copy(targetCenter.sub(normalizedCenter));
      model.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = true;
        }
      });

      this.generatedWeapon.visible = false;
      this.viewModel.add(model);
    } catch {
      // The generated weapon remains available when the optional GLB cannot be loaded.
    }
  }

  private updateViewModel(moveAmount: number): void {
    const bob = Math.sin(this.clock * 9) * moveAmount;
    this.viewModel.position.set(bob * 0.01, Math.abs(bob) * -0.012, this.recoil * 0.06);
    this.viewModel.rotation.x = this.recoil * 0.055;
    this.viewModel.rotation.z = bob * 0.01;
    this.muzzleFlash.intensity = this.recoil * 3.2;
  }

  private updateTimedEffects(deltaSeconds: number): void {
    for (let index = this.tracers.length - 1; index >= 0; index -= 1) {
      const tracer = this.tracers[index];
      tracer.life -= deltaSeconds;
      tracer.line.material.opacity = Math.max(0, tracer.life / tracer.maxLife);

      if (tracer.life <= 0) {
        this.scene.remove(tracer.line);
        tracer.line.geometry.dispose();
        tracer.line.material.dispose();
        this.tracers.splice(index, 1);
      }
    }

    for (let index = this.impacts.length - 1; index >= 0; index -= 1) {
      const impact = this.impacts[index];
      impact.life -= deltaSeconds;
      const scale = 1 + (1 - impact.life / impact.maxLife) * 1.8;
      impact.mesh.scale.setScalar(scale);
      impact.mesh.material.opacity = Math.max(0, impact.life / impact.maxLife);

      if (impact.life <= 0) {
        this.scene.remove(impact.mesh);
        impact.mesh.geometry.dispose();
        impact.mesh.material.dispose();
        this.impacts.splice(index, 1);
      }
    }

    for (let index = this.lightningBolts.length - 1; index >= 0; index -= 1) {
      const bolt = this.lightningBolts[index];
      bolt.life -= deltaSeconds;
      const opacity = Math.max(0, bolt.life / bolt.maxLife);

      for (const material of bolt.materials) {
        material.opacity = opacity;
      }

      if (bolt.flash) {
        bolt.flash.intensity = opacity * 4.8;
      }

      if (bolt.life <= 0) {
        this.disposeLightning(bolt);
        this.lightningBolts.splice(index, 1);
      }
    }
  }

  private spawnLightning(start: THREE.Vector3, end: THREE.Vector3, enemyHit: boolean): void {
    const direction = new THREE.Vector3().subVectors(end, start);
    const distance = direction.length();

    if (distance <= 0.01) {
      return;
    }

    direction.multiplyScalar(1 / distance);
    const sideways = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0));

    if (sideways.lengthSq() < 0.0001) {
      sideways.crossVectors(direction, new THREE.Vector3(1, 0, 0));
    }

    sideways.normalize();
    const vertical = new THREE.Vector3().crossVectors(sideways, direction).normalize();
    const group = new THREE.Group();
    const materials: Array<THREE.LineBasicMaterial | THREE.MeshBasicMaterial> = [];
    const boltColor = enemyHit ? 0xfff2a8 : 0xf5fdff;
    const segmentCount = THREE.MathUtils.clamp(Math.ceil(distance * 0.75), 7, 18);
    const points = this.createLightningPoints(
      start,
      end,
      sideways,
      vertical,
      segmentCount,
      Math.min(0.42, distance * 0.025),
    );

    this.addLightningBolt(group, materials, points, boltColor, 1);

    const forkCount = distance > 3 ? 2 : 1;

    for (let index = 0; index < forkCount; index += 1) {
      const anchorIndex = THREE.MathUtils.clamp(
        Math.floor(segmentCount * (0.35 + Math.random() * 0.35)),
        1,
        points.length - 2,
      );
      const forkStart = points[anchorIndex];
      const forkLength = Math.min(2.4, distance * (0.12 + Math.random() * 0.12));
      const forkEnd = forkStart
        .clone()
        .addScaledVector(direction, forkLength)
        .addScaledVector(sideways, (Math.random() - 0.5) * forkLength * 1.5)
        .addScaledVector(vertical, (Math.random() - 0.5) * forkLength * 0.65);
      const forkPoints = this.createLightningPoints(
        forkStart,
        forkEnd,
        sideways,
        vertical,
        4,
        Math.min(0.25, forkLength * 0.12),
      );
      this.addLightningBolt(group, materials, forkPoints, boltColor, 0.65);
    }

    const flash = new THREE.PointLight(boltColor, 4.8, 3.4, 2);
    flash.position.copy(start);
    group.add(flash);
    this.scene.add(group);
    this.lightningBolts.push({ group, materials, flash, life: 0.3, maxLife: 0.3 });
  }

  private createLightningPoints(
    start: THREE.Vector3,
    end: THREE.Vector3,
    sideways: THREE.Vector3,
    vertical: THREE.Vector3,
    segmentCount: number,
    amplitude: number,
  ): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];

    for (let index = 0; index <= segmentCount; index += 1) {
      const progress = index / segmentCount;
      const point = start.clone().lerp(end, progress);

      if (index > 0 && index < segmentCount) {
        point.addScaledVector(sideways, (Math.random() - 0.5) * amplitude * 2);
        point.addScaledVector(vertical, (Math.random() - 0.5) * amplitude);
      }

      points.push(point);
    }

    return points;
  }

  private addLightningBolt(
    group: THREE.Group,
    materials: Array<THREE.LineBasicMaterial | THREE.MeshBasicMaterial>,
    points: THREE.Vector3[],
    color: number,
    opacity: number,
  ): void {
    const curve = new THREE.CatmullRomCurve3(points);
    const outerMaterial = new THREE.MeshBasicMaterial({
      color: 0x4361ee,
      transparent: true,
      opacity: opacity * 0.58,
      depthWrite: false,
    });
    const coreMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    const tubularSegments = Math.max(12, points.length * 3);
    const outer = new THREE.Mesh(
      new THREE.TubeGeometry(curve, tubularSegments, 0.055, 6, false),
      outerMaterial,
    );
    const core = new THREE.Mesh(
      new THREE.TubeGeometry(curve, tubularSegments, 0.022, 5, false),
      coreMaterial,
    );

    group.add(outer, core);
    materials.push(outerMaterial, coreMaterial);
  }

  private disposeLightning(bolt: TimedLightning): void {
    this.scene.remove(bolt.group);
    bolt.group.traverse((object) => {
      if (object instanceof THREE.Line || object instanceof THREE.Mesh) {
        object.geometry.dispose();
      }
    });

    for (const material of bolt.materials) {
      material.dispose();
    }
  }

  private spawnTracer(start: THREE.Vector3, end: THREE.Vector3): void {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const material = new THREE.LineBasicMaterial({
      color: 0x8ff8ff,
      transparent: true,
      opacity: 0.9,
    });
    const line = new THREE.Line(geometry, material);

    this.scene.add(line);
    this.tracers.push({ line, life: 0.08, maxLife: 0.08 });
  }

  private spawnImpact(position: THREE.Vector3, enemyHit: boolean): void {
    const material = new THREE.MeshBasicMaterial({
      color: enemyHit ? 0xfff06a : 0x79f7ff,
      transparent: true,
      opacity: 0.9,
    });
    const mesh = new THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>(
      new THREE.SphereGeometry(enemyHit ? 0.14 : 0.1, 16, 8),
      material,
    );

    mesh.position.copy(position);
    this.scene.add(mesh);
    this.impacts.push({ mesh, life: 0.16, maxLife: 0.16 });
  }

  private getMuzzleWorldPosition(): THREE.Vector3 {
    const localMuzzle = new THREE.Vector3(0.34, -0.25, -1.25);
    return this.camera.localToWorld(localMuzzle);
  }

  private resolveVisualMuzzle(
    muzzleOverride: THREE.Vector3 | undefined,
    rayOrigin: THREE.Vector3,
  ): THREE.Vector3 {
    if (
      muzzleOverride &&
      Number.isFinite(muzzleOverride.x) &&
      Number.isFinite(muzzleOverride.y) &&
      Number.isFinite(muzzleOverride.z) &&
      muzzleOverride.distanceToSquared(rayOrigin) < 36
    ) {
      return muzzleOverride.clone();
    }

    return this.getMuzzleWorldPosition();
  }

  private findEnemyId(object: THREE.Object3D): number | null {
    let current: THREE.Object3D | null = object;

    while (current) {
      const enemyId = current.userData.enemyId;

      if (typeof enemyId === 'number') {
        return enemyId;
      }

      current = current.parent;
    }

    return null;
  }
}
