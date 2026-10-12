import { Vec2 } from './vec2';

/**
 * A 2D affine transform, stored as the top two rows of a 3x3 matrix:
 *
 * ```
 * | a  c  tx |
 * | b  d  ty |
 * | 0  0  1  |
 * ```
 *
 * Points are column vectors, so `A.multiply(B)` applies `B` first and then `A`.
 */
export class Mat3 {
  constructor(
    public a = 1,
    public b = 0,
    public c = 0,
    public d = 1,
    public tx = 0,
    public ty = 0,
  ) {}

  /** A transform that scales, then rotates, then translates. */
  static compose(position: Readonly<Vec2>, rotation: number, scale: Readonly<Vec2>): Mat3 {
    return new Mat3().compose(position, rotation, scale);
  }

  /** An orthographic projection that maps the given world rectangle to clip space (-1..1). */
  static ortho(left: number, right: number, bottom: number, top: number): Mat3 {
    const width = right - left;
    const height = top - bottom;
    return new Mat3(2 / width, 0, 0, 2 / height, -(right + left) / width, -(top + bottom) / height);
  }

  identity(): this {
    return this.set(1, 0, 0, 1, 0, 0);
  }

  set(a: number, b: number, c: number, d: number, tx: number, ty: number): this {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.tx = tx;
    this.ty = ty;
    return this;
  }

  copy(other: Readonly<Mat3>): this {
    return this.set(other.a, other.b, other.c, other.d, other.tx, other.ty);
  }

  clone(): Mat3 {
    return new Mat3(this.a, this.b, this.c, this.d, this.tx, this.ty);
  }

  compose(position: Readonly<Vec2>, rotation: number, scale: Readonly<Vec2>): this {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return this.set(
      cos * scale.x,
      sin * scale.x,
      -sin * scale.y,
      cos * scale.y,
      position.x,
      position.y,
    );
  }

  /** Sets this matrix to `this * other`. */
  multiply(other: Readonly<Mat3>): this {
    const { a, b, c, d, tx, ty } = this;
    return this.set(
      a * other.a + c * other.b,
      b * other.a + d * other.b,
      a * other.c + c * other.d,
      b * other.c + d * other.d,
      a * other.tx + c * other.ty + tx,
      b * other.tx + d * other.ty + ty,
    );
  }

  /** Sets this matrix to `other * this`. */
  premultiply(other: Readonly<Mat3>): this {
    const { a, b, c, d, tx, ty } = this;
    return this.set(
      other.a * a + other.c * b,
      other.b * a + other.d * b,
      other.a * c + other.c * d,
      other.b * c + other.d * d,
      other.a * tx + other.c * ty + other.tx,
      other.b * tx + other.d * ty + other.ty,
    );
  }

  determinant(): number {
    return this.a * this.d - this.b * this.c;
  }

  /**
   * Inverts the matrix in place. Returns `false` and leaves the matrix untouched when it
   * is singular, which happens when an entity is scaled to zero on an axis.
   */
  invert(): boolean {
    const determinant = this.determinant();
    if (determinant === 0 || !Number.isFinite(determinant)) {
      return false;
    }
    const { a, b, c, d, tx, ty } = this;
    const inverse = 1 / determinant;
    this.set(
      d * inverse,
      -b * inverse,
      -c * inverse,
      a * inverse,
      (c * ty - d * tx) * inverse,
      (b * tx - a * ty) * inverse,
    );
    return true;
  }

  /** Transforms a point, including translation. Writes to `out` when given. */
  transformPoint(point: Readonly<Vec2>, out = new Vec2()): Vec2 {
    const { x, y } = point;
    return out.set(this.a * x + this.c * y + this.tx, this.b * x + this.d * y + this.ty);
  }

  /** Transforms a direction, ignoring translation. Writes to `out` when given. */
  transformDirection(direction: Readonly<Vec2>, out = new Vec2()): Vec2 {
    const { x, y } = direction;
    return out.set(this.a * x + this.c * y, this.b * x + this.d * y);
  }

  getTranslation(out = new Vec2()): Vec2 {
    return out.set(this.tx, this.ty);
  }

  getRotation(): number {
    return Math.atan2(this.b, this.a);
  }

  /** The scale along each local axis. The Y scale is negative for mirrored transforms. */
  getScale(out = new Vec2()): Vec2 {
    const scaleX = Math.hypot(this.a, this.b);
    const scaleY = Math.hypot(this.c, this.d);
    return out.set(scaleX, this.determinant() < 0 ? -scaleY : scaleY);
  }

  equals(other: Readonly<Mat3>, epsilon = 1e-6): boolean {
    return (
      Math.abs(this.a - other.a) <= epsilon &&
      Math.abs(this.b - other.b) <= epsilon &&
      Math.abs(this.c - other.c) <= epsilon &&
      Math.abs(this.d - other.d) <= epsilon &&
      Math.abs(this.tx - other.tx) <= epsilon &&
      Math.abs(this.ty - other.ty) <= epsilon
    );
  }

  /** Writes the full 3x3 matrix in column-major order, as GLSL expects. */
  toColumnMajorArray(out: Float32Array = new Float32Array(9)): Float32Array {
    out[0] = this.a;
    out[1] = this.b;
    out[2] = 0;
    out[3] = this.c;
    out[4] = this.d;
    out[5] = 0;
    out[6] = this.tx;
    out[7] = this.ty;
    out[8] = 1;
    return out;
  }
}
