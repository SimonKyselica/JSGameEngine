import { Signal } from '../core/signal';
import { Color } from '../math/color';
import { Mat3 } from '../math/mat3';

export type TextureFilter = 'nearest' | 'linear';

/** Decoded image data ready to be uploaded to the GPU. */
export interface TextureSource {
  readonly width: number;
  readonly height: number;
  /** A browser image object. Must hold premultiplied alpha when it is an `ImageBitmap`. */
  readonly image?: TexImageSource;
  /** Straight-alpha RGBA8 pixels, top row first. Used when `image` is not set. */
  readonly pixels?: Uint8Array;
  /** Releases the decoded image once it has been uploaded. */
  readonly dispose?: () => void;
}

/** An opaque handle to a texture owned by a renderer. */
export interface Texture {
  readonly width: number;
  readonly height: number;
}

export interface RenderStats {
  drawCalls: number;
  quads: number;
}

/**
 * The drawing backend. The engine only ever draws colored, optionally textured quads,
 * so this interface is all a new backend has to implement.
 */
export interface Renderer2D {
  /** Drawing buffer size in physical pixels. */
  readonly width: number;
  readonly height: number;
  /** Statistics of the most recently completed frame. */
  readonly stats: Readonly<RenderStats>;
  /** Emitted after the GPU context was lost and recreated. All textures must be re-created. */
  readonly onContextRestored: Signal;

  resize(width: number, height: number): void;
  createTexture(source: TextureSource, filter: TextureFilter): Texture;
  destroyTexture(texture: Texture): void;

  beginFrame(clearColor: Readonly<Color>): void;
  /** Sets the world-to-clip-space matrix for the quads that follow. */
  setViewProjection(matrix: Readonly<Mat3>): void;
  /**
   * Draws a quad. `transform` maps the unit square centered on the origin
   * (-0.5..0.5 on both axes) to world space. A `null` texture draws a solid color.
   */
  drawQuad(
    transform: Readonly<Mat3>,
    texture: Texture | null,
    color: Readonly<Color>,
    flipX?: boolean,
    flipY?: boolean,
  ): void;
  endFrame(): void;
  dispose(): void;
}

export interface RecordedQuad {
  readonly transform: Mat3;
  readonly texture: Texture | null;
  readonly color: Color;
  readonly flipX: boolean;
  readonly flipY: boolean;
}

/**
 * A renderer that draws nothing and records what it was asked to draw. Used for
 * automated tests and for running games without a display.
 */
export class HeadlessRenderer implements Renderer2D {
  readonly onContextRestored = new Signal();
  readonly stats: RenderStats = { drawCalls: 0, quads: 0 };
  /** The quads of the most recent frame, in draw order. */
  readonly quads: RecordedQuad[] = [];
  readonly clearColor = Color.black();
  readonly viewProjection = new Mat3();
  /** Number of frames completed so far. */
  frameCount = 0;

  private readonly textures = new Set<Texture>();

  constructor(
    public width = 1280,
    public height = 720,
  ) {}

  get textureCount(): number {
    return this.textures.size;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  createTexture(source: TextureSource): Texture {
    const texture: Texture = { width: source.width, height: source.height };
    this.textures.add(texture);
    source.dispose?.();
    return texture;
  }

  destroyTexture(texture: Texture): void {
    this.textures.delete(texture);
  }

  beginFrame(clearColor: Readonly<Color>): void {
    this.clearColor.copy(clearColor);
    this.quads.length = 0;
  }

  setViewProjection(matrix: Readonly<Mat3>): void {
    this.viewProjection.copy(matrix);
  }

  drawQuad(
    transform: Readonly<Mat3>,
    texture: Texture | null,
    color: Readonly<Color>,
    flipX = false,
    flipY = false,
  ): void {
    this.quads.push({
      transform: new Mat3().copy(transform),
      texture,
      color: new Color().copy(color),
      flipX,
      flipY,
    });
  }

  endFrame(): void {
    this.stats.quads = this.quads.length;
    this.stats.drawCalls = this.quads.length > 0 ? 1 : 0;
    this.frameCount++;
  }

  dispose(): void {
    this.textures.clear();
    this.quads.length = 0;
  }
}
