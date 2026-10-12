import { Behaviour, type ScriptLifecycle } from 'rowan';
import { harnessOf } from './support';

/** Reports when it starts and when its entity is destroyed. Attached at runtime. */
export default class DestroyReporter extends Behaviour implements ScriptLifecycle {
  onStart(): void {
    harnessOf(this).pass('a script attached at runtime starts');
  }

  onDestroy(): void {
    harnessOf(this).pass('onDestroy runs when an entity is destroyed');
  }
}
