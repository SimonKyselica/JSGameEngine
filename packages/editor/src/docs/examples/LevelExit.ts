import { Behaviour, type Entity } from 'rowan';

/** A trigger that loads the next scene once the player has collected every coin. */
export default class LevelExit extends Behaviour {
  static properties = {
    nextScene: { type: 'string', default: 'Level 2' },
  };

  nextScene = 'Level 2';

  onTriggerEnter(other: Entity) {
    if (other.tag !== 'player') {
      return;
    }
    const coinsLeft = this.scene.findByTag('coin').length;
    if (coinsLeft > 0) {
      this.log(`${coinsLeft} coins are still out there`);
      return;
    }
    if (!this.assets.exists(this.nextScene, 'scene')) {
      this.error(`There is no scene called "${this.nextScene}"`);
      return;
    }
    // The switch happens once the current frame has finished.
    this.scene.load(this.nextScene);
  }
}
