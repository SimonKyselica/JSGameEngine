import { describe, expect, it, vi } from 'vitest';
import { AssetDatabase } from '../assets/assetDatabase';
import { encodePng } from '../assets/png';
import { Logger } from '../core/logger';
import { Color } from '../math/color';
import { Mat3 } from '../math/mat3';
import { Vec2 } from '../math/vec2';
import { Camera, SpriteRenderer } from '../scene/components';
import { Scene } from '../scene/scene';
import { CameraView } from './cameraView';
import { decodeImageHeadless } from './imageDecoder';
import { HeadlessRenderer, type TextureSource } from './renderer2d';
import { createCameraView, findPrimaryCamera, getSpriteSize, SceneRenderer } from './sceneRenderer';
import { createQuadIndices, FLOATS_PER_VERTEX, MAX_BATCH_QUADS, SpriteBatch } from './spriteBatch';
import { TextureCache, type ImageDecoder } from './textureCache';
import { premultiplyAlpha } from './webgl2Renderer';

const WHITE = Color.white();

function addTexture(assets: AssetDatabase, name: string, width: number, height: number): string {
  return assets.create({
    name,
    type: 'texture',
    mimeType: 'image/png',
    data: encodePng(width, height, new Uint8Array(width * height * 4)),
    meta: { width, height },
  }).id;
}

function createRenderSetup(): {
  scene: Scene;
  assets: AssetDatabase;
  renderer: HeadlessRenderer;
  textures: TextureCache;
  sceneRenderer: SceneRenderer;
} {
  const assets = new AssetDatabase();
  const renderer = new HeadlessRenderer(200, 100);
  const textures = new TextureCache(renderer, assets, decodeImageHeadless, 'linear');
  return {
    scene: new Scene(),
    assets,
    renderer,
    textures,
    sceneRenderer: new SceneRenderer(renderer, textures, assets),
  };
}

describe('SpriteBatch', () => {
  it('writes four transformed vertices per quad', () => {
    const flush = vi.fn();
    const batch = new SpriteBatch<string>(4, 2, flush);
    batch.add(
      Mat3.compose(new Vec2(10, 20), 0, new Vec2(2, 4)),
      'tex',
      new Color(1, 0.5, 0, 1),
      false,
      false,
    );
    expect(batch.pendingQuads).toBe(1);

    const vertex = (index: number): number[] => [
      ...batch.vertices.subarray(index * FLOATS_PER_VERTEX, (index + 1) * FLOATS_PER_VERTEX),
    ];
    // position, uv, color, texture slot; bottom-left first, counter-clockwise.
    expect(vertex(0)).toEqual([9, 18, 0, 1, 1, 0.5, 0, 1, 0]);
    expect(vertex(1)).toEqual([11, 18, 1, 1, 1, 0.5, 0, 1, 0]);
    expect(vertex(2)).toEqual([11, 22, 1, 0, 1, 0.5, 0, 1, 0]);
    expect(vertex(3)).toEqual([9, 22, 0, 0, 1, 0.5, 0, 1, 0]);
  });

  it('mirrors texture coordinates when flipped', () => {
    const batch = new SpriteBatch<string>(1, 1, vi.fn());
    batch.add(new Mat3(), 'tex', WHITE, true, true);
    expect([batch.vertices[2], batch.vertices[3]]).toEqual([1, 0]);
  });

  it('shares a slot between quads with the same texture', () => {
    // The batch reuses its texture list, so the callback has to copy what it is given.
    const flushes: { quadCount: number; textures: string[] }[] = [];
    const batch = new SpriteBatch<string>(8, 2, (_vertices, quadCount, textures) =>
      flushes.push({ quadCount, textures: [...textures] }),
    );
    batch.add(new Mat3(), 'a', WHITE, false, false);
    batch.add(new Mat3(), 'b', WHITE, false, false);
    batch.add(new Mat3(), 'a', WHITE, false, false);
    batch.flush();
    expect(flushes).toEqual([{ quadCount: 3, textures: ['a', 'b'] }]);
    const slotOf = (quad: number): number => batch.vertices[quad * 4 * FLOATS_PER_VERTEX + 8]!;
    expect([slotOf(0), slotOf(1), slotOf(2)]).toEqual([0, 1, 0]);
  });

  it('flushes when it runs out of texture slots', () => {
    const quadCounts: number[] = [];
    const batch = new SpriteBatch<string>(8, 2, (_vertices, quadCount) =>
      quadCounts.push(quadCount),
    );
    for (const texture of ['a', 'b', 'c']) {
      batch.add(new Mat3(), texture, WHITE, false, false);
    }
    expect(quadCounts).toEqual([2]);
    expect(batch.pendingQuads).toBe(1);
    expect(batch.vertices[8]).toBe(0);
  });

  it('flushes when it is full and ignores empty flushes', () => {
    const flush = vi.fn();
    const batch = new SpriteBatch<string>(2, 4, flush);
    batch.flush();
    expect(flush).not.toHaveBeenCalled();
    for (let index = 0; index < 5; index++) {
      batch.add(new Mat3(), 'a', WHITE, false, false);
    }
    expect(flush).toHaveBeenCalledTimes(2);
    expect(batch.pendingQuads).toBe(1);
  });

  it('validates its limits', () => {
    expect(() => new SpriteBatch(0, 1, vi.fn())).toThrow();
    expect(() => new SpriteBatch(MAX_BATCH_QUADS + 1, 1, vi.fn())).toThrow();
    expect(() => new SpriteBatch(1, 0, vi.fn())).toThrow();
  });

  it('creates two triangles per quad', () => {
    expect([...createQuadIndices(2)]).toEqual([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    expect(() => createQuadIndices(MAX_BATCH_QUADS + 1)).toThrow();
  });
});

describe('premultiplyAlpha', () => {
  it('multiplies color channels by alpha without changing the input', () => {
    const pixels = new Uint8Array([255, 128, 0, 128, 10, 20, 30, 0, 9, 9, 9, 255]);
    expect([...premultiplyAlpha(pixels)]).toEqual([128, 64, 0, 128, 0, 0, 0, 0, 9, 9, 9, 255]);
    expect(pixels[0]).toBe(255);
  });
});

describe('CameraView', () => {
  it('maps the visible world rectangle to clip space', () => {
    const view = new CameraView(new Vec2(10, 5), 0, 5, 2);
    expect(view.viewProjection.transformPoint(new Vec2(10, 5)).equals(new Vec2(0, 0))).toBe(true);
    expect(view.viewProjection.transformPoint(new Vec2(20, 10)).equals(new Vec2(1, 1))).toBe(true);
    expect(view.viewProjection.transformPoint(new Vec2(0, 0)).equals(new Vec2(-1, -1))).toBe(true);
    expect([view.bounds.minX, view.bounds.minY, view.bounds.maxX, view.bounds.maxY]).toEqual([
      0, 0, 20, 10,
    ]);
  });

  it('converts between viewport pixels and world space', () => {
    const view = new CameraView(new Vec2(0, 0), 0, 5, 2);
    expect(view.viewportToWorld(0, 0, 200, 100).equals(new Vec2(-10, 5))).toBe(true);
    expect(view.viewportToWorld(200, 100, 200, 100).equals(new Vec2(10, -5))).toBe(true);
    expect(view.viewportToWorld(100, 50, 200, 100).equals(new Vec2(0, 0))).toBe(true);
    expect(view.worldToViewport(new Vec2(-10, 5), 200, 100).equals(new Vec2(0, 0))).toBe(true);
    expect(view.worldToViewport(new Vec2(5, 0), 200, 100).equals(new Vec2(150, 50))).toBe(true);
    expect(view.getWorldUnitsPerPixel(100)).toBe(0.1);
  });

  it('accounts for camera rotation', () => {
    const view = new CameraView(new Vec2(0, 0), Math.PI / 2, 1, 1);
    // With the camera turned 90 degrees, world +Y appears to the right on screen.
    expect(view.viewProjection.transformPoint(new Vec2(0, 1)).equals(new Vec2(1, 0))).toBe(true);
    const point = new Vec2(0.3, -0.7);
    const roundTrip = view.viewportToWorld(
      ...view.worldToViewport(point, 50, 50).toArray(),
      50,
      50,
    );
    expect(roundTrip.equals(point)).toBe(true);
  });

  it('stays finite for degenerate sizes', () => {
    const view = new CameraView(new Vec2(), 0, 0, 0);
    expect(Number.isFinite(view.viewProjection.a)).toBe(true);
    expect(Number.isFinite(view.viewportToWorld(0, 0, 0, 0).x)).toBe(true);
  });
});

describe('HeadlessRenderer', () => {
  it('records frames and textures', () => {
    const renderer = new HeadlessRenderer(64, 32);
    const dispose = vi.fn();
    const texture = renderer.createTexture({ width: 4, height: 2, dispose });
    expect(texture).toMatchObject({ width: 4, height: 2 });
    expect(dispose).toHaveBeenCalledOnce();
    expect(renderer.textureCount).toBe(1);

    renderer.beginFrame(new Color(0.5, 0, 0, 1));
    renderer.setViewProjection(new Mat3(2, 0, 0, 2, 0, 0));
    renderer.drawQuad(new Mat3(), texture, WHITE, true);
    renderer.endFrame();
    expect(renderer.clearColor.r).toBe(0.5);
    expect(renderer.viewProjection.a).toBe(2);
    expect(renderer.quads).toHaveLength(1);
    expect(renderer.quads[0]).toMatchObject({ texture, flipX: true, flipY: false });
    expect(renderer.stats).toEqual({ drawCalls: 1, quads: 1 });
    expect(renderer.frameCount).toBe(1);

    renderer.resize(10, 20);
    expect([renderer.width, renderer.height]).toEqual([10, 20]);
    renderer.destroyTexture(texture);
    expect(renderer.textureCount).toBe(0);
    renderer.dispose();
    expect(renderer.quads).toHaveLength(0);
  });
});

describe('TextureCache', () => {
  it('loads a texture once, on demand', async () => {
    const { assets, renderer } = createRenderSetup();
    const decode = vi.fn<ImageDecoder>(decodeImageHeadless);
    const textures = new TextureCache(renderer, assets, decode, 'nearest');
    const loaded = vi.fn();
    textures.onTextureLoaded.connect(loaded);
    const id = addTexture(assets, 'a.png', 8, 4);

    expect(textures.get(id)).toBeNull();
    expect(textures.get(id)).toBeNull();
    const texture = await textures.load(id);
    expect(texture).toMatchObject({ width: 8, height: 4 });
    expect(textures.get(id)).toBe(texture);
    expect(decode).toHaveBeenCalledOnce();
    expect(loaded).toHaveBeenCalledExactlyOnceWith(id);
  });

  it('preloads every texture asset', async () => {
    const { assets, renderer, textures } = createRenderSetup();
    const first = addTexture(assets, 'a.png', 2, 2);
    const second = addTexture(assets, 'b.png', 2, 2);
    await textures.preloadAll();
    expect(textures.get(first)).not.toBeNull();
    expect(textures.get(second)).not.toBeNull();
    expect(renderer.textureCount).toBe(2);
  });

  it('returns null for missing assets and assets that are not textures', async () => {
    const { assets, textures } = createRenderSetup();
    const script = assets.create({
      name: 'a.ts',
      type: 'script',
      mimeType: 'text/plain',
      data: '',
    });
    expect(await textures.load('missing')).toBeNull();
    expect(await textures.load(script.id)).toBeNull();
    expect(textures.get('missing')).toBeNull();
  });

  it('logs decode failures and does not retry them every frame', async () => {
    const { assets, renderer } = createRenderSetup();
    const logger = new Logger();
    const errors: string[] = [];
    logger.addSink((entry) => errors.push(entry.message));
    const decode = vi.fn<ImageDecoder>(() => Promise.reject(new Error('corrupt')));
    const textures = new TextureCache(renderer, assets, decode, 'linear', logger);
    const id = addTexture(assets, 'bad.png', 1, 1);

    expect(await textures.load(id)).toBeNull();
    expect(textures.get(id)).toBeNull();
    expect(decode).toHaveBeenCalledOnce();
    expect(errors).toEqual(['Failed to load texture "bad.png": corrupt']);
  });

  it('reloads a texture after its asset changes and frees it when removed', async () => {
    const { assets, renderer, textures } = createRenderSetup();
    const id = addTexture(assets, 'a.png', 2, 2);
    const before = await textures.load(id);

    assets.setData(id, encodePng(6, 3, new Uint8Array(6 * 3 * 4)));
    expect(renderer.textureCount).toBe(0);
    const after = await textures.load(id);
    expect(after).not.toBe(before);
    expect(after).toMatchObject({ width: 6, height: 3 });

    assets.remove(id);
    expect(renderer.textureCount).toBe(0);
    expect(textures.get(id)).toBeNull();
  });

  it('discards a decode that finishes after the asset changed', async () => {
    const { assets, renderer } = createRenderSetup();
    let finishDecode: (source: TextureSource) => void = () => {};
    const dispose = vi.fn();
    const decode: ImageDecoder = () =>
      new Promise((resolve) => {
        finishDecode = resolve;
      });
    const textures = new TextureCache(renderer, assets, decode, 'linear');
    const id = addTexture(assets, 'a.png', 2, 2);

    const pending = textures.load(id);
    assets.setData(id, new Uint8Array([1]));
    finishDecode({ width: 2, height: 2, dispose });
    expect(await pending).toBeNull();
    expect(dispose).toHaveBeenCalledOnce();
    expect(renderer.textureCount).toBe(0);
  });

  it('drops all textures when the GPU context is restored or the cache is disposed', async () => {
    const { assets, renderer, textures } = createRenderSetup();
    const id = addTexture(assets, 'a.png', 2, 2);
    const first = await textures.load(id);
    renderer.onContextRestored.emit();
    expect(renderer.textureCount).toBe(0);
    expect(await textures.load(id)).not.toBe(first);

    textures.dispose();
    expect(renderer.textureCount).toBe(0);
    expect(await textures.load(id)).toBeNull();
  });
});

describe('decodeImageHeadless', () => {
  it('reports the real size of PNG data and falls back to one pixel', async () => {
    const png = encodePng(5, 3, new Uint8Array(5 * 3 * 4));
    expect(await decodeImageHeadless(png, 'image/png')).toMatchObject({ width: 5, height: 3 });
    expect(await decodeImageHeadless(new Uint8Array(3), 'image/jpeg')).toMatchObject({
      width: 1,
      height: 1,
    });
  });
});

describe('SceneRenderer', () => {
  it('draws sprites sorted by order, then by creation', () => {
    const { scene, renderer, sceneRenderer } = createRenderSetup();
    const colors = [new Color(1, 0, 0), new Color(0, 1, 0), new Color(0, 0, 1), new Color(1, 1, 0)];
    const orders = [5, 0, 5, -1];
    for (const [index, color] of colors.entries()) {
      scene.createEntity(`S${index}`).addComponent(SpriteRenderer, {
        color,
        sortingOrder: orders[index]!,
      });
    }
    sceneRenderer.render(scene, new CameraView(new Vec2(), 0, 5, 2), Color.black());
    expect(renderer.quads.map((quad) => quad.color.toHex())).toEqual([
      '#ffff00',
      '#00ff00',
      '#ff0000',
      '#0000ff',
    ]);
    expect(sceneRenderer.stats).toEqual({ drawn: 4, culled: 0 });
  });

  it('sizes quads from the texture, pixels per unit and transform', async () => {
    const { scene, assets, renderer, textures, sceneRenderer } = createRenderSetup();
    const textureId = addTexture(assets, 'wide.png', 64, 32);
    await textures.preloadAll();
    const entity = scene.createEntity('Sprite');
    entity.transform.position.set(3, 1);
    entity.transform.scale.set(2, 2);
    entity.addComponent(SpriteRenderer, { texture: textureId, pixelsPerUnit: 32, flipY: true });

    sceneRenderer.render(scene, new CameraView(new Vec2(), 0, 5, 2), Color.black());
    const quad = renderer.quads[0]!;
    // 64x32 pixels at 32 pixels per unit is 2x1 units, doubled by the entity's scale.
    expect(quad.transform.getScale().toArray()).toEqual([4, 2]);
    expect(quad.transform.getTranslation().toArray()).toEqual([3, 1]);
    expect(quad.texture).toBe(textures.get(textureId));
    expect(quad.flipY).toBe(true);
  });

  it('skips invisible, transparent, inactive and off-screen sprites', () => {
    const { scene, renderer, sceneRenderer } = createRenderSetup();
    scene.createEntity('Visible').addComponent(SpriteRenderer);
    scene.createEntity('Hidden').addComponent(SpriteRenderer, { visible: false });
    scene.createEntity('Clear').addComponent(SpriteRenderer, { color: new Color(1, 1, 1, 0) });
    const inactiveParent = scene.createEntity('InactiveParent');
    inactiveParent.active = false;
    scene.createEntity('Child', { parent: inactiveParent }).addComponent(SpriteRenderer);
    const far = scene.createEntity('Far');
    far.transform.position.set(100, 0);
    far.addComponent(SpriteRenderer);

    sceneRenderer.render(scene, new CameraView(new Vec2(), 0, 5, 2), Color.black());
    expect(renderer.quads).toHaveLength(1);
    expect(sceneRenderer.stats).toEqual({ drawn: 1, culled: 1 });
  });

  it('draws only the current sprites after the scene shrinks', () => {
    const { scene, renderer, sceneRenderer } = createRenderSetup();
    const view = new CameraView(new Vec2(), 0, 5, 2);
    const entities = [0, 1, 2].map((index) => {
      const entity = scene.createEntity(`S${index}`);
      entity.addComponent(SpriteRenderer);
      return entity;
    });
    sceneRenderer.render(scene, view, Color.black());
    expect(renderer.quads).toHaveLength(3);

    entities[0]!.destroy();
    entities[1]!.destroy();
    sceneRenderer.render(scene, view, Color.black());
    expect(renderer.quads).toHaveLength(1);
  });

  it('renders through the primary camera with its background color', () => {
    const { scene, renderer, sceneRenderer } = createRenderSetup();
    const camera = scene.createEntity('Camera');
    camera.transform.position.set(50, 0);
    camera.addComponent(Camera, { orthographicSize: 2, backgroundColor: new Color(0, 0, 1) });
    scene.createEntity('AtOrigin').addComponent(SpriteRenderer);
    const near = scene.createEntity('NearCamera');
    near.transform.position.set(50, 0);
    near.addComponent(SpriteRenderer);

    const view = sceneRenderer.renderPrimaryCamera(scene);
    expect(view?.position.toArray()).toEqual([50, 0]);
    expect(view?.aspect).toBe(2);
    expect(renderer.clearColor.toHex()).toBe('#0000ff');
    expect(renderer.quads).toHaveLength(1);
  });

  it('clears to black when there is no camera', () => {
    const { scene, renderer, sceneRenderer } = createRenderSetup();
    scene.createEntity('Sprite').addComponent(SpriteRenderer);
    expect(sceneRenderer.renderPrimaryCamera(scene)).toBeNull();
    expect(renderer.clearColor.toHex()).toBe('#000000');
    expect(renderer.quads).toHaveLength(0);
    expect(renderer.frameCount).toBe(1);
  });
});

describe('camera and sprite helpers', () => {
  it('prefers the first active primary camera', () => {
    const scene = new Scene();
    const secondary = scene.createEntity('Secondary');
    secondary.addComponent(Camera, { primary: false });
    const disabled = scene.createEntity('Disabled');
    disabled.addComponent(Camera);
    disabled.active = false;
    expect(findPrimaryCamera(scene)).toBe(secondary);

    const primary = scene.createEntity('Primary');
    primary.addComponent(Camera);
    expect(findPrimaryCamera(scene)).toBe(primary);
    expect(findPrimaryCamera(new Scene())).toBeNull();
  });

  it('builds a view from a camera entity, including its parent transform', () => {
    const scene = new Scene();
    const rig = scene.createEntity('Rig');
    rig.transform.position.set(10, 10);
    const camera = scene.createEntity('Camera', { parent: rig });
    camera.transform.position.set(1, 0);
    camera.addComponent(Camera, { orthographicSize: 3 });
    const view = createCameraView(camera, 1.5);
    expect(view.position.toArray()).toEqual([11, 10]);
    expect(view.halfHeight).toBe(3);
    expect(view.bounds.width).toBe(9);
  });

  it('falls back to a unit square for sprites without usable texture data', () => {
    const assets = new AssetDatabase();
    const sprite = new SpriteRenderer();
    expect(getSpriteSize(sprite, assets).toArray()).toEqual([1, 1]);
    sprite.texture = 'missing';
    expect(getSpriteSize(sprite, assets).toArray()).toEqual([1, 1]);

    sprite.texture = addTexture(assets, 'a.png', 50, 200);
    expect(getSpriteSize(sprite, assets).toArray()).toEqual([0.5, 2]);
    sprite.pixelsPerUnit = 0;
    expect(getSpriteSize(sprite, assets).toArray()).toEqual([0.5, 2]);
  });
});
