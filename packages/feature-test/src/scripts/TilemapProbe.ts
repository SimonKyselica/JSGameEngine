import {
  Behaviour,
  Color,
  Tilemap,
  type Collision,
  type Entity,
  type ScriptLifecycle,
} from 'rowan';
import { harnessOf } from './support';
import type TestHarness from './TestHarness';

/**
 * Exercises tilemaps.
 *
 * Expects to sit on a solid map of three tiles in one row, drawn from the sprite sheet,
 * with a falling body called "Tile Ball" above it.
 */
export default class TilemapProbe extends Behaviour implements ScriptLifecycle {
  private test!: TestHarness;
  private map!: Tilemap;
  private ball: Entity | null = null;
  private opened = false;

  onStart(): void {
    this.test = harnessOf(this);
    this.map = this.requireComponent(Tilemap);
    this.ball = this.scene.findByName('Tile Ball');
    const { test, map } = this;

    test.check(
      'Tilemap fields',
      map.texture === this.assets.find('Textures/sheet.png') &&
        map.columns === 4 &&
        map.rows === 2 &&
        map.tileSize === 0.5 &&
        map.width === 3 &&
        map.height === 1 &&
        map.tiles.join(',') === '0,5,7' &&
        map.color.equals(new Color(1, 1, 1, 0.9)) &&
        map.sortingOrder === 2 &&
        map.visible &&
        map.solid,
    );

    const scratch = this.scene.createEntity('Scratch Map').addComponent(Tilemap);
    scratch.visible = false;
    scratch.resize(2, 2);
    scratch.setTile(1, 1, 3);
    test.check(
      'Tilemap.resize, setTile and getTile',
      scratch.width === 2 &&
        scratch.height === 2 &&
        scratch.getTile(1, 1) === 3 &&
        scratch.getTile(0, 0) === -1 &&
        scratch.getTile(5, 5) === -1,
    );
    scratch.resize(3, 1);
    test.check('Tilemap.resize keeps the tiles that fit', scratch.tiles.join(',') === '-1,-1,-1');
    const before = scratch.revision;
    scratch.fill(4);
    test.check(
      'Tilemap.fill and revision',
      scratch.tiles.join(',') === '4,4,4' && scratch.revision === before + 1,
    );

    test.expectLater('a solid tilemap holds up a body');
    test.expectLater('a body falls through where tiles were removed');
  }

  onCollisionEnter(collision: Collision): void {
    if (collision.other !== this.ball || this.opened) {
      return;
    }
    this.test.pass('a solid tilemap holds up a body');
    // Take the floor away under it.
    this.map.fill(-1);
    this.opened = true;
  }

  onFixedUpdate(): void {
    if (this.opened && this.ball && this.ball.worldPosition.y < this.entity.worldPosition.y - 0.5) {
      this.test.pass('a body falls through where tiles were removed');
      this.opened = false;
    }
  }
}
