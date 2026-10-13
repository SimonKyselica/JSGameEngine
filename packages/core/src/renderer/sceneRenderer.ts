import type { AssetDatabase } from '../assets/assetDatabase';
import type { Logger } from '../core/logger';
import type { EntityId } from '../ecs/registry';
import { Color } from '../math/color';
import { Mat3 } from '../math/mat3';
import { Rect } from '../math/rect';
import { Vec2 } from '../math/vec2';
import {
  Button,
  ButtonState,
  Camera,
  Hierarchy,
  ScreenAnchor,
  SpriteRenderer,
  TextRenderer,
} from '../scene/components';
import type { Entity } from '../scene/entity';
import type { Scene } from '../scene/scene';
import { CameraView } from './cameraView';
import type { Renderer2D, Texture } from './renderer2d';
import { getTextRect, TEXT_PADDING, type TextRasterizer } from './textLayout';
import { TextTextureCache } from './textTextureCache';
import type { TextureCache } from './textureCache';

/** One quad of a frame: a sprite, or a text that was rasterized into a texture. */
interface DrawItem {
  readonly matrix: Mat3;
  texture: Texture | null;
  /** The color of the sprite or text, tinted by the button it belongs to. */
  readonly color: Color;
  flipX: boolean;
  flipY: boolean;
  /** The part of the texture that is shown, when `hasRegion` says it is not all of it. */
  readonly region: Rect;
  hasRegion: boolean;
  /** 1 for what is on the screen, which is drawn over the world, and 0 for the world. */
  layer: number;
  sortingOrder: number;
  /** Position in the unsorted list, used to keep the sort stable. */
  sequence: number;
}

/** Shown when a scene has no camera, so the problem is obvious rather than a blank frame. */
const NO_CAMERA_COLOR = Color.black();

export interface SceneRenderStats {
  /** Sprites and texts submitted to the renderer in the last frame. */
  drawn: number;
  /** Sprites and texts skipped because they were outside the camera's view. */
  culled: number;
}

/** Draws the sprites and texts of a scene through a {@link Renderer2D}. */
export class SceneRenderer {
  readonly stats: SceneRenderStats = { drawn: 0, culled: 0 };

  private readonly items: DrawItem[] = [];
  private readonly texts: TextTextureCache;
  private readonly size = new Vec2();
  private readonly corner = new Vec2();
  private readonly rect = new Rect();
  private readonly bounds = new Mat3();

  constructor(
    private readonly renderer: Renderer2D,
    private readonly textures: TextureCache,
    private readonly assets: AssetDatabase,
    textRasterizer: TextRasterizer,
    logger?: Logger,
  ) {
    this.texts = new TextTextureCache(renderer, textRasterizer, logger);
  }

  /** The viewport's width divided by its height. */
  get aspect(): number {
    return this.renderer.width / Math.max(this.renderer.height, 1);
  }

  /** Draws the scene as seen through `view`. */
  render(scene: Scene, view: CameraView, clearColor: Readonly<Color>): void {
    const count = this.collect(scene, view);
    const items = this.items;
    // Only the first `count` items belong to this frame; the rest are pooled leftovers.
    const frameItems = items.length === count ? items : items.slice(0, count);
    frameItems.sort(
      (a, b) => a.layer - b.layer || a.sortingOrder - b.sortingOrder || a.sequence - b.sequence,
    );

    this.renderer.beginFrame(clearColor);
    this.renderer.setViewProjection(view.viewProjection);
    for (const item of frameItems) {
      this.renderer.drawQuad(
        item.matrix,
        item.texture,
        item.color,
        item.flipX,
        item.flipY,
        item.hasRegion ? item.region : null,
      );
    }
    this.renderer.endFrame();
    this.texts.endFrame();
  }

  /** Frees the textures the renderer made for texts. */
  dispose(): void {
    this.texts.dispose();
  }

  /**
   * Draws the scene through its primary camera and returns the view that was used.
   * Clears to black and returns `null` when the scene has no active camera.
   */
  renderPrimaryCamera(scene: Scene): CameraView | null {
    const cameraEntity = findPrimaryCamera(scene);
    if (!cameraEntity) {
      this.stats.drawn = 0;
      this.stats.culled = 0;
      this.renderer.beginFrame(NO_CAMERA_COLOR);
      this.renderer.endFrame();
      return null;
    }
    const view = createCameraView(cameraEntity, this.aspect);
    this.render(scene, view, cameraEntity.requireComponent(Camera).backgroundColor);
    return view;
  }

  /**
   * Fills the item pool with the visible sprites and texts and returns how many there are.
   * Texts come after the sprites, which puts a text on top of a sprite with the same order.
   */
  private collect(scene: Scene, view: CameraView): number {
    let count = 0;
    let culled = 0;
    for (const [id, sprite] of scene.registry.view(SpriteRenderer)) {
      if (!sprite.visible || sprite.color.a <= 0) {
        continue;
      }
      const entity = scene.getEntity(id);
      if (!entity.activeInHierarchy) {
        continue;
      }

      const item = this.itemAt(count);
      getSpriteSize(sprite, this.assets, this.size);
      scene
        .getWorldMatrix(entity, item.matrix)
        .multiply(SCALE_SCRATCH.set(this.size.x, 0, 0, this.size.y, 0, 0));

      if (!this.isVisible(item.matrix, view)) {
        culled++;
        continue;
      }
      item.texture = sprite.texture === null ? null : this.textures.get(sprite.texture);
      item.hasRegion =
        item.texture !== null &&
        getSpriteRegion(sprite, item.texture.width, item.texture.height, item.region) !== null;
      this.finish(item, scene, id, sprite.color);
      item.flipX = sprite.flipX;
      item.flipY = sprite.flipY;
      item.sortingOrder = sprite.sortingOrder;
      item.sequence = count;
      count++;
    }

    const pixelsPerUnit = 1 / view.getWorldUnitsPerPixel(this.renderer.height);
    for (const [id, text] of scene.registry.view(TextRenderer)) {
      // Written so that a font size of NaN, which a script can produce, is skipped as well.
      if (
        !text.visible ||
        text.color.a <= 0 ||
        !(text.fontSize > 0) ||
        text.fontSize === Infinity
      ) {
        continue;
      }
      const entity = scene.getEntity(id);
      if (!entity.activeInHierarchy) {
        continue;
      }
      const cached = this.texts.prepare(id, text);
      const layout = cached.layout;
      if (!layout || layout.width <= 0) {
        continue;
      }

      const item = this.itemAt(count);
      const world = scene.getWorldMatrix(entity, item.matrix);
      const rect = getTextRect(text, layout, this.rect);
      // Culled before it is rasterized, so text that is out of sight costs no texture.
      const padding = 2 * TEXT_PADDING * text.fontSize;
      this.bounds
        .copy(world)
        .multiply(
          SCALE_SCRATCH.set(
            rect.width + padding,
            0,
            0,
            rect.height + padding,
            rect.centerX,
            rect.centerY,
          ),
        );
      if (!this.isVisible(this.bounds, view)) {
        culled++;
        continue;
      }

      world.getScale(this.size);
      const scale = Math.max(Math.abs(this.size.x), Math.abs(this.size.y));
      const texture = this.texts.getTexture(cached, text, text.fontSize * scale * pixelsPerUnit);
      if (!texture) {
        continue;
      }
      // The texture is larger than the text by its padding, and the quad with it.
      const unitsPerPixel = text.fontSize / cached.pixelsPerEm;
      world.multiply(
        SCALE_SCRATCH.set(
          texture.width * unitsPerPixel,
          0,
          0,
          texture.height * unitsPerPixel,
          rect.centerX,
          rect.centerY,
        ),
      );
      item.texture = texture;
      item.hasRegion = false;
      this.finish(item, scene, id, text.color);
      item.flipX = false;
      item.flipY = false;
      item.sortingOrder = text.sortingOrder;
      item.sequence = count;
      count++;
    }

    this.stats.drawn = count;
    this.stats.culled = culled;
    return count;
  }

  /**
   * Gives an item its color and its layer, both of which depend on what is above the entity
   * in the hierarchy: a `ScreenAnchor` puts it on the screen, and a `Button` tints it.
   */
  private finish(item: DrawItem, scene: Scene, id: EntityId, color: Readonly<Color>): void {
    const registry = scene.registry;
    const shown = item.color.copy(color);
    item.layer = 0;
    // Most scenes have neither, and then no entity needs to be asked.
    const anchors = registry.count(ScreenAnchor) > 0;
    const buttons = registry.count(Button) > 0;
    if (!anchors && !buttons) {
      return;
    }
    let foundButton = false;
    let current: EntityId | null = id;
    while (current !== null) {
      if (anchors && registry.has(current, ScreenAnchor)) {
        item.layer = 1;
      }
      // Only the nearest button counts, so a button inside a button looks like itself.
      const button = buttons && !foundButton ? registry.get(current, Button) : undefined;
      if (button) {
        foundButton = true;
        const tint = getButtonTint(button, registry.get(current, ButtonState));
        if (tint) {
          shown.set(shown.r * tint.r, shown.g * tint.g, shown.b * tint.b, shown.a * tint.a);
        }
      }
      current = registry.get(current, Hierarchy)?.parent ?? null;
    }
  }

  /** The pooled item at an index, created the first time the index is used. */
  private itemAt(index: number): DrawItem {
    let item = this.items[index];
    if (!item) {
      item = {
        matrix: new Mat3(),
        texture: null,
        color: new Color(),
        flipX: false,
        flipY: false,
        region: new Rect(),
        hasRegion: false,
        layer: 0,
        sortingOrder: 0,
        sequence: 0,
      };
      this.items.push(item);
    }
    return item;
  }

  /** Tests the quad's world-space bounding box against the camera bounds. */
  private isVisible(matrix: Readonly<Mat3>, view: CameraView): boolean {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of UNIT_QUAD_CORNERS) {
      matrix.transformPoint(this.corner.set(x, y), this.corner);
      minX = Math.min(minX, this.corner.x);
      minY = Math.min(minY, this.corner.y);
      maxX = Math.max(maxX, this.corner.x);
      maxY = Math.max(maxY, this.corner.y);
    }
    const bounds = view.bounds;
    return minX <= bounds.maxX && maxX >= bounds.minX && minY <= bounds.maxY && maxY >= bounds.minY;
  }
}

const SCALE_SCRATCH = new Mat3();

export const UNIT_QUAD_CORNERS: readonly (readonly [x: number, y: number])[] = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
];

/**
 * The entity whose camera the game is drawn from: the first active camera marked as
 * primary, or the first active camera when none is marked.
 */
export function findPrimaryCamera(scene: Scene): Entity | null {
  return scene.findPrimaryCamera();
}

/**
 * The color a button multiplies into everything it shows, or `null` while it is neither
 * hovered, pressed nor disabled. A button looks pressed only while the pointer is still on it.
 */
export function getButtonTint(
  button: Readonly<Button>,
  state: Readonly<ButtonState> | undefined,
): Readonly<Color> | null {
  if (!button.interactable) {
    return button.disabledColor;
  }
  if (!state?.hovered) {
    return null;
  }
  return state.pressed ? button.pressedColor : button.hoverColor;
}

/** Builds the view of a camera entity for a viewport with the given aspect ratio. */
export function createCameraView(cameraEntity: Entity, aspect: number): CameraView {
  const camera = cameraEntity.requireComponent(Camera);
  return new CameraView(
    cameraEntity.worldPosition,
    cameraEntity.worldRotation,
    camera.orthographicSize,
    aspect,
  );
}

/** How many frames a sprite sheet has along one side: a whole number, and at least one. */
function getFrameCount(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

/**
 * The part of its texture that a sprite shows, as fractions of the texture with the origin
 * in the top-left corner, or `null` when it shows all of it. `frame` is counted from left to
 * right and from the top row down, and starts over past the last frame.
 *
 * @param textureWidth The size of the texture in pixels. Half a pixel is left out all round,
 *   so that smoothing does not pull the neighbouring frames in at the edges.
 */
export function getSpriteRegion(
  sprite: Readonly<SpriteRenderer>,
  textureWidth: number,
  textureHeight: number,
  out = new Rect(),
): Rect | null {
  const columns = getFrameCount(sprite.columns);
  const rows = getFrameCount(sprite.rows);
  if (columns === 1 && rows === 1) {
    return null;
  }
  const count = columns * rows;
  const frame = Number.isFinite(sprite.frame) ? Math.floor(sprite.frame) : 0;
  // A double modulo, so that a negative frame counts back from the end.
  const index = ((frame % count) + count) % count;
  const insetX = textureWidth > 0 ? 0.5 / textureWidth : 0;
  const insetY = textureHeight > 0 ? 0.5 / textureHeight : 0;
  out.x = (index % columns) / columns + insetX;
  out.y = Math.floor(index / columns) / rows + insetY;
  out.width = 1 / columns - 2 * insetX;
  out.height = 1 / rows - 2 * insetY;
  return out;
}

/**
 * The size of a sprite in local units, before the entity's scale is applied: the size of
 * one frame of its texture divided by pixels-per-unit, or 1x1 for a sprite without a texture.
 */
export function getSpriteSize(
  sprite: SpriteRenderer,
  assets: AssetDatabase,
  out = new Vec2(),
): Vec2 {
  const meta = sprite.texture === null ? undefined : assets.get(sprite.texture)?.meta;
  const width = meta?.width;
  const height = meta?.height;
  if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) {
    return out.set(1, 1);
  }
  const pixelsPerUnit = sprite.pixelsPerUnit > 0 ? sprite.pixelsPerUnit : 100;
  return out.set(
    width / getFrameCount(sprite.columns) / pixelsPerUnit,
    height / getFrameCount(sprite.rows) / pixelsPerUnit,
  );
}
