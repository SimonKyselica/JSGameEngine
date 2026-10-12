import { RowanError } from '../core/assert';
import { MathUtils } from './mathUtils';

export type ColorTuple = [r: number, g: number, b: number, a: number];

const HEX_PATTERN = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** An RGBA color with straight (non-premultiplied) alpha. Channels range from 0 to 1. */
export class Color {
  constructor(
    public r = 1,
    public g = 1,
    public b = 1,
    public a = 1,
  ) {}

  static white(): Color {
    return new Color(1, 1, 1, 1);
  }

  static black(): Color {
    return new Color(0, 0, 0, 1);
  }

  static transparent(): Color {
    return new Color(0, 0, 0, 0);
  }

  /** Parses `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`. The leading `#` is optional. */
  static fromHex(hex: string): Color {
    const match = HEX_PATTERN.exec(hex.trim());
    if (!match) {
      throw new RowanError(`Invalid hex color "${hex}"`);
    }
    let digits = match[1]!;
    if (digits.length <= 4) {
      digits = [...digits].map((digit) => digit + digit).join('');
    }
    const channel = (index: number): number =>
      Number.parseInt(digits.slice(index * 2, index * 2 + 2), 16) / 255;
    return new Color(channel(0), channel(1), channel(2), digits.length === 8 ? channel(3) : 1);
  }

  static fromArray(values: readonly number[]): Color {
    return new Color(values[0] ?? 1, values[1] ?? 1, values[2] ?? 1, values[3] ?? 1);
  }

  set(r: number, g: number, b: number, a = 1): this {
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
    return this;
  }

  copy(other: Readonly<Color>): this {
    return this.set(other.r, other.g, other.b, other.a);
  }

  clone(): Color {
    return new Color(this.r, this.g, this.b, this.a);
  }

  /** Moves the color towards `target` by the fraction `t`. */
  lerp(target: Readonly<Color>, t: number): this {
    this.r = MathUtils.lerp(this.r, target.r, t);
    this.g = MathUtils.lerp(this.g, target.g, t);
    this.b = MathUtils.lerp(this.b, target.b, t);
    this.a = MathUtils.lerp(this.a, target.a, t);
    return this;
  }

  equals(other: Readonly<Color>, epsilon = MathUtils.EPSILON): boolean {
    return (
      MathUtils.approximately(this.r, other.r, epsilon) &&
      MathUtils.approximately(this.g, other.g, epsilon) &&
      MathUtils.approximately(this.b, other.b, epsilon) &&
      MathUtils.approximately(this.a, other.a, epsilon)
    );
  }

  /** Formats as `#rrggbb`, or `#rrggbbaa` when `includeAlpha` is set. */
  toHex(includeAlpha = false): string {
    const channels = includeAlpha ? [this.r, this.g, this.b, this.a] : [this.r, this.g, this.b];
    const hex = channels.map((value) =>
      Math.round(MathUtils.clamp(value, 0, 1) * 255)
        .toString(16)
        .padStart(2, '0'),
    );
    return `#${hex.join('')}`;
  }

  toArray(): ColorTuple {
    return [this.r, this.g, this.b, this.a];
  }

  toString(): string {
    return `Color(${this.r}, ${this.g}, ${this.b}, ${this.a})`;
  }
}
