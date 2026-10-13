import { Behaviour, type ScriptLifecycle, type TouchPoint } from 'rowan';
import { harnessOf } from './support';
import type TestHarness from './TestHarness';

/**
 * Exercises touch input.
 *
 * It sits on a button near the bottom-right corner of the screen. Whoever runs the scene
 * on a touch screen has to put one finger down somewhere else, then a second finger on this
 * button, and lift both again.
 *
 * The checks that need fingers are only announced when the first finger arrives. A person
 * who runs the scene on a computer without a touch screen cannot provide them, and the
 * scene must not wait for them and then report them as failed.
 */
export default class TouchProbe extends Behaviour implements ScriptLifecycle {
  private test!: TestHarness;
  private announced = false;

  onStart(): void {
    this.test = harnessOf(this);
    this.test.check(
      'Input.touches is empty and touchCount is 0 before any touch',
      this.input.touches.length === 0 && this.input.touchCount === 0,
    );
  }

  onUpdate(): void {
    const { input, test } = this;
    const touches: TouchPoint[] = input.touches;
    if (touches.length > 0 && !this.announced) {
      this.announced = true;
      for (const name of [
        'Input.touches reports a finger that touches the screen',
        'Input.touchCount counts the fingers that are down',
        'a second finger presses a button while the first is held',
        'TouchPoint.ended is true in the frame a finger is lifted',
      ]) {
        test.expectLater(name);
      }
    }
    const began = touches.find((touch) => touch.began);
    if (began) {
      const { position, worldPosition } = began;
      // The main camera sits at the origin and sees 7 units up and down at most.
      test.settle(
        'Input.touches reports a finger that touches the screen',
        Number.isInteger(began.id) &&
          position.x >= 0 &&
          position.y >= 0 &&
          Math.abs(worldPosition.y) <= 7.01 &&
          !began.ended,
        `touch ${began.id} at ${position.toString()}, in the world ${worldPosition.toString()}`,
      );
    }
    if (input.touchCount === 2) {
      test.pass('Input.touchCount counts the fingers that are down');
    }
    const ended = touches.find((touch) => touch.ended);
    if (ended) {
      test.settle(
        'TouchPoint.ended is true in the frame a finger is lifted',
        !ended.began && input.touchCount === touches.length - 1,
        `${touches.length} touches listed, ${input.touchCount} counted`,
      );
    }
  }

  onPointerDown(): void {
    this.test.settle(
      'a second finger presses a button while the first is held',
      this.input.touchCount === 2,
      `${this.input.touchCount} fingers were down`,
    );
  }
}
