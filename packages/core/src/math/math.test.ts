import { describe, expect, it } from 'vitest';
import { RowanError } from '../core/assert';
import { Color } from './color';
import { Mat3 } from './mat3';
import { MathUtils } from './mathUtils';
import { Rect } from './rect';
import { Vec2 } from './vec2';

describe('MathUtils', () => {
  it('clamps values into a range', () => {
    expect(MathUtils.clamp(5, 0, 3)).toBe(3);
    expect(MathUtils.clamp(-1, 0, 3)).toBe(0);
    expect(MathUtils.clamp(2, 0, 3)).toBe(2);
  });

  it('interpolates and inverts interpolation', () => {
    expect(MathUtils.lerp(10, 20, 0.25)).toBe(12.5);
    expect(MathUtils.inverseLerp(10, 20, 12.5)).toBe(0.25);
    expect(MathUtils.inverseLerp(4, 4, 4)).toBe(0);
  });

  it('converts between degrees and radians', () => {
    expect(MathUtils.degToRad(180)).toBeCloseTo(Math.PI);
    expect(MathUtils.radToDeg(Math.PI / 2)).toBeCloseTo(90);
  });

  it('compares with a tolerance', () => {
    expect(MathUtils.approximately(0.1 + 0.2, 0.3)).toBe(true);
    expect(MathUtils.approximately(1, 1.1)).toBe(false);
    expect(MathUtils.approximately(1, 1.1, 0.2)).toBe(true);
  });

  it('wraps angles into (-PI, PI]', () => {
    expect(MathUtils.wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(MathUtils.wrapAngle(-Math.PI)).toBeCloseTo(Math.PI);
    expect(MathUtils.wrapAngle(Math.PI / 2 + Math.PI * 4)).toBeCloseTo(Math.PI / 2);
  });

  it('moves towards a target without overshooting', () => {
    expect(MathUtils.moveTowards(0, 10, 3)).toBe(3);
    expect(MathUtils.moveTowards(9, 10, 3)).toBe(10);
    expect(MathUtils.moveTowards(0, -10, 3)).toBe(-3);
  });

  it('smooth-steps between edges', () => {
    expect(MathUtils.smoothStep(0, 1, -1)).toBe(0);
    expect(MathUtils.smoothStep(0, 1, 0.5)).toBe(0.5);
    expect(MathUtils.smoothStep(0, 1, 2)).toBe(1);
  });

  it('produces random numbers inside the range', () => {
    for (let index = 0; index < 50; index++) {
      const value = MathUtils.randomRange(2, 3);
      expect(value).toBeGreaterThanOrEqual(2);
      expect(value).toBeLessThan(3);
    }
  });
});

describe('Vec2', () => {
  it('creates common vectors', () => {
    expect(Vec2.zero().toArray()).toEqual([0, 0]);
    expect(Vec2.one().toArray()).toEqual([1, 1]);
    expect(Vec2.up().toArray()).toEqual([0, 1]);
    expect(Vec2.right().toArray()).toEqual([1, 0]);
    expect(Vec2.fromArray([3, 4]).toArray()).toEqual([3, 4]);
    expect(Vec2.fromArray([]).toArray()).toEqual([0, 0]);
    expect(Vec2.fromAngle(Math.PI / 2).equals(new Vec2(0, 1))).toBe(true);
  });

  it('mutates in place and chains', () => {
    const vector = new Vec2(1, 2);
    const result = vector.add(new Vec2(2, 3)).sub(new Vec2(1, 1)).scale(2);
    expect(result).toBe(vector);
    expect(vector.toArray()).toEqual([4, 8]);
    expect(vector.multiply(new Vec2(0.5, 0.25)).toArray()).toEqual([2, 2]);
    expect(vector.negate().toArray()).toEqual([-2, -2]);
    expect(vector.set(7, 8).toArray()).toEqual([7, 8]);
  });

  it('copies and clones without sharing state', () => {
    const original = new Vec2(1, 2);
    const clone = original.clone();
    clone.x = 9;
    expect(original.x).toBe(1);
    expect(new Vec2().copy(original).toArray()).toEqual([1, 2]);
  });

  it('measures length, distance and angle', () => {
    const vector = new Vec2(3, 4);
    expect(vector.length()).toBe(5);
    expect(vector.lengthSquared()).toBe(25);
    expect(vector.distanceTo(new Vec2(0, 0))).toBe(5);
    expect(new Vec2(0, 2).angle()).toBeCloseTo(Math.PI / 2);
  });

  it('computes dot and cross products', () => {
    expect(new Vec2(1, 2).dot(new Vec2(3, 4))).toBe(11);
    expect(new Vec2(1, 0).cross(new Vec2(0, 1))).toBe(1);
    expect(new Vec2(0, 1).cross(new Vec2(1, 0))).toBe(-1);
  });

  it('normalizes, leaving the zero vector alone', () => {
    expect(new Vec2(0, 5).normalize().toArray()).toEqual([0, 1]);
    expect(new Vec2(0, 0).normalize().toArray()).toEqual([0, 0]);
  });

  it('rotates counter-clockwise', () => {
    expect(new Vec2(1, 0).rotate(Math.PI / 2).equals(new Vec2(0, 1))).toBe(true);
  });

  it('interpolates and compares', () => {
    expect(new Vec2(0, 0).lerp(new Vec2(10, 20), 0.5).toArray()).toEqual([5, 10]);
    expect(new Vec2(1, 1).equals(new Vec2(1, 1.0000001))).toBe(true);
    expect(new Vec2(1, 1).equals(new Vec2(1, 1.1))).toBe(false);
    expect(new Vec2(1, 2).toString()).toBe('Vec2(1, 2)');
  });
});

describe('Mat3', () => {
  it('starts as the identity', () => {
    expect(new Mat3().transformPoint(new Vec2(3, 4)).toArray()).toEqual([3, 4]);
  });

  it('composes scale, then rotation, then translation', () => {
    const matrix = Mat3.compose(new Vec2(10, 20), Math.PI / 2, new Vec2(2, 3));
    // (1, 0) scales to (2, 0), rotates to (0, 2) and moves to (10, 22).
    expect(matrix.transformPoint(new Vec2(1, 0)).equals(new Vec2(10, 22))).toBe(true);
    expect(matrix.transformDirection(new Vec2(1, 0)).equals(new Vec2(0, 2))).toBe(true);
  });

  it('decomposes back into translation, rotation and scale', () => {
    const matrix = Mat3.compose(new Vec2(-3, 7), 0.6, new Vec2(2, 5));
    expect(matrix.getTranslation().equals(new Vec2(-3, 7))).toBe(true);
    expect(matrix.getRotation()).toBeCloseTo(0.6);
    expect(matrix.getScale().equals(new Vec2(2, 5))).toBe(true);
  });

  it('reports a negative Y scale for mirrored transforms', () => {
    const matrix = Mat3.compose(new Vec2(), 0, new Vec2(2, -3));
    expect(matrix.getScale().equals(new Vec2(2, -3))).toBe(true);
  });

  it('multiplies so the right-hand matrix applies first', () => {
    const translate = Mat3.compose(new Vec2(5, 0), 0, new Vec2(1, 1));
    const scale = Mat3.compose(new Vec2(), 0, new Vec2(2, 2));
    const point = new Vec2(1, 1);
    expect(translate.clone().multiply(scale).transformPoint(point).toArray()).toEqual([7, 2]);
    expect(translate.clone().premultiply(scale).transformPoint(point).toArray()).toEqual([12, 2]);
  });

  it('inverts', () => {
    const matrix = Mat3.compose(new Vec2(4, -2), 1.1, new Vec2(3, 0.5));
    const inverse = matrix.clone();
    expect(inverse.invert()).toBe(true);
    expect(matrix.clone().multiply(inverse).equals(new Mat3())).toBe(true);
  });

  it('refuses to invert a singular matrix and leaves it unchanged', () => {
    const matrix = Mat3.compose(new Vec2(1, 2), 0, new Vec2(0, 1));
    const before = matrix.clone();
    expect(matrix.invert()).toBe(false);
    expect(matrix.equals(before)).toBe(true);
  });

  it('builds an orthographic projection', () => {
    const projection = Mat3.ortho(0, 10, 0, 20);
    expect(projection.transformPoint(new Vec2(0, 0)).toArray()).toEqual([-1, -1]);
    expect(projection.transformPoint(new Vec2(10, 20)).toArray()).toEqual([1, 1]);
    expect(projection.transformPoint(new Vec2(5, 10)).equals(new Vec2(0, 0))).toBe(true);
  });

  it('exports column-major 3x3 data for shaders', () => {
    const matrix = new Mat3(1, 2, 3, 4, 5, 6);
    expect([...matrix.toColumnMajorArray()]).toEqual([1, 2, 0, 3, 4, 0, 5, 6, 1]);
  });

  it('resets and copies', () => {
    const matrix = new Mat3(1, 2, 3, 4, 5, 6);
    expect(new Mat3().copy(matrix).equals(matrix)).toBe(true);
    expect(matrix.identity().equals(new Mat3())).toBe(true);
    expect(matrix.determinant()).toBe(1);
  });
});

describe('Color', () => {
  it('parses hex strings of every supported length', () => {
    expect(Color.fromHex('#ff0000').toArray()).toEqual([1, 0, 0, 1]);
    expect(Color.fromHex('00ff0080').toArray()).toEqual([0, 1, 0, 128 / 255]);
    expect(Color.fromHex('#fff').toArray()).toEqual([1, 1, 1, 1]);
    expect(Color.fromHex('#f008').toArray()).toEqual([1, 0, 0, 136 / 255]);
  });

  it('rejects malformed hex strings', () => {
    expect(() => Color.fromHex('#12345')).toThrow(RowanError);
    expect(() => Color.fromHex('red')).toThrow(RowanError);
  });

  it('formats as hex and clamps out-of-range channels', () => {
    expect(new Color(1, 0.5, 0, 1).toHex()).toBe('#ff8000');
    expect(new Color(2, -1, 0, 0.5).toHex(true)).toBe('#ff000080');
  });

  it('round-trips through arrays, defaulting missing channels to 1', () => {
    expect(Color.fromArray([0.1, 0.2, 0.3, 0.4]).toArray()).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(Color.fromArray([0.1, 0.2, 0.3]).a).toBe(1);
  });

  it('provides presets, copying, interpolation and comparison', () => {
    expect(Color.white().toArray()).toEqual([1, 1, 1, 1]);
    expect(Color.black().toArray()).toEqual([0, 0, 0, 1]);
    expect(Color.transparent().a).toBe(0);
    const color = new Color().copy(new Color(0.2, 0.4, 0.6, 0.8));
    expect(color.clone().equals(color)).toBe(true);
    expect(color.set(0, 0, 0).lerp(Color.white(), 0.5).toArray()).toEqual([0.5, 0.5, 0.5, 1]);
    expect(color.equals(Color.black())).toBe(false);
    expect(new Color(1, 0, 0, 1).toString()).toBe('Color(1, 0, 0, 1)');
  });
});

describe('Rect', () => {
  it('exposes its edges and center', () => {
    const rect = new Rect(1, 2, 4, 6);
    expect([rect.minX, rect.minY, rect.maxX, rect.maxY]).toEqual([1, 2, 5, 8]);
    expect([rect.centerX, rect.centerY]).toEqual([3, 5]);
    expect(rect.clone()).toEqual(rect);
  });

  it('builds from corners and points', () => {
    expect(Rect.fromMinMax(-1, -2, 3, 4)).toEqual(new Rect(-1, -2, 4, 6));
    expect(Rect.fromPoints([new Vec2(2, 5), new Vec2(-1, 1), new Vec2(0, 9)])).toEqual(
      new Rect(-1, 1, 3, 8),
    );
    expect(Rect.fromPoints([])).toEqual(new Rect());
  });

  it('tests containment, including the edges', () => {
    const rect = new Rect(0, 0, 2, 2);
    expect(rect.contains(new Vec2(1, 1))).toBe(true);
    expect(rect.contains(new Vec2(2, 2))).toBe(true);
    expect(rect.contains(new Vec2(2.1, 1))).toBe(false);
  });

  it('tests intersection', () => {
    const rect = new Rect(0, 0, 2, 2);
    expect(rect.intersects(new Rect(1, 1, 2, 2))).toBe(true);
    expect(rect.intersects(new Rect(2, 0, 1, 1))).toBe(true);
    expect(rect.intersects(new Rect(3, 3, 1, 1))).toBe(false);
  });
});
