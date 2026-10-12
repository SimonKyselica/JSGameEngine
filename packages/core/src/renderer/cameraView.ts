import { Mat3 } from '../math/mat3';
import { Rect } from '../math/rect';
import { Vec2 } from '../math/vec2';

const UNIT_SCALE = new Vec2(1, 1);

/**
 * An orthographic view of the world: where the camera is and how much it sees.
 * Converts between world space, clip space and viewport pixels.
 */
export class CameraView {
  /** Maps world space to clip space (-1..1). */
  readonly viewProjection = new Mat3();
  /** Maps clip space back to world space. */
  readonly inverseViewProjection = new Mat3();
  /** The axis-aligned world rectangle that encloses everything the camera sees. */
  readonly bounds: Rect;

  /**
   * @param position Camera position in world space.
   * @param rotation Camera rotation in radians.
   * @param halfHeight Half of the visible height in world units.
   * @param aspect Viewport width divided by height.
   */
  constructor(
    readonly position: Readonly<Vec2>,
    readonly rotation: number,
    readonly halfHeight: number,
    readonly aspect: number,
  ) {
    const safeHalfHeight = Math.max(Math.abs(halfHeight), 1e-6);
    const halfWidth = safeHalfHeight * Math.max(aspect, 1e-6);

    this.inverseViewProjection
      .compose(position, rotation, UNIT_SCALE)
      .multiply(new Mat3(halfWidth, 0, 0, safeHalfHeight, 0, 0));
    this.viewProjection.copy(this.inverseViewProjection).invert();

    this.bounds = Rect.fromPoints(
      [new Vec2(-1, -1), new Vec2(1, -1), new Vec2(1, 1), new Vec2(-1, 1)].map((corner) =>
        this.inverseViewProjection.transformPoint(corner, corner),
      ),
    );
  }

  /** World units covered by one viewport pixel, for a viewport of the given height. */
  getWorldUnitsPerPixel(viewportHeight: number): number {
    return (Math.abs(this.halfHeight) * 2) / Math.max(viewportHeight, 1);
  }

  /**
   * Converts a viewport position in pixels (origin top-left, Y down) to world space.
   */
  viewportToWorld(
    x: number,
    y: number,
    viewportWidth: number,
    viewportHeight: number,
    out = new Vec2(),
  ): Vec2 {
    out.set((x / Math.max(viewportWidth, 1)) * 2 - 1, 1 - (y / Math.max(viewportHeight, 1)) * 2);
    return this.inverseViewProjection.transformPoint(out, out);
  }

  /** Converts a world position to viewport pixels (origin top-left, Y down). */
  worldToViewport(
    world: Readonly<Vec2>,
    viewportWidth: number,
    viewportHeight: number,
    out = new Vec2(),
  ): Vec2 {
    this.viewProjection.transformPoint(world, out);
    return out.set(((out.x + 1) / 2) * viewportWidth, ((1 - out.y) / 2) * viewportHeight);
  }
}
