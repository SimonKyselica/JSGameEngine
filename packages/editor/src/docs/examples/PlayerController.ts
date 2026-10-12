import { Behaviour, Vec2, type Collision, type Entity } from 'rowan';

/** A platformer character: run with A/D, jump with Space, collect entities tagged "coin". */
export default class PlayerController extends Behaviour {
  static properties = {
    speed: { type: 'number', default: 5, min: 0 },
    jumpSpeed: { type: 'number', default: 7, min: 0 },
  };

  speed = 5;
  jumpSpeed = 7;

  private grounded = false;
  private coins = 0;

  onUpdate() {
    // Key presses last one frame, so they are read in onUpdate, which runs every frame.
    if (this.grounded && this.input.wasKeyPressed('Space')) {
      const mass = this.physics.getMass(this.entity);
      this.physics.applyImpulse(this.entity, new Vec2(0, this.jumpSpeed * mass));
      this.grounded = false;
    }
  }

  onFixedUpdate() {
    // Keep the vertical speed gravity produced and replace only the horizontal one.
    const velocity = this.physics.getVelocity(this.entity);
    velocity.x = this.input.getAxis('horizontal') * this.speed;
    this.physics.setVelocity(this.entity, velocity);
  }

  onCollisionEnter(collision: Collision) {
    // The normal points from this entity to the other one: down means "standing on it".
    if (collision.normal.y < -0.5) {
      this.grounded = true;
    }
  }

  onTriggerEnter(other: Entity) {
    if (other.tag === 'coin') {
      this.coins++;
      this.log('Coins:', this.coins);
      this.destroy(other);
    }
  }
}
