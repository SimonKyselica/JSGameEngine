import { Behaviour, Vec2 } from 'rowan';

/** Press E to report what is below this entity and what is close to it. */
export default class Scanner extends Behaviour {
  static properties = {
    reach: { type: 'number', default: 2, min: 0 },
  };

  reach = 2;

  onUpdate() {
    if (!this.input.wasKeyPressed('KeyE')) {
      return;
    }
    const origin = this.entity.worldPosition;

    // A ray does not report a collider it starts inside, so the entity never hits itself.
    const ground = this.physics.raycast(origin, new Vec2(0, -1), 20);
    this.log(
      ground ? `${ground.entity.name} is ${ground.distance.toFixed(2)} below` : 'Nothing below',
    );

    const nearby = this.physics
      .overlapCircle(origin, this.reach)
      .filter((entity) => entity !== this.entity);
    this.log('Within reach:', nearby.map((entity) => entity.name).join(', ') || 'nothing');
  }
}
