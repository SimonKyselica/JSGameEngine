import { Behaviour, type ScriptLifecycle } from 'rowan';

/** Counts how often each update callback runs. Used by LifecycleProbe. */
export default class Counter extends Behaviour implements ScriptLifecycle {
  updates = 0;
  fixedUpdates = 0;
  lateUpdates = 0;

  onUpdate(): void {
    this.updates++;
  }

  onFixedUpdate(): void {
    this.fixedUpdates++;
  }

  onLateUpdate(): void {
    this.lateUpdates++;
  }
}
