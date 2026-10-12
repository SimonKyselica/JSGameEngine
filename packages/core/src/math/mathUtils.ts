/** The tolerance that `approximately` and the `equals` methods use by default: one millionth. */
const EPSILON: number = 1e-6;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const TWO_PI = Math.PI * 2;

/** Limits `value` to the range from `min` to `max`. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Linear interpolation from `a` to `b`. `t` is not clamped. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** The `t` for which `lerp(a, b, t) === value`. Returns 0 when `a` equals `b`. */
function inverseLerp(a: number, b: number, value: number): number {
  return a === b ? 0 : (value - a) / (b - a);
}

/** Converts degrees to radians. */
function degToRad(degrees: number): number {
  return degrees * DEG_TO_RAD;
}

/** Converts radians to degrees. */
function radToDeg(radians: number): number {
  return radians * RAD_TO_DEG;
}

/**
 * True when `a` and `b` differ by at most `epsilon`. Use it instead of `===` for numbers that were
 * computed.
 */
function approximately(a: number, b: number, epsilon = EPSILON): boolean {
  return Math.abs(a - b) <= epsilon;
}

/** Wraps an angle in radians into the range (-PI, PI]. */
function wrapAngle(radians: number): number {
  const wrapped = radians - TWO_PI * Math.floor((radians + Math.PI) / TWO_PI);
  return wrapped === -Math.PI ? Math.PI : wrapped;
}

/** Moves `current` towards `target` by at most `maxDelta`, never overshooting. */
function moveTowards(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) {
    return target;
  }
  return current + Math.sign(delta) * maxDelta;
}

/** Hermite interpolation between 0 and 1 as `value` goes from `edge0` to `edge1`. */
function smoothStep(edge0: number, edge1: number, value: number): number {
  const t = clamp(inverseLerp(edge0, edge1, value), 0, 1);
  return t * t * (3 - 2 * t);
}

/** A random number in the range [min, max). */
function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Common scalar math helpers, available to scripts as `MathUtils`. */
export const MathUtils = {
  EPSILON,
  clamp,
  lerp,
  inverseLerp,
  degToRad,
  radToDeg,
  approximately,
  wrapAngle,
  moveTowards,
  smoothStep,
  randomRange,
} as const;
