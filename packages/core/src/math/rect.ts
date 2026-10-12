import type { Vec2 } from './vec2';

/** An axis-aligned rectangle. `x` and `y` are the minimum corner. */
export class Rect {
  constructor(
    public x = 0,
    public y = 0,
    public width = 0,
    public height = 0,
  ) {}

  static fromMinMax(minX: number, minY: number, maxX: number, maxY: number): Rect {
    return new Rect(minX, minY, maxX - minX, maxY - minY);
  }

  /** The smallest rectangle containing every point. Returns an empty rectangle for no points. */
  static fromPoints(points: readonly Readonly<Vec2>[]): Rect {
    if (points.length === 0) {
      return new Rect();
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    return Rect.fromMinMax(minX, minY, maxX, maxY);
  }

  get minX(): number {
    return this.x;
  }

  get minY(): number {
    return this.y;
  }

  get maxX(): number {
    return this.x + this.width;
  }

  get maxY(): number {
    return this.y + this.height;
  }

  get centerX(): number {
    return this.x + this.width / 2;
  }

  get centerY(): number {
    return this.y + this.height / 2;
  }

  clone(): Rect {
    return new Rect(this.x, this.y, this.width, this.height);
  }

  contains(point: Readonly<Vec2>): boolean {
    return (
      point.x >= this.minX && point.x <= this.maxX && point.y >= this.minY && point.y <= this.maxY
    );
  }

  /** True when the rectangles overlap or touch. */
  intersects(other: Readonly<Rect>): boolean {
    return (
      this.minX <= other.maxX &&
      this.maxX >= other.minX &&
      this.minY <= other.maxY &&
      this.maxY >= other.minY
    );
  }
}
