import { MathUtils } from './mathUtils';

export type Vec2Tuple = [x: number, y: number];

/**
 * A mutable 2D vector. Methods that change the vector modify it in place and return
 * `this` so calls can be chained; use {@link Vec2.clone} when a copy is needed.
 */
export class Vec2 {
  constructor(
    public x = 0,
    public y = 0,
  ) {}

  static zero(): Vec2 {
    return new Vec2(0, 0);
  }

  static one(): Vec2 {
    return new Vec2(1, 1);
  }

  static up(): Vec2 {
    return new Vec2(0, 1);
  }

  static right(): Vec2 {
    return new Vec2(1, 0);
  }

  /** A unit vector pointing along `radians`, measured counter-clockwise from +X. */
  static fromAngle(radians: number): Vec2 {
    return new Vec2(Math.cos(radians), Math.sin(radians));
  }

  static fromArray(values: readonly number[]): Vec2 {
    return new Vec2(values[0] ?? 0, values[1] ?? 0);
  }

  set(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }

  copy(other: Readonly<Vec2>): this {
    this.x = other.x;
    this.y = other.y;
    return this;
  }

  clone(): Vec2 {
    return new Vec2(this.x, this.y);
  }

  add(other: Readonly<Vec2>): this {
    this.x += other.x;
    this.y += other.y;
    return this;
  }

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

  negate(): this {
    this.x = -this.x;
    this.y = -this.y;
    return this;
  }

  dot(other: Readonly<Vec2>): number {
    return this.x * other.x + this.y * other.y;
  }

  /** The Z component of the 3D cross product, positive when `other` is counter-clockwise. */
  cross(other: Readonly<Vec2>): number {
    return this.x * other.y - this.y * other.x;
  }

  length(): number {
    return Math.hypot(this.x, this.y);
  }

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

  equals(other: Readonly<Vec2>, epsilon = MathUtils.EPSILON): boolean {
    return (
      MathUtils.approximately(this.x, other.x, epsilon) &&
      MathUtils.approximately(this.y, other.y, epsilon)
    );
  }

  toArray(): Vec2Tuple {
    return [this.x, this.y];
  }

  toString(): string {
    return `Vec2(${this.x}, ${this.y})`;
  }
}
