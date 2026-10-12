import { Vec2 } from '@rowan/core';

export type TransformTool = 'move' | 'rotate' | 'scale';

export type GizmoHandle =
  'move-x' | 'move-y' | 'move-xy' | 'rotate' | 'scale-x' | 'scale-y' | 'scale-xy';

/** Sizes of the gizmo in screen pixels. The gizmo keeps its size at every zoom level. */
export const GIZMO = {
  axisLength: 78,
  /** Half the side of the square handle at the gizmo's center. */
  centerSize: 9,
  rotateRadius: 64,
  /** How far from a handle a pointer still grabs it. */
  hitTolerance: 7,
} as const;

/** Where the gizmo is on screen and which way its axes point. */
export interface GizmoLayout {
  /** The entity's position in viewport pixels. */
  readonly origin: Readonly<Vec2>;
  /**
   * Rotation of the gizmo's axes in radians, counter-clockwise. The move gizmo uses
   * world axes (0); the scale gizmo follows the entity's rotation.
   */
  readonly rotation: number;
}

/** Snap increments used while the snap modifier is held. */
export const SNAP = { move: 0.25, rotate: Math.PI / 12, scale: 0.1 } as const;

/** Unit vectors of the gizmo's X and Y axes on screen, where Y points down. */
export function getGizmoAxes(rotation: number): { x: Vec2; y: Vec2 } {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return { x: new Vec2(cos, -sin), y: new Vec2(-sin, -cos) };
}

function distanceToSegment(
  point: Readonly<Vec2>,
  from: Readonly<Vec2>,
  to: Readonly<Vec2>,
): number {
  const segment = to.clone().sub(from);
  const lengthSquared = segment.lengthSquared();
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, point.clone().sub(from).dot(segment) / lengthSquared));
  return point.distanceTo(from.clone().add(segment.scale(t)));
}

/** Finds the gizmo handle under the pointer, or `null`. */
export function hitTestGizmo(
  tool: TransformTool,
  layout: GizmoLayout,
  pointer: Readonly<Vec2>,
): GizmoHandle | null {
  const { origin } = layout;
  const offset = pointer.clone().sub(origin);

  if (tool === 'rotate') {
    const distance = Math.abs(offset.length() - GIZMO.rotateRadius);
    return distance <= GIZMO.hitTolerance ? 'rotate' : null;
  }

  const axes = getGizmoAxes(layout.rotation);
  // The center handle is tested first because the axes start underneath it.
  if (
    Math.abs(offset.dot(axes.x)) <= GIZMO.centerSize &&
    Math.abs(offset.dot(axes.y)) <= GIZMO.centerSize
  ) {
    return `${tool}-xy`;
  }
  const endX = origin.clone().add(axes.x.clone().scale(GIZMO.axisLength));
  const endY = origin.clone().add(axes.y.clone().scale(GIZMO.axisLength));
  if (distanceToSegment(pointer, origin, endX) <= GIZMO.hitTolerance) {
    return `${tool}-x`;
  }
  if (distanceToSegment(pointer, origin, endY) <= GIZMO.hitTolerance) {
    return `${tool}-y`;
  }
  return null;
}

/** What a gizmo drag started from. */
export interface GizmoDragStart {
  readonly handle: GizmoHandle;
  /** The entity's world position, world rotation and local scale when the drag began. */
  readonly position: Readonly<Vec2>;
  readonly rotation: number;
  readonly scale: Readonly<Vec2>;
  /** The pointer in viewport pixels and in world space when the drag began. */
  readonly pointer: Readonly<Vec2>;
  readonly pointerWorld: Readonly<Vec2>;
  readonly layout: GizmoLayout;
}

/** The transform values a drag produces. Only the fields the handle changes are set. */
export interface GizmoDragResult {
  position?: Vec2;
  rotation?: number;
  scale?: Vec2;
}

function snapTo(value: number, step: number, enabled: boolean): number {
  return enabled ? Math.round(value / step) * step : value;
}

/**
 * Computes the transform for the current pointer position of a gizmo drag.
 *
 * @param snap Round the result to the increments in {@link SNAP}.
 */
export function applyGizmoDrag(
  start: GizmoDragStart,
  pointer: Readonly<Vec2>,
  pointerWorld: Readonly<Vec2>,
  snap: boolean,
): GizmoDragResult {
  switch (start.handle) {
    case 'move-x':
    case 'move-y':
    case 'move-xy': {
      const delta = pointerWorld.clone().sub(start.pointerWorld);
      const position = start.position.clone();
      if (start.handle !== 'move-y') {
        position.x = snapTo(position.x + delta.x, SNAP.move, snap);
      }
      if (start.handle !== 'move-x') {
        position.y = snapTo(position.y + delta.y, SNAP.move, snap);
      }
      return { position };
    }
    case 'rotate': {
      const { origin } = start.layout;
      // Screen Y points down, so it is negated to get counter-clockwise angles.
      const angleAt = (point: Readonly<Vec2>): number =>
        Math.atan2(-(point.y - origin.y), point.x - origin.x);
      const delta = angleAt(pointer) - angleAt(start.pointer);
      return { rotation: snapTo(start.rotation + delta, SNAP.rotate, snap) };
    }
    case 'scale-x':
    case 'scale-y':
    case 'scale-xy': {
      const axes = getGizmoAxes(start.layout.rotation);
      const drag = pointer.clone().sub(start.pointer);
      const scale = start.scale.clone();
      // Dragging a handle one axis length away doubles the scale.
      const factorFor = (pixels: number): number => 1 + pixels / GIZMO.axisLength;
      if (start.handle === 'scale-xy') {
        const factor = factorFor(drag.x - drag.y);
        scale.x = snapTo(scale.x * factor, SNAP.scale, snap);
        scale.y = snapTo(scale.y * factor, SNAP.scale, snap);
      } else if (start.handle === 'scale-x') {
        scale.x = snapTo(scale.x * factorFor(drag.dot(axes.x)), SNAP.scale, snap);
      } else {
        scale.y = snapTo(scale.y * factorFor(drag.dot(axes.y)), SNAP.scale, snap);
      }
      return { scale };
    }
  }
}
