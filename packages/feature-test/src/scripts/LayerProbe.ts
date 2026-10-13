import { Behaviour, type Collision, type ScriptLifecycle } from 'rowan';
import { harnessOf } from './support';
import type TestHarness from './TestHarness';

/**
 * Exercises collision layers.
 *
 * Expects to sit on a falling body on the layer "Phantom", which the project settings keep
 * from colliding with "Default". Below it are two floors on the default layer: "Thin Floor",
 * which it has to fall through, and "Catch Floor" further down, which has to stop it once
 * the probe has moved its entity to the default layer.
 */
export default class LayerProbe extends Behaviour implements ScriptLifecycle {
  private test!: TestHarness;
  private passedThrough = false;

  onStart(): void {
    this.test = harnessOf(this);
    this.test.check('Entity.layer', this.entity.layer === 'Phantom');
    this.test.expectLater('a body passes through a layer that its own layer ignores');
    this.test.expectLater('a body moved to another layer collides with it');
  }

  onFixedUpdate(): void {
    const thinFloor = this.scene.findByName('Thin Floor');
    if (this.passedThrough || !thinFloor) {
      return;
    }
    // Well below the floor it started above: it was not stopped.
    if (this.entity.worldPosition.y < thinFloor.worldPosition.y - 0.75) {
      this.passedThrough = true;
      this.test.pass('a body passes through a layer that its own layer ignores');
      this.entity.layer = 'Default';
    }
  }

  onCollisionEnter(collision: Collision): void {
    this.test.settle(
      'a body moved to another layer collides with it',
      this.passedThrough && collision.other.name === 'Catch Floor',
      `touched "${collision.other.name}" ${this.passedThrough ? 'after' : 'before'} passing through`,
    );
  }
}
