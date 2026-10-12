import type { AssetDatabase } from '../assets/assetDatabase';
import type { EntityId } from '../ecs/registry';
import { Color } from '../math/color';
import { Mat3 } from '../math/mat3';
import { Vec2 } from '../math/vec2';
import { Camera, SpriteRenderer } from '../scene/components';
import type { Entity } from '../scene/entity';
import type { Scene } from '../scene/scene';
import { CameraView } from './cameraView';
import type { Renderer2D, Texture } from './renderer2d';
import type { TextureCache } from './textureCache';

interface DrawItem {
  readonly matrix: Mat3;
  sprite: SpriteRenderer;
  texture: Texture | null;
  /** Position in the unsorted list, used to keep the sort stable. */
  sequence: number;
}

/** Shown when a scene has no camera, so the problem is obvious rather than a blank frame. */
const NO_CAMERA_COLOR = Color.black();

export interface SceneRenderStats {
  /** Sprites submitted to the renderer in the last frame. */
  drawn: number;
  /** Sprites skipped because they were outside the camera's view. */
  culled: number;
}

/** Draws the sprites of a scene through a {@link Renderer2D}. */
export class SceneRenderer {
  readonly stats: SceneRenderStats = { drawn: 0, culled: 0 };

  private readonly items: DrawItem[] = [];
  private readonly size = new Vec2();
  private readonly corner = new Vec2();

  constructor(
    private readonly renderer: Renderer2D,
    private readonly textures: TextureCache,
    private readonly assets: AssetDatabase,
  ) {}

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
      (a, b) => a.sprite.sortingOrder - b.sprite.sortingOrder || a.sequence - b.sequence,
    );

    this.renderer.beginFrame(clearColor);
    this.renderer.setViewProjection(view.viewProjection);
    for (const item of frameItems) {
      const { sprite } = item;
      this.renderer.drawQuad(item.matrix, item.texture, sprite.color, sprite.flipX, sprite.flipY);
    }
    this.renderer.endFrame();
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

  /** Fills the item pool with the visible sprites and returns how many there are. */
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

      let item = this.items[count];
      if (!item) {
        item = { matrix: new Mat3(), sprite, texture: null, sequence: 0 };
        this.items.push(item);
      }
      getSpriteSize(sprite, this.assets, this.size);
      scene
        .getWorldMatrix(entity, item.matrix)
        .multiply(SCALE_SCRATCH.set(this.size.x, 0, 0, this.size.y, 0, 0));

      if (!this.isVisible(item.matrix, view)) {
        culled++;
        continue;
      }
      item.sprite = sprite;
      item.texture = sprite.texture === null ? null : this.textures.get(sprite.texture);
      item.sequence = count;
      count++;
    }
    this.stats.drawn = count;
    this.stats.culled = culled;
    return count;
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
  let fallback: EntityId | null = null;
  for (const [id, camera] of scene.registry.view(Camera)) {
    if (!scene.getEntity(id).activeInHierarchy) {
      continue;
    }
    if (camera.primary) {
      return scene.getEntity(id);
    }
    fallback ??= id;
  }
  return fallback === null ? null : scene.getEntity(fallback);
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

/**
 * The size of a sprite in local units, before the entity's scale is applied: the texture
 * size divided by pixels-per-unit, or 1x1 for a sprite without a texture.
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
  return out.set(width / pixelsPerUnit, height / pixelsPerUnit);
}
