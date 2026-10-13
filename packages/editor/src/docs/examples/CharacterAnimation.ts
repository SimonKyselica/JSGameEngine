import { Behaviour, SpriteAnimator, SpriteRenderer } from 'rowan';

/** Picks the "idle", "walk" or "jump" animation from how the character is moving. */
export default class CharacterAnimation extends Behaviour {
  private animator!: SpriteAnimator;
  private sprite!: SpriteRenderer;

  onStart() {
    this.animator = this.requireComponent(SpriteAnimator);
    this.sprite = this.requireComponent(SpriteRenderer);
  }

  onUpdate() {
    const velocity = this.physics.getVelocity(this.entity);
    if (Math.abs(velocity.y) > 0.1) {
      this.animator.clip = 'jump';
    } else if (Math.abs(velocity.x) > 0.1) {
      this.animator.clip = 'walk';
    } else {
      this.animator.clip = 'idle';
    }
    // The sheet is drawn facing right, so it is mirrored while the character moves left.
    if (velocity.x !== 0) {
      this.sprite.flipX = velocity.x < 0;
    }
  }
}
