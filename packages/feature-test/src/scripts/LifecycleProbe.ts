import { Behaviour, ScriptComponent, type ScriptLifecycle } from 'rowan';
import Counter from './Counter';
import { harnessOf } from './support';
import type TestHarness from './TestHarness';

/**
 * Exercises the lifecycle callbacks, frame timing, enabling and disabling scripts, and
 * attaching a script to an entity while the game runs.
 *
 * Expects an entity "Counter" with the Counter script.
 */
export default class LifecycleProbe extends Behaviour implements ScriptLifecycle {
  private test!: TestHarness;
  private readonly order: string[] = [];
  private counter!: Counter;
  private countWhenDisabled = 0;
  private elapsedBefore = 0;
  private sawFirstUpdate = false;

  onStart(): void {
    this.test = harnessOf(this);
    this.order.push('start');
    this.test.check('onStart runs before the first frame', this.time.frameCount === 0);

    const counterEntity = this.scene.findByName('Counter');
    this.counter = this.getScript(Counter, counterEntity ?? undefined)!;
    this.test.check('Behaviour.getScript on another entity', this.counter instanceof Counter);

    this.test.expectLater('onDestroy runs when an entity is destroyed');
    this.test.expectLater('a script attached at runtime starts');
  }

  onFixedUpdate(fixedDeltaTime: number): void {
    if (this.order.length === 1) {
      this.order.push('fixed');
      this.test.check(
        'Time.fixedDeltaTime',
        fixedDeltaTime === this.time.fixedDeltaTime && fixedDeltaTime > 0,
      );
    }
  }

  onUpdate(deltaTime: number): void {
    const { test, time } = this;
    if (this.order.length === 2) {
      this.order.push('update');
    }
    const frame = time.frameCount;
    test.check('Time.deltaTime matches the update argument', deltaTime === time.deltaTime);

    if (!this.sawFirstUpdate) {
      this.sawFirstUpdate = true;
      test.check('Time.frameCount is 1 in the first update', frame === 1);
    }

    switch (frame) {
      case 1:
        test.check('Time.elapsed', time.elapsed > 0 && time.elapsed === deltaTime);
        test.check(
          'Time.unscaledDeltaTime',
          time.unscaledDeltaTime === deltaTime && time.timeScale === 1,
        );
        break;
      case 3:
        this.counter.enabled = false;
        this.countWhenDisabled = this.counter.updates;
        break;
      case 6:
        test.check(
          'a disabled script receives no updates',
          this.counter.updates === this.countWhenDisabled,
        );
        this.counter.enabled = true;
        break;
      case 9:
        test.check(
          'a re-enabled script receives updates again',
          this.counter.updates > this.countWhenDisabled,
        );
        test.check(
          'every lifecycle callback reaches the script',
          this.counter.fixedUpdates > 0 && this.counter.lateUpdates > 0,
        );
        time.timeScale = 0.5;
        this.elapsedBefore = time.elapsed;
        break;
      case 10:
        test.near('Time.timeScale slows game time', deltaTime, time.unscaledDeltaTime * 0.5, 1e-9);
        test.near(
          'Time.elapsed advances by scaled time',
          time.elapsed - this.elapsedBefore,
          deltaTime,
          1e-9,
        );
        time.timeScale = 1;
        break;
      case 12:
        this.attachScriptAtRuntime();
        break;
    }
  }

  onLateUpdate(): void {
    if (this.order.length === 3) {
      this.order.push('late');
      this.test.check(
        'callbacks run in order: start, fixed, update, late',
        this.order.join() === 'start,fixed,update,late',
        this.order.join(),
      );
    }
  }

  /** Adds the DestroyReporter script to a new entity, then destroys that entity. */
  private attachScriptAtRuntime(): void {
    const reporter = this.assets.find('DestroyReporter', 'script');
    const temporary = this.scene.createEntity('Temporary');
    temporary.addComponent(ScriptComponent, {
      scripts: [{ script: reporter, enabled: true, properties: {} }],
    });
    this.destroy(temporary, 0.1);
  }
}
