import { CameraView, MathUtils, Vec2, type Rect } from '@rowan/core';

const MIN_HALF_HEIGHT = 0.05;
const MAX_HALF_HEIGHT = 5000;
/** Extra room around the framed area when focusing, as a multiple of its size. */
const FOCUS_PADDING = 1.4;
/** Focusing never zooms in further than this, so a single point stays in context. */
const MIN_FOCUS_HALF_HEIGHT = 1.5;

/** The camera of the editor's scene view: it only pans and zooms, and belongs to no scene. */
export class EditorCamera {
  readonly position = new Vec2(0, 0);
  /** Half of the visible height in world units. */
  halfHeight = 6;

  toView(aspect: number): CameraView {
    return new CameraView(this.position, 0, this.halfHeight, aspect);
  }

  /** Moves the camera so the world follows a pointer drag of the given size in pixels. */
  pan(deltaX: number, deltaY: number, viewportHeight: number): void {
    const unitsPerPixel = (this.halfHeight * 2) / Math.max(viewportHeight, 1);
    this.position.x -= deltaX * unitsPerPixel;
    this.position.y += deltaY * unitsPerPixel;
  }

  /**
   * Zooms by `factor` (below 1 zooms in) while keeping the world point under the pointer
   * where it is on screen.
   */
  zoomAt(
    factor: number,
    pointerX: number,
    pointerY: number,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    const aspect = viewportWidth / Math.max(viewportHeight, 1);
    const before = this.toView(aspect).viewportToWorld(
      pointerX,
      pointerY,
      viewportWidth,
      viewportHeight,
    );
    this.halfHeight = MathUtils.clamp(this.halfHeight * factor, MIN_HALF_HEIGHT, MAX_HALF_HEIGHT);
    const after = this.toView(aspect).viewportToWorld(
      pointerX,
      pointerY,
      viewportWidth,
      viewportHeight,
    );
    this.position.add(before.sub(after));
  }

  /** Centers the camera on a world rectangle and zooms so all of it is visible. */
  focus(bounds: Readonly<Rect>, aspect: number): void {
    this.position.set(bounds.centerX, bounds.centerY);
    const neededForHeight = bounds.height / 2;
    const neededForWidth = bounds.width / 2 / Math.max(aspect, 0.01);
    this.halfHeight = MathUtils.clamp(
      Math.max(neededForHeight, neededForWidth) * FOCUS_PADDING,
      MIN_FOCUS_HALF_HEIGHT,
      MAX_HALF_HEIGHT,
    );
  }
}
