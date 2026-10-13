import { Behaviour, SpriteAnimator } from 'rowan';

/** Plays the "attack" animation once when Space is pressed, then returns to "idle". */
export default class Attack extends Behaviour {
  onUpdate() {
    if (this.input.wasKeyPressed('Space')) {
      const animator = this.requireComponent(SpriteAnimator);
      animator.clip = 'attack';
      // Starts the swing over when Space is pressed again in the middle of one.
      animator.time = 0;
    }
  }

  onAnimationEnd(clip: string) {
    if (clip === 'attack') {
      this.requireComponent(SpriteAnimator).clip = 'idle';
    }
  }
}
