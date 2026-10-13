import { Behaviour, Tilemap, type Entity } from 'rowan';

/** Digs: a click removes the tile of the level that is under the pointer. */
export default class Digger extends Behaviour {
  private level: Entity | null = null;

  onStart() {
    this.level = this.scene.findByName('Level');
  }

  onUpdate() {
    if (!this.level || !this.input.wasMouseButtonPressed(0)) {
      return;
    }
    const map = this.level.requireComponent(Tilemap);
    // Cell (0, 0) starts at the position of the map's entity, and cells are tileSize large.
    const offset = this.input.mouseWorldPosition.sub(this.level.worldPosition);
    const column = Math.floor(offset.x / map.tileSize);
    const row = Math.floor(offset.y / map.tileSize);
    map.setTile(column, row, -1);
  }
}
