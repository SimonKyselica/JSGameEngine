import {
  getSpriteSize,
  Mat3,
  Rect,
  SpriteRenderer,
  UNIT_QUAD_CORNERS,
  Vec2,
  type AssetDatabase,
  type Entity,
  type Scene,
} from '@rowan/core';

const SIZE_SCRATCH = new Vec2();

/** The matrix that maps the unit square to the area a sprite covers in world space. */
function getSpriteMatrix(entity: Entity, sprite: SpriteRenderer, assets: AssetDatabase): Mat3 {
  const size = getSpriteSize(sprite, assets, SIZE_SCRATCH);
  return entity.scene.getWorldMatrix(entity).multiply(new Mat3(size.x, 0, 0, size.y, 0, 0));
}

/**
 * Finds the entity under a world-space point, the way clicking in the scene view should:
 * the topmost visible sprite wins, and entities without a sprite can be picked near
 * their position.
 *
 * @param iconRadius How close, in world units, a click must be to pick a sprite-less entity.
 */
export function pickEntity(
  scene: Scene,
  assets: AssetDatabase,
  point: Readonly<Vec2>,
  iconRadius: number,
): Entity | null {
  let best: Entity | null = null;
  let bestOrder = -Infinity;
  const local = new Vec2();

  for (const [id, sprite] of scene.registry.view(SpriteRenderer)) {
    const entity = scene.getEntity(id);
    if (!sprite.visible || !entity.activeInHierarchy) {
      continue;
    }
    const matrix = getSpriteMatrix(entity, sprite, assets);
    if (!matrix.invert()) {
      continue;
    }
    matrix.transformPoint(point, local);
    // Later sprites draw on top of earlier ones with the same order, hence ">=".
    if (Math.abs(local.x) <= 0.5 && Math.abs(local.y) <= 0.5 && sprite.sortingOrder >= bestOrder) {
      best = entity;
      bestOrder = sprite.sortingOrder;
    }
  }
  if (best) {
    return best;
  }

  let closest = iconRadius;
  for (const entity of scene.entities()) {
    if (entity.hasComponent(SpriteRenderer) || !entity.activeInHierarchy) {
      continue;
    }
    const distance = entity.worldPosition.distanceTo(point);
    if (distance <= closest) {
      closest = distance;
      best = entity;
    }
  }
  return best;
}

/** The world-space corners of an entity's sprite, or `null` when it has none. */
export function getSpriteCorners(entity: Entity, assets: AssetDatabase): Vec2[] | null {
  const sprite = entity.getComponent(SpriteRenderer);
  if (!sprite) {
    return null;
  }
  const matrix = getSpriteMatrix(entity, sprite, assets);
  return UNIT_QUAD_CORNERS.map(([x, y]) => matrix.transformPoint(new Vec2(x, y)));
}

/**
 * The world-space rectangle that encloses an entity and its descendants. Entities
 * without a sprite contribute their position.
 */
export function getEntityBounds(entity: Entity, assets: AssetDatabase): Rect {
  const points: Vec2[] = [];
  const visit = (current: Entity): void => {
    points.push(...(getSpriteCorners(current, assets) ?? [current.worldPosition]));
    for (const child of current.children) {
      visit(child);
    }
  };
  visit(entity);
  return Rect.fromPoints(points);
}
