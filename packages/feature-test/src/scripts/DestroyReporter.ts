import { Behaviour, type ScriptLifecycle } from 'rowan';
import { harnessOf } from './support';
import type TestHarness from './TestHarness';

/** Reports when it starts and when its entity is destroyed. Attached at runtime. */
export default class DestroyReporter extends Behaviour implements ScriptLifecycle {
  // Kept from the start: when the whole scene goes down, the harness may be gone already
  // by the time this script is told, and can then no longer be looked up.
  private test!: TestHarness;

  onStart(): void {
    this.test = harnessOf(this);
    this.test.pass('a script attached at runtime starts');
  }

  onDestroy(): void {
    this.test.pass('onDestroy runs when an entity is destroyed');
  }
}
