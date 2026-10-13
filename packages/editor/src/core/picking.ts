import {
  Button,
  getButtonMatrix,
  getSpriteSize,
  getTextRect,
  layoutText,
  Mat3,
  Rect,
  SpriteRenderer,
  TextRenderer,
  Tilemap,
  UNIT_QUAD_CORNERS,
  Vec2,
  type AssetDatabase,
  type Entity,
  type Scene,
  type TextMeasurer,
} from '@rowan/core';

/** What it takes to work out how much room an entity's sprite or text takes up. */
export interface VisualSources {
  readonly assets: AssetDatabase;
  readonly textMeasurer: TextMeasurer;
}

const SIZE_SCRATCH = new Vec2();
const RECT_SCRATCH = new Rect();

/** The matrix that maps the unit square to the area a sprite covers in world space. */
function getSpriteMatrix(entity: Entity, sprite: SpriteRenderer, assets: AssetDatabase): Mat3 {
  const size = getSpriteSize(sprite, assets, SIZE_SCRATCH);
  return entity.scene.getWorldMatrix(entity).multiply(new Mat3(size.x, 0, 0, size.y, 0, 0));
}

/** The matrix that maps the unit square to the area a text covers in world space. */
function getTextMatrix(entity: Entity, text: TextRenderer, measurer: TextMeasurer): Mat3 {
  const rect = getTextRect(text, layoutText(text, measurer), RECT_SCRATCH);
  return entity.scene
    .getWorldMatrix(entity)
    .multiply(new Mat3(rect.width, 0, 0, rect.height, rect.centerX, rect.centerY));
}

/** The matrix that maps the unit square to the area a tilemap covers in world space. */
function getTilemapMatrix(entity: Entity, map: Tilemap): Mat3 {
  const width = map.width * map.tileSize;
  const height = map.height * map.tileSize;
  // The map starts at the entity and extends to the right and upwards.
  return entity.scene
    .getWorldMatrix(entity)
    .multiply(new Mat3(width, 0, 0, height, width / 2, height / 2));
}

/** The world-space corners of the area of an entity's tilemap, or `null` when it has none. */
export function getTilemapCorners(entity: Entity): Vec2[] | null {
  const map = entity.getComponent(Tilemap);
  if (!map) {
    return null;
  }
  const matrix = getTilemapMatrix(entity, map);
  return UNIT_QUAD_CORNERS.map(([x, y]) => matrix.transformPoint(new Vec2(x, y)));
}

/**
 * The cell of an entity's tilemap that a world-space point is in, or `null` when the point
 * is outside the map or the entity has no usable map.
 */
export function getTilemapCell(
  entity: Entity,
  point: Readonly<Vec2>,
): { column: number; row: number } | null {
  const map = entity.getComponent(Tilemap);
  const inverse = entity.scene.getWorldMatrix(entity);
  if (!map || !(map.tileSize > 0) || !inverse.invert()) {
    return null;
  }
  const local = inverse.transformPoint(point);
  const column = Math.floor(local.x / map.tileSize);
  const row = Math.floor(local.y / map.tileSize);
  const inside = column >= 0 && row >= 0 && column < map.width && row < map.height;
  return inside ? { column, row } : null;
}

/**
 * Finds the entity under a world-space point, the way clicking in the scene view should:
 * the topmost visible sprite or text wins, and entities that have neither can be picked
 * near their position.
 *
 * @param iconRadius How close, in world units, a click must be to pick such an entity.
 */
export function pickEntity(
  scene: Scene,
  sources: VisualSources,
  point: Readonly<Vec2>,
  iconRadius: number,
): Entity | null {
  let best: Entity | null = null;
  let bestOrder = -Infinity;
  const local = new Vec2();
  /** Takes the entity when the point is inside the area `matrix` maps the unit square to. */
  const consider = (entity: Entity, matrix: Mat3, sortingOrder: number): void => {
    if (!matrix.invert()) {
      return;
    }
    matrix.transformPoint(point, local);
    // Whatever is drawn later is on top of what has the same order, hence ">=".
    if (Math.abs(local.x) <= 0.5 && Math.abs(local.y) <= 0.5 && sortingOrder >= bestOrder) {
      best = entity;
      bestOrder = sortingOrder;
    }
  };

  for (const [id, sprite] of scene.registry.view(SpriteRenderer)) {
    const entity = scene.getEntity(id);
    if (sprite.visible && entity.activeInHierarchy) {
      consider(entity, getSpriteMatrix(entity, sprite, sources.assets), sprite.sortingOrder);
    }
  }
  for (const [id, map] of scene.registry.view(Tilemap)) {
    const entity = scene.getEntity(id);
    // A map is picked by a cell that has a tile, not by the empty room around its tiles.
    const cell = map.visible && entity.activeInHierarchy ? getTilemapCell(entity, point) : null;
    if (cell && map.getTile(cell.column, cell.row) >= 0 && map.sortingOrder >= bestOrder) {
      best = entity;
      bestOrder = map.sortingOrder;
    }
  }
  // Texts are drawn after the sprites, so they are also considered after them.
  for (const [id, text] of scene.registry.view(TextRenderer)) {
    const entity = scene.getEntity(id);
    if (text.visible && entity.activeInHierarchy) {
      consider(entity, getTextMatrix(entity, text, sources.textMeasurer), text.sortingOrder);
    }
  }
  if (best) {
    return best;
  }

  let closest = iconRadius;
  for (const entity of scene.entities()) {
    const hasVisual =
      entity.hasComponent(SpriteRenderer) ||
      entity.hasComponent(TextRenderer) ||
      entity.hasComponent(Tilemap);
    if (hasVisual || !entity.activeInHierarchy) {
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

/** The world-space corners of the area an entity's text covers, or `null` when it has none. */
export function getTextCorners(entity: Entity, measurer: TextMeasurer): Vec2[] | null {
  const text = entity.getComponent(TextRenderer);
  if (!text) {
    return null;
  }
  const matrix = getTextMatrix(entity, text, measurer);
  return UNIT_QUAD_CORNERS.map(([x, y]) => matrix.transformPoint(new Vec2(x, y)));
}

/** The world-space corners of the area of an entity's button, or `null` when it has none. */
export function getButtonCorners(entity: Entity): Vec2[] | null {
  const button = entity.getComponent(Button);
  if (!button) {
    return null;
  }
  const matrix = getButtonMatrix(entity, button);
  return UNIT_QUAD_CORNERS.map(([x, y]) => matrix.transformPoint(new Vec2(x, y)));
}

/**
 * The world-space rectangle that encloses an entity and its descendants. Entities with
 * neither a sprite, a text nor a button contribute their position.
 */
export function getEntityBounds(entity: Entity, sources: VisualSources): Rect {
  const points: Vec2[] = [];
  const visit = (current: Entity): void => {
    const corners = [
      ...(getSpriteCorners(current, sources.assets) ?? []),
      ...(getTextCorners(current, sources.textMeasurer) ?? []),
      ...(getButtonCorners(current) ?? []),
      ...(getTilemapCorners(current) ?? []),
    ];
    points.push(...(corners.length > 0 ? corners : [current.worldPosition]));
    for (const child of current.children) {
      visit(child);
    }
  };
  visit(entity);
  return Rect.fromPoints(points);
}
