import { MathUtils } from './mathUtils';

/** A vector written as an array, `[x, y]`. See `Vec2.toArray` and `Vec2.fromArray`. */
export type Vec2Tuple = [x: number, y: number];

/**
 * A mutable 2D vector. Methods that change the vector modify it in place and return
 * `this` so calls can be chained; use {@link Vec2.clone} when a copy is needed.
 */
export class Vec2 {
  /** Creates a vector. Both components default to 0. */
  constructor(
    /** The horizontal component. */
    public x = 0,
    /** The vertical component. In world space, Y points up. */
    public y = 0,
  ) {}

  /** A new vector (0, 0). */
  static zero(): Vec2 {
    return new Vec2(0, 0);
  }

  /** A new vector (1, 1). */
  static one(): Vec2 {
    return new Vec2(1, 1);
  }

  /** A new vector (0, 1), which is up in world space. */
  static up(): Vec2 {
    return new Vec2(0, 1);
  }

  /** A new vector (1, 0). */
  static right(): Vec2 {
    return new Vec2(1, 0);
  }

  /** A unit vector pointing along `radians`, measured counter-clockwise from +X. */
  static fromAngle(radians: number): Vec2 {
    return new Vec2(Math.cos(radians), Math.sin(radians));
  }

  /** Creates a vector from `[x, y]`. Missing values default to 0. */
  static fromArray(values: readonly number[]): Vec2 {
    return new Vec2(values[0] ?? 0, values[1] ?? 0);
  }

  /** Sets both components. */
  set(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }

  /** Copies the components of another vector into this one. */
  copy(other: Readonly<Vec2>): this {
    this.x = other.x;
    this.y = other.y;
    return this;
  }

  /**
   * A new vector with the same components. Clone a vector before changing it when it belongs to
   * something else.
   */
  clone(): Vec2 {
    return new Vec2(this.x, this.y);
  }

  /** Adds another vector to this one. */
  add(other: Readonly<Vec2>): this {
    this.x += other.x;
    this.y += other.y;
    return this;
  }

  /** Subtracts another vector from this one. */
  sub(other: Readonly<Vec2>): this {
    this.x -= other.x;
    this.y -= other.y;
    return this;
  }

  /** Multiplies both components by a scalar. */
  scale(scalar: number): this {
    this.x *= scalar;
    this.y *= scalar;
    return this;
  }

  /** Component-wise multiplication. */
  multiply(other: Readonly<Vec2>): this {
    this.x *= other.x;
    this.y *= other.y;
    return this;
  }

  /** Reverses the direction of the vector. */
  negate(): this {
    this.x = -this.x;
    this.y = -this.y;
    return this;
  }

  /**
   * The dot product: positive when the vectors point the same way, 0 when they are perpendicular.
   */
  dot(other: Readonly<Vec2>): number {
    return this.x * other.x + this.y * other.y;
  }

  /** The Z component of the 3D cross product, positive when `other` is counter-clockwise. */
  cross(other: Readonly<Vec2>): number {
    return this.x * other.y - this.y * other.x;
  }

  /** The length of the vector. */
  length(): number {
    return Math.hypot(this.x, this.y);
  }

  /**
   * The length squared. It is cheaper to compute than the length and enough for comparing
   * distances.
   */
  lengthSquared(): number {
    return this.x * this.x + this.y * this.y;
  }

  /** Scales the vector to unit length. A zero vector is left unchanged. */
  normalize(): this {
    const length = this.length();
    if (length > 0) {
      this.x /= length;
      this.y /= length;
    }
    return this;
  }

  /** The distance between this point and another. */
  distanceTo(other: Readonly<Vec2>): number {
    return Math.hypot(this.x - other.x, this.y - other.y);
  }

  /** The angle of the vector in radians, counter-clockwise from +X. */
  angle(): number {
    return Math.atan2(this.y, this.x);
  }

  /** Rotates the vector counter-clockwise around the origin. */
  rotate(radians: number): this {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const x = this.x * cos - this.y * sin;
    const y = this.x * sin + this.y * cos;
    this.x = x;
    this.y = y;
    return this;
  }

  /** Moves the vector towards `target` by the fraction `t`. */
  lerp(target: Readonly<Vec2>, t: number): this {
    this.x = MathUtils.lerp(this.x, target.x, t);
    this.y = MathUtils.lerp(this.y, target.y, t);
    return this;
  }

  /** True when both components are within `epsilon` of the other vector's. */
  equals(other: Readonly<Vec2>, epsilon = MathUtils.EPSILON): boolean {
    return (
      MathUtils.approximately(this.x, other.x, epsilon) &&
      MathUtils.approximately(this.y, other.y, epsilon)
    );
  }

  /** The components as `[x, y]`. */
  toArray(): Vec2Tuple {
    return [this.x, this.y];
  }

  /** A readable form such as `Vec2(3, 4)`, handy for logging. */
  toString(): string {
    return `Vec2(${this.x}, ${this.y})`;
  }
}
