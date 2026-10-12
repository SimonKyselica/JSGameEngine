import { Behaviour, Color, TextRenderer, type Entity, type ScriptLifecycle } from 'rowan';
import { harnessOf } from './support';
import type TestHarness from './TestHarness';

/** The frame in which the probe changes what is written. The host compares before and after. */
const CHANGE_FRAME = 20;

/**
 * Exercises text.
 *
 * Expects child texts "Title", with every field set to something other than its default,
 * "Frame Counter" and "Hidden Text".
 */
export default class TextProbe extends Behaviour implements ScriptLifecycle {
  private test!: TestHarness;

  onStart(): void {
    this.test = harnessOf(this);
    const test = this.test;

    const title = this.label('Title');
    test.check(
      'TextRenderer fields',
      title.text === 'Rowan\nFeature Test' &&
        title.font === 'serif' &&
        title.fontSize === 0.4 &&
        title.bold &&
        title.italic &&
        title.color.equals(new Color(1, 0.9, 0.4, 1)) &&
        title.align === 'left' &&
        title.verticalAlign === 'top' &&
        title.lineHeight === 1.5 &&
        title.sortingOrder === 3 &&
        title.visible,
    );
    test.check('TextRenderer.visible', !this.label('Hidden Text').visible);

    const added = this.scene.createEntity('Added Text', this.entity).addComponent(TextRenderer);
    test.check(
      'a new TextRenderer starts with the documented defaults',
      added.text === 'Text' &&
        added.font === 'sans-serif' &&
        added.fontSize === 0.5 &&
        !added.bold &&
        !added.italic &&
        added.color.equals(Color.white()) &&
        added.align === 'center' &&
        added.verticalAlign === 'middle' &&
        added.lineHeight === 1.2 &&
        added.sortingOrder === 0 &&
        added.visible,
    );
    // Out of the way of the other texts, and empty, so it draws nothing.
    added.text = '';
    test.expectLater('text changes were applied');
  }

  onUpdate(): void {
    if (this.time.frameCount !== CHANGE_FRAME) {
      return;
    }
    this.label('Frame Counter').text = `Frame ${this.time.frameCount}`;
    const title = this.label('Title');
    title.align = 'center';
    title.fontSize = 0.8;
    title.bold = false;
    this.label('Hidden Text').visible = true;
    this.test.pass('text changes were applied');
  }

  private label(name: string): TextRenderer {
    const child: Entity | null = this.entity.findChild(name);
    if (!child) {
      throw new Error(`TextProbe needs a child called "${name}"`);
    }
    return child.requireComponent(TextRenderer);
  }
}
