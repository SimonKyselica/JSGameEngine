import { describe, expect, it } from 'vitest';
import { AssetDatabase } from '../assets/assetDatabase';
import { encodePng } from '../assets/png';
import { Color } from '../math/color';
import { Vec2 } from '../math/vec2';
import { PhysicsSystem } from '../physics/physicsSystem';
import { CameraView } from '../renderer/cameraView';
import { decodeImageHeadless } from '../renderer/imageDecoder';
import { HeadlessRenderer } from '../renderer/renderer2d';
import { SceneRenderer } from '../renderer/sceneRenderer';
import { HeadlessTextRasterizer } from '../renderer/textLayout';
import { TextureCache } from '../renderer/textureCache';
import { BoxCollider2D, EMPTY_TILE, MAX_TILEMAP_SIDE, Rigidbody2D, Tilemap } from './components';
import { deserializeComponent, serializeComponent } from './schema';
import { Scene } from './scene';

/** A map of the given size, with the tiles of `rows` listed from the top row down. */
function createMap(rows: number[][]): Tilemap {
  const map = new Tilemap();
  map.resize(rows[0]?.length ?? 0, rows.length);
  rows.forEach((tiles, index) => {
    tiles.forEach((tile, column) => map.setTile(column, rows.length - 1 - index, tile));
  });
  return map;
}

describe('Tilemap', () => {
  it('starts without cells and gets them by being resized', () => {
    const map = new Tilemap();
    expect([map.width, map.height, map.tiles]).toEqual([0, 0, []]);
    map.resize(3, 2);
    expect(map.tiles).toEqual([-1, -1, -1, -1, -1, -1]);
    expect(map.getTile(0, 0)).toBe(EMPTY_TILE);
  });

  it('keeps its tiles row by row from the bottom-left corner', () => {
    const map = createMap([
      [4, 5, 6],
      [1, 2, 3],
    ]);
    expect(map.tiles).toEqual([1, 2, 3, 4, 5, 6]);
    expect(map.getTile(0, 0)).toBe(1);
    expect(map.getTile(2, 1)).toBe(6);
  });

  it('answers -1 for cells outside the map and ignores tiles put there', () => {
    const map = createMap([[1, 2]]);
    for (const [column, row] of [
      [-1, 0],
      [2, 0],
      [0, 1],
      [0.5, 0],
      [Number.NaN, 0],
    ] as const) {
      expect(map.getTile(column, row)).toBe(EMPTY_TILE);
      map.setTile(column, row, 9);
    }
    expect(map.tiles).toEqual([1, 2]);
  });

  it('empties a cell for -1 and for numbers that are not a tile', () => {
    const map = createMap([[1, 2, 3, 4]]);
    map.setTile(0, 0, -1);
    map.setTile(1, 0, -7);
    map.setTile(2, 0, Number.NaN);
    map.setTile(3, 0, 2.9);
    expect(map.tiles).toEqual([-1, -1, -1, 2]);
  });

  it('fills every cell with one tile', () => {
    const map = createMap([
      [1, 2],
      [3, 4],
    ]);
    map.fill(7);
    expect(map.tiles).toEqual([7, 7, 7, 7]);
    map.fill(-1);
    expect(map.tiles).toEqual([-1, -1, -1, -1]);
  });

  it('keeps the tiles in place when it is made larger or smaller', () => {
    const map = createMap([
      [4, 5, 6],
      [1, 2, 3],
    ]);
    map.resize(4, 3);
    expect(map.tiles).toEqual([1, 2, 3, -1, 4, 5, 6, -1, -1, -1, -1, -1]);
    map.resize(2, 1);
    expect(map.tiles).toEqual([1, 2]);
    expect([map.width, map.height]).toEqual([2, 1]);
  });

  it('refuses sizes that make no sense, and limits how large a map can be', () => {
    const map = new Tilemap();
    map.resize(-3, Number.NaN);
    expect([map.width, map.height]).toEqual([0, 0]);
    map.resize(2.9, 1e9);
    expect([map.width, map.height]).toEqual([2, MAX_TILEMAP_SIDE]);
  });

  it('counts its changes, so that what depends on the tiles can follow', () => {
    const map = createMap([[1, 2]]);
    const before = map.revision;
    map.setTile(0, 0, 1);
    expect(map.revision).toBe(before);
    map.setTile(0, 0, 5);
    map.fill(3);
    map.resize(4, 4);
    expect(map.revision).toBe(before + 3);
  });

  it('copes with a tile list that is shorter than the map', () => {
    const map = new Tilemap();
    deserializeComponent(map, Tilemap.schema, { width: 3, height: 2, tiles: [5] }, 'map');
    expect(map.getTile(0, 0)).toBe(5);
    expect(map.getTile(2, 1)).toBe(EMPTY_TILE);
    map.setTile(1, 1, 8);
    expect(map.tiles).toEqual([5, -1, -1, -1, 8]);
  });

  it('is saved with its size and tiles, and rejects tiles that are not numbers', () => {
    const map = createMap([[1, -1]]);
    expect(serializeComponent(map, Tilemap.schema)).toMatchObject({
      width: 2,
      height: 1,
      tiles: [1, -1],
      solid: false,
    });
    expect(() => deserializeComponent(map, Tilemap.schema, { tiles: 'grass' }, 'map')).toThrow(
      'map.tiles: expected an array of tile numbers',
    );
    expect(() => deserializeComponent(map, Tilemap.schema, { tiles: [1, 'x'] }, 'map')).toThrow(
      'map.tiles[1]: expected a finite number',
    );
    deserializeComponent(map, Tilemap.schema, { tiles: [2.7, -5] }, 'map');
    expect(map.tiles).toEqual([2, -1]);
  });
});

describe('drawing a Tilemap', () => {
  async function createSetup(): Promise<{
    scene: Scene;
    renderer: HeadlessRenderer;
    sceneRenderer: SceneRenderer;
    tileset: string;
  }> {
    const assets = new AssetDatabase();
    // A tileset of 4 columns and 2 rows of 16x16 pixel tiles.
    const tileset = assets.create({
      name: 'tiles.png',
      type: 'texture',
      mimeType: 'image/png',
      data: encodePng(64, 32, new Uint8Array(64 * 32 * 4)),
      meta: { width: 64, height: 32 },
    }).id;
    const renderer = new HeadlessRenderer(200, 100);
    const textures = new TextureCache(renderer, assets, decodeImageHeadless, 'linear');
    await textures.preloadAll();
    const sceneRenderer = new SceneRenderer(
      renderer,
      textures,
      assets,
      new HeadlessTextRasterizer(),
    );
    return { scene: new Scene(), renderer, sceneRenderer, tileset };
  }
  /** Sees the world from (-10, -5) to (10, 5). */
  const VIEW = new CameraView(new Vec2(), 0, 5, 2);

  it('draws one quad for every tile, each showing its part of the tileset', async () => {
    const { scene, renderer, sceneRenderer, tileset } = await createSetup();
    const entity = scene.createEntity('Level');
    entity.transform.position.set(-2, -1);
    const map = entity.addComponent(Tilemap, {
      texture: tileset,
      columns: 4,
      rows: 2,
      tileSize: 2,
      sortingOrder: 3,
      color: new Color(1, 0.5, 0.5, 1),
    });
    map.resize(2, 2);
    map.setTile(0, 0, 0);
    map.setTile(1, 1, 5);

    sceneRenderer.render(scene, VIEW, Color.black());
    expect(renderer.quads).toHaveLength(2);
    const [first, second] = renderer.quads;
    // Cells are 2 units large; cell (0, 0) starts at the entity, so its center is (-1, 0).
    expect(first!.transform.getTranslation().toArray()).toEqual([-1, 0]);
    expect(first!.transform.getScale().toArray()).toEqual([2, 2]);
    expect(second!.transform.getTranslation().toArray()).toEqual([1, 2]);
    // Tile 5 is the second one in the second row of the tileset.
    expect(second!.region!.x).toBeCloseTo(0.25 + 0.5 / 64);
    expect(second!.region!.y).toBeCloseTo(0.5 + 0.5 / 32);
    expect(second!.color.toHex()).toBe('#ff8080');
    expect(sceneRenderer.stats).toEqual({ drawn: 2, culled: 0 });
  });

  it('draws only the cells the camera sees, however large the map is', async () => {
    const { scene, renderer, sceneRenderer } = await createSetup();
    const entity = scene.createEntity('Huge');
    entity.transform.position.set(-500, -500);
    const map = entity.addComponent(Tilemap);
    map.resize(1000, 1000);
    map.fill(0);

    sceneRenderer.render(scene, VIEW, Color.black());
    // The view is 20 by 10 units: 20 columns and 10 rows of cells, and no more.
    expect(renderer.quads).toHaveLength(200);
    // Without a tileset a tile is a plain square in the color of the map.
    expect(renderer.quads[0]!.texture).toBeNull();
    expect(renderer.quads[0]!.region).toBeNull();
  });

  it('follows the rotation and scale of its entity', async () => {
    const { scene, renderer, sceneRenderer } = await createSetup();
    const entity = scene.createEntity('Tilted');
    entity.transform.rotation = Math.PI / 2;
    entity.transform.scale.set(2, 2);
    const map = entity.addComponent(Tilemap);
    map.resize(2, 1);
    map.fill(0);

    sceneRenderer.render(scene, VIEW, Color.black());
    const centers = renderer.quads.map((quad) =>
      quad.transform
        .getTranslation()
        .toArray()
        .map((value) => Math.round(value * 1000) / 1000),
    );
    // The row of two cells now runs upwards from the entity, in cells of 2 units.
    expect(centers).toEqual([
      [-1, 1],
      [-1, 3],
    ]);
  });

  it('skips maps that are hidden, transparent, inactive, out of sight or without a usable size', async () => {
    const { scene, renderer, sceneRenderer } = await createSetup();
    const add = (name: string, fields: Partial<Tilemap> = {}, x = 0): Tilemap => {
      const entity = scene.createEntity(name);
      entity.transform.position.set(x, 0);
      const map = entity.addComponent(Tilemap, fields);
      map.resize(1, 1);
      map.fill(0);
      return map;
    };
    add('Hidden', { visible: false });
    add('Clear', { color: new Color(1, 1, 1, 0) });
    add('No size', { tileSize: 0 });
    add('Broken size', { tileSize: Number.NaN });
    add('Far away', {}, 500);
    add('Inactive');
    scene.findByName('Inactive')!.active = false;
    add('Flat').tiles.length = 0;
    scene.findByName('Flat')!.transform.scale.set(0, 1);

    sceneRenderer.render(scene, VIEW, Color.black());
    expect(renderer.quads).toHaveLength(0);
    expect(sceneRenderer.stats.culled).toBe(1);
  });
});

describe('a solid Tilemap', () => {
  const STEP = 1 / 60;
  function createWorld(): { scene: Scene; physics: PhysicsSystem; simulate: (s: number) => void } {
    const scene = new Scene();
    const physics = new PhysicsSystem(scene, new Vec2(0, -10));
    physics.start();
    return {
      scene,
      physics,
      simulate(seconds) {
        for (let time = 0; time < seconds; time += STEP) {
          physics.step(STEP);
        }
      },
    };
  }
  function addBall(scene: Scene, x: number, y: number): ReturnType<Scene['createEntity']> {
    const ball = scene.createEntity('Ball');
    ball.transform.position.set(x, y);
    ball.addComponent(Rigidbody2D);
    ball.addComponent(BoxCollider2D, { size: new Vec2(0.5, 0.5) });
    return ball;
  }

  it('holds up what falls on its tiles and lets it through where there are none', () => {
    const { scene, simulate } = createWorld();
    const level = scene.createEntity('Level');
    const map = level.addComponent(Tilemap, { solid: true });
    map.resize(4, 1);
    map.setTile(0, 0, 0);
    map.setTile(1, 0, 0);
    const caught = addBall(scene, 1, 3);
    const missed = addBall(scene, 3, 3);
    simulate(2);
    // The tiles reach up to y = 1, and the ball is half a unit tall.
    expect(caught.transform.position.y).toBeCloseTo(1.25, 1);
    expect(missed.transform.position.y).toBeLessThan(-5);
  });

  it('follows tiles that a script adds and removes', () => {
    const { scene, simulate } = createWorld();
    const map = scene.createEntity('Level').addComponent(Tilemap, { solid: true });
    map.resize(2, 1);
    map.fill(0);
    const ball = addBall(scene, 1, 3);
    simulate(2);
    expect(ball.transform.position.y).toBeCloseTo(1.25, 1);

    map.fill(-1);
    simulate(1);
    expect(ball.transform.position.y).toBeLessThan(0);
  });

  it('is not in the way while it is not solid', () => {
    const { scene, simulate, physics } = createWorld();
    const map = scene.createEntity('Decoration').addComponent(Tilemap);
    map.resize(4, 1);
    map.fill(0);
    const ball = addBall(scene, 1, 3);
    simulate(1);
    expect(ball.transform.position.y).toBeLessThan(0);

    map.solid = true;
    ball.transform.position.set(1, 3);
    physics.step(STEP);
    simulate(2);
    expect(ball.transform.position.y).toBeCloseTo(1.25, 1);
  });

  it('makes one wall of the tiles that lie side by side in a row', () => {
    const { scene, physics } = createWorld();
    const level = scene.createEntity('Level');
    level.transform.scale.set(2, 1);
    const map = level.addComponent(Tilemap, { solid: true, tileSize: 0.5 });
    map.resize(6, 2);
    // Two runs in the bottom row, one in the top row.
    for (const [column, row] of [
      [0, 0],
      [1, 0],
      [3, 0],
      [4, 0],
      [5, 0],
      [2, 1],
    ] as const) {
      map.setTile(column, row, 0);
    }
    physics.step(STEP);
    const hits = (x: number, y: number): boolean => physics.overlapPoint(new Vec2(x, y)).length > 0;
    // Cells are 1 unit wide and half a unit high after the entity's scale.
    expect(hits(1.9, 0.25)).toBe(true);
    expect(hits(2.5, 0.25)).toBe(false);
    expect(hits(5.9, 0.25)).toBe(true);
    expect(hits(2.5, 0.75)).toBe(true);
    expect(hits(1.5, 0.75)).toBe(false);
  });
});
