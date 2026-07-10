import * as THREE from 'three';
import { AudioSystem } from './AudioSystem';
import { CameraController, type CameraMode } from './CameraController';
import { CharacterController } from './CharacterController';
import { CollisionSystem } from './CollisionSystem';
import { EnemyManager } from './EnemyManager';
import { InputController } from './InputController';
import { MobileControls } from './MobileControls';
import { PlayerController } from './PlayerController';
import { publicAsset } from './publicAsset';
import { UI } from './UI';
import { WeaponSystem } from './WeaponSystem';

type GameState = 'menu' | 'playing' | 'defeat' | 'victory';

interface StarlightDebugState {
  frame: number;
  state: GameState;
  canvasClientWidth: number;
  canvasClientHeight: number;
  drawingBufferWidth: number;
  drawingBufferHeight: number;
  pixelCheck: {
    sampleCount: number;
    uniqueColors: number;
    nonTransparent: number;
    averageBrightness: number;
  };
  enemyCount: number;
  cameraMode: CameraMode;
  characterVisible: boolean;
  avatarKind: string;
  avatarClipCount: number;
  characterAnimationState: string;
  characterProceduralAnimation: boolean;
  weaponAttachment: string;
}

declare global {
  interface Window {
    __STARLIGHT_DEBUG__?: StarlightDebugState;
  }
}

const ARENA_HALF_WIDTH = 18;
const ARENA_HALF_DEPTH = 18;

export class Game {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(74, 1, 0.1, 120);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly textureLoader = new THREE.TextureLoader();
  private readonly clock = new THREE.Clock();
  private readonly audio = new AudioSystem();
  private readonly collision = new CollisionSystem(ARENA_HALF_WIDTH, ARENA_HALF_DEPTH);
  private readonly worldObjects: THREE.Object3D[] = [];
  private readonly mobileControls: MobileControls;
  private readonly input: InputController;
  private readonly player: PlayerController;
  private readonly cameraController: CameraController;
  private readonly character: CharacterController;
  private readonly weapon: WeaponSystem;
  private readonly enemies: EnemyManager;
  private readonly ui: UI;
  private readonly aimDirection = new THREE.Vector3();
  private state: GameState = 'menu';
  private score = 0;
  private defeatedTargets = 0;
  private debugFrame = 0;
  private resizeObserver?: ResizeObserver;

  constructor(private readonly container: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(1, 1, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;
    this.container.append(this.renderer.domElement);

    this.scene.add(this.camera);
    this.mobileControls = new MobileControls(this.container);
    this.input = new InputController(this.renderer.domElement, this.mobileControls);
    this.player = new PlayerController(this.input, this.collision);
    this.cameraController = new CameraController(this.camera, this.player, this.collision);
    this.character = new CharacterController(this.scene);
    this.weapon = new WeaponSystem(this.scene, this.camera, this.audio);
    this.enemies = new EnemyManager(this.scene, this.collision);
    this.ui = new UI(this.container);

    this.configureScene();
    this.createArena();
    this.bindEvents();
    this.resize();
    this.resetGame();
    this.ui.showMenu();
  }

  start(): void {
    this.clock.start();
    this.loop();
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.scheduleResize);
    window.visualViewport?.addEventListener('resize', this.scheduleResize);
    window.addEventListener('focus', this.scheduleResize);
    window.addEventListener('pageshow', this.scheduleResize);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.scheduleResize();
      }
    });
    this.resizeObserver = new ResizeObserver(this.scheduleResize);
    this.resizeObserver.observe(this.container);
    window.addEventListener('pointerdown', () => void this.audio.resume());
    window.addEventListener('keydown', () => void this.audio.resume());

    this.renderer.domElement.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
    });

    this.ui.bindStart(() => {
      this.resetGame();
      this.state = 'playing';
      this.ui.showPlaying();
      this.mobileControls.setGameplayActive(true);
      this.input.requestPointerLock();
      void this.audio.resume();
    });

    this.ui.bindRestart(() => {
      this.resetGame();
      this.state = 'playing';
      this.ui.showPlaying();
      this.mobileControls.setGameplayActive(true);
      this.input.requestPointerLock();
      void this.audio.resume();
    });
  }

  private loop = (): void => {
    window.requestAnimationFrame(this.loop);
    const deltaSeconds = Math.min(this.clock.getDelta(), 0.05);

    if (this.state === 'playing') {
      this.update(deltaSeconds);
    } else {
      this.weapon.update(deltaSeconds, 0);
    }

    this.renderer.render(this.scene, this.camera);
    this.updateDebugState();
  };

  private update(deltaSeconds: number): void {
    if (this.input.consumeCameraToggle()) {
      this.cameraController.toggleFirstPerson();
    }

    if (this.input.consumeReloadIntent()) {
      this.weapon.reload();
    }

    this.player.update(deltaSeconds);
    this.enemies.update(deltaSeconds, this.player.position, (amount) => this.damagePlayer(amount));
    const moveAmount = this.input.getMoveMagnitude();
    const aimHeld = this.input.isAimHeld();
    this.cameraController.update(deltaSeconds, aimHeld, this.input.isFrontHeld());
    const cameraMode = this.cameraController.getMode();
    this.camera.getWorldDirection(this.aimDirection);
    this.character.update(
      this.player,
      cameraMode,
      deltaSeconds,
      moveAmount,
      aimHeld,
      this.weapon.reloading,
      this.aimDirection,
    );
    this.weapon.setFirstPersonVisible(this.cameraController.isFirstPersonActive());
    this.ui.setAimMode(cameraMode === 'AimMode');

    if (this.input.consumeFiringIntent()) {
      const visualMuzzle = this.cameraController.isFirstPersonActive()
        ? undefined
        : this.character.getMuzzleWorldPosition();
      const shot = this.weapon.tryShoot(this.enemies, this.worldObjects, visualMuzzle);

      if (shot.fired) {
        this.character.triggerShoot();
        this.character.update(
          this.player,
          cameraMode,
          0,
          moveAmount,
          aimHeld,
          this.weapon.reloading,
          this.aimDirection,
        );
      }

      if (shot.defeated) {
        this.score += 100;
        this.defeatedTargets += 1;

        if (this.defeatedTargets >= this.enemies.getRoundTargetCount()) {
          this.completeTraining();
          return;
        }
      } else if (shot.hitEnemy) {
        this.score += 10;
      }
    }

    this.weapon.update(deltaSeconds, moveAmount);
    this.ui.update({
      health: this.player.health,
      maxHealth: this.player.maxHealth,
      score: this.score,
      ammo: this.weapon.ammo,
      maxAmmo: this.weapon.maxAmmo,
      reloading: this.weapon.reloading,
      enemyCount: this.enemies.getEnemyCount(),
    });
  }

  private resetGame(): void {
    this.score = 0;
    this.defeatedTargets = 0;
    this.state = 'menu';
    this.mobileControls.setGameplayActive(false);
    this.input.reset();
    this.player.reset();
    this.cameraController.reset();
    this.cameraController.update(1 / 60, false, false);
    this.weapon.reset();
    this.enemies.reset();
    this.character.update(this.player, this.cameraController.getMode(), 0, 0);
    this.weapon.setFirstPersonVisible(false);
    this.ui.setAimMode(false);
    this.ui.update({
      health: this.player.health,
      maxHealth: this.player.maxHealth,
      score: this.score,
      ammo: this.weapon.ammo,
      maxAmmo: this.weapon.maxAmmo,
      reloading: this.weapon.reloading,
      enemyCount: this.enemies.getEnemyCount(),
    });
  }

  private damagePlayer(amount: number): void {
    const defeated = this.player.takeDamage(amount);
    this.audio.playDamage();

    if (defeated) {
      this.state = 'defeat';
      this.mobileControls.setGameplayActive(false);
      this.ui.showGameOver(this.score);
      document.exitPointerLock();
    }
  }

  private completeTraining(): void {
    this.state = 'victory';
    this.mobileControls.setGameplayActive(false);
    this.ui.showVictory(this.score);

    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
  }

  private configureScene(): void {
    this.scene.background = new THREE.Color(0xe8f8ff);
    this.scene.fog = new THREE.Fog(0xe8f8ff, 38, 88);

    const hemisphere = new THREE.HemisphereLight(0xffffff, 0xcde6ff, 1.35);
    this.scene.add(hemisphere);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.65);
    keyLight.position.set(8, 14, 7);
    keyLight.castShadow = true;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 48;
    keyLight.shadow.camera.left = -22;
    keyLight.shadow.camera.right = 22;
    keyLight.shadow.camera.top = 22;
    keyLight.shadow.camera.bottom = -22;
    keyLight.shadow.mapSize.set(2048, 2048);
    this.scene.add(keyLight);

    const fillLight = new THREE.PointLight(0x88f4ff, 4.2, 28, 1.8);
    fillLight.position.set(-8, 6, -7);
    this.scene.add(fillLight);

    const magentaFill = new THREE.PointLight(0xff8bd6, 2.8, 24, 1.9);
    magentaFill.position.set(9, 4.2, 8);
    this.scene.add(magentaFill);

    const coolFill = new THREE.PointLight(0x8aa7ff, 2.4, 22, 1.7);
    coolFill.position.set(-11, 3.8, 10);
    this.scene.add(coolFill);
  }

  private createArena(): void {
    this.collision.clear();
    this.worldObjects.length = 0;

    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0xc9e6f5,
      map: this.loadTiledTexture(publicAsset('assets/polyhaven/painted-concrete/painted_concrete_02_diff_1k.jpg'), 9, 9, true),
      normalMap: this.loadTiledTexture(publicAsset('assets/polyhaven/painted-concrete/painted_concrete_02_nor_gl_1k.jpg'), 9, 9),
      roughnessMap: this.loadTiledTexture(publicAsset('assets/polyhaven/painted-concrete/painted_concrete_02_rough_1k.jpg'), 9, 9),
      normalScale: new THREE.Vector2(0.24, 0.24),
      roughness: 0.72,
      metalness: 0.12,
    });
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(ARENA_HALF_WIDTH * 2, 0.22, ARENA_HALF_DEPTH * 2),
      floorMaterial,
    );
    floor.position.y = -0.12;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.worldObjects.push(floor);

    this.createWalls();
    this.createObstacles();
    this.createLightPanels();
    this.createSpawnPads();
    this.createArenaDecorations();
  }

  private createWalls(): void {
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0xa8d0dc,
      map: this.loadTiledTexture(publicAsset('assets/polyhaven/factory-wall/factory_wall_diff_1k.jpg'), 6, 1, true),
      normalMap: this.loadTiledTexture(publicAsset('assets/polyhaven/factory-wall/factory_wall_nor_gl_1k.jpg'), 6, 1),
      roughnessMap: this.loadTiledTexture(publicAsset('assets/polyhaven/factory-wall/factory_wall_rough_1k.jpg'), 6, 1),
      normalScale: new THREE.Vector2(0.2, 0.2),
      roughness: 0.62,
      metalness: 0.2,
    });
    const accentMaterial = new THREE.MeshStandardMaterial({
      color: 0xb9f5ff,
      emissive: 0x31d9ff,
      emissiveIntensity: 0.45,
      roughness: 0.25,
    });
    const wallSpecs = [
      {
        position: new THREE.Vector3(0, 2.2, -ARENA_HALF_DEPTH - 0.2),
        size: new THREE.Vector3(ARENA_HALF_WIDTH * 2 + 0.8, 4.4, 0.42),
      },
      {
        position: new THREE.Vector3(0, 2.2, ARENA_HALF_DEPTH + 0.2),
        size: new THREE.Vector3(ARENA_HALF_WIDTH * 2 + 0.8, 4.4, 0.42),
      },
      {
        position: new THREE.Vector3(-ARENA_HALF_WIDTH - 0.2, 2.2, 0),
        size: new THREE.Vector3(0.42, 4.4, ARENA_HALF_DEPTH * 2 + 0.8),
      },
      {
        position: new THREE.Vector3(ARENA_HALF_WIDTH + 0.2, 2.2, 0),
        size: new THREE.Vector3(0.42, 4.4, ARENA_HALF_DEPTH * 2 + 0.8),
      },
    ];

    for (const spec of wallSpecs) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(spec.size.x, spec.size.y, spec.size.z), wallMaterial);
      wall.position.copy(spec.position);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.scene.add(wall);
      this.worldObjects.push(wall);
    }

    for (let index = -2; index <= 2; index += 1) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.08, 0.08), accentMaterial);
      strip.position.set(index * 6, 2.5, -ARENA_HALF_DEPTH - 0.44);
      this.scene.add(strip);
    }
  }

  private createObstacles(): void {
    const obstacleMaterial = new THREE.MeshStandardMaterial({
      color: 0x8ab8cc,
      map: this.loadTiledTexture(publicAsset('assets/polyhaven/factory-wall/factory_wall_diff_1k.jpg'), 2, 2, true),
      normalMap: this.loadTiledTexture(publicAsset('assets/polyhaven/factory-wall/factory_wall_nor_gl_1k.jpg'), 2, 2),
      roughnessMap: this.loadTiledTexture(publicAsset('assets/polyhaven/factory-wall/factory_wall_rough_1k.jpg'), 2, 2),
      normalScale: new THREE.Vector2(0.18, 0.18),
      roughness: 0.5,
      metalness: 0.24,
      emissive: 0x1c2e5d,
      emissiveIntensity: 0.08,
    });
    const topMaterial = new THREE.MeshStandardMaterial({
      color: 0x94ffee,
      roughness: 0.25,
      metalness: 0.08,
      emissive: 0x19d5c8,
      emissiveIntensity: 0.32,
    });
    const specs = [
      { position: new THREE.Vector3(-7, 0.65, -5), size: new THREE.Vector3(3.2, 1.3, 2.2) },
      { position: new THREE.Vector3(6, 0.8, -2), size: new THREE.Vector3(2.2, 1.6, 4.4) },
      { position: new THREE.Vector3(-4, 0.55, 6), size: new THREE.Vector3(5.2, 1.1, 1.8) },
      { position: new THREE.Vector3(8.5, 0.6, 8), size: new THREE.Vector3(2.1, 1.2, 2.1) },
      { position: new THREE.Vector3(0, 1.1, -10), size: new THREE.Vector3(1.8, 2.2, 1.8) },
    ];

    for (const spec of specs) {
      const obstacle = new THREE.Mesh(
        new THREE.BoxGeometry(spec.size.x, spec.size.y, spec.size.z),
        obstacleMaterial,
      );
      obstacle.position.copy(spec.position);
      obstacle.castShadow = true;
      obstacle.receiveShadow = true;
      this.scene.add(obstacle);
      this.worldObjects.push(obstacle);
      this.collision.addBox(spec.position, spec.size, obstacle);

      const top = new THREE.Mesh(new THREE.BoxGeometry(spec.size.x * 0.8, 0.045, spec.size.z * 0.8), topMaterial);
      top.position.set(spec.position.x, spec.position.y + spec.size.y / 2 + 0.026, spec.position.z);
      this.scene.add(top);
      this.worldObjects.push(top);

      const frontTrim = new THREE.Mesh(new THREE.BoxGeometry(spec.size.x * 0.82, 0.06, 0.05), topMaterial);
      const sideTrim = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, spec.size.z * 0.82), topMaterial);
      frontTrim.position.set(spec.position.x, spec.position.y + spec.size.y / 2 + 0.11, spec.position.z - spec.size.z * 0.42);
      sideTrim.position.set(spec.position.x + spec.size.x * 0.42, spec.position.y + spec.size.y / 2 + 0.11, spec.position.z);
      this.scene.add(frontTrim, sideTrim);
    }
  }

  private createLightPanels(): void {
    const panelMaterial = new THREE.MeshBasicMaterial({
      color: 0xcaffff,
      transparent: true,
      opacity: 0.95,
    });

    for (let x = -12; x <= 12; x += 8) {
      for (let z = -12; z <= 12; z += 8) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.035, 0.55), panelMaterial);
        panel.position.set(x, 4.45, z);
        this.scene.add(panel);
      }
    }
  }

  private createSpawnPads(): void {
    const padMaterial = new THREE.MeshBasicMaterial({
      color: 0xff9de2,
      transparent: true,
      opacity: 0.36,
    });
    const positions = [
      [-13, -13],
      [13, -13],
      [-13, 3],
      [13, 4],
      [-5, -11],
      [6, -8],
      [0, -15],
    ] as const;

    for (const [x, z] of positions) {
      const pad = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.95, 36), padMaterial);
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(x, 0.012, z);
      this.scene.add(pad);
    }
  }

  private createArenaDecorations(): void {
    const cyanMaterial = new THREE.MeshStandardMaterial({
      color: 0x9df7ff,
      emissive: 0x17d8ff,
      emissiveIntensity: 0.72,
      metalness: 0.12,
      roughness: 0.22,
      transparent: true,
      opacity: 0.78,
    });
    const magentaMaterial = new THREE.MeshStandardMaterial({
      color: 0xffa7dc,
      emissive: 0xff46ad,
      emissiveIntensity: 0.62,
      metalness: 0.1,
      roughness: 0.24,
      transparent: true,
      opacity: 0.72,
    });
    const frameMaterial = new THREE.MeshStandardMaterial({
      color: 0xe5edff,
      metalness: 0.34,
      roughness: 0.28,
      emissive: 0x1b2a57,
      emissiveIntensity: 0.1,
    });

    const centerRing = new THREE.Mesh(new THREE.RingGeometry(2.35, 2.48, 72), cyanMaterial);
    const innerRing = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.16, 56), magentaMaterial);
    centerRing.rotation.x = -Math.PI / 2;
    innerRing.rotation.x = -Math.PI / 2;
    centerRing.position.y = 0.008;
    innerRing.position.y = 0.01;
    this.scene.add(centerRing, innerRing);

    for (let index = -2; index <= 2; index += 1) {
      const lane = new THREE.Mesh(new THREE.BoxGeometry(27, 0.012, 0.045), index % 2 === 0 ? cyanMaterial : magentaMaterial);
      lane.position.set(0, 0.009, index * 5.4);
      this.scene.add(lane);
    }

    for (const [x, z] of [
      [-15.5, -15.5],
      [15.5, -15.5],
      [-15.5, 15.5],
      [15.5, 15.5],
    ] as const) {
      const pylon = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.58, 0.2, 16), frameMaterial);
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.5, 14), cyanMaterial);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.42, 14), magentaMaterial);
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.022, 8, 28), cyanMaterial);
      base.position.y = 0.1;
      core.position.y = 1.35;
      cap.position.y = 2.8;
      halo.position.y = 2.22;
      halo.rotation.x = Math.PI / 2;
      pylon.position.set(x, 0, z);
      pylon.add(base, core, cap, halo);
      this.scene.add(pylon);
    }

    for (let index = -2; index <= 2; index += 1) {
      const truss = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.12, 0.18), frameMaterial);
      const light = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.05, 0.08), index % 2 === 0 ? cyanMaterial : magentaMaterial);
      truss.position.set(index * 6.2, 4.18, 0);
      light.position.set(index * 6.2, 4.05, 0);
      this.scene.add(truss, light);
    }
  }

  private loadTiledTexture(
    path: string,
    repeatX: number,
    repeatY: number,
    colorTexture = false,
  ): THREE.Texture {
    const texture = this.textureLoader.load(path);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

    if (colorTexture) {
      texture.colorSpace = THREE.SRGBColorSpace;
    }

    return texture;
  }

  private resize(): void {
    const bounds = this.container.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width || window.innerWidth || 1));
    const height = Math.max(1, Math.round(bounds.height || window.innerHeight || 1));

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
  }

  private scheduleResize = (): void => {
    this.resize();
    window.requestAnimationFrame(() => this.resize());
  };

  private updateDebugState(): void {
    this.debugFrame += 1;

    if (this.debugFrame % 30 !== 0) {
      return;
    }

    const width = this.renderer.domElement.width;
    const height = this.renderer.domElement.height;

    const animationSummary = this.character.getAnimationSummary();
    const debugState: StarlightDebugState = {
      frame: this.debugFrame,
      state: this.state,
      canvasClientWidth: this.renderer.domElement.clientWidth,
      canvasClientHeight: this.renderer.domElement.clientHeight,
      drawingBufferWidth: width,
      drawingBufferHeight: height,
      pixelCheck: {
        sampleCount: 0,
        uniqueColors: 0,
        nonTransparent: 0,
        averageBrightness: 0,
      },
      enemyCount: this.enemies.getEnemyCount(),
      cameraMode: this.cameraController.getMode(),
      characterVisible: this.character.isVisible(),
      avatarKind: this.character.getAvatarKind(),
      avatarClipCount: animationSummary.clipCount,
      characterAnimationState: animationSummary.activeState,
      characterProceduralAnimation: animationSummary.proceduralActive,
      weaponAttachment: animationSummary.weaponAttachment,
    };

    window.__STARLIGHT_DEBUG__ = debugState;
    document.documentElement.dataset.starlightDebug = JSON.stringify(debugState);
  }
}
