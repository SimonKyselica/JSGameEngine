import { Behaviour, SpriteAnimator, SpriteRenderer, type ScriptLifecycle } from 'rowan';
import { harnessOf } from './support';
import type TestHarness from './TestHarness';

/**
 * Exercises sprite sheets and animation.
 *
 * Expects to sit on an entity whose sprite is a sheet of 4 columns and 2 rows, with an
 * animator that has a looping clip "blink" over frames 0 to 3, which is playing, and a clip
 * "once" over frames 4 to 6 that does not loop.
 */
export default class AnimationProbe extends Behaviour implements ScriptLifecycle {
  private test!: TestHarness;
  private sprite!: SpriteRenderer;
  private animator!: SpriteAnimator;
  /** How far the looping clip was in the previous frame, to notice when it starts over. */
  private previousTime = 0;
  /** Set when the sprite showed a frame other than the one the clip's time asks for. */
  private mismatch = '';
  private stage: 'looping' | 'once' | 'frozen' | 'done' = 'looping';
  private frozenFrames = 0;

  onStart(): void {
    this.test = harnessOf(this);
    this.sprite = this.requireComponent(SpriteRenderer);
    this.animator = this.requireComponent(SpriteAnimator);
    const { test, sprite, animator } = this;

    test.check(
      'SpriteRenderer sheet fields',
      sprite.columns === 4 && sprite.rows === 2 && sprite.frame === 0,
    );
    const [blink, once] = animator.clips;
    test.check(
      'SpriteAnimator fields',
      animator.clips.length === 2 &&
        animator.clip === 'blink' &&
        animator.playing &&
        animator.speed === 1 &&
        animator.time === 0,
    );
    test.check(
      'AnimationClip fields',
      blink?.name === 'blink' &&
        blink.firstFrame === 0 &&
        blink.lastFrame === 3 &&
        blink.framesPerSecond === 30 &&
        blink.loop &&
        once?.name === 'once' &&
        !once.loop,
    );
    test.expectLater('a looping clip shows the frame its time asks for, and starts over');
    test.expectLater('choosing another clip starts it from its first frame');
    test.expectLater('onAnimationEnd reports the clip that ended, on its last frame');
    test.expectLater('an animator that is not playing keeps its frame');
  }

  onLateUpdate(): void {
    const { test, sprite, animator } = this;
    if (this.stage === 'looping') {
      // Checked against the clip's own time rather than by counting frames of the game,
      // which are longer on some machines and would then skip frames of the animation.
      const expected = Math.floor(animator.time * 30) % 4;
      if (sprite.frame !== expected && this.mismatch === '') {
        this.mismatch = `frame ${sprite.frame} at ${animator.time} seconds, expected ${expected}`;
      }
      // The time of a looping clip only ever goes back when the clip starts over.
      if (animator.time < this.previousTime) {
        test.settle(
          'a looping clip shows the frame its time asks for, and starts over',
          this.mismatch === '',
          this.mismatch,
        );
        animator.clip = 'once';
        this.stage = 'once';
      }
      this.previousTime = animator.time;
    } else if (this.stage === 'once' && animator.time === 0) {
      // The frame in which the new clip started.
      test.settle('choosing another clip starts it from its first frame', sprite.frame === 4);
    } else if (this.stage === 'frozen') {
      this.frozenFrames++;
      if (this.frozenFrames === 10) {
        test.settle(
          'an animator that is not playing keeps its frame',
          sprite.frame === 5 && animator.time === 0.05,
          `frame ${sprite.frame}, time ${animator.time}`,
        );
        this.stage = 'done';
      }
    }
  }

  onAnimationEnd(clip: string): void {
    this.test.settle(
      'onAnimationEnd reports the clip that ended, on its last frame',
      clip === 'once' && this.sprite.frame === 6,
      `clip "${clip}", frame ${this.sprite.frame}`,
    );
    // Rewound to its second frame and stopped there, at twice the speed it will not use.
    this.animator.time = 0.05;
    this.animator.speed = 2;
    this.animator.playing = false;
    this.stage = 'frozen';
  }
}
