import { Behaviour, Vec2, type SaveValue, type ScriptLifecycle } from 'rowan';
import { harnessOf } from './support';

/**
 * Exercises save data. It leaves "visits" and "trail" behind for `FinishProbe`, which
 * checks in the next scene that they are still there.
 */
export default class StorageProbe extends Behaviour implements ScriptLifecycle {
  onStart(): void {
    const test = harnessOf(this);
    const { storage } = this;

    // Whatever an earlier run left in this browser would get in the way of the checks.
    storage.clear();
    test.check('StorageApi.clear', storage.keys().length === 0);
    test.check(
      'StorageApi.get returns the fallback for a name that is not saved',
      storage.get('visits') === undefined && storage.get('visits', 7) === 7,
    );

    storage.set('visits', 1);
    storage.set('muted', false);
    test.check(
      'StorageApi.set and get',
      storage.get('visits', 0) === 1 && storage.get('muted', true) === false,
    );
    test.check('StorageApi.has', storage.has('visits') && !storage.has('score'));
    test.check('StorageApi.keys', storage.keys().join(',') === 'visits,muted');
    test.check(
      'StorageApi.remove',
      storage.remove('muted') && !storage.remove('muted') && !storage.has('muted'),
    );

    const trail: SaveValue = { points: [new Vec2(1, 2).toArray(), [3, 4]], label: 'trail' };
    storage.set('trail', trail);
    const read = storage.get('trail', { points: [] as number[][], label: '' });
    read.points.push([5, 6]);
    test.check(
      'saved arrays and objects are copies',
      read.label === 'trail' &&
        read.points[0]?.[1] === 2 &&
        storage.get('trail', read).points.length === 2,
    );

    let message = '';
    try {
      storage.set('position', this.transform.position as unknown as SaveValue);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    test.check(
      'a value that cannot be saved is refused with advice',
      message.includes('toArray()') && !storage.has('position'),
      message,
    );
  }
}
