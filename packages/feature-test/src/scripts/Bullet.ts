import { Behaviour, type ScriptLifecycle, type ScriptPropertyDefinitions } from 'rowan';
import { harnessOf } from './support';
import type TestHarness from './TestHarness';

/** A prefab script that removes its entity after a while. Spawned by Spawner. */
export default class Bullet extends Behaviour implements ScriptLifecycle {
  static properties: ScriptPropertyDefinitions = {
    lifetime: { type: 'number', default: 0.5, min: 0, label: 'Lifetime (seconds)' },
  };

  lifetime = 0.5;
  damage = 1;
  // Kept from the start, because the harness cannot be looked up while the scene goes down.
  private test!: TestHarness;

  onStart(): void {
    this.test = harnessOf(this);
    if (this.damage === 7) {
      this.test.pass('a spawned script keeps values set by its spawner');
    }
    this.destroy(this.entity, this.lifetime);
  }

  onDestroy(): void {
    if (this.time.elapsed >= this.lifetime) {
      this.test.pass('a spawned entity destroys itself after its lifetime');
    }
  }
}
