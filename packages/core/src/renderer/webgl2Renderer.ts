import { RowanError } from '../core/assert';
import { Signal } from '../core/signal';
import type { Color } from '../math/color';
import type { Mat3 } from '../math/mat3';
import type { Renderer2D, RenderStats, Texture, TextureFilter, TextureSource } from './renderer2d';
import {
  createQuadIndices,
  FLOATS_PER_VERTEX,
  INDICES_PER_QUAD,
  SpriteBatch,
  VERTICES_PER_QUAD,
} from './spriteBatch';

const MAX_QUADS = 4096;
/** Texture units used by the sprite shader. WebGL2 guarantees at least 16 in fragment shaders. */
const MAX_TEXTURE_SLOTS = 8;
const BYTES_PER_VERTEX = FLOATS_PER_VERTEX * Float32Array.BYTES_PER_ELEMENT;

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in vec4 a_color;
layout(location = 3) in float a_slot;

uniform mat3 u_viewProjection;

out vec2 v_uv;
out vec4 v_color;
flat out int v_slot;

void main() {
  v_uv = a_uv;
  // Textures hold premultiplied alpha, so the tint has to be premultiplied as well.
  v_color = vec4(a_color.rgb * a_color.a, a_color.a);
  v_slot = int(a_slot + 0.5);
  vec3 position = u_viewProjection * vec3(a_position, 1.0);
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// GLSL ES 3.00 only allows constant indices into sampler arrays, hence the switch.
const FRAGMENT_SHADER = `#version 300 es
precision mediump float;

uniform sampler2D u_textures[${MAX_TEXTURE_SLOTS}];

in vec2 v_uv;
in vec4 v_color;
flat in int v_slot;

out vec4 o_color;

void main() {
  vec4 texel;
  switch (v_slot) {
${Array.from(
  { length: MAX_TEXTURE_SLOTS },
  (_, slot) => `    case ${slot}: texel = texture(u_textures[${slot}], v_uv); break;`,
).join('\n')}
    default: texel = vec4(1.0); break;
  }
  o_color = texel * v_color;
}
`;

class WebGLTextureHandle implements Texture {
  constructor(
    readonly width: number,
    readonly height: number,
    public glTexture: WebGLTexture | null,
  ) {}
}

interface GLResources {
  readonly program: WebGLProgram;
  readonly vertexArray: WebGLVertexArrayObject;
  readonly vertexBuffer: WebGLBuffer;
  readonly indexBuffer: WebGLBuffer;
  readonly viewProjectionLocation: WebGLUniformLocation;
  readonly whiteTexture: WebGLTextureHandle;
}

export interface WebGL2RendererOptions {
  readonly antialias?: boolean;
  /** Keep the frame readable after presenting. Needed for screenshots; costs performance. */
  readonly preserveDrawingBuffer?: boolean;
}

/** The WebGL2 implementation of {@link Renderer2D}: a batched, multi-texture quad renderer. */
export class WebGL2Renderer implements Renderer2D {
  readonly onContextRestored = new Signal();
  readonly stats: RenderStats = { drawCalls: 0, quads: 0 };

  private readonly gl: WebGL2RenderingContext;
  private readonly batch: SpriteBatch<WebGLTextureHandle>;
  private readonly textures = new Set<WebGLTextureHandle>();
  private readonly frameStats: RenderStats = { drawCalls: 0, quads: 0 };
  private readonly matrixArray = new Float32Array(9);
  private resources: GLResources | null = null;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement | OffscreenCanvas,
    options: WebGL2RendererOptions = {},
  ) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: options.antialias ?? true,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    });
    if (!gl) {
      throw new RowanError('WebGL2 is not available in this browser');
    }
    this.gl = gl;
    this.batch = new SpriteBatch(MAX_QUADS, MAX_TEXTURE_SLOTS, (vertices, quadCount, textures) =>
      this.drawBatch(vertices, quadCount, textures),
    );
    this.resources = this.createResources();

    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
  }

  get width(): number {
    return this.canvas.width;
  }

  get height(): number {
    return this.canvas.height;
  }

  /** True while the GPU context is lost. Drawing calls are ignored until it is restored. */
  get isContextLost(): boolean {
    return this.resources === null;
  }

  resize(width: number, height: number): void {
    const clampedWidth = Math.max(1, Math.floor(width));
    const clampedHeight = Math.max(1, Math.floor(height));
    if (this.canvas.width !== clampedWidth || this.canvas.height !== clampedHeight) {
      this.canvas.width = clampedWidth;
      this.canvas.height = clampedHeight;
    }
  }

  createTexture(source: TextureSource, filter: TextureFilter): Texture {
    const handle = new WebGLTextureHandle(
      source.width,
      source.height,
      this.resources ? this.uploadTexture(source, filter) : null,
    );
    source.dispose?.();
    this.textures.add(handle);
    return handle;
  }

  destroyTexture(texture: Texture): void {
    const handle = texture as WebGLTextureHandle;
    if (this.textures.delete(handle)) {
      this.gl.deleteTexture(handle.glTexture);
      handle.glTexture = null;
    }
  }

  beginFrame(clearColor: Readonly<Color>): void {
    this.frameStats.drawCalls = 0;
    this.frameStats.quads = 0;
    if (!this.resources) {
      return;
    }
    const gl = this.gl;
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(clearColor.r, clearColor.g, clearColor.b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.resources.program);
    gl.bindVertexArray(this.resources.vertexArray);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
  }

  setViewProjection(matrix: Readonly<Mat3>): void {
    if (!this.resources) {
      return;
    }
    this.batch.flush();
    this.gl.uniformMatrix3fv(
      this.resources.viewProjectionLocation,
      false,
      matrix.toColumnMajorArray(this.matrixArray),
    );
  }

  drawQuad(
    transform: Readonly<Mat3>,
    texture: Texture | null,
    color: Readonly<Color>,
    flipX = false,
    flipY = false,
  ): void {
    if (!this.resources) {
      return;
    }
    const handle = texture as WebGLTextureHandle | null;
    // A texture that lost its GPU data (context loss) falls back to solid color.
    const resolved = handle?.glTexture ? handle : this.resources.whiteTexture;
    this.batch.add(transform, resolved, color, flipX, flipY);
  }

  endFrame(): void {
    if (this.resources) {
      this.batch.flush();
      this.gl.bindVertexArray(null);
    }
    this.stats.drawCalls = this.frameStats.drawCalls;
    this.stats.quads = this.frameStats.quads;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);

    const gl = this.gl;
    for (const texture of this.textures) {
      gl.deleteTexture(texture.glTexture);
      texture.glTexture = null;
    }
    this.textures.clear();
    if (this.resources) {
      gl.deleteTexture(this.resources.whiteTexture.glTexture);
      gl.deleteBuffer(this.resources.vertexBuffer);
      gl.deleteBuffer(this.resources.indexBuffer);
      gl.deleteVertexArray(this.resources.vertexArray);
      gl.deleteProgram(this.resources.program);
      this.resources = null;
    }
  }

  private drawBatch(
    vertices: Float32Array,
    quadCount: number,
    textures: readonly WebGLTextureHandle[],
  ): void {
    const resources = this.resources;
    if (!resources) {
      return;
    }
    const gl = this.gl;
    for (const [slot, texture] of textures.entries()) {
      gl.activeTexture(gl.TEXTURE0 + slot);
      gl.bindTexture(gl.TEXTURE_2D, texture.glTexture);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.vertexBuffer);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      0,
      vertices,
      0,
      quadCount * VERTICES_PER_QUAD * FLOATS_PER_VERTEX,
    );
    gl.drawElements(gl.TRIANGLES, quadCount * INDICES_PER_QUAD, gl.UNSIGNED_SHORT, 0);
    this.frameStats.drawCalls++;
    this.frameStats.quads += quadCount;
  }

  private createResources(): GLResources {
    const gl = this.gl;
    const program = this.createProgram();
    gl.useProgram(program);

    const viewProjectionLocation = gl.getUniformLocation(program, 'u_viewProjection');
    const texturesLocation = gl.getUniformLocation(program, 'u_textures');
    if (!viewProjectionLocation || !texturesLocation) {
      throw new RowanError('The sprite shader is missing expected uniforms');
    }
    gl.uniform1iv(
      texturesLocation,
      Array.from({ length: MAX_TEXTURE_SLOTS }, (_, slot) => slot),
    );

    const vertexArray = gl.createVertexArray();
    const vertexBuffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    gl.bindVertexArray(vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.batch.vertices.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, createQuadIndices(MAX_QUADS), gl.STATIC_DRAW);

    const attributes: readonly [location: number, size: number][] = [
      [0, 2],
      [1, 2],
      [2, 4],
      [3, 1],
    ];
    let offset = 0;
    for (const [location, size] of attributes) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, BYTES_PER_VERTEX, offset);
      offset += size * Float32Array.BYTES_PER_ELEMENT;
    }
    gl.bindVertexArray(null);

    const whiteTexture = new WebGLTextureHandle(
      1,
      1,
      this.uploadTexture(
        { width: 1, height: 1, pixels: new Uint8Array([255, 255, 255, 255]) },
        'nearest',
      ),
    );
    return {
      program,
      vertexArray,
      vertexBuffer,
      indexBuffer,
      viewProjectionLocation,
      whiteTexture,
    };
  }

  private createProgram(): WebGLProgram {
    const gl = this.gl;
    const vertexShader = this.compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new RowanError(`Failed to link the sprite shader: ${log}`);
    }
    return program;
  }

  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) {
      throw new RowanError('Failed to create a shader; the WebGL context may be lost');
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new RowanError(`Failed to compile the sprite shader: ${log}`);
    }
    return shader;
  }

  private uploadTexture(source: TextureSource, filter: TextureFilter): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    if (source.image) {
      // Ignored for ImageBitmap, which must already be premultiplied by the decoder.
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source.image);
    } else if (source.pixels) {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        source.width,
        source.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        premultiplyAlpha(source.pixels),
      );
    } else {
      throw new RowanError('A texture source needs either an image or pixels');
    }

    const glFilter = filter === 'nearest' ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, glFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, glFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  private readonly handleContextLost = (event: Event): void => {
    // Without preventDefault the browser never restores the context.
    event.preventDefault();
    this.resources = null;
    for (const texture of this.textures) {
      texture.glTexture = null;
    }
  };

  private readonly handleContextRestored = (): void => {
    if (this.disposed) {
      return;
    }
    this.resources = this.createResources();
    this.onContextRestored.emit();
  };
}

/** Converts straight-alpha RGBA8 pixels to premultiplied alpha. */
export function premultiplyAlpha(pixels: Uint8Array): Uint8Array {
  const result = new Uint8Array(pixels.length);
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const alpha = pixels[index + 3]!;
    result[index] = Math.round((pixels[index]! * alpha) / 255);
    result[index + 1] = Math.round((pixels[index + 1]! * alpha) / 255);
    result[index + 2] = Math.round((pixels[index + 2]! * alpha) / 255);
    result[index + 3] = alpha;
  }
  return result;
}
