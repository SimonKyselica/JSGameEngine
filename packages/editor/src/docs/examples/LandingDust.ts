import { Behaviour, ParticleEmitter, type Collision } from 'rowan';

/** Kicks up a puff of dust whenever the entity lands on something. */
export default class LandingDust extends Behaviour {
  onCollisionEnter(collision: Collision) {
    // The normal points from this entity to the other one: downwards when it has landed.
    if (collision.normal.y < -0.5) {
      this.requireComponent(ParticleEmitter).burst(12);
    }
  }
}
