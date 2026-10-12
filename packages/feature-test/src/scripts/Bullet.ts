import { Behaviour, type ScriptLifecycle, type ScriptPropertyDefinitions } from 'rowan';
import { harnessOf } from './support';

/** A prefab script that removes its entity after a while. Spawned by Spawner. */
export default class Bullet extends Behaviour implements ScriptLifecycle {
  static properties: ScriptPropertyDefinitions = {
    lifetime: { type: 'number', default: 0.5, min: 0, label: 'Lifetime (seconds)' },
  };

  lifetime = 0.5;
  damage = 1;

  onStart(): void {
    if (this.damage === 7) {
      harnessOf(this).pass('a spawned script keeps values set by its spawner');
    }
    this.destroy(this.entity, this.lifetime);
  }

  onDestroy(): void {
    if (this.time.elapsed >= this.lifetime) {
      harnessOf(this).pass('a spawned entity destroys itself after its lifetime');
    }
  }
}
