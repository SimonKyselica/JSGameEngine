import { Behaviour, MouseButton, type ScriptLifecycle } from 'rowan';
import { harnessOf } from './support';
import type TestHarness from './TestHarness';

/**
 * Exercises keyboard and mouse input. The checks wait for real input, so whoever runs
 * the scene has to provide it: hold and release Space, press D and W, press all three
 * mouse buttons inside the view, and scroll the wheel.
 */
export default class InputProbe extends Behaviour implements ScriptLifecycle {
  private test!: TestHarness;

  onStart(): void {
    this.test = harnessOf(this);
    for (const name of [
      'Input.isKeyDown',
      'Input.wasKeyPressed',
      'Input.wasKeyReleased',
      'Input.getAxis horizontal',
      'Input.getAxis vertical',
      'Input.isMouseButtonDown',
      'Input.wasMouseButtonPressed left',
      'Input.wasMouseButtonPressed middle',
      'Input.wasMouseButtonPressed right',
      'Input.wasMouseButtonReleased',
      'Input.mousePosition and mouseWorldPosition',
      'Input.scrollDelta',
    ]) {
      this.test.expectLater(name);
    }
    this.test.check(
      'Input reports nothing before any input',
      !this.input.isKeyDown('Space') &&
        this.input.getAxis('horizontal') === 0 &&
        this.input.scrollDelta === 0,
    );
  }

  onUpdate(): void {
    const { input, test } = this;
    if (input.wasKeyPressed('Space')) {
      test.check('a pressed key is also down', input.isKeyDown('Space'));
      test.pass('Input.wasKeyPressed');
    }
    if (input.isKeyDown('Space') && !input.wasKeyPressed('Space')) {
      test.pass('Input.isKeyDown');
    }
    if (input.wasKeyReleased('Space')) {
      test.check('a released key is no longer down', !input.isKeyDown('Space'));
      test.pass('Input.wasKeyReleased');
    }
    if (input.isKeyDown('KeyD') && input.getAxis('horizontal') === 1) {
      test.pass('Input.getAxis horizontal');
    }
    if (input.isKeyDown('KeyW') && input.getAxis('vertical') === 1) {
      test.pass('Input.getAxis vertical');
    }

    if (input.wasMouseButtonPressed(MouseButton.Left)) {
      test.pass('Input.wasMouseButtonPressed left');
      this.checkPointer();
    }
    if (input.wasMouseButtonPressed(MouseButton.Middle)) {
      test.pass('Input.wasMouseButtonPressed middle');
    }
    if (input.wasMouseButtonPressed(MouseButton.Right)) {
      test.pass('Input.wasMouseButtonPressed right');
    }
    if (
      input.isMouseButtonDown(MouseButton.Left) &&
      !input.wasMouseButtonPressed(MouseButton.Left)
    ) {
      test.pass('Input.isMouseButtonDown');
    }
    if (input.wasMouseButtonReleased(MouseButton.Left)) {
      test.pass('Input.wasMouseButtonReleased');
    }
    if (input.scrollDelta !== 0) {
      test.pass('Input.scrollDelta');
    }
  }

  /** The pointer must be inside the view, and its world position inside the camera's area. */
  private checkPointer(): void {
    const screen = this.input.mousePosition;
    const world = this.input.mouseWorldPosition;
    const camera = this.scene.mainCamera;
    const inView = screen.x >= 0 && screen.y >= 0;
    // The main camera sits at the origin and sees 6 units up and down.
    const inWorld = camera !== null && Math.abs(world.y) <= 6.01 && Math.abs(world.x) <= 11;
    this.test.check(
      'the pointer is inside the view when clicked',
      inView && inWorld,
      `screen ${screen.toString()}, world ${world.toString()}`,
    );
    this.test.pass('Input.mousePosition and mouseWorldPosition');
  }
}
