import { Behaviour, Camera, Color, SpriteRenderer, type Entity, type ScriptLifecycle } from 'rowan';
import { harnessOf } from './support';
import type TestHarness from './TestHarness';

/** The frame in which the probe changes what is drawn. The host compares before and after. */
const CHANGE_FRAME = 20;

/**
 * Exercises sprites and cameras.
 *
 * Expects child sprites "Checker", "Flipped", "Tinted" and "Hidden", an inactive child
 * "Inactive", the primary "Main Camera" and a second, non-primary "Alt Camera".
 */
export default class RenderProbe extends Behaviour implements ScriptLifecycle {
  private test!: TestHarness;

  onStart(): void {
    this.test = harnessOf(this);
    const test = this.test;

    const checker = this.sprite('Checker');
    test.check(
      'SpriteRenderer fields',
      checker.texture === this.assets.find('Textures/checker.png') &&
        checker.color.equals(Color.white()) &&
        !checker.flipX &&
        !checker.flipY &&
        checker.sortingOrder === 1 &&
        checker.pixelsPerUnit === 32 &&
        checker.visible,
    );
    const flipped = this.sprite('Flipped');
    test.check('SpriteRenderer.flipX and flipY', flipped.flipX && flipped.flipY);
    test.check('SpriteRenderer.color', this.sprite('Tinted').color.equals(new Color(1, 0, 0, 1)));
    test.check('SpriteRenderer.visible', !this.sprite('Hidden').visible);
    test.check('an inactive sprite entity', !this.child('Inactive').active);

    const main = this.scene.mainCamera;
    const alt = this.scene.findByName('Alt Camera');
    const mainCamera = main?.getComponent(Camera);
    const altCamera = alt?.getComponent(Camera);
    test.check(
      'Camera fields',
      mainCamera?.orthographicSize === 6 &&
        mainCamera.primary &&
        mainCamera.backgroundColor.equals(new Color(0.1, 0.12, 0.2, 1)),
    );
    if (mainCamera && altCamera) {
      mainCamera.primary = false;
      altCamera.primary = true;
      test.check('Camera.primary selects the main camera', this.scene.mainCamera === alt);
      mainCamera.primary = true;
      altCamera.primary = false;
      test.check('the main camera can be switched back', this.scene.mainCamera === main);
    }
    test.expectLater('sprite and camera changes were applied');
  }

  onUpdate(): void {
    if (this.time.frameCount !== CHANGE_FRAME) {
      return;
    }
    const checker = this.sprite('Checker');
    checker.texture = this.assets.find('Textures/disc.png');
    checker.sortingOrder = 5;
    checker.pixelsPerUnit = 16;
    this.sprite('Flipped').flipX = false;
    this.sprite('Tinted').color.set(0, 1, 0, 1);
    this.sprite('Hidden').visible = true;

    const camera = this.scene.mainCamera?.getComponent(Camera);
    if (camera) {
      camera.orthographicSize = 7;
      camera.backgroundColor = new Color(0.2, 0.1, 0.1, 1);
    }
    this.test.pass('sprite and camera changes were applied');
  }

  private child(name: string): Entity {
    const child = this.entity.children.find((candidate) => candidate.name === name);
    if (!child) {
      throw new Error(`RenderProbe needs a child called "${name}"`);
    }
    return child;
  }

  private sprite(name: string): SpriteRenderer {
    return this.child(name).requireComponent(SpriteRenderer);
  }
}
