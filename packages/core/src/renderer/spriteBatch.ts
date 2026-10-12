import { assert } from '../core/assert';
import type { Color } from '../math/color';
import type { Mat3 } from '../math/mat3';

/** Vertex layout: position (2), uv (2), color (4), texture slot (1). */
export const FLOATS_PER_VERTEX = 9;
export const VERTICES_PER_QUAD = 4;
export const INDICES_PER_QUAD = 6;
/** The largest batch 16-bit indices can address. */
export const MAX_BATCH_QUADS = Math.floor(65536 / VERTICES_PER_QUAD);

const FLOATS_PER_QUAD = FLOATS_PER_VERTEX * VERTICES_PER_QUAD;

// Corners of the unit quad, counter-clockwise from the bottom-left, with their UVs.
// V is 0 at the top because images are uploaded with their first row at the top.
const CORNERS: readonly (readonly [x: number, y: number, u: number, v: number])[] = [
  [-0.5, -0.5, 0, 1],
  [0.5, -0.5, 1, 1],
  [0.5, 0.5, 1, 0],
  [-0.5, 0.5, 0, 0],
];

export type BatchFlush<TTexture> = (
  vertices: Float32Array,
  quadCount: number,
  textures: readonly TTexture[],
) => void;

/**
 * Collects quads into one vertex buffer so they can be drawn with a single draw call.
 * The batch is flushed automatically when it is full or runs out of texture slots.
 *
 * This class holds no GPU state, which keeps the batching rules unit-testable.
 */
export class SpriteBatch<TTexture> {
  readonly vertices: Float32Array;
  private readonly textures: TTexture[] = [];
  private quadCount = 0;

  constructor(
    readonly maxQuads: number,
    readonly maxTextures: number,
    private readonly onFlush: BatchFlush<TTexture>,
  ) {
    assert(maxQuads > 0 && maxQuads <= MAX_BATCH_QUADS, `maxQuads must be 1..${MAX_BATCH_QUADS}`);
    assert(maxTextures > 0, 'maxTextures must be at least 1');
    this.vertices = new Float32Array(maxQuads * FLOATS_PER_QUAD);
  }

  get pendingQuads(): number {
    return this.quadCount;
  }

  add(
    transform: Readonly<Mat3>,
    texture: TTexture,
    color: Readonly<Color>,
    flipX: boolean,
    flipY: boolean,
  ): void {
    let slot = this.textures.indexOf(texture);
    if (
      this.quadCount === this.maxQuads ||
      (slot === -1 && this.textures.length === this.maxTextures)
    ) {
      this.flush();
      slot = -1;
    }
    if (slot === -1) {
      slot = this.textures.length;
      this.textures.push(texture);
    }

    const { a, b, c, d, tx, ty } = transform;
    const vertices = this.vertices;
    let offset = this.quadCount * FLOATS_PER_QUAD;
    for (const [x, y, u, v] of CORNERS) {
      vertices[offset++] = a * x + c * y + tx;
      vertices[offset++] = b * x + d * y + ty;
      vertices[offset++] = flipX ? 1 - u : u;
      vertices[offset++] = flipY ? 1 - v : v;
      vertices[offset++] = color.r;
      vertices[offset++] = color.g;
      vertices[offset++] = color.b;
      vertices[offset++] = color.a;
      vertices[offset++] = slot;
    }
    this.quadCount++;
  }

  /** Hands the pending quads to the flush callback and empties the batch. */
  flush(): void {
    if (this.quadCount === 0) {
      return;
    }
    this.onFlush(this.vertices, this.quadCount, this.textures);
    this.quadCount = 0;
    this.textures.length = 0;
  }
}

/** Index data for `quadCount` quads made of two triangles each. */
export function createQuadIndices(quadCount: number): Uint16Array {
  assert(quadCount <= MAX_BATCH_QUADS, `quadCount must be at most ${MAX_BATCH_QUADS}`);
  const indices = new Uint16Array(quadCount * INDICES_PER_QUAD);
  for (let quad = 0; quad < quadCount; quad++) {
    const vertex = quad * VERTICES_PER_QUAD;
    const offset = quad * INDICES_PER_QUAD;
    indices[offset] = vertex;
    indices[offset + 1] = vertex + 1;
    indices[offset + 2] = vertex + 2;
    indices[offset + 3] = vertex;
    indices[offset + 4] = vertex + 2;
    indices[offset + 5] = vertex + 3;
  }
  return indices;
}
