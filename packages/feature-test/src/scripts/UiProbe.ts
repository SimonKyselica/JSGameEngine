import {
  Behaviour,
  Button,
  Color,
  ScreenAnchor,
  TextRenderer,
  Vec2,
  type ScriptLifecycle,
} from 'rowan';
import { harnessOf } from './support';
import type TestHarness from './TestHarness';

/**
 * Exercises what is placed on the screen, and buttons.
 *
 * It sits on a button whose center is a quarter of the way in from the top-left corner of
 * the screen. Whoever runs the scene has to move the pointer there, click the left mouse
 * button and move the pointer away again. It also expects an entity "Disabled Button".
 */
export default class UiProbe extends Behaviour implements ScriptLifecycle {
  private test!: TestHarness;
  /** The pointer callbacks so far, in the order they arrived. */
  private readonly events: string[] = [];

  onStart(): void {
    this.test = harnessOf(this);
    const test = this.test;

    const anchor = this.requireComponent(ScreenAnchor);
    test.check('ScreenAnchor fields', anchor.horizontal === 'left' && anchor.vertical === 'top');
    // 320 pixels right of and 180 pixels below the top-left corner of a 1280x720 screen,
    // seen through a camera at the origin that shows 12 units: 60 pixels per unit.
    const expected = new Vec2(-1280 / 2 / 60 + 320 / 60, 6 - 180 / 60);
    test.check(
      'an anchored entity is where the camera shows its pixels',
      this.transform.position.equals(new Vec2(320, -180)) &&
        this.entity.worldPosition.equals(expected, 1e-3),
      this.entity.worldPosition.toString(),
    );
    test.check(
      'the children of an anchored entity are on the screen too',
      this.entity.findChild('Background')?.worldPosition.equals(expected, 1e-3) === true,
    );

    const button = this.requireComponent(Button);
    test.check(
      'Button fields',
      button.size.equals(new Vec2(240, 120)) &&
        button.interactable &&
        button.hoverColor.equals(new Color(1, 1, 0.6, 1)) &&
        button.pressedColor.equals(new Color(1, 0.6, 0.6, 1)) &&
        button.disabledColor.equals(new Color(0.5, 0.5, 0.5, 0.5)),
    );
    const disabled = this.scene.findByName('Disabled Button');
    test.check(
      'Button.interactable can be switched off',
      disabled?.getComponent(Button)?.interactable === false,
    );
    const centered = this.scene.createEntity('Centered').addComponent(ScreenAnchor);
    test.check(
      'a new ScreenAnchor is anchored to the center of the screen',
      centered.horizontal === 'center' && centered.vertical === 'middle',
    );

    for (const name of ['onPointerEnter', 'onPointerDown', 'onPointerUp', 'onClick']) {
      test.expectLater(name);
    }
    test.expectLater('onPointerExit, after the other pointer callbacks in their order');
  }

  onPointerEnter(): void {
    this.record('onPointerEnter');
  }

  onPointerDown(): void {
    this.record('onPointerDown');
  }

  onPointerUp(): void {
    this.record('onPointerUp');
  }

  onClick(): void {
    this.record('onClick');
    this.requireComponent(TextRenderer).text = 'Clicked';
  }

  onPointerExit(): void {
    const order = this.events.join(' ');
    this.test.check(
      'the pointer callbacks arrive as enter, down, up, click',
      order === 'onPointerEnter onPointerDown onPointerUp onClick',
      order,
    );
    this.test.pass('onPointerExit, after the other pointer callbacks in their order');
  }

  private record(callback: string): void {
    this.events.push(callback);
    this.test.pass(callback);
  }
}
