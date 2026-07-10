import * as THREE from 'three';
import { CollisionSystem } from './CollisionSystem';
import { publicAsset } from './publicAsset';

type EnemyKind = 'orb' | 'drone' | 'target';

interface EnemyState {
  id: number;
  kind: EnemyKind;
  group: THREE.Group;
  health: number;
  maxHealth: number;
  radius: number;
  speed: number;
  visualScale: number;
  engagementDistance: number;
  attackRange: number;
  attackCooldown: number;
  spawnProgress: number;
  baseY: number;
  phase: number;
}

interface DamageResult {
  hit: boolean;
  defeated: boolean;
}

const TARGET_COUNT = 6;

export class EnemyManager {
  private readonly textureLoader = new THREE.TextureLoader();
  private readonly enemySkinColor: THREE.Texture;
  private readonly enemySkinNormal: THREE.Texture;
  private readonly enemySkinRoughness: THREE.Texture;
  private readonly enemies = new Map<number, EnemyState>();
  private readonly spawnPoints = [
    new THREE.Vector3(-13, 0, -13),
    new THREE.Vector3(13, 0, -13),
    new THREE.Vector3(-13, 0, 3),
    new THREE.Vector3(13, 0, 4),
    new THREE.Vector3(-5, 0, -11),
    new THREE.Vector3(6, 0, -8),
    new THREE.Vector3(0, 0, -15),
  ];
  private nextId = 1;
  private respawnTimer = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly collision: CollisionSystem,
  ) {
    this.enemySkinColor = this.loadSkinTexture(
      publicAsset('assets/polyhaven/painted-concrete/painted_concrete_02_diff_1k.jpg'),
      true,
    );
    this.enemySkinNormal = this.loadSkinTexture(
      publicAsset('assets/polyhaven/painted-concrete/painted_concrete_02_nor_gl_1k.jpg'),
    );
    this.enemySkinRoughness = this.loadSkinTexture(
      publicAsset('assets/polyhaven/painted-concrete/painted_concrete_02_rough_1k.jpg'),
    );
  }

  reset(): void {
    for (const enemy of this.enemies.values()) {
      this.removeEnemy(enemy);
    }

    this.enemies.clear();
    this.nextId = 1;
    this.respawnTimer = 0;

    for (let index = 0; index < TARGET_COUNT; index += 1) {
      this.spawnEnemy(this.spawnPoints[index], this.kindForIndex(index));
    }
  }

  update(
    deltaSeconds: number,
    playerPosition: THREE.Vector3,
    onPlayerDamage: (amount: number) => void,
  ): void {
    for (const enemy of this.enemies.values()) {
      this.updateEnemy(enemy, deltaSeconds, playerPosition, onPlayerDamage);
    }

    if (this.enemies.size >= TARGET_COUNT) {
      return;
    }

    this.respawnTimer -= deltaSeconds;

    if (this.respawnTimer <= 0) {
      const spawnPoint = this.findFarthestSpawnPoint(playerPosition);
      this.spawnEnemy(spawnPoint, this.kindForIndex(this.nextId));
      this.respawnTimer = 1.7;
    }
  }

  getTargetObjects(): THREE.Object3D[] {
    return [...this.enemies.values()].map((enemy) => enemy.group);
  }

  getEnemyCount(): number {
    return this.enemies.size;
  }

  getRoundTargetCount(): number {
    return TARGET_COUNT;
  }

  damageEnemy(enemyId: number, amount: number): DamageResult {
    const enemy = this.enemies.get(enemyId);

    if (!enemy || enemy.spawnProgress < 1) {
      return { hit: false, defeated: false };
    }

    enemy.health -= amount;
    this.flashEnemy(enemy);

    if (enemy.health > 0) {
      return { hit: true, defeated: false };
    }

    this.removeEnemy(enemy);
    this.enemies.delete(enemyId);
    return { hit: true, defeated: true };
  }

  private updateEnemy(
    enemy: EnemyState,
    deltaSeconds: number,
    playerPosition: THREE.Vector3,
    onPlayerDamage: (amount: number) => void,
  ): void {
    enemy.phase += deltaSeconds;
    enemy.attackCooldown = Math.max(0, enemy.attackCooldown - deltaSeconds);

    if (enemy.spawnProgress < 1) {
      enemy.spawnProgress = Math.min(1, enemy.spawnProgress + deltaSeconds * 2.6);
      const scale = THREE.MathUtils.smoothstep(enemy.spawnProgress, 0, 1) * enemy.visualScale;
      enemy.group.scale.setScalar(scale);
      return;
    }

    const toPlayer = new THREE.Vector3().subVectors(playerPosition, enemy.group.position);
    toPlayer.y = 0;
    const distance = toPlayer.length();

    if (distance > enemy.engagementDistance && enemy.speed > 0) {
      toPlayer.normalize();
      const delta = toPlayer.multiplyScalar(enemy.speed * deltaSeconds);
      const nextPosition = this.collision.moveWithCollisions(enemy.group.position, delta, enemy.radius);
      nextPosition.y = enemy.baseY;
      enemy.group.position.copy(nextPosition);
    }

    enemy.group.position.y = enemy.baseY + Math.sin(enemy.phase * 2.4) * (enemy.kind === 'drone' ? 0.18 : 0.04);
    enemy.group.lookAt(playerPosition.x, enemy.group.position.y, playerPosition.z);
    enemy.group.rotateY(Math.PI);
    this.updateEnemyVisuals(enemy, deltaSeconds);

    if (enemy.attackRange > 0 && distance < enemy.attackRange && enemy.attackCooldown <= 0) {
      enemy.attackCooldown = enemy.kind === 'drone' ? 1.8 : 2.1;
      onPlayerDamage(enemy.kind === 'drone' ? 5 : 3);
    }

    const healthRatio = THREE.MathUtils.clamp(enemy.health / enemy.maxHealth, 0, 1);
    const healthBar = enemy.group.getObjectByName('health-fill');

    if (healthBar) {
      healthBar.scale.x = healthRatio;
    }
  }

  private spawnEnemy(spawnPoint: THREE.Vector3, kind: EnemyKind): void {
    const id = this.nextId;
    this.nextId += 1;

    const group = this.createEnemyModel(kind);
    const maxHealth = kind === 'target' ? 45 : kind === 'drone' ? 70 : 60;
    const baseY = kind === 'drone' ? 1.75 : kind === 'target' ? 0.95 : 0.62;
    const visualScale = kind === 'target' ? 0.72 : kind === 'drone' ? 0.62 : 0.58;
    const engagementDistance = kind === 'target' ? Infinity : kind === 'drone' ? 3.6 : 3.0;
    const attackRange = kind === 'target' ? 0 : kind === 'drone' ? 1.15 : 0.95;

    group.position.set(spawnPoint.x, baseY, spawnPoint.z);
    group.scale.setScalar(0.01);
    group.userData.enemyId = id;
    group.traverse((object) => {
      object.userData.enemyId = id;
    });
    this.scene.add(group);

    this.enemies.set(id, {
      id,
      kind,
      group,
      health: maxHealth,
      maxHealth,
      radius: kind === 'drone' ? 0.42 : 0.38,
      speed: kind === 'target' ? 0 : kind === 'drone' ? 1.15 : 0.85,
      visualScale,
      engagementDistance,
      attackRange,
      attackCooldown: 0,
      spawnProgress: 0,
      baseY,
      phase: Math.random() * Math.PI * 2,
    });
  }

  private createEnemyModel(kind: EnemyKind): THREE.Group {
    switch (kind) {
      case 'drone':
        return this.createDrone();
      case 'target':
        return this.createTarget();
      case 'orb':
      default:
        return this.createOrb();
    }
  }

  private createOrb(): THREE.Group {
    const group = new THREE.Group();
    const shellMaterial = new THREE.MeshStandardMaterial({
      color: 0x9dc9e5,
      map: this.enemySkinColor,
      normalMap: this.enemySkinNormal,
      roughnessMap: this.enemySkinRoughness,
      normalScale: new THREE.Vector2(0.16, 0.16),
      metalness: 0.35,
      roughness: 0.42,
      emissive: 0x103d68,
      emissiveIntensity: 0.25,
    });
    const coreMaterial = new THREE.MeshStandardMaterial({
      color: 0x42d7ff,
      emissive: 0x00b8ff,
      emissiveIntensity: 1.1,
      roughness: 0.18,
    });
    const trimMaterial = new THREE.MeshStandardMaterial({
      color: 0xff86cf,
      emissive: 0xff3bb2,
      emissiveIntensity: 0.65,
      metalness: 0.12,
      roughness: 0.2,
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 18), shellMaterial);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 14), coreMaterial);
    const ringA = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.025, 8, 48), coreMaterial);
    const ringB = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.018, 8, 48), trimMaterial);
    const ringC = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.014, 8, 36), coreMaterial);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 12), coreMaterial);
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 10), trimMaterial);
    const antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), trimMaterial);

    ringA.rotation.x = Math.PI / 2;
    ringB.rotation.y = Math.PI / 2;
    ringC.rotation.set(Math.PI / 4, 0, Math.PI / 5);
    eye.position.set(0, 0.05, -0.48);
    antenna.position.set(0, 0.55, 0);
    antenna.rotation.z = -0.24;
    antennaTip.position.set(0.04, 0.72, 0);
    ringA.name = 'orb-ring-a';
    ringB.name = 'orb-ring-b';
    ringC.name = 'orb-ring-c';
    core.name = 'pulse-core';

    group.add(sphere, core, ringA, ringB, ringC, eye, antenna, antennaTip);
    this.addHealthBar(group, 0.85);
    return group;
  }

  private createDrone(): THREE.Group {
    const group = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0xa9cfe1,
      map: this.enemySkinColor,
      normalMap: this.enemySkinNormal,
      roughnessMap: this.enemySkinRoughness,
      normalScale: new THREE.Vector2(0.15, 0.15),
      metalness: 0.25,
      roughness: 0.42,
      emissive: 0x23335d,
      emissiveIntensity: 0.2,
    });
    const accentMaterial = new THREE.MeshStandardMaterial({
      color: 0xff72d2,
      emissive: 0xff38be,
      emissiveIntensity: 0.9,
      roughness: 0.2,
    });
    const darkMaterial = new THREE.MeshStandardMaterial({
      color: 0x19264d,
      metalness: 0.32,
      roughness: 0.3,
      emissive: 0x09112a,
      emissiveIntensity: 0.14,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.35, 0.55), bodyMaterial);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), darkMaterial);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 10), accentMaterial);
    const sensor = new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 10), accentMaterial);
    const wingGeometry = new THREE.BoxGeometry(0.75, 0.08, 0.18);
    const rotorGeometry = new THREE.TorusGeometry(0.23, 0.018, 8, 28);
    const leftWing = new THREE.Mesh(wingGeometry, bodyMaterial);
    const rightWing = leftWing.clone();
    const leftRotor = new THREE.Mesh(rotorGeometry, accentMaterial);
    const rightRotor = leftRotor.clone();
    const leftPod = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.32, 12), darkMaterial);
    const rightPod = leftPod.clone();
    const leftStrut = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.045, 0.05), darkMaterial);
    const rightStrut = leftStrut.clone();

    canopy.position.set(0, 0.12, 0.02);
    canopy.rotation.x = Math.PI / 2;
    core.position.set(0, -0.13, 0.05);
    sensor.position.set(0, 0.01, -0.31);
    leftWing.position.set(-0.62, 0, 0);
    rightWing.position.set(0.62, 0, 0);
    leftRotor.position.set(-0.98, 0.02, 0);
    rightRotor.position.set(0.98, 0.02, 0);
    leftRotor.rotation.x = Math.PI / 2;
    rightRotor.rotation.x = Math.PI / 2;
    leftPod.rotation.z = Math.PI / 2;
    rightPod.rotation.z = Math.PI / 2;
    leftPod.position.set(-0.86, -0.05, 0.04);
    rightPod.position.set(0.86, -0.05, 0.04);
    leftStrut.rotation.z = -0.18;
    rightStrut.rotation.z = 0.18;
    leftStrut.position.set(-0.47, -0.09, 0.06);
    rightStrut.position.set(0.47, -0.09, 0.06);
    leftRotor.name = 'drone-rotor-left';
    rightRotor.name = 'drone-rotor-right';
    core.name = 'pulse-core';

    group.add(
      body,
      canopy,
      core,
      sensor,
      leftWing,
      rightWing,
      leftPod,
      rightPod,
      leftStrut,
      rightStrut,
      leftRotor,
      rightRotor,
    );
    this.addHealthBar(group, 0.55);
    return group;
  }

  private createTarget(): THREE.Group {
    const group = new THREE.Group();
    const frameMaterial = new THREE.MeshStandardMaterial({
      color: 0xc4e1e9,
      map: this.enemySkinColor,
      normalMap: this.enemySkinNormal,
      roughnessMap: this.enemySkinRoughness,
      normalScale: new THREE.Vector2(0.12, 0.12),
      metalness: 0.15,
      roughness: 0.48,
    });
    const ringMaterial = new THREE.MeshStandardMaterial({
      color: 0x58f1d8,
      emissive: 0x12cdb6,
      emissiveIntensity: 0.75,
      roughness: 0.22,
    });
    const centerMaterial = new THREE.MeshStandardMaterial({
      color: 0xff7ab8,
      emissive: 0xff4fa1,
      emissiveIntensity: 0.85,
      roughness: 0.2,
    });
    const darkMaterial = new THREE.MeshStandardMaterial({
      color: 0x1d2b52,
      metalness: 0.3,
      roughness: 0.34,
      emissive: 0x0b1331,
      emissiveIntensity: 0.14,
    });
    const disk = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.12, 48), frameMaterial);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.035, 8, 42), ringMaterial);
    const outerRing = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.018, 8, 48), ringMaterial);
    const center = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.135, 28), centerMaterial);
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), frameMaterial);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 0.52), frameMaterial);
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.05, 0.08), darkMaterial);
    const warningLeft = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.03), centerMaterial);
    const warningRight = warningLeft.clone();

    disk.rotation.x = Math.PI / 2;
    ring.position.z = -0.08;
    outerRing.position.z = -0.065;
    center.rotation.x = Math.PI / 2;
    center.position.z = -0.09;
    stand.position.y = -0.65;
    base.position.y = -1.1;
    bracket.position.set(0, -0.94, 0.06);
    warningLeft.position.set(-0.38, -0.93, -0.015);
    warningRight.position.set(0.38, -0.93, -0.015);
    ring.name = 'target-ring';
    outerRing.name = 'target-outer-ring';
    center.name = 'pulse-core';

    group.add(disk, ring, outerRing, center, stand, base, bracket, warningLeft, warningRight);
    this.addHealthBar(group, 0.85);
    return group;
  }

  private addHealthBar(group: THREE.Group, y: number): void {
    const backgroundMaterial = new THREE.MeshBasicMaterial({
      color: 0x1d2b4f,
      transparent: true,
      opacity: 0.8,
    });
    const fillMaterial = new THREE.MeshBasicMaterial({
      color: 0x74ffcf,
      transparent: true,
      opacity: 0.95,
    });
    const background = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.045, 0.025), backgroundMaterial);
    const fill = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.035, 0.03), fillMaterial);

    background.position.set(0, y, 0);
    fill.position.set(0, y, -0.01);
    fill.name = 'health-fill';
    group.add(background, fill);
  }

  private loadSkinTexture(path: string, colorTexture = false): THREE.Texture {
    const texture = this.textureLoader.load(path);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 2);

    if (colorTexture) {
      texture.colorSpace = THREE.SRGBColorSpace;
    }

    return texture;
  }

  private updateEnemyVisuals(enemy: EnemyState, deltaSeconds: number): void {
    const ringA = enemy.group.getObjectByName('orb-ring-a');
    const ringB = enemy.group.getObjectByName('orb-ring-b');
    const ringC = enemy.group.getObjectByName('orb-ring-c');
    const leftRotor = enemy.group.getObjectByName('drone-rotor-left');
    const rightRotor = enemy.group.getObjectByName('drone-rotor-right');
    const targetRing = enemy.group.getObjectByName('target-ring');
    const targetOuterRing = enemy.group.getObjectByName('target-outer-ring');
    const core = enemy.group.getObjectByName('pulse-core');

    if (ringA) {
      ringA.rotation.z += deltaSeconds * 2.1;
    }

    if (ringB) {
      ringB.rotation.x -= deltaSeconds * 1.7;
    }

    if (ringC) {
      ringC.rotation.y += deltaSeconds * 1.2;
    }

    if (leftRotor) {
      leftRotor.rotation.z += deltaSeconds * 10.8;
    }

    if (rightRotor) {
      rightRotor.rotation.z -= deltaSeconds * 10.8;
    }

    if (targetRing) {
      targetRing.rotation.z += deltaSeconds * 1.08;
    }

    if (targetOuterRing) {
      targetOuterRing.rotation.z -= deltaSeconds * 0.72;
    }

    if (core) {
      const pulse = 1 + Math.sin(enemy.phase * 5.5) * 0.08;
      core.scale.setScalar(pulse);
    }
  }

  private flashEnemy(enemy: EnemyState): void {
    enemy.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) {
        return;
      }

      const material = object.material;

      if (Array.isArray(material)) {
        return;
      }

      if ('emissiveIntensity' in material) {
        material.emissiveIntensity = Math.min((material.emissiveIntensity ?? 0) + 0.45, 1.4);
      }
    });

    window.setTimeout(() => {
      enemy.group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) {
          return;
        }

        const material = object.material;

        if (!Array.isArray(material) && 'emissiveIntensity' in material) {
          material.emissiveIntensity = Math.max((material.emissiveIntensity ?? 0) - 0.45, 0.15);
        }
      });
    }, 75);
  }

  private removeEnemy(enemy: EnemyState): void {
    this.scene.remove(enemy.group);
    enemy.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) {
        return;
      }

      object.geometry.dispose();
      const material = object.material;

      if (Array.isArray(material)) {
        for (const entry of material) {
          entry.dispose();
        }
      } else {
        material.dispose();
      }
    });
  }

  private kindForIndex(index: number): EnemyKind {
    const kinds: EnemyKind[] = ['orb', 'drone', 'target'];
    return kinds[index % kinds.length];
  }

  private findFarthestSpawnPoint(playerPosition: THREE.Vector3): THREE.Vector3 {
    let farthest = this.spawnPoints[0];
    let farthestDistance = -Infinity;

    for (const spawnPoint of this.spawnPoints) {
      const distance = spawnPoint.distanceToSquared(playerPosition);

      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthest = spawnPoint;
      }
    }

    return farthest;
  }
}
