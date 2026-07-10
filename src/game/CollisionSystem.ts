import * as THREE from 'three';

interface BoxCollider {
  box: THREE.Box3;
  mesh?: THREE.Object3D;
}

export class CollisionSystem {
  private readonly colliders: BoxCollider[] = [];

  constructor(
    private readonly arenaHalfWidth: number,
    private readonly arenaHalfDepth: number,
  ) {}

  clear(): void {
    this.colliders.length = 0;
  }

  addBox(center: THREE.Vector3, size: THREE.Vector3, mesh?: THREE.Object3D): void {
    const box = new THREE.Box3().setFromCenterAndSize(center, size);
    this.colliders.push({ box, mesh });
  }

  getColliderMeshes(): THREE.Object3D[] {
    return this.colliders
      .map((collider) => collider.mesh)
      .filter((mesh): mesh is THREE.Object3D => Boolean(mesh));
  }

  moveWithCollisions(position: THREE.Vector3, delta: THREE.Vector3, radius: number): THREE.Vector3 {
    const next = this.clampToArena(position.clone(), radius);

    if (delta.lengthSq() === 0) {
      return next;
    }

    this.tryAxisMove(next, 'x', delta.x, radius);
    this.tryAxisMove(next, 'z', delta.z, radius);
    return this.clampToArena(next, radius);
  }

  resolveCameraCollision(target: THREE.Vector3, desired: THREE.Vector3, radius: number): THREE.Vector3 {
    const clampedDesired = this.clampToArena(desired.clone(), radius);
    let nearestHit = 1;

    for (const collider of this.colliders) {
      const expandedBox = collider.box.clone().expandByVector(new THREE.Vector3(radius, radius, radius));
      const hit = this.intersectSegmentBox(target, clampedDesired, expandedBox);

      if (hit !== null && hit < nearestHit) {
        nearestHit = hit;
      }
    }

    if (nearestHit < 1) {
      return target.clone().lerp(clampedDesired, Math.max(0, nearestHit - 0.06));
    }

    return clampedDesired;
  }

  private tryAxisMove(
    current: THREE.Vector3,
    axis: 'x' | 'z',
    amount: number,
    radius: number,
  ): void {
    if (amount === 0) {
      return;
    }

    const candidate = current.clone();
    candidate[axis] += amount;
    const clamped = this.clampToArena(candidate, radius);

    if (!this.isBlocked(clamped, radius)) {
      current.copy(clamped);
    }
  }

  private clampToArena(position: THREE.Vector3, radius: number): THREE.Vector3 {
    position.x = THREE.MathUtils.clamp(
      position.x,
      -this.arenaHalfWidth + radius,
      this.arenaHalfWidth - radius,
    );
    position.z = THREE.MathUtils.clamp(
      position.z,
      -this.arenaHalfDepth + radius,
      this.arenaHalfDepth - radius,
    );
    return position;
  }

  private isBlocked(position: THREE.Vector3, radius: number): boolean {
    for (const collider of this.colliders) {
      const { box } = collider;
      const insideX = position.x > box.min.x - radius && position.x < box.max.x + radius;
      const insideZ = position.z > box.min.z - radius && position.z < box.max.z + radius;

      if (insideX && insideZ) {
        return true;
      }
    }

    return false;
  }

  private intersectSegmentBox(start: THREE.Vector3, end: THREE.Vector3, box: THREE.Box3): number | null {
    const direction = new THREE.Vector3().subVectors(end, start);
    let tMin = 0;
    let tMax = 1;
    const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];

    for (const axis of axes) {
      const origin = start[axis];
      const delta = direction[axis];
      const min = box.min[axis];
      const max = box.max[axis];

      if (Math.abs(delta) < 0.00001) {
        if (origin < min || origin > max) {
          return null;
        }

        continue;
      }

      const inverseDelta = 1 / delta;
      let t1 = (min - origin) * inverseDelta;
      let t2 = (max - origin) * inverseDelta;

      if (t1 > t2) {
        [t1, t2] = [t2, t1];
      }

      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);

      if (tMin > tMax) {
        return null;
      }
    }

    return tMin;
  }
}
